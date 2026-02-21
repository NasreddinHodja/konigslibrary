import { crc32 } from './crc32';

export function createZip(entries: { name: string; data: Uint8Array }[]): Blob {
  const encoder = new TextEncoder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];
  const central: { nameBuf: Uint8Array; crc: number; size: number; offset: number }[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header (30 bytes + name)
    const lh = new ArrayBuffer(30);
    const lv = new DataView(lh);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 1 << 11, true); // flags: UTF-8
    lv.setUint16(8, 0, true); // compression: store
    // skip time/date (bytes 10-13)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, nameBuf.length, true);
    // extra field length stays 0

    parts.push(lh, nameBuf, entry.data);
    central.push({ nameBuf, crc, size, offset });
    offset += 30 + nameBuf.length + size;
  }

  const cdStart = offset;
  let cdSize = 0;

  for (const { nameBuf, crc, size, offset: localOffset } of central) {
    const ch = new ArrayBuffer(46);
    const cv = new DataView(ch);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 1 << 11, true); // flags: UTF-8
    cv.setUint16(10, 0, true); // compression: store
    // skip time/date (bytes 12-15)
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true); // compressed size
    cv.setUint32(24, size, true); // uncompressed size
    cv.setUint16(28, nameBuf.length, true);
    // extra field length, comment length, disk number, internal attrs stay 0
    cv.setUint32(42, localOffset, true); // local header offset

    parts.push(ch, nameBuf);
    cdSize += 46 + nameBuf.length;
  }

  // End of central directory (22 bytes)
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true); // signature
  // disk number, disk with CD stay 0
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  // comment length stays 0

  parts.push(eocd);
  return new Blob(parts, { type: 'application/zip' });
}
