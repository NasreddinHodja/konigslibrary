//! Backs off repeated failed logins.
//!
//! In memory: a restart forgets the counts, which costs an attacker a restart
//! they can't cause.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// Failures allowed before any wait.
const FREE: u32 = 5;
/// The wait doubles per failure after that, up to this.
const MAX_WAIT: Duration = Duration::from_secs(15 * 60);
/// Entries kept at most; past it, the ones not failed in the last hour go.
const MAX_ENTRIES: usize = 10_000;
const FORGET_AFTER: Duration = Duration::from_secs(60 * 60);

struct Entry {
  failures: u32,
  until: Instant,
  last: Instant,
}

#[derive(Default)]
pub struct Limiter {
  entries: Mutex<HashMap<String, Entry>>,
}

fn wait_after(failures: u32) -> Duration {
  if failures < FREE {
    return Duration::ZERO;
  }
  let doublings = (failures - FREE).min(20);
  Duration::from_secs(1u64 << doublings).min(MAX_WAIT)
}

impl Limiter {
  /// How long `key` must still wait, if it must.
  pub fn wait(&self, key: &str, now: Instant) -> Option<Duration> {
    let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
    let until = entries.get(key)?.until;
    (until > now).then(|| until - now)
  }

  pub fn fail(&self, key: &str, now: Instant) {
    let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
    if entries.len() >= MAX_ENTRIES && !entries.contains_key(key) {
      entries.retain(|_, e| now.duration_since(e.last) < FORGET_AFTER);
      // A flood of fresh keys: dropping them all only frees their own counts.
      if entries.len() >= MAX_ENTRIES {
        entries.clear();
      }
    }
    let entry = entries.entry(key.to_string()).or_insert(Entry {
      failures: 0,
      until: now,
      last: now,
    });
    entry.failures += 1;
    entry.until = now + wait_after(entry.failures);
    entry.last = now;
  }

  pub fn succeed(&self, key: &str) {
    self
      .entries
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .remove(key);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_first_failures_cost_nothing() {
    let limiter = Limiter::default();
    let now = Instant::now();
    for _ in 0..FREE - 1 {
      limiter.fail("ip", now);
      assert_eq!(limiter.wait("ip", now), None);
    }
  }

  #[test]
  fn then_the_wait_doubles_up_to_the_cap() {
    let limiter = Limiter::default();
    let now = Instant::now();
    for _ in 0..FREE {
      limiter.fail("ip", now);
    }
    assert_eq!(limiter.wait("ip", now), Some(Duration::from_secs(1)));
    limiter.fail("ip", now);
    assert_eq!(limiter.wait("ip", now), Some(Duration::from_secs(2)));
    for _ in 0..30 {
      limiter.fail("ip", now);
    }
    assert_eq!(limiter.wait("ip", now), Some(MAX_WAIT));
  }

  #[test]
  fn the_wait_runs_out() {
    let limiter = Limiter::default();
    let now = Instant::now();
    for _ in 0..FREE {
      limiter.fail("ip", now);
    }
    assert_eq!(limiter.wait("ip", now + Duration::from_secs(1)), None);
  }

  #[test]
  fn keys_are_counted_apart_and_success_clears_one() {
    let limiter = Limiter::default();
    let now = Instant::now();
    for _ in 0..FREE {
      limiter.fail("a", now);
    }
    assert!(limiter.wait("a", now).is_some());
    assert!(limiter.wait("b", now).is_none());
    limiter.succeed("a");
    assert!(limiter.wait("a", now).is_none());
  }

  #[test]
  fn a_flood_of_keys_stays_bounded() {
    let limiter = Limiter::default();
    let now = Instant::now();
    for i in 0..MAX_ENTRIES + 10 {
      limiter.fail(&i.to_string(), now);
    }
    assert!(limiter.entries.lock().unwrap().len() <= MAX_ENTRIES);
  }
}
