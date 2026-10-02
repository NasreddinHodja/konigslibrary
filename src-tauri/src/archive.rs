//! Chapter archives (`<manga>/<chapter>.cbz`) in the native library, read
//! through `klfs`, as the server reads them.

use std::path::Path;

use klfs::ZipCache;
use klparse::{chapter_cmp, chapter_number, is_chapter_name, is_image_name, MangaMeta};
use serde::Serialize;

#[derive(Serialize)]
pub struct Chapter {
  name: String,
  archive: String,
  pages: Vec<String>,
}

/// One chapter per archive in a manga folder, in chapter order as the server
/// sorts them. A corrupt archive is skipped rather than failing the whole manga;
/// a folder of more than [`klparse::MAX_CHAPTERS`] archives is an error.
pub fn list_chapters(dir: &Path) -> Result<Vec<Chapter>, String> {
  let mut files = klfs::file_names(dir).map_err(|e| e.to_string())?;
  files.retain(|n| is_chapter_name(n));
  klparse::check_chapter_count(files.len())?;
  let mut chapters = Vec::new();
  for file in files {
    let path = dir.join(&file);
    let read = klfs::read_chapter(&path);
    if !read.pages.is_empty() {
      let name = klparse::strip_zip_ext(&file).to_string();
      let number = chapter_number(&name, read.number);
      chapters.push((
        Chapter {
          name,
          archive: path.to_string_lossy().into_owned(),
          pages: read.pages,
        },
        number,
      ));
    }
  }
  chapters.sort_by(|(a, an), (b, bn)| chapter_cmp((&a.name, *an), (&b.name, *bn)));
  Ok(chapters.into_iter().map(|(c, _)| c).collect())
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
