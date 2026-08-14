#!/usr/bin/env bun
// Builds the AppImage inside the Ubuntu LTS container from
// docker/appimage-build.Dockerfile.
//
// This is not an optional convenience. linuxdeploy bundles its own `strip`,
// which is too old to parse the `.relr.dyn` sections in a rolling-release
// distro's system libraries, so bundling on an Arch host fails on essentially
// every library it copies in. Building against an older LTS base is also what
// AppImage's own portability guidance calls for.
//
// The container writes as root into the bind-mounted repo, which used to leave
// .svelte-kit/, build/ and src-tauri/binaries/ owned by root and unbuildable
// afterwards. Two things prevent that here: the expensive target directories
// are named volumes rather than bind mounts, and an EXIT trap chowns the
// workspace back to the invoking user even when the build fails.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

const IMAGE = 'konigslibrary-appimage';
const DOCKERFILE = 'docker/appimage-build.Dockerfile';
const DIST = 'dist';

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
  console.error('docker not found — required to build the AppImage.');
  process.exit(1);
}
if (!existsSync(DOCKERFILE)) {
  console.error(`${DOCKERFILE} not found.`);
  process.exit(1);
}

const uid = process.getuid();
const gid = process.getgid();

console.log(`Building the ${IMAGE} image...`);
// The Dockerfile COPYs nothing, so the context can be the docker/ dir itself
// rather than the whole repo.
run(['docker', 'build', '-f', DOCKERFILE, '-t', IMAGE, 'docker']);

mkdirSync(DIST, { recursive: true });

// Libraries that must be the host's, not the container's. linuxdeploy copies
// in whatever the built binaries link against, but the Wayland client libraries
// have to match the compositor the app actually runs under — bundling Ubuntu's
// against an Arch host makes EGL initialisation fail outright with
// "Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...".
// This is the same reason libGL/libEGL/libdrm are never bundled.
//
// linuxdeploy has --exclude-library, but Tauri invokes it internally with no
// way to pass extra arguments. It does leave the AppDir behind, so the fix is
// to drop the libraries from it and repack.
const HOST_LIBS = 'libwayland-*';

const inner = [
  `trap 'chown -R ${uid}:${gid} /workspace' EXIT`,
  'set -e',
  'bun install --frozen-lockfile',
  'bun run build:desktop:host',
  'appdir=$(ls -d src-tauri/target/release/bundle/appimage/*.AppDir | head -1)',
  'name=$(basename $(ls src-tauri/target/release/bundle/appimage/*.AppImage | head -1))',
  `echo "Dropping host-provided libraries from the AppDir: ${HOST_LIBS}"`,
  `rm -f "$appdir"/usr/lib/${HOST_LIBS}`,
  `mkdir -p /workspace/${DIST}`,
  // FUSE is not available inside the container, hence extract-and-run.
  // xz, not the default gzip: appimagetool supports only those two, and gzip
  // costs ~8MB against the compression Tauri's own packing step used.
  `ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 appimagetool --comp xz "$appdir" "/workspace/${DIST}/$name"`
].join('\n');

console.log('Building the AppImage in the container...');
// The target directories are named volumes rather than bind mounts: sharing one
// target dir between the host's rustc and the container's makes cargo
// refingerprint and rebuild everything on every switch.
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
  IMAGE,
  'bash',
  '-lc',
  inner
]);

const built = readdirSync(DIST).filter((f) => f.endsWith('.AppImage'));
if (built.length === 0) {
  console.error(`No .AppImage landed in ${DIST}/.`);
  process.exit(1);
}
for (const f of built) {
  const mb = (statSync(`${DIST}/${f}`).size / 1024 / 1024).toFixed(1);
  console.log(`\nAppImage: ${DIST}/${f} (${mb} MB)`);
}
