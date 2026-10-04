# Security

## Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability** on this
repository. Please don't open a public issue for it.

Only the latest release gets fixes.

## The server

`konigslibrary-server`, and the desktop app's Share to LAN, serve your manga
folder over HTTP, on `0.0.0.0:3000` by default (`HOST` and `PORT` change that).

**Access key.** Every `/api` route except `/api/ping` needs the server's key.
Other devices get it by scanning the QR code in Share to LAN, or from the
link the server prints on start. Without it they get `401`. This covers other
devices on the network and other websites open in a browser on the host, which
could otherwise read the library from `localhost`. The server's own page on
the host needs no key.

**Only library files are served.** Paths resolve inside the configured manga
folder; `..`, absolute paths and other traversal attempts get a 404. Outside
archives, only image files are served, so a stray file in the folder
(`id_rsa`, `.env`) isn't readable.

**Settings are local-only.** Changing the served folder (`POST /api/settings`)
and browsing the host's filesystem (`GET /api/settings/browse`) are refused
unless the request comes from this machine, with a loopback `Host` and, if
present, a matching `Origin`, even with the key. That also blocks DNS
rebinding. These routes send no CORS headers.

The checks are in `crates/klserver/src/auth.rs`, `crates/klserver/src/routes.rs`
(`is_local_client`, `is_local_page`) and `crates/klserver/src/library.rs`
(`get_file`), with tests in the same files.

## Known limits

- **Plain HTTP.** Anyone who can capture traffic on your network can read the
  key and the pages you load. Don't expose the server to the internet or run
  it on a network you don't trust without HTTPS in front of it.
- **One key for every device.** Anyone holding it has access until it's
  replaced: delete `konigslibrary.key` (the app's `lan-key` in its data
  directory) and restart, then pair your devices again.

## Dependencies

Rust dependencies are checked with `cargo-deny` (advisories, licenses, bans,
sources) on every push and weekly; see `deny.toml` for the advisories
currently ignored and why. Dependabot opens update PRs monthly.
