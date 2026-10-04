//! Manga folders and chapter archives on disk, read with `klparse`.
//!
//! `klparse` itself never touches the filesystem, so it also compiles to wasm
//! for the browser. What both native readers of a library need — the
//! self-hosted server (`klserver`) and the app (`src-tauri`) — lives here
//! instead: positional reads of an archive, a cache of parsed directories,
//! listing a manga folder, and the LAN server's access key.

mod cache;
mod key;
mod reader;

use std::path::{Path, PathBuf};

use klparse::zip::ZipError;
use klparse::{ChapterNumber, MangaMeta};

pub use cache::{ZipCache, ZIP_CACHE_MAX};
pub use key::access_key;
pub use reader::FileReader;

/// The user's home directory, from `HOME` (or `USERPROFILE` on Windows).
pub fn home_dir() -> Option<PathBuf> {
  std::env::var_os("HOME")
    .or_else(|| std::env::var_os("USERPROFILE"))
    .map(PathBuf::from)
}

/// Expands a leading `~` to `home`. Only a bare `~` or a `~/`-prefixed path
/// is expanded; `~foo` is left alone.
///
/// The home directory is passed in rather than read from the environment, so
/// tests never have to mutate process-global state.
pub fn expand_home_with(path: &str, home: &str) -> String {
  if path != "~" && !path.starts_with("~/") {
    return path.to_string();
  }
  format!("{home}{}", &path[1..])
}

/// The names of the entries in `dir` that `keep` accepts, by their type.
fn entry_names(
  dir: &Path,
  keep: impl Fn(std::fs::FileType) -> bool,
) -> std::io::Result<Vec<String>> {
  Ok(
    std::fs::read_dir(dir)?
      .flatten()
      .filter(|item| item.file_type().is_ok_and(&keep))
      .map(|item| item.file_name().to_string_lossy().into_owned())
      .collect(),
  )
}

/// The names of the regular files in `dir`.
pub fn file_names(dir: &Path) -> std::io::Result<Vec<String>> {
  entry_names(dir, |t| t.is_file())
}

/// The names of the folders in `dir`, dotfolders left out.
pub fn subfolders(dir: &Path) -> std::io::Result<Vec<String>> {
  let mut names = entry_names(dir, |t| t.is_dir())?;
  names.retain(|name| !name.starts_with('.'));
  Ok(names)
}

/// What listing a chapter needs from its archive.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ArchiveChapter {
  /// Page entry names in reading order.
  pub pages: Vec<String>,
  /// The volume and chapter its `ComicInfo.xml` gives, if any.
  pub number: ChapterNumber,
}

/// An archive's pages and ComicInfo number; no pages if it can't be read or
/// holds more than [`klparse::zip::MAX_PAGES`].
pub fn read_chapter(path: &Path) -> ArchiveChapter {
  let Ok(reader) = FileReader::open(path) else {
    return ArchiveChapter::default();
  };
  let Ok(entries) = klparse::zip::index_zip(&reader) else {
    return ArchiveChapter::default();
  };
  let number = klparse::comicinfo::comic_info_entry(&entries)
    .and_then(|e| klparse::zip::extract_entry(&reader, e).ok())
    .map(|xml| klparse::chapters::comic_info_number(&String::from_utf8_lossy(&xml)))
    .unwrap_or_default();
  let Ok(pages) = klparse::page_entries(entries) else {
    return ArchiveChapter::default();
  };
  let pages = pages.into_iter().map(|e| e.name).collect();
  ArchiveChapter { pages, number }
}

/// The ComicInfo metadata and cover of the manga folder `dir`, given the
/// names of its files.
pub fn manga_meta(dir: &Path, names: &[String]) -> MangaMeta {
  klparse::manga_meta(names, |name| FileReader::open(&dir.join(name)).ok())
}

/// The bytes of the entry `name` in the archive at `path`, through `cache`;
/// `None` if the archive has no such entry.
pub fn read_entry(cache: &ZipCache, path: &Path, name: &str) -> Result<Option<Vec<u8>>, ZipError> {
  let entries = cache.get(path)?;
  let Some(entry) = entries.iter().find(|e| e.name == name) else {
    return Ok(None);
  };
  let reader = FileReader::open(path).map_err(|e| ZipError::Io(e.to_string()))?;
  klparse::zip::extract_entry(&reader, entry).map(Some)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn expand_home_only_expands_a_leading_tilde() {
    let home = "/home/tester";
    assert_eq!(expand_home_with("~", home), "/home/tester");
    assert_eq!(expand_home_with("~/Manga", home), "/home/tester/Manga");
    assert_eq!(expand_home_with("~notme/Manga", home), "~notme/Manga");
    assert_eq!(expand_home_with("/absolute/Manga", home), "/absolute/Manga");
    assert_eq!(expand_home_with("relative/Manga", home), "relative/Manga");
  }
}
