//! HTTP surface.
//!
//! The JSON API under `/api`, plus the static SPA build for everything else.

use std::path::PathBuf;
use std::sync::Arc;

use axum::{
  body::Body,
  extract::{Query, RawPathParams, RawQuery, Request, State},
  http::{header, HeaderValue, Method, StatusCode},
  middleware,
  response::{IntoResponse, Response},
  routing::{delete, get, post},
  Json, Router,
};
use serde_json::json;
use tower_http::cors::{AllowHeaders, Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::auth::{self, Auth};
use crate::config::Config;
use crate::db::Db;
use crate::library;
use klfs::ZipCache;

pub struct AppState {
  pub config: Config,
  pub cache: ZipCache,
  pub db: Arc<Db>,
  pub static_dir: PathBuf,
  pub auth: Auth,
}

pub type SharedState = Arc<AppState>;

/// Pages inside a chapter archive never change in place, so they can be cached
/// indefinitely.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

/// A `{"error": …}` response, the shape the client reads failures from.
pub(crate) fn error(status: StatusCode, message: impl std::fmt::Display) -> Response {
  (status, Json(json!({ "error": message.to_string() }))).into_response()
}

pub(crate) fn unauthorized() -> Response {
  error(StatusCode::UNAUTHORIZED, "Unauthorized")
}

pub fn router(state: SharedState) -> Router {
  let index = state.static_dir.join("index.html");
  // Unmatched paths fall through to the built SPA, which does its own routing.
  let static_files = ServeDir::new(&state.static_dir).fallback(ServeFile::new(index));

  let require_session = middleware::from_fn_with_state(Arc::clone(&state), auth::require_session);
  let security_headers =
    middleware::from_fn_with_state(Arc::clone(&state), crate::headers::security_headers);

  // Read cross-origin; see `cors`. `/api/ping` and the routes that start a
  // session are added after the session check, so "unreachable" and "logged
  // out" stay distinguishable.
  let api = Router::new()
    .route("/api/library", get(get_library))
    .route("/api/library/{manga}/chapters", get(get_chapters))
    .route("/api/library/{manga}/meta", get(get_meta))
    .route("/api/library/{manga}/{*path}", get(get_image))
    .route("/api/auth/logout", post(auth::post_logout))
    .route("/api/auth/me", get(auth::get_me))
    .route("/api/auth/password", post(auth::post_password))
    .route("/api/auth/sessions", get(auth::get_sessions))
    .route("/api/auth/sessions/{id}", delete(auth::delete_session))
    .route_layer(require_session.clone())
    .route("/api/ping", get(get_ping))
    .route(
      "/api/auth/setup",
      get(auth::get_setup).post(auth::post_setup),
    )
    .route("/api/auth/login", post(auth::post_login))
    .layer(cors());
  // Settings are only for the SPA this server serves, which calls them
  // same-origin, so they get no CORS headers: another site's page can't read
  // them or send them JSON.
  let settings = Router::new()
    .route("/api/settings", get(get_settings).post(post_settings))
    .route("/api/settings/browse", get(get_browse))
    .route_layer(require_session);

  api
    .merge(settings)
    .fallback_service(static_files)
    .layer(security_headers)
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
/// which `allow_origin` of `Any` forbids anyway: other origins send a bearer
/// token, which a page has to add itself. `Authorization` is listed by name
/// because a `*` in `Access-Control-Allow-Headers` doesn't cover it.
fn cors() -> CorsLayer {
  CorsLayer::new()
    .allow_origin(Any)
    .allow_methods([Method::GET, Method::POST, Method::DELETE])
    .allow_headers(AllowHeaders::list([
      header::AUTHORIZATION,
      header::CONTENT_TYPE,
      header::RANGE,
    ]))
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
    Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e),
  }
}

/// Path parameters arrive percent-encoded and are decoded exactly once here,
/// for every kind of file, so a filename containing a literal `%` resolves the
/// same way whatever it is.
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
  blocking(
    move || match library::list_chapters(&state.config, &state.db, &manga) {
      Ok(chapters) => Json(chapters).into_response(),
      Err(e) => (StatusCode::UNPROCESSABLE_ENTITY, e).into_response(),
    },
  )
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
  req: Request,
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
  let headers = |ext: &str| {
    [
      (
        header::CONTENT_TYPE,
        HeaderValue::from_static(klparse::content_type(ext)),
      ),
      (
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
      ),
    ]
  };

  let found = tokio::task::spawn_blocking(move || {
    library::get_file(&state.config, &state.cache, &manga, &parts)
  })
  .await;
  match found {
    Ok(Some(library::Served::Bytes(image))) => (headers(&image.ext), image.bytes).into_response(),
    // Streamed from disk, ranges and all, rather than read whole into memory.
    Ok(Some(library::Served::File { path, ext })) => {
      match ServeFile::new(path).try_call(req).await {
        Ok(res) => {
          let mut res = res.map(Body::new);
          for (name, value) in headers(&ext) {
            res.headers_mut().insert(name, value);
          }
          res
        }
        Err(_) => not_found(),
      }
    }
    Ok(None) => not_found(),
    Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
  }
}

async fn get_settings(State(state): State<SharedState>) -> Response {
  Json(json!({ "mangaDir": state.config.manga_dir_display() })).into_response()
}

async fn post_settings(
  State(state): State<SharedState>,
  body: Option<Json<serde_json::Value>>,
) -> Response {
  let Some(manga_dir) = body
    .as_ref()
    .and_then(|Json(b)| b.get("mangaDir")?.as_str())
  else {
    return error(StatusCode::BAD_REQUEST, "mangaDir must be a string");
  };

  // Saving would succeed and change nothing: the variable wins.
  if state.config.manga_dir_is_from_env() {
    return error(
      StatusCode::CONFLICT,
      "The manga directory is set by MANGA_DIR",
    );
  }

  if let Err(e) = state.config.save_manga_dir(manga_dir) {
    return error(StatusCode::INTERNAL_SERVER_ERROR, e);
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
  Query(query): Query<BrowseQuery>,
) -> Response {
  blocking(
    move || match library::browse_dir(&state.config, query.path.as_deref()) {
      Ok(result) => Json(result).into_response(),
      Err(e) => error(StatusCode::BAD_REQUEST, e),
    },
  )
  .await
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::auth::proxy::TrustedProxies;
  use crate::auth::store::{Kind, Store};
  use axum::body::Body;
  use axum::extract::ConnectInfo;
  use axum::http::Request;
  use http_body_util::BodyExt;
  use klparse::fixture::{stored, Fixture};
  use std::net::SocketAddr;
  use std::path::Path;
  use tower::ServiceExt;

  struct Harness {
    tmp: tempfile::TempDir,
    root: PathBuf,
    state: SharedState,
    /// A live bearer session.
    token: String,
  }

  const USERNAME: &str = "admin";
  const PASSWORD: &str = "correct horse";

  fn state(
    tmp: &Path,
    config: Config,
    static_dir: PathBuf,
    db: &str,
    proxies: &str,
  ) -> SharedState {
    let store = Store::open(&tmp.join(format!("{db}-auth.db"))).unwrap();
    store
      .create_admin(USERNAME, &auth::password::hash(PASSWORD))
      .unwrap();
    Arc::new(AppState {
      config,
      cache: ZipCache::new(),
      db: Db::open(&tmp.join(format!("{db}.db"))).unwrap(),
      static_dir,
      auth: Auth::new(store, TrustedProxies::parse(proxies).unwrap(), false),
    })
  }

  fn harness_with(manga_dir: bool, proxies: &str) -> Harness {
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

    let root_str = root.to_string_lossy().into_owned();
    let config = Config::for_test(
      &conf,
      &tmp.path().to_string_lossy(),
      manga_dir.then_some(root_str.as_str()),
    );
    let state = state(tmp.path(), config, static_dir, "library", proxies);
    let token = state
      .auth
      .store
      .create_session(Kind::Bearer, "test", auth_now())
      .unwrap();
    Harness {
      tmp,
      root,
      state,
      token,
    }
  }

  fn harness() -> Harness {
    harness_with(true, "")
  }

  /// A config with no manga directory, so `POST /api/settings` has something to
  /// change.
  fn harness_unset() -> Harness {
    harness_with(false, "")
  }

  /// A server with no admin yet.
  fn harness_fresh() -> Harness {
    let h = harness();
    let store = Store::open(&h.tmp.path().join("fresh-auth.db")).unwrap();
    let state = Arc::new(AppState {
      config: h.state.config.clone(),
      cache: ZipCache::new(),
      db: Db::open(&h.tmp.path().join("fresh.db")).unwrap(),
      static_dir: h.state.static_dir.clone(),
      auth: Auth::new(store, TrustedProxies::default(), false),
    });
    Harness { state, ..h }
  }

  fn auth_now() -> i64 {
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_secs() as i64
  }

  const LOCAL_V4: &str = "127.0.0.1:54321";
  const LAN: &str = "192.168.1.50:54321";

  /// `req` with the harness's bearer token, as a signed-in app sends it.
  fn authed(h: &Harness, req: Request<Body>) -> Request<Body> {
    with_bearer(req, &h.token)
  }

  fn with_bearer(mut req: Request<Body>, token: &str) -> Request<Body> {
    req.headers_mut().insert(
      header::AUTHORIZATION,
      HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
    );
    req
  }

  fn with_cookie(mut req: Request<Body>, token: &str) -> Request<Body> {
    req.headers_mut().insert(
      header::COOKIE,
      HeaderValue::from_str(&format!("kl_session={token}")).unwrap(),
    );
    req
  }

  fn json(body: &[u8]) -> serde_json::Value {
    serde_json::from_slice(body).unwrap()
  }

  fn delete_from(uri: &str, peer: &str) -> Request<Body> {
    let addr: SocketAddr = peer.parse().unwrap();
    let mut req = Request::builder()
      .method("DELETE")
      .uri(uri)
      .body(Body::empty())
      .unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));
    req
  }

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

  // --- settings (security-critical, must not regress) ---

  #[tokio::test]
  async fn settings_need_a_session_even_from_this_machine() {
    let h = harness_unset();
    let uri = format!("/api/settings/browse?path={}", h.root.to_string_lossy());
    for peer in [LAN, LOCAL_V4] {
      let (status, _, _) = send(
        &h,
        post_from("/api/settings", peer, r#"{"mangaDir":"/tmp/evil"}"#),
      )
      .await;
      assert_eq!(status, StatusCode::UNAUTHORIZED, "{peer}");
      let (status, _, _) = send(&h, get_from(&uri, peer)).await;
      assert_eq!(status, StatusCode::UNAUTHORIZED, "{peer}");
    }
    // The rejected request must not have written anything.
    assert!(!h.state.config.config_path().exists());
  }

  #[tokio::test]
  async fn post_settings_is_allowed_with_a_session_from_anywhere() {
    for peer in [LAN, LOCAL_V4] {
      let h = harness_unset();
      let target = h.tmp.path().join("newdir");
      std::fs::create_dir_all(&target).unwrap();
      let body = format!(r#"{{"mangaDir":"{}"}}"#, target.to_string_lossy());

      let (status, _, _) = send(&h, authed(&h, post_from("/api/settings", peer, &body))).await;
      assert_eq!(status, StatusCode::OK, "peer {peer} should be allowed");
      assert_eq!(h.state.config.manga_dir().as_deref(), Some(&*target));
    }
  }

  #[tokio::test]
  async fn post_settings_refuses_when_manga_dir_comes_from_the_environment() {
    let h = harness();
    let (status, _, _) = send(
      &h,
      authed(
        &h,
        post_from("/api/settings", LOCAL_V4, r#"{"mangaDir":"/elsewhere"}"#),
      ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(h.state.config.manga_dir().as_deref(), Some(&*h.root));
  }

  #[tokio::test]
  async fn browse_is_allowed_with_a_session() {
    let h = harness();
    std::fs::create_dir_all(h.root.join("Berserk")).unwrap();
    let uri = format!("/api/settings/browse?path={}", h.root.to_string_lossy());

    let (status, body, _) = send(&h, authed(&h, get_from(&uri, LAN))).await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&body).contains("Berserk"));
  }

  #[tokio::test]
  async fn browse_reports_a_bad_path_as_400() {
    let h = harness();
    let (status, _, _) = send(
      &h,
      authed(
        &h,
        get_from("/api/settings/browse?path=/definitely/not/real", LOCAL_V4),
      ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
  }

  #[tokio::test]
  async fn get_settings_reports_the_directory() {
    let h = harness();
    let (status, body, _) = send(&h, authed(&h, get_from("/api/settings", LAN))).await;
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
      let (status, _, _) = send(&h, authed(&h, post_from("/api/settings", LOCAL_V4, body))).await;
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
    let (status, _, _) = send(
      &h,
      authed(&h, post_from("/api/settings", LOCAL_V4, "not json")),
    )
    .await;
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

    let (status, body, _) = send(&h, authed(&h, get_from("/api/library", LAN))).await;
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

    let (_, body, _) = send(&h, authed(&h, get_from("/api/library?limit=2", LAN))).await;
    let first: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(first["entries"].as_array().unwrap().len(), 2);
    let next = first["next"].as_str().unwrap();

    let uri = format!(
      "/api/library?limit=2&after={}",
      klparse::encode_uri_component(next)
    );
    let (_, body, _) = send(&h, authed(&h, get_from(&uri, LAN))).await;
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
    let (_, body, _) = send(&h, authed(&h, get_from("/api/library?q=piece", LAN))).await;
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

    let (status, body, _) = send(
      &h,
      authed(&h, get_from("/api/library/One%20Piece/chapters", LAN)),
    )
    .await;
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

    let (status, body, _) = send(
      &h,
      authed(&h, get_from("/api/library/..%2Fsecret/chapters", LAN)),
    )
    .await;
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

    let (status, body, _) = send(
      &h,
      authed(&h, get_from("/api/library/One%20Piece/meta", LAN)),
    )
    .await;
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
    let (status, _, _) = send(
      &h,
      authed(&h, get_from("/api/library/..%2Fsecret/meta", LAN)),
    )
    .await;
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
      authed(
        &h,
        get_from("/api/library/Berserk/ch01.cbz/ch01/page01.jpg", LAN),
      ),
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

    let (status, body, res) = send(
      &h,
      authed(&h, get_from("/api/library/Berserk/cover.png", LAN)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"PNGDATA");
    assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-cache");

    let (_, _, res) = send(
      &h,
      authed(&h, get_from("/api/library/Berserk/cover.png?v=1:7", LAN)),
    )
    .await;
    assert_eq!(res.headers()[header::CACHE_CONTROL], IMMUTABLE);

    let (status, body, _) = send(
      &h,
      authed(&h, get_from("/api/library/Berserk/ch01.cbz", LAN)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, std::fs::read(dir.join("ch01.cbz")).unwrap());
  }

  fn get_range(h: &Harness, uri: &str, range: &str) -> Request<Body> {
    let mut req = authed(h, get_from(uri, LAN));
    req
      .headers_mut()
      .insert(header::RANGE, HeaderValue::from_str(range).unwrap());
    req
  }

  #[tokio::test]
  async fn a_whole_archive_answers_a_byte_range() {
    let h = harness();
    let whole = std::fs::read(berserk(&h).join("ch01.cbz")).unwrap();
    let len = whole.len();

    let (status, body, res) = send(
      &h,
      get_range(&h, "/api/library/Berserk/ch01.cbz", "bytes=0-3"),
    )
    .await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(body, &whole[..4]);
    assert_eq!(
      res.headers()[header::CONTENT_RANGE],
      format!("bytes 0-3/{len}").as_str()
    );
    // Our headers are still applied on top of the partial response.
    assert_eq!(
      res.headers()[header::CONTENT_TYPE],
      "application/octet-stream"
    );
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-cache");
  }

  #[tokio::test]
  async fn a_missing_file_is_a_clean_404() {
    let h = harness();
    berserk(&h);

    let (status, body, _) = send(
      &h,
      authed(&h, get_from("/api/library/Berserk/nope.png", LAN)),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(String::from_utf8_lossy(&body), "Not found");
  }

  #[tokio::test]
  async fn a_non_image_file_is_not_served_even_when_it_exists() {
    let h = harness();
    touch(&h.root, "Berserk/id_rsa", b"PRIVATE KEY");

    let (status, _, _) = send(&h, authed(&h, get_from("/api/library/Berserk/id_rsa", LAN))).await;
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
      let (status, body, _) = send(&h, authed(&h, get_from(uri, LAN))).await;
      assert_eq!(status, StatusCode::NOT_FOUND, "{uri} should not resolve");
      assert_ne!(body, b"SECRET");
    }
  }

  // --- sessions (security-critical, must not regress) ---

  const PROTECTED: &[&str] = &[
    "/api/library",
    "/api/library/Berserk/chapters",
    "/api/library/Berserk/meta",
    "/api/library/Berserk/cover.png",
    "/api/library/Berserk/ch01.cbz/ch01/page01.jpg",
    "/api/settings",
    "/api/auth/me",
    "/api/auth/sessions",
  ];

  #[tokio::test]
  async fn without_a_session_everything_is_refused() {
    let h = harness();
    berserk(&h);
    for uri in PROTECTED {
      let (status, body, _) = send(&h, get_from(uri, LAN)).await;
      assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri}");
      assert_eq!(
        String::from_utf8_lossy(&body),
        r#"{"error":"Unauthorized"}"#
      );
    }
  }

  #[tokio::test]
  async fn being_on_this_machine_grants_nothing() {
    // Behind a reverse proxy on the same host every request is from loopback,
    // and nginx's default `Host $proxy_host` makes it look like our own page.
    let h = harness();
    berserk(&h);
    let browse = format!("/api/settings/browse?path={}", h.root.to_string_lossy());
    let cases: &[&[(header::HeaderName, &'static str)]] = &[
      &[(header::HOST, "127.0.0.1:3000")],
      &[(header::HOST, "localhost:3000")],
      &[
        (header::HOST, "127.0.0.1:3000"),
        (header::ORIGIN, "http://127.0.0.1:3000"),
      ],
      &[],
    ];
    for headers in cases {
      for uri in PROTECTED.iter().copied().chain([browse.as_str()]) {
        let req = with_headers(get_from(uri, LOCAL_V4), headers);
        let (status, _, _) = send(&h, req).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri} {headers:?}");
      }
    }
  }

  #[tokio::test]
  async fn a_bad_token_is_refused() {
    let h = harness();
    for req in [
      with_bearer(get_from("/api/library", LAN), "nope"),
      with_bearer(get_from("/api/library", LAN), ""),
      with_cookie(get_from("/api/library", LAN), "nope"),
      // A bearer token isn't a cookie.
      with_cookie(get_from("/api/library", LAN), &h.token),
    ] {
      let (status, _, _) = send(&h, req).await;
      assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
  }

  #[tokio::test]
  async fn the_old_key_parameter_is_gone() {
    let h = harness();
    let uri = format!("/api/library?key={}", h.token);
    let (status, _, _) = send(&h, get_from(&uri, LAN)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
  }

  #[tokio::test]
  async fn a_refusal_is_readable_cross_origin() {
    // So the app can tell "logged out" from "unreachable".
    let h = harness();
    let mut req = get_from("/api/library", LAN);
    req.headers_mut().insert(
      header::ORIGIN,
      HeaderValue::from_static("http://tauri.localhost"),
    );
    let (status, _, res) = send(&h, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(
      res.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
      Some(&HeaderValue::from_static("*"))
    );
  }

  // --- first run ---

  fn setup_body(token: &str, client: &str) -> String {
    format!(
      r#"{{"token":"{token}","username":"alice","password":"long enough","client":"{client}"}}"#
    )
  }

  #[tokio::test]
  async fn setup_is_needed_until_there_is_an_admin() {
    let h = harness_fresh();
    let (_, body, _) = send(&h, get_from("/api/auth/setup", LAN)).await;
    assert_eq!(json(&body)["needed"], true);
    let h = harness();
    let (_, body, _) = send(&h, get_from("/api/auth/setup", LAN)).await;
    assert_eq!(json(&body)["needed"], false);
  }

  #[tokio::test]
  async fn setup_needs_the_token_from_the_log() {
    let h = harness_fresh();
    let (status, body, _) = send(
      &h,
      post_from(
        "/api/auth/setup",
        LAN,
        &setup_body("0123456789abcdef0123456789abcdef", "bearer"),
      ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(json(&body)["error"], "Wrong setup token");
    assert!(!h.state.auth.store.has_admin());
  }

  #[tokio::test]
  async fn setup_creates_the_admin_and_signs_in() {
    let h = harness_fresh();
    let token = h.state.auth.setup_token().unwrap();
    let (status, body, _) = send(
      &h,
      post_from("/api/auth/setup", LAN, &setup_body(&token, "bearer")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session = json(&body)["token"].as_str().unwrap().to_string();
    let (status, body, _) = send(&h, with_bearer(get_from("/api/auth/me", LAN), &session)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json(&body)["username"], "alice");

    // Once only.
    assert_eq!(h.state.auth.setup_token(), None);
    let (status, _, _) = send(
      &h,
      post_from("/api/auth/setup", LAN, &setup_body(&token, "bearer")),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(h.state.auth.store.admin().unwrap().username, "alice");
  }

  #[tokio::test]
  async fn setup_refuses_a_short_password() {
    let h = harness_fresh();
    let token = h.state.auth.setup_token().unwrap();
    let body =
      format!(r#"{{"token":"{token}","username":"alice","password":"short","client":"bearer"}}"#);
    let (status, _, _) = send(&h, post_from("/api/auth/setup", LAN, &body)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!h.state.auth.store.has_admin());
    assert!(h.state.auth.setup_token().is_some());
  }

  #[tokio::test]
  async fn guessing_the_setup_token_is_slowed_down() {
    let h = harness_fresh();
    for _ in 0..5 {
      send(
        &h,
        post_from("/api/auth/setup", LAN, &setup_body("wrong", "bearer")),
      )
      .await;
    }
    let token = h.state.auth.setup_token().unwrap();
    let (status, _, res) = send(
      &h,
      post_from("/api/auth/setup", LAN, &setup_body(&token, "bearer")),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert!(res.headers().contains_key(header::RETRY_AFTER));
  }

  // --- logging in ---

  fn login_body(username: &str, password: &str, client: &str) -> String {
    format!(r#"{{"username":"{username}","password":"{password}","client":"{client}"}}"#)
  }

  async fn login(h: &Harness, peer: &str, password: &str) -> (StatusCode, serde_json::Value) {
    let (status, body, _) = send(
      h,
      post_from(
        "/api/auth/login",
        peer,
        &login_body(USERNAME, password, "bearer"),
      ),
    )
    .await;
    (status, json(&body))
  }

  #[tokio::test]
  async fn logging_in_gives_a_working_token() {
    let h = harness();
    let (status, body) = login(&h, LAN, PASSWORD).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["username"], USERNAME);
    let token = body["token"].as_str().unwrap();
    let (status, _, _) = send(&h, with_bearer(get_from("/api/library", LAN), token)).await;
    assert_eq!(status, StatusCode::OK);
  }

  #[tokio::test]
  async fn a_wrong_password_or_username_gets_the_same_answer() {
    let h = harness();
    let (status, wrong_password) = login(&h, LAN, "not the password").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body, _) = send(
      &h,
      post_from(
        "/api/auth/login",
        LAN,
        &login_body("nobody", PASSWORD, "bearer"),
      ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(json(&body), wrong_password);
    assert!(wrong_password.get("token").is_none());
  }

  #[tokio::test]
  async fn repeated_failures_lock_the_address_out() {
    let h = harness();
    for _ in 0..5 {
      assert_eq!(login(&h, LAN, "guess").await.0, StatusCode::UNAUTHORIZED);
    }
    // Even the right password waits.
    let (status, _) = login(&h, LAN, PASSWORD).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
  }

  #[tokio::test]
  async fn repeated_failures_lock_the_account_from_any_address() {
    let h = harness();
    for i in 0..5 {
      let peer = format!("10.0.0.{i}:1000");
      login(&h, &peer, "guess").await;
    }
    let (status, _) = login(&h, "10.0.1.1:1000", PASSWORD).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
  }

  #[tokio::test]
  async fn unknown_usernames_are_only_counted_per_address() {
    let h = harness();
    for i in 0..5 {
      let peer = format!("10.0.0.{i}:1000");
      send(
        &h,
        post_from(
          "/api/auth/login",
          &peer,
          &login_body("nobody", "guess", "bearer"),
        ),
      )
      .await;
    }
    assert_eq!(login(&h, "10.0.1.1:1000", PASSWORD).await.0, StatusCode::OK);
  }

  /// Five wrong passwords for the admin, each from a different address.
  async fn lock_the_account(h: &Harness) {
    for i in 0..5 {
      let peer = format!("10.9.0.{i}:1000");
      assert_eq!(login(h, &peer, "guess").await.0, StatusCode::UNAUTHORIZED);
    }
  }

  async fn login_with_device(
    h: &Harness,
    peer: &str,
    password: &str,
    device_token: &str,
  ) -> (StatusCode, serde_json::Value) {
    let body = format!(
      r#"{{"username":"{USERNAME}","password":"{password}","client":"bearer","deviceToken":"{device_token}"}}"#
    );
    let (status, body, _) = send(h, post_from("/api/auth/login", peer, &body)).await;
    (status, json(&body))
  }

  #[tokio::test]
  async fn a_known_device_still_logs_in_while_the_account_is_locked() {
    let h = harness();
    let (_, first) = login(&h, LAN, PASSWORD).await;
    let device = first["deviceToken"].as_str().unwrap().to_string();

    lock_the_account(&h).await;
    assert_eq!(
      login(&h, "10.9.1.1:1000", PASSWORD).await.0,
      StatusCode::TOO_MANY_REQUESTS
    );

    let (status, body) = login_with_device(&h, "10.9.1.1:1000", PASSWORD, &device).await;
    assert_eq!(status, StatusCode::OK);
    // It keeps the token it has.
    assert_eq!(body["deviceToken"], serde_json::Value::Null);
  }

  #[tokio::test]
  async fn a_known_device_is_counted_on_its_own() {
    let h = harness();
    let (_, first) = login(&h, LAN, PASSWORD).await;
    let device = first["deviceToken"].as_str().unwrap().to_string();
    for _ in 0..5 {
      login_with_device(&h, LAN, "guess", &device).await;
    }
    let (status, _) = login_with_device(&h, LAN, PASSWORD, &device).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    // Neither the address nor the account was counted.
    assert_eq!(login(&h, LAN, PASSWORD).await.0, StatusCode::OK);
  }

  #[tokio::test]
  async fn a_forged_device_token_counts_as_unknown() {
    let h = harness();
    lock_the_account(&h).await;
    let (status, _) = login_with_device(&h, "10.9.1.1:1000", PASSWORD, "forged").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
  }

  #[tokio::test]
  async fn our_page_keeps_its_device_token_in_a_cookie() {
    let h = harness();
    let body = login_body(USERNAME, PASSWORD, "cookie");
    let (_, _, res) = send(&h, same_origin(post_from("/api/auth/login", LAN, &body))).await;
    let device = res
      .headers()
      .get_all(header::SET_COOKIE)
      .iter()
      .map(|v| v.to_str().unwrap())
      .find(|c| c.starts_with("kl_device="))
      .unwrap()
      .to_string();
    assert!(
      device.contains("Path=/api/auth") && device.contains("HttpOnly"),
      "{device}"
    );
    let token = device["kl_device=".len()..].split(';').next().unwrap();

    lock_the_account(&h).await;
    let mut req = same_origin(post_from("/api/auth/login", "10.9.1.1:1000", &body));
    req.headers_mut().insert(
      header::COOKIE,
      HeaderValue::from_str(&format!("kl_device={token}")).unwrap(),
    );
    let (status, _, _) = send(&h, req).await;
    assert_eq!(status, StatusCode::OK);
  }

  #[tokio::test]
  async fn wrong_current_passwords_dont_lock_the_account() {
    let h = harness();
    for _ in 0..6 {
      change_password(&h, "guess", "brand new password").await;
    }
    assert_eq!(
      change_password(&h, PASSWORD, "brand new password").await,
      StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(login(&h, "10.9.1.1:1000", PASSWORD).await.0, StatusCode::OK);
  }

  fn via_proxy(mut req: Request<Body>, client: &'static str) -> Request<Body> {
    req
      .headers_mut()
      .insert("x-forwarded-for", HeaderValue::from_static(client));
    req
  }

  #[tokio::test]
  async fn behind_a_trusted_proxy_clients_are_counted_apart() {
    let h = harness_with(true, "127.0.0.1");
    let body = login_body("nobody", "guess", "bearer");
    for _ in 0..5 {
      send(
        &h,
        via_proxy(post_from("/api/auth/login", LOCAL_V4, &body), "203.0.113.1"),
      )
      .await;
    }
    let good = login_body(USERNAME, PASSWORD, "bearer");
    let (status, _, _) = send(
      &h,
      via_proxy(post_from("/api/auth/login", LOCAL_V4, &good), "203.0.113.1"),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    let (status, _, _) = send(
      &h,
      via_proxy(post_from("/api/auth/login", LOCAL_V4, &good), "203.0.113.2"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
  }

  #[tokio::test]
  async fn an_untrusted_peer_cant_dodge_the_limit_with_forwarded_for() {
    let h = harness();
    let body = login_body("nobody", "guess", "bearer");
    for i in 0..5 {
      let client: &'static str = ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5"][i];
      send(
        &h,
        via_proxy(post_from("/api/auth/login", LAN, &body), client),
      )
      .await;
    }
    let good = login_body(USERNAME, PASSWORD, "bearer");
    let (status, _, _) = send(
      &h,
      via_proxy(post_from("/api/auth/login", LAN, &good), "6.6.6.6"),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
  }

  fn same_origin(req: Request<Body>) -> Request<Body> {
    with_headers(req, &[("sec-fetch-site".parse().unwrap(), "same-origin")])
  }

  fn set_cookie(res: &Response<()>) -> String {
    res.headers()[header::SET_COOKIE]
      .to_str()
      .unwrap()
      .to_string()
  }

  fn cookie_token(set_cookie: &str) -> String {
    set_cookie
      .strip_prefix("kl_session=")
      .unwrap()
      .split(';')
      .next()
      .unwrap()
      .to_string()
  }

  #[tokio::test]
  async fn our_page_gets_an_http_only_cookie_and_no_token() {
    let h = harness();
    let req = same_origin(post_from(
      "/api/auth/login",
      LAN,
      &login_body(USERNAME, PASSWORD, "cookie"),
    ));
    let (status, body, res) = send(&h, req).await;
    assert_eq!(status, StatusCode::OK);
    assert!(json(&body).get("token").is_none());
    let cookie = set_cookie(&res);
    assert!(
      cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict"),
      "{cookie}"
    );
    assert!(!cookie.contains("Secure"), "{cookie}");

    let (status, _, _) = send(
      &h,
      with_cookie(get_from("/api/library", LAN), &cookie_token(&cookie)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
  }

  #[tokio::test]
  async fn the_cookie_is_secure_when_a_trusted_proxy_says_https() {
    let h = harness_with(true, "127.0.0.1");
    let req = with_headers(
      same_origin(post_from(
        "/api/auth/login",
        LOCAL_V4,
        &login_body(USERNAME, PASSWORD, "cookie"),
      )),
      &[("x-forwarded-proto".parse().unwrap(), "https")],
    );
    let (_, _, res) = send(&h, req).await;
    assert!(set_cookie(&res).ends_with("; Secure"));
  }

  #[tokio::test]
  async fn a_cookie_login_from_another_site_is_refused() {
    let h = harness();
    let req = with_headers(
      post_from(
        "/api/auth/login",
        LAN,
        &login_body(USERNAME, PASSWORD, "cookie"),
      ),
      &[("sec-fetch-site".parse().unwrap(), "cross-site")],
    );
    let (status, _, res) = send(&h, req).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(!res.headers().contains_key(header::SET_COOKIE));
  }

  // --- once signed in ---

  #[tokio::test]
  async fn logging_out_ends_the_session() {
    let h = harness();
    let (status, _, _) = send(&h, authed(&h, post_from("/api/auth/logout", LAN, ""))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _, _) = send(&h, authed(&h, get_from("/api/library", LAN))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
  }

  #[tokio::test]
  async fn logging_out_clears_the_cookie() {
    let h = harness();
    let token = h
      .state
      .auth
      .store
      .create_session(Kind::Cookie, "laptop", auth_now())
      .unwrap();
    let req = same_origin(with_cookie(post_from("/api/auth/logout", LAN, ""), &token));
    let (status, _, res) = send(&h, req).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(set_cookie(&res).contains("Max-Age=0"));
  }

  async fn change_password(h: &Harness, current: &str, new: &str) -> StatusCode {
    let body = format!(r#"{{"currentPassword":"{current}","newPassword":"{new}"}}"#);
    send(h, authed(h, post_from("/api/auth/password", LAN, &body)))
      .await
      .0
  }

  #[tokio::test]
  async fn changing_the_password_ends_the_other_sessions() {
    let h = harness();
    let (_, other) = login(&h, "10.0.0.9:1000", PASSWORD).await;
    let other = other["token"].as_str().unwrap().to_string();

    assert_eq!(
      change_password(&h, PASSWORD, "brand new password").await,
      StatusCode::NO_CONTENT
    );

    let (status, _, _) = send(&h, with_bearer(get_from("/api/library", LAN), &other)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = send(&h, authed(&h, get_from("/api/library", LAN))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(login(&h, LAN, PASSWORD).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(login(&h, LAN, "brand new password").await.0, StatusCode::OK);
  }

  #[tokio::test]
  async fn changing_the_password_needs_the_current_one() {
    let h = harness();
    assert_eq!(
      change_password(&h, "wrong", "brand new password").await,
      StatusCode::FORBIDDEN
    );
    assert_eq!(
      change_password(&h, PASSWORD, "short").await,
      StatusCode::BAD_REQUEST
    );
    assert_eq!(login(&h, LAN, PASSWORD).await.0, StatusCode::OK);
  }

  #[tokio::test]
  async fn sessions_are_listed_and_revoked() {
    let h = harness();
    let (_, other) = login(&h, LAN, PASSWORD).await;
    let other = other["token"].as_str().unwrap().to_string();

    let (status, body, _) = send(&h, authed(&h, get_from("/api/auth/sessions", LAN))).await;
    assert_eq!(status, StatusCode::OK);
    let list = json(&body);
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list.iter().filter(|s| s["current"] == true).count(), 1);
    let theirs = list.iter().find(|s| s["current"] == false).unwrap()["id"]
      .as_str()
      .unwrap()
      .to_string();

    let uri = format!("/api/auth/sessions/{theirs}");
    let (status, _, _) = send(&h, authed(&h, delete_from(&uri, LAN))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _, _) = send(&h, with_bearer(get_from("/api/library", LAN), &other)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = send(&h, authed(&h, delete_from(&uri, LAN))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
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

  // --- security headers ---

  /// A server that terminates TLS itself.
  fn harness_tls() -> Harness {
    let h = harness();
    let store = Store::open(&h.tmp.path().join("tls-auth.db")).unwrap();
    let state = Arc::new(AppState {
      config: h.state.config.clone(),
      cache: ZipCache::new(),
      db: Db::open(&h.tmp.path().join("tls.db")).unwrap(),
      static_dir: h.state.static_dir.clone(),
      auth: Auth::new(store, TrustedProxies::default(), true),
    });
    Harness { state, ..h }
  }

  fn hsts(res: &Response<()>) -> Option<&HeaderValue> {
    res.headers().get(header::STRICT_TRANSPORT_SECURITY)
  }

  #[tokio::test]
  async fn hsts_only_over_https() {
    let (_, _, res) = send(&harness(), get_from("/api/ping", LAN)).await;
    assert_eq!(hsts(&res), None);

    let (_, _, res) = send(&harness_tls(), get_from("/api/ping", LAN)).await;
    assert_eq!(
      hsts(&res),
      Some(&HeaderValue::from_static("max-age=63072000"))
    );
  }

  #[tokio::test]
  async fn hsts_when_a_trusted_proxy_says_https() {
    let h = harness_with(true, "127.0.0.1");
    let proto = || [("x-forwarded-proto".parse().unwrap(), "https")];
    let (_, _, res) = send(&h, with_headers(get_from("/settings", LOCAL_V4), &proto())).await;
    assert!(hsts(&res).is_some());
    let (_, _, res) = send(&h, with_headers(get_from("/settings", LAN), &proto())).await;
    assert_eq!(hsts(&res), None, "only a trusted proxy is believed");
  }

  #[tokio::test]
  async fn every_response_says_nosniff_and_its_referrer_policy() {
    let h = harness();
    for uri in ["/api/ping", "/api/library", "/favicon.png", "/settings"] {
      let (_, _, res) = send(&h, get_from(uri, LAN)).await;
      assert_eq!(
        res.headers().get(header::X_CONTENT_TYPE_OPTIONS),
        Some(&HeaderValue::from_static("nosniff")),
        "{uri}"
      );
      assert_eq!(
        res.headers().get(header::REFERRER_POLICY),
        Some(&HeaderValue::from_static("strict-origin-when-cross-origin")),
        "{uri}"
      );
    }
  }

  fn csp(res: &Response<()>) -> Option<&str> {
    res
      .headers()
      .get(header::CONTENT_SECURITY_POLICY)
      .map(|v| v.to_str().unwrap())
  }

  #[tokio::test]
  async fn the_spa_allows_its_own_inline_script_and_no_framing() {
    let h = harness();
    std::fs::write(
      h.state.static_dir.join("index.html"),
      "<!doctype html><title>SPA</title><script>alert(1)</script>",
    )
    .unwrap();
    for uri in ["/", "/settings"] {
      let (status, body, res) = send(&h, get_from(uri, LAN)).await;
      assert_eq!(status, StatusCode::OK);
      assert!(String::from_utf8_lossy(&body).ends_with("<script>alert(1)</script>"));
      let policy = csp(&res).unwrap_or_else(|| panic!("no CSP on {uri}"));
      // `openssl dgst -sha256 -binary | base64` of `alert(1)`.
      assert!(
        policy.contains("'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='"),
        "{policy}"
      );
      assert!(policy.contains("frame-ancestors 'none'"), "{policy}");
    }
  }

  #[tokio::test]
  async fn only_pages_get_a_csp() {
    let h = harness();
    for uri in ["/api/ping", "/api/library", "/favicon.png"] {
      let (_, _, res) = send(&h, authed(&h, get_from(uri, LAN))).await;
      assert_eq!(csp(&res), None, "{uri}");
    }
  }

  #[tokio::test]
  async fn a_revalidated_page_keeps_its_cached_csp() {
    // A 304's headers replace the cached ones, and it has no body to hash.
    let h = harness();
    let (_, _, res) = send(&h, get_from("/", LAN)).await;
    let modified = res.headers()[header::LAST_MODIFIED]
      .to_str()
      .unwrap()
      .to_owned();
    let mut req = get_from("/", LAN);
    req
      .headers_mut()
      .insert(header::IF_MODIFIED_SINCE, modified.parse().unwrap());
    let (status, _, res) = send(&h, req).await;
    assert_eq!(status, StatusCode::NOT_MODIFIED);
    assert_eq!(csp(&res), None);
  }

  #[tokio::test]
  async fn part_of_a_page_gets_no_csp() {
    // Its scripts may be cut short, so their hashes would be wrong.
    let h = harness();
    let mut req = get_from("/", LAN);
    req
      .headers_mut()
      .insert(header::RANGE, HeaderValue::from_static("bytes=0-5"));
    let (status, _, res) = send(&h, req).await;
    assert_eq!(status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(csp(&res), None);
  }

  // --- CORS (a LAN-paired phone reads this API from tauri.localhost) ---

  #[tokio::test]
  async fn api_responses_are_readable_cross_origin() {
    let h = harness();
    let mut req = authed(&h, get_from("/api/library", LAN));
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

  #[tokio::test]
  async fn preflight_allows_the_authorization_header() {
    // A `*` wouldn't cover it.
    let h = harness();
    let addr: SocketAddr = LAN.parse().unwrap();
    let mut req = Request::builder()
      .method("OPTIONS")
      .uri("/api/library")
      .header(header::ORIGIN, "http://tauri.localhost")
      .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
      .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "authorization")
      .body(Body::empty())
      .unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));
    let (_, _, res) = send(&h, req).await;
    let allowed = res.headers()[header::ACCESS_CONTROL_ALLOW_HEADERS]
      .to_str()
      .unwrap()
      .to_ascii_lowercase();
    assert!(allowed.contains("authorization"), "{allowed}");
  }

  #[tokio::test]
  async fn logging_in_works_cross_origin_without_credentials() {
    // Bearer clients aren't ambient, so `*` stays safe: no cookies cross.
    let h = harness();
    for uri in ["/api/auth/login", "/api/auth/setup"] {
      let (_, _, res) = send(&h, preflight(uri)).await;
      assert_eq!(
        res.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        Some(&HeaderValue::from_static("*")),
        "{uri}"
      );
      assert_eq!(
        res.headers().get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS),
        None,
        "{uri}"
      );
    }
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

  fn cookie_session(h: &Harness) -> String {
    h.state
      .auth
      .store
      .create_session(Kind::Cookie, "laptop", auth_now())
      .unwrap()
  }

  #[tokio::test]
  async fn a_cookie_post_from_another_site_is_refused() {
    let h = harness_unset();
    let token = cookie_session(&h);
    let cases: &[&[(header::HeaderName, &'static str)]] = &[
      &[("sec-fetch-site".parse().unwrap(), "cross-site")],
      &[("sec-fetch-site".parse().unwrap(), "same-site")],
      &[
        (header::HOST, "manga.example"),
        (header::ORIGIN, "https://evil.example"),
      ],
      // No way to tell where it came from.
      &[(header::HOST, "manga.example")],
    ];
    for headers in cases {
      let req = with_headers(
        with_cookie(
          post_from("/api/settings", LAN, r#"{"mangaDir":"/"}"#),
          &token,
        ),
        headers,
      );
      let (status, _, _) = send(&h, req).await;
      assert_eq!(status, StatusCode::FORBIDDEN, "{headers:?}");
    }
    assert!(!h.state.config.config_path().exists());
  }

  #[tokio::test]
  async fn a_cookie_post_from_our_page_is_allowed() {
    let cases: &[&[(header::HeaderName, &'static str)]] = &[
      // Through a proxy that rewrote Host.
      &[
        ("sec-fetch-site".parse().unwrap(), "same-origin"),
        (header::HOST, "127.0.0.1:3000"),
        (header::ORIGIN, "https://manga.example"),
      ],
      // A browser too old for Sec-Fetch-Site.
      &[
        (header::HOST, "manga.example"),
        (header::ORIGIN, "https://manga.example"),
      ],
    ];
    for headers in cases {
      let h = harness_unset();
      let token = cookie_session(&h);
      let target = h.tmp.path().join("newdir");
      std::fs::create_dir_all(&target).unwrap();
      let body = format!(r#"{{"mangaDir":"{}"}}"#, target.to_string_lossy());
      let req = with_headers(
        with_cookie(post_from("/api/settings", LAN, &body), &token),
        headers,
      );
      let (status, _, _) = send(&h, req).await;
      assert_eq!(status, StatusCode::OK, "{headers:?}");
    }
  }

  #[tokio::test]
  async fn a_cookie_get_needs_no_origin() {
    // Images and plain navigations send none.
    let h = harness();
    let token = cookie_session(&h);
    let (status, _, _) = send(&h, with_cookie(get_from("/api/library", LAN), &token)).await;
    assert_eq!(status, StatusCode::OK);
  }

  #[tokio::test]
  async fn a_bearer_post_needs_no_origin() {
    // Not ambient: another site can't make the browser send it.
    let h = harness_unset();
    let target = h.tmp.path().join("newdir");
    std::fs::create_dir_all(&target).unwrap();
    let body = format!(r#"{{"mangaDir":"{}"}}"#, target.to_string_lossy());
    let (status, _, _) = send(&h, authed(&h, post_from("/api/settings", LAN, &body))).await;
    assert_eq!(status, StatusCode::OK);
  }
}
