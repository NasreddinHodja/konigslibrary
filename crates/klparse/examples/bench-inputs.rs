//! Writes the bench inputs to a directory, for the wasm bench
//! (`src/lib/zip/wasm.bench.ts`), which cannot build them itself.
//!
//!   cargo run -p klparse --example bench-inputs -- <dir>

use std::path::PathBuf;

use klparse::bench_inputs;

fn main() -> std::io::Result<()> {
  let dir = PathBuf::from(std::env::args().nth(1).expect("usage: bench-inputs <dir>"));
  std::fs::create_dir_all(&dir)?;

  let chapter = bench_inputs::chapter();
  std::fs::write(
    dir.join("central-directory.bin"),
    bench_inputs::central_directory(&chapter),
  )?;
  let (raw, entry) = bench_inputs::page();
  std::fs::write(dir.join("page.bin"), raw)?;
  std::fs::write(dir.join("page.json"), serde_json::to_string(&entry)?)?;
  let names = serde_json::to_string(&bench_inputs::chapter_names(1000))?;
  std::fs::write(dir.join("chapter-names.json"), names)?;
  Ok(())
}
