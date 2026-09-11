// SPDX-License-Identifier: Apache-2.0
//
// resolve_cwd_json_envelope.rs — end-to-end confirmation that a
// `resolve_cwd()` failure on the `synth`/`doctor` dispatch arms goes
// through the `--json` error envelope
// (konductor-cli-engineering-design.md's "Logging and Diagnostics"
// §Decision 3) rather than the plain-text `konductor: <message>` line.
// `command` holds the literal string `"konductor"` on this envelope,
// per Decision 3's own text: `resolve_cwd()` called before dispatch is
// one of the command-agnostic paths, not attributed to `synth` or
// `doctor` specifically.
//
// Approach: `std::env::current_dir()` cannot be forced to fail from an
// in-process `cargo test` thread (dispatch.rs's own
// `resolve_cwd_succeeds_with_an_existing_directory` test comment: the
// deleted-cwd trick is process-global state, unsafe to mutate from
// parallel test threads). A subprocess sidesteps that entirely: `sh -c`
// `cd`s into a scratch directory, `rmdir`s it out from under itself,
// then `exec`s the real `konductor` binary from within that now-deleted
// directory, so the child's own `getcwd()` call fails with ENOENT.

use std::path::PathBuf;
use std::process::{Command, Output};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-resolve-cwd-json-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Runs `konductor <args>` from within a directory that is deleted out
/// from under the process before it starts, via a `cd && rmdir && exec`
/// shell wrapper. Each argument is single-quoted for the shell; none of
/// the paths/args this test passes contain a `'`, so no escaping beyond
/// that is needed.
fn run_konductor_with_deleted_cwd(args: &[&str]) -> Output {
    let scratch = scratch_dir("deleted");
    let scratch_str = scratch.to_str().unwrap();
    let quoted_args: Vec<String> = args.iter().map(|a| format!("'{a}'")).collect();
    let shell_cmd = format!(
        "cd '{scratch_str}' && rmdir '{scratch_str}' && exec '{}' {}",
        bin(),
        quoted_args.join(" ")
    );
    Command::new("sh")
        .arg("-c")
        .arg(shell_cmd)
        .output()
        .expect("failed to spawn sh")
}

/// `konductor doctor --json` with an unresolvable cwd must emit the
/// `--json` error envelope on stdout, not a plain-text line on stderr.
#[test]
fn doctor_json_resolve_cwd_failure_emits_json_envelope_not_plain_text() {
    let output = run_konductor_with_deleted_cwd(&["doctor", "--json"]);

    assert_ne!(
        output.status.code(),
        Some(0),
        "expected a failing invocation with an unresolvable cwd"
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout must be valid UTF-8");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|err| {
        panic!("stdout must be a single valid JSON document: {err}\nstdout was: {stdout:?}")
    });
    assert_eq!(
        parsed["command"], "konductor",
        "resolve_cwd() is a command-agnostic path -- command must be the literal string \"konductor\", not \"doctor\""
    );
    assert!(
        parsed["error"]
            .as_str()
            .unwrap()
            .contains("could not determine the current directory"),
        "unexpected error message: {parsed:?}"
    );

    let stderr = String::from_utf8(output.stderr).expect("stderr must be valid UTF-8");
    assert!(
        !stderr.contains("could not determine the current directory"),
        "the plain-text message must not ALSO appear on stderr when --json is set: {stderr:?}"
    );
}

/// `konductor synth --json` with an unresolvable cwd must emit the
/// `--json` error envelope on stdout, not a plain-text line on stderr.
#[test]
fn synth_json_resolve_cwd_failure_emits_json_envelope_not_plain_text() {
    let output = run_konductor_with_deleted_cwd(&["synth", "--json"]);

    assert_ne!(
        output.status.code(),
        Some(0),
        "expected a failing invocation with an unresolvable cwd"
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout must be valid UTF-8");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|err| {
        panic!("stdout must be a single valid JSON document: {err}\nstdout was: {stdout:?}")
    });
    assert_eq!(
        parsed["command"], "konductor",
        "resolve_cwd() is a command-agnostic path -- command must be the literal string \"konductor\", not \"synth\""
    );
    assert!(
        parsed["error"]
            .as_str()
            .unwrap()
            .contains("could not determine the current directory"),
        "unexpected error message: {parsed:?}"
    );

    let stderr = String::from_utf8(output.stderr).expect("stderr must be valid UTF-8");
    assert!(
        !stderr.contains("could not determine the current directory"),
        "the plain-text message must not ALSO appear on stderr when --json is set: {stderr:?}"
    );
}

/// Negative control: without `--json`, the SAME unresolvable-cwd
/// failure on `doctor` still prints the pre-existing plain-text
/// `konductor: <message>` line on stderr, and stdout stays empty. This
/// proves the fix is `--json`-gated, not a behavior change to the
/// non-`--json` path.
#[test]
fn doctor_without_json_resolve_cwd_failure_stays_plain_text() {
    let output = run_konductor_with_deleted_cwd(&["doctor"]);

    assert_ne!(
        output.status.code(),
        Some(0),
        "expected a failing invocation with an unresolvable cwd"
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout must be valid UTF-8");
    assert!(
        stdout.trim().is_empty(),
        "stdout must stay empty without --json: {stdout:?}"
    );

    let stderr = String::from_utf8(output.stderr).expect("stderr must be valid UTF-8");
    assert!(
        stderr.contains("konductor: could not determine the current directory"),
        "expected the bare 'konductor: ' prefix (command-agnostic path) on stderr: {stderr:?}"
    );
}
