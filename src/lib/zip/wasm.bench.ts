import { test, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initParser } from './index';
import { decode_entry, page_entries, sort_chapters } from './wasm/klwasm.js';

// The wasm half of the native/wasm comparison: the inputs of
// crates/klparse/benches/parse.rs, written out by `bun run bench:wasm`, timed
// through the bindings the reader calls. So each figure includes crossing the
// JS↔wasm boundary, which the browser pays too.
const inputs = (name: string) => readFileSync(`crates/target/bench-inputs/${name}`);

const cd = new Uint8Array(inputs('central-directory.bin'));
const raw = new Uint8Array(inputs('page.bin'));
const page = JSON.parse(inputs('page.json').toString());
const chapters = (JSON.parse(inputs('chapter-names.json').toString()) as string[]).map((name) => ({
  name
}));

beforeAll(async () => {
  // As in wasm.test.ts: node cannot fetch the .wasm from a file: URL.
  const wasm = fileURLToPath(new URL('./wasm/klwasm_bg.wasm', import.meta.url));
  await initParser(readFileSync(wasm));
});

test('zip', async ({ bench }) => {
  await bench('page_entries', () => {
    page_entries(cd);
  }).run();
  await bench('decode_entry', () => {
    decode_entry(raw, page.compressionMethod, page.crc32, page.uncompressedSize, page.name);
  }).run();
});

test('collate', async ({ bench }) => {
  await bench('sort_chapters', () => {
    sort_chapters(chapters);
  }).run();
});
