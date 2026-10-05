use serde::Serialize;
use std::collections::HashMap;
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc, Mutex, OnceLock,
};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::offline::{offline_dir, validate_path_component};

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
  pub current: u64,
  pub total: u64,
}

pub struct DownloadState(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

/// Progress is reported at most once per this many bytes.
const PROGRESS_STEP: u64 = 256 * 1024;

/// How often a download waiting on the network checks whether it was cancelled.
const CANCEL_POLL: Duration = Duration::from_millis(250);

/// One client for every download. Without the timeouts (reqwest has none by
/// default) a server that stops sending mid-file would leave the download
/// waiting forever.
fn client() -> &'static reqwest::Client {
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  CLIENT.get_or_init(|| {
    reqwest::Client::builder()
      .connect_timeout(Duration::from_secs(10))
      .read_timeout(Duration::from_secs(30))
      .build()
      .unwrap_or_default()
  })
}

/// Downloads one file of a manga (a chapter archive or the cover) into
/// `offline/<slug>/<file_name>`, so the downloads folder is laid out like the
/// library it came from. A file that is already there is not fetched again.
/// `token` is the server session's, sent as `Authorization: Bearer`.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn download_file(
  app: AppHandle,
  state: State<'_, DownloadState>,
  id: String,
  slug: String,
  file_name: String,
  url: String,
  token: Option<String>,
  channel: Channel<DownloadProgress>,
) -> Result<(), String> {
  let cancelled = Arc::new(AtomicBool::new(false));
  state
    .0
    .lock()
    .unwrap_or_else(|e| e.into_inner())
    .insert(id.clone(), cancelled.clone());

  let result = run(
    &app,
    &slug,
    &file_name,
    &url,
    token.as_deref(),
    &channel,
    &cancelled,
  )
  .await;

  state
    .0
    .lock()
    .unwrap_or_else(|e| e.into_inner())
    .remove(&id);
  result
}

async fn run(
  app: &AppHandle,
  slug: &str,
  file_name: &str,
  url: &str,
  token: Option<&str>,
  channel: &Channel<DownloadProgress>,
  cancelled: &AtomicBool,
) -> Result<(), String> {
  validate_path_component(slug)?;
  validate_path_component(file_name)?;
  let dir = offline_dir(app)?.join(slug);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  let dest = dir.join(file_name);
  if dest.exists() {
    return Ok(());
  }
  // Written under another name and renamed at the end, so an interrupted
  // download never looks like a finished chapter.
  let part = dir.join(format!("{file_name}.part"));

  let result = fetch(url, token, &part, channel, cancelled).await;
  match result {
    Ok(()) => std::fs::rename(&part, &dest).map_err(|e| e.to_string()),
    Err(e) => {
      let _ = std::fs::remove_file(&part);
      Err(e)
    }
  }
}

async fn fetch(
  url: &str,
  token: Option<&str>,
  part: &std::path::Path,
  channel: &Channel<DownloadProgress>,
  cancelled: &AtomicBool,
) -> Result<(), String> {
  use std::io::Write;

  let mut request = client().get(url);
  if let Some(token) = token {
    request = request.bearer_auth(token);
  }
  let mut resp = request.send().await.map_err(|e| e.to_string())?;
  if !resp.status().is_success() {
    return Err(format!("HTTP {} for {}", resp.status(), url));
  }
  let total = resp.content_length().unwrap_or(0);
  let mut file = std::fs::File::create(part).map_err(|e| e.to_string())?;

  let mut current = 0u64;
  let mut reported = 0u64;
  loop {
    if cancelled.load(Ordering::Relaxed) {
      return Err("Cancelled".to_string());
    }
    // Waited on in short slices so a cancel lands while nothing arrives. A
    // slice running out drops the wait, which loses nothing: reqwest only
    // takes a chunk off the body once it is there.
    let Ok(next) = tokio::time::timeout(CANCEL_POLL, resp.chunk()).await else {
      continue;
    };
    let Some(chunk) = next.map_err(|e| e.to_string())? else {
      break;
    };
    file.write_all(&chunk).map_err(|e| e.to_string())?;
    current += chunk.len() as u64;
    if current - reported >= PROGRESS_STEP {
      reported = current;
      let _ = channel.send(DownloadProgress { current, total });
    }
  }
  let _ = channel.send(DownloadProgress { current, total });
  file.sync_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>, id: String) {
  if let Some(flag) = state.0.lock().unwrap_or_else(|e| e.into_inner()).get(&id) {
    flag.store(true, Ordering::Relaxed);
  }
}
