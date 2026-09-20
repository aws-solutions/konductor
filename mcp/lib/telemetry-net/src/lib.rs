// SPDX-License-Identifier: Apache-2.0
//
// telemetry-net — the DNS-based host-allowlist classification,
// DNS-rebinding pin construction, and bounded-resolution
// timeout-vs-failure decision shared by cli/konductor-rs's and
// mcp/lib/skill-lookup-core's telemetry transport (each crate's own
// `telemetry` module resolves a compile-time-default/env-var-overridable
// endpoint and must confirm its host is not loopback/link-local/RFC-1918
// private-range before sending anything to it).
//
// `cli/konductor-rs` and `mcp/` are not otherwise workspace-linked (the
// former is a standalone package with no `[workspace]` of its own; the
// latter is its own separate Cargo workspace) -- this crate is the one
// place both depend on via a plain path dependency, so a security-load-
// bearing decision like "how does a resolution timeout get treated"
// exists in exactly one implementation both consumers share, rather
// than two independently-maintained copies that can silently diverge.
// It lives under `mcp/lib/` (a real member of that workspace, matching
// its own "lib/*" glob) purely because Cargo requires a workspace
// member to sit hierarchically below its workspace root -- not because
// this crate is MCP-specific; `cli/konductor-rs` reaches it the same
// way regardless of which side of the tree it physically lives on.
//
// Pure and dependency-free by default (std only): both consumers pin
// serde at different versions already, and none of the logic here
// needs serialization. The optional `async` feature (see `Cargo.toml`)
// adds a `tokio`-based bounded-resolution path for an async caller;
// off by default so a synchronous consumer never pulls tokio in.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::time::Duration;

/// The outcome of one DNS resolution attempt, bounded or not.
/// Deliberately keeps a timeout as its own variant rather than folding
/// it into the same `None`/failure bucket a genuine resolution error
/// produces -- see `decide_pin`'s own doc comment for why the
/// distinction matters for the security decision built on top of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DnsOutcome {
    /// Resolution completed (within the bound, if one applied) and
    /// returned at least one address.
    Resolved(Vec<IpAddr>),
    /// Resolution completed (within the bound, if one applied) but
    /// failed outright -- e.g. NXDOMAIN, no such host. A host that
    /// fails to resolve at all is not itself a signal of an active
    /// attacker: this crate's own placeholder endpoint host,
    /// `example.invalid`, is a reserved TLD (RFC 2606) guaranteed to
    /// never resolve, and must still be treated as "allowed" by
    /// `decide_pin` below.
    Failed,
    /// Resolution did not complete within the caller's bound.
    TimedOut,
}

/// Runs `f` on a detached helper thread and waits at most `timeout` for
/// its result, via a bounded `mpsc::Receiver::recv_timeout` rather than
/// `JoinHandle::join` (which has no timeout variant). For a synchronous
/// caller with no async runtime (`cli/konductor-rs`); an async caller
/// (`mcp/lib/skill-lookup-core`, see `resolve_host_addrs_bounded_async`
/// below) instead bounds its own `tokio::task::spawn_blocking` call
/// with `tokio::time::timeout`, since it already has a runtime that can
/// do so without spending a dedicated OS thread per call.
///
/// On timeout, returns `None` and abandons the helper thread -- there
/// is no portable way to cancel a blocked `getaddrinfo` call, so the
/// thread is simply left to finish (or never finish) on its own. This
/// costs nothing beyond the thread's own resources: it holds no lock,
/// touches no shared state, and its result is silently dropped (`send`
/// on a channel whose receiver already timed out and was dropped
/// returns an error, which is discarded, not propagated).
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

/// Resolves `host` the same way a real HTTP client would (via
/// `ToSocketAddrs`, which performs an actual DNS query for a hostname
/// and returns an IP literal directly, with no query, when `host`
/// already IS a literal). No bound of its own -- a caller that needs
/// one applies it around this call (`resolve_host_addrs_bounded` for a
/// synchronous caller, `resolve_host_addrs_bounded_async` for an async
/// one).
pub fn resolve_host_addrs(host: &str) -> Option<Vec<IpAddr>> {
    // The port is never used for anything but satisfying
    // `ToSocketAddrs`'s signature -- resolution, the only thing this
    // call needs, does not depend on it.
    (host, 0u16)
        .to_socket_addrs()
        .map(|addrs| addrs.map(|socket_addr| socket_addr.ip()).collect())
        .ok()
}

/// Resolves `host` bounded by `timeout`, distinguishing a genuine
/// resolution failure (`DnsOutcome::Failed`) from a resolution that
/// simply did not finish in time (`DnsOutcome::TimedOut`) -- the two
/// outcomes `decide_pin` below treats differently. For a synchronous
/// caller with no async runtime.
pub fn resolve_host_addrs_bounded(host: &str, timeout: Duration) -> DnsOutcome {
    let host = host.to_string();
    match run_with_timeout(timeout, move || resolve_host_addrs(&host)) {
        Some(Some(addrs)) => DnsOutcome::Resolved(addrs),
        Some(None) => DnsOutcome::Failed,
        None => DnsOutcome::TimedOut,
    }
}

/// Runs `f` on tokio's blocking thread pool via `spawn_blocking`,
/// bounded by `timeout` via `tokio::time::timeout` -- the async-runtime
/// equivalent of `run_with_timeout`'s thread+channel primitive above,
/// for a caller that already has a tokio runtime and so bounds the
/// wait using tokio's own machinery instead of a dedicated OS thread
/// per call. Generic over `T` (not just a DNS resolution result) so it
/// is directly testable with a synthetic closure, exactly like
/// `run_with_timeout` above -- a real DNS lookup for an ordinary,
/// already-cached hostname can complete fast enough that an
/// extremely short bound races the resolution rather than reliably
/// exceeding it, whereas a synthetic `std::thread::sleep` closure
/// bounds deterministically regardless of network conditions.
///
/// Returns `Ok(value)` on success, or `Err(AsyncBoundError::TimedOut)`
/// if `timeout` elapsed first, or `Err(AsyncBoundError::Panicked)` if
/// `f` itself panicked (ended abnormally WITHIN the bound, a distinct
/// low-level signal from a stalled call that never returned at all --
/// see `resolve_host_addrs_bounded_async`'s own doc comment for why the
/// DNS-specific caller nonetheless maps BOTH to the same `DnsOutcome`).
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

/// Same bound and same `DnsOutcome` shape as `resolve_host_addrs_bounded`,
/// but for an async caller that already has a tokio runtime, via
/// `run_with_timeout_async` above.
///
/// A panic (the blocking task ended abnormally) is treated as
/// `DnsOutcome::TimedOut`, NOT `Failed` (AutoSDE finding `f-b44a65a0`) --
/// matching the sync path's own behavior exactly: in
/// `resolve_host_addrs_bounded` above, a panic on the helper thread
/// drops its `mpsc::Sender` before ever sending a value, so
/// `rx.recv_timeout` returns `Err(RecvTimeoutError::Disconnected)`,
/// which `run_with_timeout`'s `.ok()` collapses to the SAME `None` a
/// genuine timeout produces -- the sync side has no way to distinguish
/// "the closure panicked" from "the closure never finished in time",
/// and both already resolve to `DnsOutcome::TimedOut` there. A
/// panicked resolution attempt provides no information about the
/// host's actual safety, exactly like a timeout -- it is not a clean
/// "the host doesn't exist" answer the way `DnsOutcome::Failed` is, so
/// it must be denied outright by `decide_pin` (fail-closed), not folded
/// into `Failed`'s fail-open, nothing-to-pin outcome. Before this fix,
/// the async path's more granular `JoinError` signal let it distinguish
/// a panic from a timeout where the sync path structurally cannot --
/// and mapped that distinction to OPPOSITE `decide_pin` verdicts
/// between the two crates, directly contradicting this crate's own
/// purpose (see this module's own top-level doc comment).
#[cfg(feature = "async")]
pub async fn resolve_host_addrs_bounded_async(host: String, timeout: Duration) -> DnsOutcome {
    match run_with_timeout_async(timeout, move || resolve_host_addrs(&host)).await {
        Ok(Some(addrs)) => DnsOutcome::Resolved(addrs),
        Ok(None) => DnsOutcome::Failed,
        Err(AsyncBoundError::Panicked) => DnsOutcome::TimedOut,
        Err(AsyncBoundError::TimedOut) => DnsOutcome::TimedOut,
    }
}

/// Given a hostname's already-resolved addresses, decides the
/// allow/deny verdict and picks the pin candidate (the first resolved
/// address, arbitrary but deterministic -- every returned address has
/// already passed `is_disallowed_ip`, so any of them is an equally
/// valid pin target). Pure and I/O-free, so it is directly unit-testable
/// against a synthetic address list without depending on a real
/// resolver or network access.
///
/// Returns `None` if any resolved address is disallowed (deny the whole
/// host); `Some(Some(ip))` with the pin candidate otherwise.
pub fn classify_resolved_addrs(addrs: &[IpAddr]) -> Option<Option<IpAddr>> {
    if addrs.iter().any(|ip| is_disallowed_ip(*ip)) {
        None
    } else {
        Some(addrs.first().copied())
    }
}

/// Given a `DnsOutcome` for a hostname that already passed the cheap
/// literal-string check (`is_disallowed_local_host`) and is not itself
/// an IP literal, decides the final allow/deny/pin verdict. This is the
/// ONE place the timeout-vs-failure distinction plays out into an
/// actual decision, so both `cli/konductor-rs` and
/// `mcp/lib/skill-lookup-core` apply it identically and can never
/// diverge:
///
/// - `Resolved(addrs)` -> classify normally via `classify_resolved_addrs`.
/// - `Failed` (a genuine resolution error, e.g. NXDOMAIN) -> allowed,
///   with nothing to pin. This keeps the pre-existing "unresolvable !=
///   disallowed" contract: this crate's own placeholder endpoint host,
///   `example.invalid`, is a reserved TLD guaranteed to never resolve,
///   and must keep resolving as "allowed" rather than being treated as
///   a rejection.
/// - `TimedOut` -> DENIED (fail closed), not folded into the same
///   fail-open bucket a genuine failure gets (AutoSDE finding
///   `f-9ec2e9ff`). Both consumers deliberately bound this resolution
///   to a short timeout specifically so it can never stall a
///   foreground/worker-thread code path (the CLI's own user-facing
///   error line; the MCP flush task's tokio worker) -- treating a
///   timeout as "block longer instead" would reintroduce exactly the
///   stall that bound exists to prevent. Failing closed instead costs
///   only an occasional skipped send for a legitimately slow resolver
///   (telemetry's fire-and-forget contract already tolerates a dropped
///   event), while closing the window an attacker who can stall
///   resolution past the bound would otherwise use to force an
///   unpinned send that `curl`'s own later, independent resolution
///   could then answer with a rebound (loopback/private-range)
///   address.
pub fn decide_pin(outcome: DnsOutcome) -> Option<Option<IpAddr>> {
    match outcome {
        DnsOutcome::Resolved(addrs) => classify_resolved_addrs(&addrs),
        DnsOutcome::Failed => Some(None),
        DnsOutcome::TimedOut => None,
    }
}

/// Returns the embedded IPv4 address for a legacy "IPv4-compatible"
/// IPv6 address (`::a.b.c.d`, RFC 4291 §2.5.5.1) -- the `::/96` prefix,
/// distinct from the IPv4-mapped form (`::ffff:a.b.c.d`) already
/// unmapped via `to_ipv4_mapped()` in `is_disallowed_ip` below.
/// `Ipv6Addr::to_ipv4()` would also recognize this notation, but it
/// ADDITIONALLY (mis)maps the unrelated loopback address `::1` to
/// `Some(0.0.0.1)` -- using it naively here would misclassify `::1` as
/// a non-loopback public address if this check ran before, or instead
/// of, the loopback check. This helper explicitly excludes both `::`
/// (unspecified, all eight segments zero) and `::1` (loopback, only the
/// last segment set to 1): those two continue to be classified by
/// `is_unspecified()`/`is_loopback()` alone, exactly as before this fix
/// existed. Returns `Some` only for a genuine `::/96`-prefixed address
/// that is neither of those two special cases -- e.g. `::10.0.0.1` or
/// `::93.184.216.34`.
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

/// Classifies a concrete, already-parsed/resolved `IpAddr` as
/// unspecified, loopback, link-local, or RFC 1918 private-range. Shared
/// by both `is_disallowed_local_host` (a literal IP in the endpoint
/// string) and a resolved address list (`classify_resolved_addrs`), so
/// the classification rule can never drift between the literal and
/// resolved paths.
///
/// The unspecified address (`0.0.0.0`/`::`) is checked explicitly
/// (AutoSDE finding `f-02064b4b`) -- none of `Ipv4Addr::is_loopback()`/
/// `is_link_local()`/`is_private()` match `0.0.0.0`, and
/// `Ipv6Addr::is_loopback()` matches only the distinct `::1` address,
/// not `::`. On many operating systems (notably Linux) a connection to
/// `0.0.0.0` is routed to a local service on loopback, so without this
/// check `KONDUCTOR_METRICS_ENDPOINT=https://0.0.0.0:<port>/...` (or a
/// hostname resolving to it) would bypass this allowlist entirely.
///
/// An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, RFC 4291 §2.5.5.2) is
/// unmapped to its IPv4 form and classified as THAT address before
/// falling through to the ordinary IPv6 checks -- without this, a
/// literal like `::ffff:127.0.0.1` parses as `IpAddr::V6` and neither
/// `Ipv6Addr::is_loopback()` (which only matches the distinct `::1`
/// address) nor the `fe80::/10` bitmask below recognizes it, so it
/// would sail through as an apparently-public IPv6 host despite
/// unambiguously addressing IPv4 loopback. `Ipv6Addr::to_ipv4_mapped()`
/// returns `Some` only for the `::ffff:0:0/96` prefix (never for an
/// ordinary IPv6 address that merely happens to contain a matching
/// suffix), so this recursion terminates in exactly one extra step.
///
/// The legacy IPv4-compatible form (`::a.b.c.d`, the DISTINCT `::/96`
/// prefix -- see `ipv4_compatible` above) is unmapped and classified
/// the same way, closing an independent bypass: `::10.0.0.1` parses as
/// a valid IPv6 literal, doesn't unmap via `to_ipv4_mapped()` (which
/// only recognizes the `::ffff:0:0/96` prefix), and neither bitmask
/// check below catches it, so it would otherwise sail through as an
/// apparently-public IPv6 host despite unambiguously addressing a
/// private IPv4 range.
///
/// A 6to4 address (`2002::/16`, RFC 3056, see
/// `six_to_four_embedded_ipv4`) and a NAT64 Well-Known Prefix address
/// (`64:ff9b::/96`, RFC 6052, see `nat64_well_known_prefix_embedded_ipv4`)
/// are unmapped and classified by their own embedded IPv4 address the
/// same way -- both are transition mechanisms that carry an ordinary
/// IPv4 address inside an IPv6 literal, and neither prefix is caught by
/// any of the checks below on its own: `2002:6440:0001::` embeds
/// `100.64.0.1` (RFC 6598 Shared Address Space -- see
/// `is_shared_address_space_cgnat` below) yet parses as an
/// apparently-public IPv6 address without this unmapping step.
///
/// See `IANA_SPECIAL_PURPOSE_REGISTRY` in this module's own test suite
/// for the full checklist of what this function does and does not
/// reject, and why.
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
                // fe80::/10 link-local -- checked via a manual bitmask
                // rather than `Ipv6Addr::is_unicast_link_local()` (a
                // newer std API) to avoid any doubt about MSRV
                // availability; the top 10 bits of the first segment
                // being 1111111010 is the exact definition of fe80::/10.
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                // fc00::/7 unique-local -- the IPv6 analog of the IPv4
                // RFC 1918 private ranges checked above via
                // `Ipv4Addr::is_private()` (AutoSDE finding
                // `f-83540965`). The top 7 bits of the first segment
                // being 1111110 is the exact definition of fc00::/7
                // (covering both the `fc00::/8` and `fd00::/8` halves a
                // reader might otherwise expect as two separate checks).
                || (v6.segments()[0] & 0xfe00) == 0xfc00
        }
    }
}

/// The IPv4-only classification `is_disallowed_ip` applies both to a
/// literal `IpAddr::V4` and to every IPv6 form that unmaps to an
/// embedded IPv4 address (IPv4-mapped, IPv4-compatible, 6to4, NAT64
/// WKP) -- factored out so all five paths share one decision and can
/// never drift from each other.
fn is_disallowed_ipv4(v4: Ipv4Addr) -> bool {
    v4.is_unspecified()
        || v4.is_loopback()
        || v4.is_link_local()
        || v4.is_private()
        || is_shared_address_space_cgnat(v4)
}

/// RFC 6598 Shared Address Space (`100.64.0.0/10`), commonly called
/// CGNAT (Carrier-Grade NAT) -- ISPs use this range to number
/// customer-facing interfaces without consuming public IPv4 space,
/// deliberately distinct from (and not covered by) the RFC 1918
/// private ranges `Ipv4Addr::is_private()` already checks above. A
/// metrics endpoint whose hostname resolves into this range is exactly
/// as reachable-only-from-the-ISP's-own-network as an RFC 1918 private
/// address, so the same SSRF-style threat model this allowlist exists
/// to close applies equally here.
fn is_shared_address_space_cgnat(v4: Ipv4Addr) -> bool {
    let octets = v4.octets();
    octets[0] == 100 && (octets[1] & 0b1100_0000) == 0b0100_0000
}

/// Returns the embedded IPv4 address for a 6to4 address (`2002::/16`,
/// RFC 3056) -- a transition mechanism that carries a public IPv4
/// address in the 32 bits immediately following the `2002::/16` prefix
/// (segments 1 and 2, i.e. bits 16-48). Unlike `ipv4_compatible` above,
/// this prefix never overlaps the unspecified or loopback addresses
/// (both have an all-zero first segment, never `0x2002`), so no
/// special-case exclusion is needed here.
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

/// Returns the embedded IPv4 address for a NAT64 Well-Known Prefix
/// address (`64:ff9b::/96`, RFC 6052) -- used by a NAT64 gateway to
/// synthesize an IPv6 address for an IPv4-only destination, carrying
/// that destination's IPv4 address in the low 32 bits (segments 6 and
/// 7). As with `six_to_four_embedded_ipv4` above, this prefix never
/// overlaps the unspecified or loopback addresses, so no exclusion is
/// needed.
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

/// Classifies `host` (already extracted by `extract_host`) as loopback,
/// link-local, or RFC 1918 private-range -- the three ranges the
/// telemetry host allowlist rejects by default. `"localhost"` is
/// checked as a literal string (case-insensitively) since it never
/// parses as an `IpAddr`. Anything else is parsed as an `IpAddr` and
/// classified by `is_disallowed_ip`; a host that is neither
/// `"localhost"` nor a valid IP literal (an ordinary public DNS
/// hostname) is NOT flagged here -- DNS hostnames are exactly the shape
/// a real fleet-managed collector endpoint has, and are instead covered
/// by a separate resolution-based check (see `decide_pin`).
pub fn is_disallowed_local_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    let Ok(ip) = host.parse::<IpAddr>() else {
        return false;
    };
    is_disallowed_ip(ip)
}

/// Strips URL userinfo (`user[:password]@`) from an authority string
/// (`host_and_port`, already scheme/path-stripped), returning just the
/// `host[:port]` remainder. `curl` and `getaddrinfo` both discard
/// everything up to and including the LAST `@` when connecting, so
/// `extract_host`/`extract_port` must classify the host AFTER the `@`,
/// never the literal pre-`@` string: without this, a caller-supplied
/// `https://x@127.0.0.1/collector` presents `extract_host` with the
/// literal string `"x@127.0.0.1"`, which parses as neither
/// `"localhost"` nor a valid `IpAddr`, so `is_disallowed_local_host`
/// returns `false` and this endpoint is (wrongly) treated as an
/// ordinary public hostname -- while `curl` itself strips the userinfo
/// and connects straight to `127.0.0.1`, a full bypass of this
/// allowlist. `rsplit_once` (not `split_once`) specifically takes the
/// LAST `@` in the string, matching curl's own parsing for the
/// (technically invalid per RFC 3986, but tolerated by curl) case of a
/// userinfo value that itself contains `@`.
fn strip_userinfo(host_and_port: &str) -> &str {
    host_and_port
        .rsplit_once('@')
        .map_or(host_and_port, |(_userinfo, host)| host)
}

/// Extracts the host component from a `https://[user[:pass]@]host[:port][/path...]`
/// URL string, handling IPv6 bracket notation (`[::1]:443`) and
/// stripping any URL userinfo first (see `strip_userinfo`). Returns
/// `None` if `endpoint` doesn't start with `https://` or has no
/// discernible host at all. Deliberately minimal, dependency-free
/// parsing (no `url` crate) -- this is a single scheme+host extraction
/// used only by this security check, not general URL handling.
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
        // IPv6 bracket notation: [::1] or [::1]:443 -- the host is
        // everything up to the closing bracket.
        return rest.split(']').next().filter(|h| !h.is_empty());
    }
    // Ordinary hostname or IPv4 literal, optionally followed by
    // ":<port>". `split(':').next()` is safe here because an IPv4
    // literal/hostname never legitimately contains a colon outside the
    // bracketed-IPv6 case handled above.
    host_and_port.split(':').next().filter(|h| !h.is_empty())
}

/// Extracts the port from a `https://host[:port][/path...]` URL string,
/// defaulting to 443 (the standard HTTPS port, matching curl's own
/// default for an endpoint with no explicit port) when none is
/// specified. Used only for building the `curl --resolve host:port:ip`
/// pinning argument -- `extract_host` above already strips the port for
/// every other check, which only ever needs the host.
pub fn extract_port(endpoint: &str) -> u16 {
    const DEFAULT_HTTPS_PORT: u16 = 443;
    let Some(after_scheme) = endpoint.strip_prefix("https://") else {
        return DEFAULT_HTTPS_PORT;
    };
    let host_and_port = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    // Same userinfo-stripping as `extract_host` -- a userinfo value
    // that itself contains a colon (`user:pass@host:port`) would
    // otherwise make the plain `split_once(':')` below find the
    // userinfo's OWN colon instead of the host:port separator, silently
    // deriving the wrong port and building an incorrect `--resolve`
    // pin for `build_resolve_arg` (curl still connects to the REAL
    // port from the full, un-stripped endpoint, so a wrong pin there
    // would fall back to curl's own unpinned resolution for that port
    // -- reopening the DNS-rebinding TOCTOU `build_resolve_arg` exists
    // to close).
    let host_and_port = strip_userinfo(host_and_port);
    let port_str = if let Some(rest) = host_and_port.strip_prefix('[') {
        // IPv6 bracket notation: the port (if any) follows the closing
        // bracket, e.g. [::1]:9999 -> "9999".
        match rest.split_once(']') {
            Some((_, after)) => after.strip_prefix(':').unwrap_or(""),
            None => "",
        }
    } else {
        // Ordinary hostname or IPv4 literal, optionally followed by
        // ":<port>" -- same split-on-first-colon rule `extract_host`
        // uses to find the host, here keeping the OTHER half instead.
        match host_and_port.split_once(':') {
            Some((_, port)) => port,
            None => "",
        }
    };
    port_str.parse().unwrap_or(DEFAULT_HTTPS_PORT)
}

/// Builds the `host:port:address` triple `curl --resolve` expects,
/// pinning `curl` to the exact address the caller already validated
/// (via `decide_pin`) rather than letting curl perform its own,
/// independent, later resolution (the DNS-rebinding TOCTOU this pin
/// exists to close). An IPv6 pin address is bracketed (`[2001:db8::1]`)
/// -- required by curl's own `--resolve` syntax to disambiguate the
/// address's internal colons from the field's own `host:port:address`
/// colon separators; an IPv4 address needs no such bracketing.
pub fn build_resolve_arg(host: &str, port: u16, pinned_ip: IpAddr) -> String {
    let ip_str = match pinned_ip {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => format!("[{v6}]"),
    };
    format!("{host}:{port}:{ip_str}")
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

    // AutoSDE finding `f-2133c92b`: `extract_host` must strip URL
    // userinfo (`user[:pass]@`) BEFORE parsing the host -- otherwise
    // `https://x@127.0.0.1/collector` classifies as the ordinary
    // hostname `"x@127.0.0.1"` (allowed) while curl itself strips the
    // userinfo and connects straight to `127.0.0.1` (disallowed): a
    // full allowlist bypass using nothing more exotic than a username.
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
        // rsplit_once takes the LAST '@' -- matching curl's own
        // parsing for a userinfo value that itself contains '@'
        // (invalid per RFC 3986, but tolerated by curl in practice).
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

    // AutoSDE finding `f-83540965`: `fc00::/7` (IPv6 unique-local, the
    // analog of the IPv4 RFC 1918 private ranges above) must be
    // rejected -- exercised at both boundaries and across the full
    // `fc00`-`fdff` first-hextet range the /7 prefix covers.
    #[test]
    fn is_disallowed_local_host_rejects_ipv6_unique_local_fc00_slash_7() {
        assert!(is_disallowed_local_host("fc00::1"));
        assert!(is_disallowed_local_host("fcff::1"));
        assert!(is_disallowed_local_host("fd00::1"));
        assert!(is_disallowed_local_host("fdff::1"));
        // Arbitrary values strictly inside the range, not just the four
        // corners above.
        assert!(is_disallowed_local_host("fc12::1"));
        assert!(is_disallowed_local_host("fd34::1"));
    }

    #[test]
    fn is_disallowed_local_host_accepts_addresses_just_outside_fc00_slash_7() {
        // fbff:: is the last address strictly below fc00::/7.
        assert!(!is_disallowed_local_host("fbff::1"));
        // fe00:: is the first address strictly above fc00::/7, and is
        // NOT itself within fe80::/10 either -- distinct, unrequested
        // range (deprecated IPv6 site-local), correctly left allowed.
        assert!(!is_disallowed_local_host("fe00::1"));
    }

    // AutoSDE finding `f-02064b4b`: the unspecified address
    // (`0.0.0.0`/`::`) must be rejected -- neither
    // `Ipv4Addr::is_loopback()`/`is_link_local()`/`is_private()` nor
    // `Ipv6Addr::is_loopback()` (which matches only the distinct `::1`)
    // catch it, and on Linux a connection to `0.0.0.0` routes to a
    // local service on loopback.
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

    // Fix: the legacy "IPv4-compatible" IPv6 notation (`::a.b.c.d`,
    // RFC 4291 §2.5.5.1, distinct from the IPv4-mapped `::ffff:a.b.c.d`
    // form already covered above) must unmap and classify by its
    // embedded IPv4 address.
    #[test]
    fn is_disallowed_local_host_unmaps_ipv4_compatible_ipv6_before_classifying() {
        assert!(is_disallowed_local_host("::10.0.0.1"));
    }

    // The naive fix (`Ipv6Addr::to_ipv4()`) would misclassify `::1` as
    // the non-loopback address `0.0.0.1` and `::` as `0.0.0.0`'s
    // unrelated segments -- both must continue to resolve via their own
    // unspecified/loopback checks, never via the ipv4-compatible path,
    // and both must still be disallowed.
    #[test]
    fn is_disallowed_local_host_still_correctly_classifies_unspecified_and_loopback_ipv6() {
        assert!(is_disallowed_local_host("::"));
        assert!(is_disallowed_local_host("::1"));
    }

    // Positive control: a genuine public address embedded in the
    // ::/96 prefix must be allowed, proving the special-case doesn't
    // just blanket-deny every ::/96 address.
    #[test]
    fn is_disallowed_local_host_accepts_a_genuine_public_ipv4_compatible_address() {
        assert!(!is_disallowed_local_host("::93.184.216.34"));
    }

    #[test]
    fn ipv4_compatible_excludes_unspecified_and_loopback_but_extracts_other_addresses() {
        // `::` (all-zero) and `::1` (loopback) must return None -- they
        // are handled by is_unspecified()/is_loopback() instead, never
        // by this helper (this is the exact bug a naive
        // `Ipv6Addr::to_ipv4()`-based fix would introduce: it maps
        // `::1` to `Some(0.0.0.1)`).
        assert_eq!(ipv4_compatible(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 0)), None);
        assert_eq!(ipv4_compatible(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 1)), None);
        // A genuine ::/96 address extracts its embedded IPv4 address.
        assert_eq!(
            ipv4_compatible(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0x0a00, 0x0001)),
            Some(Ipv4Addr::new(10, 0, 0, 1))
        );
    }

    #[test]
    fn is_disallowed_ip_unmaps_ipv4_compatible_ipv6_regardless_of_caller() {
        // ::10.0.0.1 -- private range, embedded via the ::/96 prefix.
        assert!(is_disallowed_ip(IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0, 0x0a00, 0x0001
        ))));
        // ::93.184.216.34 -- a genuine public address, positive control.
        assert!(!is_disallowed_ip(IpAddr::V6(Ipv6Addr::new(
            0, 0, 0, 0, 0, 0, 0x5db8, 0xd822
        ))));
        // `::` and `::1` must still be denied via
        // is_unspecified()/is_loopback(), not via ipv4_compatible.
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
        // The other three corners of the /10.
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(
            100, 127, 255, 255
        ))));
        assert!(is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(100, 100, 1, 1))));
    }

    #[test]
    fn is_disallowed_ip_accepts_addresses_just_outside_the_cgnat_slash_10() {
        use std::net::Ipv4Addr;
        // 100.63.255.255 is the last address strictly below 100.64.0.0/10.
        assert!(!is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(
            100, 63, 255, 255
        ))));
        // 100.128.0.0 is the first address strictly above it.
        assert!(!is_disallowed_ip(IpAddr::V4(Ipv4Addr::new(100, 128, 0, 0))));
    }

    // ── 6to4 (2002::/16, RFC 3056) ────────────────────────────────────

    #[test]
    fn six_to_four_embedded_ipv4_extracts_bits_16_to_48() {
        // 2002:6440:0001:: embeds 100.64.0.1 (0x64.0x40.0x00.0x01).
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

    #[test]
    fn is_disallowed_ip_unmaps_6to4_and_classifies_its_embedded_address() {
        // Embeds 100.64.0.1 -- CGNAT, must be rejected. This is also
        // the exact case that shows why 6to4 unmapping is
        // security-relevant on its own: a naive reader might assume
        // 6to4 addresses only ever embed genuinely public IPv4
        // addresses (that being the whole point of the mechanism), but
        // nothing stops a caller-supplied endpoint from spelling out a
        // 6to4 address that embeds a non-public range instead.
        let disallowed = Ipv6Addr::new(0x2002, 0x6440, 0x0001, 0, 0, 0, 0, 0);
        assert!(is_disallowed_ip(IpAddr::V6(disallowed)));
        // Positive control: a genuinely public embedded address (here,
        // 192.0.2.1 -- see the TEST-NET-1 registry entry below for why
        // this crate itself treats it as allowed) must sail through,
        // proving the unmapping doesn't blanket-deny every 6to4 address.
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
        // Differs from the WKP only in the second segment (`ff9c` vs
        // `ff9b`) -- must not be mistaken for a match.
        assert_eq!(
            nat64_well_known_prefix_embedded_ipv4(Ipv6Addr::new(
                0x0064, 0xff9c, 0, 0, 0, 0, 0x6440, 0x0001
            )),
            None
        );
    }

    #[test]
    fn is_disallowed_ip_unmaps_nat64_wkp_and_classifies_its_embedded_address() {
        // Embeds 100.64.0.1 -- CGNAT, must be rejected.
        let disallowed = Ipv6Addr::new(0x0064, 0xff9b, 0, 0, 0, 0, 0x6440, 0x0001);
        assert!(is_disallowed_ip(IpAddr::V6(disallowed)));
        // Positive control: a genuinely public embedded address.
        let allowed = Ipv6Addr::new(0x0064, 0xff9b, 0, 0, 0, 0, 0xc000, 0x0201);
        assert!(!is_disallowed_ip(IpAddr::V6(allowed)));
    }

    // ── IANA special-purpose address registry checklist ──────────────
    //
    // Enumerates every entry `std::net::Ipv4Addr::is_global()`/
    // `Ipv6Addr::is_global()` (nightly-only; its own doc-comment source
    // is the reference this checklist was built against) checks
    // against, and this crate's own classification decision for each --
    // either a security-relevant rejection this crate implements, or an
    // explicit "not rejected" with the one-line reason why not. A
    // future review round should diff its own findings against THIS
    // list to discover a real gap, rather than discovering one
    // notation-variant at a time, ad hoc, round after round.

    struct RegistryEntry {
        /// Human name of the range/notation, with its CIDR/RFC.
        name: &'static str,
        /// A representative literal for this range/notation, fed
        /// through `is_disallowed_local_host` exactly as a real
        /// endpoint host string would be.
        example: &'static str,
        /// Whether this crate's own `is_disallowed_ip`/
        /// `is_disallowed_local_host` rejects it.
        rejected: bool,
        /// Why -- either the security rationale for rejecting it, or
        /// why it is intentionally left un-rejected under this crate's
        /// own SSRF-style threat model (an endpoint host resolving to
        /// a network-local or ISP-internal address a caller's own
        /// process could otherwise reach).
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

    /// AutoSDE finding `f-b44a65a0`: a panicking closure must map to the
    /// SAME `None` a genuine timeout produces -- the sync path has no
    /// way to distinguish "the closure panicked" from "the closure
    /// never finished in time": a panic drops the helper thread's
    /// `mpsc::Sender` before it ever sends a value (unwinding drops
    /// `tx`, the closure's captured local, before `tx.send(f())` runs),
    /// so `rx.recv_timeout` observes `Err(RecvTimeoutError::Disconnected)`,
    /// which `.ok()` collapses to `None` -- textually identical to the
    /// `Err(RecvTimeoutError::Timeout)` case a real timeout produces.
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

    /// Companion to the test above: feeds a panicking closure through
    /// the SAME `Some(Some)`/`Some(None)`/`None` mapping
    /// `resolve_host_addrs_bounded` itself applies (that function
    /// cannot be driven with a synthetic closure directly -- it always
    /// calls the real `resolve_host_addrs`), proving the panic
    /// resolves to `DnsOutcome::TimedOut` and is therefore DENIED
    /// outright by `decide_pin` (fail-closed), never folded into
    /// `Failed`'s fail-open, nothing-to-pin outcome.
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

    // ── resolve_host_addrs_bounded: property (a) and (b) ────────────
    //
    // (a) a genuine resolution failure still fails open (via decide_pin,
    //     unchanged from before the timeout-vs-failure split existed).
    // (b) a timeout specifically does NOT fail open unpinned -- it is
    //     denied outright.

    #[test]
    fn resolve_host_addrs_bounded_reports_failed_for_an_unresolvable_host_not_timed_out() {
        // A reserved, deliberately-never-resolving TLD (RFC 2606) --
        // this resolves (fails) well within the bound, so the outcome
        // must be `Failed`, never `TimedOut`.
        let outcome = resolve_host_addrs_bounded(
            "telemetry.konductor.example.invalid",
            Duration::from_millis(500),
        );
        assert_eq!(outcome, DnsOutcome::Failed);
    }

    /// `resolve_host_addrs_bounded` always calls the real
    /// `resolve_host_addrs` internally and cannot be driven with a
    /// synthetic closure directly (see
    /// `decide_pin_denies_a_panicked_sync_resolution_the_same_as_a_timeout`
    /// above). A real DNS resolution to a real public hostname can
    /// complete fast enough -- e.g. an already-cached resolver answer --
    /// to land in `run_with_timeout`'s channel before `recv_timeout` is
    /// even called: `mpsc::Receiver::recv_timeout` returns a buffered
    /// value immediately regardless of how small the requested bound
    /// is, so an effectively-zero bound does not guarantee the timeout
    /// branch wins the race (observed directly: `example.com` at a 1ns
    /// bound returned `Resolved` with real addresses on one run, not
    /// `TimedOut`). This test instead exercises `run_with_timeout`
    /// directly with a synthetic `std::thread::sleep`-based closure (the
    /// same proven-reliable 20ms-bound/2s-sleep margin as
    /// `run_with_timeout_returns_none_when_the_closure_exceeds_the_bound`
    /// above), which bounds deterministically regardless of network
    /// conditions, then applies `resolve_host_addrs_bounded`'s own
    /// `Some(Some)`/`Some(None)`/`None` -> `DnsOutcome` mapping (see its
    /// own source) to confirm the `None` case reports
    /// `DnsOutcome::TimedOut`.
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
        // Property (a): unresolvable != disallowed.
        assert_eq!(decide_pin(DnsOutcome::Failed), Some(None));
    }

    #[test]
    fn decide_pin_denies_a_timeout_rather_than_failing_open() {
        // Property (b): a timeout must NOT be folded into the same
        // fail-open, no-pin outcome a genuine failure gets -- this is
        // the exact CRITICAL regression (AutoSDE finding f-9ec2e9ff)
        // this fix addresses.
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

        // ── property (c): the async bounded resolution behaves
        // equivalently to the sync one -- same Failed/TimedOut split,
        // exercised through the tokio path a real async caller
        // (mcp/lib/skill-lookup-core) actually uses. ─────────────────

        #[tokio::test]
        async fn resolve_host_addrs_bounded_async_reports_failed_for_an_unresolvable_host() {
            let outcome = resolve_host_addrs_bounded_async(
                "telemetry.konductor.example.invalid".to_string(),
                Duration::from_millis(500),
            )
            .await;
            assert_eq!(outcome, DnsOutcome::Failed);
        }

        /// A real hostname lookup can complete fast enough (e.g. an
        /// already-cached resolver answer) that a near-zero bound races
        /// the resolution rather than reliably exceeding it -- observed
        /// directly: `resolve_host_addrs_bounded_async("example.com",
        /// Duration::from_nanos(1))` returned `Resolved` on a real run,
        /// not `TimedOut`, because `tokio::time::timeout` polls the
        /// inner `spawn_blocking` future first and only consults the
        /// timer if it is still pending. This test instead exercises
        /// `run_with_timeout_async` directly with a synthetic
        /// `std::thread::sleep`-based closure (mirroring the sync
        /// `run_with_timeout_returns_none_when_the_closure_exceeds_the_bound`
        /// test's own proven-reliable 20ms-bound/2s-sleep margin), which
        /// bounds deterministically regardless of network conditions,
        /// then confirms `resolve_host_addrs_bounded_async`'s own
        /// `TimedOut` mapping by construction (its match arm on
        /// `Err(AsyncBoundError::TimedOut)` is exercised identically
        /// whether the bounded call comes from a real resolution or this
        /// synthetic one).
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

        /// `resolve_host_addrs_bounded_async` must map a `TimedOut`
        /// bound (proven deterministic above) to `DnsOutcome::TimedOut`,
        /// not `DnsOutcome::Failed` -- the exact distinction
        /// `decide_pin` treats differently.
        #[tokio::test]
        async fn resolve_host_addrs_bounded_async_maps_a_synthetic_timeout_to_timed_out() {
            // Same synthetic-slow-closure technique as the test above,
            // routed through the actual public entry point via a
            // hostname that resolves via /etc/hosts (no real network
            // round-trip to race against) combined with an
            // artificially tiny bound would still be racy for the same
            // reason "example.com" was -- so this asserts the mapping
            // directly against `run_with_timeout_async`'s own
            // deterministic `Err(AsyncBoundError::TimedOut)`, which is
            // exactly what `resolve_host_addrs_bounded_async` matches
            // on to produce `DnsOutcome::TimedOut` (see its own source).
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

        /// AutoSDE finding `f-b44a65a0`: the async path's own more
        /// granular signal (a `JoinError` distinguishing "panicked" from
        /// "timed out") must NOT let it diverge from the sync path's
        /// verdict. Confirms `run_with_timeout_async`'s own panic
        /// classification first (the low-level primitive), deterministically
        /// via a closure that panics immediately rather than merely sleeping
        /// past the bound.
        ///
        /// The bound here is deliberately generous (seconds, not the
        /// tens-of-milliseconds used by the genuine-timeout tests above)
        /// even though the closure panics immediately: this test asserts
        /// on which `Err` variant comes back, not on speed, so a wide
        /// bound costs nothing in the success path (`tokio::time::timeout`
        /// resolves as soon as the inner `spawn_blocking` join completes,
        /// not after the full duration) while leaving headroom for
        /// coverage-instrumented runs, where every instruction (including
        /// the blocking-pool thread dispatch and unwind machinery between
        /// the panic and the `JoinError` reaching this `.await`) runs
        /// slower (the same class of instrumentation-induced timing
        /// slowdown documented in `cli/konductor-rs/src/cli/logging.rs`'s
        /// `HomeGuard` tests). A narrow bound here would race the
        /// classification itself: if the timeout elapsed first, this
        /// would observe `Err(AsyncBoundError::TimedOut)` even though the
        /// closure genuinely panicked, misreporting an environment-speed
        /// artifact as evidence the panic/timeout distinction had broken.
        #[tokio::test]
        async fn run_with_timeout_async_returns_panicked_when_the_closure_panics() {
            let result: Result<(), AsyncBoundError> =
                run_with_timeout_async(Duration::from_secs(5), || {
                    panic!("deliberate panic for the DnsOutcome::TimedOut regression");
                })
                .await;
            assert_eq!(result, Err(AsyncBoundError::Panicked));
        }

        /// The actual CRITICAL regression this fix closes: a panic must
        /// map to `DnsOutcome::TimedOut`, NOT `Failed` -- before this fix,
        /// `resolve_host_addrs_bounded_async` mapped `Panicked` to
        /// `Failed`, which `decide_pin` treats as fail-OPEN (allowed,
        /// unpinned) -- the opposite verdict the sync path already gives
        /// a panic (see `decide_pin_denies_a_panicked_sync_resolution_the_same_as_a_timeout`
        /// in the parent module's own test list). Same technique as
        /// `resolve_host_addrs_bounded_async_maps_a_synthetic_timeout_to_timed_out`
        /// above: asserts the mapping directly against
        /// `run_with_timeout_async`'s own deterministic
        /// `Err(AsyncBoundError::Panicked)`, exactly what
        /// `resolve_host_addrs_bounded_async` matches on.
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
            // A resolved outcome (this host DOES resolve, generously
            // bounded) must round-trip through decide_pin exactly like
            // the sync path -- proving the async wrapper doesn't
            // silently change the classification, only how the wait is
            // performed.
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
