//! Where the admin and their sessions are kept.
//!
//! Its own SQLite file, not the library database: that one is a cache, which
//! the server rebuilds, or opens in a temp directory, when it has to.

use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// A session unused for this long is gone.
pub const IDLE: i64 = 30 * DAY;
/// And any session after this long, used or not.
pub const ABSOLUTE: i64 = 180 * DAY;
const DAY: i64 = 24 * 60 * 60;

/// A device token unused for this long stops counting as a known device.
pub const DEVICE_TTL: i64 = 365 * DAY;

/// How long a login waiting for approval waits.
pub const APPROVAL_TTL: i64 = 10 * 60;
/// Waiting logins kept at most; past it, new ones aren't kept.
const MAX_APPROVALS: i64 = 20;

/// How stale `last_seen` may get before a request rewrites it, so reading a
/// chapter isn't a database write per page.
const TOUCH_EVERY: i64 = 60 * 60;

/// The schema, one step per release that changed it: step `n` takes a
/// database from `user_version` `n` to `n + 1`. Steps are only ever added,
/// never edited, since databases out there have already run them. The first
/// is `IF NOT EXISTS` because databases from before versioning have its
/// tables at version 0.
const MIGRATIONS: &[&str] = &["
  -- One admin for now; the CHECK keeps it that way.
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    -- What the sessions list shows and revokes by; not a credential.
    id TEXT PRIMARY KEY,
    -- SHA-256 of the token, so a copy of this file logs no one in.
    token_hash BLOB NOT NULL UNIQUE,
    -- 'cookie' or 'bearer': a token is only accepted the way it was issued.
    kind TEXT NOT NULL,
    device TEXT NOT NULL,
    -- Unix seconds.
    created INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  -- Clients that have logged in before. A device token grants nothing by
  -- itself; it only exempts its holder from the lockout that failed logins
  -- from unknown clients bring on (see `auth::post_login`).
  CREATE TABLE IF NOT EXISTS devices (
    token_hash BLOB PRIMARY KEY,
    last_used INTEGER NOT NULL
  );

  -- Logins with the right password from a new client while the account is
  -- locked, waiting for a logged-in device to allow them.
  CREATE TABLE IF NOT EXISTS approvals (
    -- What the admin allows or denies by; not a credential.
    id TEXT PRIMARY KEY,
    -- SHA-256 of what the waiting client asks with.
    secret_hash BLOB NOT NULL UNIQUE,
    -- The session to start once allowed: 'cookie' or 'bearer'.
    kind TEXT NOT NULL,
    device TEXT NOT NULL,
    address TEXT NOT NULL,
    created INTEGER NOT NULL,
    -- 'pending', 'allowed' or 'denied'.
    state TEXT NOT NULL
  );
"];

/// Brings the database at `conn` up to the last of `migrations`, each step in
/// a transaction with its version, so a failed one leaves the version before
/// it. A database from a newer release is refused rather than used with a
/// schema this one doesn't know.
fn migrate(conn: &mut Connection, migrations: &[&str]) -> rusqlite::Result<()> {
  let version: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
  if version > migrations.len() {
    return Err(rusqlite::Error::SqliteFailure(
      rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
      Some(format!(
        "the auth database is at version {version}, from a newer release; this one knows {}",
        migrations.len()
      )),
    ));
  }
  for (n, step) in migrations.iter().enumerate().skip(version) {
    let tx = conn.transaction()?;
    tx.execute_batch(step)?;
    tx.pragma_update(None, "user_version", n + 1)?;
    tx.commit()?;
  }
  Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
  /// The server's own page: an `HttpOnly` cookie.
  Cookie,
  /// Any other origin: `Authorization: Bearer`.
  Bearer,
}

impl Kind {
  fn as_str(self) -> &'static str {
    match self {
      Kind::Cookie => "cookie",
      Kind::Bearer => "bearer",
    }
  }

  fn parse(s: &str) -> Option<Self> {
    match s {
      "cookie" => Some(Kind::Cookie),
      "bearer" => Some(Kind::Bearer),
      _ => None,
    }
  }
}

pub struct Admin {
  pub username: String,
  pub password_hash: String,
}

/// The session a request was made with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
  pub id: String,
  pub created: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
  pub id: String,
  pub device: String,
  pub created: i64,
  pub last_seen: i64,
}

/// A login waiting for approval, as the admin is shown it.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalInfo {
  pub id: String,
  pub code: String,
  pub device: String,
  pub address: String,
  pub created: i64,
}

/// Where a waiting login stands, as its client is told.
#[derive(Debug, PartialEq, Eq)]
pub enum Approval {
  /// Not decided yet; also what an unknown or expired secret gets, so a
  /// guessed one learns nothing.
  Pending,
  Denied,
  /// Allowed, and used up by this answer: start this session.
  Allowed {
    kind: Kind,
    device: String,
  },
}

/// What the waiting client and the admin both see, to tell that a request
/// is the one they made.
pub fn approval_code(id: &str) -> String {
  id[..6].to_ascii_uppercase()
}

pub struct Store {
  conn: Mutex<Connection>,
}

fn token_hash(token: &str) -> Vec<u8> {
  Sha256::digest(token.as_bytes()).to_vec()
}

fn expired(created: i64, last_seen: i64, now: i64) -> bool {
  now - last_seen >= IDLE || now - created >= ABSOLUTE
}

impl Store {
  /// Opens the store at `path`, creating it readable by its owner only.
  pub fn open(path: &Path) -> rusqlite::Result<Self> {
    if !path.exists() {
      // SQLite takes an empty file as a new database.
      klfs::write_private(path, "").map_err(|e| {
        rusqlite::Error::SqliteFailure(
          rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
          Some(e.to_string()),
        )
      })?;
    }
    let mut conn = Connection::open(path)?;
    migrate(&mut conn, MIGRATIONS)?;
    Ok(Self {
      conn: Mutex::new(conn),
    })
  }

  fn conn(&self) -> MutexGuard<'_, Connection> {
    // A panic mid-statement leaves nothing half-written that a later one
    // would trip over: each write is a single statement.
    self.conn.lock().unwrap_or_else(PoisonError::into_inner)
  }

  pub fn admin(&self) -> Option<Admin> {
    self
      .conn()
      .query_row(
        "SELECT username, password_hash FROM admin WHERE id = 1",
        [],
        |row| {
          Ok(Admin {
            username: row.get(0)?,
            password_hash: row.get(1)?,
          })
        },
      )
      .optional()
      .ok()
      .flatten()
  }

  pub fn has_admin(&self) -> bool {
    self.admin().is_some()
  }

  /// `false` if there already is one, which is left as it was.
  pub fn create_admin(&self, username: &str, password_hash: &str) -> rusqlite::Result<bool> {
    let added = self.conn().execute(
      "INSERT OR IGNORE INTO admin (id, username, password_hash) VALUES (1, ?1, ?2)",
      params![username, password_hash],
    )?;
    Ok(added == 1)
  }

  pub fn set_password(&self, password_hash: &str) -> rusqlite::Result<()> {
    self.conn().execute(
      "UPDATE admin SET password_hash = ?1 WHERE id = 1",
      params![password_hash],
    )?;
    Ok(())
  }

  /// Starts a session and returns its token, which only the caller ever sees.
  pub fn create_session(&self, kind: Kind, device: &str, now: i64) -> rusqlite::Result<String> {
    let token = klfs::random_hex(32);
    let conn = self.conn();
    // Expired sessions are cleared here rather than on a timer: logging in is
    // rare and already slow.
    conn.execute(
      "DELETE FROM sessions WHERE ?1 - last_seen >= ?2 OR ?1 - created >= ?3",
      params![now, IDLE, ABSOLUTE],
    )?;
    conn.execute(
      "INSERT INTO sessions (id, token_hash, kind, device, created, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
      params![
        klfs::random_hex(16),
        token_hash(&token),
        kind.as_str(),
        device,
        now
      ],
    )?;
    Ok(token)
  }

  /// The live session `token` belongs to, if it was issued as `kind`.
  pub fn session(&self, token: &str, kind: Kind, now: i64) -> Option<Session> {
    let conn = self.conn();
    let (id, created, last_seen): (String, i64, i64) = conn
      .query_row(
        "SELECT id, created, last_seen FROM sessions WHERE token_hash = ?1 AND kind = ?2",
        params![token_hash(token), kind.as_str()],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
      )
      .optional()
      .ok()??;
    if expired(created, last_seen, now) {
      let _ = conn.execute("DELETE FROM sessions WHERE id = ?1", params![id]);
      return None;
    }
    if now - last_seen >= TOUCH_EVERY {
      let _ = conn.execute(
        "UPDATE sessions SET last_seen = ?1 WHERE id = ?2",
        params![now, id],
      );
    }
    Some(Session { id, created })
  }

  /// A token for a client that just logged in, which only it ever sees.
  pub fn create_device(&self, now: i64) -> rusqlite::Result<String> {
    let token = klfs::random_hex(32);
    let conn = self.conn();
    conn.execute(
      "DELETE FROM devices WHERE ?1 - last_used >= ?2",
      params![now, DEVICE_TTL],
    )?;
    conn.execute(
      "INSERT INTO devices (token_hash, last_used) VALUES (?1, ?2)",
      params![token_hash(&token), now],
    )?;
    Ok(token)
  }

  /// Whether `token` is a device token still in use, which this marks used.
  pub fn known_device(&self, token: &str, now: i64) -> bool {
    let updated = self.conn().execute(
      "UPDATE devices SET last_used = ?1 WHERE token_hash = ?2 AND ?1 - last_used < ?3",
      params![now, token_hash(token), DEVICE_TTL],
    );
    updated == Ok(1)
  }

  /// Records a login waiting for approval and returns the secret its client
  /// asks with, or `None` when too many are already waiting.
  pub fn create_approval(
    &self,
    kind: Kind,
    device: &str,
    address: &str,
    now: i64,
  ) -> rusqlite::Result<Option<(String, String)>> {
    let conn = self.conn();
    conn.execute(
      "DELETE FROM approvals WHERE ?1 - created >= ?2",
      params![now, APPROVAL_TTL],
    )?;
    let waiting: i64 = conn.query_row("SELECT COUNT(*) FROM approvals", [], |row| row.get(0))?;
    if waiting >= MAX_APPROVALS {
      return Ok(None);
    }
    let id = klfs::random_hex(16);
    let secret = klfs::random_hex(32);
    conn.execute(
      "INSERT INTO approvals (id, secret_hash, kind, device, address, created, state)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')",
      params![id, token_hash(&secret), kind.as_str(), device, address, now],
    )?;
    Ok(Some((id, secret)))
  }

  /// Logins still waiting, oldest first.
  pub fn approvals(&self, now: i64) -> rusqlite::Result<Vec<ApprovalInfo>> {
    let conn = self.conn();
    let mut stmt = conn.prepare(
      "SELECT id, device, address, created FROM approvals
       WHERE state = 'pending' AND ?1 - created < ?2
       ORDER BY created, id",
    )?;
    let rows = stmt.query_map(params![now, APPROVAL_TTL], |row| {
      let id: String = row.get(0)?;
      Ok(ApprovalInfo {
        code: approval_code(&id),
        id,
        device: row.get(1)?,
        address: row.get(2)?,
        created: row.get(3)?,
      })
    })?;
    rows.collect()
  }

  /// Allows or denies a waiting login. `false` if it isn't waiting any more.
  pub fn decide(&self, id: &str, allow: bool, now: i64) -> rusqlite::Result<bool> {
    let state = if allow { "allowed" } else { "denied" };
    let updated = self.conn().execute(
      "UPDATE approvals SET state = ?1
       WHERE id = ?2 AND state = 'pending' AND ?3 - created < ?4",
      params![state, id, now, APPROVAL_TTL],
    )?;
    Ok(updated == 1)
  }

  /// Where the login waiting with `secret` stands. An allowed one is used up.
  pub fn take_approval(&self, secret: &str, now: i64) -> rusqlite::Result<Approval> {
    let conn = self.conn();
    let found: Option<(String, String, String, String, i64)> = conn
      .query_row(
        "SELECT id, kind, device, state, created FROM approvals WHERE secret_hash = ?1",
        params![token_hash(secret)],
        |row| {
          Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
          ))
        },
      )
      .optional()?;
    let Some((id, kind, device, state, created)) = found else {
      return Ok(Approval::Pending);
    };
    if now - created >= APPROVAL_TTL {
      return Ok(Approval::Pending);
    }
    match (state.as_str(), Kind::parse(&kind)) {
      ("denied", _) => Ok(Approval::Denied),
      ("allowed", Some(kind)) => {
        // Only one answer gets the session; `conn` stays locked since the
        // read, so no other one can be between them.
        conn.execute("DELETE FROM approvals WHERE id = ?1", params![id])?;
        Ok(Approval::Allowed { kind, device })
      }
      _ => Ok(Approval::Pending),
    }
  }

  /// Live sessions, most recently used first.
  pub fn sessions(&self, now: i64) -> rusqlite::Result<Vec<SessionInfo>> {
    let conn = self.conn();
    let mut stmt = conn.prepare(
      "SELECT id, device, created, last_seen FROM sessions
       WHERE ?1 - last_seen < ?2 AND ?1 - created < ?3
       ORDER BY last_seen DESC, created DESC",
    )?;
    let rows = stmt.query_map(params![now, IDLE, ABSOLUTE], |row| {
      Ok(SessionInfo {
        id: row.get(0)?,
        device: row.get(1)?,
        created: row.get(2)?,
        last_seen: row.get(3)?,
      })
    })?;
    rows.collect()
  }

  /// `false` if there was no such session.
  pub fn revoke(&self, id: &str) -> rusqlite::Result<bool> {
    Ok(
      self
        .conn()
        .execute("DELETE FROM sessions WHERE id = ?1", params![id])?
        == 1,
    )
  }

  /// Ends every session but `keep`.
  pub fn revoke_others(&self, keep: &str) -> rusqlite::Result<()> {
    self
      .conn()
      .execute("DELETE FROM sessions WHERE id != ?1", params![keep])?;
    Ok(())
  }

  /// Back to the first run: no admin, no sessions, no known devices, no
  /// waiting logins. For an admin who lost the password; whoever can run
  /// this owns the server.
  pub fn reset(&self) -> rusqlite::Result<()> {
    self.conn().execute_batch(
      "BEGIN;
       DELETE FROM admin;
       DELETE FROM sessions;
       DELETE FROM devices;
       DELETE FROM approvals;
       COMMIT;",
    )
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn store() -> (tempfile::TempDir, Store) {
    let tmp = tempfile::tempdir().unwrap();
    let store = Store::open(&tmp.path().join("auth.db")).unwrap();
    (tmp, store)
  }

  #[cfg(unix)]
  #[test]
  fn the_file_is_readable_by_its_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let (tmp, _store) = store();
    let mode = std::fs::metadata(tmp.path().join("auth.db"))
      .unwrap()
      .permissions()
      .mode();
    assert_eq!(mode & 0o777, 0o600);
  }

  #[test]
  fn there_is_only_ever_one_admin() {
    let (_tmp, store) = store();
    assert!(!store.has_admin());
    assert!(store.create_admin("alice", "h1").unwrap());
    assert!(!store.create_admin("mallory", "h2").unwrap());
    let admin = store.admin().unwrap();
    assert_eq!(
      (admin.username.as_str(), admin.password_hash.as_str()),
      ("alice", "h1")
    );
  }

  #[test]
  fn a_reset_leaves_no_admin_session_or_device() {
    let (_tmp, store) = store();
    store.create_admin("alice", "h").unwrap();
    let token = store.create_session(Kind::Bearer, "phone", 1000).unwrap();
    let device = store.create_device(1000).unwrap();
    store
      .create_approval(Kind::Bearer, "tablet", "10.0.0.2", 1000)
      .unwrap();
    store.reset().unwrap();
    assert!(!store.has_admin());
    assert!(store.session(&token, Kind::Bearer, 1000).is_none());
    assert!(!store.known_device(&device, 1000));
    assert!(store.approvals(1000).unwrap().is_empty());
    // Setup can run again.
    assert!(store.create_admin("bob", "h2").unwrap());
  }

  #[test]
  fn the_admin_survives_reopening() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("auth.db");
    Store::open(&path)
      .unwrap()
      .create_admin("alice", "h")
      .unwrap();
    assert_eq!(
      Store::open(&path).unwrap().admin().unwrap().username,
      "alice"
    );
  }

  fn version(conn: &Connection) -> usize {
    conn
      .pragma_query_value(None, "user_version", |r| r.get(0))
      .unwrap()
  }

  #[test]
  fn a_new_database_is_at_the_last_version() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("auth.db");
    Store::open(&path).unwrap();
    assert_eq!(version(&Connection::open(&path).unwrap()), MIGRATIONS.len());
  }

  #[test]
  fn a_database_from_before_versioning_keeps_its_admin() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("auth.db");
    // As v0.10.3 left it: the tables, at user_version 0.
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(MIGRATIONS[0]).unwrap();
    conn
      .execute(
        "INSERT INTO admin (id, username, password_hash) VALUES (1, 'alice', 'h')",
        [],
      )
      .unwrap();
    drop(conn);

    assert_eq!(
      Store::open(&path).unwrap().admin().unwrap().username,
      "alice"
    );
    assert_eq!(version(&Connection::open(&path).unwrap()), MIGRATIONS.len());
  }

  #[test]
  fn a_new_step_runs_once_on_an_existing_database() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn, &MIGRATIONS[..1]).unwrap();
    conn
      .execute(
        "INSERT INTO admin (id, username, password_hash) VALUES (1, 'alice', 'h')",
        [],
      )
      .unwrap();

    // Adding the column twice would fail.
    let next = [
      MIGRATIONS[0],
      "ALTER TABLE admin ADD COLUMN theme TEXT NOT NULL DEFAULT 'paper'",
    ];
    migrate(&mut conn, &next).unwrap();
    migrate(&mut conn, &next).unwrap();

    let (username, theme): (String, String) = conn
      .query_row("SELECT username, theme FROM admin", [], |r| {
        Ok((r.get(0)?, r.get(1)?))
      })
      .unwrap();
    assert_eq!((username.as_str(), theme.as_str()), ("alice", "paper"));
    assert_eq!(version(&conn), 2);
  }

  #[test]
  fn a_failed_step_leaves_the_version_before_it() {
    let mut conn = Connection::open_in_memory().unwrap();
    let broken = "CREATE TABLE half (x INTEGER); NOT SQL";
    assert!(migrate(&mut conn, &[MIGRATIONS[0], broken]).is_err());
    assert_eq!(version(&conn), 1);
    // Nothing of the failed step stays, so it can run again.
    let half: i64 = conn
      .query_row(
        "SELECT count(*) FROM sqlite_master WHERE name = 'half'",
        [],
        |r| r.get(0),
      )
      .unwrap();
    assert_eq!(half, 0);
  }

  #[test]
  fn a_database_from_a_newer_release_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("auth.db");
    Store::open(&path).unwrap();
    Connection::open(&path)
      .unwrap()
      .pragma_update(None, "user_version", MIGRATIONS.len() + 1)
      .unwrap();

    let err = Store::open(&path).err().unwrap().to_string();
    assert!(err.contains("newer release"), "{err}");
  }

  #[test]
  fn a_token_is_stored_only_as_its_hash() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("auth.db");
    let token = Store::open(&path)
      .unwrap()
      .create_session(Kind::Bearer, "phone", 0)
      .unwrap();
    assert_eq!(token.len(), 64);
    let raw = std::fs::read(&path).unwrap();
    assert!(!raw.windows(token.len()).any(|w| w == token.as_bytes()));
  }

  #[test]
  fn a_token_is_only_accepted_the_way_it_was_issued() {
    let (_tmp, store) = store();
    let token = store.create_session(Kind::Bearer, "phone", 0).unwrap();
    assert!(store.session(&token, Kind::Bearer, 1).is_some());
    assert!(store.session(&token, Kind::Cookie, 1).is_none());
    assert!(store.session("not-a-token", Kind::Bearer, 1).is_none());
  }

  #[test]
  fn an_idle_session_expires() {
    let (_tmp, store) = store();
    let fresh = store.create_session(Kind::Bearer, "phone", 0).unwrap();
    let idle = store.create_session(Kind::Bearer, "tablet", 0).unwrap();
    assert!(store.session(&fresh, Kind::Bearer, IDLE - 1).is_some());
    assert!(store.session(&idle, Kind::Bearer, IDLE).is_none());
  }

  #[test]
  fn use_keeps_a_session_alive() {
    let (_tmp, store) = store();
    let token = store.create_session(Kind::Bearer, "phone", 0).unwrap();
    let mut now = 0;
    while now < 2 * IDLE {
      now += IDLE / 2;
      assert!(
        store.session(&token, Kind::Bearer, now).is_some(),
        "at {now}"
      );
    }
  }

  #[test]
  fn every_session_ends_after_the_absolute_limit() {
    let (_tmp, store) = store();
    let token = store.create_session(Kind::Bearer, "phone", 0).unwrap();
    let mut now = 0;
    while now + IDLE / 2 < ABSOLUTE {
      now += IDLE / 2;
      assert!(store.session(&token, Kind::Bearer, now).is_some());
    }
    assert!(store.session(&token, Kind::Bearer, ABSOLUTE).is_none());
  }

  #[test]
  fn a_device_is_known_until_it_goes_unused_too_long() {
    let (_tmp, store) = store();
    let token = store.create_device(0).unwrap();
    assert!(store.known_device(&token, DEVICE_TTL - 1));
    // That use counted.
    assert!(store.known_device(&token, 2 * DEVICE_TTL - 2));
    assert!(!store.known_device(&token, 3 * DEVICE_TTL));
    assert!(!store.known_device("forged", 0));
  }

  #[test]
  fn sessions_are_listed_newest_use_first_without_expired_ones() {
    let (_tmp, store) = store();
    let old = store.create_session(Kind::Bearer, "old phone", 0).unwrap();
    store.create_session(Kind::Bearer, "tablet", IDLE).unwrap();
    store
      .create_session(Kind::Cookie, "laptop", IDLE + 10)
      .unwrap();
    let now = IDLE + 20;
    let devices: Vec<_> = store
      .sessions(now)
      .unwrap()
      .into_iter()
      .map(|s| s.device)
      .collect();
    assert_eq!(devices, ["laptop", "tablet"]);
    assert!(store.session(&old, Kind::Bearer, now).is_none());
  }

  #[test]
  fn a_revoked_session_is_refused() {
    let (_tmp, store) = store();
    let token = store.create_session(Kind::Bearer, "phone", 0).unwrap();
    let id = store.session(&token, Kind::Bearer, 0).unwrap().id;
    assert!(store.revoke(&id).unwrap());
    assert!(!store.revoke(&id).unwrap());
    assert!(store.session(&token, Kind::Bearer, 0).is_none());
  }

  #[test]
  fn revoking_the_others_keeps_only_the_one() {
    let (_tmp, store) = store();
    let mine = store.create_session(Kind::Cookie, "laptop", 0).unwrap();
    let theirs = store.create_session(Kind::Bearer, "phone", 0).unwrap();
    let id = store.session(&mine, Kind::Cookie, 0).unwrap().id;
    store.revoke_others(&id).unwrap();
    assert!(store.session(&mine, Kind::Cookie, 0).is_some());
    assert!(store.session(&theirs, Kind::Bearer, 0).is_none());
  }

  fn waiting(store: &Store, device: &str, now: i64) -> (String, String) {
    store
      .create_approval(Kind::Bearer, device, "10.0.0.2", now)
      .unwrap()
      .unwrap()
  }

  #[test]
  fn an_allowed_login_gets_its_session_once() {
    let (_tmp, store) = store();
    let (id, secret) = waiting(&store, "tablet", 0);
    assert_eq!(store.take_approval(&secret, 1).unwrap(), Approval::Pending);
    assert!(store.decide(&id, true, 2).unwrap());
    assert_eq!(
      store.take_approval(&secret, 3).unwrap(),
      Approval::Allowed {
        kind: Kind::Bearer,
        device: "tablet".into()
      }
    );
    assert_eq!(store.take_approval(&secret, 4).unwrap(), Approval::Pending);
  }

  #[test]
  fn a_denied_login_stays_denied() {
    let (_tmp, store) = store();
    let (id, secret) = waiting(&store, "tablet", 0);
    assert!(store.decide(&id, false, 1).unwrap());
    assert_eq!(store.take_approval(&secret, 2).unwrap(), Approval::Denied);
    // Decided once.
    assert!(!store.decide(&id, true, 3).unwrap());
    assert_eq!(store.take_approval(&secret, 4).unwrap(), Approval::Denied);
  }

  #[test]
  fn only_waiting_logins_are_listed_with_their_code() {
    let (_tmp, store) = store();
    let (first, _) = waiting(&store, "tablet", 0);
    let (second, _) = waiting(&store, "phone", 1);
    let (decided, _) = waiting(&store, "laptop", 2);
    store.decide(&decided, false, 3).unwrap();
    let listed = store.approvals(3).unwrap();
    let ids: Vec<_> = listed.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(ids, [first.as_str(), second.as_str()]);
    assert_eq!(listed[0].code, first[..6].to_ascii_uppercase());
    assert_eq!(listed[0].address, "10.0.0.2");
  }

  #[test]
  fn a_waiting_login_expires() {
    let (_tmp, store) = store();
    let (id, secret) = waiting(&store, "tablet", 0);
    assert_eq!(store.approvals(APPROVAL_TTL - 1).unwrap().len(), 1);
    assert!(store.approvals(APPROVAL_TTL).unwrap().is_empty());
    assert!(!store.decide(&id, true, APPROVAL_TTL).unwrap());
    store
      .conn()
      .execute("UPDATE approvals SET state = 'allowed'", [])
      .unwrap();
    assert_eq!(
      store.take_approval(&secret, APPROVAL_TTL).unwrap(),
      Approval::Pending
    );
  }

  #[test]
  fn an_unknown_secret_looks_pending() {
    let (_tmp, store) = store();
    assert_eq!(store.take_approval("guess", 0).unwrap(), Approval::Pending);
  }

  #[test]
  fn waiting_logins_are_capped() {
    let (_tmp, store) = store();
    for i in 0..MAX_APPROVALS {
      waiting(&store, "tablet", i);
    }
    let extra = store
      .create_approval(Kind::Bearer, "phone", "10.0.0.3", MAX_APPROVALS)
      .unwrap();
    assert_eq!(extra, None);
    // Expired ones make room again.
    assert!(store
      .create_approval(Kind::Bearer, "phone", "10.0.0.3", APPROVAL_TTL)
      .unwrap()
      .is_some());
  }
}
