//! `encodeURIComponent` / `decodeURIComponent` equivalents.
//!
//! Slugs travel between the server and the browser, and the browser builds
//! request paths with `encodeURIComponent`, so the two sides have to agree on
//! exactly which characters are escaped.

/// Characters `encodeURIComponent` leaves alone: `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
fn is_unreserved(b: u8) -> bool {
  b.is_ascii_alphanumeric()
    || matches!(
      b,
      b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
    )
}

pub fn encode_uri_component(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  for &b in s.as_bytes() {
    if is_unreserved(b) {
      out.push(b as char);
    } else {
      const HEX: &[u8; 16] = b"0123456789ABCDEF";
      out.push('%');
      out.push(char::from(HEX[usize::from(b >> 4)]));
      out.push(char::from(HEX[usize::from(b & 0xF)]));
    }
  }
  out
}

/// Returns `None` for a malformed escape or invalid UTF-8, where
/// `decodeURIComponent` would throw a `URIError`.
pub fn decode_uri_component(s: &str) -> Option<String> {
  let bytes = s.as_bytes();
  let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' {
      // Two hex digits exactly: `from_str_radix` alone would also take a
      // sign (`%+F`), which `decodeURIComponent` rejects.
      let hex = bytes.get(i + 1..i + 3)?;
      if !hex.iter().all(u8::is_ascii_hexdigit) {
        return None;
      }
      let hex = std::str::from_utf8(hex).ok()?;
      out.push(u8::from_str_radix(hex, 16).ok()?);
      i += 3;
    } else {
      out.push(bytes[i]);
      i += 1;
    }
  }
  String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
  use super::{decode_uri_component, encode_uri_component};

  #[test]
  fn encodes_like_encode_uri_component() {
    assert_eq!(encode_uri_component("One Piece"), "One%20Piece");
    assert_eq!(encode_uri_component("Berserk.cbz"), "Berserk.cbz");
    assert_eq!(encode_uri_component("a/b"), "a%2Fb");
    assert_eq!(encode_uri_component("100%"), "100%25");
    assert_eq!(encode_uri_component("ch-01_v2!~*'()"), "ch-01_v2!~*'()");
    assert_eq!(encode_uri_component("漫画"), "%E6%BC%AB%E7%94%BB");
  }

  #[test]
  fn roundtrips() {
    for name in [
      "One Piece",
      "漫画/第1話/ページ01.png",
      "100% Cotton",
      "a+b&c=d",
    ] {
      let encoded = encode_uri_component(name);
      assert_eq!(decode_uri_component(&encoded).as_deref(), Some(name));
    }
  }

  #[test]
  fn plus_is_not_a_space() {
    // encodeURIComponent escapes `+`, and decodeURIComponent does not treat a
    // literal `+` as a space (unlike form-encoding).
    assert_eq!(encode_uri_component("a+b"), "a%2Bb");
    assert_eq!(decode_uri_component("a+b").as_deref(), Some("a+b"));
  }

  #[test]
  fn rejects_malformed_escapes() {
    assert_eq!(decode_uri_component("%"), None);
    assert_eq!(decode_uri_component("%2"), None);
    assert_eq!(decode_uri_component("%zz"), None);
    // A sign, which `from_str_radix` would take but `decodeURIComponent` throws on.
    assert_eq!(decode_uri_component("%+F"), None);
    assert_eq!(decode_uri_component("%-1"), None);
    // A valid escape that is not valid UTF-8.
    assert_eq!(decode_uri_component("%FF"), None);
  }
}
