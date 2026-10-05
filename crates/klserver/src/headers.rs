//! Security headers on every response.
//!
//! Values from the OWASP HTTP Headers cheat sheet, except HSTS, which leaves
//! out `includeSubDomains` and `preload`: the server is often one subdomain of
//! a domain it doesn't own.

use std::net::{IpAddr, SocketAddr};

use axum::{
  body::Body,
  extract::{ConnectInfo, Request, State},
  http::{header, HeaderValue, StatusCode},
  middleware::Next,
  response::{IntoResponse, Response},
};
use sha2::{Digest, Sha256};

use crate::routes::SharedState;

const HSTS: &str = "max-age=63072000";
/// The largest page the CSP's script hashes are worked out for; the SPA's
/// `index.html` is a few KiB.
const MAX_PAGE: usize = 1 << 20;

pub async fn security_headers(
  State(state): State<SharedState>,
  req: Request,
  next: Next,
) -> Response {
  // Always there when served; an unknown peer is trusted with nothing.
  let peer = req
    .extensions()
    .get::<ConnectInfo<SocketAddr>>()
    .map_or(IpAddr::from([0, 0, 0, 0]), |ConnectInfo(peer)| peer.ip());
  let https = state.auth.https(peer, req.headers());
  let mut res = next.run(req).await;
  let headers = res.headers_mut();
  headers.insert(
    header::X_CONTENT_TYPE_OPTIONS,
    HeaderValue::from_static("nosniff"),
  );
  headers.insert(
    header::REFERRER_POLICY,
    HeaderValue::from_static("strict-origin-when-cross-origin"),
  );
  if https {
    headers.insert(
      header::STRICT_TRANSPORT_SECURITY,
      HeaderValue::from_static(HSTS),
    );
  }
  // Only a full page: a 304 leaves the cached page's CSP in place, and a
  // range of one has scripts cut in half.
  if res.status() != StatusCode::OK || !is_html(&res) {
    return res;
  }
  let (mut parts, body) = res.into_parts();
  let Ok(page) = axum::body::to_bytes(body, MAX_PAGE).await else {
    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
  };
  match HeaderValue::from_str(&csp(&page)) {
    Ok(value) => {
      parts.headers.insert(header::CONTENT_SECURITY_POLICY, value);
      Response::from_parts(parts, Body::from(page))
    }
    Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
  }
}

fn is_html(res: &Response) -> bool {
  res
    .headers()
    .get(header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .is_some_and(|v| v.starts_with("text/html"))
}

/// The SPA's policy, allowing the inline scripts `page` has by their hashes:
/// SvelteKit's bootstrap and the theme script in `app.html`.
///
/// - `'wasm-unsafe-eval'`: the archive reader is wasm.
/// - `style-src 'unsafe-inline'`: `app.html`'s `<style>` and `style`
///   attributes.
/// - `connect-src` and `img-src` take any `http:`/`https:`: the settings page
///   can point the SPA at another server, whose covers and pages are still
///   plain `<img>` URLs.
fn csp(page: &[u8]) -> String {
  let hashes: String = inline_scripts(page)
    .map(|script| format!(" 'sha256-{}'", base64(&Sha256::digest(script))))
    .collect();
  format!(
    "default-src 'self'; \
     script-src 'self' 'wasm-unsafe-eval'{hashes}; \
     style-src 'self' 'unsafe-inline'; \
     img-src 'self' blob: data: http: https:; \
     connect-src 'self' http: https:; \
     object-src 'none'; \
     base-uri 'none'; \
     form-action 'self'; \
     frame-ancestors 'none'"
  )
}

/// The contents of every `<script>` without a `src`, byte for byte, as the
/// browser hashes them.
fn inline_scripts(page: &[u8]) -> impl Iterator<Item = &[u8]> {
  // Lowercasing ASCII keeps every byte where it was.
  let lower = page.to_ascii_lowercase();
  let mut at = 0;
  std::iter::from_fn(move || loop {
    let open = at + find(&lower[at..], b"<script")?;
    let tag_end = open + find(&lower[open..], b">")?;
    let body = tag_end + 1;
    let close = body + find(&lower[body..], b"</script")?;
    at = close;
    if find(&lower[open..tag_end], b"src=").is_none() {
      return Some(&page[body..close]);
    }
  })
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
  haystack.windows(needle.len()).position(|w| w == needle)
}

/// Standard base64 with padding, as CSP hashes are written.
fn base64(bytes: &[u8]) -> String {
  const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
  for chunk in bytes.chunks(3) {
    let n = chunk
      .iter()
      .enumerate()
      .fold(0u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
    for i in 0..4 {
      if i <= chunk.len() {
        out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
      } else {
        out.push('=');
      }
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn base64_pads_like_the_standard() {
    assert_eq!(base64(b""), "");
    assert_eq!(base64(b"f"), "Zg==");
    assert_eq!(base64(b"fo"), "Zm8=");
    assert_eq!(base64(b"foo"), "Zm9v");
    // `openssl dgst -sha256 -binary | base64` of the empty string.
    assert_eq!(
      base64(&Sha256::digest(b"")),
      "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    );
  }

  #[test]
  fn only_inline_scripts_are_hashed() {
    let page = b"<script src=\"/a.js\"></script>\
      <SCRIPT type=\"module\">alert(1)</SCRIPT>\
      <script>\n  b()\n</script>";
    let scripts: Vec<&[u8]> = inline_scripts(page).collect();
    assert_eq!(scripts, [&b"alert(1)"[..], b"\n  b()\n"]);
  }

  #[test]
  fn the_policy_names_each_inline_script_by_its_hash() {
    let policy = csp(b"<script>alert(1)</script><script src=\"/x.js\"></script>");
    assert!(
      policy.contains(
        "script-src 'self' 'wasm-unsafe-eval' 'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI=';"
      ),
      "{policy}"
    );
    assert!(policy.ends_with("frame-ancestors 'none'"), "{policy}");
  }

  #[test]
  fn an_unclosed_script_ends_the_list() {
    assert_eq!(inline_scripts(b"<script>a()").count(), 0);
    assert_eq!(inline_scripts(b"<script").count(), 0);
  }
}
