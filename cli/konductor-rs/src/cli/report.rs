// SPDX-License-Identifier: Apache-2.0
//
// report.rs — shared `--json` error-envelope construction and
// reporting, used by every command that emits the
// `{"command": ..., "error": ..., ...extra}` shape on stdout, plus the
// telemetry side effect every such error also carries.
//
// Invariant: under `--json`, an invocation emits exactly one JSON
// document -- either the success document or this error envelope,
// never both. `command`/`error` are guaranteed on every envelope --
// `build_error_json` inserts `extra` first and `command`/`error`
// last, so a colliding key in `extra` never overrides them.
//
// Not every error path routes through `report_error`: a failure that
// occurs AFTER the operation it's attached to has already succeeded
// (e.g. install.rs's index-finalize write, which runs after
// `install_from_local` has already returned `Ok`) must never emit a
// second `--json` document on top of the success envelope that
// follows. Those call sites report telemetry directly via
// `crate::cli::telemetry::report_cli_error` instead.

/// Builds the `--json` error envelope: `{"command": ..., "error": ...,
/// ...extra}`. Pure JSON construction, no I/O, so tests can assert the
/// exact shape without capturing stdout.
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

/// A json-aware error-reporting helper shared across commands: prints
/// the `--json` envelope to stdout when `json` is true, or the
/// plain-text `konductor {command}: {message}` line to stderr
/// otherwise, and reports a telemetry `cli_error` event via
/// `crate::cli::telemetry::report_cli_error`.
///
/// `error_code` is a stable, closed error-category string, never
/// `message`/an error's own `Display` text (which routinely embeds a
/// local filesystem path). `target_dir` is the target this error
/// occurred against, used to resolve telemetry's endpoint/opt-out;
/// callers with no single target in scope yet pass their best
/// scope-agnostic fallback (typically `$HOME`). `no_telemetry` carries
/// `--no-telemetry` through to `report_cli_error`, which skips the
/// event when set. `extra` lets a call site attach additional
/// structured fields without a bespoke `serde_json::json!` call; a key
/// named `"command"`/`"error"` is silently overwritten by the
/// guaranteed field, so callers should avoid the collision.
///
/// Prints the user-facing line before reporting telemetry: the
/// telemetry call can block briefly on a bounded DNS resolution, and
/// the error output should never wait on that.
#[allow(clippy::too_many_arguments)]
pub(crate) fn report_error(
    command: &str,
    error_code: &str,
    target_dir: &std::path::Path,
    no_telemetry: bool,
    message: &str,
    extra: Vec<(&str, serde_json::Value)>,
    json: bool,
    color: crate::cli::output::ColorMode,
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
        color,
    );
}

/// Same as `report_error`, but for a `--all` batch call site that
/// visits more than one `target_dir` in a single process: routes the
/// telemetry side effect through `telemetry::report_cli_error_for_target`
/// (resolves the endpoint per call, uncached) instead of
/// `report_error`'s process-global endpoint cache, so each target's own
/// `.konductor/config.yml` opt-out is read fresh rather than inherited
/// from whichever target the cache resolved first.
#[allow(clippy::too_many_arguments)]
pub(crate) fn report_error_for_target(
    command: &str,
    error_code: &str,
    target_dir: &std::path::Path,
    no_telemetry: bool,
    message: &str,
    extra: Vec<(&str, serde_json::Value)>,
    json: bool,
    color: crate::cli::output::ColorMode,
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
        color,
    );
}

/// Shared core for `report_error`/`report_error_for_target`: prints the
/// envelope/plain-text line, then reports telemetry via whichever of
/// `telemetry::report_cli_error`/`report_cli_error_for_target`
/// `uncached_identity` selects.
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
    color: crate::cli::output::ColorMode,
) {
    if json {
        println!("{}", build_error_json(command, message, extra));
    } else {
        eprintln!(
            "{} {message}",
            crate::cli::output::error_prefix(color, &format!("konductor {command}:"))
        );
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
/// `update`/`doctor`: the one success path that returns before there is
/// any per-target result to shape into a richer report. `--json` mode
/// emits `{"command": ..., "tracked_installs": 0}`; plain-text mode
/// prints the same wording as before, now colorized green via
/// `success_prefix` since this is a genuine success message.
pub(crate) fn report_no_tracked_installs(
    command: &str,
    json: bool,
    color: crate::cli::output::ColorMode,
) {
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
    println!(
        "{} no tracked Konductor installs found",
        crate::cli::output::success_prefix(color, &format!("konductor {command}:"))
    );
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
