//! Chapter archives (`<manga>/<chapter>.cbz`) in the native library, read with
//! the same parser the server uses.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;

use klparse::zip::{extract_entry, index_zip, ReadAt, ZipEntry, ZipError};
use klparse::{is_image_name, is_zip_name, locale_cmp, page_entries, MangaMeta};
use serde::Serialize;

struct FileReader {
  file: Mutex<File>,
  size: u64,
}

impl FileReader {
  fn open(path: &Path) -> Result<Self, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    Ok(Self {
      file: Mutex::new(file),
      size,
    })
  }
}

impl ReadAt for FileReader {
  fn size(&self) -> u64 {
    self.size
  }

  fn read_at(&self, offset: u64, len: usize) -> Result<Vec<u8>, ZipError> {
    if offset >= self.size || len == 0 {
      return Ok(Vec::new());
    }
    let len = len.min((self.size - offset) as usize);
    let mut file = self.file.lock().unwrap_or_else(|e| e.into_inner());
    file
      .seek(SeekFrom::Start(offset))
      .map_err(|e| ZipError::Io(e.to_string()))?;
    let mut buf = vec![0u8; len];
    file
      .read_exact(&mut buf)
      .map_err(|e| ZipError::Io(e.to_string()))?;
    Ok(buf)
  }
}

fn index(path: &Path) -> Result<(FileReader, Vec<ZipEntry>), String> {
  let reader = FileReader::open(path)?;
  let entries = index_zip(&reader).map_err(|e| format!("{e:?}"))?;
  Ok((reader, entries))
}

#[derive(Serialize)]
pub struct Chapter {
  name: String,
  archive: String,
  pages: Vec<String>,
}

fn file_names(dir: &Path) -> Result<Vec<String>, String> {
  Ok(
    std::fs::read_dir(dir)
      .map_err(|e| e.to_string())?
      .flatten()
      .filter(|i| i.file_type().is_ok_and(|t| t.is_file()))
      .map(|i| i.file_name().to_string_lossy().into_owned())
      .collect(),
  )
}

/// One chapter per archive in a manga folder, sorted the way the server sorts
/// them. A corrupt archive is skipped rather than failing the whole manga.
pub fn list_chapters(dir: &Path) -> Result<Vec<Chapter>, String> {
  let mut chapters: Vec<Chapter> = Vec::new();
  for file in file_names(dir)? {
    if file.starts_with('.') || !is_zip_name(&file) {
      continue;
    }
    let path = dir.join(&file);
    let Ok((_, entries)) = index(&path) else {
      continue;
    };
    let pages: Vec<String> = page_entries(entries).into_iter().map(|e| e.name).collect();
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

pub fn read_page(path: &Path, entry_name: &str) -> Result<Vec<u8>, String> {
  if !is_image_name(entry_name) {
    return Err("not an image entry".to_string());
  }
  let (reader, entries) = index(path)?;
  let entry = entries
    .iter()
    .find(|e| e.name == entry_name)
    .ok_or("entry not found in archive")?;
  extract_entry(&reader, entry).map_err(|e| format!("{e:?}"))
}

/// ComicInfo metadata and cover of a manga folder.
pub fn manga_meta(dir: &Path) -> Result<MangaMeta, String> {
  Ok(klparse::manga_meta(&file_names(dir)?, |name| {
    FileReader::open(&dir.join(name)).ok()
  }))
}
