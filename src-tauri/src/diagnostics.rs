use std::path::{Path, PathBuf};
use tauri::Manager;

/// Where the panic hook leaves the last crash, beside the logs.
const CRASH_FILE: &str = "crash.txt";

/// The app version and platform, heading the logs and crash reports.
fn header(version: &str) -> String {
  format!(
    "konigslibrary {version} ({} {})\n",
    std::env::consts::OS,
    std::env::consts::ARCH
  )
}

/// What a panic leaves behind: its message, where it happened and the
/// backtrace.
fn crash_text(version: &str, message: &str, location: &str, backtrace: &str) -> String {
  format!(
    "{}\npanicked at {location}:\n{message}\n\n{backtrace}\n",
    header(version)
  )
}

/// Writes every panic to `dir`'s crash file, for the next launch to offer
/// reporting, then runs the hook that was there before.
pub fn install_panic_hook(dir: PathBuf, version: String) {
  let previous = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    let payload = info.payload();
    let message = payload
      .downcast_ref::<&str>()
      .copied()
      .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
      .unwrap_or("(no message)");
    let location = info
      .location()
      .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
      .unwrap_or_else(|| "an unknown location".to_string());
    let backtrace = std::backtrace::Backtrace::force_capture().to_string();
    log::error!("panicked at {location}: {message}");
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(
      dir.join(CRASH_FILE),
      crash_text(&version, message, &location, &backtrace),
    );
    previous(info);
  }));
}

/// The log files in `dir`, oldest first: rotated ones carry their date after
/// the name, and the one being written has none.
fn log_files(dir: &Path) -> Vec<PathBuf> {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return Vec::new();
  };
  let mut files: Vec<PathBuf> = entries
    .filter_map(|e| Some(e.ok()?.path()))
    .filter(|p| p.extension().is_some_and(|ext| ext == "log"))
    .collect();
  files.sort_by_key(|p| {
    let stem = p
      .file_stem()
      .unwrap_or_default()
      .to_string_lossy()
      .into_owned();
    (!stem.contains('_'), stem)
  });
  files
}

/// Every log in `dir` as one text, under the version and platform.
fn collect_logs(dir: &Path, version: &str) -> String {
  let mut out = header(version);
  for file in log_files(dir) {
    if let Ok(text) = std::fs::read_to_string(&file) {
      out.push('\n');
      out.push_str(&text);
    }
  }
  out
}

/// The crash file in `dir`, removed so it is offered only once.
fn take_crash(dir: &Path) -> Option<String> {
  let path = dir.join(CRASH_FILE);
  let text = std::fs::read_to_string(&path).ok()?;
  let _ = std::fs::remove_file(&path);
  Some(text)
}

fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app.path().app_log_dir().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn read_logs(app: tauri::AppHandle) -> Result<String, String> {
  Ok(collect_logs(
    &log_dir(&app)?,
    &app.package_info().version.to_string(),
  ))
}

/// The last session's crash, if it had one. Asking clears it.
#[tauri::command]
pub fn take_crash_report(app: tauri::AppHandle) -> Result<Option<String>, String> {
  Ok(take_crash(&log_dir(&app)?))
}

#[cfg(test)]
mod tests {
  use super::*;

  struct TempDir(PathBuf);

  impl TempDir {
    fn new(tag: &str) -> Self {
      let dir = std::env::temp_dir().join(format!(
        "kl-diagnostics-{tag}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
      ));
      let _ = std::fs::remove_dir_all(&dir);
      std::fs::create_dir_all(&dir).unwrap();
      Self(dir)
    }
  }

  impl Drop for TempDir {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn logs_come_oldest_first_under_the_version() {
    let dir = TempDir::new("logs");
    std::fs::write(dir.0.join("app.log"), "current\n").unwrap();
    std::fs::write(dir.0.join("app_2026-10-04_10-00-00.log"), "older\n").unwrap();
    std::fs::write(dir.0.join("app_2026-10-03_10-00-00.log"), "oldest\n").unwrap();
    std::fs::write(dir.0.join(CRASH_FILE), "not a log\n").unwrap();

    let logs = collect_logs(&dir.0, "1.2.3");
    assert!(logs.starts_with("konigslibrary 1.2.3 ("));
    let at = |s: &str| logs.find(s).unwrap();
    assert!(at("oldest") < at("older"));
    assert!(at("older") < at("current"));
    assert!(!logs.contains("not a log"));
  }

  #[test]
  fn no_log_folder_is_just_the_header() {
    let logs = collect_logs(&std::env::temp_dir().join("kl-diagnostics-none"), "1.2.3");
    assert_eq!(logs, header("1.2.3"));
  }

  #[test]
  fn a_crash_is_offered_once() {
    let dir = TempDir::new("crash");
    assert_eq!(take_crash(&dir.0), None);
    std::fs::write(dir.0.join(CRASH_FILE), "boom").unwrap();
    assert_eq!(take_crash(&dir.0).as_deref(), Some("boom"));
    assert_eq!(take_crash(&dir.0), None);
  }

  #[test]
  fn a_panic_leaves_a_crash_report() {
    let dir = TempDir::new("panic");
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    install_panic_hook(dir.0.clone(), "1.2.3".into());
    // A value known only at run time, so the message is formatted (a String)
    // rather than folded into the literal (a &str).
    let page = std::hint::black_box(7);
    let line = line!() + 1;
    let result = std::thread::spawn(move || panic!("page {page} is missing")).join();
    // Hand the hook back before asserting, so a failure reports normally.
    let _ = std::panic::take_hook();
    std::panic::set_hook(previous);

    assert!(result.is_err());
    let report = take_crash(&dir.0).expect("no crash report");
    assert!(report.starts_with("konigslibrary 1.2.3 ("));
    assert!(report.contains("page 7 is missing"));
    assert!(report.contains(&format!("diagnostics.rs:{line}:")));
  }
}
