export type BaseZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
};

export const EOCD_SIG = 0x06054b50;
export const ZIP64_EOCD_LOC_SIG = 0x07064b50;
export const ZIP64_EOCD_SIG = 0x06064b50;
export const CD_SIG = 0x02014b50;
export const ZIP64_EXTRA_ID = 0x0001;

export function getUint64(dv: DataView, offset: number): number {
  const lo = dv.getUint32(offset, true);
  const hi = dv.getUint32(offset + 4, true);
  return lo + hi * 0x100000000;
}

export function parseCentralDirectory(cdBuf: ArrayBuffer): BaseZipEntry[] {
  const cd = new DataView(cdBuf);
  const entries: BaseZipEntry[] = [];
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
        if (id === ZIP64_EXTRA_ID) {
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

    const nameBytes = new Uint8Array(cdBuf, pos + 46, nameLen);
    const name = new TextDecoder().decode(nameBytes);

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
}
