# Security

## Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability** on this
repository. Please don't open a public issue for it.

Only the latest release gets fixes.

## What the server protects

`konigslibrary-server`, and the desktop app's Share to LAN, serve your manga
folder over HTTP or HTTPS, on `0.0.0.0:3000` by default (`HOST` and `PORT`
change that). It may be on a home network or on the internet, behind a reverse
proxy or not. What it guards:

- **The library.** Only the admin's sessions can list or read it.
- **The host's filesystem.** Settings can point the server at any folder and
  list the host's directories, so they need a session too.
- **The account.** The password, and the sessions that stand in for it.

Who it guards against: anyone else who can reach the server, other websites
open in the admin's browser, and anyone on the network path once TLS is on.
Not against someone with access to the host, who can read the library from
disk anyway.

## Accounts

One admin. On first run the server prints a one-time setup token in its log,
and creating the admin takes that token, so the first stranger to reach a new
public server can't claim it. Reading the log proves you run the server. The
desktop app passes its sidecar a fresh token each start and creates the admin
itself, so its token is never logged.

Passwords are 8–256 characters, hashed with Argon2id at OWASP's minimum (19
MiB, two passes, one lane). A login with an unknown username still runs a hash,
so timing doesn't tell which usernames exist.

A lost password is reset with `konigslibrary-server reset-admin` on the host,
which removes the admin, every session and every known device. Being able to
run it is the proof of ownership.

## Sessions

- Tokens are 256 bits from the OS's random generator and stored only as their
  SHA-256, so a copy of the auth database holds no usable token.
- A session ends 30 days after its last use, or 180 days after login.
- The server's own page gets an `HttpOnly; SameSite=Strict` cookie its
  scripts can't read, `Secure` over HTTPS. Other origins (the apps, the web
  reader hosted elsewhere) get a bearer token, which they keep in
  `localStorage`. A token only works the way it was issued.
- Changing the password ends every other session. Any session can be listed
  and ended from Settings.
- The auth database (`konigslibrary-auth.db`, `KL_AUTH_DB`) is created
  readable only by its owner.

**Cross-site requests.** `SameSite=Strict` keeps the cookie off other sites'
requests; as a second check, a cookie request that changes anything needs
`Sec-Fetch-Site: same-origin`, or a matching `Origin` from a browser that
doesn't send it. Library and auth routes allow any origin through CORS, since
the apps live on other origins, but without credentials: a page elsewhere
needs a bearer token it doesn't have. Settings send no CORS headers.

**Nothing is trusted for being local.** Behind a reverse proxy on the same
host every request comes from loopback, so the server's own page on the host
logs in like everyone else.

## Guessing passwords

After 5 failed logins, each failure doubles the wait, up to 15 minutes, with
`429` and `Retry-After`. Failures are counted per address (per `/64` for
IPv6), and against the account when the username is right, so guessing from
many addresses gains nothing.

A login returns a device token, which the client sends on later logins. A
client holding one is counted on its own (OWASP's "device cookies"), so
someone guessing locks out new devices, not the admin's. Wrong current
passwords on a password change count per session, so a stolen session can't
lock the account either.

## TLS and headers

With `KL_TLS_CERT` and `KL_TLS_KEY` the server speaks HTTPS itself (rustls),
and picks up a renewed certificate without a restart. Over HTTPS, responses
carry HSTS for two years, without `includeSubDomains` or `preload`, since the
server is often one name on a domain it doesn't own.

Every response gets `X-Content-Type-Options: nosniff` and
`Referrer-Policy: strict-origin-when-cross-origin`. The page gets a
Content-Security-Policy that allows its own inline scripts only by hash, wasm,
images from itself and `blob:`, and connections to itself and GitHub's API (for
the About page's download links), with `frame-ancestors 'none'`.

## Reverse proxies

`X-Forwarded-For` and `X-Forwarded-Proto` are believed only from the addresses
in `KL_TRUSTED_PROXIES`; from anyone else they're ignored. The client is the
rightmost forwarded hop that isn't a trusted proxy, so a client can't pick its
own address by sending the header. See `docs/guide/install.org` for a setup.

## Files

Paths resolve inside the configured manga folder; `..`, absolute paths and
other traversal attempts get a 404. Outside archives, only image files are
served, so a stray file in the folder (`id_rsa`, `.env`) isn't readable.

## Where to look

`crates/klserver/src/auth.rs` (routes, middleware, cross-site check),
`auth/store.rs`, `auth/password.rs`, `auth/limit.rs`, `auth/proxy.rs`,
`headers.rs`, `tls.rs`, and `library.rs` (`get_file`), with tests in the same
files.

## Known limits

- **Plain HTTP on the LAN.** Share to LAN, and a server without TLS, send the
  password, session tokens and pages in the clear: anyone who can capture
  traffic on the network can take over a session. A certificate the apps
  accept needs a domain: Android 7+ apps trust only system CAs, so a
  self-signed one won't do. Put a server on the internet only with HTTPS.
- **One account.** Everyone you share with uses the admin's login, and every
  session can change the served folder and browse the host's directories.
- **A new device can be locked out.** While someone keeps guessing, a device
  that never logged in before can't log in, for up to 15 minutes after they
  stop. Devices that have logged in before aren't affected.
- **Limits reset on restart.** Failure counts are kept in memory.
- **Bearer tokens in `localStorage`.** A script injected into the apps or the
  hosted web reader could read them. Their CSPs (`src-tauri/tauri.conf.json`;
  `svelte.config.js` and `vercel.json`) allow only their own scripts, but let
  them connect to any server, since that's where the user's library is.
- **No second factor.**

## Dependencies

Rust dependencies are checked with `cargo-deny` (advisories, licenses, bans,
sources) on every push and weekly; see `deny.toml` for the advisories
currently ignored and why. Dependabot opens update PRs monthly.
