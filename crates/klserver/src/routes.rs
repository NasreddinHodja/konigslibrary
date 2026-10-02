//! HTTP surface.
//!
//! Port of the five `src/routes/api/**/+server.ts` handlers, plus serving the
//! static SPA build that SvelteKit's adapter-node used to serve.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
  extract::{ConnectInfo, Query, RawPathParams, RawQuery, State},
  http::{header, HeaderMap, HeaderValue, Method, StatusCode},
  response::{IntoResponse, Response},
  routing::get,
  Json, Router,
};
use serde_json::json;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::config::Config;
use crate::db::Db;
use crate::library;
use crate::zipcache::ZipCache;

pub struct AppState {
  pub config: Config,
  pub cache: ZipCache,
  pub db: Arc<Db>,
  pub static_dir: PathBuf,
}

pub type SharedState = Arc<AppState>;

/// Pages inside a chapter archive never change in place, so they can be cached
/// indefinitely.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// Whether a request came from this machine.
///
/// `POST /api/settings` and `GET /api/settings/browse` are gated on this: the
/// LAN server is reachable by every device on the network, and neither
/// rewriting the served directory nor walking the host's filesystem should be
/// exposed to them. Kept byte-for-byte equivalent to the TypeScript check
/// against `127.0.0.1` and `::1`, with the IPv4-mapped form of loopback also
/// accepted because a dual-stack listener reports v4 clients that way.
fn is_local_client(addr: SocketAddr) -> bool {
  match addr.ip() {
    IpAddr::V4(v4) => v4 == Ipv4Addr::LOCALHOST,
    IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
      Some(v4) => v4 == Ipv4Addr::LOCALHOST,
      None => v6 == Ipv6Addr::LOCALHOST,
    },
  }
}

/// Whether a request comes from a page this server served to this machine,
/// not from another site open in the same browser.
///
/// A loopback peer alone doesn't show that: any site the user visits can make
/// their browser call `http://localhost:<port>`, and through DNS rebinding can
/// even do it same-origin. Browsers always send `Host`, and `Origin` on a
/// cross-origin or POST request, so a page of ours has a loopback `Host` and,
/// if there is an `Origin`, the same one. Non-browser clients send neither
/// header and are judged by their peer address alone.
fn is_local_page(headers: &HeaderMap) -> bool {
  let host = headers.get(header::HOST).and_then(|h| h.to_str().ok());
  if let Some(host) = host {
    let name = match host.strip_prefix('[') {
      Some(v6) => v6.split_once(']').map_or(v6, |(addr, _)| addr),
      None => host.rsplit_once(':').map_or(host, |(name, _)| name),
    };
    if !matches!(name, "localhost" | "127.0.0.1" | "::1") {
      return false;
    }
  }
  match headers.get(header::ORIGIN) {
    None => true,
    Some(origin) => {
      let authority = origin
        .to_str()
        .ok()
        .and_then(|o| o.split_once("://"))
        .map(|(_, rest)| rest);
      authority.is_some() && authority == host
    }
  }
}

fn forbidden() -> Response {
  (StatusCode::FORBIDDEN, Json(json!({ "error": "Forbidden" }))).into_response()
}

pub fn router(state: SharedState) -> Router {
  let index = state.static_dir.join("index.html");
  // Unmatched paths fall through to the built SPA, which does its own routing.
  let static_files = ServeDir::new(&state.static_dir).fallback(ServeFile::new(index));

  // The library is read cross-origin; see `cors`.
  let library = Router::new()
    .route("/api/ping", get(get_ping))
    .route("/api/library", get(get_library))
    .route("/api/library/{manga}/chapters", get(get_chapters))
    .route("/api/library/{manga}/meta", get(get_meta))
    .route("/api/library/{manga}/{*path}", get(get_image))
    .layer(cors());
  // Settings are only for the SPA this server serves, which calls them
  // same-origin, so they get no CORS headers: another site's page can't read
  // them or send them JSON.
  let settings = Router::new()
    .route("/api/settings", get(get_settings).post(post_settings))
    .route("/api/settings/browse", get(get_browse));

  library
    .merge(settings)
    .fallback_service(static_files)
    .with_state(state)
}

/// The library API is read cross-origin, so it has to opt in.
///
/// A phone paired over LAN runs the packaged app, whose webview origin is
/// `tauri.localhost`, not this server — without these headers every `fetch`
/// here fails as an opaque "Failed to fetch". Any origin is allowed because
/// the backend-free web deployment can also be pointed at a self-hosted
/// server from whatever domain it happens to be served from. The settings
/// routes are left out (see `router`), and no credentials are involved,
/// which `allow_origin` of `Any` forbids anyway.
fn cors() -> CorsLayer {
  CorsLayer::new()
    .allow_origin(Any)
    .allow_methods([Method::GET, Method::POST])
    .allow_headers(Any)
}

/// Runs a handler's file and database work on tokio's blocking pool. Syncing
/// the library, parsing archives and reading files all block, and on a worker
/// thread they would hold up every other request — `/api/ping` included,
/// which the client then takes for the server being down.
async fn blocking(work: impl FnOnce() -> Response + Send + 'static) -> Response {
  tokio::task::spawn_blocking(work)
    .await
    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Reachability probe: the client polls this while offline, so it must stay
/// cheaper than `/api/library`, which can re-sync the library database.
async fn get_ping() -> StatusCode {
  StatusCode::NO_CONTENT
}

/// Manga per page when the client does not ask for a size, and the most it
/// may ask for.
const LIBRARY_PAGE: usize = 100;
const LIBRARY_PAGE_MAX: usize = 500;

#[derive(serde::Deserialize)]
pub struct LibraryQuery {
  q: Option<String>,
  after: Option<String>,
  limit: Option<usize>,
}

async fn get_library(
  State(state): State<SharedState>,
  Query(query): Query<LibraryQuery>,
) -> Response {
  blocking(move || library_page(&state, &query)).await
}

fn library_page(state: &AppState, query: &LibraryQuery) -> Response {
  let limit = query
    .limit
    .unwrap_or(LIBRARY_PAGE)
    .clamp(1, LIBRARY_PAGE_MAX);
  let Some(dir) = state.config.manga_dir() else {
    return Json(json!({ "entries": [], "next": null })).into_response();
  };
  state.db.refresh(&dir);
  match state.db.page(
    query.q.as_deref().unwrap_or(""),
    query.after.as_deref(),
    limit,
  ) {
    Ok(page) => Json(page).into_response(),
    Err(e) => (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(json!({ "error": e.to_string() })),
    )
      .into_response(),
  }
}

/// Path parameters arrive percent-encoded and are decoded exactly once here.
///
/// The old stack decoded inconsistently — SvelteKit decoded the param, then
/// `library.ts` called `decodeURIComponent` again for directory manga but not
/// for zip entries — so a filename containing a literal `%` behaved differently
/// depending on the manga's type. One decode, in one place, for both.
fn decode_param(raw: &str) -> Option<String> {
  klparse::decode_uri_component(raw)
}

fn raw_param<'a>(params: &'a RawPathParams, name: &str) -> Option<&'a str> {
  params.iter().find(|(k, _)| *k == name).map(|(_, v)| v)
}

async fn get_chapters(State(state): State<SharedState>, params: RawPathParams) -> Response {
  let Some(manga) = raw_param(&params, "manga").and_then(decode_param) else {
    return Json(Vec::<library::ServerChapter>::new()).into_response();
  };
  blocking(move || Json(library::list_chapters(&state.config, &state.db, &manga)).into_response())
    .await
}

async fn get_meta(State(state): State<SharedState>, params: RawPathParams) -> Response {
  let Some(manga) = raw_param(&params, "manga").and_then(decode_param) else {
    return (StatusCode::NOT_FOUND, "Not found").into_response();
  };
  blocking(move || {
    let meta = library::manga_path(&state.config, &manga)
      .filter(|(_, path)| path.is_dir())
      .and_then(|(_, path)| state.db.meta(&path, &manga));
    match meta {
      Some(json) => ([(header::CONTENT_TYPE, "application/json")], json).into_response(),
      None => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
  })
  .await
}

async fn get_image(
  State(state): State<SharedState>,
  params: RawPathParams,
  RawQuery(query): RawQuery,
) -> Response {
  let not_found = || (StatusCode::NOT_FOUND, "Not found").into_response();

  let (Some(manga), Some(raw_path)) = (
    raw_param(&params, "manga").and_then(decode_param),
    raw_param(&params, "path"),
  ) else {
    return not_found();
  };

  // Each segment is decoded on its own, so an encoded `/` inside a filename
  // stays part of that filename instead of becoming a path separator.
  let Some(parts) = raw_path
    .split('/')
    .map(decode_param)
    .collect::<Option<Vec<String>>>()
  else {
    return not_found();
  };

  blocking(move || {
    let Some(image) = library::get_file(&state.config, &state.cache, &manga, &parts) else {
      return not_found();
    };
    // Covers and whole archives can be replaced in place, so only pages are
    // addressed by paths that never change — and a cover asked for by the
    // version the library listed, which a replaced cover no longer matches.
    let versioned = query
      .as_deref()
      .is_some_and(|q| q.split('&').any(|kv| kv.starts_with("v=")));
    let cache_control = if parts.len() > 1 || versioned {
      IMMUTABLE
    } else {
      "no-cache"
    };

    (
      [
        (
          header::CONTENT_TYPE,
          HeaderValue::from_static(klparse::content_type(&image.ext)),
        ),
        (
          header::CACHE_CONTROL,
          HeaderValue::from_static(cache_control),
        ),
      ],
      image.bytes,
    )
      .into_response()
  })
  .await
}

async fn get_settings(State(state): State<SharedState>) -> Response {
  Json(json!({ "mangaDir": state.config.manga_dir_display() })).into_response()
}

async fn post_settings(
  State(state): State<SharedState>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  headers: HeaderMap,
  body: Option<Json<serde_json::Value>>,
) -> Response {
  if !is_local_client(addr) || !is_local_page(&headers) {
    return forbidden();
  }

  let Some(Json(body)) = body else {
    return (
      StatusCode::BAD_REQUEST,
      Json(json!({ "error": "mangaDir must be a string" })),
    )
      .into_response();
  };
  let Some(manga_dir) = body.get("mangaDir").and_then(|v| v.as_str()) else {
    return (
      StatusCode::BAD_REQUEST,
      Json(json!({ "error": "mangaDir must be a string" })),
    )
      .into_response();
  };

  // Saving would succeed and change nothing: the variable wins.
  if state.config.manga_dir_is_from_env() {
    return (
      StatusCode::CONFLICT,
      Json(json!({ "error": "The manga directory is set by MANGA_DIR" })),
    )
      .into_response();
  }

  if let Err(e) = state.config.save_manga_dir(manga_dir) {
    return (
      StatusCode::INTERNAL_SERVER_ERROR,
      Json(json!({ "error": e.to_string() })),
    )
      .into_response();
  }
  // Echoes back what was sent, before `~` expansion, as the old handler did.
  Json(json!({ "mangaDir": manga_dir })).into_response()
}

#[derive(serde::Deserialize)]
pub struct BrowseQuery {
  path: Option<String>,
}

async fn get_browse(
  State(state): State<SharedState>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  headers: HeaderMap,
  Query(query): Query<BrowseQuery>,
) -> Response {
  if !is_local_client(addr) || !is_local_page(&headers) {
    return forbidden();
  }

  blocking(
    move || match library::browse_dir(&state.config, query.path.as_deref()) {
      Ok(result) => Json(result).into_response(),
      Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
    },
  )
  .await
}

#[cfg(test)]
mod tests {
  use super::*;
  use axum::body::Body;
  use axum::http::Request;
  use http_body_util::BodyExt;
  use klparse::fixture::{stored, Fixture};
  use std::path::Path;
  use tower::ServiceExt;

  struct Harness {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    state: SharedState,
  }

  fn harness() -> Harness {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("manga");
    let conf = tmp.path().join("conf");
    let static_dir = tmp.path().join("client");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&conf).unwrap();
    std::fs::create_dir_all(&static_dir).unwrap();
    std::fs::write(
      static_dir.join("index.html"),
      "<!doctype html><title>SPA</title>",
    )
    .unwrap();
    std::fs::write(static_dir.join("favicon.png"), b"ICON").unwrap();

    let config = Config::for_test(
      &conf,
      &tmp.path().to_string_lossy(),
      Some(&root.to_string_lossy()),
    );
    let state = Arc::new(AppState {
      config,
      cache: ZipCache::new(),
      db: Db::open(&tmp.path().join("library.db")).unwrap(),
      static_dir,
    });
    Harness {
      _tmp: tmp,
      root,
      state,
    }
  }

  /// A config with no manga directory, so `POST /api/settings` has something to
  /// change.
  fn harness_unset() -> Harness {
    let h = harness();
    let conf = h._tmp.path().join("conf");
    let config = Config::for_test(&conf, &h._tmp.path().to_string_lossy(), None);
    let static_dir = h.state.static_dir.clone();
    let state = Arc::new(AppState {
      config,
      cache: ZipCache::new(),
      db: Db::open(&h._tmp.path().join("library-unset.db")).unwrap(),
      static_dir,
    });
    Harness {
      _tmp: h._tmp,
      root: h.root,
      state,
    }
  }

  const LOCAL_V4: &str = "127.0.0.1:54321";
  const LOCAL_V6: &str = "[::1]:54321";
  const LAN: &str = "192.168.1.50:54321";

  async fn send(h: &Harness, req: Request<Body>) -> (StatusCode, Vec<u8>, Response<()>) {
    let res = router(Arc::clone(&h.state)).oneshot(req).await.unwrap();
    let status = res.status();
    let (parts, body) = res.into_parts();
    let bytes = body.collect().await.unwrap().to_bytes().to_vec();
    (status, bytes, Response::from_parts(parts, ()))
  }

  fn get_from(uri: &str, peer: &str) -> Request<Body> {
    let addr: SocketAddr = peer.parse().unwrap();
    let mut req = Request::builder().uri(uri).body(Body::empty()).unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));
    req
  }

  fn post_from(uri: &str, peer: &str, body: &str) -> Request<Body> {
    let addr: SocketAddr = peer.parse().unwrap();
    let mut req = Request::builder()
      .method("POST")
      .uri(uri)
      .header("content-type", "application/json")
      .body(Body::from(body.to_string()))
      .unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));
    req
  }

  fn touch(base: &Path, rel: &str, body: &[u8]) {
    let p = base.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
  }

  fn write_zip(base: &Path, name: &str, entries: &[(&str, &[u8])]) {
    let mut fx = Fixture::new();
    for (n, d) in entries {
      fx = fx.entry(stored(n, d));
    }
    std::fs::write(base.join(name), fx.build()).unwrap();
  }

  // --- the localhost guard (security-critical, must not regress) ---

  #[tokio::test]
  async fn post_settings_is_forbidden_for_a_lan_client() {
    let h = harness_unset();
    let (status, body, _) = send(
      &h,
      post_from("/api/settings", LAN, r#"{"mangaDir":"/tmp/evil"}"#),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(String::from_utf8_lossy(&body), r#"{"error":"Forbidden"}"#);
    // The rejected request must not have written anything.
    assert!(!h.state.config.config_path().exists());
  }

  #[tokio::test]
  async fn post_settings_is_allowed_from_loopback() {
    for peer in [LOCAL_V4, LOCAL_V6] {
      let h = harness_unset();
      let target = h._tmp.path().join("newdir");
      std::fs::create_dir_all(&target).unwrap();
      let body = format!(r#"{{"mangaDir":"{}"}}"#, target.to_string_lossy());

      let (status, _, _) = send(&h, post_from("/api/settings", peer, &body)).await;
      assert_eq!(status, StatusCode::OK, "peer {peer} should be allowed");
      assert_eq!(h.state.config.manga_dir().as_deref(), Some(&*target));
    }
  }

  #[tokio::test]
  async fn post_settings_refuses_when_manga_dir_comes_from_the_environment() {
    let h = harness();
    let (status, _, _) = send(
      &h,
      post_from("/api/settings", LOCAL_V4, r#"{"mangaDir":"/elsewhere"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(h.state.config.manga_dir().as_deref(), Some(&*h.root));
  }

  #[tokio::test]
  async fn browse_is_forbidden_for_a_lan_client() {
    let h = harness();
    let (status, body, _) = send(&h, get_from("/api/settings/browse?path=/etc", LAN)).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(String::from_utf8_lossy(&body), r#"{"error":"Forbidden"}"#);
  }

  #[tokio::test]
  async fn browse_is_allowed_from_loopback() {
    let h = harness();
    std::fs::create_dir_all(h.root.join("Berserk")).unwrap();
    let uri = format!("/api/settings/browse?path={}", h.root.to_string_lossy());

    let (status, body, _) = send(&h, get_from(&uri, LOCAL_V4)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&body).contains("Berserk"));
  }

  #[tokio::test]
  async fn browse_reports_a_bad_path_as_400() {
    let h = harness();
    let (status, _, _) = send(
      &h,
      get_from("/api/settings/browse?path=/definitely/not/real", LOCAL_V4),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
  }

  #[tokio::test]
  async fn get_settings_is_not_gated_on_being_local() {
    // Only the mutating and filesystem-walking endpoints are restricted; the
    // LAN client needs to be able to read which directory is being served.
    let h = harness();
    let (status, body, _) = send(&h, get_from("/api/settings", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&body).contains("mangaDir"));
  }

  #[tokio::test]
  async fn post_settings_rejects_a_non_string_manga_dir() {
    let h = harness_unset();
    for body in [
      r#"{"mangaDir":123}"#,
      r#"{"mangaDir":null}"#,
      r#"{"mangaDir":{}}"#,
      r#"{}"#,
    ] {
      let (status, _, _) = send(&h, post_from("/api/settings", LOCAL_V4, body)).await;
      assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "body {body} should be rejected"
      );
      assert!(!h.state.config.config_path().exists());
    }
  }

  #[tokio::test]
  async fn post_settings_rejects_a_malformed_body() {
    let h = harness_unset();
    let (status, _, _) = send(&h, post_from("/api/settings", LOCAL_V4, "not json")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
  }

  // --- library and chapters ---

  #[tokio::test]
  async fn ping_answers_a_lan_client() {
    let h = harness();
    let (status, _, _) = send(&h, get_from("/api/ping", LAN)).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
  }

  #[tokio::test]
  async fn library_lists_the_configured_directory() {
    let h = harness();
    std::fs::create_dir_all(h.root.join("Berserk")).unwrap();
    std::fs::create_dir_all(h.root.join("Akira")).unwrap();

    let (status, body, _) = send(&h, get_from("/api/library", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(parsed["entries"][0]["name"], "Akira");
    assert_eq!(parsed["entries"][1]["name"], "Berserk");
    assert_eq!(parsed["next"], serde_json::Value::Null);
  }

  #[tokio::test]
  async fn library_pages_through_the_directory() {
    let h = harness();
    for name in ["Akira", "Berserk", "Monster"] {
      std::fs::create_dir_all(h.root.join(name)).unwrap();
    }

    let (_, body, _) = send(&h, get_from("/api/library?limit=2", LAN)).await;
    let first: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(first["entries"].as_array().unwrap().len(), 2);
    let next = first["next"].as_str().unwrap();

    let uri = format!(
      "/api/library?limit=2&after={}",
      klparse::encode_uri_component(next)
    );
    let (_, body, _) = send(&h, get_from(&uri, LAN)).await;
    let second: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(second["entries"][0]["name"], "Monster");
    assert_eq!(second["next"], serde_json::Value::Null);
  }

  #[tokio::test]
  async fn library_filters_by_name() {
    let h = harness();
    for name in ["One Piece", "Berserk"] {
      std::fs::create_dir_all(h.root.join(name)).unwrap();
    }
    let (_, body, _) = send(&h, get_from("/api/library?q=piece", LAN)).await;
    let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(parsed["entries"].as_array().unwrap().len(), 1);
    assert_eq!(parsed["entries"][0]["name"], "One Piece");
  }

  #[tokio::test]
  async fn chapters_are_served_for_a_percent_encoded_slug() {
    let h = harness();
    std::fs::create_dir_all(h.root.join("One Piece")).unwrap();
    write_zip(
      &h.root.join("One Piece"),
      "ch01.cbz",
      &[("page01.png", b"x")],
    );

    let (status, body, _) = send(&h, get_from("/api/library/One%20Piece/chapters", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(parsed[0]["name"], "ch01");
    assert_eq!(parsed[0]["pageCount"], 1);
  }

  #[tokio::test]
  async fn chapters_for_a_traversing_slug_return_an_empty_list() {
    let h = harness();
    let secret = h.root.parent().unwrap().join("secret");
    std::fs::create_dir_all(&secret).unwrap();
    write_zip(&secret, "ch01.cbz", &[("page01.png", b"SECRET")]);

    let (status, body, _) = send(&h, get_from("/api/library/..%2Fsecret/chapters", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(String::from_utf8_lossy(&body), "[]");
  }

  // --- metadata ---

  #[tokio::test]
  async fn meta_reads_comic_info_and_finds_the_cover() {
    let h = harness();
    touch(&h.root, "One Piece/cover.jpg", b"x");
    std::fs::create_dir_all(h.root.join("One Piece")).unwrap();
    write_zip(
      &h.root.join("One Piece"),
      "ch1.cbz",
      &[
        ("01.jpg", b"x"),
        (
          "ComicInfo.xml",
          b"<ComicInfo><Series>One Piece</Series><Year>1997</Year></ComicInfo>",
        ),
      ],
    );

    let (status, body, _) = send(&h, get_from("/api/library/One%20Piece/meta", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(parsed["title"], "One Piece");
    assert_eq!(parsed["year"], 1997);
    assert_eq!(parsed["cover"], "cover.jpg");
  }

  #[tokio::test]
  async fn meta_for_a_traversing_slug_is_a_404() {
    let h = harness();
    std::fs::create_dir_all(h.root.parent().unwrap().join("secret")).unwrap();
    let (status, _, _) = send(&h, get_from("/api/library/..%2Fsecret/meta", LAN)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
  }

  // --- files ---

  fn berserk(h: &Harness) -> PathBuf {
    let dir = h.root.join("Berserk");
    std::fs::create_dir_all(&dir).unwrap();
    write_zip(&dir, "ch01.cbz", &[("ch01/page01.jpg", b"JPEGDATA")]);
    touch(&dir, "cover.png", b"PNGDATA");
    dir
  }

  #[tokio::test]
  async fn a_page_is_extracted_from_its_chapter_archive() {
    let h = harness();
    berserk(&h);

    let (status, body, res) = send(
      &h,
      get_from("/api/library/Berserk/ch01.cbz/ch01/page01.jpg", LAN),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"JPEGDATA");
    assert_eq!(res.headers()[header::CONTENT_TYPE], "image/jpeg");
    assert_eq!(res.headers()[header::CACHE_CONTROL], IMMUTABLE);
  }

  #[tokio::test]
  async fn the_cover_and_whole_archives_are_served_uncached() {
    let h = harness();
    let dir = berserk(&h);

    let (status, body, res) = send(&h, get_from("/api/library/Berserk/cover.png", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"PNGDATA");
    assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-cache");

    let (_, _, res) = send(&h, get_from("/api/library/Berserk/cover.png?v=1:7", LAN)).await;
    assert_eq!(res.headers()[header::CACHE_CONTROL], IMMUTABLE);

    let (status, body, _) = send(&h, get_from("/api/library/Berserk/ch01.cbz", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, std::fs::read(dir.join("ch01.cbz")).unwrap());
  }

  #[tokio::test]
  async fn a_missing_file_is_a_clean_404() {
    let h = harness();
    berserk(&h);

    let (status, body, _) = send(&h, get_from("/api/library/Berserk/nope.png", LAN)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(String::from_utf8_lossy(&body), "Not found");
  }

  #[tokio::test]
  async fn a_non_image_file_is_not_served_even_when_it_exists() {
    let h = harness();
    touch(&h.root, "Berserk/id_rsa", b"PRIVATE KEY");

    let (status, _, _) = send(&h, get_from("/api/library/Berserk/id_rsa", LAN)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
  }

  #[tokio::test]
  async fn a_traversing_path_is_a_404() {
    let h = harness();
    berserk(&h);
    touch(h.root.parent().unwrap(), "secret.png", b"SECRET");

    for uri in [
      "/api/library/Berserk/..%2F..%2Fsecret.png",
      "/api/library/..%2F..%2Fsecret.png/x.png",
      "/api/library/..%2F/secret.png",
    ] {
      let (status, body, _) = send(&h, get_from(uri, LAN)).await;
      assert_eq!(status, StatusCode::NOT_FOUND, "{uri} should not resolve");
      assert_ne!(body, b"SECRET");
    }
  }

  // --- static fallback ---

  #[tokio::test]
  async fn unmatched_routes_serve_the_spa() {
    let h = harness();
    let (status, body, _) = send(&h, get_from("/settings", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&body).contains("<title>SPA</title>"));
  }

  #[tokio::test]
  async fn static_assets_are_served_from_the_build_directory() {
    let h = harness();
    let (status, body, _) = send(&h, get_from("/favicon.png", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"ICON");
  }

  // --- CORS (a LAN-paired phone reads this API from tauri.localhost) ---

  #[tokio::test]
  async fn api_responses_are_readable_cross_origin() {
    let h = harness();
    let mut req = get_from("/api/library", LAN);
    req.headers_mut().insert(
      header::ORIGIN,
      HeaderValue::from_static("http://tauri.localhost"),
    );
    let (status, _, res) = send(&h, req).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
      res.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
      Some(&HeaderValue::from_static("*"))
    );
  }

  fn preflight(uri: &str) -> Request<Body> {
    let addr: SocketAddr = LAN.parse().unwrap();
    let mut req = Request::builder()
      .method("OPTIONS")
      .uri(uri)
      .header(header::ORIGIN, "http://tauri.localhost")
      .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
      .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
      .body(Body::empty())
      .unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));
    req
  }

  #[tokio::test]
  async fn preflight_is_answered() {
    let h = harness();
    let (status, _, res) = send(&h, preflight("/api/library")).await;
    assert!(status.is_success(), "preflight returned {status}");
    assert_eq!(
      res.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
      Some(&HeaderValue::from_static("*"))
    );
  }

  // --- other sites in the host's browser (security-critical) ---

  #[tokio::test]
  async fn settings_are_not_opened_cross_origin() {
    let h = harness();
    for uri in ["/api/settings", "/api/settings/browse"] {
      let (_, _, res) = send(&h, preflight(uri)).await;
      assert_eq!(
        res.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        None,
        "{uri} must not allow other origins"
      );
    }
  }

  fn with_headers(
    mut req: Request<Body>,
    headers: &[(header::HeaderName, &'static str)],
  ) -> Request<Body> {
    for (name, value) in headers {
      req
        .headers_mut()
        .insert(name, HeaderValue::from_static(value));
    }
    req
  }

  #[tokio::test]
  async fn browse_is_forbidden_to_another_site_on_this_machine() {
    let h = harness();
    let uri = format!("/api/settings/browse?path={}", h.root.to_string_lossy());
    let cases: &[&[(header::HeaderName, &'static str)]] = &[
      // A cross-origin fetch to localhost.
      &[
        (header::HOST, "localhost:3000"),
        (header::ORIGIN, "https://evil.example"),
      ],
      // DNS rebinding: same-origin, but under the attacker's name.
      &[
        (header::HOST, "evil.example:3000"),
        (header::ORIGIN, "http://evil.example:3000"),
      ],
      &[(header::HOST, "evil.example:3000")],
    ];
    for headers in cases {
      let (status, _, _) = send(&h, with_headers(get_from(&uri, LOCAL_V4), headers)).await;
      assert_eq!(status, StatusCode::FORBIDDEN, "{headers:?}");
    }
  }

  #[tokio::test]
  async fn browse_is_allowed_from_our_own_page() {
    let h = harness();
    let uri = format!("/api/settings/browse?path={}", h.root.to_string_lossy());
    let cases: &[&[(header::HeaderName, &'static str)]] = &[
      &[(header::HOST, "localhost:3000")],
      &[
        (header::HOST, "127.0.0.1:3000"),
        (header::ORIGIN, "http://127.0.0.1:3000"),
      ],
      &[
        (header::HOST, "[::1]:3000"),
        (header::ORIGIN, "http://[::1]:3000"),
      ],
    ];
    for headers in cases {
      let (status, _, _) = send(&h, with_headers(get_from(&uri, LOCAL_V4), headers)).await;
      assert_eq!(status, StatusCode::OK, "{headers:?}");
    }
  }

  #[tokio::test]
  async fn post_settings_is_forbidden_to_another_site_on_this_machine() {
    let h = harness_unset();
    let req = with_headers(
      post_from("/api/settings", LOCAL_V4, r#"{"mangaDir":"/"}"#),
      &[
        (header::HOST, "localhost:3000"),
        (header::ORIGIN, "https://evil.example"),
      ],
    );
    let (status, _, _) = send(&h, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(!h.state.config.config_path().exists());
  }
}
