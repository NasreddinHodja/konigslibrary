use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;

use klparse::zip::{ReadAt, ZipError};

/// Reads an archive off disk without mapping or buffering the whole file.
pub struct FileReader {
  file: Mutex<File>,
  size: u64,
}

impl FileReader {
  pub fn open(path: &Path) -> std::io::Result<Self> {
    let file = File::open(path)?;
    let size = file.metadata()?.len();
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
    // Clamp rather than error: a truncated archive should surface as a parse
    // failure, not as an I/O failure halfway through indexing. More left than
    // `usize` holds (on 32-bit targets) can't be shorter than `len`.
    let len = usize::try_from(self.size - offset).map_or(len, |available| len.min(available));

    // Nothing panics while the file is locked, but a poisoned lock would
    // still hold a usable file.
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
