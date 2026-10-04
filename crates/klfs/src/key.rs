//! The server's access key, kept in a file so pairings survive restarts.

use std::fs;
use std::io;
use std::path::Path;

/// Bytes of randomness in a key; it's hex, so twice as many characters.
const KEY_BYTES: usize = 16;

/// The key stored at `path`, created on first use.
pub fn access_key(path: &Path) -> io::Result<String> {
  if let Ok(raw) = fs::read_to_string(path) {
    let key = raw.trim();
    if !key.is_empty() {
      return Ok(key.to_string());
    }
  }
  let mut bytes = [0u8; KEY_BYTES];
  getrandom::fill(&mut bytes).map_err(io::Error::other)?;
  let key: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
  write_private(path, &format!("{key}\n"))?;
  Ok(key)
}

/// Writes a file only its owner can read, where the OS has such a thing.
fn write_private(path: &Path, contents: &str) -> io::Result<()> {
  #[cfg(unix)]
  {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
      .write(true)
      .create(true)
      .truncate(true)
      .mode(0o600)
      .open(path)?
      .write_all(contents.as_bytes())
  }
  #[cfg(not(unix))]
  {
    fs::write(path, contents)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_key_is_created_once_and_then_reused() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("konigslibrary.key");
    let first = access_key(&path).unwrap();
    assert_eq!(first.len(), KEY_BYTES * 2);
    assert!(first.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_eq!(access_key(&path).unwrap(), first);
  }

  #[test]
  fn an_empty_key_file_gets_a_new_key() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("konigslibrary.key");
    fs::write(&path, "\n").unwrap();
    assert_eq!(access_key(&path).unwrap().len(), KEY_BYTES * 2);
  }

  #[cfg(unix)]
  #[test]
  fn the_key_file_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("konigslibrary.key");
    access_key(&path).unwrap();
    let mode = fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
  }
}
