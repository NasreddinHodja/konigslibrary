import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexZip, extractEntry, groupChapters, initParser } from './index';

// Exercises the browser parser end to end: the same wasm module the reader
// loads, driven through the same byte-range plumbing. The Rust unit tests in
// crates/klparse cover the parsing rules themselves; this covers the binding
// layer — that the JS↔wasm boundary passes offsets, sizes and byte arrays
// across correctly, which is where a `--target web` build breaks silently.
const fixture = () => {
  const path = fileURLToPath(new URL('./__fixtures__/sample.cbz', import.meta.url));
  return new File([readFileSync(path)], 'sample.cbz');
};

beforeAll(async () => {
  // The generated loader would `fetch` the .wasm relative to itself, which node
  // cannot do for a file: URL, so hand it the bytes directly.
  const wasm = fileURLToPath(new URL('./wasm/klwasm_bg.wasm', import.meta.url));
  await initParser(readFileSync(wasm));
});

describe('wasm zip parser', () => {
  it('indexes a real deflated archive', async () => {
    const entries = await indexZip(fixture());

    // The explicit "Sample/" directory record must not appear as an entry.
    expect(entries.some((e) => e.name.endsWith('/'))).toBe(false);
    expect(entries.map((e) => e.name)).toContain('Sample/ch01/page1.png');
    // Deflated, and actually smaller than the original.
    const page = entries.find((e) => e.name === 'Sample/ch01/page1.png')!;
    expect(page.compressionMethod).toBe(8);
    expect(page.compressedSize).toBeLessThan(page.uncompressedSize);
  });

  it('extracts and inflates an entry, verifying its CRC', async () => {
    const file = fixture();
    const entries = await indexZip(file);
    const entry = entries.find((e) => e.name === 'Sample/ch02/page2.png')!;

    const blob = await extractEntry(file, entry);
    const text = new TextDecoder().decode(await blob.arrayBuffer());
    expect(text).toBe('ch02-page2'.repeat(30));
    expect(blob.size).toBe(entry.uncompressedSize);
  });

  it('rejects an entry whose CRC does not match', async () => {
    const file = fixture();
    const entries = await indexZip(file);
    const entry = { ...entries[0], crc32: entries[0].crc32 ^ 0xffff };

    await expect(extractEntry(file, entry)).rejects.toThrow(/CRC32 mismatch/);
  });

  it('rejects an oversized entry before reading anything', async () => {
    const file = fixture();
    const entries = await indexZip(file);
    const entry = { ...entries[0], uncompressedSize: 65 * 1024 * 1024 };

    await expect(extractEntry(file, entry)).rejects.toThrow(/exceeds limit/);
  });

  it('rejects a file that is not a zip', async () => {
    const notAZip = new File([new TextEncoder().encode('nope')], 'fake.cbz');
    await expect(indexZip(notAZip)).rejects.toThrow('Not a valid ZIP file');
  });

  it('groups pages into chapters, stripping the redundant root', async () => {
    const entries = await indexZip(fixture());
    const { commonRoot, chapters } = await groupChapters(entries);

    expect(commonRoot).toBe('Sample');
    expect(chapters.map((c) => c.name)).toEqual(['ch01', 'ch02', 'ch10']);
  });

  it('counts only image entries as pages', async () => {
    const entries = await indexZip(fixture());
    const { chapters } = await groupChapters(entries);

    // ch01 also holds ComicInfo.xml and notes.txt, which are not pages.
    const ch01 = chapters.find((c) => c.name === 'ch01')!;
    expect(ch01.entries).toHaveLength(3);
    expect(ch01.entries.every((e) => e.name.endsWith('.png'))).toBe(true);
  });

  it('orders pages numerically rather than lexicographically', async () => {
    const entries = await indexZip(fixture());
    const { chapters } = await groupChapters(entries);

    const ch01 = chapters.find((c) => c.name === 'ch01')!;
    expect(ch01.entries.map((e) => e.name)).toEqual([
      'Sample/ch01/page1.png',
      'Sample/ch01/page2.png',
      'Sample/ch01/page10.png'
    ]);
  });
});
