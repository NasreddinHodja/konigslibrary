//! Archive parsing and ordering, native. `src/lib/zip/wasm.bench.ts` times the
//! same inputs through the wasm build.

use std::hint::black_box;

use criterion::{criterion_group, criterion_main, BatchSize, Criterion, Throughput};
use klparse::bench_inputs::{self, PAGES, PAGE_SIZE};
use klparse::chapters::{chapter_cmp, chapter_number, ChapterNumber};
use klparse::collate::fold;
use klparse::{index_zip, locale_cmp, page_entries, zip};

fn archive(c: &mut Criterion) {
  let chapter = bench_inputs::chapter();
  let cd = bench_inputs::central_directory(&chapter);
  let (raw, page) = bench_inputs::page();

  let mut g = c.benchmark_group("zip");
  g.throughput(Throughput::Elements(PAGES as u64));
  // What opening a chapter costs the server: tail, directory, parse.
  g.bench_function("index_zip", |b| {
    b.iter(|| index_zip(black_box(&chapter[..])))
  });
  // What it costs the browser once the directory is read.
  g.bench_function("page_entries", |b| {
    b.iter(|| page_entries(zip::parse_central_directory(black_box(cd))))
  });

  g.throughput(Throughput::Bytes(PAGE_SIZE as u64));
  // Inflating a page and checking its CRC, once its bytes are read.
  g.bench_function("decode_entry", |b| {
    b.iter(|| {
      zip::decode_entry(
        black_box(&raw),
        page.compression_method,
        page.crc32,
        page.uncompressed_size,
        &page.name,
      )
    })
  });
  g.finish();
}

fn collate(c: &mut Criterion) {
  let chapters = bench_inputs::chapter_names(1000);
  let manga = bench_inputs::manga_names(5000);

  let mut g = c.benchmark_group("collate");
  g.throughput(Throughput::Elements(chapters.len() as u64));
  // The chapter list of a long series, as `sort_chapters` orders it.
  g.bench_function("sort_chapters", |b| {
    b.iter_batched(
      || chapters.clone(),
      |names| {
        let mut keyed: Vec<(String, ChapterNumber)> = names
          .into_iter()
          .map(|n| {
            let number = chapter_number(&n, ChapterNumber::default());
            (n, number)
          })
          .collect();
        keyed.sort_by(|a, b| chapter_cmp((&a.0, a.1), (&b.0, b.1)));
        keyed
      },
      BatchSize::SmallInput,
    )
  });

  g.throughput(Throughput::Elements(manga.len() as u64));
  g.bench_function("sort_manga", |b| {
    b.iter_batched(
      || manga.clone(),
      |mut names| {
        names.sort_by(|a, b| locale_cmp(a, b));
        names
      },
      BatchSize::SmallInput,
    )
  });
  // The sort and search keys the server stores per manga.
  g.bench_function("fold", |b| {
    b.iter(|| manga.iter().map(|n| fold(black_box(n))).collect::<Vec<_>>())
  });
  g.finish();
}

criterion_group!(benches, archive, collate);
criterion_main!(benches);
