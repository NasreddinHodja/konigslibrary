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
// The container plumbing (root-owned files, named volumes) is in lib/docker.js.
import { DIST, buildImage, reportDist, runInContainer } from './lib/docker.js';

const IMAGE = 'konigslibrary-appimage';
const DOCKERFILE = 'docker/appimage-build.Dockerfile';

buildImage(IMAGE, DOCKERFILE, 'build the AppImage');

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

const steps = [
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
];

console.log('Building the AppImage in the container...');
runInContainer(IMAGE, steps);

reportDist('.AppImage', 'AppImage');
