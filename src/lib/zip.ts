import {
  type BaseZipEntry,
  EOCD_SIG,
  ZIP64_EOCD_LOC_SIG,
  ZIP64_EOCD_SIG,
  getUint64,
  parseCentralDirectory
} from '$lib/zip-parse';

export type ZipEntry = BaseZipEntry;

export async function indexZip(file: File): Promise<ZipEntry[]> {
  const tailSize = Math.min(file.size, 65536);
  const tailBuf = await file.slice(file.size - tailSize).arrayBuffer();
  const tail = new DataView(tailBuf);

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
      const z64Buf = await file.slice(zip64EocdPos, zip64EocdPos + 56).arrayBuffer();
      const z64 = new DataView(z64Buf);
      if (z64.getUint32(0, true) === ZIP64_EOCD_SIG) {
        cdSize = getUint64(z64, 40);
        cdOffset = getUint64(z64, 48);
      }
    }
  }

  const cdBuf = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  return parseCentralDirectory(cdBuf);
}

export async function extractEntry(file: File, entry: ZipEntry): Promise<Blob> {
  const lhBuf = await file
    .slice(entry.localHeaderOffset, entry.localHeaderOffset + 30)
    .arrayBuffer();
  const lh = new DataView(lhBuf);
  if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('Invalid local file header');
  const nameLen = lh.getUint16(26, true);
  const extraLen = lh.getUint16(28, true);

  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const raw = file.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return raw;
  }
  if (entry.compressionMethod !== 8) {
    throw new Error(`Unsupported compression method: ${entry.compressionMethod}`);
  }

  const ds = new DecompressionStream('deflate-raw');
  const readable = raw.stream().pipeThrough(ds);
  return new Response(readable).blob();
}
