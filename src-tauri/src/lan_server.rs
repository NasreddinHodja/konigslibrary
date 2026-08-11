use serde::Serialize;
use std::net::{TcpListener, UdpSocket};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{path::BaseDirectory, AppHandle, Manager, State};
use tauri_plugin_shell::{
  process::{CommandChild, CommandEvent},
  ShellExt,
};

pub struct Running {
  child: CommandChild,
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
  Ok(socket.local_addr().map_err(|e| e.to_string())?.ip().to_string())
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

  let (mut rx, child) = app
    .shell()
    .sidecar("konigslibrary-server")
    .map_err(|e| e.to_string())?
    .env("MANGA_DIR", &manga_dir)
    .env("PORT", port.to_string())
    .env("HOST", "0.0.0.0")
    .env("NO_BROWSER", "1")
    .env("KL_STATIC_DIR", assets_dir.to_string_lossy().to_string())
    .spawn()
    .map_err(|e| e.to_string())?;

  tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
      match event {
        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
          log::info!("[lan-server] {}", String::from_utf8_lossy(&line));
        }
        _ => {}
      }
    }
  });

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
    let _ = child.kill();
    return Err("server did not become ready".to_string());
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
  if let Some(running) = state.0.lock().unwrap().take() {
    running.child.kill().map_err(|e| e.to_string())?;
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
  if let Some(running) = state.0.lock().unwrap().take() {
    let _ = running.child.kill();
  }
}
