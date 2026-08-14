//! ZIP/CBZ reading, including ZIP64.
//!
//! Port of the former `src/lib/zip/parse.ts` + `src/lib/zip/index.ts` (browser)
//! and `src/lib/server/zip-node.ts` (server), which duplicated the byte-range
//! plumbing around a shared `parseCentralDirectory`. Here the plumbing is shared
//! too, behind the [`ReadAt`] trait: the server reads from a file handle, the
//! browser reads from `File.slice`.
//!
//! Nothing in this module loads a whole archive into memory. That matters for
//! the browser: opening a 2GB CBZ still only reads the tail, the central
//! directory, and the bytes of the page being displayed.

use std::fmt;

use crate::crc32::crc32;

pub const EOCD_SIG: u32 = 0x0605_4b50;
pub const ZIP64_EOCD_LOC_SIG: u32 = 0x0706_4b50;
pub const ZIP64_EOCD_SIG: u32 = 0x0606_4b50;
pub const CD_SIG: u32 = 0x0201_4b50;
pub const LOCAL_SIG: u32 = 0x0403_4b50;
pub const ZIP64_EXTRA_ID: u16 = 0x0001;

/// A 32-bit field set to this means "the real value is in the ZIP64 extra field".
const ZIP64_SENTINEL_32: u32 = 0xffff_ffff;

/// How far back from EOF to search for the end-of-central-directory record.
/// 64KiB is the largest possible archive comment, so the record cannot be
/// further back than this.
pub const TAIL_SIZE: u64 = 65536;

/// 8MiB. A central directory larger than this is not a manga archive.
pub const MAX_CD_BYTES: u64 = 8 * 1024 * 1024;

/// 64MiB per entry — enough for any manga page, blocks zip bombs.
pub const MAX_UNCOMPRESSED_BYTES: u64 = 64 * 1024 * 1024;

pub const METHOD_STORE: u16 = 0;
pub const METHOD_DEFLATE: u16 = 8;

/// Serialised as camelCase so the shape crossing the wasm boundary matches the
/// `ZipEntry` the TypeScript code already used.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipEntry {
  pub name: String,
  pub compressed_size: u64,
  pub uncompressed_size: u64,
  pub compression_method: u16,
  pub local_header_offset: u64,
  pub crc32: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZipError {
  NotAZip,
  CentralDirectoryTooLarge(u64),
  InvalidLocalHeader,
  UnsupportedCompressionMethod(u16),
  EntryTooLarge {
    name: String,
    size: u64,
  },
  Crc32Mismatch {
    name: String,
    expected: u32,
    actual: u32,
  },
  Inflate(String),
  Io(String),
}

impl fmt::Display for ZipError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      // Wording kept identical to the TypeScript implementation: the browser
      // surfaces these strings to the user when an upload fails to open.
      Self::NotAZip => write!(f, "Not a valid ZIP file"),
      Self::CentralDirectoryTooLarge(n) => {
        write!(f, "Central directory size ({n}) exceeds limit")
      }
      Self::InvalidLocalHeader => write!(f, "Invalid local file header"),
      Self::UnsupportedCompressionMethod(m) => write!(f, "Unsupported compression method: {m}"),
      Self::EntryTooLarge { name, size } => {
        write!(
          f,
          "Entry \"{name}\" uncompressed size ({size}) exceeds limit"
        )
      }
      Self::Crc32Mismatch {
        name,
        expected,
        actual,
      } => {
        write!(
          f,
          "CRC32 mismatch for \"{name}\": expected {expected:x}, got {actual:x}"
        )
      }
      Self::Inflate(e) => write!(f, "Failed to inflate entry: {e}"),
      Self::Io(e) => write!(f, "{e}"),
    }
  }
}

impl std::error::Error for ZipError {}

pub type Result<T> = std::result::Result<T, ZipError>;

/// Random access over an archive, without requiring it all in memory.
///
/// A short read is not an error: implementations return whatever was available,
/// and every parser here is bounds-checked, so a truncated archive surfaces as
/// [`ZipError::NotAZip`] rather than a panic.
pub trait ReadAt {
  fn size(&self) -> u64;
  fn read_at(&self, offset: u64, len: usize) -> Result<Vec<u8>>;
}

impl ReadAt for [u8] {
  fn size(&self) -> u64 {
    self.len() as u64
  }
  fn read_at(&self, offset: u64, len: usize) -> Result<Vec<u8>> {
    let start = (offset as usize).min(self.len());
    let end = start.saturating_add(len).min(self.len());
    Ok(self[start..end].to_vec())
  }
}

impl ReadAt for Vec<u8> {
  fn size(&self) -> u64 {
    self.as_slice().size()
  }
  fn read_at(&self, offset: u64, len: usize) -> Result<Vec<u8>> {
    self.as_slice().read_at(offset, len)
  }
}

// --- little-endian readers, all bounds-checked ---

fn u16le(b: &[u8], off: usize) -> Option<u16> {
  let s = b.get(off..off + 2)?;
  Some(u16::from_le_bytes([s[0], s[1]]))
}

fn u32le(b: &[u8], off: usize) -> Option<u32> {
  let s = b.get(off..off + 4)?;
  Some(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn u64le(b: &[u8], off: usize) -> Option<u64> {
  let s = b.get(off..off + 8)?;
  Some(u64::from_le_bytes([
    s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7],
  ]))
}

/// Where the central directory lives, as read from the end-of-central-directory
/// record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EocdInfo {
  pub cd_offset: u64,
  pub cd_size: u64,
  /// Set when the EOCD used ZIP64 sentinels and a ZIP64 locator was present.
  /// The caller must read 56 bytes at this absolute file offset and feed them
  /// to [`parse_zip64_eocd`] to get the real offset and size.
  pub zip64_eocd_offset: Option<u64>,
}

/// Scans backwards through the last [`TAIL_SIZE`] bytes of the archive for the
/// EOCD signature. `tail_start` is the absolute file offset `tail` begins at,
/// needed to turn the ZIP64 locator's position into an absolute offset.
pub fn find_eocd(tail: &[u8]) -> Result<EocdInfo> {
  let mut eocd_offset = None;
  // 22 is the size of a comment-less EOCD record; anything shorter cannot hold one.
  if tail.len() >= 22 {
    for i in (0..=tail.len() - 22).rev() {
      if u32le(tail, i) == Some(EOCD_SIG) {
        eocd_offset = Some(i);
        break;
      }
    }
  }
  let eocd_offset = eocd_offset.ok_or(ZipError::NotAZip)?;

  let cd_size = u32le(tail, eocd_offset + 12).ok_or(ZipError::NotAZip)? as u64;
  let cd_offset = u32le(tail, eocd_offset + 16).ok_or(ZipError::NotAZip)? as u64;

  let mut zip64_eocd_offset = None;
  if cd_offset == ZIP64_SENTINEL_32 as u64 || cd_size == ZIP64_SENTINEL_32 as u64 {
    // The ZIP64 locator sits immediately before the EOCD record.
    if let Some(loc) = eocd_offset.checked_sub(20) {
      if u32le(tail, loc) == Some(ZIP64_EOCD_LOC_SIG) {
        zip64_eocd_offset = u64le(tail, loc + 8);
      }
    }
  }

  Ok(EocdInfo {
    cd_offset,
    cd_size,
    zip64_eocd_offset,
  })
}

/// Reads `(cd_size, cd_offset)` out of a ZIP64 end-of-central-directory record.
/// Returns `None` if the signature does not match, mirroring the TypeScript
/// behaviour of falling back to the 32-bit values.
pub fn parse_zip64_eocd(buf: &[u8]) -> Option<(u64, u64)> {
  if u32le(buf, 0)? != ZIP64_EOCD_SIG {
    return None;
  }
  Some((u64le(buf, 40)?, u64le(buf, 48)?))
}

/// Walks the central directory, returning one entry per file record.
///
/// Directory records (names ending in `/`) and any name containing a `..`
/// segment are dropped: nothing downstream should ever be able to address a
/// path outside the archive's own tree.
pub fn parse_central_directory(cd: &[u8]) -> Vec<ZipEntry> {
  let mut entries = Vec::new();
  let mut pos = 0usize;

  while pos + 46 <= cd.len() {
    if u32le(cd, pos) != Some(CD_SIG) {
      break;
    }

    let Some(compression_method) = u16le(cd, pos + 10) else {
      break;
    };
    let Some(crc) = u32le(cd, pos + 16) else {
      break;
    };
    let Some(csize32) = u32le(cd, pos + 20) else {
      break;
    };
    let Some(usize32) = u32le(cd, pos + 24) else {
      break;
    };
    let Some(name_len) = u16le(cd, pos + 28).map(usize::from) else {
      break;
    };
    let Some(extra_len) = u16le(cd, pos + 30).map(usize::from) else {
      break;
    };
    let Some(comment_len) = u16le(cd, pos + 32).map(usize::from) else {
      break;
    };
    let Some(lho32) = u32le(cd, pos + 42) else {
      break;
    };

    let mut compressed_size = csize32 as u64;
    let mut uncompressed_size = usize32 as u64;
    let mut local_header_offset = lho32 as u64;

    if csize32 == ZIP64_SENTINEL_32 || usize32 == ZIP64_SENTINEL_32 || lho32 == ZIP64_SENTINEL_32 {
      // The ZIP64 extra record packs only the fields that were actually
      // sentinelled, in a fixed order, so each one has to be consumed
      // conditionally to keep the cursor aligned.
      let mut ex = pos + 46 + name_len;
      let ex_end = ex + extra_len;
      while ex + 4 <= ex_end.min(cd.len()) {
        let Some(id) = u16le(cd, ex) else { break };
        let Some(sz) = u16le(cd, ex + 2).map(usize::from) else {
          break;
        };
        if id == ZIP64_EXTRA_ID {
          let mut fp = ex + 4;
          if usize32 == ZIP64_SENTINEL_32 {
            let Some(v) = u64le(cd, fp) else { break };
            uncompressed_size = v;
            fp += 8;
          }
          if csize32 == ZIP64_SENTINEL_32 {
            let Some(v) = u64le(cd, fp) else { break };
            compressed_size = v;
            fp += 8;
          }
          if lho32 == ZIP64_SENTINEL_32 {
            let Some(v) = u64le(cd, fp) else { break };
            local_header_offset = v;
          }
          break;
        }
        ex += 4 + sz;
      }
    }

    let Some(name_bytes) = cd.get(pos + 46..pos + 46 + name_len) else {
      break;
    };
    let name = String::from_utf8_lossy(name_bytes).into_owned();

    if !name.ends_with('/') && !name.split('/').any(|s| s == "..") {
      entries.push(ZipEntry {
        name,
        compressed_size,
        uncompressed_size,
        compression_method,
        local_header_offset,
        crc32: crc,
      });
    }

    pos += 46 + name_len + extra_len + comment_len;
  }

  entries
}

/// Validates a 30-byte local file header and returns the offset of the entry's
/// data *relative to the start of that header*.
pub fn local_header_data_offset(lh: &[u8]) -> Result<u64> {
  if u32le(lh, 0) != Some(LOCAL_SIG) {
    return Err(ZipError::InvalidLocalHeader);
  }
  let name_len = u16le(lh, 26).ok_or(ZipError::InvalidLocalHeader)? as u64;
  let extra_len = u16le(lh, 28).ok_or(ZipError::InvalidLocalHeader)? as u64;
  Ok(30 + name_len + extra_len)
}

/// Rejects an entry whose declared uncompressed size is over the zip-bomb limit.
/// Checked before any bytes are read, so an inflate bomb never gets allocated.
pub fn check_entry_size(name: &str, uncompressed_size: u64) -> Result<()> {
  if uncompressed_size > MAX_UNCOMPRESSED_BYTES {
    return Err(ZipError::EntryTooLarge {
      name: name.to_string(),
      size: uncompressed_size,
    });
  }
  Ok(())
}

/// Decompresses one entry's raw bytes and verifies its CRC32.
///
/// A stored CRC of 0 means "not recorded" and skips the check, matching the
/// browser implementation.
pub fn decode_entry(
  raw: &[u8],
  compression_method: u16,
  expected_crc: u32,
  name: &str,
) -> Result<Vec<u8>> {
  let out = match compression_method {
    METHOD_STORE => raw.to_vec(),
    METHOD_DEFLATE => inflate_raw(raw)?,
    other => return Err(ZipError::UnsupportedCompressionMethod(other)),
  };

  if expected_crc != 0 {
    let actual = crc32(&out);
    if actual != expected_crc {
      return Err(ZipError::Crc32Mismatch {
        name: name.to_string(),
        expected: expected_crc,
        actual,
      });
    }
  }

  Ok(out)
}

fn inflate_raw(raw: &[u8]) -> Result<Vec<u8>> {
  use flate2::read::DeflateDecoder;
  use std::io::Read;

  let mut out = Vec::new();
  DeflateDecoder::new(raw)
    .read_to_end(&mut out)
    .map_err(|e| ZipError::Inflate(e.to_string()))?;
  Ok(out)
}

/// Reads an archive's central directory. Only the tail and the directory itself
/// are read, never the entry data.
pub fn index_zip<R: ReadAt + ?Sized>(r: &R) -> Result<Vec<ZipEntry>> {
  let file_size = r.size();
  let tail_size = file_size.min(TAIL_SIZE);
  let tail = r.read_at(file_size - tail_size, tail_size as usize)?;

  let mut info = find_eocd(&tail)?;
  if let Some(pos) = info.zip64_eocd_offset {
    let buf = r.read_at(pos, 56)?;
    if let Some((cd_size, cd_offset)) = parse_zip64_eocd(&buf) {
      info.cd_size = cd_size;
      info.cd_offset = cd_offset;
    }
  }

  if info.cd_size > MAX_CD_BYTES {
    return Err(ZipError::CentralDirectoryTooLarge(info.cd_size));
  }

  let cd = r.read_at(info.cd_offset, info.cd_size as usize)?;
  Ok(parse_central_directory(&cd))
}

/// Reads and decompresses a single entry.
pub fn extract_entry<R: ReadAt + ?Sized>(r: &R, entry: &ZipEntry) -> Result<Vec<u8>> {
  check_entry_size(&entry.name, entry.uncompressed_size)?;

  let lh = r.read_at(entry.local_header_offset, 30)?;
  let data_offset = local_header_data_offset(&lh)?;
  let raw = r.read_at(
    entry.local_header_offset + data_offset,
    entry.compressed_size as usize,
  )?;

  decode_entry(&raw, entry.compression_method, entry.crc32, &entry.name)
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::fixture::{deflated, stored, zip64_stored, ArchiveOptions, Fixture};

  // --- ported from src/lib/zip/zip.test.ts ---

  #[test]
  fn indexes_a_single_stored_file() {
    let data = b"hello world";
    let zip = Fixture::new().entry(stored("hello.txt", data)).build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "hello.txt");
    assert_eq!(entries[0].uncompressed_size, data.len() as u64);
    assert_eq!(entries[0].compression_method, METHOD_STORE);
  }

  #[test]
  fn extracts_stored_data_matching_the_original() {
    let data = b"konigslibrary test data";
    let zip = Fixture::new().entry(stored("file.bin", data)).build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(extract_entry(&zip, &entries[0]).unwrap(), data);
  }

  #[test]
  fn handles_multiple_files_preserving_order_and_names() {
    let files: Vec<(&str, Vec<u8>)> = vec![
      ("chapter1/page01.png", pseudo_random(1024, 1)),
      ("chapter1/page02.png", pseudo_random(2048, 2)),
      ("chapter2/page01.png", pseudo_random(512, 3)),
    ];
    let mut fx = Fixture::new();
    for (name, data) in &files {
      fx = fx.entry(stored(name, data));
    }
    let zip = fx.build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries.len(), 3);
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, files.iter().map(|(n, _)| *n).collect::<Vec<_>>());

    for (entry, (_, data)) in entries.iter().zip(files.iter()) {
      assert_eq!(&extract_entry(&zip, entry).unwrap(), data);
    }
  }

  #[test]
  fn handles_an_empty_file_entry() {
    let zip = Fixture::new().entry(stored("empty.txt", b"")).build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].uncompressed_size, 0);
    assert!(extract_entry(&zip, &entries[0]).unwrap().is_empty());
  }

  #[test]
  fn preserves_unicode_filenames() {
    let name = "漫画/第1話/ページ01.png";
    let zip = Fixture::new()
      .entry(stored(name, &pseudo_random(64, 4)))
      .build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries[0].name, name);
  }

  #[test]
  fn rejects_a_non_zip_file() {
    let garbage = b"this is not a zip".to_vec();
    assert_eq!(index_zip(&garbage).unwrap_err(), ZipError::NotAZip);
    assert_eq!(
      index_zip(&garbage).unwrap_err().to_string(),
      "Not a valid ZIP file"
    );
  }

  #[test]
  fn rejects_an_empty_file() {
    let empty: Vec<u8> = Vec::new();
    assert_eq!(index_zip(&empty).unwrap_err(), ZipError::NotAZip);
  }

  #[test]
  fn rejects_unsupported_compression_method_on_extract() {
    let zip = Fixture::new().entry(stored("test.bin", b"test")).build();
    let mut entry = index_zip(&zip).unwrap().remove(0);
    entry.compression_method = 99;

    let err = extract_entry(&zip, &entry).unwrap_err();
    assert_eq!(err, ZipError::UnsupportedCompressionMethod(99));
    assert_eq!(err.to_string(), "Unsupported compression method: 99");
  }

  // --- ZIP64: never exercised by a test before, the TS fixture builder
  // (src/lib/zip/write.ts) could only emit stored, non-zip64 entries ---

  #[test]
  fn reads_sizes_and_offset_from_a_zip64_extra_field() {
    // All three fields sentinelled, so the whole ZIP64 extra record is consumed.
    let data = b"zip64 entry payload";
    let zip = Fixture::new()
      .entry(zip64_stored("z64/page01.png", data))
      .build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "z64/page01.png");
    assert_eq!(entries[0].uncompressed_size, data.len() as u64);
    assert_eq!(entries[0].compressed_size, data.len() as u64);
    assert_eq!(extract_entry(&zip, &entries[0]).unwrap(), data);
  }

  #[test]
  fn reads_a_zip64_extra_field_with_only_some_fields_sentinelled() {
    // Only the local header offset is sentinelled: the ZIP64 record then holds
    // just that one 8-byte value, and reading it at a fixed position would
    // return garbage.
    let data = b"partial sentinel";
    let mut e = stored("only-offset.png", data);
    e.zip64_offset = true;
    let zip = Fixture::new().entry(e).build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries[0].uncompressed_size, data.len() as u64);
    assert_eq!(extract_entry(&zip, &entries[0]).unwrap(), data);
  }

  #[test]
  fn skips_non_zip64_extra_records_when_looking_for_the_zip64_one() {
    let data = b"extra fields before zip64";
    let mut e = zip64_stored("padded.png", data);
    // 0x5455 is the extended-timestamp record, extremely common in the wild and
    // often written before the ZIP64 one.
    e.extra_prefix = vec![0x55, 0x54, 0x05, 0x00, 0x03, 0x01, 0x02, 0x03, 0x04];
    let zip = Fixture::new().entry(e).build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries[0].uncompressed_size, data.len() as u64);
    assert_eq!(extract_entry(&zip, &entries[0]).unwrap(), data);
  }

  #[test]
  fn follows_a_zip64_end_of_central_directory_record() {
    // Archive-level ZIP64: the EOCD holds 0xffffffff for the directory offset
    // and size, and the real values live in the ZIP64 EOCD record found via the
    // locator.
    let zip = Fixture::new()
      .entry(stored("ch01/page01.png", b"one"))
      .entry(stored("ch01/page02.png", b"two"))
      .options(ArchiveOptions { zip64_eocd: true })
      .build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(extract_entry(&zip, &entries[1]).unwrap(), b"two");
  }

  #[test]
  fn get_uint64_reads_values_above_the_32_bit_range() {
    // The old getUint64 helper computed `lo + hi * 2**32`; check the equivalent
    // path handles a value that does not fit in 32 bits.
    let mut buf = vec![0u8; 8];
    buf.copy_from_slice(&0x0000_0001_0000_0005u64.to_le_bytes());
    assert_eq!(u64le(&buf, 0), Some(4_294_967_301));
  }

  // --- deflate: zip-node.ts's inflateRawAsync path was entirely untested ---

  #[test]
  fn extracts_a_deflated_entry() {
    let data: Vec<u8> = b"manga page bytes ".repeat(400);
    let zip = Fixture::new()
      .entry(deflated("ch01/page01.png", &data))
      .build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries[0].compression_method, METHOD_DEFLATE);
    assert!(entries[0].compressed_size < entries[0].uncompressed_size);
    assert_eq!(extract_entry(&zip, &entries[0]).unwrap(), data);
  }

  #[test]
  fn extracts_a_mix_of_stored_and_deflated_entries() {
    let a = b"stored payload".to_vec();
    let b: Vec<u8> = vec![b'x'; 5000];
    let zip = Fixture::new()
      .entry(stored("ch01/page01.png", &a))
      .entry(deflated("ch01/page02.png", &b))
      .build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(extract_entry(&zip, &entries[0]).unwrap(), a);
    assert_eq!(extract_entry(&zip, &entries[1]).unwrap(), b);
  }

  #[test]
  fn rejects_a_deflated_entry_whose_crc_does_not_match() {
    let zip = Fixture::new()
      .entry(deflated("ch01/page01.png", b"payload"))
      .build();
    let mut entry = index_zip(&zip).unwrap().remove(0);
    entry.crc32 ^= 0xffff;

    assert!(matches!(
      extract_entry(&zip, &entry).unwrap_err(),
      ZipError::Crc32Mismatch { .. }
    ));
  }

  #[test]
  fn corrupt_deflate_stream_is_an_error_not_a_panic() {
    let mut e = deflated("ch01/page01.png", b"payload that will be corrupted");
    e.corrupt_payload = true;
    let zip = Fixture::new().entry(e).build();

    let entries = index_zip(&zip).unwrap();
    assert!(extract_entry(&zip, &entries[0]).is_err());
  }

  // --- directory entries and traversal: both untested before ---

  #[test]
  fn drops_directory_entries_from_the_central_directory() {
    let zip = Fixture::new()
      .entry(stored("ch01/", b""))
      .entry(stored("ch01/page01.png", b"one"))
      .entry(stored("ch02/", b""))
      .build();

    let entries = index_zip(&zip).unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["ch01/page01.png"]);
  }

  #[test]
  fn drops_entry_names_containing_a_parent_directory_segment() {
    let zip = Fixture::new()
      .entry(stored("../escape.png", b"nope"))
      .entry(stored("ch01/../../escape.png", b"nope"))
      .entry(stored("a/../b.png", b"nope"))
      .entry(stored("ch01/page01.png", b"fine"))
      .build();

    let entries = index_zip(&zip).unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["ch01/page01.png"]);
  }

  #[test]
  fn keeps_names_where_dot_dot_is_only_part_of_a_segment() {
    // "..foo" and "foo..bar" are ordinary filenames, not traversal.
    let zip = Fixture::new()
      .entry(stored("ch01/..leading.png", b"a"))
      .entry(stored("ch01/mid..dle.png", b"b"))
      .build();

    let entries = index_zip(&zip).unwrap();
    assert_eq!(entries.len(), 2);
  }

  // --- limits ---

  #[test]
  fn rejects_a_central_directory_over_the_size_limit() {
    let mut zip = Fixture::new().entry(stored("a.png", b"a")).build();
    // Rewrite the EOCD's central-directory size field to just over 8MiB.
    let eocd = zip.len() - 22;
    let oversized = (MAX_CD_BYTES + 1) as u32;
    zip[eocd + 12..eocd + 16].copy_from_slice(&oversized.to_le_bytes());

    let err = index_zip(&zip).unwrap_err();
    assert_eq!(err, ZipError::CentralDirectoryTooLarge(MAX_CD_BYTES + 1));
    assert_eq!(
      err.to_string(),
      "Central directory size (8388609) exceeds limit"
    );
  }

  #[test]
  fn rejects_an_entry_over_the_uncompressed_size_limit() {
    let zip = Fixture::new().entry(stored("bomb.png", b"small")).build();
    let mut entry = index_zip(&zip).unwrap().remove(0);
    // A zip bomb declares a huge uncompressed size against tiny compressed data;
    // the check has to happen before anything is inflated.
    entry.uncompressed_size = MAX_UNCOMPRESSED_BYTES + 1;

    let err = extract_entry(&zip, &entry).unwrap_err();
    assert_eq!(
      err.to_string(),
      "Entry \"bomb.png\" uncompressed size (67108865) exceeds limit"
    );
  }

  #[test]
  fn an_entry_exactly_at_the_limit_is_allowed() {
    assert!(check_entry_size("edge.png", MAX_UNCOMPRESSED_BYTES).is_ok());
    assert!(check_entry_size("edge.png", MAX_UNCOMPRESSED_BYTES + 1).is_err());
  }

  // --- malformed input must not panic ---

  #[test]
  fn rejects_a_bad_local_file_header() {
    let mut zip = Fixture::new().entry(stored("a.png", b"a")).build();
    zip[0] = 0x00; // clobber the local header signature

    let entries = index_zip(&zip).unwrap();
    assert_eq!(
      extract_entry(&zip, &entries[0]).unwrap_err(),
      ZipError::InvalidLocalHeader
    );
  }

  #[test]
  fn truncated_central_directory_yields_entries_without_panicking() {
    let zip = Fixture::new()
      .entry(stored("ch01/page01.png", b"one"))
      .entry(stored("ch01/page02.png", b"two"))
      .build();
    let cd_start = find_cd_start(&zip);
    // Hand a half-record slice straight to the parser.
    let truncated = &zip[cd_start..cd_start + 30];
    assert!(parse_central_directory(truncated).is_empty());
  }

  #[test]
  fn central_directory_with_an_absurd_name_length_does_not_panic() {
    let zip = Fixture::new().entry(stored("a.png", b"a")).build();
    let cd_start = find_cd_start(&zip);
    let mut cd = zip[cd_start..].to_vec();
    cd[28..30].copy_from_slice(&u16::MAX.to_le_bytes());
    assert!(parse_central_directory(&cd).is_empty());
  }

  #[test]
  fn zip64_extra_field_truncated_mid_record_does_not_panic() {
    let mut e = zip64_stored("a.png", b"payload");
    e.truncate_zip64_extra = true;
    let zip = Fixture::new().entry(e).build();
    // Must not panic; the entry is simply left with its sentinel values.
    let _ = index_zip(&zip);
  }

  // --- helpers ---

  fn find_cd_start(zip: &[u8]) -> usize {
    let eocd = zip.len() - 22;
    u32le(zip, eocd + 16).unwrap() as usize
  }

  /// Deterministic filler bytes; the TS tests used Math.random, which made
  /// failures unreproducible.
  fn pseudo_random(n: usize, seed: u32) -> Vec<u8> {
    let mut state = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
    (0..n)
      .map(|_| {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (state >> 24) as u8
      })
      .collect()
  }
}
