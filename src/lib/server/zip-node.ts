import { open, type FileHandle } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

export type NodeZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
};

const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_LOC_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CD_SIG = 0x02014b50;

function getUint64(dv: DataView, offset: number): number {
  const lo = dv.getUint32(offset, true);
  const hi = dv.getUint32(offset + 4, true);
  return lo + hi * 0x100000000;
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
    const cd = new DataView(cdBuf.buffer, cdBuf.byteOffset, cdBuf.byteLength);

    const entries: NodeZipEntry[] = [];
    let pos = 0;
    while (pos < cdBuf.byteLength) {
      if (cd.getUint32(pos, true) !== CD_SIG) break;

      const compressionMethod = cd.getUint16(pos + 10, true);
      let compressedSize: number = cd.getUint32(pos + 20, true);
      let uncompressedSize: number = cd.getUint32(pos + 24, true);
      const nameLen = cd.getUint16(pos + 28, true);
      const extraLen = cd.getUint16(pos + 30, true);
      const commentLen = cd.getUint16(pos + 32, true);
      let localHeaderOffset: number = cd.getUint32(pos + 42, true);

      if (
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff
      ) {
        let exPos = pos + 46 + nameLen;
        const exEnd = exPos + extraLen;
        while (exPos + 4 <= exEnd) {
          const id = cd.getUint16(exPos, true);
          const sz = cd.getUint16(exPos + 2, true);
          if (id === 0x0001) {
            let fp = exPos + 4;
            if (uncompressedSize === 0xffffffff) {
              uncompressedSize = getUint64(cd, fp);
              fp += 8;
            }
            if (compressedSize === 0xffffffff) {
              compressedSize = getUint64(cd, fp);
              fp += 8;
            }
            if (localHeaderOffset === 0xffffffff) {
              localHeaderOffset = getUint64(cd, fp);
            }
            break;
          }
          exPos += 4 + sz;
        }
      }

      const name = cdBuf.subarray(pos + 46, pos + 46 + nameLen).toString('utf-8');

      if (!name.endsWith('/')) {
        entries.push({
          name,
          compressedSize,
          uncompressedSize,
          compressionMethod,
          localHeaderOffset
        });
      }

      pos += 46 + nameLen + extraLen + commentLen;
    }

    return entries;
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
