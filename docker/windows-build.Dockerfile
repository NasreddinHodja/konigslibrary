# Cross-compiles the Windows build from Linux: cargo-xwin supplies the MSVC
# CRT/Windows SDK (downloaded from Microsoft under its own license, hence
# XWIN_ACCEPT_LICENSE below) so rustc can target x86_64-pc-windows-msvc
# without a real Windows machine. NSIS's compiler (makensis) is itself a
# portable, natively-Linux-buildable tool, not a Windows-only one, so the
# installer step doesn't need Wine.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    file \
    unzip \
    ca-certificates \
    build-essential \
    pkg-config \
    libssl-dev \
    clang \
    lld \
    llvm \
    nsis \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# The archive parser is a Rust crate compiled two ways: natively into the
# konigslibrary-server binary (here, cross-compiled to Windows), and to wasm
# for the browser. wasm-bindgen-cli must match the version pinned in
# crates/klwasm/Cargo.toml.
RUN rustup target add wasm32-unknown-unknown x86_64-pc-windows-msvc \
    && cargo install -f wasm-bindgen-cli --version 0.2.99 \
    && cargo install cargo-xwin

# cargo-xwin downloads the MSVC CRT and Windows SDK headers/libs from
# Microsoft on first use; this accepts the license non-interactively so it
# works unattended in a container.
ENV XWIN_ACCEPT_LICENSE=1

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /workspace
