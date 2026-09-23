// SPDX-License-Identifier: Apache-2.0
//
// telemetry.rs — skill-lookup-core's own mirror of konductor-rs's
// telemetry module.
//
// Duplicated between crates by design, not shared: the two crates are
// not workspace-linked in a way that lets either depend on the other
// for the transport surface (spawn/DNS/host-allowlist/counters).
// Differences from konductor-rs's mirror:
//   - This module reads (never writes) the identity file.
//   - Its detached spawn uses `tokio::process::Command`, so tokio's
//     own orphan-reaping queue reaps the flush task's children.
//   - It emits exactly one event type: `report_mcp_tool_call`.
//
// The nil-UUID sentinel, UUID-shape validation, the machine-scoped
// `$HOME/.konductor/telemetry.json` read path, and the private-dir
// creation check live in the shared `konductor-telemetry` crate.
// `init_identity` resolves `$HOME` explicitly, never derived from
// `--skills-dir` or `std::env::current_exe()`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::io::AsyncWriteExt as _;

/// AWS Solutions Library Solution ID assigned to Konductor.
const SOLUTION_ID: &str = "SO0370";

const DEFAULT_TELEMETRY_ENDPOINT: &str = "https://metrics.awssolutionsbuilder.com/generic";

/// The same checked-in transport script `konductor-rs` embeds, via
/// this crate's own independent `include_str!`.
const TELEMETRY_REPORT_SCRIPT: &str =
    include_str!("../../../../scripts/konductor-telemetry-report.sh");

const MATERIALIZED_SCRIPT_NAME: &str = "konductor-telemetry-report-mcp.sh";

pub use konductor_telemetry::NIL_UUID_SENTINEL;

/// No fallback to `std::env::temp_dir()`, never derived from
/// `--skills-dir` or `current_exe()`. No `HOME` means no anchor the
/// instance record could mean anything against.
///
/// Filters `HOME=""` the same as unset -- `konductor-rs`'s own
/// `env_home_dir` (`cli/install/index.rs`) filters it for the
/// identical reason: an unfiltered empty value would resolve to
/// `Some(PathBuf::from(""))`, and joining onto that builds a
/// cwd-relative `.konductor/` path instead of refusing outright, so
/// `init_identity` would anchor `resolve_instance_uuid_for_wire`
/// against whatever directory this process happens to be running
/// from rather than falling back to `NIL_UUID_SENTINEL`.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
}

/// Resolved at most once, at startup before the flush task is spawned.
/// A `skill-lookup-mcp` instance launched against N different targets
/// still reports exactly one, machine-wide `UUID` -- `skills_dirs`
/// plays no role in identity resolution.
static IDENTITY_CACHE: OnceLock<String> = OnceLock::new();

/// `skills_dirs` is kept in the signature for call-site stability only
/// -- it no longer affects identity resolution.
pub fn init_identity(skills_dirs: &[PathBuf]) {
    let _ = skills_dirs;
    IDENTITY_CACHE.get_or_init(|| match home_dir() {
        Some(home) => konductor_telemetry::resolve_instance_uuid_for_wire(&home),
        None => NIL_UUID_SENTINEL.to_string(),
    });
}

fn cached_uuid() -> &'static str {
    IDENTITY_CACHE
        .get()
        .map(|s| s.as_str())
        .unwrap_or(NIL_UUID_SENTINEL)
}

fn materialize_script() -> std::io::Result<PathBuf> {
    let dir = konductor_telemetry::private_script_dir()?;
    konductor_telemetry::materialize_script(&dir, MATERIALIZED_SCRIPT_NAME, TELEMETRY_REPORT_SCRIPT)
}

/// Fleet-wide opt-out env var, same name and semantics as
/// `konductor-rs`'s own mirror.
const TELEMETRY_OFF_ENV_VAR: &str = "KONDUCTOR_TELEMETRY";
const TELEMETRY_OFF_VALUE: &str = "off";

/// Exposed so `main.rs` can gate spawning the counters/flush task on
/// it structurally, rather than spawning it anyway and relying solely
/// on `resolve_endpoint`'s own per-flush check.
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

/// Mirrors `cli/konductor-rs`'s own `DNS_RESOLUTION_TIMEOUT`. A
/// resolution error still fails open; a timeout does not -- denied
/// outright via the same shared decision, so the two crates can never
/// diverge on this.
const DNS_RESOLUTION_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);

/// Resolves the telemetry endpoint for one flush cycle. `async`
/// because the host-allowlist check performs a blocking DNS
/// resolution, offloaded to a blocking-pool thread via
/// `resolve_host_addrs_bounded_async` rather than run synchronously,
/// which would otherwise block the flush task's worker thread.
///
/// Callers must resolve once per flush cycle and reuse the result --
/// the endpoint and its allowlist verdict are invariant across a
/// cycle. `#[cfg(test)]`: production calls `resolve_endpoint_with_pin`
/// directly.
#[cfg(test)]
async fn resolve_endpoint() -> Option<String> {
    resolve_endpoint_with_pin()
        .await
        .map(|(endpoint, _pin)| endpoint)
}

/// Same resolution as `resolve_endpoint`, but also returns the address
/// (if any) `spawn_and_send` must pin `curl` to via `--resolve` --
/// closes a DNS-rebinding TOCTOU, same rationale as `konductor-rs`'s
/// own mirror.
async fn resolve_endpoint_with_pin() -> Option<(String, Option<std::net::IpAddr>)> {
    if fleet_opted_out() {
        return None;
    }

    // skill-lookup-mcp has no single target_dir (it can be launched
    // against multiple --skills-dir roots at once), so only the
    // compile-time-default and env-var tiers apply here.
    let candidate = if let Ok(from_env) = std::env::var("KONDUCTOR_METRICS_ENDPOINT") {
        if !from_env.is_empty() {
            from_env
        } else {
            DEFAULT_TELEMETRY_ENDPOINT.to_string()
        }
    } else {
        DEFAULT_TELEMETRY_ENDPOINT.to_string()
    };

    // Without this allowlist, env-var-set access in shared CI could
    // redirect telemetry to an attacker-controlled loopback/private
    // address.
    let pinned_ip = endpoint_host_is_allowed_with_pin(&candidate).await?;

    Some((candidate, pinned_ip))
}

/// Same classification and escape-hatch contract as `konductor-rs`'s
/// own mirror, duplicated per this module's "not workspace-linked"
/// convention. `async`: this crate's copy offloads the resolution
/// check to a blocking-pool thread rather than running it
/// synchronously. `#[cfg(test)]`: production calls
/// `endpoint_host_is_allowed_with_pin` directly.
#[cfg(test)]
async fn endpoint_host_is_allowed(endpoint: &str) -> bool {
    endpoint_host_is_allowed_with_pin(endpoint).await.is_some()
}

/// Same allow/deny decision as `endpoint_host_is_allowed`, but also
/// returns the address (if any) `spawn_and_send` must pin `curl` to.
/// The pin must come from the same resolution the allow/deny verdict
/// is based on, never a second, independent lookup.
async fn endpoint_host_is_allowed_with_pin(endpoint: &str) -> Option<Option<std::net::IpAddr>> {
    if std::env::var_os(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR).is_some() {
        return Some(None);
    }
    let host = konductor_telemetry::extract_host(endpoint)?;
    if konductor_telemetry::is_disallowed_local_host(host) {
        return None;
    }
    if host.parse::<std::net::IpAddr>().is_ok() {
        return Some(None);
    }
    let outcome = konductor_telemetry::resolve_host_addrs_bounded_async(
        host.to_string(),
        DNS_RESOLUTION_TIMEOUT,
    )
    .await;
    konductor_telemetry::decide_pin(outcome)
}

/// Bool-only convenience so this module's existing resolution-path
/// tests need no changes. `TimedOut` folds into `true` here only
/// because none of this test-only helper's callers exercise a real
/// timeout; the actual distinction is asserted against
/// `konductor_telemetry::decide_pin` directly.
#[cfg(test)]
async fn resolved_addresses_include_disallowed_host(host: &str) -> bool {
    match konductor_telemetry::resolve_host_addrs_bounded_async(
        host.to_string(),
        DNS_RESOLUTION_TIMEOUT,
    )
    .await
    {
        konductor_telemetry::DnsOutcome::Resolved(addrs) => addrs
            .iter()
            .any(|ip| konductor_telemetry::is_disallowed_ip(*ip)),
        konductor_telemetry::DnsOutcome::Failed => false,
        konductor_telemetry::DnsOutcome::TimedOut => true,
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

/// Howard Hinnant's civil-from-days algorithm, duplicated per this
/// module's "no shared crate" convention.
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

/// The transport seam `spawn_and_send_with_transport` sends through.
/// Mirrors `cli/konductor-rs`'s own identically-named trait in
/// `telemetry/report.rs`, duplicated per this module's own "not
/// workspace-linked" convention. `send` is `async` because this
/// crate's real implementation spawns via `tokio::process::Command`
/// and awaits writing `body` to the child's stdin.
///
/// Taken generically (`impl Transport`) rather than as `&dyn
/// Transport`: native `async fn` in a trait is not object-safe
/// without nightly-only work or the `async-trait` crate, which this
/// crate does not otherwise need.
trait Transport {
    async fn send(&self, endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: &str);
}

/// The real spawn mechanics, factored out so they exist in every
/// build, `cfg(test)` included -- unlike `RealTransport` itself
/// (gated to `#[cfg(not(test))]`), `zombie_process_absence_after_many_spawns`
/// below wants a genuine spawn against its own dedicated
/// `telemetry_test_sink::TelemetrySink` for a real TLS round-trip: it
/// tests tokio's orphan-reaping of a real child process, not this
/// module's telemetry-routing logic. Byte-identical to what
/// `spawn_and_send` always did before this seam existed.
async fn real_spawn_and_send(endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: &str) {
    let Ok(script_path) = materialize_script() else {
        return;
    };
    let mut command = tokio::process::Command::new(&script_path);
    command.arg(endpoint);
    if let Some(ip) = pinned_ip {
        if let Some(host) = konductor_telemetry::extract_host(endpoint) {
            command.arg(konductor_telemetry::build_resolve_arg(
                host,
                konductor_telemetry::extract_port(endpoint),
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
    // child is dropped here without .wait() -- tokio's own background
    // orphan-reaping queue still reaps it.
}

/// Production's only implementation of `Transport`: delegates straight
/// to `real_spawn_and_send`. `#[cfg(not(test))]`: this type does not
/// exist in a test build, mirroring `cli/konductor-rs`'s own mirror.
#[cfg(not(test))]
struct RealTransport;

#[cfg(not(test))]
impl Transport for RealTransport {
    async fn send(&self, endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: &str) {
        real_spawn_and_send(endpoint, pinned_ip, body).await;
    }
}

/// Production entry point: every `report_mcp_tool_call` call funnels
/// through here. Outside `cfg(test)` this is unconditionally
/// `RealTransport`.
///
/// Under `cfg(test)` only, this defers to `default_test_transport()`
/// instead: `report_mcp_tool_call`'s own signature is unchanged, so a
/// caller reaching it has no parameter list to thread a `Transport`
/// through.
async fn spawn_and_send(endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: String) {
    #[cfg(test)]
    {
        spawn_and_send_with_transport(default_test_transport(), endpoint, pinned_ip, &body).await;
        return;
    }
    #[cfg(not(test))]
    spawn_and_send_with_transport(&RealTransport, endpoint, pinned_ip, &body).await;
}

/// Same send as `spawn_and_send`, but through an explicitly injected
/// `Transport` -- the seam this module's own tests use directly,
/// passing a `RecordingTransport`.
async fn spawn_and_send_with_transport(
    transport: &impl Transport,
    endpoint: &str,
    pinned_ip: Option<std::net::IpAddr>,
    body: &str,
) {
    transport.send(endpoint, pinned_ip, body).await;
}

/// `#[cfg(test)]`-only global, the one place this module uses a
/// global rather than explicit injection, for the same reason
/// `cli/konductor-rs`'s own mirror does: `report_mcp_tool_call`'s
/// unchanged signature gives an in-crate test no parameter list to
/// inject a `Transport` through. Every caller gets the identical,
/// never-mutated-after-init `RecordingTransport` instance.
#[cfg(test)]
static DEFAULT_TEST_TRANSPORT: OnceLock<RecordingTransport> = OnceLock::new();

#[cfg(test)]
fn default_test_transport() -> &'static RecordingTransport {
    DEFAULT_TEST_TRANSPORT.get_or_init(RecordingTransport::default)
}

/// Test-only stub `Transport`: records every send it receives instead
/// of spawning anything, so a test can assert on what WOULD have been
/// sent without a real process, DNS resolution, or network egress ever
/// occurring.
#[cfg(test)]
#[derive(Default)]
struct RecordingTransport {
    sent: Mutex<Vec<RecordedSend>>,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct RecordedSend {
    endpoint: String,
    pinned_ip: Option<std::net::IpAddr>,
    body: String,
}

#[cfg(test)]
impl RecordingTransport {
    /// Snapshot of every send recorded so far, oldest first. Never
    /// cleared automatically -- since `default_test_transport()` is
    /// shared crate-wide, a test asserting on this must filter to its
    /// own endpoint/body rather than assume an empty starting state.
    fn recorded(&self) -> Vec<RecordedSend> {
        self.sent
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

#[cfg(test)]
impl Transport for RecordingTransport {
    async fn send(&self, endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: &str) {
        self.sent
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(RecordedSend {
                endpoint: endpoint.to_string(),
                pinned_ip,
                body: body.to_string(),
            });
    }
}

/// Called once per accumulated `(tool_name, skill_name, error_code)`
/// key per flush cycle. Fires unconditionally under the nil-UUID
/// sentinel when no identity was discoverable at startup -- legitimate
/// unattributed usage. `endpoint` is resolved once per flush cycle by
/// the caller, not re-resolved here per key.
pub async fn report_mcp_tool_call(
    endpoint: &str,
    pinned_ip: Option<std::net::IpAddr>,
    tool_name: &str,
    skill_name: Option<&str>,
    error_code: Option<&str>,
    count: u64,
) {
    let uuid = cached_uuid();
    let data = build_mcp_tool_call_data(uuid, tool_name, skill_name, error_code, count);
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

/// Factored out of `report_mcp_tool_call` so the schema-drift guard
/// test can assert against the real, shipped body-construction path.
fn build_mcp_tool_call_data(
    uuid: &str,
    tool_name: &str,
    skill_name: Option<&str>,
    error_code: Option<&str>,
    count: u64,
) -> serde_json::Value {
    let target_name = match skill_name {
        Some(skill) => format!("{tool_name}:{skill}"),
        None => tool_name.to_string(),
    };
    serde_json::json!({
        "eventId": build_event_id(uuid),
        "eventType": "mcp_tool_call",
        "targetName": target_name,
        "sessionId": null,
        "parentSessionId": null,
        "errorCode": error_code,
        "harness": null,
        // Explicit `null`, never omitted. agentVersion has no
        // per-target equivalent here: an mcp_tool_call event isn't
        // scoped to one install target.
        "agentVersion": null,
        "TimeStamp": iso8601_now(),
        // Not part of the core per-invocation schema every other
        // eventType shares -- this flush cycle's accumulated count.
        "count": count,
    })
}

/// In-process counters, keyed by `(tool_name, skill_name, error_code)`.
/// `errorCode: None` for a successful call. Shared between the server
/// struct and the flush task.
pub type ToolCallCounters =
    std::sync::Arc<Mutex<HashMap<(String, Option<String>, Option<&'static str>), u64>>>;

/// Fixed sentinel for an unrecognized `tool_name`/`skill_name` --
/// bounds cardinality to one entry.
pub const UNKNOWN_SENTINEL: &str = "<unknown>";

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

/// Atomically swaps the counter map so any increment landing during
/// or immediately after a flush is captured in the new map, never
/// lost to a read-then-clear race.
pub fn take_counters(
    counters: &ToolCallCounters,
) -> HashMap<(String, Option<String>, Option<&'static str>), u64> {
    let mut map = counters
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    std::mem::take(&mut *map)
}

/// Reports one event per accumulated key, then swaps the counter map.
/// Resolves the endpoint once for the whole cycle and skips entirely
/// when counters are empty, so an idle tick pays no DNS cost.
///
/// Checks emptiness and resolves the endpoint before swapping the
/// counters out: counters are cleared only once there's somewhere to
/// send them, so a denied resolution on one tick (a timeout, not a
/// persistent opt-out) doesn't discard a flush window's worth of real
/// counts. The emptiness check is a cheap peek at the map, no
/// `mem::take`, so the "no DNS lookup on an idle cycle" property this
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

    /// Dedicated lock for every test mutating `KONDUCTOR_TELEMETRY`/
    /// `KONDUCTOR_METRICS_ENDPOINT`/
    /// `KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT` -- `cargo test` runs
    /// concurrently by default, and these env vars have no per-thread
    /// scoping.
    static TELEMETRY_ENV_LOCK: StdMutex<()> = StdMutex::new(());

    fn lock_telemetry_env() -> std::sync::MutexGuard<'static, ()> {
        TELEMETRY_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    // Transport seam: spawn_and_send_with_transport is exercised
    // directly against a freshly-constructed RecordingTransport (never
    // the shared default_test_transport(), which other tests in this
    // file may also be recording into concurrently) -- isolates each
    // test's own assertions to sends it itself made.

    #[tokio::test]
    async fn spawn_and_send_with_transport_records_endpoint_pin_and_body_unchanged() {
        let transport = RecordingTransport::default();
        let ip: std::net::IpAddr = "203.0.113.5".parse().unwrap();

        spawn_and_send_with_transport(
            &transport,
            "https://example.invalid/collector",
            Some(ip),
            r#"{"eventType":"mcp_tool_call"}"#,
        )
        .await;

        let recorded = transport.recorded();
        assert_eq!(
            recorded,
            vec![RecordedSend {
                endpoint: "https://example.invalid/collector".to_string(),
                pinned_ip: Some(ip),
                body: r#"{"eventType":"mcp_tool_call"}"#.to_string(),
            }],
            "the injected transport must receive exactly the endpoint, pin, and body \
             spawn_and_send_with_transport was called with, unchanged -- no process spawned, \
             no DNS resolution, no network egress"
        );
    }

    /// `spawn_and_send` (the unparameterized production entry point
    /// `report_mcp_tool_call` reaches) must, in THIS test build, route
    /// through the shared test-only transport rather than
    /// `RealTransport` -- `RealTransport` does not even exist under
    /// `cfg(test)` (see its own `#[cfg(not(test))]` gate), so there is
    /// no way for this call to reach a real process spawn regardless of
    /// what endpoint is passed. This is the property that replaces the
    /// removed `cfg(test)` redirect for every call site `spawn_and_send`
    /// (not `spawn_and_send_with_transport`) is reached from.
    #[tokio::test]
    async fn spawn_and_send_default_entry_point_never_reaches_a_real_transport_in_a_test_build() {
        let before = default_test_transport().recorded().len();

        spawn_and_send(
            "https://telemetry-seam-probe.example.invalid/generic",
            None,
            r#"{"probe":"default-entry-point"}"#.to_string(),
        )
        .await;

        let after = default_test_transport().recorded();
        assert_eq!(
            after.len(),
            before + 1,
            "spawn_and_send must record exactly one more send into the shared test transport"
        );
        assert_eq!(
            after.last().unwrap().endpoint,
            "https://telemetry-seam-probe.example.invalid/generic",
            "the recorded send must carry the exact endpoint passed to spawn_and_send, \
             confirming the call actually reached the stub rather than being silently dropped"
        );
    }

    // Schema-drift guard, the MCP-side counterpart of
    // konductor-rs/report.rs's session_id_pattern_from_schema: reads
    // docs/telemetry-schema.json live off disk rather than a
    // hand-typed copy, so drift between the schema and what this
    // crate emits fails loudly.

    fn required_keys_from_schema() -> Vec<String> {
        let schema_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../docs/telemetry-schema.json");
        let contents = fs::read_to_string(&schema_path).unwrap_or_else(|e| {
            panic!(
                "failed to read {} (expected the checked-in telemetry schema): {e}",
                schema_path.display()
            )
        });
        let schema: serde_json::Value = serde_json::from_str(&contents).unwrap();
        schema["required"]
            .as_array()
            .expect("schema must declare a top-level `required` array")
            .iter()
            .map(|v| {
                v.as_str()
                    .expect("each `required` entry must be a string")
                    .to_string()
            })
            .collect()
    }

    /// Builds a real `mcp_tool_call` body via `build_mcp_tool_call_data`
    /// (never a hand-duplicated copy) and asserts every key the live
    /// schema's `required` array names is present -- an explicit JSON
    /// `null` counts as present, only a genuinely omitted key fails.
    #[test]
    fn mcp_tool_call_body_satisfies_schemas_required_list() {
        let required = required_keys_from_schema();
        assert!(
            required.contains(&"agentVersion".to_string()),
            "sanity: the schema's own required list must still name agentVersion -- if this \
             fails, the schema itself changed and this test's premise needs revisiting"
        );

        let data =
            build_mcp_tool_call_data(&"a".repeat(64), "get_skill", Some("code-review"), None, 3);
        let object = data
            .as_object()
            .expect("build_mcp_tool_call_data must produce a JSON object");

        let missing: Vec<&String> = required
            .iter()
            .filter(|key| !object.contains_key(key.as_str()))
            .collect();

        assert!(
            missing.is_empty(),
            "mcp_tool_call event body is missing required key(s) {missing:?} that \
             docs/telemetry-schema.json's own `required` array demands -- every key must be \
             present (as an explicit JSON null when the field doesn't apply to this eventType, \
             matching this object's own sessionId/parentSessionId/harness/agentVersion \
             convention), never omitted. Full body: {data}"
        );
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
    fn nil_uuid_sentinel_is_64_zero_chars() {
        assert_eq!(NIL_UUID_SENTINEL.len(), 64);
        assert!(NIL_UUID_SENTINEL.chars().all(|c| c == '0'));
    }

    // resolve_endpoint/endpoint_host_is_allowed are async (the DNS
    // check runs via spawn_blocking), so the tests below hold
    // TELEMETRY_ENV_LOCK's std MutexGuard across .await. Safe here:
    // each #[tokio::test] gets its own runtime, so there's never a
    // second task in the same runtime that could contend for the lock.
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

    // Host allowlist: the pure classification/parsing primitives live
    // in the konductor-telemetry crate and are exercised by its own suite.
    // The tests below exercise this module's own glue around the
    // shared, bounded, async resolution path. Each holds
    // TELEMETRY_ENV_LOCK's std MutexGuard across its own .await --
    // safe per the #[tokio::test] runtime-isolation note above.

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

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn resolved_addresses_include_disallowed_host_does_not_flag_an_unresolvable_host() {
        let _lock = lock_telemetry_env();
        assert!(
            !resolved_addresses_include_disallowed_host("telemetry.konductor.example.invalid")
                .await
        );
    }

    // Timeout-vs-failure distinction: both properties are asserted
    // directly against the shared decision function, exactly as
    // cli/telemetry/report.rs's own tests do.

    #[test]
    fn decide_pin_denies_a_timeout_outcome_rather_than_failing_open() {
        assert_eq!(
            konductor_telemetry::decide_pin(konductor_telemetry::DnsOutcome::TimedOut),
            None
        );
    }

    #[test]
    fn decide_pin_fails_open_for_a_genuine_resolution_failure() {
        assert_eq!(
            konductor_telemetry::decide_pin(konductor_telemetry::DnsOutcome::Failed),
            Some(None)
        );
    }

    /// Confirms `endpoint_host_is_allowed_with_pin` resolves and
    /// classifies an ordinary case correctly end-to-end now that its
    /// own resolution is bounded.
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

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn endpoint_host_is_allowed_accepts_the_compile_time_default_endpoint_host() {
        let _lock = lock_telemetry_env();
        assert!(endpoint_host_is_allowed(DEFAULT_TELEMETRY_ENDPOINT).await);
    }

    /// `KONDUCTOR_METRICS_ENDPOINT` pointed at a private-range host
    /// must be rejected by `resolve_endpoint`, not sent to.
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
    // spawn_blocking, not the calling task's own worker thread) is
    // exercised in konductor-telemetry's own test suite.

    /// `flush_once` returns immediately on an empty snapshot, without
    /// ever reaching `resolve_endpoint`'s DNS check.
    #[tokio::test]
    async fn flush_once_with_empty_snapshot_does_not_resolve_endpoint() {
        let counters: ToolCallCounters = std::sync::Arc::new(Mutex::new(HashMap::new()));
        flush_once(&counters).await;
    }

    /// `flush_once` must not discard the accumulated counters when
    /// endpoint resolution denies the send -- leave them in place for
    /// the next cycle rather than silently dropping a flush window's
    /// worth of real counts.
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

    /// `init_identity`/`cached_uuid` must resolve the machine-scoped
    /// instance record from `$HOME/.konductor/telemetry.json`, never
    /// from a `--skills-dir`'s own sibling `telemetry-id.json`.
    #[tokio::test]
    async fn init_identity_resolves_from_home_dir_not_from_skills_dir_sibling() {
        let _guard = crate::test_home_lock::lock_home();
        let home = scratch_dir("init-identity-home");
        fs::create_dir_all(&home).unwrap();

        // A different target directory with its own per-target
        // telemetry-id.json sibling, which must be ignored.
        let target_dir = scratch_dir("init-identity-target");
        let target_konductor_dir = target_dir.join(".konductor");
        let skills_dir = target_konductor_dir.join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        let target_only_uuid = "f".repeat(64);
        fs::write(
            target_konductor_dir.join("telemetry-id.json"),
            format!(
                r#"{{"schema_version":1,"version":"0.1.0","UUID":"{target_only_uuid}","harness":"kiro-cli"}}"#
            ),
        )
        .unwrap();

        let instance_uuid = konductor_telemetry::resolve_instance_uuid_for_wire(&home);
        assert_eq!(
            instance_uuid,
            konductor_telemetry::NIL_UUID_SENTINEL,
            "sanity: no telemetry.json exists at `home` yet"
        );
        let minted = konductor_telemetry::ensure_instance(&home, true, || {
            "2026-01-01T00:00:00.000Z".to_string()
        });

        let original_home = std::env::var_os("HOME");
        // SAFETY: held under the crate-wide HOME_ENV_LOCK for this
        // test's entire body; restored before the lock releases below.
        unsafe {
            std::env::set_var("HOME", &home);
        }

        let resolved = match home_dir() {
            Some(resolved_home) => {
                assert_eq!(resolved_home, home);
                konductor_telemetry::resolve_instance_uuid_for_wire(&resolved_home)
            }
            None => panic!("HOME was just set explicitly and must resolve"),
        };

        // SAFETY: see above.
        unsafe {
            match &original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }

        assert_eq!(
            resolved, minted.uuid,
            "identity resolution must return the $HOME-scoped instance UUID"
        );
        assert_ne!(
            resolved, target_only_uuid,
            "identity resolution must NEVER return a target-relative per-target UUID -- this \
             is exactly the walk-up-from-a-passed-directory pattern this module forbids reusing \
             for the machine-scoped instance record"
        );

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    #[test]
    fn home_dir_resolves_from_home_env_var_not_from_binary_location() {
        let _guard = crate::test_home_lock::lock_home();
        let fake_home = scratch_dir("home-dir-env-var-only");
        fs::create_dir_all(&fake_home).unwrap();
        let original_home = std::env::var_os("HOME");

        // SAFETY: held under the crate-wide HOME_ENV_LOCK.
        unsafe {
            std::env::set_var("HOME", &fake_home);
        }
        let resolved = home_dir();

        // SAFETY: see above.
        unsafe {
            match &original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }

        assert_eq!(
            resolved,
            Some(fake_home.clone()),
            "home_dir() must resolve exactly the HOME env var, never a path derived from \
             std::env::current_exe() or from any --skills-dir/target_dir argument"
        );
        assert_ne!(
            resolved.as_deref(),
            std::env::current_exe()
                .ok()
                .as_deref()
                .and_then(|p| p.parent()),
            "home_dir() must never equal the running binary's own containing directory"
        );
        fs::remove_dir_all(&fake_home).ok();
    }

    /// Fifth site of the same unfiltered-`HOME` defect class fixed
    /// individually across `cli/konductor-rs` (`env_home_dir`,
    /// `install.rs`, `uninstall.rs`, `telemetry/report.rs`): this
    /// crate keeps its own copy of the module rather than sharing it
    /// (see this file's own top-of-file doc comment), so that earlier
    /// sweep never reached it. `HOME=""` must resolve the same as
    /// unset, not to `Some(PathBuf::from(""))` -- which
    /// `resolve_instance_uuid_for_wire` would then anchor against a
    /// cwd-relative `.konductor/` path instead of falling back to
    /// `NIL_UUID_SENTINEL`.
    #[test]
    fn home_dir_treats_empty_string_the_same_as_unset() {
        let _guard = crate::test_home_lock::lock_home();
        let original_home = std::env::var_os("HOME");

        // SAFETY: held under the crate-wide HOME_ENV_LOCK.
        unsafe {
            std::env::set_var("HOME", "");
        }
        let resolved = home_dir();

        // SAFETY: see above.
        unsafe {
            match &original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }

        assert_eq!(
            resolved, None,
            "HOME=\"\" must resolve the same as HOME unset, not to Some(PathBuf::from(\"\")) -- \
             an unfiltered empty value silently becomes a cwd-relative path once joined onto"
        );
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

    /// Pins both halves of this crate's own `materialize_script` call:
    /// existence/executable-bit alone can't catch a `dir`/
    /// `script_name`/`contents` transposition against
    /// `cli/konductor-rs`'s own call, since both consumers pass a
    /// private per-uid dir and a `String` argument in the same
    /// position -- only reading the materialized name AND bytes back
    /// tells the two calls apart.
    #[tokio::test]
    async fn materialized_script_has_this_crates_own_name_and_contents() {
        let _guard = crate::test_home_lock::lock_home();
        let path = materialize_script().expect("must materialize");
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some(MATERIALIZED_SCRIPT_NAME),
            "skill-lookup-core must materialize under its own filename \
             (konductor-telemetry-report-mcp.sh), not konductor-rs's \
             (konductor-telemetry-report.sh) -- a swapped script_name argument at this call \
             site would still pass an existence/executable-bit-only check"
        );
        let contents = fs::read_to_string(&path).expect("materialized file must be readable");
        assert_eq!(
            contents, TELEMETRY_REPORT_SCRIPT,
            "the materialized file's bytes must equal this crate's own embedded script \
             constant -- a swapped contents argument at this call site would still pass an \
             existence/executable-bit-only check"
        );
    }

    /// The shell-side half of the HTTPS-only guarantee: the Rust side
    /// enforces it independently via `extract_host`'s own
    /// `strip_prefix("https://")`, so if this `case` construct were
    /// ever dropped from the script, that Rust gate would still hold
    /// and every existing test would keep passing -- only reading the
    /// materialized script's own contents catches the silent loss of
    /// defence-in-depth. One per consumer (not shared) for the same
    /// reason the content/filename pin above is one per consumer: this
    /// reads THIS crate's own materialized file, so a transposition
    /// bug specific to this call site is caught here regardless of
    /// what konductor-rs's own copy of this test finds.
    #[tokio::test]
    async fn materialized_script_still_enforces_https_only() {
        let _guard = crate::test_home_lock::lock_home();
        let path = materialize_script().expect("must materialize");
        let contents = fs::read_to_string(&path).expect("materialized file must be readable");
        assert!(
            contents.contains("case \"$endpoint\" in") && contents.contains("https://*) ;;"),
            "the materialized script must still contain the shell-side HTTPS-only gate \
             (`case \"$endpoint\" in https://*) ;; *) exit 0 ...`) -- dropping it would leave \
             the Rust-side strip_prefix(\"https://\") gate as the only enforcement, silently \
             losing defence-in-depth with no other test catching it"
        );
    }

    /// Confirms `materialize_script` succeeds with `HOME` unset (a
    /// real dry-run build container failed this before the fallback
    /// existed), and that the fallback directory still carries the
    /// same `0o700` property the `HOME`-set path has.
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

    /// Detached children of the tokio-based spawn must never linger as
    /// zombies. Asserts the property `tokio::process::Command` itself
    /// provides: repeated spawns complete promptly rather than
    /// eventually blocking as the process table fills.
    ///
    /// Calls `real_spawn_and_send` directly, never `spawn_and_send`
    /// (which, in this test build, routes to the shared
    /// `RecordingTransport` stub and would spawn nothing at all) --
    /// this test wants a real TLS round-trip against a dedicated sink
    /// instance for its own zombie-free assertion, exercising the same
    /// real spawn mechanics `RealTransport` calls in production.
    #[tokio::test]
    async fn zombie_process_absence_after_many_spawns() {
        let sink = telemetry_test_sink::TelemetrySink::start();
        let ca_bundle = sink.ca_bundle_path().display().to_string();
        std::env::set_var("CURL_CA_BUNDLE", &ca_bundle);
        for _ in 0..20 {
            real_spawn_and_send(&sink.endpoint_url(), None, "{}").await;
        }
        std::env::remove_var("CURL_CA_BUNDLE");
    }

    /// A `$HOME/.konductor/telemetry.json` published by a newer binary
    /// must still yield its `UUID` read-only, through `home_dir()`'s
    /// own resolution -- confirms the delegation to the shared crate
    /// preserves that behavior end-to-end.
    #[test]
    fn instance_record_newer_schema_uuid_is_read_read_only_through_home_dir() {
        let _guard = crate::test_home_lock::lock_home();
        let home = scratch_dir("newer-schema-through-home-dir");
        fs::create_dir_all(&home).unwrap();
        let instance_path = home.join(".konductor").join("telemetry.json");
        fs::create_dir_all(instance_path.parent().unwrap()).unwrap();
        let newer_uuid = "e".repeat(64);
        let newer_contents = format!(
            r#"{{"schema_version":999,"UUID":"{newer_uuid}","created_at":"2099-01-01T00:00:00.000Z","telemetry_consent":true,"new_field":"x"}}"#
        );
        fs::write(&instance_path, &newer_contents).unwrap();
        let before = fs::read(&instance_path).unwrap();

        let original_home = std::env::var_os("HOME");
        // SAFETY: held under the crate-wide HOME_ENV_LOCK.
        unsafe {
            std::env::set_var("HOME", &home);
        }
        let resolved = home_dir()
            .map(|h| konductor_telemetry::resolve_instance_uuid_for_wire(&h))
            .unwrap();
        // SAFETY: see above.
        unsafe {
            match &original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }

        let after = fs::read(&instance_path).unwrap();
        assert_eq!(
            before, after,
            "this module never writes; telemetry.json must be untouched regardless"
        );
        assert_eq!(resolved, newer_uuid);

        fs::remove_dir_all(&home).ok();
    }

    // create_private_dir_all's own direct-call hardening tests
    // (symlink-at-target rejection, ordinary-directory success) now
    // live in konductor-telemetry's own test module, alongside the
    // function itself -- moved, not dropped, when this crate's copy
    // was deleted in favor of konductor_telemetry::create_private_dir_all.
}
