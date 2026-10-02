//! Filename classification, shared by the browser (through klwasm), the
//! server and the app, so all agree on what counts as a page and what counts
//! as an archive.

const IMAGE_EXTS: [&str; 7] = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp"];
const ZIP_EXTS: [&str; 2] = ["zip", "cbz"];

/// The extension of `name`, as written, without the dot. `None` when there is
/// no dot in the final path segment.
fn extension(name: &str) -> Option<&str> {
  let last = name.rsplit('/').next().unwrap_or(name);
  let (_, ext) = last.rsplit_once('.')?;
  (!ext.is_empty()).then_some(ext)
}

/// Whether `ext` is one of `exts`, ignoring case. Compared in place: these run
/// for every entry of every archive listed, so nothing is allocated.
fn is_one_of(ext: &str, exts: &[&str]) -> bool {
  exts.iter().any(|e| ext.eq_ignore_ascii_case(e))
}

pub fn is_image_name(name: &str) -> bool {
  extension(name).is_some_and(|ext| is_one_of(ext, &IMAGE_EXTS))
}

pub fn is_zip_name(name: &str) -> bool {
  extension(name).is_some_and(|ext| is_one_of(ext, &ZIP_EXTS))
}

/// The lowercased extension including the leading dot, for Content-Type
/// mapping. Equivalent to Node's `extname(p).toLowerCase()`.
pub fn ext_with_dot(name: &str) -> String {
  match extension(name) {
    Some(ext) => format!(".{}", ext.to_ascii_lowercase()),
    None => String::new(),
  }
}

/// Drops a trailing `.zip`/`.cbz`, for display names. The slug keeps it.
pub fn strip_zip_ext(name: &str) -> &str {
  match name.rsplit_once('.') {
    Some((stem, ext)) if is_one_of(ext, &ZIP_EXTS) => stem,
    _ => name,
  }
}

/// Maps an extension (with dot) to a Content-Type, defaulting to
/// `application/octet-stream` for anything unrecognised.
pub fn content_type(ext_with_dot: &str) -> &'static str {
  match ext_with_dot {
    ".jpg" | ".jpeg" => "image/jpeg",
    ".png" => "image/png",
    ".gif" => "image/gif",
    ".webp" => "image/webp",
    ".avif" => "image/avif",
    ".bmp" => "image/bmp",
    _ => "application/octet-stream",
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn recognises_image_extensions_case_insensitively() {
    for name in [
      "page01.png",
      "page01.PNG",
      "page01.jpg",
      "page01.jpeg",
      "page01.JPEG",
      "a/b/page01.gif",
      "page.webp",
      "page.avif",
      "page.bmp",
    ] {
      assert!(is_image_name(name), "{name} should be an image");
    }
  }

  #[test]
  fn rejects_non_image_names() {
    for name in [
      "notes.txt",
      "page01",
      "archive.zip",
      "a.png.txt",
      "",
      ".",
      "trailing.",
    ] {
      assert!(!is_image_name(name), "{name} should not be an image");
    }
  }

  #[test]
  fn a_dot_in_a_parent_directory_does_not_count() {
    // Only the final segment's extension matters.
    assert!(!is_image_name("v1.0/chapter"));
    assert!(is_image_name("v1.0/page01.png"));
  }

  #[test]
  fn recognises_zip_extensions() {
    assert!(is_zip_name("manga.zip"));
    assert!(is_zip_name("manga.CBZ"));
    assert!(!is_zip_name("manga.rar"));
    assert!(!is_zip_name("manga"));
  }

  #[test]
  fn strips_zip_extension_for_display_only() {
    assert_eq!(strip_zip_ext("Berserk.cbz"), "Berserk");
    assert_eq!(strip_zip_ext("Berserk.ZIP"), "Berserk");
    assert_eq!(strip_zip_ext("Berserk"), "Berserk");
    assert_eq!(strip_zip_ext("Vol.1.cbz"), "Vol.1");
    // Not an archive extension, so nothing is stripped.
    assert_eq!(strip_zip_ext("Berserk.rar"), "Berserk.rar");
  }

  #[test]
  fn maps_extensions_to_content_types() {
    assert_eq!(content_type(".jpg"), "image/jpeg");
    assert_eq!(content_type(".jpeg"), "image/jpeg");
    assert_eq!(content_type(".png"), "image/png");
    assert_eq!(content_type(".gif"), "image/gif");
    assert_eq!(content_type(".webp"), "image/webp");
    assert_eq!(content_type(".avif"), "image/avif");
    assert_eq!(content_type(".bmp"), "image/bmp");
    assert_eq!(content_type(".txt"), "application/octet-stream");
    assert_eq!(content_type(""), "application/octet-stream");
  }

  #[test]
  fn ext_with_dot_lowercases() {
    assert_eq!(ext_with_dot("page01.PNG"), ".png");
    assert_eq!(ext_with_dot("a/b/page01.JpEg"), ".jpeg");
    assert_eq!(ext_with_dot("noext"), "");
  }
}
