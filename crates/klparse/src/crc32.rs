const POLY: u32 = 0xedb8_8320;

fn table() -> &'static [u32; 256] {
  use std::sync::OnceLock;
  static TABLE: OnceLock<[u32; 256]> = OnceLock::new();
  TABLE.get_or_init(|| {
    let mut t = [0u32; 256];
    for (i, slot) in t.iter_mut().enumerate() {
      let mut c = i as u32;
      for _ in 0..8 {
        c = if c & 1 != 0 { POLY ^ (c >> 1) } else { c >> 1 };
      }
      *slot = c;
    }
    t
  })
}

pub fn crc32(data: &[u8]) -> u32 {
  let t = table();
  let mut crc: u32 = 0xffff_ffff;
  for &b in data {
    crc = t[((crc ^ b as u32) & 0xff) as usize] ^ (crc >> 8);
  }
  crc ^ 0xffff_ffff
}

#[cfg(test)]
mod tests {
  use super::crc32;

  #[test]
  fn matches_known_vectors() {
    assert_eq!(crc32(b""), 0x0000_0000);
    assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    assert_eq!(crc32(b"hello world"), 0x0d4a_1185);
  }
}
