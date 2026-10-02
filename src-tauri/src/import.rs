//! Manga added through the upload button, copied into the app's own storage.
//!
//! Copied rather than remembered: Android only lends access to a picked file
//! until the device restarts, and has no folder picker at all, so a manga that
//! should stay in the library has to live somewhere the app owns.

use std::path::{Path, PathBuf};

use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{AppHandle, Manager};

use crate::download::DownloadProgress;
use crate::offline::{delete_manga_folder, validate_path_component};

/// Where imported manga live, one folder per manga, named after it.
pub fn import_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(
    app
      .path()
      .app_data_dir()
      .map_err(|e| e.to_string())?
      .join("library"),
  )
}

/// Whether a file belongs in a manga folder: a chapter archive or the cover.
fn is_manga_file(name: &str) -> bool {
  klparse::is_chapter_name(name) || klparse::is_cover_name(name)
}

/// Writes `dir/name` through a `.part` file, so a manga folder never holds half
/// a chapter that the listing would count as finished. A failed write (a full
/// disk, say) takes its `.part` with it.
fn write_via_part(
  dir: &Path,
  name: &str,
  write: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<(), String> {
  let part = dir.join(format!("{name}.part"));
  let written = write(&part).and_then(|()| std::fs::rename(&part, dir.join(name)));
  written.map_err(|e| {
    let _ = std::fs::remove_file(&part);
    e.to_string()
  })
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
  let raw = request
    .headers()
    .get(name)
    .and_then(|v| v.to_str().ok())
    .ok_or_else(|| format!("missing {name} header"))?;
  let value = klparse::decode_uri_component(raw).ok_or_else(|| format!("bad {name} header"))?;
  validate_path_component(&value)?;
  Ok(value)
}

/// Adds one file to an imported manga, creating the manga if it is new.
/// The bytes are the request body; the `manga` and `file` headers name where
/// they go, percent-encoded. Returns the manga folder.
/// Async (off the main thread) so writing a whole chapter doesn't stall the UI.
#[tauri::command(async)]
pub fn import_file(app: AppHandle, request: Request<'_>) -> Result<String, String> {
  let manga = header(&request, "manga")?;
  let file = header(&request, "file")?;
  if !is_manga_file(&file) {
    return Err(format!("{file} is not a chapter archive or a cover"));
  }
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("expected the file's bytes".to_string());
  };

  let dir = import_dir(&app)?.join(&manga);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  write_via_part(&dir, &file, |part| std::fs::write(part, bytes))?;
  Ok(dir.to_string_lossy().into_owned())
}

/// Copies a manga folder picked on desktop into the library: its chapter
/// archives and cover, nothing else. Reports progress per file and returns the
/// new manga folder.
#[tauri::command]
pub async fn import_manga_folder(
  app: AppHandle,
  path: String,
  channel: Channel<DownloadProgress>,
) -> Result<String, String> {
  let src = PathBuf::from(&path);
  let name = src
    .file_name()
    .map(|n| n.to_string_lossy().into_owned())
    .ok_or_else(|| format!("{path} is not a folder"))?;

  let files: Vec<String> = std::fs::read_dir(&src)
    .map_err(|e| e.to_string())?
    .flatten()
    .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
    .map(|e| e.file_name().to_string_lossy().into_owned())
    .filter(|n| is_manga_file(n))
    .collect();
  if !files.iter().any(|n| klparse::is_zip_name(n)) {
    return Err(format!("No chapter archives in {name}"));
  }

  let dir = import_dir(&app)?.join(&name);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let total = files.len() as u64;
  for (i, file) in files.iter().enumerate() {
    write_via_part(&dir, file, |part| std::fs::copy(src.join(file), part).map(|_| ()))?;
    let _ = channel.send(DownloadProgress {
      current: i as u64 + 1,
      total,
    });
  }
  Ok(dir.to_string_lossy().into_owned())
}

/// Deletes an imported manga one file at a time, reporting how many are gone.
#[tauri::command]
pub async fn delete_imported_manga(
  app: AppHandle,
  name: String,
  channel: Channel<DownloadProgress>,
) -> Result<(), String> {
  validate_path_component(&name)?;
  delete_manga_folder(&import_dir(&app)?.join(&name), &channel)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_chapters_and_the_cover_are_imported() {
    assert!(is_manga_file("Chapter 1.cbz"));
    assert!(is_manga_file("ch2.ZIP"));
    assert!(is_manga_file("Cover.jpg"));
    assert!(!is_manga_file("page1.jpg"));
    assert!(!is_manga_file("notes.txt"));
    assert!(!is_manga_file(".hidden.cbz"));
  }
}
