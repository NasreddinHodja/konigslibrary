#!/usr/bin/env bun
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';

// Only Linux desktop is built/released today (see .github/workflows) — revisit if
// Windows/macOS builds are added.
const TARGET = 'x86_64-unknown-linux-gnu';
const BIN_DIR = 'src-tauri/binaries';
const ASSETS_DIR = `${BIN_DIR}/konigslibrary-server-assets`;

console.log('Building local server (adapter-node)...');
execSync('vite build', { stdio: 'inherit', env: { ...process.env, LOCAL_BUILD: '1' } });

// `bun build --compile` embeds import.meta.url as a virtual /$bunfs/... path, so
// adapter-node's default static-asset directory (derived from import.meta.url) can
// never resolve on disk. Patch in an env override so the sidecar can be pointed at
// a real, shipped client/ directory at spawn time.
const envPath = 'build/env.js';
const marker = 'const dir = path.dirname(fileURLToPath(import.meta.url));';
const replacement =
  'const dir = process.env.KL_STATIC_DIR || path.dirname(fileURLToPath(import.meta.url));';
const envSrc = readFileSync(envPath, 'utf8');
if (!envSrc.includes(marker)) {
  console.error(
    `Expected line not found in ${envPath} — adapter-node output may have changed:\n  ${marker}`
  );
  process.exit(1);
}
writeFileSync(envPath, envSrc.replace(marker, replacement));

mkdirSync(BIN_DIR, { recursive: true });
const outfile = `${BIN_DIR}/konigslibrary-server-${TARGET}`;
console.log(`Compiling sidecar binary to ${outfile}...`);
// Must stay on the same filesystem as the project directory: bun build --compile
// creates a temp file in cwd, and copying it to an outfile on a different
// filesystem (e.g. tmpfs) silently fails (EXDEV) while still exiting 0.
execSync(`bun build --compile --outfile=${outfile} server.js`, { stdio: 'inherit' });

rmSync(ASSETS_DIR, { recursive: true, force: true });
cpSync('build/client', `${ASSETS_DIR}/client`, { recursive: true });
if (existsSync('build/prerendered')) {
  cpSync('build/prerendered', `${ASSETS_DIR}/prerendered`, { recursive: true });
}

console.log(`Sidecar ready: ${outfile}`);
console.log(`Static assets: ${ASSETS_DIR}`);
