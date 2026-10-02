use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::download::DownloadProgress;

/// Rejects anything but one file or folder name (see `klparse::is_plain_name`).
pub fn validate_path_component(s: &str) -> Result<(), String> {
  if klparse::is_plain_name(s) {
    Ok(())
  } else {
    Err(format!("Invalid path component: {s:?}"))
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
  pub slug: String,
  pub name: String,
  pub path: String,
}

/// The folders in `dir` holding at least one finished chapter archive, as
/// (folder name, path). Dotfolders and dotfiles don't count, as in every
/// other listing.
pub fn manga_folders(dir: &Path) -> Vec<(String, String)> {
  let Ok(read) = std::fs::read_dir(dir) else {
    return vec![];
  };
  read
    .flatten()
    .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
    .filter(|entry| {
      std::fs::read_dir(entry.path()).is_ok_and(|mut files| {
        files.any(|f| {
          f.is_ok_and(|f| klparse::is_chapter_name(&f.file_name().to_string_lossy()))
        })
      })
    })
    .map(|entry| {
      (
        entry.file_name().to_string_lossy().into_owned(),
        entry.path().to_string_lossy().into_owned(),
      )
    })
    .collect()
}

/// Every downloaded manga in `dir` with at least one finished chapter.
pub fn scan(dir: &Path) -> Vec<OfflineManga> {
  manga_folders(dir)
    .into_iter()
    .map(|(slug, path)| OfflineManga {
      name: klparse::decode_uri_component(&slug).unwrap_or_else(|| slug.clone()),
      path,
      slug,
    })
    .collect()
}

/// Every downloaded manga with at least one finished chapter.
#[tauri::command]
pub async fn list_offline_manga(app: AppHandle) -> Result<Vec<OfflineManga>, String> {
  let mut results = scan(&offline_dir(&app)?);
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
  delete_manga_folder(&offline_dir(&app)?.join(&slug), &channel)
}

/// Deletes a manga folder one file at a time, reporting how many are gone.
pub fn delete_manga_folder(dir: &Path, channel: &Channel<DownloadProgress>) -> Result<(), String> {
  let Ok(read) = std::fs::read_dir(dir) else {
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
  std::fs::remove_dir_all(dir).map_err(|e| e.to_string())
}
