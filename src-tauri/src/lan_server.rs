use serde::Serialize;
use std::net::{TcpListener, UdpSocket};
use std::path::{Path, PathBuf};
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
  /// Only this app knows it, so only this app can create the admin.
  setup_token: String,
  setup_needed: bool,
}

#[derive(Default)]
pub struct LanServerState(pub Mutex<Option<Running>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LanServerStatus {
  running: bool,
  url: Option<String>,
  port: Option<u16>,
  /// No admin yet: other devices have no account to log in with.
  setup_needed: bool,
}

impl Running {
  fn status(&self) -> LanServerStatus {
    LanServerStatus {
      running: true,
      url: Some(format!("http://{}:{}", self.lan_ip, self.port)),
      port: Some(self.port),
      setup_needed: self.setup_needed,
    }
  }
}

/// Stops the server, if one is running.
fn stop(state: &LanServerState) -> std::io::Result<()> {
  match state.0.lock().unwrap().take() {
    Some(mut running) => running.child.start_kill(),
    None => Ok(()),
  }
}

/// The server's admin and sessions, in the app data directory.
const AUTH_DB: &str = "lan-auth.db";

/// The bundled server and the client it serves.
fn assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .resolve(
      "binaries/konigslibrary-server-assets",
      BaseDirectory::Resource,
    )
    .map_err(|e| e.to_string())
}

fn server_bin(assets_dir: &Path) -> PathBuf {
  assets_dir.join(format!(
    "konigslibrary-server{}",
    std::env::consts::EXE_SUFFIX
  ))
}

fn free_port() -> Result<u16, String> {
  let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
  Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

/// The address other devices on the LAN reach this machine at.
///
/// No packet is actually sent; connecting a UDP socket only picks the route
/// out, whose local address is the LAN-facing one. A public address is tried
/// first; on a network with no internet route, private ranges are, so sharing
/// over a LAN doesn't depend on being online.
fn lan_ip() -> Result<String, String> {
  ["8.8.8.8:80", "192.168.0.1:9", "10.0.0.1:9", "172.16.0.1:9"]
    .into_iter()
    .find_map(|target| {
      let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
      socket.connect(target).ok()?;
      let ip = socket.local_addr().ok()?.ip();
      (!ip.is_unspecified() && !ip.is_loopback()).then(|| ip.to_string())
    })
    .ok_or_else(|| "no network to share the library on".to_string())
}

#[tauri::command]
pub async fn start_lan_server(
  app: AppHandle,
  state: State<'_, LanServerState>,
  manga_dir: String,
  port: Option<u16>,
) -> Result<LanServerStatus, String> {
  if let Some(running) = &*state.0.lock().unwrap() {
    return Ok(running.status());
  }

  let port = match port {
    Some(p) => p,
    None => free_port()?,
  };
  let ip = lan_ip()?;
  let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
  // The shared key from before accounts; nothing reads it any more.
  let _ = std::fs::remove_file(data_dir.join("lan-key"));
  // A new one each start; it only matters until the admin exists.
  let setup_token = klfs::random_hex(16);

  let assets_dir = assets_dir(&app)?;
  let server_bin = server_bin(&assets_dir);

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
    // Its library database: the working directory it inherits may be a
    // read-only install location.
    .env("KL_DB", data_dir.join("lan-library.db"))
    // The admin and sessions, kept across restarts so devices stay logged in.
    .env("KL_AUTH_DB", data_dir.join(AUTH_DB))
    .env("KL_SETUP_TOKEN", &setup_token)
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
  // `/api/ping` answers at once; `/api/library` would sync the whole library
  // first, which on a big folder outlasts every probe.
  let ready_url = format!("http://127.0.0.1:{port}/api/ping");
  let mut ready = false;
  for _ in 0..20 {
    let ok = client
      .get(&ready_url)
      .timeout(Duration::from_millis(300))
      .send()
      .await
      .is_ok_and(|r| r.status().is_success());
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

  let setup_needed = match setup_needed(&client, port).await {
    Ok(needed) => needed,
    Err(e) => {
      let _ = child.start_kill();
      return Err(e);
    }
  };

  let running = Running {
    child,
    port,
    lan_ip: ip,
    setup_token,
    setup_needed,
  };
  let status = running.status();
  *state.0.lock().unwrap() = Some(running);
  Ok(status)
}

/// Whether the server at `port` has no admin yet.
async fn setup_needed(client: &reqwest::Client, port: u16) -> Result<bool, String> {
  let body = client
    .get(format!("http://127.0.0.1:{port}/api/auth/setup"))
    .send()
    .await
    .and_then(|r| r.error_for_status())
    .map_err(|e| e.to_string())?
    .text()
    .await
    .map_err(|e| e.to_string())?;
  serde_json::from_str::<serde_json::Value>(&body)
    .ok()
    .and_then(|v| v["needed"].as_bool())
    .ok_or_else(|| "the server did not say whether it needs setting up".to_string())
}

/// Creates the admin other devices log in as, on the running server.
#[tauri::command]
pub async fn setup_lan_server(
  state: State<'_, LanServerState>,
  username: String,
  password: String,
) -> Result<LanServerStatus, String> {
  let (port, token) = match &*state.0.lock().unwrap() {
    Some(running) => (running.port, running.setup_token.clone()),
    None => return Err("The server isn't running".to_string()),
  };
  let base = format!("http://127.0.0.1:{port}/api/auth");
  let client = reqwest::Client::new();
  let res = client
    .post(format!("{base}/setup"))
    .header(reqwest::header::CONTENT_TYPE, "application/json")
    .body(
      serde_json::json!({
        "token": token,
        "username": username,
        "password": password,
        "client": "bearer",
      })
      .to_string(),
    )
    .send()
    .await
    .map_err(|e| e.to_string())?;
  let ok = res.status().is_success();
  let body: serde_json::Value =
    serde_json::from_str(&res.text().await.map_err(|e| e.to_string())?).unwrap_or_default();
  if !ok {
    return Err(
      body["error"]
        .as_str()
        .unwrap_or("Could not set up the server")
        .to_string(),
    );
  }
  // Setup also logs in, which this app has no use for: it reads the library
  // from disk.
  if let Some(session) = body["token"].as_str() {
    let _ = client
      .post(format!("{base}/logout"))
      .bearer_auth(session)
      .send()
      .await;
  }

  let mut guard = state.0.lock().unwrap();
  match guard.as_mut() {
    Some(running) => {
      running.setup_needed = false;
      Ok(running.status())
    }
    // Stopped while setting up; the admin was still created.
    None => Err("The server stopped".to_string()),
  }
}

/// Forgets the account other devices log in with, for an admin who lost the
/// password: stops the server, then runs its `reset-admin`. Sharing again
/// asks for a new account; every device is logged out.
#[tauri::command]
pub async fn reset_lan_account(
  app: AppHandle,
  state: State<'_, LanServerState>,
) -> Result<(), String> {
  let running = state.0.lock().unwrap().take();
  if let Some(mut running) = running {
    // Waits for it to exit, so it can't serve the old sessions meanwhile.
    let _ = running.child.kill().await;
  }
  let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let server_bin = server_bin(&assets_dir(&app)?);
  let out = Command::new(&server_bin)
    .arg("reset-admin")
    .env("KL_AUTH_DB", data_dir.join(AUTH_DB))
    .output()
    .await
    .map_err(|e| format!("could not start {}: {e}", server_bin.display()))?;
  if !out.status.success() {
    return Err(format!(
      "Could not reset the account: {}",
      String::from_utf8_lossy(&out.stderr).trim()
    ));
  }
  Ok(())
}

#[tauri::command]
pub fn stop_lan_server(state: State<'_, LanServerState>) -> Result<(), String> {
  stop(&state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lan_server_status(state: State<'_, LanServerState>) -> LanServerStatus {
  match &*state.0.lock().unwrap() {
    Some(running) => running.status(),
    None => LanServerStatus {
      running: false,
      url: None,
      port: None,
      setup_needed: false,
    },
  }
}

pub fn kill_if_running(state: &LanServerState) {
  let _ = stop(state);
}
