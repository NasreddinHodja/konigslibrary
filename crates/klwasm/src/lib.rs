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

use klparse::chapters;
use klparse::comicinfo;
use klparse::zip;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

fn to_js_error(e: impl std::fmt::Display) -> JsValue {
  // Surfaces as a normal `Error` on the JS side, so existing `catch` blocks and
  // error messages shown to the user keep working.
  JsValue::from(js_sys::Error::new(&e.to_string()))
}

/// A zip error as a JS `Error` whose `name` is the error's code, which the
/// browser maps to the message it shows (`src/lib/utils/errors.ts`).
fn zip_error(e: zip::ZipError) -> JsValue {
  let err = js_sys::Error::new(&e.to_string());
  err.set_name(e.code());
  err.into()
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
  serde_wasm_bindgen::to_value(value).map_err(to_js_error)
}

/// Locates the end-of-central-directory record within the archive's tail.
#[wasm_bindgen]
pub fn find_eocd(tail: &[u8]) -> Result<JsValue, JsValue> {
  to_js(&zip::find_eocd(tail).map_err(zip_error)?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Zip64Eocd {
  cd_offset: u64,
  cd_size: u64,
}

/// Reads the real central-directory offset and size out of a ZIP64
/// end-of-central-directory record. Returns `null` if the record does not
/// match, in which case the 32-bit values stand.
#[wasm_bindgen]
pub fn parse_zip64_eocd(buf: &[u8]) -> Result<JsValue, JsValue> {
  match zip::parse_zip64_eocd(buf) {
    Some((cd_size, cd_offset)) => to_js(&Zip64Eocd { cd_offset, cd_size }),
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
    .map_err(zip_error)
}

/// Rejects an entry whose declared sizes are over the zip-bomb limit. Called
/// before any bytes are fetched.
#[wasm_bindgen]
pub fn check_entry_size(
  name: &str,
  compressed_size: f64,
  uncompressed_size: f64,
) -> Result<(), JsValue> {
  zip::check_entry_size(name, compressed_size as u64, uncompressed_size as u64).map_err(zip_error)
}

/// Decompresses one entry's raw bytes and verifies its CRC32.
#[wasm_bindgen]
pub fn decode_entry(
  raw: &[u8],
  compression_method: u16,
  expected_crc: u32,
  uncompressed_size: f64,
  name: &str,
) -> Result<Vec<u8>, JsValue> {
  zip::decode_entry(
    raw,
    compression_method,
    expected_crc,
    uncompressed_size as u64,
    name,
  )
  .map_err(zip_error)
}

/// The maximum bytes worth reading from the end of a file to find the EOCD.
#[wasm_bindgen]
pub fn tail_size() -> f64 {
  zip::TAIL_SIZE as f64
}

/// The most chapter archives a manga may hold.
#[wasm_bindgen]
pub fn max_chapters() -> f64 {
  klparse::MAX_CHAPTERS as f64
}

/// Rejects a central directory over the size limit. Called before fetching it.
#[wasm_bindgen]
pub fn check_central_directory_size(cd_size: f64) -> Result<(), JsValue> {
  zip::check_central_directory_size(cd_size as u64).map_err(zip_error)
}

/// The image entries of a chapter archive, in reading order, from its central
/// directory: parsed, filtered and sorted in one call, so the entries cross to
/// JavaScript once.
#[wasm_bindgen]
pub fn page_entries(cd: &[u8]) -> Result<JsValue, JsValue> {
  to_js(&klparse::page_entries(zip::parse_central_directory(cd)).map_err(zip_error)?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChapterEntries {
  pages: Vec<zip::ZipEntry>,
  comic_info: Option<zip::ZipEntry>,
}

/// A chapter archive's pages, as `page_entries` gives them, and its
/// `ComicInfo.xml` entry, for the chapter's number.
#[wasm_bindgen]
pub fn chapter_entries(cd: &[u8]) -> Result<JsValue, JsValue> {
  let entries = zip::parse_central_directory(cd);
  let comic_info = comicinfo::comic_info_entry(&entries).cloned();
  to_js(&ChapterEntries {
    pages: klparse::page_entries(entries).map_err(zip_error)?,
    comic_info,
  })
}

/// The `<Volume>` and `<Number>` of a `ComicInfo.xml` text.
#[wasm_bindgen]
pub fn comic_info_number(xml: &str) -> Result<JsValue, JsValue> {
  to_js(&chapters::comic_info_number(xml))
}

#[derive(Deserialize)]
struct SortItem {
  name: String,
  volume: Option<f64>,
  chapter: Option<f64>,
}

/// Chapter names in the order the server sorts them, given each one's
/// ComicInfo numbers.
#[wasm_bindgen]
pub fn sort_chapters(items: JsValue) -> Result<Vec<String>, JsValue> {
  let items: Vec<SortItem> = serde_wasm_bindgen::from_value(items).map_err(to_js_error)?;
  let mut keyed: Vec<(String, chapters::ChapterNumber)> = items
    .into_iter()
    .map(|i| {
      let info = chapters::ChapterNumber {
        volume: i.volume,
        chapter: i.chapter,
      };
      let number = chapters::chapter_number(&i.name, info);
      (i.name, number)
    })
    .collect();
  keyed.sort_by(|a, b| chapters::chapter_cmp((&a.0, a.1), (&b.0, b.1)));
  Ok(keyed.into_iter().map(|(name, _)| name).collect())
}

/// Which archives to read `ComicInfo.xml` from, and which file is the cover.
#[wasm_bindgen]
pub fn meta_sources(names: Vec<String>) -> Result<JsValue, JsValue> {
  to_js(&comicinfo::meta_sources(&names))
}

/// Parses each `ComicInfo.xml` text, in `meta_sources` order, into one result.
#[wasm_bindgen]
pub fn merge_comic_info(xmls: Vec<String>, cover: Option<String>) -> Result<JsValue, JsValue> {
  let infos = xmls.iter().map(|x| comicinfo::parse_comic_info(x));
  to_js(&comicinfo::merge_meta(infos, cover))
}
