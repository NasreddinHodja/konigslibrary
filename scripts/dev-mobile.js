#!/usr/bin/env bun
// Runs a server on the LAN and the Android app in dev mode, for testing a
// phone against it:
//
//   (default)  klserver on 0.0.0.0:KL_SERVER_PORT, serving MANGA_DIR
//   --share    the desktop app instead; Settings → Share to LAN starts its
//              server. The sidecar is rebuilt first, so it isn't a stale one.
//
// The phone's app gets its own Vite on 5174: tauri.conf.json's devUrl is 5173,
// which the desktop app's Vite holds. The wasm parser is built once here
// rather than by each app's `bun dev`, which would write the same files at
// the same time.
import { spawn, spawnSync } from 'node:child_process';

const share = process.argv.includes('--share');
const port = process.env.KL_SERVER_PORT || '3000';
const PHONE_VITE_PORT = 5174;

const children = [];
let shuttingDown = false;

function start(name, cmd, args, env) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n${name} exited (${signal || code}), stopping.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  // The whole process group, not just our children: each `tauri dev` starts
  // a Vite that outlives a SIGTERM to the CLI and keeps its port.
  try {
    process.kill(0, 'SIGTERM');
  } catch {
    for (const child of children) child.kill('SIGTERM');
  }
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

function runOnce(cmd, args) {
  const { status } = spawnSync(cmd, args, { stdio: 'inherit' });
  if (status !== 0) process.exit(status ?? 1);
}

if (share) runOnce('bun', ['run', 'build:sidecar']);
else runOnce('bun', ['run', 'build:wasm']);

if (share) {
  start('desktop app', 'bun', [
    'tauri',
    'dev',
    '-c',
    JSON.stringify({ build: { beforeDevCommand: 'vite dev' } })
  ]);
} else {
  // Its banner prints the address to type on the phone, and the setup token
  // on first run.
  start(
    'konigslibrary-server',
    'cargo',
    ['run', '--manifest-path', 'crates/Cargo.toml', '-p', 'klserver'],
    {
      PORT: port,
      HOST: '0.0.0.0',
      NO_BROWSER: '1',
      MANGA_DIR: process.env.MANGA_DIR || 'dev-library',
      // Its own index and accounts, apart from the real server's in the repo
      // root (see dev-local.js).
      ...(process.env.MANGA_DIR
        ? {}
        : {
            KL_DB: process.env.KL_DB || 'dev-library/.konigslibrary.db',
            KL_AUTH_DB: process.env.KL_AUTH_DB || 'dev-library/.konigslibrary-auth.db'
          })
    }
  );
}

start('android app', 'bun', [
  'tauri',
  'android',
  'dev',
  '-c',
  JSON.stringify({
    build: {
      devUrl: `http://localhost:${PHONE_VITE_PORT}`,
      beforeDevCommand: `vite dev --port ${PHONE_VITE_PORT} --strictPort`
    }
  })
]);
