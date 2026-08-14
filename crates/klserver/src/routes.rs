//! HTTP surface.
//!
//! Port of the five `src/routes/api/**/+server.ts` handlers, plus serving the
//! static SPA build that SvelteKit's adapter-node used to serve.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
  extract::{ConnectInfo, Query, RawPathParams, State},
  http::{header, HeaderValue, Method, StatusCode},
  response::{IntoResponse, Response},
  routing::get,
  Json, Router,
};
use serde_json::json;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use crate::config::Config;
use crate::library;
use crate::zipcache::ZipCache;

pub struct AppState {
  pub config: Config,
  pub cache: ZipCache,
  pub static_dir: PathBuf,
}

pub type SharedState = Arc<AppState>;

/// Pages are addressed by content-derived paths and never change in place, so
/// they can be cached indefinitely.
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

fn forbidden() -> Response {
  (StatusCode::FORBIDDEN, Json(json!({ "error": "Forbidden" }))).into_response()
}

pub fn router(state: SharedState) -> Router {
  let index = state.static_dir.join("index.html");
  // Unmatched paths fall through to the built SPA, which does its own routing.
  let static_files = ServeDir::new(&state.static_dir).fallback(ServeFile::new(index));

  Router::new()
    .route("/api/library", get(get_library))
    .route("/api/library/{manga}/chapters", get(get_chapters))
    .route("/api/library/{manga}/{*path}", get(get_image))
    .route("/api/settings", get(get_settings).post(post_settings))
    .route("/api/settings/browse", get(get_browse))
    .fallback_service(static_files)
    .layer(cors())
    .with_state(state)
}

/// The API is read cross-origin, so it has to opt in.
///
/// A phone paired over LAN runs the packaged app, whose webview origin is
/// `tauri.localhost`, not this server — without these headers every `fetch`
/// here fails as an opaque "Failed to fetch". Any origin is allowed because
/// the backend-free web deployment can also be pointed at a self-hosted
/// server from whatever domain it happens to be served from. That grants no
/// new reach: `POST /api/settings` and `/api/settings/browse` stay gated on
/// `is_local_client`, and no credentials are involved, which `allow_origin`
/// of `Any` forbids anyway.
fn cors() -> CorsLayer {
  CorsLayer::new()
    .allow_origin(Any)
    .allow_methods([Method::GET, Method::POST])
    .allow_headers(Any)
}

async fn get_library(State(state): State<SharedState>) -> Response {
  Json(library::list_manga(&state.config)).into_response()
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
  Json(library::list_chapters(&state.config, &state.cache, &manga)).into_response()
}

async fn get_image(State(state): State<SharedState>, params: RawPathParams) -> Response {
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

  let result = if klparse::is_zip_name(&manga) {
    library::get_image_from_zip(&state.config, &state.cache, &manga, &parts.join("/"))
  } else {
    library::get_image_from_dir(&state.config, &manga, &parts)
  };

  let Some(image) = result else {
    return not_found();
  };

  (
    [
      (
        header::CONTENT_TYPE,
        HeaderValue::from_static(klparse::content_type(&image.ext)),
      ),
      (header::CACHE_CONTROL, HeaderValue::from_static(IMMUTABLE)),
    ],
    image.bytes,
  )
    .into_response()
}

async fn get_settings(State(state): State<SharedState>) -> Response {
  Json(json!({ "mangaDir": state.config.manga_dir_display() })).into_response()
}

async fn post_settings(
  State(state): State<SharedState>,
  ConnectInfo(addr): ConnectInfo<SocketAddr>,
  body: Option<Json<serde_json::Value>>,
) -> Response {
  if !is_local_client(addr) {
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
  Query(query): Query<BrowseQuery>,
) -> Response {
  if !is_local_client(addr) {
    return forbidden();
  }

  match library::browse_dir(&state.config, query.path.as_deref()) {
    Ok(result) => Json(result).into_response(),
    Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response(),
  }
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
  async fn library_lists_the_configured_directory() {
    let h = harness();
    std::fs::create_dir_all(h.root.join("Berserk")).unwrap();
    write_zip(&h.root, "Akira.cbz", &[("p.png", b"x")]);

    let (status, body, _) = send(&h, get_from("/api/library", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(parsed[0]["name"], "Akira");
    assert_eq!(parsed[0]["type"], "zip");
    assert_eq!(parsed[1]["name"], "Berserk");
    assert_eq!(parsed[1]["type"], "directory");
  }

  #[tokio::test]
  async fn chapters_are_served_for_a_percent_encoded_slug() {
    let h = harness();
    touch(&h.root, "One Piece/ch01/page01.png", b"x");

    let (status, body, _) = send(&h, get_from("/api/library/One%20Piece/chapters", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    let parsed: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(parsed[0]["name"], "ch01");
    assert_eq!(parsed[0]["pageCount"], 1);
  }

  #[tokio::test]
  async fn chapters_for_a_traversing_slug_return_an_empty_list() {
    let h = harness();
    touch(
      h.root.parent().unwrap(),
      "secret/ch01/page01.png",
      b"SECRET",
    );

    let (status, body, _) = send(&h, get_from("/api/library/..%2Fsecret/chapters", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(String::from_utf8_lossy(&body), "[]");
  }

  // --- images ---

  #[tokio::test]
  async fn image_from_a_directory_manga_has_the_right_headers() {
    let h = harness();
    touch(&h.root, "Berserk/ch01/page01.png", b"PNGDATA");

    let (status, body, res) = send(&h, get_from("/api/library/Berserk/ch01/page01.png", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"PNGDATA");
    assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");
    assert_eq!(res.headers()[header::CACHE_CONTROL], IMMUTABLE);
  }

  #[tokio::test]
  async fn image_from_an_archive_is_extracted_on_demand() {
    let h = harness();
    write_zip(&h.root, "Akira.cbz", &[("ch01/page01.jpg", b"JPEGDATA")]);

    let (status, body, res) =
      send(&h, get_from("/api/library/Akira.cbz/ch01/page01.jpg", LAN)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"JPEGDATA");
    assert_eq!(res.headers()[header::CONTENT_TYPE], "image/jpeg");
  }

  #[tokio::test]
  async fn an_unknown_extension_falls_back_to_octet_stream() {
    let h = harness();
    // `.bmp` is in the allowlist but has no dedicated mapping check here;
    // use a name the allowlist accepts and confirm the mapping table is used.
    touch(&h.root, "Berserk/ch01/page01.bmp", b"BMPDATA");
    let (_, _, res) = send(&h, get_from("/api/library/Berserk/ch01/page01.bmp", LAN)).await;
    assert_eq!(res.headers()[header::CONTENT_TYPE], "image/bmp");

    assert_eq!(klparse::content_type(".xyz"), "application/octet-stream");
  }

  #[tokio::test]
  async fn a_missing_image_is_a_clean_404() {
    let h = harness();
    std::fs::create_dir_all(h.root.join("Berserk")).unwrap();

    let (status, body, _) = send(&h, get_from("/api/library/Berserk/ch01/nope.png", LAN)).await;
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
  async fn a_traversing_image_path_is_a_404() {
    let h = harness();
    touch(h.root.parent().unwrap(), "secret.png", b"SECRET");

    for uri in [
      "/api/library/Berserk/..%2F..%2Fsecret.png",
      "/api/library/..%2F..%2Fsecret.png/x.png",
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

  #[tokio::test]
  async fn preflight_is_answered() {
    let h = harness();
    let addr: SocketAddr = LAN.parse().unwrap();
    let mut req = Request::builder()
      .method("OPTIONS")
      .uri("/api/settings")
      .header(header::ORIGIN, "http://tauri.localhost")
      .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
      .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
      .body(Body::empty())
      .unwrap();
    req.extensions_mut().insert(ConnectInfo(addr));
    let (status, _, res) = send(&h, req).await;
    assert!(status.is_success(), "preflight returned {status}");
    assert_eq!(
      res.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
      Some(&HeaderValue::from_static("*"))
    );
  }
}
