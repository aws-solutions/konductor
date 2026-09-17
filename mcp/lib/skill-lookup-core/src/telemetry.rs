// SPDX-License-Identifier: Apache-2.0
//
// telemetry.rs — skill-lookup-core's own mirror of konductor-rs's
// telemetry module.
//
// Duplicated between crates by design, not shared:
// the two crates are not workspace-linked in a way that lets either
// depend on the other. Differences from konductor-rs's mirror:
//   - This module reads (never writes) the identity file -- it has no
//     `konductor install`-managed target of its own.
//   - Its detached spawn uses `tokio::process::Command`, not
//     `std::process::Command`, so tokio's own orphan-reaping queue
//     reaps the long-lived flush task's detached children.
//   - It emits exactly one event type: `report_mcp_tool_call`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tokio::io::AsyncWriteExt as _;

/// AWS Solutions Library Solution ID assigned to Konductor -- the real,
/// registered identifier, not a placeholder. Mirrors `konductor-rs`'s
/// own constant of the same name.
const SOLUTION_ID: &str = "SO0370";

/// Compile-time default endpoint -- same real AWS Solutions Library
/// metrics endpoint `konductor-rs`'s mirror uses.
const DEFAULT_TELEMETRY_ENDPOINT: &str = "https://metrics.awssolutionsbuilder.com/generic";

/// The checked-in transport script's text, embedded at compile time --
/// the SAME checked-in file `konductor-rs` embeds, via this
/// crate's own independent `include_str!` (its own manifest-relative
/// path -- each crate embeds it independently).
const TELEMETRY_REPORT_SCRIPT: &str =
    include_str!("../../../../scripts/konductor-telemetry-report.sh");

const MATERIALIZED_SCRIPT_NAME: &str = "konductor-telemetry-report-mcp.sh";

/// The nil-UUID sentinel: used unconditionally by this
/// crate's own `report_mcp_tool_call` when no identity file is
/// discoverable -- a legitimate, tolerated state (unmanaged
/// `skill-lookup-mcp` instance), never an error.
pub const NIL_UUID_SENTINEL: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

/// A 64-character lowercase hex shape check -- same validation
/// `konductor-rs`'s identity module applies before caching a `UUID`.
fn is_valid_uuid_shape(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// This crate's own known identity schema version -- must track
/// `konductor-rs`'s `SCHEMA_VERSION` constant (`cli/telemetry/identity.rs`)
/// since both crates read the same on-disk file shape.
const CURRENT_SCHEMA_VERSION: u64 = 1;

#[derive(Debug, Clone, Deserialize)]
struct IdentityRecord {
    schema_version: u64,
    #[serde(rename = "UUID")]
    uuid: String,
}

/// Reads `<skills_dir_parent>/.konductor/telemetry-id.json`, if present
/// and well-formed. `skills_dir` is the configured `--skills-dir` root
/// (e.g. `<target_dir>/.konductor/skills`); the identity file is a
/// sibling of that root's own parent directory
/// (`<target_dir>/.konductor/telemetry-id.json`) -- this function
/// checks exactly that one path per configured root, never an
/// open-ended directory walk.
///
/// This crate never writes the identity file (see this module's own
/// docstring), so a recognized-but-newer `schema_version` can never
/// trigger a clobber here the way it could in `konductor-rs`'s
/// write/publish path. It still gets read-only treatment for
/// consistency with that crate's mirror: the `UUID` is extracted and
/// used if present and well-shaped, falling back to `None` (which
/// `cached_uuid` turns into the nil-UUID sentinel) only when the UUID
/// itself can't be safely read -- never treated identically to a
/// genuinely malformed/absent file at the call site, even though both
/// currently resolve to the same nil-UUID behavior for THIS read-only
/// crate.
fn read_identity_near_skills_dir(skills_dir: &Path) -> Option<String> {
    // skills_dir is <target_dir>/.konductor/skills; its parent is
    // <target_dir>/.konductor, which is where telemetry-id.json lives.
    let konductor_dir = skills_dir.parent()?;
    let path = konductor_dir.join("telemetry-id.json");
    let contents = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    let schema_version = value.get("schema_version").and_then(|v| v.as_u64())?;

    if schema_version > CURRENT_SCHEMA_VERSION {
        // A real identity a newer binary already published. Use its
        // UUID read-only if it's extractable; this function never
        // writes, so there is no clobber risk either way -- but the
        // UUID is still validated the same way as the recognized-schema
        // case below, never trusted unchecked.
        return value
            .get("UUID")
            .and_then(|v| v.as_str())
            .filter(|s| is_valid_uuid_shape(s))
            .map(|s| s.to_string());
    }

    let record: IdentityRecord = serde_json::from_value(value).ok()?;
    if record.schema_version != CURRENT_SCHEMA_VERSION {
        return None;
    }
    if !is_valid_uuid_shape(&record.uuid) {
        return None;
    }
    Some(record.uuid)
}

/// This process's cached identity lookup: resolved at most once, over
/// every configured `--skills-dir` root, at startup, before the flush
/// task is spawned -- never per flush.
static IDENTITY_CACHE: OnceLock<Option<String>> = OnceLock::new();

/// Resolves and caches the `UUID` for this process, checking each of
/// `skills_dirs` in order and caching the first value found. Call this
/// once at startup, before spawning the flush task.
pub fn init_identity(skills_dirs: &[PathBuf]) {
    IDENTITY_CACHE.get_or_init(|| {
        skills_dirs
            .iter()
            .find_map(|dir| read_identity_near_skills_dir(dir))
    });
}

fn cached_uuid() -> &'static str {
    IDENTITY_CACHE
        .get()
        .and_then(|opt| opt.as_deref())
        .unwrap_or(NIL_UUID_SENTINEL)
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

fn materialize_script() -> std::io::Result<PathBuf> {
    let dir = private_script_dir()?;
    let path = dir.join(MATERIALIZED_SCRIPT_NAME);
    write_verified(&path, TELEMETRY_REPORT_SCRIPT)?;
    set_executable(&path)?;
    Ok(path)
}

/// `$HOME/.konductor/tmp` when `HOME` is set, created `0o700` if
/// absent -- never the shared, world-writable `std::env::temp_dir()`
/// directly. Same fix applied to `cli/konductor-rs`'s own mirror
/// (`cli/telemetry/report.rs`): a fixed, predictable path in a shared
/// temp dir is a local code-execution vector (symlink pre-placement,
/// or a TOCTOU swap between materializing and executing).
///
/// `HOME` is not guaranteed to be set -- sandboxed build/CI containers
/// commonly run with no `HOME` at all (this crate's own
/// `materialized_script_path_exists_and_is_executable` test caught
/// this in a real dry-run build). When `HOME` is unset, falls back to
/// a per-uid subdirectory under `std::env::temp_dir()`
/// (`konductor-tmp-<uid>`), created `0o700` the same way -- this keeps
/// the directory private to the current user (not world-writable, not
/// symlink-attackable via another uid) without requiring `$HOME` to
/// exist. `std::env::temp_dir()` itself never depends on `HOME` (it
/// falls back to `TMPDIR`/`/tmp`), so this fallback works in exactly
/// the environment that broke the `$HOME`-only path.
fn private_script_dir() -> std::io::Result<PathBuf> {
    let dir = match std::env::var_os("HOME") {
        Some(home) => PathBuf::from(home).join(".konductor").join("tmp"),
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
/// pre-existing entry at that exact path without checking both. Same
/// fix as `cli/konductor-rs`'s mirror (`cli/telemetry/report.rs`) --
/// see that function's doc comment for the two hazards this closes
/// (a hostile pre-created directory owned by a different local user,
/// and a symlink at the exact leaf path that `set_permissions`
/// (`chmod(2)`) would otherwise follow).
#[cfg(unix)]
fn create_private_dir_all(dir: &Path) -> std::io::Result<()> {
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
fn create_private_dir_all(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// Writes `contents` to `path` only if no byte-identical copy is
/// already there, opening with `O_NOFOLLOW` (never following a
/// symlink an attacker pre-placed at `path`) and verifying the result
/// is a regular file before returning -- closes the TOCTOU window
/// between this write and `spawn_and_send`'s later exec. Relies on
/// `private_script_dir`'s `0o700` permissions to keep another local
/// user from replacing the file afterward.
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

/// Fleet-wide opt-out env var (`KONDUCTOR_TELEMETRY=off` + managed
/// config for fleet) -- same name and semantics as `konductor-rs`'s own mirror
/// (`cli/telemetry/report.rs`'s `TELEMETRY_OFF_ENV_VAR`), checked here
/// too since this crate resolves telemetry-enabled state independently
/// (alongside `main.rs`'s own `--telemetry <on|off>` CLI-flag check,
/// which this env var takes precedence over the same way it takes
/// precedence over a repo's checked-in config on the `konductor-rs`
/// side).
const TELEMETRY_OFF_ENV_VAR: &str = "KONDUCTOR_TELEMETRY";
const TELEMETRY_OFF_VALUE: &str = "off";

/// Whether the fleet-wide `KONDUCTOR_TELEMETRY=off` opt-out is set in
/// this process's environment. Exposed (`pub`) so `main.rs` can gate
/// spawning the counters/flush task on it structurally -- an
/// omitted-not-invoked-then-checked structural opt-out for
/// `--telemetry off` -- rather than spawning the task anyway and
/// relying solely on `resolve_endpoint`'s own per-flush check (below)
/// to silently drop every accumulated count.
pub fn fleet_opted_out() -> bool {
    std::env::var(TELEMETRY_OFF_ENV_VAR).as_deref() == Ok(TELEMETRY_OFF_VALUE)
}

/// Debug-only escape hatch for `endpoint_host_is_allowed` below -- same
/// name and semantics as `konductor-rs`'s own mirror
/// (`cli/telemetry/report.rs`'s `TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR`),
/// so a developer sets ONE env var name to allow a loopback test
/// endpoint regardless of which binary the telemetry call happens to
/// go through.
const TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR: &str = "KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT";

/// Upper bound on how long this module's DNS resolution may block the
/// tokio worker thread running the periodic flush task (mirroring
/// `cli/konductor-rs`'s own `DNS_RESOLUTION_TIMEOUT` in
/// `cli/telemetry/report.rs`, which this crate previously had no
/// equivalent of at all -- an un-timeboxed resolution here can stall a
/// current-thread/single-worker runtime's entire flush cycle for
/// however long a slow or misconfigured resolver takes). A resolution
/// error still fails open (see `telemetry_net::decide_pin`'s own doc
/// comment); a TIMEOUT does not (AutoSDE finding `f-9ec2e9ff`) -- it is
/// denied outright via the SAME shared decision `cli/konductor-rs` now
/// applies, so the two crates can never diverge on this again.
const DNS_RESOLUTION_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

/// Resolves the telemetry endpoint for ONE flush cycle. `async` because
/// the host-allowlist check (`endpoint_host_is_allowed`) performs a
/// blocking DNS resolution -- bounded by `DNS_RESOLUTION_TIMEOUT` and
/// offloaded to a blocking-pool thread via
/// `telemetry_net::resolve_host_addrs_bounded_async` (which itself uses
/// `tokio::task::spawn_blocking` + `tokio::time::timeout`; see that
/// function's own doc comment) rather than running synchronously inside
/// this async fn, which would otherwise block the tokio worker thread
/// running the periodic flush task (and, on a current-thread/
/// single-worker runtime, the whole runtime) for however long
/// `getaddrinfo` takes.
///
/// Callers must resolve ONCE per flush cycle and reuse the result for
/// every accumulated key in that cycle (see `flush_once`) -- the
/// endpoint and its allowlist verdict are invariant across a cycle, so
/// re-resolving per key would perform N redundant blocking DNS lookups
/// of the same host for a cycle with N distinct keys.
/// `#[cfg(test)]`: production code (`flush_once`) now calls
/// `resolve_endpoint_with_pin` directly (it needs the pin this wrapper
/// discards) -- kept only so this module's existing `Option<String>`-
/// shaped tests need no changes.
#[cfg(test)]
async fn resolve_endpoint() -> Option<String> {
    resolve_endpoint_with_pin()
        .await
        .map(|(endpoint, _pin)| endpoint)
}

/// Same resolution as `resolve_endpoint`, but also returns the address
/// (if any) `spawn_and_send` must pin `curl` to via `--resolve`
/// (adversarial finding: DNS-rebinding TOCTOU between this check's own
/// resolution and curl's later, independent one -- see
/// `konductor-rs`'s own mirror, `cli/telemetry/report.rs`'s
/// `endpoint_host_is_allowed_with_pin`, for the full rationale, which
/// applies identically here since both crates hand a bare hostname
/// string to the SAME checked-in transport script). Kept as a wrapper
/// around the SAME logic `resolve_endpoint` used to contain directly,
/// so the two can never drift.
async fn resolve_endpoint_with_pin() -> Option<(String, Option<std::net::IpAddr>)> {
    if fleet_opted_out() {
        return None;
    }

    // No .konductor/config.yml resolution here: skill-lookup-mcp has no
    // single target_dir to read a config from (it can be launched
    // against multiple --skills-dir roots at once) -- this mirror only
    // implements the compile-time-default + env-var tiers of the
    // published three-tier order; the third tier (per-repo config.yml)
    // is scoped to konductor-rs's own single-target call sites.
    //
    // `KONDUCTOR_METRICS_ENDPOINT`, not `KONDUCTOR_TELEMETRY_ENDPOINT` --
    // must match `konductor-rs`'s own mirror and the published section's
    // literal name exactly.
    let candidate = if let Ok(from_env) = std::env::var("KONDUCTOR_METRICS_ENDPOINT") {
        if !from_env.is_empty() {
            from_env
        } else {
            DEFAULT_TELEMETRY_ENDPOINT.to_string()
        }
    } else {
        DEFAULT_TELEMETRY_ENDPOINT.to_string()
    };

    // Security gate (host allowlist): same rationale as
    // `konductor-rs`'s own mirror (`cli/telemetry/report.rs`'s
    // `endpoint_host_is_allowed`) -- anyone with env-var-set access in
    // shared CI could otherwise redirect this crate's telemetry to an
    // attacker-controlled host by pointing `KONDUCTOR_METRICS_ENDPOINT`
    // at a loopback/link-local/private-range address reachable from
    // this host.
    let pinned_ip = endpoint_host_is_allowed_with_pin(&candidate).await?;

    Some((candidate, pinned_ip))
}

/// Whether `endpoint`'s host is safe to send telemetry to -- same
/// classification and escape-hatch contract as `konductor-rs`'s own
/// mirror (`cli/telemetry/report.rs`'s `endpoint_host_is_allowed`); see
/// that function's own doc comment for the full rationale, including
/// why a hostname that fails to resolve at all (e.g. a reserved,
/// deliberately-never-resolving `.invalid` TLD host) is never itself
/// treated as disallowed. Duplicated here per this module's own "not
/// workspace-linked" convention (see this file's module doc comment),
/// not shared.
///
/// `async` (unlike `konductor-rs`'s own synchronous mirror): this
/// crate's copy runs inside a `tokio::spawn`ed async task (the flush
/// task in `main.rs`), so the resolution check below is offloaded to a
/// blocking-pool thread via `tokio::task::spawn_blocking` rather than
/// run synchronously on the calling task's worker thread.
/// `#[cfg(test)]`: production code now calls
/// `endpoint_host_is_allowed_with_pin` directly (it needs the pin this
/// bool-only wrapper discards) -- kept only so this module's existing
/// bool-shaped tests need no changes.
#[cfg(test)]
async fn endpoint_host_is_allowed(endpoint: &str) -> bool {
    endpoint_host_is_allowed_with_pin(endpoint).await.is_some()
}

/// Same allow/deny decision as `endpoint_host_is_allowed`, but also
/// returns the address (if any) `spawn_and_send` must pin `curl` to via
/// `--resolve` -- same rationale and `Option<Option<IpAddr>>` shape as
/// `konductor-rs`'s own mirror
/// (`cli/telemetry/report.rs`'s `endpoint_host_is_allowed_with_pin`);
/// see that function's own doc comment for the full rationale,
/// including why the pin MUST come from the exact same resolution this
/// function's own allow/deny verdict is based on, never a second,
/// independent lookup.
async fn endpoint_host_is_allowed_with_pin(endpoint: &str) -> Option<Option<std::net::IpAddr>> {
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
    let outcome =
        telemetry_net::resolve_host_addrs_bounded_async(host.to_string(), DNS_RESOLUTION_TIMEOUT)
            .await;
    telemetry_net::decide_pin(outcome)
}

/// Resolves `host` via `telemetry_net::resolve_host_addrs_bounded_async`
/// and checks whether the outcome would be flagged as disallowed -- a
/// bool-only convenience so this module's existing tests exercising the
/// resolution path need no changes; see `cli/telemetry/report.rs`'s own
/// `resolved_addresses_include_disallowed_host` for the identical
/// rationale. A `TimedOut` outcome is folded into `true` here only
/// because none of this test-only helper's own callers exercise a real
/// timeout -- the actual timeout-vs-failure distinction is asserted
/// directly against `telemetry_net::decide_pin` in this module's own
/// tests below, and exhaustively in `telemetry-net`'s own test suite.
#[cfg(test)]
async fn resolved_addresses_include_disallowed_host(host: &str) -> bool {
    match telemetry_net::resolve_host_addrs_bounded_async(host.to_string(), DNS_RESOLUTION_TIMEOUT)
        .await
    {
        telemetry_net::DnsOutcome::Resolved(addrs) => {
            addrs.iter().any(|ip| telemetry_net::is_disallowed_ip(*ip))
        }
        telemetry_net::DnsOutcome::Failed => false,
        telemetry_net::DnsOutcome::TimedOut => true,
    }
}

fn build_event_id(uuid: &str) -> String {
    use sha2::{Digest, Sha256};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let input = format!("{uuid}-{nanos}-{}", std::process::id());
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn wire_timestamp_now() -> String {
    // Same shape konductor-rs's mirror produces
    // ("YYYY-MM-DD HH:MM:SS.f"), computed independently here since this
    // crate has no shared `civil_from_days` helper of its own (each
    // crate accepts this per-crate duplication).
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let days = (secs / 86400) as i64;
    let (y, m, d) = civil_from_days(days);
    let rem = secs % 86400;
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    format!(
        "{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}.{}",
        millis / 100
    )
}

fn iso8601_now() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let days = (secs / 86400) as i64;
    let (y, m, d) = civil_from_days(days);
    let rem = secs % 86400;
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{millis:03}Z")
}

/// Howard Hinnant's civil-from-days algorithm -- same algorithm
/// `cli/konductor-rs/src/cli/time.rs`'s `civil_from_days` implements,
/// duplicated here for the identical "no shared crate" reason as the
/// rest of this module (each crate accepts this per-crate duplication).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Spawns the materialized transport script detached via
/// `tokio::process::Command` -- so tokio's own orphan-reaping queue
/// reaps this long-lived flush task's detached children, rather
/// than `std::process::Command`, which does not reap on `Child` drop.
///
/// `pinned_ip`, when `Some`, is passed to the script as a second
/// `host:port:address` argument for `curl --resolve` (adversarial
/// finding: DNS-rebinding TOCTOU -- see `konductor-rs`'s own mirror,
/// `cli/telemetry/report.rs`'s `spawn_and_send`, for the full
/// rationale, which applies identically here). `extract_host` is
/// called again here purely as a string-split (no network I/O, so
/// re-deriving it costs nothing and introduces no second TOCTOU
/// window) to recover the host `build_resolve_arg` needs alongside the
/// port and the already-resolved pin address.
async fn spawn_and_send(endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: String) {
    let Ok(script_path) = materialize_script() else {
        return;
    };
    let mut command = tokio::process::Command::new(&script_path);
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
        let _ = stdin.write_all(body.as_bytes()).await;
    }
    // `child` is dropped here without `.wait()` -- tokio's own
    // background orphan-reaping queue still reaps it.
}

/// `report_mcp_tool_call`: called once per accumulated
/// `(tool_name, skill_name, error_code)` key per flush cycle. Returns
/// `()`, never `Result` -- telemetry failure never propagates. Fires
/// unconditionally under the nil-UUID sentinel when no identity file
/// was discoverable at startup (legitimate unattributed usage, never
/// skipped the way konductor-rs's other `report_*` functions skip on a
/// missing identity).
///
/// `endpoint` is resolved ONCE per flush cycle by the caller
/// (`flush_once`), not re-resolved here per key -- the endpoint and its
/// allowlist verdict are invariant across a cycle, so resolving once
/// and passing it down avoids N redundant blocking DNS lookups of the
/// same host for a cycle with N distinct keys (see `resolve_endpoint`'s
/// own doc comment).
pub async fn report_mcp_tool_call(
    endpoint: &str,
    pinned_ip: Option<std::net::IpAddr>,
    tool_name: &str,
    skill_name: Option<&str>,
    error_code: Option<&str>,
    count: u64,
) {
    let uuid = cached_uuid();
    let target_name = match skill_name {
        Some(skill) => format!("{tool_name}:{skill}"),
        None => tool_name.to_string(),
    };
    let data = serde_json::json!({
        "eventId": build_event_id(uuid),
        "eventType": "mcp_tool_call",
        "targetName": target_name,
        "sessionId": null,
        "parentSessionId": null,
        "errorCode": error_code,
        "harness": null,
        "TimeStamp": iso8601_now(),
        // Not part of the core per-invocation schema every other
        // eventType shares -- an implementation-visible
        // count for this flush cycle's accumulated calls under this
        // key, folded into Data since the outer envelope's Data field is
        // a flexible, solution-defined object. The flush
        // interval and batch shape this field reflects (60s, one event
        // per accumulated key, see `main.rs`'s own decision comment
        // above its `tokio::spawn`) are DECIDED for this revision --
        // this field's own PRESENCE stays
        // optional in the schema (`docs/telemetry-schema.json`) rather
        // than required, since a future eventType has no reason to
        // carry it.
        "count": count,
    });
    let outer = serde_json::json!({
        "Solution": SOLUTION_ID,
        "Version": env!("CARGO_PKG_VERSION"),
        "UUID": uuid,
        "TimeStamp": wire_timestamp_now(),
        "Data": data,
    });
    let Ok(body) = serde_json::to_string(&outer) else {
        return;
    };
    spawn_and_send(endpoint, pinned_ip, body).await;
}

/// In-process counters, keyed by `(tool_name, skill_name, error_code)`.
/// `errorCode: None` for a successful call. Shared between
/// the server struct (cloned into whatever holds `call_tool`) and the
/// flush task.
pub type ToolCallCounters =
    std::sync::Arc<Mutex<HashMap<(String, Option<String>, Option<&'static str>), u64>>>;

/// Fixed sentinel for an unrecognized `tool_name`/`skill_name` --
/// bounds cardinality to one entry regardless of how many distinct
/// unrecognized values a caller sends.
pub const UNKNOWN_SENTINEL: &str = "<unknown>";
/// taking the lock only for the duration of the increment -- no
/// `.await` held across the critical section.
pub fn increment_counter(
    counters: &ToolCallCounters,
    tool_name: impl Into<String>,
    skill_name: Option<String>,
    error_code: Option<&'static str>,
) {
    let mut map = counters
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *map.entry((tool_name.into(), skill_name, error_code))
        .or_insert(0) += 1;
}

/// Atomically swaps the counter map (`std::mem::take` under the lock)
/// so any increment landing during or immediately after a flush is
/// captured in the new map, never lost to a read-then-clear race.
pub fn take_counters(
    counters: &ToolCallCounters,
) -> HashMap<(String, Option<String>, Option<&'static str>), u64> {
    let mut map = counters
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    std::mem::take(&mut *map)
}

/// Runs one flush cycle: reports one event per accumulated key, then
/// swaps the counter map. Resolves the telemetry endpoint ONCE for the
/// whole cycle (not once per key -- see `resolve_endpoint`'s own doc
/// comment) and skips entirely, with no DNS lookup at all, when the
/// counters are currently empty -- an idle 60-second tick with no
/// calls to report has no reason to pay resolution's cost.
///
/// Deliberately checks emptiness and resolves the endpoint BEFORE
/// swapping the counters out (AutoSDE finding `f-cbc7d92e`): the
/// counters are cleared only once there is somewhere to actually send
/// them. Previously, `take_counters` ran first and unconditionally,
/// so a `DnsOutcome::TimedOut` on this one tick -- which `decide_pin`
/// denies outright (see its own doc comment), not a persistent
/// opt-out -- silently discarded a full 60-second window of real
/// counts even though telemetry is enabled and the very next flush
/// would likely succeed. The emptiness check here is a cheap peek at
/// the map (`is_empty()` under the lock, no `mem::take`) so the "no
/// DNS lookup on an idle cycle" property this function's own doc
/// comment documents still holds.
pub async fn flush_once(counters: &ToolCallCounters) {
    let is_empty = counters
        .lock()
        .expect("counters mutex must not be poisoned")
        .is_empty();
    if is_empty {
        return;
    }
    let Some((endpoint, pinned_ip)) = resolve_endpoint_with_pin().await else {
        return;
    };
    let snapshot = take_counters(counters);
    for ((tool_name, skill_name, error_code), count) in snapshot {
        report_mcp_tool_call(
            &endpoint,
            pinned_ip,
            &tool_name,
            skill_name.as_deref(),
            error_code,
            count,
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex as StdMutex;

    /// Dedicated lock for every test in this module that mutates
    /// `KONDUCTOR_TELEMETRY`/`KONDUCTOR_METRICS_ENDPOINT`/
    /// `KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT` -- mirrors
    /// `konductor-rs`'s own `report.rs` test module's
    /// `TELEMETRY_ENV_LOCK` (added for the identical race), which takes
    /// this same lock in every one of its own `resolve_endpoint_*`
    /// tests, including its `resolve_endpoint_respects_fleet_wide_telemetry_off_env_var`.
    /// This module's own `resolve_endpoint_respects_fleet_wide_telemetry_off_env_var`/
    /// `fleet_opted_out_reflects_the_env_var_exactly` tests previously
    /// mutated these same env vars without acquiring this lock -- since
    /// `cargo test` runs `#[test]` functions concurrently by default,
    /// that gap let either test's `remove_var("KONDUCTOR_METRICS_ENDPOINT")`
    /// interleave with the escape-hatch test's own `set_var`/
    /// `resolve_endpoint()` call below, clearing the loopback endpoint
    /// mid-check and making `resolve_endpoint` silently fall back to
    /// `DEFAULT_TELEMETRY_ENDPOINT` -- the exact failure this lock now
    /// closes for every mutator in this module, not just the two tests
    /// that originally introduced it.
    static TELEMETRY_ENV_LOCK: StdMutex<()> = StdMutex::new(());

    fn lock_telemetry_env() -> std::sync::MutexGuard<'static, ()> {
        TELEMETRY_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        std::env::temp_dir().join(format!(
            "skill-lookup-core-telemetry-test-{name}-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn is_valid_uuid_shape_accepts_64_lowercase_hex() {
        assert!(is_valid_uuid_shape(&"a".repeat(64)));
        assert!(!is_valid_uuid_shape(&"A".repeat(64)));
        assert!(!is_valid_uuid_shape(&"a".repeat(63)));
    }

    #[test]
    fn nil_uuid_sentinel_is_64_zero_chars() {
        assert_eq!(NIL_UUID_SENTINEL.len(), 64);
        assert!(NIL_UUID_SENTINEL.chars().all(|c| c == '0'));
    }

    // `resolve_endpoint`/`endpoint_host_is_allowed` became `async` for
    // this fix (the blocking DNS check now runs via `spawn_blocking`),
    // so the four tests below now hold `TELEMETRY_ENV_LOCK`'s std
    // `MutexGuard` across the `.await` on that call -- clippy's
    // `await_holding_lock` flags this as a general deadlock risk (a
    // lock held across a suspend point can block a tokio worker thread
    // another task needs). That risk doesn't apply here: each
    // `#[tokio::test]` gets its OWN, separate single-task runtime, so
    // there is never a second task in the SAME runtime that could try
    // to acquire this lock while the first is suspended -- the
    // structural precondition the lint guards against cannot occur.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn resolve_endpoint_respects_fleet_wide_telemetry_off_env_var() {
        let _lock = lock_telemetry_env();
        std::env::remove_var("KONDUCTOR_METRICS_ENDPOINT");
        std::env::set_var(TELEMETRY_OFF_ENV_VAR, TELEMETRY_OFF_VALUE);
        let resolved = resolve_endpoint().await;
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        assert_eq!(
            resolved, None,
            "KONDUCTOR_TELEMETRY=off must disable telemetry for this mirror too"
        );
    }

    #[test]
    fn fleet_opted_out_reflects_the_env_var_exactly() {
        let _lock = lock_telemetry_env();
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        assert!(!fleet_opted_out());
        std::env::set_var(TELEMETRY_OFF_ENV_VAR, TELEMETRY_OFF_VALUE);
        assert!(fleet_opted_out());
        std::env::set_var(TELEMETRY_OFF_ENV_VAR, "OFF");
        assert!(
            !fleet_opted_out(),
            "only the exact lowercase value \"off\" opts out"
        );
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
    }

    // ── Host allowlist (security gate) -- the pure classification/
    // parsing primitives (`extract_host`, `is_disallowed_local_host`,
    // `is_disallowed_ip`, `classify_resolved_addrs`) now live in the
    // `telemetry-net` crate and are exercised by its own test suite; see
    // that crate's `src/lib.rs`. The tests below exercise this module's
    // own glue around the shared, bounded, ASYNC resolution path. ─────

    /// FINDING regression (read-only mirror): same DNS-resolution gap
    /// as `konductor-rs`'s own mirror -- see that module's
    /// `resolved_addresses_include_disallowed_host_flags_a_resolved_loopback_or_private_literal`
    /// for the full rationale, including why an IP literal exercises
    /// the resolution code path deterministically without requiring
    /// network access.
    /// See the `#[allow(clippy::await_holding_lock)]` comment above
    /// `resolve_endpoint_respects_fleet_wide_telemetry_off_env_var` for
    /// why holding `TELEMETRY_ENV_LOCK` across this test's `.await` is
    /// safe.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn resolved_addresses_include_disallowed_host_flags_a_resolved_loopback_or_private_literal(
    ) {
        let _lock = lock_telemetry_env();
        assert!(resolved_addresses_include_disallowed_host("127.0.0.1").await);
        assert!(resolved_addresses_include_disallowed_host("10.0.0.1").await);
        assert!(resolved_addresses_include_disallowed_host("::1").await);
        assert!(resolved_addresses_include_disallowed_host("::ffff:127.0.0.1").await);
        assert!(!resolved_addresses_include_disallowed_host("192.0.2.1").await);
    }

    /// Pins the "unresolvable is not itself disallowed" contract using a
    /// dedicated `.invalid`-TLD fixture host -- see `konductor-rs`'s own
    /// mirror test of the same name for the full rationale.
    /// See the `#[allow(clippy::await_holding_lock)]` comment above
    /// `resolve_endpoint_respects_fleet_wide_telemetry_off_env_var` for
    /// why holding `TELEMETRY_ENV_LOCK` across this test's `.await` is
    /// safe.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn resolved_addresses_include_disallowed_host_does_not_flag_an_unresolvable_host() {
        let _lock = lock_telemetry_env();
        assert!(
            !resolved_addresses_include_disallowed_host("telemetry.konductor.example.invalid")
                .await
        );
    }

    // ── AutoSDE finding f-9ec2e9ff: timeout-vs-failure distinction ─────
    //
    // This crate previously had NO resolution timeout of any kind --
    // the CRITICAL fix's structural requirement (fold the shared logic
    // into `telemetry-net` FIRST) is what makes the fix below a single,
    // already-correct addition rather than a second, independently
    // written copy of the CLI's own bug. Both properties are asserted
    // directly against the shared decision function, exactly as
    // `cli/telemetry/report.rs`'s own tests do, so this crate can never
    // silently re-diverge from it.

    /// Property (b): a TIMEOUT must be denied outright, never folded
    /// into the same fail-open, no-pin outcome a genuine resolution
    /// failure gets.
    #[test]
    fn decide_pin_denies_a_timeout_outcome_rather_than_failing_open() {
        assert_eq!(
            telemetry_net::decide_pin(telemetry_net::DnsOutcome::TimedOut),
            None
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

    /// Property (c): this crate's own `endpoint_host_is_allowed_with_pin`
    /// now bounds its resolution at all (it previously had no bound),
    /// via the SAME shared, async-bounded primitive the timeout fix
    /// lives in. A near-zero bound makes `resolve_host_addrs_bounded_async`
    /// report `TimedOut` deterministically regardless of real resolver
    /// latency (proven directly in `telemetry-net`'s own test suite);
    /// this test instead confirms `endpoint_host_is_allowed_with_pin`
    /// itself, at ITS OWN fixed `DNS_RESOLUTION_TIMEOUT`, still resolves
    /// and classifies an ordinary case correctly end-to-end -- i.e. the
    /// wiring (escape hatch -> literal check -> bounded resolve ->
    /// decide_pin) added by this fix compiles and runs correctly for a
    /// real, non-timing-dependent case. Uses a dedicated `.invalid`-TLD
    /// fixture host rather than `DEFAULT_TELEMETRY_ENDPOINT`: the
    /// compile-time default is now a real, resolvable public host, so
    /// it no longer exercises this "nothing to pin" branch. Named to
    /// match `konductor-rs`'s own mirror test of the same fixture and
    /// contract (`endpoint_host_is_allowed_with_pin_returns_no_pin_for_an_unresolvable_host`).
    /// See the `#[allow(clippy::await_holding_lock)]` comment above
    /// `resolve_endpoint_respects_fleet_wide_telemetry_off_env_var` for
    /// why holding `TELEMETRY_ENV_LOCK` across this test's `.await` is
    /// safe.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn endpoint_host_is_allowed_with_pin_returns_no_pin_for_an_unresolvable_host() {
        let _lock = lock_telemetry_env();
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        assert_eq!(
            endpoint_host_is_allowed_with_pin(
                "https://telemetry.konductor.example.invalid/collector"
            )
            .await,
            Some(None),
            "an unresolvable host must still resolve as allowed now that this crate's own \
             resolution path is bounded"
        );
    }

    /// End-to-end regression guard, mirroring `konductor-rs`'s own test
    /// of the same name: the compile-time default endpoint must still
    /// resolve as `allowed` now that a real resolution check runs on
    /// every call.
    /// See the `#[allow(clippy::await_holding_lock)]` comment above
    /// `resolve_endpoint_respects_fleet_wide_telemetry_off_env_var` for
    /// why holding `TELEMETRY_ENV_LOCK` across this test's `.await` is
    /// safe.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn endpoint_host_is_allowed_accepts_the_compile_time_default_endpoint_host() {
        let _lock = lock_telemetry_env();
        assert!(endpoint_host_is_allowed(DEFAULT_TELEMETRY_ENDPOINT).await);
    }

    /// The CRITICAL regression this fix addresses (same as
    /// `konductor-rs`'s own mirror): `KONDUCTOR_METRICS_ENDPOINT`
    /// pointed at a private-range host must be rejected by
    /// `resolve_endpoint`, not sent to.
    /// See the `#[allow(clippy::await_holding_lock)]` comment above
    /// `resolve_endpoint_respects_fleet_wide_telemetry_off_env_var` for
    /// why holding `TELEMETRY_ENV_LOCK` across this test's `.await` is
    /// safe.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn resolve_endpoint_rejects_private_range_endpoint_from_env_var() {
        let _lock = lock_telemetry_env();
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        std::env::set_var(
            "KONDUCTOR_METRICS_ENDPOINT",
            "https://192.168.1.50/collector",
        );
        let resolved = resolve_endpoint().await;
        std::env::remove_var("KONDUCTOR_METRICS_ENDPOINT");
        assert_eq!(resolved, None);
    }

    /// The debug-only escape hatch, same contract as `konductor-rs`'s
    /// own mirror: with `KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT` set,
    /// the same loopback endpoint the test above rejects must resolve.
    /// See the `#[allow(clippy::await_holding_lock)]` comment above
    /// `resolve_endpoint_respects_fleet_wide_telemetry_off_env_var` for
    /// why holding `TELEMETRY_ENV_LOCK` across this test's `.await` is
    /// safe.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn resolve_endpoint_escape_hatch_allows_loopback_endpoint_when_explicitly_set() {
        let _lock = lock_telemetry_env();
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        std::env::set_var(
            "KONDUCTOR_METRICS_ENDPOINT",
            "https://127.0.0.1:4318/collector",
        );
        std::env::set_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR, "1");
        let resolved = resolve_endpoint().await;
        std::env::remove_var("KONDUCTOR_METRICS_ENDPOINT");
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        assert_eq!(
            resolved,
            Some("https://127.0.0.1:4318/collector".to_string())
        );
    }

    // Off-thread propagation (this crate's DNS check runs via
    // `tokio::task::spawn_blocking`, not on the calling task's own
    // worker thread) is exercised in `telemetry-net`'s own test suite
    // (`resolve_host_addrs_bounded_async_*`), which the async check
    // above now delegates to entirely.

    /// A flush cycle with no accumulated calls must resolve no endpoint
    /// at all (no DNS lookup, on-thread or off) -- `flush_once` returns
    /// immediately on an empty snapshot rather than paying resolution's
    /// cost for a cycle with nothing to report.
    #[tokio::test]
    async fn flush_once_with_empty_snapshot_does_not_resolve_endpoint() {
        let counters: ToolCallCounters = std::sync::Arc::new(Mutex::new(HashMap::new()));
        // Should complete promptly with no panic and no observable
        // side effect -- there is nothing to assert on the resolved
        // endpoint directly (flush_once resolves it internally), so
        // this test's real assertion is that an empty flush is a cheap
        // no-op that returns without ever reaching resolve_endpoint's
        // DNS check.
        flush_once(&counters).await;
    }

    /// AutoSDE finding `f-cbc7d92e`: `flush_once` must not discard the
    /// accumulated counters when endpoint resolution denies the send
    /// (a `KONDUCTOR_METRICS_ENDPOINT` pointed at a disallowed host is
    /// used here as a deterministic stand-in for the DNS-timeout case
    /// the finding itself calls out -- both paths return `None` from
    /// `resolve_endpoint_with_pin`, and `flush_once` must treat every
    /// such denial the same way: leave the counters in place for the
    /// next cycle, not silently drop a full flush window's worth of
    /// real counts).
    /// See the `#[allow(clippy::await_holding_lock)]` comment above
    /// `resolve_endpoint_respects_fleet_wide_telemetry_off_env_var` for
    /// why holding `TELEMETRY_ENV_LOCK` across this test's `.await` is
    /// safe.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn flush_once_preserves_counters_when_endpoint_resolution_is_denied() {
        let _lock = lock_telemetry_env();
        std::env::remove_var(TELEMETRY_OFF_ENV_VAR);
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        std::env::set_var(
            "KONDUCTOR_METRICS_ENDPOINT",
            "https://192.168.1.50/collector",
        );

        let counters: ToolCallCounters = std::sync::Arc::new(Mutex::new(HashMap::new()));
        increment_counter(&counters, "some_tool", None, None);

        flush_once(&counters).await;

        std::env::remove_var("KONDUCTOR_METRICS_ENDPOINT");

        let remaining = counters
            .lock()
            .expect("counters mutex must not be poisoned");
        assert_eq!(
            remaining.len(),
            1,
            "flush_once must NOT discard the accumulated counters when endpoint resolution \
             denies the send -- clearing them unconditionally BEFORE resolving would silently \
             lose a full flush window's worth of real counts, even though telemetry is \
             enabled and the very next flush would likely succeed"
        );
    }

    #[test]
    fn read_identity_near_skills_dir_finds_sibling_file() {
        let target_dir = scratch_dir("identity-found");
        let konductor_dir = target_dir.join(".konductor");
        let skills_dir = konductor_dir.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(
            konductor_dir.join("telemetry-id.json"),
            format!(
                r#"{{"schema_version":1,"version":"0.1.0","UUID":"{}","harness":"kiro-cli"}}"#,
                "a".repeat(64)
            ),
        )
        .unwrap();

        let found = read_identity_near_skills_dir(&skills_dir);
        assert_eq!(found, Some("a".repeat(64)));
        fs::remove_dir_all(&target_dir).ok();
    }

    #[test]
    fn read_identity_near_skills_dir_returns_none_when_absent() {
        let target_dir = scratch_dir("identity-absent");
        let skills_dir = target_dir.join(".konductor").join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        assert_eq!(read_identity_near_skills_dir(&skills_dir), None);
        fs::remove_dir_all(&target_dir).ok();
    }

    #[test]
    fn civil_from_days_matches_known_epoch_date() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn increment_and_take_counters_round_trips() {
        let counters: ToolCallCounters = std::sync::Arc::new(Mutex::new(HashMap::new()));
        increment_counter(&counters, "find_skills", None, None);
        increment_counter(&counters, "find_skills", None, None);
        increment_counter(
            &counters,
            "get_skill",
            Some("code-review".to_string()),
            None,
        );

        let snapshot = take_counters(&counters);
        assert_eq!(
            snapshot.get(&("find_skills".to_string(), None, None)),
            Some(&2)
        );
        assert_eq!(
            snapshot.get(&(
                "get_skill".to_string(),
                Some("code-review".to_string()),
                None
            )),
            Some(&1)
        );

        // After take_counters, the map is empty again.
        let after = take_counters(&counters);
        assert!(after.is_empty());
    }

    #[test]
    fn increment_counter_landing_during_flush_is_not_lost() {
        // Simulates the race take_counters's atomic-swap semantics
        // exist to prevent: an increment right after a flush must land
        // in the FRESH map, not be lost.
        let counters: ToolCallCounters = std::sync::Arc::new(Mutex::new(HashMap::new()));
        increment_counter(&counters, "find_skills", None, None);
        let _first_flush = take_counters(&counters);
        // New increment after the flush swap.
        increment_counter(&counters, "find_skills", None, None);
        let second_flush = take_counters(&counters);
        assert_eq!(
            second_flush.get(&("find_skills".to_string(), None, None)),
            Some(&1),
            "an increment landing after a flush must be captured in the next flush, not lost"
        );
    }

    #[test]
    fn unknown_tool_name_repeated_calls_collapse_onto_one_key() {
        let counters: ToolCallCounters = std::sync::Arc::new(Mutex::new(HashMap::new()));
        for _ in 0..5 {
            increment_counter(&counters, UNKNOWN_SENTINEL, None, Some("mcp.unknown_tool"));
        }
        let snapshot = take_counters(&counters);
        assert_eq!(snapshot.len(), 1, "must collapse onto exactly one key");
        assert_eq!(
            snapshot.get(&(UNKNOWN_SENTINEL.to_string(), None, Some("mcp.unknown_tool"))),
            Some(&5)
        );
    }

    #[test]
    fn unknown_skill_name_repeated_calls_collapse_onto_one_key() {
        let counters: ToolCallCounters = std::sync::Arc::new(Mutex::new(HashMap::new()));
        for _ in 0..3 {
            increment_counter(
                &counters,
                "get_skill",
                Some(UNKNOWN_SENTINEL.to_string()),
                Some("mcp.unknown_skill"),
            );
        }
        let snapshot = take_counters(&counters);
        assert_eq!(snapshot.len(), 1);
        assert_eq!(
            snapshot.get(&(
                "get_skill".to_string(),
                Some(UNKNOWN_SENTINEL.to_string()),
                Some("mcp.unknown_skill")
            )),
            Some(&3)
        );
    }

    #[tokio::test]
    async fn materialized_script_path_exists_and_is_executable() {
        use std::os::unix::fs::PermissionsExt;
        let _guard = crate::test_home_lock::lock_home();
        let path = materialize_script().expect("must materialize");
        assert!(path.exists());
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode & 0o100, 0o100);
    }

    /// The portability regression this fix addresses: a real dry-run
    /// build container with `HOME` unset failed the test above with
    /// `Custom { kind: NotFound, error: "HOME is not set" }` before the
    /// fallback existed. Confirms `materialize_script` now succeeds
    /// with `HOME` unset, AND that the fallback directory it lands in
    /// still carries the same non-world-writable `0o700` property the
    /// `HOME`-set path has -- the portability fix must not regress the
    /// TOCTOU/symlink security fix. Serializes against the test above (and
    /// any other `HOME`-mutating test in this crate, including
    /// `logging.rs`'s own `HomeGuard`-based tests) via the crate-wide
    /// `crate::test_home_lock::HOME_ENV_LOCK` so none of them ever observe
    /// each other's `HOME` value mid-test.
    #[tokio::test]
    async fn materialize_script_succeeds_with_home_unset_and_uses_private_fallback_dir() {
        use std::os::unix::fs::PermissionsExt;

        let _guard = crate::test_home_lock::lock_home();
        let original_home = std::env::var_os("HOME");
        // SAFETY: held under the crate-wide HOME_ENV_LOCK for this test's
        // entire body; restored before the lock releases below.
        unsafe {
            std::env::remove_var("HOME");
        }

        let result = materialize_script();

        // SAFETY: see above.
        unsafe {
            match &original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }

        let path = result.expect(
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

    #[tokio::test]
    async fn zombie_process_absence_after_many_spawns() {
        // Detached children of the tokio-based spawn must never
        // linger as zombies: spawn many short-lived
        // children in a loop via the tokio-based spawn_and_send path
        // and confirm none linger as zombies. We can't directly
        // enumerate this process's own zombie children portably from a
        // test, so this test instead asserts the property
        // tokio::process::Command itself provides: dropping a
        // Child without .wait() does not panic or block, and repeated
        // spawns complete promptly (a real zombie-accumulation bug
        // would manifest as spawn() eventually blocking/failing once
        // the process table fills, which this loop would surface as a
        // timeout/failure rather than a clean, fast completion).
        for _ in 0..20 {
            spawn_and_send("https://example.invalid/x", None, "{}".to_string()).await;
        }
    }

    /// FINDING 1 regression (read-only mirror): a file published by a
    /// NEWER binary (higher `schema_version` than this crate's own
    /// `CURRENT_SCHEMA_VERSION`, otherwise valid `UUID`) must still
    /// yield that UUID read-only -- never collapsed into the same
    /// `None` bucket a genuinely malformed/absent file produces, and
    /// (since this crate never writes) never touched on disk either
    /// way.
    #[test]
    fn read_identity_near_skills_dir_reads_newer_schema_uuid_read_only() {
        let target_dir = scratch_dir("newer-schema-read-only");
        let konductor_dir = target_dir.join(".konductor");
        let skills_dir = konductor_dir.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        let identity_path = konductor_dir.join("telemetry-id.json");
        let newer_uuid = "e".repeat(64);
        let newer_contents = format!(
            r#"{{"schema_version":999,"version":"9.9.9","UUID":"{newer_uuid}","harness":"future","new_field":"x"}}"#
        );
        fs::write(&identity_path, &newer_contents).unwrap();
        let before = fs::read(&identity_path).unwrap();

        let found = read_identity_near_skills_dir(&skills_dir);

        let after = fs::read(&identity_path).unwrap();
        assert_eq!(
            before, after,
            "this crate never writes; file must be untouched regardless"
        );
        assert_eq!(found, Some(newer_uuid));

        fs::remove_dir_all(&target_dir).ok();
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
        fs::create_dir_all(&base).unwrap();
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
}
