//! The access key other devices need for `/api`.
//!
//! It travels as the `key` query parameter: page images are plain
//! `<img src>` URLs, which can't carry a header, and cookies don't cross
//! origins over plain HTTP.

use std::io;
use std::net::SocketAddr;
use std::path::Path;

use axum::{
  extract::{ConnectInfo, Request, State},
  middleware::Next,
  response::Response,
};

use crate::routes::{is_local_client, is_local_page, unauthorized, SharedState};

#[derive(Debug, PartialEq, Eq)]
pub enum KeySource {
  /// `KL_KEY`, from the desktop app, which shows the key itself.
  Env,
  /// The key file, which only the banner can tell the user about.
  File,
}

/// `KL_KEY` if set, otherwise the key file at `path`, created on first run.
pub fn load_key(env_key: Option<String>, path: &Path) -> io::Result<(String, KeySource)> {
  match env_key.filter(|k| !k.is_empty()) {
    Some(key) => Ok((key, KeySource::Env)),
    None => Ok((klfs::access_key(path)?, KeySource::File)),
  }
}

/// Keys are hex, so the parameter needs no decoding.
fn query_key(req: &Request) -> Option<&str> {
  req
    .uri()
    .query()?
    .split('&')
    .find_map(|pair| pair.strip_prefix("key="))
}

/// Takes the same time wherever the inputs differ, so timing doesn't leak the
/// key a character at a time.
fn same_key(given: &str, key: &str) -> bool {
  given.len() == key.len()
    && given
      .bytes()
      .zip(key.bytes())
      .fold(0u8, |acc, (a, b)| acc | (a ^ b))
      == 0
}

/// Lets through a request with the key, or one from our own page on this
/// machine: the user is at the host.
pub async fn require_key(
  State(state): State<SharedState>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  req: Request,
  next: Next,
) -> Response {
  let keyed = query_key(&req).is_some_and(|k| same_key(k, &state.key));
  if keyed || (is_local_client(addr) && is_local_page(req.headers())) {
    next.run(req).await
  } else {
    unauthorized()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_env_key_wins_and_nothing_is_written() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("konigslibrary.key");
    let got = load_key(Some("fromenv".into()), &path).unwrap();
    assert_eq!(got, ("fromenv".to_string(), KeySource::Env));
    assert!(!path.exists());
  }

  #[test]
  fn without_the_env_key_the_file_is_used() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("konigslibrary.key");
    let (first, source) = load_key(Some(String::new()), &path).unwrap();
    assert_eq!(source, KeySource::File);
    assert_eq!(load_key(None, &path).unwrap().0, first);
  }

  #[test]
  fn keys_compare_exactly() {
    assert!(same_key("abc123", "abc123"));
    assert!(!same_key("abc124", "abc123"));
    assert!(!same_key("abc12", "abc123"));
    assert!(!same_key("", "abc123"));
  }
}
