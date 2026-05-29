#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/NasreddinHodja/konigslibrary"
BUN_VERSION="1.2.15"

# ---------- helpers ----------
die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "=> $*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not found"
}

# ---------- resolve working directory ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------- 1. ensure bun ----------
get_bun() {
  local OS ARCH
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"

  case "$OS" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)      die "Unsupported OS: $OS" ;;
  esac

  case "$ARCH" in
    x86_64)       ARCH="x64" ;;
    aarch64|arm64) ARCH="aarch64" ;;
    *)             die "Unsupported architecture: $ARCH" ;;
  esac

  local ZIP="bun-${OS}-${ARCH}.zip"
  local URL="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${ZIP}"

  info "Downloading Bun $BUN_VERSION ($OS-$ARCH)..."
  need_cmd curl
  curl -fSL --progress-bar "$URL" -o "$ZIP"
  mkdir -p bun
  unzip -jo "$ZIP" "*/bun" -d bun
  chmod +x bun/bun
  rm "$ZIP"
  info "Bun installed to ./bun/"
}

HAS_BUN=0
if command -v bun >/dev/null 2>&1; then
  HAS_BUN=1
fi

if [ -x "./bun/bun" ]; then
  export PATH="$SCRIPT_DIR/bun:$PATH"
  HAS_BUN=1
fi

if [ "$HAS_BUN" -eq 0 ]; then
  get_bun
  export PATH="$SCRIPT_DIR/bun:$PATH"
fi

info "Using $(bun --version) at $(command -v bun)"

# ---------- 2. get the app source + build ----------
if [ ! -d "build" ]; then
  info "Downloading konigslibrary source..."
  need_cmd curl
  curl -fSL "$REPO_URL/archive/refs/heads/main.tar.gz" -o repo.tar.gz
  tar xf repo.tar.gz --strip-components=1
  rm repo.tar.gz

  info "Installing dependencies..."
  bun install --frozen-lockfile

  info "Building (adapter-node)..."
  LOCAL_BUILD=1 bun run build

  info "Build complete."
fi

# ---------- 3. launch ----------
info "Starting server..."
exec bun server.js
