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

/// A manga folder's metadata, as `klparse::MangaMeta` serializes it. `cover` is
/// the cover's file name within the folder.
export type RawMangaMeta = {
  title: string | null;
  description: string | null;
  year: number | null;
  authors: string[];
  tags: string[];
  status: string | null;
  cover: string | null;
};

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

async function bytes(file: File, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

/// The bytes of an archive's central directory, found from its tail.
async function centralDirectory(file: File): Promise<Uint8Array> {
  await initParser();

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

  wasm.check_central_directory_size(cdSize);

  return bytes(file, cdOffset, cdOffset + cdSize);
}

export async function indexZip(file: File): Promise<ZipEntry[]> {
  return wasm.parse_central_directory(await centralDirectory(file));
}

export async function extractEntry(file: File, entry: ZipEntry): Promise<Blob> {
  await initParser();

  // Checked before reading anything, so a zip bomb is rejected on its declared
  // sizes rather than after a huge read; decode_entry caps the inflating.
  wasm.check_entry_size(entry.name, entry.compressedSize, entry.uncompressedSize);

  const header = await bytes(file, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const dataStart = entry.localHeaderOffset + wasm.local_header_data_offset(header);
  const raw = await bytes(file, dataStart, dataStart + entry.compressedSize);

  const data = wasm.decode_entry(
    raw,
    entry.compressionMethod,
    entry.crc32,
    entry.uncompressedSize,
    entry.name
  );
  // wasm-bindgen hands back a fresh Uint8Array copied out of the wasm heap; the
  // cast only tells TypeScript its buffer is not a SharedArrayBuffer.
  return new Blob([data as Uint8Array<ArrayBuffer>]);
}

/// The image entries of a chapter archive, in reading order.
export async function pageEntries(file: File): Promise<ZipEntry[]> {
  return wasm.page_entries(await centralDirectory(file));
}

/// Sorts names the way the server sorts chapters.
export async function sortNames(names: string[]): Promise<string[]> {
  await initParser();
  return wasm.sort_names(names);
}

async function comicInfoXml(file: File): Promise<string | null> {
  const entries = await indexZip(file);
  const entry = entries.find((e) => /(^|\/)comicinfo\.xml$/i.test(e.name));
  if (!entry) return null;
  return (await extractEntry(file, entry)).text();
}

/// ComicInfo metadata and cover of a manga folder, given its files.
export async function mangaMeta(files: File[]): Promise<RawMangaMeta> {
  await initParser();
  const byName = new Map(files.map((f) => [f.name, f]));
  const sources: { archives: string[]; cover: string | null } = wasm.meta_sources([
    ...byName.keys()
  ]);
  const xmls: string[] = [];
  for (const name of sources.archives) {
    // A corrupt archive just contributes nothing.
    const xml = await comicInfoXml(byName.get(name)!).catch(() => null);
    if (xml) xmls.push(xml);
  }
  return wasm.merge_comic_info(xmls, sources.cover ?? undefined);
}
