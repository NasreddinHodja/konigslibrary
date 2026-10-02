#!/usr/bin/env bun
// Generates a manga directory of made-up manga for development, laid out like
// a real one: a folder per manga holding .cbz chapters (tiny solid-colour PNG
// pages and a ComicInfo.xml) and, for most, a cover.png. Output is the same
// every run.
//
//   bun scripts/gen-dev-library.js [--count N] [--chapters N] [--pages N]
//                                  [--out DIR] [--force] [--if-missing]
//
// --chapters 0 makes empty manga folders, for listing very large libraries
// without writing an archive per manga.
//
// Alongside them, a fixed "Order - …" manga per chapter-ordering rule, whose
// summary lists the order its chapters should show in.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const OUT = arg('out', 'dev-library');
const COUNT = Number(arg('count', 500));
const CHAPTERS = Number(arg('chapters', 3));
const PAGES = Number(arg('pages', 4));

if (existsSync(OUT)) {
  if (flag('if-missing')) process.exit(0);
  if (!flag('force')) {
    console.error(`${OUT} already exists — pass --force to replace it.`);
    process.exit(1);
  }
  rmSync(OUT, { recursive: true });
}

// --- deterministic randomness ---

let seed = 0x6b6c;
function rand() {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(rand() * list.length)];

// --- names ---

// Mixed case, accents, punctuation and digits on purpose: they are what the
// collation has to get right.
const FIRST = [
  'Akira',
  'Berserk',
  'Blue',
  'Chainsaw',
  'Dorohedoro',
  'Élan',
  'Ōkami',
  'ghost',
  'Hunter',
  'Iron',
  'Jujutsu',
  'Kaiju',
  'Last',
  'Monster',
  'Night',
  'One',
  'Pluto',
  'Quiet',
  'Red',
  'Silent',
  'Tokyo',
  'Ultra',
  'Vagabond',
  'White',
  'Xeno',
  'Yotsuba',
  'Zero',
  '_Hidden',
  '100',
  '20th Century',
  "Witch's",
  'Æther',
  'über'
];
const SECOND = [
  'Blade',
  'Boy',
  'City',
  'Dragon',
  'Eater',
  'Flame',
  'Garden',
  'Heart',
  'Island',
  'Journey',
  'Knight',
  'Lotus',
  'Moon',
  'Noise',
  'Orbit',
  'Piece',
  'Queen',
  'River',
  'Sword',
  'Tale',
  'Undead',
  'Voice',
  'Wolf',
  'X',
  'Youth',
  'Zone',
  'no Hana',
  '& Co.',
  '- Rebirth'
];
const SUFFIX = ['', '', '', '', ' 2', ' II', ' (Remastered)', ' - Side Story', ' vol. 3', '!'];
const WRITERS = [
  'Oda Eiichiro',
  'Urasawa Naoki',
  'Miura Kentaro',
  'Hayashida Q',
  'Takahashi Rumiko'
];
const GENRES = ['Action', 'Drama', 'Horror', 'Comedy', 'Sci-Fi', 'Romance', 'Mystery'];

function names(count) {
  const seen = new Set();
  const out = [];
  while (out.length < count) {
    let name = `${pick(FIRST)} ${pick(SECOND)}${pick(SUFFIX)}`;
    if (seen.has(name)) name = `${name} ${out.length}`;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// --- PNG ---

const crc32 = (bytes) => Bun.hash.crc32(bytes) >>> 0;

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}

/// A `w`×`h` RGB image of `rgb`, with a darker band at `band` (0..1), if given, so
/// consecutive pages can be told apart.
function png(w, h, rgb, band) {
  const row = Buffer.alloc(1 + w * 3);
  const dark = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    row.set(rgb, 1 + x * 3);
    dark.set(
      rgb.map((c) => c >> 2),
      1 + x * 3
    );
  }
  const bandTop = Math.floor(band * (h - h / 10));
  const rows = [];
  for (let y = 0; y < h; y++)
    rows.push(band !== null && y >= bandTop && y < bandTop + h / 10 ? dark : row);
  const ihdr = Buffer.concat([u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- ZIP (stored entries, UTF-8 names) ---

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// --- ComicInfo ---

const xmlEscape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function comicInfo(title, number) {
  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Series>${xmlEscape(title)}</Series>
  <Number>${number}</Number>
  <Summary>A made-up manga for testing konigslibrary.</Summary>
  <Year>${1980 + Math.floor(rand() * 45)}</Year>
  <Writer>${pick(WRITERS)}</Writer>
  <Genre>${pick(GENRES)}, ${pick(GENRES)}</Genre>
</ComicInfo>
`);
}

/// A chapter's ComicInfo for the ordering cases: `number` is written as given,
/// so a non-numeric one can be tested too.
function orderComicInfo(title, summary, number) {
  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Series>${xmlEscape(title)}</Series>
  ${number === undefined ? '' : `<Number>${xmlEscape(String(number))}</Number>`}
  <Summary>${xmlEscape(summary)}</Summary>
</ComicInfo>
`);
}

// Each case's chapters are listed shuffled; `expected` is the order they
// should show in, by file name without the extension.
const ORDER_CASES = [
  {
    name: 'Order - Unpadded numbers',
    files: [['ch10'], ['ch2'], ['ch1.5'], ['ch1']],
    expected: ['ch1', 'ch1.5', 'ch2', 'ch10']
  },
  {
    name: 'Order - Volumes then loose chapters',
    files: [['Ch 21'], ['Vol 2 Ch 15'], ['Vol 1'], ['Ch 20'], ['Vol 2']],
    expected: ['Vol 1', 'Vol 2', 'Vol 2 Ch 15', 'Ch 20', 'Ch 21']
  },
  {
    name: 'Order - Marker styles',
    files: [['Tome 1 Chapter 4'], ['Berserk v01 c003'], ['vol1 chp.1'], ['Vol. 1 Ch. 2.5']],
    expected: ['vol1 chp.1', 'Vol. 1 Ch. 2.5', 'Berserk v01 c003', 'Tome 1 Chapter 4']
  },
  {
    name: 'Order - Bare numbers and brackets',
    files: [['Beelzebub_100 (2012) [KSH]'], ['Beelzebub_53[KSH]'], ['Beelzebub_7[KSH]']],
    expected: ['Beelzebub_7[KSH]', 'Beelzebub_53[KSH]', 'Beelzebub_100 (2012) [KSH]']
  },
  {
    name: 'Order - Words that look like markers',
    files: [['Witch 12'], ['Love Witch 7'], ['Witch 3']],
    expected: ['Witch 3', 'Love Witch 7', 'Witch 12']
  },
  {
    name: 'Order - ComicInfo Number overrides',
    files: [
      ['a', 3],
      ['b', 1],
      ['c', 4],
      ['d', 2],
      ['ch 9', 'Special']
    ],
    expected: ['b', 'd', 'a', 'c', 'ch 9']
  },
  {
    name: 'Order - Unnumbered last',
    files: [['Extras'], ['ch 2'], ['Bonus'], ['ch 1']],
    expected: ['ch 1', 'ch 2', 'Bonus', 'Extras']
  },
  {
    name: 'Order - Legacy chapter names',
    files: [['chapter_0010-00'], ['chapter_0002-05'], ['chapter_0002-00']],
    expected: ['chapter_0002-00 (Ch. 2)', 'chapter_0002-05 (Ch. 2.5)', 'chapter_0010-00 (Ch. 10)']
  }
];

// --- output ---

mkdirSync(OUT, { recursive: true });
const started = performance.now();
const list = names(COUNT);

for (const [i, name] of list.entries()) {
  const dir = join(OUT, name);
  mkdirSync(dir);
  if (CHAPTERS === 0) continue;

  const rgb = [64 + rand() * 191, 64 + rand() * 191, 64 + rand() * 191].map(Math.floor);
  // Some titles differ from the folder name, like a real ComicInfo would.
  const title = rand() < 0.2 ? `${name} (Official)` : name;

  if (rand() < 0.7) writeFileSync(join(dir, 'cover.png'), png(60, 90, rgb, null));
  for (let c = 1; c <= CHAPTERS; c++) {
    const pages = [];
    for (let p = 1; p <= PAGES; p++) {
      pages.push({
        name: `${String(p).padStart(3, '0')}.png`,
        data: png(120, 180, rgb, PAGES > 1 ? (p - 1) / (PAGES - 1) : 0)
      });
    }
    pages.push({ name: 'ComicInfo.xml', data: comicInfo(title, c) });
    writeFileSync(join(dir, `Chapter ${String(c).padStart(3, '0')}.cbz`), zip(pages));
  }

  if ((i + 1) % 1000 === 0) process.stdout.write(`\r${i + 1}/${COUNT}`);
}

if (CHAPTERS > 0) {
  for (const { name, files, expected } of ORDER_CASES) {
    const dir = join(OUT, name);
    mkdirSync(dir);
    const rgb = [64 + rand() * 191, 64 + rand() * 191, 64 + rand() * 191].map(Math.floor);
    const summary = `Expected order: ${expected.join(', ')}`;
    for (const [file, number] of files) {
      const pages = [];
      for (let p = 1; p <= PAGES; p++) {
        pages.push({
          name: `${String(p).padStart(3, '0')}.png`,
          data: png(120, 180, rgb, PAGES > 1 ? (p - 1) / (PAGES - 1) : 0)
        });
      }
      pages.push({ name: 'ComicInfo.xml', data: orderComicInfo(name, summary, number) });
      writeFileSync(join(dir, `${file}.cbz`), zip(pages));
    }
  }
}

const secs = ((performance.now() - started) / 1000).toFixed(1);
console.log(`\r${COUNT} manga written to ${OUT}/ in ${secs}s`);
