//! Test-only ZIP builder.
//!
//! Replaces `src/lib/zip/write.ts`, which could only emit stored, non-ZIP64
//! entries — which is why the ZIP64 and deflate branches of the parser had
//! never been exercised by a test. This builder can emit deflated entries,
//! per-entry ZIP64 extra fields (with any subset of the three fields
//! sentinelled), archive-level ZIP64 end-of-central-directory records, and
//! deliberately malformed variants.

use crate::crc32::crc32;
use crate::zip::{
  CD_SIG, EOCD_SIG, LOCAL_SIG, METHOD_DEFLATE, METHOD_STORE, ZIP64_EOCD_LOC_SIG, ZIP64_EOCD_SIG,
  ZIP64_EXTRA_ID,
};

const SENTINEL: u32 = 0xffff_ffff;

#[derive(Debug, Clone)]
pub struct FixtureEntry {
  pub name: String,
  pub data: Vec<u8>,
  pub method: u16,
  /// Write `0xffffffff` for both sizes and put the real ones in a ZIP64 extra.
  pub zip64_sizes: bool,
  /// Same, for the local header offset.
  pub zip64_offset: bool,
  /// Extra-field records written *before* the ZIP64 one, to check that the
  /// parser walks the extra field rather than assuming ZIP64 comes first.
  pub extra_prefix: Vec<u8>,
  /// Bytes written into the local header's extra field, so the data offset is
  /// not simply `30 + name_len`.
  pub local_extra: Vec<u8>,
  /// Cut the ZIP64 extra record short while leaving its declared size intact.
  pub truncate_zip64_extra: bool,
  /// Flip bytes in the stored payload after the CRC is computed.
  pub corrupt_payload: bool,
}

fn base(name: &str, data: &[u8], method: u16) -> FixtureEntry {
  FixtureEntry {
    name: name.to_string(),
    data: data.to_vec(),
    method,
    zip64_sizes: false,
    zip64_offset: false,
    extra_prefix: Vec::new(),
    local_extra: Vec::new(),
    truncate_zip64_extra: false,
    corrupt_payload: false,
  }
}

pub fn stored(name: &str, data: &[u8]) -> FixtureEntry {
  base(name, data, METHOD_STORE)
}

pub fn deflated(name: &str, data: &[u8]) -> FixtureEntry {
  base(name, data, METHOD_DEFLATE)
}

/// A stored entry with all three ZIP64 fields sentinelled, plus a ZIP64 record
/// in the local header's extra field.
pub fn zip64_stored(name: &str, data: &[u8]) -> FixtureEntry {
  let mut e = base(name, data, METHOD_STORE);
  e.zip64_sizes = true;
  e.zip64_offset = true;
  // A realistic writer also puts sizes in the local header's ZIP64 extra.
  let mut local = vec![0u8; 4];
  local[0..2].copy_from_slice(&ZIP64_EXTRA_ID.to_le_bytes());
  local[2..4].copy_from_slice(&16u16.to_le_bytes());
  local.extend_from_slice(&(data.len() as u64).to_le_bytes());
  local.extend_from_slice(&(data.len() as u64).to_le_bytes());
  e.local_extra = local;
  e
}

#[derive(Debug, Clone, Default)]
pub struct ArchiveOptions {
  /// Sentinel the EOCD's central-directory offset and size, and write a ZIP64
  /// EOCD record plus locator ahead of it.
  pub zip64_eocd: bool,
}

#[derive(Debug, Default)]
pub struct Fixture {
  entries: Vec<FixtureEntry>,
  options: ArchiveOptions,
}

impl Fixture {
  pub fn new() -> Self {
    Self::default()
  }

  pub fn entry(mut self, e: FixtureEntry) -> Self {
    self.entries.push(e);
    self
  }

  pub fn options(mut self, o: ArchiveOptions) -> Self {
    self.options = o;
    self
  }

  pub fn build(self) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut records = Vec::new();

    for e in &self.entries {
      let local_offset = out.len() as u64;
      let crc = crc32(&e.data);
      let mut payload = match e.method {
        METHOD_STORE => e.data.clone(),
        METHOD_DEFLATE => deflate_raw(&e.data),
        m => panic!("fixture cannot write compression method {m}"),
      };
      if e.corrupt_payload {
        for b in payload.iter_mut().take(8) {
          *b ^= 0xff;
        }
      }

      let name = e.name.as_bytes();
      let mut lh = vec![0u8; 30];
      lh[0..4].copy_from_slice(&LOCAL_SIG.to_le_bytes());
      lh[4..6].copy_from_slice(&20u16.to_le_bytes()); // version needed
      lh[6..8].copy_from_slice(&(1u16 << 11).to_le_bytes()); // UTF-8 names
      lh[8..10].copy_from_slice(&e.method.to_le_bytes());
      // bytes 10..14: mod time/date, left zeroed
      lh[14..18].copy_from_slice(&crc.to_le_bytes());
      lh[18..22].copy_from_slice(&(payload.len() as u32).to_le_bytes());
      lh[22..26].copy_from_slice(&(e.data.len() as u32).to_le_bytes());
      lh[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
      lh[28..30].copy_from_slice(&(e.local_extra.len() as u16).to_le_bytes());

      out.extend_from_slice(&lh);
      out.extend_from_slice(name);
      out.extend_from_slice(&e.local_extra);
      out.extend_from_slice(&payload);

      records.push((e, crc, payload.len() as u64, local_offset));
    }

    let cd_start = out.len() as u64;

    for (e, crc, csize, local_offset) in &records {
      let name = e.name.as_bytes();

      let mut zip64 = Vec::new();
      if e.zip64_sizes || e.zip64_offset {
        let mut fields: Vec<u8> = Vec::new();
        if e.zip64_sizes {
          fields.extend_from_slice(&(e.data.len() as u64).to_le_bytes());
          fields.extend_from_slice(&csize.to_le_bytes());
        }
        if e.zip64_offset {
          fields.extend_from_slice(&local_offset.to_le_bytes());
        }
        zip64.extend_from_slice(&ZIP64_EXTRA_ID.to_le_bytes());
        zip64.extend_from_slice(&(fields.len() as u16).to_le_bytes());
        if e.truncate_zip64_extra {
          fields.truncate(4);
        }
        zip64.extend_from_slice(&fields);
      }

      let mut extra = e.extra_prefix.clone();
      extra.extend_from_slice(&zip64);

      let mut ch = vec![0u8; 46];
      ch[0..4].copy_from_slice(&CD_SIG.to_le_bytes());
      ch[4..6].copy_from_slice(&20u16.to_le_bytes()); // version made by
      ch[6..8].copy_from_slice(&20u16.to_le_bytes()); // version needed
      ch[8..10].copy_from_slice(&(1u16 << 11).to_le_bytes()); // UTF-8 names
      ch[10..12].copy_from_slice(&e.method.to_le_bytes());
      // bytes 12..16: mod time/date, left zeroed
      ch[16..20].copy_from_slice(&crc.to_le_bytes());
      let cd_csize = if e.zip64_sizes {
        SENTINEL
      } else {
        *csize as u32
      };
      let cd_usize = if e.zip64_sizes {
        SENTINEL
      } else {
        e.data.len() as u32
      };
      let cd_offset = if e.zip64_offset {
        SENTINEL
      } else {
        *local_offset as u32
      };
      ch[20..24].copy_from_slice(&cd_csize.to_le_bytes());
      ch[24..28].copy_from_slice(&cd_usize.to_le_bytes());
      ch[28..30].copy_from_slice(&(name.len() as u16).to_le_bytes());
      ch[30..32].copy_from_slice(&(extra.len() as u16).to_le_bytes());
      // comment length, disk number, attrs stay zeroed
      ch[42..46].copy_from_slice(&cd_offset.to_le_bytes());

      out.extend_from_slice(&ch);
      out.extend_from_slice(name);
      out.extend_from_slice(&extra);
    }

    let cd_size = out.len() as u64 - cd_start;
    let count = records.len() as u64;

    let (eocd_cd_size, eocd_cd_offset) = if self.options.zip64_eocd {
      let z64_pos = out.len() as u64;

      let mut z64 = vec![0u8; 56];
      z64[0..4].copy_from_slice(&ZIP64_EOCD_SIG.to_le_bytes());
      z64[4..12].copy_from_slice(&44u64.to_le_bytes()); // size of the rest of this record
      z64[12..14].copy_from_slice(&45u16.to_le_bytes()); // version made by
      z64[14..16].copy_from_slice(&45u16.to_le_bytes()); // version needed
                                                         // bytes 16..24: disk numbers, left zeroed
      z64[24..32].copy_from_slice(&count.to_le_bytes());
      z64[32..40].copy_from_slice(&count.to_le_bytes());
      z64[40..48].copy_from_slice(&cd_size.to_le_bytes());
      z64[48..56].copy_from_slice(&cd_start.to_le_bytes());
      out.extend_from_slice(&z64);

      let mut loc = vec![0u8; 20];
      loc[0..4].copy_from_slice(&ZIP64_EOCD_LOC_SIG.to_le_bytes());
      // bytes 4..8: disk holding the ZIP64 EOCD, left zeroed
      loc[8..16].copy_from_slice(&z64_pos.to_le_bytes());
      loc[16..20].copy_from_slice(&1u32.to_le_bytes()); // total disks
      out.extend_from_slice(&loc);

      (SENTINEL, SENTINEL)
    } else {
      (cd_size as u32, cd_start as u32)
    };

    let mut eocd = vec![0u8; 22];
    eocd[0..4].copy_from_slice(&EOCD_SIG.to_le_bytes());
    // bytes 4..8: disk numbers, left zeroed
    eocd[8..10].copy_from_slice(&(count as u16).to_le_bytes());
    eocd[10..12].copy_from_slice(&(count as u16).to_le_bytes());
    eocd[12..16].copy_from_slice(&eocd_cd_size.to_le_bytes());
    eocd[16..20].copy_from_slice(&eocd_cd_offset.to_le_bytes());
    // comment length stays zeroed
    out.extend_from_slice(&eocd);

    out
  }
}

fn deflate_raw(data: &[u8]) -> Vec<u8> {
  use flate2::write::DeflateEncoder;
  use flate2::Compression;
  use std::io::Write;

  let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
  enc.write_all(data).expect("writing to a Vec cannot fail");
  enc.finish().expect("finishing a Vec encoder cannot fail")
}
