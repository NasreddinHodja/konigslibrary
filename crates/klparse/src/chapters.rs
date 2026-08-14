//! Chapter detection from a flat list of `/`-separated entry names.
//!
//! Port of the former `src/lib/chapters/index.ts`, shared by the browser (wasm)
//! and the server exactly as the TypeScript version was shared between the
//! upload flow and `listChaptersFromZip`.

use crate::collate::natural_cmp;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Depth {
  pub depth: usize,
  pub common_root: Option<String>,
}

/// Finds how many leading path segments every entry has in common, stopping two
/// segments short of the shortest name so a chapter segment and a filename
/// always remain.
pub fn detect_depth<S: AsRef<str>>(names: &[S]) -> Depth {
  if names.is_empty() {
    return Depth {
      depth: 0,
      common_root: None,
    };
  }

  let split: Vec<Vec<&str>> = names
    .iter()
    .map(|n| n.as_ref().split('/').collect())
    .collect();
  let min_len = split
    .iter()
    .map(|s| s.len())
    .min()
    .expect("names is non-empty");
  let mut depth = 0usize;

  // `min_len - 2` as a saturating subtraction: for flat names (len 1) or names
  // one level deep (len 2) the loop must not run at all.
  for i in 0..min_len.saturating_sub(2) {
    let val = split[0][i];
    if split.iter().all(|s| s[i] == val) {
      depth = i + 1;
    } else {
      break;
    }
  }

  let common_root = if depth > 0 {
    Some(split[0][..depth].join("/"))
  } else {
    None
  };
  Depth { depth, common_root }
}

/// Groups entries by the path segment at `depth`, returning `(chapter, entries)`
/// pairs. Chapter order is the insertion order of first appearance; entries
/// within a chapter are sorted by name with numeric collation.
pub fn group_by_chapter<T, F>(entries: Vec<T>, depth: usize, name_of: F) -> Vec<(String, Vec<T>)>
where
  F: Fn(&T) -> &str,
{
  let mut order: Vec<String> = Vec::new();
  let mut groups: Vec<Vec<T>> = Vec::new();

  for entry in entries {
    let segs: Vec<&str> = name_of(&entry).split('/').collect();
    // Use the segment at `depth`, but if it just repeats the common root
    // (redundant nesting), skip to the next meaningful segment.
    let mut chapter = if segs.len() > depth + 1 {
      segs[depth]
    } else {
      ""
    };
    if !chapter.is_empty() && depth > 0 && chapter == segs[depth - 1] && segs.len() > depth + 2 {
      chapter = segs[depth + 1];
    }
    let chapter = chapter.to_string();

    match order.iter().position(|c| *c == chapter) {
      Some(idx) => groups[idx].push(entry),
      None => {
        order.push(chapter);
        groups.push(vec![entry]);
      }
    }
  }

  for group in &mut groups {
    group.sort_by(|a, b| natural_cmp(name_of(a), name_of(b)));
  }

  order.into_iter().zip(groups).collect()
}

#[cfg(test)]
mod tests {
  use super::{detect_depth, group_by_chapter, Depth};

  fn names(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
  }

  fn group(v: &[&str], depth: usize) -> Vec<(String, Vec<String>)> {
    group_by_chapter(names(v), depth, |s| s.as_str())
  }

  fn chapter<'a>(groups: &'a [(String, Vec<String>)], name: &str) -> Option<&'a Vec<String>> {
    groups.iter().find(|(n, _)| n == name).map(|(_, e)| e)
  }

  // --- detectDepth: ported from src/lib/chapters/chapters.test.ts ---

  #[test]
  fn depth_zero_for_flat_files() {
    assert_eq!(
      detect_depth(&names(&["page01.png", "page02.png"])),
      Depth {
        depth: 0,
        common_root: None
      }
    );
  }

  #[test]
  fn depth_zero_for_empty_input() {
    let empty: [&str; 0] = [];
    assert_eq!(
      detect_depth(&empty),
      Depth {
        depth: 0,
        common_root: None
      }
    );
  }

  #[test]
  fn depth_zero_for_single_level_directories() {
    let d = detect_depth(&names(&[
      "ch01/page01.png",
      "ch01/page02.png",
      "ch02/page01.png",
    ]));
    assert_eq!(d.depth, 0);
  }

  #[test]
  fn detects_common_root_at_depth_one() {
    let d = detect_depth(&names(&[
      "manga/ch01/page01.png",
      "manga/ch01/page02.png",
      "manga/ch02/page01.png",
    ]));
    assert_eq!(d.depth, 1);
    assert_eq!(d.common_root.as_deref(), Some("manga"));
  }

  #[test]
  fn detects_deeper_common_root() {
    let d = detect_depth(&names(&[
      "root/manga/vol1/ch01/page01.png",
      "root/manga/vol1/ch02/page01.png",
    ]));
    assert!(d.depth >= 1);
    assert!(d.common_root.is_some());
    assert_eq!(d.common_root.as_deref(), Some("root/manga/vol1"));
  }

  // --- groupByChapter: ported from src/lib/chapters/chapters.test.ts ---

  #[test]
  fn groups_flat_files_into_a_single_chapter() {
    let groups = group(&["page01.png", "page02.png"], 0);
    assert_eq!(groups.len(), 1);
    assert_eq!(chapter(&groups, "").map(Vec::len), Some(2));
  }

  #[test]
  fn groups_by_first_directory_at_depth_zero() {
    let groups = group(
      &["ch01/page01.png", "ch01/page02.png", "ch02/page01.png"],
      0,
    );
    assert_eq!(groups.len(), 2);
    assert_eq!(chapter(&groups, "ch01").map(Vec::len), Some(2));
    assert_eq!(chapter(&groups, "ch02").map(Vec::len), Some(1));
  }

  #[test]
  fn groups_by_segment_at_specified_depth() {
    let groups = group(
      &[
        "manga/ch01/page01.png",
        "manga/ch01/page02.png",
        "manga/ch02/page01.png",
      ],
      1,
    );
    assert_eq!(groups.len(), 2);
    assert!(chapter(&groups, "ch01").is_some());
    assert!(chapter(&groups, "ch02").is_some());
  }

  #[test]
  fn sorts_entries_within_each_chapter_by_name() {
    let groups = group(
      &["ch01/page03.png", "ch01/page01.png", "ch01/page02.png"],
      0,
    );
    assert_eq!(
      chapter(&groups, "ch01").unwrap().as_slice(),
      ["ch01/page01.png", "ch01/page02.png", "ch01/page03.png"]
    );
  }

  // --- behaviour the TS tests did not pin down ---

  #[test]
  fn sorts_pages_numerically_not_lexicographically() {
    let groups = group(&["ch01/page10.png", "ch01/page2.png", "ch01/page1.png"], 0);
    assert_eq!(
      chapter(&groups, "ch01").unwrap().as_slice(),
      ["ch01/page1.png", "ch01/page2.png", "ch01/page10.png"]
    );
  }

  #[test]
  fn skips_a_segment_that_repeats_the_common_root() {
    let groups = group(
      &["manga/manga/ch01/page01.png", "manga/manga/ch02/page01.png"],
      1,
    );
    assert!(chapter(&groups, "ch01").is_some());
    assert!(chapter(&groups, "ch02").is_some());
  }
}
