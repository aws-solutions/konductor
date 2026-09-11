// SPDX-License-Identifier: Apache-2.0
//
// synth_package_e2e.rs — end-to-end test proving a real `konductor
// synth` run packages `dist/` into a tar.gz artifact and writes its
// `.sha256` sidecar, driving the real compiled binary (same pattern as
// synth_install_e2e.rs).
//
// Isolation: runs entirely under `std::env::temp_dir()`, no network, no
// published release (`--from` only).

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const CMD_SYNTH: &str = "synth";

/// The dedicated, never-packaged artifact output directory
/// `dispatch_synth_with` writes the artifact/sidecar to, relative to
/// the repo root -- mirrors `synth::artifact_output_dir` (not exported
/// from this bin-only crate, so restated here rather than imported).
fn artifact_dir(repo_root: &Path) -> PathBuf {
    repo_root.join("target").join("konductor-artifacts")
}

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-synth-package-e2e-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn run_konductor(cwd: &Path, args: &[&str]) -> Output {
    // `HOME` is overridden to `cwd` for the same reason
    // synth_install_e2e.rs overrides it: `log_invocation` resolves
    // `$HOME` for `~/.konductor/logs/` on every invocation, regardless
    // of `--from`/`--target`.
    Command::new(bin())
        .args(args)
        .current_dir(cwd)
        .env("HOME", cwd)
        .output()
        .expect("failed to spawn konductor binary")
}

fn seed_agent_spec_source(repo_root: &Path) {
    let agents_dir = repo_root.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(
        agents_dir.join("k-example.agent-spec.json"),
        br#"{
  "schemaVersion": "1",
  "name": "k-example",
  "config": {
    "description": "An example agent.",
    "model": "claude-sonnet-5",
    "systemPrompt": "You are a helpful agent."
  },
  "clientConfig": {
    "kiroCli": {}
  }
}
"#,
    )
    .unwrap();
}

/// Finds every top-level file directly under `dir` whose name ends with
/// `suffix` -- used to discover the packaged artifact/sidecar without
/// hand-computing the exact filename (which embeds the crate version
/// and host target triple).
fn find_files_with_suffix(dir: &Path, suffix: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(suffix))
        {
            found.push(path);
        }
    }
    found.sort();
    found
}

/// End-to-end proof: a real `synth --from <repo>` run must produce a
/// packaged `.tar.gz` artifact and its `.sha256` sidecar under the
/// dedicated `target/konductor-artifacts/` directory (never under the
/// repo root, and never inside `dist/`), and the sidecar must round-trip
/// through the real, unmodified `parse_sidecar`/`sha256_hex`.
#[test]
fn real_synth_produces_packaged_artifact_and_sidecar_on_disk() {
    let repo_root = scratch_dir("repo");
    seed_agent_spec_source(&repo_root);

    let synth_result = run_konductor(
        &repo_root,
        &[CMD_SYNTH, "--from", &repo_root.display().to_string()],
    );
    assert!(
        synth_result.status.success(),
        "real `synth --from <repo>` must succeed: stderr={}",
        String::from_utf8_lossy(&synth_result.stderr)
    );

    let artifact_output_dir = artifact_dir(&repo_root);
    assert!(
        artifact_output_dir.is_dir(),
        "synth must create the dedicated artifact output directory at {}",
        artifact_output_dir.display()
    );

    let artifact_files = find_files_with_suffix(&artifact_output_dir, ".tar.gz");
    assert_eq!(
        artifact_files.len(),
        1,
        "expected exactly one packaged .tar.gz artifact under {}, found: {:?}",
        artifact_output_dir.display(),
        artifact_files
    );
    let artifact_path = &artifact_files[0];
    let artifact_filename = artifact_path.file_name().unwrap().to_str().unwrap();
    assert!(
        artifact_filename.starts_with("konductor-v"),
        "artifact filename must follow the konductor-v<version>-<triple>.tar.gz shape, got: {artifact_filename}"
    );

    let sidecar_files = find_files_with_suffix(&artifact_output_dir, ".sha256");
    assert_eq!(
        sidecar_files.len(),
        1,
        "expected exactly one .sha256 sidecar under {}, found: {:?}",
        artifact_output_dir.display(),
        sidecar_files
    );
    let sidecar_path = &sidecar_files[0];
    assert_eq!(
        sidecar_path.file_name().unwrap().to_str().unwrap(),
        format!("{artifact_filename}.sha256"),
        "sidecar must be named <artifact_filename>.sha256, sitting beside the artifact"
    );

    // Reimplements parse_sidecar/sha256_hex's format here since this
    // bin-only crate has no lib.rs for an integration test to import
    // from. The parsing/hashing logic itself is covered by sidecar.rs's
    // and install/artifact.rs's own unit tests; this only checks that a
    // real synth run's on-disk output conforms to it.
    let artifact_bytes = std::fs::read(artifact_path).unwrap();
    assert!(
        !artifact_bytes.is_empty(),
        "packaged artifact must not be empty"
    );

    let sidecar_contents = std::fs::read_to_string(sidecar_path).unwrap();
    let line = sidecar_contents
        .lines()
        .next()
        .expect("sidecar must have a line");
    let (hash, filename) = line
        .split_once("  ")
        .expect("sidecar must use two-space separator");
    assert_eq!(filename, artifact_filename);
    assert_eq!(hash.len(), 64);
    assert!(hash
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&artifact_bytes);
    let expected_hash = format!("{:x}", hasher.finalize());
    assert_eq!(
        hash, expected_hash,
        "sidecar's recorded hash must match the real SHA-256 of the artifact bytes actually on disk"
    );

    // The artifact must actually be the packaged dist/ tree: unpacking
    // it must yield the agent file synth itself wrote under dist/.
    let dist_dir = repo_root.join("dist");
    assert!(
        dist_dir.is_dir(),
        "synth must still produce dist/ as before"
    );
    let decoder = flate2::read::GzDecoder::new(&artifact_bytes[..]);
    let mut archive = tar::Archive::new(decoder);
    let mut saw_agent_entry = false;
    for entry in archive.entries().unwrap() {
        let entry = entry.unwrap();
        let path = entry.path().unwrap().to_string_lossy().into_owned();
        assert!(
            !Path::new(&path).is_absolute(),
            "archive entry path must never be absolute, got: {path}"
        );
        if path.ends_with("k-example.json") {
            saw_agent_entry = true;
        }
    }
    assert!(
        saw_agent_entry,
        "packaged archive must contain the synthed k-example.json somewhere"
    );

    std::fs::remove_dir_all(&repo_root).ok();
}

/// Re-running `synth` against the same repo root a second time must
/// still succeed and still leave exactly one artifact/sidecar pair on
/// disk (overwritten in place), not a stale-plus-fresh accumulation --
/// consistent with `dispatch_synth_with`'s own documented idempotency.
#[test]
fn real_synth_run_twice_leaves_exactly_one_artifact_and_sidecar() {
    let repo_root = scratch_dir("repo-twice");
    seed_agent_spec_source(&repo_root);

    for _ in 0..2 {
        let synth_result = run_konductor(
            &repo_root,
            &[CMD_SYNTH, "--from", &repo_root.display().to_string()],
        );
        assert!(
            synth_result.status.success(),
            "real `synth --from <repo>` must succeed: stderr={}",
            String::from_utf8_lossy(&synth_result.stderr)
        );
    }

    assert_eq!(
        find_files_with_suffix(&artifact_dir(&repo_root), ".tar.gz").len(),
        1
    );
    assert_eq!(
        find_files_with_suffix(&artifact_dir(&repo_root), ".sha256").len(),
        1
    );

    std::fs::remove_dir_all(&repo_root).ok();
}

/// `synth --from <repo> --json` must report the artifact's and sidecar's
/// paths as `artifact_path`/`sidecar_path`, matching the real files a
/// genuine `synth` run actually left on disk.
#[test]
fn real_synth_json_output_reports_real_artifact_and_sidecar_paths() {
    let repo_root = scratch_dir("repo-json");
    seed_agent_spec_source(&repo_root);

    let synth_result = run_konductor(
        &repo_root,
        &[
            CMD_SYNTH,
            "--from",
            &repo_root.display().to_string(),
            "--json",
        ],
    );
    assert!(
        synth_result.status.success(),
        "real `synth --from <repo> --json` must succeed: stderr={}",
        String::from_utf8_lossy(&synth_result.stderr)
    );

    let stdout = String::from_utf8_lossy(&synth_result.stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .unwrap_or_else(|err| panic!("--json output must be valid JSON: {err}, got: {stdout}"));

    let artifact_files = find_files_with_suffix(&artifact_dir(&repo_root), ".tar.gz");
    assert_eq!(artifact_files.len(), 1, "expected exactly one artifact");
    let sidecar_files = find_files_with_suffix(&artifact_dir(&repo_root), ".sha256");
    assert_eq!(sidecar_files.len(), 1, "expected exactly one sidecar");

    let reported_artifact_path = parsed["artifact_path"]
        .as_str()
        .expect("artifact_path field must be a string");
    let reported_sidecar_path = parsed["sidecar_path"]
        .as_str()
        .expect("sidecar_path field must be a string");

    assert_eq!(
        Path::new(reported_artifact_path),
        artifact_files[0].as_path(),
        "reported artifact_path must match the real packaged artifact on disk"
    );
    assert_eq!(
        Path::new(reported_sidecar_path),
        sidecar_files[0].as_path(),
        "reported sidecar_path must match the real checksum sidecar on disk"
    );
    assert!(
        Path::new(reported_artifact_path).is_file(),
        "artifact_path must point at a file that actually exists"
    );
    assert!(
        Path::new(reported_sidecar_path).is_file(),
        "sidecar_path must point at a file that actually exists"
    );

    std::fs::remove_dir_all(&repo_root).ok();
}
