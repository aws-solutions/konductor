// SPDX-License-Identifier: Apache-2.0
//
// instance_identity_two_target_concurrency.rs — two concurrent installs
// against different target directories, both racing on the same
// telemetry.json, must converge on one instance UUID.
//
// Driven through real OS processes invoking the compiled `konductor`
// binary: the `<file>.tmp-<pid>` write path is process-safe but not
// thread-safe, so this race needs separate processes.
//
// Every invocation pins `HOME` to a shared, isolated scratch directory
// and passes `--target <isolated_dir>` explicitly.

use std::path::Path;
use std::process::{Command, Output};

// Duplicated for the same visibility-boundary reason
// install_manifest_concurrency.rs documents: this crate defines only a
// [[bin]] target, so config::KONDUCTOR_DIR_NAME and the identity/
// instance modules' own private constants aren't reachable here.
const KONDUCTOR_DIR_NAME: &str = ".konductor";
const TELEMETRY_FILE_NAME: &str = "telemetry.json";
const CMD_INSTALL: &str = "install";

const ITERATIONS: usize = 25;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

/// Runs `konductor` with `HOME` pinned to `home_dir`, telemetry
/// redirected to `sink` rather than disabled outright.
fn run_konductor(
    home_dir: &Path,
    sink: &telemetry_test_sink::TelemetrySink,
    args: &[&str],
) -> Output {
    let mut command = Command::new(bin());
    command
        .args(args)
        .current_dir(home_dir)
        .env("HOME", home_dir);
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    command.output().expect("failed to spawn konductor binary")
}

fn scratch_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-instance-two-target-race-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Seeds `<repo_root>/dist/<harness>/agents/<name>.json`, mirroring
/// real `synth` output layout. Parameterized on `harness` so the two
/// racing installs use distinct, coexisting harnesses -- this test's
/// race is on `telemetry.json`, not the manifest lock.
fn seed_synthed_repo(name: &str, harness: &str) -> std::path::PathBuf {
    let repo_root = scratch_dir(&format!("repo-{name}"));
    let dir = repo_root.join("dist").join(harness).join("agents");
    std::fs::create_dir_all(&dir).unwrap();
    if harness == "claude" {
        std::fs::write(dir.join("k-example.md"), b"# k-example\n").unwrap();
    } else {
        std::fs::write(dir.join("k-example.json"), b"{}\n").unwrap();
    }
    repo_root
}

fn read_instance_bytes(home_dir: &Path) -> Vec<u8> {
    let path = home_dir.join(KONDUCTOR_DIR_NAME).join(TELEMETRY_FILE_NAME);
    std::fs::read(&path).unwrap_or_else(|err| panic!("telemetry.json missing at {path:?}: {err}"))
}

/// Runs `ITERATIONS` rounds, each racing two concurrent `konductor
/// install` processes against distinct target directories sharing one
/// `HOME`. Asserts convergence: exactly one `telemetry.json`, and both
/// targets' installs succeed against the same shared instance record
/// with no torn or interleaved write.
#[test]
fn two_concurrent_installs_different_targets_converge_on_one_instance_uuid() {
    // One sink shared across every round, Arc-wrapped for the two
    // concurrent installer threads below.
    let sink = std::sync::Arc::new(telemetry_test_sink::TelemetrySink::start());
    for i in 0..ITERATIONS {
        let home = scratch_dir(&format!("home-{i}"));
        let target_a = home.join("project-a");
        let target_b = home.join("project-b");
        std::fs::create_dir_all(&target_a).unwrap();
        std::fs::create_dir_all(&target_b).unwrap();

        let repo_a = seed_synthed_repo(&format!("a-{i}"), "kiro-cli-v2");
        let repo_b = seed_synthed_repo(&format!("b-{i}"), "claude");
        let repo_a_local = repo_a.display().to_string();
        let repo_b_local = repo_b.display().to_string();
        let target_a_str = target_a.display().to_string();
        let target_b_str = target_b.display().to_string();

        let home_a = home.clone();
        let home_b = home.clone();
        let sink_a = sink.clone();
        let sink_b = sink.clone();
        let handle_a = std::thread::spawn(move || {
            run_konductor(
                &home_a,
                &sink_a,
                &[
                    CMD_INSTALL,
                    "--from",
                    &repo_a_local,
                    "--target",
                    &target_a_str,
                    "--harness",
                    "kiro-cli-v2",
                ],
            )
        });
        let handle_b = std::thread::spawn(move || {
            run_konductor(
                &home_b,
                &sink_b,
                &[
                    CMD_INSTALL,
                    "--from",
                    &repo_b_local,
                    "--target",
                    &target_b_str,
                    "--harness",
                    "claude",
                ],
            )
        });

        let output_a = handle_a.join().expect("installer A process must not panic");
        let output_b = handle_b.join().expect("installer B process must not panic");

        assert!(
            output_a.status.success(),
            "round {i}: installer A (target-a) must exit 0: {}",
            String::from_utf8_lossy(&output_a.stderr)
        );
        assert!(
            output_b.status.success(),
            "round {i}: installer B (target-b) must exit 0: {}",
            String::from_utf8_lossy(&output_b.stderr)
        );

        // Part 1: convergence on one shared instance UUID.
        let instance_raw = read_instance_bytes(&home);
        let instance_json: serde_json::Value = serde_json::from_slice(&instance_raw)
            .unwrap_or_else(|err| {
                panic!(
                    "round {i}: telemetry.json is not valid JSON (torn/interleaved write): {err}"
                )
            });
        let instance_uuid = instance_json["UUID"]
            .as_str()
            .unwrap_or_else(|| panic!("round {i}: telemetry.json must carry a string UUID"))
            .to_string();
        assert_eq!(
            instance_uuid.len(),
            64,
            "round {i}: instance UUID must be a 64-char hex digest, got {instance_uuid:?}"
        );
        assert!(
            instance_json["telemetry_consent"].is_boolean(),
            "round {i}: telemetry.json must carry a boolean telemetry_consent"
        );

        // No leftover temp files anywhere touched by this round.
        for dir in [
            home.join(KONDUCTOR_DIR_NAME),
            target_a.join(KONDUCTOR_DIR_NAME),
            target_b.join(KONDUCTOR_DIR_NAME),
        ] {
            let leftovers: Vec<_> = std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
                .collect();
            assert!(
                leftovers.is_empty(),
                "round {i}: leftover temp file(s) in {dir:?}: {:?}",
                leftovers.iter().map(|e| e.file_name()).collect::<Vec<_>>()
            );
        }

        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_dir_all(&repo_a).ok();
        std::fs::remove_dir_all(&repo_b).ok();
    }
}
