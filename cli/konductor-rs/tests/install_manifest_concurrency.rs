// SPDX-License-Identifier: Apache-2.0
//
// install_manifest_concurrency.rs — integration test proving
// `.konductor/manifest` writes are crash-safe under concurrent writers,
// driven through REAL OS PROCESSES invoking the actual compiled
// `konductor` binary (mirrors config_set_concurrency.rs's own rationale
// for testing across process boundaries, not merely threads in-process;
// see that file's module docstring for why this crate's `[[bin]]`-only
// shape, with no `[lib]` target, makes subprocess invocation the only
// way to exercise the real dispatch path from an integration test).
//
// Two concurrent `konductor install` processes race to write the same
// manifest path repeatedly. Both install the SAME (only registered)
// strategy, so their outputs differ by at most the live `installed_at`
// timestamp and each file's `provenance` (see
// `normalize_race_dependent_fields`'s own docstring for why provenance
// is legitimately race-dependent, not evidence of a torn write) --
// loose shape assertions (schema_version==1, strategy=="kiro-cli",
// files is an array) would still pass against a plausible
// torn/interleaved write of two such near-identical documents. To
// actually rule that out, each round first captures a REAL solo-writer
// reference output (a single `install` run against an equivalent fresh
// directory, immediately before the race) and asserts the raced
// result -- with the live timestamp and per-file provenance fields
// normalized out -- is byte-identical to that reference: i.e. wholly
// one coherent write, not a mix of two.
//
// Every invocation below passes `--target <isolated_dir>` explicitly:
// `install`'s default destination is now `$HOME` (see install.rs's
// `resolve_destination`), and this test must never write into the real
// `$HOME` of whatever machine runs it.

use std::path::Path;
use std::process::{Command, Output};

// Duplicated for the same visibility-boundary reason
// config_set_concurrency.rs documents for its own constants: the crate
// defines only a `[[bin]]` target, so `config::KONDUCTOR_DIR_NAME` is
// not reachable from an integration test at compile time.
const KONDUCTOR_DIR_NAME: &str = ".konductor";
const MANIFEST_FILE_NAME: &str = "manifest";
const CMD_INSTALL: &str = "install";

const ITERATIONS: usize = 50;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn run_konductor(cwd: &Path, args: &[&str]) -> Output {
    // `HOME` is overridden to `cwd` (an isolated temp dir) for every
    // invocation here: `install`'s default destination is now `$HOME`
    // (this test always passes `--target` explicitly, so that alone
    // isn't the concern), but `log_invocation` (logging.rs) independently
    // resolves `$HOME` for `~/.konductor/logs/` on EVERY invocation,
    // regardless of `--target` -- without this override, a real
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
        "konductor-install-manifest-concurrency-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Seeds `<repo_root>/dist/kiro-cli-v2/agents/<name>.json`, mirroring
/// real synth output layout -- `install --from <repo_root>` needs a
/// real source to copy from.
fn seed_synthed_repo(name: &str) -> std::path::PathBuf {
    let repo_root = scratch_dir(&format!("repo-{name}"));
    let dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("k-example.json"), b"{}\n").unwrap();
    repo_root
}

fn read_manifest_bytes(dir: &Path) -> Vec<u8> {
    let path = dir.join(KONDUCTOR_DIR_NAME).join(MANIFEST_FILE_NAME);
    std::fs::read(&path).unwrap_or_else(|err| panic!("manifest missing at {path:?}: {err}"))
}

/// Zeroes out the live-clock `installed_at` value, each file entry's
/// `provenance`, and the recorded `source` path, so two otherwise
/// content-identical manifests (each from a fresh, real `install` run)
/// can be compared for structural/content equality without a
/// legitimately race-dependent OR round-specific field causing a false
/// mismatch.
///
/// `source` is normalized for the same reason `installed_at` is:
/// `install_from_local` records the CANONICALIZED `--from <repo-root>`
/// path it was given (see kiro_cli.rs's `install_from_local`), and this
/// test deliberately seeds a DIFFERENT, freshly-named repo directory
/// for the solo reference run than for the raced round (`reference-{i}`
/// vs `round-{i}` -- see `seed_synthed_repo` call sites below), so the
/// two runs' `source` values differing is expected and per-round, not
/// evidence of a torn/interleaved write.
///
/// `provenance` became genuinely race-dependent once write-ahead
/// provenance classification landed: two processes racing an install
/// into the SAME initially-empty target can observe each other's
/// in-flight state at `classify_provenance` time (e.g. one sees the
/// destination still absent -> `created`; the other, running a beat
/// later, sees the first process's file already on disk plus its
/// already-written manifest naming that exact path -> `replaced_ours`)
/// -- correct, timing-dependent output from BOTH processes, not a
/// torn/interleaved write. The solo reference run below never has a
/// second writer to race against, so it always observes an empty
/// destination and always classifies `created`; comparing raw
/// `provenance` values against the raced result would therefore fail
/// on a legitimate, non-corrupt outcome. `sha256` and every other field
/// stay directly comparable -- a torn/interleaved write would still be
/// caught by a hash or structural mismatch.
fn normalize_race_dependent_fields(json: &serde_json::Value) -> serde_json::Value {
    let mut normalized = json.clone();
    if let Some(obj) = normalized.as_object_mut() {
        obj.insert(
            "installed_at".to_string(),
            serde_json::Value::String("<normalized>".to_string()),
        );
        obj.insert(
            "source".to_string(),
            serde_json::Value::String("<normalized>".to_string()),
        );
        if let Some(files) = obj.get_mut("files").and_then(|f| f.as_array_mut()) {
            for file in files {
                if let Some(file_obj) = file.as_object_mut() {
                    file_obj.insert(
                        "provenance".to_string(),
                        serde_json::Value::String("<normalized>".to_string()),
                    );
                }
            }
        }
    }
    normalized
}

/// Runs `ITERATIONS` independent rounds. Each round:
/// 1. Runs a solo `install` in a fresh reference directory, capturing
///    its manifest as ground truth for "what one coherent, complete
///    write looks like" this round.
/// 2. Races two concurrent `install` processes against a second, fresh
///    target directory.
/// 3. Asserts the raced result -- timestamp-normalized -- is BYTE-
///    IDENTICAL to the timestamp-normalized reference. A torn or
///    interleaved write mixing both processes' output would only
///    coincidentally match a real solo write's exact bytes; a
///    consistently-passing result across 50 rounds is strong evidence
///    the write is genuinely atomic, not merely well-shaped.
#[test]
fn concurrent_install_writes_never_produce_a_corrupt_manifest() {
    for i in 0..ITERATIONS {
        let reference_repo = seed_synthed_repo(&format!("reference-{i}"));
        let reference_local = reference_repo.display().to_string();
        let reference_dir = scratch_dir(&format!("reference-{i}"));
        let reference_target = reference_dir.display().to_string();
        let reference_output = run_konductor(
            &reference_dir,
            &[
                CMD_INSTALL,
                "--from",
                &reference_local,
                "--target",
                &reference_target,
                "--harness",
                "kiro-cli-v2",
            ],
        );
        assert!(
            reference_output.status.success(),
            "round {i}: reference (solo) install must exit 0: {}",
            String::from_utf8_lossy(&reference_output.stderr)
        );
        let reference_json: serde_json::Value =
            serde_json::from_slice(&read_manifest_bytes(&reference_dir))
                .expect("round {i}: reference manifest must be valid JSON");
        let reference_normalized = normalize_race_dependent_fields(&reference_json);

        let round_repo = seed_synthed_repo(&format!("round-{i}"));
        let round_local = round_repo.display().to_string();
        let round_dir = scratch_dir(&format!("round-{i}"));
        let round_target = round_dir.display().to_string();
        let dir_a = round_dir.clone();
        let dir_b = round_dir.clone();
        let local_a = round_local.clone();
        let local_b = round_local.clone();
        let target_a = round_target.clone();
        let target_b = round_target.clone();
        let handle_a = std::thread::spawn(move || {
            run_konductor(
                &dir_a,
                &[
                    CMD_INSTALL,
                    "--from",
                    &local_a,
                    "--target",
                    &target_a,
                    "--harness",
                    "kiro-cli-v2",
                ],
            )
        });
        let handle_b = std::thread::spawn(move || {
            run_konductor(
                &dir_b,
                &[
                    CMD_INSTALL,
                    "--from",
                    &local_b,
                    "--target",
                    &target_b,
                    "--harness",
                    "kiro-cli-v2",
                ],
            )
        });

        let output_a = handle_a.join().expect("writer A process must not panic");
        let output_b = handle_b.join().expect("writer B process must not panic");

        assert!(
            output_a.status.success(),
            "round {i}: writer A must exit 0: {}",
            String::from_utf8_lossy(&output_a.stderr)
        );
        assert!(
            output_b.status.success(),
            "round {i}: writer B must exit 0: {}",
            String::from_utf8_lossy(&output_b.stderr)
        );

        let manifest_path = round_dir.join(KONDUCTOR_DIR_NAME).join(MANIFEST_FILE_NAME);
        assert!(
            manifest_path.is_file(),
            "round {i}: manifest missing after both writers ran"
        );

        let raw = read_manifest_bytes(&round_dir);
        assert!(!raw.is_empty(), "round {i}: manifest is empty");

        // Must parse as JSON: a torn/interleaved write from two
        // concurrent renames would almost certainly fail this, since
        // each writer's bytes are a fully independent, complete
        // document (write_atomic's rename is all-or-nothing).
        let parsed: serde_json::Value = serde_json::from_slice(&raw).unwrap_or_else(|err| {
            panic!(
                "round {i}: manifest is not valid JSON (corrupt/interleaved write): {err}; \
                 raw bytes: {raw:?}"
            )
        });
        let raced_normalized = normalize_race_dependent_fields(&parsed);

        // The real discriminator: the raced result must be exactly the
        // same document a real, uncontended solo write produces this
        // round -- not merely "the right shape".
        assert_eq!(
            raced_normalized, reference_normalized,
            "round {i}: raced manifest content diverges from a real solo write's output \
             (possible torn/interleaved write); raced={parsed}, reference={reference_json}"
        );

        // No leftover temp file from either writer.
        let konductor_dir = round_dir.join(KONDUCTOR_DIR_NAME);
        let leftovers: Vec<_> = std::fs::read_dir(&konductor_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "round {i}: leftover temp file(s): {:?}",
            leftovers.iter().map(|e| e.file_name()).collect::<Vec<_>>()
        );

        std::fs::remove_dir_all(&round_dir).ok();
        std::fs::remove_dir_all(&reference_dir).ok();
        std::fs::remove_dir_all(&round_repo).ok();
        std::fs::remove_dir_all(&reference_repo).ok();
    }
}
