//! The Device tab's listing: every manga on this device, a page at a time.
//!
//! Three folders feed it: the manga directory the user configured (desktop
//! only), the downloads folder, whose manga came from a server, and the
//! imports folder, holding manga added through the upload button. Each is
//! sorted the same way and paged with the same cursor, so a page is their
//! pages merged.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use klparse::listing::{self, Key};
use serde::Serialize;

use crate::offline;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
  /// A folder in the user's manga directory.
  Folder,
  /// Downloaded from a server.
  Download,
  /// Added through the upload button.
  Import,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DeviceEntry {
  pub name: String,
  pub path: String,
  pub origin: Origin,
  /// The server slug, for a downloaded manga.
  pub slug: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DevicePage {
  pub entries: Vec<DeviceEntry>,
  pub next: Option<String>,
}

fn key(e: &DeviceEntry) -> Key<'_> {
  (&e.name, &e.path)
}

fn sorted(mut entries: Vec<DeviceEntry>) -> Vec<DeviceEntry> {
  entries.sort_by(|a, b| listing::key_cmp(key(a), key(b)));
  entries
}

/// Every manga folder in the manga directory, dotfolders skipped.
fn scan_manga_dir(dir: &Path) -> Vec<DeviceEntry> {
  let Ok(read) = std::fs::read_dir(dir) else {
    return Vec::new();
  };
  let entries = read
    .flatten()
    .filter(|item| item.file_type().is_ok_and(|t| t.is_dir()))
    .filter_map(|item| {
      let name = item.file_name().to_string_lossy().into_owned();
      (!name.starts_with('.')).then(|| DeviceEntry {
        path: dir.join(&name).to_string_lossy().into_owned(),
        name,
        origin: Origin::Folder,
        slug: None,
      })
    })
    .collect();
  sorted(entries)
}

/// The manga directory's listing, kept between pages and rebuilt when its
/// mtime moves or another directory is configured. The downloads and imports
/// folders are not cached: a download or import finishing its first chapter
/// changes the manga's own folder, not theirs, and they are small enough to
/// rescan.
#[derive(Default)]
pub struct DeviceIndex {
  cached: Mutex<Option<Cached>>,
}

struct Cached {
  dir: PathBuf,
  mtime: SystemTime,
  entries: Vec<DeviceEntry>,
}

impl DeviceIndex {
  pub fn page(
    &self,
    manga_dir: Option<&Path>,
    offline_dir: &Path,
    import_dir: &Path,
    query: &str,
    after: Option<&str>,
    limit: usize,
  ) -> DevicePage {
    let downloads = sorted(
      offline::scan(offline_dir)
        .into_iter()
        .map(|m| DeviceEntry {
          name: m.name,
          path: m.path,
          origin: Origin::Download,
          slug: Some(m.slug),
        })
        .collect(),
    );
    let imports = sorted(
      offline::manga_folders(import_dir)
        .into_iter()
        .map(|(name, path)| DeviceEntry {
          name,
          path,
          origin: Origin::Import,
          slug: None,
        })
        .collect(),
    );

    let mut cached = self.cached.lock().unwrap();
    let mtime = manga_dir.and_then(|d| std::fs::metadata(d).and_then(|m| m.modified()).ok());
    match (manga_dir, mtime) {
      (Some(dir), Some(mtime)) => {
        let fresh = cached
          .as_ref()
          .is_some_and(|c| c.dir == dir && c.mtime == mtime);
        if !fresh {
          *cached = Some(Cached {
            entries: scan_manga_dir(dir),
            dir: dir.to_path_buf(),
            mtime,
          });
        }
      }
      _ => *cached = None,
    }
    let empty = Vec::new();
    let own = cached.as_ref().map_or(&empty, |c| &c.entries);

    let pages =
      [own, &downloads, &imports].map(|list| listing::page(list, key, query, after, limit));
    merge(pages, limit)
  }
}

/// Merges pages cut from the same cursor into one page of `limit`.
fn merge<const N: usize>(pages: [listing::Page<'_, DeviceEntry>; N], limit: usize) -> DevicePage {
  let more = pages.iter().any(|p| p.next.is_some());
  let mut all: Vec<&DeviceEntry> = pages.into_iter().flat_map(|p| p.items).collect();
  all.sort_by(|x, y| listing::key_cmp(key(x), key(y)));
  let truncated = all.len() > limit;
  all.truncate(limit);

  let next = match all.last() {
    Some(last) if more || truncated => Some(listing::cursor(key(last))),
    _ => None,
  };
  DevicePage {
    entries: all.into_iter().cloned().collect(),
    next,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  struct TempDir(PathBuf);

  impl TempDir {
    fn new(tag: &str) -> Self {
      let dir = std::env::temp_dir().join(format!(
        "kl-device-{tag}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
      ));
      let _ = std::fs::remove_dir_all(&dir);
      std::fs::create_dir_all(&dir).unwrap();
      Self(dir)
    }
  }

  impl Drop for TempDir {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  fn manga(dir: &Path, name: &str) {
    std::fs::create_dir_all(dir.join(name)).unwrap();
  }

  fn download(dir: &Path, slug: &str) {
    std::fs::create_dir_all(dir.join(slug)).unwrap();
    std::fs::write(dir.join(slug).join("ch1.cbz"), b"").unwrap();
  }

  /// A folder that does not exist, for a source with nothing in it.
  fn none() -> PathBuf {
    std::env::temp_dir().join("kl-device-none")
  }

  fn names(page: &DevicePage) -> Vec<&str> {
    page.entries.iter().map(|e| e.name.as_str()).collect()
  }

  #[test]
  fn pages_interleave_own_folders_and_downloads() {
    let own = TempDir::new("own");
    let off = TempDir::new("off");
    manga(&own.0, "Akira");
    manga(&own.0, "Monster");
    download(&off.0, "Berserk");
    download(&off.0, "One%20Piece");

    let index = DeviceIndex::default();
    let first = index.page(Some(&own.0), &off.0, &none(), "", None, 3);
    assert_eq!(names(&first), ["Akira", "Berserk", "Monster"]);
    let second = index.page(Some(&own.0), &off.0, &none(), "", first.next.as_deref(), 3);
    assert_eq!(names(&second), ["One Piece"]);
    assert_eq!(second.entries[0].slug.as_deref(), Some("One%20Piece"));
    assert!(second.next.is_none());
  }

  #[test]
  fn a_manga_in_both_places_is_listed_twice() {
    let own = TempDir::new("both-own");
    let off = TempDir::new("both-off");
    manga(&own.0, "Berserk");
    download(&off.0, "Berserk");

    let index = DeviceIndex::default();
    let first = index.page(Some(&own.0), &off.0, &none(), "", None, 1);
    let second = index.page(Some(&own.0), &off.0, &none(), "", first.next.as_deref(), 1);
    assert_eq!(names(&first), ["Berserk"]);
    assert_eq!(names(&second), ["Berserk"]);
    assert_ne!(first.entries[0].path, second.entries[0].path);
  }

  #[test]
  fn downloads_without_a_finished_chapter_are_skipped() {
    let off = TempDir::new("partial");
    std::fs::create_dir_all(off.0.join("Pluto")).unwrap();
    let page = DeviceIndex::default().page(None, &off.0, &none(), "", None, 10);
    assert!(page.entries.is_empty());
  }

  #[test]
  fn query_filters_both_sources() {
    let own = TempDir::new("q-own");
    let off = TempDir::new("q-off");
    manga(&own.0, "One Piece");
    manga(&own.0, "Akira");
    download(&off.0, "Piece%20of%20Cake");

    let page = DeviceIndex::default().page(Some(&own.0), &off.0, &none(), "piece", None, 10);
    assert_eq!(names(&page), ["One Piece", "Piece of Cake"]);
  }

  #[test]
  fn imports_are_listed_under_their_own_name() {
    let off = TempDir::new("imp-off");
    let imp = TempDir::new("imp-imp");
    download(&off.0, "Akira");
    download(&imp.0, "One Piece");

    let page = DeviceIndex::default().page(None, &off.0, &imp.0, "", None, 10);
    assert_eq!(names(&page), ["Akira", "One Piece"]);
    assert_eq!(page.entries[0].origin, Origin::Download);
    assert_eq!(page.entries[1].origin, Origin::Import);
    assert_eq!(page.entries[1].slug, None);
  }
}
