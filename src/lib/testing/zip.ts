/// Builds a zip archive in memory, every entry stored (no compression): enough
/// for the parser to read, without a zip library.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(entries: Record<string, string>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (out: number[], v: number) => out.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (out: number[], v: number) =>
    out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);

  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const offset = local.length;

    u32(local, 0x04034b50);
    [20, 0, 0, 0, 0].forEach((v) => u16(local, v)); // version, flags, method, time, date
    [crc, data.length, data.length].forEach((v) => u32(local, v));
    u16(local, nameBytes.length);
    u16(local, 0);
    local.push(...nameBytes, ...data);

    u32(central, 0x02014b50);
    [20, 20, 0, 0, 0, 0].forEach((v) => u16(central, v)); // made by, needed, flags, method, time, date
    [crc, data.length, data.length].forEach((v) => u32(central, v));
    [nameBytes.length, 0, 0, 0, 0].forEach((v) => u16(central, v)); // name, extra, comment, disk, internal
    u32(central, 0); // external attributes
    u32(central, offset);
    central.push(...nameBytes);
  }

  const end: number[] = [];
  u32(end, 0x06054b50);
  [0, 0, Object.keys(entries).length, Object.keys(entries).length].forEach((v) => u16(end, v));
  u32(end, central.length);
  u32(end, local.length);
  u16(end, 0);
  return new Uint8Array([...local, ...central, ...end]);
}

/// A chapter archive of `pages` images, named 1.jpg, 2.jpg, …, each holding
/// its own name; `extra` adds entries such as a ComicInfo.xml.
export function chapterFile(
  fileName: string,
  pages: number,
  extra: Record<string, string> = {}
): File {
  const entries: Record<string, string> = {};
  for (let i = 1; i <= pages; i++) entries[`${i}.jpg`] = `${fileName} page ${i}`;
  return new File([zip({ ...entries, ...extra })], fileName);
}
