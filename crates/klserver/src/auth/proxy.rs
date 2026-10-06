//! Who a request is really from, behind a reverse proxy.
//!
//! `X-Forwarded-For` and `X-Forwarded-Proto` are only believed from the
//! addresses in `KL_TRUSTED_PROXIES`: anyone else can send them.

use std::net::IpAddr;

use axum::http::HeaderMap;

/// `KL_TRUSTED_PROXIES`: addresses and CIDR ranges, comma-separated.
#[derive(Debug, Default, Clone)]
pub struct TrustedProxies(Vec<(IpAddr, u8)>);

/// IPv4 clients of a dual-stack listener arrive as `::ffff:a.b.c.d`.
fn canonical(ip: IpAddr) -> IpAddr {
  match ip {
    IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(ip, IpAddr::V4),
    v4 => v4,
  }
}

fn bits(ip: IpAddr) -> u8 {
  if ip.is_ipv4() {
    32
  } else {
    128
  }
}

fn in_range(ip: IpAddr, (net, prefix): (IpAddr, u8)) -> bool {
  // The top `prefix` of `len` bits; shifting by the full width would overflow.
  let mask = |len: u32| u128::MAX.checked_shl(len - u32::from(prefix)).unwrap_or(0);
  match (ip, net) {
    (IpAddr::V4(a), IpAddr::V4(b)) => {
      let m = mask(32) as u32;
      u32::from(a) & m == u32::from(b) & m
    }
    (IpAddr::V6(a), IpAddr::V6(b)) => {
      let m = mask(128);
      u128::from(a) & m == u128::from(b) & m
    }
    _ => false,
  }
}

impl TrustedProxies {
  pub fn parse(spec: &str) -> Result<Self, String> {
    let mut ranges = Vec::new();
    for item in spec.split(',').map(str::trim).filter(|s| !s.is_empty()) {
      let (addr, prefix) = match item.split_once('/') {
        Some((addr, prefix)) => (addr, Some(prefix)),
        None => (item, None),
      };
      let ip: IpAddr = addr
        .parse()
        .map_err(|_| format!("KL_TRUSTED_PROXIES: {item:?} is not an address"))?;
      let ip = canonical(ip);
      let prefix = match prefix {
        None => bits(ip),
        Some(p) => p
          .parse::<u8>()
          .ok()
          .filter(|&p| p <= bits(ip))
          .ok_or_else(|| format!("KL_TRUSTED_PROXIES: bad prefix in {item:?}"))?,
      };
      ranges.push((ip, prefix));
    }
    Ok(Self(ranges))
  }

  pub fn is_empty(&self) -> bool {
    self.0.is_empty()
  }

  fn trusts(&self, ip: IpAddr) -> bool {
    let ip = canonical(ip);
    self.0.iter().any(|&range| in_range(ip, range))
  }

  /// The client's address: the peer's, or, when the peer is a trusted proxy,
  /// the rightmost `X-Forwarded-For` hop that isn't one.
  pub fn client_ip(&self, peer: IpAddr, headers: &HeaderMap) -> IpAddr {
    let peer = canonical(peer);
    if !self.trusts(peer) {
      return peer;
    }
    let hops: Vec<&str> = headers
      .get_all("x-forwarded-for")
      .iter()
      .filter_map(|v| v.to_str().ok())
      .flat_map(|v| v.split(','))
      .map(str::trim)
      .collect();
    let mut client = peer;
    for hop in hops.iter().rev() {
      // A hop we can't read ends the chain at the last one we could.
      let Ok(ip) = hop.parse::<IpAddr>() else {
        break;
      };
      client = canonical(ip);
      if !self.trusts(client) {
        break;
      }
    }
    client
  }

  /// Whether the client reached us over HTTPS, as a trusted proxy reports it.
  pub fn forwarded_https(&self, peer: IpAddr, headers: &HeaderMap) -> bool {
    self.trusts(peer)
      && headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .is_some_and(|proto| proto.trim().eq_ignore_ascii_case("https"))
  }
}

/// What the login limit counts per: the address, or for IPv6 its /64, which
/// one host can have all of.
pub fn limit_key(ip: IpAddr) -> String {
  match canonical(ip) {
    IpAddr::V4(v4) => v4.to_string(),
    IpAddr::V6(v6) => {
      let s = v6.segments();
      format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use axum::http::HeaderValue;

  fn ip(s: &str) -> IpAddr {
    s.parse().unwrap()
  }

  fn xff(values: &[&'static str]) -> HeaderMap {
    let mut h = HeaderMap::new();
    for v in values {
      h.append("x-forwarded-for", HeaderValue::from_static(v));
    }
    h
  }

  #[test]
  fn parses_addresses_and_ranges() {
    let p = TrustedProxies::parse(" 127.0.0.1, 10.0.0.0/8 ,::1, fd00::/8").unwrap();
    assert!(p.trusts(ip("127.0.0.1")));
    assert!(!p.trusts(ip("127.0.0.2")));
    assert!(p.trusts(ip("10.200.3.4")));
    assert!(!p.trusts(ip("11.0.0.1")));
    assert!(p.trusts(ip("::1")));
    assert!(p.trusts(ip("fd12::5")));
    assert!(p.trusts(ip("::ffff:127.0.0.1")));
    assert!(TrustedProxies::parse("").unwrap().0.is_empty());
  }

  #[test]
  fn a_zero_prefix_trusts_everything_in_its_family() {
    let p = TrustedProxies::parse("0.0.0.0/0").unwrap();
    assert!(p.trusts(ip("203.0.113.9")));
    assert!(!p.trusts(ip("2001:db8::1")));
  }

  #[test]
  fn rejects_bad_entries() {
    for spec in ["nope", "10.0.0.0/33", "::1/129", "10.0.0.0/x"] {
      assert!(TrustedProxies::parse(spec).is_err(), "{spec}");
    }
  }

  #[test]
  fn forwarded_headers_from_anyone_else_are_ignored() {
    let p = TrustedProxies::parse("127.0.0.1").unwrap();
    let h = xff(&["203.0.113.9"]);
    assert_eq!(p.client_ip(ip("192.168.1.5"), &h), ip("192.168.1.5"));
    let none = TrustedProxies::default();
    assert_eq!(none.client_ip(ip("127.0.0.1"), &h), ip("127.0.0.1"));
  }

  #[test]
  fn the_rightmost_untrusted_hop_is_the_client() {
    let p = TrustedProxies::parse("127.0.0.1, 10.0.0.0/8").unwrap();
    // The leftmost entry is whatever the client claimed.
    let h = xff(&["1.2.3.4, 203.0.113.9", "10.0.0.2"]);
    assert_eq!(p.client_ip(ip("127.0.0.1"), &h), ip("203.0.113.9"));
  }

  #[test]
  fn an_unreadable_hop_stops_the_walk() {
    let p = TrustedProxies::parse("127.0.0.1").unwrap();
    let h = xff(&["203.0.113.9, garbage"]);
    assert_eq!(p.client_ip(ip("127.0.0.1"), &h), ip("127.0.0.1"));
  }

  #[test]
  fn https_is_only_believed_from_a_trusted_proxy() {
    let p = TrustedProxies::parse("127.0.0.1").unwrap();
    let mut h = HeaderMap::new();
    h.insert("x-forwarded-proto", HeaderValue::from_static("https"));
    assert!(p.forwarded_https(ip("127.0.0.1"), &h));
    assert!(!p.forwarded_https(ip("192.168.1.5"), &h));
    h.insert("x-forwarded-proto", HeaderValue::from_static("http"));
    assert!(!p.forwarded_https(ip("127.0.0.1"), &h));
  }

  #[test]
  fn ipv6_clients_are_limited_per_64() {
    assert_eq!(
      limit_key(ip("2001:db8:1:2:aaaa::1")),
      limit_key(ip("2001:db8:1:2:bbbb::9"))
    );
    assert_ne!(
      limit_key(ip("2001:db8:1:2::1")),
      limit_key(ip("2001:db8:1:3::1"))
    );
    assert_eq!(limit_key(ip("::ffff:192.0.2.1")), "192.0.2.1");
  }
}
