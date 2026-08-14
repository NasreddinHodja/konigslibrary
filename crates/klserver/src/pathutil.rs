//! Node-compatible path resolution.
//!
//! The traversal guards being ported here were written against Node's
//! `path.resolve`, which normalises `.` and `..` *lexically* — it never touches
//! the filesystem and never resolves symlinks. `std::fs::canonicalize` is not a
//! drop-in replacement: it requires the path to exist (so a guard would return
//! the wrong answer for a missing file instead of rejecting a traversal) and it
//! follows symlinks (so a symlinked manga directory, which people do use, would
//! stop working). This module reproduces the lexical behaviour instead.

use std::path::{Component, Path, PathBuf};

/// Expands a leading `~`, matching the TypeScript `expandHome`. Only a bare `~`
/// or a `~/`-prefixed path is expanded; `~foo` is left alone.
///
/// The home directory is passed in rather than read from the environment, so
/// tests never have to mutate process-global state.
pub fn expand_home_with(path: &str, home: &str) -> String {
  if path != "~" && !path.starts_with("~/") {
    return path.to_string();
  }
  format!("{home}{}", &path[1..])
}

pub fn home_dir() -> Option<PathBuf> {
  std::env::var_os("HOME")
    .or_else(|| std::env::var_os("USERPROFILE"))
    .map(PathBuf::from)
}

/// Equivalent of Node's `path.resolve(base, ...segments)`: an absolute segment
/// discards everything before it, then the result is normalised lexically.
pub fn resolve_from(base: &Path, segments: &[&str]) -> PathBuf {
  let mut acc = base.to_path_buf();
  for seg in segments {
    if seg.is_empty() {
      continue;
    }
    // PathBuf::push already replaces the accumulator when the pushed path is
    // absolute, which is exactly what path.resolve does.
    acc.push(seg);
  }
  normalize(&acc)
}

/// Equivalent of Node's single-argument `path.resolve(p)`: make absolute
/// against `cwd`, then normalise.
pub fn resolve(cwd: &Path, path: &str) -> PathBuf {
  resolve_from(cwd, &[path])
}

/// Resolves `.` and `..` without consulting the filesystem. At the filesystem
/// root, `..` is a no-op, as in Node.
pub fn normalize(path: &Path) -> PathBuf {
  let mut out = PathBuf::new();
  let mut depth = 0usize;

  for comp in path.components() {
    match comp {
      Component::Prefix(p) => out.push(p.as_os_str()),
      Component::RootDir => out.push(Component::RootDir.as_os_str()),
      Component::CurDir => {}
      Component::ParentDir => {
        if depth > 0 {
          out.pop();
          depth -= 1;
        }
      }
      Component::Normal(c) => {
        out.push(c);
        depth += 1;
      }
    }
  }

  if out.as_os_str().is_empty() {
    out.push(Component::CurDir.as_os_str());
  }
  out
}

/// The parent of `dir`, or `None` at the filesystem root — where Node's
/// `resolve(dir, '..')` returns `dir` itself rather than looping.
pub fn parent_of(dir: &Path) -> Option<PathBuf> {
  let parent = resolve_from(dir, &[".."]);
  if parent == dir {
    None
  } else {
    Some(parent)
  }
}

/// True when `candidate` is strictly inside `root`.
///
/// This is the string-prefix test the TypeScript used
/// (`resolved.startsWith(resolve(dir) + sep)`), kept verbatim rather than
/// swapped for `Path::starts_with`, which compares whole components and would
/// accept `candidate == root`.
pub fn is_inside(root: &Path, candidate: &Path) -> bool {
  let mut prefix = root.to_string_lossy().into_owned();
  if !prefix.ends_with(std::path::MAIN_SEPARATOR) {
    prefix.push(std::path::MAIN_SEPARATOR);
  }
  candidate.to_string_lossy().starts_with(&prefix)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn normalizes_dot_and_dotdot_lexically() {
    assert_eq!(normalize(Path::new("/a/b/../c")), Path::new("/a/c"));
    assert_eq!(normalize(Path::new("/a/./b")), Path::new("/a/b"));
    assert_eq!(normalize(Path::new("/a/b/c/../../d")), Path::new("/a/d"));
  }

  #[test]
  fn dotdot_at_the_root_is_a_no_op() {
    assert_eq!(normalize(Path::new("/..")), Path::new("/"));
    assert_eq!(normalize(Path::new("/../../..")), Path::new("/"));
  }

  #[test]
  fn an_absolute_segment_discards_the_base() {
    // Matches path.resolve('/manga', '/etc/passwd') === '/etc/passwd'.
    assert_eq!(
      resolve_from(Path::new("/manga"), &["/etc/passwd"]),
      Path::new("/etc/passwd")
    );
  }

  #[test]
  fn joins_and_normalizes_multiple_segments() {
    assert_eq!(
      resolve_from(Path::new("/manga"), &["One Piece", "ch01", "page01.png"]),
      Path::new("/manga/One Piece/ch01/page01.png")
    );
    assert_eq!(
      resolve_from(Path::new("/manga"), &["a", "..", "b"]),
      Path::new("/manga/b")
    );
    assert_eq!(
      resolve_from(Path::new("/manga"), &["", "a"]),
      Path::new("/manga/a")
    );
  }

  #[test]
  fn is_inside_requires_being_strictly_below_the_root() {
    let root = Path::new("/manga");
    assert!(is_inside(root, Path::new("/manga/One Piece")));
    assert!(is_inside(root, Path::new("/manga/a/b/c.png")));
    // The root itself is not "inside" it.
    assert!(!is_inside(root, Path::new("/manga")));
    // A sibling directory sharing a name prefix must not pass.
    assert!(!is_inside(root, Path::new("/manga-other/x")));
    assert!(!is_inside(root, Path::new("/etc/passwd")));
  }

  #[test]
  fn traversal_out_of_the_root_is_caught_after_normalization() {
    let root = Path::new("/manga");
    let escaped = resolve_from(root, &["../etc/passwd"]);
    assert_eq!(escaped, Path::new("/etc/passwd"));
    assert!(!is_inside(root, &escaped));
  }

  #[test]
  fn parent_is_none_at_the_filesystem_root() {
    assert_eq!(
      parent_of(Path::new("/a/b")).as_deref(),
      Some(Path::new("/a"))
    );
    assert_eq!(parent_of(Path::new("/a")).as_deref(), Some(Path::new("/")));
    assert_eq!(parent_of(Path::new("/")), None);
  }

  #[test]
  fn expand_home_only_expands_a_leading_tilde() {
    let home = "/home/tester";
    assert_eq!(expand_home_with("~", home), "/home/tester");
    assert_eq!(expand_home_with("~/Manga", home), "/home/tester/Manga");
    assert_eq!(expand_home_with("~notme/Manga", home), "~notme/Manga");
    assert_eq!(expand_home_with("/absolute/Manga", home), "/absolute/Manga");
    assert_eq!(expand_home_with("relative/Manga", home), "relative/Manga");
  }
}
