// SPDX-License-Identifier: Apache-2.0
//
// Host-allowlist classification, DNS-rebinding pin construction, and the
// resolution timeout-vs-failure decision shared by cli/konductor-rs and
// mcp/lib/skill-lookup-core, so the two crates (not otherwise linked)
// can't silently diverge on a security-relevant call.
//
// std-only by default; the `async` feature adds a tokio-based bounded
// resolution path so a synchronous consumer never pulls tokio in.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::identity::{create_private_dir_all, current_uid};

/// A timeout is kept distinct from a resolution failure: `decide_pin`
/// treats the two differently.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DnsOutcome {
    Resolved(Vec<IpAddr>),
    /// A genuine resolution error (e.g. NXDOMAIN). Not itself a sign of
    /// an attacker -- `example.invalid` (RFC 2606) never resolves and
    /// must still be treated as allowed by `decide_pin`.
    Failed,
    TimedOut,
}

/// Runs `f` on a detached thread, bounded by `timeout` via
/// `mpsc::recv_timeout` (`JoinHandle::join` has no timeout variant). On
/// timeout the thread is abandoned rather than cancelled -- there is no
/// portable way to interrupt a blocked `getaddrinfo` call -- and its
/// eventual result is silently dropped.
pub fn run_with_timeout<T, F>(timeout: Duration, f: F) -> Option<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(timeout).ok()
}

/// Resolves `host` via `ToSocketAddrs`, the same lookup a real HTTP
/// client performs. Unbounded; callers needing a bound wrap this in
/// `resolve_host_addrs_bounded` or `_bounded_async`.
pub fn resolve_host_addrs(host: &str) -> Option<Vec<IpAddr>> {
    // Port is unused; resolution doesn't depend on it.
    (host, 0u16)
        .to_socket_addrs()
        .map(|addrs| addrs.map(|socket_addr| socket_addr.ip()).collect())
        .ok()
}

/// Sync version of the bounded resolution; distinguishes `Failed` from
/// `TimedOut` for `decide_pin`.
pub fn resolve_host_addrs_bounded(host: &str, timeout: Duration) -> DnsOutcome {
    let host = host.to_string();
    match run_with_timeout(timeout, move || resolve_host_addrs(&host)) {
        Some(Some(addrs)) => DnsOutcome::Resolved(addrs),
        Some(None) => DnsOutcome::Failed,
        None => DnsOutcome::TimedOut,
    }
}

/// Async equivalent of `run_with_timeout`, using tokio's own runtime
/// instead of a dedicated thread per call.
///
/// `Err(Panicked)` and `Err(TimedOut)` are kept distinct here even
/// though the sync path can't tell them apart -- see
/// `resolve_host_addrs_bounded_async` for why both still collapse to
/// the same `DnsOutcome::TimedOut`.
#[cfg(feature = "async")]
async fn run_with_timeout_async<T, F>(timeout: Duration, f: F) -> Result<T, AsyncBoundError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    match tokio::time::timeout(timeout, tokio::task::spawn_blocking(f)).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_join_error)) => Err(AsyncBoundError::Panicked),
        Err(_elapsed) => Err(AsyncBoundError::TimedOut),
    }
}

#[cfg(feature = "async")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AsyncBoundError {
    TimedOut,
    Panicked,
}

/// Async version of `resolve_host_addrs_bounded`.
///
/// A panic maps to `TimedOut`, not `Failed` (AutoSDE `f-b44a65a0`): the
/// sync path can't tell a panic from a stall (both drop the channel
/// without sending), so both already resolve to `TimedOut` there. A
/// panicked resolution says nothing about the host's safety, so it
/// must be denied outright like a timeout, not treated as the
/// fail-open "nothing to pin" case a clean failure gets.
#[cfg(feature = "async")]
pub async fn resolve_host_addrs_bounded_async(host: String, timeout: Duration) -> DnsOutcome {
    match run_with_timeout_async(timeout, move || resolve_host_addrs(&host)).await {
        Ok(Some(addrs)) => DnsOutcome::Resolved(addrs),
        Ok(None) => DnsOutcome::Failed,
        Err(AsyncBoundError::Panicked) => DnsOutcome::TimedOut,
        Err(AsyncBoundError::TimedOut) => DnsOutcome::TimedOut,
    }
}

/// Picks the pin candidate (the first resolved address; any of them is
/// equally valid once all have passed `is_disallowed_ip`) or denies the
/// whole host if any address is disallowed.
pub fn classify_resolved_addrs(addrs: &[IpAddr]) -> Option<Option<IpAddr>> {
    if addrs.iter().any(|ip| is_disallowed_ip(*ip)) {
        None
    } else {
        Some(addrs.first().copied())
    }
}

/// Final allow/deny/pin verdict for a hostname that isn't itself an IP
/// literal. The one place the timeout-vs-failure distinction becomes a
/// decision, so both consumer crates apply it identically:
///
/// - `Resolved` classifies normally.
/// - `Failed` is allowed with nothing to pin -- unresolvable isn't the
///   same as disallowed (`example.invalid` must still pass).
/// - `TimedOut` is denied outright (AutoSDE `f-9ec2e9ff`), not folded
///   into `Failed`'s fail-open case. Both consumers bound this
///   resolution specifically so it can never stall a foreground or
///   worker thread; treating a timeout as "wait longer" would
///   reintroduce that stall. Failing closed instead costs an
///   occasional dropped event against a slow resolver, in exchange for
///   closing the window where a stalled resolution lets curl's later,
///   unpinned resolution get rebound to a private address.
pub fn decide_pin(outcome: DnsOutcome) -> Option<Option<IpAddr>> {
    match outcome {
        DnsOutcome::Resolved(addrs) => classify_resolved_addrs(&addrs),
        DnsOutcome::Failed => Some(None),
        DnsOutcome::TimedOut => None,
    }
}

/// Embedded IPv4 address for the legacy IPv4-compatible IPv6 notation
/// (`::a.b.c.d`, RFC 4291 §2.5.5.1, the `::/96` prefix -- distinct from
/// the IPv4-mapped form handled via `to_ipv4_mapped()` below).
/// `Ipv6Addr::to_ipv4()` also recognizes this notation but additionally
/// maps `::1` to `Some(0.0.0.1)`, misclassifying loopback as public;
/// this excludes `::` and `::1` explicitly so those keep going through
/// `is_unspecified()`/`is_loopback()` instead.
fn ipv4_compatible(v6: Ipv6Addr) -> Option<Ipv4Addr> {
    let segments = v6.segments();
    if segments[..6] != [0, 0, 0, 0, 0, 0] {
        return None;
    }
    if v6.is_unspecified() || v6.is_loopback() {
        return None;
    }
    Some(Ipv4Addr::new(
        (segments[6] >> 8) as u8,
        (segments[6] & 0xff) as u8,
        (segments[7] >> 8) as u8,
        (segments[7] & 0xff) as u8,
    ))
}

/// Classifies a resolved `IpAddr` as unspecified, loopback, link-local,
/// or RFC 1918 private. Shared by the literal-IP path
/// (`is_disallowed_local_host`) and the resolved-address path
/// (`classify_resolved_addrs`) so the two can't drift apart.
///
/// The unspecified address (`0.0.0.0`/`::`) is checked explicitly
/// (AutoSDE `f-02064b4b`): none of `is_loopback`/`is_link_local`/
/// `is_private` match `0.0.0.0`, and on Linux a connection to
/// `0.0.0.0` routes to a local service on loopback, so without this
/// check a hostname resolving to it would bypass the allowlist.
///
/// An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, RFC 4291 §2.5.5.2) is
/// unmapped and classified as its embedded IPv4 address first --
/// `::ffff:127.0.0.1` otherwise parses as an ordinary `IpAddr::V6` that
/// no other check here catches, despite unambiguously addressing IPv4
/// loopback.
///
/// The legacy IPv4-compatible form (`::a.b.c.d`, the distinct `::/96`
/// prefix) is unmapped the same way, closing an independent bypass:
/// `::10.0.0.1` doesn't unmap via `to_ipv4_mapped()` and isn't caught
/// by either bitmask check below.
///
/// 6to4 (`2002::/16`, RFC 3056) and NAT64 WKP (`64:ff9b::/96`, RFC
/// 6052) addresses are unmapped and classified by their embedded IPv4
/// address the same way -- both transition mechanisms carry an
/// ordinary IPv4 address inside an IPv6 literal that neither bitmask
/// check below catches on its own.
///
/// See `IANA_SPECIAL_PURPOSE_REGISTRY` in this module's tests for the
/// full checklist of what this rejects and why.
pub fn is_disallowed_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_disallowed_ipv4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_disallowed_ipv4(mapped);
            }
            if let Some(compat) = ipv4_compatible(v6) {
                return is_disallowed_ipv4(compat);
            }
            if let Some(embedded) = six_to_four_embedded_ipv4(v6) {
                return is_disallowed_ipv4(embedded);
            }
            if let Some(embedded) = nat64_well_known_prefix_embedded_ipv4(v6) {
                return is_disallowed_ipv4(embedded);
            }
            v6.is_unspecified()
                || v6.is_loopback()
                // fe80::/10: top 10 bits of the first segment are
                // 1111111010. Checked via bitmask rather than the
                // newer `is_unicast_link_local()` to avoid an MSRV
                // question.
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                // fc00::/7 unique-local, the IPv6 analog of RFC 1918
                // (AutoSDE `f-83540965`). Top 7 bits 1111110 covers
                // both fc00::/8 and fd00::/8 in one check.
                || (v6.segments()[0] & 0xfe00) == 0xfc00
        }
    }
}

/// IPv4-only classification, applied to a literal `IpAddr::V4` and to
/// every IPv6 form that unmaps to an embedded IPv4 address.
fn is_disallowed_ipv4(v4: Ipv4Addr) -> bool {
    v4.is_unspecified()
        || v4.is_loopback()
        || v4.is_link_local()
        || v4.is_private()
        || is_shared_address_space_cgnat(v4)
}

/// RFC 6598 Shared Address Space / CGNAT (`100.64.0.0/10`) -- distinct
/// from the RFC 1918 ranges above, but a resolved endpoint here is
/// reachable only from within the ISP's own network, the same SSRF
/// threat model this allowlist exists to close.
fn is_shared_address_space_cgnat(v4: Ipv4Addr) -> bool {
    let octets = v4.octets();
    octets[0] == 100 && (octets[1] & 0b1100_0000) == 0b0100_0000
}

/// Embedded IPv4 address for a 6to4 address (`2002::/16`, RFC 3056):
/// bits 16-48 (segments 1-2). This prefix never overlaps unspecified
/// or loopback, so no exclusion is needed.
fn six_to_four_embedded_ipv4(v6: Ipv6Addr) -> Option<Ipv4Addr> {
    let segments = v6.segments();
    if segments[0] != 0x2002 {
        return None;
    }
    Some(Ipv4Addr::new(
        (segments[1] >> 8) as u8,
        (segments[1] & 0xff) as u8,
        (segments[2] >> 8) as u8,
        (segments[2] & 0xff) as u8,
    ))
}

/// Embedded IPv4 address for a NAT64 Well-Known Prefix address
/// (`64:ff9b::/96`, RFC 6052): the low 32 bits (segments 6-7).
fn nat64_well_known_prefix_embedded_ipv4(v6: Ipv6Addr) -> Option<Ipv4Addr> {
    let segments = v6.segments();
    if segments[..6] != [0x0064, 0xff9b, 0, 0, 0, 0] {
        return None;
    }
    Some(Ipv4Addr::new(
        (segments[6] >> 8) as u8,
        (segments[6] & 0xff) as u8,
        (segments[7] >> 8) as u8,
        (segments[7] & 0xff) as u8,
    ))
}

/// Rejects loopback, link-local, and RFC 1918 private hosts.
/// `"localhost"` is checked as a case-insensitive literal since it
/// never parses as an `IpAddr`. An ordinary public DNS hostname is not
/// flagged here -- that's a real fleet-managed collector's shape, and
/// is covered instead by the resolution-based check in `decide_pin`.
pub fn is_disallowed_local_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    let Ok(ip) = host.parse::<IpAddr>() else {
        return false;
    };
    is_disallowed_ip(ip)
}

/// Strips URL userinfo (`user[:password]@`) from an authority string,
/// returning `host[:port]`. `curl` discards everything up to the last
/// `@` before connecting, so classification must run on the
/// post-`@` host: without this, `https://x@127.0.0.1/` presents
/// `"x@127.0.0.1"` to `is_disallowed_local_host`, which parses as
/// neither `"localhost"` nor a valid IP and is (wrongly) allowed,
/// while curl itself connects straight to `127.0.0.1` -- a full
/// bypass. `rsplit_once` (the LAST `@`) matches curl's own tolerance
/// for a userinfo value that itself contains `@`.
fn strip_userinfo(host_and_port: &str) -> &str {
    host_and_port
        .rsplit_once('@')
        .map_or(host_and_port, |(_userinfo, host)| host)
}

/// Extracts the host from a `https://[user[:pass]@]host[:port][/path]`
/// URL, handling IPv6 brackets (`[::1]:443`) and userinfo. Returns
/// `None` for a non-`https://` or hostless input. Minimal,
/// dependency-free parsing for this one security check, not general
/// URL handling.
pub fn extract_host(endpoint: &str) -> Option<&str> {
    let after_scheme = endpoint.strip_prefix("https://")?;
    let host_and_port = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    if host_and_port.is_empty() {
        return None;
    }
    let host_and_port = strip_userinfo(host_and_port);
    if host_and_port.is_empty() {
        return None;
    }
    if let Some(rest) = host_and_port.strip_prefix('[') {
        return rest.split(']').next().filter(|h| !h.is_empty());
    }
    // A hostname or IPv4 literal never contains a colon outside the
    // bracketed-IPv6 case above, so splitting on ':' is safe here.
    host_and_port.split(':').next().filter(|h| !h.is_empty())
}

/// Extracts the port from a `https://host[:port][/path]` URL,
/// defaulting to 443 (curl's own default). Used only for the
/// `curl --resolve host:port:ip` pin.
pub fn extract_port(endpoint: &str) -> u16 {
    const DEFAULT_HTTPS_PORT: u16 = 443;
    let Some(after_scheme) = endpoint.strip_prefix("https://") else {
        return DEFAULT_HTTPS_PORT;
    };
    let host_and_port = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    // A userinfo value containing its own colon would otherwise make
    // the plain split below find that colon instead of the host:port
    // separator, deriving the wrong port and building a pin for a port
    // curl never connects to -- reopening the rebinding TOCTOU
    // `build_resolve_arg` exists to close.
    let host_and_port = strip_userinfo(host_and_port);
    let port_str = if let Some(rest) = host_and_port.strip_prefix('[') {
        match rest.split_once(']') {
            Some((_, after)) => after.strip_prefix(':').unwrap_or(""),
            None => "",
        }
    } else {
        match host_and_port.split_once(':') {
            Some((_, port)) => port,
            None => "",
        }
    };
    port_str.parse().unwrap_or(DEFAULT_HTTPS_PORT)
}

/// Builds the `host:port:address` triple `curl --resolve` expects,
/// pinning curl to the address `decide_pin` already validated instead
/// of letting curl resolve independently later (the rebinding TOCTOU
/// this pin closes). An IPv6 address is bracketed, as `--resolve`
/// requires to disambiguate its colons from the field separators.
pub fn build_resolve_arg(host: &str, port: u16, pinned_ip: IpAddr) -> String {
    let ip_str = match pinned_ip {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => format!("[{v6}]"),
    };
    format!("{host}:{port}:{ip_str}")
}

/// Materializes `contents` as `script_name` inside `dir`, executable.
/// Self-healing on a deleted or stale copy. `cli/konductor-rs` and
/// `mcp/lib/skill-lookup-core` both embed
/// `scripts/konductor-telemetry-report.sh` via their own
/// `include_str!` under different names, so this crate takes all
/// three as caller-owned rather than hardcoding one.
pub fn materialize_script(
    dir: &Path,
    script_name: &str,
    contents: &str,
) -> std::io::Result<PathBuf> {
    let path = dir.join(script_name);
    write_verified(&path, contents)?;
    set_executable(&path)?;
    Ok(path)
}

/// `$HOME/.konductor/tmp`, created `0o700` -- never the shared,
/// world-writable `std::env::temp_dir()` directly. Falls back to a
/// per-uid subdirectory when `HOME` is unset or empty (sandboxed CI):
/// an empty value is not a valid anchor, and joining onto it would
/// otherwise build a path relative to the process's current directory
/// instead of refusing outright.
pub fn private_script_dir() -> std::io::Result<PathBuf> {
    let dir = match std::env::var_os("HOME").filter(|home| !home.is_empty()) {
        Some(home) => PathBuf::from(home).join(".konductor").join("tmp"),
        None => std::env::temp_dir().join(format!("konductor-tmp-{}", current_uid())),
    };
    create_private_dir_all(&dir)?;
    Ok(dir)
}

/// Writes `contents` to `path` only if no byte-identical copy exists
/// already, via `O_NOFOLLOW` to close the TOCTOU window between this
/// write and `spawn_and_send`'s later exec.
#[cfg(unix)]
fn write_verified(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::OpenOptionsExt;

    if let Ok(existing) = std::fs::read_to_string(path) {
        if existing == contents {
            return verify_regular_file(path);
        }
    }

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .custom_flags(O_NOFOLLOW)
        .open(path)?;
    file.write_all(contents.as_bytes())?;
    drop(file);
    verify_regular_file(path)
}

#[cfg(not(unix))]
fn write_verified(path: &Path, contents: &str) -> std::io::Result<()> {
    std::fs::write(path, contents)
}

/// `O_NOFOLLOW` isn't a single value across platforms: Linux/Android/
/// illumos/Solaris use `0o400_000` (`0x20000`); macOS and the BSDs use
/// `0o400` (`0x100`).
#[cfg(any(
    target_os = "linux",
    target_os = "android",
    target_os = "illumos",
    target_os = "solaris"
))]
const O_NOFOLLOW: i32 = 0o400_000;
#[cfg(all(
    unix,
    not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "illumos",
        target_os = "solaris"
    ))
))]
const O_NOFOLLOW: i32 = 0o400;

/// Rejects anything that isn't a regular file, the last check before
/// this path is handed to `spawn()`. Uses `symlink_metadata`, never
/// `metadata`, so a symlink swapped in after the `O_NOFOLLOW` open
/// above is detected rather than followed.
#[cfg(unix)]
fn verify_regular_file(path: &Path) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "materialized script path is not a regular file",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn set_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_host_parses_ordinary_hostname_with_and_without_port_and_path() {
        assert_eq!(
            extract_host("https://example.com/konductor-telemetry"),
            Some("example.com")
        );
        assert_eq!(
            extract_host("https://example.com:8443/x"),
            Some("example.com")
        );
        assert_eq!(extract_host("https://example.com"), Some("example.com"));
    }

    #[test]
    fn extract_host_parses_ipv4_and_bracketed_ipv6() {
        assert_eq!(extract_host("https://127.0.0.1/x"), Some("127.0.0.1"));
        assert_eq!(extract_host("https://127.0.0.1:9999/x"), Some("127.0.0.1"));
        assert_eq!(extract_host("https://[::1]/x"), Some("::1"));
        assert_eq!(extract_host("https://[::1]:9999/x"), Some("::1"));
    }

    #[test]
    fn extract_host_returns_none_for_non_https_or_hostless_input() {
        assert_eq!(extract_host("http://example.com"), None);
        assert_eq!(extract_host("not-a-url-at-all"), None);
        assert_eq!(extract_host("https://"), None);
    }

    /// AutoSDE `f-2133c92b`: `extract_host` must strip userinfo before
    /// parsing, or `https://x@127.0.0.1/collector` classifies as the
    /// allowed hostname `"x@127.0.0.1"` while curl connects straight
    /// to `127.0.0.1` -- a bypass via nothing more than a username.
    #[test]
    fn extract_host_strips_userinfo_before_parsing_host() {
        assert_eq!(
            extract_host("https://x@127.0.0.1/collector"),
            Some("127.0.0.1")
        );
        assert_eq!(
            extract_host("https://user:pass@example.com:8443/x"),
            Some("example.com")
        );
        assert_eq!(extract_host("https://x@[::1]:443/collector"), Some("::1"));
    }

    #[test]
    fn extract_host_strips_userinfo_up_to_the_last_at_sign() {
        assert_eq!(extract_host("https://a@b@127.0.0.1/x"), Some("127.0.0.1"));
    }

    #[test]
    fn extract_host_returns_none_when_userinfo_leaves_nothing_after_the_at_sign() {
        assert_eq!(extract_host("https://x@/collector"), None);
    }

    #[test]
    fn is_disallowed_local_host_via_extract_host_catches_the_userinfo_bypass() {
        let host = extract_host("https://x@127.0.0.1/collector").expect("host must parse");
        assert!(
            is_disallowed_local_host(host),
            "the userinfo-stripped host must classify as loopback, closing the bypass"
        );
    }

    #[test]
    fn extract_port_defaults_to_443_when_unspecified() {
        assert_eq!(extract_port("https://example.com/x"), 443);
        assert_eq!(extract_port("https://[::1]/x"), 443);
    }

    /// Guards every test in this module that mutates the process-wide
    /// `HOME` env var, so `cargo test`'s default thread-parallel
    /// execution can't interleave two tests' `HOME` values.
    static HOME_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// AutoSDE `f-f661b9d5`: an empty `HOME` must take the same
    /// temp-dir fallback as an unset one. Before the `.filter`, `Some`
    /// still matched on `""`, so `private_script_dir` built the
    /// cwd-relative path `.konductor/tmp` instead of refusing to
    /// anchor on empty input.
    #[test]
    fn private_script_dir_falls_back_to_temp_dir_when_home_is_empty() {
        let _guard = HOME_ENV_LOCK.lock().unwrap();
        let original_home = std::env::var_os("HOME");

        // SAFETY: held under `HOME_ENV_LOCK` for this test's entire
        // body; restored before the lock releases below.
        unsafe {
            std::env::set_var("HOME", "");
        }

        let result = private_script_dir();

        // SAFETY: see above.
        unsafe {
            match &original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }

        let dir = result.expect("temp-dir fallback must succeed even with HOME empty");
        assert!(
            dir.starts_with(std::env::temp_dir()),
            "empty HOME must resolve under temp_dir(), not a path relative to cwd: {dir:?}"
        );
        assert!(
            !dir.starts_with(".konductor"),
            "empty HOME must never build the cwd-relative `.konductor/tmp` path: {dir:?}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extract_port_parses_an_explicit_port() {
        assert_eq!(extract_port("https://example.com:8443/x"), 8443);
        assert_eq!(extract_port("https://[::1]:9999/x"), 9999);
    }

    #[test]
    fn extract_port_strips_userinfo_before_parsing_port() {
        assert_eq!(extract_port("https://user:pass@example.com:8443/x"), 8443);
        assert_eq!(extract_port("https://x@[::1]:9999/x"), 9999);
    }

    #[test]
    fn build_resolve_arg_formats_ipv4_without_brackets() {
        use std::net::Ipv4Addr;
        let ip = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));
        assert_eq!(
            build_resolve_arg("example.com", 443, ip),
            "example.com:443:192.0.2.1"
        );
    }

    #[test]
    fn build_resolve_arg_brackets_ipv6() {
        use std::net::Ipv6Addr;
        let ip = IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1));
        assert_eq!(
            build_resolve_arg("example.com", 8443, ip),
            "example.com:8443:[2001:db8::1]"
        );
    }

    #[test]
    fn is_disallowed_local_host_rejects_loopback_link_local_and_private_ranges() {
        assert!(is_disallowed_local_host("127.0.0.1"));
        assert!(is_disallowed_local_host("::1"));
        assert!(is_disallowed_local_host("localhost"));
        assert!(is_disallowed_local_host("LOCALHOST"));
        assert!(is_disallowed_local_host("169.254.1.1"));
        assert!(is_disallowed_local_host("fe80::1"));
        assert!(is_disallowed_local_host("10.0.0.1"));
        assert!(is_disallowed_local_host("172.16.0.1"));
        assert!(is_disallowed_local_host("192.168.1.1"));
    }

    /// AutoSDE `f-83540965`: `fc00::/7` (unique-local) must be
    /// rejected, exercised across the full `fc00`-`fdff` range.
    #[test]
    fn is_disallowed_local_host_rejects_ipv6_unique_local_fc00_slash_7() {
        assert!(is_disallowed_local_host("fc00::1"));
        assert!(is_disallowed_local_host("fcff::1"));
        assert!(is_disallowed_local_host("fd00::1"));
        assert!(is_disallowed_local_host("fdff::1"));
        assert!(is_disallowed_local_host("fc12::1"));
        assert!(is_disallowed_local_host("fd34::1"));
    }

    #[test]
    fn is_disallowed_local_host_accepts_addresses_just_outside_fc00_slash_7() {
        assert!(!is_disallowed_local_host("fbff::1"));
        // fe00:: is not within fe80::/10 either -- deprecated IPv6
        // site-local, correctly left allowed.
        assert!(!is_disallowed_local_host("fe00::1"));
    }

    /// AutoSDE `f-02064b4b`: the unspecified address (`0.0.0.0`/`::`)
    /// must be rejected -- no `is_loopback`/`is_link_local`/
    /// `is_private` check catches it, and on Linux a connection to
    /// `0.0.0.0` routes to a local service on loopback.
    #[test]
    fn is_disallowed_local_host_rejects_unspecified_addresses() {
        assert!(is_disallowed_local_host("0.0.0.0"));
        assert!(is_disallowed_local_host("::"));
    }

    #[test]
    fn is_disallowed_ip_rejects_unspecified_ipv4_and_ipv6() {
        use std::net::Ipv4Addr;
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0))));
        assert!(is_disallowed_ip(IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0, 0, 0
        ))));
    }

    #[test]
    fn is_disallowed_local_host_unmaps_ipv4_compatible_ipv6_before_classifying() {
        assert!(is_disallowed_local_host("::10.0.0.1"));
    }

    /// A naive `Ipv6Addr::to_ipv4()`-based fix would misclassify `::1`
    /// as the non-loopback address `0.0.0.1`; both `::` and `::1` must
    /// keep resolving via their own unspecified/loopback checks.
    #[test]
    fn is_disallowed_local_host_still_correctly_classifies_unspecified_and_loopback_ipv6() {
        assert!(is_disallowed_local_host("::"));
        assert!(is_disallowed_local_host("::1"));
    }

    #[test]
    fn is_disallowed_local_host_accepts_a_genuine_public_ipv4_compatible_address() {
        assert!(!is_disallowed_local_host("::93.184.216.34"));
    }

    #[test]
    fn ipv4_compatible_excludes_unspecified_and_loopback_but_extracts_other_addresses() {
        assert_eq!(ipv4_compatible(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 0)), None);
        assert_eq!(ipv4_compatible(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 1)), None);
        assert_eq!(
            ipv4_compatible(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0x0a00, 0x0001)),
            Some(Ipv4Addr::new(10, 0, 0, 1))
        );
    }

    #[test]
    fn is_disallowed_ip_unmaps_ipv4_compatible_ipv6_regardless_of_caller() {
        assert!(is_disallowed_ip(IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0, 0x0a00, 0x0001
        ))));
        assert!(!is_disallowed_ip(IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0, 0x5db8, 0xd822
        ))));
        assert!(is_disallowed_ip(IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0, 0, 0
        ))));
        assert!(is_disallowed_ip(IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0, 0, 1
        ))));
    }

    // ── RFC 6598 Shared Address Space / CGNAT (100.64.0.0/10) ────────

    #[test]
    fn is_disallowed_ip_rejects_ipv4_shared_address_space_cgnat() {
        use std::net::Ipv4Addr;
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))));
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(
            100, 127, 255, 255
        ))));
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(100, 100, 1, 1))));
    }

    #[test]
    fn is_disallowed_ip_accepts_addresses_just_outside_the_cgnat_slash_10() {
        use std::net::Ipv4Addr;
        assert!(!is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(
            100, 63, 255, 255
        ))));
        assert!(!is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(100, 128, 0, 0))));
    }

    // ── 6to4 (2002::/16, RFC 3056) ────────────────────────────────────

    #[test]
    fn six_to_four_embedded_ipv4_extracts_bits_16_to_48() {
        // 2002:6440:0001:: embeds 100.64.0.1.
        let v6 = Ipv6Addr::new(0x2002, 0x6440, 0x0001, 0, 0, 0, 0, 0);
        assert_eq!(
            six_to_four_embedded_ipv4(v6),
            Some(Ipv4Addr::new(100, 64, 0, 1))
        );
    }

    #[test]
    fn six_to_four_embedded_ipv4_returns_none_for_a_non_6to4_prefix() {
        assert_eq!(
            six_to_four_embedded_ipv4(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1)),
            None
        );
    }

    /// A 6to4 address can embed a non-public IPv4 range: nothing
    /// requires the embedded address to be genuinely public.
    #[test]
    fn is_disallowed_ip_unmaps_6to4_and_classifies_its_embedded_address() {
        let disallowed = Ipv6Addr::new(0x2002, 0x6440, 0x0001, 0, 0, 0, 0, 0);
        assert!(is_disallowed_ip(IpAddr::V6(disallowed)));
        let allowed = Ipv6Addr::new(0x2002, 0xc000, 0x0201, 0, 0, 0, 0, 0);
        assert!(!is_disallowed_ip(IpAddr::V6(allowed)));
    }

    // ── NAT64 Well-Known Prefix (64:ff9b::/96, RFC 6052) ─────────────

    #[test]
    fn nat64_well_known_prefix_embedded_ipv4_extracts_the_low_32_bits() {
        let v6 = Ipv6Addr::new(0x0064, 0xff9b, 0, 0, 0, 0, 0x6440, 0x0001);
        assert_eq!(
            nat64_well_known_prefix_embedded_ipv4(v6),
            Some(Ipv4Addr::new(100, 64, 0, 1))
        );
    }

    #[test]
    fn nat64_well_known_prefix_embedded_ipv4_returns_none_for_a_non_matching_prefix() {
        assert_eq!(
            nat64_well_known_prefix_embedded_ipv4(Ipv6Addr::new(
                0x0064, 0xff9c, 0, 0, 0, 0, 0x6440, 0x0001
            )),
            None
        );
    }

    #[test]
    fn is_disallowed_ip_unmaps_nat64_wkp_and_classifies_its_embedded_address() {
        let disallowed = Ipv6Addr::new(0x0064, 0xff9b, 0, 0, 0, 0, 0x6440, 0x0001);
        assert!(is_disallowed_ip(IpAddr::V6(disallowed)));
        let allowed = Ipv6Addr::new(0x0064, 0xff9b, 0, 0, 0, 0, 0xc000, 0x0201);
        assert!(!is_disallowed_ip(IpAddr::V6(allowed)));
    }

    // ── IANA special-purpose address registry checklist ──────────────
    //
    // Enumerates every entry `Ipv4Addr::is_global()`/`Ipv6Addr::is_global()`
    // checks and this crate's own decision for each, so a future review
    // finds a real gap by diffing against this list rather than
    // discovering one notation variant at a time.

    struct RegistryEntry {
        name: &'static str,
        example: &'static str,
        rejected: bool,
        reason: &'static str,
    }

    const IANA_SPECIAL_PURPOSE_REGISTRY: &[RegistryEntry] = &[
        // ── IPv4 ───────────────────────────────────────────────────
        RegistryEntry {
            name: "IPv4 unspecified (0.0.0.0/32)",
            example: "0.0.0.0",
            rejected: true,
            reason: "on Linux, a connection to 0.0.0.0 routes to a local service on loopback",
        },
        RegistryEntry {
            name: "IPv4 loopback (127.0.0.0/8)",
            example: "127.0.0.1",
            rejected: true,
            reason: "loopback -- reachable only from this same host",
        },
        RegistryEntry {
            name: "IPv4 link-local (169.254.0.0/16)",
            example: "169.254.1.1",
            rejected: true,
            reason: "link-local -- reachable only on this host's own local link",
        },
        RegistryEntry {
            name: "IPv4 private, RFC 1918 (10.0.0.0/8)",
            example: "10.0.0.1",
            rejected: true,
            reason: "RFC 1918 private range",
        },
        RegistryEntry {
            name: "IPv4 private, RFC 1918 (172.16.0.0/12)",
            example: "172.16.0.1",
            rejected: true,
            reason: "RFC 1918 private range",
        },
        RegistryEntry {
            name: "IPv4 private, RFC 1918 (192.168.0.0/16)",
            example: "192.168.1.1",
            rejected: true,
            reason: "RFC 1918 private range",
        },
        RegistryEntry {
            name: "IPv4 Shared Address Space / CGNAT, RFC 6598 (100.64.0.0/10)",
            example: "100.64.0.1",
            rejected: true,
            reason: "carrier-grade-NAT space, reachable only from within the ISP's own network",
        },
        RegistryEntry {
            name: "IPv4 TEST-NET-1, RFC 5737 (192.0.2.0/24)",
            example: "192.0.2.1",
            rejected: false,
            reason: "documentation-only range, never routed on the public Internet; low \
                      security relevance for this SSRF-style threat model",
        },
        RegistryEntry {
            name: "IPv4 TEST-NET-2, RFC 5737 (198.51.100.0/24)",
            example: "198.51.100.1",
            rejected: false,
            reason: "documentation-only range, never routed; low security relevance",
        },
        RegistryEntry {
            name: "IPv4 TEST-NET-3, RFC 5737 (203.0.113.0/24)",
            example: "203.0.113.1",
            rejected: false,
            reason: "documentation-only range, never routed; low security relevance",
        },
        RegistryEntry {
            name: "IPv4 benchmarking, RFC 2544 (198.18.0.0/15)",
            example: "198.18.0.1",
            rejected: false,
            reason: "benchmarking-only range, never routed on the public Internet in practice; \
                      low security relevance",
        },
        RegistryEntry {
            name: "IPv4 reserved (240.0.0.0/4)",
            example: "240.0.0.1",
            rejected: false,
            reason: "reserved for future use, not a valid TCP connect target in practice",
        },
        RegistryEntry {
            name: "IPv4 limited broadcast (255.255.255.255/32)",
            example: "255.255.255.255",
            rejected: false,
            reason: "not a valid unicast TCP connect target; no ordinary socket can \
                      meaningfully connect to it",
        },
        // ── IPv6 ───────────────────────────────────────────────────
        RegistryEntry {
            name: "IPv6 unspecified (::/128)",
            example: "::",
            rejected: true,
            reason: "same local-service-routing risk as the IPv4 unspecified address",
        },
        RegistryEntry {
            name: "IPv6 loopback (::1/128)",
            example: "::1",
            rejected: true,
            reason: "loopback",
        },
        RegistryEntry {
            name: "IPv6 unicast link-local (fe80::/10)",
            example: "fe80::1",
            rejected: true,
            reason: "link-local",
        },
        RegistryEntry {
            name: "IPv6 unique-local, RFC 4193 (fc00::/7)",
            example: "fc00::1",
            rejected: true,
            reason: "the IPv6 analog of the IPv4 RFC 1918 private ranges",
        },
        RegistryEntry {
            name: "IPv4-mapped IPv6, RFC 4291 (::ffff:0:0/96)",
            example: "::ffff:10.0.0.1",
            rejected: true,
            reason: "unmapped and classified as its embedded IPv4 address",
        },
        RegistryEntry {
            name: "IPv4-compatible IPv6, legacy, RFC 4291 (::/96)",
            example: "::10.0.0.1",
            rejected: true,
            reason: "unmapped and classified as its embedded IPv4 address",
        },
        RegistryEntry {
            name: "6to4, RFC 3056 (2002::/16)",
            example: "2002:6440:0001::",
            rejected: true,
            reason: "unmaps bits 16-48 to the embedded IPv4 address and classifies it",
        },
        RegistryEntry {
            name: "NAT64 Well-Known Prefix, RFC 6052 (64:ff9b::/96)",
            example: "64:ff9b::6440:1",
            rejected: true,
            reason: "unmaps the low 32 bits to the embedded IPv4 address and classifies it",
        },
        RegistryEntry {
            name: "IPv6 documentation, RFC 3849 (2001:db8::/32)",
            example: "2001:db8::1",
            rejected: false,
            reason: "documentation-only range, never routed; low security relevance",
        },
        RegistryEntry {
            name: "IPv6 benchmarking, RFC 5180 (2001:2::/48)",
            example: "2001:2::1",
            rejected: false,
            reason: "benchmarking-only range, never routed in practice; low security relevance",
        },
        RegistryEntry {
            name: "Teredo, RFC 4380 (2001::/32)",
            example: "2001::1",
            rejected: false,
            reason: "known, deliberately out-of-scope gap: the embedded address is XOR-\
                      obfuscated (not a plain bit-slice like 6to4/NAT64 WKP), and the \
                      mechanism itself is largely deprecated",
        },
    ];

    #[test]
    fn iana_special_purpose_registry_matches_expected_classification() {
        for entry in IANA_SPECIAL_PURPOSE_REGISTRY {
            let actual = is_disallowed_local_host(entry.example);
            assert_eq!(
                actual, entry.rejected,
                "{} ({}): expected rejected={}, got {} -- {}",
                entry.name, entry.example, entry.rejected, actual, entry.reason
            );
        }
    }

    #[test]
    fn is_disallowed_local_host_accepts_ordinary_public_hostname_and_public_ip() {
        assert!(!is_disallowed_local_host("example.com"));
        assert!(!is_disallowed_local_host(
            "telemetry.konductor.example.invalid"
        ));
        assert!(!is_disallowed_local_host("192.0.2.1"));
    }

    #[test]
    fn is_disallowed_local_host_unmaps_ipv4_mapped_ipv6_before_classifying() {
        assert!(is_disallowed_local_host("::ffff:127.0.0.1"));
        assert!(is_disallowed_local_host("::ffff:10.0.0.1"));
        assert!(is_disallowed_local_host("::ffff:169.254.1.1"));
        assert!(!is_disallowed_local_host("::ffff:192.0.2.1"));
    }

    #[test]
    fn is_disallowed_ip_unmaps_ipv4_mapped_ipv6_regardless_of_caller() {
        use std::net::{Ipv4Addr, Ipv6Addr};
        assert!(is_disallowed_ip(IpAddr::V6(
            Ipv4Addr::new(127, 0, 0, 1).to_ipv6_mapped()
        )));
        assert!(!is_disallowed_ip(IpAddr::V6(
            Ipv4Addr::new(8, 8, 8, 8).to_ipv6_mapped()
        )));
        assert!(!is_disallowed_ip(IpAddr::V6(Ipv6Addr::new(
            0x2001, 0xdb8, 0, 0, 0, 0, 0, 1
        ))));
    }

    #[test]
    fn classify_resolved_addrs_picks_the_first_address_when_none_are_disallowed() {
        use std::net::Ipv4Addr;
        let public_a = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));
        let public_b = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 2));
        assert_eq!(
            classify_resolved_addrs(&[public_a, public_b]),
            Some(Some(public_a))
        );
    }

    #[test]
    fn classify_resolved_addrs_rejects_when_any_resolved_address_is_disallowed() {
        use std::net::Ipv4Addr;
        let public = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));
        let private = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        assert_eq!(classify_resolved_addrs(&[public, private]), None);
        assert_eq!(classify_resolved_addrs(&[private, public]), None);
    }

    // ── run_with_timeout ─────────────────────────────────────────────

    #[test]
    fn run_with_timeout_returns_the_value_when_the_closure_finishes_in_time() {
        let result = run_with_timeout(Duration::from_millis(200), || 42);
        assert_eq!(result, Some(42));
    }

    #[test]
    fn run_with_timeout_returns_none_when_the_closure_exceeds_the_bound() {
        let start = std::time::Instant::now();
        let result = run_with_timeout(Duration::from_millis(20), || {
            std::thread::sleep(Duration::from_secs(2));
            "never observed"
        });
        assert_eq!(result, None);
        assert!(
            start.elapsed() < Duration::from_secs(1),
            "run_with_timeout must return promptly at the bound, not wait for the closure; \
             took {:?}",
            start.elapsed()
        );
    }

    /// AutoSDE `f-b44a65a0`: a panicking closure must map to the same
    /// `None` a timeout produces. Unwinding drops the sender before
    /// `tx.send(f())` runs, so `recv_timeout` sees `Disconnected`,
    /// which collapses to `None` -- indistinguishable from a real
    /// `Timeout`.
    #[test]
    fn run_with_timeout_returns_none_when_the_closure_panics() {
        let result: Option<()> = run_with_timeout(Duration::from_millis(200), || {
            panic!("deliberate panic for the DnsOutcome::TimedOut regression (f-b44a65a0)");
        });
        assert_eq!(
            result, None,
            "a panicked closure must map to the same None a real timeout produces -- \
             resolve_host_addrs_bounded's `None => DnsOutcome::TimedOut` arm cannot \
             distinguish the two, so both must fail closed via decide_pin"
        );
    }

    /// Feeds a panicking closure through `resolve_host_addrs_bounded`'s
    /// own mapping (that function can't be driven with a synthetic
    /// closure directly), proving a panic resolves to `TimedOut` and is
    /// denied outright by `decide_pin`, never `Failed`'s fail-open case.
    #[test]
    fn decide_pin_denies_a_panicked_sync_resolution_the_same_as_a_timeout() {
        let outcome =
            match run_with_timeout(Duration::from_millis(200), || -> Option<Vec<IpAddr>> {
                panic!("deliberate panic for the DnsOutcome::TimedOut regression (f-b44a65a0)");
            }) {
                Some(Some(addrs)) => DnsOutcome::Resolved(addrs),
                Some(None) => DnsOutcome::Failed,
                None => DnsOutcome::TimedOut,
            };
        assert_eq!(
            outcome,
            DnsOutcome::TimedOut,
            "a panicked sync resolution must map to DnsOutcome::TimedOut, never Failed"
        );
        assert_eq!(
            decide_pin(outcome),
            None,
            "and must therefore be denied outright, not allowed unpinned"
        );
    }

    // ── resolve_host_addrs_bounded: (a) a genuine failure still fails
    // open; (b) a timeout is denied outright, never folded into (a). ──

    #[test]
    fn resolve_host_addrs_bounded_reports_failed_for_an_unresolvable_host_not_timed_out() {
        let outcome = resolve_host_addrs_bounded(
            "telemetry.konductor.example.invalid",
            Duration::from_millis(500),
        );
        assert_eq!(outcome, DnsOutcome::Failed);
    }

    /// `resolve_host_addrs_bounded` always calls the real resolver, so
    /// it can't be driven with a synthetic closure, and a real lookup
    /// can complete fast enough to beat even a near-zero bound
    /// (`recv_timeout` returns a buffered value immediately regardless
    /// of the requested wait). This exercises `run_with_timeout`
    /// directly with a synthetic sleeping closure instead, then applies
    /// the same mapping `resolve_host_addrs_bounded` uses.
    #[test]
    fn resolve_host_addrs_bounded_reports_timed_out_when_the_bound_is_exceeded() {
        let outcome = match run_with_timeout(Duration::from_millis(20), || {
            std::thread::sleep(Duration::from_secs(2));
            None::<Vec<IpAddr>>
        }) {
            Some(Some(addrs)) => DnsOutcome::Resolved(addrs),
            Some(None) => DnsOutcome::Failed,
            None => DnsOutcome::TimedOut,
        };
        assert_eq!(outcome, DnsOutcome::TimedOut);
    }

    #[test]
    fn decide_pin_fails_open_with_no_pin_for_a_genuine_resolution_failure() {
        assert_eq!(decide_pin(DnsOutcome::Failed), Some(None));
    }

    /// AutoSDE `f-9ec2e9ff`: a timeout must not be folded into the same
    /// fail-open case a genuine failure gets.
    #[test]
    fn decide_pin_denies_a_timeout_rather_than_failing_open() {
        assert_eq!(decide_pin(DnsOutcome::TimedOut), None);
    }

    #[test]
    fn decide_pin_classifies_a_resolved_outcome_normally() {
        use std::net::Ipv4Addr;
        let public = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));
        let private = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        assert_eq!(
            decide_pin(DnsOutcome::Resolved(vec![public])),
            Some(Some(public))
        );
        assert_eq!(decide_pin(DnsOutcome::Resolved(vec![private])), None);
    }

    #[cfg(feature = "async")]
    mod async_tests {
        use super::*;

        // Same Failed/TimedOut split as the sync path, through the
        // tokio path mcp/lib/skill-lookup-core actually uses.

        #[tokio::test]
        async fn resolve_host_addrs_bounded_async_reports_failed_for_an_unresolvable_host() {
            let outcome = resolve_host_addrs_bounded_async(
                "telemetry.konductor.example.invalid".to_string(),
                Duration::from_millis(500),
            )
            .await;
            assert_eq!(outcome, DnsOutcome::Failed);
        }

        /// `tokio::time::timeout` polls the inner future first and only
        /// consults the timer if it's still pending, so a real lookup
        /// can beat even a near-zero bound. Exercises
        /// `run_with_timeout_async` directly with a synthetic sleeping
        /// closure instead.
        #[tokio::test]
        async fn run_with_timeout_async_returns_timed_out_when_the_closure_exceeds_the_bound() {
            let start = std::time::Instant::now();
            let result = run_with_timeout_async(Duration::from_millis(20), || {
                std::thread::sleep(Duration::from_secs(2));
                "never observed"
            })
            .await;
            assert_eq!(result, Err(AsyncBoundError::TimedOut));
            assert!(
                start.elapsed() < Duration::from_secs(1),
                "run_with_timeout_async must return promptly at the bound, not wait for the \
                 closure; took {:?}",
                start.elapsed()
            );
        }

        #[tokio::test]
        async fn resolve_host_addrs_bounded_async_maps_a_synthetic_timeout_to_timed_out() {
            let outcome = match run_with_timeout_async(Duration::from_millis(20), || {
                std::thread::sleep(Duration::from_secs(2));
                Some(vec![])
            })
            .await
            {
                Ok(Some(addrs)) => DnsOutcome::Resolved(addrs),
                Ok(None) => DnsOutcome::Failed,
                Err(AsyncBoundError::Panicked) => DnsOutcome::TimedOut,
                Err(AsyncBoundError::TimedOut) => DnsOutcome::TimedOut,
            };
            assert_eq!(outcome, DnsOutcome::TimedOut);
        }

        /// AutoSDE `f-b44a65a0`: the async path's more granular
        /// `JoinError` signal must not let it diverge from the sync
        /// path's verdict.
        ///
        /// The bound is deliberately generous (seconds) even though the
        /// closure panics immediately: this asserts on which `Err`
        /// variant comes back, not on speed, so the wide bound costs
        /// nothing in the success path and leaves headroom under
        /// coverage instrumentation. A narrow bound would risk the
        /// timeout elapsing before the panic's `JoinError` arrives,
        /// misreporting slow instrumentation as a broken distinction.
        #[tokio::test]
        async fn run_with_timeout_async_returns_panicked_when_the_closure_panics() {
            let result: Result<(), AsyncBoundError> =
                run_with_timeout_async(Duration::from_secs(5), || {
                    panic!("deliberate panic for the DnsOutcome::TimedOut regression");
                })
                .await;
            assert_eq!(result, Err(AsyncBoundError::Panicked));
        }

        /// The CRITICAL regression this fix closes: a panic must map to
        /// `TimedOut`, not `Failed` -- previously `Panicked` mapped to
        /// `Failed`, which `decide_pin` treats as fail-open, the
        /// opposite of the sync path's already fail-closed panic
        /// handling.
        #[tokio::test]
        async fn resolve_host_addrs_bounded_async_maps_a_panic_to_timed_out_not_failed() {
            let outcome = match run_with_timeout_async(
                Duration::from_millis(200),
                || -> Option<Vec<IpAddr>> {
                    panic!("deliberate panic for the DnsOutcome::TimedOut regression (f-b44a65a0)");
                },
            )
            .await
            {
                Ok(Some(addrs)) => DnsOutcome::Resolved(addrs),
                Ok(None) => DnsOutcome::Failed,
                Err(AsyncBoundError::Panicked) => DnsOutcome::TimedOut,
                Err(AsyncBoundError::TimedOut) => DnsOutcome::TimedOut,
            };
            assert_eq!(
                outcome,
                DnsOutcome::TimedOut,
                "a panicked async resolution must map to DnsOutcome::TimedOut, not Failed -- \
                 the exact CRITICAL fail-open divergence this fix addresses \
                 (AutoSDE finding f-b44a65a0)"
            );
            assert_eq!(
                decide_pin(outcome),
                None,
                "and must therefore be denied outright via decide_pin, matching the sync \
                 path's already fail-closed treatment of a panic"
            );
        }

        #[tokio::test]
        async fn resolve_host_addrs_bounded_async_resolves_within_the_bound() {
            let outcome =
                resolve_host_addrs_bounded_async("localhost".to_string(), Duration::from_secs(2))
                    .await;
            match outcome {
                DnsOutcome::Resolved(_) => {}
                other => panic!("expected Resolved for \"localhost\", got {other:?}"),
            }
        }
    }
}
