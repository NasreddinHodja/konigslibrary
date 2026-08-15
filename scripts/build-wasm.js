#!/usr/bin/env bun
// Compiles crates/klwasm to wasm and generates its JS bindings into
// src/lib/zip/wasm/, which is gitignored — `bun run build:wasm` is a
// prerequisite of `check`, `test` and `build`.
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

const CRATES = 'crates';
const OUT_DIR = 'src/lib/zip/wasm';
const WASM = `${CRATES}/target/wasm32-unknown-unknown/release/klwasm.wasm`;

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function has(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

if (!has('cargo')) {
  console.error('cargo not found — install Rust from https://rustup.rs to build the parser.');
  process.exit(1);
}

if (!has('wasm-bindgen')) {
  console.error(
    'wasm-bindgen not found. Install the CLI matching the pinned crate version:\n' +
      '  cargo install -f wasm-bindgen-cli --version 0.2.99'
  );
  process.exit(1);
}

console.log('Building klwasm (wasm32-unknown-unknown, release)...');
run(
  `cargo build --manifest-path ${CRATES}/Cargo.toml -p klwasm --target wasm32-unknown-unknown --release`
);

if (!existsSync(WASM)) {
  console.error(`Expected ${WASM} to exist after the build.`);
  process.exit(1);
}

console.log(`Generating bindings into ${OUT_DIR}...`);
rmSync(OUT_DIR, { recursive: true, force: true });
run(`wasm-bindgen --target web --out-dir ${OUT_DIR} --out-name klwasm ${WASM}`);

console.log(`Parser ready: ${OUT_DIR}/klwasm.js`);
