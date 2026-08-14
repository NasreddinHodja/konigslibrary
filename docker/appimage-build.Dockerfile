# Builds the Linux AppImage on a stable Ubuntu LTS base
# instead of the host's system libraries. Per AppImage's own best practices
# (https://docs.appimage.org/reference/best-practices.html), building on a newer
# base than your oldest supported target breaks portability, and on rolling-release
# hosts (Arch) linuxdeploy's bundled gtk plugin is known to crash outright against
# too-new glib. Ubuntu 22.04 doesn't ship libwebkit2gtk-4.1-dev (Tauri v2's hard
# requirement) in its default repos, so 24.04 is the oldest LTS that works cleanly.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    file \
    unzip \
    ca-certificates \
    build-essential \
    libssl-dev \
    libxdo-dev \
    libwebkit2gtk-4.1-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# The archive parser is a Rust crate compiled two ways: natively into the
# konigslibrary-server binary, and to wasm for the browser. The frontend build
# cannot run without both the wasm target and a wasm-bindgen CLI matching the
# version pinned in crates/klwasm/Cargo.toml.
RUN rustup target add wasm32-unknown-unknown \
    && cargo install -f wasm-bindgen-cli --version 0.2.99

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Used to repack the AppDir after dropping libraries that must come from the
# host rather than the build container — see scripts/build-appimage.js.
RUN wget -qO /usr/local/bin/appimagetool \
      https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage \
    && chmod +x /usr/local/bin/appimagetool

WORKDIR /workspace
