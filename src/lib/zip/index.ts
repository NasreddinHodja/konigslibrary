// Byte-range plumbing around the Rust parser in crates/klparse, compiled to
// wasm. Everything that interprets ZIP bytes lives there; this file only
// decides which ranges of the file to read.
//
// The reads stay here, in JavaScript, because `File.slice` is async and lazy:
// opening a 2GB CBZ touches only the 64KB tail, the central directory, and the
// bytes of the page being displayed. Handing the whole file to wasm would copy
// the entire archive into the wasm heap just to list its contents.
import init, * as wasm from './wasm/klwasm.js';

export type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  crc32: number;
};

export type ZipChapter = { name: string; entries: ZipEntry[] };
export type GroupedChapters = { commonRoot: string | null; chapters: ZipChapter[] };

let ready: Promise<unknown> | null = null;

/// Loads the wasm module, once per thread.
///
/// The argument exists for tests: the generated loader locates the `.wasm`
/// beside itself and `fetch`es it, which works in a browser but not under
/// vitest, where the bytes are read off disk and passed in instead.
export function initParser(input?: Parameters<typeof init>[0]): Promise<unknown> {
  ready ??= init(input);
  return ready;
}

function ensureReady(): Promise<unknown> {
  return initParser();
}

async function bytes(file: File, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

export async function indexZip(file: File): Promise<ZipEntry[]> {
  await ensureReady();

  const tailSize = Math.min(file.size, wasm.tail_size());
  const eocd = wasm.find_eocd(await bytes(file, file.size - tailSize, file.size));

  let { cdOffset, cdSize } = eocd;
  if (eocd.zip64EocdOffset != null) {
    const record = await bytes(file, eocd.zip64EocdOffset, eocd.zip64EocdOffset + 56);
    const zip64 = wasm.parse_zip64_eocd(record);
    if (zip64) {
      cdOffset = zip64.cdOffset;
      cdSize = zip64.cdSize;
    }
  }

  if (cdSize > wasm.max_central_directory_bytes()) {
    throw new Error(`Central directory size (${cdSize}) exceeds limit`);
  }

  return wasm.parse_central_directory(await bytes(file, cdOffset, cdOffset + cdSize));
}

export async function extractEntry(file: File, entry: ZipEntry): Promise<Blob> {
  await ensureReady();

  // Checked before reading anything, so a zip bomb is rejected on its declared
  // size rather than after it has been inflated.
  wasm.check_entry_size(entry.name, entry.uncompressedSize);

  const header = await bytes(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const dataStart = entry.localHeaderOffset + wasm.local_header_data_offset(header);
  const raw = await bytes(file, dataStart, dataStart + entry.compressedSize);

  const data = wasm.decode_entry(raw, entry.compressionMethod, entry.crc32, entry.name);
  // wasm-bindgen hands back a fresh Uint8Array copied out of the wasm heap; the
  // cast only tells TypeScript its buffer is not a SharedArrayBuffer.
  return new Blob([data as Uint8Array<ArrayBuffer>]);
}

/// Filters to image entries, detects the chapter nesting depth and groups
/// pages — the same code path the server uses for a zip-backed manga.
export async function groupChapters(entries: ZipEntry[]): Promise<GroupedChapters> {
  await ensureReady();
  return wasm.group_chapters(entries);
}
