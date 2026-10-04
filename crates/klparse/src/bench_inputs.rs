//! Benchmark inputs, the same every run.
//!
//! Shared by the criterion benches (`benches/`) and, written to disk by
//! `examples/bench-inputs.rs`, the wasm bench (`src/lib/zip/wasm.bench.ts`),
//! so native and wasm time the same bytes.

use crate::fixture::{deflated, stored, Fixture};
use crate::zip::{self, ZipEntry};

/// Pages in [`chapter`]: a long chapter, or a short volume.
pub const PAGES: usize = 200;

/// Size of [`page`]: a typical scanned page.
pub const PAGE_SIZE: usize = 1 << 20;

/// A tiny deterministic generator (an LCG), so inputs need no `rand`.
struct Lcg(u64);

impl Lcg {
  fn next(&mut self) -> u32 {
    self.0 = self
      .0
      .wrapping_mul(6364136223846793005)
      .wrapping_add(1442695040888963407);
    (self.0 >> 33) as u32
  }

  fn below(&mut self, n: usize) -> usize {
    self.next() as usize % n
  }
}

/// A chapter archive of [`PAGES`] stored pages in shuffled order, plus a
/// `ComicInfo.xml`, as a scanlation group would pack one. The pages are a few
/// bytes each: what is timed is the directory, not the payload.
pub fn chapter() -> Vec<u8> {
  let mut names: Vec<String> = (1..=PAGES)
    .map(|i| format!("Chapter 012/{i:03}.jpg"))
    .collect();
  let mut rng = Lcg(1);
  for i in (1..names.len()).rev() {
    names.swap(i, rng.below(i + 1));
  }
  let mut fx = Fixture::new();
  for name in &names {
    fx = fx.entry(stored(name, b"page"));
  }
  fx.entry(stored(
    "ComicInfo.xml",
    b"<ComicInfo><Volume>2</Volume><Number>12</Number></ComicInfo>",
  ))
  .build()
}

/// The central directory of `archive`, as the browser reads it by range.
pub fn central_directory(archive: &[u8]) -> &[u8] {
  let tail = &archive[archive.len().saturating_sub(zip::TAIL_SIZE as usize)..];
  let eocd = zip::find_eocd(tail).expect("the fixture has an EOCD");
  let start = eocd.cd_offset as usize;
  &archive[start..start + eocd.cd_size as usize]
}

/// One deflated page of [`PAGE_SIZE`] bytes: its compressed bytes, as the
/// browser reads them by range, and its entry. The bytes are runs of noise, so
/// they compress about as poorly as image data does.
pub fn page() -> (Vec<u8>, ZipEntry) {
  let mut rng = Lcg(2);
  let mut data = Vec::with_capacity(PAGE_SIZE);
  while data.len() < PAGE_SIZE {
    let byte = rng.next() as u8;
    let run = 1 + rng.below(4);
    data.extend(std::iter::repeat_n(byte, run));
  }
  data.truncate(PAGE_SIZE);
  let archive = Fixture::new().entry(deflated("001.png", &data)).build();
  let entry = zip::index_zip(&archive[..])
    .expect("the fixture indexes")
    .remove(0);
  let start =
    (entry.local_header_offset + zip::local_header_data_offset(&archive[..30]).unwrap()) as usize;
  let raw = archive[start..start + entry.compressed_size as usize].to_vec();
  (raw, entry)
}

/// `count` chapter archive names in the styles found in real libraries:
/// volume and chapter markers, decimals, bare numbers, group tags, padding.
pub fn chapter_names(count: usize) -> Vec<String> {
  let mut rng = Lcg(3);
  (0..count)
    .map(|i| {
      let ch = i + 1;
      let vol = ch / 10 + 1;
      match rng.below(6) {
        0 => format!("Vol.{vol:02} Ch.{ch:03} - The Title.cbz"),
        1 => format!("c{ch:03} [Group].cbz"),
        2 => format!("Chapter {ch}.5.cbz"),
        3 => format!("v{vol} c{ch}.cbz"),
        4 => format!("{ch:04}.cbz"),
        _ => format!("Extra {ch} (Omake).cbz"),
      }
    })
    .rev()
    .collect()
}

/// `count` manga folder names, mixing case, accents and punctuation the way
/// a library does.
pub fn manga_names(count: usize) -> Vec<String> {
  const WORDS: [&str; 12] = [
    "Berserk",
    "akira",
    "Ōkami",
    "One Piece",
    "Émile",
    "vagabond",
    "Dr. Stone",
    "_drafts",
    "Zéro",
    "monster",
    "20th Century Boys",
    "Ão",
  ];
  let mut rng = Lcg(4);
  (0..count)
    .map(|i| {
      let a = WORDS[rng.below(WORDS.len())];
      let b = WORDS[rng.below(WORDS.len())];
      format!("{a} {b} {i}")
    })
    .collect()
}
