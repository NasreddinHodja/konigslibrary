#!/usr/bin/env bun
// Sums the gzipped size of the built site's JS, CSS and wasm and fails if any
// is over its budget. Prints a Markdown table, for the CI run summary.
//
//   bun scripts/bundle-budget.js [build dir]
//
// Each file is gzipped on its own, as it is served. The budgets are the sizes
// at the time they were set plus about 10%: raise one on purpose, in the same
// change that grows the bundle.
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGETS = { '.js': 133_000, '.css': 9_000, '.wasm': 95_000 };
const DIR = process.argv[2] ?? 'build';

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]
  );

const sizes = Object.fromEntries(Object.keys(BUDGETS).map((ext) => [ext, 0]));
for (const file of files(DIR)) {
  const ext = extname(file);
  if (ext in sizes) sizes[ext] += gzipSync(readFileSync(file), { level: 9 }).length;
}

const kb = (n) => `${(n / 1000).toFixed(1)} kB`;

const rows = [];
let failed = false;
for (const [ext, budget] of Object.entries(BUDGETS)) {
  const over = sizes[ext] > budget;
  failed ||= over;
  rows.push(`| ${ext} | ${kb(sizes[ext])} | ${kb(budget)} | ${over ? '❌' : ''} |`);
}

console.log('## Bundle size\n');
console.log('Gzipped, summed over every file of the type.\n');
console.log('| Type | Size | Budget | |');
console.log('| --- | --- | --- | --- |');
console.log(rows.join('\n'));

if (failed) {
  console.error('\nThe bundle is over budget (scripts/bundle-budget.js).');
  process.exit(1);
}
