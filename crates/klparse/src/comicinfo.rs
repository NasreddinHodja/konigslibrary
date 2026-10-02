//! Manga metadata from what a downloader leaves on disk: a `cover.<ext>` in the
//! manga folder and a `ComicInfo.xml` inside each chapter archive.
//!
//! Filesystem-free, like the rest of this crate: callers pass the folder's file
//! names and a way to open one of them.

use serde::Serialize;

use crate::collate::natural_cmp;
use crate::names::{is_chapter_name, is_cover_name};
use crate::zip::{extract_entry, index_zip, ReadAt, ZipEntry};

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MangaMeta {
  pub title: Option<String>,
  pub description: Option<String>,
  pub year: Option<i32>,
  pub authors: Vec<String>,
  pub tags: Vec<String>,
  pub status: Option<String>,
  /// File name of the cover image inside the manga folder.
  pub cover: Option<String>,
}

impl MangaMeta {
  /// Fills every empty field from `other`.
  fn fill_from(&mut self, other: MangaMeta) {
    if self.title.is_none() {
      self.title = other.title;
    }
    if self.description.is_none() {
      self.description = other.description;
    }
    if self.year.is_none() {
      self.year = other.year;
    }
    if self.authors.is_empty() {
      self.authors = other.authors;
    }
    if self.tags.is_empty() {
      self.tags = other.tags;
    }
    if self.status.is_none() {
      self.status = other.status;
    }
  }
}

/// The text of the first `<tag>…</tag>`, entity-decoded and trimmed. `None` when
/// the element is missing, self-closing or blank.
pub(crate) fn element(xml: &str, tag: &str) -> Option<String> {
  let open = format!("<{tag}>");
  let close = format!("</{tag}>");
  let start = xml.find(&open)? + open.len();
  let len = xml[start..].find(&close)?;
  let text = decode_entities(xml[start..start + len].trim());
  (!text.is_empty()).then_some(text)
}

/// How far past a `&` to look for the `;` that ends an entity: room for the
/// longest valid one with some leading zeros.
const ENTITY_MAX: usize = 32;

fn decode_entities(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  let mut rest = s;
  while let Some(amp) = rest.find('&') {
    out.push_str(&rest[..amp]);
    rest = &rest[amp..];
    // An entity's `;` is close by (`&#x10FFFF;` is the longest valid one).
    // Searching the whole rest instead would rescan it for every `&` that
    // isn't an entity, which is quadratic in a long run of them.
    let Some(semi) = rest.bytes().take(ENTITY_MAX).position(|b| b == b';') else {
      out.push('&');
      rest = &rest[1..];
      continue;
    };
    let entity = &rest[1..semi];
    let decoded = match entity {
      "amp" => Some('&'),
      "lt" => Some('<'),
      "gt" => Some('>'),
      "quot" => Some('"'),
      "apos" => Some('\''),
      _ => entity
        .strip_prefix("#x")
        .or_else(|| entity.strip_prefix("#X"))
        .and_then(|h| u32::from_str_radix(h, 16).ok())
        .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
        .and_then(char::from_u32),
    };
    match decoded {
      Some(c) => {
        out.push(c);
        rest = &rest[semi + 1..];
      }
      None => {
        out.push('&');
        rest = &rest[1..];
      }
    }
  }
  out.push_str(rest);
  out
}

/// Archives without `<Status>` mark a complete series with `<Count>`.
fn status(xml: &str) -> Option<String> {
  element(xml, "Status").or_else(|| {
    element(xml, "Count")
      .and_then(|c| c.parse::<u32>().ok())
      .filter(|c| *c > 0)
      .map(|_| "Complete".to_string())
  })
}

/// Comma-separated values from several elements, trimmed and deduplicated in
/// order.
fn list(xml: &str, tags: &[&str]) -> Vec<String> {
  let mut out: Vec<String> = Vec::new();
  for tag in tags {
    let Some(text) = element(xml, tag) else {
      continue;
    };
    for item in text.split(',').map(str::trim).filter(|s| !s.is_empty()) {
      if !out.iter().any(|o| o == item) {
        out.push(item.to_string());
      }
    }
  }
  out
}

pub fn parse_comic_info(xml: &str) -> MangaMeta {
  MangaMeta {
    title: element(xml, "Series"),
    description: element(xml, "Summary"),
    // ComicInfo's schema default for an unknown year is -1.
    year: element(xml, "Year")
      .and_then(|y| y.parse().ok())
      .filter(|y| *y > 0),
    authors: list(xml, &["Writer", "Penciller"]),
    tags: list(xml, &["Genre", "Tags"]),
    status: status(xml),
    cover: None,
  }
}

/// An archive's `ComicInfo.xml` entry, at any depth.
pub fn comic_info_entry(entries: &[ZipEntry]) -> Option<&ZipEntry> {
  entries.iter().find(|e| {
    let base = e.name.rsplit('/').next().unwrap_or(&e.name);
    base.eq_ignore_ascii_case("ComicInfo.xml")
  })
}

/// The `ComicInfo.xml` of one archive, if it has one.
pub(crate) fn read_comic_info<R: ReadAt + ?Sized>(r: &R) -> Option<MangaMeta> {
  let entries = index_zip(r).ok()?;
  let entry = comic_info_entry(&entries)?;
  let bytes = extract_entry(r, entry).ok()?;
  Some(parse_comic_info(&String::from_utf8_lossy(&bytes)))
}

/// Which files of a manga folder hold its metadata: the chapter archives to
/// read `ComicInfo.xml` from, in priority order, and the cover image.
///
/// The first chapter wins and the last one fills whatever it lacks: a
/// downloader can write full metadata into some chapters and only the series
/// name into others.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct MetaSources {
  pub archives: Vec<String>,
  pub cover: Option<String>,
}

pub fn meta_sources(names: &[String]) -> MetaSources {
  let mut archives: Vec<&String> = names.iter().filter(|n| is_chapter_name(n)).collect();
  archives.sort_by(|a, b| natural_cmp(a, b));
  let archives = match archives.as_slice() {
    [] => vec![],
    [only] => vec![(*only).clone()],
    [first, .., last] => vec![(*first).clone(), (*last).clone()],
  };

  let cover = names.iter().find(|n| is_cover_name(n)).cloned();

  MetaSources { archives, cover }
}

/// Combines what [`meta_sources`] pointed at: the parsed `ComicInfo.xml` of
/// each archive, in the same order, and the cover.
pub fn merge_meta(infos: impl IntoIterator<Item = MangaMeta>, cover: Option<String>) -> MangaMeta {
  let mut meta = MangaMeta::default();
  for info in infos {
    meta.fill_from(info);
  }
  meta.cover = cover;
  meta
}

/// Metadata for a manga folder from its file `names`.
pub fn manga_meta<R: ReadAt>(names: &[String], open: impl Fn(&str) -> Option<R>) -> MangaMeta {
  let sources = meta_sources(names);
  let infos = sources
    .archives
    .iter()
    .filter_map(|name| open(name).and_then(|r| read_comic_info(&r)));
  merge_meta(infos, sources.cover)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::fixture::{deflated, stored, Fixture};

  const FULL: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Series>One Piece</Series>
  <Number>1</Number>
  <Summary>Luffy &amp; the search for &quot;One Piece&quot;&#8230;</Summary>
  <Year>1997</Year>
  <Count>1100</Count>
  <Writer>ODA Eiichiro</Writer>
  <Penciller>ODA Eiichiro</Penciller>
  <Genre>Action, Adventure</Genre>
  <Tags>Pirate/s, Adventure, Ocean</Tags>
  <Status>Ongoing</Status>
</ComicInfo>"#;

  const SPARSE: &str = r#"<ComicInfo>
  <Series>One Piece (other)</Series>
  <Writer>Someone Else</Writer>
  <Year>-1</Year>
  <Summary/>
</ComicInfo>"#;

  #[test]
  fn parses_the_fields_the_detail_page_shows() {
    let m = parse_comic_info(FULL);
    assert_eq!(m.title.as_deref(), Some("One Piece"));
    assert_eq!(
      m.description.as_deref(),
      Some("Luffy & the search for \"One Piece\"…")
    );
    assert_eq!(m.year, Some(1997));
    assert_eq!(m.authors, ["ODA Eiichiro"]);
    assert_eq!(m.tags, ["Action", "Adventure", "Pirate/s", "Ocean"]);
    assert_eq!(m.status.as_deref(), Some("Ongoing"));
  }

  #[test]
  fn a_count_without_a_status_means_complete() {
    let m = parse_comic_info("<ComicInfo><Count>18</Count></ComicInfo>");
    assert_eq!(m.status.as_deref(), Some("Complete"));
  }

  #[test]
  fn missing_empty_and_placeholder_values_are_none() {
    let m = parse_comic_info(SPARSE);
    assert_eq!(m.description, None);
    assert_eq!(m.year, None);
    assert!(m.tags.is_empty());
    assert_eq!(m.status, None);
  }

  #[test]
  fn an_unknown_entity_is_left_as_is() {
    assert_eq!(decode_entities("a &nbsp; b & c"), "a &nbsp; b & c");
  }

  #[test]
  fn entities_decode_next_to_ampersands_that_are_not_entities() {
    assert_eq!(decode_entities("&&amp;&#x41;& &#66;"), "&&A& B");
    assert_eq!(decode_entities("& no semicolon"), "& no semicolon");
  }

  #[test]
  fn a_long_run_of_ampersands_decodes_in_linear_time() {
    // Quadratic before the `;` search was bounded: seconds at this size.
    let text = format!("{};", "&".repeat(400_000));
    let start = std::time::Instant::now();
    assert_eq!(decode_entities(&text), text);
    assert!(start.elapsed() < std::time::Duration::from_secs(2));
  }

  fn archive(xml: Option<&str>) -> Vec<u8> {
    let mut fx = Fixture::new().entry(stored("01.jpg", b"x"));
    if let Some(xml) = xml {
      fx = fx.entry(deflated("ComicInfo.xml", xml.as_bytes()));
    }
    fx.build()
  }

  fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
  }

  #[test]
  fn first_chapter_wins_and_the_last_fills_gaps() {
    let files = names(&[
      "cover.jpg",
      "chapter_0010.cbz",
      "chapter_0002.cbz",
      "chapter_0001.cbz",
    ]);
    let m = manga_meta(&files, |n| match n {
      "chapter_0001.cbz" => Some(archive(Some(SPARSE))),
      "chapter_0010.cbz" => Some(archive(Some(FULL))),
      "chapter_0002.cbz" => panic!("middle chapters are not read"),
      _ => None,
    });
    assert_eq!(m.title.as_deref(), Some("One Piece (other)"));
    assert_eq!(m.authors, ["Someone Else"]);
    assert_eq!(m.year, Some(1997));
    assert_eq!(m.status.as_deref(), Some("Ongoing"));
    assert!(m.description.is_some());
    assert_eq!(m.cover.as_deref(), Some("cover.jpg"));
  }

  #[test]
  fn a_folder_without_metadata_yields_an_empty_result() {
    let files = names(&["ch1.cbz", "notes.txt", "cover.txt"]);
    let m = manga_meta(&files, |_| Some(archive(None)));
    assert_eq!(m, MangaMeta::default());
  }
}
