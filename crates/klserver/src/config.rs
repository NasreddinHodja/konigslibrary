//! The configured manga directory.
//!
//! Port of `getMangaDir` / `saveMangaDir` / `readConfig` from
//! `src/lib/server/library.ts`. The config file is re-read on every lookup, not
//! cached: `POST /api/settings` has to take effect for the very next request
//! without a restart.

use std::fs;
use std::path::PathBuf;

use crate::pathutil::{expand_home_with, resolve};

#[derive(Debug, Clone)]
pub struct Config {
  /// `MANGA_DIR`, which takes priority over the config file.
  env_manga_dir: Option<String>,
  /// Where `konigslibrary.json` lives — the process working directory in
  /// production, a temp directory in tests.
  config_path: PathBuf,
  cwd: PathBuf,
  home: String,
}

impl Config {
  pub fn from_env() -> Self {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let home = crate::pathutil::home_dir()
      .map(|h| h.to_string_lossy().into_owned())
      .unwrap_or_default();
    Self {
      env_manga_dir: std::env::var("MANGA_DIR").ok().filter(|v| !v.is_empty()),
      config_path: cwd.join("konigslibrary.json"),
      cwd,
      home,
    }
  }

  /// Builds a config with everything pinned explicitly, so tests never touch
  /// process-global state.
  #[cfg(test)]
  pub fn for_test(cwd: &std::path::Path, home: &str, env_manga_dir: Option<&str>) -> Self {
    Self {
      env_manga_dir: env_manga_dir.map(str::to_string),
      config_path: cwd.join("konigslibrary.json"),
      cwd: cwd.to_path_buf(),
      home: home.to_string(),
    }
  }

  #[cfg(test)]
  pub fn config_path(&self) -> &std::path::Path {
    &self.config_path
  }

  pub fn home(&self) -> &str {
    &self.home
  }

  fn read_config_manga_dir(&self) -> Option<String> {
    let raw = fs::read_to_string(&self.config_path).ok()?;
    // An unparseable config is ignored rather than fatal, as before.
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let dir = value.get("mangaDir")?.as_str()?;
    if dir.is_empty() {
      return None;
    }
    Some(dir.to_string())
  }

  /// `None` when no manga directory has been configured at all.
  pub fn manga_dir(&self) -> Option<PathBuf> {
    let raw = match &self.env_manga_dir {
      Some(dir) => dir.clone(),
      None => self.read_config_manga_dir()?,
    };
    Some(resolve(&self.cwd, &expand_home_with(&raw, &self.home)))
  }

  /// The value reported by `GET /api/settings`: the empty string when unset,
  /// matching what the settings UI expects.
  pub fn manga_dir_display(&self) -> String {
    self
      .manga_dir()
      .map(|p| p.to_string_lossy().into_owned())
      .unwrap_or_default()
  }

  /// Writes `konigslibrary.json`, expanding `~` before saving so the stored
  /// value is already absolute.
  pub fn save_manga_dir(&self, dir: &str) -> std::io::Result<()> {
    let expanded = expand_home_with(dir, &self.home);
    let body = serde_json::json!({ "mangaDir": expanded });
    fs::write(
      &self.config_path,
      format!("{}\n", serde_json::to_string_pretty(&body)?),
    )
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::Path;

  fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().expect("temp dir")
  }

  #[test]
  fn env_var_takes_priority_over_the_config_file() {
    let dir = tmp();
    let cfg = Config::for_test(dir.path(), "/home/tester", Some("/from/env"));
    cfg.save_manga_dir("/from/config").unwrap();

    assert_eq!(cfg.manga_dir().as_deref(), Some(Path::new("/from/env")));
  }

  #[test]
  fn falls_back_to_the_config_file_when_the_env_var_is_unset() {
    let dir = tmp();
    let cfg = Config::for_test(dir.path(), "/home/tester", None);
    cfg.save_manga_dir("/from/config").unwrap();

    assert_eq!(cfg.manga_dir().as_deref(), Some(Path::new("/from/config")));
  }

  #[test]
  fn expands_tilde_in_the_env_var() {
    let dir = tmp();
    let cfg = Config::for_test(dir.path(), "/home/tester", Some("~/Manga"));
    assert_eq!(
      cfg.manga_dir().as_deref(),
      Some(Path::new("/home/tester/Manga"))
    );
  }

  #[test]
  fn expands_tilde_before_saving_to_the_config_file() {
    let dir = tmp();
    let cfg = Config::for_test(dir.path(), "/home/tester", None);
    cfg.save_manga_dir("~/Manga").unwrap();

    let raw = std::fs::read_to_string(cfg.config_path()).unwrap();
    assert!(
      raw.contains("/home/tester/Manga"),
      "stored config was: {raw}"
    );
    assert!(
      !raw.contains('~'),
      "tilde should be expanded before saving: {raw}"
    );
    assert_eq!(
      cfg.manga_dir().as_deref(),
      Some(Path::new("/home/tester/Manga"))
    );
  }

  #[test]
  fn is_unset_when_neither_source_provides_a_directory() {
    let dir = tmp();
    let cfg = Config::for_test(dir.path(), "/home/tester", None);
    assert_eq!(cfg.manga_dir(), None);
    assert_eq!(cfg.manga_dir_display(), "");
  }

  #[test]
  fn an_empty_manga_dir_in_the_config_counts_as_unset() {
    let dir = tmp();
    let cfg = Config::for_test(dir.path(), "/home/tester", None);
    std::fs::write(cfg.config_path(), r#"{"mangaDir":""}"#).unwrap();
    assert_eq!(cfg.manga_dir(), None);
  }

  #[test]
  fn an_invalid_config_file_is_ignored_rather_than_fatal() {
    let dir = tmp();
    let cfg = Config::for_test(dir.path(), "/home/tester", None);
    std::fs::write(cfg.config_path(), "{ not json at all").unwrap();
    assert_eq!(cfg.manga_dir(), None);
  }

  #[test]
  fn a_relative_directory_is_resolved_against_the_working_directory() {
    let dir = tmp();
    let cfg = Config::for_test(dir.path(), "/home/tester", Some("Manga"));
    assert_eq!(cfg.manga_dir().as_deref(), Some(&*dir.path().join("Manga")));
  }

  #[test]
  fn saving_then_reading_reflects_the_new_value_without_a_restart() {
    let dir = tmp();
    let cfg = Config::for_test(dir.path(), "/home/tester", None);
    cfg.save_manga_dir("/first").unwrap();
    assert_eq!(cfg.manga_dir().as_deref(), Some(Path::new("/first")));
    cfg.save_manga_dir("/second").unwrap();
    assert_eq!(cfg.manga_dir().as_deref(), Some(Path::new("/second")));
  }
}
