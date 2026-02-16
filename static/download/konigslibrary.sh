#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/NasreddinHodja/konigslibrary"
NODE_VERSION="22.16.0"
MIN_NODE=22

# ---------- helpers ----------
die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "=> $*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not found"
}

# ---------- resolve working directory ----------
# Everything lives next to this script (or in CWD if piped)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------- 1. ensure Node >= 22 ----------
get_node() {
  local OS ARCH
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"

  case "$OS" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)      die "Unsupported OS: $OS" ;;
  esac

  case "$ARCH" in
    x86_64)  ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)       die "Unsupported architecture: $ARCH" ;;
  esac

  local TARBALL="node-v${NODE_VERSION}-${OS}-${ARCH}.tar.xz"
  local URL="https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"

  info "Downloading Node.js $NODE_VERSION ($OS-$ARCH)..."
  need_cmd curl
  curl -fSL --progress-bar "$URL" -o "$TARBALL"
  mkdir -p node
  tar xf "$TARBALL" --strip-components=1 -C node
  rm "$TARBALL"
  info "Node.js installed to ./node/"
}

HAS_NODE=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  if [ "$NODE_MAJOR" -ge "$MIN_NODE" ] 2>/dev/null; then
    HAS_NODE=1
  fi
fi

if [ -x "./node/bin/node" ]; then
  export PATH="$SCRIPT_DIR/node/bin:$PATH"
  HAS_NODE=1
fi

if [ "$HAS_NODE" -eq 0 ]; then
  get_node
  export PATH="$SCRIPT_DIR/node/bin:$PATH"
fi

info "Using $(node -v) at $(command -v node)"

# ---------- 2. get the app source + build ----------
if [ ! -d "build" ]; then
  info "Downloading konigslibrary source..."
  need_cmd curl
  curl -fSL "$REPO_URL/archive/refs/heads/main.tar.gz" -o repo.tar.gz
  tar xf repo.tar.gz --strip-components=1
  rm repo.tar.gz

  info "Installing dependencies..."
  npm install --no-fund --no-audit

  info "Building (adapter-node)..."
  LOCAL_BUILD=1 npm run build

  info "Build complete."
fi

# ---------- 3. launch ----------
info "Starting server..."
exec node server.js
