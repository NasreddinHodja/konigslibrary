//! konigslibrary's local server.
//!
//! Replaces `server.js` (SvelteKit adapter-node behind a vendored ~88MB bun
//! runtime) for both deployments that need a backend: the desktop app's
//! "Share to LAN" sidecar, and the standalone self-hosted install driven by
//! `konigslibrary.service`. The browser-only deployment still needs no server
//! at all — that path runs the same parser compiled to wasm.

mod config;
mod library;
mod pathutil;
mod routes;
mod zipcache;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use config::Config;
use routes::{AppState, SharedState};
use zipcache::ZipCache;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
  let port: u16 = std::env::var("PORT")
    .ok()
    .and_then(|p| p.parse().ok())
    .unwrap_or(3000);
  let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
  let static_dir = static_dir();

  let state: SharedState = Arc::new(AppState {
    config: Config::from_env(),
    cache: ZipCache::new(),
    static_dir,
  });

  let addr: SocketAddr = format!("{host}:{port}").parse()?;
  let listener = tokio::net::TcpListener::bind(addr).await?;
  let bound = listener.local_addr()?;

  print_banner(bound.port());
  if std::env::var("NO_BROWSER").is_err() {
    open_browser(bound.port());
  }

  // ConnectInfo is what the localhost-only guard on the settings routes reads,
  // so the service has to be built with it.
  axum::serve(
    listener,
    routes::router(state).into_make_service_with_connect_info::<SocketAddr>(),
  )
  .await?;

  Ok(())
}

/// Where the built SPA lives. `KL_STATIC_DIR` is set by the desktop app, which
/// unpacks the client build into its resource directory.
fn static_dir() -> PathBuf {
  if let Ok(dir) = std::env::var("KL_STATIC_DIR") {
    return PathBuf::from(dir);
  }
  // Next to the binary, as shipped; falls back to the repo layout in dev.
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      let candidate = dir.join("client");
      if candidate.is_dir() {
        return candidate;
      }
    }
  }
  PathBuf::from("build-local")
}

fn print_banner(port: u16) {
  println!("\nkonigslibrary running on:");
  println!("  Local:   http://localhost:{port}");
  for addr in lan_addresses() {
    println!("  Network: http://{addr}:{port}");
  }
  println!();
}

/// Every non-loopback IPv4 address on the host, so the user can see which URL
/// to open on their phone.
fn lan_addresses() -> Vec<String> {
  // Reading the routing table would need a dependency; asking the OS which
  // local address it would use to reach the internet gets the same answer for
  // the single-interface case that matters here. No packet is sent.
  let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") else {
    return Vec::new();
  };
  if socket.connect("8.8.8.8:80").is_err() {
    return Vec::new();
  }
  match socket.local_addr() {
    Ok(addr) if !addr.ip().is_loopback() => vec![addr.ip().to_string()],
    _ => Vec::new(),
  }
}

fn open_browser(port: u16) {
  let url = format!("http://localhost:{port}");
  let opener = if cfg!(target_os = "macos") {
    "open"
  } else if cfg!(target_os = "windows") {
    "explorer"
  } else {
    "xdg-open"
  };
  // Best-effort: a headless host simply has nothing to open.
  let _ = std::process::Command::new(opener).arg(&url).spawn();
}
