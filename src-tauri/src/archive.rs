//! Chapter archives (`<manga>/<chapter>.cbz`) in the native library, read
//! through `klfs`, as the server reads them.

use std::path::Path;

use klfs::ZipCache;
use klparse::{is_chapter_name, is_image_name, locale_cmp, MangaMeta};
use serde::Serialize;

#[derive(Serialize)]
pub struct Chapter {
  name: String,
  archive: String,
  pages: Vec<String>,
}

/// One chapter per archive in a manga folder, sorted the way the server sorts
/// them. A corrupt archive is skipped rather than failing the whole manga.
pub fn list_chapters(dir: &Path) -> Result<Vec<Chapter>, String> {
  let mut chapters: Vec<Chapter> = Vec::new();
  for file in klfs::file_names(dir).map_err(|e| e.to_string())? {
    if !is_chapter_name(&file) {
      continue;
    }
    let path = dir.join(&file);
    let pages = klfs::archive_pages(&path);
    if !pages.is_empty() {
      chapters.push(Chapter {
        name: klparse::strip_zip_ext(&file).to_string(),
        archive: path.to_string_lossy().into_owned(),
        pages,
      });
    }
  }
  chapters.sort_by(|a, b| locale_cmp(&a.name, &b.name));
  Ok(chapters)
}

/// One page of a chapter archive. The archive's directory is parsed once and
/// kept in `cache`, not re-read on every page turn.
pub fn read_page(cache: &ZipCache, path: &Path, entry_name: &str) -> Result<Vec<u8>, String> {
  if !is_image_name(entry_name) {
    return Err("not an image entry".to_string());
  }
  klfs::read_entry(cache, path, entry_name)
    .map_err(|e| format!("{e:?}"))?
    .ok_or_else(|| "entry not found in archive".to_string())
}

/// ComicInfo metadata and cover of a manga folder.
pub fn manga_meta(dir: &Path) -> Result<MangaMeta, String> {
  let names = klfs::file_names(dir).map_err(|e| e.to_string())?;
  Ok(klfs::manga_meta(dir, &names))
}
