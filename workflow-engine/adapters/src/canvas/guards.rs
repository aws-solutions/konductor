// SPDX-License-Identifier: Apache-2.0
//! The request guards of the canvas contract: the `Host`, the `Origin`, the bearer token, the content type, and the
//! launch code that is traded for a token. Each is a plain function of the request, so a test can call it alone.

use std::fs::File;
use std::io::Read;

use super::http::Head;

/// How long the launch code works, from the moment the server starts (the contract's 60 seconds).
pub const LAUNCH_WINDOW_MS: u64 = 60_000;

/// Compares two secrets in time that depends on their length only.
pub fn same_secret(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = a.len() ^ b.len();
    for (i, byte) in a.iter().enumerate() {
        // Past the end of `b` the comparison goes on with a fixed byte, so a short guess takes as long as a long one.
        diff |= usize::from(byte ^ b.get(i).copied().unwrap_or(0));
    }
    diff == 0
}

/// A secret of 256 bits from the operating system's random source, as 64 lower-case hex digits. The standard library
/// has no random source of its own, so this reads `/dev/urandom`, which does not block and is seeded at boot.
pub fn new_secret() -> std::io::Result<String> {
    let mut bytes = [0u8; 32];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// The `Host` of the request, lower case, if it is this server on a loopback name and port.
pub fn local_host(head: &Head, port: u16) -> Option<String> {
    let host = head.header("host").ok()??.to_ascii_lowercase();
    (host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")).then_some(host)
}

/// Whether the `Origin` and `Sec-Fetch-Site` of the request are allowed. A `PUT` or `POST` must carry the server's own
/// `Origin`. A `GET` may leave both out, but one it carries must not point elsewhere.
pub fn origin_allowed(head: &Head, host: &str) -> bool {
    let own = format!("http://{host}");
    let (Ok(origin), Ok(site)) = (head.header("origin"), head.header("sec-fetch-site")) else {
        return false;
    };
    if head.method == "GET" {
        origin.is_none_or(|o| o == own) && site.is_none_or(|s| s == "same-origin" || s == "none")
    } else {
        origin == Some(own.as_str())
    }
}

/// The token in `Authorization: Bearer <token>`.
pub fn bearer(head: &Head) -> Option<&str> {
    let value = head.header("authorization").ok()??;
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty() && !token.contains([' ', '\t']))
        .then_some(token)
}

/// Whether the media type is `application/json`, with no parameter or with `charset=utf-8`.
pub fn json_content_type(head: &Head) -> bool {
    let Ok(Some(value)) = head.header("content-type") else {
        return false;
    };
    let lower = value.to_ascii_lowercase();
    let (media, parameter) = match lower.split_once(';') {
        Some((media, parameter)) => (media.trim(), Some(parameter.trim())),
        None => (lower.trim(), None),
    };
    media == "application/json"
        && parameter.is_none_or(|p| {
            p.strip_prefix("charset")
                .map(str::trim_start)
                .and_then(|r| r.strip_prefix('='))
                .is_some_and(|v| v.trim() == "utf-8")
        })
}

/// The one-time launch code and the session token it is traded for.
#[derive(Debug)]
pub struct SessionGate {
    code: String,
    opened_ms: u64,
    token: Option<String>,
}

impl SessionGate {
    /// A gate whose launch window opens at `now_ms`.
    pub fn new(code: String, now_ms: u64) -> SessionGate {
        SessionGate {
            code,
            opened_ms: now_ms,
            token: None,
        }
    }

    /// Trades the code for a token, once and within the window. A wrong code does not use the code up.
    pub fn exchange(
        &mut self,
        code: &str,
        now_ms: u64,
        mint: impl FnOnce() -> Option<String>,
    ) -> Option<String> {
        let right = same_secret(code, &self.code);
        let open = self.token.is_none() && now_ms.saturating_sub(self.opened_ms) < LAUNCH_WINDOW_MS;
        if !(right && open) {
            return None;
        }
        let token = mint()?;
        self.token = Some(token.clone());
        Some(token)
    }

    /// Whether `sent` is the session token.
    pub fn accepts(&self, sent: Option<&str>) -> bool {
        match (&self.token, sent) {
            (Some(token), Some(sent)) => same_secret(sent, token),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head(method: &str, headers: &[(&str, &str)]) -> Head {
        Head {
            method: method.to_string(),
            target: "/".to_string(),
            headers: headers
                .iter()
                .map(|(n, v)| (n.to_string(), v.to_string()))
                .collect(),
            surplus: Vec::new(),
        }
    }

    #[test]
    fn secrets_are_equal_only_when_every_byte_is() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "ab"));
        assert!(!same_secret("ab", "abc"));
        assert!(!same_secret("", "a"));
        assert!(same_secret("", ""));
        // A guess that is the secret followed by zero bytes is not the secret.
        assert!(!same_secret("ab\0", "ab"));
    }

    #[test]
    fn a_new_secret_is_64_hex_digits_and_differs_each_time() {
        let (a, b) = (new_secret().unwrap(), new_secret().unwrap());
        assert_eq!(a.len(), 64);
        assert!(a
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)));
        assert_ne!(a, b);
    }

    #[test]
    fn the_host_must_name_a_loopback_address_and_this_port() {
        for ok in ["127.0.0.1:8080", "localhost:8080", "LOCALHOST:8080"] {
            assert!(
                local_host(&head("GET", &[("host", ok)]), 8080).is_some(),
                "{ok}"
            );
        }
        for bad in [
            "127.0.0.1:8081",
            "127.0.0.1",
            "evil.example:8080",
            "127.0.0.1.evil.example:8080",
            "[::1]:8080",
            "",
        ] {
            assert!(
                local_host(&head("GET", &[("host", bad)]), 8080).is_none(),
                "{bad}"
            );
        }
        assert!(local_host(&head("GET", &[]), 8080).is_none());
        let twice = head(
            "GET",
            &[("host", "127.0.0.1:8080"), ("host", "127.0.0.1:8080")],
        );
        assert!(local_host(&twice, 8080).is_none());
    }

    #[test]
    fn a_post_needs_its_own_origin_and_a_get_only_refuses_a_foreign_one() {
        let host = "127.0.0.1:8080";
        let own = "http://127.0.0.1:8080";
        assert!(origin_allowed(&head("POST", &[("origin", own)]), host));
        assert!(!origin_allowed(&head("POST", &[]), host));
        assert!(!origin_allowed(
            &head("PUT", &[("origin", "http://evil.example")]),
            host
        ));
        assert!(!origin_allowed(&head("POST", &[("origin", "null")]), host));
        assert!(origin_allowed(&head("GET", &[]), host));
        assert!(origin_allowed(&head("GET", &[("origin", own)]), host));
        assert!(!origin_allowed(
            &head("GET", &[("origin", "http://evil.example")]),
            host
        ));
        for site in ["same-origin", "none"] {
            assert!(origin_allowed(
                &head("GET", &[("sec-fetch-site", site)]),
                host
            ));
        }
        for site in ["cross-site", "same-site"] {
            assert!(!origin_allowed(
                &head("GET", &[("sec-fetch-site", site)]),
                host
            ));
        }
    }

    #[test]
    fn the_bearer_token_is_read_from_one_authorization_header() {
        assert_eq!(
            bearer(&head("GET", &[("authorization", "Bearer abc")])),
            Some("abc")
        );
        assert_eq!(
            bearer(&head("GET", &[("authorization", "bearer abc")])),
            Some("abc")
        );
        assert_eq!(
            bearer(&head("GET", &[("authorization", "Basic abc")])),
            None
        );
        assert_eq!(
            bearer(&head("GET", &[("authorization", "Bearer a b")])),
            None
        );
        assert_eq!(bearer(&head("GET", &[("authorization", "Bearer ")])), None);
        assert_eq!(bearer(&head("GET", &[])), None);
    }

    #[test]
    fn the_content_type_is_json_with_no_parameter_or_utf8() {
        for ok in [
            "application/json",
            "Application/JSON",
            "application/json; charset=utf-8",
            "application/json;charset=UTF-8",
        ] {
            assert!(
                json_content_type(&head("POST", &[("content-type", ok)])),
                "{ok}"
            );
        }
        for bad in [
            "text/plain",
            "application/json; charset=latin1",
            "application/json; boundary=x",
            "application/jsonx",
            "",
        ] {
            assert!(
                !json_content_type(&head("POST", &[("content-type", bad)])),
                "{bad}"
            );
        }
        assert!(!json_content_type(&head("POST", &[])));
    }

    #[test]
    fn a_launch_code_works_once_and_only_in_its_window() {
        let mint = || Some("token".to_string());
        let mut gate = SessionGate::new("code".to_string(), 1_000);
        assert_eq!(gate.exchange("wrong", 1_001, mint), None);
        assert_eq!(
            gate.exchange("code", 1_002, mint),
            Some("token".to_string())
        );
        assert_eq!(gate.exchange("code", 1_003, mint), None);
        assert!(gate.accepts(Some("token")));
        assert!(!gate.accepts(Some("other")));
        assert!(!gate.accepts(None));

        let mut late = SessionGate::new("code".to_string(), 1_000);
        assert_eq!(late.exchange("code", 1_000 + LAUNCH_WINDOW_MS, mint), None);
        let mut inside = SessionGate::new("code".to_string(), 1_000);
        assert!(inside
            .exchange("code", 1_000 + LAUNCH_WINDOW_MS - 1, mint)
            .is_some());
    }

    #[test]
    fn nothing_is_accepted_before_a_token_exists() {
        let gate = SessionGate::new("code".to_string(), 0);
        assert!(!gate.accepts(Some("")));
        assert!(!gate.accepts(Some("code")));
    }
}
