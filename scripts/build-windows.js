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
import { DIST, buildImage, reportDist, runInContainer } from './lib/docker.js';

const IMAGE = 'konigslibrary-windows-build';
const DOCKERFILE = 'docker/windows-build.Dockerfile';
const TARGET = 'x86_64-pc-windows-msvc';

buildImage(IMAGE, DOCKERFILE, 'cross-compile the Windows build');

const steps = [
  `export KL_TARGET=${TARGET}`,
  'bun run build:sidecar',
  'bun run clean:kit',
  'bun run prepare',
  `bun tauri build --runner cargo-xwin --target ${TARGET}`,
  `mkdir -p /workspace/${DIST}`,
  `installer=$(ls src-tauri/target/${TARGET}/release/bundle/nsis/*.exe | head -1)`,
  `cp "$installer" /workspace/${DIST}/`
];

console.log('Cross-compiling the Windows build in the container...');
console.log(
  'First run downloads the MSVC CRT/Windows SDK (cargo-xwin) — expect several GB and a long wait.'
);
runInContainer(IMAGE, steps, [
  'konigslibrary-cargo-registry-win:/root/.cargo/registry',
  'konigslibrary-xwin-cache:/root/.cache'
]);

reportDist('.exe', 'Windows installer');
