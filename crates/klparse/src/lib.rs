//! Manga archive parsing for konigslibrary.
//!
//! This is the single implementation of ZIP64 reading and ComicInfo parsing,
//! compiled two ways:
//!
//! - `wasm32` via `klwasm`, for the browser's "open a local file, no backend"
//!   flow — the thing that lets the plain-website deployment ship with no
//!   server at all;
//! - native via `klserver`, for the LAN-sharing sidecar and the standalone
//!   self-hosted deployment.
//!
//! The Tauri app (`src-tauri`) links it natively too.

pub mod chapters;
pub mod collate;
pub mod comicinfo;
mod crc32;
pub mod listing;
pub mod names;
pub mod uri;
pub mod zip;

#[cfg(any(test, feature = "fixtures"))]
pub mod fixture;

pub use chapters::{chapter_cmp, chapter_number, check_chapter_count, ChapterNumber, MAX_CHAPTERS};
pub use collate::{locale_cmp, natural_cmp};
pub use comicinfo::{manga_meta, MangaMeta};
pub use names::{
  content_type, ext_with_dot, is_chapter_name, is_cover_name, is_image_name, is_plain_name,
  is_zip_name, strip_zip_ext,
};
pub use uri::{decode_uri_component, encode_uri_component};
pub use zip::{extract_entry, index_zip, page_entries, ReadAt, Result, ZipEntry, ZipError};
