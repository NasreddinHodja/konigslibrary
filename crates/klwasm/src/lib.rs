//! Browser bindings for `klparse`.
//!
//! Replaces `src/lib/zip/parse.ts` and the parsing half of `src/lib/zip/index.ts`.
//!
//! # Why this API is byte-slice shaped
//!
//! The obvious wasm binding would be `index_zip(whole_file_bytes)`. That would
//! be a serious regression: the TypeScript implementation read a CBZ through
//! `File.slice`, touching only the 64KB tail, the central directory, and the
//! one page being displayed. Handing the whole file to wasm would copy a
//! multi-gigabyte archive into the wasm heap just to open it.
//!
//! So the range reads stay in JavaScript, where `File.slice` is async, and
//! every function here takes just the bytes for one range. All the actual
//! parsing — signature checks, ZIP64 sentinel handling, central directory
//! walking, inflate, CRC verification — happens in `klparse`, the same code the
//! native server runs.

use klparse::zip::{self, ZipEntry};
use serde::Serialize;
use wasm_bindgen::prelude::*;

fn to_js_error(e: impl std::fmt::Display) -> JsValue {
  // Surfaces as a normal `Error` on the JS side, so existing `catch` blocks and
  // error messages shown to the user keep working.
  JsValue::from(js_sys::Error::new(&e.to_string()))
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
  serde_wasm_bindgen::to_value(value).map_err(to_js_error)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EocdInfo {
  cd_offset: f64,
  cd_size: f64,
  /// When set, the caller must read 56 bytes at this absolute file offset and
  /// pass them to `parse_zip64_eocd`.
  zip64_eocd_offset: Option<f64>,
}

/// Locates the end-of-central-directory record within the archive's tail.
#[wasm_bindgen]
pub fn find_eocd(tail: &[u8]) -> Result<JsValue, JsValue> {
  let info = zip::find_eocd(tail).map_err(to_js_error)?;
  to_js(&EocdInfo {
    cd_offset: info.cd_offset as f64,
    cd_size: info.cd_size as f64,
    zip64_eocd_offset: info.zip64_eocd_offset.map(|v| v as f64),
  })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Zip64Eocd {
  cd_offset: f64,
  cd_size: f64,
}

/// Reads the real central-directory offset and size out of a ZIP64
/// end-of-central-directory record. Returns `null` if the record does not
/// match, in which case the 32-bit values stand.
#[wasm_bindgen]
pub fn parse_zip64_eocd(buf: &[u8]) -> Result<JsValue, JsValue> {
  match zip::parse_zip64_eocd(buf) {
    Some((cd_size, cd_offset)) => to_js(&Zip64Eocd {
      cd_offset: cd_offset as f64,
      cd_size: cd_size as f64,
    }),
    None => Ok(JsValue::NULL),
  }
}

/// Parses the central directory into entries, dropping directory records and
/// any name containing a `..` segment.
#[wasm_bindgen]
pub fn parse_central_directory(cd: &[u8]) -> Result<JsValue, JsValue> {
  to_js(&zip::parse_central_directory(cd))
}

/// Validates a 30-byte local file header and returns the offset of the entry's
/// data relative to the start of that header.
#[wasm_bindgen]
pub fn local_header_data_offset(lh: &[u8]) -> Result<f64, JsValue> {
  zip::local_header_data_offset(lh)
    .map(|v| v as f64)
    .map_err(to_js_error)
}

/// Rejects an entry whose declared uncompressed size is over the zip-bomb
/// limit. Called before any bytes are fetched.
#[wasm_bindgen]
pub fn check_entry_size(name: &str, uncompressed_size: f64) -> Result<(), JsValue> {
  zip::check_entry_size(name, uncompressed_size as u64).map_err(to_js_error)
}

/// Decompresses one entry's raw bytes and verifies its CRC32.
#[wasm_bindgen]
pub fn decode_entry(
  raw: &[u8],
  compression_method: u16,
  expected_crc: u32,
  name: &str,
) -> Result<Vec<u8>, JsValue> {
  zip::decode_entry(raw, compression_method, expected_crc, name).map_err(to_js_error)
}

/// The maximum bytes worth reading from the end of a file to find the EOCD.
#[wasm_bindgen]
pub fn tail_size() -> f64 {
  zip::TAIL_SIZE as f64
}

/// The central-directory size limit, checked by the caller before fetching it.
#[wasm_bindgen]
pub fn max_central_directory_bytes() -> f64 {
  zip::MAX_CD_BYTES as f64
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Chapter {
  name: String,
  entries: Vec<ZipEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Grouped {
  /// The archive's common root directory, used as a fallback manga title.
  common_root: Option<String>,
  chapters: Vec<Chapter>,
}

/// Filters an archive's entries down to images, detects the chapter nesting
/// depth, and groups pages into chapters.
///
/// This is the whole of what `src/lib/sources/upload.ts` used to do with
/// `detectDepth` + `groupByChapter`, moved here so the browser and the server
/// group chapters through the same code rather than two implementations that
/// have to be kept in step.
#[wasm_bindgen]
pub fn group_chapters(entries: JsValue) -> Result<JsValue, JsValue> {
  let entries: Vec<ZipEntry> = serde_wasm_bindgen::from_value(entries).map_err(to_js_error)?;

  let image_entries: Vec<ZipEntry> = entries
    .into_iter()
    .filter(|e| klparse::is_image_name(&e.name))
    .collect();

  let names: Vec<&str> = image_entries.iter().map(|e| e.name.as_str()).collect();
  let depth = klparse::detect_depth(&names);

  let mut chapters: Vec<Chapter> =
    klparse::group_by_chapter(image_entries, depth.depth, |e| &e.name)
      .into_iter()
      .map(|(name, entries)| Chapter { name, entries })
      .collect();

  chapters.sort_by(|a, b| klparse::locale_cmp(&a.name, &b.name));

  to_js(&Grouped {
    common_root: depth.common_root,
    chapters,
  })
}
