//! Cache of parsed central directories, keyed by path and invalidated by mtime.
//!
//! Port of `getCachedIndex` from `src/lib/server/zip-node.ts`. Without it, every
//! page request would re-read and re-parse the archive's central directory.
//!
//! Also holds the [`FileReader`] adapter that lets `klparse` read an archive
//! through positional file reads instead of loading it into memory.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use klparse::zip::{ReadAt, ZipEntry, ZipError};

/// Matches `ZIP_CACHE_MAX` in the TypeScript implementation.
pub const ZIP_CACHE_MAX: usize = 50;

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
    // failure, not as an I/O failure halfway through indexing.
    let available = (self.size - offset) as usize;
    let len = len.min(available);

    let mut file = self.file.lock().expect("zip file mutex poisoned");
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

#[derive(Debug, Clone)]
struct CacheEntry {
  path: PathBuf,
  mtime: std::time::SystemTime,
  entries: Arc<Vec<ZipEntry>>,
}

/// Least-recently-used cache. Ordered oldest-first, so eviction pops the front
/// and a hit moves the entry to the back — the same ordering the JS `Map`
/// gave via delete-then-set.
#[derive(Default)]
pub struct ZipCache {
  inner: Mutex<Vec<CacheEntry>>,
}

impl ZipCache {
  pub fn new() -> Self {
    Self::default()
  }

  /// Returns the archive's entries, parsing them only on a miss or when the
  /// file's mtime has changed since it was cached.
  pub fn get(&self, path: &Path) -> Result<Arc<Vec<ZipEntry>>, ZipError> {
    let mtime = std::fs::metadata(path)
      .and_then(|m| m.modified())
      .map_err(|e| ZipError::Io(e.to_string()))?;

    if let Some(hit) = self.take_fresh(path, mtime) {
      return Ok(hit);
    }

    let reader = FileReader::open(path).map_err(|e| ZipError::Io(e.to_string()))?;
    let entries = Arc::new(klparse::zip::index_zip(&reader)?);
    self.insert(path, mtime, Arc::clone(&entries));
    Ok(entries)
  }

  /// A hit also reorders the entry to most-recently-used.
  fn take_fresh(&self, path: &Path, mtime: std::time::SystemTime) -> Option<Arc<Vec<ZipEntry>>> {
    let mut cache = self.inner.lock().expect("zip cache mutex poisoned");
    let idx = cache.iter().position(|e| e.path == path)?;
    if cache[idx].mtime != mtime {
      cache.remove(idx);
      return None;
    }
    let entry = cache.remove(idx);
    let entries = Arc::clone(&entry.entries);
    cache.push(entry);
    Some(entries)
  }

  fn insert(&self, path: &Path, mtime: std::time::SystemTime, entries: Arc<Vec<ZipEntry>>) {
    let mut cache = self.inner.lock().expect("zip cache mutex poisoned");
    cache.retain(|e| e.path != path);
    while cache.len() >= ZIP_CACHE_MAX {
      cache.remove(0);
    }
    cache.push(CacheEntry {
      path: path.to_path_buf(),
      mtime,
      entries,
    });
  }

  #[cfg(test)]
  fn paths(&self) -> Vec<PathBuf> {
    self
      .inner
      .lock()
      .unwrap()
      .iter()
      .map(|e| e.path.clone())
      .collect()
  }

  #[cfg(test)]
  fn len(&self) -> usize {
    self.inner.lock().unwrap().len()
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use klparse::fixture::{stored, Fixture};

  fn write_zip(dir: &Path, name: &str, pages: &[&str]) -> PathBuf {
    let mut fx = Fixture::new();
    for p in pages {
      fx = fx.entry(stored(p, b"payload"));
    }
    let path = dir.join(name);
    std::fs::write(&path, fx.build()).unwrap();
    path
  }

  /// Filesystem mtime resolution is coarse enough that two writes in quick
  /// succession can land on the same timestamp, which would make an
  /// invalidation test pass or fail at random. Setting it explicitly removes
  /// the race.
  fn set_mtime(path: &Path, secs_from_epoch: u64) {
    let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs_from_epoch);
    let f = File::options().write(true).open(path).unwrap();
    f.set_modified(t).unwrap();
  }

  #[test]
  fn parses_on_first_use_and_caches_the_result() {
    let dir = tempfile::tempdir().unwrap();
    let zip = write_zip(dir.path(), "a.cbz", &["ch01/page01.png"]);
    let cache = ZipCache::new();

    let first = cache.get(&zip).unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(cache.len(), 1);

    let second = cache.get(&zip).unwrap();
    // Same allocation: the archive was not re-read.
    assert!(Arc::ptr_eq(&first, &second));
  }

  #[test]
  fn invalidates_when_the_mtime_changes() {
    let dir = tempfile::tempdir().unwrap();
    let zip = write_zip(dir.path(), "a.cbz", &["ch01/page01.png"]);
    let cache = ZipCache::new();

    set_mtime(&zip, 1_000_000);
    let first = cache.get(&zip).unwrap();
    assert_eq!(first.len(), 1);

    // Rewrite with different contents and a different mtime.
    write_zip(dir.path(), "a.cbz", &["ch01/page01.png", "ch01/page02.png"]);
    set_mtime(&zip, 2_000_000);

    let second = cache.get(&zip).unwrap();
    assert!(!Arc::ptr_eq(&first, &second));
    assert_eq!(second.len(), 2);
    assert_eq!(
      cache.len(),
      1,
      "the stale entry should be replaced, not duplicated"
    );
  }

  #[test]
  fn a_hit_moves_the_entry_to_most_recently_used() {
    let dir = tempfile::tempdir().unwrap();
    let a = write_zip(dir.path(), "a.cbz", &["p.png"]);
    let b = write_zip(dir.path(), "b.cbz", &["p.png"]);
    let cache = ZipCache::new();

    cache.get(&a).unwrap();
    cache.get(&b).unwrap();
    assert_eq!(cache.paths(), vec![a.clone(), b.clone()]);

    // Touching `a` again must move it behind `b`.
    cache.get(&a).unwrap();
    assert_eq!(cache.paths(), vec![b, a]);
  }

  #[test]
  fn evicts_the_oldest_entry_once_the_cache_is_full() {
    let dir = tempfile::tempdir().unwrap();
    let cache = ZipCache::new();

    let mut paths = Vec::new();
    for i in 0..ZIP_CACHE_MAX {
      let p = write_zip(dir.path(), &format!("{i}.cbz"), &["p.png"]);
      cache.get(&p).unwrap();
      paths.push(p);
    }
    assert_eq!(cache.len(), ZIP_CACHE_MAX);

    let extra = write_zip(dir.path(), "extra.cbz", &["p.png"]);
    cache.get(&extra).unwrap();

    assert_eq!(
      cache.len(),
      ZIP_CACHE_MAX,
      "cache must not grow past its limit"
    );
    let live = cache.paths();
    assert!(
      !live.contains(&paths[0]),
      "the oldest entry should have been evicted"
    );
    assert!(live.contains(&paths[1]));
    assert!(live.contains(&extra));
  }

  #[test]
  fn eviction_respects_recency_not_insertion_order() {
    let dir = tempfile::tempdir().unwrap();
    let cache = ZipCache::new();

    let mut paths = Vec::new();
    for i in 0..ZIP_CACHE_MAX {
      let p = write_zip(dir.path(), &format!("{i}.cbz"), &["p.png"]);
      cache.get(&p).unwrap();
      paths.push(p);
    }

    // Re-touch the oldest so it is no longer the eviction candidate.
    cache.get(&paths[0]).unwrap();
    let extra = write_zip(dir.path(), "extra.cbz", &["p.png"]);
    cache.get(&extra).unwrap();

    let live = cache.paths();
    assert!(live.contains(&paths[0]), "recently used entry must survive");
    assert!(
      !live.contains(&paths[1]),
      "the new oldest entry should be evicted instead"
    );
  }

  #[test]
  fn a_missing_file_is_an_error_not_a_panic() {
    let dir = tempfile::tempdir().unwrap();
    let cache = ZipCache::new();
    assert!(cache.get(&dir.path().join("nope.cbz")).is_err());
  }

  #[test]
  fn a_non_zip_file_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("not-a-zip.cbz");
    std::fs::write(&path, b"definitely not a zip").unwrap();
    let cache = ZipCache::new();
    assert_eq!(cache.get(&path).unwrap_err(), ZipError::NotAZip);
  }
}
