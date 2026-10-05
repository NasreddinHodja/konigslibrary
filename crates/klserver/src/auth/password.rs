//! Password hashing: Argon2id with the OWASP minimum of 19 MiB, two passes and
//! one lane, which are also the `argon2` crate's defaults.

use std::sync::OnceLock;

use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use argon2::Argon2;

pub const MIN_LEN: usize = 8;
/// Bounds the work one request can ask for.
pub const MAX_LEN: usize = 256;

#[cfg(not(test))]
fn argon2() -> Argon2<'static> {
  Argon2::default()
}

/// The cheapest parameters, so the tests don't spend seconds hashing.
/// Verifying reads the parameters from the hash, so nothing else changes.
#[cfg(test)]
fn argon2() -> Argon2<'static> {
  use argon2::{Algorithm, Params, Version};
  let params = Params::new(Params::MIN_M_COST, 1, 1, None).unwrap();
  Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

/// Why a new password can't be used, if it can't.
pub fn check(password: &str) -> Result<(), String> {
  let len = password.chars().count();
  if len < MIN_LEN {
    Err(format!("The password needs at least {MIN_LEN} characters"))
  } else if len > MAX_LEN {
    Err(format!(
      "The password can have at most {MAX_LEN} characters"
    ))
  } else {
    Ok(())
  }
}

/// A PHC string (`$argon2id$v=19$…`) with its own random salt.
pub fn hash(password: &str) -> String {
  argon2()
    .hash_password(password.as_bytes())
    .expect("hashing with valid parameters")
    .to_string()
}

pub fn verify(password: &str, hash: &str) -> bool {
  if password.len() > MAX_LEN * 4 {
    return false;
  }
  PasswordHash::new(hash).is_ok_and(|parsed| {
    argon2()
      .verify_password(password.as_bytes(), &parsed)
      .is_ok()
  })
}

/// Does the work of a failed `verify`, for a login with an unknown username,
/// so the response time doesn't tell which usernames exist.
pub fn verify_nothing(password: &str) {
  static DUMMY: OnceLock<String> = OnceLock::new();
  verify(
    password,
    DUMMY.get_or_init(|| hash("not anyone's password")),
  );
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_hash_verifies_only_its_password() {
    let h = hash("correct horse");
    assert!(h.starts_with("$argon2id$v=19$"), "{h}");
    assert!(verify("correct horse", &h));
    assert!(!verify("correct horsf", &h));
    assert!(!verify("", &h));
  }

  #[test]
  fn each_hash_has_its_own_salt() {
    assert_ne!(hash("same"), hash("same"));
  }

  #[test]
  fn a_malformed_hash_verifies_nothing() {
    assert!(!verify("anything", "not a hash"));
    assert!(!verify("anything", ""));
  }

  #[test]
  fn the_release_parameters_are_the_owasp_minimum() {
    let params = Argon2::default().params().clone();
    assert_eq!(
      (params.m_cost(), params.t_cost(), params.p_cost()),
      (19 * 1024, 2, 1)
    );
    let h = Argon2::default().hash_password(b"x").unwrap().to_string();
    assert!(h.starts_with("$argon2id$"), "{h}");
  }

  #[test]
  fn length_limits() {
    assert!(check("1234567").is_err());
    assert!(check("12345678").is_ok());
    // Counted in characters, not bytes.
    assert!(check("ééééééé").is_err());
    assert!(check(&"x".repeat(MAX_LEN)).is_ok());
    assert!(check(&"x".repeat(MAX_LEN + 1)).is_err());
  }
}
