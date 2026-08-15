use serde::Serialize;
use std::net::{TcpListener, UdpSocket};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{path::BaseDirectory, AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

pub struct Running {
  child: Child,
  port: u16,
  lan_ip: String,
}

#[derive(Default)]
pub struct LanServerState(pub Mutex<Option<Running>>);

#[derive(Serialize, Clone)]
pub struct LanServerStatus {
  running: bool,
  url: Option<String>,
  port: Option<u16>,
}

fn free_port() -> Result<u16, String> {
  let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
  Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

fn lan_ip() -> Result<String, String> {
  // No packet is actually sent; connect() just picks the outbound route so we
  // can read back the LAN-facing local address.
  let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
  socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
  Ok(
    socket
      .local_addr()
      .map_err(|e| e.to_string())?
      .ip()
      .to_string(),
  )
}

#[tauri::command]
pub async fn start_lan_server(
  app: AppHandle,
  state: State<'_, LanServerState>,
  manga_dir: String,
  port: Option<u16>,
) -> Result<LanServerStatus, String> {
  if let Some(running) = &*state.0.lock().unwrap() {
    return Ok(LanServerStatus {
      running: true,
      url: Some(format!("http://{}:{}", running.lan_ip, running.port)),
      port: Some(running.port),
    });
  }

  let port = match port {
    Some(p) => p,
    None => free_port()?,
  };
  let ip = lan_ip()?;

  let assets_dir = app
    .path()
    .resolve(
      "binaries/konigslibrary-server-assets",
      BaseDirectory::Resource,
    )
    .map_err(|e| e.to_string())?;

  let server_bin = assets_dir.join(format!("konigslibrary-server{}", std::env::consts::EXE_SUFFIX));

  // Spawned through tokio directly rather than tauri-plugin-shell's sidecar
  // API. A sidecar has to be declared in bundle.externalBin, and Tauri's
  // bundler patches a __TAURI_BUNDLE_TYPE marker into every externalBin
  // binary for update detection — when the marker is absent, as it is in any
  // non-Tauri binary, it corrupts the file rather than skipping it, which
  // broke AppImage bundling. This server ships as a plain bundle.resources
  // entry, which the bundler leaves alone, and plain resources cannot be
  // reached through .sidecar().
  let mut child = Command::new(&server_bin)
    .env("MANGA_DIR", &manga_dir)
    .env("PORT", port.to_string())
    .env("HOST", "0.0.0.0")
    .env("NO_BROWSER", "1")
    // KL_STATIC_DIR is the static root itself, not the directory holding it.
    .env(
      "KL_STATIC_DIR",
      assets_dir.join("client").to_string_lossy().to_string(),
    )
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true)
    .spawn()
    .map_err(|e| format!("could not start {}: {e}", server_bin.display()))?;

  // Drain both pipes, or the child blocks once a pipe buffer fills.
  for stream in [
    child
      .stdout
      .take()
      .map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
    child
      .stderr
      .take()
      .map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
  ]
  .into_iter()
  .flatten()
  {
    tauri::async_runtime::spawn(async move {
      let mut lines = BufReader::new(stream).lines();
      while let Ok(Some(line)) = lines.next_line().await {
        log::info!("[lan-server] {line}");
      }
    });
  }

  let client = reqwest::Client::new();
  let ready_url = format!("http://127.0.0.1:{port}/api/library");
  let mut ready = false;
  for _ in 0..20 {
    let ok = client
      .get(&ready_url)
      .timeout(Duration::from_millis(300))
      .send()
      .await
      .map(|r| r.status().is_success())
      .unwrap_or(false);
    if ok {
      ready = true;
      break;
    }
    tokio::time::sleep(Duration::from_millis(150)).await;
  }

  if !ready {
    let _ = child.start_kill();
    // A child that already exited usually means the binary is missing or not
    // executable, which is worth saying plainly rather than reporting a timeout.
    let detail = match child.try_wait() {
      Ok(Some(status)) => format!("server exited early ({status})"),
      _ => "server did not become ready".to_string(),
    };
    return Err(detail);
  }

  let url = format!("http://{ip}:{port}");
  *state.0.lock().unwrap() = Some(Running {
    child,
    port,
    lan_ip: ip,
  });

  Ok(LanServerStatus {
    running: true,
    url: Some(url),
    port: Some(port),
  })
}

#[tauri::command]
pub fn stop_lan_server(state: State<'_, LanServerState>) -> Result<(), String> {
  if let Some(mut running) = state.0.lock().unwrap().take() {
    running.child.start_kill().map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
pub fn lan_server_status(state: State<'_, LanServerState>) -> LanServerStatus {
  match &*state.0.lock().unwrap() {
    Some(running) => LanServerStatus {
      running: true,
      url: Some(format!("http://{}:{}", running.lan_ip, running.port)),
      port: Some(running.port),
    },
    None => LanServerStatus {
      running: false,
      url: None,
      port: None,
    },
  }
}

pub fn kill_if_running(state: &LanServerState) {
  if let Some(mut running) = state.0.lock().unwrap().take() {
    let _ = running.child.start_kill();
  }
}
