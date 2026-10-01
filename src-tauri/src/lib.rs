mod archive;
mod device_library;
mod download;
mod immersive;
mod import;
mod lan_server;
mod offline;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// Directories the webview may read from: the configured manga directory and
/// the app's own downloads and imports folders.
#[derive(Default)]
struct Roots {
  manga: Option<PathBuf>,
  others: Vec<PathBuf>,
}

struct MangaDirState(Mutex<Roots>);

#[tauri::command]
fn home_dir() -> Result<String, String> {
  std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .map_err(|_| "could not determine home directory".to_string())
}

#[tauri::command]
fn set_manga_dir(
  app: tauri::AppHandle,
  state: tauri::State<MangaDirState>,
  dir: String,
) -> Result<(), String> {
  let canonical = std::fs::canonicalize(&dir).map_err(|e| e.to_string())?;
  app
    .asset_protocol_scope()
    .allow_directory(&canonical, true)
    .map_err(|e| e.to_string())?;
  state.0.lock().unwrap().manga = Some(canonical);
  Ok(())
}

/// Canonicalizes `path`, rejecting anything outside the allowed roots.
fn allowed_path(state: &MangaDirState, path: &str) -> Result<PathBuf, String> {
  let canonical = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
  let roots = state.0.lock().unwrap();
  let allowed = roots
    .manga
    .iter()
    .chain(roots.others.iter())
    .any(|root| canonical.starts_with(root));
  if !allowed {
    return Err("path is outside the manga directories".to_string());
  }
  Ok(canonical)
}

#[tauri::command]
fn list_manga_chapters(
  state: tauri::State<MangaDirState>,
  path: String,
) -> Result<Vec<archive::Chapter>, String> {
  archive::list_chapters(&allowed_path(&state, &path)?)
}

#[tauri::command]
fn read_archive_page(
  state: tauri::State<MangaDirState>,
  path: String,
  entry: String,
) -> Result<tauri::ipc::Response, String> {
  let bytes = archive::read_page(&allowed_path(&state, &path)?, &entry)?;
  Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn read_manga_meta(
  state: tauri::State<MangaDirState>,
  path: String,
) -> Result<klparse::MangaMeta, String> {
  archive::manga_meta(&allowed_path(&state, &path)?)
}

/// Manga per Device-tab page when the webview does not ask for a size, and
/// the most it may ask for.
const DEVICE_PAGE: usize = 100;
const DEVICE_PAGE_MAX: usize = 500;

/// One page of the Device tab: the configured manga directory and the
/// downloads folder together, filtered to names containing `query`.
#[tauri::command]
async fn list_device_manga(
  app: tauri::AppHandle,
  roots: tauri::State<'_, MangaDirState>,
  index: tauri::State<'_, device_library::DeviceIndex>,
  query: Option<String>,
  after: Option<String>,
  limit: Option<usize>,
) -> Result<device_library::DevicePage, String> {
  let manga_dir = roots.0.lock().unwrap().manga.clone();
  Ok(index.page(
    manga_dir.as_deref(),
    &offline::offline_dir(&app)?,
    &import::import_dir(&app)?,
    query.as_deref().unwrap_or(""),
    after.as_deref(),
    limit.unwrap_or(DEVICE_PAGE).clamp(1, DEVICE_PAGE_MAX),
  ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "linux")]
  std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

  tauri::Builder::default()
    .manage(download::DownloadState(Default::default()))
    .manage(MangaDirState(Mutex::new(Roots::default())))
    .manage(device_library::DeviceIndex::default())
    .manage(lan_server::LanServerState::default())
    .plugin(immersive::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_deep_link::init())
    .setup(|app| {
      // The app's own manga folders are always readable.
      for dir in [
        offline::offline_dir(app.handle())?,
        import::import_dir(app.handle())?,
      ] {
        std::fs::create_dir_all(&dir)?;
        app
          .state::<MangaDirState>()
          .0
          .lock()
          .unwrap()
          .others
          .push(std::fs::canonicalize(&dir)?);
      }

      let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Info
      } else {
        log::LevelFilter::Warn
      };
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log_level)
          .build(),
      )?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      home_dir,
      set_manga_dir,
      list_device_manga,
      list_manga_chapters,
      read_archive_page,
      read_manga_meta,
      download::download_file,
      download::cancel_download,
      offline::list_offline_manga,
      offline::delete_offline_manga,
      import::import_file,
      import::import_manga_folder,
      import::delete_imported_manga,
      lan_server::start_lan_server,
      lan_server::stop_lan_server,
      lan_server::lan_server_status,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
        if let Some(state) = app_handle.try_state::<lan_server::LanServerState>() {
          lan_server::kill_if_running(&state);
        }
      }
    });
}
