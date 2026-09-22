// SPDX-License-Identifier: Apache-2.0
//
// telemetry/report.rs — the `telemetry::report_*` call-site API.
//
// Every function here returns `()`, never `Result`: telemetry failure
// must never propagate to a caller.

#[cfg(not(test))]
use std::io::Write as _;
#[cfg(not(test))]
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use super::envelope::{EventEnvelope, EventType, OuterEnvelope};
use crate::cli::install::index;
// `identity` is otherwise unused in this module's own non-test code --
// no production `report_*` gate reads the legacy per-target identity
// file anymore -- but stays available for `#[cfg(test)]` call sites
// below that simulate a developer machine predating its retirement.
#[allow(unused_imports)]
use super::identity;
use super::install_info;
use super::instance;

use konductor_telemetry::NIL_UUID_SENTINEL;

/// AWS Solutions Library Solution ID assigned to Konductor.
pub(super) const SOLUTION_ID: &str = "SO0370";

const DEFAULT_TELEMETRY_ENDPOINT: &str = "https://metrics.awssolutionsbuilder.com/generic";

/// Env var override, ahead of `.konductor/config.yml`.
const TELEMETRY_ENDPOINT_ENV_VAR: &str = "KONDUCTOR_METRICS_ENDPOINT";

/// Fleet-wide opt-out (`KONDUCTOR_TELEMETRY=off`). Checked first in
/// `resolve_endpoint`, ahead of a repo's own `telemetry.enabled: false`.
const TELEMETRY_OFF_ENV_VAR: &str = "KONDUCTOR_TELEMETRY";

const TELEMETRY_OFF_VALUE: &str = "off";

const TELEMETRY_REPORT_SCRIPT: &str =
    include_str!("../../../../../scripts/konductor-telemetry-report.sh");

const MATERIALIZED_SCRIPT_NAME: &str = "konductor-telemetry-report.sh";

/// No fallback to `std::env::temp_dir()`: with no `HOME` there is no
/// anchor the instance record could mean anything against. Routes
/// through `index::env_home_dir` so `HOME=""` refuses the same way an
/// unset `HOME` does, instead of resolving to a relative path that
/// `instance::ensure_instance_with_migration`/
/// `resolve_instance_uuid_for_wire` would silently treat as real.
fn home_dir() -> Option<std::path::PathBuf> {
    index::env_home_dir()
}

/// The consent decision itself, as a pure function of its two inputs
/// -- no I/O, no `HOME` lookup, no instance-file resolution. ANDed:
/// either input being false suppresses reporting, unconditionally,
/// and a per-target opt-out can never be overridden by machine
/// consent.
///
/// Split out of `telemetry_consent_allows` so this AND logic is
/// exercisable without a filesystem: `machine_consent` is exactly
/// `InstanceRecord.telemetry_consent`, resolved by the caller.
fn consent_decision(target_already_opted_out: bool, machine_consent: bool) -> bool {
    !target_already_opted_out && machine_consent
}

/// Resolves this call's two consent inputs -- `HOME` and the instance
/// record -- then applies `consent_decision`.
///
/// Always resolves/mints the instance record even when
/// `target_already_opted_out` is true, so a later call for a
/// different, opted-in target on the same machine finds a record
/// already there.
fn telemetry_consent_allows(target_already_opted_out: bool) -> bool {
    let Some(home) = home_dir() else {
        return false;
    };
    let record = instance::ensure_instance_with_migration(&home, target_already_opted_out, true);
    consent_decision(target_already_opted_out, record.telemetry_consent)
}

/// Debug-only escape hatch for the host-allowlist check below.
const TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR: &str = "KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT";

/// Whether telemetry is disabled (fleet-wide env var or per-repo
/// config), or no endpoint resolves. `KONDUCTOR_TELEMETRY=off` wins
/// over a repo's own `.konductor/config.yml`. Endpoint resolution
/// order: env var -> config.yml -> compile-time default.
///
/// Reads just the `telemetry:` key out of
/// `<target_dir>/.konductor/config.yml`, deliberately not through the
/// `cli::config::Config` machinery, which models an unrelated schema.
/// `#[cfg(test)]`: production calls `resolve_endpoint_with_pin` directly.
#[cfg(test)]
fn resolve_endpoint(target_dir: &std::path::Path) -> Option<String> {
    resolve_endpoint_with_pin(target_dir).map(|(endpoint, _pinned_ip)| endpoint)
}

/// Same resolution as `resolve_endpoint`, but also returns the address
/// (if any) `spawn_and_send` must pin `curl` to via `--resolve` --
/// closes a DNS-rebinding TOCTOU between this check's own resolution
/// and curl's later, independent one.
fn resolve_endpoint_with_pin(
    target_dir: &std::path::Path,
) -> Option<(String, Option<std::net::IpAddr>)> {
    if std::env::var(TELEMETRY_OFF_ENV_VAR).as_deref() == Ok(TELEMETRY_OFF_VALUE) {
        return None;
    }

    let raw = read_telemetry_config(target_dir);

    if let Some(false) = raw.as_ref().and_then(|r| r.enabled) {
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

    // Host allowlist: without it, config-write or env-var-set access
    // in shared CI could redirect telemetry to an attacker-controlled
    // host via a loopback/private-range override.
    let pinned_ip = endpoint_host_is_allowed_with_pin(&candidate)?;

    Some((candidate, pinned_ip))
}

/// Rejects a loopback (`127.0.0.1`/`::1`/`localhost`), link-local, or
/// RFC 1918 private-range host, unless the debug-only
/// `KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT` escape hatch is set. A
/// host this function cannot classify at all is not allowed.
///
/// Runs the cheap literal-string/IP-literal check first, then a real
/// DNS resolution check -- the literal check alone is bypassable by a
/// hostname like `127.0.0.1.nip.io`, which resolves to a loopback
/// address without being one itself. A hostname that fails to resolve
/// at all is NOT itself treated as disallowed. `#[cfg(test)]`:
/// production calls `endpoint_host_is_allowed_with_pin` directly.
#[cfg(test)]
fn endpoint_host_is_allowed(endpoint: &str) -> bool {
    endpoint_host_is_allowed_with_pin(endpoint).is_some()
}

/// Same allow/deny decision as `endpoint_host_is_allowed`, but also
/// returns the address (if any) `spawn_and_send` must pin `curl` to.
/// The pin comes from the SAME resolution this function's own
/// allow/deny verdict is based on, never a second, independent lookup
/// (which would just move the TOCTOU window).
///
/// The literal-check and escape-hatch handling is this crate's own
/// glue; the resolution bound and allow/deny/pin decision are shared
/// with `skill-lookup-core`'s own mirror.
///
/// Returns:
/// - `None` -- disallowed; do not send. Also covers a resolution that
///   timed out (denied outright, never folded into the fail-open case).
/// - `Some(None)` -- allowed, nothing to pin.
/// - `Some(Some(ip))` -- allowed; `ip` is what to pin to.
fn endpoint_host_is_allowed_with_pin(endpoint: &str) -> Option<Option<std::net::IpAddr>> {
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
    let outcome = konductor_telemetry::resolve_host_addrs_bounded(host, DNS_RESOLUTION_TIMEOUT);
    konductor_telemetry::decide_pin(outcome)
}

/// Resolves `host` via `konductor_telemetry::resolve_host_addrs_bounded` and
/// checks whether the outcome would be flagged as disallowed. `TimedOut`
/// folds into `true` here only because none of this test-only helper's
/// own callers exercise a real timeout.
#[cfg(test)]
fn resolved_addresses_include_disallowed_host(host: &str) -> bool {
    match konductor_telemetry::resolve_host_addrs_bounded(host, DNS_RESOLUTION_TIMEOUT) {
        konductor_telemetry::DnsOutcome::Resolved(addrs) => addrs
            .iter()
            .any(|ip| konductor_telemetry::is_disallowed_ip(*ip)),
        konductor_telemetry::DnsOutcome::Failed => false,
        konductor_telemetry::DnsOutcome::TimedOut => true,
    }
}

/// Upper bound on this module's DNS resolution. `report_error` reaches
/// this resolution before printing the user-facing error line, so an
/// un-timeboxed lookup here stalls every telemetry-enabled CLI error's
/// output. A resolution error still fails open; a timeout does not --
/// it is denied outright.
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

/// `None` on missing/unreadable/malformed -- the same "absent"
/// tolerance every telemetry read path applies.
fn read_telemetry_config(target_dir: &std::path::Path) -> Option<RawTelemetrySection> {
    let path = target_dir
        .join(super::super::config::KONDUCTOR_DIR_NAME)
        .join(super::super::config::CONFIG_FILE_NAME);
    let contents = std::fs::read_to_string(path).ok()?;
    let parsed: RawConfigTelemetryOnly = serde_yaml::from_str(&contents).ok()?;
    parsed.telemetry
}

/// Materializes the embedded transport script into a process-private
/// directory and makes it executable. Self-healing: a deleted or
/// stale copy is rewritten.
fn materialize_script() -> std::io::Result<std::path::PathBuf> {
    let dir = konductor_telemetry::private_script_dir()?;
    konductor_telemetry::materialize_script(&dir, MATERIALIZED_SCRIPT_NAME, TELEMETRY_REPORT_SCRIPT)
}

/// The transport seam `spawn_and_send_with_transport` sends through,
/// injected explicitly rather than resolved via a global in this
/// module's own test suite -- see `default_test_transport` below for
/// the one place a `cfg(test)`-only global is used instead.
///
/// `send` takes the same arguments the real spawn always took: the
/// resolved `endpoint`, an optional DNS-rebinding pin, and the
/// serialized JSON `body`. Must never panic and never block its caller
/// meaningfully -- the real implementation's "telemetry failure never
/// propagates" contract applies to every implementation of this trait.
trait Transport {
    fn send(&self, endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: &str);
}

/// Production's only implementation: byte-identical to what
/// `spawn_and_send` always did before this seam existed. Materializes
/// the script, spawns it detached with `endpoint` as its first argv
/// (no shell interposed) and an optional `host:port:address` pin as
/// its second, writes `body` to its stdin, and never `.wait()`s --
/// any spawn error or later network failure is discarded.
///
/// `#[cfg(not(test))]`: this type does not exist in a test build --
/// `spawn_and_send`'s own `#[cfg(test)]` arm never constructs it, so a
/// test build has no code path that can reach a real spawn through
/// this seam, structurally rather than by convention.
#[cfg(not(test))]
struct RealTransport;

#[cfg(not(test))]
impl Transport for RealTransport {
    fn send(&self, endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: &str) {
        let Ok(script_path) = materialize_script() else {
            return;
        };
        let mut command = Command::new(&script_path);
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
            let _ = stdin.write_all(body.as_bytes());
            // stdin is closed here, leaving the child detached, never
            // .wait()-ed -- fire-and-forget.
        }
    }
}

/// Production entry point: every `send_event*` call site -- and
/// through them, every `report_*` public function -- funnels through
/// here. Outside `cfg(test)` this is unconditionally `RealTransport`.
///
/// Under `cfg(test)` only, this defers to `default_test_transport()`
/// instead. A test that wants explicit control over what was sent
/// must call `spawn_and_send_with_transport` directly with its own
/// stub, which this module's own tests below do.
fn spawn_and_send(endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: &str) {
    #[cfg(test)]
    {
        spawn_and_send_with_transport(default_test_transport(), endpoint, pinned_ip, body);
        return;
    }
    #[cfg(not(test))]
    spawn_and_send_with_transport(&RealTransport, endpoint, pinned_ip, body);
}

/// Same send as `spawn_and_send`, but through an explicitly injected
/// `Transport` rather than always `RealTransport` -- the seam this
/// module's own tests use directly, passing a `RecordingTransport`
/// explicitly. Matches this codebase's `*_with_*` convention for an
/// injectable variant sitting beneath a stable public wrapper.
fn spawn_and_send_with_transport(
    transport: &dyn Transport,
    endpoint: &str,
    pinned_ip: Option<std::net::IpAddr>,
    body: &str,
) {
    transport.send(endpoint, pinned_ip, body);
}

/// `#[cfg(test)]`-only global, and the one place in this module a
/// global is used rather than explicit injection: dozens of unit
/// tests in other files (`install.rs`, `update.rs`, `uninstall.rs`,
/// `dispatch.rs`, `telemetry_hook.rs`) reach `spawn_and_send` only
/// transitively, through unchanged public entry points with no
/// parameter list to thread a `Transport` through. Safe here because
/// every caller gets the identical, never-mutated-after-init
/// `RecordingTransport` instance -- unlike `HOME`-mutation (see
/// `HomeGuard`/`NoHomeGuard` below), there is no race to write
/// different values to this slot.
#[cfg(test)]
static DEFAULT_TEST_TRANSPORT: OnceLock<RecordingTransport> = OnceLock::new();

#[cfg(test)]
fn default_test_transport() -> &'static RecordingTransport {
    DEFAULT_TEST_TRANSPORT.get_or_init(RecordingTransport::new)
}

/// Test-only stub `Transport`: records every send it receives instead
/// of spawning anything, so a test can assert on what would have been
/// sent without a real process, DNS resolution, or network egress
/// occurring. `Mutex`-guarded since `cargo test` runs concurrently by
/// default and multiple tests may share this single instance.
#[cfg(test)]
#[derive(Default)]
struct RecordingTransport {
    sent: std::sync::Mutex<Vec<RecordedSend>>,
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
    fn new() -> Self {
        Self::default()
    }

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
    fn send(&self, endpoint: &str, pinned_ip: Option<std::net::IpAddr>, body: &str) {
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

/// Cached endpoint+pin resolution, once per process. Correct for a
/// single-target invocation, wrong for a `--all` batch: each target
/// has its own `.konductor/config.yml` opt-out. `_for_target` senders
/// bypass this via `resolve_endpoint_with_pin_uncached`.
static ENDPOINT_CACHE: OnceLock<Option<(String, Option<std::net::IpAddr>)>> = OnceLock::new();

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

/// Bypasses `ENDPOINT_CACHE` -- for `_for_target` call sites, each
/// with its own per-repo config and opt-out.
fn resolve_endpoint_with_pin_uncached(
    target_dir: &std::path::Path,
) -> Option<(String, Option<std::net::IpAddr>)> {
    resolve_endpoint_with_pin(target_dir)
}

/// Resolves the wire `UUID`: the instance record's own value, never
/// the per-target identity.
fn resolve_wire_uuid() -> String {
    match home_dir() {
        Some(home) => instance::resolve_instance_uuid_for_wire(&home),
        None => NIL_UUID_SENTINEL.to_string(),
    }
}

/// `None` when the install-info record is missing, unreadable, an
/// unrecognized schema version, or itself carries `agent_version:
/// None`.
///
/// `#[allow(dead_code)]`: `report_package_installed`/
/// `report_package_version_updated`(`_for_target`) now read
/// `install_info::read_install_info` directly, reusing that single
/// read for both their consent gate and `agent_version` -- calling
/// this afterward would mean reading the same record twice. Kept, not
/// retired -- still exercised by its own tests below.
#[allow(dead_code)]
fn agent_version_for_target(target_dir: &std::path::Path) -> Option<String> {
    install_info::read_install_info(target_dir).and_then(|record| record.agent_version)
}

#[allow(clippy::too_many_arguments)]
fn send_event_with_endpoint(
    endpoint: &str,
    pinned_ip: Option<std::net::IpAddr>,
    event_type: EventType,
    target_name: impl Into<String>,
    identity_uuid: &str,
    session_id: Option<String>,
    parent_session_id: Option<String>,
    error_code: Option<String>,
    harness_field: Option<String>,
    agent_version: Option<String>,
) {
    // identity_uuid is used only as eventId entropy -- the wire UUID
    // is always the instance record's own value.
    let data = EventEnvelope::build(
        event_type,
        target_name,
        identity_uuid,
        session_id,
        parent_session_id,
        error_code,
        harness_field,
        agent_version,
    );
    let outer = OuterEnvelope::wrap(data, resolve_wire_uuid());
    let Ok(body) = serde_json::to_string(&outer) else {
        return;
    };
    spawn_and_send(endpoint, pinned_ip, &body);
}

/// Resolves the endpoint via `cached_endpoint_with_pin` -- correct for
/// a single-target invocation, wrong for a `--all` batch.
#[allow(clippy::too_many_arguments)]
fn send_event(
    target_dir: &std::path::Path,
    event_type: EventType,
    target_name: impl Into<String>,
    identity_uuid: &str,
    session_id: Option<String>,
    parent_session_id: Option<String>,
    error_code: Option<String>,
    harness_field: Option<String>,
    agent_version: Option<String>,
) {
    let Some((endpoint, pinned_ip)) = cached_endpoint_with_pin(target_dir) else {
        return;
    };
    send_event_with_endpoint(
        &endpoint,
        pinned_ip,
        event_type,
        target_name,
        identity_uuid,
        session_id,
        parent_session_id,
        error_code,
        harness_field,
        agent_version,
    );
}

/// Same as `send_event`, but resolves via
/// `resolve_endpoint_with_pin_uncached` -- for `_for_target` call
/// sites, so each target's own opt-out is honored rather than
/// inherited from `ENDPOINT_CACHE`.
#[allow(clippy::too_many_arguments)]
fn send_event_for_target(
    target_dir: &std::path::Path,
    event_type: EventType,
    target_name: impl Into<String>,
    identity_uuid: &str,
    session_id: Option<String>,
    parent_session_id: Option<String>,
    error_code: Option<String>,
    harness_field: Option<String>,
    agent_version: Option<String>,
) {
    let Some((endpoint, pinned_ip)) = resolve_endpoint_with_pin_uncached(target_dir) else {
        return;
    };
    send_event_with_endpoint(
        &endpoint,
        pinned_ip,
        event_type,
        target_name,
        identity_uuid,
        session_id,
        parent_session_id,
        error_code,
        harness_field,
        agent_version,
    );
}

/// `sha256_hex(UUID + raw_session_id)` -- the raw runtime session id
/// is never transmitted as-is. The UUID mixed in means the same raw
/// session id hashes to a different wire value per install.
fn hash_session_id(uuid: &str, raw_session_id: &str) -> String {
    super::super::install::artifact::sha256_hex(format!("{uuid}{raw_session_id}").as_bytes())
}

/// Treats an empty-string `raw_session_id` the same as `None`.
fn hash_present_session_id(uuid: &str, raw_session_id: Option<&str>) -> Option<String> {
    raw_session_id
        .filter(|raw| !raw.is_empty())
        .map(|raw| hash_session_id(uuid, raw))
}

/// Fired from the hidden `__telemetry-hook` subcommand at
/// `SessionStart`/`agentSpawn`. Gated on `install_info::read_install_info`
/// -- the per-target consent signal -- not the retired per-target
/// identity.
///
/// `NIL_UUID_SENTINEL` stands in for the old `identity.uuid` as
/// `eventId` entropy, matching `report_package_uninstalled`'s own
/// precedent: the per-target identity UUID never reached the wire
/// either (`resolve_wire_uuid` supplies that separately), so dropping
/// it here loses no attribution. The session-hash salt is a separate
/// role and uses `resolve_wire_uuid()` instead -- see
/// `hash_present_session_id`.
pub(crate) fn report_agent_invocation(
    target_dir: &std::path::Path,
    agent_name: &str,
    session_id: Option<String>,
) {
    let Some(_install_info) = install_info::read_install_info(target_dir) else {
        return;
    };
    if !telemetry_consent_allows(false) {
        return;
    }
    let wire_uuid = resolve_wire_uuid();
    let hashed_session_id = hash_present_session_id(&wire_uuid, session_id.as_deref());
    send_event(
        target_dir,
        EventType::AgentInvocation,
        agent_name,
        NIL_UUID_SENTINEL,
        hashed_session_id,
        None,
        None,
        None,
        None,
    );
}

/// Fired from the hidden `__telemetry-hook` subcommand at
/// `SubagentStart`. Same install-info gate and sentinel-as-entropy
/// substitution as `report_agent_invocation`.
pub(crate) fn report_subagent_invocation(
    target_dir: &std::path::Path,
    specialist_name: &str,
    session_id: Option<String>,
    parent_session_id: Option<String>,
) {
    let Some(_install_info) = install_info::read_install_info(target_dir) else {
        return;
    };
    if !telemetry_consent_allows(false) {
        return;
    }
    let wire_uuid = resolve_wire_uuid();
    let hashed_session_id = hash_present_session_id(&wire_uuid, session_id.as_deref());
    let hashed_parent_session_id =
        hash_present_session_id(&wire_uuid, parent_session_id.as_deref());
    send_event(
        target_dir,
        EventType::SubagentInvocation,
        specialist_name,
        NIL_UUID_SENTINEL,
        hashed_session_id,
        hashed_parent_session_id,
        None,
        None,
        None,
    );
}

/// The one exception to the skip-on-`None` rule. `no_telemetry` is
/// checked first so `--no-telemetry` is unconditional even when this
/// target already has an install-info record.
pub(crate) fn report_cli_error(
    target_dir: &std::path::Path,
    command: &str,
    error_code: &str,
    no_telemetry: bool,
) {
    if no_telemetry {
        return;
    }
    if !telemetry_consent_allows(false) {
        return;
    }
    report_cli_error_with_install_info(
        target_dir,
        command,
        error_code,
        install_info::read_install_info(target_dir),
    );
}

/// Same as `report_cli_error`, but resolves `install-info.json` fresh
/// per call -- for `--all` batch call sites. `install_info` has no
/// process-lifetime cache to split (see `report_package_uninstalled`'s
/// own doc comment), so this differs from `report_cli_error` only in
/// which `send_event*`/`report_cli_error_with_install_info_for_target`
/// variant it calls.
pub(crate) fn report_cli_error_for_target(
    target_dir: &std::path::Path,
    command: &str,
    error_code: &str,
    no_telemetry: bool,
) {
    if no_telemetry {
        return;
    }
    if !telemetry_consent_allows(false) {
        return;
    }
    report_cli_error_with_install_info_for_target(
        target_dir,
        command,
        error_code,
        install_info::read_install_info(target_dir),
    );
}

/// Shared core for `report_cli_error`/`report_cli_error_for_target`.
fn report_cli_error_with_install_info(
    target_dir: &std::path::Path,
    command: &str,
    error_code: &str,
    install_info: Option<install_info::InstallInfoRecord>,
) {
    match install_info {
        Some(install_info) => send_event(
            target_dir,
            EventType::CliError,
            command,
            NIL_UUID_SENTINEL,
            None,
            None,
            Some(error_code.to_string()),
            Some(install_info.harness),
            None,
        ),
        None => {
            // Only "install" fires under the nil sentinel
            // pre-install-info; no_telemetry is handled by the caller.
            if command == "install" {
                send_event(
                    target_dir,
                    EventType::CliError,
                    command,
                    NIL_UUID_SENTINEL,
                    None,
                    None,
                    Some(error_code.to_string()),
                    None,
                    None,
                );
            }
        }
    }
}

/// Same fallback-sentinel contract as
/// `report_cli_error_with_install_info`, sent via
/// `send_event_for_target`.
fn report_cli_error_with_install_info_for_target(
    target_dir: &std::path::Path,
    command: &str,
    error_code: &str,
    install_info: Option<install_info::InstallInfoRecord>,
) {
    match install_info {
        Some(install_info) => send_event_for_target(
            target_dir,
            EventType::CliError,
            command,
            NIL_UUID_SENTINEL,
            None,
            None,
            Some(error_code.to_string()),
            Some(install_info.harness),
            None,
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
                    None,
                );
            }
        }
    }
}

/// Fired by `uninstall_one_impl` only after every fallible step has
/// already succeeded, before `install-info.json`/`telemetry-id.json`
/// are removed. `harness` comes from `install_info::read_install_info`
/// -- the per-INSTALL record, not the (retired) per-target identity --
/// via the process-global endpoint cache: correct for a single-target
/// invocation, wrong for a `--all` batch (see
/// `report_package_uninstalled_for_target`). `install_info` itself has
/// no cache of its own to split; every read hits disk, so nothing here
/// can inherit a sibling target's harness the way the old identity
/// cache could.
///
/// The `NIL_UUID_SENTINEL` passed as `identity_uuid` is `eventId`
/// entropy only -- see `EventEnvelope::build`'s own doc comment --
/// never the wire `UUID` (`resolve_wire_uuid` supplies that). The
/// per-target record this used to read had a UUID that reached
/// nothing on the wire either; dropping it here loses no attribution.
pub(crate) fn report_package_uninstalled(target_dir: &std::path::Path) {
    let Some(install_info) = install_info::read_install_info(target_dir) else {
        return;
    };
    if !telemetry_consent_allows(false) {
        return;
    }
    send_event(
        target_dir,
        EventType::PackageUninstalled,
        install_info.harness.clone(),
        NIL_UUID_SENTINEL,
        None,
        None,
        None,
        None,
        None,
    );
}

/// Same as `report_package_uninstalled`, but resolves the endpoint via
/// `resolve_endpoint_with_pin_uncached` -- for a `--all` loop, so each
/// target's own `.konductor/config.yml` opt-out is honored rather than
/// inherited from `ENDPOINT_CACHE`. `install_info::read_install_info`
/// is already an uncached, per-call disk read on both paths, so this
/// function's own harness resolution needs no separate uncached
/// variant the way the old identity-cache split required.
pub(crate) fn report_package_uninstalled_for_target(target_dir: &std::path::Path) {
    let Some(install_info) = install_info::read_install_info(target_dir) else {
        return;
    };
    if !telemetry_consent_allows(false) {
        return;
    }
    send_event_for_target(
        target_dir,
        EventType::PackageUninstalled,
        install_info.harness.clone(),
        NIL_UUID_SENTINEL,
        None,
        None,
        None,
        None,
        None,
    );
}

/// Fired once `install_from_local` and index finalize have both
/// already succeeded. Gated on `install_info::read_install_info` --
/// the same record supplies `agent_version`, so this is a single read
/// covering both.
pub(crate) fn report_package_installed(target_dir: &std::path::Path, harness: &str) {
    let Some(record) = install_info::read_install_info(target_dir) else {
        return;
    };
    if !telemetry_consent_allows(false) {
        return;
    }
    send_event(
        target_dir,
        EventType::PackageInstalled,
        harness,
        NIL_UUID_SENTINEL,
        None,
        None,
        None,
        None,
        record.agent_version,
    );
}

/// Fired once `strategy.install_from_local` has already succeeded.
/// `install_info` has no process-lifetime cache to split (see
/// `report_package_uninstalled`'s own doc comment) -- every read here
/// hits disk, so this differs from `report_package_version_updated_for_target`
/// only in which `send_event*` variant it calls.
pub(crate) fn report_package_version_updated(target_dir: &std::path::Path, harness: &str) {
    let Some(record) = install_info::read_install_info(target_dir) else {
        return;
    };
    if !telemetry_consent_allows(false) {
        return;
    }
    send_event(
        target_dir,
        EventType::PackageVersionUpdated,
        harness,
        NIL_UUID_SENTINEL,
        None,
        None,
        None,
        None,
        record.agent_version,
    );
}

/// Same as `report_package_version_updated`, but resolves the endpoint
/// via `resolve_endpoint_with_pin_uncached` -- for a `--all` loop, so
/// each target's own `.konductor/config.yml` opt-out is honored rather
/// than inherited from `ENDPOINT_CACHE`.
pub(crate) fn report_package_version_updated_for_target(
    target_dir: &std::path::Path,
    harness: &str,
) {
    let Some(record) = install_info::read_install_info(target_dir) else {
        return;
    };
    if !telemetry_consent_allows(false) {
        return;
    }
    send_event_for_target(
        target_dir,
        EventType::PackageVersionUpdated,
        harness,
        NIL_UUID_SENTINEL,
        None,
        None,
        None,
        None,
        record.agent_version,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, MutexGuard};

    // consent_decision: exhaustive over its 2 bool inputs (4 cases),
    // no filesystem, deterministic on any architecture. This is the
    // AND gate itself; telemetry_consent_allows's own integration
    // tests further down cover resolving HOME and the instance record
    // into these two inputs, which this function deliberately excludes.

    #[test]
    fn consent_decision_reports_when_not_opted_out_and_machine_consents() {
        assert!(consent_decision(false, true));
    }

    #[test]
    fn consent_decision_suppresses_when_opted_out_even_if_machine_consents() {
        assert!(
            !consent_decision(true, true),
            "a per-target opt-out must never be overridden by machine consent"
        );
    }

    #[test]
    fn consent_decision_suppresses_when_not_opted_out_but_machine_declines() {
        assert!(!consent_decision(false, false));
    }

    #[test]
    fn consent_decision_suppresses_when_opted_out_and_machine_declines() {
        assert!(!consent_decision(true, false));
    }

    /// Dedicated lock for tests mutating `TELEMETRY_OFF_ENV_VAR`/
    /// `TELEMETRY_ENDPOINT_ENV_VAR`/`TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR`
    /// -- `std::env::set_var` has no per-thread scoping.
    static TELEMETRY_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn lock_telemetry_env() -> MutexGuard<'static, ()> {
        TELEMETRY_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn spawn_and_send_with_transport_records_endpoint_pin_and_body_unchanged() {
        let transport = RecordingTransport::new();
        let ip: std::net::IpAddr = "203.0.113.5".parse().unwrap();

        spawn_and_send_with_transport(
            &transport,
            "https://example.invalid/collector",
            Some(ip),
            r#"{"eventType":"cli_error"}"#,
        );

        let recorded = transport.recorded();
        assert_eq!(
            recorded,
            vec![RecordedSend {
                endpoint: "https://example.invalid/collector".to_string(),
                pinned_ip: Some(ip),
                body: r#"{"eventType":"cli_error"}"#.to_string(),
            }],
            "the injected transport must receive exactly the endpoint, pin, and body \
             spawn_and_send_with_transport was called with, unchanged -- no process spawned, \
             no DNS resolution, no network egress"
        );
    }

    #[test]
    fn spawn_and_send_with_transport_records_multiple_sends_in_order() {
        let transport = RecordingTransport::new();

        spawn_and_send_with_transport(&transport, "https://a.invalid/x", None, "first");
        spawn_and_send_with_transport(&transport, "https://b.invalid/y", None, "second");

        let recorded = transport.recorded();
        assert_eq!(recorded.len(), 2);
        assert_eq!(recorded[0].endpoint, "https://a.invalid/x");
        assert_eq!(recorded[0].body, "first");
        assert_eq!(recorded[1].endpoint, "https://b.invalid/y");
        assert_eq!(recorded[1].body, "second");
    }

    #[test]
    fn spawn_and_send_default_entry_point_never_reaches_a_real_transport_in_a_test_build() {
        let before = default_test_transport().recorded().len();

        spawn_and_send(
            "https://telemetry-seam-probe.example.invalid/generic",
            None,
            r#"{"probe":"default-entry-point"}"#,
        );

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

    /// Reads the checked-in schema's own
    /// `properties.sessionId.pattern` so this test fails loudly if it
    /// ever drifts from what `hash_session_id` produces.
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

    fn matches_lowercase_hex_64(value: &str) -> bool {
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }

    #[test]
    fn hash_session_id_output_matches_schemas_session_id_pattern() {
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
        assert_eq!(
            hash_session_id(&"a".repeat(64), "session-123"),
            hash_session_id(&"a".repeat(64), "session-123")
        );
        assert_ne!(
            hash_session_id(&"a".repeat(64), "session-123"),
            hash_session_id(&"b".repeat(64), "session-123")
        );
    }

    #[test]
    fn hash_present_session_id_treats_empty_string_as_absent() {
        assert_eq!(hash_present_session_id(&"a".repeat(64), Some("")), None);
        assert_eq!(hash_present_session_id(&"a".repeat(64), None), None);
    }

    #[test]
    fn hash_present_session_id_hashes_a_non_empty_value_normally() {
        let uuid = "a".repeat(64);
        assert_eq!(
            hash_present_session_id(&uuid, Some("real-session-id")),
            Some(hash_session_id(&uuid, "real-session-id"))
        );
    }

    /// Regression test for the salt/wire-attribution conflation that
    /// let `report_agent_invocation`/`report_subagent_invocation` hash
    /// `sessionId` with the public, compile-time `NIL_UUID_SENTINEL`
    /// instead of `resolve_wire_uuid()`. A constant salt makes the
    /// same raw session id hash identically on every machine --
    /// linkable across installs and confirmable by anyone holding
    /// ingested data plus a candidate session id. `resolve_wire_uuid`
    /// reads each machine's own instance record, so this must differ
    /// per machine for a future regression back to a constant salt to
    /// fail here.
    #[test]
    fn resolve_wire_uuid_salts_the_same_raw_session_id_differently_per_machine() {
        const RAW_SESSION_ID: &str = "same-raw-session-id-on-both-machines";

        let uuid_a = {
            let home = HomeGuard::new("wire-uuid-salt-machine-a");
            instance::ensure_instance(&home.scratch, true);
            resolve_wire_uuid()
        };
        let uuid_b = {
            let home = HomeGuard::new("wire-uuid-salt-machine-b");
            instance::ensure_instance(&home.scratch, true);
            resolve_wire_uuid()
        };
        assert_ne!(
            uuid_a, uuid_b,
            "two freshly minted instance records must not share a UUID -- \
             otherwise this test cannot tell per-machine salting apart from a \
             constant one"
        );

        let hash_a = hash_present_session_id(&uuid_a, Some(RAW_SESSION_ID));
        let hash_b = hash_present_session_id(&uuid_b, Some(RAW_SESSION_ID));
        assert_ne!(
            hash_a, hash_b,
            "the same raw session id must hash differently under two different \
             machine UUIDs -- a constant salt (e.g. NIL_UUID_SENTINEL) would make \
             this pass identically and defeat per-machine scoping"
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

    #[test]
    fn resolved_addresses_include_disallowed_host_flags_a_resolved_loopback_or_private_literal() {
        assert!(resolved_addresses_include_disallowed_host("127.0.0.1"));
        assert!(resolved_addresses_include_disallowed_host("10.0.0.1"));
        assert!(resolved_addresses_include_disallowed_host("::1"));
        assert!(resolved_addresses_include_disallowed_host(
            "::ffff:127.0.0.1"
        ));
    }

    #[test]
    fn resolved_addresses_include_disallowed_host_accepts_a_resolved_public_literal() {
        assert!(!resolved_addresses_include_disallowed_host("192.0.2.1"));
    }

    #[test]
    fn resolved_addresses_include_disallowed_host_does_not_flag_an_unresolvable_host() {
        assert!(!resolved_addresses_include_disallowed_host(
            "telemetry.konductor.example.invalid"
        ));
    }

    #[test]
    fn endpoint_host_is_allowed_accepts_the_compile_time_default_endpoint_host() {
        assert!(endpoint_host_is_allowed(DEFAULT_TELEMETRY_ENDPOINT));
    }

    #[test]
    fn decide_pin_denies_a_timeout_outcome_rather_than_failing_open() {
        assert_eq!(
            konductor_telemetry::decide_pin(konductor_telemetry::DnsOutcome::TimedOut),
            None,
            "a TimedOut outcome must be denied, not treated the same as a resolution failure"
        );
    }

    #[test]
    fn decide_pin_fails_open_for_a_genuine_resolution_failure() {
        assert_eq!(
            konductor_telemetry::decide_pin(konductor_telemetry::DnsOutcome::Failed),
            Some(None)
        );
    }

    #[test]
    fn endpoint_host_is_allowed_with_pin_returns_no_pin_for_an_ip_literal() {
        let _lock = lock_telemetry_env();
        std::env::remove_var(TELEMETRY_ALLOW_LOCAL_ENDPOINT_ENV_VAR);
        assert_eq!(
            endpoint_host_is_allowed_with_pin("https://192.0.2.1/x"),
            Some(None)
        );
    }

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

    /// Pins both halves of `materialize_script`'s call site in this
    /// crate: existence/executable-bit alone can't catch a `dir`/
    /// `script_name`/`contents` transposition against
    /// `mcp/lib/skill-lookup-core`'s own call, since both consumers
    /// pass a private per-uid dir and a `String` argument in the same
    /// position -- only reading the materialized name AND bytes back
    /// tells the two calls apart.
    #[test]
    fn materialized_script_has_this_crates_own_name_and_contents() {
        let _home = HomeGuard::new("materialize-content-and-name-pin");
        let path = materialize_script().expect("must materialize");
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some(MATERIALIZED_SCRIPT_NAME),
            "cli/konductor-rs must materialize under its own filename \
             (konductor-telemetry-report.sh), not skill-lookup-core's \
             (konductor-telemetry-report-mcp.sh) -- a swapped script_name argument at this \
             call site would still pass an existence/executable-bit-only check"
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
    /// defence-in-depth. Lives here (once per consumer, not shared)
    /// because it reads THIS crate's own materialized file, exactly
    /// like the content-pin test above it -- a single shared test
    /// reading one consumer's script contents would leave the other
    /// consumer's own transposition-into-materialize_script bug
    /// unguarded for this specific property.
    #[test]
    fn materialized_script_still_enforces_https_only() {
        let _home = HomeGuard::new("materialize-https-gate-pin");
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

    /// Removes `HOME` for the guard's lifetime, under
    /// `HOME_ENV_LOCK`.
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

    /// Acquires the crate-wide `test_home_lock::HOME_ENV_LOCK` and
    /// points `HOME` at a fresh scratch dir.
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

    #[test]
    fn create_private_dir_all_rejects_symlink_at_target_path() {
        use std::os::unix::fs::PermissionsExt;

        let base = scratch_dir("symlink-target-rejected");
        let real_elsewhere = base.join("elsewhere");
        fs::create_dir_all(&real_elsewhere).unwrap();
        let target = base.join("private-tmp-dir");
        std::os::unix::fs::symlink(&real_elsewhere, &target).unwrap();

        let result = konductor_telemetry::create_private_dir_all(&target);

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

    #[test]
    fn create_private_dir_all_succeeds_for_ordinary_owned_directory() {
        use std::os::unix::fs::PermissionsExt;

        let base = scratch_dir("ordinary-dir-still-works");
        let target = base.join("private-tmp-dir");

        konductor_telemetry::create_private_dir_all(&target)
            .expect("must succeed for an ordinary, self-owned path");

        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);

        fs::remove_dir_all(&base).ok();
    }

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

    #[test]
    fn shell_is_disallowed_ip_accepts_unspecified_lookalikes() {
        assert!(!shell_is_disallowed_ip("0.0.0.1"));
        assert!(!shell_is_disallowed_ip("192.0.2.1"));
    }

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

    #[test]
    fn shell_is_disallowed_ip_accepts_public_hex_mapped_address() {
        assert!(
            !shell_is_disallowed_ip("::ffff:808:808"),
            "::ffff:808:808 (= ::ffff:8.8.8.8, public) must NOT be rejected"
        );
    }

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

    #[test]
    fn shell_is_disallowed_ip_accepts_6to4_with_only_tail_compression() {
        assert!(
            !shell_is_disallowed_ip("2002:c000:201::"),
            "2002:c000:201:: embeds 192.0.2.1 (allowed); the trailing \"::\" only compresses \
             unrelated tail segments and must not affect classification"
        );
    }

    #[test]
    fn shell_is_disallowed_ip_rejects_nat64_single_hextet_compression() {
        assert!(
            shell_is_disallowed_ip("64:ff9b::6440"),
            "64:ff9b::6440 (single compressed hextet) must fail closed rather than compute a \
             wrong embedded address"
        );
    }

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

    #[test]
    fn shell_host_extraction_strips_userinfo_up_to_the_last_at_sign() {
        assert_eq!(shell_extract_host("https://a@b@127.0.0.1/x"), "127.0.0.1");
    }

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

    /// Returns the raw exit code (plus stderr) under an explicit
    /// `interpreter` path -- needs to tell apart three outcomes (0 =
    /// disallowed, 1 = not disallowed, 2 = the interpreter aborted on
    /// a bad arithmetic expression), not just two.
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

    /// dash rejects the bash/ksh-only `16#` form; `sh` may be a bash
    /// symlink that accepts it too, so this targets dash by name and
    /// skips visibly if absent.
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

    use crate::cli::test_home_lock::lock_home;

    fn with_home<R>(home: &std::path::Path, body: impl FnOnce() -> R) -> R {
        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", home);
        let result = body();
        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        result
    }

    /// Confirms the instance record actually persisted at `home` and
    /// returns it. Call this AFTER a `telemetry_consent_allows` call
    /// that should have minted it, and BEFORE asserting on that call's
    /// boolean result: `ensure_instance` fails closed on a write
    /// failure, so the boolean alone can't distinguish a denied
    /// consent from an unwritten file. Panics naming the write
    /// failure -- never silently lets a caller assert on a result that
    /// was never really persisted.
    fn assert_instance_persisted(home: &std::path::Path) -> instance::InstanceRecord {
        with_home(home, || instance::read_instance(home)).unwrap_or_else(|| {
            panic!(
                "telemetry.json did not persist at {} -- this is a write failure, not a \
                 consent decision; see stderr for the failing syscall",
                home.display()
            )
        })
    }

    /// Case 1: `telemetry_consent_allows` resolves a fresh `HOME` with
    /// no prior instance record for an opted-out target. The AND
    /// logic itself is `consent_decision`'s own job, covered purely
    /// above; this test is about resolution -- minting on first call
    /// -- succeeding correctly for this input.
    #[test]
    fn telemetry_consent_allows_resolves_opted_out_target_against_a_fresh_home() {
        let _guard = lock_home();
        let home = scratch_dir("no-silent-reenable-case-1-home");
        let target = scratch_dir("no-silent-reenable-case-1-target");

        let allowed = with_home(&home, || telemetry_consent_allows(true));

        assert!(
            !allowed,
            "a target with no telemetry-id.json (opted out at install) must not be \
             allowed to report, even on a machine with no prior telemetry.json at all"
        );
        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target).ok();
    }

    /// `HOME=""` must refuse consent the same way an unset `HOME`
    /// does, not resolve to a relative path and treat it as real.
    /// `home_dir()` used to read `var_os("HOME")` with no empty-string
    /// filter, unlike `index::env_home_dir` (see this module's
    /// `home_dir` doc comment for why it now delegates there).
    #[test]
    fn telemetry_consent_allows_refuses_with_home_set_to_empty_string_like_unset() {
        let _guard = lock_home();
        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", "");

        let allowed = telemetry_consent_allows(false);

        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        assert!(
            !allowed,
            "HOME=\"\" must refuse consent the same way an unset HOME does -- resolving \
             it to a relative path would let a target's own opt-out state (or lack of \
             one) attach to whatever the process's cwd happens to be, not a real machine"
        );
    }

    /// Case 2: a second call for the same opted-out target resolves
    /// the SAME on-disk instance record `ensure_instance_with_migration`
    /// minted on the first call, and does not let that record's own
    /// `telemetry_consent: true` re-seed anything. The suppression
    /// itself is `consent_decision`'s job (covered purely above);
    /// this test is about correctly resolving/persisting the instance
    /// record across two calls, not the AND logic.
    #[test]
    fn telemetry_consent_allows_resolves_the_same_persisted_instance_record_across_repeat_calls() {
        let _guard = lock_home();
        let home = scratch_dir("no-silent-reenable-case-2-home");
        let target = scratch_dir("no-silent-reenable-case-2-target");

        let first_call_allowed = with_home(&home, || telemetry_consent_allows(true));
        assert!(!first_call_allowed, "first call must not report");

        let instance_record = with_home(&home, || {
            instance::read_instance(&home).expect("telemetry.json must exist after the first call")
        });
        assert!(
            instance_record.telemetry_consent,
            "the instance record's own telemetry_consent must be the ordinary new-install \
             default (true) even though the very first call on this machine was for an \
             opted-out target -- seeding consent from target_already_opted_out has been removed"
        );

        let second_call_allowed = with_home(&home, || telemetry_consent_allows(true));
        assert!(
            !second_call_allowed,
            "the same opted-out target must still not report after the instance record exists \
             on disk -- the AND gate's own per-target conjunct suppresses it regardless of the \
             instance record's consent value"
        );
        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target).ok();
    }

    /// Case 3, positive control: `telemetry_consent_allows` resolves
    /// a fresh `HOME`'s new-install default (opt-IN) for a target
    /// that never opted out. `assert_instance_persisted` below is
    /// this test's real point -- confirming the write actually
    /// landed, not just that the boolean happened to be `true`.
    #[test]
    fn telemetry_consent_allows_resolves_the_new_install_default_for_a_never_opted_out_target() {
        let _guard = lock_home();
        let home = scratch_dir("no-silent-reenable-case-3-home");
        let target = scratch_dir("no-silent-reenable-case-3-target");

        let allowed = with_home(&home, || telemetry_consent_allows(false));

        // Precondition, checked BEFORE the positive assertion below:
        // a write failure also fails closed to `!allowed`, so the
        // boolean alone can't distinguish "this machine's ordinary
        // opt-in default" from "the instance record never persisted."
        let instance_record = assert_instance_persisted(&home);
        assert!(instance_record.telemetry_consent);

        assert!(
            allowed,
            "a target that never opted out must continue to report on a machine with no \
             prior instance record -- the ordinary new-install default is opt-IN"
        );
        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target).ok();
    }

    /// Case 4: two distinct targets on one machine resolve the SAME
    /// persisted instance record independently, opted-out running
    /// first -- the opted-out call must not seed a decline that
    /// leaks into the opted-in target's own later resolution. The AND
    /// logic each call applies is covered purely above; this test is
    /// about the shared instance record resolving the same way for
    /// both targets regardless of call order.
    #[test]
    fn telemetry_consent_allows_resolves_the_same_instance_record_independently_for_two_targets_opted_out_first(
    ) {
        let _guard = lock_home();
        let home = scratch_dir("no-silent-reenable-case-4-home");
        let opted_out_target = scratch_dir("no-silent-reenable-case-4-opted-out");
        let opted_in_target = scratch_dir("no-silent-reenable-case-4-opted-in");

        let opted_out_result = with_home(&home, || telemetry_consent_allows(true));
        assert!(!opted_out_result, "the opted-out target must not report");

        let opted_in_result = with_home(&home, || telemetry_consent_allows(false));

        // Precondition, checked BEFORE the positive assertion below:
        // a write failure also fails closed to `!opted_in_result`, so
        // the boolean alone can't distinguish "the opted-out call
        // seeded a real decline" from "the instance record never
        // persisted."
        let instance_record = assert_instance_persisted(&home);
        assert!(instance_record.telemetry_consent);

        assert!(
            opted_in_result,
            "an opted-in target on the SAME machine must report normally, independent of an \
             opted-out target's call having run first -- one project's historical opt-out must \
             never permanently suppress telemetry for every OTHER project on the same machine"
        );

        assert_ne!(
            opted_out_target, opted_in_target,
            "sanity: the two targets in this test must be genuinely distinct paths"
        );

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&opted_out_target).ok();
        fs::remove_dir_all(&opted_in_target).ok();
    }

    /// Mirror ordering of case 4: opted-in runs first, persisting
    /// `telemetry_consent: true`; the opted-out target's own call
    /// must then resolve and apply that SAME persisted record
    /// correctly, still suppressing itself. This is the test that
    /// caught a real temp-file write collision on one CI
    /// architecture: the failure was in
    /// `ensure_instance_with_migration`'s persistence, not in the AND
    /// logic, which `consent_decision`'s pure tests above now cover
    /// without any filesystem involved.
    #[test]
    fn telemetry_consent_allows_resolves_persisted_true_consent_correctly_for_an_opted_out_target()
    {
        let _guard = lock_home();
        let home = scratch_dir("no-silent-reenable-case-4b-home");
        let opted_in_target = scratch_dir("no-silent-reenable-case-4b-opted-in");
        let opted_out_target = scratch_dir("no-silent-reenable-case-4b-opted-out");

        let opted_in_result = with_home(&home, || telemetry_consent_allows(false));

        // Precondition, checked BEFORE the result below: on a write
        // failure `ensure_instance` fails closed to consent=false, so
        // `opted_in_result` alone can't distinguish "the target opted
        // out" from "the instance record never made it to disk."
        let instance_record = assert_instance_persisted(&home);
        assert!(
            instance_record.telemetry_consent,
            "telemetry.json persisted but with consent=false -- ensure_instance did not mint \
             the expected true default"
        );

        assert!(opted_in_result, "the opted-in target must report");

        let opted_out_result = with_home(&home, || telemetry_consent_allows(true));
        assert!(
            !opted_out_result,
            "a target's own per-target opt-out must independently suppress reporting for \
             itself even on a machine whose instance-level consent is true -- the AND gate's \
             two operands must each be able to veto reporting on their own"
        );

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&opted_in_target).ok();
        fs::remove_dir_all(&opted_out_target).ok();
    }

    #[test]
    fn resolve_wire_uuid_returns_the_instance_uuid_not_the_per_target_identity_uuid() {
        let _guard = lock_home();
        let home = scratch_dir("wire-uuid-instance-not-identity-home");
        let target = scratch_dir("wire-uuid-instance-not-identity-target");

        let per_target_identity = identity::ensure_identity(&target, "kiro-cli");

        let instance_record = with_home(&home, || instance::ensure_instance(&home, true));

        // Precondition: on a write failure, ensure_instance's own
        // return value AND resolve_wire_uuid's later read both fall
        // to the same nil sentinel, so the equality assertion below
        // would still hold -- a false pass that measures a broken
        // write, not the UUID-selection logic this test targets.
        let persisted = assert_instance_persisted(&home);
        assert_eq!(persisted.uuid, instance_record.uuid);

        assert_ne!(
            per_target_identity.uuid, instance_record.uuid,
            "sanity: the per-target and instance UUIDs must be genuinely different values \
             (they are generated by different code, for different purposes)"
        );

        let wire_uuid = with_home(&home, resolve_wire_uuid);

        assert_eq!(
            wire_uuid, instance_record.uuid,
            "resolve_wire_uuid must return the INSTANCE record's UUID"
        );
        assert_ne!(
            wire_uuid, per_target_identity.uuid,
            "resolve_wire_uuid must NEVER return the per-target identity's own UUID -- that \
             was this phase's whole point: one identifier per machine, not per project"
        );

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn resolve_wire_uuid_yields_sentinel_not_a_per_target_uuid_when_instance_record_is_unreadable()
    {
        let _guard = lock_home();
        let home = scratch_dir("wire-uuid-unreadable-instance-home");
        let target = scratch_dir("wire-uuid-unreadable-instance-target");

        let per_target_identity = identity::ensure_identity(&target, "kiro-cli");

        let konductor_dir = home.join(super::super::super::config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(konductor_dir.join("telemetry.json"), b"not json at all").unwrap();

        let wire_uuid = with_home(&home, resolve_wire_uuid);

        assert_eq!(
            wire_uuid, NIL_UUID_SENTINEL,
            "an unreadable instance record must yield the nil-UUID sentinel"
        );
        assert_ne!(
            wire_uuid, per_target_identity.uuid,
            "an unreadable instance record must NEVER fall back to a per-target identity's \
             own UUID -- that would silently reintroduce per-target attribution on exactly \
             the failure path this fix is supposed to close"
        );

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn resolve_wire_uuid_yields_sentinel_when_home_is_unset() {
        let _guard = crate::cli::test_home_lock::lock_home();
        let original_home = std::env::var_os("HOME");
        std::env::remove_var("HOME");

        let wire_uuid = resolve_wire_uuid();

        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => {}
        }

        assert_eq!(wire_uuid, NIL_UUID_SENTINEL);
    }

    /// `HOME=""` must yield the same sentinel as an unset `HOME`, not
    /// a wire UUID resolved against a relative path.
    #[test]
    fn resolve_wire_uuid_yields_sentinel_when_home_is_empty_string_like_unset() {
        let _guard = crate::cli::test_home_lock::lock_home();
        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", "");

        let wire_uuid = resolve_wire_uuid();

        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        assert_eq!(
            wire_uuid, NIL_UUID_SENTINEL,
            "HOME=\"\" must yield the sentinel, the same as unset HOME -- resolving a wire \
             UUID against a relative path would be a real, but meaningless, identity"
        );
    }

    #[test]
    fn agent_version_for_target_reads_the_real_install_info_record() {
        let target = scratch_dir("agent-version-for-target-present");
        let source = scratch_dir("agent-version-for-target-present-source");
        fs::create_dir_all(source.join("dist")).unwrap();
        fs::write(source.join("dist").join("VERSION"), "9.8.7\n").unwrap();

        install_info::write_install_info(&target, &source, "kiro-cli-v2", "2026-01-01T00:00:00Z")
            .unwrap();

        assert_eq!(agent_version_for_target(&target), Some("9.8.7".to_string()));

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn agent_version_for_target_degrades_to_none_when_record_is_absent() {
        let target = scratch_dir("agent-version-for-target-absent");
        assert_eq!(agent_version_for_target(&target), None);
        fs::remove_dir_all(&target).ok();
    }

    // ── report_package_uninstalled{,_for_target}: harness sourced from
    //    install-info.json, not the retired per-target identity ────────

    /// Finds the most recent send in `default_test_transport()` whose
    /// body's `eventType` is `package_uninstalled` and whose
    /// `targetName` matches `harness` -- narrows a shared, never-reset
    /// recorder down to the one event a given test cares about,
    /// mirroring `spawn_and_send_default_entry_point_never_reaches_a_real_transport_in_a_test_build`'s
    /// own filter-by-content approach for a globally shared instance.
    fn find_recorded_uninstall_event(harness: &str) -> Option<serde_json::Value> {
        default_test_transport()
            .recorded()
            .into_iter()
            .filter_map(|send| serde_json::from_str::<serde_json::Value>(&send.body).ok())
            .filter(|body| body["Data"]["eventType"] == "package_uninstalled")
            .filter(|body| body["Data"]["targetName"] == harness)
            .last()
    }

    /// An uninstall still attributes its event with the harness
    /// `install-info.json` carries -- the primary case this change
    /// exists for. `harness` here is BOTH the event's `targetName`
    /// (per `send_event`'s own `target_name` parameter, threaded
    /// through as `install_info.harness.clone()`) and the `harness`
    /// field.
    #[test]
    fn report_package_uninstalled_attributes_with_the_install_info_harness() {
        let _guard = lock_home();
        let home = scratch_dir("uninstalled-harness-from-install-info-home");
        let target = scratch_dir("uninstalled-harness-from-install-info-target");
        let source = scratch_dir("uninstalled-harness-from-install-info-source");
        install_info::write_install_info(&target, &source, "kiro-cli-v2", "2026-01-01T00:00:00Z")
            .unwrap();

        with_home(&home, || report_package_uninstalled(&target));

        let event = find_recorded_uninstall_event("kiro-cli-v2")
            .expect("a package_uninstalled event naming kiro-cli-v2 must have been recorded");
        assert_eq!(event["Data"]["targetName"], "kiro-cli-v2");

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    /// The hole this change closes: `telemetry-id.json` absent
    /// entirely (the state after retirement) must still attribute the
    /// event correctly, sourced from `install-info.json` alone.
    #[test]
    fn report_package_uninstalled_attributes_correctly_with_no_legacy_identity_file() {
        let _guard = lock_home();
        let home = scratch_dir("uninstalled-no-legacy-identity-home");
        let target = scratch_dir("uninstalled-no-legacy-identity-target");
        let source = scratch_dir("uninstalled-no-legacy-identity-source");
        install_info::write_install_info(&target, &source, "claude", "2026-01-01T00:00:00Z")
            .unwrap();
        assert!(
            !identity::identity_path(&target).exists(),
            "sanity: telemetry-id.json must be genuinely absent for this test to mean anything"
        );

        with_home(&home, || report_package_uninstalled(&target));

        let event = find_recorded_uninstall_event("claude").expect(
            "a package_uninstalled event naming claude must have been recorded even \
                     with no telemetry-id.json on disk",
        );
        assert_eq!(event["Data"]["targetName"], "claude");

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    /// With NEITHER file present (the target was never installed, or
    /// opted out), no event is recorded at all -- `read_install_info`
    /// returning `None` is a plain skip, not a fallback to the
    /// nil-UUID sentinel path the way `report_cli_error` treats a
    /// missing identity for "install".
    #[test]
    fn report_package_uninstalled_records_nothing_when_install_info_is_absent() {
        let _guard = lock_home();
        let home = scratch_dir("uninstalled-absent-install-info-home");
        let target = scratch_dir("uninstalled-absent-install-info-target");
        assert!(!install_info::install_info_path(&target).exists());

        let before = default_test_transport().recorded().len();
        with_home(&home, || report_package_uninstalled(&target));
        let after = default_test_transport().recorded().len();

        assert_eq!(
            before, after,
            "no install-info.json means no attribution source, so no event may be sent"
        );

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target).ok();
    }

    /// The batch entry point (`report_package_uninstalled_for_target`)
    /// must attribute identically to the single-target entry point --
    /// both read the same uncached `install_info::read_install_info`.
    #[test]
    fn report_package_uninstalled_for_target_attributes_with_the_install_info_harness() {
        let _guard = lock_home();
        let home = scratch_dir("uninstalled-for-target-harness-home");
        let target = scratch_dir("uninstalled-for-target-harness-target");
        let source = scratch_dir("uninstalled-for-target-harness-source");
        install_info::write_install_info(&target, &source, "kiro-v3", "2026-01-01T00:00:00Z")
            .unwrap();

        with_home(&home, || report_package_uninstalled_for_target(&target));

        let event = find_recorded_uninstall_event("kiro-v3")
            .expect("a package_uninstalled event naming kiro-v3 must have been recorded");
        assert_eq!(event["Data"]["targetName"], "kiro-v3");

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    /// Two-target batch, no cross-contamination: `install_info`'s own
    /// reads are always uncached disk reads (there is no
    /// process-lifetime `OnceLock` for this record the way
    /// `IDENTITY_CACHE` gates `cached_identity`), so calling
    /// `report_package_uninstalled_for_target` for target A and then
    /// target B in the SAME process must report each target's own
    /// harness -- neither inherits the other's. This is the
    /// regression `IDENTITY_CACHE`'s own doc comment warns an `--all`
    /// batch is unsafe for; this test proves the install-info-sourced
    /// path never reintroduces it.
    #[test]
    fn two_target_batch_reports_each_targets_own_harness_without_cross_contamination() {
        let _guard = lock_home();
        let home = scratch_dir("uninstalled-batch-no-cross-contamination-home");
        let target_a = scratch_dir("uninstalled-batch-no-cross-contamination-a");
        let target_b = scratch_dir("uninstalled-batch-no-cross-contamination-b");
        let source = scratch_dir("uninstalled-batch-no-cross-contamination-source");
        install_info::write_install_info(&target_a, &source, "kiro-cli-v2", "2026-01-01T00:00:00Z")
            .unwrap();
        install_info::write_install_info(&target_b, &source, "claude", "2026-01-02T00:00:00Z")
            .unwrap();

        with_home(&home, || {
            report_package_uninstalled_for_target(&target_a);
            report_package_uninstalled_for_target(&target_b);
        });

        let event_a = find_recorded_uninstall_event("kiro-cli-v2")
            .expect("target A's event, naming kiro-cli-v2, must have been recorded");
        let event_b = find_recorded_uninstall_event("claude")
            .expect("target B's event, naming claude, must have been recorded");
        assert_eq!(event_a["Data"]["targetName"], "kiro-cli-v2");
        assert_eq!(
            event_b["Data"]["targetName"], "claude",
            "target B must report ITS OWN harness (claude), never target A's (kiro-cli-v2) -- \
             a process-lifetime cache here would leak A's value into B's event"
        );

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn built_envelope_carries_the_instance_uuid_and_agent_version_together() {
        let instance_uuid = "c".repeat(64);
        let identity_uuid = "d".repeat(64);
        assert_ne!(
            instance_uuid, identity_uuid,
            "sanity: must be distinct values"
        );

        let data = EventEnvelope::build(
            EventType::PackageInstalled,
            "kiro-cli-v2",
            &identity_uuid,
            None,
            None,
            None,
            None,
            Some("5.6.7".to_string()),
        );
        let outer = OuterEnvelope::wrap(data, instance_uuid.clone());
        let json = serde_json::to_value(&outer).unwrap();

        assert_eq!(
            json["UUID"], instance_uuid,
            "the outer envelope's UUID must be the instance value passed to wrap(), never \
             the per-target identity_uuid also in scope"
        );
        assert_eq!(json["Data"]["agentVersion"], "5.6.7");
    }

    #[test]
    fn missing_home_env_var_fails_closed_never_open() {
        let _guard = lock_home();
        let original_home = std::env::var_os("HOME");
        std::env::remove_var("HOME");

        let target = scratch_dir("no-silent-reenable-missing-home-target");
        let allowed = telemetry_consent_allows(false);

        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => {}
        }

        assert!(
            !allowed,
            "an unresolvable HOME must fail closed to \"not allowed\", never default to \
             \"allowed\" -- there is no anchor to read a real consent signal from"
        );
        fs::remove_dir_all(&target).ok();
    }
}
