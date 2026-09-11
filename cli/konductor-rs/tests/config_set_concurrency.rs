// SPDX-License-Identifier: Apache-2.0
//
// config_set_concurrency.rs — integration tests driving the `config set`
// lost-update fix through REAL OS PROCESSES invoking the actual compiled
// `konductor` binary, rather than exercising `config_lock::acquire` (or
// `config::set_config_value`) in-process.
//
// `src/cli/config_lock.rs`'s own `#[cfg(test)] mod tests` already proves
// the lock primitive itself serializes concurrent *threads* correctly.
// That is necessary but not sufficient evidence for the reported bug,
// which was reproduced across independent CLI *processes* sharing a
// filesystem path -- a thread-only test cannot fully rule out a race that
// only manifests across separate process address spaces / file
// descriptor tables. These tests close that gap by shelling out to
// `env!("CARGO_BIN_EXE_konductor")` (Cargo's standard mechanism for
// integration tests to locate their crate's own compiled binary) exactly
// as a real user would invoke the CLI.

use std::path::Path;
use std::process::{Command, Output};

// This integration test invokes the compiled `konductor` binary as a
// subprocess (see `bin()`/`run_konductor` below) rather than linking
// against the crate's internals -- the crate defines only a `[[bin]]`
// target (see Cargo.toml), no `[lib]`, so `config::KONDUCTOR_DIR_NAME` /
// `config::CONFIG_FILE_NAME` / `Commands`/`ConfigAction`'s `as_str()`
// constants are not reachable from here at compile time. These constants
// are duplicated for that reason (mirrors dispatch.rs's own
// `EXIT_USAGE_ERROR`, which duplicates cli.rs's private constant for the
// same kind of visibility-boundary reason) and must stay equal to
// src/cli/config.rs's `KONDUCTOR_DIR_NAME`/`CONFIG_FILE_NAME` values.
const KONDUCTOR_DIR_NAME: &str = ".konductor";
const CONFIG_FILE_NAME: &str = "config.yml";

// Subcommand/action names this test's argv construction needs, mirroring
// `Commands`/`ConfigAction`'s `as_str()` constants in src/cli.rs for the
// same reason `KONDUCTOR_DIR_NAME`/`CONFIG_FILE_NAME` above are
// duplicated rather than imported.
const CMD_INIT: &str = "init";
const CMD_CONFIG: &str = "config";
const ACTION_GET: &str = "get";
const ACTION_SET: &str = "set";

// Severity values this test exercises, mirroring `Severity`'s `Display`
// output in src/cli/config.rs for the same reason noted above.
const SEVERITY_LOW: &str = "LOW";
const SEVERITY_MEDIUM: &str = "MEDIUM";
const SEVERITY_HIGH: &str = "HIGH";

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn run_konductor(cwd: &Path, args: &[&str]) -> Output {
    // `HOME` is overridden to `cwd` (an isolated temp dir): unrelated to
    // this file's own `config set` assertions, but `log_invocation`
    // (logging.rs) independently resolves `$HOME` for
    // `~/.konductor/logs/` on EVERY invocation -- without this, a real
    // subprocess run here would still write an invocation log line into
    // this test-runner's actual home directory.
    Command::new(bin())
        .args(args)
        .current_dir(cwd)
        .env("HOME", cwd)
        .output()
        .expect("failed to spawn konductor binary")
}

fn scratch_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-config-set-concurrency-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Reproduces the review's exact reported shape end-to-end: many
/// concurrent REAL PROCESSES running `config set` against two different
/// keys on a shared project. Before the fix this reproduced as ~58/60
/// processes silently losing their update while all still exiting 0.
/// After the fix, every process must exit 0 AND the final config.yml
/// must hold a valid value for BOTH keys (not merely "some" value,
/// since a lost update could coincidentally still look plausible).
#[test]
fn concurrent_config_set_multiprocess_no_lost_updates() {
    let dir = scratch_dir("no-lost-updates");
    let init_output = run_konductor(&dir, &[CMD_INIT]);
    assert!(
        init_output.status.success(),
        "init must succeed: {}",
        String::from_utf8_lossy(&init_output.stderr)
    );

    // Mirrors the review's reported 60-process / 2-key reproduction: 15
    // writers per key (kept smaller than 60 to keep CI time reasonable
    // while still exercising real contention), alternating value so the
    // last writer to land determines the final value, but every process
    // must exit 0 and the two keys must never cross-contaminate.
    let jobs: Vec<(&str, &str)> = (0..15)
        .map(|i| {
            (
                "default_severity",
                if i % 2 == 0 {
                    SEVERITY_LOW
                } else {
                    SEVERITY_HIGH
                },
            )
        })
        .chain((0..15).map(|i| {
            (
                "fail_on_severity_at_or_above",
                if i % 2 == 0 {
                    SEVERITY_LOW
                } else {
                    SEVERITY_MEDIUM
                },
            )
        }))
        .collect();

    let handles: Vec<_> = jobs
        .into_iter()
        .map(|(key, value)| {
            let dir = dir.clone();
            std::thread::spawn(move || run_konductor(&dir, &[CMD_CONFIG, ACTION_SET, key, value]))
        })
        .collect();

    let outputs: Vec<Output> = handles.into_iter().map(|h| h.join().unwrap()).collect();

    let failures: Vec<String> = outputs
        .iter()
        .filter(|o| !o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stderr).to_string())
        .collect();
    assert!(
        failures.is_empty(),
        "every config set process must exit 0; failures: {failures:?}"
    );

    let config_path = dir.join(KONDUCTOR_DIR_NAME).join(CONFIG_FILE_NAME);
    let raw = std::fs::read_to_string(&config_path).expect("config.yml must exist");
    let parsed: serde_yaml::Value = serde_yaml::from_str(&raw)
        .expect("config.yml must remain valid YAML after concurrent writes");

    let severity = parsed
        .get("default_severity")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert!(
        severity == SEVERITY_LOW || severity == SEVERITY_HIGH,
        "default_severity must hold a value from one of the concurrent writers, got {severity:?}"
    );

    let threshold = parsed
        .get("fail_on_severity_at_or_above")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert!(
        threshold == SEVERITY_LOW || threshold == SEVERITY_MEDIUM,
        "fail_on_severity_at_or_above must hold a value from one of the concurrent writers, got {threshold:?}"
    );

    // Confirm the two keys' writers never clobbered each other's field --
    // a lock that serializes but merges incorrectly could still exhibit
    // this as a silent-loss variant.
    let get_severity = run_konductor(&dir, &[CMD_CONFIG, ACTION_GET, "default_severity"]);
    let get_threshold = run_konductor(
        &dir,
        &[CMD_CONFIG, ACTION_GET, "fail_on_severity_at_or_above"],
    );
    assert!(get_severity.status.success());
    assert!(get_threshold.status.success());
    let severity_out = String::from_utf8_lossy(&get_severity.stdout)
        .trim()
        .to_string();
    let threshold_out = String::from_utf8_lossy(&get_threshold.stdout)
        .trim()
        .to_string();
    assert!(severity_out == SEVERITY_LOW || severity_out == SEVERITY_HIGH);
    assert!(threshold_out == SEVERITY_LOW || threshold_out == SEVERITY_MEDIUM);

    std::fs::remove_dir_all(&dir).ok();
}

/// Simulates real contention by holding the config lock file open (via a
/// raw `flock`, mirroring what `config_lock::acquire` itself does) in
/// THIS test process while a REAL subprocess attempts `config set`. The
/// subprocess must give up within its bounded wait and exit
/// EXIT_USAGE_ERROR (64) with a clear message -- never hang, and never
/// exit 2 (reserved for the unresolved-CRITICAL-gate signal).
#[test]
fn config_set_exits_usage_error_when_lock_is_held_by_another_process() {
    use fs2::FileExt;

    let dir = scratch_dir("lock-contention");
    let init_output = run_konductor(&dir, &[CMD_INIT]);
    assert!(init_output.status.success());

    let konductor_dir = dir.join(KONDUCTOR_DIR_NAME);
    let lock_path = konductor_dir.join(".config.lock");
    let lock_file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .expect("must be able to open the lock file");
    lock_file
        .lock_exclusive()
        .expect("must be able to hold the lock from this test process");

    let result = run_konductor(
        &dir,
        &[CMD_CONFIG, ACTION_SET, "default_severity", SEVERITY_LOW],
    );

    // Release explicitly (also happens automatically on drop, but explicit
    // here so intent is unambiguous before asserting on the subprocess).
    fs2::FileExt::unlock(&lock_file).ok();

    let exit_code = result
        .status
        .code()
        .expect("process must exit with a code, not a signal");
    assert_eq!(
        exit_code,
        64,
        "lock-contention must map to EXIT_USAGE_ERROR (64); stderr: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_ne!(
        exit_code, 2,
        "lock-contention must never exit code 2 (reserved for the unresolved-CRITICAL-gate signal)"
    );
    let stderr = String::from_utf8_lossy(&result.stderr).to_lowercase();
    assert!(
        stderr.contains("lock"),
        "stderr must mention the lock: {stderr}"
    );

    // Confirm the contended write never landed.
    let config_path = konductor_dir.join(CONFIG_FILE_NAME);
    let raw_after = std::fs::read_to_string(&config_path).unwrap();
    let parsed_after: serde_yaml::Value = serde_yaml::from_str(&raw_after).unwrap();
    assert_eq!(
        parsed_after
            .get("default_severity")
            .and_then(|v| v.as_str()),
        Some(SEVERITY_MEDIUM),
        "a config set that failed on lock contention must not have modified config.yml at all"
    );

    std::fs::remove_dir_all(&dir).ok();
}
