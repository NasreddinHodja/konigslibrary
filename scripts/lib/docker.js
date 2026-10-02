// What the containerized builds (build-appimage.js, build-windows.js) share:
// building the image, running the build in it against this checkout, and
// reporting what landed in dist/.
//
// The container writes as root into the bind-mounted repo, which used to leave
// .svelte-kit/, build/ and src-tauri/binaries/ owned by root and unbuildable
// afterwards. Two things prevent that here: the expensive target directories
// are named volumes rather than bind mounts, and an EXIT trap chowns the
// workspace back to the invoking user even when the build fails.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';

export const DIST = 'dist';

export function run(args, opts = {}) {
  execFileSync(args[0], args.slice(1), { stdio: 'inherit', ...opts });
}

export function has(cmd) {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/// Builds `image` from `dockerfile`, exiting with `why` if docker is missing.
export function buildImage(image, dockerfile, why) {
  if (!has('docker')) {
    console.error(`docker not found — required to ${why}.`);
    process.exit(1);
  }
  if (!existsSync(dockerfile)) {
    console.error(`${dockerfile} not found.`);
    process.exit(1);
  }
  console.log(`Building the ${image} image...`);
  // The Dockerfiles COPY nothing, so the context can be the docker/ dir itself
  // rather than the whole repo.
  run(['docker', 'build', '-f', dockerfile, '-t', image, 'docker']);
  mkdirSync(DIST, { recursive: true });
}

/// Runs the shell `steps` in `image` with this checkout at /workspace, after
/// installing dependencies. `volumes` adds `name:/path` mounts.
export function runInContainer(image, steps, volumes = []) {
  const inner = [
    `trap 'chown -R ${process.getuid()}:${process.getgid()} /workspace' EXIT`,
    'set -e',
    'bun install --frozen-lockfile',
    ...steps
  ].join('\n');
  // The target directories are named volumes rather than bind mounts: sharing
  // one target dir between the host's rustc and the container's makes cargo
  // refingerprint and rebuild everything on every switch.
  const mounts = [
    `${process.cwd()}:/workspace`,
    'konigslibrary-tauri-target:/workspace/src-tauri/target',
    'konigslibrary-crates-target:/workspace/crates/target',
    'konigslibrary-node-modules:/workspace/node_modules',
    ...volumes
  ].flatMap((v) => ['-v', v]);
  run(['docker', 'run', '--rm', ...mounts, image, 'bash', '-lc', inner]);
}

/// Prints each `ext` file in dist/ with its size, or exits if there is none.
export function reportDist(ext, label) {
  const built = readdirSync(DIST).filter((f) => f.endsWith(ext));
  if (built.length === 0) {
    console.error(`No ${label} landed in ${DIST}/.`);
    process.exit(1);
  }
  for (const f of built) {
    const mb = (statSync(`${DIST}/${f}`).size / 1024 / 1024).toFixed(1);
    console.log(`\n${label}: ${DIST}/${f} (${mb} MB)`);
  }
}
