// SPDX-License-Identifier: Apache-2.0
//
// telemetry_report_process.rs — integration test proving
// `report_cli_error`'s once-per-process identity cache and
// `--no-telemetry` skip semantics hold across the REAL compiled
// `konductor` binary (mirrors install_manifest_concurrency.rs's own
// rationale for testing across process boundaries: this crate defines
// only a `[[bin]]` target, so `telemetry::report_cli_error`'s
// process-global `OnceLock` identity cache -- and therefore
// `--no-telemetry`'s interaction with it -- cannot be exercised
// meaningfully from a `cargo test` unit test running inside ONE shared
// process; see `telemetry/report.rs`'s own test-module docstring for
// why those tests deliberately stop short of this).
//
// The scenario this specifically guards: `report_cli_error`'s
// `no_telemetry` flag must suppress a report regardless of whether an
// identity is already cached for `target_dir` -- a target that already
// has a valid `.konductor/telemetry-id.json` (e.g. left over from a
// prior, successful, telemetry-ENABLED install) must NOT report an
// error via that pre-existing identity on an invocation that
// explicitly passes `--no-telemetry`; the opt-out must hold regardless
// of whether an identity happens to already be on disk.
//
// Observability without a real network endpoint: `report_cli_error`'s
// only observable side effect that does not depend on a live telemetry
// backend is `spawn_and_send`'s script materialization
// (`$HOME/.konductor/tmp/konductor-telemetry-report.sh`, written
// SYNCHRONOUSLY before the fire-and-forget child process is even
// spawned -- see `report.rs`'s own `materialize_script`/`spawn_and_send`).
// Whether that file exists after this process exits is therefore a
// reliable, deterministic proxy for "did a telemetry event actually
// get reported", with no dependency on the (unreachable, `.invalid`)
// compile-time-default endpoint the report itself is aimed at.
//
// Every invocation below passes `--target <isolated_dir>` explicitly,
// and overrides `HOME` to a SEPARATE isolated scratch dir (never the
// real machine's own `$HOME`) -- `install`'s default destination is
// `$HOME` (see install.rs's `resolve_destination`), and script
// materialization is keyed off `$HOME` too (`report.rs`'s
// `private_script_dir`).

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const CMD_INSTALL: &str = "install";
const CMD_UPDATE: &str = "update";
const MATERIALIZED_SCRIPT_RELATIVE_PATH: &str = ".konductor/tmp/konductor-telemetry-report.sh";
const IDENTITY_RELATIVE_PATH: &str = ".konductor/telemetry-id.json";

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-telemetry-report-process-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Runs `konductor` with `args` against a fresh process, with `HOME`
/// overridden to `home_dir` (script materialization and the log-write
/// path both key off `$HOME` -- see this file's own module docstring).
fn run_konductor(home_dir: &Path, target_dir: &Path, args: &[&str]) -> Output {
    Command::new(bin())
        .args(args)
        .current_dir(target_dir)
        .env("HOME", home_dir)
        .output()
        .expect("failed to spawn konductor binary")
}

/// Writes a well-formed `.konductor/telemetry-id.json` directly at
/// `target_dir`, simulating a prior successful (telemetry-enabled)
/// install -- the exact precondition the regression needs:
/// `cached_identity(target_dir)` must resolve to `Some(_)` on the very
/// first `report_cli_error` call this process makes, matching
/// `identity.rs`'s own on-disk schema exactly (`schema_version`,
/// `version`, `UUID`, `harness`).
fn seed_preexisting_identity(target_dir: &Path) {
    seed_preexisting_identity_with_uuid(target_dir, &"a".repeat(64));
}

/// Same as `seed_preexisting_identity`, but with a caller-chosen `UUID`
/// -- needed by the batch-attribution regression below, which seeds TWO
/// distinct targets and must be able to tell them apart.
fn seed_preexisting_identity_with_uuid(target_dir: &Path, uuid: &str) {
    let konductor_dir = target_dir.join(".konductor");
    std::fs::create_dir_all(&konductor_dir).unwrap();
    std::fs::write(
        konductor_dir.join("telemetry-id.json"),
        format!(r#"{{"schema_version":1,"version":"0.1.0","UUID":"{uuid}","harness":"kiro-cli"}}"#),
    )
    .unwrap();
}

/// Triggers `install`'s `install.would_fail_as_noop` error path (no
/// `--from` at all) against `target_dir` -- the cheapest deterministic
/// way to make `dispatch_install_with` call `report_cli_error` exactly
/// once, without needing a seeded synth source tree or a real strategy
/// run. Returns the process `Output` so the caller can assert on exit
/// status if it wants to.
fn run_install_with_no_from(home_dir: &Path, target_dir: &Path, extra_args: &[&str]) -> Output {
    let target_str = target_dir.display().to_string();
    // `--harness` is required. A valid choice must be passed so this
    // reaches `would_fail_as_noop` (a strategy IS selected -- that
    // strategy's own no-op check is what actually fails, since --from
    // is absent) -- omitting it would instead fail at clap parse time,
    // before `dispatch_install_with`/`report_cli_error` are ever
    // reached, which would make every regression this file tests pass
    // for the wrong reason (telemetry code never ran, rather than
    // running and correctly suppressing).
    let mut args: Vec<&str> = vec![
        CMD_INSTALL,
        "--target",
        &target_str,
        "--harness",
        "kiro-cli-v2",
    ];
    args.extend_from_slice(extra_args);
    run_konductor(home_dir, target_dir, &args)
}

/// The core regression test (see this file's own module docstring):
/// with a pre-existing identity already on disk, `--no-telemetry` must
/// suppress the report unconditionally -- not only when no identity
/// exists yet.
#[test]
fn no_telemetry_suppresses_cli_error_report_even_with_a_preexisting_identity() {
    let home_dir = scratch_dir("no-telemetry-home");
    let target_dir = scratch_dir("no-telemetry-target");
    seed_preexisting_identity(&target_dir);

    let output = run_install_with_no_from(&home_dir, &target_dir, &["--no-telemetry"]);

    assert!(
        !output.status.success(),
        "install with no --from must fail as a no-op, --no-telemetry notwithstanding"
    );
    assert_eq!(
        output.status.code(),
        Some(64),
        "must exit with EXIT_USAGE_ERROR (64), stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );

    let script_path = home_dir.join(MATERIALIZED_SCRIPT_RELATIVE_PATH);
    assert!(
        !script_path.exists(),
        "--no-telemetry must suppress report_cli_error even when a valid identity already \
         exists at the target ({}); found a materialized transport script at {} -- the \
         opt-out must be checked unconditionally, not only in the branch taken when NO \
         identity exists yet",
        target_dir.join(IDENTITY_RELATIVE_PATH).display(),
        script_path.display()
    );

    std::fs::remove_dir_all(&home_dir).ok();
    std::fs::remove_dir_all(&target_dir).ok();
}

/// Positive control for the test above: the SAME scenario, MINUS
/// `--no-telemetry`, must still report (and therefore materialize the
/// transport script) -- proving the absence of the script in the test
/// above is actually caused by the opt-out, not by some unrelated
/// reason telemetry never fires in this environment at all (e.g. a
/// broken test harness assumption).
#[test]
fn cli_error_report_fires_and_materializes_the_script_without_no_telemetry() {
    let home_dir = scratch_dir("with-telemetry-home");
    let target_dir = scratch_dir("with-telemetry-target");
    seed_preexisting_identity(&target_dir);

    let output = run_install_with_no_from(&home_dir, &target_dir, &[]);

    assert!(
        !output.status.success(),
        "install with no --from must fail as a no-op"
    );
    assert_eq!(output.status.code(), Some(64));

    let script_path = home_dir.join(MATERIALIZED_SCRIPT_RELATIVE_PATH);
    assert!(
        script_path.exists(),
        "without --no-telemetry, report_cli_error must fire and materialize the transport \
         script at {} -- if this positive control fails, the negative test above proves \
         nothing",
        script_path.display()
    );

    std::fs::remove_dir_all(&home_dir).ok();
    std::fs::remove_dir_all(&target_dir).ok();
}

/// Same suppression, but for the OTHER branch `report_cli_error`
/// serves: no pre-existing identity at all (a genuinely first-ever
/// invocation). `--no-telemetry` must suppress the nil-UUID-sentinel
/// report this branch would otherwise fire just as completely as
/// it suppresses the pre-existing-identity branch above.
#[test]
fn no_telemetry_suppresses_cli_error_report_with_no_preexisting_identity() {
    let home_dir = scratch_dir("no-telemetry-no-identity-home");
    let target_dir = scratch_dir("no-telemetry-no-identity-target");
    // Deliberately do NOT seed an identity file this time.

    let output = run_install_with_no_from(&home_dir, &target_dir, &["--no-telemetry"]);

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(64));

    let script_path = home_dir.join(MATERIALIZED_SCRIPT_RELATIVE_PATH);
    assert!(
        !script_path.exists(),
        "--no-telemetry must suppress the nil-UUID-sentinel report when no identity exists \
         yet either; found a materialized transport script at {}",
        script_path.display()
    );

    std::fs::remove_dir_all(&home_dir).ok();
    std::fs::remove_dir_all(&target_dir).ok();
}

/// Positive control for the test above, and the missing case this fix
/// adds: the documented nil-UUID-sentinel branch -- telemetry ON,
/// error occurs before ANY identity file exists at the target -- is
/// arguably the most common real-world scenario (a genuinely
/// first-ever invocation against a target that has never been
/// installed to before), yet no prior test exercised it. Every
/// existing positive control in this file seeds a pre-existing
/// identity first (`cli_error_report_fires_and_materializes_the_script_without_no_telemetry`);
/// this test deliberately does NOT, confirming `report_cli_error`
/// still fires (under the nil-UUID sentinel) and materializes
/// the transport script even with no identity on disk at all --
/// without `--no-telemetry`, unlike `no_telemetry_suppresses_cli_error_report_with_no_preexisting_identity`
/// above, which covers the identical no-identity setup but asserts the
/// OPPOSITE (suppressed) outcome under the opt-out.
#[test]
fn cli_error_report_fires_under_nil_uuid_sentinel_with_no_preexisting_identity() {
    let home_dir = scratch_dir("nil-uuid-sentinel-home");
    let target_dir = scratch_dir("nil-uuid-sentinel-target");
    // Deliberately do NOT seed an identity file -- the exact precondition
    // the nil-UUID-sentinel branch exists to serve.
    assert!(
        !target_dir.join(IDENTITY_RELATIVE_PATH).exists(),
        "sanity check: no identity file must exist before this run"
    );

    let output = run_install_with_no_from(&home_dir, &target_dir, &[]);

    assert!(
        !output.status.success(),
        "install with no --from must fail as a no-op"
    );
    assert_eq!(output.status.code(), Some(64));

    let script_path = home_dir.join(MATERIALIZED_SCRIPT_RELATIVE_PATH);
    assert!(
        script_path.exists(),
        "report_cli_error must fire under the nil-UUID sentinel and materialize the transport \
         script at {} even when no identity file exists at the target yet -- this is the \
         positive control for no_telemetry_suppresses_cli_error_report_with_no_preexisting_identity; \
         if this fails, that suppression test proves nothing",
        script_path.display()
    );
    assert!(
        !target_dir.join(IDENTITY_RELATIVE_PATH).exists(),
        "a no-op install failure must never create an identity file as a side effect of \
         reporting under the nil-UUID sentinel"
    );

    std::fs::remove_dir_all(&home_dir).ok();
    std::fs::remove_dir_all(&target_dir).ok();
}

// ── update's report_error call sites: no_telemetry must be threaded
// through, not hardcoded ────────────────────────────────────────────
//
// Before this fix, every `report_error` call site inside `update.rs`
// hardcoded `no_telemetry: false` regardless of the real `--no-telemetry`
// flag on the invocation -- unlike `install.rs`'s own 9 call sites,
// which already thread the real value through. This section exercises
// the "update.target_not_found" call site: `--target <dir>` naming a
// directory the install index has never tracked -- the cheapest
// deterministic way to make `dispatch_update_with` call
// `report_error`/`report_cli_error` exactly once, without needing a
// seeded manifest or a real strategy run.

/// Triggers `update`'s "update.target_not_found" error path. Mirrors
/// `run_install_with_no_from`'s own shape for the update command.
fn run_update_with_untracked_target(
    home_dir: &Path,
    target_dir: &Path,
    extra_args: &[&str],
) -> Output {
    let target_str = target_dir.display().to_string();
    let mut args: Vec<&str> = vec![CMD_UPDATE, "--target", &target_str];
    args.extend_from_slice(extra_args);
    run_konductor(home_dir, target_dir, &args)
}

/// The core regression test for this fix: with a pre-existing identity
/// already on disk (so `cached_identity` resolves to `Some(_)` and
/// would otherwise report), `--no-telemetry` must suppress the
/// "update.target_not_found" report -- exactly the way `install`'s own
/// suppression tests above already prove for `install`'s call sites.
#[test]
fn update_no_telemetry_suppresses_cli_error_report_on_target_not_found() {
    let home_dir = scratch_dir("update-no-telemetry-home");
    let target_dir = scratch_dir("update-no-telemetry-target");
    seed_preexisting_identity(&target_dir);

    let output = run_update_with_untracked_target(&home_dir, &target_dir, &["--no-telemetry"]);

    assert!(
        !output.status.success(),
        "update --target <untracked dir> must fail with a usage error, stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.status.code(), Some(64));

    let script_path = home_dir.join(MATERIALIZED_SCRIPT_RELATIVE_PATH);
    assert!(
        !script_path.exists(),
        "update --no-telemetry must suppress the update.target_not_found cli_error report -- \
         before this fix, update.rs's report_error call sites hardcoded no_telemetry: false \
         and reported regardless of this flag; found a materialized transport script at {}",
        script_path.display()
    );

    std::fs::remove_dir_all(&home_dir).ok();
    std::fs::remove_dir_all(&target_dir).ok();
}

/// Positive control for the test above: the SAME scenario, MINUS
/// `--no-telemetry`, must still report (and therefore materialize the
/// transport script) -- proving the absence of the script above is
/// caused by the opt-out actually taking effect on update's own call
/// sites, not by some unrelated reason telemetry never fires for
/// `update` in this environment at all.
#[test]
fn update_cli_error_report_fires_on_target_not_found_without_no_telemetry() {
    let home_dir = scratch_dir("update-with-telemetry-home");
    let target_dir = scratch_dir("update-with-telemetry-target");
    seed_preexisting_identity(&target_dir);

    let output = run_update_with_untracked_target(&home_dir, &target_dir, &[]);

    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(64));

    let script_path = home_dir.join(MATERIALIZED_SCRIPT_RELATIVE_PATH);
    assert!(
        script_path.exists(),
        "without --no-telemetry, update's report_cli_error must fire and materialize the \
         transport script at {} -- if this positive control fails, the negative test above \
         proves nothing",
        script_path.display()
    );

    std::fs::remove_dir_all(&home_dir).ok();
    std::fs::remove_dir_all(&target_dir).ok();
}

// ── `--all` batch attribution ──────────────
//
// `dispatch_update_all_json`'s per-target failure branch, and
// `update_one_target`'s failure arm when reached from the PLAIN `--all`
// loop, both used to resolve telemetry identity via the process-global
// `cached_identity` cache -- correct for a single target, but WRONG once
// more than one distinct `target_dir` is visited in the same process:
// every target after the first would report under whichever identity the
// cache resolved FIRST, not its own. The fix routes both call sites
// through `report_cli_error_for_target`/`report_error_for_target`
// (`read_identity_uncached`) instead.
//
// The exact per-target UUID is not observable from outside the process
// (telemetry is fire-and-forget over HTTPS to an unreachable-by-design
// placeholder host; nothing captures the wire body -- see this file's
// own module docstring on why script materialization, not network
// capture, is this test suite's established observability boundary).
// The correctness of `read_identity_uncached` bypassing a poisoned
// `IDENTITY_CACHE` is instead proven directly, at the unit level, by
// `report.rs`'s own
// `read_identity_uncached_returns_each_targets_own_identity_regardless_of_the_process_cache`.
// What THIS subprocess test proves, that the unit test cannot: with 2+
// distinct failing targets tracked in the SAME process's index, neither
// target's `cli_error` report is silently dropped by the batch loop --
// both appear in the single JSON document `update --all --json` emits.

/// Seeds `<repo_root>/dist/kiro-cli-v2/agents/<name>.json`, mirroring
/// real synth output layout -- same minimal fixture shape
/// `install_manifest_concurrency.rs`'s own `seed_synthed_repo` uses.
fn seed_synthed_repo_at(repo_root: &Path, name: &str) {
    let dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(format!("{name}.json")), b"{}\n").unwrap();
}

/// Forces `target_dir` into `update`'s "stale (no manifest found)"
/// failure by deleting its manifest after a real, successful install --
/// the cheapest way to make a target BOTH genuinely tracked in the
/// index (so `update --all` visits it) AND guaranteed to hit
/// `run_update_one_target`'s failure arm (`update.target_failed`)
/// without needing a real `--from` on the `update` invocation itself.
fn make_target_stale(target_dir: &Path) {
    let manifest_path = target_dir.join(".konductor").join("manifest");
    std::fs::remove_file(&manifest_path).unwrap_or_else(|err| {
        panic!(
            "expected a manifest at {} from a prior successful install: {err}",
            manifest_path.display()
        )
    });
}

/// The core regression test for this fix: two DISTINCT targets, each
/// with its own on-disk identity file carrying a DIFFERENT `UUID`, both
/// tracked in the same process's index and both failing as "stale" on
/// `update --all --json`. Before this fix, the second target's
/// `cli_error` telemetry report would have been attributed to the
/// FIRST target's cached identity; this test cannot observe the wire
/// UUID (see this section's own module comment), but it does prove the
/// necessary precondition for that misattribution to even matter: BOTH
/// targets' failures are individually reported in the batch output,
/// neither silently dropped or merged.
#[test]
fn update_all_json_batch_reports_every_distinct_failing_target_not_just_the_first() {
    let home_dir = scratch_dir("batch-attribution-home");
    let repo_root = scratch_dir("batch-attribution-repo");
    let target_a = scratch_dir("batch-attribution-target-a");
    let target_b = scratch_dir("batch-attribution-target-b");
    seed_synthed_repo_at(&repo_root, "k-example");

    let repo_str = repo_root.display().to_string();
    for target in [&target_a, &target_b] {
        let target_str = target.display().to_string();
        let output = run_konductor(
            &home_dir,
            target,
            &[
                CMD_INSTALL,
                "--from",
                &repo_str,
                "--target",
                &target_str,
                "--harness",
                "kiro-cli-v2",
            ],
        );
        assert!(
            output.status.success(),
            "setup: install must succeed for {}, stderr={}",
            target.display(),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    // Overwrite each target's REAL (randomly-generated) identity with a
    // deterministic, distinct UUID -- not needed for this test's own
    // assertions (which never read a UUID back), but keeps this test's
    // setup honest about the "each with its own on-disk identity file"
    // precondition the finding describes, and matches what a caller
    // reproducing this locally would want to inspect by hand.
    seed_preexisting_identity_with_uuid(&target_a, &"1".repeat(64));
    seed_preexisting_identity_with_uuid(&target_b, &"2".repeat(64));

    make_target_stale(&target_a);
    make_target_stale(&target_b);

    let output = run_konductor(&home_dir, &home_dir, &[CMD_UPDATE, "--all", "--json"]);

    assert_eq!(
        output.status.code(),
        Some(64),
        "both targets are stale, so the batch must exit EXIT_USAGE_ERROR; stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|err| {
        panic!("stdout must be exactly one JSON document: {err}\nstdout={stdout}")
    });

    let failed = parsed["failed"]
        .as_array()
        .expect("batch report must have a 'failed' array");
    assert_eq!(
        failed.len(),
        2,
        "both distinct stale targets must appear in 'failed' -- neither may be silently \
         dropped by the batch loop; got: {parsed}"
    );

    let canonical_a = std::fs::canonicalize(&target_a).unwrap();
    let canonical_b = std::fs::canonicalize(&target_b).unwrap();
    for canonical in [&canonical_a, &canonical_b] {
        let canonical_str = canonical.display().to_string();
        let matching = failed
            .iter()
            .find(|entry| entry["target_dir"] == canonical_str);
        assert!(
            matching.is_some(),
            "expected {canonical_str} in 'failed'; got: {parsed}"
        );
        assert!(
            matching.unwrap()["error"]
                .as_str()
                .unwrap_or_default()
                .contains("is stale"),
            "expected a stale-manifest error for {canonical_str}; got: {parsed}"
        );
    }

    std::fs::remove_dir_all(&home_dir).ok();
    std::fs::remove_dir_all(&repo_root).ok();
    std::fs::remove_dir_all(&target_a).ok();
    std::fs::remove_dir_all(&target_b).ok();
}

// ── Batch endpoint caching (superseded by the per-target fix below)
//    ─────────────────────────────────────
//
// Every `send_event` call used to re-resolve the telemetry
// endpoint+DNS-rebinding-pin from scratch (`resolve_endpoint_with_pin`,
// bounded by `DNS_RESOLUTION_TIMEOUT`) -- fine for a single-target
// invocation, but a `--all` batch loop visiting N targets in one
// process paid that bounded wait N times. An earlier revision of this
// fix cached the resolved `(endpoint, pin)` once per process
// (`ENDPOINT_CACHE`, mirroring `IDENTITY_CACHE`'s own once-per-process
// contract) to collapse that cost back to one resolution per batch.
//
// That caching was itself the CRITICAL regression `f-d87f3600` (below)
// describes: `resolve_endpoint_with_pin` resolves BOTH the endpoint AND
// each target's own per-repo `telemetry.enabled` opt-out from that
// target's OWN `.konductor/config.yml` -- caching the FIRST target's
// verdict and reusing it for every later target in the same batch
// silently ignored a later target's own opt-out. The fix below removes
// this cache from every `_for_target` batch call site entirely
// (`send_event_for_target`/`resolve_endpoint_with_pin_uncached`),
// re-paying the bounded DNS wait per target -- the same
// correctness-over-performance trade `read_identity_uncached` already
// makes for identity. See `update_all_json_batch_honors_each_targets_own_telemetry_opt_out`
// below for the regression test.

/// Same as `run_konductor`, but with `KONDUCTOR_LOG=debug` set so the
/// subprocess's stderr carries this crate's own trace stream --
/// needed only by the endpoint-caching regression below; every other
/// test in this file relies on `run_konductor`'s plain (trace-off)
/// behavior instead.
fn run_konductor_with_debug_log(home_dir: &Path, target_dir: &Path, args: &[&str]) -> Output {
    Command::new(bin())
        .args(args)
        .current_dir(target_dir)
        .env("HOME", home_dir)
        .env("KONDUCTOR_LOG", "debug")
        .output()
        .expect("failed to spawn konductor binary")
}

/// Disables telemetry for `target_dir` specifically, via that target's
/// OWN `.konductor/config.yml` -- the per-repo opt-out mechanism
/// `f-d87f3600` describes, distinct from the `--no-telemetry` CLI flag
/// every other test in this file exercises. Overwrites the whole file
/// (fine for this test: nothing else in this target's own config.yml is
/// under test).
fn disable_telemetry_via_config(target_dir: &Path) {
    let konductor_dir = target_dir.join(".konductor");
    std::fs::create_dir_all(&konductor_dir).unwrap();
    std::fs::write(
        konductor_dir.join("config.yml"),
        "telemetry:\n  enabled: false\n",
    )
    .unwrap();
}

/// The core regression test for the per-target endpoint/opt-out fix: two
/// distinct, genuinely tracked, genuinely stale targets in ONE
/// `update --all --json` batch -- target A with telemetry enabled
/// (default), target B with telemetry disabled via its OWN
/// `.konductor/config.yml`. Both take the failure arm that calls
/// `report_cli_error_for_target` -> `send_event_for_target`.
///
/// Before this fix, `send_event_for_target` (like every other sender in
/// this module) resolved the endpoint via the process-global
/// `ENDPOINT_CACHE`, populated once from whichever target's resolution
/// ran FIRST -- so whichever target the batch visited second would
/// silently inherit the FIRST target's resolved endpoint and
/// `telemetry.enabled` verdict, regardless of its own config. Depending
/// on which target the batch happened to visit first, that either sent
/// telemetry for the disabled target (a privacy/opt-out violation) or
/// silently dropped telemetry for the enabled one (a false negative) --
/// this test proves the correct outcome now holds independent of visit
/// order:
///
/// 1. The "disabled for this target" trace fires -- proving target B's
///    OWN `resolve_endpoint_with_pin` call actually ran and read ITS OWN
///    config, rather than the call being skipped because a
///    process-global cache already held a value from a different
///    target's resolution.
/// 2. The "endpoint resolved and cached" trace (`cached_endpoint_with_pin`'s
///    own, from the single-target/non-batch call sites) never fires --
///    proving no `_for_target` sender in this batch touches that cache
///    at all anymore.
/// 3. The transport script still materializes -- proving target A's
///    enabled event was genuinely sent, not collaterally suppressed by
///    target B's disablement.
#[test]
fn update_all_json_batch_honors_each_targets_own_telemetry_opt_out() {
    let home_dir = scratch_dir("endpoint-opt-out-home");
    let repo_root = scratch_dir("endpoint-opt-out-repo");
    let target_a = scratch_dir("endpoint-opt-out-target-a");
    let target_b = scratch_dir("endpoint-opt-out-target-b");
    seed_synthed_repo_at(&repo_root, "k-example");

    let repo_str = repo_root.display().to_string();
    for target in [&target_a, &target_b] {
        let target_str = target.display().to_string();
        let output = run_konductor(
            &home_dir,
            target,
            &[
                CMD_INSTALL,
                "--from",
                &repo_str,
                "--target",
                &target_str,
                "--harness",
                "kiro-cli-v2",
            ],
        );
        assert!(
            output.status.success(),
            "setup: install must succeed for {}, stderr={}",
            target.display(),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    // Target A keeps the default (telemetry enabled); target B opts out
    // via its own config -- the exact per-target divergence f-d87f3600
    // describes as silently ignored by the pre-fix cache.
    disable_telemetry_via_config(&target_b);

    make_target_stale(&target_a);
    make_target_stale(&target_b);

    let output =
        run_konductor_with_debug_log(&home_dir, &home_dir, &[CMD_UPDATE, "--all", "--json"]);

    assert_eq!(
        output.status.code(),
        Some(64),
        "both targets are stale, so the batch must exit EXIT_USAGE_ERROR; stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let stderr = String::from_utf8_lossy(&output.stderr);

    let disabled_trace_lines = stderr
        .lines()
        .filter(|line| {
            line.contains("telemetry: disabled for this target via .konductor/config.yml")
        })
        .count();
    assert_eq!(
        disabled_trace_lines, 1,
        "target B's own per-repo opt-out must be independently detected exactly once -- got \
         {disabled_trace_lines}; stderr={stderr}"
    );

    let cached_resolution_trace_lines = stderr
        .lines()
        .filter(|line| line.contains("telemetry: endpoint resolved and cached"))
        .count();
    assert_eq!(
        cached_resolution_trace_lines, 0,
        "no `_for_target` batch sender may resolve the endpoint through the process-global \
         cache anymore -- got {cached_resolution_trace_lines} cached resolutions; \
         stderr={stderr}"
    );

    let script_path = home_dir.join(MATERIALIZED_SCRIPT_RELATIVE_PATH);
    assert!(
        script_path.exists(),
        "target A's telemetry-enabled cli_error event must still be genuinely sent, \
         materializing the transport script at {} -- target B's opt-out must not \
         collaterally suppress it",
        script_path.display()
    );

    std::fs::remove_dir_all(&home_dir).ok();
    std::fs::remove_dir_all(&repo_root).ok();
    std::fs::remove_dir_all(&target_a).ok();
    std::fs::remove_dir_all(&target_b).ok();
}
