use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::download::ServerChapter;

#[derive(Serialize, Deserialize, Clone)]
pub struct MangaMeta {
  pub slug: String,
  pub name: String,
  pub chapters: Vec<ServerChapter>,
}

fn offline_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("offline"))
}

pub async fn save_chapter_meta(
  app: &AppHandle,
  slug: &str,
  manga_name: &str,
  chapter: &ServerChapter,
) -> Result<(), String> {
  let dir = offline_dir(app)?.join(slug);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

  let meta_path = dir.join("meta.json");
  let mut meta: MangaMeta = if meta_path.exists() {
    let data = std::fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).unwrap_or(MangaMeta {
      slug: slug.to_string(),
      name: manga_name.to_string(),
      chapters: vec![],
    })
  } else {
    MangaMeta { slug: slug.to_string(), name: manga_name.to_string(), chapters: vec![] }
  };

  if let Some(existing) = meta.chapters.iter_mut().find(|c| c.name == chapter.name) {
    *existing = chapter.clone();
  } else {
    meta.chapters.push(chapter.clone());
  }
  meta.chapters.sort_by(|a, b| a.name.cmp(&b.name));

  std::fs::write(&meta_path, serde_json::to_string(&meta).map_err(|e| e.to_string())?)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_offline_manga(app: AppHandle) -> Result<Vec<MangaMeta>, String> {
  let dir = offline_dir(&app)?;
  if !dir.exists() {
    return Ok(vec![]);
  }

  let mut results = vec![];
  for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let meta_path = entry.path().join("meta.json");
    if meta_path.exists() {
      if let Ok(data) = std::fs::read_to_string(&meta_path) {
        if let Ok(meta) = serde_json::from_str::<MangaMeta>(&data) {
          if !meta.chapters.is_empty() {
            results.push(meta);
          }
        }
      }
    }
  }

  results.sort_by(|a, b| a.name.cmp(&b.name));
  Ok(results)
}

#[tauri::command]
pub async fn get_offline_manga(app: AppHandle, slug: String) -> Result<Option<MangaMeta>, String> {
  let meta_path = offline_dir(&app)?.join(&slug).join("meta.json");
  if !meta_path.exists() {
    return Ok(None);
  }
  let data = std::fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
  Ok(Some(serde_json::from_str(&data).map_err(|e| e.to_string())?))
}

#[tauri::command]
pub async fn get_chapter_page_paths(
  app: AppHandle,
  slug: String,
  chapter_name: String,
  filenames: Vec<String>,
) -> Result<Vec<String>, String> {
  let base = offline_dir(&app)?.join(&slug).join(&chapter_name);
  Ok(filenames.iter().map(|f| base.join(f).to_string_lossy().to_string()).collect())
}

#[tauri::command]
pub async fn delete_offline_manga(app: AppHandle, slug: String) -> Result<(), String> {
  let dir = offline_dir(&app)?.join(&slug);
  if dir.exists() {
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
  }
  Ok(())
}
