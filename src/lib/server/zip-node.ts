import { open, stat as fsStat, type FileHandle } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import {
  type BaseZipEntry,
  EOCD_SIG,
  ZIP64_EOCD_LOC_SIG,
  ZIP64_EOCD_SIG,
  getUint64,
  parseCentralDirectory
} from '$lib/zip/parse';

export type NodeZipEntry = BaseZipEntry;

const zipIndexCache = new Map<string, { entries: NodeZipEntry[]; mtimeMs: number }>();

export async function getCachedIndex(filePath: string): Promise<NodeZipEntry[]> {
  const s = await fsStat(filePath);
  const cached = zipIndexCache.get(filePath);
  if (cached && cached.mtimeMs === s.mtimeMs) return cached.entries;
  const entries = await indexZipFile(filePath);
  zipIndexCache.set(filePath, { entries, mtimeMs: s.mtimeMs });
  return entries;
}

async function readAt(fh: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  await fh.read(buf, 0, length, offset);
  return buf;
}

export async function indexZipFile(filePath: string): Promise<NodeZipEntry[]> {
  const fh = await open(filePath, 'r');
  try {
    const stat = await fh.stat();
    const fileSize = stat.size;

    const tailSize = Math.min(fileSize, 65536);
    const tailBuf = await readAt(fh, fileSize - tailSize, tailSize);
    const tail = new DataView(tailBuf.buffer, tailBuf.byteOffset, tailBuf.byteLength);

    let eocdOffset = -1;
    for (let i = tailBuf.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === EOCD_SIG) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) throw new Error('Not a valid ZIP file');

    let cdOffset = tail.getUint32(eocdOffset + 16, true);
    let cdSize = tail.getUint32(eocdOffset + 12, true);

    if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      const locOffset = eocdOffset - 20;
      if (locOffset >= 0 && tail.getUint32(locOffset, true) === ZIP64_EOCD_LOC_SIG) {
        const zip64EocdPos = getUint64(tail, locOffset + 8);
        const z64Buf = await readAt(fh, zip64EocdPos, 56);
        const z64 = new DataView(z64Buf.buffer, z64Buf.byteOffset, z64Buf.byteLength);
        if (z64.getUint32(0, true) === ZIP64_EOCD_SIG) {
          cdSize = getUint64(z64, 40);
          cdOffset = getUint64(z64, 48);
        }
      }
    }

    const cdBuf = await readAt(fh, cdOffset, cdSize);
    const ab = new Uint8Array(cdBuf).buffer as ArrayBuffer;
    return parseCentralDirectory(ab);
  } finally {
    await fh.close();
  }
}

export async function extractEntryFromFile(filePath: string, entry: NodeZipEntry): Promise<Buffer> {
  const fh = await open(filePath, 'r');
  try {
    const lhBuf = await readAt(fh, entry.localHeaderOffset, 30);
    const lh = new DataView(lhBuf.buffer, lhBuf.byteOffset, lhBuf.byteLength);
    const nameLen = lh.getUint16(26, true);
    const extraLen = lh.getUint16(28, true);

    const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
    const raw = await readAt(fh, dataStart, entry.compressedSize);

    if (entry.compressionMethod === 0) {
      return raw;
    }

    return inflateRawSync(raw);
  } finally {
    await fh.close();
  }
}
