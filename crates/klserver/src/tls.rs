//! The server's own HTTPS: `KL_TLS_CERT` (the full chain) and `KL_TLS_KEY`.
//!
//! A renewed certificate is picked up without a restart: the files are
//! checked every minute, and reloaded when either has changed.

use std::io;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use axum_server::tls_rustls::RustlsConfig;

const CHECK_EVERY: Duration = Duration::from_secs(60);

pub struct Files {
  cert: PathBuf,
  key: PathBuf,
}

/// When each file was last modified.
type Stamp = (SystemTime, SystemTime);

impl Files {
  /// Both or neither.
  pub fn from_env() -> Result<Option<Self>, String> {
    let var = |name| std::env::var_os(name).filter(|v| !v.is_empty());
    match (var("KL_TLS_CERT"), var("KL_TLS_KEY")) {
      (Some(cert), Some(key)) => Ok(Some(Self {
        cert: cert.into(),
        key: key.into(),
      })),
      (None, None) => Ok(None),
      _ => Err("KL_TLS_CERT and KL_TLS_KEY go together".to_string()),
    }
  }

  fn stamp(&self) -> io::Result<Stamp> {
    let modified = |path| std::fs::metadata(path)?.modified();
    Ok((modified(&self.cert)?, modified(&self.key)?))
  }

  pub async fn load(self) -> io::Result<(RustlsConfig, Watcher)> {
    // Stamped first: a change while reading is reloaded next time.
    let loaded = self.stamp()?;
    let config = RustlsConfig::from_pem_file(&self.cert, &self.key).await?;
    let watcher = Watcher {
      files: self,
      config: config.clone(),
      loaded,
      failed: None,
    };
    Ok((config, watcher))
  }
}

pub struct Watcher {
  files: Files,
  config: RustlsConfig,
  loaded: Stamp,
  /// The files that last failed to load, so a broken renewal is reported
  /// once rather than every minute.
  failed: Option<Stamp>,
}

impl Watcher {
  /// Reloads the certificate whenever its files change, for as long as the
  /// server runs.
  pub async fn run(mut self) {
    loop {
      tokio::time::sleep(CHECK_EVERY).await;
      match self.reload_if_changed().await {
        Ok(true) => println!("[konigslibrary] Reloaded the TLS certificate"),
        Ok(false) => {}
        Err(e) => eprintln!(
          "[konigslibrary] Cannot reload the TLS certificate: {e}; keeping the current one"
        ),
      }
    }
  }

  /// `Ok(false)` when nothing changed, or when the files that failed last
  /// time still haven't. On an error the current certificate stays: a
  /// renewal may have replaced the certificate but not yet its key.
  async fn reload_if_changed(&mut self) -> io::Result<bool> {
    let now = self.files.stamp()?;
    if now == self.loaded || Some(now) == self.failed {
      return Ok(false);
    }
    match self
      .config
      .reload_from_pem_file(&self.files.cert, &self.files.key)
      .await
    {
      Ok(()) => {
        self.loaded = now;
        self.failed = None;
        Ok(true)
      }
      Err(e) => {
        self.failed = Some(now);
        Err(e)
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::Path;
  use std::sync::Arc;

  const CERT_A: &str = include_str!("../testdata/cert-a.pem");
  const KEY_A: &str = include_str!("../testdata/key-a.pem");
  const CERT_B: &str = include_str!("../testdata/cert-b.pem");
  const KEY_B: &str = include_str!("../testdata/key-b.pem");

  /// Writes `path` with a modification time `secs` from now, so a change
  /// never lands in the same tick as the last one.
  fn write(path: &Path, body: &str, secs: u64) {
    std::fs::write(path, body).unwrap();
    std::fs::File::options()
      .write(true)
      .open(path)
      .unwrap()
      .set_modified(SystemTime::now() + Duration::from_secs(secs))
      .unwrap();
  }

  async fn watcher(dir: &Path) -> (RustlsConfig, Watcher) {
    let files = Files {
      cert: dir.join("cert.pem"),
      key: dir.join("key.pem"),
    };
    write(&files.cert, CERT_A, 0);
    write(&files.key, KEY_A, 0);
    files.load().await.unwrap()
  }

  #[tokio::test]
  async fn unchanged_files_are_left_alone() {
    let dir = tempfile::tempdir().unwrap();
    let (config, mut w) = watcher(dir.path()).await;
    let before = config.get_inner();
    assert!(!w.reload_if_changed().await.unwrap());
    assert!(Arc::ptr_eq(&before, &config.get_inner()));
  }

  #[tokio::test]
  async fn a_renewed_certificate_is_served() {
    let dir = tempfile::tempdir().unwrap();
    let (config, mut w) = watcher(dir.path()).await;
    let before = config.get_inner();
    write(&w.files.cert, CERT_B, 10);
    write(&w.files.key, KEY_B, 10);
    assert!(w.reload_if_changed().await.unwrap());
    assert!(!Arc::ptr_eq(&before, &config.get_inner()));
    assert!(!w.reload_if_changed().await.unwrap(), "only once");
  }

  #[tokio::test]
  async fn a_half_renewed_pair_keeps_the_current_certificate() {
    let dir = tempfile::tempdir().unwrap();
    let (config, mut w) = watcher(dir.path()).await;
    let before = config.get_inner();

    // The new certificate with the old key.
    write(&w.files.cert, CERT_B, 10);
    assert!(w.reload_if_changed().await.is_err());
    assert!(Arc::ptr_eq(&before, &config.get_inner()));
    assert!(
      !w.reload_if_changed().await.unwrap(),
      "reported once, not every minute"
    );

    write(&w.files.key, KEY_B, 20);
    assert!(w.reload_if_changed().await.unwrap());
    assert!(!Arc::ptr_eq(&before, &config.get_inner()));
  }
}
