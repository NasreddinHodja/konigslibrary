import { describe, it, expect } from 'vitest';
import { crc32 } from './crc32';
import { createZip } from './write';
import { indexZip, extractEntry } from '$lib/zip';

describe('crc32', () => {
  it('returns 0 for empty data', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('computes known CRC32 for "hello"', () => {
    const data = new TextEncoder().encode('hello');
    // Known CRC32 for "hello" is 0x3610a686
    expect(crc32(data)).toBe(0x3610a686);
  });

  it('is consistent across calls', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    expect(crc32(data)).toBe(crc32(data));
  });

  it('differs for different inputs', () => {
    const a = new TextEncoder().encode('foo');
    const b = new TextEncoder().encode('bar');
    expect(crc32(a)).not.toBe(crc32(b));
  });
});

describe('CRC32 validation in extraction', () => {
  function toFile(blob: Blob, name: string): File {
    return new File([blob], name, { type: 'application/zip' });
  }

  it('entries have crc32 field set', async () => {
    const data = new TextEncoder().encode('test');
    const zip = toFile(createZip([{ name: 'test.txt', data }]), 'test.zip');
    const entries = await indexZip(zip);
    expect(entries[0].crc32).toBe(crc32(data));
  });

  it('extracts valid entries without error', async () => {
    const data = new TextEncoder().encode('valid content');
    const zip = toFile(createZip([{ name: 'file.txt', data }]), 'test.zip');
    const entries = await indexZip(zip);
    const blob = await extractEntry(zip, entries[0]);
    const result = new Uint8Array(await blob.arrayBuffer());
    expect(result).toEqual(data);
  });

  it('rejects corrupted data with CRC32 mismatch', async () => {
    const data = new TextEncoder().encode('original');
    const zip = toFile(createZip([{ name: 'file.txt', data }]), 'test.zip');
    const entries = await indexZip(zip);
    entries[0].crc32 = 0xdeadbeef;
    await expect(extractEntry(zip, entries[0])).rejects.toThrow('CRC32 mismatch');
  });
});
