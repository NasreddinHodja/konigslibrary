#!/usr/bin/env bun
// Runs the two halves of the self-hosted deployment side by side: the klserver
// API on KL_SERVER_PORT and the Vite dev server, which proxies /api to it (see
// vite.config.ts). Pass --host to expose Vite on the LAN.
import { spawn } from 'node:child_process';

const port = process.env.KL_SERVER_PORT || '3000';
const host = process.argv.includes('--host');

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
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

start(
  'konigslibrary-server',
  'cargo',
  ['run', '--manifest-path', 'crates/Cargo.toml', '-p', 'klserver'],
  { PORT: port, HOST: '127.0.0.1', NO_BROWSER: '1' }
);

start('vite', 'vite', host ? ['dev', '--host'] : ['dev'], { LOCAL_BUILD: '1' });
