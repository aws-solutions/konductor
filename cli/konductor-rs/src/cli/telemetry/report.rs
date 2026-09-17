// SPDX-License-Identifier: Apache-2.0
//
// telemetry/report.rs — the `telemetry::report_*` call-site API.
//
// Every function here returns `()`, never `Result` -- telemetry failure
// must never propagate to a caller. Internally: a missing/malformed
// identity file, a `spawn()` error, or the transport script's own
// network failure are all discarded, never escalated.
//
// Naming: `telemetry`, not `metrics` -- `Commands::Metrics` already
// names a distinct, unrelated stub command.

use std::io::Write as _;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use super::envelope::{EventEnvelope, EventType, OuterEnvelope, NIL_UUID_SENTINEL};
use super::identity::{self, IdentityRecord};

/// AWS Solutions Library Solution ID assigned to Konductor. This is the
/// real, registered identifier, not a placeholder, and is sent as every
/// outbound telemetry event's `Solution` field.
pub(super) const SOLUTION_ID: &str = "SO0370";

/// Compile-time default endpoint (three-tier resolution order, tier 1)
/// -- the real AWS Solutions Library operational-metrics ingestion
/// endpoint for Konductor (`SOLUTION_ID` = `SO0370`). Accepts a POST of
/// the exact `Solution`/`Version`/`UUID`/`TimeStamp`/`Data` envelope
/// shape `envelope.rs`'s `OuterEnvelope` already produces.
const DEFAULT_TELEMETRY_ENDPOINT: &str = "https://metrics.awssolutionsbuilder.com/generic";

/// Environment variable overriding the endpoint (tier 2 of the
/// three-tier resolution order -- `KONDUCTOR_METRICS_ENDPOINT` env var
/// -> `.konductor/config.yml` `telemetry.endpoint` -> compile-time
/// default). Named `KONDUCTOR_METRICS_ENDPOINT`, not
/// `KONDUCTOR_TELEMETRY_ENDPOINT` --
/// must match that literal name exactly, since it
/// is the one already-documented, externally-visible override an
/// operator would set.
const TELEMETRY_ENDPOINT_ENV_VAR: &str = "KONDUCTOR_METRICS_ENDPOINT";

/// Fleet-wide opt-out env var ("`KONDUCTOR_TELEMETRY=off` + managed
/// config for fleet"). Checked FIRST in `resolve_endpoint`, ahead of
/// `.konductor/config.yml`'s own per-repo `telemetry.enabled: false` --
/// a fleet-level override set in the process environment is meant to be
/// unconditional, not something an individual repo's checked-in config
/// can re-enable.
const TELEMETRY_OFF_ENV_VAR: &str = "KONDUCTOR_TELEMETRY";

/// The exact value `TELEMETRY_OFF_ENV_VAR` must equal to disable
/// telemetry -- matches the documented literal example
/// (`KONDUCTOR_TELEMETRY=off`) exactly; any other value (including
/// empty) leaves telemetry enabled per the other resolution tiers.
const TELEMETRY_OFF_VALUE: &str = "off";

/// The checked-in transport script's text, embedded at compile time
/// -- never read from a source-tree path at runtime.
const TELEMETRY_REPORT_SCRIPT: &str =
    include_str!("../../../../../scripts/konductor-telemetry-report.sh");

/// Materialized script's file name under `std::env::temp_dir()`.
const MATERIALIZED_SCRIPT_NAME: &str = "konductor-telemetry-report.sh";

/// This process's cached identity lookup: resolved at most once,
/// regardless of how many `report_*` calls happen in this process's
/// lifetime. Test-only escape hatch (`reset_identity_cache_for_test`)
/// exists because `cargo test` runs every test in this module in one
/// shared process -- without it, the first test to populate the cache
/// would poison every later test in the same run.
static IDENTITY_CACHE: OnceLock<Option<IdentityRecord>> = OnceLock::new();

/// Resolves the identity record for `target_dir`, cached for the rest of
/// this process. `target_dir`'s value only matters on the FIRST call in
/// a process -- subsequent calls (even with a different `target_dir`,
/// which no real call site ever does across process lifetime) return
/// the cached value: identity is resolved once and reused for the rest
/// of the process.
///
/// NOT SAFE for a `--all` batch loop that iterates several distinct
/// `target_dir`s in one process -- each has its OWN
/// `.konductor/telemetry-id.json` with its own UUID, but every target
/// after the first would be reported under the first target's cached
/// identity. Batch call sites (`uninstall_one`/`run_update_one_target`
/// invoked from `dispatch_all`/`dispatch_update_all_json`) must use
/// `read_identity_uncached` instead, which re-reads per call.
fn cached_identity(target_dir: &std::path::Path) -> Option<IdentityRecord> {
    IDENTITY_CACHE
        .get_or_init(|| identity::read_identity(target_dir))
        .clone()
}

/// Reads `target_dir`'s identity record directly, bypassing
/// `IDENTITY_CACHE` entirely. Use this from any call site that may run
/// against more than one `target_dir` within a single process (the
/// `--all` batch paths in `uninstall.rs`/`update.rs`) -- the process-
/// global cache's "resolved once" contract only holds for a
/// single-target invocation.
pub(crate) fn read_identity_uncached(target_dir: &std::path::Path) -> Option<IdentityRecord> {
    identity::read_identity(target_dir)
}

/// Debug-only escape hatch for the host-allowlist check below
/// (`endpoint_host_is_allowed`) -- set to bypass it for local
/// dev/testing against a loopback endpoint (e.g. a developer's own test
/// receiver on `127.0.0.1`). Never checked implicitly by any other
/// code path; a caller must explicitly opt in by setting this exact
/// env var, and the name says plainly what it does rather than reusing
/// a more general-purpose-sounding flag.
const TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR: &str = "KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT";

/// Whether telemetry is disabled (fleet-wide env var or per-repo
/// config), or no endpoint resolves. Checks, in order:
/// 1. `KONDUCTOR_TELEMETRY=off` (`TELEMETRY_OFF_ENV_VAR`) -- the
///    fleet-wide opt-out. Checked FIRST and unconditionally: a
///    fleet-managed environment
///    variable is meant to win over whatever an individual repo's
///    checked-in `.konductor/config.yml` says.
/// 2. `.konductor/config.yml`'s `telemetry.enabled: false` -- the
///    per-repo opt-out.
///
/// If neither disables telemetry, resolves the endpoint per the
/// three-tier order: `KONDUCTOR_METRICS_ENDPOINT`
/// env var -> `.konductor/config.yml`'s `telemetry.endpoint` ->
/// compile-time `DEFAULT_TELEMETRY_ENDPOINT`. Returns `None` if
/// telemetry is disabled by either mechanism above, OR if the resolved
/// endpoint's host fails `endpoint_host_is_allowed` (see that
/// function's own doc comment for the security rationale); `Some(endpoint)`
/// otherwise. `target_dir` is used only to look for a project-local
/// `.konductor/config.yml` -- absent that, falls back to the compile-time
/// default (with the env var taking precedence over both).
///
/// Reads `.konductor/config.yml` directly via `serde_yaml` for just the
/// `telemetry` top-level key -- deliberately NOT threaded through the
/// existing `cli::config::Config`/`load_config` machinery, which models
/// an unrelated severity/tier gate-config schema (this only requires
/// "the YAML parsing already available to the crate", i.e. `serde_yaml`
/// itself, not that specific struct).
/// `#[cfg(test)]`: production code now calls `resolve_endpoint_with_pin`
/// directly (it needs the pin `resolve_endpoint` itself discards) --
/// this thin wrapper has no remaining non-test caller, kept only so
/// this module's existing `Option<String>`-shaped tests need no
/// changes.
#[cfg(test)]
fn resolve_endpoint(target_dir: &std::path::Path) -> Option<String> {
    resolve_endpoint_with_pin(target_dir).map(|(endpoint, _pinned_ip)| endpoint)
}

/// Same resolution as `resolve_endpoint`, but also returns the address
/// (if any) `send_event`/`spawn_and_send` must pin `curl` to via
/// `--resolve` (adversarial finding: DNS-rebinding TOCTOU) -- see
/// `endpoint_host_is_allowed_with_pin`'s own doc comment for the full
/// rationale and the meaning of each `Option<Option<IpAddr>>` shape.
/// Kept as a wrapper around the SAME logic `resolve_endpoint` used to
/// contain directly (rather than two independently-maintained
/// resolution pipelines) so the two can never drift.
fn resolve_endpoint_with_pin(
    target_dir: &std::path::Path,
) -> Option<(String, Option<std::net::IpAddr>)> {
    if std::env::var(TELEMETRY_OFF_ENV_VAR).as_deref() == Ok(TELEMETRY_OFF_VALUE) {
        return None;
    }

    let raw = read_telemetry_config(target_dir);

    if let Some(false) = raw.as_ref().and_then(|r| r.enabled) {
        // Provenance-only trace (`KONDUCTOR_LOG=debug`), mirroring
        // `cached_endpoint_with_pin`'s own resolution trace: the one
        // externally observable signal that THIS target's own
        // `.konductor/config.yml` was actually consulted and found
        // disabled, as opposed to a `--all` batch call site silently
        // reusing a DIFFERENT target's cached verdict -- see
        // `tests/telemetry_report_process.rs`'s own
        // `update_all_json_batch_honors_each_targets_own_telemetry_opt_out`.
        crate::cli::trace::trace(
            "trace",
            "telemetry: disabled for this target via .konductor/config.yml",
        );
        return None;
    }

    let candidate = if let Ok(from_env) = std::env::var(TELEMETRY_ENDPOINT_ENV_VAR) {
        if !from_env.is_empty() {
            from_env
        } else if let Some(endpoint) = raw.as_ref().and_then(|r| r.endpoint.clone()) {
            endpoint
        } else {
            DEFAULT_TELEMETRY_ENDPOINT.to_string()
        }
    } else if let Some(endpoint) = raw.as_ref().and_then(|r| r.endpoint.clone()) {
        endpoint
    } else {
        DEFAULT_TELEMETRY_ENDPOINT.to_string()
    };

    // Security gate (host allowlist): anyone with config-write or
    // env-var-set access in shared CI could otherwise redirect
    // telemetry to an attacker-controlled host by pointing either
    // override tier at a loopback/link-local/private-range address that
    // happens to be reachable from THIS host but is not the real
    // fleet-managed collector -- e.g. a listener the attacker controls
    // on the same CI runner or the same private network segment.
    // Rejecting rather than silently sending is the same fail-closed
    // posture `resolve_endpoint`'s other checks already apply.
    let pinned_ip = endpoint_host_is_allowed_with_pin(&candidate)?;

    Some((candidate, pinned_ip))
}

/// Whether `endpoint`'s host is safe to send telemetry to: rejects a
/// loopback (`127.0.0.1`/`::1`/`localhost`), link-local
/// (`169.254.0.0/16`/`fe80::/10`), or RFC 1918 private-range
/// (`10.0.0.0/8`/`172.16.0.0/12`/`192.168.0.0/16`) host, unless the
/// debug-only `KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT` escape hatch is
/// set (see that constant's own doc comment). A host this function
/// cannot classify at all (fails to parse as a URL with a discernible
/// host) is treated as NOT allowed -- fail closed, matching every other
/// tolerance decision in this module, which drops rather than sends on
/// anything it cannot positively validate.
///
/// Two checks run, in order: the cheap literal-string/IP-literal check
/// (`is_disallowed_local_host`), then an actual DNS resolution check
/// (`resolved_addresses_include_disallowed_host`). The literal check
/// alone is bypassable by a hostname like `127.0.0.1.nip.io`, which is
/// not itself a loopback/private-range literal but resolves to one at
/// request time -- the same class of gap as an unmapped IPv4-mapped
/// IPv6 literal (`::ffff:127.0.0.1`), which `is_disallowed_local_host`
/// also now unmaps before classifying (see that function's own doc
/// comment). Running both checks closes the gap without regressing the
/// existing fast literal path: an IP literal never touches the
/// resolver (`ToSocketAddrs` resolves it directly, no DNS query), and a
/// hostname that fails to resolve at all -- e.g. a reserved,
/// deliberately-never-resolving `.invalid` TLD host (RFC 2606) -- is
/// NOT itself treated as disallowed; see that function's own doc
/// comment for why.
/// `#[cfg(test)]`: production code now calls
/// `endpoint_host_is_allowed_with_pin` directly (it needs the pin this
/// bool-only wrapper discards) -- kept only so this module's existing
/// bool-shaped tests need no changes.
#[cfg(test)]
fn endpoint_host_is_allowed(endpoint: &str) -> bool {
    endpoint_host_is_allowed_with_pin(endpoint).is_some()
}

/// Same allow/deny decision as `endpoint_host_is_allowed`, but also
/// returns the address (if any) `spawn_and_send` must pin `curl` to via
/// `--resolve` -- closing the DNS-rebinding TOCTOU between THIS
/// function's own resolution and curl's later, independent one
/// (adversarial finding: the Rust-side check validates a hostname, then
/// hands the bare hostname string to the transport script, which lets
/// curl resolve it again at connect time -- a rebinding attacker can
/// flip the DNS answer in between). Computes the pin from the EXACT
/// SAME resolution this function's own allow/deny verdict is based on
/// -- never a second, independent lookup, which would just move the
/// TOCTOU window rather than close it (a second resolution can
/// legitimately return a different address than the first under
/// precisely the attack this closes).
///
/// The literal-check and escape-hatch handling below is this crate's
/// own glue; the resolution bound (`telemetry_net::resolve_host_addrs_bounded`)
/// and the resulting allow/deny/pin decision (`telemetry_net::decide_pin`)
/// are the shared implementation `mcp/lib/skill-lookup-core`'s own
/// mirror also calls, so the timeout-vs-failure distinction that
/// decision embodies can never diverge
/// between the two crates.
///
/// Returns:
/// - `None` -- disallowed; do not send. This now also covers a
///   resolution that did not finish within `DNS_RESOLUTION_TIMEOUT`
///   (see `telemetry_net::decide_pin`'s own doc comment for why a
///   timeout is denied outright rather than folded into the same
///   fail-open outcome a genuine resolution failure gets).
/// - `Some(None)` -- allowed, with nothing to pin: either the debug
///   escape hatch bypassed validation entirely, `host` is already an IP
///   literal (curl performs no resolution for a literal, so there is no
///   TOCTOU window to close), or `host` failed to resolve outright
///   within the bound (fail-open, matching
///   `resolved_addresses_include_disallowed_host`'s own contract --
///   there is no address to pin either way).
/// - `Some(Some(ip))` -- allowed, and `host` resolved to one or more
///   addresses none of which are disallowed; `ip` is the exact address
///   this check validated and `spawn_and_send` must pin `curl` to.
fn endpoint_host_is_allowed_with_pin(endpoint: &str) -> Option<Option<std::net::IpAddr>> {
    if std::env::var_os(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR).is_some() {
        return Some(None);
    }
    let host = telemetry_net::extract_host(endpoint)?;
    if telemetry_net::is_disallowed_local_host(host) {
        return None;
    }
    if host.parse::<std::net::IpAddr>().is_ok() {
        // Already a literal -- ToSocketAddrs never queries a resolver
        // for one, so there is nothing to pin.
        return Some(None);
    }
    let outcome = telemetry_net::resolve_host_addrs_bounded(host, DNS_RESOLUTION_TIMEOUT);
    telemetry_net::decide_pin(outcome)
}

/// Resolves `host` via `telemetry_net::resolve_host_addrs_bounded` and
/// checks whether the outcome would be flagged as disallowed -- a
/// bool-only convenience so this module's existing tests exercising
/// the resolution path (as opposed to `endpoint_host_is_allowed_with_pin`'s
/// full pin-and-escape-hatch decision) need no changes. A `TimedOut`
/// outcome is folded into `true` (treated the same as "flagged") here
/// only because none of this test-only helper's own callers exercise a
/// real timeout -- the actual timeout-vs-failure distinction is
/// asserted directly against `telemetry_net::decide_pin` in this
/// module's own tests below, and exhaustively in `telemetry-net`'s own
/// test suite.
#[cfg(test)]
fn resolved_addresses_include_disallowed_host(host: &str) -> bool {
    match telemetry_net::resolve_host_addrs_bounded(host, DNS_RESOLUTION_TIMEOUT) {
        telemetry_net::DnsOutcome::Resolved(addrs) => {
            addrs.iter().any(|ip| telemetry_net::is_disallowed_ip(*ip))
        }
        telemetry_net::DnsOutcome::Failed => false,
        telemetry_net::DnsOutcome::TimedOut => true,
    }
}

/// Upper bound on how long this module's DNS resolution may block its
/// caller. `report_error` calls
/// `telemetry::report_cli_error` -- which reaches this resolution via
/// `resolve_endpoint`/`endpoint_host_is_allowed` -- BEFORE printing the
/// user-facing error line, so an un-timeboxed `getaddrinfo` call here
/// stalls every telemetry-enabled CLI error's visible output for as
/// long as the (possibly slow or misconfigured) resolver takes.
/// Deliberately short: a normal, responsive resolver finishes in low
/// single-digit milliseconds. A resolution error still fails open (see
/// `telemetry_net::decide_pin`'s own doc comment). A TIMEOUT does not --
/// it is denied outright rather than
/// given more time, since lengthening this bound on a timeout would
/// reintroduce the exact foreground stall this bound exists to prevent.
const DNS_RESOLUTION_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

#[derive(Debug, Default, serde::Deserialize)]
struct RawTelemetrySection {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    endpoint: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct RawConfigTelemetryOnly {
    #[serde(default)]
    telemetry: Option<RawTelemetrySection>,
}

/// Reads just the `telemetry:` top-level key out of
/// `<target_dir>/.konductor/config.yml`, if present and parseable.
/// Missing file, unreadable file, or malformed YAML all read back as
/// `None` -- the same "absent" tolerance every other telemetry read
/// path in this module already applies.
fn read_telemetry_config(target_dir: &std::path::Path) -> Option<RawTelemetrySection> {
    let path = target_dir
        .join(super::super::config::KONDUCTOR_DIR_NAME)
        .join(super::super::config::CONFIG_FILE_NAME);
    let contents = std::fs::read_to_string(path).ok()?;
    let parsed: RawConfigTelemetryOnly = serde_yaml::from_str(&contents).ok()?;
    parsed.telemetry
}

/// Materializes the embedded transport script into a process-private
/// directory (never the shared, world-writable `std::env::temp_dir()`)
/// and makes it executable.
///
/// Security follow-up: writing a fixed, predictable name into a
/// shared temp dir is a local code-execution vector on multi-user
/// hosts -- a local attacker can pre-place a symlink at that path
/// (`std::fs::write` follows symlinks) or swap the file's contents
/// between this write and the later `spawn()` (TOCTOU), running
/// arbitrary code with this process's privileges. Mitigated by:
///   1. materializing under `$HOME/.konductor/tmp`, created `0o700`
///      (private to this user, not world-writable);
///   2. opening with `O_NOFOLLOW` so a pre-placed symlink at the target
///      path is rejected outright rather than followed;
///   3. verifying the open file is a regular file immediately before
///      making it executable, closing the TOCTOU window between the
///      open and the `spawn()` below.
///
/// Self-healing: a deleted or stale (post-upgrade) copy is simply
/// rewritten, with no separate upgrade step.
fn materialize_script() -> std::io::Result<std::path::PathBuf> {
    let dir = private_script_dir()?;
    let path = dir.join(MATERIALIZED_SCRIPT_NAME);
    write_verified(&path, TELEMETRY_REPORT_SCRIPT)?;
    set_executable(&path)?;
    Ok(path)
}

/// `$HOME/.konductor/tmp` when `HOME` is set, created `0o700` if
/// absent. Never the shared, world-writable `std::env::temp_dir()`
/// directly -- see `materialize_script`'s doc comment.
///
/// `HOME` is not guaranteed to be set -- sandboxed build/CI containers
/// commonly run with no `HOME` at all (this crate's `skill-lookup-core`
/// mirror's `materialized_script_path_exists_and_is_executable` test
/// caught this in a real dry-run build). When `HOME` is unset, falls
/// back to a per-uid subdirectory under `std::env::temp_dir()`
/// (`konductor-tmp-<uid>`), created `0o700` the same way -- private to
/// the current user (not world-writable, not symlink-attackable via
/// another uid) without requiring `$HOME` to exist.
/// `std::env::temp_dir()` itself never depends on `HOME` (it falls
/// back to `TMPDIR`/`/tmp`), so this fallback works in exactly the
/// environment that broke the `$HOME`-only path.
fn private_script_dir() -> std::io::Result<std::path::PathBuf> {
    let dir = match std::env::var_os("HOME") {
        Some(home) => std::path::PathBuf::from(home)
            .join(".konductor")
            .join("tmp"),
        None => std::env::temp_dir().join(format!("konductor-tmp-{}", current_uid())),
    };
    create_private_dir_all(&dir)?;
    Ok(dir)
}

/// The current process's effective UID, via a direct `getuid(2)` FFI
/// call -- avoids pulling in the `libc` crate for one syscall this
/// module needs only for the `HOME`-unset fallback's per-user scoping.
#[cfg(unix)]
fn current_uid() -> u32 {
    extern "C" {
        fn getuid() -> u32;
    }
    // SAFETY: getuid(2) takes no arguments, has no preconditions, and
    // cannot fail.
    unsafe { getuid() }
}

#[cfg(not(unix))]
fn current_uid() -> u32 {
    0
}

/// Creates `dir` (and any missing parents) with `0o700` permissions,
/// then verifies the final leaf component is a real directory owned by
/// this process's own UID before returning -- never trusts a
/// pre-existing entry at that exact path without checking both.
///
/// Two independent hazards on a shared multi-user host:
///   1. Ownership: `create_dir_all` is a no-op if something is already
///      there, and `set_permissions` happily re-chmods whatever that
///      is. A different local user could have pre-created the
///      directory before this process ever ran; silently trusting and
///      writing into it hands that user visibility (or worse) into
///      this process's private telemetry-transport script.
///   2. Symlinks: `set_permissions` (`chmod(2)`) follows symlinks. If
///      the leaf path component is a symlink to somewhere else
///      entirely, the `0o700` mode lands on that OTHER target, not on
///      a private directory at the intended path -- and the directory
///      the script later gets written into (via `write_verified`'s own
///      `O_NOFOLLOW` open, which only protects the FILE, not the
///      directory) is not actually this process's private space.
///
/// Fails closed on either hazard: returns an error rather than
/// proceeding to materialize the script into an untrustworthy
/// directory. `symlink_metadata` (never `metadata`) on the leaf
/// component specifically, so a symlink at that exact path is detected
/// rather than transparently followed the way `create_dir_all` and
/// `set_permissions` both would.
#[cfg(unix)]
fn create_private_dir_all(dir: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    std::fs::create_dir_all(dir)?;

    let leaf_meta = std::fs::symlink_metadata(dir)?;
    if leaf_meta.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "refusing to use {}: a symlink exists at this exact path \
                 instead of a real directory",
                dir.display()
            ),
        ));
    }
    if !leaf_meta.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("refusing to use {}: not a directory", dir.display()),
        ));
    }
    if leaf_meta.uid() != current_uid() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!(
                "refusing to use {}: owned by uid {}, not this process's own uid {}",
                dir.display(),
                leaf_meta.uid(),
                current_uid()
            ),
        ));
    }

    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn create_private_dir_all(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// Writes `contents` to `path` only if no byte-identical copy is
/// already there, opening with `O_NOFOLLOW` (never following a
/// symlink an attacker pre-placed at `path`) and verifying the result
/// is a regular file before returning -- closes the TOCTOU window
/// between this write and `spawn_and_send`'s later exec. Relies on
/// `private_script_dir`'s `0o700` permissions (not a uid check here,
/// to avoid pulling in a new `libc`-style dependency for one syscall)
/// to keep another local user from replacing the file afterward.
#[cfg(unix)]
fn write_verified(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
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
fn write_verified(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
    std::fs::write(path, contents)
}

/// `O_NOFOLLOW` -- NOT a single numeric value shared across
/// Linux/BSD/macOS: on Linux/Android/illumos/Solaris it is `0o400_000`
/// (`0x20000`); on macOS and the *BSDs it is `0o400` (`0x100`).
/// cfg-gated per platform rather than pulling in a `libc` dependency
/// for a single flag this crate doesn't otherwise need.
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

/// Rejects anything that isn't a regular file -- the last check before
/// this path is handed to `spawn()`. `symlink_metadata` (never
/// `metadata`) so a symlink swapped in after the `O_NOFOLLOW` open
/// above is detected rather than transparently followed.
#[cfg(unix)]
fn verify_regular_file(path: &std::path::Path) -> std::io::Result<()> {
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
fn set_executable(path: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn set_executable(_path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

/// Spawns the materialized transport script detached: the endpoint as
/// its first `Command` argument (a fixed argv array, no shell
/// interposed), an optional `host:port:address` pin as its second
/// (adversarial finding: DNS-rebinding TOCTOU -- see
/// `build_resolve_arg`'s own doc comment), the JSON body written to its
/// stdin and the handle closed. Never `.wait()`-ed -- any
/// spawn error, and any later network failure this Rust code never
/// observes, is discarded.
///
/// `pinned_ip` is `None` whenever `endpoint_host_is_allowed_with_pin`
/// had nothing to pin (an IP literal, an unresolvable host, or the
/// debug escape hatch) -- in that case the script performs its own
/// unpinned resolution, exactly as it did before this fix. When
/// `Some`, `extract_host` is called again here purely as a string-split
/// (no network I/O, so re-deriving it costs nothing and introduces no
/// second TOCTOU window) to recover the host `build_resolve_arg` needs
/// alongside the port and the already-resolved pin address.
fn spawn_and_send(endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: &str) {
    let Ok(script_path) = materialize_script() else {
        return;
    };
    let mut command = Command::new(&script_path);
    command.arg(endpoint);
    if let Some(ip) = pinned_ip {
        if let Some(host) = telemetry_net::extract_host(endpoint) {
            command.arg(telemetry_net::build_resolve_arg(
                host,
                telemetry_net::extract_port(endpoint),
                ip,
            ));
        }
    }
    let Ok(mut child) = command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return;
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(body.as_bytes());
        // Dropping `stdin` here closes the pipe; the child is left
        // detached and never `.wait()`-ed -- a deliberate
        // fire-and-forget shape.
    }
}

/// This process's cached endpoint+pin resolution: resolved at most once
/// per process, mirroring `IDENTITY_CACHE`'s own once-per-process
/// contract (and its own caveat: `target_dir`'s value only matters on
/// the FIRST call in a process). Correct for a single-target invocation
/// -- where the resolution cost is paid once either way -- but WRONG for
/// a `--all` batch over several distinct targets, for exactly the reason
/// `IDENTITY_CACHE` documents on its own: each target has its OWN
/// `target_dir/.konductor/config.yml`, which `resolve_endpoint_with_pin`
/// reads for BOTH the endpoint AND the per-repo `telemetry.enabled`
/// opt-out, so caching the first target's resolution and reusing it for
/// every later target would silently ignore a later target's own
/// opt-out. Every `_for_target` sender in
/// this module (`send_event_for_target`) therefore bypasses this cache
/// entirely via `resolve_endpoint_with_pin_uncached`, re-resolving once
/// per target -- accepting a bounded DNS wait per target in a batch as
/// the deliberate correctness-over-performance trade this fix requires,
/// the same trade `read_identity_uncached` already makes for identity.
static ENDPOINT_CACHE: OnceLock<Option<(String, Option<std::net::IpAddr>)>> = OnceLock::new();

/// Resolves the telemetry endpoint and DNS-rebinding pin for
/// `target_dir`, cached for the rest of this process -- see
/// `ENDPOINT_CACHE`'s own doc comment for why this exists and what it
/// fixes for a multi-target batch run.
///
/// Traces (provenance only, `KONDUCTOR_LOG=debug`) exactly once per
/// process, on whichever call actually performs the resolution --
/// never on a call that only observes the already-cached value. This
/// is deliberately the one externally observable signal of the caching
/// behavior itself: `ENDPOINT_CACHE` is a process-global `OnceLock`
/// with no safe reset (the same constraint `IDENTITY_CACHE` documents
/// on its own doc comment), so this function's caching contract cannot
/// be exercised by an in-process unit test sharing a `cargo test`
/// binary with other tests that may have already populated it --
/// `tests/telemetry_report_process.rs`'s own
/// `update_all_json_batch_resolves_the_endpoint_exactly_once` test
/// instead spawns a fresh subprocess per case and counts this trace
/// line in its stderr output.
fn cached_endpoint_with_pin(
    target_dir: &std::path::Path,
) -> Option<(String, Option<std::net::IpAddr>)> {
    let was_uninitialized = ENDPOINT_CACHE.get().is_none();
    let result = ENDPOINT_CACHE
        .get_or_init(|| resolve_endpoint_with_pin(target_dir))
        .clone();
    if was_uninitialized {
        crate::cli::trace::trace(
            "trace",
            "telemetry: endpoint resolved and cached for the rest of this process",
        );
    }
    result
}

/// Resolves the telemetry endpoint and DNS-rebinding pin for
/// `target_dir` directly, bypassing `ENDPOINT_CACHE` entirely -- mirrors
/// `read_identity_uncached`'s own doc comment and exists for the same
/// reason: unlike the MCP side's own
/// once-per-process justification for a resolution cache (single
/// process, no per-repo config), the CLI's `resolve_endpoint_with_pin`
/// reads a genuinely PER-REPO `target_dir/.konductor/config.yml` for
/// both the endpoint AND the `telemetry.enabled` opt-out. Use this from
/// any call site that may run against more than one `target_dir` within
/// a single process (the `_for_target` batch call sites in this module) --
/// without it, every target after the first in an `--all` batch would
/// silently inherit the FIRST target's resolved endpoint and opt-out
/// verdict from `ENDPOINT_CACHE`, even when that target's own
/// `config.yml` sets `telemetry.enabled: false` or a distinct endpoint.
fn resolve_endpoint_with_pin_uncached(
    target_dir: &std::path::Path,
) -> Option<(String, Option<std::net::IpAddr>)> {
    resolve_endpoint_with_pin(target_dir)
}

/// Shared core for `send_event`/`send_event_for_target`: given an
/// ALREADY-resolved `(endpoint, pinned_ip)` pair, builds and sends one
/// event. `harness` is only populated on the wire for `cli_error` events
/// -- callers pass `None` for every other event type. Kept as
/// one function so the two callers' identical envelope-building and
/// serialization logic can never drift apart -- only how the endpoint
/// is resolved (cached vs. uncached) differs between them.
#[allow(clippy::too_many_arguments)]
fn send_event_with_endpoint(
    endpoint: &str,
    pinned_ip: Option<std::net::IpAddr>,
    event_type: EventType,
    target_name: impl Into<String>,
    uuid: &str,
    session_id: Option<String>,
    parent_session_id: Option<String>,
    error_code: Option<String>,
    harness_field: Option<String>,
) {
    let data = EventEnvelope::build(
        event_type,
        target_name,
        uuid,
        session_id,
        parent_session_id,
        error_code,
        harness_field,
    );
    let outer = OuterEnvelope::wrap(data, uuid.to_string());
    let Ok(body) = serde_json::to_string(&outer) else {
        return;
    };
    spawn_and_send(endpoint, pinned_ip, &body);
}

/// Builds and sends one event, given a resolved `(uuid, harness)` pair.
/// Resolves the endpoint via `cached_endpoint_with_pin` -- correct for a
/// single-target invocation, WRONG for a `--all` batch over several
/// distinct targets (see `send_event_for_target`, which every
/// `_for_target` sender in this module uses instead).
#[allow(clippy::too_many_arguments)]
fn send_event(
    target_dir: &std::path::Path,
    event_type: EventType,
    target_name: impl Into<String>,
    uuid: &str,
    session_id: Option<String>,
    parent_session_id: Option<String>,
    error_code: Option<String>,
    harness_field: Option<String>,
) {
    let Some((endpoint, pinned_ip)) = cached_endpoint_with_pin(target_dir) else {
        return;
    };
    send_event_with_endpoint(
        &endpoint,
        pinned_ip,
        event_type,
        target_name,
        uuid,
        session_id,
        parent_session_id,
        error_code,
        harness_field,
    );
}

/// Same event as `send_event`, but resolves the endpoint+pin directly via
/// `resolve_endpoint_with_pin_uncached` instead of `cached_endpoint_with_pin` --
/// use this from any `_for_target` call
/// site that may visit more than one `target_dir` in one process. Without
/// this, a `--all` batch's second-and-later targets would inherit the
/// FIRST target's resolved endpoint and per-repo `telemetry.enabled`
/// verdict from `ENDPOINT_CACHE`, silently sending telemetry for a target
/// that opted out via its own `.konductor/config.yml`.
#[allow(clippy::too_many_arguments)]
fn send_event_for_target(
    target_dir: &std::path::Path,
    event_type: EventType,
    target_name: impl Into<String>,
    uuid: &str,
    session_id: Option<String>,
    parent_session_id: Option<String>,
    error_code: Option<String>,
    harness_field: Option<String>,
) {
    let Some((endpoint, pinned_ip)) = resolve_endpoint_with_pin_uncached(target_dir) else {
        return;
    };
    send_event_with_endpoint(
        &endpoint,
        pinned_ip,
        event_type,
        target_name,
        uuid,
        session_id,
        parent_session_id,
        error_code,
        harness_field,
    );
}

/// Hashes a runtime-provided session identifier:
/// `sha256_hex(UUID + the runtime's own session identifier)`. This is
/// the ONE place `sessionId`/`parentSessionId` get their final wire
/// value -- the raw runtime session id (e.g. Claude Code's own
/// `session_id`/`sessionId` hook payload field, see `telemetry_hook.rs`)
/// is never transmitted or stored as-is. Applied identically regardless
/// of which of the two wire fields the caller is populating; the UUID
/// mixed in is this identity's own, so the SAME raw runtime session id
/// hashes to a DIFFERENT wire value on a different install (this
/// design's join key, not the runtime's own value, is what a consumer
/// can correlate on).
fn hash_session_id(uuid: &str, raw_session_id: &str) -> String {
    super::super::install::artifact::sha256_hex(format!("{uuid}{raw_session_id}").as_bytes())
}

/// Hashes `raw_session_id` per `hash_session_id`, but treats an
/// empty-string value the SAME as a fully-absent (`None`) one --
/// `hash_session_id` never fails on empty input, so without this
/// filter a present-but-empty raw session id would hash into a
/// valid-looking-but-meaningless 64-hex `sessionId` on the wire,
/// silently masquerading as a real session identifier. Shared by
/// `report_agent_invocation`/`report_subagent_invocation` (both of
/// `session_id` and `parent_session_id`) so the empty-string treatment
/// can't drift between call sites, and is directly unit-testable
/// without going through the identity-cache-gated `report_*` functions
/// (`IDENTITY_CACHE`'s process-global `OnceLock` makes those otherwise
/// untestable at the unit level within a shared `cargo test` process --
/// see that constant's own doc comment).
fn hash_present_session_id(uuid: &str, raw_session_id: Option<&str>) -> Option<String> {
    raw_session_id
        .filter(|raw| !raw.is_empty())
        .map(|raw| hash_session_id(uuid, raw))
}

/// `report_agent_invocation`: fired from the hidden
/// `__telemetry-hook` subcommand at `SessionStart`/`agentSpawn`. Skips
/// entirely if the identity cache is `None` (most plausibly means
/// `--no-telemetry` was passed at install).
pub(crate) fn report_agent_invocation(
    target_dir: &std::path::Path,
    agent_name: &str,
    session_id: Option<String>,
) {
    let Some(identity) = cached_identity(target_dir) else {
        return;
    };
    let hashed_session_id = hash_present_session_id(&identity.uuid, session_id.as_deref());
    send_event(
        target_dir,
        EventType::AgentInvocation,
        agent_name,
        &identity.uuid,
        hashed_session_id,
        None,
        None,
        None,
    );
}

/// `report_subagent_invocation`: fired from the hidden
/// `__telemetry-hook` subcommand at `SubagentStart`. `parent_session_id`
/// is set from the SAME hook payload's own `sessionId` as `session_id`
/// -- both parameters carry the identical raw value by
/// construction; kept as two parameters so the call site stays
/// self-describing rather than the function silently duplicating one
/// into the other. Each is hashed independently (rather than hashing
/// one and reusing the result for both) so a future caller that ever
/// legitimately passes two different raw values is not silently
/// collapsed onto one hash.
pub(crate) fn report_subagent_invocation(
    target_dir: &std::path::Path,
    specialist_name: &str,
    session_id: Option<String>,
    parent_session_id: Option<String>,
) {
    let Some(identity) = cached_identity(target_dir) else {
        return;
    };
    // Empty string treated the same as `None` for both -- see
    // `hash_present_session_id`'s own doc comment.
    let hashed_session_id = hash_present_session_id(&identity.uuid, session_id.as_deref());
    let hashed_parent_session_id =
        hash_present_session_id(&identity.uuid, parent_session_id.as_deref());
    send_event(
        target_dir,
        EventType::SubagentInvocation,
        specialist_name,
        &identity.uuid,
        hashed_session_id,
        hashed_parent_session_id,
        None,
        None,
    );
}

/// `report_cli_error`: the one exception to the skip-on-
/// `None` rule. `no_telemetry` carries `--no-telemetry`'s parsed value
/// into the one call site (`command == "install"`) where the
/// identity cache alone cannot disambiguate "opted out" from "hasn't
/// installed yet". Every non-`install` call site passes `false`, a value
/// never inspected for those commands.
///
/// `no_telemetry` is checked UNCONDITIONALLY, before `cached_identity`
/// is even consulted -- not just inside the `None` arm below. A prior
/// successful install (this exact target already carries a valid
/// `.konductor/telemetry-id.json`, e.g. from before `--no-telemetry` was
/// passed on a later, failing invocation) makes `cached_identity`
/// return `Some(_)`; without this early return, that `Some` arm would
/// report the error regardless of `no_telemetry`, silently ignoring the
/// opt-out on every invocation that happens to already have an
/// identity on disk. Checking it here, before the match, makes the
/// opt-out unconditional and structural -- never
/// "invoked then checked" -- for every caller, identity present or not.
pub(crate) fn report_cli_error(
    target_dir: &std::path::Path,
    command: &str,
    error_code: &str,
    no_telemetry: bool,
) {
    if no_telemetry {
        return;
    }
    report_cli_error_with_identity(target_dir, command, error_code, cached_identity(target_dir));
}

/// Same event and `no_telemetry`/nil-UUID-sentinel contract as
/// `report_cli_error`, but resolves `target_dir`'s identity directly via
/// `read_identity_uncached` instead of the process-global cache --
/// use this from a `--all` batch call
/// site that visits more than one `target_dir` in one process. Without
/// this, `update.rs`'s `dispatch_update_all_json` (JSON batch) and
/// `update_one_target`'s failure arm (plain-text `--all`, which shares
/// the identical per-target loop) would report every failing target
/// AFTER the first under the FIRST target's cached UUID -- the exact
/// misattribution `report_package_uninstalled_for_target`/
/// `report_package_version_updated_for_target` already exist to avoid
/// for their own (success-path) events.
pub(crate) fn report_cli_error_for_target(
    target_dir: &std::path::Path,
    command: &str,
    error_code: &str,
    no_telemetry: bool,
) {
    if no_telemetry {
        return;
    }
    report_cli_error_with_identity_for_target(
        target_dir,
        command,
        error_code,
        read_identity_uncached(target_dir),
    );
}

/// Shared core for `report_cli_error`/`report_cli_error_for_target`:
/// given an ALREADY-resolved `identity` (cached or uncached, per the
/// caller), sends the `cli_error` event or falls back to the nil-UUID
/// sentinel -- kept as one function so the two callers' identical
/// `Some`/`None` handling (and the nil-UUID sentinel's `command ==
/// "install"` gate) can never drift apart.
fn report_cli_error_with_identity(
    target_dir: &std::path::Path,
    command: &str,
    error_code: &str,
    identity: Option<IdentityRecord>,
) {
    match identity {
        Some(identity) => send_event(
            target_dir,
            EventType::CliError,
            command,
            &identity.uuid,
            None,
            None,
            Some(error_code.to_string()),
            Some(identity.harness),
        ),
        None => {
            // `no_telemetry` has already been handled by the caller's
            // own early return, so the only remaining question is
            // whether this is the one command that fires under the
            // nil-UUID sentinel pre-identity.
            if command == "install" {
                // Install failed before identity existed -- fire under
                // the nil-UUID sentinel rather than skipping.
                send_event(
                    target_dir,
                    EventType::CliError,
                    command,
                    NIL_UUID_SENTINEL,
                    None,
                    None,
                    Some(error_code.to_string()),
                    // `harness` is unknown pre-identity; there is no
                    // install-strategy record to read it from yet.
                    None,
                );
            }
            // Otherwise: a non-install command with no prior successful
            // install -- skip.
        }
    }
}

/// Same event and fallback-sentinel contract as
/// `report_cli_error_with_identity`, but sends via `send_event_for_target`
/// (uncached endpoint resolution, same per-repo-config concern
/// `resolve_endpoint_with_pin_uncached` exists for) instead of
/// `send_event` -- used by `report_cli_error_for_target`, the `--all`
/// batch call site that visits more than one `target_dir` in one process.
fn report_cli_error_with_identity_for_target(
    target_dir: &std::path::Path,
    command: &str,
    error_code: &str,
    identity: Option<IdentityRecord>,
) {
    match identity {
        Some(identity) => send_event_for_target(
            target_dir,
            EventType::CliError,
            command,
            &identity.uuid,
            None,
            None,
            Some(error_code.to_string()),
            Some(identity.harness),
        ),
        None => {
            if command == "install" {
                send_event_for_target(
                    target_dir,
                    EventType::CliError,
                    command,
                    NIL_UUID_SENTINEL,
                    None,
                    None,
                    Some(error_code.to_string()),
                    None,
                );
            }
        }
    }
}

/// `report_package_uninstalled`: fired by `uninstall_one_impl`
/// only AFTER every fallible step of that uninstall has already
/// succeeded (manifest read, eligible-file deletion, manifest removal,
/// index-entry removal) -- so a success event is never sent for an
/// uninstall that goes on to fail with an `UninstallError`. Still fires
/// BEFORE the identity file itself is deleted, so
/// `.konductor/telemetry-id.json` still exists to read at the moment
/// this call resolves it. Every failure mode -- missing, unreadable,
/// malformed, unsupported `schema_version` -- is folded into the same
/// skip-on-`None` tolerance; none of these becomes an `UninstallError`.
///
/// Uses the process-global identity cache -- correct for the
/// single-target call sites (`dispatch_target`/the lone-tracked-install
/// path), WRONG for a `--all` batch over several distinct targets (see
/// `report_package_uninstalled_for_target`, which `dispatch_all` uses
/// instead).
pub(crate) fn report_package_uninstalled(target_dir: &std::path::Path) {
    let Some(identity) = cached_identity(target_dir) else {
        return;
    };
    send_event(
        target_dir,
        EventType::PackageUninstalled,
        identity.harness.clone(),
        &identity.uuid,
        None,
        None,
        None,
        None,
    );
}

/// Same event as `report_package_uninstalled`, but resolves `target_dir`'s
/// identity directly via `read_identity_uncached` instead of the
/// process-global cache. Use this from a
/// `--all` loop that visits more than one `target_dir` in one process --
/// each target's own UUID is read fresh, rather than every target after
/// the first inheriting whichever UUID the cache happened to resolve
/// first.
pub(crate) fn report_package_uninstalled_for_target(target_dir: &std::path::Path) {
    let Some(identity) = read_identity_uncached(target_dir) else {
        return;
    };
    send_event_for_target(
        target_dir,
        EventType::PackageUninstalled,
        identity.harness.clone(),
        &identity.uuid,
        None,
        None,
        None,
        None,
    );
}

/// `report_package_installed`: fired once `install_from_local`
/// and index finalize have both already succeeded, alongside the
/// existing `report_install_success` call.
pub(crate) fn report_package_installed(target_dir: &std::path::Path, harness: &str) {
    let Some(identity) = cached_identity(target_dir) else {
        return;
    };
    send_event(
        target_dir,
        EventType::PackageInstalled,
        harness,
        &identity.uuid,
        None,
        None,
        None,
        None,
    );
}

/// `report_package_version_updated`: fired once
/// `strategy.install_from_local` has already succeeded, before
/// `run_update_one_target`'s trailing `match manifest::read_manifest`.
///
/// Uses the process-global identity cache -- correct for a
/// single-target run, WRONG for a `--all` batch over several distinct
/// targets in one process (see `report_package_version_updated_for_target`,
/// which `dispatch_update_all_json`'s per-target loop uses instead).
pub(crate) fn report_package_version_updated(target_dir: &std::path::Path, harness: &str) {
    let Some(identity) = cached_identity(target_dir) else {
        return;
    };
    send_event(
        target_dir,
        EventType::PackageVersionUpdated,
        harness,
        &identity.uuid,
        None,
        None,
        None,
        None,
    );
}

/// Same event as `report_package_version_updated`, but resolves
/// `target_dir`'s identity directly via `read_identity_uncached`
/// instead of the process-global cache -- every target in an `update
/// --all` run has its own
/// `.konductor/telemetry-id.json` and its own UUID; the cache only
/// ever resolves the first target's.
pub(crate) fn report_package_version_updated_for_target(
    target_dir: &std::path::Path,
    harness: &str,
) {
    let Some(identity) = read_identity_uncached(target_dir) else {
        return;
    };
    send_event_for_target(
        target_dir,
        EventType::PackageVersionUpdated,
        harness,
        &identity.uuid,
        None,
        None,
        None,
        None,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, MutexGuard};

    /// Test-only shared lock for every `resolve_endpoint_*` test below
    /// that mutates the process-global `TELEMETRY_OFF_ENV_VAR`
    /// (`KONDUCTOR_TELEMETRY`) / `TELEMETRY_ENDPOINT_ENV_VAR`
    /// (`KONDUCTOR_METRICS_ENDPOINT`) / `TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR`
    /// (`KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT`) env vars -- `std::env::set_var`/
    /// `remove_var` have no per-thread scoping, so two of these tests
    /// running concurrently under `cargo test`'s default multi-threaded
    /// harness could each mutate the SAME process-wide var at once and
    /// observe a torn or unrelated value (the exact hazard
    /// `crate::cli::test_home_lock::HOME_ENV_LOCK` exists to prevent for
    /// `HOME` mutations elsewhere in this crate).
    ///
    /// A SEPARATE lock from `HOME_ENV_LOCK`, not a reuse of it: none of
    /// the `resolve_endpoint_*` tests below touch `HOME` (`resolve_endpoint`
    /// itself never reads it -- only `target_dir`'s own
    /// `.konductor/config.yml`), and no `HOME`-mutating test anywhere in
    /// this crate touches `KONDUCTOR_TELEMETRY`/`KONDUCTOR_METRICS_ENDPOINT`.
    /// The two var sets are never touched by the same test, so there is
    /// no cross-set race to guard against -- only the same-set race
    /// within this module's own five tests -- and a dedicated lock keeps
    /// that scope local instead of serializing against every unrelated
    /// `HOME`-mutating test in the crate.
    static TELEMETRY_ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Acquires `TELEMETRY_ENV_LOCK`, recovering the guard even if a
    /// previous holder panicked while it was held -- same poison-recovery
    /// rationale as `test_home_lock::lock_home`, so one failing assertion
    /// here never cascades into every later test in this module also
    /// failing with `PoisonError`.
    fn lock_telemetry_env() -> MutexGuard<'static, ()> {
        TELEMETRY_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// `docs/telemetry-schema.json`'s own `properties.sessionId.pattern`
    /// -- read from the real, checked-in schema file (never a second,
    /// hand-typed copy of the pattern string) so this test fails loudly
    /// if the schema's own regex ever drifts from what this module's
    /// `hash_session_id` is assumed to satisfy.
    fn session_id_pattern_from_schema() -> String {
        let schema_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../docs/telemetry-schema.json");
        let contents = fs::read_to_string(&schema_path).unwrap_or_else(|e| {
            panic!(
                "failed to read {} (expected the checked-in telemetry schema): {e}",
                schema_path.display()
            )
        });
        let schema: serde_json::Value = serde_json::from_str(&contents).unwrap();
        schema["properties"]["sessionId"]["pattern"]
            .as_str()
            .expect("schema must declare properties.sessionId.pattern as a string")
            .to_string()
    }

    /// Anchored matcher for the EXACT pattern
    /// `session_id_pattern_from_schema` is asserted (immediately below,
    /// in the test that calls this) to equal --
    /// `^[a-f0-9]{64}$` -- rather than a general-purpose regex engine
    /// this crate has no other need for. Deliberately stricter than
    /// `char::is_ascii_hexdigit()` (which also accepts uppercase A-F):
    /// the schema's pattern is lowercase-only, matching `sha256_hex()`'s
    /// own documented output shape.
    fn matches_lowercase_hex_64(value: &str) -> bool {
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }

    #[test]
    fn hash_session_id_output_matches_schemas_session_id_pattern() {
        // Pin the assumption `matches_lowercase_hex_64` encodes against
        // the schema's own real pattern string -- if the schema's regex
        // ever changes shape, this fails here rather than the value
        // check below silently passing against a stale hand-rolled
        // matcher.
        assert_eq!(session_id_pattern_from_schema(), "^[a-f0-9]{64}$");

        let hashed = hash_session_id(&"a".repeat(64), "real-claude-code-session-id-value");
        assert!(
            matches_lowercase_hex_64(&hashed),
            "hash_session_id output {hashed:?} must match the schema's own \
             sessionId pattern ^[a-f0-9]{{64}}$ -- exactly 64 lowercase hex chars, \
             no uppercase"
        );
    }

    #[test]
    fn hash_session_id_is_deterministic_and_uuid_scoped() {
        // Same UUID + same raw session id -> identical hash (the join
        // key must be reproducible across independent report_* calls in
        // the same process/session).
        assert_eq!(
            hash_session_id(&"a".repeat(64), "session-123"),
            hash_session_id(&"a".repeat(64), "session-123")
        );
        // Same raw runtime session id under a DIFFERENT install's UUID
        // must hash to a DIFFERENT wire value -- the UUID, not the raw
        // runtime session id itself, is this design's own join key.
        assert_ne!(
            hash_session_id(&"a".repeat(64), "session-123"),
            hash_session_id(&"b".repeat(64), "session-123")
        );
    }

    /// Fix regression: an empty-string raw session id must be treated
    /// the same as a fully-absent (`None`) one -- `hash_session_id`
    /// itself never fails on empty input, so without
    /// `hash_present_session_id`'s own filter a present-but-empty value
    /// would hash into a valid-looking-but-meaningless 64-hex
    /// `sessionId`, silently masquerading as a real session identifier
    /// on the wire. Tests the shared helper directly (not
    /// `report_agent_invocation`/`report_subagent_invocation`
    /// themselves, which are gated by `IDENTITY_CACHE`'s process-global
    /// `OnceLock` and so cannot be exercised meaningfully from a unit
    /// test in this shared process -- see that constant's own doc
    /// comment).
    #[test]
    fn hash_present_session_id_treats_empty_string_as_absent() {
        assert_eq!(hash_present_session_id(&"a".repeat(64), Some("")), None);
        assert_eq!(hash_present_session_id(&"a".repeat(64), None), None);
    }

    /// The positive control for the test above: a genuinely non-empty
    /// raw session id must still hash normally, matching
    /// `hash_session_id`'s own direct output -- proving the empty-string
    /// filter doesn't also swallow real values.
    #[test]
    fn hash_present_session_id_hashes_a_non_empty_value_normally() {
        let uuid = "a".repeat(64);
        assert_eq!(
            hash_present_session_id(&uuid, Some("real-session-id")),
            Some(hash_session_id(&uuid, "real-session-id"))
        );
    }

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-report-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn resolve_endpoint_falls_back_to_compile_time_default() {
        let _lock = lock_telemetry_env();
        let dir = scratch_dir("endpoint-default");
        // No env var, no config.yml -- must resolve to the compile-time
        // default rather than None.
        std::env::remove_var(TELEMETRY_ENDPOINT_ENV_VAR);
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        let resolved = resolve_endpoint(&dir);
        assert_eq!(resolved, Some(DEFAULT_TELEMETRY_ENDPOINT.to_string()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_endpoint_respects_disabled_flag() {
        let _lock = lock_telemetry_env();
        let dir = scratch_dir("endpoint-disabled");
        let config_dir = dir.join(super::super::super::config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join(super::super::super::config::CONFIG_FILE_NAME),
            "telemetry:\n  enabled: false\n",
        )
        .unwrap();
        std::env::remove_var(TELEMETRY_ENDPOINT_ENV_VAR);
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        assert_eq!(resolve_endpoint(&dir), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_endpoint_respects_fleet_wide_telemetry_off_env_var() {
        let _lock = lock_telemetry_env();
        let dir = scratch_dir("endpoint-fleet-off");
        // Even a repo that explicitly opts BACK IN via its own checked-in
        // config must not override the fleet-wide env var -- the
        // env var is the
        // fleet-managed override, checked ahead of a per-repo config.
        let config_dir = dir.join(super::super::super::config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join(super::super::super::config::CONFIG_FILE_NAME),
            "telemetry:\n  enabled: true\n",
        )
        .unwrap();
        std::env::remove_var(TELEMETRY_ENDPOINT_ENV_VAR);
        std::env::set_var(TELEMETRY_OFF_ENV_VAR, TELEMETRY_OFF_VALUE);
        let resolved = resolve_endpoint(&dir);
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        assert_eq!(
            resolved, None,
            "KONDUCTOR_TELEMETRY=off must disable telemetry regardless of a repo's own \
             telemetry.enabled: true"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_endpoint_ignores_telemetry_env_var_when_not_exactly_off() {
        let _lock = lock_telemetry_env();
        let dir = scratch_dir("endpoint-fleet-not-off");
        std::env::remove_var(TELEMETRY_ENDPOINT_ENV_VAR);
        std::env::set_var(TELEMETRY_OFF_ENV_VAR, "OFF");
        let resolved = resolve_endpoint(&dir);
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        assert_eq!(
            resolved,
            Some(DEFAULT_TELEMETRY_ENDPOINT.to_string()),
            "only the exact value \"off\" disables telemetry -- a differently-cased or \
             otherwise different value must not"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_endpoint_prefers_config_endpoint_over_default() {
        let _lock = lock_telemetry_env();
        let dir = scratch_dir("endpoint-config");
        let config_dir = dir.join(super::super::super::config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join(super::super::super::config::CONFIG_FILE_NAME),
            "telemetry:\n  endpoint: \"https://example.com/custom\"\n",
        )
        .unwrap();
        std::env::remove_var(TELEMETRY_ENDPOINT_ENV_VAR);
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        assert_eq!(
            resolve_endpoint(&dir),
            Some("https://example.com/custom".to_string())
        );
        fs::remove_dir_all(&dir).ok();
    }

    // ── Host allowlist (security gate) ──────────────────────────────────
    //
    // The pure classification/parsing primitives this security gate is
    // built on (`extract_host`, `is_disallowed_local_host`,
    // `is_disallowed_ip`, `classify_resolved_addrs`, `build_resolve_arg`,
    // `extract_port`, `run_with_timeout`) now live in the `telemetry-net`
    // crate and are exercised by its own test suite -- see that crate's
    // `src/lib.rs`. The tests below stay in THIS module because they
    // exercise this crate's own glue around that shared logic (env var
    // and `.konductor/config.yml` resolution, the escape hatch, and the
    // end-to-end `endpoint_host_is_allowed_with_pin` decision), which
    // has no equivalent in the shared crate.

    /// FINDING regression (DNS resolution): `resolved_addresses_include_disallowed_host`
    /// must flag a host based on what it actually resolves to, not the
    /// literal string. A host that IS a bare IP literal never touches
    /// the resolver at all (`ToSocketAddrs` parses it directly), so
    /// this exercises the exact code path a real hostname resolving to
    /// a disallowed address would take, deterministically and without
    /// requiring network access in the test environment.
    #[test]
    fn resolved_addresses_include_disallowed_host_flags_a_resolved_loopback_or_private_literal() {
        assert!(resolved_addresses_include_disallowed_host("127.0.0.1"));
        assert!(resolved_addresses_include_disallowed_host("10.0.0.1"));
        assert!(resolved_addresses_include_disallowed_host("::1"));
        // The same IPv4-mapped-IPv6 unmapping gap, exercised through the
        // resolution path rather than the literal-string path.
        assert!(resolved_addresses_include_disallowed_host(
            "::ffff:127.0.0.1"
        ));
    }

    #[test]
    fn resolved_addresses_include_disallowed_host_accepts_a_resolved_public_literal() {
        assert!(!resolved_addresses_include_disallowed_host("192.0.2.1"));
    }

    /// Pins the "unresolvable is not itself disallowed" contract using a
    /// dedicated fixture host: `telemetry.konductor.example.invalid` sits
    /// under the reserved `.invalid` TLD (RFC 2606), guaranteed to never
    /// resolve. If a failed resolution were treated as disallowed, any
    /// endpoint under a never-resolving domain would be rejected outright
    /// the moment DNS resolution was added to this check.
    #[test]
    fn resolved_addresses_include_disallowed_host_does_not_flag_an_unresolvable_host() {
        assert!(!resolved_addresses_include_disallowed_host(
            "telemetry.konductor.example.invalid"
        ));
    }

    /// End-to-end regression guard: the compile-time default endpoint
    /// (a real, public AWS Solutions metrics host) must be reported as
    /// `allowed` by the same DNS-backed check that rejects loopback and
    /// private-range hosts.
    #[test]
    fn endpoint_host_is_allowed_accepts_the_compile_time_default_endpoint_host() {
        assert!(endpoint_host_is_allowed(DEFAULT_TELEMETRY_ENDPOINT));
    }

    // ── Bounded DNS resolution and the timeout-vs-failure distinction
    // (see telemetry-net's own test suite
    // for `run_with_timeout`/`resolve_host_addrs_bounded`/`decide_pin`
    // coverage; the tests below exercise this crate's own
    // `endpoint_host_is_allowed_with_pin` wrapper end-to-end) ───────────

    /// Property (b): a TIMEOUT must be denied outright, never folded
    /// into the same fail-open, no-pin outcome a genuine resolution
    /// failure gets -- the exact CRITICAL regression
    /// the shared `telemetry_net::decide_pin` fixes.
    /// Exercised directly against the shared decision function this
    /// module's own `endpoint_host_is_allowed_with_pin` delegates to
    /// (rather than forcing a real 500ms timeout in this test), so the
    /// property is pinned regardless of local resolver latency.
    #[test]
    fn decide_pin_denies_a_timeout_outcome_rather_than_failing_open() {
        assert_eq!(
            telemetry_net::decide_pin(telemetry_net::DnsOutcome::TimedOut),
            None,
            "a TimedOut outcome must be denied, not treated the same as a resolution failure"
        );
    }

    /// Property (a) (unchanged by the timeout fix): a genuine resolution
    /// failure still fails open with nothing to pin.
    #[test]
    fn decide_pin_fails_open_for_a_genuine_resolution_failure() {
        assert_eq!(
            telemetry_net::decide_pin(telemetry_net::DnsOutcome::Failed),
            Some(None)
        );
    }

    // ── Adversarial finding: DNS-rebinding TOCTOU (curl --resolve pin) ──

    /// `endpoint_host_is_allowed_with_pin` must produce NOTHING to pin
    /// for an IP literal -- `ToSocketAddrs` never queries a resolver for
    /// one, so there is no TOCTOU window for `curl --resolve` to close.
    #[test]
    fn endpoint_host_is_allowed_with_pin_returns_no_pin_for_an_ip_literal() {
        let _lock = lock_telemetry_env();
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        assert_eq!(
            endpoint_host_is_allowed_with_pin("https://192.0.2.1/x"),
            Some(None)
        );
    }

    /// Same "nothing to pin" contract for an unresolvable hostname
    /// (fail-open, matching `resolved_addresses_include_disallowed_host`'s
    /// own contract) -- there is no resolved address to reuse as a pin.
    /// Uses a dedicated `.invalid`-TLD fixture host rather than
    /// `DEFAULT_TELEMETRY_ENDPOINT`: the compile-time default is now a
    /// real, resolvable public host, so it no longer exercises this
    /// "unresolvable" branch.
    #[test]
    fn endpoint_host_is_allowed_with_pin_returns_no_pin_for_an_unresolvable_host() {
        let _lock = lock_telemetry_env();
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        assert_eq!(
            endpoint_host_is_allowed_with_pin(
                "https://telemetry.konductor.example.invalid/collector"
            ),
            Some(None)
        );
    }

    /// The escape hatch bypasses validation (and therefore pinning)
    /// entirely -- a developer who explicitly opted into an arbitrary
    /// local endpoint gets no pin interference.
    #[test]
    fn endpoint_host_is_allowed_with_pin_returns_no_pin_when_escape_hatch_is_set() {
        let _lock = lock_telemetry_env();
        std::env::set_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR, "1");
        let result = endpoint_host_is_allowed_with_pin("https://127.0.0.1:4318/collector");
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        assert_eq!(result, Some(None));
    }

    #[test]
    fn endpoint_host_is_allowed_with_pin_rejects_a_disallowed_literal() {
        let _lock = lock_telemetry_env();
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        assert_eq!(
            endpoint_host_is_allowed_with_pin("https://10.0.0.1/x"),
            None
        );
    }

    /// The CRITICAL regression this fix addresses: an attacker (or a
    /// misconfigured shared CI environment) with only config-write or
    /// env-var-set access could otherwise redirect telemetry to a
    /// loopback/private-range host by setting `KONDUCTOR_METRICS_ENDPOINT`
    /// -- `resolve_endpoint` must reject it (return `None`), not send.
    #[test]
    fn resolve_endpoint_rejects_private_range_endpoint_from_env_var() {
        let _lock = lock_telemetry_env();
        let dir = scratch_dir("endpoint-private-range-rejected");
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        std::env::set_var(TELEMETRY_ENDPOINT_ENV_VAR, "https://192.168.1.50/collector");
        let resolved = resolve_endpoint(&dir);
        std::env::remove_var(TELEMETRY_ENDPOINT_ENV_VAR);
        assert_eq!(
            resolved, None,
            "a private-range endpoint must be rejected, not sent to"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Same attack, but a loopback host via `.konductor/config.yml`
    /// (the OTHER override tier) -- confirms the check applies
    /// regardless of which tier resolved the endpoint.
    #[test]
    fn resolve_endpoint_rejects_loopback_endpoint_from_config() {
        let _lock = lock_telemetry_env();
        let dir = scratch_dir("endpoint-loopback-config-rejected");
        let config_dir = dir.join(super::super::super::config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join(super::super::super::config::CONFIG_FILE_NAME),
            "telemetry:\n  endpoint: \"https://127.0.0.1:4318/collector\"\n",
        )
        .unwrap();
        std::env::remove_var(TELEMETRY_ENDPOINT_ENV_VAR);
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        assert_eq!(resolve_endpoint(&dir), None);
        fs::remove_dir_all(&dir).ok();
    }

    /// The debug-only escape hatch: with
    /// `KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT` set, the SAME loopback
    /// endpoint that the test above rejects must now resolve normally --
    /// proving the escape hatch is real and correctly gated behind an
    /// explicit, clearly-named opt-in rather than silently always-on.
    #[test]
    fn resolve_endpoint_escape_hatch_allows_loopback_endpoint_when_explicitly_set() {
        let _lock = lock_telemetry_env();
        let dir = scratch_dir("endpoint-loopback-escape-hatch");
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        std::env::set_var(
            TELEMETRY_ENDPOINT_ENV_VAR,
            "https://127.0.0.1:4318/collector",
        );
        std::env::set_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR, "1");
        let resolved = resolve_endpoint(&dir);
        std::env::remove_var(TELEMETRY_ENDPOINT_ENV_VAR);
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        assert_eq!(
            resolved,
            Some("https://127.0.0.1:4318/collector".to_string()),
            "the explicit debug-only escape hatch must allow a loopback endpoint through"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn materialized_script_path_exists_and_is_executable_after_first_call() {
        use std::os::unix::fs::PermissionsExt;

        let _home = HomeGuard::new("materialize-exists-executable");
        let path = materialize_script().expect("must materialize");
        assert!(path.exists());
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode & 0o100, 0o100, "must be executable by owner");
    }

    #[test]
    fn materialize_script_is_idempotent_when_already_matching() {
        let _home = HomeGuard::new("materialize-idempotent");
        let first = materialize_script().unwrap();
        let mtime_before = fs::metadata(&first).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let second = materialize_script().unwrap();
        let mtime_after = fs::metadata(&second).unwrap().modified().unwrap();
        assert_eq!(first, second);
        assert_eq!(
            mtime_before, mtime_after,
            "an already-matching script must not be rewritten"
        );
    }

    /// The portability regression this fix addresses: a real dry-run
    /// build container with `HOME` unset failed this exact call with
    /// `Custom { kind: NotFound, error: "HOME is not set" }` before the
    /// fallback existed. Confirms `materialize_script` now succeeds with
    /// `HOME` unset, AND that the fallback directory it lands in still
    /// carries the same non-world-writable `0o700` property the
    /// `HOME`-set path has -- the portability fix must not regress the
    /// TOCTOU/symlink security fix.
    #[test]
    fn materialize_script_succeeds_with_home_unset_and_uses_private_fallback_dir() {
        use std::os::unix::fs::PermissionsExt;

        let _guard = NoHomeGuard::new();
        let path = materialize_script().expect(
            "materialize_script must succeed even when HOME is unset (falls back to \
             std::env::temp_dir()-based private dir)",
        );
        assert!(path.exists());

        let script_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            script_mode & 0o100,
            0o100,
            "must be executable by owner even on the fallback path"
        );

        let dir = path.parent().unwrap();
        assert!(
            dir.starts_with(std::env::temp_dir()),
            "HOME-unset fallback must live under std::env::temp_dir(), got {}",
            dir.display()
        );
        let dir_mode = fs::metadata(dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            dir_mode, 0o700,
            "HOME-unset fallback dir must still be private (0o700), not world-writable"
        );
    }

    /// RAII guard for `materialize_script_succeeds_with_home_unset_...`:
    /// removes `HOME` entirely (rather than pointing it at a scratch
    /// dir, like `HomeGuard` does) for its entire lifetime, under the
    /// same crate-wide `HOME_ENV_LOCK` every other `HOME`-mutating test
    /// in this crate uses, so this test never races a concurrently
    /// running test that expects `HOME` to be set.
    struct NoHomeGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        original_home: Option<std::ffi::OsString>,
    }

    impl NoHomeGuard {
        fn new() -> Self {
            let lock = crate::cli::test_home_lock::lock_home();
            let original_home = std::env::var_os("HOME");
            // SAFETY: held for this guard's entire lifetime under
            // HOME_ENV_LOCK; restored on Drop before the lock releases.
            unsafe {
                std::env::remove_var("HOME");
            }
            Self {
                _lock: lock,
                original_home,
            }
        }
    }

    impl Drop for NoHomeGuard {
        fn drop(&mut self) {
            // SAFETY: see NoHomeGuard::new.
            unsafe {
                match &self.original_home {
                    Some(value) => std::env::set_var("HOME", value),
                    None => std::env::remove_var("HOME"),
                }
            }
        }
    }

    /// RAII guard for the two tests above, which call `materialize_script`
    /// and therefore transitively read the process-global `$HOME` (via
    /// `private_script_dir`'s TOCTOU/symlink fix). Acquires the
    /// crate-wide `test_home_lock::HOME_ENV_LOCK` for its entire
    /// lifetime and points `HOME` at a fresh scratch dir -- without
    /// this, a concurrently-running test elsewhere in the crate that
    /// also mutates `HOME` (every other module's own `HomeGuard`) can
    /// interleave with these two tests' two separate
    /// `materialize_script()` calls, making each call resolve a
    /// DIFFERENT `$HOME/.konductor/tmp` and fail the "same path"
    /// assertion despite both calls being correct in isolation. See
    /// `crate::cli::test_home_lock`'s own doc comment for the general
    /// rationale (module-private locks did not serialize across
    /// modules).
    struct HomeGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        scratch: std::path::PathBuf,
        original_home: Option<std::ffi::OsString>,
    }

    impl HomeGuard {
        fn new(label: &str) -> Self {
            let lock = crate::cli::test_home_lock::lock_home();
            let scratch = scratch_dir(label);
            let original_home = std::env::var_os("HOME");
            // SAFETY: held for this guard's entire lifetime under
            // HOME_ENV_LOCK, so no other HOME-mutating test anywhere in
            // this crate observes an interleaved value; restored on
            // Drop before the lock releases.
            unsafe {
                std::env::set_var("HOME", &scratch);
            }
            Self {
                _lock: lock,
                scratch,
                original_home,
            }
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            // SAFETY: see HomeGuard::new.
            unsafe {
                match &self.original_home {
                    Some(value) => std::env::set_var("HOME", value),
                    None => std::env::remove_var("HOME"),
                }
            }
            fs::remove_dir_all(&self.scratch).ok();
        }
    }

    // `report_cli_error`'s `no_telemetry` short-circuit (the top-level
    // early return above) interacting with `IDENTITY_CACHE`'s
    // once-per-process semantics is NOT unit-tested here: `OnceLock` has
    // no safe reset, and `cargo test` runs every test in this module
    // inside one shared process, so the first test to populate
    // `IDENTITY_CACHE` would silently poison every later test's
    // expectations -- exactly the scenario this regression needs (a
    // pre-existing identity already cached when `--no-telemetry` is
    // passed) cannot be set up cleanly at the unit level. That specific
    // interaction is exercised instead by
    // `tests/telemetry_report_process.rs`, which spawns the real
    // `konductor` binary as a fresh subprocess per case -- the same
    // process-boundary guarantee this module's own design relies on.
    // The
    // OTHER `report_*` functions' own skip-on-missing-identity behavior
    // (`report_package_installed`/`report_agent_invocation`/etc.) is not
    // separately covered by that file today -- it shares the same
    // `OnceLock` constraint but is not the regression that file was
    // written to close.

    /// Writes a well-formed `.konductor/telemetry-id.json` directly at
    /// `target_dir`, matching `identity.rs`'s own on-disk schema exactly
    /// -- same shape `tests/telemetry_report_process.rs`'s own
    /// `seed_preexisting_identity` helper uses, duplicated here (not
    /// imported) since this module's tests run in-process and that
    /// file's helper is private to its own crate-external test binary.
    fn write_identity_fixture(target_dir: &std::path::Path, uuid: &str) {
        let konductor_dir = target_dir.join(super::super::super::config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(
            konductor_dir.join("telemetry-id.json"),
            format!(
                r#"{{"schema_version":1,"version":"0.1.0","UUID":"{uuid}","harness":"kiro-cli"}}"#
            ),
        )
        .unwrap();
    }

    /// Regression test: `read_identity_uncached`
    /// -- the primitive `report_cli_error_for_target` relies on to avoid
    /// the exact misattribution across batch targets -- must resolve
    /// EACH target's own identity directly from disk, regardless of
    /// what `IDENTITY_CACHE`'s process-global `OnceLock` already holds
    /// for a DIFFERENT target. Unlike the no-telemetry/cache interaction
    /// noted just above (which needs a specific, controlled initial
    /// cache state this shared test process cannot guarantee), THIS
    /// test asserts nothing about the cache's own value -- only that
    /// the UNCACHED read for target B is correct no matter what the
    /// cache is currently poisoned to (by this call to
    /// `cached_identity(&target_a)`, or by any other test in this
    /// shared process that happened to populate it first) -- so it is
    /// safe to run alongside every other test in this module without
    /// depending on execution order.
    #[test]
    fn read_identity_uncached_returns_each_targets_own_identity_regardless_of_the_process_cache() {
        let target_a = scratch_dir("uncached-identity-target-a");
        let target_b = scratch_dir("uncached-identity-target-b");
        let uuid_a = "a".repeat(64);
        let uuid_b = "b".repeat(64);
        write_identity_fixture(&target_a, &uuid_a);
        write_identity_fixture(&target_b, &uuid_b);

        // Populate (or observe already-populated) IDENTITY_CACHE from
        // target A -- the exact process-global cache
        // `report_cli_error`'s CACHED path would (incorrectly, pre-fix)
        // reuse for every subsequent target in a `--all` batch,
        // regardless of which `target_dir` is passed.
        let _ = cached_identity(&target_a);

        let identity_b = read_identity_uncached(&target_b)
            .expect("target B has a valid identity file and must resolve uncached");
        assert_eq!(
            identity_b.uuid, uuid_b,
            "read_identity_uncached must resolve THIS target's own identity from disk, never \
             a value inherited from the process-global cache -- this is the exact primitive \
             report_cli_error_for_target relies on to avoid misattributing target B's \
             cli_error event to target A's UUID in a --all batch"
        );

        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
    }

    /// Regression test: `resolve_endpoint_with_pin_uncached`
    /// -- the primitive `send_event_for_target` relies on to avoid the
    /// exact per-repo-opt-out bypass this guards against -- must
    /// resolve EACH target's own `.konductor/config.yml` directly,
    /// regardless of what `ENDPOINT_CACHE`'s process-global `OnceLock`
    /// already holds for a DIFFERENT target. Mirrors
    /// `read_identity_uncached_returns_each_targets_own_identity_regardless_of_the_process_cache`
    /// above exactly: this test asserts nothing about the cache's own
    /// value -- only that the UNCACHED resolution for target B is
    /// correct no matter what the cache is currently poisoned to (by
    /// this call for target A, or by any other test in this shared
    /// process that happened to populate it first) -- so it is safe to
    /// run alongside every other test in this module without depending
    /// on execution order. The full batch-level regression (proving no
    /// `_for_target` sender reaches `ENDPOINT_CACHE` at all, across a
    /// real `update --all --json` run) is exercised by
    /// `tests/telemetry_report_process.rs`'s
    /// `update_all_json_batch_honors_each_targets_own_telemetry_opt_out`,
    /// which spawns a fresh subprocess per case instead.
    #[test]
    fn resolve_endpoint_with_pin_uncached_returns_each_targets_own_config_regardless_of_the_process_cache(
    ) {
        let target_a = scratch_dir("uncached-endpoint-target-a");
        let target_b = scratch_dir("uncached-endpoint-target-b");
        let konductor_dir_b = target_b.join(".konductor");
        fs::create_dir_all(&konductor_dir_b).unwrap();
        fs::write(
            konductor_dir_b.join("config.yml"),
            "telemetry:\n  enabled: false\n",
        )
        .unwrap();

        // Populate (or observe already-populated) ENDPOINT_CACHE from
        // target A -- the exact process-global cache the CRITICAL
        // pre-fix `send_event` path would (incorrectly) reuse for every
        // subsequent target in a `--all` batch, regardless of which
        // `target_dir` is passed or what that target's OWN config says.
        let _ = cached_endpoint_with_pin(&target_a);

        assert_eq!(
            resolve_endpoint_with_pin_uncached(&target_b),
            None,
            "resolve_endpoint_with_pin_uncached must resolve THIS target's own \
             .konductor/config.yml directly, never a value inherited from the \
             process-global cache -- this is the exact primitive send_event_for_target \
             relies on to avoid silently sending telemetry for target B despite its own \
             telemetry.enabled: false"
        );

        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
    }

    /// FINDING 2 regression: a symlink placed at the exact target path
    /// `create_private_dir_all` is asked to create must be detected and
    /// rejected (fail closed) rather than followed/used -- `chmod(2)`
    /// via `set_permissions` follows symlinks, so trusting one here
    /// would set `0o700` on whatever the symlink points to instead of a
    /// real private directory at the intended path.
    #[test]
    fn create_private_dir_all_rejects_symlink_at_target_path() {
        use std::os::unix::fs::PermissionsExt;

        let base = scratch_dir("symlink-target-rejected");
        let real_elsewhere = base.join("elsewhere");
        fs::create_dir_all(&real_elsewhere).unwrap();
        let target = base.join("private-tmp-dir");
        std::os::unix::fs::symlink(&real_elsewhere, &target).unwrap();

        let result = create_private_dir_all(&target);

        assert!(
            result.is_err(),
            "must fail closed when a symlink sits at the exact target path"
        );
        assert!(
            target.symlink_metadata().unwrap().file_type().is_symlink(),
            "the symlink itself must be left in place -- this function must not delete or replace it"
        );
        let elsewhere_mode = fs::metadata(&real_elsewhere).unwrap().permissions().mode() & 0o777;
        assert_ne!(
            elsewhere_mode, 0o700,
            "must never chmod the symlink's target -- that would be the exact TOCTOU/symlink bug being fixed"
        );

        fs::remove_dir_all(&base).ok();
    }

    /// A genuine, ordinary directory (no symlink involved, owned by
    /// this process's own UID) must still succeed and end up `0o700` --
    /// confirms the new ownership/symlink checks don't break the normal
    /// case the function existed to serve in the first place.
    #[test]
    fn create_private_dir_all_succeeds_for_ordinary_owned_directory() {
        use std::os::unix::fs::PermissionsExt;

        let base = scratch_dir("ordinary-dir-still-works");
        let target = base.join("private-tmp-dir");

        create_private_dir_all(&target).expect("must succeed for an ordinary, self-owned path");

        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);

        fs::remove_dir_all(&base).ok();
    }

    // ── shell-side is_disallowed_ip mirror: unspecified-address and
    // hex-form IPv4-mapped address classification ──────────────
    //
    // These extract the `is_disallowed_ip` FUNCTION DEFINITION directly
    // out of `TELEMETRY_REPORT_SCRIPT` (the exact, checked-in transport
    // script text this crate embeds via `include_str!`) and re-run it
    // standalone via `sh`, bypassing the script's own top-level
    // `https://` endpoint gate -- proving the ACTUAL shipped shell
    // logic classifies each literal correctly, not a hand-written
    // reimplementation that could silently drift from what ships.

    /// Extracts `is_disallowed_ip`'s function body from the checked-in
    /// script by locating its opening `is_disallowed_ip() {` marker and
    /// the next line consisting solely of `}` -- the function's own
    /// body never contains a standalone `}` line (its only braces are
    /// the function's own opening/closing ones; `case`/`esac` and
    /// `${...}` parameter expansions use no other brace pairs), so this
    /// is an exact, unambiguous extent.
    fn extract_shell_is_disallowed_ip() -> &'static str {
        let marker = "is_disallowed_ip() {";
        let start = TELEMETRY_REPORT_SCRIPT
            .find(marker)
            .expect("script must define is_disallowed_ip() -- extraction marker not found");
        let body_start = start + marker.len();
        let close_offset = TELEMETRY_REPORT_SCRIPT[body_start..]
            .find("\n}\n")
            .expect("is_disallowed_ip's closing brace (a standalone \"}\" line) not found");
        &TELEMETRY_REPORT_SCRIPT[start..body_start + close_offset + "\n}".len()]
    }

    /// Runs the REAL, extracted `is_disallowed_ip` shell function
    /// against `addr`, returning whether it classified `addr` as
    /// disallowed (shell exit 0 == disallowed, matching the function's
    /// own documented "Returns 0 (shell true) if disallowed" contract).
    fn shell_is_disallowed_ip(addr: &str) -> bool {
        let driver = format!(
            "{}\nis_disallowed_ip \"$1\"\n",
            extract_shell_is_disallowed_ip()
        );
        let status = std::process::Command::new("sh")
            .arg("-c")
            .arg(driver)
            .arg("sh") // becomes $0 inside the -c script
            .arg(addr) // becomes $1, i.e. the function's own argument
            .status()
            .expect("failed to spawn sh to exercise the extracted is_disallowed_ip function");
        status.success()
    }

    /// Shell-side mirror check: the
    /// unspecified address literal must be rejected on both address
    /// families.
    #[test]
    fn shell_is_disallowed_ip_rejects_unspecified_addresses() {
        assert!(
            shell_is_disallowed_ip("0.0.0.0"),
            "0.0.0.0 must be rejected by the shell-side mirror"
        );
        assert!(
            shell_is_disallowed_ip("::"),
            ":: must be rejected by the shell-side mirror"
        );
    }

    /// Positive control: an address that merely LOOKS related to the
    /// unspecified literal (differs in the last octet, or a plain
    /// public address) must not be swept up by the new glob arm.
    #[test]
    fn shell_is_disallowed_ip_accepts_unspecified_lookalikes() {
        assert!(!shell_is_disallowed_ip("0.0.0.1"));
        assert!(!shell_is_disallowed_ip("192.0.2.1"));
    }

    /// The hex form of an IPv4-mapped
    /// IPv6 address (distinct from the dotted-decimal form already
    /// matched) must be rejected -- including a hextet with a dropped
    /// leading zero (`a00` for `0a00`, i.e. `10.0.0.x`), a case that is
    /// fragile for a purely glob-based fix.
    #[test]
    fn shell_is_disallowed_ip_rejects_hex_form_ipv4_mapped_addresses() {
        assert!(
            shell_is_disallowed_ip("::ffff:7f00:1"),
            "::ffff:7f00:1 (= ::ffff:127.0.0.1, loopback) must be rejected"
        );
        assert!(
            shell_is_disallowed_ip("::ffff:a00:1"),
            "::ffff:a00:1 (= ::ffff:10.0.0.1, private, dropped leading zero) must be rejected"
        );
    }

    /// Positive control called out by the finding itself: a blanket
    /// `::ffff:*:*` arm would incorrectly reject this genuinely public
    /// address in mapped hex form.
    #[test]
    fn shell_is_disallowed_ip_accepts_public_hex_mapped_address() {
        assert!(
            !shell_is_disallowed_ip("::ffff:808:808"),
            "::ffff:808:808 (= ::ffff:8.8.8.8, public) must NOT be rejected"
        );
    }

    /// Regression guard: the new hex-form arm and the unspecified-
    /// address arm must not have broken any pre-existing classification
    /// this function already made correctly.
    #[test]
    fn shell_is_disallowed_ip_still_classifies_preexisting_cases_correctly() {
        assert!(shell_is_disallowed_ip("127.0.0.1"));
        assert!(shell_is_disallowed_ip("::1"));
        assert!(shell_is_disallowed_ip("::ffff:127.0.0.1"));
        assert!(shell_is_disallowed_ip("fc00::1"));
        assert!(shell_is_disallowed_ip("fe80::1"));
        assert!(!shell_is_disallowed_ip("example.com"));
        assert!(!shell_is_disallowed_ip("192.0.2.1"));
    }

    /// The IPv4-mapped form of the
    /// unspecified address must be rejected in both its dotted-decimal
    /// and hex-hextet forms, matching the Rust-side `is_disallowed_ip`
    /// (which unmaps via `to_ipv4_mapped()` and rejects via
    /// `is_unspecified()`).
    #[test]
    fn shell_is_disallowed_ip_rejects_ipv4_mapped_unspecified_address() {
        assert!(
            shell_is_disallowed_ip("::ffff:0.0.0.0"),
            "::ffff:0.0.0.0 must be rejected"
        );
        assert!(
            shell_is_disallowed_ip("::ffff:0:0"),
            "::ffff:0:0 (hex form of ::ffff:0.0.0.0) must be rejected via the same recursion"
        );
    }

    /// This round's fix: RFC 6598 Shared Address Space / CGNAT
    /// (100.64.0.0/10) must be rejected, mirroring the Rust-side
    /// `is_shared_address_space_cgnat`. Exercised at both corners of
    /// the /10 and just outside both ends.
    #[test]
    fn shell_is_disallowed_ip_rejects_ipv4_shared_address_space_cgnat() {
        assert!(shell_is_disallowed_ip("100.64.0.1"));
        assert!(shell_is_disallowed_ip("100.127.255.255"));
        assert!(!shell_is_disallowed_ip("100.63.255.255"));
        assert!(!shell_is_disallowed_ip("100.128.0.0"));
    }

    /// The IPv4-mapped-IPv6 dotted-decimal arms carry their own CGNAT
    /// entries (mirroring the plain-IPv4 arms above), so a mapped CGNAT
    /// literal is rejected directly, and the hex form is rejected via
    /// its recursion into the dotted-decimal form -- both must match
    /// the Rust-side `is_disallowed_ip`, which unmaps via
    /// `to_ipv4_mapped()` before applying `is_shared_address_space_cgnat`.
    #[test]
    fn shell_is_disallowed_ip_rejects_ipv4_mapped_shared_address_space_cgnat() {
        assert!(
            shell_is_disallowed_ip("::ffff:100.64.0.1"),
            "::ffff:100.64.0.1 (mapped dotted-decimal CGNAT) must be rejected"
        );
        assert!(
            shell_is_disallowed_ip("::ffff:6440:1"),
            "::ffff:6440:1 (hex form embedding 100.64.0.1, CGNAT) must be rejected via recursion \
             into the mapped dotted-decimal arm"
        );
        assert!(
            !shell_is_disallowed_ip("::ffff:808:808"),
            "::ffff:808:808 (mapped hex form of 8.8.8.8, a genuinely public address) must remain \
             accepted"
        );
    }

    /// This round's fix: 6to4 (2002::/16) must unmap its embedded IPv4
    /// address (bits 16-48) and classify by it, mirroring the Rust-side
    /// `six_to_four_embedded_ipv4`. "2002:6440:1::" embeds 100.64.0.1
    /// (CGNAT) -- the same case the Rust-side test uses to show the
    /// unmapping is security-relevant on its own, not just a
    /// notational nicety.
    #[test]
    fn shell_is_disallowed_ip_unmaps_6to4_and_classifies_embedded_address() {
        assert!(
            shell_is_disallowed_ip("2002:6440:1::"),
            "2002:6440:1:: embeds 100.64.0.1 (CGNAT) and must be rejected"
        );
        assert!(
            !shell_is_disallowed_ip("2002:c000:201::"),
            "2002:c000:201:: embeds 192.0.2.1 (TEST-NET-1, allowed by this crate's own \
             threat model) and must NOT be rejected -- positive control"
        );
    }

    /// This round's fix: the NAT64 Well-Known Prefix (64:ff9b::/96)
    /// must unmap its embedded IPv4 address (the low 32 bits) and
    /// classify by it, mirroring the Rust-side
    /// `nat64_well_known_prefix_embedded_ipv4`. Exercised in both the
    /// hex-hextet and dotted-decimal forms RFC 6052 permits.
    #[test]
    fn shell_is_disallowed_ip_unmaps_nat64_wkp_and_classifies_embedded_address() {
        assert!(
            shell_is_disallowed_ip("64:ff9b::6440:1"),
            "64:ff9b::6440:1 (hex form) embeds 100.64.0.1 (CGNAT) and must be rejected"
        );
        assert!(
            !shell_is_disallowed_ip("64:ff9b::c000:201"),
            "64:ff9b::c000:201 (hex form) embeds 192.0.2.1 (allowed) -- positive control"
        );
        assert!(
            shell_is_disallowed_ip("64:ff9b::100.64.0.1"),
            "64:ff9b::100.64.0.1 (dotted-decimal form) embeds 100.64.0.1 (CGNAT) and must be \
             rejected"
        );
        assert!(
            !shell_is_disallowed_ip("64:ff9b::192.0.2.1"),
            "64:ff9b::192.0.2.1 (dotted-decimal form) embeds 192.0.2.1 (allowed) -- positive \
             control"
        );
    }

    /// "::" zero-compression landing on
    /// the 6to4 embedded-IPv4 portion itself must be rejected, not
    /// silently pass through. "2002::1" fully expands to
    /// `2002:0:0:0:0:0:0:1`, so the embedded address (segments 1-2) is
    /// `0.0.0.0` (unspecified); "2002:6440::" expands to
    /// `2002:6440:0:0:0:0:0:0`, embedding `100.64.0.0` (CGNAT). Both
    /// leave `hi` and/or `lo` empty via the naive colon-split
    /// extraction, which this arm fails closed on rather than risk an
    /// incorrect embedded-address computation.
    #[test]
    fn shell_is_disallowed_ip_rejects_6to4_zero_compression_on_embedded_address() {
        assert!(
            shell_is_disallowed_ip("2002::1"),
            "2002::1 embeds 0.0.0.0 (unspecified) via \"::\" compression and must be rejected"
        );
        assert!(
            shell_is_disallowed_ip("2002:6440::"),
            "2002:6440:: embeds 100.64.0.0 (CGNAT) via \"::\" compression and must be rejected"
        );
    }

    /// Positive control: a 6to4 address whose "::" only compresses the
    /// tail (segments 3-7, unrelated to the embedded IPv4) must still
    /// classify normally by its explicit hi/lo hextets -- the
    /// fail-closed arm above must not over-block this common,
    /// unambiguous shape.
    #[test]
    fn shell_is_disallowed_ip_accepts_6to4_with_only_tail_compression() {
        assert!(
            !shell_is_disallowed_ip("2002:c000:201::"),
            "2002:c000:201:: embeds 192.0.2.1 (allowed); the trailing \"::\" only compresses \
             unrelated tail segments and must not affect classification"
        );
    }

    /// The NAT64 analog of the "::" zero-compression case above: "64:ff9b::6440" is
    /// a valid, fully-compressed address (`64:ff9b:0:0:0:0:0:6440`)
    /// whose single remaining hextet occupies the LOW position only
    /// (hi is the compressed zero) -- a naive colon-split extraction
    /// finds no colon to split on and would duplicate the one hextet
    /// into both hi and lo, computing a wrong embedded address, so
    /// this arm must fail closed on the ambiguity instead.
    #[test]
    fn shell_is_disallowed_ip_rejects_nat64_single_hextet_compression() {
        assert!(
            shell_is_disallowed_ip("64:ff9b::6440"),
            "64:ff9b::6440 (single compressed hextet) must fail closed rather than compute a \
             wrong embedded address"
        );
    }

    // ── shell-side userinfo stripping (mirrors the Rust-side
    // `extract_host` fix) ────────────────────────────────────────────

    /// Extracts the shipped script's userinfo-then-host extraction
    /// lines (from `host="${endpoint#https://}"` through the
    /// bracket/port-handling `case ... esac` that immediately follows
    /// it) directly out of `TELEMETRY_REPORT_SCRIPT`, the same
    /// script-extraction technique `extract_shell_is_disallowed_ip`
    /// above uses -- proving the ACTUAL shipped lines strip userinfo
    /// and isolate the host correctly, not a hand-written
    /// reimplementation that could silently drift from what ships.
    fn extract_shell_host_extraction() -> &'static str {
        let start_marker = "host=\"${endpoint#https://}\"";
        let start = TELEMETRY_REPORT_SCRIPT
            .find(start_marker)
            .expect("script must define the host-extraction lines -- marker not found");
        let esac_marker = "\n  esac\n";
        let rel_end = TELEMETRY_REPORT_SCRIPT[start..]
            .find(esac_marker)
            .expect("host-extraction's closing bracket/port \"esac\" not found");
        &TELEMETRY_REPORT_SCRIPT[start..start + rel_end + esac_marker.len()]
    }

    /// Runs the REAL, extracted host-extraction lines against
    /// `endpoint` and returns the resulting `$host` value -- the exact
    /// string the script's own `is_disallowed_ip`/DNS-resolution steps
    /// (extracted and tested separately above) go on to classify.
    fn shell_extract_host(endpoint: &str) -> String {
        let driver = format!(
            "endpoint=\"$1\"\n{}\nprintf '%s' \"$host\"\n",
            extract_shell_host_extraction()
        );
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(driver)
            .arg("sh") // becomes $0 inside the -c script
            .arg(endpoint) // becomes $1
            .output()
            .expect("failed to spawn sh to exercise the extracted host-extraction lines");
        String::from_utf8(output.stdout).expect("shell output must be valid UTF-8")
    }

    /// The shipped
    /// script's own host-extraction lines must strip URL userinfo
    /// BEFORE isolating the host, exactly like the Rust-side
    /// `extract_host` fix -- otherwise `curl` (which itself discards
    /// userinfo before connecting) and this defense-in-depth layer
    /// classify two different strings for the same endpoint.
    #[test]
    fn shell_host_extraction_strips_userinfo_before_isolating_the_host() {
        assert_eq!(
            shell_extract_host("https://x@127.0.0.1/collector"),
            "127.0.0.1"
        );
        assert_eq!(
            shell_extract_host("https://user:pass@example.com:8443/x"),
            "example.com"
        );
        assert_eq!(shell_extract_host("https://x@[::1]:443/collector"), "::1");
    }

    /// Same "take the LAST @" rule as the Rust-side `strip_userinfo`,
    /// via `${host##*@}`'s greedy (longest-match) prefix removal.
    #[test]
    fn shell_host_extraction_strips_userinfo_up_to_the_last_at_sign() {
        assert_eq!(shell_extract_host("https://a@b@127.0.0.1/x"), "127.0.0.1");
    }

    // ── POSIX-sh portability of the hex-decoding arms (6to4, NAT64
    // hex-hextet, ::ffff:*:* hex form) ─────────────────────────────────
    //
    // `is_disallowed_ip`'s three hex-decoding arms use the POSIX
    // `0x`-prefixed arithmetic form (`$((0x$hi))`). POSIX `sh`
    // arithmetic defines only C-style integer constants -- `0x`-hex is
    // one of those; base-N `#` conversion (`$((16#$hi))`) is a
    // bash/ksh/zsh extension with no POSIX meaning at all. `dash` --
    // the actual `/bin/sh` on Debian/Ubuntu and many CI images --
    // rejects a `16#`-style expression outright with a fatal
    // "arithmetic expression: expecting EOF" error that aborts the
    // whole script, for every address that reaches one of these arms,
    // regardless of which side of the allow/deny decision that address
    // would land on. `sh` on a given dev/CI box is not reliably POSIX
    // sh -- it is commonly a symlink to bash (which accepts `16#` even
    // under `--posix`), so a test that runs the extracted function
    // under plain `sh` cannot distinguish the two forms on such a box.
    // The two tests below each target a specific external tool BY NAME
    // (`dash`, `shellcheck`) and skip with a visible marker rather than
    // substituting a different tool when that exact one is absent.

    /// Resolves `name` on `PATH` via `command -v`, run under a driver
    /// shell rather than assumed to be a builtin of the *current*
    /// process's own shell. Shared by both tests below, each gating on
    /// a different external tool that may or may not be installed in
    /// the environment this test runs in.
    fn find_on_path(name: &str) -> Option<String> {
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(format!("command -v {name}"))
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
        (!path.is_empty()).then_some(path)
    }

    /// Same extraction and driver-script shape as `shell_is_disallowed_ip`,
    /// but runs the extracted function under an explicit `interpreter`
    /// path rather than `sh`, and returns the raw exit code (plus
    /// stderr) rather than a success/failure bool -- this test needs to
    /// tell apart three outcomes (0 = disallowed, 1 = not disallowed, 2
    /// = the interpreter itself aborted on a bad arithmetic expression),
    /// not just two.
    fn shell_is_disallowed_ip_exit_code_under(interpreter: &str, addr: &str) -> (i32, String) {
        let driver = format!(
            "{}\nis_disallowed_ip \"$1\"\n",
            extract_shell_is_disallowed_ip()
        );
        let output = std::process::Command::new(interpreter)
            .arg("-c")
            .arg(driver)
            .arg(interpreter) // becomes $0 inside the -c script
            .arg(addr) // becomes $1, i.e. the function's own argument
            .output()
            .unwrap_or_else(|e| {
                panic!("failed to spawn {interpreter} to exercise the extracted is_disallowed_ip function: {e}")
            });
        let code = output.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        (code, stderr)
    }

    /// Runs the REAL, extracted `is_disallowed_ip` function under a
    /// genuine `dash`, for six addresses that each reach one of the
    /// three hex-decoding arms (three disallowed, three allowed
    /// positive controls). A correct classification under dash exits 0
    /// (disallowed) or 1 (allowed); exit code 2 -- dash's own
    /// fatal-arithmetic-error code -- means the arm's arithmetic
    /// expression is not valid POSIX sh, for every one of these
    /// addresses regardless of its expected classification, which is
    /// exactly the failure mode this test exists to catch. Skips with
    /// an explicit, visible marker -- never a silent no-op, and never a
    /// fallback to a different interpreter, which would let this test
    /// pass on a shell that accepts both the POSIX and the non-POSIX
    /// form alike -- when no `dash` is installed on this machine.
    #[test]
    fn shell_hex_arithmetic_arms_are_posix_portable_under_dash() {
        let Some(dash) = find_on_path("dash") else {
            eprintln!(
                "SKIPPED shell_hex_arithmetic_arms_are_posix_portable_under_dash: no `dash` \
                 executable found on this machine (checked via `command -v dash`). This test \
                 specifically requires dash rather than falling back to `sh` or another shell, \
                 because dash is what rejects the bash/ksh-only `16#` arithmetic form that this \
                 test guards against -- a substitute shell that also accepts `16#` would pass \
                 here regardless of which form the script actually ships. Install dash to \
                 exercise this test for real."
            );
            return;
        };

        // (address, expected exit code) -- 0 = disallowed, 1 = allowed.
        // Each reaches one of the three hex-decoding arms.
        let cases: &[(&str, i32)] = &[
            ("2002:6440:1::", 0),     // 6to4, embeds 100.64.0.1 (CGNAT) -- disallowed
            ("2002:c000:201::", 1),   // 6to4, embeds 192.0.2.1 (public) -- allowed
            ("64:ff9b::6440:1", 0),   // NAT64 hex, embeds 100.64.0.1 -- disallowed
            ("64:ff9b::c000:201", 1), // NAT64 hex, embeds 192.0.2.1 -- allowed
            ("::ffff:a00:1", 0),      // mapped hex, dropped leading zero (10.0.0.1) -- disallowed
            ("::ffff:808:808", 1),    // mapped hex (8.8.8.8) -- allowed
        ];

        for (addr, expected_code) in cases {
            let (code, stderr) = shell_is_disallowed_ip_exit_code_under(&dash, addr);
            assert_eq!(
                code, *expected_code,
                "dash classified {addr:?} with exit code {code} (expected {expected_code}) -- \
                 stderr: {stderr:?}. Exit code 2 with an \"arithmetic expression\" message means \
                 this arm is using the bash/ksh-only `16#` form instead of POSIX `0x`."
            );
        }
    }

    /// Independent, static confirmation of the same POSIX-sh compliance
    /// property the test above checks dynamically: `shellcheck -s sh`
    /// against the checked-in transport script's own on-disk path
    /// (never a copy of the embedded `TELEMETRY_REPORT_SCRIPT` written
    /// back out to a temp file -- `include_str!` already guarantees the
    /// two are byte-identical at compile time, so checking the real
    /// file is equivalent and simpler), mirroring
    /// `session_id_pattern_from_schema`'s own `CARGO_MANIFEST_DIR`-
    /// relative path pattern. `-s sh` pins the dialect shellcheck checks
    /// against to POSIX sh specifically (not bash), flagging a `16#`
    /// arithmetic expression under `SC3052` regardless of whether this
    /// environment happens to have `dash` (or any other genuinely
    /// POSIX-only shell) installed to exercise it at runtime. Skips
    /// with a visible marker when no `shellcheck` executable is found.
    #[test]
    fn transport_script_passes_shellcheck_posix_sh() {
        let Some(shellcheck) = find_on_path("shellcheck") else {
            eprintln!(
                "SKIPPED transport_script_passes_shellcheck_posix_sh: no `shellcheck` \
                 executable found on this machine (checked via `command -v shellcheck`). \
                 Install shellcheck to exercise this test for real."
            );
            return;
        };

        let script_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../scripts/konductor-telemetry-report.sh");
        assert!(
            script_path.exists(),
            "expected the checked-in transport script at {}",
            script_path.display()
        );

        let output = std::process::Command::new(&shellcheck)
            .arg("-s")
            .arg("sh")
            .arg(&script_path)
            .output()
            .unwrap_or_else(|e| panic!("failed to spawn shellcheck at {shellcheck}: {e}"));

        assert!(
            output.status.success(),
            "shellcheck -s sh found POSIX-sh compliance issues in {}:\n{}",
            script_path.display(),
            String::from_utf8_lossy(&output.stdout)
        );
    }
}
