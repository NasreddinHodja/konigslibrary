#!/usr/bin/env bun
// Packages the LAN-sharing server for the desktop bundle: the native
// konigslibrary-server binary plus the static SPA it serves.
//
// This used to vendor a whole bun runtime (~88MB of a ~114MB AppImage) to
// execute ~450 lines of our own JavaScript. That code is now the klserver
// crate, so the payload is a single ~2MB binary.
//
// It ships as a `bundle.resources` entry rather than `bundle.externalBin`.
// Tauri's bundler patches a __TAURI_BUNDLE_TYPE marker into every externalBin
// sidecar for update detection; when the marker isn't present — true for any
// binary Tauri didn't build — it corrupts the file instead of skipping it,
// which crashes on startup and breaks AppImage bundling. Plain resources are
// not run through that patching pass at all.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, copyFileSync, chmodSync, statSync } from 'node:fs';

const BIN_DIR = 'src-tauri/binaries';
const ASSETS_DIR = `${BIN_DIR}/konigslibrary-server-assets`;
const SERVER_BIN = 'crates/target/release/konigslibrary-server';

function run(cmd, env) {
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
}

console.log('Building the static frontend (adapter-static)...');
// LOCAL_BUILD, not TAURI_BUILD: this copy is what a phone's browser loads over
// the LAN, and it needs __LOCAL_BUILD__ set so it talks to its own origin's API.
run('bun scripts/build-wasm.js');
run('vite build', { LOCAL_BUILD: '1' });

console.log('Building konigslibrary-server (release)...');
run('cargo build --manifest-path crates/Cargo.toml -p klserver --release');

if (!existsSync(SERVER_BIN)) {
  console.error(`Expected ${SERVER_BIN} to exist after the build.`);
  process.exit(1);
}

rmSync(ASSETS_DIR, { recursive: true, force: true });
mkdirSync(ASSETS_DIR, { recursive: true });

// The server resolves its static root from KL_STATIC_DIR, which lan_server.rs
// points at this directory.
cpSync('build', `${ASSETS_DIR}/client`, { recursive: true });

const out = `${ASSETS_DIR}/konigslibrary-server`;
copyFileSync(SERVER_BIN, out);
chmodSync(out, 0o755);

const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`Server binary: ${out} (${mb} MB)`);
console.log(`Static assets: ${ASSETS_DIR}/client`);
