// SPDX-License-Identifier: Apache-2.0
//
// verbose_has_no_effect_on_error_paths.rs — end-to-end confirmation
// that `--verbose`/`-v` stays scoped to success-detail output only,
// with zero effect on any error path.
//
// This test does not refactor `--verbose` itself; it is a
// behavioral pin confirming the property already holds after this
// change set's earlier logging/error-handling edits (KONDUCTOR_LOG
// tracing, error-prefix unification, the --json error envelope).
//
// Approach: run the REAL compiled binary against a failing invocation
// on each of `synth`/`doctor` (both have a `--verbose` success-detail
// branch: `format_verbose_lines`, `doctor::print_report`'s verbose
// branch), once with `--verbose`/`-v` and once without, and assert
// BYTE-IDENTICAL stdout, stderr, and exit code between the two runs. A
// subprocess (rather than calling dispatch functions directly and
// capturing output) is used because these call sites write directly
// via `println!`/`eprintln!` and there is no in-process capture
// mechanism already established in this crate for that (see
// uninstall.rs's own test-suite comments on preferring structural
// assertions over stdout/stderr capture): a subprocess sidesteps
// that entirely by letting the OS capture each stream.
//
// `install` has its own `--verbose` success-detail branch
// (`format_install_verbose_lines`) but no dedicated failing-invocation
// test here. Every one of install's failure branches (an unresolvable
// destination, an unregistered `--harness`, a `would_fail_as_noop`
// local-source check, a corrupted/duplicate index) reports through the
// same shared `report::report_error` function doctor's own
// resolve-destination failure already exercises below: `doctor.rs`
// re-exports and calls install's own `resolve_destination` directly,
// so that specific failure is the identical function call, not just
// similar code. `report_error` takes no `verbose` argument, so there
// is no install-specific error-formatting code left for a dedicated
// install test to cover. The only way to reach install's failure path
// without `--from` is the real GitHub-backed remote-install fallback
// (`dispatch_install_with`'s hardcoded remote closure), so a dedicated
// install test here would require live network access for coverage
// this file's other two failing-invocation tests already provide.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_home(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-verbose-no-effect-on-error-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn run_konductor(home: &Path, sink: &telemetry_test_sink::TelemetrySink, args: &[&str]) -> Output {
    let mut command = Command::new(bin());
    command.args(args).current_dir(home).env("HOME", home);
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    command.output().expect("failed to spawn konductor binary")
}

/// Asserts that appending `-v` to `args` changes NOTHING about a
/// failing invocation's stdout, stderr, or exit code.
fn assert_verbose_has_no_effect_on_failure(
    home: &Path,
    sink: &telemetry_test_sink::TelemetrySink,
    args: &[&str],
) {
    let without_verbose = run_konductor(home, sink, args);
    assert_ne!(
        without_verbose.status.code(),
        Some(0),
        "expected a failing invocation for args {args:?}, got success"
    );

    let mut with_verbose_args: Vec<&str> = args.to_vec();
    with_verbose_args.push("-v");
    let with_verbose = run_konductor(home, sink, &with_verbose_args);

    assert_eq!(
        without_verbose.status.code(),
        with_verbose.status.code(),
        "exit code must be identical with/without -v on a failing invocation: {args:?}"
    );
    assert_eq!(
        without_verbose.stdout, with_verbose.stdout,
        "stdout must be byte-identical with/without -v on a failing invocation: {args:?}"
    );
    assert_eq!(
        without_verbose.stderr, with_verbose.stderr,
        "stderr must be byte-identical with/without -v on a failing invocation: {args:?}"
    );
}

#[test]
fn synth_verbose_has_no_effect_on_a_failing_invocation() {
    let home = scratch_home("synth");
    let sink = telemetry_test_sink::TelemetrySink::start();
    // An empty source tree with no agents/skills/SOPs/context still
    // parses successfully today (see synth/mod.rs's own "nothing to
    // build" message) -- force a genuine parse failure instead via a
    // malformed agent-spec file, which fails before format_verbose_lines
    // is ever reached.
    let agents_dir = home.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(
        agents_dir.join("broken.agent-spec.json"),
        b"{ not valid json",
    )
    .unwrap();

    assert_verbose_has_no_effect_on_failure(&home, &sink, &["synth"]);
}

#[test]
fn doctor_verbose_has_no_effect_on_a_failing_invocation() {
    let home = scratch_home("doctor");
    let sink = telemetry_test_sink::TelemetrySink::start();
    // An unresolvable destination -- $HOME removed AND no --target --
    // is an APPLICATION-level error path (doctor.rs's own
    // resolve_destination failure, via report::report_error), not a
    // clap usage error. This matters: clap's own usage-error text
    // echoes back the invoking command line verbatim, so appending -v
    // to a CLAP-rejected invocation (e.g. --target/--all together)
    // legitimately changes clap's own rendered text -- that would be a
    // false positive for this test, not a real violation of `--verbose`
    // staying scoped to success-only output.
    let mut cmd = Command::new(bin());
    cmd.args(["doctor"]).current_dir(&home);
    cmd.env_remove("HOME");
    for var in sink.env_vars() {
        cmd.env(var.name, &var.value);
    }
    let without_verbose = cmd.output().expect("failed to spawn konductor binary");
    assert_ne!(
        without_verbose.status.code(),
        Some(0),
        "expected a failing invocation with no HOME and no --target"
    );

    let mut cmd = Command::new(bin());
    cmd.args(["doctor", "-v"]).current_dir(&home);
    cmd.env_remove("HOME");
    for var in sink.env_vars() {
        cmd.env(var.name, &var.value);
    }
    let with_verbose = cmd.output().expect("failed to spawn konductor binary");

    assert_eq!(
        without_verbose.status.code(),
        with_verbose.status.code(),
        "exit code must be identical with/without -v on a failing invocation"
    );
    assert_eq!(
        without_verbose.stdout, with_verbose.stdout,
        "stdout must be byte-identical with/without -v on a failing invocation"
    );
    assert_eq!(
        without_verbose.stderr, with_verbose.stderr,
        "stderr must be byte-identical with/without -v on a failing invocation"
    );
}

/// Companion positive control: `--verbose` DOES change output on a
/// SUCCESSFUL `doctor` run (append the per-file detail listing) --
/// without this, the two tests above would also pass if `-v` were
/// silently ignored everywhere, which is not the property
/// `--verbose` actually guarantees (scoped to error paths only, not a no-op flag).
#[test]
fn doctor_verbose_does_affect_a_successful_invocation() {
    let home = scratch_home("doctor-success-control");
    let sink = telemetry_test_sink::TelemetrySink::start();

    let without_verbose = run_konductor(
        &home,
        &sink,
        &["doctor", "--target", home.to_str().unwrap()],
    );
    let with_verbose = run_konductor(
        &home,
        &sink,
        &["doctor", "--target", home.to_str().unwrap(), "-v"],
    );

    assert_eq!(
        without_verbose.status.code(),
        with_verbose.status.code(),
        "doctor's exit code must not depend on -v"
    );
    assert_ne!(
        without_verbose.stdout, with_verbose.stdout,
        "doctor -v must add per-check detail lines on a real run, proving -v is not a global no-op"
    );
}
