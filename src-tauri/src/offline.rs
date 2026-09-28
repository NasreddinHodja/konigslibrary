use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::download::DownloadProgress;

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

/// Deletes a downloaded manga one file at a time, reporting how many are gone.
#[tauri::command]
pub async fn delete_offline_manga(
  app: AppHandle,
  slug: String,
  channel: Channel<DownloadProgress>,
) -> Result<(), String> {
  validate_path_component(&slug)?;
  let dir = offline_dir(&app)?.join(&slug);
  let Ok(read) = std::fs::read_dir(&dir) else {
    return Ok(());
  };
  let files: Vec<PathBuf> = read
    .flatten()
    .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
    .map(|e| e.path())
    .collect();

  let total = files.len() as u64;
  for (i, file) in files.iter().enumerate() {
    std::fs::remove_file(file).map_err(|e| e.to_string())?;
    let _ = channel.send(DownloadProgress {
      current: i as u64 + 1,
      total,
    });
  }
  std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}
