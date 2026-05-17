use serde::Serialize;

#[derive(Serialize)]
struct DirEntry {
  name: String,
  is_dir: bool,
}

#[tauri::command]
fn home_dir() -> Result<String, String> {
  std::env::var("HOME")
    .or_else(|_| std::env::var("USERPROFILE"))
    .map_err(|_| "could not determine home directory".to_string())
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
  let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
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

#[tauri::command]
#[allow(unused_variables)]
fn set_immersive(_app: tauri::AppHandle, _hidden: bool) -> Result<(), String> {
  // run_mobile_plugin removed in Tauri 2.10 — needs updated mobile plugin API
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "linux")]
  std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![home_dir, list_dir, set_immersive])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
