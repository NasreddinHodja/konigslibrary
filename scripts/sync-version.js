#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: bun version <major.minor.patch>');
  process.exit(1);
}

// package.json
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.version = version;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// tauri.conf.json
const tauriConf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
tauriConf.version = version;
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConf, null, 2) + '\n');

// Cargo.toml
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
writeFileSync('src-tauri/Cargo.toml', cargo.replace(/^version = ".*"/m, `version = "${version}"`));

console.log(`bumped to ${version}`);
