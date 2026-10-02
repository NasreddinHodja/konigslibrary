//! Listing a manga's chapters and serving its pages; listing the library
//! itself is the database's (`db.rs`).
//!
//! Every path that leaves the configured manga directory is rejected here rather than at the route layer, so the
//! guard cannot be bypassed by adding a route.

use std::path::{Path, PathBuf};

use klparse::{collate::locale_cmp, ext_with_dot, is_image_name, is_plain_name, is_zip_name};
use serde::Serialize;

use crate::config::Config;
use crate::db::Db;
use crate::pathutil::{is_inside, parent_of, resolve, resolve_from};
use klfs::expand_home_with;
use klfs::ZipCache;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerChapter {
  pub name: String,
  pub slug: String,
  pub page_count: usize,
  pub pages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowseEntry {
  pub name: String,
  pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowseResult {
  pub path: String,
  pub parent: Option<String>,
  pub entries: Vec<BrowseEntry>,
}

pub struct ImageResult {
  pub bytes: Vec<u8>,
  /// Lowercased extension including the dot, for Content-Type mapping.
  pub ext: String,
}

/// What `get_file` found: bytes to send, or a whole file to stream from disk.
pub enum Served {
  Bytes(ImageResult),
  /// A chapter archive, too big to read into memory per request.
  File {
    path: PathBuf,
    ext: String,
  },
}

/// Directory listing for the settings folder picker. Directories only, dotfiles
/// hidden, sorted by name.
pub fn browse_dir(cfg: &Config, path: Option<&str>) -> Result<BrowseResult, String> {
  let requested = path
    .map(str::trim)
    .filter(|p| !p.is_empty())
    .unwrap_or(cfg.home());
  let dir = resolve(
    Path::new(cfg.home()),
    &expand_home_with(requested, cfg.home()),
  );

  let mut entries: Vec<BrowseEntry> = klfs::subfolders(&dir)
    .map_err(|e| format!("{}: {}", dir.display(), e))?
    .into_iter()
    .map(|name| BrowseEntry {
      path: dir.join(&name).to_string_lossy().into_owned(),
      name,
    })
    .collect();
  entries.sort_by(|a, b| locale_cmp(&a.name, &b.name));

  Ok(BrowseResult {
    path: dir.to_string_lossy().into_owned(),
    parent: parent_of(&dir).map(|p| p.to_string_lossy().into_owned()),
    entries,
  })
}

/// Resolves a manga name against the configured directory, rejecting anything
/// that isn't one of its folders' names.
pub fn manga_path(cfg: &Config, manga_name: &str) -> Option<(PathBuf, PathBuf)> {
  if !is_plain_name(manga_name) {
    return None;
  }
  let dir = cfg.manga_dir()?;
  let path = resolve_from(&dir, &[manga_name]);
  if !is_inside(&dir, &path) || path == dir {
    return None;
  }
  Some((dir, path))
}

/// One chapter per archive in the manga folder, through the database's store
/// of chapter lists. Every image in an archive is a page, whatever folders it
/// is nested under.
pub fn list_chapters(cfg: &Config, db: &Db, manga_name: &str) -> Vec<ServerChapter> {
  let Some((_, path)) = manga_path(cfg, manga_name) else {
    return Vec::new();
  };
  db.chapters(&path, manga_name)
}

/// A file served out of a manga folder:
///
/// - `<chapter>.cbz/<entry path>` — a page inside a chapter archive;
/// - `<chapter>.cbz` — the whole archive, for downloading;
/// - `<image>` — a loose image such as the cover.
pub fn get_file(
  cfg: &Config,
  cache: &ZipCache,
  manga_name: &str,
  path_parts: &[String],
) -> Option<Served> {
  let (_, manga) = manga_path(cfg, manga_name)?;
  let (first, rest) = path_parts.split_first()?;
  if !is_plain_name(first) {
    return None;
  }

  let resolved = resolve_from(&manga, &[first]);
  if !is_inside(&manga, &resolved) || !std::fs::metadata(&resolved).is_ok_and(|m| m.is_file()) {
    return None;
  }

  if is_zip_name(first) {
    if rest.is_empty() {
      return Some(Served::File {
        path: resolved,
        ext: ext_with_dot(first),
      });
    }
    return read_zip_entry(cache, &resolved, &rest.join("/")).map(Served::Bytes);
  }

  // Allowlist by extension: the library must never serve arbitrary files.
  if !rest.is_empty() || !is_image_name(first) {
    return None;
  }
  Some(Served::Bytes(ImageResult {
    bytes: std::fs::read(&resolved).ok()?,
    ext: ext_with_dot(first),
  }))
}

fn read_zip_entry(cache: &ZipCache, zip_path: &Path, entry_path: &str) -> Option<ImageResult> {
  if !is_image_name(entry_path) {
    return None;
  }
  let bytes = klfs::read_entry(cache, zip_path, entry_path).ok()??;
  Some(ImageResult {
    ext: ext_with_dot(entry_path),
    bytes,
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use klparse::fixture::{stored, Fixture};

  struct Lib {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    cfg: Config,
    cache: ZipCache,
    db: std::sync::Arc<Db>,
  }

  /// A library rooted at `<tmp>/manga`, with the config file kept in a
  /// separate directory so it never shows up in listings.
  fn lib() -> Lib {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("manga");
    std::fs::create_dir_all(&root).unwrap();
    let conf = tmp.path().join("conf");
    std::fs::create_dir_all(&conf).unwrap();
    let cfg = Config::for_test(
      &conf,
      &tmp.path().to_string_lossy(),
      Some(&root.to_string_lossy()),
    );
    let db = Db::open(&tmp.path().join("library.db")).unwrap();
    Lib {
      _tmp: tmp,
      root,
      cfg,
      cache: ZipCache::new(),
      db,
    }
  }

  fn mkdir(base: &Path, rel: &str) {
    std::fs::create_dir_all(base.join(rel)).unwrap();
  }

  fn touch(base: &Path, rel: &str, body: &[u8]) {
    let p = base.join(rel);
    if let Some(parent) = p.parent() {
      std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(p, body).unwrap();
  }

  fn write_zip(base: &Path, name: &str, entries: &[(&str, &[u8])]) {
    let mut fx = Fixture::new();
    for (n, d) in entries {
      fx = fx.entry(stored(n, d));
    }
    std::fs::write(base.join(name), fx.build()).unwrap();
  }

  // --- listChapters ---

  #[test]
  fn list_chapters_rejects_a_slug_that_escapes_the_manga_directory() {
    let l = lib();
    let outside = l.root.parent().unwrap().join("secret");
    mkdir(&outside, "");
    write_zip(&outside, "ch1.cbz", &[("p.png", b"x")]);

    assert_eq!(list_chapters(&l.cfg, &l.db, "../secret"), Vec::new());
    assert_eq!(list_chapters(&l.cfg, &l.db, "/etc"), Vec::new());
    assert_eq!(list_chapters(&l.cfg, &l.db, ""), Vec::new());
  }

  #[test]
  fn list_chapters_returns_empty_for_a_missing_manga() {
    let l = lib();
    assert_eq!(list_chapters(&l.cfg, &l.db, "Nope"), Vec::new());
  }

  #[test]
  fn makes_one_chapter_per_archive() {
    let l = lib();
    let berserk = l.root.join("Berserk");
    mkdir(&berserk, "");
    write_zip(&berserk, "ch02.cbz", &[("p10.png", b"b"), ("p9.png", b"a")]);
    write_zip(
      &berserk,
      "ch01.zip",
      &[("inner/p1.png", b"c"), ("ComicInfo.xml", b"<x/>")],
    );
    touch(&berserk, "cover.jpg", b"cover");

    let chapters = list_chapters(&l.cfg, &l.db, "Berserk");
    assert_eq!(chapters.len(), 2);
    assert_eq!(chapters[0].name, "ch01");
    assert_eq!(chapters[0].slug, "ch01.zip");
    assert_eq!(chapters[0].pages, ["inner/p1.png"]);
    assert_eq!(chapters[1].name, "ch02");
    assert_eq!(chapters[1].pages, ["p9.png", "p10.png"]);
    assert_eq!(chapters[1].page_count, 2);
  }

  #[test]
  fn ignores_image_folders_loose_images_and_broken_archives() {
    let l = lib();
    let berserk = l.root.join("Berserk");
    touch(&berserk, "ch00/page01.png", b"a");
    touch(&berserk, "page01.png", b"a");
    write_zip(&berserk, "ch01.cbz", &[("p1.png", b"b")]);
    write_zip(&berserk, "notes.zip", &[("a.txt", b"x")]);
    touch(&berserk, "broken.cbz", b"not a zip");
    write_zip(&berserk, ".hidden.cbz", &[("p1.png", b"b")]);

    let chapters = list_chapters(&l.cfg, &l.db, "Berserk");
    let names: Vec<&str> = chapters.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["ch01"]);
  }

  #[test]
  fn chapter_slug_is_percent_encoded() {
    let l = lib();
    let berserk = l.root.join("Berserk");
    mkdir(&berserk, "");
    write_zip(&berserk, "Chapter 01.cbz", &[("p1.png", b"b")]);

    let chapters = list_chapters(&l.cfg, &l.db, "Berserk");
    assert_eq!(chapters[0].name, "Chapter 01");
    assert_eq!(chapters[0].slug, "Chapter%2001.cbz");
  }

  #[test]
  fn a_changed_archive_is_read_again_and_a_removed_one_dropped() {
    let l = lib();
    let berserk = l.root.join("Berserk");
    mkdir(&berserk, "");
    write_zip(&berserk, "ch01.cbz", &[("p1.png", b"a")]);
    write_zip(&berserk, "ch02.cbz", &[("p1.png", b"a")]);
    assert_eq!(list_chapters(&l.cfg, &l.db, "Berserk")[0].page_count, 1);

    // Rewritten in place with another page, and its sibling removed.
    std::thread::sleep(std::time::Duration::from_millis(20));
    write_zip(&berserk, "ch01.cbz", &[("p1.png", b"a"), ("p2.png", b"b")]);
    std::fs::remove_file(berserk.join("ch02.cbz")).unwrap();

    let chapters = list_chapters(&l.cfg, &l.db, "Berserk");
    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].pages, ["p1.png", "p2.png"]);
  }

  #[test]
  fn an_unchanged_archive_is_served_from_the_store() {
    let l = lib();
    let berserk = l.root.join("Berserk");
    mkdir(&berserk, "");
    write_zip(&berserk, "ch01.cbz", &[("p1.png", b"a")]);
    list_chapters(&l.cfg, &l.db, "Berserk");

    // Same size and mtime, different bytes: only a stored list survives this.
    let path = berserk.join("ch01.cbz");
    let mtime = std::fs::metadata(&path).unwrap().modified().unwrap();
    let mut bytes = std::fs::read(&path).unwrap();
    for b in bytes.iter_mut() {
      *b = 0;
    }
    std::fs::write(&path, &bytes).unwrap();
    std::fs::File::options()
      .write(true)
      .open(&path)
      .unwrap()
      .set_modified(mtime)
      .unwrap();

    assert_eq!(list_chapters(&l.cfg, &l.db, "Berserk")[0].pages, ["p1.png"]);
  }

  // --- getFile ---

  fn parts(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
  }

  #[test]
  fn reads_a_page_out_of_a_chapter_archive() {
    let l = lib();
    let berserk = l.root.join("Berserk");
    mkdir(&berserk, "");
    write_zip(&berserk, "ch01.cbz", &[("inner/p1.PNG", b"PNGDATA")]);

    let Some(Served::Bytes(img)) = get_file(
      &l.cfg,
      &l.cache,
      "Berserk",
      &parts(&["ch01.cbz", "inner", "p1.PNG"]),
    ) else {
      panic!("expected the page's bytes");
    };
    assert_eq!(img.bytes, b"PNGDATA");
    assert_eq!(img.ext, ".png");
  }

  #[test]
  fn serves_a_whole_chapter_archive() {
    let l = lib();
    let berserk = l.root.join("Berserk");
    mkdir(&berserk, "");
    write_zip(&berserk, "ch01.cbz", &[("p1.png", b"x")]);

    let Some(Served::File { path, ext }) =
      get_file(&l.cfg, &l.cache, "Berserk", &parts(&["ch01.cbz"]))
    else {
      panic!("expected the archive's path");
    };
    assert_eq!(path, berserk.join("ch01.cbz"));
    assert_eq!(ext, ".cbz");
  }

  #[test]
  fn serves_the_cover() {
    let l = lib();
    touch(&l.root, "Berserk/cover.jpg", b"JPEG");
    let Some(Served::Bytes(img)) = get_file(&l.cfg, &l.cache, "Berserk", &parts(&["cover.jpg"]))
    else {
      panic!("expected the cover's bytes");
    };
    assert_eq!(img.bytes, b"JPEG");
    assert_eq!(img.ext, ".jpg");
  }

  #[test]
  fn rejects_non_images_and_non_image_entries() {
    let l = lib();
    let berserk = l.root.join("Berserk");
    touch(&berserk, "id_rsa", b"KEY");
    touch(&berserk, "notes.txt", b"TEXT");
    write_zip(&berserk, "ch01.cbz", &[("ComicInfo.xml", b"<x/>")]);

    for p in [
      parts(&["id_rsa"]),
      parts(&["notes.txt"]),
      parts(&["ch01.cbz", "ComicInfo.xml"]),
    ] {
      assert!(get_file(&l.cfg, &l.cache, "Berserk", &p).is_none(), "{p:?}");
    }
  }

  #[test]
  fn rejects_paths_escaping_the_manga_directory() {
    let l = lib();
    let outside = l.root.parent().unwrap();
    touch(outside, "secret.png", b"SECRET");
    write_zip(outside, "secret.cbz", &[("p.png", b"SECRET")]);
    mkdir(&l.root, "Berserk");

    for (manga, p) in [
      ("Berserk", parts(&["../../secret.png"])),
      ("Berserk", parts(&["../../secret.cbz", "p.png"])),
      ("..", parts(&["secret.png"])),
      ("..", parts(&["secret.cbz"])),
      ("/etc", parts(&["hostname"])),
    ] {
      assert!(
        get_file(&l.cfg, &l.cache, manga, &p).is_none(),
        "{manga} {p:?}"
      );
    }
  }

  #[test]
  fn returns_none_for_missing_files_and_entries() {
    let l = lib();
    let berserk = l.root.join("Berserk");
    mkdir(&berserk, "");
    write_zip(&berserk, "ch01.cbz", &[("p1.png", b"x")]);

    assert!(get_file(&l.cfg, &l.cache, "Berserk", &parts(&["nope.png"])).is_none());
    assert!(get_file(&l.cfg, &l.cache, "Berserk", &parts(&["ch01.cbz", "p9.png"])).is_none());
    assert!(get_file(&l.cfg, &l.cache, "Berserk", &parts(&["ch09.cbz"])).is_none());
  }

  // --- browseDir ---

  #[test]
  fn browse_lists_only_directories_sorted_and_without_dotfiles() {
    let l = lib();
    mkdir(&l.root, "Zebra");
    mkdir(&l.root, "alpha");
    mkdir(&l.root, ".hidden");
    touch(&l.root, "file.txt", b"");

    let result = browse_dir(&l.cfg, Some(&l.root.to_string_lossy())).unwrap();
    let names: Vec<&str> = result.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["alpha", "Zebra"]);
    assert_eq!(
      result.entries[0].path,
      l.root.join("alpha").to_string_lossy()
    );
  }

  #[test]
  fn browse_defaults_to_the_home_directory() {
    let l = lib();
    let home = Path::new(l.cfg.home()).to_path_buf();
    mkdir(&home, "Pictures");

    for arg in [None, Some(""), Some("   ")] {
      let result = browse_dir(&l.cfg, arg).unwrap();
      assert_eq!(result.path, home.to_string_lossy());
      assert!(result.entries.iter().any(|e| e.name == "Pictures"));
    }
  }

  #[test]
  fn browse_expands_a_leading_tilde() {
    let l = lib();
    mkdir(Path::new(l.cfg.home()), "Pictures");
    let result = browse_dir(&l.cfg, Some("~/Pictures")).unwrap();
    assert_eq!(
      result.path,
      Path::new(l.cfg.home()).join("Pictures").to_string_lossy()
    );
  }

  #[test]
  fn browse_reports_a_parent_except_at_the_filesystem_root() {
    let l = lib();
    let result = browse_dir(&l.cfg, Some(&l.root.to_string_lossy())).unwrap();
    assert_eq!(
      result.parent.as_deref(),
      Some(&*l.root.parent().unwrap().to_string_lossy())
    );

    let root = browse_dir(&l.cfg, Some("/")).unwrap();
    assert_eq!(
      root.parent, None,
      "the filesystem root must not loop back to itself"
    );
  }

  #[test]
  fn browse_reports_an_error_for_an_unreadable_directory() {
    let l = lib();
    assert!(browse_dir(&l.cfg, Some("/definitely/not/a/real/path")).is_err());
  }
}
