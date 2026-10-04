//! Library indexing: what the server does between finding a manga directory
//! and having every title and cover in the list.

use std::hint::black_box;
use std::path::Path;
use std::sync::Arc;

use criterion::{criterion_group, criterion_main, BatchSize, Criterion, Throughput};
use klparse::bench_inputs;
use klparse::fixture::{stored, Fixture};
use klserver::db::Db;

const MANGA: usize = 500;
const CHAPTERS: usize = 3;

/// A manga directory of [`MANGA`] folders, each with [`CHAPTERS`] archives
/// carrying a `ComicInfo.xml` and a cover image, as the sweep finds them.
fn library(root: &Path) {
  for (i, name) in bench_inputs::manga_names(MANGA).iter().enumerate() {
    let dir = root.join(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("cover.jpg"), b"cover").unwrap();
    for ch in 1..=CHAPTERS {
      let xml = format!(
        "<ComicInfo><Series>Series {i}</Series><Number>{ch}</Number>\
         <Summary>A summary.</Summary><Genre>Action, Drama</Genre></ComicInfo>"
      );
      let zip = Fixture::new()
        .entry(stored("ComicInfo.xml", xml.as_bytes()))
        .entry(stored("001.jpg", b"page"))
        .build();
      std::fs::write(dir.join(format!("Chapter {ch}.cbz")), zip).unwrap();
    }
  }
}

/// A database of its own, so every iteration starts empty.
fn fresh_db() -> (tempfile::TempDir, Arc<Db>) {
  let tmp = tempfile::tempdir().unwrap();
  let db = Db::open(&tmp.path().join("library.db")).unwrap();
  (tmp, db)
}

fn index(c: &mut Criterion) {
  let lib = tempfile::tempdir().unwrap();
  let root = lib.path().join("manga");
  library(&root);

  let mut g = c.benchmark_group("index");
  g.throughput(Throughput::Elements(MANGA as u64));
  // Listing the directory into rows: the list is usable after this.
  g.bench_function("sync", |b| {
    b.iter_batched(
      fresh_db,
      |(tmp, db)| {
        db.sync_folders(&root).unwrap();
        (tmp, db)
      },
      BatchSize::PerIteration,
    )
  });
  // Reading every manga's metadata: the first start on a library.
  g.bench_function("sweep_cold", |b| {
    b.iter_batched(
      || {
        let (tmp, db) = fresh_db();
        db.sync_folders(&root).unwrap();
        (tmp, db)
      },
      |(tmp, db)| {
        db.sweep(&root).unwrap();
        (tmp, db)
      },
      BatchSize::PerIteration,
    )
  });

  // Nothing changed since the last sweep: every later start.
  let (_tmp, db) = fresh_db();
  db.sync_folders(&root).unwrap();
  db.sweep(&root).unwrap();
  g.bench_function("sweep_warm", |b| b.iter(|| db.sweep(&root).unwrap()));
  g.finish();

  // One page of the list, as the library view asks for it.
  let mut g = c.benchmark_group("query");
  g.bench_function("page", |b| {
    b.iter(|| db.page(black_box(""), None, 50).unwrap())
  });
  g.bench_function("search", |b| {
    b.iter(|| db.page(black_box("berserk"), None, 50).unwrap())
  });
  g.finish();
}

criterion_group!(benches, index);
criterion_main!(benches);
