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

// KL_TARGET cross-compiles the server (e.g. x86_64-pc-windows-msvc via
// cargo-xwin, from build-windows.js). Without it, this targets the host,
// matching whatever platform this script is running on.
const TARGET = process.env.KL_TARGET || '';
const IS_WINDOWS = TARGET ? TARGET.includes('windows') : process.platform === 'win32';
const EXE = IS_WINDOWS ? '.exe' : '';
const SERVER_BIN = `crates/target/${TARGET ? `${TARGET}/` : ''}release/konigslibrary-server${EXE}`;

function run(cmd, env) {
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
}

console.log('Building the static frontend (adapter-static)...');
// LOCAL_BUILD, not TAURI_BUILD: this copy is what a phone's browser loads over
// the LAN, and it needs __LOCAL_BUILD__ set so it talks to its own origin's API.
run('bun scripts/build-wasm.js');
run('vite build', { LOCAL_BUILD: '1' });

console.log('Building konigslibrary-server (release)...');
// cargo-xwin provides the MSVC CRT/SDK needed to cross-compile a Windows
// target from a non-Windows host; a native build (no KL_TARGET, or KL_TARGET
// matching the host) uses plain cargo.
const cargoBin = TARGET && IS_WINDOWS && process.platform !== 'win32' ? 'cargo xwin' : 'cargo';
const targetFlag = TARGET ? ` --target ${TARGET}` : '';
run(`${cargoBin} build --manifest-path crates/Cargo.toml -p klserver --release${targetFlag}`);

if (!existsSync(SERVER_BIN)) {
  console.error(`Expected ${SERVER_BIN} to exist after the build.`);
  process.exit(1);
}

rmSync(ASSETS_DIR, { recursive: true, force: true });
mkdirSync(ASSETS_DIR, { recursive: true });

// The server resolves its static root from KL_STATIC_DIR, which lan_server.rs
// points at this directory.
cpSync('build', `${ASSETS_DIR}/client`, { recursive: true });

const out = `${ASSETS_DIR}/konigslibrary-server${EXE}`;
copyFileSync(SERVER_BIN, out);
// Windows doesn't have a unix mode bit; the exe is already runnable as-is.
if (!IS_WINDOWS) chmodSync(out, 0o755);

const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`Server binary: ${out} (${mb} MB)`);
console.log(`Static assets: ${ASSETS_DIR}/client`);
