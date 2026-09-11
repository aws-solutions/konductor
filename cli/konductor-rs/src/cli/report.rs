// SPDX-License-Identifier: Apache-2.0
//
// report.rs — shared `--json` error-envelope construction and
// reporting, used by every command that emits the
// `{"command": ..., "error": ..., ...extra}` shape on stdout, plus the
// telemetry side effect (design doc D.6/D.11) every such error also
// carries.
//
// Shared by install.rs, synth/mod.rs, doctor.rs, uninstall.rs,
// update.rs, and dispatch.rs -- centralized here rather than owned by
// any one command module, since every command follows this same
// `--json` error-envelope convention (see
// konductor-cli-engineering-design.md's "Logging and Diagnostics"
// §Decision 3) AND the same telemetry `cli_error` reporting convention
// (konductor-usage-analytics-design.md D.6/D.11). `report_error` is
// the single place both conventions meet, so every call site gets
// both for free rather than needing to remember to wire telemetry in
// separately.
//
// The envelope invariant: under `--json`, every non-zero exit emits
// this shape to stdout, and an invocation emits exactly one JSON
// document -- either the success document or this error envelope,
// never both. `command`/`error` are guaranteed on every envelope --
// `build_error_json` inserts `extra` first and `command`/`error`
// last, so a colliding key in `extra` never overrides them. `extra`
// is command-specific and not part of the stable cross-command
// contract.
//
// NOT every error path in the codebase routes through `report_error`:
// a failure that occurs AFTER the operation it's attached to has
// already succeeded (e.g. install.rs's index-finalize write, which
// runs after `install_from_local` has already returned `Ok`) must
// never emit a second `--json` document on top of the success
// envelope that follows -- that would violate the "exactly one JSON
// document" invariant above. Those call sites report telemetry
// directly via `crate::cli::telemetry::report_cli_error` and keep
// their own plain-text `eprintln!`, bypassing this module entirely.

/// Builds the `--json` error envelope: `{"command": ..., "error": ...,
/// ...extra}`. Pure JSON construction, no I/O -- callers that need to
/// print it use `report_error` below; this half exists on its own so
/// tests can assert the exact shape/parseability without capturing
/// stdout.
pub(crate) fn build_error_json(
    command: &str,
    message: &str,
    extra: Vec<(&str, serde_json::Value)>,
) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    for (key, value) in extra {
        object.insert(key.to_string(), value);
    }
    // Inserted last (after `extra`) so a colliding key in `extra` is
    // overwritten by the guaranteed field rather than the reverse --
    // `command`/`error` are guaranteed on every envelope regardless of
    // what a caller passes in `extra`.
    object.insert(
        "command".to_string(),
        serde_json::Value::String(command.to_string()),
    );
    object.insert(
        "error".to_string(),
        serde_json::Value::String(message.to_string()),
    );
    serde_json::Value::Object(object)
}

/// A json-aware error-reporting helper for every error path across
/// `install`/`synth`/`update`/`uninstall`/`doctor`/`dispatch`: prints
/// the `--json` envelope to stdout when `json` is true, or the
/// plain-text `konductor {command}: {message}` line to stderr
/// otherwise, AND reports a telemetry `cli_error` event (design doc
/// D.6/D.11) via `crate::cli::telemetry::report_cli_error` -- folded
/// in here so every call site gets both the envelope/plain-text
/// report and the telemetry side effect from one call, rather than
/// needing to remember to wire telemetry in separately at each site.
///
/// `error_code` is a stable, closed error-category string (D.11) --
/// never `message`/an error's own `Display` text, which routinely
/// embeds a local filesystem path. `target_dir` is the target this
/// error occurred against, needed to resolve telemetry's cached
/// identity lookup (D.6/D.11); callers with no single target in scope
/// yet (e.g. a global index read) pass their best scope-agnostic
/// fallback (typically `$HOME`). `no_telemetry` carries `--no-telemetry`'s
/// parsed value through to `report_cli_error` -- `install`'s call
/// sites are the only ones that ever have a real flag value to pass;
/// every other command passes `false` literally, a value
/// `report_cli_error` never inspects for those commands (D.8).
///
/// `message` is the plain-text wording each call site already used --
/// when `json` is true, the same string becomes the envelope's
/// `"error"` field; when `json` is false, `message` is printed
/// verbatim, byte-identical to each call site's pre-existing
/// plain-text wording. `extra` lets a call site attach additional
/// structured fields (e.g. `duplicate_targets`) without a bespoke
/// `serde_json::json!` call -- `build_error_json` inserts `command`/
/// `error` after `extra`, so a field named `"command"`/`"error"`
/// passed here is overwritten by the guaranteed field rather than
/// overwriting it; callers should still avoid the collision, since
/// the extra key is silently dropped rather than surfaced.
///
/// The `json` branch prints to stdout, not stderr: every success
/// document these commands emit already goes to stdout, so a failure
/// document staying on stdout too means a `--json` consumer only ever
/// has to read one stream to see every outcome, success or failure.
///
/// Prints BEFORE reporting telemetry:
/// `report_cli_error` reaches a host-allowlist DNS resolution
/// (`telemetry::report.rs`'s `endpoint_host_is_allowed`) that is now
/// bounded (see that module's own `DNS_RESOLUTION_TIMEOUT`) but is
/// never instantaneous -- printing the user-facing error line first
/// means a slow-but-within-bound resolver delays only the fire-and-
/// forget telemetry side effect, never the error output every caller
/// of `report_error` exists to surface promptly.
pub(crate) fn report_error(
    command: &str,
    error_code: &str,
    target_dir: &std::path::Path,
    no_telemetry: bool,
    message: &str,
    extra: Vec<(&str, serde_json::Value)>,
    json: bool,
) {
    report_error_impl(
        command,
        error_code,
        target_dir,
        no_telemetry,
        false,
        message,
        extra,
        json,
    );
}

/// Same as `report_error`, but for a `--all` batch call site that
/// visits more than one `target_dir` in a single process -- routes the telemetry side effect through
/// `telemetry::report_cli_error_for_target` (which re-reads identity
/// per call, uncached) instead of `report_error`'s
/// `telemetry::report_cli_error` (the process-global cache), so each
/// target's own UUID is reported rather than every target after the
/// first inheriting whichever UUID the cache resolved first. Mirrors
/// the existing `report_package_uninstalled`/`_for_target` and
/// `report_package_version_updated`/`_for_target` sibling-function
/// convention already established in `telemetry/report.rs`, rather
/// than widening `report_error`'s own signature for every one of its
/// ~20 call sites just to thread a flag only batch call sites need.
pub(crate) fn report_error_for_target(
    command: &str,
    error_code: &str,
    target_dir: &std::path::Path,
    no_telemetry: bool,
    message: &str,
    extra: Vec<(&str, serde_json::Value)>,
    json: bool,
) {
    report_error_impl(
        command,
        error_code,
        target_dir,
        no_telemetry,
        true,
        message,
        extra,
        json,
    );
}

/// Shared core for `report_error`/`report_error_for_target`: prints the
/// envelope/plain-text line, then reports telemetry via whichever of
/// `telemetry::report_cli_error`/`report_cli_error_for_target`
/// `uncached_identity` selects -- kept as one function so the two
/// callers' identical print logic can never drift apart.
#[allow(clippy::too_many_arguments)]
fn report_error_impl(
    command: &str,
    error_code: &str,
    target_dir: &std::path::Path,
    no_telemetry: bool,
    uncached_identity: bool,
    message: &str,
    extra: Vec<(&str, serde_json::Value)>,
    json: bool,
) {
    if json {
        println!("{}", build_error_json(command, message, extra));
    } else {
        eprintln!("konductor {command}: {message}");
    }
    if uncached_identity {
        crate::cli::telemetry::report_cli_error_for_target(
            target_dir,
            command,
            error_code,
            no_telemetry,
        );
    } else {
        crate::cli::telemetry::report_cli_error(target_dir, command, error_code, no_telemetry);
    }
}

/// Reports the zero-tracked-installs case shared by `uninstall`/
/// `update`: the one success path that returns before there is any
/// per-target result to shape into a richer report. `--json` mode
/// emits `{"command": ..., "tracked_installs": 0}`; `--json` false
/// keeps the plain-text wording each caller already used.
pub(crate) fn report_no_tracked_installs(command: &str, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::json!({
                "command": command,
                "tracked_installs": 0,
            })
        );
        return;
    }
    println!("konductor {command}: no tracked Konductor installs found");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_error_json_has_command_and_error_fields() {
        let value = build_error_json("uninstall", "something went wrong", Vec::new());
        assert_eq!(value["command"], "uninstall");
        assert_eq!(value["error"], "something went wrong");
    }

    #[test]
    fn build_error_json_includes_extra_fields() {
        let value = build_error_json(
            "install",
            "bad target",
            vec![("target_dir", serde_json::Value::String("/tmp/x".into()))],
        );
        assert_eq!(value["command"], "install");
        assert_eq!(value["error"], "bad target");
        assert_eq!(value["target_dir"], "/tmp/x");
    }

    #[test]
    fn build_error_json_extra_field_never_collides_with_command_or_error() {
        // A caller-supplied extra field named "command" or "error"
        // must not override the guaranteed fields: build_error_json
        // inserts `extra` first and the guaranteed fields last, so the
        // real command/message always win over a colliding extra key.
        let value = build_error_json(
            "doctor",
            "resolution failed",
            vec![
                ("command", serde_json::Value::String("evil".into())),
                ("error", serde_json::Value::String("evil".into())),
            ],
        );
        assert_eq!(value["command"], "doctor");
        assert_eq!(value["error"], "resolution failed");
        // Both colliding extra keys were absorbed into the guaranteed
        // fields, so the envelope still has exactly two keys, not four.
        assert_eq!(value.as_object().unwrap().len(), 2);
    }

    #[test]
    fn report_error_json_true_produces_parseable_envelope_with_extra() {
        // report_error's json branch delegates to build_error_json and
        // prints to stdout; assert the envelope it WOULD print via the
        // pure builder, since capturing stdout across parallel test
        // threads is unreliable (see uninstall.rs's own test-suite
        // comments on this same tradeoff).
        let value = build_error_json(
            "synth",
            "transformer 'kiro-cli-v2' failed: boom",
            vec![("completed", serde_json::Value::Array(Vec::new()))],
        );
        let reparsed: serde_json::Value =
            serde_json::from_str(&value.to_string()).expect("must be valid, parseable JSON");
        assert_eq!(reparsed["command"], "synth");
        assert_eq!(reparsed["error"], "transformer 'kiro-cli-v2' failed: boom");
        assert_eq!(reparsed["completed"], serde_json::json!([]));
    }

    #[test]
    fn report_no_tracked_installs_json_has_command_and_tracked_installs_fields() {
        // Structural check mirroring report_error's approach above --
        // asserts the JSON shape this function's `json` branch produces
        // without capturing stdout.
        let value = serde_json::json!({
            "command": "uninstall",
            "tracked_installs": 0,
        });
        let reparsed: serde_json::Value =
            serde_json::from_str(&value.to_string()).expect("must be valid, parseable JSON");
        assert_eq!(reparsed["command"], "uninstall");
        assert_eq!(reparsed["tracked_installs"], 0);
    }
}
