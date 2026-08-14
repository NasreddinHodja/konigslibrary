//! Listing the library, its chapters, and its pages.
//!
//! Port of `src/lib/server/library.ts`. Every path that leaves the configured
//! manga directory is rejected here rather than at the route layer, so the
//! guard cannot be bypassed by adding a route.

use std::path::{Path, PathBuf};

use klparse::{
  chapters::{detect_depth, group_by_chapter},
  collate::locale_cmp,
  ext_with_dot, is_image_name, is_zip_name,
  names::strip_zip_ext,
  uri::encode_uri_component,
  zip::ZipEntry,
};
use serde::Serialize;

use crate::config::Config;
use crate::pathutil::{expand_home_with, is_inside, parent_of, resolve, resolve_from};
use crate::zipcache::{FileReader, ZipCache};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LibraryEntry {
  pub name: String,
  pub slug: String,
  #[serde(rename = "type")]
  pub kind: &'static str,
}

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

  let read = std::fs::read_dir(&dir).map_err(|e| format!("{}: {}", dir.display(), e))?;

  let mut entries: Vec<BrowseEntry> = Vec::new();
  for item in read.flatten() {
    let name = item.file_name().to_string_lossy().into_owned();
    if name.starts_with('.') {
      continue;
    }
    if !item.file_type().map(|t| t.is_dir()).unwrap_or(false) {
      continue;
    }
    entries.push(BrowseEntry {
      name: name.clone(),
      path: dir.join(&name).to_string_lossy().into_owned(),
    });
  }
  entries.sort_by(|a, b| locale_cmp(&a.name, &b.name));

  Ok(BrowseResult {
    path: dir.to_string_lossy().into_owned(),
    parent: parent_of(&dir).map(|p| p.to_string_lossy().into_owned()),
    entries,
  })
}

/// Every manga in the configured directory: subdirectories and `.zip`/`.cbz`
/// files, mixed into one alphabetical list.
///
/// Returns an empty list — never an error — when no directory is configured or
/// it cannot be read, so a misconfigured server still serves its UI.
pub fn list_manga(cfg: &Config) -> Vec<LibraryEntry> {
  let Some(dir) = cfg.manga_dir() else {
    return Vec::new();
  };

  let read = match std::fs::read_dir(&dir) {
    Ok(r) => r,
    Err(e) => {
      eprintln!(
        "[konigslibrary] Cannot read manga directory \"{}\": {e}",
        dir.display()
      );
      return Vec::new();
    }
  };

  let mut entries: Vec<LibraryEntry> = Vec::new();
  for item in read.flatten() {
    let name = item.file_name().to_string_lossy().into_owned();
    if name.starts_with('.') {
      continue;
    }
    let is_dir = item.file_type().map(|t| t.is_dir()).unwrap_or(false);
    if is_dir {
      entries.push(LibraryEntry {
        slug: encode_uri_component(&name),
        name,
        kind: "directory",
      });
    } else if is_zip_name(&name) {
      entries.push(LibraryEntry {
        // The extension is dropped for display only; the slug keeps it,
        // because it is also the on-disk filename.
        name: strip_zip_ext(&name).to_string(),
        slug: encode_uri_component(&name),
        kind: "zip",
      });
    }
  }

  entries.sort_by(|a, b| locale_cmp(&a.name, &b.name));
  entries
}

/// Resolves a manga name against the configured directory, rejecting anything
/// that lands outside it.
fn manga_path(cfg: &Config, manga_name: &str) -> Option<(PathBuf, PathBuf)> {
  let dir = cfg.manga_dir()?;
  let path = resolve_from(&dir, &[manga_name]);
  if !is_inside(&dir, &path) {
    return None;
  }
  Some((dir, path))
}

pub fn list_chapters(cfg: &Config, cache: &ZipCache, manga_name: &str) -> Vec<ServerChapter> {
  let Some((_, path)) = manga_path(cfg, manga_name) else {
    return Vec::new();
  };

  // `metadata` follows symlinks, matching Node's `stat`.
  let Ok(meta) = std::fs::metadata(&path) else {
    return Vec::new();
  };

  if meta.is_dir() {
    list_chapters_from_dir(&path)
  } else if is_zip_name(manga_name) {
    list_chapters_from_zip(cache, &path)
  } else {
    // A stray non-archive file sitting in the library root.
    Vec::new()
  }
}

fn list_chapters_from_dir(manga_path: &Path) -> Vec<ServerChapter> {
  let Ok(read) = std::fs::read_dir(manga_path) else {
    return Vec::new();
  };

  let mut subdirs: Vec<String> = Vec::new();
  let mut images: Vec<String> = Vec::new();
  for item in read.flatten() {
    let name = item.file_name().to_string_lossy().into_owned();
    let Ok(ft) = item.file_type() else { continue };
    if ft.is_dir() {
      if !name.starts_with('.') {
        subdirs.push(name);
      }
    } else if ft.is_file() && is_image_name(&name) {
      images.push(name);
    }
  }

  if !subdirs.is_empty() {
    let mut chapters: Vec<ServerChapter> = Vec::new();
    for sub in subdirs {
      let Ok(read) = std::fs::read_dir(manga_path.join(&sub)) else {
        continue;
      };
      let mut pages: Vec<String> = read
        .flatten()
        .map(|i| i.file_name().to_string_lossy().into_owned())
        .filter(|n| is_image_name(n))
        .collect();
      // Plain collation here, unlike the zip path, which is numeric. Kept as
      // it was rather than unified, so directory libraries do not reorder.
      pages.sort_by(|a, b| locale_cmp(a, b));

      // A subdirectory with no images is not a chapter.
      if !pages.is_empty() {
        chapters.push(ServerChapter {
          slug: encode_uri_component(&sub),
          name: sub,
          page_count: pages.len(),
          pages,
        });
      }
    }
    chapters.sort_by(|a, b| locale_cmp(&a.name, &b.name));
    return chapters;
  }

  if !images.is_empty() {
    images.sort_by(|a, b| locale_cmp(a, b));
    // Loose images with no subdirectories become one unnamed chapter.
    return vec![ServerChapter {
      name: String::new(),
      slug: String::new(),
      page_count: images.len(),
      pages: images,
    }];
  }

  Vec::new()
}

fn list_chapters_from_zip(cache: &ZipCache, zip_path: &Path) -> Vec<ServerChapter> {
  let Ok(entries) = cache.get(zip_path) else {
    return Vec::new();
  };

  let image_entries: Vec<ZipEntry> = entries
    .iter()
    .filter(|e| is_image_name(&e.name))
    .cloned()
    .collect();

  let names: Vec<&str> = image_entries.iter().map(|e| e.name.as_str()).collect();
  let depth = detect_depth(&names).depth;

  let mut chapters: Vec<ServerChapter> = group_by_chapter(image_entries, depth, |e| &e.name)
    .into_iter()
    .map(|(name, entries)| ServerChapter {
      slug: encode_uri_component(&name),
      name,
      page_count: entries.len(),
      pages: entries.into_iter().map(|e| e.name).collect(),
    })
    .collect();

  chapters.sort_by(|a, b| locale_cmp(&a.name, &b.name));
  chapters
}

/// Reads a page out of a directory-backed manga.
pub fn get_image_from_dir(
  cfg: &Config,
  manga_name: &str,
  path_parts: &[String],
) -> Option<ImageResult> {
  let dir = cfg.manga_dir()?;

  let mut segments: Vec<&str> = vec![manga_name];
  segments.extend(path_parts.iter().map(String::as_str));
  let resolved = resolve_from(&dir, &segments);

  if !is_inside(&dir, &resolved) {
    return None;
  }
  // Allowlist by extension: the library must never serve arbitrary files.
  let name = resolved.to_string_lossy();
  if !is_image_name(&name) {
    return None;
  }

  let bytes = std::fs::read(&resolved).ok()?;
  Some(ImageResult {
    ext: ext_with_dot(&name),
    bytes,
  })
}

/// Reads a page out of a zip-backed manga.
pub fn get_image_from_zip(
  cfg: &Config,
  cache: &ZipCache,
  manga_name: &str,
  entry_path: &str,
) -> Option<ImageResult> {
  let (_, zip_path) = manga_path(cfg, manga_name)?;
  if !is_zip_name(manga_name) {
    return None;
  }
  if !is_image_name(entry_path) {
    return None;
  }

  let entries = cache.get(&zip_path).ok()?;
  let entry = entries.iter().find(|e| e.name == entry_path)?;

  let reader = FileReader::open(&zip_path).ok()?;
  let bytes = klparse::zip::extract_entry(&reader, entry).ok()?;
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
    Lib {
      _tmp: tmp,
      root,
      cfg,
      cache: ZipCache::new(),
    }
  }

  /// A config pointing at no manga directory at all.
  fn unset_lib() -> Lib {
    let tmp = tempfile::tempdir().unwrap();
    let conf = tmp.path().join("conf");
    std::fs::create_dir_all(&conf).unwrap();
    let cfg = Config::for_test(&conf, &tmp.path().to_string_lossy(), None);
    let root = tmp.path().join("missing");
    Lib {
      _tmp: tmp,
      root,
      cfg,
      cache: ZipCache::new(),
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

  // --- listManga ---

  #[test]
  fn list_manga_mixes_directories_and_archives_in_one_sorted_list() {
    let l = lib();
    mkdir(&l.root, "Berserk");
    write_zip(&l.root, "Akira.cbz", &[("p.png", b"x")]);
    write_zip(&l.root, "Nausicaa.zip", &[("p.png", b"x")]);
    mkdir(&l.root, "Vagabond");

    let entries = list_manga(&l.cfg);
    let got: Vec<(&str, &str, &str)> = entries
      .iter()
      .map(|e| (e.name.as_str(), e.slug.as_str(), e.kind))
      .collect();
    assert_eq!(
      got,
      [
        ("Akira", "Akira.cbz", "zip"),
        ("Berserk", "Berserk", "directory"),
        ("Nausicaa", "Nausicaa.zip", "zip"),
        ("Vagabond", "Vagabond", "directory"),
      ]
    );
  }

  #[test]
  fn list_manga_strips_the_archive_extension_from_the_display_name_only() {
    let l = lib();
    write_zip(&l.root, "One Piece.cbz", &[("p.png", b"x")]);

    let entries = list_manga(&l.cfg);
    assert_eq!(entries[0].name, "One Piece");
    // The slug is the on-disk filename, percent-encoded.
    assert_eq!(entries[0].slug, "One%20Piece.cbz");
  }

  #[test]
  fn list_manga_skips_dotfiles_and_unrelated_files() {
    let l = lib();
    mkdir(&l.root, ".hidden");
    touch(&l.root, ".DS_Store", b"");
    touch(&l.root, "notes.txt", b"");
    touch(&l.root, "cover.png", b"");
    mkdir(&l.root, "Berserk");

    let entries = list_manga(&l.cfg);
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["Berserk"]);
  }

  #[test]
  fn list_manga_returns_empty_when_no_directory_is_configured() {
    let l = unset_lib();
    assert_eq!(list_manga(&l.cfg), Vec::new());
  }

  #[test]
  fn list_manga_returns_empty_rather_than_failing_when_the_directory_is_unreadable() {
    let l = lib();
    std::fs::remove_dir_all(&l.root).unwrap();
    assert_eq!(list_manga(&l.cfg), Vec::new());
  }

  // --- listChapters: routing and the traversal guard ---

  #[test]
  fn list_chapters_rejects_a_slug_that_escapes_the_manga_directory() {
    let l = lib();
    touch(
      l.root.parent().unwrap(),
      "secret.cbz",
      b"should never be reachable",
    );
    mkdir(&l.root, "Berserk/ch01");
    touch(&l.root, "Berserk/ch01/p.png", b"x");

    // Must return empty, not error and not leak.
    assert_eq!(list_chapters(&l.cfg, &l.cache, "../secret.cbz"), Vec::new());
    assert_eq!(list_chapters(&l.cfg, &l.cache, "../../etc"), Vec::new());
    assert_eq!(list_chapters(&l.cfg, &l.cache, "/etc"), Vec::new());
    assert_eq!(
      list_chapters(&l.cfg, &l.cache, "Berserk/../../secret.cbz"),
      Vec::new()
    );
    // The directory itself is not a manga either.
    assert_eq!(list_chapters(&l.cfg, &l.cache, ""), Vec::new());
  }

  #[test]
  fn list_chapters_returns_empty_for_a_random_non_archive_file() {
    let l = lib();
    touch(&l.root, "readme.txt", b"hello");
    assert_eq!(list_chapters(&l.cfg, &l.cache, "readme.txt"), Vec::new());
  }

  #[test]
  fn list_chapters_returns_empty_for_a_missing_manga() {
    let l = lib();
    assert_eq!(list_chapters(&l.cfg, &l.cache, "Nope"), Vec::new());
  }

  // --- listChaptersFromDir ---

  #[test]
  fn dir_manga_makes_one_chapter_per_subdirectory() {
    let l = lib();
    touch(&l.root, "Berserk/ch02/page02.png", b"b");
    touch(&l.root, "Berserk/ch02/page01.png", b"a");
    touch(&l.root, "Berserk/ch01/page01.png", b"c");

    let chapters = list_chapters(&l.cfg, &l.cache, "Berserk");
    assert_eq!(chapters.len(), 2);
    assert_eq!(chapters[0].name, "ch01");
    assert_eq!(chapters[1].name, "ch02");
    assert_eq!(chapters[1].pages, ["page01.png", "page02.png"]);
    assert_eq!(chapters[1].page_count, 2);
  }

  #[test]
  fn dir_manga_with_only_loose_images_becomes_one_unnamed_chapter() {
    let l = lib();
    touch(&l.root, "Oneshot/page02.png", b"b");
    touch(&l.root, "Oneshot/page01.png", b"a");

    let chapters = list_chapters(&l.cfg, &l.cache, "Oneshot");
    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].name, "");
    assert_eq!(chapters[0].slug, "");
    assert_eq!(chapters[0].pages, ["page01.png", "page02.png"]);
  }

  #[test]
  fn dir_manga_skips_dotfile_subdirectories() {
    let l = lib();
    touch(&l.root, "Berserk/ch01/page01.png", b"a");
    touch(&l.root, "Berserk/.thumbnails/page01.png", b"a");

    let chapters = list_chapters(&l.cfg, &l.cache, "Berserk");
    let names: Vec<&str> = chapters.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["ch01"]);
  }

  #[test]
  fn dir_manga_excludes_subdirectories_with_no_images() {
    let l = lib();
    touch(&l.root, "Berserk/ch01/page01.png", b"a");
    mkdir(&l.root, "Berserk/empty");
    touch(&l.root, "Berserk/notes/readme.txt", b"not an image");

    let chapters = list_chapters(&l.cfg, &l.cache, "Berserk");
    let names: Vec<&str> = chapters.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["ch01"]);
  }

  #[test]
  fn dir_manga_ignores_loose_images_once_subdirectories_exist() {
    let l = lib();
    touch(&l.root, "Berserk/ch01/page01.png", b"a");
    touch(&l.root, "Berserk/cover.png", b"cover");

    let chapters = list_chapters(&l.cfg, &l.cache, "Berserk");
    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].name, "ch01");
  }

  #[test]
  fn dir_manga_with_nothing_readable_yields_no_chapters() {
    let l = lib();
    mkdir(&l.root, "Empty");
    assert_eq!(list_chapters(&l.cfg, &l.cache, "Empty"), Vec::new());
  }

  #[test]
  fn dir_chapter_slug_is_percent_encoded() {
    let l = lib();
    touch(&l.root, "Berserk/Chapter 01/page01.png", b"a");

    let chapters = list_chapters(&l.cfg, &l.cache, "Berserk");
    assert_eq!(chapters[0].name, "Chapter 01");
    assert_eq!(chapters[0].slug, "Chapter%2001");
  }

  // --- listChaptersFromZip ---

  #[test]
  fn zip_manga_groups_entries_into_chapters() {
    let l = lib();
    write_zip(
      &l.root,
      "Akira.cbz",
      &[
        ("ch01/page01.png", b"a"),
        ("ch01/page02.png", b"b"),
        ("ch02/page01.png", b"c"),
      ],
    );

    let chapters = list_chapters(&l.cfg, &l.cache, "Akira.cbz");
    assert_eq!(chapters.len(), 2);
    assert_eq!(chapters[0].name, "ch01");
    assert_eq!(chapters[0].page_count, 2);
    // Pages are the full entry paths, which is what the image route needs.
    assert_eq!(chapters[0].pages, ["ch01/page01.png", "ch01/page02.png"]);
    assert_eq!(chapters[1].name, "ch02");
  }

  #[test]
  fn zip_manga_counts_only_image_entries() {
    let l = lib();
    write_zip(
      &l.root,
      "Akira.cbz",
      &[
        ("ch01/page01.png", b"a"),
        ("ch01/ComicInfo.xml", b"<xml/>"),
        ("ch01/notes.txt", b"text"),
        ("ch01/page02.png", b"b"),
      ],
    );

    let chapters = list_chapters(&l.cfg, &l.cache, "Akira.cbz");
    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].page_count, 2);
    assert_eq!(chapters[0].pages, ["ch01/page01.png", "ch01/page02.png"]);
  }

  #[test]
  fn zip_manga_strips_a_redundant_common_root() {
    let l = lib();
    write_zip(
      &l.root,
      "Akira.cbz",
      &[
        ("Akira/ch01/page01.png", b"a"),
        ("Akira/ch01/page02.png", b"b"),
        ("Akira/ch02/page01.png", b"c"),
      ],
    );

    let chapters = list_chapters(&l.cfg, &l.cache, "Akira.cbz");
    let names: Vec<&str> = chapters.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["ch01", "ch02"]);
  }

  #[test]
  fn zip_manga_with_flat_pages_becomes_one_unnamed_chapter() {
    let l = lib();
    write_zip(
      &l.root,
      "Oneshot.cbz",
      &[("page02.png", b"b"), ("page01.png", b"a")],
    );

    let chapters = list_chapters(&l.cfg, &l.cache, "Oneshot.cbz");
    assert_eq!(chapters.len(), 1);
    assert_eq!(chapters[0].name, "");
    assert_eq!(chapters[0].pages, ["page01.png", "page02.png"]);
  }

  #[test]
  fn zip_manga_sorts_pages_numerically_within_a_chapter() {
    let l = lib();
    write_zip(
      &l.root,
      "Akira.cbz",
      &[
        ("ch01/page10.png", b"j"),
        ("ch01/page2.png", b"b"),
        ("ch01/page1.png", b"a"),
      ],
    );

    let chapters = list_chapters(&l.cfg, &l.cache, "Akira.cbz");
    assert_eq!(
      chapters[0].pages,
      ["ch01/page1.png", "ch01/page2.png", "ch01/page10.png"]
    );
  }

  #[test]
  fn a_corrupt_archive_yields_no_chapters_rather_than_failing() {
    let l = lib();
    touch(&l.root, "Broken.cbz", b"not actually a zip file");
    assert_eq!(list_chapters(&l.cfg, &l.cache, "Broken.cbz"), Vec::new());
  }

  // --- getImageFromDir ---

  #[test]
  fn reads_a_page_from_a_directory_manga() {
    let l = lib();
    touch(&l.root, "Berserk/ch01/page01.png", b"PNGDATA");

    let img = get_image_from_dir(&l.cfg, "Berserk", &["ch01".into(), "page01.png".into()]).unwrap();
    assert_eq!(img.bytes, b"PNGDATA");
    assert_eq!(img.ext, ".png");
  }

  #[test]
  fn dir_image_extension_is_lowercased_for_content_type_mapping() {
    let l = lib();
    touch(&l.root, "Berserk/ch01/page01.JPG", b"JPEGDATA");

    let img = get_image_from_dir(&l.cfg, "Berserk", &["ch01".into(), "page01.JPG".into()]).unwrap();
    assert_eq!(img.ext, ".jpg");
  }

  #[test]
  fn dir_image_rejects_paths_escaping_the_manga_directory() {
    let l = lib();
    touch(l.root.parent().unwrap(), "secret.png", b"SECRET");

    assert!(get_image_from_dir(
      &l.cfg,
      "Berserk",
      &["..".into(), "..".into(), "secret.png".into()]
    )
    .is_none());
    assert!(get_image_from_dir(&l.cfg, "..", &["secret.png".into()]).is_none());
    assert!(get_image_from_dir(&l.cfg, "/etc", &["hostname".into()]).is_none());
  }

  #[test]
  fn dir_image_rejects_non_image_extensions_even_when_the_file_exists() {
    let l = lib();
    touch(&l.root, "Berserk/secrets.txt", b"PLAINTEXT");
    touch(&l.root, "Berserk/id_rsa", b"KEY");

    assert!(get_image_from_dir(&l.cfg, "Berserk", &["secrets.txt".into()]).is_none());
    assert!(get_image_from_dir(&l.cfg, "Berserk", &["id_rsa".into()]).is_none());
  }

  #[test]
  fn dir_image_returns_none_for_a_missing_file() {
    let l = lib();
    mkdir(&l.root, "Berserk");
    assert!(get_image_from_dir(&l.cfg, "Berserk", &["nope.png".into()]).is_none());
  }

  // --- getImageFromZip ---

  #[test]
  fn reads_a_page_out_of_an_archive() {
    let l = lib();
    write_zip(&l.root, "Akira.cbz", &[("ch01/page01.png", b"PNGDATA")]);

    let img = get_image_from_zip(&l.cfg, &l.cache, "Akira.cbz", "ch01/page01.png").unwrap();
    assert_eq!(img.bytes, b"PNGDATA");
    assert_eq!(img.ext, ".png");
  }

  #[test]
  fn zip_image_rejects_an_archive_path_outside_the_manga_directory() {
    let l = lib();
    write_zip(
      l.root.parent().unwrap(),
      "secret.cbz",
      &[("p.png", b"SECRET")],
    );
    assert!(get_image_from_zip(&l.cfg, &l.cache, "../secret.cbz", "p.png").is_none());
  }

  #[test]
  fn zip_image_rejects_non_image_entries() {
    let l = lib();
    write_zip(
      &l.root,
      "Akira.cbz",
      &[("ch01/page01.png", b"a"), ("ch01/ComicInfo.xml", b"<xml/>")],
    );
    assert!(get_image_from_zip(&l.cfg, &l.cache, "Akira.cbz", "ch01/ComicInfo.xml").is_none());
  }

  #[test]
  fn zip_image_returns_none_for_an_entry_that_is_not_in_the_archive() {
    let l = lib();
    write_zip(&l.root, "Akira.cbz", &[("ch01/page01.png", b"a")]);
    assert!(get_image_from_zip(&l.cfg, &l.cache, "Akira.cbz", "ch01/page99.png").is_none());
  }

  #[test]
  fn zip_image_rejects_a_manga_that_is_not_an_archive() {
    let l = lib();
    touch(&l.root, "Berserk/ch01/page01.png", b"a");
    assert!(get_image_from_zip(&l.cfg, &l.cache, "Berserk", "ch01/page01.png").is_none());
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
