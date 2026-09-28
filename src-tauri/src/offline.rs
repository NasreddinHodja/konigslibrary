use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn validate_path_component(s: &str) -> Result<(), String> {
  let mut components = Path::new(s).components();
  match (components.next(), components.next()) {
    (Some(Component::Normal(_)), None) => Ok(()),
    _ => Err(format!("Invalid path component: {s:?}")),
  }
}

/// Where downloaded manga live, one folder per manga, laid out like the
/// library they came from.
pub fn offline_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(
    app
      .path()
      .app_data_dir()
      .map_err(|e| e.to_string())?
      .join("offline"),
  )
}

#[derive(Serialize)]
pub struct OfflineManga {
  /// The server slug the manga was downloaded under.
  slug: String,
  name: String,
  path: String,
}

/// Every downloaded manga with at least one finished chapter.
#[tauri::command]
pub async fn list_offline_manga(app: AppHandle) -> Result<Vec<OfflineManga>, String> {
  let dir = offline_dir(&app)?;
  let Ok(read) = std::fs::read_dir(&dir) else {
    return Ok(vec![]);
  };

  let mut results = vec![];
  for entry in read.flatten() {
    let path = entry.path();
    let has_chapter = std::fs::read_dir(&path).is_ok_and(|mut files| {
      files.any(|f| f.is_ok_and(|f| klparse::is_zip_name(&f.file_name().to_string_lossy())))
    });
    if !has_chapter {
      continue;
    }
    let slug = entry.file_name().to_string_lossy().into_owned();
    results.push(OfflineManga {
      name: klparse::decode_uri_component(&slug).unwrap_or_else(|| slug.clone()),
      path: path.to_string_lossy().into_owned(),
      slug,
    });
  }

  results.sort_by(|a, b| a.name.cmp(&b.name));
  Ok(results)
}

#[tauri::command]
pub async fn delete_offline_manga(app: AppHandle, slug: String) -> Result<(), String> {
  validate_path_component(&slug)?;
  let dir = offline_dir(&app)?.join(&slug);
  if dir.exists() {
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
  }
  Ok(())
}
