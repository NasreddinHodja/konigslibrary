import { describe, it, expect } from 'vitest';
import { createZip } from '$lib/zip-write';
import { indexZip, extractEntry } from '$lib/zip';

function toFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: 'application/zip' });
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

describe('zip roundtrip', () => {
  it('indexes a single stored file', async () => {
    const data = new TextEncoder().encode('hello world');
    const zip = toFile(createZip([{ name: 'hello.txt', data }]), 'test.zip');

    const entries = await indexZip(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('hello.txt');
    expect(entries[0].uncompressedSize).toBe(data.length);
    expect(entries[0].compressionMethod).toBe(0);
  });

  it('extracts stored data that matches the original', async () => {
    const data = new TextEncoder().encode('konigslibrary test data');
    const zip = toFile(createZip([{ name: 'file.bin', data }]), 'test.zip');

    const entries = await indexZip(zip);
    const blob = await extractEntry(zip, entries[0]);
    const extracted = new Uint8Array(await blob.arrayBuffer());
    expect(extracted).toEqual(data);
  });

  it('handles multiple files', async () => {
    const files = [
      { name: 'chapter1/page01.png', data: randomBytes(1024) },
      { name: 'chapter1/page02.png', data: randomBytes(2048) },
      { name: 'chapter2/page01.png', data: randomBytes(512) }
    ];
    const zip = toFile(createZip(files), 'manga.cbz');

    const entries = await indexZip(zip);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));

    for (let i = 0; i < files.length; i++) {
      const blob = await extractEntry(zip, entries[i]);
      const extracted = new Uint8Array(await blob.arrayBuffer());
      expect(extracted).toEqual(files[i].data);
    }
  });

  it('handles an empty file entry', async () => {
    const zip = toFile(createZip([{ name: 'empty.txt', data: new Uint8Array(0) }]), 'test.zip');

    const entries = await indexZip(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].uncompressedSize).toBe(0);

    const blob = await extractEntry(zip, entries[0]);
    expect(blob.size).toBe(0);
  });

  it('preserves unicode filenames', async () => {
    const name = '漫画/第1話/ページ01.png';
    const data = randomBytes(64);
    const zip = toFile(createZip([{ name, data }]), 'test.zip');

    const entries = await indexZip(zip);
    expect(entries[0].name).toBe(name);
  });
});

describe('zip error handling', () => {
  it('rejects a non-zip file', async () => {
    const garbage = toFile(new Blob(['this is not a zip']), 'fake.zip');
    await expect(indexZip(garbage)).rejects.toThrow('Not a valid ZIP file');
  });

  it('rejects an empty file', async () => {
    const empty = toFile(new Blob([]), 'empty.zip');
    await expect(indexZip(empty)).rejects.toThrow('Not a valid ZIP file');
  });

  it('rejects unsupported compression method on extract', async () => {
    const data = new TextEncoder().encode('test');
    const zip = toFile(createZip([{ name: 'test.bin', data }]), 'test.zip');

    const entries = await indexZip(zip);
    // Fake a compression method the extractor doesn't support
    entries[0].compressionMethod = 99;
    await expect(extractEntry(zip, entries[0])).rejects.toThrow(
      'Unsupported compression method: 99'
    );
  });
});
