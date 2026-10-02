//! Paging through a sorted manga listing.
//!
//! Both the server and the device keep their manga directory as one sorted
//! list and hand it out a page at a time, so neither has to send a whole
//! directory — which can hold hundreds of thousands of manga — in one go.
//!
//! Pages are addressed by keyset rather than offset: the cursor is the key of
//! the last manga already shown, so a manga added or removed while someone is
//! scrolling does not shift every later page by one.

use std::cmp::Ordering;

use crate::collate::{fold, locale_cmp};

/// Separates the name from the tie-breaker inside a cursor. No filename or
/// path can contain it.
const CURSOR_SEP: char = '\0';

/// A listing's sort key: the name it is shown and sorted by, and something
/// unique to break ties between equal names (empty when names are unique).
pub type Key<'a> = (&'a str, &'a str);

/// The order every listing is kept in: by name as `localeCompare` sorts, then
/// byte-wise so names that collate equal still have a fixed order, then by
/// tie-breaker.
pub fn key_cmp(a: Key, b: Key) -> Ordering {
  locale_cmp(a.0, b.0)
    .then_with(|| a.0.cmp(b.0))
    .then_with(|| a.1.cmp(b.1))
}

/// The cursor that resumes a listing right after the item with this key.
pub fn cursor((name, tie): Key) -> String {
  format!("{name}{CURSOR_SEP}{tie}")
}

pub struct Page<'a, T> {
  pub items: Vec<&'a T>,
  /// Cursor for the page after this one; `None` on the last page.
  pub next: Option<String>,
}

/// The `limit` items of `sorted` that come after `after` and whose name
/// contains `query`, ignoring case and accents as the server's search does
/// (both sides [`fold`]ed: "okami" finds "Ōkami").
///
/// `sorted` must be in [`key_cmp`] order by `key`. An empty `query` matches
/// everything; an `after` that no longer names an item still resumes at the
/// right place.
pub fn page<'a, T>(
  sorted: &'a [T],
  key: impl Fn(&T) -> Key<'_>,
  query: &str,
  after: Option<&str>,
  limit: usize,
) -> Page<'a, T> {
  let start = match after {
    Some(cursor) => {
      let cursor = cursor.split_once(CURSOR_SEP).unwrap_or((cursor, ""));
      sorted.partition_point(|item| key_cmp(key(item), cursor) != Ordering::Greater)
    }
    None => 0,
  };

  let query = fold(query);
  let mut matching = sorted[start..]
    .iter()
    .filter(|item| query.is_empty() || fold(key(item).0).contains(&query));

  let items: Vec<&T> = matching.by_ref().take(limit).collect();
  let next = match (items.last(), matching.next()) {
    (Some(last), Some(_)) => Some(cursor(key(last))),
    _ => None,
  };
  Page { items, next }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn names(items: &[&str]) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = items
      .iter()
      .map(|n| (n.to_string(), String::new()))
      .collect();
    v.sort_by(|a, b| key_cmp((&a.0, &a.1), (&b.0, &b.1)));
    v
  }

  fn key(item: &(String, String)) -> Key<'_> {
    (&item.0, &item.1)
  }

  fn shown<'a, T>(page: &'a Page<'a, (String, T)>) -> Vec<&'a str> {
    page.items.iter().map(|i| i.0.as_str()).collect()
  }

  #[test]
  fn pages_cover_every_item_exactly_once() {
    let all = names(&["Vagabond", "akira", "Berserk", "Monster", "Pluto", "Akira"]);
    let mut seen = Vec::new();
    let mut after: Option<String> = None;
    loop {
      let p = page(&all, key, "", after.as_deref(), 2);
      seen.extend(shown(&p).into_iter().map(String::from));
      match p.next {
        Some(n) => after = Some(n),
        None => break,
      }
    }
    assert_eq!(
      seen,
      ["akira", "Akira", "Berserk", "Monster", "Pluto", "Vagabond"]
    );
  }

  #[test]
  fn the_last_page_has_no_cursor() {
    let all = names(&["A", "B"]);
    assert!(page(&all, key, "", None, 2).next.is_none());
    assert!(page(&all, key, "", None, 1).next.is_some());
  }

  #[test]
  fn query_matches_a_substring_ignoring_case() {
    let all = names(&["One Piece", "Berserk", "Piece of Cake"]);
    let p = page(&all, key, "  PIECE ", None, 10);
    assert_eq!(shown(&p), ["One Piece", "Piece of Cake"]);
  }

  #[test]
  fn query_matches_ignoring_accents_and_spacing() {
    let all = names(&["Ōkami", "Okami Den", "Berserk", "One  Piece"]);
    assert_eq!(
      shown(&page(&all, key, "okami", None, 10)),
      ["Ōkami", "Okami Den"]
    );
    assert_eq!(
      shown(&page(&all, key, "one piece", None, 10)),
      ["One  Piece"]
    );
  }

  #[test]
  fn query_and_cursor_combine() {
    let all = names(&["a1", "b", "a2", "a3"]);
    let first = page(&all, key, "a", None, 1);
    assert_eq!(shown(&first), ["a1"]);
    let second = page(&all, key, "a", first.next.as_deref(), 5);
    assert_eq!(shown(&second), ["a2", "a3"]);
    assert!(second.next.is_none());
  }

  #[test]
  fn a_cursor_for_a_removed_item_resumes_after_it() {
    let all = names(&["Akira", "Monster"]);
    let p = page(&all, key, "", Some("Berserk\0"), 10);
    assert_eq!(shown(&p), ["Monster"]);
  }

  #[test]
  fn a_cursor_past_the_end_is_an_empty_last_page() {
    let all = names(&["Akira"]);
    let p = page(&all, key, "", Some("Zzz\0"), 10);
    assert!(p.items.is_empty());
    assert!(p.next.is_none());
  }

  #[test]
  fn equal_names_are_told_apart_by_the_tie_breaker() {
    let mut all = vec![
      ("Berserk".to_string(), "/b".to_string()),
      ("Berserk".to_string(), "/a".to_string()),
    ];
    all.sort_by(|a, b| key_cmp(key(a), key(b)));
    let first = page(&all, key, "", None, 1);
    assert_eq!(first.items[0].1, "/a");
    let second = page(&all, key, "", first.next.as_deref(), 1);
    assert_eq!(second.items[0].1, "/b");
  }
}
