//! Logging in to the server.
//!
//! One admin, created on first run with a setup token printed in the log, so
//! the first stranger to reach a public server can't claim it. Every `/api`
//! route but `/api/ping` and the login and setup routes needs a session:
//!
//! - the server's own page gets an `HttpOnly; SameSite=Strict` cookie, which
//!   its scripts can't read;
//! - other origins (the apps, the web reader hosted elsewhere) get a token
//!   for `Authorization: Bearer`: cookies don't cross origins once browsers
//!   block third-party ones.
//!
//! Nothing is granted for being on this machine: behind a reverse proxy on the
//! same host, every request comes from loopback.

mod limit;
pub mod password;
pub mod proxy;
pub mod store;

use std::net::{IpAddr, SocketAddr};
use std::sync::{Mutex, PoisonError};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::{
  extract::{ConnectInfo, Path, Request, State},
  http::{header, HeaderMap, HeaderValue, Method, StatusCode},
  middleware::Next,
  response::{IntoResponse, Response},
  Extension, Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::routes::{error, unauthorized, SharedState};
use limit::Limiter;
use proxy::TrustedProxies;
use store::{Kind, Store};

const COOKIE: &str = "kl_session";
/// The device token, for our own page; see `post_login`.
const DEVICE_COOKIE: &str = "kl_device";
const MAX_USERNAME: usize = 64;
const MAX_DEVICE: usize = 100;

pub struct Auth {
  pub store: Store,
  /// Until the admin exists.
  setup_token: Mutex<Option<String>>,
  /// Failed logins from unknown clients: per address, and against the
  /// admin's username.
  ip_limit: Limiter,
  account_limit: Limiter,
  /// Failed logins per device token, and failed password changes per
  /// session: clients we know, counted apart from everyone else.
  known_limit: Limiter,
  proxies: TrustedProxies,
}

impl Auth {
  pub fn new(store: Store, proxies: TrustedProxies) -> Self {
    let setup_token = (!store.has_admin()).then(|| store::random_hex(16));
    Self {
      store,
      setup_token: Mutex::new(setup_token),
      ip_limit: Limiter::default(),
      account_limit: Limiter::default(),
      known_limit: Limiter::default(),
      proxies,
    }
  }

  /// What `POST /api/auth/setup` needs, while there's no admin.
  pub fn setup_token(&self) -> Option<String> {
    self
      .setup_token
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .clone()
  }
}

/// The session a request was made with, for the handlers behind
/// `require_session`.
#[derive(Debug, Clone)]
pub struct Current {
  pub id: String,
  pub kind: Kind,
}

fn now() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_or(0, |d| d.as_secs() as i64)
}

/// Takes the same time wherever the inputs differ, so timing doesn't leak a
/// secret a character at a time.
fn same_secret(given: &str, secret: &str) -> bool {
  given.len() == secret.len()
    && given
      .bytes()
      .zip(secret.bytes())
      .fold(0u8, |acc, (a, b)| acc | (a ^ b))
      == 0
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
  headers
    .get(header::AUTHORIZATION)?
    .to_str()
    .ok()?
    .strip_prefix("Bearer ")
    .map(str::trim)
}

fn named_cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
  headers
    .get_all(header::COOKIE)
    .iter()
    .filter_map(|v| v.to_str().ok())
    .flat_map(|v| v.split(';'))
    .find_map(|pair| pair.trim().strip_prefix(name)?.strip_prefix('='))
}

fn cookie(headers: &HeaderMap) -> Option<&str> {
  named_cookie(headers, COOKIE)
}

/// Whether a request carrying our cookie was sent by our own page.
///
/// `SameSite=Strict` already keeps the cookie off other sites' requests; this
/// is the second check. `Sec-Fetch-Site` is set by the browser and survives a
/// proxy rewriting `Host`; browsers too old to send it are judged by `Origin`.
fn same_origin(headers: &HeaderMap) -> bool {
  if let Some(site) = headers.get("sec-fetch-site") {
    return site == "same-origin";
  }
  let host = headers.get(header::HOST).and_then(|h| h.to_str().ok());
  let origin = headers
    .get(header::ORIGIN)
    .and_then(|o| o.to_str().ok())
    .and_then(|o| o.split_once("://"))
    .map(|(_, authority)| authority);
  host.is_some() && origin == host
}

fn is_safe(method: &Method) -> bool {
  matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

fn forbidden_cross_site() -> Response {
  error(StatusCode::FORBIDDEN, "Cross-site request refused")
}

/// Lets through a request with a live session: a bearer token, or our cookie.
pub async fn require_session(
  State(state): State<SharedState>,
  mut req: Request,
  next: Next,
) -> Response {
  let headers = req.headers();
  let (token, kind) = match (bearer(headers), cookie(headers)) {
    (Some(token), _) => (token, Kind::Bearer),
    (None, Some(token)) => (token, Kind::Cookie),
    (None, None) => return unauthorized(),
  };
  if kind == Kind::Cookie && !is_safe(req.method()) && !same_origin(headers) {
    return forbidden_cross_site();
  }
  let Some(session) = state.auth.store.session(token, kind, now()) else {
    return unauthorized();
  };
  req.extensions_mut().insert(Current {
    id: session.id,
    kind,
  });
  next.run(req).await
}

/// Where a request came from, as far as the limits and cookies care.
struct Caller {
  ip: IpAddr,
  https: bool,
}

fn caller(auth: &Auth, peer: SocketAddr, headers: &HeaderMap) -> Caller {
  Caller {
    ip: auth.proxies.client_ip(peer.ip(), headers),
    https: auth.proxies.forwarded_https(peer.ip(), headers),
  }
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Client {
  Cookie,
  Bearer,
}

fn session_cookie(token: &str, https: bool) -> String {
  let secure = if https { "; Secure" } else { "" };
  format!(
    "{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{secure}",
    store::ABSOLUTE
  )
}

/// Sent only to the login routes, which are all that read it.
fn device_cookie(token: &str, https: bool) -> String {
  let secure = if https { "; Secure" } else { "" };
  format!(
    "{DEVICE_COOKIE}={token}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age={}{secure}",
    store::DEVICE_TTL
  )
}

fn cleared_cookie() -> &'static str {
  "kl_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
}

/// The name a session is listed under: what the client called itself, or its
/// user agent.
fn device_name(given: Option<&str>, headers: &HeaderMap) -> String {
  let name = given
    .map(str::trim)
    .filter(|d| !d.is_empty())
    .or_else(|| headers.get(header::USER_AGENT)?.to_str().ok())
    .unwrap_or("Unknown device");
  name
    .chars()
    .filter(|c| !c.is_control())
    .take(MAX_DEVICE)
    .collect()
}

/// Starts a session and hands it over the way the client asked, with a new
/// device token unless the client already holds one.
fn issue(
  state: &SharedState,
  client: Client,
  device: String,
  username: &str,
  https: bool,
  known_device: bool,
) -> Response {
  let kind = match client {
    Client::Cookie => Kind::Cookie,
    Client::Bearer => Kind::Bearer,
  };
  let token = match state.auth.store.create_session(kind, &device, now()) {
    Ok(token) => token,
    Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, e),
  };
  let device_token = if known_device {
    None
  } else {
    match state.auth.store.create_device(now()) {
      Ok(token) => Some(token),
      Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
  };
  match client {
    Client::Cookie => {
      let mut res = Json(json!({ "username": username })).into_response();
      let cookies = std::iter::once(session_cookie(&token, https))
        .chain(device_token.map(|t| device_cookie(&t, https)));
      for cookie in cookies {
        if let Ok(value) = HeaderValue::from_str(&cookie) {
          res.headers_mut().append(header::SET_COOKIE, value);
        }
      }
      res
    }
    Client::Bearer => Json(json!({
      "username": username,
      "token": token,
      "deviceToken": device_token,
    }))
    .into_response(),
  }
}

fn too_many(wait: std::time::Duration) -> Response {
  let secs = wait.as_secs().max(1);
  let mut res = error(
    StatusCode::TOO_MANY_REQUESTS,
    format!("Too many attempts; try again in {secs} s"),
  );
  res.headers_mut().insert(header::RETRY_AFTER, secs.into());
  res
}

/// The longer wait owed by this address or this account, if any.
fn owed_wait(auth: &Auth, ip_key: &str, account: Option<&str>) -> Option<std::time::Duration> {
  let now = Instant::now();
  let by_ip = auth.ip_limit.wait(ip_key, now);
  let by_account = account.and_then(|a| auth.account_limit.wait(a, now));
  by_ip.max(by_account)
}

/// Who a login attempt is counted against.
enum Counted {
  /// A client holding a device token: only its own failures count.
  Known(String),
  /// Anyone else: their address, and the account if the username is right.
  Unknown {
    ip_key: String,
    account: Option<String>,
  },
}

impl Counted {
  fn wait(&self, auth: &Auth) -> Option<std::time::Duration> {
    match self {
      Counted::Known(key) => auth.known_limit.wait(key, Instant::now()),
      Counted::Unknown { ip_key, account } => owed_wait(auth, ip_key, account.as_deref()),
    }
  }

  fn fail(&self, auth: &Auth) {
    let now = Instant::now();
    match self {
      Counted::Known(key) => auth.known_limit.fail(key, now),
      Counted::Unknown { ip_key, account } => {
        auth.ip_limit.fail(ip_key, now);
        if let Some(account) = account {
          auth.account_limit.fail(account, now);
        }
      }
    }
  }

  fn succeed(&self, auth: &Auth) {
    match self {
      Counted::Known(key) => auth.known_limit.succeed(key),
      Counted::Unknown { ip_key, account } => {
        auth.ip_limit.succeed(ip_key);
        if let Some(account) = account {
          auth.account_limit.succeed(account);
        }
      }
    }
  }
}

async fn hash_blocking(password: String) -> Result<String, Response> {
  tokio::task::spawn_blocking(move || password::hash(&password))
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn verify_blocking(password: String, hash: Option<String>) -> bool {
  tokio::task::spawn_blocking(move || match hash {
    Some(hash) => password::verify(&password, &hash),
    None => {
      password::verify_nothing(&password);
      false
    }
  })
  .await
  .unwrap_or(false)
}

/// The username trimmed, if it's usable.
fn check_username(raw: &str) -> Option<String> {
  let name = raw.trim();
  let len = name.chars().count();
  ((1..=MAX_USERNAME).contains(&len) && !name.chars().any(char::is_control))
    .then(|| name.to_string())
}

pub async fn get_setup(State(state): State<SharedState>) -> Response {
  Json(json!({ "needed": !state.auth.store.has_admin() })).into_response()
}

#[derive(Deserialize)]
pub struct SetupBody {
  token: String,
  username: String,
  password: String,
  client: Client,
  device: Option<String>,
}

pub async fn post_setup(
  State(state): State<SharedState>,
  ConnectInfo(peer): ConnectInfo<SocketAddr>,
  headers: HeaderMap,
  Json(body): Json<SetupBody>,
) -> Response {
  let auth = &state.auth;
  if body.client == Client::Cookie && !same_origin(&headers) {
    return forbidden_cross_site();
  }
  let Some(expected) = auth.setup_token() else {
    return error(StatusCode::CONFLICT, "The server is already set up");
  };
  let caller = caller(auth, peer, &headers);
  let ip_key = proxy::limit_key(caller.ip);
  if let Some(wait) = owed_wait(auth, &ip_key, None) {
    return too_many(wait);
  }
  if !same_secret(body.token.trim(), &expected) {
    auth.ip_limit.fail(&ip_key, Instant::now());
    return error(StatusCode::FORBIDDEN, "Wrong setup token");
  }
  let Some(username) = check_username(&body.username) else {
    return error(
      StatusCode::BAD_REQUEST,
      format!("The username needs 1 to {MAX_USERNAME} characters"),
    );
  };
  if let Err(why) = password::check(&body.password) {
    return error(StatusCode::BAD_REQUEST, why);
  }
  let hash = match hash_blocking(body.password).await {
    Ok(hash) => hash,
    Err(res) => return res,
  };
  match auth.store.create_admin(&username, &hash) {
    Ok(true) => {}
    // Another setup request won the race.
    Ok(false) => return error(StatusCode::CONFLICT, "The server is already set up"),
    Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, e),
  }
  *auth
    .setup_token
    .lock()
    .unwrap_or_else(PoisonError::into_inner) = None;
  auth.ip_limit.succeed(&ip_key);
  let device = device_name(body.device.as_deref(), &headers);
  issue(&state, body.client, device, &username, caller.https, false)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginBody {
  username: String,
  password: String,
  client: Client,
  device: Option<String>,
  /// What an earlier login returned; our own page sends `kl_device` instead.
  device_token: Option<String>,
}

pub async fn post_login(
  State(state): State<SharedState>,
  ConnectInfo(peer): ConnectInfo<SocketAddr>,
  headers: HeaderMap,
  Json(body): Json<LoginBody>,
) -> Response {
  let auth = &state.auth;
  if body.client == Client::Cookie && !same_origin(&headers) {
    return forbidden_cross_site();
  }
  let caller = caller(auth, peer, &headers);
  let admin = auth.store.admin();
  // Only the real account is counted: unknown usernames would let anyone
  // fill the table.
  let account = admin
    .as_ref()
    .filter(|a| a.username == body.username.trim())
    .map(|a| a.username.clone());
  // Failures from unknown clients lock out every unknown client, wherever it
  // is, so guessing from many addresses gains nothing. Clients that logged in
  // before are exempt, each counted on its own, so that lockout can't keep
  // the admin out (OWASP: "Slow Down Online Guessing Attacks with Device
  // Cookies").
  let device_token = match body.client {
    Client::Bearer => body.device_token.as_deref(),
    Client::Cookie => named_cookie(&headers, DEVICE_COOKIE),
  };
  let counted = match device_token.filter(|t| auth.store.known_device(t, now())) {
    Some(token) => Counted::Known(token.to_string()),
    None => Counted::Unknown {
      ip_key: proxy::limit_key(caller.ip),
      account: account.clone(),
    },
  };
  if let Some(wait) = counted.wait(auth) {
    return too_many(wait);
  }
  let hash = account
    .as_ref()
    .and(admin.as_ref())
    .map(|a| a.password_hash.clone());
  if !verify_blocking(body.password, hash).await {
    counted.fail(auth);
    return error(StatusCode::UNAUTHORIZED, "Wrong username or password");
  }
  counted.succeed(auth);
  // Verified, so `account` is the admin's username.
  let username = account.unwrap_or_default();
  let device = device_name(body.device.as_deref(), &headers);
  let known = matches!(counted, Counted::Known(_));
  issue(&state, body.client, device, &username, caller.https, known)
}

pub async fn post_logout(
  State(state): State<SharedState>,
  Extension(current): Extension<Current>,
) -> Response {
  if let Err(e) = state.auth.store.revoke(&current.id) {
    return error(StatusCode::INTERNAL_SERVER_ERROR, e);
  }
  let mut res = StatusCode::NO_CONTENT.into_response();
  if current.kind == Kind::Cookie {
    res.headers_mut().insert(
      header::SET_COOKIE,
      HeaderValue::from_static(cleared_cookie()),
    );
  }
  res
}

pub async fn get_me(
  State(state): State<SharedState>,
  Extension(current): Extension<Current>,
) -> Response {
  let username = state.auth.store.admin().map(|a| a.username);
  Json(json!({ "username": username, "session": current.id })).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordBody {
  current_password: String,
  new_password: String,
}

/// Changes the password and ends every other session: whoever knew the old
/// one may hold one of them.
///
/// Failures are counted per session, not against the account: a stolen
/// session guessing here shouldn't lock the admin out of logging in.
pub async fn post_password(
  State(state): State<SharedState>,
  Extension(current): Extension<Current>,
  Json(body): Json<PasswordBody>,
) -> Response {
  let auth = &state.auth;
  let Some(admin) = auth.store.admin() else {
    return unauthorized();
  };
  let counted = Counted::Known(format!("session:{}", current.id));
  if let Some(wait) = counted.wait(auth) {
    return too_many(wait);
  }
  if !verify_blocking(body.current_password, Some(admin.password_hash)).await {
    counted.fail(auth);
    return error(StatusCode::FORBIDDEN, "Wrong current password");
  }
  counted.succeed(auth);
  if let Err(why) = password::check(&body.new_password) {
    return error(StatusCode::BAD_REQUEST, why);
  }
  let hash = match hash_blocking(body.new_password).await {
    Ok(hash) => hash,
    Err(res) => return res,
  };
  let saved = auth
    .store
    .set_password(&hash)
    .and_then(|()| auth.store.revoke_others(&current.id));
  match saved {
    Ok(()) => StatusCode::NO_CONTENT.into_response(),
    Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e),
  }
}

pub async fn get_sessions(
  State(state): State<SharedState>,
  Extension(current): Extension<Current>,
) -> Response {
  match state.auth.store.sessions(now()) {
    Ok(sessions) => {
      let list: Vec<_> = sessions
        .into_iter()
        .map(|s| {
          json!({
            "id": s.id,
            "device": s.device,
            "created": s.created,
            "lastSeen": s.last_seen,
            "current": s.id == current.id,
          })
        })
        .collect();
      Json(list).into_response()
    }
    Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e),
  }
}

pub async fn delete_session(State(state): State<SharedState>, Path(id): Path<String>) -> Response {
  match state.auth.store.revoke(&id) {
    Ok(true) => StatusCode::NO_CONTENT.into_response(),
    Ok(false) => error(StatusCode::NOT_FOUND, "No such session"),
    Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
    let mut h = HeaderMap::new();
    for (k, v) in pairs {
      h.append(*k, HeaderValue::from_static(v));
    }
    h
  }

  #[test]
  fn secrets_compare_exactly() {
    assert!(same_secret("abc123", "abc123"));
    assert!(!same_secret("abc124", "abc123"));
    assert!(!same_secret("abc12", "abc123"));
    assert!(!same_secret("", "abc123"));
  }

  #[test]
  fn the_cookie_is_found_among_others() {
    let h = headers(&[("cookie", "a=1; kl_session=tok; b=2")]);
    assert_eq!(cookie(&h), Some("tok"));
    let h = headers(&[("cookie", "kl_sessionx=nope")]);
    assert_eq!(cookie(&h), None);
  }

  #[test]
  fn a_bearer_token_needs_the_scheme() {
    assert_eq!(
      bearer(&headers(&[("authorization", "Bearer tok")])),
      Some("tok")
    );
    assert_eq!(bearer(&headers(&[("authorization", "Basic tok")])), None);
  }

  #[test]
  fn same_origin_prefers_sec_fetch_site() {
    // A proxy rewrote Host, but the browser says same-origin.
    assert!(same_origin(&headers(&[
      ("sec-fetch-site", "same-origin"),
      ("host", "127.0.0.1:3000"),
      ("origin", "https://manga.example"),
    ])));
    assert!(!same_origin(&headers(&[
      ("sec-fetch-site", "cross-site"),
      ("host", "manga.example"),
      ("origin", "https://manga.example"),
    ])));
    assert!(!same_origin(&headers(&[("sec-fetch-site", "same-site")])));
  }

  #[test]
  fn without_sec_fetch_site_origin_must_match_host() {
    assert!(same_origin(&headers(&[
      ("host", "manga.example"),
      ("origin", "https://manga.example"),
    ])));
    assert!(!same_origin(&headers(&[
      ("host", "manga.example"),
      ("origin", "https://evil.example"),
    ])));
    // Neither header: not a browser page of ours.
    assert!(!same_origin(&headers(&[("host", "manga.example")])));
  }

  #[test]
  fn the_session_cookie_is_locked_down() {
    let c = session_cookie("tok", false);
    assert!(c.starts_with("kl_session=tok; "), "{c}");
    for part in ["HttpOnly", "SameSite=Strict", "Path=/"] {
      assert!(c.contains(part), "{c} lacks {part}");
    }
    assert!(!c.contains("Secure"));
    assert!(session_cookie("tok", true).ends_with("; Secure"));
  }

  #[test]
  fn usernames_are_trimmed_and_bounded() {
    assert_eq!(check_username("  alice "), Some("alice".to_string()));
    assert_eq!(check_username("   "), None);
    assert_eq!(check_username("a\tb"), None);
    assert!(check_username(&"é".repeat(MAX_USERNAME)).is_some());
    assert_eq!(check_username(&"x".repeat(MAX_USERNAME + 1)), None);
  }

  #[test]
  fn device_names_are_trimmed_and_bounded() {
    let ua = headers(&[("user-agent", "Firefox")]);
    assert_eq!(device_name(Some("  Pixel  "), &ua), "Pixel");
    assert_eq!(device_name(Some(""), &ua), "Firefox");
    assert_eq!(device_name(None, &HeaderMap::new()), "Unknown device");
    assert_eq!(device_name(Some("a\nb"), &ua), "ab");
    assert_eq!(device_name(Some(&"x".repeat(500)), &ua).len(), MAX_DEVICE);
  }
}
