//! Manga folders and chapter archives on disk, read with `klparse`.
//!
//! `klparse` itself never touches the filesystem, so it also compiles to wasm
//! for the browser. What both native readers of a library need — the
//! self-hosted server (`klserver`) and the app (`src-tauri`) — lives here
//! instead: positional reads of an archive, a cache of parsed directories,
//! and listing a manga folder.

mod cache;
mod reader;

use std::path::{Path, PathBuf};

use klparse::zip::ZipError;
use klparse::MangaMeta;

pub use cache::{ZipCache, ZIP_CACHE_MAX};
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

/// An archive's page entry names in reading order; none if it can't be read.
pub fn archive_pages(path: &Path) -> Vec<String> {
  let Ok(reader) = FileReader::open(path) else {
    return Vec::new();
  };
  let Ok(entries) = klparse::zip::index_zip(&reader) else {
    return Vec::new();
  };
  klparse::page_entries(entries)
    .into_iter()
    .map(|e| e.name)
    .collect()
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
