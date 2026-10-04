#!/usr/bin/env bun
// Reads the criterion results of a `--baseline-lenient main` run and fails if
// any bench got slower than main by more than THRESHOLD. Prints a Markdown
// table of every bench, for the CI run summary.
//
//   bun scripts/bench-compare.js [criterion dir]
//
// A bench counts as slower only when criterion's 95% confidence interval for
// the change lies wholly above THRESHOLD: base and head run back to back on
// one runner, but shared runners are still noisy. A bench with no `change/`
// (new, or main had no benches yet) is listed and not judged.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const THRESHOLD = 0.15;
const DIR = process.argv[2] ?? 'crates/target/criterion';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

/// Every bench directory under DIR: the ones holding a `new/` result.
function benches(dir) {
  if (existsSync(join(dir, 'new', 'benchmark.json'))) return [dir];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'report')
    .flatMap((d) => benches(join(dir, d.name)));
}

function time(ns) {
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`;
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`;
  return `${ns.toFixed(0)} ns`;
}

const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

const rows = [];
let failed = false;
for (const dir of benches(DIR).sort()) {
  const { full_id } = json(join(dir, 'new', 'benchmark.json'));
  const mean = json(join(dir, 'new', 'estimates.json')).mean.point_estimate;
  const changeFile = join(dir, 'change', 'estimates.json');
  if (!existsSync(changeFile)) {
    rows.push(`| ${full_id} | ${time(mean)} | new | |`);
    continue;
  }
  const change = json(changeFile).mean;
  const slower = change.confidence_interval.lower_bound > THRESHOLD;
  failed ||= slower;
  const range = `${pct(change.confidence_interval.lower_bound)} … ${pct(change.confidence_interval.upper_bound)}`;
  rows.push(
    `| ${full_id} | ${time(mean)} | ${pct(change.point_estimate)} (${range}) | ${slower ? '❌' : ''} |`
  );
}

console.log('## Benchmarks\n');
console.log(`Mean time, and change against main. Fails past +${THRESHOLD * 100}%.\n`);
console.log('| Bench | Time | Change | |');
console.log('| --- | --- | --- | --- |');
console.log(rows.join('\n'));

if (failed) {
  console.error(`\nA bench is more than ${THRESHOLD * 100}% slower than main.`);
  process.exit(1);
}
