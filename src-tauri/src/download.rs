use std::collections::HashMap;
use std::sync::{
  atomic::{AtomicBool, Ordering},
  Arc, Mutex,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri::ipc::Channel;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerChapter {
  pub name: String,
  pub slug: Option<String>,
  pub pages: Vec<String>,
  #[serde(rename = "pageCount")]
  pub page_count: usize,
}

#[derive(Serialize, Clone)]
pub struct DownloadProgress {
  pub current: usize,
  pub total: usize,
}

pub struct DownloadState(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

#[tauri::command]
pub async fn download_chapter(
  app: AppHandle,
  state: State<'_, DownloadState>,
  id: String,
  slug: String,
  manga_name: String,
  chapter: ServerChapter,
  page_urls: Vec<String>,
  channel: Channel<DownloadProgress>,
) -> Result<(), String> {
  let cancelled = Arc::new(AtomicBool::new(false));
  state.0.lock().unwrap().insert(id.clone(), cancelled.clone());

  let result = run(&app, &slug, &manga_name, &chapter, &page_urls, &channel, &cancelled).await;

  state.0.lock().unwrap().remove(&id);
  result
}

async fn run(
  app: &AppHandle,
  slug: &str,
  manga_name: &str,
  chapter: &ServerChapter,
  page_urls: &[String],
  channel: &Channel<DownloadProgress>,
  cancelled: &AtomicBool,
) -> Result<(), String> {
  use tauri::Manager;

  let chapter_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?
    .join("offline")
    .join(slug)
    .join(&chapter.name);

  std::fs::create_dir_all(&chapter_dir).map_err(|e| e.to_string())?;

  let client = reqwest::Client::new();
  let total = page_urls.len();

  for (i, url) in page_urls.iter().enumerate() {
    if cancelled.load(Ordering::Relaxed) {
      return Err("Cancelled".to_string());
    }

    let filename = chapter.pages[i].split('/').last().unwrap_or(&chapter.pages[i]);
    let file_path = chapter_dir.join(filename);

    if !file_path.exists() {
      let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
      if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), url));
      }
      let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
      std::fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;
    }

    let _ = channel.send(DownloadProgress { current: i + 1, total });
  }

  crate::offline::save_chapter_meta(app, slug, manga_name, chapter).await
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>, id: String) {
  if let Some(flag) = state.0.lock().unwrap().get(&id) {
    flag.store(true, Ordering::Relaxed);
  }
}
