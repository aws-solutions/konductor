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
// loose shape assertions (schema_version==2, strategies[0].strategy==
// "kiro-cli-v2", files is an array) would still pass against a plausible
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
// Duplicated for the same visibility-boundary reason as the two
// constants above: `install_info::INSTALL_INFO_FILE_NAME` is
// `pub(crate)`, unreachable from this integration test.
const INSTALL_INFO_FILE_NAME: &str = "install-info.json";
const CMD_INSTALL: &str = "install";
const CMD_UNINSTALL: &str = "uninstall";

const ITERATIONS: usize = 50;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn run_konductor(cwd: &Path, sink: &telemetry_test_sink::TelemetrySink, args: &[&str]) -> Output {
    // `HOME` is overridden to `cwd` (an isolated temp dir) for every
    // invocation here: `install`'s default destination is now `$HOME`
    // (this test always passes `--target` explicitly, so that alone
    // isn't the concern), but `log_invocation` (logging.rs) independently
    // resolves `$HOME` for `~/.konductor/logs/` on EVERY invocation,
    // regardless of `--target` -- without this override, a real
    // subprocess run here would still write an invocation log line into
    // this test-runner's actual home directory.
    //
    // Telemetry redirects to `sink` rather than being disabled: a
    // successful install still reports a package_installed event, so
    // without this every round would reach the live endpoint.
    let mut command = Command::new(bin());
    command.args(args).current_dir(cwd).env("HOME", cwd);
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    command.output().expect("failed to spawn konductor binary")
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
    // The manifest is now `{schema_version,
    // strategies: [...]}` -- `installed_at`/`source`/each file's
    // `provenance` live inside EACH element of `strategies`, not at the
    // top level. This test only ever installs the single registered
    // `kiro-cli-v2` strategy, so `strategies` always has exactly one
    // element, but the normalization must still reach into it (rather
    // than a no-op top-level insert that would silently leave the real,
    // race-dependent values in place and produce a false mismatch).
    if let Some(strategies) = normalized
        .as_object_mut()
        .and_then(|obj| obj.get_mut("strategies"))
        .and_then(|s| s.as_array_mut())
    {
        for slot in strategies {
            let Some(slot_obj) = slot.as_object_mut() else {
                continue;
            };
            slot_obj.insert(
                "installed_at".to_string(),
                serde_json::Value::String("<normalized>".to_string()),
            );
            slot_obj.insert(
                "source".to_string(),
                serde_json::Value::String("<normalized>".to_string()),
            );
            if let Some(files) = slot_obj.get_mut("files").and_then(|f| f.as_array_mut()) {
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
    // Shared, Arc-wrapped sink redirecting telemetry off the live endpoint.
    let sink = std::sync::Arc::new(telemetry_test_sink::TelemetrySink::start());
    for i in 0..ITERATIONS {
        let reference_repo = seed_synthed_repo(&format!("reference-{i}"));
        let reference_local = reference_repo.display().to_string();
        let reference_dir = scratch_dir(&format!("reference-{i}"));
        let reference_target = reference_dir.display().to_string();
        let reference_output = run_konductor(
            &reference_dir,
            &sink,
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
        let sink_a = sink.clone();
        let sink_b = sink.clone();
        let handle_a = std::thread::spawn(move || {
            run_konductor(
                &dir_a,
                &sink_a,
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
                &sink_b,
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

/// Seeds a repo root with BOTH `dist/kiro-cli-v2/agents/` and
/// `dist/claude/agents/` output, so a single `--from <repo_root>` can
/// drive either strategy's `install --harness <name>`.
fn seed_dual_strategy_repo(name: &str) -> std::path::PathBuf {
    let repo_root = scratch_dir(&format!("dual-repo-{name}"));
    let kiro_dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
    std::fs::create_dir_all(&kiro_dir).unwrap();
    std::fs::write(kiro_dir.join("k-example.json"), b"{}\n").unwrap();
    let claude_dir = repo_root.join("dist").join("claude").join("agents");
    std::fs::create_dir_all(&claude_dir).unwrap();
    std::fs::write(claude_dir.join("k-example.md"), b"# k-example\n").unwrap();
    repo_root
}

/// `manifest::upsert_strategy` is a read-modify-write
/// (`read_manifest` -> mutate -> `write_manifest`) serialized under a
/// per-target manifest lock. This is the coexistence scenario that
/// lock protects: two concurrent installs of DIFFERENT strategies
/// (`kiro-cli-v2` and `claude`, which are not `KIRO_VARIANT_FAMILY`
/// members of each other and so coexist rather than override) at the
/// SAME target. Without that lock, each process could read a manifest
/// lacking the OTHER's slot, and whichever process's atomic write
/// landed last would silently drop the other's slot -- both processes
/// still exit 0, so the race would be invisible to either caller.
/// Runs `ITERATIONS` rounds and asserts
/// BOTH strategies' slots survive every round -- unlike
/// `concurrent_install_writes_never_produce_a_corrupt_manifest` above
/// (which races the SAME strategy against itself and cannot catch a
/// lost-slot race, since there is only ever one slot to lose), this
/// test's discriminator is specifically "did the OTHER strategy's slot
/// survive," not byte-identical content.
#[test]
fn two_different_strategies_installed_concurrently_do_not_drop_either_slot() {
    // Shared, Arc-wrapped sink redirecting telemetry off the live endpoint.
    let sink = std::sync::Arc::new(telemetry_test_sink::TelemetrySink::start());
    for i in 0..ITERATIONS {
        let repo = seed_dual_strategy_repo(&format!("{i}"));
        let repo_local = repo.display().to_string();
        let target_dir = scratch_dir(&format!("dual-target-{i}"));
        let target = target_dir.display().to_string();

        let dir_kiro = target_dir.clone();
        let dir_claude = target_dir.clone();
        let local_kiro = repo_local.clone();
        let local_claude = repo_local.clone();
        let target_kiro = target.clone();
        let target_claude = target.clone();
        let sink_kiro = sink.clone();
        let sink_claude = sink.clone();
        let handle_kiro = std::thread::spawn(move || {
            run_konductor(
                &dir_kiro,
                &sink_kiro,
                &[
                    CMD_INSTALL,
                    "--from",
                    &local_kiro,
                    "--target",
                    &target_kiro,
                    "--harness",
                    "kiro-cli-v2",
                ],
            )
        });
        let handle_claude = std::thread::spawn(move || {
            run_konductor(
                &dir_claude,
                &sink_claude,
                &[
                    CMD_INSTALL,
                    "--from",
                    &local_claude,
                    "--target",
                    &target_claude,
                    "--harness",
                    "claude",
                ],
            )
        });

        let output_kiro = handle_kiro
            .join()
            .expect("kiro-cli-v2 writer must not panic");
        let output_claude = handle_claude.join().expect("claude writer must not panic");

        assert!(
            output_kiro.status.success(),
            "round {i}: kiro-cli-v2 install must exit 0: {}",
            String::from_utf8_lossy(&output_kiro.stderr)
        );
        assert!(
            output_claude.status.success(),
            "round {i}: claude install must exit 0: {}",
            String::from_utf8_lossy(&output_claude.stderr)
        );

        let raw = read_manifest_bytes(&target_dir);
        let parsed: serde_json::Value = serde_json::from_slice(&raw).unwrap_or_else(|err| {
            panic!("round {i}: manifest is not valid JSON (corrupt/interleaved write): {err}")
        });
        let strategies = parsed["strategies"]
            .as_array()
            .expect("round {i}: strategies must be an array");
        let mut names: Vec<&str> = strategies
            .iter()
            .map(|s| s["strategy"].as_str().expect("strategy must be a string"))
            .collect();
        names.sort_unstable();
        assert_eq!(
            names,
            vec!["claude", "kiro-cli-v2"],
            "round {i}: both concurrently-installed strategies' slots must survive -- \
             a lost-update race would silently drop one of them; raw manifest: {parsed}"
        );

        std::fs::remove_dir_all(&target_dir).ok();
        std::fs::remove_dir_all(&repo).ok();
    }
}

/// Races `konductor install --harness claude` (a fresh, coexisting
/// slot, against a target that already has `kiro-cli-v2` pre-
/// installed synchronously) against `konductor uninstall --harness
/// kiro-cli-v2` (removing the pre-installed slot) at the SAME target.
/// Distinct from
/// `two_different_strategies_installed_concurrently_do_not_drop_either_slot`
/// above, which races two INSTALLS of different strategies -- both
/// going through `upsert_strategy`'s lock, so it cannot exercise an
/// install racing an uninstall.
///
/// `uninstall`'s finalize step re-reads the manifest FRESH under the
/// SAME lock `install`'s `upsert_strategy` uses, so the final state is
/// deterministic regardless of interleaving: `kiro-cli-v2` removed,
/// `claude` present. Never both, and never the whole manifest wiped.
#[test]
fn concurrent_install_of_other_strategy_survives_uninstall_of_original_strategy() {
    // Shared, Arc-wrapped sink redirecting telemetry off the live endpoint.
    let sink = std::sync::Arc::new(telemetry_test_sink::TelemetrySink::start());
    for i in 0..ITERATIONS {
        let repo = seed_dual_strategy_repo(&format!("install-vs-uninstall-{i}"));
        let repo_local = repo.display().to_string();
        let target_dir = scratch_dir(&format!("install-vs-uninstall-target-{i}"));
        let target = target_dir.display().to_string();

        // Pre-install kiro-cli-v2 synchronously -- this establishes the
        // starting state the race below acts on; it is not itself part
        // of the race.
        let setup_output = run_konductor(
            &target_dir,
            &sink,
            &[
                CMD_INSTALL,
                "--from",
                &repo_local,
                "--target",
                &target,
                "--harness",
                "kiro-cli-v2",
            ],
        );
        assert!(
            setup_output.status.success(),
            "round {i}: pre-race setup install must exit 0: {}",
            String::from_utf8_lossy(&setup_output.stderr)
        );

        let dir_install = target_dir.clone();
        let dir_uninstall = target_dir.clone();
        let local_install = repo_local.clone();
        let target_install = target.clone();
        let target_uninstall = target.clone();
        let sink_install = sink.clone();
        let sink_uninstall = sink.clone();
        let handle_install = std::thread::spawn(move || {
            run_konductor(
                &dir_install,
                &sink_install,
                &[
                    CMD_INSTALL,
                    "--from",
                    &local_install,
                    "--target",
                    &target_install,
                    "--harness",
                    "claude",
                ],
            )
        });
        let handle_uninstall = std::thread::spawn(move || {
            run_konductor(
                &dir_uninstall,
                &sink_uninstall,
                &[
                    CMD_UNINSTALL,
                    "--target",
                    &target_uninstall,
                    "--harness",
                    "kiro-cli-v2",
                ],
            )
        });

        let output_install = handle_install
            .join()
            .expect("install writer must not panic");
        let output_uninstall = handle_uninstall
            .join()
            .expect("uninstall writer must not panic");

        assert!(
            output_install.status.success(),
            "round {i}: concurrent install must exit 0: {}",
            String::from_utf8_lossy(&output_install.stderr)
        );
        assert!(
            output_uninstall.status.success(),
            "round {i}: concurrent uninstall must exit 0: {}",
            String::from_utf8_lossy(&output_uninstall.stderr)
        );

        let manifest_path = target_dir.join(KONDUCTOR_DIR_NAME).join(MANIFEST_FILE_NAME);
        assert!(
            manifest_path.is_file(),
            "round {i}: manifest must still exist after the race -- claude's slot must \
             survive (a pre-fix run would delete the manifest file outright here)"
        );

        let raw = std::fs::read(&manifest_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&raw).unwrap_or_else(|err| {
            panic!("round {i}: manifest is not valid JSON (corrupt/interleaved write): {err}")
        });
        let strategies = parsed["strategies"]
            .as_array()
            .expect("round {i}: strategies must be an array");
        let mut names: Vec<&str> = strategies
            .iter()
            .map(|s| s["strategy"].as_str().expect("strategy must be a string"))
            .collect();
        names.sort_unstable();
        assert_eq!(
            names,
            vec!["claude"],
            "round {i}: kiro-cli-v2 must be removed AND claude's concurrently-installed slot \
             must survive -- got {parsed}"
        );

        std::fs::remove_dir_all(&target_dir).ok();
        std::fs::remove_dir_all(&repo).ok();
    }
}

/// Seeds a repo root with `dist/kiro-cli-v2/agents/`,
/// `dist/kiro-v3/agents/`, AND `dist/claude/agents/` output, so a single
/// `--from <repo_root>` can drive any of the three harnesses'
/// `install --harness <name>`.
fn seed_kiro_variant_and_claude_repo(name: &str) -> std::path::PathBuf {
    let repo_root = scratch_dir(&format!("kiro-variant-repo-{name}"));
    let v2_dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
    std::fs::create_dir_all(&v2_dir).unwrap();
    std::fs::write(v2_dir.join("k-example.json"), b"{}\n").unwrap();
    let v3_dir = repo_root.join("dist").join("kiro-v3").join("agents");
    std::fs::create_dir_all(&v3_dir).unwrap();
    std::fs::write(v3_dir.join("k-example.json"), b"{}\n").unwrap();
    let claude_dir = repo_root.join("dist").join("claude").join("agents");
    std::fs::create_dir_all(&claude_dir).unwrap();
    std::fs::write(claude_dir.join("k-example.md"), b"# k-example\n").unwrap();
    repo_root
}

/// Distinct from
/// `concurrent_install_of_other_strategy_survives_uninstall_of_original_strategy`
/// above, specific to the `kiro-cli-v2`/`kiro-v3` OVERRIDE-ON-SWITCH
/// pair (`manifest::KIRO_VARIANT_FAMILY`) rather than
/// an independently-coexisting strategy pair. That test races a
/// coexisting strategy (`claude`) that never shares a destination
/// path with the strategy being uninstalled, so it cannot exercise a
/// stale, unlocked delete stomping on a shared path. This test races
/// the ONE pair that does: `kiro-cli-v2` and `kiro-v3` write every
/// destination path IDENTICALLY by construction (§9.1).
///
/// Pre-installs BOTH `kiro-cli-v2` AND `claude` synchronously -- this
/// establishes the starting state the race below acts on; it is not
/// itself part of the race. `claude`'s slot is what keeps this
/// target's `strategies` list at 2+ entries for the ENTIRE race
/// (`claude` shares no destination path with either Kiro variant,
/// so nothing below ever touches it): with 2+ tracked strategies,
/// `harness_select::select_harness` is FORCED onto its exact-name-match
/// path (`resolve_harness_to_strategy_name`, a pure lookup against the
/// STATIC strategy registry, never consulting what is actually tracked)
/// rather than its own documented "exactly 1 tracked strategy -> return
/// it directly, ignoring `--harness` entirely" shortcut. Without
/// `claude` present, that shortcut can -- independent of the race this
/// test targets -- make `uninstall --harness kiro-cli-v2` resolve
/// to whichever SOLE strategy the unlocked read happens to see, e.g.
/// `kiro-v3` if the concurrent install's write-ahead override has
/// already landed by then, deleting an in-flight install's OWN files
/// under a name it was never asked to remove. That is a real,
/// pre-existing characteristic of `select_harness` for a single-tracked-
/// strategy target (see its own module doc comment), not something
/// `delete_and_remove_strategy_locked` is scoped to address --
/// keeping `strategies.len() >= 2` throughout removes that confound
/// entirely, so `selected_name` is deterministically always `"kiro-cli-v2"`
/// once `uninstall`'s (unlocked) harness selection succeeds at all, and
/// this test exercises exactly the targeted race: an UNLOCKED read of a
/// strategy whose fresh, LOCKED re-read may find has ALREADY been
/// overridden by a concurrent install by the time the deletion actually
/// runs.
///
/// `uninstall.rs`'s file-deletion step runs entirely INSIDE the same
/// per-target lock `install`'s `upsert_strategy` uses, against a FRESH
/// re-read of the slot named by the (unlocked) harness selection -- so
/// it either deletes the strategy that is STILL, in fact, tracked at
/// the instant the lock is held (kiro-cli-v2 winning the race), or
/// finds nothing left under that name and deletes nothing at all
/// (kiro-v3 having already replaced it) -- never a stale, already-
/// superseded slot's files. Without that lock, a stale UNLOCKED read
/// (`delete_eligible_files` running against it) could instead delete
/// `kiro-cli-v2`'s slot's files -- the SAME destination paths kiro-v3
/// also writes -- while the manifest, already committed by the
/// concurrent install, still correctly lists `kiro-v3` as `Complete`
/// with every one of those now-deleted files: reading the manifest
/// back after such a race would show files that do not exist on disk,
/// the exact corrupted state this test's assertions rule out.
#[test]
fn uninstall_of_kiro_cli_survives_concurrent_override_to_kiro_cli_v3() {
    // Shared, Arc-wrapped sink redirecting telemetry off the live endpoint.
    let sink = std::sync::Arc::new(telemetry_test_sink::TelemetrySink::start());
    for i in 0..ITERATIONS {
        let repo = seed_kiro_variant_and_claude_repo(&format!("{i}"));
        let repo_local = repo.display().to_string();
        let target_dir = scratch_dir(&format!("kiro-variant-race-target-{i}"));
        let target = target_dir.display().to_string();

        // Pre-install kiro-cli-v2, THEN claude, both synchronously --
        // this establishes the starting state the race below acts on;
        // it is not itself part of the race. See this test's own doc
        // comment for why claude's coexisting slot matters here.
        let setup_kiro_output = run_konductor(
            &target_dir,
            &sink,
            &[
                CMD_INSTALL,
                "--from",
                &repo_local,
                "--target",
                &target,
                "--harness",
                "kiro-cli-v2",
            ],
        );
        assert!(
            setup_kiro_output.status.success(),
            "round {i}: pre-race setup install (kiro-cli-v2) must exit 0: {}",
            String::from_utf8_lossy(&setup_kiro_output.stderr)
        );
        let setup_claude_output = run_konductor(
            &target_dir,
            &sink,
            &[
                CMD_INSTALL,
                "--from",
                &repo_local,
                "--target",
                &target,
                "--harness",
                "claude",
            ],
        );
        assert!(
            setup_claude_output.status.success(),
            "round {i}: pre-race setup install (claude) must exit 0: {}",
            String::from_utf8_lossy(&setup_claude_output.stderr)
        );

        let dir_install = target_dir.clone();
        let dir_uninstall = target_dir.clone();
        let local_install = repo_local.clone();
        let target_install = target.clone();
        let target_uninstall = target.clone();
        let sink_install = sink.clone();
        let sink_uninstall = sink.clone();
        let handle_install = std::thread::spawn(move || {
            run_konductor(
                &dir_install,
                &sink_install,
                &[
                    CMD_INSTALL,
                    "--from",
                    &local_install,
                    "--target",
                    &target_install,
                    "--harness",
                    "kiro-v3",
                ],
            )
        });
        let handle_uninstall = std::thread::spawn(move || {
            run_konductor(
                &dir_uninstall,
                &sink_uninstall,
                &[
                    CMD_UNINSTALL,
                    "--target",
                    &target_uninstall,
                    "--harness",
                    "kiro-cli-v2",
                ],
            )
        });

        let output_install = handle_install
            .join()
            .expect("install writer must not panic");
        let output_uninstall = handle_uninstall
            .join()
            .expect("uninstall writer must not panic");

        assert!(
            output_install.status.success(),
            "round {i}: concurrent install --harness kiro-v3 must exit 0: {}",
            String::from_utf8_lossy(&output_install.stderr)
        );
        // Duplicated from cli.rs's own `EXIT_USAGE_ERROR` for the same
        // visibility-boundary reason this file's other constants are
        // (see the module docstring at the top of this file).
        const EXIT_USAGE_ERROR: i32 = 64;
        assert!(
            output_uninstall.status.success()
                || output_uninstall.status.code() == Some(EXIT_USAGE_ERROR),
            "round {i}: concurrent uninstall --harness kiro-cli-v2 must exit 0 (removed \
             kiro-cli-v2) or {EXIT_USAGE_ERROR} (kiro-cli-v2 was already overridden to kiro-v3 by \
             the time of uninstall's own harness selection -- `select_harness` cannot resolve \
             `--harness kiro-cli-v2` against a target that no longer tracks it, since \
             claude's coexisting slot keeps `strategies.len() >= 2` and forces exact-name \
             matching -- see this test's own doc comment): got {:?}: {}",
            output_uninstall.status.code(),
            String::from_utf8_lossy(&output_uninstall.stderr)
        );

        let manifest_path = target_dir.join(KONDUCTOR_DIR_NAME).join(MANIFEST_FILE_NAME);
        // claude's slot is never touched by anything in this race
        // (see this test's own doc comment), so the manifest itself
        // must always still exist.
        assert!(
            manifest_path.is_file(),
            "round {i}: manifest must still exist after the race -- claude's slot must \
             survive"
        );
        let raw = std::fs::read(&manifest_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&raw).unwrap_or_else(|err| {
            panic!("round {i}: manifest is not valid JSON (corrupt/interleaved write): {err}")
        });
        let strategies = parsed["strategies"]
            .as_array()
            .expect("round {i}: strategies must be an array");
        let names: Vec<&str> = strategies
            .iter()
            .map(|s| s["strategy"].as_str().expect("strategy must be a string"))
            .collect();
        assert!(
            names.contains(&"claude"),
            "round {i}: claude's coexisting slot must survive the race untouched -- got \
             {parsed}"
        );
        assert!(
            !names.contains(&"kiro-cli-v2"),
            "round {i}: kiro-cli-v2 must never survive this race -- whichever process ran the \
             removal, it either deleted kiro-cli-v2's own slot or found it already replaced by \
             kiro-v3; got {parsed}"
        );

        // The real discriminator, and the one the pre-fix bug actually
        // produced: whatever the manifest claims is tracked, EVERY one
        // of its files must genuinely exist on disk. NEVER the
        // corrupted state where the manifest still lists a strategy
        // (kiro-v3) as Complete with files that a racing
        // uninstall's stale, unlocked delete step already removed.
        for slot in strategies {
            let slot_name = slot["strategy"].as_str().unwrap();
            let files = slot["files"]
                .as_array()
                .unwrap_or_else(|| panic!("round {i}: {slot_name}'s files must be an array"));
            for file in files {
                let rel = file["path"].as_str().expect("file path must be a string");
                let full = target_dir.join(rel);
                assert!(
                    full.is_file(),
                    "round {i}: CORRUPTED STATE -- manifest claims {slot_name} tracks {rel} \
                     (at {}), but it does not exist on disk (manifest claims files exist that \
                     were actually deleted); full manifest: {parsed}",
                    full.display()
                );
            }
        }

        std::fs::remove_dir_all(&target_dir).ok();
        std::fs::remove_dir_all(&repo).ok();
    }
}

/// `write_install_info` (telemetry/install_info.rs) is called
/// separately, AFTER each strategy's own `upsert_strategy` call has
/// already returned and dropped its lock -- so two concurrent installs
/// of DIFFERENT harnesses at the SAME target can each reach
/// `write_install_info` unlocked and racing each other, independent of
/// `upsert_strategy`'s own per-target lock (which only ever serializes
/// the manifest read-modify-write, not anything after it returns).
///
/// Distinct from every other test in this file: those all assert the
/// MANIFEST survives a race intact. This one is about the SEPARATE
/// `install-info.json` record `write_install_info` produces.
///
/// The two WRITERS below are real, separate `konductor install`
/// subprocesses, run back-to-back in a tight loop for a fixed wall-
/// clock duration -- true process-level concurrency, exactly like
/// every other test in this file. A single READER thread (no subprocess
/// needed: it only ever reads, so it carries none of the temp-file-
/// naming concerns a second writer would) polls the same path in a
/// tight loop for the same duration, checking every read it manages to
/// land: present-but-empty or present-but-unparseable is the actual
/// defect this guards (an absent file, e.g. mid-`rename`, is not --
/// `read_install_info`'s own real callers already treat "absent" as a
/// normal outcome). A full round-based test that reads back only AFTER
/// both writers have already returned (an earlier version of this
/// test) can never observe this: whichever writer's complete write
/// lands last always leaves a well-formed file by the time both have
/// joined, so only a reader sampling WHILE the race is in flight can
/// catch the transient bad state the unfixed truncate-then-write left
/// exposed.
#[test]
fn concurrent_installs_of_different_harnesses_never_leave_a_torn_install_info() {
    let sink = telemetry_test_sink::TelemetrySink::start();
    let repo = seed_dual_strategy_repo("install-info-race");
    let repo_local = repo.display().to_string();
    let target_dir = scratch_dir("install-info-race-target");
    let target = target_dir.display().to_string();
    let install_info_path = target_dir
        .join(KONDUCTOR_DIR_NAME)
        .join(INSTALL_INFO_FILE_NAME);

    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let violation: std::sync::Arc<std::sync::Mutex<Option<(Vec<u8>, String)>>> =
        std::sync::Arc::new(std::sync::Mutex::new(None));

    let stop_reader = stop.clone();
    let violation_reader = violation.clone();
    let reader_path = install_info_path.clone();
    let reader = std::thread::spawn(move || {
        while !stop_reader.load(std::sync::atomic::Ordering::Relaxed) {
            // `NotFound` (e.g. mid-`rename`, or before the very first
            // write has landed) is not the defect this test targets --
            // see this test's own doc comment. Only a PRESENT file
            // that is empty or fails to parse is.
            let Ok(raw) = std::fs::read(&reader_path) else {
                continue;
            };
            if raw.is_empty() {
                let mut slot = violation_reader.lock().unwrap();
                if slot.is_none() {
                    *slot = Some((
                        raw,
                        "install-info.json existed but was EMPTY -- a truncate from one \
                         writer landed with no following write yet visible"
                            .to_string(),
                    ));
                }
                continue;
            }
            if let Err(err) = serde_json::from_slice::<serde_json::Value>(&raw) {
                let mut slot = violation_reader.lock().unwrap();
                if slot.is_none() {
                    *slot = Some((
                        raw,
                        format!(
                            "install-info.json existed but was not valid JSON \
                             (torn/spliced write): {err}"
                        ),
                    ));
                }
            }
        }
    });

    // Race duration: long enough for the tight reader loop to sample
    // many thousands of times against real, separate `install`
    // subprocess launches -- see this test's own investigation notes
    // for why a fixed, generous wall-clock budget (rather than a
    // round count) is what actually lands the interleave: the
    // vulnerable window is a handful of bytes, dwarfed by a full
    // `install` invocation's own file-copy/manifest work, so it needs
    // many thousands of real subprocess launches to hit at all.
    const RACE_DURATION: std::time::Duration = std::time::Duration::from_secs(15);
    let deadline = std::time::Instant::now() + RACE_DURATION;

    let target_kiro = target.clone();
    let local_kiro = repo_local.clone();
    let sink_kiro = sink;
    let writer_kiro = std::thread::spawn(move || {
        while std::time::Instant::now() < deadline {
            let output = run_konductor(
                Path::new(&target_kiro),
                &sink_kiro,
                &[
                    CMD_INSTALL,
                    "--from",
                    &local_kiro,
                    "--target",
                    &target_kiro,
                    "--harness",
                    "kiro-cli-v2",
                ],
            );
            assert!(
                output.status.success(),
                "kiro-cli-v2 install must exit 0: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    });
    let target_claude = target.clone();
    let local_claude = repo_local.clone();
    let sink_claude = telemetry_test_sink::TelemetrySink::start();
    let writer_claude = std::thread::spawn(move || {
        while std::time::Instant::now() < deadline {
            let output = run_konductor(
                Path::new(&target_claude),
                &sink_claude,
                &[
                    CMD_INSTALL,
                    "--from",
                    &local_claude,
                    "--target",
                    &target_claude,
                    "--harness",
                    "claude",
                ],
            );
            assert!(
                output.status.success(),
                "claude install must exit 0: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    });

    writer_kiro
        .join()
        .expect("kiro-cli-v2 writer must not panic");
    writer_claude.join().expect("claude writer must not panic");
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    reader.join().expect("reader thread must not panic");

    let violation = violation.lock().unwrap();
    assert!(
        violation.is_none(),
        "reader observed a corrupt install-info.json while installs raced: {:?}",
        violation.as_ref().map(|(raw, msg)| (msg, raw))
    );

    // Final state, read once both writers and the reader have all
    // stopped: must still be a complete, valid, one-writer record.
    assert!(
        install_info_path.is_file(),
        "install-info.json missing after the race"
    );
    let raw = std::fs::read(&install_info_path)
        .unwrap_or_else(|err| panic!("failed to read install-info.json: {err}"));
    let parsed: serde_json::Value = serde_json::from_slice(&raw).unwrap_or_else(|err| {
        panic!("final install-info.json is not valid JSON: {err}; raw bytes: {raw:?}")
    });
    let obj = parsed
        .as_object()
        .unwrap_or_else(|| panic!("install-info.json root must be an object: {parsed}"));
    assert_eq!(
        obj.len(),
        4,
        "install-info.json must have exactly four keys, got {obj:?}"
    );
    let harness = obj
        .get("harness")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| panic!("missing/non-string 'harness' field: {parsed}"));
    assert!(
        harness == "kiro-cli-v2" || harness == "claude",
        "'harness' must be exactly one racer's own value, got {harness:?}: {parsed}"
    );

    // No leftover temp file from either writer.
    let konductor_dir = target_dir.join(KONDUCTOR_DIR_NAME);
    let leftovers: Vec<_> = std::fs::read_dir(&konductor_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "leftover temp file(s): {:?}",
        leftovers.iter().map(|e| e.file_name()).collect::<Vec<_>>()
    );

    std::fs::remove_dir_all(&target_dir).ok();
    std::fs::remove_dir_all(&repo).ok();
}
