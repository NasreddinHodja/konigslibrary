mod download;
mod immersive;
mod offline;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Serialize)]
struct DirEntry {
  name: String,
  is_dir: bool,
}

struct MangaDirState(Mutex<Option<PathBuf>>);

#[tauri::command]
fn home_dir() -> Result<String, String> {
  std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .map_err(|_| "could not determine home directory".to_string())
}

#[tauri::command]
fn set_manga_dir(app: tauri::AppHandle, state: tauri::State<MangaDirState>, dir: String) -> Result<(), String> {
  let canonical = std::fs::canonicalize(&dir).map_err(|e| e.to_string())?;
  app.asset_protocol_scope().allow_directory(&canonical, true).map_err(|e| e.to_string())?;
  *state.0.lock().unwrap() = Some(canonical);
  Ok(())
}

#[tauri::command]
fn list_dir(state: tauri::State<MangaDirState>, path: String) -> Result<Vec<DirEntry>, String> {
  let allowed_root = state
    .0
    .lock()
    .unwrap()
    .clone()
    .ok_or("manga directory not configured")?;

  let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;

  if !canonical.starts_with(&allowed_root) {
    return Err("path is outside the configured manga directory".to_string());
  }

  let entries = std::fs::read_dir(&canonical).map_err(|e| e.to_string())?;
  let mut results = Vec::new();
  for entry in entries {
    let entry = entry.map_err(|e| e.to_string())?;
    let ft = entry.file_type().map_err(|e| e.to_string())?;
    results.push(DirEntry {
      name: entry.file_name().to_string_lossy().to_string(),
      is_dir: ft.is_dir(),
    });
  }
  results.sort_by(|a, b| a.name.cmp(&b.name));
  Ok(results)
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "linux")]
  std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

  tauri::Builder::default()
    .manage(download::DownloadState(Default::default()))
    .manage(MangaDirState(Mutex::new(None)))
    .plugin(immersive::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
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
      list_dir,
      download::download_chapter,
      download::cancel_download,
      offline::list_offline_manga,
      offline::get_offline_manga,
      offline::get_chapter_page_paths,
      offline::delete_offline_manga,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
