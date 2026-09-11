// SPDX-License-Identifier: Apache-2.0
//
// kondutor_log_debug_trace.rs — end-to-end coverage for
// KONDUCTOR_LOG=debug (konductor-cli-engineering-design.md's "Logging
// and Diagnostics" §Decision 1), driving the REAL compiled binary in a
// subprocess.
//
// A subprocess is required, not an in-process call into `cli::trace`:
// `trace::debug_enabled()` memoizes its env-var read in a
// process-lifetime `OnceLock` (see that module's own doc comment), so
// only a fresh process picks up a fresh `KONDUCTOR_LOG` value -- the
// same reason `synth_install_e2e.rs` and the concurrency integration
// tests in this directory already drive the real binary rather than
// calling dispatch functions directly.
//
// Isolation: `HOME` is always overridden to an isolated scratch dir
// (never the test-runner's real home) -- same rationale as
// `synth_install_e2e.rs`'s own `run_konductor` helper: `logging.rs`
// resolves `$HOME` on every invocation regardless of which command
// ran, so every subprocess here needs an isolated `$HOME` or it would
// write a real invocation-log line into this machine's actual home
// directory.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_home(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-log-debug-trace-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Runs the real `konductor` binary with `KONDUCTOR_LOG` set to
/// `konductor_log_value` (pass `None` to leave it unset), `HOME`
/// overridden to `home` (an isolated scratch dir), and `args` as the
/// invocation's arguments.
fn run_konductor(home: &Path, konductor_log_value: Option<&str>, args: &[&str]) -> Output {
    let mut cmd = Command::new(bin());
    cmd.args(args).current_dir(home).env("HOME", home);
    match konductor_log_value {
        Some(value) => cmd.env("KONDUCTOR_LOG", value),
        None => cmd.env_remove("KONDUCTOR_LOG"),
    };
    cmd.output().expect("failed to spawn konductor binary")
}

/// `KONDUCTOR_LOG=debug` on a real invocation must emit at least one
/// trace line to stderr, in the documented `YYYY-MM-DDTHH:MM:SS LEVEL
/// message` shape -- plain text, no JSON wrapping, no trailing `Z`
/// (distinct from the invocation log's own ISO-8601 `Z`-suffixed
/// timestamp).
#[test]
fn konductor_log_debug_emits_trace_lines_to_stderr() {
    let home = scratch_home("emits");

    let output = run_konductor(&home, Some("debug"), &["doctor", "--target", "/tmp"]);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        stderr
            .lines()
            .any(|line| line.starts_with(char::is_numeric)),
        "expected at least one debug trace line on stderr, got: {stderr:?}"
    );

    let trace_line = stderr
        .lines()
        .find(|line| line.starts_with(char::is_numeric))
        .unwrap();
    // "YYYY-MM-DDTHH:MM:SS " prefix is 20 characters (19 for the
    // timestamp itself, plus the separating space before LEVEL).
    assert!(
        trace_line.len() > 20,
        "trace line too short to carry a timestamp + level + message: {trace_line:?}"
    );
    let ts = &trace_line[..19];
    assert_eq!(ts.as_bytes()[4], b'-');
    assert_eq!(ts.as_bytes()[7], b'-');
    assert_eq!(ts.as_bytes()[10], b'T');
    assert_eq!(ts.as_bytes()[13], b':');
    assert_eq!(ts.as_bytes()[16], b':');
    assert_ne!(
        trace_line.as_bytes()[19],
        b'Z',
        "trace timestamps must not carry the invocation-log's trailing Z: {trace_line:?}"
    );
}

/// Unset `KONDUCTOR_LOG` must produce zero trace-shaped lines on
/// stderr -- the gating default.
#[test]
fn konductor_log_unset_emits_no_trace_lines() {
    let home = scratch_home("unset");

    let output = run_konductor(&home, None, &["doctor", "--target", "/tmp"]);
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        !stderr
            .lines()
            .any(|line| line.starts_with(char::is_numeric)),
        "expected no timestamp-prefixed trace lines with KONDUCTOR_LOG unset, got: {stderr:?}"
    );
}

/// Any value other than exactly `debug` (case-sensitive, exact match --
/// see trace.rs's own `debug_enabled` doc comment) must be treated the
/// same as unset: no trace output.
#[test]
fn konductor_log_wrong_value_emits_no_trace_lines() {
    let home = scratch_home("wrong-value");

    for value in ["Debug", "DEBUG", "trace", "1", "true"] {
        let output = run_konductor(&home, Some(value), &["doctor", "--target", "/tmp"]);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            !stderr
                .lines()
                .any(|line| line.starts_with(char::is_numeric)),
            "KONDUCTOR_LOG={value:?} must not enable trace output, got: {stderr:?}"
        );
    }
}

/// `KONDUCTOR_LOG=debug` combined with `--json` must never mix a trace
/// line into stdout: stdout must stay valid, parseable JSON (or the
/// success/error envelope shape doctor already emits), independent of
/// whether tracing also fired on stderr.
#[test]
fn konductor_log_debug_never_mixes_into_json_stdout() {
    let home = scratch_home("json-isolation");

    let output = run_konductor(
        &home,
        Some("debug"),
        &["doctor", "--target", "/tmp", "--json"],
    );
    let stdout = String::from_utf8_lossy(&output.stdout);

    // doctor --json prints exactly one JSON document to stdout,
    // regardless of KONDUCTOR_LOG. Confirm stdout parses as JSON and
    // contains no trace-shaped line at all.
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).unwrap_or_else(|err| {
            panic!("stdout must be valid JSON even with KONDUCTOR_LOG=debug set: {err}\nstdout: {stdout:?}")
        });
    assert!(
        parsed.is_object(),
        "expected a JSON object on stdout: {parsed}"
    );
    assert!(
        !stdout.contains(" trace "),
        "stdout must never contain a debug trace line: {stdout:?}"
    );
}

/// `KONDUCTOR_LOG=debug` traces both a successful AND a failing
/// invocation -- Decision 1 states tracing is independent of outcome.
/// Uses an invocation that fails for a reason unrelated to tracing
/// itself (an unresolvable doctor destination has no bearing on
/// whether trace lines fire).
#[test]
fn konductor_log_debug_traces_a_failing_invocation_too() {
    let home = scratch_home("traces-failure");
    // Remove HOME so `doctor`'s own destination resolution fails --
    // this only affects `$HOME`-based destination resolution, not
    // `KONDUCTOR_LOG`, which is read independently.
    let mut cmd = Command::new(bin());
    cmd.args(["doctor"]).current_dir(&home);
    cmd.env("KONDUCTOR_LOG", "debug");
    cmd.env_remove("HOME");
    let output = cmd.output().expect("failed to spawn konductor binary");

    assert_ne!(
        output.status.code(),
        Some(0),
        "expected a failing invocation (no HOME, no --target)"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr
            .lines()
            .any(|line| line.starts_with(char::is_numeric)),
        "a failing invocation must still emit trace lines when KONDUCTOR_LOG=debug: {stderr:?}"
    );
}
