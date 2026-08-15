#!/usr/bin/env bun
// Cross-compiles the Windows NSIS installer inside the container from
// docker/windows-build.Dockerfile, so it can be built and tested from this
// Linux machine without a real Windows box. See that Dockerfile for why
// cargo-xwin + NSIS work here without Wine.
//
// This is a local testing path, not the release path: actual releases build
// natively on a windows-latest GitHub Actions runner (release-windows.yml),
// which is far less fiddly than cross-compiling. Use this script to sanity
// check a change before pushing a tag.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

const IMAGE = 'konigslibrary-windows-build';
const DOCKERFILE = 'docker/windows-build.Dockerfile';
const DIST = 'dist';
const TARGET = 'x86_64-pc-windows-msvc';

function run(args, opts = {}) {
  execFileSync(args[0], args.slice(1), { stdio: 'inherit', ...opts });
}

function has(cmd) {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!has('docker')) {
  console.error('docker not found — required to cross-compile the Windows build.');
  process.exit(1);
}
if (!existsSync(DOCKERFILE)) {
  console.error(`${DOCKERFILE} not found.`);
  process.exit(1);
}

const uid = process.getuid();
const gid = process.getgid();

console.log(`Building the ${IMAGE} image...`);
run(['docker', 'build', '-f', DOCKERFILE, '-t', IMAGE, 'docker']);

mkdirSync(DIST, { recursive: true });

const inner = [
  `trap 'chown -R ${uid}:${gid} /workspace' EXIT`,
  'set -e',
  'bun install --frozen-lockfile',
  `export KL_TARGET=${TARGET}`,
  'bun run build:sidecar',
  'bun run clean:kit',
  'bun run prepare',
  `bun tauri build --runner cargo-xwin --target ${TARGET}`,
  `mkdir -p /workspace/${DIST}`,
  `installer=$(ls src-tauri/target/${TARGET}/release/bundle/nsis/*.exe | head -1)`,
  `cp "$installer" /workspace/${DIST}/`
].join('\n');

console.log('Cross-compiling the Windows build in the container...');
console.log(
  'First run downloads the MSVC CRT/Windows SDK (cargo-xwin) — expect several GB and a long wait.'
);
run([
  'docker',
  'run',
  '--rm',
  '-v',
  `${process.cwd()}:/workspace`,
  '-v',
  'konigslibrary-tauri-target:/workspace/src-tauri/target',
  '-v',
  'konigslibrary-crates-target:/workspace/crates/target',
  '-v',
  'konigslibrary-node-modules:/workspace/node_modules',
  '-v',
  'konigslibrary-cargo-registry-win:/root/.cargo/registry',
  '-v',
  'konigslibrary-xwin-cache:/root/.cache',
  IMAGE,
  'bash',
  '-lc',
  inner
]);

const built = readdirSync(DIST).filter((f) => f.endsWith('.exe'));
if (built.length === 0) {
  console.error(`No installer .exe landed in ${DIST}/.`);
  process.exit(1);
}
for (const f of built) {
  const mb = (statSync(`${DIST}/${f}`).size / 1024 / 1024).toFixed(1);
  console.log(`\nWindows installer: ${DIST}/${f} (${mb} MB)`);
}
