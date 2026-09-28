//! Chapter archives (`<manga>/<chapter>.cbz`) in the native library, read with
//! the same parser the server uses.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;

use klparse::zip::{extract_entry, index_zip, ReadAt, ZipEntry, ZipError};
use klparse::{collate::natural_cmp, is_image_name};

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

/// Every image entry in the archive, sorted the way the server sorts them.
pub fn list_pages(path: &Path) -> Result<Vec<String>, String> {
  let (_, entries) = index(path)?;
  let mut pages: Vec<String> = entries
    .into_iter()
    .map(|e| e.name)
    .filter(|n| is_image_name(n))
    .collect();
  pages.sort_by(|a, b| natural_cmp(a, b));
  Ok(pages)
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
