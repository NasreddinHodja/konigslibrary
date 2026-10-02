//! The library database.
//!
//! One row per manga holding what the list shows, sorts and searches by — the
//! ComicInfo title, folded, and the cover — so a manga directory of hundreds of
//! thousands of manga is neither listed from disk per request nor read two
//! archives per card. It is a cache of the manga directory: deleting the file
//! only costs a rescan.
//!
//! Keeping it current:
//!
//! - the row set follows the manga directory, re-synced whenever the
//!   directory's mtime moves (adding, removing or renaming a manga folder);
//! - each manga's metadata is re-read when its folder's mtime moves or either
//!   archive it was read from changes size or mtime — the only inputs
//!   [`klparse::manga_meta`] has — in a background pass after every re-sync
//!   and at most every [`RESWEEP`], and on demand when `/meta` asks for it.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use klparse::collate::{fold, locale_cmp};
use klparse::comicinfo::meta_sources;
use klparse::is_chapter_name;
use klparse::listing;
use klparse::names::strip_zip_ext;
use klparse::uri::encode_uri_component;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::library::ServerChapter;

/// How often a request may trigger a pass over every manga's metadata even
/// though the manga directory itself has not changed.
const RESWEEP: Duration = Duration::from_secs(10 * 60);

/// Metadata reads committed per transaction during a sweep, so requests
/// writing on demand never wait long.
const BATCH: usize = 200;

/// Search terms shorter than this can't use the trigram index and fall back to
/// scanning.
const TRIGRAM: usize = 3;

/// Bumped whenever the schema changes. A database from another version is
/// dropped and rebuilt, which is only a rescan since it is a cache.
const SCHEMA_VERSION: i64 = 2;

const DROP: &str = "
  DROP TABLE IF EXISTS chapters;
  DROP TABLE IF EXISTS manga_fts;
  DROP TABLE IF EXISTS manga;
  DROP TABLE IF EXISTS settings;
";

const SCHEMA: &str = "
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE IF NOT EXISTS manga (
    folder TEXT PRIMARY KEY,
    -- The folded title, or folded folder name until a title is known.
    sort_title TEXT NOT NULL COLLATE kl,
    title TEXT,
    -- Folded title and folder name: what a search matches against.
    search TEXT NOT NULL,
    cover TEXT,
    -- The cover file's size and mtime: its version, for caching.
    cover_stamp TEXT,
    -- The /meta response as JSON. NULL until the metadata is read.
    meta TEXT,
    -- What the metadata was read from, to tell when it is stale.
    dir_mtime INTEGER,
    first TEXT,
    first_stamp TEXT,
    last TEXT,
    last_stamp TEXT
  );

  CREATE INDEX IF NOT EXISTS manga_order ON manga (sort_title, folder);

  -- A manga's chapters, stored the first time they are asked for rather than
  -- by the sweep: only what gets read takes room.
  CREATE TABLE IF NOT EXISTS chapters (
    folder TEXT NOT NULL,
    file TEXT NOT NULL,
    -- The archive's size and mtime when its pages were read.
    stamp TEXT NOT NULL,
    -- Its page entry names in reading order, as JSON; [] for an archive with
    -- none or one that can't be read, so it isn't retried until it changes.
    pages TEXT NOT NULL,
    PRIMARY KEY (folder, file)
  ) WITHOUT ROWID;

  CREATE VIRTUAL TABLE IF NOT EXISTS manga_fts USING fts5 (
    search, content = 'manga', content_rowid = 'rowid', tokenize = 'trigram'
  );

  CREATE TRIGGER IF NOT EXISTS manga_insert AFTER INSERT ON manga BEGIN
    INSERT INTO manga_fts (rowid, search) VALUES (new.rowid, new.search);
  END;
  CREATE TRIGGER IF NOT EXISTS manga_delete AFTER DELETE ON manga BEGIN
    INSERT INTO manga_fts (manga_fts, rowid, search) VALUES ('delete', old.rowid, old.search);
  END;
  CREATE TRIGGER IF NOT EXISTS manga_update AFTER UPDATE OF search ON manga BEGIN
    INSERT INTO manga_fts (manga_fts, rowid, search) VALUES ('delete', old.rowid, old.search);
    INSERT INTO manga_fts (rowid, search) VALUES (new.rowid, new.search);
  END;
";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LibraryEntry {
  pub name: String,
  pub slug: String,
  /// ComicInfo title; `None` when there is none or it hasn't been read yet.
  pub title: Option<String>,
  /// Cover file name inside the manga folder.
  pub cover: Option<String>,
  /// Changes whenever the cover file does, so a URL carrying it can be cached
  /// for good.
  #[serde(rename = "coverVersion")]
  pub cover_version: Option<String>,
  /// Whether `title` and `cover` have been read, so a missing one is final.
  pub scanned: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct LibraryPage {
  pub entries: Vec<LibraryEntry>,
  pub next: Option<String>,
}

pub struct Db {
  path: PathBuf,
  /// Serves requests. Sweeps open their own, so reading never waits on them.
  conn: Mutex<Connection>,
  sweep_state: Mutex<SweepState>,
  /// The manga directory as of the last row-set sync: its path and mtime.
  synced: Mutex<Option<(PathBuf, SystemTime)>>,
  last_sweep: Mutex<Option<Instant>>,
}

/// Locks `m` even if a panic poisoned it. What these mutexes guard stays
/// sound after one: a connection whose open transaction rolled back when it
/// was dropped, or a plain value. Without this, one panic while parsing an
/// archive would fail every later request until a restart.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
  m.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Default)]
struct SweepState {
  running: bool,
  /// A directory synced while a sweep was running, to sweep once it ends.
  next: Option<PathBuf>,
}

fn connect(path: &Path) -> rusqlite::Result<Connection> {
  let conn = Connection::open(path)?;
  conn.pragma_update(None, "journal_mode", "WAL")?;
  conn.pragma_update(None, "synchronous", "NORMAL")?;
  conn.busy_timeout(Duration::from_secs(10))?;
  // The listing order: as `localeCompare` sorts, bytes breaking ties.
  conn.create_collation("kl", |a, b| listing::key_cmp((a, ""), (b, "")))?;
  Ok(conn)
}

fn nanos(t: SystemTime) -> i64 {
  t.duration_since(UNIX_EPOCH)
    .map_or(0, |d| d.as_nanos() as i64)
}

fn mtime(path: &Path) -> Option<SystemTime> {
  std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// A file's size and mtime, which change whenever it is rewritten.
fn stamp(path: &Path) -> Option<String> {
  let m = std::fs::metadata(path).ok()?;
  Some(format!("{}:{}", nanos(m.modified().ok()?), m.len()))
}

/// What the metadata of a manga was read from, as stored in its row.
struct Sources {
  dir_mtime: Option<i64>,
  first: Option<(String, String)>,
  last: Option<(String, String)>,
  /// Rewriting the cover in place changes neither the folder nor an archive.
  cover: Option<(String, String)>,
}

impl Sources {
  fn is_fresh(&self, path: &Path) -> bool {
    let Some(dir_mtime) = self.dir_mtime else {
      return false;
    };
    mtime(path).map(nanos) == Some(dir_mtime)
      && [&self.first, &self.last, &self.cover]
        .into_iter()
        .flatten()
        .all(|(name, s)| stamp(&path.join(name)).as_deref() == Some(s))
  }
}

/// A manga's metadata and what it was read from.
struct Read {
  meta: klparse::MangaMeta,
  sources: Sources,
}

fn read_manga(path: &Path) -> Option<Read> {
  // Stamped before reading, so a change made mid-read shows up as stale next
  // time rather than being stamped over.
  let dir_mtime = nanos(mtime(path)?);
  let names = klfs::file_names(path).ok()?;
  let archives = meta_sources(&names).archives;
  let stamped =
    |name: Option<&String>| name.and_then(|n| stamp(&path.join(n)).map(|s| (n.clone(), s)));
  let first = stamped(archives.first());
  let last = stamped(archives.last()).filter(|_| archives.len() > 1);
  let meta = klfs::manga_meta(path, &names);
  let cover = stamped(meta.cover.as_ref());
  Some(Read {
    meta,
    sources: Sources {
      dir_mtime: Some(dir_mtime),
      first,
      last,
      cover,
    },
  })
}

fn store(conn: &Connection, folder: &str, read: &Read) -> rusqlite::Result<()> {
  let title = read.meta.title.as_deref();
  let sort_title = fold(title.unwrap_or(folder));
  let search = match title {
    Some(t) => format!("{} {}", fold(t), fold(folder)),
    None => fold(folder),
  };
  let meta = serde_json::to_string(&read.meta).expect("metadata serializes");
  let (first, first_stamp) = read.sources.first.clone().unzip();
  let (last, last_stamp) = read.sources.last.clone().unzip();
  let cover_stamp = read.sources.cover.as_ref().map(|(_, s)| s);
  conn.execute(
    "INSERT INTO manga (folder, sort_title, title, search, cover, meta,
                        dir_mtime, first, first_stamp, last, last_stamp, cover_stamp)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT (folder) DO UPDATE SET
       sort_title = excluded.sort_title, title = excluded.title,
       search = excluded.search, cover = excluded.cover, meta = excluded.meta,
       dir_mtime = excluded.dir_mtime, first = excluded.first,
       first_stamp = excluded.first_stamp, last = excluded.last,
       last_stamp = excluded.last_stamp, cover_stamp = excluded.cover_stamp",
    params![
      folder,
      sort_title,
      title,
      search,
      read.meta.cover,
      meta,
      read.sources.dir_mtime,
      first,
      first_stamp,
      last,
      last_stamp,
      cover_stamp
    ],
  )?;
  Ok(())
}

fn sources_of(
  conn: &Connection,
  folder: &str,
) -> rusqlite::Result<Option<(Sources, Option<String>)>> {
  conn
    .query_row(
      "SELECT dir_mtime, first, first_stamp, last, last_stamp, meta, cover, cover_stamp
       FROM manga WHERE folder = ?1",
      [folder],
      |r| {
        let pair = |a: Option<String>, b: Option<String>| a.zip(b);
        Ok((
          Sources {
            dir_mtime: r.get(0)?,
            first: pair(r.get(1)?, r.get(2)?),
            last: pair(r.get(3)?, r.get(4)?),
            cover: pair(r.get(6)?, r.get(7)?),
          },
          r.get(5)?,
        ))
      },
    )
    .optional()
}

impl Db {
  pub fn open(path: &Path) -> rusqlite::Result<Arc<Self>> {
    let conn = connect(path)?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version != SCHEMA_VERSION {
      conn.execute_batch(DROP)?;
      conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }
    conn.execute_batch(SCHEMA)?;
    Ok(Arc::new(Self {
      path: path.to_path_buf(),
      conn: Mutex::new(conn),
      sweep_state: Mutex::new(SweepState::default()),
      synced: Mutex::new(None),
      last_sweep: Mutex::new(None),
    }))
  }

  /// Brings the row set in line with `dir` if it may have changed since the
  /// last sync, then starts a background metadata sweep if one is due.
  /// Syncing is a directory listing and a diff, so it runs inline: the list
  /// is complete as soon as this returns, titles fill in as the sweep goes.
  pub fn refresh(self: &Arc<Self>, dir: &Path) {
    // Held across the check and the sync, so a request arriving mid-sync
    // waits for it instead of starting a second one.
    let synced_now = {
      let mut synced = lock(&self.synced);
      let current = mtime(dir);
      let stale = synced.as_ref().map(|(d, m)| (d.as_path(), Some(*m))) != Some((dir, current));
      // An unreadable directory still syncs, to an empty list, but is retried.
      let ok = stale && self.sync_folders(dir).is_ok();
      if ok {
        *synced = current.map(|m| (dir.to_path_buf(), m));
      }
      ok
    };

    let due = synced_now || lock(&self.last_sweep).is_none_or(|at| at.elapsed() > RESWEEP);
    if !due {
      return;
    }
    let mut state = lock(&self.sweep_state);
    if state.running {
      // The running sweep may be of a directory just switched away from:
      // this one goes next rather than waiting out RESWEEP.
      if synced_now {
        state.next = Some(dir.to_path_buf());
      }
      return;
    }
    state.running = true;
    drop(state);
    let db = Arc::clone(self);
    let dir = dir.to_path_buf();
    std::thread::spawn(move || db.sweep_until_done(dir));
  }

  /// Sweeps `dir`, then whatever directory was synced meanwhile, until none
  /// is left.
  fn sweep_until_done(&self, mut dir: PathBuf) {
    loop {
      *lock(&self.last_sweep) = Some(Instant::now());
      if let Err(e) = self.sweep(&dir) {
        eprintln!("[konigslibrary] Library sweep failed: {e}");
      }
      let mut state = lock(&self.sweep_state);
      match state.next.take() {
        Some(next) => dir = next,
        None => {
          state.running = false;
          return;
        }
      }
    }
  }

  /// Makes the rows match the folders in `dir`: drops vanished manga, adds new
  /// ones with no metadata yet. A different directory than last time starts
  /// over.
  fn sync_folders(&self, dir: &Path) -> rusqlite::Result<()> {
    let folders = match klfs::subfolders(dir) {
      Ok(f) => f,
      Err(e) => {
        eprintln!(
          "[konigslibrary] Cannot read manga directory \"{}\": {e}",
          dir.display()
        );
        Vec::new()
      }
    };
    let mut conn = lock(&self.conn);
    let tx = conn.transaction()?;

    let dir_str = dir.to_string_lossy();
    let stored: Option<String> = tx
      .query_row(
        "SELECT value FROM settings WHERE key = 'manga_dir'",
        [],
        |r| r.get(0),
      )
      .optional()?;
    if stored.as_deref() != Some(&dir_str) {
      tx.execute("DELETE FROM manga", [])?;
      tx.execute("DELETE FROM chapters", [])?;
      tx.execute(
        "INSERT INTO settings (key, value) VALUES ('manga_dir', ?1)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [&*dir_str],
      )?;
    }

    let existing: HashSet<String> = tx
      .prepare("SELECT folder FROM manga")?
      .query_map([], |r| r.get(0))?
      .collect::<rusqlite::Result<_>>()?;
    let present: HashSet<&str> = folders.iter().map(String::as_str).collect();
    {
      let mut delete = tx.prepare("DELETE FROM manga WHERE folder = ?1")?;
      let mut delete_chapters = tx.prepare("DELETE FROM chapters WHERE folder = ?1")?;
      for gone in existing.iter().filter(|f| !present.contains(f.as_str())) {
        delete.execute([gone])?;
        delete_chapters.execute([gone])?;
      }
      let mut insert =
        tx.prepare("INSERT INTO manga (folder, sort_title, search) VALUES (?1, ?2, ?2)")?;
      for new in folders.iter().filter(|f| !existing.contains(*f)) {
        insert.execute(params![new, fold(new)])?;
      }
    }
    tx.commit()
  }

  /// Re-reads the metadata of every manga whose sources changed, on its own
  /// connection, committing in batches.
  fn sweep(&self, dir: &Path) -> rusqlite::Result<()> {
    let mut conn = connect(&self.path)?;
    let folders: Vec<String> = conn
      .prepare("SELECT folder FROM manga")?
      .query_map([], |r| r.get(0))?
      .collect::<rusqlite::Result<_>>()?;

    let dir_str = dir.to_string_lossy();
    for batch in folders.chunks(BATCH) {
      let tx = conn.transaction()?;
      // The library was switched to another directory: its rows are no
      // longer this sweep's to fill.
      let current: Option<String> = tx
        .query_row(
          "SELECT value FROM settings WHERE key = 'manga_dir'",
          [],
          |r| r.get(0),
        )
        .optional()?;
      if current.as_deref() != Some(&dir_str) {
        return Ok(());
      }
      for folder in batch {
        let path = dir.join(folder);
        // A row gone since the list was taken stays gone: storing would
        // bring back a manga the last sync removed.
        let Some((sources, _)) = sources_of(&tx, folder)? else {
          continue;
        };
        if sources.is_fresh(&path) {
          continue;
        }
        if let Some(read) = read_manga(&path) {
          store(&tx, folder, &read)?;
        }
      }
      tx.commit()?;
    }
    Ok(())
  }

  /// The `/meta` response for the manga folder at `path`, as JSON: stored if
  /// still current, re-read otherwise.
  pub fn meta(&self, path: &Path, folder: &str) -> Option<String> {
    if let Ok(Some((sources, Some(meta)))) = sources_of(&lock(&self.conn), folder) {
      if sources.is_fresh(path) {
        return Some(meta);
      }
    }
    // Read with the connection free, as `chapters` does, so other requests
    // don't wait on the archives.
    let read = read_manga(path)?;
    if let Err(e) = store(&lock(&self.conn), folder, &read) {
      eprintln!("[konigslibrary] Cannot store metadata of \"{folder}\": {e}");
    }
    Some(serde_json::to_string(&read.meta).expect("metadata serializes"))
  }

  /// The chapters of the manga folder at `path`, one per archive holding at
  /// least one page, in name order. Each archive's pages are stored once read
  /// and read again only when its size or mtime changes, so opening a long
  /// series costs a directory listing and a `stat` per chapter, not a parse.
  pub fn chapters(&self, path: &Path, folder: &str) -> Vec<ServerChapter> {
    let mut files = klfs::file_names(path).unwrap_or_default();
    files.retain(|n| is_chapter_name(n));

    let mut stored = self.stored_chapters(folder).unwrap_or_else(|e| {
      eprintln!("[konigslibrary] Cannot read stored chapters of \"{folder}\": {e}");
      HashMap::new()
    });

    // Archives are parsed with the connection free, so a long series opening
    // for the first time doesn't hold up everyone else's requests.
    let mut changed: Vec<(String, String, Vec<String>)> = Vec::new();
    let mut chapters: Vec<ServerChapter> = Vec::new();
    for file in &files {
      // Taken out, not cloned: what is left afterwards is what's gone.
      let known = stored.remove(file);
      let Some(current) = stamp(&path.join(file)) else {
        continue;
      };
      let pages = match known {
        Some((s, pages)) if s == current => pages,
        _ => {
          let pages = klfs::archive_pages(&path.join(file));
          changed.push((file.clone(), current, pages.clone()));
          pages
        }
      };
      if !pages.is_empty() {
        chapters.push(ServerChapter {
          slug: encode_uri_component(file),
          name: strip_zip_ext(file).to_string(),
          page_count: pages.len(),
          pages,
        });
      }
    }

    let gone: Vec<&String> = stored.keys().collect();
    if !changed.is_empty() || !gone.is_empty() {
      if let Err(e) = self.store_chapters(folder, &changed, &gone) {
        eprintln!("[konigslibrary] Cannot store chapters of \"{folder}\": {e}");
      }
    }

    chapters.sort_by(|a, b| locale_cmp(&a.name, &b.name));
    chapters
  }

  fn stored_chapters(
    &self,
    folder: &str,
  ) -> rusqlite::Result<HashMap<String, (String, Vec<String>)>> {
    let conn = lock(&self.conn);
    let mut stmt = conn.prepare("SELECT file, stamp, pages FROM chapters WHERE folder = ?1")?;
    let rows = stmt.query_map([folder], |r| {
      let pages: String = r.get(2)?;
      Ok((
        r.get::<_, String>(0)?,
        (
          r.get::<_, String>(1)?,
          serde_json::from_str(&pages).unwrap_or_default(),
        ),
      ))
    })?;
    rows.collect()
  }

  fn store_chapters(
    &self,
    folder: &str,
    changed: &[(String, String, Vec<String>)],
    gone: &[&String],
  ) -> rusqlite::Result<()> {
    let mut conn = lock(&self.conn);
    let tx = conn.transaction()?;
    {
      let mut upsert = tx.prepare(
        "INSERT INTO chapters (folder, file, stamp, pages) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (folder, file) DO UPDATE SET stamp = excluded.stamp, pages = excluded.pages",
      )?;
      for (file, stamp, pages) in changed {
        let json = serde_json::to_string(pages).expect("page names serialize");
        upsert.execute(params![folder, file, stamp, json])?;
      }
      let mut delete = tx.prepare("DELETE FROM chapters WHERE folder = ?1 AND file = ?2")?;
      for file in gone {
        delete.execute(params![folder, file])?;
      }
    }
    tx.commit()
  }

  /// One page of the library in title order, filtered to manga whose title
  /// or folder name contains `query`, ignoring case and accents.
  pub fn page(
    &self,
    query: &str,
    after: Option<&str>,
    limit: usize,
  ) -> rusqlite::Result<LibraryPage> {
    let after = after.map(listing::parse_cursor);
    let q = fold(query);
    let trigram = q.chars().count() >= TRIGRAM;
    let needle = if trigram {
      format!("\"{}\"", q.replace('"', "\"\""))
    } else {
      q.clone()
    };
    let fetch = (limit + 1) as i64;

    // Clauses are added only when used: an `OR :after IS NULL` escape hatch
    // would keep SQLite from walking the sort index from the cursor.
    let mut clauses = vec!["1"];
    let mut args: Vec<(&str, &dyn rusqlite::ToSql)> = vec![(":limit", &fetch)];
    if let Some((title, folder)) = &after {
      clauses.push("(sort_title, folder) > (:after_title, :after_folder)");
      args.push((":after_title", title));
      args.push((":after_folder", folder));
    }
    if !q.is_empty() {
      clauses.push(if trigram {
        "rowid IN (SELECT rowid FROM manga_fts WHERE manga_fts MATCH :needle)"
      } else {
        "instr(search, :needle) > 0"
      });
      args.push((":needle", &needle));
    }
    let sql = format!(
      "SELECT folder, title, cover, meta IS NOT NULL, sort_title, cover_stamp FROM manga
       WHERE {} ORDER BY sort_title, folder LIMIT :limit",
      clauses.join(" AND ")
    );

    let conn = lock(&self.conn);
    let mut stmt = conn.prepare(&sql)?;
    let mut rows: Vec<(LibraryEntry, String)> = stmt
      .query_map(&*args, |r| {
        let folder: String = r.get(0)?;
        Ok((
          LibraryEntry {
            slug: encode_uri_component(&folder),
            name: folder,
            title: r.get(1)?,
            cover: r.get(2)?,
            scanned: r.get(3)?,
            cover_version: r.get(5)?,
          },
          r.get(4)?,
        ))
      })?
      .collect::<rusqlite::Result<_>>()?;

    let more = rows.len() > limit;
    rows.truncate(limit);
    let next = match rows.last() {
      Some((entry, sort_title)) if more => Some(listing::cursor((sort_title, &entry.name))),
      _ => None,
    };
    Ok(LibraryPage {
      entries: rows.into_iter().map(|(e, _)| e).collect(),
      next,
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use klparse::fixture::{stored, Fixture};

  struct Lib {
    tmp: tempfile::TempDir,
    root: PathBuf,
    db: Arc<Db>,
  }

  fn lib() -> Lib {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("manga");
    std::fs::create_dir_all(&root).unwrap();
    let db = Db::open(&tmp.path().join("library.db")).unwrap();
    Lib { tmp, root, db }
  }

  fn manga(l: &Lib, folder: &str, series: Option<&str>) {
    let dir = l.root.join(folder);
    std::fs::create_dir_all(&dir).unwrap();
    let mut fx = Fixture::new().entry(stored("01.png", b"x"));
    if let Some(s) = series {
      let xml = format!("<ComicInfo><Series>{s}</Series></ComicInfo>");
      fx = fx.entry(stored("ComicInfo.xml", xml.as_bytes()));
    }
    std::fs::write(dir.join("ch1.cbz"), fx.build()).unwrap();
  }

  /// Syncs and sweeps inline, as the background thread would.
  fn scan(l: &Lib) {
    l.db.sync_folders(&l.root).unwrap();
    l.db.sweep(&l.root).unwrap();
  }

  fn names(page: &LibraryPage) -> Vec<&str> {
    page.entries.iter().map(|e| e.name.as_str()).collect()
  }

  #[test]
  fn lists_folders_before_any_metadata_is_read() {
    let l = lib();
    manga(&l, "Berserk", None);
    manga(&l, "Akira", None);
    l.db.sync_folders(&l.root).unwrap();

    let page = l.db.page("", None, 10).unwrap();
    assert_eq!(names(&page), ["Akira", "Berserk"]);
    assert!(page.entries.iter().all(|e| !e.scanned));
  }

  #[test]
  fn sorts_by_comicinfo_title() {
    let l = lib();
    manga(&l, "aaa", Some("Zeta"));
    manga(&l, "zzz", Some("Alpha"));
    scan(&l);

    let page = l.db.page("", None, 10).unwrap();
    assert_eq!(names(&page), ["zzz", "aaa"]);
    assert_eq!(page.entries[0].title.as_deref(), Some("Alpha"));
    assert!(page.entries[0].scanned);
  }

  #[test]
  fn pages_cover_every_manga_once() {
    let l = lib();
    for n in ["A", "B", "C", "D", "E"] {
      manga(&l, n, None);
    }
    scan(&l);

    let mut seen = Vec::new();
    let mut after: Option<String> = None;
    loop {
      let page = l.db.page("", after.as_deref(), 2).unwrap();
      seen.extend(names(&page).into_iter().map(String::from));
      match page.next {
        Some(n) => after = Some(n),
        None => break,
      }
    }
    assert_eq!(seen, ["A", "B", "C", "D", "E"]);
  }

  #[test]
  fn search_matches_title_or_folder_ignoring_case_and_accents() {
    let l = lib();
    manga(&l, "okami-folder", Some("Ōkami"));
    manga(&l, "One Piece", None);
    manga(&l, "Berserk", None);
    scan(&l);

    assert_eq!(
      names(&l.db.page("OKAMI", None, 10).unwrap()),
      ["okami-folder"]
    );
    assert_eq!(names(&l.db.page("piece", None, 10).unwrap()), ["One Piece"]);
    // Too short for the trigram index.
    assert_eq!(names(&l.db.page("rs", None, 10).unwrap()), ["Berserk"]);
  }

  #[test]
  fn sync_drops_removed_folders() {
    let l = lib();
    manga(&l, "Akira", None);
    manga(&l, "Berserk", None);
    scan(&l);
    std::fs::remove_dir_all(l.root.join("Akira")).unwrap();
    l.db.sync_folders(&l.root).unwrap();
    assert_eq!(names(&l.db.page("", None, 10).unwrap()), ["Berserk"]);
  }

  #[test]
  fn a_rewritten_archive_makes_the_metadata_stale() {
    let l = lib();
    manga(&l, "m", Some("Old"));
    scan(&l);
    let path = l.root.join("m");
    assert!(l.db.meta(&path, "m").unwrap().contains("Old"));

    // Overwritten in place: the folder's mtime may not move, the archive's does.
    std::thread::sleep(Duration::from_millis(20));
    let fx = Fixture::new().entry(stored("01.png", b"x")).entry(stored(
      "ComicInfo.xml",
      b"<ComicInfo><Series>New Title</Series></ComicInfo>",
    ));
    std::fs::write(path.join("ch1.cbz"), fx.build()).unwrap();

    assert!(l.db.meta(&path, "m").unwrap().contains("New Title"));
    assert_eq!(names(&l.db.page("new title", None, 10).unwrap()), ["m"]);
  }

  #[test]
  fn another_directory_starts_over() {
    let l = lib();
    manga(&l, "Akira", None);
    scan(&l);
    let other = l.tmp.path().join("other");
    std::fs::create_dir_all(other.join("Monster")).unwrap();
    l.db.sync_folders(&other).unwrap();
    assert_eq!(names(&l.db.page("", None, 10).unwrap()), ["Monster"]);
  }

  #[test]
  fn a_replaced_cover_gets_a_new_version() {
    let l = lib();
    manga(&l, "m", None);
    let cover = l.root.join("m").join("cover.png");
    std::fs::write(&cover, b"one").unwrap();
    scan(&l);
    let before = l.db.page("", None, 10).unwrap().entries[0]
      .cover_version
      .clone();
    assert!(before.is_some());

    std::thread::sleep(Duration::from_millis(20));
    std::fs::write(&cover, b"two!").unwrap();
    l.db.sweep(&l.root).unwrap();
    let after = l.db.page("", None, 10).unwrap().entries[0]
      .cover_version
      .clone();
    assert_ne!(before, after);
  }
}
