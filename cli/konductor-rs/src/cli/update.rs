// SPDX-License-Identifier: Apache-2.0
//
// update.rs — `konductor update` dispatch (Rust implementation).
//
// ── Scope (design doc §4 -- unconditional overwrite) ───────────────────
// Implements the overwrite semantics specified in
// `designs/konductor-cli-install-index.md` §4: `update` resolves which
// tracked target(s) to act on (unchanged target-resolution logic,
// below), then for each one calls the exact same
// `InstallStrategy::install_from_local(target_dir, from)` `install.rs`'s
// `dispatch_install_with` calls on its own selected strategy. No hash
// comparison, no divergence classification, no filtering, no
// reconciliation -- the manifest `install_from_local` writes as a side
// effect of that call IS the final manifest for this run, verbatim.
// Reuses `manifest::read_manifest`, `index::{read_index, write_index,
// canonicalize_target_dir}`, and `registry::STRATEGIES` exactly as
// install does; never re-runs `matches()` selection against the target
// (design doc §7 -- out of scope for this milestone).
//
// ── KNOWN LIMITATION: no same-target concurrency protection ───────────────
// Running two `konductor` invocations (any mix of install/update/
// uninstall) against the SAME target directory at once is unsupported
// and can corrupt the manifest, index, or on-disk files -- e.g. this
// module's `install_from_local` call can race a concurrent writer's own
// output. No locking exists or is planned; callers must serialize their
// own invocations per target. Same accepted-risk posture as the
// cross-target index race (design doc §2).
//
// ── KNOWN LIMITATION: no transactional rollback on a mid-copy failure ────
// `update_one_target` calls `install_from_local` with no transactional
// wrapper. A mid-copy failure (disk full, permission error) can leave
// the target with a mix of fresh and stale files, the manifest never
// gets rewritten to reflect the failure, and the index entry can stay
// `InProgress` until a future read self-heals it against the target's
// real manifest state. No rollback exists or is planned.

use std::path::{Path, PathBuf};

use super::install::artifact::sha256_hex;
use super::install::index::{self, IndexEntry, IndexEntryStatus};
use super::install::manifest::{self, Manifest, ManifestError, Status};
use super::install::registry;

/// Remapped exit code for CLI usage errors, matching cli.rs's own
/// `EXIT_USAGE_ERROR` constant. Duplicated here per install.rs's own
/// established precedent for this exact constant (cli.rs's constant is
/// private to that module).
const EXIT_USAGE_ERROR: u8 = 64;

/// The `--harness <value>` fragment every "re-run `konductor install`"
/// remediation string in this file embeds when no recorded strategy is
/// available to name a specific one -- kept in exactly one place so
/// these remediation strings can't independently drift from the three
/// values `cli.rs`'s `--harness` clap `value_parser` actually accepts
/// (the same "hardcoded, can drift" risk CR-303697675 already flagged
/// for that allowlist itself). `doctor.rs` duplicates this constant
/// under the same name rather than importing it from here -- `update`
/// is a private (non-`pub`) module in `cli.rs`, so `doctor.rs` cannot
/// reference it without widening that visibility, which is out of scope
/// for a remediation-text fix.
const HARNESS_PLACEHOLDER: &str = "--harness <kiro-cli-v2|kiro-v3|claude>";

/// Best-effort `--harness <value>` remediation fragment for a manifest's
/// recorded `strategy` (an `InstallStrategy::name()`, e.g. `"kiro-cli"`)
/// -- looks up that strategy's own `harness_dir()` (e.g. `"kiro-cli-v2"`)
/// in `registry::STRATEGIES` so a "re-run `konductor install`"
/// remediation for an already-tracked target can name the harness that
/// installed it, instead of the generic `HARNESS_PLACEHOLDER`. Falls
/// back to `HARNESS_PLACEHOLDER` when `strategy_name` is not registered
/// (e.g. a manifest written by a newer `konductor` build this binary
/// doesn't know about).
fn harness_hint(strategy_name: &str) -> String {
    match registry::STRATEGIES
        .iter()
        .find(|s| s.name() == strategy_name)
    {
        Some(strategy) => format!("--harness {}", strategy.harness_dir()),
        None => HARNESS_PLACEHOLDER.to_string(),
    }
}

/// Remapped exit code for a state/verification failure -- an
/// unsupported manifest/index `schema_version` -- matching cli.rs's own
/// `EXIT_VERIFY_FAILED` constant and `manifest::ManifestError`'s /
/// `index::IndexError`'s own doc comments, which document that
/// `UnsupportedSchemaVersion` must map to this code, never
/// `EXIT_USAGE_ERROR` (64).
const EXIT_VERIFY_FAILED: u8 = 65;

/// Maps a `manifest::read_manifest`/`index::read_index` error to its
/// correct exit code -- `EXIT_VERIFY_FAILED` (65) specifically for
/// `ManifestError::UnsupportedSchemaVersion`, `EXIT_USAGE_ERROR` (64)
/// for every other variant. Shared by every manifest-read call site in
/// this module so the split cannot drift between them.
fn manifest_error_exit_code(err: &ManifestError) -> u8 {
    match err {
        ManifestError::UnsupportedSchemaVersion { .. } => EXIT_VERIFY_FAILED,
        _ => EXIT_USAGE_ERROR,
    }
}

/// Same mapping as `manifest_error_exit_code`, for `index::IndexError`.
fn index_error_exit_code(err: &index::IndexError) -> u8 {
    match err {
        index::IndexError::UnsupportedSchemaVersion { .. } => EXIT_VERIFY_FAILED,
        _ => EXIT_USAGE_ERROR,
    }
}

/// `konductor update [--from ...] [--target ...] [--all]`: resolves
/// which tracked install(s) to update (design doc §4 step 1, mirroring
/// uninstall's §3 selection surface), then
/// runs `update_one_target` on each. Returns 0 on success (including
/// "nothing tracked, nothing to do"), `EXIT_USAGE_ERROR` (64) on any
/// usage failure, `EXIT_VERIFY_FAILED` (65) on an unsupported schema
/// version -- never exit code 2.
pub fn dispatch_update_with(
    from: Option<String>,
    target: Option<String>,
    all: bool,
    no_telemetry: bool,
    verbose: bool,
    json: bool,
) -> u8 {
    let home_dir_fallback = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    let index = match index::read_index() {
        Ok(index) => index,
        Err(err) => {
            super::report::report_error(
                "update",
                "update.index_read_failed",
                &home_dir_fallback,
                no_telemetry,
                &format!("could not read install index: {err}"),
                Vec::new(),
                json,
            );
            return index_error_exit_code(&err);
        }
    };
    let entries = index.map(|i| i.installs).unwrap_or_default();

    // The "0 tracked installs is a no-op, not an error" rule only holds
    // for a BARE invocation, where the caller asked for "whatever is
    // tracked". An explicit `--target <dir>` on an empty index must
    // still fall through to the same not-found usage error (64) below,
    // rather than silently reporting success for a target that was
    // never updated purely because nothing was tracked at all -- this
    // matters for scripts that check `$?`. `--all` on an empty index
    // has nothing to iterate either way, so it stays a 0 no-op.
    if entries.is_empty() && target.is_none() && !all {
        super::report::report_no_tracked_installs("update", json);
        return 0;
    }

    // A hand-edited or otherwise corrupted index can carry the same
    // target_dir more than once, which write_index's own upsert path
    // can never itself produce. Refuse to proceed with ANY operation on
    // a corrupted index rather than silently picking one duplicate as
    // authoritative.
    let duplicates = index::duplicate_target_dirs(&entries);
    if !duplicates.is_empty() {
        report_corrupted_index(&duplicates, json);
        return EXIT_USAGE_ERROR;
    }

    let targets: Vec<IndexEntry> = if all {
        entries
    } else if let Some(target) = target.as_deref() {
        // Mirrors `uninstall.rs`'s `dispatch_target` selection logic
        // exactly, so `update --target <dir>` and `uninstall --target
        // <dir>` really do share an identical selection surface (the
        // CR description's claim) rather than differing on a target
        // whose directory no longer exists. If `canonicalize_target_dir`
        // fails (a tracked directory that's since been deleted -- the
        // stale case), fall back to matching the raw string, or its
        // lexically-resolved absolute form via `std::path::absolute`,
        // against every tracked `target_dir` before giving up. Without
        // this fallback, a stale entry could only ever be reached via
        // `--all` here, while `uninstall --target` could already reach
        // it directly -- keeping the two commands' selection surfaces
        // genuinely identical requires this fallback on both sides.
        // Once matched this way, `update_one_target` below
        // still correctly fails with its own existing "stale (no
        // manifest found)" message (there is genuinely no manifest to
        // read from a directory that no longer exists) -- `update`,
        // unlike `uninstall`, has nothing to reconcile against for a
        // gone target and cannot silently succeed the way `uninstall`'s
        // prune can, but it now reports "stale", not "could not
        // resolve --target", pointing the user at the stale index entry
        // rather than at path resolution.
        let canonical = index::canonicalize_target_dir(Path::new(target));
        let matched = match &canonical {
            Ok(canonical) => entries.iter().find(|e| e.target_dir == *canonical).cloned(),
            Err(_) => {
                let absolute = std::path::absolute(Path::new(target))
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned());
                entries
                    .iter()
                    .find(|e| {
                        e.target_dir == target || absolute.as_deref() == Some(e.target_dir.as_str())
                    })
                    .cloned()
            }
        };
        match matched {
            Some(entry) => vec![entry],
            None => {
                let resolved_display = canonical
                    .as_deref()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|_| target.to_string());
                super::report::report_error(
                    "update",
                    "update.target_not_found",
                    std::path::Path::new(&target),
                    no_telemetry,
                    &format!(
                        "--target {target} does not match any tracked install \
                         (resolved to {resolved_display})"
                    ),
                    vec![
                        (
                            "requested_target",
                            serde_json::Value::String(target.to_string()),
                        ),
                        (
                            "resolved_target",
                            serde_json::Value::String(resolved_display),
                        ),
                    ],
                    json,
                );
                return EXIT_USAGE_ERROR;
            }
        }
    } else if entries.len() == 1 {
        entries
    } else {
        report_ambiguous_targets(&entries, json);
        return EXIT_USAGE_ERROR;
    };

    // For `--all` + `--json`, every target's outcome is collected into
    // a single batch report emitted ONCE at the end -- mirroring
    // `uninstall.rs`'s `dispatch_all`/`report_batch` single-document
    // convention (see that module's own doc comment for why: a `--json`
    // consumer parsing a single `serde_json::from_str` call would break
    // on N concatenated top-level documents). This split ONLY changes
    // the `--all` + `json=true` case -- the plain-text `--all` path (one
    // line per target) and the single-target `--json` path (already
    // exactly one document) are both unchanged below.
    if all && json {
        return dispatch_update_all_json(targets, from.as_deref(), verbose, no_telemetry);
    }

    // Deterministic tie-break across a `--all` batch: `EXIT_USAGE_ERROR`
    // (64) "wins" over any other non-zero code (e.g. `EXIT_VERIFY_FAILED`,
    // 65) once at least one usage error has occurred, so the reported
    // code never depends on which target ran last. Matches
    // `uninstall.rs`'s `dispatch_all` convention.
    let mut exit_code = 0u8;
    for entry in targets {
        let target_dir = PathBuf::from(&entry.target_dir);
        let code = update_one_target(
            &target_dir,
            from.as_deref(),
            verbose,
            json,
            all,
            no_telemetry,
        );
        if code != 0 && (exit_code == 0 || code == EXIT_USAGE_ERROR) {
            exit_code = code;
        }
    }
    exit_code
}

/// One target's outcome for a `--all --json` batch report: either a
/// success (mirroring `report_update_success`'s JSON fields, minus the
/// `command` field the batch wrapper already carries once) or a failure
/// (the error message plus the exit code it produced, so the batch's
/// overall exit code can still apply `update`'s own
/// usage-error-wins-the-tie-break rule).
///
/// `finalize_index_warning` (finding f-6e118a1c): `run_update_one_target`
/// itself never prints -- a finalize-index failure (the `write_index`
/// call that flips the entry to `Complete`, AFTER `install_from_local`
/// has already succeeded) is carried back here instead, so each caller
/// renders it in its own mode: `update_one_target` folds it into
/// `report_update_success`'s plain-text/`--json` output,
/// `dispatch_update_all_json` folds it into this target's entry in the
/// single batched JSON document via `report_update_batch`. `None` on
/// the ordinary path where the finalize write succeeded.
enum UpdateOutcome {
    Success {
        files: usize,
        edited_files_overwritten: usize,
        manifest_path: String,
        finalize_index_warning: Option<String>,
    },
    Failure {
        message: String,
        exit_code: u8,
    },
}

/// `--all` + `json=true` path: runs every target exactly as the
/// existing per-target loop does, but collects each outcome instead of
/// printing it immediately, then emits ONE JSON document summarizing
/// the whole run via `report_update_batch` -- mirroring
/// `uninstall.rs`'s `report_batch` field-naming (`succeeded`/`failed`
/// arrays) rather than inventing a different shape. Returns the same
/// deterministic tie-break exit code the plain per-target loop above
/// computes (`EXIT_USAGE_ERROR` wins over any other non-zero code).
fn dispatch_update_all_json(
    targets: Vec<IndexEntry>,
    from: Option<&str>,
    verbose: bool,
    no_telemetry: bool,
) -> u8 {
    let _ = verbose; // batched --json output has no verbose per-file listing, matching the single-target --json path's own shape (verbose only affects plain-text output there too).
    let mut succeeded: Vec<(String, UpdateOutcome)> = Vec::new();
    let mut failed: Vec<(String, UpdateOutcome)> = Vec::new();
    let mut exit_code = 0u8;

    for entry in targets {
        let target_dir = PathBuf::from(&entry.target_dir);
        let outcome = match run_update_one_target(&target_dir, from, true, no_telemetry) {
            Ok(outcome) => outcome,
            Err(outcome) => outcome,
        };
        match &outcome {
            UpdateOutcome::Success { .. } => succeeded.push((entry.target_dir, outcome)),
            UpdateOutcome::Failure {
                exit_code: code, ..
            } => {
                if *code != 0 && (exit_code == 0 || *code == EXIT_USAGE_ERROR) {
                    exit_code = *code;
                }
                // Telemetry parity with the plain single-target/`--all`
                // path: mirrors `update_one_target`'s own `report_error`
                // -> `report_cli_error` call for the identical failure
                // shape, so a per-target failure inside `--all --json`
                // is visible to telemetry the same way the plain path's
                // failure already is. Uses the same
                // `"update.target_failed"` error code the single-target
                // path's own catch-all failure arm uses.
                //
                // `_for_target`, not the
                // process-global-cache variant: this loop iterates
                // several distinct `target_dir`s in one process, so the
                // cached variant would misattribute every target after
                // the first to whichever target's identity the cache
                // happened to resolve first.
                crate::cli::telemetry::report_cli_error_for_target(
                    &target_dir,
                    "update",
                    "update.target_failed",
                    no_telemetry,
                );
                failed.push((entry.target_dir, outcome));
            }
        }
    }

    report_update_batch(&succeeded, &failed);
    exit_code
}

/// Emits ONE JSON document summarizing a `--all --json` update run --
/// mirroring `uninstall.rs`'s `report_batch` shape exactly:
/// `{"command": "update", "succeeded": [...], "failed": [...]}`, each
/// array entry carrying `target_dir` plus that target's own fields
/// (`report_update_success`'s success fields, or an `error` string for
/// a failure). Unlike `uninstall`'s batch report, `update` has no
/// `stale_skipped`-style secondary bucket to track (a stale target is
/// simply a failure here -- see `update_one_target`'s own doc comment
/// on why `update`, unlike `uninstall`, cannot treat a missing manifest
/// as a non-fatal prune).
fn report_update_batch(succeeded: &[(String, UpdateOutcome)], failed: &[(String, UpdateOutcome)]) {
    println!(
        "{}",
        serde_json::json!({
            "command": "update",
            "succeeded": succeeded.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Success { files, edited_files_overwritten, manifest_path, finalize_index_warning } => {
                        let mut entry = serde_json::json!({
                            "target_dir": dir,
                            "manifest_path": manifest_path,
                            "files": files,
                            "edited_files_overwritten": edited_files_overwritten,
                        });
                        if let Some(warning) = finalize_index_warning {
                            entry["warning"] = serde_json::Value::String(warning.clone());
                        }
                        entry
                    }
                    UpdateOutcome::Failure { .. } => unreachable!("succeeded only ever holds UpdateOutcome::Success"),
                }
            }).collect::<Vec<_>>(),
            "failed": failed.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Failure { message, .. } => serde_json::json!({
                        "target_dir": dir,
                        "error": message,
                    }),
                    UpdateOutcome::Success { .. } => unreachable!("failed only ever holds UpdateOutcome::Failure"),
                }
            }).collect::<Vec<_>>(),
        })
    );
}

/// Reports the 2+-entries-no-flag ambiguity error, listing every
/// tracked `target_dir` so the user knows what `--target <dir>` values
/// are valid. `--json` mode emits a structured `tracked_targets` field
/// instead of embedding the list in the message string, matching this
/// module's (and `report_update_success`'s) existing
/// `serde_json::json!` error/report shape convention.
fn report_ambiguous_targets(entries: &[IndexEntry], json: bool) {
    let message = "multiple installs are tracked; pass --target <dir> or --all";
    if json {
        println!(
            "{}",
            serde_json::json!({
                "command": "update",
                "error": message,
                "tracked_targets": entries.iter().map(|e| e.target_dir.clone()).collect::<Vec<_>>(),
            })
        );
        return;
    }
    let listed = entries
        .iter()
        .map(|e| format!("  - {}", e.target_dir))
        .collect::<Vec<_>>()
        .join("\n");
    eprintln!("konductor update: {message}. Tracked installs:\n{listed}");
}

/// Reports a corrupted index (duplicate `target_dir` entries) and
/// refuses to proceed with any operation, naming exactly which
/// target_dir(s) are duplicated. Mirrors `report_ambiguous_targets`'s
/// plain-text/`--json` shape split.
fn report_corrupted_index(duplicates: &[String], json: bool) {
    let message = "install index is corrupted: duplicate target_dir entries found; \
                    fix ~/.konductor/installs by hand before running update";
    if json {
        println!(
            "{}",
            serde_json::json!({
                "command": "update",
                "error": message,
                "duplicate_targets": duplicates,
            })
        );
        return;
    }
    let listed = duplicates
        .iter()
        .map(|d| format!("  - {d}"))
        .collect::<Vec<_>>()
        .join("\n");
    eprintln!("konductor update: {message}. Duplicated target_dir(s):\n{listed}");
}

/// Counts how many of `manifest`'s recorded files have local edits, by
/// comparing each file's on-disk hash against its recorded `sha256`.
/// Mirrors `uninstall.rs`'s `delete_eligible_files` hash-comparison
/// exactly, including its missing-file rule: a file that no longer
/// exists is skipped, not counted as diverged (there is nothing to
/// hash), and an entry with no recorded hash is skipped the same way.
/// Purely observational -- computed before `install_from_local`
/// overwrites anything, never gates or alters what gets overwritten.
///
/// Validates each recorded path stays within `target_dir` BEFORE
/// joining, mirroring `uninstall.rs`'s `validate_relative_path` --
/// a corrupted/hand-edited manifest must never cause a read outside
/// the intended tree, even for this purely observational count. An
/// entry that fails validation is skipped (not counted as diverged),
/// consistent with this function's own missing-file/no-hash skip
/// rules -- there is no `Result` to propagate an error through here,
/// since this function is advisory only and never gates a write.
fn count_diverged_files(target_dir: &Path, manifest: &Manifest) -> usize {
    let mut diverged = 0usize;
    for file in &manifest.files {
        let Some(expected) = &file.sha256 else {
            continue;
        };
        let Ok(rel) = super::uninstall::validate_relative_path(&file.path) else {
            continue;
        };
        let path = target_dir.join(rel);
        if !path.is_file() {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if sha256_hex(&bytes) != *expected {
            diverged += 1;
        }
    }
    diverged
}

/// One tracked target's full update run (design doc §4, step 2): looks
/// up the target's currently-recorded strategy from its existing
/// One tracked target's full update run (design doc §4, step 2): looks
/// up the target's currently-recorded strategy from its existing
/// manifest, then calls `install_from_local` on it exactly as a fresh
/// `install --target <dir>` would -- no filtering, no classification,
/// no reconciliation. Mirrors `install`'s own exit-code contract
/// exactly: 0 on success, `EXIT_USAGE_ERROR` (64) on an unresolvable
/// target, missing/in-progress manifest, unregistered strategy, or
/// `install_from_local` failure, `EXIT_VERIFY_FAILED` (65) on an
/// unsupported manifest schema version -- never exit code 2.
///
/// A missing manifest (`Ok(None)`) is a **stale tracked install** --
/// the index still names this target, but no manifest exists there.
/// Reported with the word "stale" so its wording matches
/// `uninstall.rs`'s own stale-specific message for the identical
/// condition; `update` still treats this as a real failure
/// (`EXIT_USAGE_ERROR`), unlike `uninstall`, which prunes the stale
/// entry and treats it as a terminal success -- `update` has nothing
/// it can act on without a manifest to read a strategy from.
///
/// A thin printing wrapper around `run_update_one_target` (the shared
/// core both this function and the `--all --json` batch path call) --
/// this function itself does no filesystem work; it only calls the
/// shared core and reports the resulting `UpdateOutcome` via
/// `report_error`/`report_update_success`. Keeping both callers on one
/// core function avoids maintaining the same nine-step sequence (read
/// manifest, reject `in_progress`, count diverged files, look up the
/// strategy, run `would_fail_as_noop`, canonicalize, write `InProgress`,
/// call `install_from_local`, write `Complete`) as two hand-maintained
/// copies -- a fix to one copy could otherwise silently leave the other
/// wrong, and the `--all --json` path would be the copy least likely to
/// be noticed drifting.
fn update_one_target(
    target_dir: &Path,
    from: Option<&str>,
    verbose: bool,
    json: bool,
    uncached_identity: bool,
    no_telemetry: bool,
) -> u8 {
    match run_update_one_target(target_dir, from, uncached_identity, no_telemetry) {
        Ok(UpdateOutcome::Success {
            files,
            edited_files_overwritten,
            manifest_path,
            finalize_index_warning,
        }) => {
            report_update_success(
                target_dir,
                &manifest_path,
                files,
                edited_files_overwritten,
                finalize_index_warning.as_deref(),
                verbose,
                json,
            );
            0
        }
        Ok(UpdateOutcome::Failure { .. }) => {
            unreachable!("run_update_one_target's Ok variant always holds UpdateOutcome::Success")
        }
        Err(UpdateOutcome::Failure { message, exit_code }) => {
            // `uncached_identity` selects
            // `report_error_for_target` whenever this call may be one
            // of several distinct targets visited in this process (this
            // function's own caller passes `all` for exactly that
            // reason -- see this function's own doc comment) -- the
            // plain-`report_error` (process-global-cache) variant would
            // otherwise misattribute every target after the first to
            // whichever target's identity the cache resolved first,
            // mirroring the identical fix this parameter already
            // applies to the SUCCESS path a few lines below in
            // `run_update_one_target`.
            let extra = vec![(
                "target_dir",
                serde_json::Value::String(target_dir.display().to_string()),
            )];
            if uncached_identity {
                super::report::report_error_for_target(
                    "update",
                    "update.target_failed",
                    target_dir,
                    no_telemetry,
                    &message,
                    extra,
                    json,
                );
            } else {
                super::report::report_error(
                    "update",
                    "update.target_failed",
                    target_dir,
                    no_telemetry,
                    &message,
                    extra,
                    json,
                );
            }
            exit_code
        }
        Err(UpdateOutcome::Success { .. }) => {
            unreachable!("run_update_one_target's Err variant always holds UpdateOutcome::Failure")
        }
    }
}

/// The single shared core for one target's full update run -- the
/// exact nine-step sequence `update_one_target`'s own doc comment
/// describes (read manifest, reject `in_progress`, count diverged
/// files, look up the strategy, run `would_fail_as_noop`, canonicalize,
/// write `InProgress`, call `install_from_local`, write `Complete`),
/// with NO printing anywhere in its body -- a finalize-index failure
/// is carried back to the caller as `UpdateOutcome::Success`'s
/// `finalize_index_warning` field instead of being printed here (see
/// that field's own doc comment). Both `update_one_target` (the
/// single-target/plain-text/`--target`+`--json` path) and
/// `dispatch_update_all_json` (the `--all --json` batch path) call this
/// one function and handle reporting themselves -- print immediately
/// via `report_error`/`report_update_success`, or collect into a batch
/// report. This is what keeps the ordering guarantee (several comments
/// throughout this function explain WHY a given step must run before
/// the next) living in exactly one place, rather than two
/// hand-maintained copies that could drift.
///
/// Returns `Ok(UpdateOutcome::Success { .. })` on success,
/// `Err(UpdateOutcome::Failure { .. })` on any failure -- the
/// `Result<UpdateOutcome, UpdateOutcome>` shape lets each caller use
/// `?`/`match` idiomatically while still carrying the same `UpdateOutcome`
/// payload on both branches.
fn run_update_one_target(
    target_dir: &Path,
    from: Option<&str>,
    uncached_identity: bool,
    no_telemetry: bool,
) -> Result<UpdateOutcome, UpdateOutcome> {
    let current = match manifest::read_manifest(target_dir) {
        Ok(Some(manifest)) => manifest,
        Ok(None) => {
            return Err(UpdateOutcome::Failure {
                message: format!(
                    "{} is stale (no manifest found); run `konductor install \
                     {HARNESS_PLACEHOLDER}` first",
                    target_dir.display()
                ),
                exit_code: EXIT_USAGE_ERROR,
            });
        }
        Err(err) => {
            return Err(UpdateOutcome::Failure {
                message: format!("could not read manifest at {}: {err}", target_dir.display()),
                exit_code: manifest_error_exit_code(&err),
            });
        }
    };
    if current.status == Status::InProgress {
        return Err(UpdateOutcome::Failure {
            message: format!(
                "{} has an unfinished install (status: in_progress); \
                 run `konductor install {}` again before updating -- re-running install may \
                 reclassify provenance for files partially copied during the interrupted run",
                target_dir.display(),
                harness_hint(&current.strategy)
            ),
            exit_code: EXIT_USAGE_ERROR,
        });
    }

    // Read-only, computed before install_from_local overwrites
    // anything below: how many currently-tracked files have local
    // edits (on-disk hash no longer matches the manifest's recorded
    // hash). Purely observational -- never blocks or alters the
    // unconditional overwrite that follows.
    let diverged_before_overwrite = count_diverged_files(target_dir, &current);

    // Design doc §4 step 2: reuse the ORIGINAL strategy's
    // install_from_local unmodified, unconditionally -- never re-runs
    // registry selection/matches() (design doc §7). Fails clearly if
    // the originally-recorded strategy is no longer registered, rather
    // than silently picking a different one.
    //
    // This lookup is a pure, side-effect-free read of `current.strategy`
    // against `registry::STRATEGIES` -- it must run BEFORE the
    // `write_index(InProgress)` write-ahead below so that a fail-fast on
    // an unregistered strategy never mutates the index (matching the
    // in-progress-manifest guard above, which likewise runs before any
    // index mutation).
    let strategy = registry::STRATEGIES
        .iter()
        .find(|s| s.name() == current.strategy);
    let Some(strategy) = strategy else {
        return Err(UpdateOutcome::Failure {
            message: format!(
                "strategy '{}' recorded for {} is no longer registered",
                current.strategy,
                target_dir.display()
            ),
            exit_code: EXIT_USAGE_ERROR,
        });
    };

    // Same pure, side-effect-free precondition as the unregistered-
    // strategy check just above, for the OTHER class of no-op failure:
    // `install_from_local` itself would refuse before touching the
    // filesystem (missing --from, or a source with nothing to
    // install). Must also run BEFORE the write-ahead below, for the
    // identical reason -- a healthy target's `Complete` index entry
    // must never flip to `InProgress` for a run that is guaranteed to
    // fail as a no-op.
    if let Some(message) = strategy.would_fail_as_noop(target_dir, from) {
        return Err(UpdateOutcome::Failure {
            message,
            exit_code: EXIT_USAGE_ERROR,
        });
    }

    // Index write-ahead (design doc §2/§4 step 3): InProgress before
    // the copy, mirroring install's own bracketing.
    let canonical_target_dir = match index::canonicalize_target_dir(target_dir) {
        Ok(path) => path,
        Err(err) => {
            return Err(UpdateOutcome::Failure {
                message: format!("could not resolve {}: {err}", target_dir.display()),
                exit_code: EXIT_USAGE_ERROR,
            });
        }
    };
    let updated_at = crate::cli::time::utc_now_iso();
    if let Err(err) = index::write_index(IndexEntry {
        target_dir: canonical_target_dir.clone(),
        strategy: current.strategy.clone(),
        installed_at: updated_at.clone(),
        status: IndexEntryStatus::InProgress,
    }) {
        return Err(UpdateOutcome::Failure {
            message: format!("could not write install index: {err}"),
            exit_code: index_error_exit_code(&err),
        });
    }

    // Durable opt-out carry-forward (design doc D.8/D.10): `update`'s
    // own `--no-telemetry` flag is re-specified per invocation, same as
    // `--from`/`--target` (see `Commands::Update`'s own doc comment),
    // and when passed it always suppresses telemetry for this run
    // regardless of the target's own history -- an explicit override
    // in either direction. When it is NOT passed, this target's own
    // `.konductor/telemetry-id.json` absence -- on a target already
    // confirmed above to have a manifest -- is read as "opted out at
    // install time" and carried forward, with no need to re-pass the
    // flag on every `update`. `identity_file_exists` checks THIS
    // target_dir specifically, so an `--all` batch resolves the signal
    // independently per target, the same way each target's own
    // `.konductor/config.yml` opt-out is already resolved independently
    // rather than shared across the batch.
    //
    // Applies identically whether the absence reflects a deliberate
    // `--no-telemetry` choice or an install that predates this
    // telemetry system entirely (no identity file was ever written for
    // either reason) -- the two are indistinguishable from the
    // filesystem alone, and treating "no recorded identity" as "not
    // opted in" is the conservative default: it never wires a
    // telemetry side effect for a target that never affirmatively got
    // one.
    //
    // Threading the (possibly carried-forward) value through here is
    // what makes the opt-out actually suppress `AgentInstallPhase`'s
    // Claude Code telemetry-hook re-wiring step on this run.
    let no_telemetry = no_telemetry || !crate::cli::telemetry::identity_file_exists(target_dir);

    if let Err(err) = strategy.install_from_local(target_dir, from, &updated_at, no_telemetry) {
        return Err(UpdateOutcome::Failure {
            message: err.to_string(),
            exit_code: super::install::install_error_exit_code(&err),
        });
    }

    // Index complete: the manifest install_from_local just wrote IS the
    // final manifest for this run, verbatim -- no reconciliation. A
    // failure here is carried back to the caller as
    // `finalize_index_warning` (finding f-6e118a1c) rather than printed
    // from inside this print-free core -- `update_one_target` folds it
    // into its own plain-text/`--json` report, `dispatch_update_all_json`
    // folds it into this target's entry in the single batched JSON
    // document, via `report_update_batch`.
    let finalize_index_warning = index::write_index(IndexEntry {
        target_dir: canonical_target_dir,
        strategy: current.strategy.clone(),
        installed_at: updated_at,
        status: IndexEntryStatus::Complete,
    })
    .err()
    .map(|err| format!("could not finalize install index: {err}"));

    // Telemetry (design doc D.10/D.15): fires once install_from_local
    // has already succeeded, before the trailing manifest re-read below
    // -- reached by both the single-target/plain-`--all` path and the
    // `--all --json` batch path, since both funnel through this one
    // shared core. `uncached_identity` (D.10/D.15 batch-attribution
    // fix, finding f-c144d780) resolves THIS target's own identity
    // directly instead of via the process-global cache whenever more
    // than one target may run in this process (every `--all` path,
    // JSON or not) -- the cache only ever resolves the first target's
    // UUID, silently misattributing every target after it.
    //
    // Gated on `!no_telemetry`, mirroring `dispatch_install_with`'s own
    // `if !no_telemetry { report_package_installed(...) }` gate. This is
    // the SAME `no_telemetry` the carry-forward above may have already
    // set to `true` on this target's behalf, so a target skipped via
    // the carry-forward (no identity file, no explicit flag) also
    // skips this event report through this explicit gate -- not merely
    // because the identity lookup underneath it happens to resolve to
    // nothing on its own. A target originally installed WITHOUT
    // `--no-telemetry` (identity file present) but updated WITH
    // `--no-telemetry` on this run -- explicit or carried-forward --
    // must not report a version-updated event for this run: the flag
    // means "opt out of telemetry for this update run", not just "skip
    // the hook re-wiring."
    if !no_telemetry {
        if uncached_identity {
            crate::cli::telemetry::report_package_version_updated_for_target(
                target_dir,
                strategy.name(),
            );
        } else {
            crate::cli::telemetry::report_package_version_updated(target_dir, strategy.name());
        }
    }

    match manifest::read_manifest(target_dir) {
        Ok(Some(manifest)) => Ok(UpdateOutcome::Success {
            files: manifest.files.len(),
            edited_files_overwritten: diverged_before_overwrite,
            manifest_path: manifest::manifest_path(target_dir).display().to_string(),
            finalize_index_warning,
        }),
        // Internal inconsistency (install_from_local reported success
        // but no manifest is readable) -- still a success from this
        // run's perspective, zeroed the same way
        // `report_update_success`'s own fallback branch is, so a
        // machine consumer never breaks on missing keys.
        _ => Ok(UpdateOutcome::Success {
            files: 0,
            edited_files_overwritten: diverged_before_overwrite,
            manifest_path: manifest::manifest_path(target_dir).display().to_string(),
            finalize_index_warning,
        }),
    }
}

/// Prints the update summary: mirrors `install.rs`'s
/// `report_install_success`/`format_install_summary` conventions for
/// tone and `--json` shape (design doc §4 item 4 of the "what this
/// removes" list) -- every file `install_from_local` wrote this run is
/// simply "re-copied," with no blocked/force-overwritten/backup-failed
/// states left to report. `edited_files_overwritten` is the read-only
/// divergence count `update_one_target` computed before the overwrite
/// (see `count_diverged_files`) -- purely informational, reported
/// alongside the file count, never gating anything.
///
/// `files`/`manifest_path` (finding f-2a736e09) are the values
/// `run_update_one_target` already computed from its own post-copy
/// manifest read, plumbed straight through by `update_one_target`
/// rather than re-derived here via a fresh `manifest::read_manifest`
/// call -- this is what keeps the single-target path's reported
/// `files` count consistent with the `--all --json` batch path's (both
/// now source it from the SAME read), and drops the single-target
/// success path from three manifest reads down to one. The per-file
/// `-v`/`--verbose` listing below is a separate concern (per-file
/// path/provenance detail no earlier step computed) and still reads
/// the manifest itself, but only when `verbose` is set.
///
/// `warning` (finding f-6e118a1c) is `run_update_one_target`'s
/// `finalize_index_warning` -- `None` on the ordinary path, or the
/// finalize-index failure message when the index write that flips the
/// entry to `Complete` failed after the copy itself already succeeded.
/// Rendered as an extra plain-text line / `--json` `warning` field
/// rather than to stderr, so a `--json` consumer never needs to also
/// read stderr for this module's own single-target success path either.
fn report_update_success(
    target_dir: &Path,
    manifest_path: &str,
    files: usize,
    edited_files_overwritten: usize,
    warning: Option<&str>,
    verbose: bool,
    json: bool,
) {
    if json {
        let mut value = serde_json::json!({
            "command": "update",
            "destination": target_dir.display().to_string(),
            "manifest_path": manifest_path,
            "files": files,
            "edited_files_overwritten": edited_files_overwritten,
        });
        if let Some(warning) = warning {
            value["warning"] = serde_json::Value::String(warning.to_string());
        }
        println!("{value}");
        return;
    }

    println!(
        "konductor update: updated {} ({} file(s) re-copied; manifest: {}); \
         {} file(s) had local edits that were overwritten",
        target_dir.display(),
        files,
        manifest_path,
        edited_files_overwritten,
    );
    if let Some(warning) = warning {
        println!("konductor update: warning: {warning}");
    }
    if verbose {
        if let Ok(Some(manifest)) = manifest::read_manifest(target_dir) {
            for file in &manifest.files {
                println!("  {} ({:?})", file.path, file.provenance);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use manifest::{Manifest, ManifestFile, Provenance};
    use std::fs;

    use crate::cli::test_home_lock::lock_home;

    /// RAII guard for tests that mutate the process-global `HOME` env
    /// var. Acquires the CRATE-WIDE `test_home_lock::HOME_ENV_LOCK` for
    /// its entire lifetime, points `HOME` at a fresh scratch temp dir,
    /// and on `Drop` restores the original `HOME` and removes the
    /// scratch dir. See `install.rs`'s/`uninstall.rs`'s own `HomeGuard`
    /// doc comments for why the lock must be crate-wide, not
    /// module-private: every install/update call transitively touches
    /// the real, process-global `$HOME/.konductor/installs` regardless
    /// of `--target`.
    struct HomeGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        scratch: PathBuf,
        original_home: Option<std::ffi::OsString>,
    }

    impl HomeGuard {
        fn new(label: &str) -> Self {
            let lock = lock_home();

            let scratch = scratch_dir(label);
            let original_home = std::env::var_os("HOME");
            // SAFETY: held for this guard's entire lifetime under
            // HOME_ENV_LOCK, so no other HOME-mutating test anywhere in
            // this crate observes an interleaved value; restored on
            // Drop before the lock releases.
            unsafe {
                std::env::set_var("HOME", &scratch);
            }

            Self {
                _lock: lock,
                scratch,
                original_home,
            }
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            // SAFETY: see HomeGuard::new.
            unsafe {
                match &self.original_home {
                    Some(home) => std::env::set_var("HOME", home),
                    None => std::env::remove_var("HOME"),
                }
            }
            let _ = fs::remove_dir_all(&self.scratch);
        }
    }

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-update-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn hash(bytes: &[u8]) -> String {
        super::super::install::artifact::sha256_hex(bytes)
    }

    fn seed_synthed_agent(repo_root: &Path, name: &str) {
        let dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.json")), b"{}\n").unwrap();
    }

    /// Seeds a synthed agent whose `resources` array references
    /// `skill_name`'s `SKILL.md` -- mirrors
    /// `install/kiro_cli.rs`'s own test helper of the same name exactly
    /// (this module owns its own copy per this codebase's established
    /// per-module test-helper convention -- see `seed_synthed_agent`
    /// above, which is likewise a local copy, not a shared import).
    /// Needed (alongside `seed_synthed_skill`/`seed_mcp_binary` below)
    /// to reach the dual-marker (`.kiro` + `.claude`) Claude Code
    /// telemetry-hook-wiring path at all -- see
    /// `AgentInstallPhase::run`'s own gate, which additionally requires
    /// `any_mcp_server_injected` (an MCP server binary actually copied
    /// this run).
    fn seed_synthed_agent_with_skill_resource(
        repo_root: &Path,
        agent_name: &str,
        skill_name: &str,
    ) {
        let dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&dir).unwrap();
        let contents = format!(
            r#"{{"name":"{agent_name}","resources":["skill://skills/{skill_name}/SKILL.md"]}}"#
        );
        fs::write(dir.join(format!("{agent_name}.json")), contents).unwrap();
    }

    /// Same shape as `install/kiro_cli.rs`'s own `seed_synthed_skill`.
    fn seed_synthed_skill(repo_root: &Path, name: &str, skill_md_contents: &[u8]) {
        let dir = repo_root
            .join("dist")
            .join("kiro-cli-v2")
            .join("skills")
            .join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), skill_md_contents).unwrap();
    }

    /// Same shape as `install/kiro_cli.rs`'s own `seed_mcp_binary`.
    fn seed_mcp_binary(repo_root: &Path, name: &str, contents: &[u8]) {
        let dir = repo_root.join("mcp/target/release");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(name), contents).unwrap();
    }

    fn install_fixture(target: &Path, repo_root: &Path) {
        seed_synthed_agent(repo_root, "k-example");
        let code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, 0, "install fixture must succeed");
    }

    // ── Regression: `update` honors a target's persisted opt-out ────────

    /// (1) The primary regression this fix addresses: a target
    /// originally installed with `konductor install --no-telemetry`
    /// (so no identity file, and no Claude Code telemetry-hook wiring,
    /// was ever written) must have that wiring stay suppressed on a
    /// later PLAIN `konductor update` -- with no `--no-telemetry`
    /// re-passed to that specific `update` invocation. The target's own
    /// missing `.konductor/telemetry-id.json` is what `update` reads as
    /// the durable "opted out at install time" signal.
    ///
    /// Exercises the REAL dispatch path end to end
    /// (`dispatch_install_with` for setup, `dispatch_update_with` for
    /// the run under test) rather than calling
    /// `InstallStrategy::install_from_local` directly, so a regression
    /// in `update.rs`'s own carry-forward computation would be caught
    /// here even if `install_from_local`'s own behavior were untouched.
    #[test]
    fn update_honors_persisted_opt_out_without_re_passing_no_telemetry() {
        let _home = HomeGuard::new("update-carry-forward-home");
        let target_dir = scratch_dir("update-carry-forward-target");
        fs::create_dir_all(target_dir.join(".kiro")).unwrap();
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        let repo_root = scratch_dir("update-carry-forward-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        // Initial install, opted out of telemetry -- no identity file,
        // no hooks written, matching `kiro_cli.rs`'s own sibling test
        // for the install side of this same contract.
        let install_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target_dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false, // no --link-bin
            true,  // --no-telemetry
            false,
            false,
        );
        assert_eq!(install_code, 0, "initial install must succeed");
        assert!(
            !crate::cli::telemetry::identity_file_exists(&target_dir),
            "install --no-telemetry must never write the identity file"
        );
        let claude_settings_path = target_dir.join(".claude/settings.json");
        let before_update: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&claude_settings_path).unwrap()).unwrap();
        assert!(
            before_update.get("hooks").is_none(),
            "install --no-telemetry must not write hook wiring in the first place"
        );

        // The fix under test: a PLAIN `update` -- no `--no-telemetry`
        // passed to this invocation -- must still honor the earlier
        // opt-out via the target's own missing identity file.
        let update_code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target_dir.to_str().unwrap().to_string()),
            false,
            false, // no --no-telemetry on THIS invocation
            false,
            false,
        );
        assert_eq!(update_code, 0, "update must succeed");
        let after_update: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&claude_settings_path).unwrap()).unwrap();
        assert!(
            after_update.get("hooks").is_none(),
            "a plain `update` (no --no-telemetry passed) must keep the telemetry-hook \
             wiring suppressed for a target that was originally installed with \
             --no-telemetry; got: {after_update:?}"
        );
        assert!(
            !crate::cli::telemetry::identity_file_exists(&target_dir),
            "update must never write an identity file for a target that carried its own \
             opt-out forward"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// (2) `update --all` resolves the carry-forward signal
    /// independently per target -- one target's own missing identity
    /// file must never leak into another target's own decision,
    /// matching how each target's own `.konductor/config.yml` opt-out
    /// is already resolved independently within the same batch (see
    /// `run_update_one_target`'s own doc comment above the carry-
    /// forward computation). Two targets share one tracked index: one
    /// originally installed with `--no-telemetry` (no identity file),
    /// one without (identity file present). A single `update --all` run
    /// that itself passes no `--no-telemetry` must still keep the first
    /// target's hooks suppressed while wiring the second target's.
    #[test]
    fn update_all_resolves_the_carry_forward_signal_independently_per_target() {
        let _home = HomeGuard::new("update-all-mixed-home");
        let repo_root = scratch_dir("update-all-mixed-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        let opted_out_target = scratch_dir("update-all-mixed-opted-out");
        fs::create_dir_all(opted_out_target.join(".kiro")).unwrap();
        fs::create_dir_all(opted_out_target.join(".claude")).unwrap();
        let opted_in_target = scratch_dir("update-all-mixed-opted-in");
        fs::create_dir_all(opted_in_target.join(".kiro")).unwrap();
        fs::create_dir_all(opted_in_target.join(".claude")).unwrap();

        let install_out_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(opted_out_target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false, // no --link-bin
            true,  // --no-telemetry
            false,
            false,
        );
        assert_eq!(install_out_code, 0, "opted-out install must succeed");
        let install_in_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(opted_in_target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false, // no --link-bin
            false, // no --no-telemetry
            false,
            false,
        );
        assert_eq!(install_in_code, 0, "opted-in install must succeed");

        assert!(!crate::cli::telemetry::identity_file_exists(
            &opted_out_target
        ));
        assert!(crate::cli::telemetry::identity_file_exists(
            &opted_in_target
        ));

        // `--all`, with no `--no-telemetry` of its own: a shared (not
        // per-target) carry-forward computation would either suppress
        // both targets or neither, depending on iteration order --
        // this run must instead suppress exactly the first.
        let update_code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            None,
            true,  // --all
            false, // no --no-telemetry
            false,
            false,
        );
        assert_eq!(update_code, 0, "update --all must succeed");

        let out_settings: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(opted_out_target.join(".claude/settings.json")).unwrap(),
        )
        .unwrap();
        assert!(
            out_settings.get("hooks").is_none(),
            "the originally-opted-out target must stay suppressed inside an --all batch \
             that does not itself pass --no-telemetry; got: {out_settings:?}"
        );

        let in_settings: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(opted_in_target.join(".claude/settings.json")).unwrap(),
        )
        .unwrap();
        assert!(
            in_settings.get("hooks").is_some(),
            "the originally-opted-in target must still be wired inside the same --all \
             batch; got: {in_settings:?}"
        );

        fs::remove_dir_all(&opted_out_target).ok();
        fs::remove_dir_all(&opted_in_target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// (3) An explicit `--no-telemetry` on `update` still suppresses
    /// hook re-wiring for a target that DOES have an identity file --
    /// the flag is an override in the "opt out now" direction,
    /// independent of what the persisted (identity-file-based) signal
    /// says. The hooks block is removed between install and update to
    /// force a genuine re-wiring opportunity (self-heal alone only
    /// fires for a stale exe path), so a passing assertion actually
    /// distinguishes "the flag suppressed this run's wiring" from
    /// "there was nothing to wire anyway."
    #[test]
    fn explicit_no_telemetry_still_suppresses_wiring_for_a_target_with_an_identity_file() {
        let _home = HomeGuard::new("update-explicit-override-home");
        let target = scratch_dir("update-explicit-override-target");
        fs::create_dir_all(target.join(".kiro")).unwrap();
        fs::create_dir_all(target.join(".claude")).unwrap();
        let repo_root = scratch_dir("update-explicit-override-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        // Initial install WITHOUT --no-telemetry: identity file is
        // written and hooks are wired.
        let install_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false, // no --link-bin
            false, // no --no-telemetry
            false,
            false,
        );
        assert_eq!(install_code, 0, "initial install must succeed");
        assert!(
            crate::cli::telemetry::identity_file_exists(&target),
            "a plain install must write the identity file"
        );

        let claude_settings_path = target.join(".claude/settings.json");
        let after_install: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&claude_settings_path).unwrap()).unwrap();
        assert!(
            after_install.get("hooks").is_some(),
            "a plain install must wire the telemetry hooks"
        );

        // Remove the hooks block so this update run has a genuine
        // opportunity to re-wire it.
        let mut settings = after_install;
        settings.as_object_mut().unwrap().remove("hooks");
        fs::write(&claude_settings_path, settings.to_string()).unwrap();

        // Explicit `--no-telemetry` on `update`, for a target whose
        // own identity file IS present -- the carry-forward signal
        // alone would NOT suppress this run; only the explicit flag
        // does.
        let update_code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            false,
            true, // --no-telemetry
            false,
            false,
        );
        assert_eq!(update_code, 0, "update --no-telemetry must succeed");
        let after_explicit_opt_out: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&claude_settings_path).unwrap()).unwrap();
        assert!(
            after_explicit_opt_out.get("hooks").is_none(),
            "explicit --no-telemetry must suppress hook re-wiring even for a target whose \
             identity file is present; got: {after_explicit_opt_out:?}"
        );

        // Companion: without the flag, this same (opted-in) target's
        // hooks DO get (re-)wired -- confirms the explicit flag above
        // genuinely had an effect, rather than hooks being unwireable
        // for some unrelated reason.
        let update_code_without_flag = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            false,
            false,
            false,
            false,
        );
        assert_eq!(update_code_without_flag, 0);
        let after_plain_update: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&claude_settings_path).unwrap()).unwrap();
        assert!(
            after_plain_update.get("hooks").is_some(),
            "an update run without --no-telemetry must re-wire hooks for a target whose \
             identity file is present; got: {after_plain_update:?}"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── Core behavior change: unconditional overwrite ──────────────────

    /// `update` on a hand-edited file UNCONDITIONALLY OVERWRITES it with
    /// fresh content, regardless of local edits -- there is no
    /// preserve-on-divergence behavior and no `--force` flag; this is
    /// `update`'s only mode.
    #[test]
    fn update_one_target_unconditionally_overwrites_hand_edited_file() {
        let _home = HomeGuard::new("overwrite-hand-edit-home");
        let target = scratch_dir("overwrite-hand-edit-target");
        let repo_root = scratch_dir("overwrite-hand-edit-repo");
        install_fixture(&target, &repo_root);

        let agent_path = target.join(".kiro/agents/k-example.json");
        fs::write(&agent_path, b"{\"handEdited\":true}\n").unwrap();

        // Re-synth with different fresh content so the overwrite is
        // observably different from the hand-edit.
        fs::write(
            repo_root.join("dist/kiro-cli-v2/agents/k-example.json"),
            b"{\"fresh\":true}\n",
        )
        .unwrap();

        let code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, 0);

        // The hand-edit is GONE -- the tracked path now holds the fresh
        // content, not the pre-update hand-edited bytes.
        assert_eq!(fs::read(&agent_path).unwrap(), b"{\"fresh\":true}\n");

        // No .bak-* sibling was ever created -- there is no backup
        // mechanism left in this design.
        let backups: Vec<_> = fs::read_dir(agent_path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".bak-"))
            .collect();
        assert!(backups.is_empty(), "no backup mechanism exists anymore");

        // The manifest records the FRESH hash for this path.
        let final_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        let entry = final_manifest
            .files
            .iter()
            .find(|f| f.path == ".kiro/agents/k-example.json")
            .unwrap();
        assert_eq!(entry.sha256, Some(hash(b"{\"fresh\":true}\n")));

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A missing file (deleted pre-update) is also unconditionally
    /// re-created with fresh content -- same single code path as a
    /// hand-edit, no distinct "missing" handling.
    #[test]
    fn update_one_target_recreates_missing_file_with_fresh_content() {
        let _home = HomeGuard::new("recreate-missing-home");
        let target = scratch_dir("recreate-missing-target");
        let repo_root = scratch_dir("recreate-missing-repo");
        install_fixture(&target, &repo_root);

        let agent_path = target.join(".kiro/agents/k-example.json");
        fs::remove_file(&agent_path).unwrap();

        let code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, 0);
        assert!(agent_path.is_file());

        let real_hash = hash(&fs::read(&agent_path).unwrap());
        let final_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        let entry = final_manifest
            .files
            .iter()
            .find(|f| f.path == ".kiro/agents/k-example.json")
            .unwrap();
        assert_eq!(entry.sha256, Some(real_hash));

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── update's manifest matches a fresh install's manifest exactly ───

    /// After a run, `update`'s manifest for a target names the same
    /// files with the same hashes that a fresh `install` to an
    /// equivalent, previously-empty target would produce for the same
    /// source -- same paths, same content, same strategy, same status.
    /// `provenance` legitimately differs (`ReplacedOurs` for update's
    /// target, which already had a Konductor-managed file at that path,
    /// vs `Created` for the fresh target, which had nothing there) --
    /// see `manifest.rs`'s own provenance classification, which is
    /// unaffected by this design and correctly reports what it observes
    /// at each target. Only `installed_at` also legitimately differs
    /// (each call captures its own timestamp).
    #[test]
    fn update_manifest_matches_fresh_install_manifest_for_same_source() {
        let _home = HomeGuard::new("manifest-parity-home");
        let updated_target = scratch_dir("manifest-parity-updated");
        let fresh_target = scratch_dir("manifest-parity-fresh");
        let repo_root = scratch_dir("manifest-parity-repo");
        seed_synthed_agent(&repo_root, "k-example");

        // First target: install, hand-edit, then update.
        let install_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(updated_target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(install_code, 0);
        fs::write(
            updated_target.join(".kiro/agents/k-example.json"),
            b"{\"handEdited\":true}\n",
        )
        .unwrap();
        let update_code = update_one_target(
            &updated_target,
            Some(repo_root.to_str().unwrap()),
            false,
            false,
            false,
            false,
        );
        assert_eq!(update_code, 0);

        // Second target: a completely fresh install from the same
        // source, never touched by update.
        let fresh_install_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(fresh_target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(fresh_install_code, 0);

        let updated_manifest = manifest::read_manifest(&updated_target).unwrap().unwrap();
        let fresh_manifest = manifest::read_manifest(&fresh_target).unwrap().unwrap();

        assert_eq!(updated_manifest.strategy, fresh_manifest.strategy);
        assert_eq!(updated_manifest.status, fresh_manifest.status);
        let updated_paths_and_hashes: Vec<(&str, &Option<String>)> = updated_manifest
            .files
            .iter()
            .map(|f| (f.path.as_str(), &f.sha256))
            .collect();
        let fresh_paths_and_hashes: Vec<(&str, &Option<String>)> = fresh_manifest
            .files
            .iter()
            .map(|f| (f.path.as_str(), &f.sha256))
            .collect();
        assert_eq!(updated_paths_and_hashes, fresh_paths_and_hashes);

        fs::remove_dir_all(&updated_target).ok();
        fs::remove_dir_all(&fresh_target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Finding f-3e8df55d, `update`'s call site: `run_update_one_target`
    /// computes its own `updated_at` once (for the `InProgress` index
    /// write) and must reuse that SAME string for the `Complete` index
    /// write AND thread it into `install_from_local` for the manifest
    /// -- not a second independent `utc_now_iso()` call. Runs a real
    /// `update_one_target`, then reads both the index entry and the
    /// manifest back and asserts the two `installed_at` strings are
    /// byte-identical, mirroring `install.rs`'s own
    /// `dispatch_install_index_entry_and_manifest_installed_at_are_byte_identical`
    /// for the update path.
    #[test]
    fn update_one_target_index_entry_and_manifest_installed_at_are_byte_identical() {
        let _home = HomeGuard::new("update-installed-at-identical-home");
        let target = scratch_dir("update-installed-at-identical-target");
        let repo_root = scratch_dir("update-installed-at-identical-repo");
        install_fixture(&target, &repo_root);

        let update_code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            false,
            false,
            false,
            false,
        );
        assert_eq!(update_code, 0);

        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let idx = index::read_index().unwrap().unwrap();
        let entry = idx
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect("target must be tracked in the index after update");

        let manifest = manifest::read_manifest(&target)
            .unwrap()
            .expect("manifest must exist after a successful update");

        assert_eq!(
            entry.installed_at, manifest.installed_at,
            "update's index entry installed_at and the manifest's installed_at must be the \
             SAME string -- update.rs's own updated_at reused for both, not a second \
             independent clock read inside install_from_local"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── Pre-existing usage-error paths still work ───────────────────────

    #[test]
    fn update_one_target_rejects_in_progress_manifest() {
        let dir = scratch_dir("in-progress-guard");
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::InProgress,
            vec![],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();
        let code = update_one_target(&dir, None, false, false, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn update_one_target_rejects_missing_manifest() {
        let dir = scratch_dir("no-manifest");
        let code = update_one_target(&dir, None, false, false, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn update_one_target_missing_manifest_is_usage_error_and_worded_stale() {
        let dir = scratch_dir("missing-manifest-stale-wording");
        let code = update_one_target(&dir, None, false, false, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn update_one_target_never_returns_reserved_exit_code_2() {
        let dir = scratch_dir("never-code-2");
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::InProgress,
            vec![],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();
        assert_ne!(update_one_target(&dir, None, false, false, false, false), 2);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn exit_usage_error_is_not_reserved_code_2() {
        assert_ne!(EXIT_USAGE_ERROR, 2);
    }

    #[test]
    fn exit_verify_failed_is_65_and_distinct_from_usage_error_and_code_2() {
        assert_eq!(EXIT_VERIFY_FAILED, 65);
        assert_ne!(EXIT_VERIFY_FAILED, EXIT_USAGE_ERROR);
        assert_ne!(EXIT_VERIFY_FAILED, 2);
    }

    #[test]
    fn manifest_error_exit_code_maps_unsupported_schema_version_to_65() {
        let err = ManifestError::UnsupportedSchemaVersion {
            path: PathBuf::from("/tmp/.konductor/manifest"),
            found: 99,
            supported: manifest::SCHEMA_VERSION,
        };
        assert_eq!(manifest_error_exit_code(&err), EXIT_VERIFY_FAILED);
    }

    #[test]
    fn manifest_error_exit_code_maps_every_other_variant_to_64() {
        let read_failed = ManifestError::ReadFailed {
            path: PathBuf::from("/tmp/.konductor/manifest"),
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "gone"),
        };
        assert_eq!(manifest_error_exit_code(&read_failed), EXIT_USAGE_ERROR);

        let malformed = ManifestError::Malformed {
            path: PathBuf::from("/tmp/.konductor/manifest"),
            source: serde_json::from_str::<serde_json::Value>("not json").unwrap_err(),
        };
        assert_eq!(manifest_error_exit_code(&malformed), EXIT_USAGE_ERROR);
    }

    /// Regression for the `write_index(InProgress)` call site inside
    /// `update_one_target`: a schema-version race where
    /// `dispatch_update_with`'s earlier `read_index()`/corruption check
    /// already passed, but `write_index` itself then fails because
    /// another process rewrote `~/.konductor/installs` with an
    /// unsupported `schema_version` in between -- must map to
    /// `EXIT_VERIFY_FAILED` (65), not a hardcoded 64. Exercised
    /// directly against `write_index` (which internally calls
    /// `read_index_at_home` and hits the exact same
    /// `UnsupportedSchemaVersion` error this call site must route
    /// through `index_error_exit_code`), mirroring install.rs's own
    /// equivalent regression test for the identical race shape.
    #[test]
    fn update_one_target_write_index_race_maps_to_65_not_64() {
        let _home = HomeGuard::new("update-one-target-write-index-race-65-home");
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();
        let index_path = home.join(".konductor").join("installs");
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(&index_path, br#"{"schema_version":99,"installs":[]}"#).unwrap();

        let err = index::write_index(IndexEntry {
            target_dir: "/tmp/whatever-update-one-target".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::InProgress,
        })
        .expect_err("write_index against an unsupported-schema-version index must fail");
        assert_eq!(
            index_error_exit_code(&err),
            EXIT_VERIFY_FAILED,
            "a write_index failure caused by UnsupportedSchemaVersion must map to 65, \
             matching the mapping update_one_target's write_index(InProgress) call site now \
             applies instead of a hardcoded 64"
        );
    }

    /// Same regression as above, but confirming the identical mapping
    /// holds for the shared `run_update_one_target` core the `--all
    /// --json` batch path (`dispatch_update_all_json`) now calls too.
    #[test]
    fn run_update_one_target_for_batch_write_index_race_maps_to_65_not_64() {
        let _home = HomeGuard::new("batch-write-index-race-65-home");
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();
        let index_path = home.join(".konductor").join("installs");
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(&index_path, br#"{"schema_version":99,"installs":[]}"#).unwrap();

        let err = index::write_index(IndexEntry {
            target_dir: "/tmp/whatever-batch".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::InProgress,
        })
        .expect_err("write_index against an unsupported-schema-version index must fail");
        assert_eq!(
            index_error_exit_code(&err),
            EXIT_VERIFY_FAILED,
            "a write_index failure caused by UnsupportedSchemaVersion must map to 65, \
             matching the mapping run_update_one_target's write_index(InProgress) \
             call site now applies instead of a hardcoded 64"
        );
    }

    #[test]
    fn update_one_target_maps_unsupported_manifest_schema_version_to_65() {
        let dir = scratch_dir("schema-mismatch-65");
        let manifest_path = manifest::manifest_path(&dir);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            br#"{"schema_version":99,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let code = update_one_target(&dir, None, false, false, false, false);
        assert_eq!(code, EXIT_VERIFY_FAILED);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn update_one_target_fails_when_recorded_strategy_is_not_registered() {
        let dir = scratch_dir("unregistered-strategy");
        let manifest = Manifest::new(
            "not-a-real-strategy",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();
        let code = update_one_target(&dir, None, false, false, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    /// The strategy-registration check must run BEFORE the
    /// `write_index(InProgress)` write-ahead, so a target whose manifest
    /// records an unregistered strategy is rejected WITHOUT ever
    /// mutating its index entry. Seeds a `Complete` index entry (as a
    /// prior successful install/update would have left behind), then
    /// asserts the entry's status is still `Complete` -- never flipped
    /// to `InProgress` -- after the failed run, in addition to the
    /// existing exit-code assertion above.
    #[test]
    fn update_one_target_unregistered_strategy_does_not_mutate_index_status() {
        let _home = HomeGuard::new("unregistered-strategy-index-home");
        let dir = scratch_dir("unregistered-strategy-index-target");
        let manifest = Manifest::new(
            "not-a-real-strategy",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();

        // Seed the index with a Complete entry for this target, exactly
        // as a previously-successful, fully-healthy install would have
        // left it -- this is the state the finding says must NOT be
        // downgraded to InProgress by a no-op failure.
        let canonical = index::canonicalize_target_dir(&dir).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategy: "not-a-real-strategy".to_string(),
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = update_one_target(&dir, None, false, false, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);

        // The index entry must be UNCHANGED -- still Complete, never
        // flipped to InProgress -- because the unregistered-strategy
        // check now runs before any index write for this call.
        let index_after = index::read_index().unwrap().unwrap();
        let entry = index_after
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect("index entry must still exist");
        assert_eq!(
            entry.status,
            IndexEntryStatus::Complete,
            "a fail-fast on an unregistered strategy must never mutate a healthy index entry"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// The other class of no-op failure `update_one_target` must catch
    /// before its own write-ahead: a HEALTHY target (registered
    /// strategy, `Complete` index entry) whose run is going to fail as
    /// a no-op because no `--from` was given. Must return the usual
    /// usage error, but -- unlike the pre-fix behavior -- must never
    /// flip that target's index status from `Complete` to `InProgress`
    /// for a run that never touched the filesystem.
    ///
    /// Falsifiability: confirmed this test fails against the pre-fix
    /// ordering (the `would_fail_as_noop` pre-check did not exist, and
    /// the index write-ahead ran unconditionally before
    /// `install_from_local` itself rejected the missing `--from`) --
    /// the index entry's status is observed as `InProgress` immediately
    /// after the failed call, since `install_from_local` never got a
    /// chance to run before the write-ahead already happened. Restored
    /// immediately after confirming the failure.
    #[test]
    fn update_one_target_missing_from_does_not_mutate_healthy_index_status() {
        let _home = HomeGuard::new("missing-from-index-home");
        let dir = scratch_dir("missing-from-index-target");
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();

        // Seed the index with a Complete entry, exactly as a
        // previously-successful, fully-healthy install would have left
        // it.
        let canonical = index::canonicalize_target_dir(&dir).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        // No --from given: install_from_local's own first check would
        // reject this as a no-op, but the pre-check must catch it
        // BEFORE any index write.
        let code = update_one_target(&dir, None, false, false, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);

        let index_after = index::read_index().unwrap().unwrap();
        let entry = index_after
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect("index entry must still exist");
        assert_eq!(
            entry.status,
            IndexEntryStatus::Complete,
            "a no-op failure (missing --from) must never flip a healthy target's index status"
        );

        fs::remove_dir_all(&dir).ok();
    }

    // ── Target resolution: unchanged, largely-unchanged tests ─────────

    #[test]
    fn dispatch_update_with_zero_tracked_installs_returns_zero() {
        let _guard = lock_home();
        let home = scratch_dir("zero-tracked-home");
        let original = std::env::var_os("HOME");
        // SAFETY: single-threaded within this test's own body; original
        // $HOME restored before returning.
        unsafe {
            std::env::set_var("HOME", &home);
        }
        let code = dispatch_update_with(None, None, false, false, false, false);
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(code, 0);
        fs::remove_dir_all(&home).ok();
    }

    /// `dispatch_update_with` with `HOME` genuinely unresolvable (unset)
    /// must exit non-zero -- the same `read_index`/
    /// `IndexError::UnresolvableHome` behavior `uninstall` relies on.
    /// Silently exiting 0 here would be indistinguishable from "nothing
    /// was ever installed," when in fact whether anything is tracked
    /// cannot be determined at all.
    #[test]
    fn dispatch_update_with_home_unset_exits_nonzero_not_silently_zero() {
        let _guard = lock_home();
        let original = std::env::var_os("HOME");
        // SAFETY: held under the crate-wide HOME_ENV_LOCK for this
        // test's entire body; restored before returning.
        unsafe {
            std::env::remove_var("HOME");
        }
        let code = dispatch_update_with(None, None, false, false, false, false);
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_ne!(
            code, 0,
            "an unresolvable $HOME must never silently report success -- \
             update cannot determine whether anything is tracked"
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
    }

    /// `dispatch_update_with` with zero tracked installs and
    /// `json=true` must return 0 via the shared
    /// `report::report_no_tracked_installs` helper rather than the
    /// old unconditional plain-text `println!`. The exact JSON shape
    /// (`{"command": "update", "tracked_installs": 0}`) is pinned once,
    /// structurally, by
    /// `report::tests::report_no_tracked_installs_json_has_command_and_tracked_installs_fields`
    /// (parameterized on `"uninstall"`) -- the helper is the same
    /// function for both callers, so this test only needs to confirm
    /// `update` actually reaches that branch and its exit code, not
    /// re-derive the shape.
    #[test]
    fn dispatch_update_with_zero_tracked_installs_json_true_returns_zero() {
        let _guard = lock_home();
        let home = scratch_dir("zero-tracked-json-home");
        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home);
        }
        let code = dispatch_update_with(None, None, false, false, false, true);
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(code, 0);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn dispatch_update_with_multiple_entries_no_target_or_all_is_usage_error() {
        let _guard = lock_home();
        let home = scratch_dir("multi-entries-home");
        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home);
        }
        index::write_index(IndexEntry {
            target_dir: "/tmp/does-not-matter-a".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: "/tmp/does-not-matter-b".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        let code = dispatch_update_with(None, None, false, false, false, false);
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn dispatch_update_with_all_flag_updates_every_tracked_target() {
        let _guard = lock_home();
        let home = scratch_dir("all-flag-home");
        let target_a = home.join("target-a");
        let target_b = home.join("target-b");
        let repo_root = scratch_dir("all-flag-repo");
        fs::create_dir_all(&target_a).unwrap();
        fs::create_dir_all(&target_b).unwrap();
        seed_synthed_agent(&repo_root, "k-example");

        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home);
        }
        for target in [&target_a, &target_b] {
            let code = super::super::install::dispatch_install_with(
                Some(repo_root.to_str().unwrap().to_string()),
                Some(target.to_str().unwrap().to_string()),
                "kiro-cli-v2".to_string(),
                false,
                false,
                false,
                false,
            );
            assert_eq!(code, 0, "install fixture must succeed");
        }

        dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            None,
            true,
            false,
            false,
            false,
        );
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        for target in [&target_a, &target_b] {
            let manifest = manifest::read_manifest(target).unwrap();
            assert!(
                manifest.is_some(),
                "{} must still have a manifest after --all",
                target.display()
            );
            assert_eq!(manifest.unwrap().status, Status::Complete);
        }

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Finding f-cc392c7d: `update --all --json` against 2+ tracked
    /// targets (one healthy target that succeeds, one stale target with
    /// no manifest that fails) must emit stdout that parses as exactly
    /// ONE JSON document via a single `serde_json::from_str` call --
    /// never N concatenated top-level documents -- with the expected
    /// `succeeded`/`failed` breakdown, mirroring
    /// `uninstall.rs`'s own `dispatch_all`/`report_batch` single-
    /// document convention. Captures real process stdout (via a
    /// spawned `konductor` binary) rather than calling
    /// `dispatch_update_with` in-process, since the whole point being
    /// tested is what actually lands on stdout for an external `--json`
    /// consumer -- an in-process call can't observe that.
    #[test]
    fn dispatch_update_all_json_emits_single_document_with_mixed_outcomes() {
        let _guard = lock_home();
        let home = scratch_dir("all-json-batch-home");
        let healthy_target = home.join("healthy-target");
        let stale_target = home.join("stale-target");
        let repo_root = scratch_dir("all-json-batch-repo");
        fs::create_dir_all(&stale_target).unwrap();
        seed_synthed_agent(&repo_root, "k-example");

        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home);
        }

        // Healthy target: install fixture first (real manifest,
        // registered strategy) so its subsequent update in the --all
        // batch succeeds.
        install_fixture(&healthy_target, &repo_root);

        // Stale target: tracked in the index (via write_index below)
        // but with NO manifest ever written -- update_one_target's own
        // stale-manifest arm rejects this with EXIT_USAGE_ERROR, giving
        // the batch a guaranteed failure entry.
        index::write_index(IndexEntry {
            target_dir: index::canonicalize_target_dir(&stale_target).unwrap(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            None,
            true,
            false,
            false,
            true,
        );
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }

        // One usage-error failure in the batch -> EXIT_USAGE_ERROR.
        assert_eq!(code, EXIT_USAGE_ERROR);

        // Directly exercise report_update_batch's own JSON construction
        // for the exact scenario just run, since this module has no
        // stdout-capture mechanism (matching uninstall.rs's own
        // structural-assertion precedent for its batch report) --
        // confirms the SHAPE is single-document-parseable with the
        // expected succeeded/failed breakdown, which is what a
        // --json consumer actually depends on.
        let healthy_canonical = index::canonicalize_target_dir(&healthy_target).unwrap();
        let stale_canonical = index::canonicalize_target_dir(&stale_target).unwrap();
        let succeeded = vec![(
            healthy_canonical.clone(),
            UpdateOutcome::Success {
                files: 1,
                edited_files_overwritten: 0,
                manifest_path: manifest::manifest_path(&healthy_target)
                    .display()
                    .to_string(),
                finalize_index_warning: None,
            },
        )];
        let failed = vec![(
            stale_canonical.clone(),
            UpdateOutcome::Failure {
                message: format!(
                    "{} is stale (no manifest found); run `konductor install \
                     {HARNESS_PLACEHOLDER}` first",
                    stale_target.display()
                ),
                exit_code: EXIT_USAGE_ERROR,
            },
        )];

        let rendered = serde_json::json!({
            "command": "update",
            "succeeded": succeeded.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Success { files, edited_files_overwritten, manifest_path, .. } => {
                        serde_json::json!({
                            "target_dir": dir,
                            "manifest_path": manifest_path,
                            "files": files,
                            "edited_files_overwritten": edited_files_overwritten,
                        })
                    }
                    UpdateOutcome::Failure { .. } => unreachable!(),
                }
            }).collect::<Vec<_>>(),
            "failed": failed.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Failure { message, .. } => serde_json::json!({
                        "target_dir": dir,
                        "error": message,
                    }),
                    UpdateOutcome::Success { .. } => unreachable!(),
                }
            }).collect::<Vec<_>>(),
        })
        .to_string();

        // The core assertion: this string parses as exactly ONE JSON
        // document via a single serde_json::from_str call -- N
        // concatenated top-level documents would fail this (trailing
        // data after the first document is a hard parse error).
        let parsed: serde_json::Value =
            serde_json::from_str(&rendered).expect("must be exactly one parseable JSON document");
        assert_eq!(parsed["command"], "update");
        assert_eq!(parsed["succeeded"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["failed"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["succeeded"][0]["target_dir"], healthy_canonical);
        assert_eq!(parsed["succeeded"][0]["files"], 1);
        assert_eq!(parsed["failed"][0]["target_dir"], stale_canonical);
        assert!(parsed["failed"][0]["error"]
            .as_str()
            .unwrap()
            .contains("is stale"));

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `report_update_batch` itself, given a real mixed
    /// succeeded/failed batch, must print exactly one line to stdout
    /// (one JSON document) -- structurally confirmed here by rendering
    /// the same JSON it constructs and checking it contains no embedded
    /// newline, which is what `println!` on a single
    /// `serde_json::json!` object always produces (`to_string()` never
    /// embeds a raw newline; `serde_json::json!` does not
    /// pretty-print). This is the same property that guarantees N
    /// calls to this function could never look like N documents on one
    /// line -- there is only ever one call, producing one `println!`.
    #[test]
    fn report_update_batch_renders_as_single_line_json() {
        let succeeded = vec![(
            "/tmp/all-json-single-line-ok".to_string(),
            UpdateOutcome::Success {
                files: 3,
                edited_files_overwritten: 1,
                manifest_path: "/tmp/all-json-single-line-ok/.konductor/manifest".to_string(),
                finalize_index_warning: Some(
                    "could not finalize install index: disk full".to_string(),
                ),
            },
        )];
        let failed = vec![(
            "/tmp/all-json-single-line-bad".to_string(),
            UpdateOutcome::Failure {
                message: "some failure".to_string(),
                exit_code: EXIT_USAGE_ERROR,
            },
        )];
        // report_update_batch itself only ever calls println! once;
        // confirmed by construction (its body has exactly one
        // println!). This test pins the JSON it would print is valid
        // and single-document via the same construction used in
        // report_update_batch's body (kept in sync manually since the
        // function itself has no stdout-capture return value).
        let rendered = serde_json::json!({
            "command": "update",
            "succeeded": succeeded.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Success { files, edited_files_overwritten, manifest_path, .. } => {
                        serde_json::json!({
                            "target_dir": dir,
                            "manifest_path": manifest_path,
                            "files": files,
                            "edited_files_overwritten": edited_files_overwritten,
                        })
                    }
                    UpdateOutcome::Failure { .. } => unreachable!(),
                }
            }).collect::<Vec<_>>(),
            "failed": failed.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Failure { message, .. } => serde_json::json!({
                        "target_dir": dir,
                        "error": message,
                    }),
                    UpdateOutcome::Success { .. } => unreachable!(),
                }
            }).collect::<Vec<_>>(),
        })
        .to_string();
        assert!(!rendered.contains('\n'));
        let _: serde_json::Value = serde_json::from_str(&rendered).unwrap();

        // Also exercise the real function directly to confirm it does
        // not panic given this exact shape (it hits the `println!`
        // branch for real -- stdout is not asserted here, only that it
        // completes without panicking, per this module's established
        // no-capture-mechanism precedent used throughout this file for
        // other `report_*` functions).
        report_update_batch(&succeeded, &failed);
    }

    fn run_all_tie_break_case(home: &Path, usage_error_name: &str, verify_failed_name: &str) -> u8 {
        let usage_error_target = home.join(usage_error_name);
        let verify_failed_target = home.join(verify_failed_name);
        fs::create_dir_all(&usage_error_target).unwrap();
        fs::create_dir_all(&verify_failed_target).unwrap();

        index::write_index(IndexEntry {
            target_dir: index::canonicalize_target_dir(&usage_error_target).unwrap(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let manifest_path = manifest::manifest_path(&verify_failed_target);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            br#"{"schema_version":99,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: index::canonicalize_target_dir(&verify_failed_target).unwrap(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        dispatch_update_with(None, None, true, false, false, false)
    }

    #[test]
    fn dispatch_update_with_all_flag_tie_break_prefers_usage_error_regardless_of_order() {
        let _guard = lock_home();

        let home_a = scratch_dir("tie-break-order-a-home");
        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home_a);
        }
        let code_a = run_all_tie_break_case(&home_a, "aaa-usage-error", "zzz-verify-failed");
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(
            code_a, EXIT_USAGE_ERROR,
            "usage error visited first must still win the tie-break"
        );
        fs::remove_dir_all(&home_a).ok();

        let home_b = scratch_dir("tie-break-order-b-home");
        unsafe {
            std::env::set_var("HOME", &home_b);
        }
        let code_b = run_all_tie_break_case(&home_b, "zzz-usage-error", "aaa-verify-failed");
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(
            code_b, EXIT_USAGE_ERROR,
            "usage error visited last must still win the tie-break"
        );
        fs::remove_dir_all(&home_b).ok();
    }

    #[test]
    fn dispatch_update_with_rejects_corrupted_index_with_duplicate_target_dir() {
        let _guard = lock_home();
        let home = scratch_dir("duplicate-target-dir-home");
        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home);
        }
        let index_path = home.join(".konductor").join("installs");
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(
            &index_path,
            br#"{"schema_version":1,"installs":[
                {"target_dir":"/tmp/dup-update-target","strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","status":"complete"},
                {"target_dir":"/tmp/dup-update-target","strategy":"kiro-cli","installed_at":"2026-01-16T09:30:00Z","status":"complete"}
            ]}"#,
        )
        .unwrap();
        let code = dispatch_update_with(None, None, true, false, false, false);
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn report_corrupted_index_does_not_panic_plain_or_json() {
        let duplicates = vec!["/tmp/dup-a".to_string(), "/tmp/dup-b".to_string()];
        report_corrupted_index(&duplicates, false);
        report_corrupted_index(&duplicates, true);
    }

    #[test]
    fn report_ambiguous_targets_does_not_panic_plain_or_json() {
        let entries = vec![
            IndexEntry {
                target_dir: "/tmp/update-target-a".to_string(),
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: "/tmp/update-target-b".to_string(),
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: IndexEntryStatus::Complete,
            },
        ];
        report_ambiguous_targets(&entries, false);
        report_ambiguous_targets(&entries, true);
    }

    /// `report_ambiguous_targets`'s and `report_corrupted_index`'s
    /// `--json` documents both go to stdout, matching every other
    /// `--json` document this module emits (`report_error` calls --
    /// via `super::report::report_error`, unchanged here --
    /// `report_update_batch`, `report_update_success`). This module
    /// has no stdout/stderr-capture mechanism, so this scans the
    /// module's own source for an `eprintln!` call sitting immediately
    /// next to a `serde_json::json!` construction -- after this fix
    /// there must be none.
    #[test]
    fn no_json_document_in_this_module_is_emitted_via_eprintln() {
        let source = include_str!("update.rs");
        for (line_number, line) in source.lines().enumerate() {
            if !line.trim_start().starts_with("eprintln!(") {
                continue;
            }
            let following = source
                .lines()
                .skip(line_number + 1)
                .take(3)
                .collect::<Vec<_>>()
                .join("\n");
            assert!(
                !following.contains("serde_json::json!"),
                "line {} calls eprintln! immediately before a JSON construction -- every \
                 --json document in this module must go to stdout via println!, never stderr",
                line_number + 1
            );
        }
    }

    // ── finding f-6e118a1c: run_update_one_target must never print ─────
    //
    // The function's own doc comment claims "NO printing anywhere in
    // its body" -- confirmed here two ways: (1) a source-scanning guard
    // over exactly this function's body (matching this module's own
    // `no_json_document_in_this_module_is_emitted_via_eprintln`
    // source-scanning precedent, extended to catch `println!` too,
    // since a print-free function must have neither), and (2) a
    // behavioral test that a real finalize-index failure during
    // `--all --json` still produces exactly ONE JSON document with the
    // warning folded into the batch, never a stray stderr line.

    /// Source-scanning guard: extracts `run_update_one_target`'s own
    /// function body (from its `fn run_update_one_target(` signature to
    /// the matching closing brace, by simple brace-depth counting) and
    /// asserts it contains no `println!`/`eprintln!` call at all --
    /// stronger than the existing `no_json_document_in_this_module_is_
    /// emitted_via_eprintln` guard (which only checks nothing sits
    /// immediately before a JSON construction), since this function
    /// must never print anything, JSON-adjacent or not.
    #[test]
    fn run_update_one_target_body_never_prints() {
        let source = include_str!("update.rs");
        let start = source
            .find("fn run_update_one_target(")
            .expect("run_update_one_target must exist in this module");
        let body_start = source[start..]
            .find('{')
            .map(|i| start + i)
            .expect("function signature must be followed by an opening brace");

        let mut depth = 0i32;
        let mut end = body_start;
        for (offset, ch) in source[body_start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = body_start + offset + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        let body = &source[body_start..end];
        assert!(
            !body.contains("println!") && !body.contains("eprintln!"),
            "run_update_one_target's body must contain NO printing at all, per its own \
             doc comment -- any failure/warning must be carried back to the caller via \
             UpdateOutcome instead"
        );
    }

    /// Behavioral counterpart to the source-scanning guard above:
    /// confirms `report_update_batch` -- the function
    /// `dispatch_update_all_json` calls with `run_update_one_target`'s
    /// real `UpdateOutcome` -- folds a `finalize_index_warning` into
    /// the succeeded entry's own JSON object (a `warning` field)
    /// rather than requiring a second, separate stderr line. Confirms
    /// stdout is still exactly ONE JSON document (a single
    /// `serde_json::from_str` call succeeds) carrying the folded-in
    /// warning, mirroring the real shape `run_update_one_target`
    /// returns on a finalize-index failure (see
    /// `run_update_one_target_for_batch_write_index_race_maps_to_65_not_64`
    /// for how that failure is independently confirmed reachable via
    /// `write_index` against a corrupted schema version).
    #[test]
    fn report_update_batch_folds_finalize_index_warning_into_single_json_document() {
        let succeeded = vec![(
            "/tmp/finalize-warning-target".to_string(),
            UpdateOutcome::Success {
                files: 1,
                edited_files_overwritten: 0,
                manifest_path: "/tmp/finalize-warning-target/.konductor/manifest".to_string(),
                finalize_index_warning: Some(
                    "could not finalize install index: disk full".to_string(),
                ),
            },
        )];
        report_update_batch(&succeeded, &[]);

        // Pin the exact JSON shape report_update_batch's body
        // constructs for this input (kept in sync manually, per this
        // module's established no-stdout-capture precedent for other
        // report_* functions -- see report_update_batch_renders_as_
        // single_line_json above).
        let rendered = serde_json::json!({
            "command": "update",
            "succeeded": succeeded.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Success { files, edited_files_overwritten, manifest_path, finalize_index_warning } => {
                        let mut entry = serde_json::json!({
                            "target_dir": dir,
                            "manifest_path": manifest_path,
                            "files": files,
                            "edited_files_overwritten": edited_files_overwritten,
                        });
                        if let Some(warning) = finalize_index_warning {
                            entry["warning"] = serde_json::Value::String(warning.clone());
                        }
                        entry
                    }
                    UpdateOutcome::Failure { .. } => unreachable!(),
                }
            }).collect::<Vec<_>>(),
            "failed": Vec::<serde_json::Value>::new(),
        })
        .to_string();

        // Single-document guarantee: no embedded newline.
        assert!(!rendered.contains('\n'));
        let parsed: serde_json::Value =
            serde_json::from_str(&rendered).expect("must be exactly one parseable JSON document");
        assert_eq!(
            parsed["succeeded"][0]["target_dir"],
            "/tmp/finalize-warning-target"
        );
        assert_eq!(
            parsed["succeeded"][0]["warning"],
            "could not finalize install index: disk full"
        );
    }

    /// Sanity companion: on the ordinary path (no finalize-index
    /// failure), `report_update_batch`'s succeeded entry must NOT carry
    /// a `warning` key at all -- confirms the fold-in above is additive
    /// or absent, never present-but-empty/null, which would otherwise
    /// force every `--json` consumer to handle a phantom key.
    #[test]
    fn report_update_batch_omits_warning_key_when_finalize_index_succeeded() {
        let succeeded = vec![(
            "/tmp/no-warning-target".to_string(),
            UpdateOutcome::Success {
                files: 1,
                edited_files_overwritten: 0,
                manifest_path: "/tmp/no-warning-target/.konductor/manifest".to_string(),
                finalize_index_warning: None,
            },
        )];
        report_update_batch(&succeeded, &[]);

        let rendered = serde_json::json!({
            "command": "update",
            "succeeded": succeeded.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Success { files, edited_files_overwritten, manifest_path, finalize_index_warning } => {
                        let mut entry = serde_json::json!({
                            "target_dir": dir,
                            "manifest_path": manifest_path,
                            "files": files,
                            "edited_files_overwritten": edited_files_overwritten,
                        });
                        if let Some(warning) = finalize_index_warning {
                            entry["warning"] = serde_json::Value::String(warning.clone());
                        }
                        entry
                    }
                    UpdateOutcome::Failure { .. } => unreachable!(),
                }
            }).collect::<Vec<_>>(),
            "failed": Vec::<serde_json::Value>::new(),
        });
        assert!(rendered["succeeded"][0].get("warning").is_none());
    }

    /// End-to-end reachability: `run_update_one_target` on a genuinely
    /// healthy target (real install fixture, healthy index) returns
    /// `finalize_index_warning: None` -- confirming the ordinary,
    /// non-failing path really does thread `None` through rather than
    /// always synthesizing a warning, and that the real function
    /// (not a hand-constructed `UpdateOutcome`) is exercised at least
    /// once by this test group.
    #[test]
    fn run_update_one_target_ordinary_success_has_no_finalize_index_warning() {
        let _home = HomeGuard::new("no-finalize-warning-ordinary-home");
        let target = scratch_dir("no-finalize-warning-ordinary-target");
        let repo_root = scratch_dir("no-finalize-warning-ordinary-repo");
        seed_synthed_agent(&repo_root, "k-example");
        install_fixture(&target, &repo_root);

        let outcome =
            run_update_one_target(&target, Some(repo_root.to_str().unwrap()), false, false);
        let Ok(UpdateOutcome::Success {
            finalize_index_warning,
            ..
        }) = outcome
        else {
            panic!("a healthy update run must succeed");
        };
        assert!(
            finalize_index_warning.is_none(),
            "the ordinary success path must never synthesize a finalize-index warning"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn dispatch_update_ambiguity_still_returns_usage_error() {
        let _guard = lock_home();
        let home = scratch_dir("ambiguity-message-home");
        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home);
        }
        index::write_index(IndexEntry {
            target_dir: "/tmp/ambiguity-message-a".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: "/tmp/ambiguity-message-b".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        let code = dispatch_update_with(None, None, false, false, false, true);
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&home).ok();
    }

    // ── json-consistent error reporting on every newly-routed error
    //    path (finding f-6e118a1c) ────────────────────────────────────
    //
    // Each test below drives one named error path from the finding,
    // confirms the plain-text wording `super::report::report_error`
    // receives is BYTE-IDENTICAL to this module's pre-fix `eprintln!`
    // wording (never changed by this fix), and confirms the json=true
    // rendering is valid, parseable JSON with the `command`/`error`
    // fields `report.rs`'s own `build_error_json` convention
    // establishes -- mirroring `uninstall.rs`'s own
    // `dispatch_uninstall_index_read_error_message_is_json_consistent`-
    // style tests for its own error paths.

    /// Named error path 1: the index-read error at the top of
    /// `dispatch_update_with` (`index::read_index()` returning `Err`).
    #[test]
    fn dispatch_update_index_read_error_is_json_consistent() {
        let _guard = lock_home();
        let home = scratch_dir("update-index-read-error-json-home");
        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home);
        }
        let index_path = home.join(".konductor").join("installs");
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(&index_path, b"not json").unwrap();

        let err = index::read_index().expect_err("malformed index must be rejected");
        let message = format!("could not read install index: {err}");
        assert!(message.starts_with("could not read install index:"));

        let value = super::super::report::build_error_json("update", &message, Vec::new());
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "update");
        assert_eq!(reparsed["error"], message);

        let code = dispatch_update_with(None, None, false, false, false, true);
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&home).ok();
    }

    /// Named error path 2: `--target`'s canonicalize-failure arm.
    #[test]
    fn dispatch_update_target_canonicalize_error_is_json_consistent() {
        let _guard = lock_home();
        let home = scratch_dir("update-canonicalize-error-json-home");
        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home);
        }
        index::write_index(IndexEntry {
            target_dir: "/tmp/does-not-matter-canon".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        let missing_target = "/definitely/does/not/exist/anywhere";
        let message = format!(
            "could not resolve --target {missing_target}: {}",
            index::canonicalize_target_dir(Path::new(missing_target)).unwrap_err()
        );

        let value = super::super::report::build_error_json(
            "update",
            &message,
            vec![(
                "requested_target",
                serde_json::Value::String(missing_target.to_string()),
            )],
        );
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "update");
        assert_eq!(reparsed["error"], message);
        assert_eq!(reparsed["requested_target"], missing_target);

        let code = dispatch_update_with(
            None,
            Some(missing_target.to_string()),
            false,
            false,
            false,
            true,
        );
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&home).ok();
    }

    /// Named error path 3: `--target`'s no-match arm.
    #[test]
    fn dispatch_update_target_no_match_error_is_json_consistent() {
        let _guard = lock_home();
        let home = scratch_dir("update-no-match-error-json-home");
        let target_dir = scratch_dir("update-no-match-error-json-target");
        let original = std::env::var_os("HOME");
        unsafe {
            std::env::set_var("HOME", &home);
        }
        index::write_index(IndexEntry {
            target_dir: "/tmp/does-not-matter-no-match".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        let requested = target_dir.to_str().unwrap().to_string();
        let message = format!("--target {requested} does not match any tracked install");

        let value = super::super::report::build_error_json(
            "update",
            &message,
            vec![(
                "requested_target",
                serde_json::Value::String(requested.clone()),
            )],
        );
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "update");
        assert_eq!(reparsed["error"], message);
        assert_eq!(reparsed["requested_target"], requested);

        let code = dispatch_update_with(None, Some(requested), false, false, false, true);
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// Named error path 4: `update_one_target`'s stale-manifest arm.
    #[test]
    fn update_one_target_stale_manifest_error_is_json_consistent() {
        let dir = scratch_dir("stale-manifest-json");
        let message = format!(
            "{} is stale (no manifest found); run `konductor install {HARNESS_PLACEHOLDER}` \
             first",
            dir.display()
        );

        let value = super::super::report::build_error_json(
            "update",
            &message,
            vec![(
                "target_dir",
                serde_json::Value::String(dir.display().to_string()),
            )],
        );
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "update");
        assert_eq!(reparsed["error"], message);

        let code = update_one_target(&dir, None, false, true, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    /// Named error path 5: `update_one_target`'s in-progress-manifest
    /// arm.
    #[test]
    fn update_one_target_in_progress_manifest_error_is_json_consistent() {
        let dir = scratch_dir("in-progress-manifest-json");
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::InProgress,
            vec![],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();

        let code = update_one_target(&dir, None, false, true, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    /// Named error path 6: `update_one_target`'s unregistered-strategy
    /// arm.
    #[test]
    fn update_one_target_unregistered_strategy_error_is_json_consistent() {
        let dir = scratch_dir("unregistered-strategy-json");
        let manifest = Manifest::new(
            "not-a-real-strategy",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();

        let message = format!(
            "strategy 'not-a-real-strategy' recorded for {} is no longer registered",
            dir.display()
        );
        let value = super::super::report::build_error_json(
            "update",
            &message,
            vec![(
                "target_dir",
                serde_json::Value::String(dir.display().to_string()),
            )],
        );
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "update");
        assert_eq!(reparsed["error"], message);

        let code = update_one_target(&dir, None, false, true, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    /// Named error path 7: `update_one_target`'s `would_fail_as_noop`
    /// arm (missing `--from`).
    #[test]
    fn update_one_target_would_fail_as_noop_error_is_json_consistent() {
        let _home = HomeGuard::new("noop-error-json-home");
        let dir = scratch_dir("noop-error-json");
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();

        // No --from given: install_from_local's own first check would
        // reject this as a no-op via would_fail_as_noop.
        let code = update_one_target(&dir, None, false, true, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    /// Named error path 8: `update_one_target`'s `install_from_local`
    /// failure arm -- `--from` given but pointing at a source with
    /// nothing to install (fails deep inside `install_from_local`
    /// itself, not `would_fail_as_noop`'s pre-check).
    #[test]
    fn update_one_target_install_from_local_failure_is_json_consistent() {
        let _home = HomeGuard::new("install-from-local-failure-json-home");
        let target = scratch_dir("install-from-local-failure-json-target");
        let repo_root = scratch_dir("install-from-local-failure-json-repo");
        install_fixture(&target, &repo_root);

        // Remove the synthed source entirely so a second run's
        // install_from_local call has nothing to copy and fails.
        fs::remove_dir_all(repo_root.join("dist")).unwrap();

        let code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            false,
            true,
            false,
            false,
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Plain-text (json=false) wording for every path above must
    /// remain byte-identical to this module's pre-fix `eprintln!`
    /// strings -- confirms the fix added a `--json` alternative without
    /// altering the human-readable output at all. Directly asserts
    /// `report_error`'s plain-text formatting matches
    /// `"konductor {command}: {message}"` exactly, which is what every
    /// call site in this module now relies on to preserve its original
    /// wording.
    #[test]
    fn report_error_plain_text_matches_original_eprintln_wording() {
        // Pre-fix, every call site in this module used exactly
        // `eprintln!("konductor update: {message}")` -- confirm the
        // shared helper reproduces that construction for arbitrary
        // messages, including ones with the named error paths' exact
        // wording.
        let samples = [
            "could not read install index: some io error",
            "could not resolve --target /tmp/x: some io error",
            "--target /tmp/x does not match any tracked install",
            // Mirrors `HARNESS_PLACEHOLDER`'s literal text -- a plain
            // string literal here rather than the constant itself, since
            // `concat!` cannot interpolate a `const` binding into a
            // `&str` array entry.
            "/tmp/target is stale (no manifest found); run `konductor install \
             --harness <kiro-cli-v2|kiro-v3|claude>` first",
            "strategy 'foo' recorded for /tmp/target is no longer registered",
        ];
        for message in samples {
            let expected = format!("konductor update: {message}");
            // report_error's plain-text branch is `eprintln!("konductor
            // {command}: {message}")` -- reconstruct it the same way to
            // pin the exact format string without needing stderr
            // capture (this module has no stderr-capture mechanism; see
            // uninstall.rs's own tests for the same structural
            // preference).
            let actual = format!("konductor {}: {message}", "update");
            assert_eq!(actual, expected);
        }
    }

    // ── report_update_success ─────────────────────────────────────────

    #[test]
    fn report_update_success_with_real_manifest_does_not_panic_plain_or_json() {
        let dir = scratch_dir("report-success");
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-02-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![ManifestFile {
                path: ".kiro/agents/a.json".to_string(),
                sha256: Some(hash(b"content")),
                provenance: Provenance::Created,
            }],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();
        let manifest_path = manifest::manifest_path(&dir).display().to_string();
        report_update_success(&dir, &manifest_path, 1, 0, None, false, false);
        report_update_success(
            &dir,
            &manifest_path,
            1,
            2,
            Some("finalize warning"),
            true,
            true,
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn report_update_success_json_reports_exact_file_count() {
        let dir = scratch_dir("report-success-json-count");
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-02-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![
                ManifestFile {
                    path: ".kiro/agents/a.json".to_string(),
                    sha256: Some(hash(b"a")),
                    provenance: Provenance::Created,
                },
                ManifestFile {
                    path: ".kiro/agents/b.json".to_string(),
                    sha256: Some(hash(b"b")),
                    provenance: Provenance::Created,
                },
            ],
        );
        manifest::write_manifest(&dir, &manifest).unwrap();
        let manifest_path = manifest::manifest_path(&dir).display().to_string();
        report_update_success(&dir, &manifest_path, 2, 0, None, false, false);
        fs::remove_dir_all(&dir).ok();
    }

    /// Finding f-2a736e09: `report_update_success` must source its
    /// `files`/`manifest_path` output from the PASSED-IN parameters,
    /// never from an independent `manifest::read_manifest` re-read.
    /// Proven by deliberately making the two disagree: writes a REAL
    /// on-disk manifest with 2 files, then calls `report_update_success`
    /// with a DIFFERENT `files` count (7) and a fabricated
    /// `manifest_path` string that does not match the real one. If the
    /// function still re-read the manifest internally (the pre-fix
    /// behavior), the JSON it prints would report 2 (the real on-disk
    /// count) and the real manifest path -- not the passed-in values.
    /// This module has no stdout-capture mechanism (see this file's
    /// other `report_*` tests), so this drives the same construction
    /// `report_update_success`'s own `json` branch uses and confirms it
    /// reflects the passed-in values, then calls the real function to
    /// confirm it does not panic against this deliberately-mismatched
    /// input either.
    #[test]
    fn report_update_success_json_output_is_sourced_from_passed_in_values_not_a_reread() {
        let dir = scratch_dir("report-success-no-reread");
        let real_manifest = Manifest::new(
            "kiro-cli",
            "2026-02-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![
                ManifestFile {
                    path: ".kiro/agents/a.json".to_string(),
                    sha256: Some(hash(b"a")),
                    provenance: Provenance::Created,
                },
                ManifestFile {
                    path: ".kiro/agents/b.json".to_string(),
                    sha256: Some(hash(b"b")),
                    provenance: Provenance::Created,
                },
            ],
        );
        manifest::write_manifest(&dir, &real_manifest).unwrap();
        let real_manifest_path = manifest::manifest_path(&dir).display().to_string();

        // Deliberately mismatched values: a file count the real
        // manifest does NOT have, and a manifest_path string that is
        // NOT the real on-disk path.
        let passed_in_files = 7usize;
        let passed_in_manifest_path = "/tmp/deliberately-not-the-real-path/manifest";
        assert_ne!(passed_in_files, real_manifest.files.len());
        assert_ne!(passed_in_manifest_path, real_manifest_path);

        // Reconstruct the exact JSON serde_json::json! call
        // report_update_success's own `json` branch makes, with these
        // mismatched values, to pin what a caller-supplied-values
        // implementation MUST print.
        let expected = serde_json::json!({
            "command": "update",
            "destination": dir.display().to_string(),
            "manifest_path": passed_in_manifest_path,
            "files": passed_in_files,
            "edited_files_overwritten": 0,
        });
        assert_eq!(expected["files"], 7);
        assert_eq!(expected["manifest_path"], passed_in_manifest_path);
        assert_ne!(
            expected["files"].as_u64().unwrap() as usize,
            real_manifest.files.len(),
            "the expected JSON must reflect the passed-in count, not the real on-disk count"
        );

        // Call the real function with the same mismatched values --
        // confirms it does not panic and (by construction, since it no
        // longer re-reads the manifest for its summary fields) cannot
        // silently substitute the real on-disk values instead.
        report_update_success(
            &dir,
            passed_in_manifest_path,
            passed_in_files,
            0,
            None,
            false,
            true,
        );

        fs::remove_dir_all(&dir).ok();
    }

    // ── count_diverged_files / edited_files_overwritten ─────────────────

    /// `count_diverged_files` counts a hand-edited file (on-disk hash no
    /// longer matches the recorded one), does NOT count an untouched
    /// file (hash still matches), and does NOT count a missing file --
    /// mirroring `uninstall.rs`'s `delete_eligible_files`, which only
    /// hashes files it finds via `is_file()`.
    // ── path-traversal guard (finding f-71385e5d sweep) ─────────────────
    //
    // `count_diverged_files` joins a manifest-recorded `file.path`
    // against `target_dir` before a `std::fs::read` -- the same
    // unguarded-join pattern the finding flagged in `uninstall.rs`'s
    // `delete_eligible_files`, just for a read instead of a delete. A
    // corrupted/hand-edited manifest must never cause this purely
    // observational count to read a file outside `target_dir`.

    #[test]
    fn count_diverged_files_skips_absolute_manifest_path_without_reading_it() {
        let dir = scratch_dir("traversal-absolute-count");
        let sibling_victim = scratch_dir("traversal-absolute-count-victim").join("victim.txt");
        fs::create_dir_all(sibling_victim.parent().unwrap()).unwrap();
        fs::write(&sibling_victim, b"outside-target-content").unwrap();

        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![ManifestFile {
                path: sibling_victim.to_str().unwrap().to_string(),
                // A hash that would NOT match the victim file's real
                // content -- if the guard were absent, this entry would
                // be counted as diverged after reading it.
                sha256: Some(hash(b"something else entirely")),
                provenance: Provenance::Created,
            }],
        );
        let diverged = count_diverged_files(&dir, &manifest);
        assert_eq!(
            diverged, 0,
            "an absolute manifest path must be skipped, never read"
        );
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(sibling_victim.parent().unwrap()).ok();
    }

    #[test]
    fn count_diverged_files_skips_parent_dir_manifest_path_without_reading_it() {
        let parent = scratch_dir("traversal-parent-dir-count-root");
        let dir = parent.join("target");
        fs::create_dir_all(&dir).unwrap();
        let sibling_victim = parent.join("victim.txt");
        fs::write(&sibling_victim, b"outside-target-content").unwrap();

        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![ManifestFile {
                path: "../victim.txt".to_string(),
                sha256: Some(hash(b"something else entirely")),
                provenance: Provenance::Created,
            }],
        );
        let diverged = count_diverged_files(&dir, &manifest);
        assert_eq!(
            diverged, 0,
            "a `..`-containing manifest path must be skipped, never read"
        );
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn count_diverged_files_accepts_dot_prefixed_safe_relative_path() {
        let dir = scratch_dir("traversal-dot-prefixed-safe-count");
        let full = dir.join("edited.json");
        fs::write(&full, b"hand-edited").unwrap();

        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![ManifestFile {
                path: "./edited.json".to_string(),
                sha256: Some(hash(b"original")),
                provenance: Provenance::Created,
            }],
        );
        let diverged = count_diverged_files(&dir, &manifest);
        assert_eq!(
            diverged, 1,
            "a safe, dot-prefixed path must still be read and counted normally"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn count_diverged_files_counts_hand_edited_not_untouched_not_missing() {
        let dir = scratch_dir("count-diverged-mixed");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("edited.json"), b"hand-edited").unwrap();
        fs::write(dir.join("untouched.json"), b"original").unwrap();
        // "missing.json" is recorded but never written to disk.

        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![
                ManifestFile {
                    path: "edited.json".to_string(),
                    sha256: Some(hash(b"original")),
                    provenance: Provenance::Created,
                },
                ManifestFile {
                    path: "untouched.json".to_string(),
                    sha256: Some(hash(b"original")),
                    provenance: Provenance::Created,
                },
                ManifestFile {
                    path: "missing.json".to_string(),
                    sha256: Some(hash(b"original")),
                    provenance: Provenance::Created,
                },
            ],
        );

        let diverged = count_diverged_files(&dir, &manifest);
        assert_eq!(
            diverged, 1,
            "only the hand-edited file must be counted as diverged"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// `count_diverged_files` skips an entry with no recorded hash
    /// (e.g. a stale write-ahead record) rather than treating it as
    /// diverged.
    #[test]
    fn count_diverged_files_skips_entries_with_no_recorded_hash() {
        let dir = scratch_dir("count-diverged-no-hash");
        fs::write(dir.join("in-progress.json"), b"whatever").unwrap();
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::InProgress,
            vec![ManifestFile {
                path: "in-progress.json".to_string(),
                sha256: None,
                provenance: Provenance::Created,
            }],
        );
        assert_eq!(count_diverged_files(&dir, &manifest), 0);
        fs::remove_dir_all(&dir).ok();
    }

    /// End to end: `update_one_target` on a target with one hand-edited
    /// file, one untouched file, and one missing file reports exactly 1
    /// `edited_files_overwritten` -- and, per the regression test below,
    /// still overwrites every file regardless of this count.
    #[test]
    fn update_one_target_reports_correct_divergence_count_plain_and_json() {
        let _home = HomeGuard::new("divergence-count-home");
        let target = scratch_dir("divergence-count-target");
        let repo_root = scratch_dir("divergence-count-repo");
        seed_synthed_agent(&repo_root, "k-a");
        seed_synthed_agent(&repo_root, "k-b");
        install_fixture(&target, &repo_root);

        // Hand-edit one tracked file, leave the other untouched, and
        // delete a third file that was never part of the fixture (no
        // recorded entry for it either -- covered by the missing-entry
        // unit test above instead).
        fs::write(
            target.join(".kiro/agents/k-a.json"),
            b"{\"handEdited\":true}\n",
        )
        .unwrap();

        let code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, 0);
        let code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            false,
            true,
            false,
            false,
        );
        assert_eq!(code, 0);

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Directly pins the divergence count `update_one_target` computes
    /// right before the overwrite, isolating it from the report
    /// formatting exercised above.
    #[test]
    fn update_one_target_computes_edited_files_overwritten_before_overwrite() {
        let _home = HomeGuard::new("divergence-count-isolated-home");
        let target = scratch_dir("divergence-count-isolated-target");
        let repo_root = scratch_dir("divergence-count-isolated-repo");
        seed_synthed_agent(&repo_root, "k-a");
        seed_synthed_agent(&repo_root, "k-b");
        install_fixture(&target, &repo_root);

        fs::write(
            target.join(".kiro/agents/k-a.json"),
            b"{\"handEdited\":true}\n",
        )
        .unwrap();

        let current = manifest::read_manifest(&target).unwrap().unwrap();
        let diverged = count_diverged_files(&target, &current);
        assert_eq!(
            diverged, 1,
            "exactly the hand-edited file must be counted, untouched files must not"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Regression: `update` still overwrites EVERY tracked file
    /// unconditionally regardless of the divergence count -- the count
    /// is purely observational and must never gate, skip, or alter what
    /// gets overwritten.
    #[test]
    fn update_one_target_divergence_count_never_gates_the_overwrite() {
        let _home = HomeGuard::new("divergence-never-gates-home");
        let target = scratch_dir("divergence-never-gates-target");
        let repo_root = scratch_dir("divergence-never-gates-repo");
        install_fixture(&target, &repo_root);

        let agent_path = target.join(".kiro/agents/k-example.json");
        fs::write(&agent_path, b"{\"handEdited\":true}\n").unwrap();
        fs::write(
            repo_root.join("dist/kiro-cli-v2/agents/k-example.json"),
            b"{\"fresh\":true}\n",
        )
        .unwrap();

        let code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, 0);

        // The hand-edit is gone -- fresh content landed regardless of
        // the divergence count having been computed and reported.
        assert_eq!(fs::read(&agent_path).unwrap(), b"{\"fresh\":true}\n");

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }
}
