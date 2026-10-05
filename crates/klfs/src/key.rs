//! Secrets: random tokens, and files only their owner can read.

use std::fs;
use std::io;
use std::path::Path;

/// `bytes` of randomness from the OS, as hex: twice as many characters.
pub fn random_hex(bytes: usize) -> String {
  let mut buf = vec![0u8; bytes];
  getrandom::fill(&mut buf).expect("the OS has no random source");
  buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Bytes of randomness in an access key; it's hex, so twice as many characters.
const KEY_BYTES: usize = 16;

/// The key stored at `path`, created on first use.
pub fn access_key(path: &Path) -> io::Result<String> {
  if let Ok(raw) = fs::read_to_string(path) {
    let key = raw.trim();
    if !key.is_empty() {
      return Ok(key.to_string());
    }
  }
  let key = random_hex(KEY_BYTES);
  write_private(path, &format!("{key}\n"))?;
  Ok(key)
}

/// Writes a file only its owner can read, where the OS has such a thing.
pub fn write_private(path: &Path, contents: &str) -> io::Result<()> {
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
  fn random_hex_is_hex_of_the_given_length_and_differs_each_time() {
    let first = random_hex(16);
    assert_eq!(first.len(), 32);
    assert!(first.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_ne!(random_hex(16), first);
  }

  #[cfg(unix)]
  #[test]
  fn a_private_file_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("secret");
    write_private(&path, "x").unwrap();
    let mode = fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
  }
}
