//! Manga archive parsing for konigslibrary.
//!
//! This is the single implementation of ZIP64 reading and chapter detection,
//! compiled two ways:
//!
//! - `wasm32` via `klwasm`, for the browser's "open a local file, no backend"
//!   flow — the thing that lets the plain-website deployment ship with no
//!   server at all;
//! - native via `klserver`, for the LAN-sharing sidecar and the standalone
//!   self-hosted deployment.
//!
//! It replaces three TypeScript modules that between them held two copies of
//! the same byte-range plumbing: `src/lib/zip/parse.ts`, `src/lib/zip/index.ts`
//! and `src/lib/server/zip-node.ts`.

pub mod chapters;
pub mod collate;
pub mod crc32;
pub mod names;
pub mod uri;
pub mod zip;

#[cfg(any(test, feature = "fixtures"))]
pub mod fixture;

pub use chapters::{detect_depth, group_by_chapter, Depth};
pub use collate::{locale_cmp, natural_cmp};
pub use crc32::crc32;
pub use names::{content_type, ext_with_dot, is_image_name, is_zip_name, strip_zip_ext};
pub use uri::{decode_uri_component, encode_uri_component};
pub use zip::{extract_entry, index_zip, ReadAt, Result, ZipEntry, ZipError};
