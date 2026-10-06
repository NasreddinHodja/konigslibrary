//! The server's own HTTPS: `KL_TLS_CERT` (the full chain) and `KL_TLS_KEY`.
//!
//! A renewed certificate is picked up without a restart: the files are
//! checked every minute, and reloaded when either has changed.

use std::io;
use std::net::IpAddr;
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

/// Whether other networks can route to `ip`: not a private, loopback,
/// link-local, shared (carrier-grade NAT) or documentation address.
pub fn is_public(ip: IpAddr) -> bool {
  match ip {
    IpAddr::V4(v4) => {
      let [a, b, ..] = v4.octets();
      let shared = a == 100 && (64..128).contains(&b);
      !(v4.is_private()
        || v4.is_loopback()
        || v4.is_link_local()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_documentation()
        || shared)
    }
    IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
      Some(v4) => is_public(IpAddr::V4(v4)),
      None => {
        !(v6.is_loopback()
          || v6.is_unspecified()
          || v6.is_unique_local()
          || v6.is_unicast_link_local())
      }
    },
  }
}

/// A warning for a server speaking plain HTTP where the internet reaches it
/// with no proxy in front to add HTTPS: logins and sessions would cross it in
/// the clear. `bound` is the address it listens on; for `0.0.0.0` or `::`,
/// `outward`, the one the host reaches the internet from, is what's exposed.
pub fn plain_http_warning(
  https: bool,
  proxied: bool,
  bound: IpAddr,
  outward: Option<IpAddr>,
) -> Option<String> {
  if https || proxied {
    return None;
  }
  let exposed = if bound.is_unspecified() {
    outward?
  } else {
    bound
  };
  is_public(exposed).then(|| {
    format!(
      "Serving plain HTTP on {exposed}, a public address: passwords and sessions cross the internet unencrypted. \
       Set KL_TLS_CERT and KL_TLS_KEY, or put a reverse proxy with HTTPS in front \
       (HOST=127.0.0.1 KL_TRUSTED_PROXIES=127.0.0.1)."
    )
  })
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

  fn ip(s: &str) -> IpAddr {
    s.parse().unwrap()
  }

  #[test]
  fn only_addresses_other_networks_reach_are_public() {
    for public in [
      "201.33.84.19",
      "8.8.8.8",
      "2606:4700::1",
      "::ffff:201.33.84.19",
    ] {
      assert!(is_public(ip(public)), "{public}");
    }
    for local in [
      "192.168.0.100",
      "10.1.2.3",
      "172.16.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "100.64.0.1",
      "100.127.255.254",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:192.168.0.1",
    ] {
      assert!(!is_public(ip(local)), "{local}");
    }
    // Just outside the shared range.
    assert!(is_public(ip("100.128.0.1")));
  }

  #[test]
  fn plain_http_on_a_public_address_is_warned_about() {
    let public = ip("201.33.84.19");
    let warning = plain_http_warning(false, false, public, None).unwrap();
    assert!(warning.contains("201.33.84.19"), "{warning}");
    // Bound everywhere: what's exposed is the address the host goes out from.
    assert!(plain_http_warning(false, false, ip("0.0.0.0"), Some(public)).is_some());
    assert!(plain_http_warning(false, false, ip("::"), Some(public)).is_some());
  }

  #[test]
  fn https_a_proxy_or_a_private_address_needs_no_warning() {
    let public = ip("201.33.84.19");
    assert!(plain_http_warning(true, false, public, None).is_none());
    assert!(plain_http_warning(false, true, public, None).is_none());
    // Behind the proxy, bound to loopback.
    assert!(plain_http_warning(false, false, ip("127.0.0.1"), Some(public)).is_none());
    // Share to LAN on a home network.
    let lan = Some(ip("192.168.0.100"));
    assert!(plain_http_warning(false, false, ip("0.0.0.0"), lan).is_none());
    // No route out: nothing to say.
    assert!(plain_http_warning(false, false, ip("0.0.0.0"), None).is_none());
  }
}
