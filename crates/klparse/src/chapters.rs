//! Chapter order within a manga: by volume and chapter number, taken from each
//! archive's `ComicInfo.xml` where it has them and parsed out of its file name
//! otherwise, so a library sorts right without renaming.
//!
//! The name parser follows Kavita's markers (`v1`, `vol. 1`, `tome 2`, `c12`,
//! `ch.12.5`, `chapter 12`, a bare number) for Latin-script names only.

use std::cmp::Ordering;

use serde::Serialize;

use crate::collate::natural_cmp;
use crate::comicinfo::element;
use crate::names::strip_zip_ext;

/// Where a chapter falls in its manga. Either field may be missing: volume
/// archives have no chapter, loose chapters no volume.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
pub struct ChapterNumber {
  pub volume: Option<f64>,
  pub chapter: Option<f64>,
}

impl ChapterNumber {
  /// `self`, with each missing field taken from `other`.
  pub fn or(self, other: ChapterNumber) -> ChapterNumber {
    ChapterNumber {
      volume: self.volume.or(other.volume),
      chapter: self.chapter.or(other.chapter),
    }
  }

  fn is_known(&self) -> bool {
    self.volume.is_some() || self.chapter.is_some()
  }
}

/// `<Volume>` and `<Number>` of a `ComicInfo.xml`, where they are numbers.
pub fn comic_info_number(xml: &str) -> ChapterNumber {
  let number = |tag| {
    element(xml, tag)
      .and_then(|n| n.parse::<f64>().ok())
      .filter(|n| n.is_finite() && *n >= 0.0)
  };
  ChapterNumber {
    volume: number("Volume"),
    chapter: number("Number"),
  }
}

const VOLUME_MARKERS: [&str; 4] = ["volume", "vol", "tome", "v"];
const CHAPTER_MARKERS: [&str; 6] = ["chapter", "chap", "chp", "ch", "episode", "c"];

/// The volume and chapter in a chapter archive's file name.
pub fn name_number(name: &str) -> ChapterNumber {
  let stem = strip_zip_ext(name);
  if let Some(chapter) = numbered_name(stem) {
    return ChapterNumber {
      volume: None,
      chapter: Some(chapter),
    };
  }

  let text = without_brackets(&stem.to_lowercase());
  let volume = marked(&text, &VOLUME_MARKERS);
  let chapter = marked(&text, &CHAPTER_MARKERS);
  ChapterNumber {
    volume,
    chapter: chapter.or_else(|| volume.is_none().then(|| bare(&text)).flatten()),
  }
}

/// `chapter_<major>-<minor>`, the names the README documents: `chapter_0044-05`
/// is 44.05, so minors order as written.
fn numbered_name(stem: &str) -> Option<f64> {
  let (major, minor) = stem.strip_prefix("chapter_")?.split_once('-')?;
  let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
  if !digits(major) || !digits(minor) {
    return None;
  }
  format!("{major}.{minor}").parse().ok()
}

/// `text` with `(…)`, `[…]` and `{…}` groups removed: scanlator tags, years and
/// resolutions, whose numbers aren't the chapter's.
fn without_brackets(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  let mut depth = 0usize;
  for ch in text.chars() {
    match ch {
      '(' | '[' | '{' => depth += 1,
      ')' | ']' | '}' => depth = depth.saturating_sub(1),
      _ if depth == 0 => out.push(ch),
      _ => {}
    }
  }
  out
}

/// The number at the start of `s`: digits, optionally a `.` and more digits.
fn number_at(s: &str) -> Option<(f64, usize)> {
  let int = s.bytes().take_while(u8::is_ascii_digit).count();
  if int == 0 {
    return None;
  }
  let mut end = int;
  if s[int..].starts_with('.') {
    let frac = s[int + 1..].bytes().take_while(u8::is_ascii_digit).count();
    if frac > 0 {
      end = int + 1 + frac;
    }
  }
  Some((s[..end].parse().ok()?, end))
}

/// The number after the first of `markers` that starts a word and is followed,
/// past at most a few separators, by digits: `vol. 3`, `c012`, `chapter_7`.
fn marked(text: &str, markers: &[&str]) -> Option<f64> {
  let mut prev: Option<char> = None;
  for (i, ch) in text.char_indices() {
    let starts_word = !prev.is_some_and(char::is_alphabetic);
    prev = Some(ch);
    if !starts_word {
      continue;
    }
    for marker in markers {
      let Some(rest) = text[i..].strip_prefix(marker) else {
        continue;
      };
      let gap = rest
        .bytes()
        .take(3)
        .take_while(|b| matches!(b, b'.' | b' ' | b'_' | b'-'))
        .count();
      if let Some((n, _)) = number_at(&rest[gap..]) {
        return Some(n);
      }
    }
  }
  None
}

/// The last number not run into a letter, for names with no markers:
/// `Beelzebub_53` is 53, `Kaiju No. 8 - 045` is 45.
fn bare(text: &str) -> Option<f64> {
  let mut found = None;
  let mut prev: Option<char> = None;
  let mut skip_to = 0;
  for (i, ch) in text.char_indices() {
    let after_letter = prev.is_some_and(char::is_alphabetic);
    let in_number = prev.is_some_and(|p| p.is_ascii_digit());
    prev = Some(ch);
    if i < skip_to || in_number || after_letter || !ch.is_ascii_digit() {
      continue;
    }
    if let Some((n, len)) = number_at(&text[i..]) {
      found = Some(n);
      skip_to = i + len;
    }
  }
  found
}

/// The number a chapter sorts by: the ComicInfo values it has, then the file
/// name's for the rest.
pub fn chapter_number(name: &str, comic_info: ChapterNumber) -> ChapterNumber {
  comic_info.or(name_number(name))
}

/// Chapter order. Numbered chapters come first, by volume (chapters not yet
/// in a volume after every volume) then chapter (a whole volume before the
/// chapters numbered within it); the rest follow by name, numbers in it
/// compared by value. Equal numbers fall back to the name too.
pub fn chapter_cmp(a: (&str, ChapterNumber), b: (&str, ChapterNumber)) -> Ordering {
  let (an, bn) = (a.1, b.1);
  let by_number = match (an.is_known(), bn.is_known()) {
    (true, false) => Ordering::Less,
    (false, true) => Ordering::Greater,
    (false, false) => Ordering::Equal,
    (true, true) => {
      let volume = |n: ChapterNumber| n.volume.unwrap_or(f64::INFINITY);
      let chapter = |n: ChapterNumber| n.chapter.unwrap_or(f64::NEG_INFINITY);
      volume(an)
        .total_cmp(&volume(bn))
        .then(chapter(an).total_cmp(&chapter(bn)))
    }
  };
  by_number.then_with(|| natural_cmp(a.0, b.0))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn num(volume: Option<f64>, chapter: Option<f64>) -> ChapterNumber {
    ChapterNumber { volume, chapter }
  }

  fn sorted(names: &[&str]) -> Vec<String> {
    let mut v: Vec<(String, ChapterNumber)> = names
      .iter()
      .map(|n| (n.to_string(), chapter_number(n, ChapterNumber::default())))
      .collect();
    v.sort_by(|a, b| chapter_cmp((&a.0, a.1), (&b.0, b.1)));
    v.into_iter().map(|(n, _)| n).collect()
  }

  #[test]
  fn parses_volume_and_chapter_markers() {
    assert_eq!(
      name_number("Berserk v01 c003.cbz"),
      num(Some(1.0), Some(3.0))
    );
    assert_eq!(
      name_number("Berserk Vol. 2 Ch. 12.5.cbz"),
      num(Some(2.0), Some(12.5))
    );
    assert_eq!(name_number("Volume 07.zip"), num(Some(7.0), None));
    assert_eq!(name_number("Tome 3.cbz"), num(Some(3.0), None));
    assert_eq!(
      name_number("Chapter 12 - Title 2.cbz"),
      num(None, Some(12.0))
    );
    assert_eq!(name_number("chp.4.cbz"), num(None, Some(4.0)));
    assert_eq!(name_number("Episode_9.cbz"), num(None, Some(9.0)));
    assert_eq!(name_number("Berserk c001-006.cbz"), num(None, Some(1.0)));
  }

  #[test]
  fn markers_must_start_a_word() {
    // The `ch` of "Witch" and the `v` of "Love" are not markers.
    assert_eq!(name_number("Witch 12.cbz"), num(None, Some(12.0)));
    assert_eq!(name_number("Love2.cbz"), num(None, None));
  }

  #[test]
  fn falls_back_to_the_last_bare_number() {
    assert_eq!(name_number("Beelzebub_53[KSH].zip"), num(None, Some(53.0)));
    assert_eq!(name_number("Kaiju No. 8 - 045.cbz"), num(None, Some(45.0)));
    assert_eq!(name_number("001.cbz"), num(None, Some(1.0)));
    assert_eq!(
      name_number("Berserk 12 (2016) [Group].cbz"),
      num(None, Some(12.0))
    );
    assert_eq!(name_number("Extras.cbz"), num(None, None));
  }

  #[test]
  fn reads_the_numbered_chapter_names() {
    assert_eq!(name_number("chapter_0044-00.cbz"), num(None, Some(44.0)));
    assert_eq!(name_number("chapter_0044-05.cbz"), num(None, Some(44.05)));
  }

  #[test]
  fn reads_numbers_out_of_comic_info() {
    let xml = "<ComicInfo><Volume>3</Volume><Number>12.5</Number></ComicInfo>";
    assert_eq!(comic_info_number(xml), num(Some(3.0), Some(12.5)));
    let xml = "<ComicInfo><Number>Special</Number><Volume>-1</Volume></ComicInfo>";
    assert_eq!(comic_info_number(xml), num(None, None));
  }

  #[test]
  fn comic_info_overrides_the_name_field_by_field() {
    let n = chapter_number("Berserk v02 c010.cbz", num(None, Some(11.0)));
    assert_eq!(n, num(Some(2.0), Some(11.0)));
  }

  #[test]
  fn sorts_unpadded_numbers_by_value() {
    assert_eq!(
      sorted(&["ch10.cbz", "ch2.cbz", "ch1.cbz", "ch1.5.cbz"]),
      ["ch1.cbz", "ch1.5.cbz", "ch2.cbz", "ch10.cbz"]
    );
  }

  #[test]
  fn loose_chapters_follow_the_volumes() {
    assert_eq!(
      sorted(&["Ch 21.cbz", "Vol 2.cbz", "Vol 1.cbz", "Ch 20.cbz"]),
      ["Vol 1.cbz", "Vol 2.cbz", "Ch 20.cbz", "Ch 21.cbz"]
    );
  }

  #[test]
  fn unnumbered_chapters_go_last_by_name() {
    assert_eq!(
      sorted(&["Extras.cbz", "ch 3.cbz", "Bonus.cbz"]),
      ["ch 3.cbz", "Bonus.cbz", "Extras.cbz"]
    );
  }

  #[test]
  fn sorts_the_numbered_chapter_names() {
    assert_eq!(
      sorted(&["chapter_0010-00", "chapter_0002-05", "chapter_0002-00"]),
      ["chapter_0002-00", "chapter_0002-05", "chapter_0010-00"]
    );
  }
}
