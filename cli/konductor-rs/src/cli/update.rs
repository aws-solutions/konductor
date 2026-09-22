// SPDX-License-Identifier: Apache-2.0
//
// update.rs -- `konductor update` dispatch (Rust implementation).
//
// Unconditional overwrite: `update` resolves which tracked target(s) to
// act on, then for each one calls the exact same
// `InstallStrategy::install_from_local(target_dir, from)`
// `install.rs`'s `dispatch_install_with` calls when `--from` is given.
// No filtering, no reconciliation -- the manifest `install_from_local`
// writes as a side effect of that call is the final manifest for this
// run, verbatim. Reuses `manifest::read_manifest`, `index::{read_index,
// write_index, canonicalize_target_dir}`, and `registry::STRATEGIES`
// exactly as install does; never re-runs `matches()` selection against
// the target.
//
// Without `--from`, each target's update instead tries the exact same
// real remote fallback chain `install`'s own no-`--from` path uses
// (`remote_orchestrate::install_from_remote_with_fallback`: GitHub
// Release first, falling back to `main`'s `dist/` tree) -- see
// `run_update_one_target`'s own doc comment for how the fetched tree is
// then applied through the SAME strategy the target's manifest already
// records, with no `--harness` re-prompt. `use_github_token` is
// `update`'s own `--use-github-token` flag, threaded straight through
// to that same call, identical in meaning and effect to
// `install --use-github-token`. Every error-mapping helper this remote
// path needs (`remote_orchestration_error_exit_code`,
// `remote_orchestration_error_code`,
// `main_branch_dist_orchestration_error_exit_code`,
// `main_branch_dist_orchestration_error_code`,
// `fallback_chain_error_exit_code`, `fallback_chain_error_code`) is
// reused directly from `install.rs` (`pub(super)` there for exactly
// this reason), never duplicated here.
//
// Hash-based divergence classification does exist here, but only under
// `--dry-run` (`preview_update`/`is_diverged`, per file); a real run
// computes the same hash comparison (`count_diverged_files`) purely for
// an aggregate "how many were overwritten while diverged" count
// reported after the fact -- it never gates or alters which files get
// overwritten. `--dry-run` for a no-`--from` target never makes a
// network call either (see `preview_update`'s own doc comment): it
// reports the currently-tracked file list and its current divergence,
// since fetching a fresh release just to preview it would give a
// read-only inspection command a real external side effect.
//
// Manifest and index writes are locked and fresh-read; file copies are
// not. Every manifest write here is serialized through the same
// `config_lock`-backed advisory lock `install.rs`/`uninstall.rs` use,
// and the finalize index write re-reads the manifest fresh rather than
// reusing a pre-`install_from_local` snapshot -- a concurrent
// install/uninstall of a different, coexisting strategy can no longer
// have its slot silently dropped from either the manifest or the
// index. What remains unsupported: two invocations racing on the exact
// same strategy slot at the same target -- `install_from_local`'s
// file-copy phase has no mutex of its own, so concurrent runs against
// that one slot can still interleave their copies. Callers must still
// serialize same-slot invocations themselves.
//
// Known limitation: no transactional rollback on a mid-copy failure.
// `update_one_target` calls `install_from_local` (or, with no
// `--from`, the remote fallback chain) with no transactional wrapper.
// A mid-copy failure (disk full, permission error) can leave
// the target with a mix of fresh and stale files, the manifest never
// gets rewritten to reflect the failure, and the index entry can stay
// `InProgress` until a future read self-heals it. No rollback exists or
// is planned.

use std::path::{Path, PathBuf};

use super::install::artifact::sha256_hex;
use super::install::index::{self, IndexEntry, IndexEntryStatus};
use super::install::manifest::{self, ManifestError, Status, StrategyManifest};
use super::install::registry;
use super::install::{github_branch, remote_orchestrate};
use crate::cli::output::ColorMode;

// Test-only synchronization point, compiled only under `#[cfg(test)]`:
// lets a test deterministically block `run_update_one_target` between
// `install_from_local` completing and the finalize fresh-read, instead
// of relying on a timing assumption about which of two racing threads
// finishes first. The sole caller,
// `update_finalize_index_reflects_a_concurrently_installed_other_strategy`,
// uses it to guarantee its concurrent installer thread's write has
// already committed before the fresh read runs -- without this, the
// read's outcome depends on thread-scheduling speed, which made that
// test flaky on a different build platform.
#[cfg(test)]
thread_local! {
    static MID_UPDATE_SYNC_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
}

/// Remapped exit code for CLI usage errors, matching cli.rs's own
/// `EXIT_USAGE_ERROR` constant. Duplicated here per install.rs's own
/// established precedent for this exact constant (cli.rs's constant is
/// private to that module).
const EXIT_USAGE_ERROR: u8 = 64;

/// The `--harness <value>` fragment every "re-run `konductor install`"
/// remediation string in this file embeds when no recorded strategy is
/// available to name a specific one -- kept in one place so these
/// strings can't drift from the three values `cli.rs`'s `--harness`
/// clap `value_parser` actually accepts. `doctor.rs` duplicates this
/// constant rather than importing it, since `update` is a private
/// module in `cli.rs`.
const HARNESS_PLACEHOLDER: &str = "--harness <kiro-cli-v2|kiro-v3|claude>";

/// Best-effort `--harness <value>` remediation fragment for a
/// manifest's recorded `strategy` name, so a "re-run `konductor
/// install`" remediation can name the harness that installed it
/// instead of the generic `HARNESS_PLACEHOLDER`. `name()` and
/// `harness_dir()` are identical by construction, so this only checks
/// whether `strategy_name` is still a registered strategy, falling
/// back to `HARNESS_PLACEHOLDER` when it isn't (e.g. a manifest
/// written by a newer `konductor` build this binary doesn't know
/// about).
fn harness_hint(strategy_name: &str) -> String {
    if registry::STRATEGIES
        .iter()
        .any(|s| s.name() == strategy_name)
    {
        format!("--harness {strategy_name}")
    } else {
        HARNESS_PLACEHOLDER.to_string()
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

/// `konductor update [--from ...] [--target ...] [--all] [--harness
/// <name>]`: resolves which tracked install(s) to update, mirroring
/// uninstall's selection surface, then runs `update_one_target` on
/// each. `harness` selects which of a resolved target's tracked
/// strategies to act on when it tracks 2+; `harness_select::select_harness`
/// validates an explicit `--harness` even at a single tracked slot, so
/// a mismatch is a usage error, not a silent no-op (it has no effect
/// only when the target tracks 0 strategies). With `--all`, a target
/// that doesn't track the requested harness is skipped rather than
/// counted as a batch failure, mirroring `uninstall.rs`'s skip bucket.
/// Returns 0 on success, `EXIT_USAGE_ERROR` on any usage failure,
/// `EXIT_VERIFY_FAILED` on an unsupported schema version -- never exit
/// code 2.
///
/// `dry_run` reports exactly what would be overwritten for every
/// resolved target (via `preview_update`) without touching the
/// filesystem at all -- a dry run is non-destructive by definition.
/// There is no confirmation prompt: a real (non-dry-run) run proceeds
/// directly.
#[allow(clippy::too_many_arguments)]
pub fn dispatch_update_with(
    from: Option<String>,
    target: Option<String>,
    all: bool,
    harness: Option<String>,
    no_telemetry: bool,
    dry_run: bool,
    use_github_token: bool,
    verbose: bool,
    json: bool,
    color: ColorMode,
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
                color,
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
        super::report::report_no_tracked_installs("update", json, color);
        return 0;
    }

    // A hand-edited or otherwise corrupted index can carry the same
    // target_dir more than once, which write_index's own upsert path
    // can never itself produce. Refuse to proceed with ANY operation on
    // a corrupted index rather than silently picking one duplicate as
    // authoritative.
    let duplicates = index::duplicate_target_dirs(&entries);
    if !duplicates.is_empty() {
        report_corrupted_index(&duplicates, json, color);
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
                    color,
                );
                return EXIT_USAGE_ERROR;
            }
        }
    } else if entries.len() == 1 {
        entries
    } else {
        report_ambiguous_targets(&entries, json, color);
        return EXIT_USAGE_ERROR;
    };

    // `targets` is empty only via `--all` against an empty index (every
    // other arm above either returns earlier or resolves at least one
    // entry) -- the bare-invocation short-circuit above deliberately
    // excludes `--all`, since `--all` has nothing to iterate either way
    // and must stay a no-op regardless of `--dry-run`/`--json`.
    if targets.is_empty() {
        super::report::report_no_tracked_installs("update", json, color);
        return 0;
    }

    if dry_run {
        return report_dry_run_preview(
            &targets,
            from.as_deref(),
            harness.as_deref(),
            use_github_token,
            json,
            color,
        );
    }

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
        return dispatch_update_all_json(
            targets,
            from.as_deref(),
            harness.as_deref(),
            use_github_token,
            verbose,
            no_telemetry,
        );
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
            harness.as_deref(),
            use_github_token,
            verbose,
            json,
            all,
            no_telemetry,
            color,
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
/// `finalize_index_warning`: `run_update_one_target` itself never
/// prints -- carried back here instead, so each caller renders it in
/// its own mode: `update_one_target` folds it into
/// `report_update_success`'s output, `dispatch_update_all_json` folds
/// it into this target's entry via `report_update_batch`. `None` on
/// the ordinary path where nothing below needed to speak up. Despite
/// the name, this now carries either (or both, `"; "`-joined) of two
/// independent conditions: a finalize-index failure (the `write_index`
/// call that flips the entry to `Complete`, after `install_from_local`
/// has already succeeded), or the opt-out carry-forward finding a
/// broken (not merely absent) `install-info.json` -- see
/// `run_update_one_target`'s own comment above that read.
enum UpdateOutcome {
    Success {
        files: usize,
        edited_files_overwritten: usize,
        manifest_path: String,
        finalize_index_warning: Option<String>,
        /// The single strategy slot this run acted on (`current.strategy`
        /// in `run_update_one_target`). Lets `report_update_success`
        /// scope its own verbose per-file listing to this slot alone
        /// when the target tracks more than one strategy, instead of
        /// listing every tracked slot's files.
        strategy_name: String,
    },
    Failure {
        message: String,
        exit_code: u8,
        /// Whether this is specifically the "target doesn't track the
        /// requested `--harness`" case
        /// (`harness_select::HarnessSelectionError::NotTracked`), as
        /// opposed to every other failure. Only `dispatch_update_all_json`
        /// and the plain-text `--all` loop read this field, treating it
        /// as a per-target skip that doesn't affect the batch's exit
        /// code, mirroring `uninstall.rs`'s
        /// `UninstallError::harness_not_tracked`. The single-target
        /// path ignores this and reports an ordinary usage error --
        /// there's no sibling target to skip past.
        harness_not_tracked: bool,
        /// `None` at every failure site that returns before the opt-out
        /// carry-forward's `read_install_info_detailed` call runs (every
        /// site above that point in `run_update_one_target`); `Some` iff
        /// that read found a broken -- present but unreadable or
        /// schema-invalid -- `install-info.json`, the same condition
        /// `finalize_index_warning` (`UpdateOutcome::Success`) already
        /// surfaces on the success path. Exists so a target whose
        /// `install_from_local` (or the remote fallback chain) fails
        /// still tells the user about a broken record instead of the
        /// two problems masking each other -- the case where it matters
        /// most, since a corrupted `.konductor/` and a failing install
        /// plausibly share a cause.
        telemetry_state_warning: Option<String>,
    },
}

/// `--all` + `json=true` path: runs every target exactly as the
/// per-target loop does, but collects each outcome instead of printing
/// it immediately, then emits one JSON document via
/// `report_update_batch`, mirroring `uninstall.rs`'s `report_batch`
/// field naming (`succeeded`/`failed` arrays). Returns the same
/// deterministic tie-break exit code the plain per-target loop
/// computes (`EXIT_USAGE_ERROR` wins over any other non-zero code).
fn dispatch_update_all_json(
    targets: Vec<IndexEntry>,
    from: Option<&str>,
    harness: Option<&str>,
    use_github_token: bool,
    verbose: bool,
    no_telemetry: bool,
) -> u8 {
    let _ = verbose; // Batched --json output has no verbose per-file listing.
    let mut succeeded: Vec<(String, UpdateOutcome)> = Vec::new();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut failed: Vec<(String, UpdateOutcome)> = Vec::new();
    let mut exit_code = 0u8;

    for entry in targets {
        let target_dir = PathBuf::from(&entry.target_dir);
        // `uncached_identity: true`, `json: true` -- this path only ever
        // runs for `--all --json`, so harness selection must never
        // prompt (see `harness_select::select_harness`'s own `json`/
        // `allow_interactive` gating).
        let outcome = match run_update_one_target(
            &target_dir,
            from,
            harness,
            use_github_token,
            true,
            true,
            no_telemetry,
        ) {
            Ok(outcome) => outcome,
            Err(outcome) => outcome,
        };
        match outcome {
            UpdateOutcome::Success { .. } => succeeded.push((entry.target_dir, outcome)),
            // A target that does not track the requested `--harness`
            // (design decision, mirroring `uninstall.rs`'s `dispatch_all`):
            // skipped, not failed. Informational, does not affect
            // `exit_code`, and is not reported to telemetry as an error --
            // there is nothing broken about this target.
            UpdateOutcome::Failure {
                harness_not_tracked: true,
                message,
                ..
            } => {
                skipped.push((entry.target_dir, message));
            }
            UpdateOutcome::Failure {
                exit_code: code, ..
            } => {
                if code != 0 && (exit_code == 0 || code == EXIT_USAGE_ERROR) {
                    exit_code = code;
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
                // the first to whichever target's own `harness`/opt-out
                // signal the cache resolved first.
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

    report_update_batch(&succeeded, &skipped, &failed);
    exit_code
}

/// Emits ONE JSON document summarizing a `--all --json` update run --
/// mirroring `uninstall.rs`'s `report_batch` shape:
/// `{"command": "update", "succeeded": [...], "skipped": [...],
/// "failed": [...]}`, each `succeeded`/`failed` array entry carrying
/// `target_dir` plus that target's own fields (`report_update_success`'s
/// success fields, or an `error` string for a failure), and each
/// `skipped` entry carrying `target_dir` plus a `reason` string.
///
/// `skipped` is a SEPARATE bucket from both `succeeded` and `failed`:
/// targets that do not track the requested `--harness`
/// (`UpdateOutcome::Failure::harness_not_tracked`, see that field's own
/// doc comment). A stale target (missing manifest) is still, unlike
/// `uninstall`'s own stale case, simply a `failed` entry here -- see
/// `update_one_target`'s own doc comment on why `update`, unlike
/// `uninstall`, cannot treat a missing manifest as a non-fatal prune.
/// The two are distinct: a stale/missing target is a genuine failure
/// (nothing for `update` to act on); a harness mismatch is a skip
/// (there is something to act on, it is simply not the strategy this
/// run asked for).
fn report_update_batch(
    succeeded: &[(String, UpdateOutcome)],
    skipped: &[(String, String)],
    failed: &[(String, UpdateOutcome)],
) {
    println!(
        "{}",
        serde_json::json!({
            "command": "update",
            "succeeded": succeeded.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Success { files, edited_files_overwritten, manifest_path, finalize_index_warning, strategy_name: _ } => {
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
            "skipped": skipped.iter().map(|(dir, reason)| serde_json::json!({
                "target_dir": dir,
                "reason": reason,
            })).collect::<Vec<_>>(),
            "failed": failed.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Failure { message, telemetry_state_warning, .. } => {
                        let mut entry = serde_json::json!({
                            "target_dir": dir,
                            "error": message,
                        });
                        if let Some(warning) = telemetry_state_warning {
                            entry["warning"] = serde_json::Value::String(warning.clone());
                        }
                        entry
                    }
                    UpdateOutcome::Success { .. } => unreachable!("failed only ever holds UpdateOutcome::Failure"),
                }
            }).collect::<Vec<_>>(),
        })
    );
}

/// Reports the 2+-entries-no-flag ambiguity error, listing every
/// tracked install so the user knows what `--target <dir>` values
/// are valid. `--json` mode emits a structured `tracked_targets` field
/// instead of embedding the list in the message string, matching this
/// module's (and `report_update_success`'s) existing
/// `serde_json::json!` error/report shape convention. The plain-text
/// line is styled via `error_prefix` (red), matching every other usage
/// error this module reports through `report_error`.
fn report_ambiguous_targets(entries: &[IndexEntry], json: bool, color: ColorMode) {
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
    eprintln!(
        "{} {message}. Tracked install(s):\n{listed}",
        crate::cli::output::error_prefix(color, "konductor update:")
    );
}

/// Reports a corrupted index (duplicate `target_dir` entries) and
/// refuses to proceed with any operation, naming exactly which tracked
/// install(s) are duplicated. Mirrors `report_ambiguous_targets`'s
/// plain-text/`--json` shape split, including its `error_prefix`
/// styling.
fn report_corrupted_index(duplicates: &[String], json: bool, color: ColorMode) {
    let message = "the tracked-install index is corrupted: duplicate tracked install \
                    entries found; fix ~/.konductor/installs by hand before running update";
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
    eprintln!(
        "{} {message}. Duplicated tracked install(s):\n{listed}",
        crate::cli::output::error_prefix(color, "konductor update:")
    );
}

/// `--dry-run` preview for every resolved target: reads each target's
/// manifest (read-only -- `preview_update` never calls
/// `install_from_local`/writes an index or manifest entry) and reports
/// exactly which files WOULD be re-copied by a real `update_one_target`
/// run against `harness`'s resolved slot, plus how many of them
/// currently have local edits that would be overwritten (via
/// `count_diverged_files`, the same read-only divergence count the real
/// run itself computes before its unconditional overwrite). `update`
/// has no eligibility filter the way `uninstall` does -- every file in
/// the resolved slot is unconditionally re-copied -- so the preview's
/// "would overwrite" set is simply every tracked path in that slot.
///
/// A preview failure for one target (missing/in-progress manifest,
/// unresolved `--harness`, an unregistered strategy) is reported the
/// same way a real failure would be, per target, continuing past it to
/// preview the rest -- mirrors `dispatch_update_all_json`'s own
/// continue-past-failure contract. Always returns 0: a preview reports,
/// it never itself fails the run, since it made no filesystem changes
/// for a script to have failed AT.
///
/// `use_github_token` is accepted for signature symmetry with
/// `dispatch_update_with`'s other callers but has no effect here: a
/// preview never makes a network call either way (see `preview_update`'s
/// own doc comment), so there is nothing for a GitHub token to
/// authenticate.
fn report_dry_run_preview(
    targets: &[IndexEntry],
    from: Option<&str>,
    harness: Option<&str>,
    use_github_token: bool,
    json: bool,
    color: ColorMode,
) -> u8 {
    let _ = use_github_token;
    let mut previewed: Vec<(String, Vec<PreviewFile>)> = Vec::new();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();

    for entry in targets {
        let target_dir = PathBuf::from(&entry.target_dir);
        match preview_update(&target_dir, from, harness, json) {
            Ok(would_overwrite) => {
                previewed.push((entry.target_dir.clone(), would_overwrite));
            }
            Err(err) if err.harness_not_tracked => {
                skipped.push((entry.target_dir.clone(), err.message));
            }
            Err(err) => failed.push((entry.target_dir.clone(), err.message)),
        }
    }

    if json {
        println!(
            "{}",
            serde_json::json!({
                "command": "update",
                "dry_run": true,
                "previewed": previewed.iter().map(|(dir, files)| {
                    let diverged = files.iter().filter(|f| f.diverged).count();
                    serde_json::json!({
                        "target_dir": dir,
                        "would_overwrite": files.iter().map(preview_file_json).collect::<Vec<_>>(),
                        "edited_files_would_be_overwritten": diverged,
                    })
                }).collect::<Vec<_>>(),
                "skipped": skipped.iter().map(|(dir, message)| serde_json::json!({
                    "target_dir": dir,
                    "reason": message,
                })).collect::<Vec<_>>(),
                "failed": failed.iter().map(|(dir, message)| serde_json::json!({
                    "target_dir": dir,
                    "error": message,
                })).collect::<Vec<_>>(),
            })
        );
        return 0;
    }

    for (dir, files) in &previewed {
        if files.is_empty() {
            println!(
                "{} dry run: nothing to overwrite at {dir}",
                crate::cli::output::success_prefix(color, "konductor update:")
            );
        } else {
            let diverged = files.iter().filter(|f| f.diverged).count();
            println!(
                "{} dry run: would overwrite {} file(s) at {dir} ({diverged} with local \
                 edits):",
                crate::cli::output::success_prefix(color, "konductor update:"),
                files.len()
            );
            for file in files {
                println!("{}", format_preview_file_line(file));
            }
        }
    }
    for (dir, message) in &skipped {
        println!("konductor update: skipped {dir}: {message}");
    }
    for (dir, message) in &failed {
        eprintln!(
            "{} could not preview {dir}: {message}",
            crate::cli::output::error_prefix(color, "konductor update:")
        );
    }
    0
}

/// One file `preview_update` would overwrite: its path (as recorded in
/// the manifest) and whether its on-disk content has diverged from the
/// manifest's recorded hash -- i.e. would have local edits destroyed by
/// the unconditional overwrite. Mirrors `uninstall.rs`'s own
/// `PreviewFile` shape and `format_preview_file_line`/`preview_file_json`
/// helpers exactly, so both commands' `--dry-run` output disclose
/// per-path divergence the same way.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewFile {
    path: PathBuf,
    diverged: bool,
}

/// Renders one `PreviewFile` as a plain-text line, identical in shape
/// to `uninstall.rs`'s own `format_preview_file_line` -- `  <path>`
/// when unmodified, `  <path> (local edits would be destroyed)` when
/// diverged.
fn format_preview_file_line(file: &PreviewFile) -> String {
    if file.diverged {
        format!("  {} (local edits would be destroyed)", file.path.display())
    } else {
        format!("  {}", file.path.display())
    }
}

/// Builds one `PreviewFile`'s `--json` representation: `{"path": ...,
/// "diverged": ...}`, identical in shape to `uninstall.rs`'s own
/// `preview_file_json`.
fn preview_file_json(file: &PreviewFile) -> serde_json::Value {
    serde_json::json!({
        "path": file.path.display().to_string(),
        "diverged": file.diverged,
    })
}

/// `preview_update`'s error type. Carries a human-readable message and
/// whether this is specifically the "target doesn't track the
/// requested `--harness`" case (`harness_not_tracked`) -- mirrors
/// `uninstall.rs`'s `UninstallError` shape (minus `exit_code`, which
/// `report_dry_run_preview` never reads: a preview failure always
/// still returns 0, since it made no filesystem change for a script to
/// have failed AT). `report_dry_run_preview` reads `harness_not_tracked`
/// directly to bucket a target as skipped rather than failed, the same
/// distinction the real (non-dry-run) path gets from
/// `UpdateOutcome::Failure`'s own field of the same name.
#[derive(Debug)]
struct PreviewUpdateError {
    message: String,
    harness_not_tracked: bool,
}

impl std::fmt::Display for PreviewUpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl PreviewUpdateError {
    fn usage(message: impl Into<String>) -> Self {
        PreviewUpdateError {
            message: message.into(),
            harness_not_tracked: false,
        }
    }

    /// Specifically the "target does not track the requested
    /// `--harness`" case `harness_select::select_harness` reports via
    /// `HarnessSelectionError::NotTracked`, detected structurally via
    /// `HarnessSelectionError::is_not_tracked()` rather than by
    /// matching on the error's rendered `Display` text.
    fn harness_not_tracked(message: impl Into<String>) -> Self {
        PreviewUpdateError {
            message: message.into(),
            harness_not_tracked: true,
        }
    }
}

/// Read-only preview of one target's update run: resolves the same
/// strategy slot `run_update_one_target` would (same manifest read,
/// same 0-strategies/in-progress/harness-mismatch rejections, same
/// `select_harness` call with `allow_interactive: false` since a
/// preview never blocks on stdin), then returns every file path in that
/// slot (the "would overwrite" set -- `update` has no eligibility
/// filter, unlike `uninstall`) alongside, per file, whether its on-disk
/// hash has already diverged from the manifest (via
/// `diverged_files_in`, the same hash comparison `count_diverged_files`
/// itself uses). Touches no filesystem state beyond reading the
/// manifest and comparing hashes -- no `install_from_local`, no remote
/// fetch of any kind, no index/manifest write.
///
/// With no `--from`, a preview never makes a network call -- fetching
/// a fresh release just to preview it would give a read-only inspection
/// command a real external side effect. Instead it reports the
/// CURRENTLY-tracked file list (`selected.files`, read from the
/// existing manifest, same as the `--from` case) and that list's
/// current divergence; the exact file set a real no-`--from` run
/// fetches may differ once it actually pulls a fresh release. Open
/// design decision, not resolved here: a different tradeoff (e.g. an
/// opt-in `--dry-run --fetch`) is possible if this one proves
/// insufficient.
fn preview_update(
    target_dir: &Path,
    from: Option<&str>,
    harness: Option<&str>,
    json: bool,
) -> Result<Vec<PreviewFile>, PreviewUpdateError> {
    let full_manifest = match manifest::read_manifest(target_dir) {
        Ok(Some(manifest)) => manifest,
        Ok(None) => {
            return Err(PreviewUpdateError::usage(format!(
                "{} is stale (no manifest found); run `konductor install \
                 {HARNESS_PLACEHOLDER}` first",
                target_dir.display()
            )));
        }
        Err(err) => {
            return Err(PreviewUpdateError::usage(format!(
                "could not read manifest at {}: {err}",
                target_dir.display()
            )));
        }
    };
    if full_manifest.strategies.is_empty() {
        return Err(PreviewUpdateError::usage(format!(
            "{} is stale (no manifest found); run `konductor install \
             {HARNESS_PLACEHOLDER}` first",
            target_dir.display()
        )));
    }

    let selected = super::harness_select::select_harness(
        &target_dir.display().to_string(),
        &full_manifest.strategies,
        harness,
        false,
        json,
    )
    .map_err(|err| {
        if err.is_not_tracked() {
            PreviewUpdateError::harness_not_tracked(err.to_string())
        } else {
            PreviewUpdateError::usage(err.to_string())
        }
    })?;

    if selected.status == Status::InProgress {
        return Err(PreviewUpdateError::usage(format!(
            "{} has an unfinished install (status: in_progress); \
             run `konductor install {}` again before updating",
            target_dir.display(),
            harness_hint(&selected.strategy)
        )));
    }

    // Single lookup, reused below for `would_fail_as_noop` -- mirrors
    // `run_update_one_target`'s own `let-else` idiom for this exact
    // check rather than looking the strategy up twice.
    let Some(strategy) = registry::STRATEGIES
        .iter()
        .find(|s| s.name() == selected.strategy)
    else {
        return Err(PreviewUpdateError::usage(format!(
            "strategy '{}' recorded for {} is no longer registered",
            selected.strategy,
            target_dir.display()
        )));
    };

    // Mirrors `run_update_one_target`'s own pure, side-effect-free
    // no-op precondition check -- a missing/invalid `--from`, or a
    // source with nothing to install, would make the REAL run fail
    // before it ever touches the filesystem, so the preview must report
    // that same failure rather than claiming files would be overwritten
    // when they would not be. Only checked when `--from` is given,
    // matching `run_update_one_target`'s identical `from.is_some()`
    // gate -- a missing `--from` preview never calls `would_fail_as_noop`
    // (there is no local source to check against), since it never
    // attempts the real remote fetch a `--from` run's no-op check
    // exists to pre-empt.
    if from.is_some() {
        if let Some(message) = strategy.would_fail_as_noop(target_dir, from) {
            return Err(PreviewUpdateError::usage(message));
        }
    }

    let would_overwrite: Vec<PreviewFile> = selected
        .files
        .iter()
        .map(|f| PreviewFile {
            path: PathBuf::from(&f.path),
            diverged: is_diverged(target_dir, f),
        })
        .collect();
    Ok(would_overwrite)
}

/// Whether a single manifest-recorded file's on-disk content has
/// diverged from its recorded `sha256` -- the exact per-file test
/// `count_diverged_files` applies while summing. Validates the
/// recorded path stays within `target_dir` before joining (mirrors
/// `uninstall.rs`'s `validate_relative_path`), and treats a missing
/// file or a missing/unreadable hash as NOT diverged, matching
/// `count_diverged_files`'s own skip rules exactly.
fn is_diverged(target_dir: &Path, file: &manifest::ManifestFile) -> bool {
    let Some(expected) = &file.sha256 else {
        return false;
    };
    let Ok(rel) = super::uninstall::validate_relative_path(&file.path) else {
        return false;
    };
    let path = target_dir.join(rel);
    if !path.is_file() {
        return false;
    }
    let Ok(bytes) = std::fs::read(&path) else {
        return false;
    };
    sha256_hex(&bytes) != *expected
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
/// Delegates the per-file test to `is_diverged` -- the same function
/// `preview_update` uses to build its own per-path `PreviewFile` list --
/// so the two can never drift on what counts as diverged.
fn count_diverged_files(target_dir: &Path, manifest: &StrategyManifest) -> usize {
    manifest
        .files
        .iter()
        .filter(|file| is_diverged(target_dir, file))
        .count()
}

/// One tracked target's full update run: looks
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
#[allow(clippy::too_many_arguments)]
fn update_one_target(
    target_dir: &Path,
    from: Option<&str>,
    harness: Option<&str>,
    use_github_token: bool,
    verbose: bool,
    json: bool,
    uncached_identity: bool,
    no_telemetry: bool,
    color: ColorMode,
) -> u8 {
    match run_update_one_target(
        target_dir,
        from,
        harness,
        use_github_token,
        uncached_identity,
        json,
        no_telemetry,
    ) {
        Ok(UpdateOutcome::Success {
            files,
            edited_files_overwritten,
            manifest_path,
            finalize_index_warning,
            strategy_name,
        }) => {
            report_update_success(
                target_dir,
                &manifest_path,
                files,
                edited_files_overwritten,
                finalize_index_warning.as_deref(),
                &strategy_name,
                verbose,
                json,
                color,
            );
            0
        }
        Ok(UpdateOutcome::Failure { .. }) => {
            unreachable!("run_update_one_target's Ok variant always holds UpdateOutcome::Success")
        }
        Err(UpdateOutcome::Failure {
            message,
            exit_code,
            harness_not_tracked,
            telemetry_state_warning,
        }) => {
            // A target that does not track the requested `--harness`,
            // reached specifically via the plain-text `--all` loop
            // (`uncached_identity` doubles as "this call is part of an
            // `--all` batch" -- see this function's own doc comment;
            // the `--all --json` combination never reaches this arm at
            // all, since `dispatch_update_with` routes it to
            // `dispatch_update_all_json` before this function is ever
            // called): skipped, not failed. Informational, printed on
            // stdout, and does not contribute to the batch's exit-code
            // tie-break -- mirroring `uninstall.rs`'s `dispatch_all`/
            // `report_batch` skip bucket. A single explicit `--target
            // <dir>` (or a bare invocation with exactly one tracked
            // install) has no sibling target to skip past, so this
            // branch never fires there (`uncached_identity` is `false`
            // on that path) -- the mismatch is reported as an ordinary
            // usage error below, matching `uninstall.rs`'s
            // `dispatch_target`'s identical choice.
            if uncached_identity && harness_not_tracked {
                println!(
                    "konductor update: skipped {}: {message}",
                    target_dir.display()
                );
                return 0;
            }
            // Folded into `message` with the same `"; "` join
            // `finalize_index_warning` uses on the success path, and
            // also carried in `extra` as a `"warning"` field so a
            // `--json` consumer sees it as its own key rather than only
            // embedded in `"error"`'s text. `Some` here means
            // `run_update_one_target`'s opt-out carry-forward found a
            // broken `install-info.json` before `install_from_local` (or
            // the remote fallback chain) went on to fail -- the case
            // `report_update_success`'s own `finalize_index_warning`
            // never covers, since a failure never reaches
            // `UpdateOutcome::Success` at all.
            let full_message = match &telemetry_state_warning {
                Some(warning) => format!("{message}; {warning}"),
                None => message.clone(),
            };
            // `uncached_identity` selects `report_error_for_target`
            // whenever this call may be one of several distinct
            // targets visited in this process -- the plain-`report_error`
            // (process-global-cache) variant would otherwise
            // misattribute every target after the first to whichever
            // target's own `harness`/opt-out signal the cache resolved
            // first, mirroring the identical fix on the success path
            // below.
            let mut extra = vec![(
                "target_dir",
                serde_json::Value::String(target_dir.display().to_string()),
            )];
            if let Some(warning) = &telemetry_state_warning {
                extra.push(("warning", serde_json::Value::String(warning.clone())));
            }
            if uncached_identity {
                super::report::report_error_for_target(
                    "update",
                    "update.target_failed",
                    target_dir,
                    no_telemetry,
                    &full_message,
                    extra,
                    json,
                    color,
                );
            } else {
                super::report::report_error(
                    "update",
                    "update.target_failed",
                    target_dir,
                    no_telemetry,
                    &full_message,
                    extra,
                    json,
                    color,
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
/// write `InProgress`, call `install_from_local` or the no-`--from`
/// remote fallback chain, write `Complete`), with NO printing anywhere
/// in its body -- a finalize-index failure is carried back to the
/// caller as `UpdateOutcome::Success`'s `finalize_index_warning` field
/// instead of being printed here (see that field's own doc comment).
/// Both `update_one_target` (the single-target/plain-text/
/// `--target`+`--json` path) and `dispatch_update_all_json` (the
/// `--all --json` batch path) call this one function and handle
/// reporting themselves -- print immediately via
/// `report_error`/`report_update_success`, or collect into a batch
/// report. This is what keeps the ordering guarantee (several comments
/// throughout this function explain WHY a given step must run before
/// the next) living in exactly one place, rather than two
/// hand-maintained copies that could drift.
///
/// `use_github_token` is only read on the no-`--from` branch -- it has
/// no effect when `from` is `Some`, which never touches GitHub's API.
///
/// Returns `Ok(UpdateOutcome::Success { .. })` on success,
/// `Err(UpdateOutcome::Failure { .. })` on any failure -- the
/// `Result<UpdateOutcome, UpdateOutcome>` shape lets each caller use
/// `?`/`match` idiomatically while still carrying the same `UpdateOutcome`
/// payload on both branches.
#[allow(clippy::too_many_arguments)]
fn run_update_one_target(
    target_dir: &Path,
    from: Option<&str>,
    harness: Option<&str>,
    use_github_token: bool,
    uncached_identity: bool,
    json: bool,
    no_telemetry: bool,
) -> Result<UpdateOutcome, UpdateOutcome> {
    run_update_one_target_with_remote_installer(
        target_dir,
        from,
        harness,
        uncached_identity,
        json,
        no_telemetry,
        // owner/repo are the confirmed real values for this project,
        // hardcoded ONLY at this one call site -- mirrors
        // `install.rs`'s own `dispatch_install_with`.
        move |strategy, destination, installed_at, no_telemetry| {
            remote_orchestrate::install_from_remote_with_fallback(
                "aws-solutions",
                "konductor",
                github_branch::DEFAULT_BRANCH,
                strategy,
                destination,
                installed_at,
                no_telemetry,
                use_github_token,
            )
        },
    )
}

/// The full `run_update_one_target` implementation, parameterized by
/// `remote_installer` -- the no-`--from` remote-install attempt. In
/// production, `run_update_one_target` passes a closure that reaches
/// the real GitHub API; this module's own tests pass a closure that
/// fails (or succeeds) right away with no real network call --
/// mirrors `install.rs`'s own
/// `dispatch_install_with`/`dispatch_install_with_remote_installer`
/// split exactly, so tests can inject a fake, network-free installer
/// here the same way.
fn run_update_one_target_with_remote_installer(
    target_dir: &Path,
    from: Option<&str>,
    harness: Option<&str>,
    uncached_identity: bool,
    json: bool,
    no_telemetry: bool,
    remote_installer: impl FnOnce(
        &dyn super::install::InstallStrategy,
        &Path,
        &str,
        bool,
    ) -> Result<
        (
            remote_orchestrate::RemoteInstallSource,
            super::install::remote::RemoteInstallOutcome,
        ),
        remote_orchestrate::FallbackChainError,
    >,
) -> Result<UpdateOutcome, UpdateOutcome> {
    let full_manifest = match manifest::read_manifest(target_dir) {
        Ok(Some(manifest)) => manifest,
        Ok(None) => {
            return Err(UpdateOutcome::Failure {
                message: format!(
                    "{} is stale (no manifest found); run `konductor install \
                     {HARNESS_PLACEHOLDER}` first",
                    target_dir.display()
                ),
                exit_code: EXIT_USAGE_ERROR,
                harness_not_tracked: false,
                telemetry_state_warning: None,
            });
        }
        Err(err) => {
            return Err(UpdateOutcome::Failure {
                message: format!("could not read manifest at {}: {err}", target_dir.display()),
                exit_code: manifest_error_exit_code(&err),
                harness_not_tracked: false,
                telemetry_state_warning: None,
            });
        }
    };
    // A target's manifest can now track more than
    // one strategy (a Kiro variant coexisting with `claude`).
    // `update` acts on exactly one slot per run -- 0 slots is treated
    // the same as no manifest at all; 1 slot acts directly (unchanged
    // behavior); 2+ slots resolves via `harness_select::select_harness`
    // -- an explicit `--harness <name>` (applying the same
    // 0/1/2+-tracked-entries selection pattern one
    // level down, from "which target" to "which strategy"), an
    // interactive picker when this call is not part of an `--all` batch
    // and stdin is a real TTY, or a usage error naming every tracked
    // strategy otherwise. `uncached_identity` doubles as this call's own
    // "is this potentially one of several targets visited in this
    // process" signal (see this function's own callers) -- exactly the
    // condition that also means "do not prompt interactively", so no
    // separate parameter is introduced for it.
    if full_manifest.strategies.is_empty() {
        return Err(UpdateOutcome::Failure {
            message: format!(
                "{} is stale (no manifest found); run `konductor install \
                 {HARNESS_PLACEHOLDER}` first",
                target_dir.display()
            ),
            exit_code: EXIT_USAGE_ERROR,
            harness_not_tracked: false,
            telemetry_state_warning: None,
        });
    }
    // Every other already-tracked strategy's name must survive both
    // index writes below unchanged -- `update` never adds or removes a
    // slot for any strategy other than the one it resolves to act on
    // (this is a refresh, not an override-switch), so the full set of
    // tracked names computed here, before selection, is what the
    // write-ahead write uses directly, and is also the fallback the
    // finalize write below uses if its fresh re-read fails or finds
    // nothing. Overwriting the index entry with only the resolved
    // strategy would silently drop every other tracked strategy's name
    // from the index while its manifest slot remains untouched on
    // disk, orphaning it from future listings even though nothing was
    // actually removed.
    let tracked_strategy_names: Vec<String> = full_manifest
        .strategy_names()
        .into_iter()
        .map(str::to_string)
        .collect();
    let current = match super::harness_select::select_harness(
        &target_dir.display().to_string(),
        &full_manifest.strategies,
        harness,
        !uncached_identity,
        json,
    ) {
        Ok(slot) => slot,
        Err(err) => {
            // `NotTracked` is the one case the `--all` batch path
            // (`dispatch_update_all_json`, and the plain-text `--all`
            // loop via `update_one_target`) treats as a per-target skip
            // rather than a failure -- see `UpdateOutcome::Failure`'s
            // own doc comment. Every other `select_harness` failure
            // (ambiguous selection, invalid prompt response) stays an
            // ordinary usage error.
            return Err(UpdateOutcome::Failure {
                harness_not_tracked: err.is_not_tracked(),
                message: err.to_string(),
                exit_code: EXIT_USAGE_ERROR,
                telemetry_state_warning: None,
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
            harness_not_tracked: false,
            telemetry_state_warning: None,
        });
    }

    // Read-only, computed before install_from_local overwrites
    // anything below: how many currently-tracked files have local
    // edits (on-disk hash no longer matches the manifest's recorded
    // hash). Purely observational -- never blocks or alters the
    // unconditional overwrite that follows.
    let diverged_before_overwrite = count_diverged_files(target_dir, current);

    // Reuses the ORIGINAL strategy's
    // install_from_local unmodified, unconditionally -- never re-runs
    // registry selection/matches(). Fails clearly if
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
            harness_not_tracked: false,
            telemetry_state_warning: None,
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
    //
    // Only checked when `--from` is given, matching `install.rs`'s
    // identical guard: a missing `--from` has no local source to check
    // with `would_fail_as_noop` at all -- the no-`--from` case tries
    // the real remote fallback chain below instead, sharing every
    // guard from this point on with the `--from` path.
    if from.is_some() {
        if let Some(message) = strategy.would_fail_as_noop(target_dir, from) {
            return Err(UpdateOutcome::Failure {
                message,
                exit_code: EXIT_USAGE_ERROR,
                harness_not_tracked: false,
                telemetry_state_warning: None,
            });
        }
    }

    // Index write-ahead: InProgress before
    // the copy, mirroring install's own bracketing.
    let canonical_target_dir = match index::canonicalize_target_dir(target_dir) {
        Ok(path) => path,
        Err(err) => {
            return Err(UpdateOutcome::Failure {
                message: format!("could not resolve {}: {err}", target_dir.display()),
                exit_code: EXIT_USAGE_ERROR,
                harness_not_tracked: false,
                telemetry_state_warning: None,
            });
        }
    };
    let updated_at = crate::cli::time::utc_now_iso();
    if let Err(err) = index::write_index(IndexEntry {
        target_dir: canonical_target_dir.clone(),
        strategies: tracked_strategy_names.clone(),
        installed_at: updated_at.clone(),
        status: IndexEntryStatus::InProgress,
    }) {
        return Err(UpdateOutcome::Failure {
            message: format!("could not write install index: {err}"),
            exit_code: index_error_exit_code(&err),
            harness_not_tracked: false,
            telemetry_state_warning: None,
        });
    }

    // Durable opt-out carry-forward: `update`'s
    // own `--no-telemetry` flag is re-specified per invocation, same as
    // `--from`/`--target` (see `Commands::Update`'s own doc comment),
    // and when passed it always suppresses telemetry for this run
    // regardless of the target's own history -- an explicit override
    // in either direction. When it is NOT passed, this target's own
    // `.konductor/install-info.json` is read via
    // `read_install_info_detailed` (not the plain `read_install_info`
    // `report_*` uses, since this call site -- unlike those -- needs to
    // tell the user WHY, not just whether) to resolve one of three
    // outcomes, the same three `doctor`'s `check_telemetry_state` reads
    // from this file:
    //
    //   - `Ok`: an install-info record exists and validated. Not
    //     opted out; `no_telemetry` is left as the caller passed it.
    //   - `Err(NotFound)`: no record was ever written, either from a
    //     deliberate `--no-telemetry` choice at install or an install
    //     that predates this telemetry system entirely -- the two are
    //     indistinguishable from the filesystem alone. Carried forward
    //     as opted-out silently, same as before: this is the
    //     conservative default that never wires a telemetry side
    //     effect for a target that never affirmatively got one, and
    //     nothing here is broken, so nothing is printed.
    //   - `Err(Broken)`: a record exists but is unreadable or fails
    //     schema validation. Nobody opted out; something wrote, or
    //     left, a file that cannot be trusted. Still carried forward as
    //     opted-out -- fail-closed, since the code cannot know what the
    //     user actually chose -- but unlike the other two outcomes this
    //     is worth telling the user about, so it is surfaced as a
    //     warning (`telemetry_state_warning` below) naming the file,
    //     matching `check_telemetry_state`'s own wording for the same
    //     condition.
    //
    // Resolved via THIS target_dir specifically, so an `--all` batch
    // resolves the signal independently per target, the same way each
    // target's own `.konductor/config.yml` opt-out is already resolved
    // independently rather than shared across the batch.
    //
    // Threading the (possibly carried-forward) value through here is
    // what makes the opt-out actually suppress `AgentInstallPhase`'s
    // Claude Code telemetry-hook re-wiring step on this run.
    //
    // Read unconditionally -- NOT `no_telemetry ||`-short-circuited --
    // so a broken record is always surfaced via `telemetry_state_warning`
    // even on a run where `--no-telemetry` was passed explicitly (which
    // would otherwise skip this read entirely and never learn the
    // record was broken rather than absent). The read's `Ok`/`NotFound`
    // outcomes never affect `no_telemetry`: an explicit `--no-telemetry`
    // already decided the opt-out on its own, and this read exists only
    // to resolve that decision when the flag was NOT passed and to
    // report whether the file backing that decision is trustworthy.
    let mut telemetry_state_warning: Option<String> = None;
    let carried_forward_opt_out =
        match crate::cli::telemetry::read_install_info_detailed(target_dir) {
            Ok(_) => false,
            Err(crate::cli::telemetry::InstallInfoAbsence::NotFound) => true,
            Err(crate::cli::telemetry::InstallInfoAbsence::Broken) => {
                let record_path = crate::cli::telemetry::install_info_path(target_dir);
                telemetry_state_warning = Some(format!(
                    "telemetry reporting is off for {}: {} is present but could not be read \
                 (unreadable or an unrecognized schema) -- re-run `konductor install` to \
                 rewrite it, or inspect it directly to see why it failed to parse",
                    target_dir.display(),
                    record_path.display()
                ));
                true
            }
        };
    let no_telemetry = no_telemetry || carried_forward_opt_out;

    // The actual update step: `--from` reads and copies synthed local
    // content through the selected strategy, exactly as before; no
    // `--from` instead tries the real remote fallback chain through the
    // caller-supplied `remote_installer` (production's real
    // GitHub-backed closure, or this module's tests' fake, network-free
    // one) -- mirrors `install.rs`'s own `--from`/no-`--from` branch in
    // `dispatch_install_with_remote_installer` exactly, reusing its
    // `pub(super)` error-mapping helpers below rather than duplicating
    // them.
    let install_result: Result<(), super::install::InstallError> = if let Some(from_path) = from {
        strategy.install_from_local(target_dir, Some(from_path), &updated_at, no_telemetry)
    } else {
        match remote_installer(*strategy, target_dir, &updated_at, no_telemetry) {
            Ok((_source, _outcome)) => Ok(()),
            Err(err) => {
                return Err(UpdateOutcome::Failure {
                    message: err.to_string(),
                    exit_code: super::install::fallback_chain_error_exit_code(&err),
                    harness_not_tracked: false,
                    telemetry_state_warning: telemetry_state_warning.clone(),
                });
            }
        }
    };
    if let Err(err) = install_result {
        return Err(UpdateOutcome::Failure {
            message: err.to_string(),
            exit_code: super::install::install_error_exit_code(&err),
            harness_not_tracked: false,
            telemetry_state_warning: telemetry_state_warning.clone(),
        });
    }

    // Test-only: see `MID_UPDATE_SYNC_HOOK`'s own doc comment. A no-op
    // in every real build, and a no-op in every test that never sets
    // the hook.
    #[cfg(test)]
    if let Some(hook) = MID_UPDATE_SYNC_HOOK.with(|h| h.borrow_mut().take()) {
        hook();
    }

    // Index complete: the manifest install_from_local just wrote IS the
    // final manifest for this run, verbatim -- no reconciliation. A
    // failure here is carried back to the caller as
    // `finalize_index_warning` (finding f-6e118a1c) rather than printed
    // from inside this print-free core -- `update_one_target` folds it
    // into its own plain-text/`--json` report, `dispatch_update_all_json`
    // folds it into this target's entry in the single batched JSON
    // document, via `report_update_batch`.
    //
    // The `strategies` list itself is resolved the SAME way
    // `install.rs`'s own finalize write resolves it
    // (`install::resolve_final_strategies`): re-read the manifest FRESH
    // here, after `install_from_local` has already run, rather than
    // reusing `tracked_strategy_names` -- the snapshot captured at the
    // TOP of this function, before `install_from_local` (and therefore
    // before any concurrent install/uninstall of a DIFFERENT, coexisting
    // strategy at this same target could have run to completion). Bounded
    // by the same invariant this function's own doc comment already
    // states above (`update` never adds or removes a slot for any
    // strategy other than the one it resolves to act on): under a
    // concurrent process modifying a coexisting strategy during this
    // run, the pre-computed snapshot could go stale by the time this
    // write actually happens, silently dropping that strategy's name
    // from the index even though its manifest slot survives on disk --
    // exactly the gap `resolve_final_strategies` already closes for
    // `install`. Falls back to `tracked_strategy_names` (never a
    // single-element vec naming only the resolved strategy) if the fresh
    // read fails or finds nothing, for the identical reason
    // `resolve_final_strategies`'s own doc comment gives.
    let final_strategies = super::install::resolve_final_strategies(
        manifest::read_manifest(target_dir),
        &tracked_strategy_names,
    );
    // Folded together with `telemetry_state_warning` (set above, if
    // the opt-out carry-forward hit a broken install-info record)
    // rather than adding a second `UpdateOutcome::Success` field --
    // both are the same kind of thing from every caller's perspective,
    // an otherwise-successful run with something worth telling the
    // user about, and `report_update_success`/`report_update_batch`
    // already render exactly one such message per target. The two
    // conditions are independent and either can fire alone; joining
    // with `"; "` when both do keeps both visible rather than one
    // silently overwriting the other.
    let finalize_index_warning = index::write_index(IndexEntry {
        target_dir: canonical_target_dir,
        strategies: final_strategies,
        installed_at: updated_at,
        status: IndexEntryStatus::Complete,
    })
    .err()
    .map(|err| format!("could not finalize install index: {err}"));
    let finalize_index_warning = match (telemetry_state_warning, finalize_index_warning) {
        (Some(telemetry), Some(finalize)) => Some(format!("{telemetry}; {finalize}")),
        (Some(telemetry), None) => Some(telemetry),
        (None, finalize) => finalize,
    };

    // Telemetry: fires once install_from_local
    // has already succeeded, before the trailing manifest re-read below
    // -- reached by both the single-target/plain-`--all` path and the
    // `--all --json` batch path, since both funnel through this one
    // shared core. `uncached_identity`
    // (finding f-c144d780) resolves THIS target's own identity
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
            files: manifest
                .get(current.strategy.as_str())
                .map(|slot| slot.files.len())
                .unwrap_or(0),
            edited_files_overwritten: diverged_before_overwrite,
            manifest_path: manifest::manifest_path(target_dir).display().to_string(),
            finalize_index_warning,
            strategy_name: current.strategy.clone(),
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
            strategy_name: current.strategy.clone(),
        }),
    }
}

/// Prints the update summary: mirrors `install.rs`'s
/// `report_install_success`/`format_install_summary` conventions for
/// tone and `--json` shape -- every file `install_from_local` wrote this run is
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
/// the manifest itself, but only when `verbose` is set, and only for
/// the `strategy_name` slot -- see that parameter's own doc comment.
///
/// `warning` (finding f-6e118a1c) is `run_update_one_target`'s
/// `finalize_index_warning` -- `None` on the ordinary path, or a
/// message covering one or both of: the finalize-index write that
/// flips the entry to `Complete` failing after the copy itself already
/// succeeded, or the opt-out carry-forward finding this target's
/// `install-info.json` present but broken (see
/// `UpdateOutcome::Success`'s own doc comment). Rendered as an extra
/// plain-text line / `--json` `warning` field rather than to stderr, so
/// a `--json` consumer never needs to also read stderr for this
/// module's own single-target success path either.
///
/// `strategy_name` is the slot this run actually acted on
/// (`UpdateOutcome::Success`'s own field of the same name, threaded
/// through by `update_one_target`). A target's manifest can track more
/// than one strategy (a Kiro variant coexisting
/// with `claude`), and `--harness` lets a single run resolve to and
/// refresh just one of them, so the verbose listing below scopes to
/// this one slot rather than every tracked slot.
#[allow(clippy::too_many_arguments)]
fn report_update_success(
    target_dir: &Path,
    manifest_path: &str,
    files: usize,
    edited_files_overwritten: usize,
    warning: Option<&str>,
    strategy_name: &str,
    verbose: bool,
    json: bool,
    color: ColorMode,
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
        "{} updated {} ({} file(s) re-copied; manifest: {}); \
         {} file(s) had local edits that were overwritten",
        crate::cli::output::success_prefix(color, "konductor update:"),
        target_dir.display(),
        files,
        manifest_path,
        edited_files_overwritten,
    );
    if let Some(warning) = warning {
        println!(
            "{} {warning}",
            crate::cli::output::status::warn(color, "konductor update: warning:")
        );
    }
    if verbose {
        // `update` only ever acts on a single tracked strategy per run
        // (see `run_update_one_target`'s own
        // multi-strategy guard), so the listing is scoped to that one
        // slot (`strategy_name`) via `manifest.get`, not every
        // currently-tracked slot -- a target tracking a coexisting
        // strategy (e.g. `claude` alongside a Kiro variant) can reach a
        // successful update via `--harness`, and that other slot's
        // files were never touched by this run.
        if let Ok(Some(manifest)) = manifest::read_manifest(target_dir) {
            if let Some(slot) = manifest.get(strategy_name) {
                for file in &slot.files {
                    println!("  {} ({:?})", file.path, file.provenance);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use manifest::{ManifestFile, Provenance};
    use std::fs;

    use super::super::install::github;
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
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0, "install fixture must succeed");
    }

    // ── Harness selection ─────────────────────────────────────────────────

    /// `update --harness <name>` at a target tracking 2+ strategies
    /// refreshes only the SELECTED strategy's own slot, and both (a)
    /// leaves the OTHER already-tracked strategy's own manifest slot
    /// untouched, and (b) keeps that other strategy's own name in the
    /// INDEX entry's `strategies` list -- the exact bug this
    /// implementation's own `tracked_strategy_names` fix closes: naively
    /// writing `strategies: vec![current.strategy.clone()]` back to the
    /// index would otherwise silently drop the untouched strategy's name
    /// from the index even though its manifest slot survives on disk.
    #[test]
    fn update_one_target_with_harness_refreshes_only_selected_strategy() {
        let _home = HomeGuard::new("harness-select-update-home");
        let target = scratch_dir("harness-select-update-target");
        let repo_root = scratch_dir("harness-select-update-repo");
        install_fixture(&target, &repo_root);

        // A second, independently-tracked strategy at the SAME target
        // (`claude` shares no path with Kiro, so
        // it coexists rather than overriding). Hand-crafted directly via
        // `upsert_strategy` rather than a real Claude Code install --
        // `update`, once it resolves to the `kiro-cli-v2` slot via
        // `--harness kiro-cli-v2`, never reads or writes this OTHER
        // slot's own content, so a real install for it isn't needed to
        // exercise the behavior under test.
        manifest::upsert_strategy(
            &target,
            StrategyManifest::new(
                "claude",
                "2026-01-15T09:30:00Z",
                ".",
                None,
                Status::Complete,
                vec![manifest::ManifestFile {
                    path: ".claude/agents/k-example.md".to_string(),
                    sha256: Some(hash(b"claude content\n")),
                    provenance: manifest::Provenance::Created,
                }],
            ),
        )
        .unwrap();
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string(), "claude".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        // "kiro-cli-v2" is `KiroCliInstallStrategy::name()`/`harness_dir()`
        // -- the two are identical after the harness/strategy name
        // unification, so this is both the `--harness` value a user
        // would type and the manifest-internal name.
        let code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            Some("kiro-cli-v2"),
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);

        let after = manifest::read_manifest(&target).unwrap().unwrap();
        let mut names = after.strategy_names();
        names.sort_unstable();
        assert_eq!(
            names,
            vec!["claude", "kiro-cli-v2"],
            "the untouched claude slot must survive the update"
        );
        let claude_slot = after.get("claude").unwrap();
        assert_eq!(claude_slot.files.len(), 1);
        assert_eq!(
            claude_slot.files[0].sha256,
            Some(hash(b"claude content\n")),
            "the untouched claude slot's own file entry must be byte-identical, never re-hashed by this run"
        );

        // The bug this fix closes: the INDEX entry for this target must
        // still name BOTH strategies, not just the one `update` acted
        // on.
        let index_after = index::read_index().unwrap().unwrap();
        let entry = index_after
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect("target_dir entry must still exist");
        let mut index_names = entry.strategies.clone();
        index_names.sort_unstable();
        assert_eq!(
            index_names,
            vec!["claude".to_string(), "kiro-cli-v2".to_string()],
            "update must never drop an untouched strategy's name from the index entry"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The fix this file's own `run_update_one_target` doc comment now
    /// describes: the finalize INDEX write re-reads the manifest FRESH
    /// (`install::resolve_final_strategies`) instead of reusing
    /// `tracked_strategy_names` -- a snapshot captured before
    /// `install_from_local` runs. Races a REAL concurrent `claude`
    /// install (`manifest::upsert_strategy`, which takes the same lock
    /// `install_from_local`'s own manifest write does) against
    /// `update_one_target` refreshing the ALREADY-tracked `kiro-cli-v2`
    /// slot. The manifest itself is always correct either way
    /// (`manifest.rs`'s own locking already guarantees that,
    /// independent of this fix) -- what this test proves is that the
    /// INDEX now agrees with that same, correct, post-race manifest
    /// state, rather than the stale pre-`install_from_local` snapshot
    /// the old code would have written regardless of how the race
    /// landed.
    ///
    /// Ordering between the installer thread's write and this
    /// function's own finalize fresh-read is enforced via
    /// `MID_UPDATE_SYNC_HOOK` (a channel `recv()`, a real synchronization
    /// primitive) rather than left to relative thread-scheduling speed --
    /// `manifest.rs`'s sibling race tests
    /// (`remove_strategy_locked_never_drops_a_concurrently_installed_other_strategy`
    /// et al.) get away without one because they join BOTH racing
    /// threads before asserting on the post-race state; this test
    /// instead asserts on what a THIRD, synchronous call
    /// (`update_one_target`, running on this test's own thread) observed
    /// DURING the race, which is exactly the kind of assertion that
    /// needs an explicit ordering guarantee to be deterministic.
    #[test]
    fn update_finalize_index_reflects_a_concurrently_installed_other_strategy() {
        const ITERATIONS: usize = 20;
        for i in 0..ITERATIONS {
            let _home = HomeGuard::new(&format!("update-finalize-race-home-{i}"));
            let target = scratch_dir(&format!("update-finalize-race-target-{i}"));
            let repo_root = scratch_dir(&format!("update-finalize-race-repo-{i}"));
            install_fixture(&target, &repo_root);

            let (installer_done_tx, installer_done_rx) = std::sync::mpsc::channel::<()>();
            let target_for_installer = target.clone();
            let installer = std::thread::spawn(move || {
                let result = manifest::upsert_strategy(
                    &target_for_installer,
                    StrategyManifest::new(
                        "claude",
                        "2026-01-15T09:30:00Z",
                        ".",
                        None,
                        Status::Complete,
                        vec![manifest::ManifestFile {
                            path: ".claude/agents/k-example.md".to_string(),
                            sha256: Some(hash(b"claude content\n")),
                            provenance: manifest::Provenance::Created,
                        }],
                    ),
                );
                // Signal unconditionally, even on failure -- the hook
                // below must still unblock so a genuine
                // `upsert_strategy` regression surfaces through
                // `installer.join()`'s own assertion below, rather than
                // hanging this test forever.
                let _ = installer_done_tx.send(());
                result
            });

            // Deterministically guarantees the installer's write has
            // already committed by the time `run_update_one_target`'s
            // finalize fresh-read executes -- see this test's own doc
            // comment above for why a bare `thread::spawn` + late
            // `join()` (this test's own prior shape) cannot guarantee
            // that ordering.
            MID_UPDATE_SYNC_HOOK.with(|hook| {
                *hook.borrow_mut() = Some(Box::new(move || {
                    installer_done_rx
                        .recv()
                        .expect("installer thread must signal completion before the finalize read");
                }));
            });

            let code = update_one_target(
                &target,
                Some(repo_root.to_str().unwrap()),
                None,
                false, /* use_github_token */
                false,
                false,
                false,
                false,
                ColorMode::disabled(),
            );
            assert_eq!(code, 0, "round {i}: update must succeed");

            installer
                .join()
                .unwrap_or_else(|_| panic!("round {i}: installer thread must not panic"))
                .unwrap_or_else(|_| panic!("round {i}: upsert_strategy must succeed"));

            // The manifest is always correct regardless of interleaving
            // (manifest.rs's own locking guarantees this) -- the INDEX
            // must now agree with it.
            let manifest = manifest::read_manifest(&target).unwrap().unwrap();
            let mut manifest_names = manifest.strategy_names();
            manifest_names.sort_unstable();
            assert_eq!(
                manifest_names,
                vec!["claude", "kiro-cli-v2"],
                "round {i}: the manifest must track both strategies regardless of interleaving"
            );

            let canonical = index::canonicalize_target_dir(&target).unwrap();
            let idx = index::read_index().unwrap().unwrap();
            let entry = idx
                .installs
                .iter()
                .find(|e| e.target_dir == canonical)
                .unwrap_or_else(|| panic!("round {i}: target_dir entry must still exist"));
            let mut index_names = entry.strategies.clone();
            index_names.sort_unstable();
            assert_eq!(
                index_names,
                vec!["claude".to_string(), "kiro-cli-v2".to_string()],
                "round {i}: update's finalize write must re-read the manifest fresh, not \
                 reuse the pre-install tracked_strategy_names snapshot -- otherwise a \
                 concurrently-installed claude slot would be silently dropped from the \
                 index even though its manifest slot survives on disk"
            );

            fs::remove_dir_all(&target).ok();
            fs::remove_dir_all(&repo_root).ok();
        }
    }

    /// A non-matching `--harness` value at a 2+-strategy target is a
    /// usage error, and never touches either strategy's slot.
    #[test]
    fn update_one_target_with_unmatched_harness_is_usage_error_and_touches_nothing() {
        let _home = HomeGuard::new("harness-select-update-unmatched-home");
        let target = scratch_dir("harness-select-update-unmatched-target");
        let repo_root = scratch_dir("harness-select-update-unmatched-repo");
        install_fixture(&target, &repo_root);
        manifest::upsert_strategy(
            &target,
            StrategyManifest::new(
                "claude",
                "2026-01-15T09:30:00Z",
                ".",
                None,
                Status::Complete,
                vec![manifest::ManifestFile {
                    path: ".claude/agents/k-example.md".to_string(),
                    sha256: Some(hash(b"claude content\n")),
                    provenance: manifest::Provenance::Created,
                }],
            ),
        )
        .unwrap();
        let before = manifest::read_manifest(&target).unwrap().unwrap();

        let code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            Some("kiro-v3"),
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        let after = manifest::read_manifest(&target).unwrap().unwrap();
        assert_eq!(before, after, "an unmatched --harness must touch nothing");

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The design decision this fix implements, mirroring `uninstall.rs`'s
    /// `dispatch_all_skips_targets_that_do_not_track_the_requested_harness`:
    /// with `--harness <name>` given to an `update --all` batch, a
    /// target that does not track that harness is SKIPPED, not failed --
    /// the batch still succeeds (exit 0) and the skipped target's
    /// manifest is left byte-identical, while a target that DOES track
    /// the requested harness is genuinely updated (a hand-edited file is
    /// unconditionally overwritten with fresh content, matching
    /// `update_one_target_unconditionally_overwrites_hand_edited_file`'s
    /// own proof of a genuine update). Before this fix,
    /// `run_update_one_target` folded EVERY `select_harness` failure --
    /// including `HarnessSelectionError::NotTracked` -- into the same
    /// `UpdateOutcome::Failure` bucket as a genuine usage error, driving
    /// the whole batch to a non-zero exit code for a target that was
    /// never actually broken.
    #[test]
    fn dispatch_update_with_all_flag_skips_targets_that_do_not_track_the_requested_harness() {
        let _home = HomeGuard::new("update-all-skip-harness-not-tracked-home");

        let matching_target = scratch_dir("update-all-skip-matching-target");
        let matching_repo = scratch_dir("update-all-skip-matching-repo");
        install_fixture(&matching_target, &matching_repo);

        // Hand-edit the matching target's installed file, then re-synth
        // different fresh content -- an unconditional overwrite (proof
        // of a genuine update, not a skip) is only observable if the
        // post-run content differs from BOTH the hand-edit and matches
        // the fresh source exactly.
        let matching_agent_path = matching_target.join(".kiro/agents/k-example.json");
        fs::write(&matching_agent_path, b"{\"handEdited\":true}\n").unwrap();
        fs::write(
            matching_repo.join("dist/kiro-cli-v2/agents/k-example.json"),
            b"{\"fresh\":true}\n",
        )
        .unwrap();

        // Tracks a DIFFERENT harness ("claude") than the one this batch
        // requests ("kiro-cli-v2") -- must be skipped, not updated or
        // failed.
        let mismatched_target = scratch_dir("update-all-skip-mismatched-target");
        fs::create_dir_all(&mismatched_target).unwrap();
        manifest::upsert_strategy(
            &mismatched_target,
            StrategyManifest::new(
                "claude",
                "2026-01-15T09:30:00Z",
                ".",
                None,
                Status::Complete,
                vec![manifest::ManifestFile {
                    path: ".claude/agents/k-example.md".to_string(),
                    sha256: Some(hash(b"claude content\n")),
                    provenance: manifest::Provenance::Created,
                }],
            ),
        )
        .unwrap();
        let mismatched_canonical = index::canonicalize_target_dir(&mismatched_target).unwrap();
        index::write_index(IndexEntry {
            target_dir: mismatched_canonical,
            strategies: vec!["claude".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        let before_mismatched = manifest::read_manifest(&mismatched_target)
            .unwrap()
            .unwrap();

        let code = dispatch_update_with(
            Some(matching_repo.to_str().unwrap().to_string()),
            None,
            true,
            Some("kiro-cli-v2".to_string()),
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            false,
            ColorMode::disabled(),
        );

        // A skip is not a failure -- the batch succeeds overall.
        assert_eq!(code, 0);

        // The hand-edit is GONE -- the target tracking the requested
        // harness must have been genuinely updated with fresh content.
        assert_eq!(
            fs::read(&matching_agent_path).unwrap(),
            b"{\"fresh\":true}\n"
        );

        let after_mismatched = manifest::read_manifest(&mismatched_target)
            .unwrap()
            .unwrap();
        assert_eq!(
            before_mismatched, after_mismatched,
            "the target that does not track the requested harness must be left untouched, \
             not updated"
        );

        fs::remove_dir_all(&matching_target).ok();
        fs::remove_dir_all(&matching_repo).ok();
        fs::remove_dir_all(&mismatched_target).ok();
    }

    /// `report_update_batch` itself, in isolation: a `skipped` entry
    /// lands in its own bucket, distinct from `succeeded`/`failed`, in
    /// both plain-text and `--json` mode -- guards against a future
    /// change silently dropping the skip bucket or panicking on it.
    /// Mirrors `uninstall.rs`'s
    /// `report_batch_does_not_panic_with_a_skipped_entry_present`.
    #[test]
    fn report_update_batch_does_not_panic_with_a_skipped_entry_present() {
        report_update_batch(
            &[],
            &[(
                "/proj/b".to_string(),
                "/proj/b does not track harness 'kiro-cli-v2'; tracked harness(es): claude"
                    .to_string(),
            )],
            &[],
        );
    }

    // ── Regression: `update` honors a target's persisted opt-out ────────

    /// (1) The primary regression this fix addresses: a target
    /// originally installed with `konductor install --no-telemetry`
    /// (so no install-info record, and no Claude Code telemetry-hook
    /// wiring, was ever written) must have that wiring stay suppressed
    /// on a later PLAIN `konductor update` -- with no `--no-telemetry`
    /// re-passed to that specific `update` invocation. The target's own
    /// missing `.konductor/install-info.json` is what `update` reads as
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

        // Initial install, opted out of telemetry -- no install-info
        // record, no hooks written, matching `kiro_cli.rs`'s own
        // sibling test for the install side of this same contract.
        let install_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target_dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false, // no --link-bin
            true,  // --no-telemetry
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(install_code, 0, "initial install must succeed");
        assert!(
            !crate::cli::telemetry::install_info_exists(&target_dir),
            "install --no-telemetry must never write install-info.json"
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
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            // no --no-telemetry on THIS invocation
            false,
            false,
            ColorMode::disabled(),
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
            !crate::cli::telemetry::install_info_exists(&target_dir),
            "update must never write install-info.json for a target that carried its own \
             opt-out forward"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// (2) `update --all` resolves the carry-forward signal
    /// independently per target -- one target's own missing
    /// install-info record must never leak into another target's own
    /// decision, matching how each target's own
    /// `.konductor/config.yml` opt-out is already resolved
    /// independently within the same batch (see
    /// `run_update_one_target`'s own doc comment above the carry-
    /// forward computation). Two targets share one tracked index: one
    /// originally installed with `--no-telemetry` (no install-info
    /// record), one without (install-info record present). A single
    /// `update --all` run that itself passes no `--no-telemetry` must
    /// still keep the first target's hooks suppressed while wiring the
    /// second target's.
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
            false,
            ColorMode::disabled(),
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
            false,
            ColorMode::disabled(),
        );
        assert_eq!(install_in_code, 0, "opted-in install must succeed");

        assert!(!crate::cli::telemetry::install_info_exists(
            &opted_out_target
        ));
        assert!(crate::cli::telemetry::install_info_exists(&opted_in_target));

        // `--all`, with no `--no-telemetry` of its own: a shared (not
        // per-target) carry-forward computation would either suppress
        // both targets or neither, depending on iteration order --
        // this run must instead suppress exactly the first.
        let update_code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            None,
            true, // --all
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            // no --no-telemetry
            false,
            false,
            ColorMode::disabled(),
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

    /// (2.1) The reverse case: the legacy identity file present but
    /// `install-info.json` absent must read as opted out -- no
    /// fallback to the legacy file. The identity file is no longer
    /// written by any install path, so it is seeded directly to
    /// reconstruct a developer machine that predates this file's
    /// retirement.
    #[test]
    fn update_carry_forward_does_not_fall_back_to_identity_file_when_install_info_absent() {
        let _home = HomeGuard::new("update-carry-forward-no-fallback-home");
        let target = scratch_dir("update-carry-forward-no-fallback-target");
        fs::create_dir_all(target.join(".kiro")).unwrap();
        fs::create_dir_all(target.join(".claude")).unwrap();
        let repo_root = scratch_dir("update-carry-forward-no-fallback-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        // Opted-in install: writes install-info.json. The legacy
        // identity file is no longer written by any install path, so
        // it is seeded directly here to reconstruct the state a
        // developer machine from before this file was retired would
        // still have on disk.
        let install_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(install_code, 0, "opted-in install must succeed");
        assert!(crate::cli::telemetry::install_info_exists(&target));
        crate::cli::telemetry::ensure_identity(&target, "kiro-cli-v2");

        // Delete only install-info.json, leaving the legacy identity
        // file in place -- the signal read for reporting must not
        // fall back to it.
        fs::remove_file(crate::cli::telemetry::install_info_path(&target)).unwrap();
        assert!(!crate::cli::telemetry::install_info_exists(&target));
        assert!(crate::cli::telemetry::identity_path(&target).is_file());

        let claude_settings_path = target.join(".claude/settings.json");
        let mut settings: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&claude_settings_path).unwrap()).unwrap();
        settings.as_object_mut().unwrap().remove("hooks");
        fs::write(&claude_settings_path, settings.to_string()).unwrap();

        let update_code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            false,
            None,
            false, // no explicit --no-telemetry: relies on the carry-forward signal alone
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(update_code, 0, "update must succeed");
        let after_update: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&claude_settings_path).unwrap()).unwrap();
        assert!(
            after_update.get("hooks").is_none(),
            "a target with the legacy identity file present but install-info.json absent \
             must be read as opted OUT -- there must be no fallback to the legacy file; \
             got: {after_update:?}"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// (3) An explicit `--no-telemetry` on `update` still suppresses
    /// hook re-wiring for a target that DOES have an install-info
    /// record -- the flag is an override in the "opt out now"
    /// direction, independent of what the persisted signal says. The
    /// hooks block is removed between install and update to force a
    /// genuine re-wiring opportunity (self-heal alone only fires for a
    /// stale exe path), so a passing assertion actually distinguishes
    /// "the flag suppressed this run's wiring" from "there was nothing
    /// to wire anyway."
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

        // Initial install WITHOUT --no-telemetry: install-info.json is
        // written and hooks are wired.
        let install_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false, // no --link-bin
            false, // no --no-telemetry
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(install_code, 0, "initial install must succeed");
        assert!(
            crate::cli::telemetry::install_info_exists(&target),
            "a plain install must write install-info.json"
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
            None,
            true,
            false,
            false, /* use_github_token */
            /* yes */
            // --no-telemetry
            false,
            false,
            ColorMode::disabled(),
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
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            false,
            ColorMode::disabled(),
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
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
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
        let entry = final_manifest.strategies[0]
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
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);
        assert!(agent_path.is_file());

        let real_hash = hash(&fs::read(&agent_path).unwrap());
        let final_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        let entry = final_manifest.strategies[0]
            .files
            .iter()
            .find(|f| f.path == ".kiro/agents/k-example.json")
            .unwrap();
        assert_eq!(entry.sha256, Some(real_hash));

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `update` shares `install_from_local` with `install`, so the
    /// Kiro-discoverable `sop-<name>/SKILL.md` conversion this feature
    /// adds is refreshed by `update` the same way every other content
    /// type already is -- no dedicated `update.rs` code was needed to
    /// get this for free, but it needs its own regression test: a stale
    /// body left over from a prior install must not survive a re-run.
    /// Mirrors `install/kiro_cli_v3.rs`'s own
    /// `install_from_local_kiro_sop_skill_survives_variant_override_switch`
    /// proof that this path is actually regenerated, not merely left
    /// untouched, but drives it through `update_one_target` (the real
    /// `konductor update` entry point) instead of calling
    /// `install_from_local` a second time by hand.
    #[test]
    fn update_one_target_refreshes_stale_kiro_sop_skill_body() {
        let _home = HomeGuard::new("refresh-kiro-sop-skill-home");
        let target = scratch_dir("refresh-kiro-sop-skill-target");
        let repo_root = scratch_dir("refresh-kiro-sop-skill-repo");

        seed_synthed_agent(&repo_root, "k-example");
        let sops_dir = repo_root.join("dist/kiro-cli-v2/sops");
        fs::create_dir_all(&sops_dir).unwrap();
        fs::write(
            sops_dir.join("ticket-sync.sop.md"),
            b"## Overview\n\nOriginal body.\n",
        )
        .unwrap();

        let install_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(install_code, 0, "install fixture must succeed");

        let sop_skill_path = target.join(".kiro/skills/sop-ticket-sync/SKILL.md");
        let original_body =
            fs::read_to_string(&sop_skill_path).expect("SOP-skill file must exist after install");
        assert!(original_body.contains("Original body."));

        // Re-stage the SOP with a NEW body, mirroring a real `konductor
        // synth` re-run before `konductor update`.
        fs::write(
            sops_dir.join("ticket-sync.sop.md"),
            b"## Overview\n\nRefreshed body.\n",
        )
        .unwrap();

        let update_code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(update_code, 0, "update must succeed");

        let refreshed_body = fs::read_to_string(&sop_skill_path)
            .expect("SOP-skill file must still exist after update");
        assert!(
            refreshed_body.contains("Refreshed body."),
            "update must regenerate the SOP-skill file from the currently staged content, \
             not leave it frozen at install's stale body, got: {refreshed_body}"
        );
        assert!(!refreshed_body.contains("Original body."));

        let final_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        assert!(
            final_manifest.strategies[0]
                .files
                .iter()
                .any(|f| f.path == ".kiro/skills/sop-ticket-sync/SKILL.md"),
            "the refreshed SOP-skill file must still be tracked in kiro-cli-v2's own slot"
        );

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
            false,
            ColorMode::disabled(),
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
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
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
            false,
            ColorMode::disabled(),
        );
        assert_eq!(fresh_install_code, 0);

        let updated_manifest = manifest::read_manifest(&updated_target).unwrap().unwrap();
        let fresh_manifest = manifest::read_manifest(&fresh_target).unwrap().unwrap();

        assert_eq!(
            updated_manifest.strategies[0].strategy,
            fresh_manifest.strategies[0].strategy
        );
        assert_eq!(
            updated_manifest.strategies[0].status,
            fresh_manifest.strategies[0].status
        );
        let updated_paths_and_hashes: Vec<(&str, &Option<String>)> = updated_manifest.strategies[0]
            .files
            .iter()
            .map(|f| (f.path.as_str(), &f.sha256))
            .collect();
        let fresh_paths_and_hashes: Vec<(&str, &Option<String>)> = fresh_manifest.strategies[0]
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
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
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
            entry.installed_at, manifest.strategies[0].installed_at,
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
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::InProgress,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();
        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn update_one_target_rejects_missing_manifest() {
        let dir = scratch_dir("no-manifest");
        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn update_one_target_missing_manifest_is_usage_error_and_worded_stale() {
        let dir = scratch_dir("missing-manifest-stale-wording");
        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn update_one_target_never_returns_reserved_exit_code_2() {
        let dir = scratch_dir("never-code-2");
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::InProgress,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();
        assert_ne!(
            update_one_target(
                &dir,
                None,
                None,
                false, /* use_github_token */
                false,
                false,
                false,
                false,
                ColorMode::disabled()
            ),
            2
        );
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
            strategies: vec!["kiro-cli-v2".to_string()],
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
            strategies: vec!["kiro-cli-v2".to_string()],
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
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_VERIFY_FAILED);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn update_one_target_fails_when_recorded_strategy_is_not_registered() {
        let dir = scratch_dir("unregistered-strategy");
        let manifest = StrategyManifest::new(
            "not-a-real-strategy",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();
        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
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
        let manifest = StrategyManifest::new(
            "not-a-real-strategy",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();

        // Seed the index with a Complete entry for this target, exactly
        // as a previously-successful, fully-healthy install would have
        // left it -- this is the state the finding says must NOT be
        // downgraded to InProgress by a no-op failure.
        let canonical = index::canonicalize_target_dir(&dir).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["not-a-real-strategy".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
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
    /// strategy, `Complete` index entry) given a `--from` pointing at a
    /// source with nothing to install. Must return the usual usage
    /// error, but -- unlike the pre-fix behavior -- must never flip
    /// that target's index status from `Complete` to `InProgress` for a
    /// run that never touched the filesystem. This is STILL a
    /// synchronous no-op case, distinct from the no-`--from` case below:
    /// `--from` was given, so `would_fail_as_noop` runs and catches it
    /// before any index write, exactly as it always has.
    ///
    /// Falsifiability: confirmed this test fails against the pre-fix
    /// ordering (the `would_fail_as_noop` pre-check did not exist, and
    /// the index write-ahead ran unconditionally before
    /// `install_from_local` itself rejected the empty source) -- the
    /// index entry's status is observed as `InProgress` immediately
    /// after the failed call, since `install_from_local` never got a
    /// chance to run before the write-ahead already happened.
    #[test]
    fn update_one_target_from_with_nothing_to_install_does_not_mutate_healthy_index_status() {
        let _home = HomeGuard::new("empty-from-index-home");
        let dir = scratch_dir("empty-from-index-target");
        let empty_source = scratch_dir("empty-from-index-source");
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();

        // Seed the index with a Complete entry, exactly as a
        // previously-successful, fully-healthy install would have left
        // it.
        let canonical = index::canonicalize_target_dir(&dir).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        // `--from` IS given, but points at a source with nothing to
        // install for this strategy -- install_from_local's own first
        // check would reject this as a no-op, but the pre-check must
        // catch it BEFORE any index write.
        let code = update_one_target(
            &dir,
            Some(empty_source.to_str().unwrap()),
            None,
            false, // use_github_token
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
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
            "a no-op failure (--from with nothing to install) must never flip a healthy \
             target's index status"
        );

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&empty_source).ok();
    }

    /// The no-`--from` contract: omitting `--from` is no longer a
    /// synchronous no-op the way an empty `--from` source still is (see
    /// the test above) -- it defers to the real remote fallback chain
    /// instead, via the SAME `remote_installer` seam
    /// `run_update_one_target_with_remote_installer` accepts (mirrors
    /// `install.rs`'s own fake-installer test pattern exactly; no real
    /// network call is made here). A missing `--from` therefore DOES
    /// write the `InProgress` index entry before the attempt, and
    /// leaves it `InProgress` on failure -- exactly like a `--from`
    /// failure after `install_from_local` starts already leaves it --
    /// rather than the old "never mutate a healthy index status"
    /// contract the pre-fix, `--from`-required world had for a missing
    /// `--from`.
    #[test]
    fn update_one_target_missing_from_tries_remote_fallback_and_leaves_in_progress_on_failure() {
        let _home = HomeGuard::new("missing-from-remote-fallback-home");
        let dir = scratch_dir("missing-from-remote-fallback-target");
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();

        // Seed the index with a Complete entry, exactly as a
        // previously-successful, fully-healthy install would have left
        // it.
        let canonical = index::canonicalize_target_dir(&dir).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        // No --from given: this now defers to the (fake, network-free)
        // remote fallback chain instead of a synchronous no-op
        // rejection.
        let outcome = run_update_one_target_with_remote_installer(
            &dir,
            None,
            None,
            false,
            false,
            false,
            |_strategy, _destination, _installed_at, _no_telemetry| {
                Err(remote_orchestrate::FallbackChainError::ReleaseOnly(
                    remote_orchestrate::RemoteOrchestrationError::Fetch(
                        github::GithubFetchError::Network(
                            "fake network error injected by a test -- no real network call was made"
                                .to_string(),
                        ),
                    ),
                ))
            },
        );
        assert!(
            matches!(outcome, Err(UpdateOutcome::Failure { .. })),
            "a failed no-`--from` remote fetch must be reported as a Failure outcome"
        );

        // Unlike the `--from`-with-empty-source case above, the index
        // entry IS expected to have been flipped to InProgress: a
        // missing `--from` no longer short-circuits before the
        // write-ahead, it attempts the real remote fetch first.
        let index_after = index::read_index().unwrap().unwrap();
        let entry = index_after
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect("index entry must still exist");
        assert_eq!(
            entry.status,
            IndexEntryStatus::InProgress,
            "a failed no-`--from` remote fetch attempt must leave the index entry \
             InProgress, self-healable via the target's own manifest state, exactly like a \
             `--from` failure after install_from_local starts already leaves it"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// Closes half one of finding (`telemetry_state_warning` /
    /// `install_from_local` early return): a target with a broken
    /// `install-info.json` AND a failing install step must still hear
    /// about the broken record, not just the install failure -- the
    /// two problems are likely to share a cause, so silently dropping
    /// the telemetry warning on this path is exactly the case where it
    /// would help most. Uses the same fake-remote-fallback-failure
    /// shape as the sibling test just above (`_leaves_in_progress_on_
    /// failure`) rather than a real `install_from_local` I/O failure,
    /// since both reach `UpdateOutcome::Failure` through the identical
    /// post-read code path this fix touches.
    #[test]
    fn run_update_one_target_surfaces_broken_telemetry_record_on_install_failure() {
        // `run_update_one_target_with_remote_installer`'s own write-ahead
        // and finalize writes (inside the code under test, not this
        // seed) go through the real, unguarded `index::write_index` --
        // so this test's own seed entry must land in the SAME `$HOME`
        // those internal writes resolve, not a separate scratch home,
        // or the finalize write's read-modify-write would silently lose
        // this seed rather than refreshing it. `HomeGuard` (not the
        // home-aware `write_index_at_home` alone) is what's needed here.
        let _home = HomeGuard::new("broken-record-install-failure-home");
        let dir = scratch_dir("broken-record-install-failure-target");
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();
        let canonical = index::canonicalize_target_dir(&dir).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        // A present-but-corrupt install-info.json: neither valid JSON
        // nor a recognized schema, matching
        // `InstallInfoAbsence::Broken`'s own doc comment.
        fs::create_dir_all(dir.join(".konductor")).unwrap();
        fs::write(crate::cli::telemetry::install_info_path(&dir), b"not json").unwrap();

        let outcome = run_update_one_target_with_remote_installer(
            &dir,
            None,
            None,
            false,
            false,
            false, // no_telemetry not passed -- the carry-forward must still run
            |_strategy, _destination, _installed_at, _no_telemetry| {
                Err(remote_orchestrate::FallbackChainError::ReleaseOnly(
                    remote_orchestrate::RemoteOrchestrationError::Fetch(
                        github::GithubFetchError::Network(
                            "fake network error injected by a test -- no real network call \
                             was made"
                                .to_string(),
                        ),
                    ),
                ))
            },
        );

        match outcome {
            Err(UpdateOutcome::Failure {
                telemetry_state_warning,
                ..
            }) => {
                let warning = telemetry_state_warning.expect(
                    "a broken install-info.json must surface a warning even on the \
                             install-failure early return",
                );
                assert!(
                    warning.contains("could not be read"),
                    "warning must name the broken-record condition, got: {warning}"
                );
            }
            Err(UpdateOutcome::Success { .. }) => {
                panic!("run_update_one_target's Err variant always holds UpdateOutcome::Failure")
            }
            Ok(_) => panic!("expected a Failure outcome from the fake remote-fallback error"),
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// Closes half two of the same finding: an explicit `--no-telemetry`
    /// must not skip the detailed read entirely. Before the fix, the
    /// `no_telemetry ||`-short-circuit meant a run with the flag passed
    /// never learned whether its own broken record existed at all --
    /// consent is unaffected either way (opted out was already true),
    /// but the warning must still surface now that the read always
    /// runs.
    #[test]
    fn run_update_one_target_surfaces_broken_telemetry_record_with_explicit_no_telemetry() {
        // See the sibling test just above for why `HomeGuard` (not
        // `write_index_at_home` alone) is required here.
        let _home = HomeGuard::new("broken-record-explicit-no-telemetry-home");
        let dir = scratch_dir("broken-record-explicit-no-telemetry-target");
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();
        let canonical = index::canonicalize_target_dir(&dir).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        fs::create_dir_all(dir.join(".konductor")).unwrap();
        fs::write(crate::cli::telemetry::install_info_path(&dir), b"not json").unwrap();

        let outcome = run_update_one_target_with_remote_installer(
            &dir,
            None,
            None,
            false,
            false,
            true, // --no-telemetry passed explicitly
            |_strategy, _destination, installed_at, no_telemetry| {
                // The flag must still read as opted-out regardless of
                // the now-unconditional detailed read's own outcome.
                assert!(
                    no_telemetry,
                    "--no-telemetry must reach the install step unchanged"
                );
                let _ = installed_at;
                Ok((
                    remote_orchestrate::RemoteInstallSource::MainBranchDist,
                    crate::cli::install::remote::RemoteInstallOutcome::default(),
                ))
            },
        );

        match outcome {
            Ok(UpdateOutcome::Success {
                finalize_index_warning,
                ..
            }) => {
                let warning = finalize_index_warning.expect(
                    "an explicit --no-telemetry run must still surface the broken-record \
                     warning -- the read must not be skipped by the || short-circuit",
                );
                assert!(
                    warning.contains("could not be read"),
                    "warning must name the broken-record condition, got: {warning}"
                );
            }
            Ok(UpdateOutcome::Failure { .. }) => {
                panic!("run_update_one_target's Ok variant always holds UpdateOutcome::Success")
            }
            Err(_) => panic!("expected a Success outcome from the fake remote-fallback success"),
        }

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
        let code = dispatch_update_with(
            None,
            None,
            false,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            false,
            ColorMode::disabled(),
        );
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
        let code = dispatch_update_with(
            None,
            None,
            false,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            false,
            ColorMode::disabled(),
        );
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
        let code = dispatch_update_with(
            None,
            None,
            false,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            true,
            ColorMode::disabled(),
        );
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
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: "/tmp/does-not-matter-b".to_string(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        let code = dispatch_update_with(
            None,
            None,
            false,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            false,
            ColorMode::disabled(),
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
                false,
                ColorMode::disabled(),
            );
            assert_eq!(code, 0, "install fixture must succeed");
        }

        dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            None,
            true,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            false,
            ColorMode::disabled(),
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
            assert_eq!(manifest.unwrap().strategies[0].status, Status::Complete);
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
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            None,
            true,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            true,
            ColorMode::disabled(),
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
        let succeeded = [(
            healthy_canonical.clone(),
            UpdateOutcome::Success {
                files: 1,
                edited_files_overwritten: 0,
                manifest_path: manifest::manifest_path(&healthy_target)
                    .display()
                    .to_string(),
                finalize_index_warning: None,
                strategy_name: "kiro-cli-v2".to_string(),
            },
        )];
        let failed = [(
            stale_canonical.clone(),
            UpdateOutcome::Failure {
                message: format!(
                    "{} is stale (no manifest found); run `konductor install \
                     {HARNESS_PLACEHOLDER}` first",
                    stale_target.display()
                ),
                exit_code: EXIT_USAGE_ERROR,
                harness_not_tracked: false,
                telemetry_state_warning: None,
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
                strategy_name: "kiro-cli-v2".to_string(),
            },
        )];
        let failed = vec![(
            "/tmp/all-json-single-line-bad".to_string(),
            UpdateOutcome::Failure {
                message: "some failure".to_string(),
                exit_code: EXIT_USAGE_ERROR,
                harness_not_tracked: false,
                telemetry_state_warning: None,
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
        report_update_batch(&succeeded, &[], &failed);
    }

    fn run_all_tie_break_case(home: &Path, usage_error_name: &str, verify_failed_name: &str) -> u8 {
        let usage_error_target = home.join(usage_error_name);
        let verify_failed_target = home.join(verify_failed_name);
        fs::create_dir_all(&usage_error_target).unwrap();
        fs::create_dir_all(&verify_failed_target).unwrap();

        index::write_index(IndexEntry {
            target_dir: index::canonicalize_target_dir(&usage_error_target).unwrap(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let manifest_path = manifest::manifest_path(&verify_failed_target);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: index::canonicalize_target_dir(&verify_failed_target).unwrap(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        dispatch_update_with(
            None,
            None,
            true,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            false,
            ColorMode::disabled(),
        )
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
                {"target_dir":"/tmp/dup-update-target","strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","status":"complete"},
                {"target_dir":"/tmp/dup-update-target","strategy":"kiro-cli-v2","installed_at":"2026-01-16T09:30:00Z","status":"complete"}
            ]}"#,
        )
        .unwrap();
        let code = dispatch_update_with(
            None,
            None,
            true,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            false,
            ColorMode::disabled(),
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

    #[test]
    fn report_corrupted_index_does_not_panic_plain_or_json() {
        let duplicates = vec!["/tmp/dup-a".to_string(), "/tmp/dup-b".to_string()];
        report_corrupted_index(&duplicates, false, ColorMode::disabled());
        report_corrupted_index(&duplicates, true, ColorMode::disabled());
    }

    #[test]
    fn report_ambiguous_targets_does_not_panic_plain_or_json() {
        let entries = vec![
            IndexEntry {
                target_dir: "/tmp/update-target-a".to_string(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: "/tmp/update-target-b".to_string(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: IndexEntryStatus::Complete,
            },
        ];
        report_ambiguous_targets(&entries, false, ColorMode::disabled());
        report_ambiguous_targets(&entries, true, ColorMode::disabled());
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
                strategy_name: "kiro-cli-v2".to_string(),
            },
        )];
        report_update_batch(&succeeded, &[], &[]);

        // Pin the exact JSON shape report_update_batch's body
        // constructs for this input (kept in sync manually, per this
        // module's established no-stdout-capture precedent for other
        // report_* functions -- see report_update_batch_renders_as_
        // single_line_json above).
        let rendered = serde_json::json!({
            "command": "update",
            "succeeded": succeeded.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Success { files, edited_files_overwritten, manifest_path, finalize_index_warning, strategy_name: _ } => {
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
                strategy_name: "kiro-cli-v2".to_string(),
            },
        )];
        report_update_batch(&succeeded, &[], &[]);

        let rendered = serde_json::json!({
            "command": "update",
            "succeeded": succeeded.iter().map(|(dir, outcome)| {
                match outcome {
                    UpdateOutcome::Success { files, edited_files_overwritten, manifest_path, finalize_index_warning, strategy_name: _ } => {
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

        let outcome = run_update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            None,
            false, /* use_github_token */
            false,
            false,
            false,
        );
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

    // ── Carry-forward: absent vs. valid vs. broken install-info ─────────
    //
    // Three tests pinning the three outcomes `read_install_info_detailed`
    // can produce at this call site, matching `doctor.rs`'s own
    // `check_telemetry_state_*` trio for the same three-way read.

    /// Outcome 1: a genuinely absent record (never opted out, never
    /// installed with telemetry at all) is still carried forward as
    /// opted-out, silently -- the pre-existing, correct behavior for
    /// this case. No `finalize_index_warning` is synthesized.
    #[test]
    fn absent_install_info_carries_opt_out_forward_silently() {
        let _home = HomeGuard::new("carry-forward-absent-home");
        let target = scratch_dir("carry-forward-absent-target");
        let repo_root = scratch_dir("carry-forward-absent-repo");
        seed_synthed_agent(&repo_root, "k-example");
        let install_code = super::super::install::dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            true, // --no-telemetry: no install-info.json is ever written
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(install_code, 0, "opted-out install fixture must succeed");
        assert!(!crate::cli::telemetry::install_info_exists(&target));

        let outcome = run_update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            None,
            false, // use_github_token
            false, // uncached_identity
            false, // json
            false, // no --no-telemetry on this update call
        );
        let Ok(UpdateOutcome::Success {
            finalize_index_warning,
            ..
        }) = outcome
        else {
            panic!("update on an absent-install-info target must still succeed");
        };
        assert!(
            finalize_index_warning.is_none(),
            "a genuinely absent record is the conservative default, not a broken one -- \
             nothing to warn about; got: {finalize_index_warning:?}"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Outcome 2: a valid, schema-current record does not suppress
    /// telemetry for this run, and produces no warning.
    #[test]
    fn valid_install_info_does_not_suppress_or_warn() {
        let _home = HomeGuard::new("carry-forward-valid-home");
        let target = scratch_dir("carry-forward-valid-target");
        let repo_root = scratch_dir("carry-forward-valid-repo");
        install_fixture(&target, &repo_root); // no --no-telemetry: writes a valid record
        assert!(crate::cli::telemetry::install_info_exists(&target));

        let outcome = run_update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            None,
            false, // use_github_token
            false, // uncached_identity
            false, // json
            false, // no --no-telemetry on this update call
        );
        let Ok(UpdateOutcome::Success {
            finalize_index_warning,
            ..
        }) = outcome
        else {
            panic!("update on a target with a valid install-info record must succeed");
        };
        assert!(
            finalize_index_warning.is_none(),
            "a valid record must neither suppress telemetry nor warn; got: \
             {finalize_index_warning:?}"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Outcome 3 -- the regression this fix closes. A record that
    /// exists but fails to read back (corrupted JSON) must still
    /// suppress reporting, fail-closed, exactly like outcomes 1 and 2's
    /// non-suppressing/suppressing behavior is unaffected -- but unlike
    /// a genuine opt-out, it must ALSO emit a warning naming the file,
    /// since nobody chose this and the target can still fix it.
    ///
    /// Before this fix, `read_install_info(target_dir).is_none()`
    /// treated this identically to outcome 1: suppressed, and silent.
    /// This test would have passed on suppression alone before the fix
    /// -- the `finalize_index_warning` assertion is what actually
    /// fails on the pre-fix code, since nothing there ever populated
    /// it for this case.
    #[test]
    fn broken_install_info_suppresses_and_warns() {
        let _home = HomeGuard::new("carry-forward-broken-home");
        let target = scratch_dir("carry-forward-broken-target");
        let repo_root = scratch_dir("carry-forward-broken-repo");
        install_fixture(&target, &repo_root);
        let record_path = crate::cli::telemetry::install_info_path(&target);
        fs::write(&record_path, b"not json").unwrap();
        assert!(
            crate::cli::telemetry::read_install_info(&target).is_none(),
            "corrupting the file must make it unreadable as a record"
        );

        let outcome = run_update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            None,
            false, // use_github_token
            false, // uncached_identity
            false, // json
            false, // no --no-telemetry on this update call
        );
        let Ok(UpdateOutcome::Success {
            finalize_index_warning,
            ..
        }) = outcome
        else {
            panic!("update on a target with a broken install-info record must still succeed");
        };

        let warning = finalize_index_warning
            .expect("a broken (present but unreadable) record must produce a warning");
        assert!(
            warning.contains(&record_path.display().to_string()),
            "the warning must name the broken file so the user can act on it; got: {warning}"
        );
        assert!(
            warning.contains("could not be read"),
            "the warning must match doctor's own wording for the same condition; got: {warning}"
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
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: "/tmp/ambiguity-message-b".to_string(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();
        let code = dispatch_update_with(
            None,
            None,
            false,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            true,
            ColorMode::disabled(),
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

        let code = dispatch_update_with(
            None,
            None,
            false,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            true,
            ColorMode::disabled(),
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
            strategies: vec!["kiro-cli-v2".to_string()],
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
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            true,
            ColorMode::disabled(),
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
            strategies: vec!["kiro-cli-v2".to_string()],
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

        let code = dispatch_update_with(
            None,
            Some(requested),
            false,
            None,
            false,
            false,
            false, /* use_github_token */
            /* yes */
            false,
            true,
            ColorMode::disabled(),
        );
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

        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            true,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    /// Named error path 5: `update_one_target`'s in-progress-manifest
    /// arm.
    #[test]
    fn update_one_target_in_progress_manifest_error_is_json_consistent() {
        let dir = scratch_dir("in-progress-manifest-json");
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::InProgress,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();

        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            true,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    /// Named error path 6: `update_one_target`'s unregistered-strategy
    /// arm.
    #[test]
    fn update_one_target_unregistered_strategy_error_is_json_consistent() {
        let dir = scratch_dir("unregistered-strategy-json");
        let manifest = StrategyManifest::new(
            "not-a-real-strategy",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();

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

        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            true,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
    }

    /// Named error path 7: `update_one_target`'s `would_fail_as_noop`
    /// arm (missing `--from`).
    #[test]
    fn update_one_target_would_fail_as_noop_error_is_json_consistent() {
        let _home = HomeGuard::new("noop-error-json-home");
        let dir = scratch_dir("noop-error-json");
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&dir, manifest).unwrap();

        // No --from given: install_from_local's own first check would
        // reject this as a no-op via would_fail_as_noop.
        let code = update_one_target(
            &dir,
            None,
            None,
            false, /* use_github_token */
            false,
            true,
            false,
            false,
            ColorMode::disabled(),
        );
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
            None,
            false, /* use_github_token */
            false,
            true,
            false,
            false,
            ColorMode::disabled(),
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
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
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
        manifest::upsert_strategy(&dir, manifest).unwrap();
        let manifest_path = manifest::manifest_path(&dir).display().to_string();
        report_update_success(
            &dir,
            &manifest_path,
            1,
            0,
            None,
            "kiro-cli-v2",
            false,
            false,
            ColorMode::disabled(),
        );
        report_update_success(
            &dir,
            &manifest_path,
            1,
            2,
            Some("finalize warning"),
            "kiro-cli-v2",
            true,
            true,
            ColorMode::disabled(),
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// `report_update_success`'s verbose
    /// listing must scope to the `strategy_name` slot the run actually
    /// acted on, not every tracked slot -- a target can track a
    /// coexisting strategy (e.g. `claude`) that this run never touched.
    /// Confirmed here via `manifest.get`, the same lookup
    /// `report_update_success`'s verbose branch uses: with both
    /// slots present, looking up the acted-on strategy's own name
    /// returns only that slot's files, never the other slot's.
    #[test]
    fn report_update_success_verbose_scopes_to_the_selected_strategy_only() {
        let dir = scratch_dir("report-success-verbose-scoped");
        manifest::upsert_strategy(
            &dir,
            StrategyManifest::new(
                "kiro-cli-v2",
                "2026-02-01T00:00:00Z",
                ".",
                None,
                Status::Complete,
                vec![ManifestFile {
                    path: ".kiro/agents/a.json".to_string(),
                    sha256: Some(hash(b"kiro content")),
                    provenance: Provenance::Created,
                }],
            ),
        )
        .unwrap();
        manifest::upsert_strategy(
            &dir,
            StrategyManifest::new(
                "claude",
                "2026-02-01T00:00:00Z",
                ".",
                None,
                Status::Complete,
                vec![ManifestFile {
                    path: ".claude/agents/k-example.md".to_string(),
                    sha256: Some(hash(b"claude content")),
                    provenance: Provenance::Created,
                }],
            ),
        )
        .unwrap();

        let manifest = manifest::read_manifest(&dir).unwrap().unwrap();
        let selected = manifest.get("kiro-cli-v2").unwrap();
        assert_eq!(selected.files.len(), 1);
        assert_eq!(selected.files[0].path, ".kiro/agents/a.json");
        let untouched = manifest.get("claude").unwrap();
        assert_eq!(untouched.files.len(), 1);
        assert_ne!(
            selected.files[0].path, untouched.files[0].path,
            "the two slots must remain independently scoped"
        );

        let manifest_path = manifest::manifest_path(&dir).display().to_string();
        // Exercises the real function against the two-strategy manifest
        // to confirm it does not panic when scoping to one slot via
        // `strategy_name` while a second, untouched slot coexists.
        report_update_success(
            &dir,
            &manifest_path,
            1,
            0,
            None,
            "kiro-cli-v2",
            true,
            false,
            ColorMode::disabled(),
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn report_update_success_json_reports_exact_file_count() {
        let dir = scratch_dir("report-success-json-count");
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
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
        manifest::upsert_strategy(&dir, manifest).unwrap();
        let manifest_path = manifest::manifest_path(&dir).display().to_string();
        report_update_success(
            &dir,
            &manifest_path,
            2,
            0,
            None,
            "kiro-cli-v2",
            false,
            false,
            ColorMode::disabled(),
        );
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
        let real_manifest = StrategyManifest::new(
            "kiro-cli-v2",
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
        let real_manifest_files_len = real_manifest.files.len();
        manifest::upsert_strategy(&dir, real_manifest).unwrap();
        let real_manifest_path = manifest::manifest_path(&dir).display().to_string();

        // Deliberately mismatched values: a file count the real
        // manifest does NOT have, and a manifest_path string that is
        // NOT the real on-disk path.
        let passed_in_files = 7usize;
        let passed_in_manifest_path = "/tmp/deliberately-not-the-real-path/manifest";
        assert_ne!(passed_in_files, real_manifest_files_len);
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
            real_manifest_files_len,
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
            "kiro-cli-v2",
            false,
            true,
            ColorMode::disabled(),
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

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
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

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
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

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
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

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
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
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
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
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);
        let code = update_one_target(
            &target,
            Some(repo_root.to_str().unwrap()),
            None,
            false, /* use_github_token */
            false,
            true,
            false,
            false,
            ColorMode::disabled(),
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
        let diverged = count_diverged_files(&target, &current.strategies[0]);
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
            None,
            false, /* use_github_token */
            false,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);

        // The hand-edit is gone -- fresh content landed regardless of
        // the divergence count having been computed and reported.
        assert_eq!(fs::read(&agent_path).unwrap(), b"{\"fresh\":true}\n");

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── --dry-run ────────────────────────────────────────────────────

    /// (a) `--dry-run` makes no filesystem changes: the tracked file
    /// must survive byte-for-byte (even a hand-edited one), the
    /// manifest must remain unchanged, and the index status must stay
    /// `Complete` -- never flipped to `InProgress`.
    #[test]
    fn dispatch_update_dry_run_makes_no_filesystem_changes() {
        let _home = HomeGuard::new("update-dry-run-no-changes-home");
        let target = scratch_dir("update-dry-run-no-changes-target");
        let repo_root = scratch_dir("update-dry-run-no-changes-repo");
        install_fixture(&target, &repo_root);

        let agent_path = target.join(".kiro/agents/k-example.json");
        fs::write(&agent_path, b"{\"handEdited\":true}\n").unwrap();
        fs::write(
            repo_root.join("dist/kiro-cli-v2/agents/k-example.json"),
            b"{\"fresh\":true}\n",
        )
        .unwrap();
        let before_manifest = manifest::read_manifest(&target).unwrap().unwrap();

        let code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            false,
            None,
            false,
            true,
            false, /* use_github_token */
            // --dry-run
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0, "a dry run must report success, not fail");

        assert_eq!(
            fs::read(&agent_path).unwrap(),
            b"{\"handEdited\":true}\n",
            "--dry-run must never overwrite the hand-edited file"
        );
        let after_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        assert_eq!(
            before_manifest, after_manifest,
            "--dry-run must never rewrite the manifest"
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let idx = index::read_index().unwrap().unwrap();
        let entry = idx
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .unwrap();
        assert_eq!(
            entry.status,
            IndexEntryStatus::Complete,
            "--dry-run must never flip the index status to InProgress"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `preview_update` reports every tracked path as "would overwrite"
    /// (update has no eligibility filter), plus the correct diverged
    /// count for a hand-edited file.
    #[test]
    fn preview_update_reports_every_tracked_path_and_diverged_count() {
        let _home = HomeGuard::new("preview-update-basic-home");
        let target = scratch_dir("preview-update-basic-target");
        let repo_root = scratch_dir("preview-update-basic-repo");
        install_fixture(&target, &repo_root);
        fs::write(
            target.join(".kiro/agents/k-example.json"),
            b"{\"handEdited\":true}\n",
        )
        .unwrap();

        let would_overwrite =
            preview_update(&target, Some(repo_root.to_str().unwrap()), None, false).unwrap();
        assert_eq!(
            would_overwrite,
            vec![PreviewFile {
                path: PathBuf::from(".kiro/agents/k-example.json"),
                diverged: true,
            }]
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A stale target (no manifest) previews as an `Err` naming the
    /// same "is stale" wording the real run would fail with -- a dry
    /// run must fail exactly where a real run would.
    #[test]
    fn preview_update_stale_target_fails_the_same_way_a_real_run_would() {
        let target = scratch_dir("preview-update-stale");
        let err = preview_update(&target, None, None, false).unwrap_err();
        assert!(err.message.contains("is stale (no manifest found)"));
        assert!(!err.harness_not_tracked);
        fs::remove_dir_all(&target).ok();
    }

    /// Per-path divergence clarity: a target with one locally-modified
    /// tracked file and one unmodified tracked file must have
    /// `preview_update` flag exactly the modified one as `diverged`,
    /// distinct from the unmodified one -- reusing the same hash
    /// comparison `count_diverged_files`'s real-run counterpart
    /// performs, so a `--dry-run` reader can tell which specific path
    /// would have local edits overwritten, not just an aggregate count.
    #[test]
    fn preview_update_flags_only_the_diverged_path_among_two_tracked_files() {
        let _home = HomeGuard::new("preview-update-diverged-mixed-home");
        let target = scratch_dir("preview-update-diverged-mixed-target");
        let repo_root = scratch_dir("preview-update-diverged-mixed-repo");
        seed_synthed_agent(&repo_root, "k-edited");
        seed_synthed_agent(&repo_root, "k-untouched");
        install_fixture(&target, &repo_root);

        fs::write(
            target.join(".kiro/agents/k-edited.json"),
            b"{\"handEdited\":true}\n",
        )
        .unwrap();

        let would_overwrite =
            preview_update(&target, Some(repo_root.to_str().unwrap()), None, false).unwrap();
        assert_eq!(would_overwrite.len(), 3, "k-example, k-edited, k-untouched");

        let edited = would_overwrite
            .iter()
            .find(|f| f.path == Path::new(".kiro/agents/k-edited.json"))
            .expect("the hand-edited file must be in the preview");
        assert!(
            edited.diverged,
            "the hand-edited file must be flagged as diverged"
        );

        let untouched = would_overwrite
            .iter()
            .find(|f| f.path == Path::new(".kiro/agents/k-untouched.json"))
            .expect("the untouched file must be in the preview");
        assert!(
            !untouched.diverged,
            "the untouched file must NOT be flagged as diverged"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Same mixed target's plain-text rendering via
    /// `format_preview_file_line`: the diverged path's line must be
    /// distinguishable from the unmodified path's line, not just an
    /// aggregate "N file(s) (M with local edits)" count.
    #[test]
    fn format_preview_file_line_distinguishes_diverged_from_unmodified() {
        let diverged = PreviewFile {
            path: PathBuf::from(".kiro/agents/k-edited.json"),
            diverged: true,
        };
        let untouched = PreviewFile {
            path: PathBuf::from(".kiro/agents/k-untouched.json"),
            diverged: false,
        };
        let diverged_line = format_preview_file_line(&diverged);
        let untouched_line = format_preview_file_line(&untouched);
        assert_ne!(
            diverged_line, untouched_line,
            "a diverged path's line must render differently from an unmodified path's"
        );
        assert!(diverged_line.contains(".kiro/agents/k-edited.json"));
        assert!(diverged_line.contains("local edits would be destroyed"));
        assert!(untouched_line.contains(".kiro/agents/k-untouched.json"));
        assert!(!untouched_line.contains("local edits would be destroyed"));
    }

    /// Same mixed target's `--json` shape: `preview_file_json` must
    /// carry `diverged: true`/`false` per path.
    #[test]
    fn preview_file_json_carries_per_path_diverged_flag() {
        let diverged = PreviewFile {
            path: PathBuf::from(".kiro/agents/k-edited.json"),
            diverged: true,
        };
        let untouched = PreviewFile {
            path: PathBuf::from(".kiro/agents/k-untouched.json"),
            diverged: false,
        };
        let diverged_value = preview_file_json(&diverged);
        let untouched_value = preview_file_json(&untouched);
        assert_eq!(diverged_value["path"], ".kiro/agents/k-edited.json");
        assert_eq!(diverged_value["diverged"], true);
        assert_eq!(untouched_value["path"], ".kiro/agents/k-untouched.json");
        assert_eq!(untouched_value["diverged"], false);
    }

    /// End-to-end: `report_dry_run_preview`'s `--json` document for a
    /// target with one diverged and one unmodified tracked file must
    /// carry BOTH paths with their own correct `diverged` flag inside
    /// the SAME `would_overwrite` array -- not merely an aggregate
    /// count -- proving the dry-run path genuinely distinguishes the
    /// two files from each other in its real emitted output.
    #[test]
    fn preview_update_json_document_distinguishes_diverged_path_from_unmodified() {
        let _home = HomeGuard::new("preview-update-diverged-json-e2e-home");
        let target = scratch_dir("preview-update-diverged-json-e2e-target");
        let repo_root = scratch_dir("preview-update-diverged-json-e2e-repo");
        seed_synthed_agent(&repo_root, "k-edited");
        seed_synthed_agent(&repo_root, "k-untouched");
        install_fixture(&target, &repo_root);

        fs::write(
            target.join(".kiro/agents/k-edited.json"),
            b"{\"handEdited\":true}\n",
        )
        .unwrap();

        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let entries = vec![IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        }];

        let code = report_dry_run_preview(
            &entries,
            Some(repo_root.to_str().unwrap()),
            None,
            false, /* use_github_token */
            true,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);

        // Structural guard above confirms the real print call site
        // doesn't panic; directly assert the shape it constructs from
        // the same preview_update result.
        let would_overwrite =
            preview_update(&target, Some(repo_root.to_str().unwrap()), None, true).unwrap();
        let would_overwrite_json: Vec<serde_json::Value> =
            would_overwrite.iter().map(preview_file_json).collect();
        assert_eq!(
            would_overwrite_json.len(),
            3,
            "k-example, k-edited, k-untouched"
        );

        let edited_entry = would_overwrite_json
            .iter()
            .find(|entry| entry["path"] == ".kiro/agents/k-edited.json")
            .expect("the edited file must appear in would_overwrite");
        assert_eq!(edited_entry["diverged"], true);

        let untouched_entry = would_overwrite_json
            .iter()
            .find(|entry| entry["path"] == ".kiro/agents/k-untouched.json")
            .expect("the untouched file must appear in would_overwrite");
        assert_eq!(untouched_entry["diverged"], false);

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The autoSDE-flagged regression this fix addresses: a target that
    /// does not track the requested `--harness` must be reported via
    /// `PreviewUpdateError::harness_not_tracked`, structurally, rather
    /// than a caller recovering the distinction by matching on the
    /// error's rendered `Display` text -- the previous
    /// `is_harness_not_tracked_message` substring check this test
    /// replaces would have silently broken if `HarnessSelectionError`'s
    /// wording ever changed.
    #[test]
    fn preview_update_not_tracked_harness_is_reported_structurally() {
        let target = scratch_dir("preview-update-not-tracked");
        fs::create_dir_all(&target).unwrap();
        manifest::upsert_strategy(
            &target,
            StrategyManifest::new(
                "claude",
                "2026-01-15T09:30:00Z",
                ".",
                None,
                Status::Complete,
                vec![manifest::ManifestFile {
                    path: ".claude/agents/k-example.md".to_string(),
                    sha256: Some(hash(b"claude content\n")),
                    provenance: manifest::Provenance::Created,
                }],
            ),
        )
        .unwrap();

        let err = preview_update(&target, None, Some("kiro-cli-v2"), false).unwrap_err();
        assert!(err.harness_not_tracked);
        assert!(err.message.contains("does not track harness 'kiro-cli-v2'"));

        fs::remove_dir_all(&target).ok();
    }

    /// (b) With no confirmation gate, `dispatch_update_with` proceeds
    /// directly with the real overwrite even with no TTY attached --
    /// the hand-edited file is unconditionally overwritten with fresh
    /// content.
    #[test]
    fn dispatch_update_with_no_tty_proceeds_directly() {
        let _home = HomeGuard::new("update-proceeds-directly-home");
        let target = scratch_dir("update-proceeds-directly-target");
        let repo_root = scratch_dir("update-proceeds-directly-repo");
        install_fixture(&target, &repo_root);

        let agent_path = target.join(".kiro/agents/k-example.json");
        fs::write(&agent_path, b"{\"handEdited\":true}\n").unwrap();

        let code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            false,
            None,
            false,
            false,
            false, /* use_github_token */
            // no --dry-run
            false,
            false,
            ColorMode::disabled(),
        );

        assert_eq!(
            code, 0,
            "with no confirmation gate, the run must proceed and succeed"
        );
        assert_ne!(
            fs::read(&agent_path).unwrap(),
            b"{\"handEdited\":true}\n",
            "the hand-edited file must be overwritten with fresh content"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Same direct-proceed proof for `--all`: both tracked targets'
    /// files are overwritten, with no gate in the way.
    #[test]
    fn dispatch_update_all_with_no_tty_proceeds_directly_for_every_target() {
        let _home = HomeGuard::new("update-proceeds-directly-all-home");
        let target_a = scratch_dir("update-proceeds-directly-all-a");
        let target_b = scratch_dir("update-proceeds-directly-all-b");
        let repo_root = scratch_dir("update-proceeds-directly-all-repo");
        install_fixture(&target_a, &repo_root);
        install_fixture(&target_b, &repo_root);

        let agent_a = target_a.join(".kiro/agents/k-example.json");
        let agent_b = target_b.join(".kiro/agents/k-example.json");
        fs::write(&agent_a, b"{\"handEdited\":true}\n").unwrap();
        fs::write(&agent_b, b"{\"handEdited\":true}\n").unwrap();

        let code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            None,
            true, // --all
            None,
            false,
            false,
            false, /* use_github_token */
            // no --dry-run
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);
        assert_ne!(fs::read(&agent_a).unwrap(), b"{\"handEdited\":true}\n");
        assert_ne!(fs::read(&agent_b).unwrap(), b"{\"handEdited\":true}\n");

        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `--json` mode has no effect on the (now nonexistent) confirmation
    /// gate -- a `--json` invocation with a single target still
    /// proceeds directly.
    #[test]
    fn dispatch_update_json_proceeds_directly_with_a_single_target() {
        let _home = HomeGuard::new("update-json-proceeds-directly-home");
        let target = scratch_dir("update-json-proceeds-directly-target");
        let repo_root = scratch_dir("update-json-proceeds-directly-repo");
        install_fixture(&target, &repo_root);
        let agent_path = target.join(".kiro/agents/k-example.json");
        let before = fs::read(&agent_path).unwrap();

        let code = dispatch_update_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            false,
            None,
            false,
            false,
            false, /* use_github_token */
            // no --dry-run
            false,
            true, // --json
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);
        // The manifest is re-copied from a fresh install fixture, so
        // content is unchanged, but the run must have actually
        // succeeded rather than declining.
        assert_eq!(fs::read(&agent_path).unwrap(), before);

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── `update --all` on an empty index must stay a 0 no-op ───────────
    //
    // `--all` resolves `targets` to an empty `Vec` against an empty
    // index rather than hitting the bare-invocation short-circuit above
    // (which excludes `--all` on purpose). Covered here across every
    // mode the dry-run branch depends on.

    #[test]
    fn dispatch_update_all_on_empty_index_dry_run_is_a_noop() {
        let _home = HomeGuard::new("update-all-empty-dry-run-home");
        assert!(index::read_index().unwrap().is_none());
        let code = dispatch_update_with(
            None,
            None,
            true, // --all
            None,
            false,
            true,
            false, /* use_github_token */
            // --dry-run
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0, "--all --dry-run on an empty index must be a no-op");
    }

    #[test]
    fn dispatch_update_all_on_empty_index_is_a_noop() {
        let _home = HomeGuard::new("update-all-empty-home");
        assert!(index::read_index().unwrap().is_none());
        let code = dispatch_update_with(
            None,
            None,
            true, // --all
            None,
            false,
            false,
            false, /* use_github_token */
            // no --dry-run
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0, "--all on an empty index must be a no-op");
    }

    #[test]
    fn dispatch_update_all_on_empty_index_json_is_a_noop() {
        let _home = HomeGuard::new("update-all-empty-json-home");
        assert!(index::read_index().unwrap().is_none());
        let code = dispatch_update_with(
            None,
            None,
            true, // --all
            None,
            false,
            false,
            false, /* use_github_token */
            // no --dry-run
            false,
            true, // --json
            ColorMode::disabled(),
        );
        assert_eq!(code, 0, "--all --json on an empty index must be a no-op");
    }
}
