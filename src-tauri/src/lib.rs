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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
    .invoke_handler(tauri::generate_handler![home_dir, list_dir])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
