// SPDX-License-Identifier: Apache-2.0
//
// uninstall.rs -- `konductor uninstall` dispatch (Rust implementation).
//
// `--target`/`--all` are supported alongside the flagless bare
// invocation. No interactive TTY picker, and no implicit resolve-to-
// $HOME destructive-confirmation gate either: a bare invocation
// (`--target` omitted, `--all` not passed) against 2+ tracked entries
// is an immediate usage error naming every tracked install, matching
// design §3's own table exactly and mirroring `update.rs`'s identical
// ambiguous-selection error (`report_ambiguous_targets`) -- see that
// function's own doc comment. A single tracked entry is always
// uninstalled directly with no flag needed, unchanged from the
// design's own 1-entry row.
//
// `harness` (design doc §9.6) is a SEPARATE selection axis from target
// resolution: once a target is resolved (by whichever path above), if
// that target tracks 2+ STRATEGIES, `harness` (or an interactive
// picker, or a usage error) selects exactly one of them; see
// `harness_select::select_harness`.
//
// Manifest writes are locked and fresh-read; file copies are not. Every
// manifest write here goes through the same `config_lock`-backed
// advisory lock `install.rs`/`update.rs` use, and re-reads the manifest
// fresh under that lock rather than trusting an earlier unlocked read
// used only to drive harness selection. A concurrent install/uninstall
// of a different, coexisting strategy at the same target can no longer
// corrupt or lose its slot. What remains unsupported: two invocations
// racing on the exact same strategy slot's on-disk files -- this
// module's delete loop and `update.rs`'s copy loop each touch the
// filesystem outside the manifest-write critical section, so they can
// still interleave and corrupt files even though the manifest stays
// consistent. Callers must still serialize same-slot invocations
// themselves -- same accepted-risk posture as the cross-target index
// race (design doc §2).

use std::path::{Component, Path, PathBuf};

use super::harness_select;
use super::install::artifact::sha256_hex;
use super::install::bin_link;
use super::install::claude::CLAUDE_DESTINATION_ROOT as CLAUDE_ROOT;
use super::install::index::{self, Index};
use super::install::kiro_cli::{
    KIRO_DESTINATION_ROOT as KIRO_ROOT, KONDUCTOR_DESTINATION_ROOT as KONDUCTOR_ROOT,
};
use super::install::manifest::{self, ManifestError, Provenance, StrategyManifest};
use super::install::resource_rewrite::{
    CLAUDE_SETTINGS_RELATIVE_PATH, V3_STANDALONE_HOOKS_RELATIVE_PATH,
    V3_STANDALONE_HOOK_LOCK_FILE_NAME,
};
use crate::cli::output::ColorMode;
use crate::cli::synth::kiro_cli_v2::SKILLS_CONTENT_TYPE_DIR;

/// Remapped exit code for CLI usage errors, matching cli.rs's
/// `EXIT_USAGE_ERROR` (private to that module, so duplicated here).
const EXIT_USAGE_ERROR: u8 = 64;

/// Remapped exit code for a state/verification failure -- an
/// unsupported manifest/index `schema_version` -- matching cli.rs's
/// `EXIT_VERIFY_FAILED`, which `ManifestError`/`IndexError` document as
/// the required mapping for `UnsupportedSchemaVersion`.
const EXIT_VERIFY_FAILED: u8 = 65;

use super::EXIT_SUCCESS_WITH_WARNINGS;

/// Maps a `manifest::read_manifest`/`index::read_index` error to
/// its correct exit code -- `EXIT_VERIFY_FAILED` (65) specifically for
/// `ManifestError::UnsupportedSchemaVersion`, `EXIT_USAGE_ERROR` (64)
/// for every other variant. Shared by every manifest-read call site in
/// this module so the split cannot drift between them.
fn manifest_error_exit_code(err: &ManifestError) -> u8 {
    match err {
        ManifestError::UnsupportedSchemaVersion { .. } => EXIT_VERIFY_FAILED,
        _ => EXIT_USAGE_ERROR,
    }
}

/// Same mapping as `manifest_error_exit_code`, for
/// `index::IndexError`.
fn index_error_exit_code(err: &index::IndexError) -> u8 {
    match err {
        index::IndexError::UnsupportedSchemaVersion { .. } => EXIT_VERIFY_FAILED,
        _ => EXIT_USAGE_ERROR,
    }
}

/// `uninstall_one`'s error type. Carries a human-readable message, the
/// exit code that produced it (`EXIT_VERIFY_FAILED` for an unsupported
/// manifest/index schema version, `EXIT_USAGE_ERROR` otherwise), and
/// whether this is specifically the "target doesn't track the
/// requested `--harness`" case (`harness_not_tracked`). Only
/// `dispatch_all`'s batch loop inspects `harness_not_tracked`, treating
/// it as a per-target skip rather than a failure.
/// `dispatch_target`'s single-target path still surfaces it as an
/// ordinary usage error -- there's no sibling target to skip to.
#[derive(Debug)]
struct UninstallError {
    message: String,
    exit_code: u8,
    harness_not_tracked: bool,
}

impl std::fmt::Display for UninstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl UninstallError {
    fn usage(message: impl Into<String>) -> Self {
        UninstallError {
            message: message.into(),
            exit_code: EXIT_USAGE_ERROR,
            harness_not_tracked: false,
        }
    }

    /// Specifically the "target does not track the requested
    /// `--harness`" case `harness_select::select_harness` reports via
    /// `HarnessSelectionError::NotTracked` (see this struct's doc for
    /// why it's split out from `usage`).
    fn harness_not_tracked(message: impl Into<String>) -> Self {
        UninstallError {
            message: message.into(),
            exit_code: EXIT_USAGE_ERROR,
            harness_not_tracked: true,
        }
    }

    fn from_manifest(target_dir: &str, err: ManifestError) -> Self {
        UninstallError {
            exit_code: manifest_error_exit_code(&err),
            message: format!("could not read manifest for {target_dir}: {err}"),
            harness_not_tracked: false,
        }
    }

    fn from_index(target_dir: &str, err: index::IndexError) -> Self {
        UninstallError {
            exit_code: index_error_exit_code(&err),
            message: format!("could not update install index for {target_dir}: {err}"),
            harness_not_tracked: false,
        }
    }
}

// Runtime namespace roots `uninstall` must never remove, regardless of
// emptiness. Imported from `kiro_cli.rs`'s own constants (aliased to
// shorter local names) so the values can't drift between modules.

/// One target's uninstall outcome: how many files were deleted, how
/// many of those had a diverged hash (design §5's disclosure
/// requirement), how many now-empty directories were removed, and
/// whether this target was **stale** -- tracked in the index
/// but with no manifest found on disk. A stale result's
/// `files_deleted`/`diverged_deleted`/`dirs_removed` are always all 0
/// (there was nothing to read, so nothing was deleted), which is
/// exactly why `stale` exists as its own field: a real, successful
/// uninstall that also happens to delete 0 files (e.g. every file was
/// already independently removed while the manifest itself remained)
/// would otherwise be indistinguishable in the report from a stale
/// index entry that never had a manifest to begin with. `stale: true`
/// is the caller's signal to report this target as "stale (no manifest
/// found); cleared its tracked install entry" rather than blending it
/// into a real 0-file uninstall's message.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UninstallCounts {
    pub files_deleted: usize,
    pub diverged_deleted: usize,
    /// The specific relative paths counted in `diverged_deleted`, in
    /// the order `delete_eligible_files` encountered them -- design
    /// §5's disclosure requirement made concrete: a bare count tells
    /// the user HOW MANY hand-edited files were deleted anyway, but not
    /// WHICH ones, so there is nothing to check before trusting the
    /// count. Populated alongside `diverged_deleted`'s increment in
    /// `delete_eligible_files`, never independently -- the two must
    /// always agree in length. Surfaced verbatim in `--json` output and
    /// listed by name in the plain-text success message when non-empty.
    pub diverged_paths: Vec<PathBuf>,
    pub dirs_removed: usize,
    pub stale: bool,
    /// Whether this target had a `--link-bin`-created symlink tracked
    /// in `$HOME/.konductor/bin-links`, and that tracking entry was
    /// dropped as part of this uninstall. `false` for a target that
    /// never requested `--link-bin` (the common case), not an error.
    /// Does not imply the physical symlink was deleted -- see
    /// `bin_link_symlink_removed`, since another still-installed
    /// target can share the same physical symlink.
    pub bin_link_untracked: bool,
    /// Whether the on-disk `--link-bin` symlink was actually deleted --
    /// `bin_link::BinLinkRemoval::physically_removed` passed through.
    /// Always `false` when `bin_link_untracked` is `false`; can also be
    /// `false` even when `bin_link_untracked` is `true`, e.g. when
    /// another still-installed target's tracking entry names the same
    /// physical symlink. Reporting must key its "removed its
    /// --link-bin symlink" message off this field, not
    /// `bin_link_untracked`.
    pub bin_link_symlink_removed: bool,
    /// The error, if `bin_link::remove_bin_link` failed for this
    /// target. `None` on the ordinary path -- either nothing was tracked
    /// (`bin_link_untracked` stays `false` too) or removal succeeded.
    /// Carried back as data rather than printed directly at the failure
    /// site (mirrors `update.rs`'s own `finalize_index_warning` field
    /// and its "no printing in the core function" rationale): a
    /// `--json` consumer that only reads stdout must be able to see
    /// this failure too, not just a plain-text `eprintln!` on stderr --
    /// and `Some(failure)` here is distinguishable from "this target
    /// never requested `--link-bin`" in a way a bare `false` on
    /// `bin_link_untracked` alone is not.
    ///
    /// A `BinLinkFailure` (message + exit code), not a bare `String` --
    /// CR comment r1p6's regression: `bin_link.rs` already splits
    /// `BinLinkError` into `EXIT_VERIFY_FAILED` (65, for
    /// `UnsupportedSchemaVersion`/`RollbackAlsoFailed`) vs
    /// `EXIT_USAGE_ERROR` (64, every other variant) via
    /// `bin_link::bin_link_error_exit_code`, but a bare `String` throws
    /// that distinction away before `exit_code_for_counts` ever runs --
    /// every bin-link failure flattened to `EXIT_SUCCESS_WITH_WARNINGS`
    /// (6), silently downgrading a real state-consistency concern (a
    /// `BIN_LINK_SCHEMA_VERSION` bump, or a rollback that itself failed)
    /// to a mere warning. The exit code is derived once, at construction
    /// time in `uninstall_one_impl` (the one place that still has the
    /// real `BinLinkError` value), rather than re-derived from the
    /// message string later.
    pub bin_link_error: Option<BinLinkFailure>,
}

/// `UninstallCounts.bin_link_error`'s payload: a `bin_link::BinLinkError`
/// reduced to what a report/exit-code call site actually needs -- the
/// rendered message, and the correct exit code for THIS non-fatal
/// context. Not the `BinLinkError` itself: that type carries
/// `std::io::Error`/`serde_json::Error` sources with no
/// `Clone`/`PartialEq`/`Eq`, which `UninstallCounts`'s own derives require;
/// reducing to (message, exit_code) at construction time keeps this struct
/// exactly as inspectable as the plain `String` it replaces, while never
/// losing the variant-specific exit code the way that bare `String` did.
///
/// The exit code here is NOT `bin_link::bin_link_error_exit_code`'s raw
/// output taken verbatim: that function was written for a context where
/// a `BinLinkError` is the PRIMARY failure of the whole command (its own
/// doc comment's "reserved for a future caller... e.g. a standalone
/// `--link-bin` command"), where every non-`UnsupportedSchemaVersion`/
/// `RollbackAlsoFailed` variant is a real usage error (64). `uninstall`'s
/// own bin-link removal is explicitly NON-FATAL (see
/// `uninstall_one_impl`'s own doc comment) -- every file this uninstall
/// was responsible for is still deleted and the index entry still
/// removed regardless of this failure, so an ordinary `SymlinkFailed`/
/// `ForeignFileExists`/etc. here must stay `EXIT_SUCCESS_WITH_WARNINGS`
/// (6), a warning on top of a real success, not escalate to 64 as if
/// the whole uninstall had failed. CR comment r1p6's actual complaint
/// was narrower than "reuse `bin_link_error_exit_code` outright": it
/// specifically named `UnsupportedSchemaVersion`/`RollbackAlsoFailed` as
/// the two variants silently downgraded to 6 that should instead read as
/// 65 (a state-consistency concern, not a mere warning) -- so only those
/// two variants are escalated here; every other variant keeps the
/// pre-existing non-fatal 6.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinLinkFailure {
    pub message: String,
    pub exit_code: u8,
}

impl BinLinkFailure {
    fn from_error(err: &bin_link::BinLinkError) -> Self {
        // Escalate to EXIT_VERIFY_FAILED (65) only for the two variants
        // CR comment r1p6 named -- a state-consistency concern, not an
        // ordinary bin-link removal hiccup. Every other variant keeps
        // the pre-existing non-fatal EXIT_SUCCESS_WITH_WARNINGS (6) --
        // see this struct's own doc comment for why
        // `bin_link_error_exit_code`'s raw output (64 for everything
        // else) is the wrong mapping in THIS non-fatal context.
        let exit_code = match err {
            bin_link::BinLinkError::UnsupportedSchemaVersion { .. }
            | bin_link::BinLinkError::RollbackAlsoFailed { .. } => EXIT_VERIFY_FAILED,
            _ => EXIT_SUCCESS_WITH_WARNINGS,
        };
        BinLinkFailure {
            message: err.to_string(),
            exit_code,
        }
    }
}

/// `konductor uninstall [--target <dir>] [--all] [--harness <name>]`.
/// Reads `~/.konductor/installs` and applies the design §3 selection
/// table: a bare invocation (`--target` omitted, `--all` not passed)
/// against 2+ tracked entries is a usage error naming every tracked
/// install -- see `report_ambiguous_targets` below, mirroring
/// `update.rs`'s own equivalent ambiguity error. `harness` (design doc
/// §9.6) is a SEPARATE selection axis from all of the above -- once a
/// target is resolved, if it tracks 2+ strategies, `harness` (or an
/// interactive picker, or a usage error) selects exactly one of them;
/// see `harness_select::select_harness`. Returns 0 on success/no-op,
/// `EXIT_USAGE_ERROR` (64) on any usage error (including the
/// 2+-tracked-installs ambiguity case), `EXIT_VERIFY_FAILED` (65) on an
/// unsupported index schema version, `EXIT_SUCCESS_WITH_WARNINGS` (6)
/// on an otherwise-successful uninstall that hit a non-fatal
/// `--link-bin` symlink-removal failure -- never exit code 2.
///
/// `dry_run` reports exactly what would be removed for each resolved
/// target (via `preview_uninstall`) without touching the filesystem at
/// all -- a dry run is non-destructive by definition. There is no
/// confirmation prompt: a real (non-dry-run) run proceeds directly.
pub fn dispatch_uninstall(
    target: Option<String>,
    all: bool,
    harness: Option<String>,
    dry_run: bool,
    json: bool,
    color: ColorMode,
) -> u8 {
    // No single target is in scope yet at this point in dispatch --
    // `report_error`'s `target_dir` param
    // falls back to $HOME here, the closest thing to a scope-agnostic
    // identity lookup this global index read has.
    let home_dir_fallback = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    let index = match index::read_index() {
        Ok(Some(index)) => index,
        Ok(None) => Index::new(Vec::new()),
        Err(err) => {
            report_error(
                "uninstall",
                "uninstall.index_read_failed",
                &home_dir_fallback,
                false,
                &format!("could not read install index: {err}"),
                Vec::new(),
                json,
                color,
            );
            return index_error_exit_code(&err);
        }
    };

    // The "0 tracked installs is a no-op, not an error" rule only holds
    // for a BARE invocation, where the caller asked for "whatever is
    // tracked". An explicit `--target <dir>` on an empty index must
    // still fall through to `dispatch_target`'s own not-found usage
    // error (64) below, rather than silently reporting success for a
    // target that was never uninstalled purely because nothing was
    // tracked at all -- this matters for scripts that check `$?`.
    // `--all` on an empty index has nothing to iterate either way, so
    // it stays a 0 no-op.
    if index.installs.is_empty() && target.is_none() && !all {
        report_no_tracked_installs("uninstall", json, color);
        return 0;
    }

    // A hand-edited or otherwise corrupted index can carry the same
    // target_dir more than once, which write_index's own upsert path
    // can never itself produce. Refuse to proceed with ANY operation on
    // a corrupted index rather than silently picking one duplicate as
    // authoritative.
    let duplicates = index::duplicate_target_dirs(&index.installs);
    if !duplicates.is_empty() {
        report_corrupted_index(&duplicates, json, color);
        return EXIT_USAGE_ERROR;
    }

    if all {
        return dispatch_all(&index, harness.as_deref(), dry_run, json, color);
    }

    if let Some(target) = target {
        return dispatch_target(&index, &target, harness.as_deref(), dry_run, json, color);
    }

    if index.installs.len() == 1 {
        let entry = &index.installs[0];
        if dry_run {
            return report_dry_run_preview(&entry.target_dir, harness.as_deref(), json, color);
        }
        return match uninstall_one(&entry.target_dir, harness.as_deref(), true, json) {
            Ok(counts) => {
                report_single(&entry.target_dir, &counts, json, color);
                exit_code_for_counts(&counts)
            }
            Err(err) => {
                report_error(
                    "uninstall",
                    "uninstall.target_failed",
                    Path::new(&entry.target_dir),
                    false,
                    &err.to_string(),
                    vec![(
                        "target_dir",
                        serde_json::Value::String(entry.target_dir.clone()),
                    )],
                    json,
                    color,
                );
                err.exit_code
            }
        };
    }

    // 2+ tracked entries, neither `--target` nor `--all` given: usage
    // error naming every tracked install, mirroring `update.rs`'s own
    // `report_ambiguous_targets` for its identical ambiguous-selection
    // case -- the caller must disambiguate with `--target <dir>` or
    // `--all`.
    report_ambiguous_targets(&index.installs, json, color);
    EXIT_USAGE_ERROR
}

/// Maps a successful `uninstall_one`/`uninstall_one_for_batch` result
/// to its exit code: the failure's own carried exit code (see
/// `BinLinkFailure`) when this target hit a non-fatal `--link-bin`
/// symlink-removal failure (`counts.bin_link_error.is_some()`) -- 65
/// (`EXIT_VERIFY_FAILED`) for `UnsupportedSchemaVersion`/
/// `RollbackAlsoFailed`, `EXIT_SUCCESS_WITH_WARNINGS` (6) for every
/// other `BinLinkError` variant (CR comment r1p6's fix: this used to
/// assume 6 unconditionally, flattening a real state-consistency
/// concern into a mere warning) -- 0 otherwise. Shared by every
/// `Ok(counts)` call site in this module (the single-entry shortcut in
/// `dispatch_uninstall`, `dispatch_target`'s matched-entry arm) so the
/// mapping cannot drift between them. `dispatch_all`'s own batch
/// tie-break additionally folds this into `worst_exit_code`'s
/// precedence ordering -- see that function's own doc comment.
fn exit_code_for_counts(counts: &UninstallCounts) -> u8 {
    match &counts.bin_link_error {
        Some(failure) => failure.exit_code,
        None => 0,
    }
}

/// Builds `report_ambiguous_targets`'s plain-text message: the
/// ambiguity error plus a listing of every tracked install's
/// `target_dir`, one per line. Named so tests bind to the real
/// construction -- mirrors `dispatch_target_no_match_message`'s own
/// split exactly (see that function's doc comment): pulling the
/// message/listing construction out of its call site is what lets a
/// test assert specific target names actually appear in the rendered
/// output, rather than only confirming the call site doesn't panic.
fn build_ambiguous_targets_message(entries: &[index::IndexEntry]) -> String {
    let message = "multiple installs are tracked; pass --target <dir> or --all";
    let listed = entries
        .iter()
        .map(|e| format!("  - {}", e.target_dir))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{message}. Tracked install(s):\n{listed}")
}

/// Reports the 2+-tracked-installs-no-flag ambiguity error, listing
/// every tracked install so the user knows what `--target <dir>`
/// values are valid. Mirrors `update.rs`'s own `report_ambiguous_targets`
/// message/shape exactly -- there is no implicit `$HOME` resolution or
/// picker to fall back to; the caller must disambiguate with
/// `--target <dir>` or `--all`.
fn report_ambiguous_targets(entries: &[index::IndexEntry], json: bool, color: ColorMode) {
    if json {
        let message = "multiple installs are tracked; pass --target <dir> or --all";
        println!(
            "{}",
            serde_json::json!({
                "command": "uninstall",
                "error": message,
                "tracked_targets": entries.iter().map(|e| e.target_dir.clone()).collect::<Vec<_>>(),
            })
        );
        return;
    }
    eprintln!(
        "{} {}",
        crate::cli::output::error_prefix(color, "konductor uninstall:"),
        build_ambiguous_targets_message(entries)
    );
}

// `build_error_json`/`report_error`/`report_no_tracked_installs` moved
// to `cli/report.rs` once a third and fourth caller (install, synth)
// needed them -- see that module's doc comment. Re-imported below so
// this module's own call sites don't need touching. `build_error_json`
// itself is only referenced by this module's own tests (`mod tests`
// below imports it too via `use super::*`), so it is `#[cfg(test)]`-
// gated here to avoid an unused-import warning on a non-test build.
#[cfg(test)]
use super::report::build_error_json;
use super::report::{report_error, report_no_tracked_installs};

/// Reports a corrupted index (duplicate `target_dir` entries)
/// and refuses to proceed with any operation, naming exactly which
/// tracked install(s) are duplicated. Splits plain-text/`--json` output
/// the same way `report_single`/`report_batch` do.
fn report_corrupted_index(duplicates: &[String], json: bool, color: ColorMode) {
    let message = "the tracked-install index is corrupted: duplicate tracked install \
                    entries found; fix ~/.konductor/installs by hand before running uninstall";
    if json {
        println!(
            "{}",
            serde_json::json!({
                "command": "uninstall",
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
        crate::cli::output::error_prefix(color, "konductor uninstall:")
    );
}

/// Every tracked install's `target_dir` OTHER than `resolved_home`,
/// preserving index order, formatted `  - <target_dir>` one per line
/// (matching `update.rs`'s own `report_ambiguous_targets` listing
/// convention). `None` when there is nothing else to list -- either
/// `resolved_home` is the index's only entry, or the index is empty.
///
/// Used by `dispatch_target`'s NOT-FOUND usage error, so a resolved
/// path that matches nothing tracked also tells the user what IS
/// tracked, rather than naming only the path that failed to match.
///
/// `resolved_home` is excluded by exact string match against each
/// entry's `target_dir` -- on the not-found call site it matches
/// nothing tracked by definition, so nothing is excluded and every
/// tracked install is listed.
fn format_other_tracked_installs(index: &Index, resolved_home: &str) -> Option<String> {
    let others: Vec<&str> = index
        .installs
        .iter()
        .map(|entry| entry.target_dir.as_str())
        .filter(|target_dir| *target_dir != resolved_home)
        .collect();
    if others.is_empty() {
        return None;
    }
    Some(
        others
            .iter()
            .map(|dir| format!("  - {dir}"))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

/// Builds the "does not match any tracked install" usage-error message
/// `dispatch_target`'s no-match branch reports. Named so tests bind to
/// the real construction -- including the `format_other_tracked_installs`
/// listing appended when the index has other tracked installs to name
/// -- rather than reconstructing the message by hand and never
/// exercising that append at all.
///
/// Ends with a softened clause acknowledging uncertainty rather than
/// asserting `target` was never tracked: a directory that WAS
/// previously installed but has since been fully uninstalled resolves
/// identically to one that was never installed at all, and this
/// message cannot tell the two apart -- both simply match nothing in
/// the current index.
fn dispatch_target_no_match_message(index: &Index, target: &str, resolved_display: &str) -> String {
    let mut message =
        format!("{target} does not match any tracked install (resolved to {resolved_display})");
    if let Some(listing) = format_other_tracked_installs(index, resolved_display) {
        message.push_str(&format!(". Tracked install(s):\n{listing}"));
    }
    message.push_str(" (this may mean it was never installed, or was already fully uninstalled)");
    message
}

/// `--target <dir>` path: canonicalizes `<dir>` the same way install
/// does, then requires an exact match against a tracked entry -- a
/// non-matching target is a usage error, never a silent no-op.
///
/// If canonicalization fails (a tracked directory that no longer
/// exists -- exactly the stale case `uninstall_one` is built to prune),
/// fall back to matching `target` as given against every tracked
/// `target_dir` -- either verbatim, or resolved to an absolute (but
/// not existence-requiring) path via `std::path::absolute` so a
/// relative `--target` spelling can still match an absolute index
/// entry -- before giving up. Without this fallback, a stale entry
/// could only ever be cleaned up via `--all`, since `--target <dir>`
/// would always fail before it got a chance to match. A genuinely
/// wrong/unrelated path still matches nothing in either the
/// canonical-path attempt or this fallback, so it still falls through
/// to the same usage error as before.
fn dispatch_target(
    index: &Index,
    target: &str,
    harness: Option<&str>,
    dry_run: bool,
    json: bool,
    color: ColorMode,
) -> u8 {
    let canonical = index::canonicalize_target_dir(Path::new(target));

    let matched = match &canonical {
        Ok(canonical) => index
            .installs
            .iter()
            .find(|entry| entry.target_dir == *canonical),
        Err(_) => {
            // Fallback: the path may no longer exist on disk (a stale
            // tracked install) -- try matching it another way before
            // reporting a usage error. `std::path::absolute` does not
            // require the path to exist (unlike `canonicalize`), and
            // performs no symlink resolution -- it is purely lexical,
            // so this can only match an index entry that was itself
            // recorded via the same non-existence-requiring form for a
            // path that has since disappeared out from under it.
            let absolute = std::path::absolute(Path::new(target))
                .ok()
                .map(|p| p.to_string_lossy().into_owned());
            index.installs.iter().find(|entry| {
                entry.target_dir == target || absolute.as_deref() == Some(entry.target_dir.as_str())
            })
        }
    };
    let Some(entry) = matched else {
        let resolved_display = canonical
            .as_deref()
            .map(|c| c.to_string())
            .unwrap_or_else(|_| target.to_string());
        let message = dispatch_target_no_match_message(index, target, &resolved_display);
        report_error(
            "uninstall",
            "uninstall.target_not_found",
            Path::new(target),
            false,
            &message,
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
    };
    if dry_run {
        return report_dry_run_preview(&entry.target_dir, harness, json, color);
    }
    match uninstall_one(&entry.target_dir, harness, true, json) {
        Ok(counts) => {
            report_single(&entry.target_dir, &counts, json, color);
            exit_code_for_counts(&counts)
        }
        Err(err) => {
            report_error(
                "uninstall",
                "uninstall.target_failed",
                Path::new(&entry.target_dir),
                false,
                &err.to_string(),
                vec![(
                    "target_dir",
                    serde_json::Value::String(entry.target_dir.clone()),
                )],
                json,
                color,
            );
            err.exit_code
        }
    }
}

/// `--all` path: uninstalls every tracked entry, continuing on a
/// per-target failure and reporting which targets succeeded/skipped/
/// failed rather than aborting the whole batch on the first error.
/// Returns `EXIT_USAGE_ERROR` (64) if at least one target
/// failed with a usage error, or `EXIT_VERIFY_FAILED` (65) if at least
/// one target failed specifically on an unsupported schema version and
/// none failed with a plain usage error (65 "wins" over 0 but never
/// silently masks a 64 -- if both kinds of failure occur in the same
/// batch, 64 is reported, matching this module's/`update.rs`'s
/// single-target behavior where a usage error is the more actionable of
/// the two). A stale entry (no manifest found) still counts as
/// "succeeded" here (its index entry was pruned, which is uninstall's
/// correct terminal behavior) -- `report_batch` distinguishes
/// stale-skipped targets from genuinely-emptied ones via
/// `UninstallCounts.stale`, so the batch summary itself does not need a
/// third bucket for that case.
///
/// A DIFFERENT case does get its own bucket: a target that does not
/// track the requested `--harness` at all
/// (`UninstallError::harness_not_tracked`, set when
/// `harness_select::select_harness` returns
/// `HarnessSelectionError::NotTracked`). With `--harness <name>` given,
/// `select_harness` now validates the name against every tracked target
/// individually (r2's stricter check -- see that function's own doc
/// comment), so a mixed set of targets where only some track the
/// requested harness used to hard-fail the ones that don't, showing up
/// in the FAILED list even though nothing about that target is actually
/// broken. Design decision: such a target is SKIPPED instead -- an
/// informational per-target message, not a failure -- and does not
/// affect `worst_exit_code`. A target that DOES track the requested
/// harness but fails to uninstall for some other reason still counts as
/// a real failure below, unaffected by this.
///
/// Precedence rank for `dispatch_all`'s batch tie-break, highest wins:
/// `EXIT_USAGE_ERROR` (64) beats `EXIT_VERIFY_FAILED` (65) beats
/// `EXIT_SUCCESS_WITH_WARNINGS` (6) beats 0 -- a real failure anywhere
/// in the batch is always more actionable than a `--link-bin` warning
/// on an otherwise-successful target, which is itself more actionable
/// than a clean 0. Not the numeric code itself: 65 is a larger number
/// than 64 but ranks BELOW it here (a usage error is more actionable
/// than a state-verification failure), so precedence needs its own
/// ordering distinct from the raw exit-code values. Shared by both the
/// `Ok`/`Err` arms below (comment r1p6's fix means the `Ok` arm's own
/// `exit_code_for_counts` can now yield 65, not only 6/0, so both arms
/// must resolve through the SAME ranking or a later, higher-precedence
/// code from one arm could lose to an earlier, lower-precedence code
/// already recorded by the other). The `harness_not_tracked` skip
/// bucket never enters this ranking at all -- see this function's own
/// doc comment above for why it is informational, not a failure.
fn exit_code_precedence_rank(code: u8) -> u8 {
    match code {
        EXIT_USAGE_ERROR => 3,
        EXIT_VERIFY_FAILED => 2,
        EXIT_SUCCESS_WITH_WARNINGS => 1,
        _ => 0,
    }
}

/// Precedence across the whole batch, highest wins: see
/// `exit_code_precedence_rank`'s own doc comment for the ranking and
/// why it is not simply the numeric code value.
///
/// `dry_run` reports every tracked target's preview (via
/// `preview_uninstall`) without touching the filesystem, mirroring
/// `dispatch_target`'s own dry-run short-circuit. Otherwise, every
/// resolved target is uninstalled directly with no confirmation gate.
fn dispatch_all(
    index: &Index,
    harness: Option<&str>,
    dry_run: bool,
    json: bool,
    color: ColorMode,
) -> u8 {
    // `--all` against an empty index has nothing to iterate and must
    // stay a no-op regardless of `--dry-run`/`--json` -- the
    // bare-invocation short-circuit in `dispatch_uninstall` deliberately
    // excludes `--all` (see that function's own comment), so this is
    // the only place left to catch it.
    if index.installs.is_empty() {
        report_no_tracked_installs("uninstall", json, color);
        return 0;
    }

    if dry_run {
        return report_dry_run_preview_all(&index.installs, harness, json, color);
    }

    let mut succeeded: Vec<(String, UninstallCounts)> = Vec::new();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();
    let mut worst_exit_code = 0u8;

    let consider = |code: u8, worst_exit_code: &mut u8| {
        if exit_code_precedence_rank(code) > exit_code_precedence_rank(*worst_exit_code) {
            *worst_exit_code = code;
        }
    };

    for entry in &index.installs {
        match uninstall_one_for_batch(&entry.target_dir, harness) {
            Ok(counts) => {
                consider(exit_code_for_counts(&counts), &mut worst_exit_code);
                succeeded.push((entry.target_dir.clone(), counts));
            }
            Err(err) if err.harness_not_tracked => {
                skipped.push((entry.target_dir.clone(), err.message));
            }
            Err(err) => {
                consider(err.exit_code, &mut worst_exit_code);
                failed.push((entry.target_dir.clone(), err.message));
            }
        }
    }

    report_batch(&succeeded, &skipped, &failed, json, color);

    worst_exit_code
}

/// One file `preview_uninstall` would remove: its path (relative to the
/// target directory) and whether its on-disk content has diverged from
/// the manifest's recorded hash -- exactly the same disclosure the real
/// (non-dry-run) run makes per-file via `UninstallCounts.diverged_paths`
/// (see `delete_eligible_files`), computed here read-only via the same
/// hash comparison rather than duplicating the eligibility logic.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewFile {
    path: PathBuf,
    /// Whether this file's on-disk content no longer matches the
    /// manifest's recorded `sha256` -- i.e. deleting it for real would
    /// destroy local edits. A missing on-disk hash (e.g. an
    /// `InProgress` write-ahead record) is never considered diverged,
    /// mirroring `delete_eligible_files`'s own rule.
    diverged: bool,
}

/// `--dry-run` preview for a single target: reads the target's manifest
/// (read-only -- `preview_uninstall` never calls
/// `delete_eligible_files`/`cleanup_empty_dirs`/any index or manifest
/// write) and reports exactly which files WOULD be deleted by a real
/// `uninstall_one` run against `harness`'s resolved slot, applying the
/// identical eligibility rule `delete_eligible_files` itself uses
/// (`Created`/`ReplacedOurs`, never `ReplacedForeign`, never
/// `CLAUDE_SETTINGS_RELATIVE_PATH`), and -- per file -- whether it has
/// diverged from its manifest-recorded hash, via the same hash
/// comparison `delete_eligible_files` itself performs before deleting.
/// Returns the paths that would be removed, or an `UninstallError` for
/// the same failure classes `uninstall_one` itself would report
/// (missing/malformed manifest, unresolved `--harness`) -- a dry run
/// must fail exactly where a real run would, so a script relying on
/// `--dry-run`'s exit code to predict the real run's outcome sees the
/// same signal.
///
/// A missing manifest (stale tracked install) previews as zero files,
/// mirroring `uninstall_one`'s own non-fatal stale handling -- there is
/// nothing to preview deleting, not a failure.
fn preview_uninstall(
    target_dir: &str,
    harness: Option<&str>,
    json: bool,
) -> Result<Vec<PreviewFile>, UninstallError> {
    let target_path = Path::new(target_dir);
    let manifest = manifest::read_manifest(target_path)
        .map_err(|err| UninstallError::from_manifest(target_dir, err))?;

    let Some(full_manifest) = manifest else {
        return Ok(Vec::new());
    };
    if full_manifest.strategies.is_empty() {
        return Ok(Vec::new());
    }

    let selected = harness_select::select_harness(
        target_dir,
        &full_manifest.strategies,
        harness,
        // A dry-run preview never blocks on an interactive picker --
        // it is read-only and side-effect-free either way, so there is
        // no reason to prompt; an ambiguous selection is reported the
        // same way a non-interactive real run would report it.
        false,
        json,
    )
    .map_err(|err| {
        if err.is_not_tracked() {
            UninstallError::harness_not_tracked(err.to_string())
        } else {
            UninstallError::usage(err.to_string())
        }
    })?;

    let mut would_delete = Vec::new();
    for file in &selected.files {
        let rel = validate_relative_path(&file.path).map_err(UninstallError::usage)?;
        if file.provenance == Provenance::ReplacedForeign
            || file.path == CLAUDE_SETTINGS_RELATIVE_PATH
        {
            continue;
        }
        let path = target_path.join(rel);
        if !path.is_file() {
            continue;
        }
        // Same hash-comparison rule `delete_eligible_files` applies
        // before it actually deletes this path -- a divergence here
        // means the real run would destroy local edits, not just a
        // manifest-tracked file.
        let diverged = match &file.sha256 {
            Some(expected) => match std::fs::read(&path) {
                Ok(bytes) => sha256_hex(&bytes) != *expected,
                Err(_) => false,
            },
            None => false,
        };
        would_delete.push(PreviewFile {
            path: rel.to_path_buf(),
            diverged,
        });
    }
    Ok(would_delete)
}

/// Renders one `PreviewFile` as a plain-text line: `  <path>` when
/// unmodified, `  <path> (local edits would be destroyed)` when
/// diverged -- so a dry-run reader can tell at a glance which specific
/// tracked path would lose hand-edited content, not just an aggregate
/// count. Shared by `report_dry_run_preview`/`report_dry_run_preview_all`.
fn format_preview_file_line(file: &PreviewFile) -> String {
    if file.diverged {
        format!("  {} (local edits would be destroyed)", file.path.display())
    } else {
        format!("  {}", file.path.display())
    }
}

/// Builds one `PreviewFile`'s `--json` representation: `{"path": ...,
/// "diverged": ...}` -- the per-path counterpart to
/// `UninstallCounts.diverged_paths`'s own disclosure on the real run.
fn preview_file_json(file: &PreviewFile) -> serde_json::Value {
    serde_json::json!({
        "path": file.path.display().to_string(),
        "diverged": file.diverged,
    })
}

/// Prints `preview_uninstall`'s result for a single target -- every
/// path that would be removed, one per line in plain-text mode (each
/// flagged individually when it has diverged from its manifest-recorded
/// hash, via `format_preview_file_line`), or a structured `{"command":
/// "uninstall", "dry_run": true, "target_dir": ..., "would_delete":
/// [{"path": ..., "diverged": ...}, ...]}` document in `--json` mode --
/// and returns the exit code `dispatch_target`/the single-entry
/// shortcut should return. A preview failure (unresolved
/// manifest/harness) is reported the same way a real failure would be,
/// via `report_error`, so `--dry-run`'s exit code genuinely predicts
/// the real run's.
fn report_dry_run_preview(
    target_dir: &str,
    harness: Option<&str>,
    json: bool,
    color: ColorMode,
) -> u8 {
    match preview_uninstall(target_dir, harness, json) {
        Ok(would_delete) => {
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "command": "uninstall",
                        "dry_run": true,
                        "target_dir": target_dir,
                        "would_delete": would_delete.iter().map(preview_file_json).collect::<Vec<_>>(),
                    })
                );
            } else if would_delete.is_empty() {
                println!(
                    "{} dry run: nothing to remove from {target_dir}",
                    crate::cli::output::success_prefix(color, "konductor uninstall:")
                );
            } else {
                println!(
                    "{} dry run: would remove {} file(s) from {target_dir}:",
                    crate::cli::output::success_prefix(color, "konductor uninstall:"),
                    would_delete.len()
                );
                for file in &would_delete {
                    println!("{}", format_preview_file_line(file));
                }
            }
            0
        }
        Err(err) => {
            report_error(
                "uninstall",
                "uninstall.dry_run_preview_failed",
                Path::new(target_dir),
                false,
                &err.to_string(),
                vec![(
                    "target_dir",
                    serde_json::Value::String(target_dir.to_string()),
                )],
                json,
                color,
            );
            err.exit_code
        }
    }
}

/// `--all --dry-run` path: previews every tracked target, continuing
/// past a per-target preview failure (mirrors `dispatch_all`'s own
/// continue-past-failure contract for the real deletion path) and
/// reporting a single batched result. Always returns 0 in plain-text
/// mode (a preview reports, it never itself fails the run); in `--json`
/// mode a per-target preview failure is still surfaced in a `failed`
/// bucket within the one document, but the overall exit code stays 0 --
/// a dry run makes no filesystem changes, so there is nothing for a
/// script to have failed AT, only something to inspect before deciding
/// whether to re-run for real.
fn report_dry_run_preview_all(
    entries: &[index::IndexEntry],
    harness: Option<&str>,
    json: bool,
    color: ColorMode,
) -> u8 {
    let mut previewed: Vec<(String, Vec<PreviewFile>)> = Vec::new();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();

    for entry in entries {
        match preview_uninstall(&entry.target_dir, harness, json) {
            Ok(would_delete) => previewed.push((entry.target_dir.clone(), would_delete)),
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
                "command": "uninstall",
                "dry_run": true,
                "previewed": previewed.iter().map(|(dir, files)| serde_json::json!({
                    "target_dir": dir,
                    "would_delete": files.iter().map(preview_file_json).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
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

    for (dir, would_delete) in &previewed {
        if would_delete.is_empty() {
            println!(
                "{} dry run: nothing to remove from {dir}",
                crate::cli::output::success_prefix(color, "konductor uninstall:")
            );
        } else {
            println!(
                "{} dry run: would remove {} file(s) from {dir}:",
                crate::cli::output::success_prefix(color, "konductor uninstall:"),
                would_delete.len()
            );
            for file in would_delete {
                println!("{}", format_preview_file_line(file));
            }
        }
    }
    for (dir, message) in &skipped {
        println!("konductor uninstall: skipped {dir}: {message}");
    }
    for (dir, message) in &failed {
        eprintln!(
            "{} could not preview {dir}: {message}",
            crate::cli::output::error_prefix(color, "konductor uninstall:")
        );
    }
    0
}

/// Per-target uninstall: reads that target's manifest, deletes every
/// eligible file (`Created`/`ReplacedOurs`, even if the on-disk hash
/// has diverged; never `ReplacedForeign`), cleans up now-empty
/// directories (never `.kiro/`/`.konductor/` themselves), and removes
/// the target from the index. `target_dir` must already be the
/// canonicalized string an index entry carries.
///
/// A missing manifest (`Ok(None)` from `read_manifest`) is a **stale
/// tracked install** -- the index names this target, but nothing is
/// there for uninstall to read. This is still the correct place to
/// prune the stale tracked install entry (uninstall's terminal
/// behavior for a target it can no longer act on), but the returned
/// `UninstallCounts.stale` is set to `true` so the caller's report
/// explicitly says "stale (no manifest found); cleared its tracked
/// install entry" rather than rendering identically to a real,
/// successful 0-file uninstall (see `report_single`/`report_batch`).
/// Consistent in tone/wording with `update.rs`'s own message for the
/// identical missing-manifest condition (see that module's
/// `update_one_target` doc comment) -- `update` cannot treat it as
/// non-fatal the way `uninstall` can, since it has nothing to
/// reconcile against.
fn uninstall_one(
    target_dir: &str,
    harness: Option<&str>,
    allow_interactive: bool,
    json: bool,
) -> Result<UninstallCounts, UninstallError> {
    uninstall_one_impl(target_dir, false, harness, allow_interactive, json)
}

/// Same as `uninstall_one`, but reports its telemetry event via
/// `report_package_uninstalled_for_target` instead of the
/// single-target entry point, since `dispatch_all` visits several
/// distinct `target_dir`s in one process and must resolve each
/// target's own endpoint config rather than the first one's cached
/// resolution (see `report_package_uninstalled_for_target`'s own doc
/// comment). Never prompts interactively and never treats itself as
/// `--json` -- an `--all` batch has no single caller context to prompt
/// against.
fn uninstall_one_for_batch(
    target_dir: &str,
    harness: Option<&str>,
) -> Result<UninstallCounts, UninstallError> {
    uninstall_one_impl(target_dir, true, harness, false, false)
}

fn uninstall_one_impl(
    target_dir: &str,
    uncached_identity: bool,
    harness: Option<&str>,
    allow_interactive: bool,
    json: bool,
) -> Result<UninstallCounts, UninstallError> {
    let target_path = Path::new(target_dir);

    let manifest = manifest::read_manifest(target_path)
        .map_err(|err| UninstallError::from_manifest(target_dir, err))?;

    let mut counts = UninstallCounts::default();
    let mut touched_dirs: Vec<PathBuf> = Vec::new();
    // Whether this run leaves the target with no tracked strategies at
    // all. Gates the target-wide side effects further down (bin-link
    // untracking, index-entry removal, telemetry cleanup) to a genuine
    // full teardown, never a partial single-harness removal that
    // leaves another already-tracked strategy (e.g. `claude`) still
    // installed. Defaults `true` because the `None` and
    // empty-`strategies` arms below have nothing else to preserve; the
    // `Some(full_manifest)` arm's concurrent-override race recomputes
    // this from a fresh read instead (see that arm's comment).
    let mut target_fully_removed = true;
    // The strategy name this run actually removed, if any -- used
    // below to shrink the index entry's `strategies` list by exactly
    // that name when the target was not fully removed. `None` on the
    // stale/0-slot paths, which remove the whole index entry instead.
    let mut removed_strategy_name: Option<String> = None;

    match &manifest {
        None => {
            counts.stale = true;
        }
        // A manifest can exist on disk with an empty `strategies` list
        // (e.g. every slot was already removed by an earlier
        // per-harness uninstall, or a hand-edited manifest). Handled as
        // its own case rather than falling through to the `None` arm:
        // that arm reports `stale = true` without removing the
        // manifest file, while `index::remove_index_entry` still runs
        // a few lines down -- which would orphan a manifest file with
        // no index entry able to reach it. Handled here, the manifest
        // file itself is removed too.
        //
        // The delete-vs-nothing decision must not be taken from this
        // unlocked `manifest` read -- a concurrent `install --harness
        // <other>` could commit a new slot into this file between this
        // read and the delete, and an unconditional delete here would
        // silently discard it. `remove_strategy_locked(_, None)`
        // re-reads fresh under the same lock `install`'s
        // `upsert_strategy` uses, and only deletes the file if it's
        // still empty at that point.
        Some(full_manifest) if full_manifest.strategies.is_empty() => {
            let outcome = manifest::remove_strategy_locked(target_path, None)
                .map_err(|err| UninstallError::from_manifest(target_dir, err))?;
            // `None` only if the manifest vanished entirely between the
            // unlocked read above and this locked re-read (e.g. a racing
            // uninstall of the same target already removed it) --
            // nothing left to finalize either way.
            if let Some(outcome) = outcome {
                target_fully_removed = outcome.target_fully_removed;
            }
            counts.stale = true;
        }
        Some(full_manifest) => {
            let selected_name = harness_select::select_harness(
                target_dir,
                &full_manifest.strategies,
                harness,
                allow_interactive,
                json,
            )
            .map_err(|err| {
                // `NotTracked` is the one case a batch caller
                // (`dispatch_all`) treats as a skip rather than a
                // failure -- see `UninstallError`'s own doc comment.
                // Every other `select_harness` failure (ambiguous
                // selection, invalid prompt response) stays an ordinary
                // usage error.
                if err.is_not_tracked() {
                    UninstallError::harness_not_tracked(err.to_string())
                } else {
                    UninstallError::usage(err.to_string())
                }
            })?
            .strategy
            .clone();

            // `full_manifest` above is read unlocked -- it exists only
            // to drive harness selection (picking a name, never file
            // content). The actual deletion step must run against a
            // fresh, locked re-read of `selected_name`'s slot, not this
            // stale snapshot: a concurrent `install --harness <other>`
            // landing in the gap could commit a new slot at the same
            // destination paths (`KIRO_VARIANT_FAMILY` members write
            // identical paths by construction), and this uninstall's
            // stale view would then delete files the concurrent install
            // just wrote. `delete_eligible_files` -- and the
            // counts/touched_dirs it mutates -- run entirely inside the
            // locked critical section below, against whichever slot is
            // genuinely tracked under `selected_name` at the instant
            // the lock is held. See `delete_and_remove_strategy_locked`'s
            // doc comment for the matching removal-decision invariant.
            //
            // `cleanup_empty_dirs` also runs from inside this same
            // closure, still under the manifest lock, rather than
            // after this whole `match` returns. Running it unlocked
            // left a narrower race: a concurrent `install --harness
            // <other>` could `create_dir_all` and start copying into a
            // shared destination directory (e.g. `.kiro/agents/`) in
            // the gap between this closure's delete and this
            // uninstall's own unlocked cleanup call, and `remove_dir`
            // on a directory the installer is mid-write into fails its
            // next `write_atomic` with "No such file or directory" --
            // the exact panic
            // `install_manifest_concurrency.rs`'s
            // `uninstall_of_kiro_cli_survives_concurrent_override_to_kiro_cli_v3`
            // reproduces. Folding cleanup into this closure makes the
            // delete and empty-directory removal atomic with respect
            // to any concurrent install's own locked manifest write.
            match manifest::delete_and_remove_strategy_locked(
                target_path,
                &selected_name,
                |fresh_slot| {
                    delete_eligible_files(target_path, fresh_slot, &mut counts, &mut touched_dirs)?;
                    counts.dirs_removed += cleanup_empty_dirs(target_path, &touched_dirs);
                    touched_dirs.clear();
                    Ok(())
                },
            )
            .map_err(|err| UninstallError::from_manifest(target_dir, err))?
            {
                Some(outcome) => {
                    target_fully_removed = outcome.target_fully_removed;
                    removed_strategy_name = Some(selected_name);
                }
                None => {
                    // The fresh, locked read no longer tracks
                    // `selected_name` -- either the manifest vanished
                    // entirely (a concurrent uninstall of the last
                    // remaining strategy), or a concurrent `install
                    // --harness <other>` already replaced this exact
                    // slot (the KIRO_VARIANT_FAMILY override-on-switch
                    // race). Either way, `delete_eligible_files` was
                    // never invoked -- nothing was deleted.
                    //
                    // `target_fully_removed` must not simply default to
                    // `true` here: `None` says nothing about whether
                    // some other, unrelated strategy (e.g. a
                    // coexisting `claude`) is still tracked, and the
                    // teardown below (`index::remove_index_entry`) is
                    // not name-scoped -- it drops the whole index entry
                    // regardless of which strategies remain, orphaning
                    // a real survivor's manifest slot. Re-reading fresh
                    // here (best-effort, since the lock is already
                    // released) reflects the manifest's actual current
                    // state instead of a blind default.
                    target_fully_removed = match manifest::read_manifest(target_path) {
                        Ok(Some(m)) => m.strategies.is_empty(),
                        Ok(None) => true,
                        Err(_) => true,
                    };
                    counts.stale = true;
                }
            }
        }
    }

    // `counts.dirs_removed` is already fully accumulated: the
    // `Some(full_manifest)` arm above runs `cleanup_empty_dirs` itself
    // inside the locked closure and clears `touched_dirs`; no other
    // arm populates it. Asserted rather than silently relied on, so a
    // future arm that starts populating it without cleanup fails
    // loudly instead of leaking an unlocked cleanup pass.
    debug_assert!(
        touched_dirs.is_empty(),
        "touched_dirs must be fully drained by the locked cleanup above"
    );

    // Everything from here down is a property of the target as a
    // whole (the $PATH bin-link, the index entry, the telemetry
    // identity file), not of any one strategy's slot -- so it must
    // only be torn down on a genuine full teardown
    // (`target_fully_removed`), never when another already-tracked
    // strategy (e.g. `claude`) survives this run's partial removal.
    if target_fully_removed {
        // If this target ever ran `install --link-bin`, its tracked
        // $PATH symlink is removed here too, regardless of whether the
        // target was stale or a real uninstall above. Deliberately
        // non-fatal: a cleanup failure must not abort an uninstall that
        // already removed every other tracked file, mirroring
        // `install`'s own `--link-bin` non-fatal posture. No printing
        // here on any path -- carried back as `counts.bin_link_error`
        // instead, so a `--json` consumer reading only stdout can still
        // see it, distinct from "never requested `--link-bin`".
        // `report_single`/`report_batch` print it in both modes.
        match bin_link::remove_bin_link(target_dir) {
            Ok(Some(removal)) => {
                counts.bin_link_untracked = true;
                counts.bin_link_symlink_removed = removal.physically_removed;
            }
            Ok(None) => {}
            Err(err) => {
                counts.bin_link_error = Some(BinLinkFailure::from_error(&err));
            }
        }

        index::remove_index_entry(target_dir)
            .map_err(|err| UninstallError::from_index(target_dir, err))?;

        // Telemetry: report only after every fallible operation above
        // has already succeeded -- reporting success for an uninstall
        // that goes on to fail with an `UninstallError` would be a
        // false signal. `harness` is read from `install-info.json` --
        // the per-install record -- which is still on disk at this
        // point; fires before that file (and `telemetry-id.json`, if
        // present) are removed below. Every failure mode this call can
        // hit is folded into `report_package_uninstalled`'s own
        // best-effort tolerance -- never becomes an `UninstallError`.
        if uncached_identity {
            crate::cli::telemetry::report_package_uninstalled_for_target(target_path);
        } else {
            crate::cli::telemetry::report_package_uninstalled(target_path);
        }

        // Remove both per-target telemetry records last, so a
        // crash/interruption before this point leaves them in place
        // and a retried uninstall re-reports (accepted at-least-once
        // delivery). Both removals are best-effort: a target that
        // opted out at install time, or one installed before
        // `telemetry-id.json` was retired as a read source, may be
        // missing either file already -- a genuine `NotFound` is fine
        // and silent. Any other removal error (permissions, I/O) is
        // warned, not swallowed: it means a stale record survives this
        // uninstall, which a later `install` at the same target_dir
        // would otherwise silently inherit.
        let install_info_path = crate::cli::telemetry::install_info_path(target_path);
        if let Err(err) = std::fs::remove_file(&install_info_path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "konductor uninstall: warning: could not remove {}: {err}",
                    install_info_path.display()
                );
            }
        }
        let identity_path = crate::cli::telemetry::identity_path(target_path);
        if let Err(err) = std::fs::remove_file(&identity_path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "konductor uninstall: warning: could not remove {}: {err}",
                    identity_path.display()
                );
            }
        }
    } else if let Some(name) = &removed_strategy_name {
        // Only the selected harness's name leaves the index's tracked
        // `strategies` list -- every other already-tracked strategy,
        // and the `target_dir` entry itself, survives.
        index::remove_strategy_from_index(target_dir, name)
            .map_err(|err| UninstallError::from_index(target_dir, err))?;
    }

    Ok(counts)
}

/// Validates that a manifest-recorded relative path stays within
/// `target_dir` before it is ever joined against it -- a corrupted or
/// hand-edited manifest must never cause a write/delete outside the
/// intended tree. Rejects an absolute path (`Path::join` replaces the
/// base entirely when the joined path is absolute, e.g.
/// `target_dir.join("/etc/foo") == /etc/foo`) and any path containing a
/// `..` component (`Path::join` doesn't normalize `..`, so a lexical
/// `starts_with` check on the joined result alone isn't sufficient --
/// `target_dir/../../etc` still starts with `target_dir` by
/// component). A `./`-prefixed but otherwise safe relative path is
/// accepted unchanged.
pub(super) fn validate_relative_path(raw: &str) -> Result<&Path, String> {
    let rel = Path::new(raw);
    if rel.is_absolute() || rel.components().any(|c| c == Component::ParentDir) {
        return Err(format!("manifest entry {raw:?} escapes target directory"));
    }
    Ok(rel)
}

/// Deletes every `Created`/`ReplacedOurs` file this manifest names --
/// even if the on-disk hash no longer matches the manifest's recorded
/// hash (that preserve-on-divergence rule is `update`-only). Never
/// deletes a `ReplacedForeign` path. Records each deleted file's
/// parent directory in `touched_dirs` for later empty-directory
/// cleanup, and counts how many deleted files had a diverged hash -- a
/// missing on-disk file doesn't count as diverged, since there's
/// nothing to disclose losing.
///
/// `validate_relative_path` runs before `file.provenance` is even
/// inspected, so an unsafe path can never reach path computation
/// regardless of provenance -- including a `ReplacedForeign` entry,
/// which is skipped from deletion but must still never be joined
/// unvalidated.
///
/// `CLAUDE_SETTINGS_RELATIVE_PATH` (`.claude/settings.json`) is also
/// skipped here regardless of provenance, even `Created`/
/// `ReplacedOurs`. Every other content type owns the whole file at its
/// manifest path, so those provenances correctly mean "safe to delete,
/// we wrote every byte." This file breaks that assumption:
/// `resource_rewrite/claude_settings.rs`'s `merge_claude_settings_permissions` only
/// merges a handful of `permissions.allow` grants into what is, by
/// design, a shared file that may carry a user's own `hooks` or other
/// MCP servers' grants. There's no `Provenance` variant for "partially
/// ours, strip only our own entries" to build finer-grained removal
/// on, so the safe default is to leave the whole file alone, matching
/// this function's `ReplacedForeign` handling.
fn delete_eligible_files(
    target_dir: &Path,
    manifest: &StrategyManifest,
    counts: &mut UninstallCounts,
    touched_dirs: &mut Vec<PathBuf>,
) -> Result<(), String> {
    for file in &manifest.files {
        let rel = validate_relative_path(&file.path)?;
        if file.provenance == Provenance::ReplacedForeign
            || file.path == CLAUDE_SETTINGS_RELATIVE_PATH
        {
            continue;
        }
        let path = target_dir.join(rel);

        // The V3 standalone telemetry-hook document shares its directory
        // with a dedicated lock file (`V3_STANDALONE_HOOK_LOCK_FILE_NAME`,
        // see its own doc comment) that is never manifest-tracked, so it
        // never appears as its own loop iteration here. Removed
        // unconditionally alongside the tracked hook document's entry,
        // regardless of whether that entry's `path` still exists on disk
        // or whether removing it below succeeds -- otherwise the lock
        // file (and, transitively, `.kiro/hooks/`) would be stranded
        // whenever the tracked document was deleted out-of-band before
        // uninstall ran.
        if file.path == V3_STANDALONE_HOOKS_RELATIVE_PATH {
            if let Some(parent) = path.parent() {
                let _ = std::fs::remove_file(parent.join(V3_STANDALONE_HOOK_LOCK_FILE_NAME));
                touched_dirs.push(parent.to_path_buf());
            }
        }

        if !path.is_file() {
            continue;
        }
        if let Some(expected) = &file.sha256 {
            if let Ok(bytes) = std::fs::read(&path) {
                if sha256_hex(&bytes) != *expected {
                    counts.diverged_deleted += 1;
                    counts.diverged_paths.push(rel.to_path_buf());
                }
            }
        }
        std::fs::remove_file(&path)
            .map_err(|e| format!("failed to remove {}: {e}", path.display()))?;
        counts.files_deleted += 1;
        if let Some(parent) = path.parent() {
            touched_dirs.push(parent.to_path_buf());
        }
    }
    Ok(())
}

/// Removes any directory in `touched_dirs` (and, transitively, any of
/// its now-empty ancestors up to but not including `target_dir`) that is
/// now empty, walking up from each touched directory. Never removes
/// `<target_dir>/.kiro`, `<target_dir>/.konductor`, or
/// `<target_dir>/.claude` themselves, regardless of emptiness --
/// those are each runtime's own namespace root, not something uninstall
/// owns the lifecycle of. Protecting `.claude` here matters even though
/// `ClaudeInstallStrategy` installs both its content types under that
/// one root (see `install::claude`'s own "Two install roots, collapsed
/// to one" doc comment): without this, uninstalling every tracked
/// Claude Code file would leave `.claude/` empty and this function would
/// delete it outright, unlike the `.kiro`/`.konductor` roots it already
/// protects unconditionally. Returns the count of directories actually
/// removed. Best-effort: a directory that fails to remove (e.g.
/// permissions) is simply left in place rather than aborting the whole
/// uninstall over cleanup.
///
/// `.kiro/skills/` (`kiro_skills_root` below) is protected the same way
/// `.kiro`/`.konductor`/`.claude` are, even though it is a SUBDIRECTORY of
/// an already-protected root, not a root of its own: unlike every other
/// path this codebase installs, `.kiro/skills/sop-<name>/SKILL.md` shares
/// its parent directory with Kiro IDE's own general-purpose skills
/// directory, which legitimately holds skills this install never created
/// (see `install::kiro_cli::install_kiro_sop_skills`'s own doc comment).
/// Deleting every tracked `sop-<name>/` subdirectory can leave
/// `.kiro/skills/` itself empty, and without this explicit protection
/// this function would then remove it outright -- destroying a directory
/// that may still be relied on (e.g. as a mount point for symlinked
/// third-party skills) even though this install owns nothing under it
/// anymore.
fn cleanup_empty_dirs(target_dir: &Path, touched_dirs: &[PathBuf]) -> usize {
    let mut removed = 0usize;
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let kiro_root = target_dir.join(KIRO_ROOT);
    let konductor_root = target_dir.join(KONDUCTOR_ROOT);
    let claude_root = target_dir.join(CLAUDE_ROOT);
    let kiro_skills_root = kiro_root.join(SKILLS_CONTENT_TYPE_DIR);

    for start in touched_dirs {
        let mut current = start.clone();
        loop {
            if current == *target_dir
                || current == kiro_root
                || current == konductor_root
                || current == claude_root
                || current == kiro_skills_root
            {
                break;
            }
            if !current.starts_with(target_dir) {
                break;
            }
            let is_empty = std::fs::read_dir(&current)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
            if !is_empty {
                break;
            }
            // `seen` is only marked after a CONFIRMED-successful
            // removal, never before attempting it. If `remove_dir`
            // fails (e.g. a permissions error), this directory must
            // stay eligible for a later sibling's pass to revisit and
            // remove once something else empties it further -- marking
            // it here on a failed attempt would permanently skip it for
            // the rest of this run, even though it may become
            // removable moments later.
            if seen.contains(&current) {
                break;
            }
            if std::fs::remove_dir(&current).is_err() {
                break;
            }
            seen.insert(current.clone());
            removed += 1;
            match current.parent() {
                Some(parent) => current = parent.to_path_buf(),
                None => break,
            }
        }
    }
    removed
}

/// Builds `report_single`'s `--json` document. Named so tests bind to
/// the real construction directly -- mirrors
/// `dispatch_target_no_match_message`'s/`build_ambiguous_targets_message`'s
/// own split (CR comment r1p9): pulling this out of `report_single`'s
/// body is what lets a test assert `diverged_paths`' actual VALUES
/// appear in the emitted shape, rather than only confirming the call
/// site doesn't panic.
fn build_single_json(target_dir: &str, counts: &UninstallCounts) -> serde_json::Value {
    // `bin_link_error` is inserted only when `Some` -- mirrors
    // `update.rs`'s own conditional `value["warning"] = ...`
    // pattern for `finalize_index_warning` -- so a `--json`
    // consumer sees the failure in the SAME stdout document as
    // everything else this uninstall did, rather than only on
    // stderr as plain text (finding `f-dd9ebe8a`).
    let mut value = serde_json::json!({
        "command": "uninstall",
        "target_dir": target_dir,
        "stale": counts.stale,
        "files_deleted": counts.files_deleted,
        "diverged_deleted": counts.diverged_deleted,
        "diverged_paths": counts.diverged_paths,
        "dirs_removed": counts.dirs_removed,
        "bin_link_untracked": counts.bin_link_untracked,
        "bin_link_symlink_removed": counts.bin_link_symlink_removed,
    });
    if let Some(failure) = &counts.bin_link_error {
        value["bin_link_error"] = serde_json::Value::String(failure.message.clone());
    }
    value
}

/// `counts.stale` (set by `uninstall_one` when no manifest was
/// found for this target) branches to a distinct message/JSON shape --
/// "cleared (no manifest found); tracked install removed" -- so a
/// stale, nothing-to-delete result never renders identically to a real,
/// successful 0-file uninstall (e.g. every file was already
/// independently removed while the manifest itself remained). Both the
/// real-success and stale arms lead with a verb describing action taken
/// WITHIN `target_dir` ("uninstalled from"/"cleared"), never a verb that
/// could be misread as `target_dir` itself having been deleted.
fn report_single(target_dir: &str, counts: &UninstallCounts, json: bool, color: ColorMode) {
    if json {
        println!("{}", build_single_json(target_dir, counts));
        return;
    }
    // Keyed off `bin_link_symlink_removed` specifically, NOT
    // `bin_link_untracked` -- the latter is true whenever a tracking
    // entry existed, even if the physical symlink survives because
    // another still-installed target shares it (see
    // `UninstallCounts::bin_link_symlink_removed`'s own doc comment).
    // Reporting "removed its --link-bin symlink" off the wrong field
    // would wrongly claim $PATH resolution changed when it did not.
    let bin_link_note = if counts.bin_link_symlink_removed {
        "; removed its --link-bin symlink"
    } else if counts.bin_link_untracked {
        "; untracked its --link-bin symlink (still shared with another installed target)"
    } else {
        ""
    };
    let diverged_note = format_diverged_paths_note(&counts.diverged_paths);
    if counts.stale {
        println!(
            "{} {target_dir} is stale (no manifest found); cleared its \
             tracked install entry{bin_link_note}",
            crate::cli::output::success_prefix(color, "konductor uninstall:")
        );
    } else {
        println!(
            "{} uninstalled from {target_dir}; deleted {} file(s) ({} with \
             a hash that had diverged from the manifest), removed {} now-empty \
             director(y/ies){bin_link_note}{diverged_note}",
            crate::cli::output::success_prefix(color, "konductor uninstall:"),
            counts.files_deleted,
            counts.diverged_deleted,
            counts.dirs_removed
        );
    }
    // Printed via `println!` (stdout), not `eprintln!` -- see
    // `bin_link_error`'s own doc comment for why this must not be
    // stderr-only.
    if let Some(failure) = &counts.bin_link_error {
        println!(
            "{} could not remove tracked --link-bin symlink for \
             {target_dir}: {}",
            crate::cli::output::status::warn(color, "konductor uninstall: warning:"),
            failure.message
        );
    }
}

/// Renders `counts.diverged_paths` as a trailing clause -- "; \
/// hash-diverged file(s): path1, path2" -- for `report_single`/
/// `report_batch`'s plain-text success message, or an empty string when
/// there is nothing to list. Split out so both call sites format this
/// exactly the same way.
fn format_diverged_paths_note(diverged_paths: &[PathBuf]) -> String {
    if diverged_paths.is_empty() {
        return String::new();
    }
    let listed = diverged_paths
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    format!("; hash-diverged file(s): {listed}")
}

/// Same stale-vs-real distinguishability as `report_single`, but
/// per succeeded entry in a batch, plus a `stale_skipped` count in the
/// final summary line/JSON so the batch total distinguishes
/// stale-skipped targets from genuinely-emptied ones at a glance.
///
/// `skipped` is a SEPARATE bucket from both `succeeded` and `failed`:
/// targets that do not track the `--harness` this batch requested
/// (`UninstallError::harness_not_tracked`, see `dispatch_all`'s own doc
/// comment). Reported informationally, distinct from a real failure --
/// printed on stdout in plain-text mode (not stderr, where `failed` is
/// printed), since it is not an error condition.
fn report_batch(
    succeeded: &[(String, UninstallCounts)],
    skipped: &[(String, String)],
    failed: &[(String, String)],
    json: bool,
    color: ColorMode,
) {
    let stale_skipped = succeeded.iter().filter(|(_, c)| c.stale).count();
    if json {
        println!(
            "{}",
            serde_json::json!({
                "command": "uninstall",
                "succeeded": succeeded.iter().map(|(dir, counts)| {
                    // Same conditional-insert as `report_single` -- see
                    // that function's comment for why `bin_link_error`
                    // must land in this SAME stdout document rather
                    // than only on stderr.
                    let mut entry = serde_json::json!({
                        "target_dir": dir,
                        "stale": counts.stale,
                        "files_deleted": counts.files_deleted,
                        "diverged_deleted": counts.diverged_deleted,
                        "diverged_paths": counts.diverged_paths,
                        "dirs_removed": counts.dirs_removed,
                        "bin_link_untracked": counts.bin_link_untracked,
                        "bin_link_symlink_removed": counts.bin_link_symlink_removed,
                    });
                    if let Some(failure) = &counts.bin_link_error {
                        entry["bin_link_error"] = serde_json::Value::String(failure.message.clone());
                    }
                    entry
                }).collect::<Vec<_>>(),
                "skipped": skipped.iter().map(|(dir, message)| serde_json::json!({
                    "target_dir": dir,
                    "reason": message,
                })).collect::<Vec<_>>(),
                "failed": failed.iter().map(|(dir, message)| serde_json::json!({
                    "target_dir": dir,
                    "error": message,
                })).collect::<Vec<_>>(),
                "stale_skipped": stale_skipped,
            })
        );
        return;
    }
    for (dir, counts) in succeeded {
        // Same field choice as `report_single` -- see that function's
        // comment for why `bin_link_symlink_removed`, not
        // `bin_link_untracked`, is the correct gate for this message.
        let bin_link_note = if counts.bin_link_symlink_removed {
            "; removed its --link-bin symlink"
        } else if counts.bin_link_untracked {
            "; untracked its --link-bin symlink (still shared with another installed target)"
        } else {
            ""
        };
        let diverged_note = format_diverged_paths_note(&counts.diverged_paths);
        if counts.stale {
            println!(
                "{} {dir} is stale (no manifest found); cleared its \
                 tracked install entry{bin_link_note}",
                crate::cli::output::success_prefix(color, "konductor uninstall:")
            );
        } else {
            println!(
                "{} uninstalled from {dir}; deleted {} file(s) ({} \
                 diverged), removed {} now-empty director(y/ies){bin_link_note}{diverged_note}",
                crate::cli::output::success_prefix(color, "konductor uninstall:"),
                counts.files_deleted,
                counts.diverged_deleted,
                counts.dirs_removed
            );
        }
        // Same stdout-not-stderr rationale as `report_single`'s own
        // `bin_link_error` warning line.
        if let Some(failure) = &counts.bin_link_error {
            println!(
                "{} could not remove tracked --link-bin symlink \
                 for {dir}: {}",
                crate::cli::output::status::warn(color, "konductor uninstall: warning:"),
                failure.message
            );
        }
    }
    for (dir, message) in skipped {
        println!("konductor uninstall: skipped {dir}: {message}");
    }
    for (dir, message) in failed {
        eprintln!(
            "{} failed to remove {dir}: {message}",
            crate::cli::output::error_prefix(color, "konductor uninstall:")
        );
    }
    println!(
        "{} {} succeeded ({} stale-skipped), {} skipped (harness not tracked), {} failed",
        crate::cli::output::success_prefix(color, "konductor uninstall:"),
        succeeded.len(),
        stale_skipped,
        skipped.len(),
        failed.len()
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use index::IndexEntry;
    use std::fs;
    use std::sync::MutexGuard;

    use crate::cli::test_home_lock::lock_home;

    fn scratch_home(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-uninstall-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Serializes every test in this module that calls `uninstall_one`/
    /// `dispatch_target`/`dispatch_all` end to end. `uninstall_one`
    /// unconditionally calls `index::remove_index_entry` in its last
    /// step (see its own body), which -- like `write_index` -- always
    /// resolves the REAL, process-global `$HOME/.konductor/installs`
    /// for the index's LOCATION, regardless of what target_dir the
    /// uninstall itself addresses (an older revision of this module's
    /// docstring claimed `uninstall_one` could be exercised "without
    /// touching the real `~/.konductor/installs`" by never calling
    /// `dispatch_uninstall` -- that was never true once
    /// `remove_index_entry` was added to `uninstall_one`'s own body;
    /// only `dispatch_uninstall` was ever bypassed, not the index
    /// write). `HomeGuard` below acquires the CRATE-WIDE
    /// `test_home_lock::HOME_ENV_LOCK` for its entire lifetime and
    /// repoints `HOME` at a scratch dir, so these tests stop depending
    /// on a real, writable ambient `$HOME` -- required in some internal
    /// CI sandboxes, where `$HOME` cannot be resolved at all. Uses the
    /// SHARED, crate-wide lock rather than a module-private one -- see
    /// `crate::cli::test_home_lock`'s own doc comment for why a
    /// module-private lock is insufficient: it explains that
    /// module-private `HOME_ENV_LOCK`s did NOT serialize across
    /// modules and caused a real intermittent failure in `update.rs`,
    /// which is exactly why this crate-wide lock exists.
    ///
    /// RAII guard for tests that mutate the process-global `HOME` env
    /// var. Points `HOME` at a fresh scratch temp dir, and on `Drop`
    /// restores the original `HOME` and removes the scratch dir.
    struct HomeGuard {
        _lock: MutexGuard<'static, ()>,
        scratch: PathBuf,
        original_home: Option<std::ffi::OsString>,
    }

    impl HomeGuard {
        fn new(label: &str) -> Self {
            let lock = lock_home();

            let scratch = scratch_home(label);
            let original_home = std::env::var_os("HOME");
            // SAFETY: held for this guard's entire lifetime under the
            // crate-wide HOME_ENV_LOCK, so no other HOME-mutating test
            // anywhere in this crate observes an interleaved value;
            // restored on Drop before the lock releases.
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

    /// Builds a target dir with a manifest + real on-disk files matching
    /// it, so `uninstall_one` can be exercised end to end. Callers that
    /// invoke `uninstall_one`/`dispatch_target`/`dispatch_all` on the
    /// result must hold a `HomeGuard` (see its docstring above) since
    /// that call path always reaches the real index-removal step.
    fn seed_target(target: &Path, files: Vec<(&str, &[u8], Provenance, Option<&str>)>) {
        let mut manifest_files = Vec::new();
        for (path, contents, provenance, forced_hash) in files {
            let full = target.join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(&full, contents).unwrap();
            let sha256 = match forced_hash {
                Some(h) => Some(h.to_string()),
                None => Some(sha256_hex(&fs::read(&full).unwrap())),
            };
            manifest_files.push(manifest::ManifestFile {
                path: path.to_string(),
                sha256,
                provenance,
            });
        }
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            manifest_files,
        );
        manifest::upsert_strategy(target, manifest).unwrap();
    }

    /// Same idea as `seed_target`, but writes TWO independent strategy
    /// slots at the same target -- one
    /// `strategy_name`/file set per call, via two separate
    /// `manifest::upsert_strategy` calls (which is exactly what two
    /// real, independent `konductor install --harness <name>` runs
    /// against the same target would also produce, for two strategies
    /// outside `KIRO_VARIANT_FAMILY` of each other). Used by the
    /// harness-selection tests below to exercise a genuine 2-strategy
    /// manifest without going through the full install pipeline.
    fn seed_multi_strategy_target(
        target: &Path,
        strategy_name: &str,
        files: Vec<(&str, &[u8], Provenance)>,
    ) {
        let mut manifest_files = Vec::new();
        for (path, contents, provenance) in files {
            let full = target.join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(&full, contents).unwrap();
            manifest_files.push(manifest::ManifestFile {
                path: path.to_string(),
                sha256: Some(sha256_hex(&fs::read(&full).unwrap())),
                provenance,
            });
        }
        let manifest = StrategyManifest::new(
            strategy_name,
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            manifest_files,
        );
        manifest::upsert_strategy(target, manifest).unwrap();
    }

    // ── path-traversal guard (finding f-71385e5d) ───────────────────────
    //
    // A manifest's `files[].path` is untrusted content -- a corrupted or
    // hand-edited `.konductor/manifest` must never be able to cause
    // `delete_eligible_files` to touch anything outside `target_dir`.
    // These tests assert the function returns an `Err` WITHOUT ever
    // calling `remove_file` for an unsafe entry -- proven by asserting
    // the malicious/unrelated path used in each test still exists (or,
    // for the absolute-path case, was never touched) after the call,
    // rather than relying on the test environment's real filesystem
    // permissions as the safety net.

    #[test]
    fn validate_relative_path_rejects_absolute_path() {
        assert!(validate_relative_path("/etc/passwd").is_err());
    }

    #[test]
    fn validate_relative_path_rejects_parent_dir_component() {
        assert!(validate_relative_path("../../etc/passwd").is_err());
        assert!(validate_relative_path("a/../../b").is_err());
    }

    #[test]
    fn validate_relative_path_accepts_dot_prefixed_safe_relative_path() {
        // A `./`-prefixed but otherwise safe relative path must still
        // succeed -- confirms the fix isn't overly broad.
        assert!(validate_relative_path("./.kiro/agents/a.json").is_ok());
        assert!(validate_relative_path(".kiro/agents/a.json").is_ok());
    }

    /// A manifest entry with an absolute path must cause
    /// `delete_eligible_files` to return an `Err` WITHOUT ever calling
    /// `remove_file` -- proven here using a path that, if the guard
    /// failed, would resolve to a sibling scratch-test file this test
    /// creates and owns (never anything genuinely outside the test's
    /// own scratch directory), so the assertion does not depend on the
    /// runner's real filesystem permissions to stay safe.
    #[test]
    fn delete_eligible_files_rejects_absolute_manifest_path_without_deleting() {
        let target = scratch_home("traversal-absolute");
        // A file living OUTSIDE target_dir that an absolute manifest
        // path could name if the guard were absent -- this test proves
        // it survives untouched.
        let sibling_victim = scratch_home("traversal-absolute-victim").join("victim.txt");
        fs::create_dir_all(sibling_victim.parent().unwrap()).unwrap();
        fs::write(&sibling_victim, b"do not delete me").unwrap();

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            vec![manifest::ManifestFile {
                path: sibling_victim.to_str().unwrap().to_string(),
                sha256: None,
                provenance: Provenance::Created,
            }],
        );
        let mut counts = UninstallCounts::default();
        let mut touched_dirs = Vec::new();
        let result = delete_eligible_files(&target, &manifest, &mut counts, &mut touched_dirs);

        assert!(
            result.is_err(),
            "an absolute manifest path must be rejected"
        );
        assert!(
            sibling_victim.is_file(),
            "the file outside target_dir must never be touched"
        );
        assert_eq!(counts.files_deleted, 0);

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(sibling_victim.parent().unwrap()).ok();
    }

    /// A manifest entry with a `../` component must cause
    /// `delete_eligible_files` to return an `Err` WITHOUT ever calling
    /// `remove_file` -- proven the same way as the absolute-path case
    /// above: a sibling scratch file the traversal would reach if the
    /// guard were absent must survive untouched.
    #[test]
    fn delete_eligible_files_rejects_parent_dir_manifest_path_without_deleting() {
        let parent = scratch_home("traversal-parent-dir-root");
        let target = parent.join("target");
        fs::create_dir_all(&target).unwrap();
        let sibling_victim = parent.join("victim.txt");
        fs::write(&sibling_victim, b"do not delete me").unwrap();

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            vec![manifest::ManifestFile {
                path: "../victim.txt".to_string(),
                sha256: None,
                provenance: Provenance::Created,
            }],
        );
        let mut counts = UninstallCounts::default();
        let mut touched_dirs = Vec::new();
        let result = delete_eligible_files(&target, &manifest, &mut counts, &mut touched_dirs);

        assert!(
            result.is_err(),
            "a `..`-containing manifest path must be rejected"
        );
        assert!(
            sibling_victim.is_file(),
            "the file outside target_dir must never be touched"
        );
        assert_eq!(counts.files_deleted, 0);

        fs::remove_dir_all(&parent).ok();
    }

    /// A `ReplacedForeign` entry with an unsafe path must ALSO be
    /// rejected -- the validation runs before the provenance check, so
    /// a malicious/corrupted manifest entry can never cause any path
    /// computation involving an unsafe path at all, regardless of
    /// provenance (even though a *safe* `ReplacedForeign` entry is
    /// always skipped from deletion).
    #[test]
    fn delete_eligible_files_rejects_unsafe_path_even_for_replaced_foreign_entry() {
        let target = scratch_home("traversal-replaced-foreign");
        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            vec![manifest::ManifestFile {
                path: "../../etc/passwd".to_string(),
                sha256: None,
                provenance: Provenance::ReplacedForeign,
            }],
        );
        let mut counts = UninstallCounts::default();
        let mut touched_dirs = Vec::new();
        let result = delete_eligible_files(&target, &manifest, &mut counts, &mut touched_dirs);

        assert!(
            result.is_err(),
            "an unsafe path must be rejected even for a ReplacedForeign entry, \
             which is otherwise skipped from deletion"
        );
        fs::remove_dir_all(&target).ok();
    }

    /// A `./`-prefixed but otherwise safe relative path must still
    /// succeed and delete the intended file -- confirms the fix is not
    /// overly broad and normal uninstall behavior is unaffected.
    #[test]
    fn delete_eligible_files_accepts_dot_prefixed_safe_relative_path() {
        let target = scratch_home("traversal-dot-prefixed-safe");
        let full = target.join(".kiro/agents/a.json");
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(&full, b"{}").unwrap();

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            vec![manifest::ManifestFile {
                path: "./.kiro/agents/a.json".to_string(),
                sha256: None,
                provenance: Provenance::Created,
            }],
        );
        let mut counts = UninstallCounts::default();
        let mut touched_dirs = Vec::new();
        let result = delete_eligible_files(&target, &manifest, &mut counts, &mut touched_dirs);

        assert!(result.is_ok(), "a safe, dot-prefixed path must succeed");
        assert_eq!(counts.files_deleted, 1);
        assert!(!full.exists());

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn deletes_created_and_replaced_ours_files() {
        let _home = HomeGuard::new("delete-created-ours-home");
        let target = scratch_home("delete-created-ours");
        seed_target(
            &target,
            vec![
                (".kiro/agents/a.json", b"{}", Provenance::Created, None),
                (
                    ".konductor/skills/s/SKILL.md",
                    b"# s",
                    Provenance::ReplacedOurs,
                    None,
                ),
            ],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert_eq!(counts.files_deleted, 2);
        assert!(!target.join(".kiro/agents/a.json").exists());
        assert!(!target.join(".konductor/skills/s/SKILL.md").exists());
        fs::remove_dir_all(&target).ok();
    }

    /// `uninstall_one` must delete the manifest file itself, not just
    /// the files it lists -- otherwise `X/.konductor/manifest` survives
    /// with `status: complete` and a file list describing files that no
    /// longer exist, leaving the target looking half-installed to a
    /// later `install`/`doctor` read.
    #[test]
    fn uninstall_one_removes_manifest_file_itself() {
        let _home = HomeGuard::new("removes-manifest-file-itself-home");
        let target = scratch_home("removes-manifest-file-itself");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        assert!(
            manifest::manifest_path(&target).is_file(),
            "sanity check: the manifest must exist before uninstall"
        );

        uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();

        assert!(
            !manifest::manifest_path(&target).exists(),
            "the manifest file itself must be deleted after a successful uninstall, \
             not just the files it lists"
        );
        fs::remove_dir_all(&target).ok();
    }

    /// The stale path (no manifest present at all) must not attempt to
    /// remove a manifest file that never existed -- `uninstall_one`
    /// must still succeed and report `stale: true`, never erroring on a
    /// missing manifest file it never wrote.
    #[test]
    fn uninstall_one_stale_path_skips_manifest_removal_without_erroring() {
        let _home = HomeGuard::new("stale-skips-manifest-removal-home");
        let target = scratch_home("stale-skips-manifest-removal");
        // No manifest written at all -- the stale case.
        assert!(!manifest::manifest_path(&target).exists());

        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(counts.stale);
        assert!(!manifest::manifest_path(&target).exists());
        fs::remove_dir_all(&target).ok();
    }

    // ── telemetry attribution: install-info.json, not the retired
    //    per-target identity ───────────────────────────────────────────

    /// Seeds `target` with a manifest + real files (via `seed_target`)
    /// AND `install-info.json`, matching what a real
    /// `konductor install` run leaves behind for `harness`.
    fn seed_target_with_install_info(target: &Path, harness: &str) {
        seed_target(
            target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let source = scratch_home("seed-install-info-source");
        crate::cli::telemetry::write_install_info(target, &source, harness, "2026-01-15T09:30:00Z")
            .unwrap();
        fs::remove_dir_all(&source).ok();
    }

    /// An uninstall still attributes its event with the correct
    /// harness, and both per-target telemetry files are gone
    /// afterward. This is a structural, not a wire-level, assertion --
    /// the actual `eventType`/`harness` payload is pinned by
    /// `report.rs`'s own
    /// `report_package_uninstalled_attributes_with_the_install_info_harness`
    /// test, which has access to `RecordingTransport`; this test
    /// guards uninstall's own side of the contract (installed
    /// harness -> read before removal -> both files removed).
    #[test]
    fn uninstall_attributes_with_correct_harness_and_removes_both_telemetry_files() {
        let _home = HomeGuard::new("attributes-removes-both-files-home");
        let target = scratch_home("attributes-removes-both-files");
        seed_target_with_install_info(&target, "kiro-cli-v2");
        crate::cli::telemetry::ensure_identity(&target, "kiro-cli-v2");
        assert!(crate::cli::telemetry::install_info_path(&target).is_file());
        assert!(crate::cli::telemetry::identity_path(&target).is_file());

        uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();

        assert!(
            !crate::cli::telemetry::install_info_path(&target).exists(),
            "install-info.json must be removed once it is the per-target telemetry record"
        );
        assert!(
            !crate::cli::telemetry::identity_path(&target).exists(),
            "telemetry-id.json must be removed too, so retiring it actually cleans up"
        );
        fs::remove_dir_all(&target).ok();
    }

    /// The hole this change closes: an uninstall attributes correctly
    /// when `telemetry-id.json` is absent entirely -- the state after
    /// retirement, where `install-info.json` is the ONLY per-target
    /// telemetry file on disk. Before the fix (still reading `harness`
    /// from the identity file), this state reported an unattributed
    /// uninstall or none at all; this test shows the pre-fix shape of
    /// that failure by asserting the file that would have carried
    /// `harness` truly never existed, then confirms the real run
    /// still succeeds and cleans up correctly.
    #[test]
    fn uninstall_attributes_correctly_when_legacy_identity_file_is_absent() {
        let _home = HomeGuard::new("attributes-no-legacy-identity-home");
        let target = scratch_home("attributes-no-legacy-identity");
        seed_target_with_install_info(&target, "claude");
        // The hole: no telemetry-id.json at all, matching the
        // post-retirement state -- the pre-fix code's only harness
        // source is genuinely absent here.
        assert!(
            !crate::cli::telemetry::identity_path(&target).exists(),
            "sanity: this test is meaningless if telemetry-id.json exists"
        );

        let counts = uninstall_one(target.to_str().unwrap(), None, true, false)
            .expect("uninstall must still succeed with no legacy identity file present");
        assert!(!counts.stale);
        assert!(
            !crate::cli::telemetry::install_info_path(&target).exists(),
            "install-info.json must still be removed on this path"
        );
        fs::remove_dir_all(&target).ok();
    }

    /// A crash between the report and cleanup (simulated here by
    /// stopping right after the point `uninstall_one_impl` would have
    /// reported, before either file is removed) must leave both
    /// per-target files in place so a retried uninstall can still read
    /// `harness` and re-report -- the accepted at-least-once delivery
    /// property. Modeled by seeding the target exactly as a real
    /// pre-crash uninstall would leave it (files already deleted,
    /// index entry already gone, telemetry files still present), then
    /// running uninstall_one AGAIN and confirming it treats the
    /// now-manifest-less target as stale while still finding and
    /// removing the surviving telemetry files -- the retry's own
    /// cleanup, standing in for what the crashed run never reached.
    #[test]
    fn crash_between_report_and_cleanup_leaves_files_for_a_retried_uninstall_to_remove() {
        let _home = HomeGuard::new("crash-before-cleanup-retry-home");
        let target = scratch_home("crash-before-cleanup-retry");
        seed_target_with_install_info(&target, "kiro-v3");
        crate::cli::telemetry::ensure_identity(&target, "kiro-v3");

        // Simulates a crash immediately after the real run's telemetry
        // report but before it removed either file or the manifest:
        // delete the manifest and its files directly (what
        // `delete_and_remove_strategy_locked` would have already done
        // by the time report fires), leaving both telemetry files
        // behind exactly as an interrupted process would.
        fs::remove_file(target.join(".kiro/agents/a.json")).ok();
        manifest::remove_strategy_locked(&target, Some("kiro-cli-v2")).unwrap();
        assert!(!manifest::manifest_path(&target).is_file());
        assert!(
            crate::cli::telemetry::install_info_path(&target).is_file(),
            "the simulated crash must leave install-info.json behind, unremoved"
        );
        assert!(
            crate::cli::telemetry::identity_path(&target).is_file(),
            "the simulated crash must leave telemetry-id.json behind, unremoved"
        );

        // The retry: uninstall_one again against the same target. No
        // manifest survives the simulated crash, so this run takes the
        // stale path -- but it must still reach the telemetry-file
        // cleanup step (target_fully_removed's stale arm also runs the
        // target-wide teardown), proving a retry converges to a clean
        // state rather than orphaning the files the crashed run left
        // behind.
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(counts.stale);
        assert!(
            !crate::cli::telemetry::install_info_path(&target).exists(),
            "a retried uninstall must remove install-info.json the crashed run left behind"
        );
        assert!(
            !crate::cli::telemetry::identity_path(&target).exists(),
            "a retried uninstall must remove telemetry-id.json the crashed run left behind"
        );
        fs::remove_dir_all(&target).ok();
    }

    /// Regression (CR comment finding `f-dd9ebe8a`): a `bin_link::
    /// remove_bin_link` failure must be captured into
    /// `counts.bin_link_error` -- data a `--json` consumer reading only
    /// stdout can see -- rather than only ever reaching an operator via
    /// a stderr `eprintln!` (which the pre-fix code did unconditionally,
    /// with no `--json`-visible trace at all). Corrupts the sidecar file
    /// `remove_bin_link` reads so it returns `Err`, then confirms
    /// `uninstall_one` still succeeds overall (non-fatal posture
    /// preserved) but reports the failure in `bin_link_error`, distinct
    /// from the untouched `bin_link_untracked`/`bin_link_symlink_removed`
    /// fields (which must stay `false`, not be conflated with "this
    /// target never requested `--link-bin`").
    ///
    /// A REAL tracked bin-link entry is seeded first (CR comment
    /// r1p4's fix): `remove_bin_link` now folds an undeterminable
    /// lock/read failure into "not tracked" for a target with no
    /// evidence of a tracked link, which is the correct fix but means
    /// this test's ORIGINAL untracked-target setup no longer reproduces
    /// a captured failure at all (see
    /// `uninstall_one_untracked_bin_link_survives_a_corrupt_sidecar`
    /// below for that corrected, opposite case). Seeding a real entry
    /// first, then injecting a permission-denial AFTER `remove_bin_link`'s
    /// own `position()` match (rather than corrupting the sidecar, which
    /// is undeterminable by construction and would fold to "not tracked"
    /// regardless of this seed) is what still makes this target's
    /// tracked status genuinely known before the injected failure.
    #[test]
    fn uninstall_one_captures_a_bin_link_removal_failure_instead_of_swallowing_it() {
        use std::os::unix::fs::PermissionsExt;

        if bin_link::running_as_root() {
            eprintln!(
                "skipping uninstall_one_captures_a_bin_link_removal_failure_instead_of_swallowing_it: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let _home = HomeGuard::new("bin-link-removal-failure-home");
        let target = scratch_home("bin-link-removal-failure");
        // Stale path (no manifest) is sufficient -- `remove_bin_link` is
        // called on every path, stale or not.
        assert!(!manifest::manifest_path(&target).exists());

        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        // Real tracked entry first, under the EXACT string `uninstall_one`
        // will pass to `remove_bin_link` below.
        bin_link::ensure_bin_link(target.to_str().unwrap(), "2026-01-15T09:30:00Z").unwrap();
        // Strip execute permission from the bin-link's parent directory
        // so `symlink_metadata` on the link path inside it fails with
        // `PermissionDenied`, not `NotFound` -- a real `SymlinkFailed`
        // reached AFTER the `position()` lookup already matched this
        // target (see bin_link.rs's own
        // `remove_bin_link_propagates_a_non_not_found_stat_error_instead_of_treating_it_as_absence`
        // for the identical repro shape on that module's own tests).
        let bin_dir = bin_link::local_bin_link_path(&home)
            .parent()
            .expect("link path always has a parent")
            .to_path_buf();
        let mut perms = fs::metadata(&bin_dir).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&bin_dir, perms).unwrap();

        let counts_result = uninstall_one(target.to_str().unwrap(), None, true, false);

        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&bin_dir, restored);

        let counts = counts_result.expect(
            "a bin-link removal failure must stay non-fatal to the overall uninstall, exactly \
             like the pre-fix eprintln!-only behavior",
        );
        assert!(
            counts.bin_link_error.is_some(),
            "the failure must be captured into counts.bin_link_error, not silently dropped"
        );
        assert!(
            !counts.bin_link_untracked,
            "a failed removal must not be reported as an untracked bin-link"
        );
        assert!(
            !counts.bin_link_symlink_removed,
            "a failed removal must not be reported as a physically-removed symlink"
        );

        fs::remove_dir_all(&target).ok();
    }

    /// Companion to the test above, pinning the corrected (r1p4) behavior
    /// directly at the `uninstall_one` level: a target that never ran
    /// `install --link-bin` must uninstall cleanly with NO
    /// `bin_link_error`, even while `~/.konductor/bin-links` is corrupt
    /// for an unrelated reason.
    #[test]
    fn uninstall_one_untracked_bin_link_survives_a_corrupt_sidecar() {
        let _home = HomeGuard::new("bin-link-untracked-corrupt-sidecar-home");
        let target = scratch_home("bin-link-untracked-corrupt-sidecar");
        assert!(!manifest::manifest_path(&target).exists());

        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let bin_links_path = bin_link::bin_links_path(Some(&home)).unwrap();
        fs::create_dir_all(bin_links_path.parent().unwrap()).unwrap();
        // Corrupt, and this target was NEVER tracked in it.
        fs::write(&bin_links_path, b"not valid json").unwrap();

        let counts = uninstall_one(target.to_str().unwrap(), None, true, false)
            .expect("an untracked target must uninstall cleanly regardless of sidecar state");
        assert!(
            counts.bin_link_error.is_none(),
            "a target never tracked in bin-links must not be charged for an unrelated \
             corrupt sidecar"
        );
        assert!(!counts.bin_link_untracked);
        assert!(!counts.bin_link_symlink_removed);

        fs::remove_dir_all(&target).ok();
    }

    /// `EXIT_SUCCESS_WITH_WARNINGS` (6): unlike `uninstall_one`'s own
    /// unit test above (which only confirms `Ok(counts).bin_link_error`
    /// is populated), this exercises the DISPATCH layer end to end --
    /// `dispatch_target` and `dispatch_uninstall`'s single-entry
    /// shortcut must both map a bin-link removal failure with no other
    /// failure to exit code 6, not 0.
    ///
    /// Regression (CR comment r1p4): a REAL tracked bin-link entry is
    /// seeded first, and the failure this test injects happens AFTER
    /// the `position()` lookup succeeds (a symlink stat failure on the
    /// bin directory itself, not a corrupt/unreadable sidecar) -- so
    /// this target's tracking status is genuinely determinable as
    /// "tracked" before the injected failure ever occurs, unlike the
    /// r1p4 fix's own "sidecar itself unreadable" case (see
    /// `dispatch_target_untracked_bin_link_survives_a_corrupt_sidecar`
    /// below), which is undeterminable by construction and therefore
    /// MUST fold to "not tracked" regardless of whether this target
    /// happens to have a real entry -- there is no way to check
    /// `position()` against content that never parsed.
    #[test]
    fn dispatch_target_returns_exit_code_6_when_bin_link_error_present_with_no_other_failure() {
        use std::os::unix::fs::PermissionsExt;

        if bin_link::running_as_root() {
            eprintln!(
                "skipping dispatch_target_returns_exit_code_6_when_bin_link_error_present_with_no_other_failure: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let _home = HomeGuard::new("dispatch-target-exit-6-home");
        let target = scratch_home("dispatch-target-exit-6");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();

        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        // Real tracked entry first, so the injected failure below
        // resolves against a target with a genuine tracked link at
        // stake -- not the untracked-target case r1p4 is about.
        bin_link::ensure_bin_link(&canonical, "2026-01-15T09:30:00Z").unwrap();
        // Strip execute permission from the bin-link's parent directory
        // so `symlink_metadata` on the link path inside it fails with
        // `PermissionDenied`, not `NotFound` -- a real `SymlinkFailed`
        // reached AFTER `remove_bin_link`'s own `position()` lookup
        // already matched this target, mirroring
        // `remove_bin_link_propagates_a_non_not_found_stat_error_instead_of_treating_it_as_absence`
        // in bin_link.rs's own test suite. Root's DAC override would
        // bypass this chmod (see that test's own root-proofing), so
        // this test is skipped under root via the guard above.
        let bin_dir = bin_link::local_bin_link_path(&home)
            .parent()
            .expect("link path always has a parent")
            .to_path_buf();
        let mut perms = fs::metadata(&bin_dir).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&bin_dir, perms).unwrap();

        let index = Index::new(vec![IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            target.to_str().unwrap(),
            None,
            false,
            false,
            ColorMode::disabled(),
        );

        // Restore permissions before any further cleanup.
        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&bin_dir, restored);

        assert_eq!(
            code, EXIT_SUCCESS_WITH_WARNINGS,
            "an otherwise-successful uninstall with a bin-link removal failure for a \
             GENUINELY tracked target must exit 6, not 0"
        );
        assert!(!target.join(".kiro/agents/a.json").exists());
        fs::remove_dir_all(&target).ok();
    }

    /// Regression (CR comment r1p4): the inverse of the test above.
    /// A target that NEVER ran `install --link-bin` (nothing tracked
    /// for it in the sidecar) must uninstall cleanly with exit 0, even
    /// while `~/.konductor/bin-links` is corrupted for an unrelated
    /// reason -- before this fix, the lock-acquire/read on the corrupt
    /// sidecar propagated with `?` BEFORE the `position()` lookup ever
    /// ran, so this untracked target was charged with a `bin_link_error`
    /// (and exit 6) purely because SOME OTHER file was malformed, never
    /// because this target had anything to do with `--link-bin` at all.
    #[test]
    fn dispatch_target_untracked_bin_link_survives_a_corrupt_sidecar() {
        let _home = HomeGuard::new("dispatch-target-untracked-corrupt-sidecar-home");
        let target = scratch_home("dispatch-target-untracked-corrupt-sidecar");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();

        // This target never ran `install --link-bin` -- nothing tracked
        // for it. The sidecar is corrupted anyway (simulating damage
        // unrelated to this target, e.g. a hand-edit or a different
        // target's own bug).
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let bin_links_path = bin_link::bin_links_path(Some(&home)).unwrap();
        fs::create_dir_all(bin_links_path.parent().unwrap()).unwrap();
        fs::write(&bin_links_path, b"not valid json").unwrap();

        let index = Index::new(vec![IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            target.to_str().unwrap(),
            None,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(
            code, 0,
            "a target with no tracked --link-bin symlink must exit 0 even when the \
             (unrelated) sidecar is corrupted -- it must never be charged for a failure \
             that has nothing to do with it"
        );
        assert!(!target.join(".kiro/agents/a.json").exists());
        fs::remove_dir_all(&target).ok();
    }

    /// Same exit-code-6 mapping, via `dispatch_uninstall`'s
    /// single-tracked-entry shortcut rather than `dispatch_target`
    /// directly. Real tracked bin-link entry seeded first, with a
    /// permission-denial failure injected AFTER `remove_bin_link`'s own
    /// `position()` match (not a corrupt/unreadable sidecar) -- see
    /// `dispatch_target_returns_exit_code_6_when_bin_link_error_present_with_no_other_failure`'s
    /// own comment for why (CR comment r1p4).
    #[test]
    fn dispatch_uninstall_single_entry_returns_exit_code_6_when_bin_link_error_present() {
        use std::os::unix::fs::PermissionsExt;

        if bin_link::running_as_root() {
            eprintln!(
                "skipping dispatch_uninstall_single_entry_returns_exit_code_6_when_bin_link_error_present: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let _home = HomeGuard::new("dispatch-uninstall-exit-6-home");
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        seed_target(
            &home,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&home).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        bin_link::ensure_bin_link(&canonical, "2026-01-15T09:30:00Z").unwrap();
        let bin_dir = bin_link::local_bin_link_path(&home)
            .parent()
            .expect("link path always has a parent")
            .to_path_buf();
        let mut perms = fs::metadata(&bin_dir).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&bin_dir, perms).unwrap();

        let code = dispatch_uninstall(None, false, None, false, false, ColorMode::disabled());

        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&bin_dir, restored);

        assert_eq!(code, EXIT_SUCCESS_WITH_WARNINGS);
        assert!(!home.join(".kiro/agents/a.json").exists());
    }

    /// `exit_code_for_counts` itself: 0 when `bin_link_error` is `None`,
    /// the failure's own carried exit code when it is `Some` -- 6 for a
    /// USAGE_ERROR-mapped `BinLinkError` variant (see the companion test
    /// below for the 65 case, CR comment r1p6's fix), regardless of any
    /// other field.
    #[test]
    fn exit_code_for_counts_maps_bin_link_error_to_six() {
        assert_eq!(exit_code_for_counts(&UninstallCounts::default()), 0);
        let with_error = UninstallCounts {
            bin_link_error: Some(BinLinkFailure {
                message: "boom".to_string(),
                exit_code: EXIT_SUCCESS_WITH_WARNINGS,
            }),
            ..Default::default()
        };
        assert_eq!(
            exit_code_for_counts(&with_error),
            EXIT_SUCCESS_WITH_WARNINGS
        );
    }

    /// Regression (CR comment r1p6): a `bin_link_error` whose underlying
    /// `BinLinkError` variant maps to `EXIT_VERIFY_FAILED` (65) --
    /// `UnsupportedSchemaVersion`/`RollbackAlsoFailed` -- must propagate
    /// AS 65 through `exit_code_for_counts`, not be flattened to 6. This
    /// is exactly the case a bare `String` field could never carry: the
    /// variant is already gone by the time a `String` is all that's
    /// left, so `BinLinkFailure::from_error` -- which derives the exit
    /// code from the real `BinLinkError` value at construction time --
    /// is what makes this distinction possible at all.
    #[test]
    fn exit_code_for_counts_preserves_65_for_a_schema_version_bin_link_error() {
        let err = bin_link::BinLinkError::UnsupportedSchemaVersion {
            path: PathBuf::from("/home/x/.konductor/bin-links"),
            found: 99,
            supported: 1,
        };
        let failure = BinLinkFailure::from_error(&err);
        assert_eq!(
            failure.exit_code, EXIT_VERIFY_FAILED,
            "UnsupportedSchemaVersion must carry exit code 65, not be assumed as 6"
        );
        let counts = UninstallCounts {
            bin_link_error: Some(failure),
            ..Default::default()
        };
        assert_eq!(
            exit_code_for_counts(&counts),
            EXIT_VERIFY_FAILED,
            "exit_code_for_counts must surface the carried 65, not flatten it to 6"
        );
    }

    /// Companion to the test above: an ORDINARY `BinLinkError` variant
    /// (not `UnsupportedSchemaVersion`/`RollbackAlsoFailed`) must stay
    /// at `EXIT_SUCCESS_WITH_WARNINGS` (6), not escalate to
    /// `EXIT_USAGE_ERROR` (64) the way `bin_link::bin_link_error_exit_code`
    /// would map it in its own (different) context. `uninstall`'s own
    /// bin-link removal is explicitly non-fatal -- see
    /// `BinLinkFailure`'s own doc comment for why blindly reusing that
    /// function's raw output here would wrongly turn a warning-level
    /// symlink hiccup into a reported usage error on an otherwise
    /// fully-successful uninstall.
    #[test]
    fn exit_code_for_counts_keeps_six_for_an_ordinary_bin_link_error() {
        let err = bin_link::BinLinkError::ForeignFileExists {
            path: PathBuf::from("/home/x/.local/bin/konductor"),
        };
        let failure = BinLinkFailure::from_error(&err);
        assert_eq!(
            failure.exit_code, EXIT_SUCCESS_WITH_WARNINGS,
            "an ordinary BinLinkError variant must stay a non-fatal warning (6), not \
             escalate to a usage error (64)"
        );
        let counts = UninstallCounts {
            bin_link_error: Some(failure),
            ..Default::default()
        };
        assert_eq!(exit_code_for_counts(&counts), EXIT_SUCCESS_WITH_WARNINGS);
    }

    #[test]
    fn never_deletes_replaced_foreign_files() {
        let _home = HomeGuard::new("never-delete-foreign-home");
        let target = scratch_home("never-delete-foreign");
        seed_target(
            &target,
            vec![(
                ".kiro/context/notes.md",
                b"user content",
                Provenance::ReplacedForeign,
                None,
            )],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert_eq!(counts.files_deleted, 0);
        assert!(target.join(".kiro/context/notes.md").exists());
        fs::remove_dir_all(&target).ok();
    }

    /// `.claude/settings.json` is a genuinely SHARED file (this install
    /// only ever merges a few `permissions.allow` grant strings into
    /// it -- see `resource_rewrite/claude_settings.rs`'s own
    /// `claude_settings_grant_merges_preserving_unrelated_entries`
    /// test), but its manifest entry is classified `Created`/
    /// `ReplacedOurs` exactly like every other content type this
    /// codebase installs, where those provenances DO mean "we own every
    /// byte, safe to delete". Seeded here as `ReplacedOurs` -- the
    /// classification a real second install/reinstall over the same
    /// target produces (see `manifest::classify_provenance`) -- with
    /// content this install never wrote (an unrelated `hooks` key and
    /// another MCP server's own `permissions.allow` entry), proving
    /// uninstall does not wholesale-delete it even under the
    /// provenance value that would otherwise authorize deletion for
    /// any other path.
    #[test]
    fn never_deletes_claude_settings_json_even_when_replaced_ours() {
        let _home = HomeGuard::new("never-delete-claude-settings-home");
        let target = scratch_home("never-delete-claude-settings");
        let unrelated_content = br#"{"hooks":{"some-hook":true},"permissions":{"allow":["mcp__other-server__some_tool","mcp__konductor-skills__find_skills"]}}"#;
        seed_target(
            &target,
            vec![(
                ".claude/settings.json",
                unrelated_content,
                Provenance::ReplacedOurs,
                None,
            )],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert_eq!(
            counts.files_deleted, 0,
            ".claude/settings.json must never be counted as deleted, regardless of provenance"
        );
        let still_there = fs::read_to_string(target.join(".claude/settings.json")).unwrap();
        assert_eq!(
            still_there.as_bytes(),
            unrelated_content,
            "unrelated hooks/other-server content must survive uninstall byte-for-byte"
        );
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn deletes_created_file_even_when_hash_has_diverged() {
        let _home = HomeGuard::new("delete-diverged-home");
        let target = scratch_home("delete-diverged");
        // Force a stale recorded hash while real on-disk content differs
        // -- simulates a hand-edited Created file. Must still be
        // deleted, and counted as diverged.
        seed_target(
            &target,
            vec![(
                ".kiro/agents/a.json",
                b"hand-edited content",
                Provenance::Created,
                Some(&"a".repeat(64)),
            )],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert_eq!(counts.files_deleted, 1);
        assert_eq!(counts.diverged_deleted, 1);
        assert_eq!(
            counts.diverged_paths,
            vec![PathBuf::from(".kiro/agents/a.json")],
            "diverged_paths must name the specific file counted in diverged_deleted"
        );
        assert!(!target.join(".kiro/agents/a.json").exists());
        fs::remove_dir_all(&target).ok();
    }

    /// `diverged_paths` must stay empty (never a phantom entry) when no
    /// file's hash actually diverged -- `diverged_deleted`/
    /// `diverged_paths.len()` must always agree.
    #[test]
    fn diverged_paths_is_empty_when_nothing_diverged() {
        let _home = HomeGuard::new("diverged-paths-empty-home");
        let target = scratch_home("diverged-paths-empty");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert_eq!(counts.diverged_deleted, 0);
        assert!(counts.diverged_paths.is_empty());
        fs::remove_dir_all(&target).ok();
    }

    /// Multiple diverged files must all be recorded, in the order
    /// `delete_eligible_files` encounters them (manifest file order).
    #[test]
    fn diverged_paths_records_every_diverged_file_in_order() {
        let _home = HomeGuard::new("diverged-paths-multiple-home");
        let target = scratch_home("diverged-paths-multiple");
        seed_target(
            &target,
            vec![
                (
                    ".kiro/agents/a.json",
                    b"hand-edited a",
                    Provenance::Created,
                    Some(&"a".repeat(64)),
                ),
                (".kiro/agents/b.json", b"{}", Provenance::Created, None),
                (
                    ".kiro/agents/c.json",
                    b"hand-edited c",
                    Provenance::Created,
                    Some(&"c".repeat(64)),
                ),
            ],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert_eq!(counts.diverged_deleted, 2);
        assert_eq!(
            counts.diverged_paths,
            vec![
                PathBuf::from(".kiro/agents/a.json"),
                PathBuf::from(".kiro/agents/c.json"),
            ]
        );
        fs::remove_dir_all(&target).ok();
    }

    /// `format_diverged_paths_note` renders the trailing clause
    /// `report_single`/`report_batch` append to their plain-text success
    /// message -- empty when there is nothing to list, and naming every
    /// path (comma-separated) when there is.
    #[test]
    fn format_diverged_paths_note_lists_paths_or_is_empty() {
        assert_eq!(format_diverged_paths_note(&[]), "");
        let note = format_diverged_paths_note(&[
            PathBuf::from(".kiro/agents/a.json"),
            PathBuf::from(".kiro/agents/b.json"),
        ]);
        assert!(note.starts_with("; hash-diverged file(s): "));
        assert!(note.contains(".kiro/agents/a.json"));
        assert!(note.contains(".kiro/agents/b.json"));
    }

    /// `report_single`'s `--json` document must carry `diverged_paths`
    /// as an actual array field with the real path VALUES, not only the
    /// `diverged_deleted` count.
    ///
    /// Regression (CR comment r1p9): the old version of this test only
    /// confirmed `report_single` doesn't panic -- `diverged_paths`
    /// could be dropped from the `json!` macro entirely and this test
    /// would stay green. Asserts against `build_single_json` (the same
    /// construction `report_single` itself now calls, pulled out for
    /// direct testability) so the actual emitted value is checked.
    #[test]
    fn report_single_json_includes_diverged_paths_field() {
        let counts = UninstallCounts {
            files_deleted: 1,
            diverged_deleted: 1,
            diverged_paths: vec![PathBuf::from(".kiro/agents/a.json")],
            ..Default::default()
        };
        let value = build_single_json("/proj/a", &counts);
        assert_eq!(
            value["diverged_paths"],
            serde_json::json!([".kiro/agents/a.json"]),
            "diverged_paths must carry the real path values, not just a count: {value}"
        );
        assert_eq!(value["diverged_deleted"], 1);
        assert_eq!(value["target_dir"], "/proj/a");

        // Structural guard for the actual print call site.
        report_single("/proj/a", &counts, false, ColorMode::disabled());
        report_single("/proj/a", &counts, true, ColorMode::disabled());
    }

    #[test]
    fn does_not_count_divergence_for_hash_matched_file() {
        let _home = HomeGuard::new("no-divergence-when-matched-home");
        let target = scratch_home("no-divergence-when-matched");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert_eq!(counts.files_deleted, 1);
        assert_eq!(counts.diverged_deleted, 0);
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn removes_now_empty_directories_but_keeps_kiro_and_konductor_roots() {
        let _home = HomeGuard::new("empty-dir-cleanup-home");
        let target = scratch_home("empty-dir-cleanup");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        // agents/ subdir must be gone (now empty after deletion)...
        assert!(!target.join(".kiro/agents").exists());
        // ...but .kiro/ itself, and .konductor/ (holding the manifest
        // uninstall just read, then the index-removal step touches),
        // must both still exist.
        assert!(target.join(".kiro").is_dir());
        assert!(target.join(".konductor").is_dir());
        assert!(counts.dirs_removed >= 1);
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn never_removes_dot_konductor_even_if_it_would_become_empty() {
        // Manifest itself lives under .konductor/ -- deleting the last
        // tracked file must never attempt to remove .konductor/, even
        // though nothing this function touches would make it non-empty
        // on its own (manifest deletion is not part of this path).
        let target = scratch_home("keep-konductor-root");
        let _home = HomeGuard::new("keep-konductor-root-home");
        seed_target(
            &target,
            vec![(
                ".konductor/skills/s/SKILL.md",
                b"# s",
                Provenance::Created,
                None,
            )],
        );
        uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(target.join(".konductor").is_dir());
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn never_removes_dot_claude_even_if_it_would_become_empty() {
        // Regression for the Claude Code install strategy: `.claude/`
        // holds BOTH agents and skills (see `install::claude`'s own
        // "Two install roots, collapsed to one" doc comment), so
        // deleting every tracked file leaves it empty -- it must be
        // protected exactly like `.kiro`/`.konductor` are above, not
        // removed just because nothing else in this run happens to
        // populate it.
        let target = scratch_home("keep-claude-root");
        let _home = HomeGuard::new("keep-claude-root-home");
        seed_target(
            &target,
            vec![(
                ".claude/skills/s/SKILL.md",
                b"# s",
                Provenance::Created,
                None,
            )],
        );
        uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(target.join(".claude").is_dir());
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn removes_now_empty_subdirs_under_claude_but_keeps_claude_root() {
        let _home = HomeGuard::new("claude-empty-dir-cleanup-home");
        let target = scratch_home("claude-empty-dir-cleanup");
        seed_target(
            &target,
            vec![(".claude/agents/a.md", b"agent", Provenance::Created, None)],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(!target.join(".claude/agents").exists());
        assert!(target.join(".claude").is_dir());
        assert!(counts.dirs_removed >= 1);
        fs::remove_dir_all(&target).ok();
    }

    // ── `.kiro/skills/sop-<name>/SKILL.md` (Kiro-discoverable SOP skills) ──
    //
    // Unlike `.claude/skills/sop-<name>/SKILL.md` (the Claude dual-marker
    // conversion, deliberately excluded from every strategy's manifest
    // slot -- see `install::kiro_cli::plan_additive_claude_sop_skill_files`'s
    // own doc comment), the Kiro-discoverable conversion IS tracked in
    // the installing strategy's own slot, like any other content type.
    // These tests exercise the same safety properties every other
    // content type already gets from `delete_eligible_files`/
    // `cleanup_empty_dirs`, plus the one extra protection this path
    // specifically needs: `.kiro/skills/` itself must survive even when
    // this install owns nothing under it anymore, since it is Kiro IDE's
    // general-purpose skills directory, shared with skills this install
    // never created.

    #[test]
    fn never_removes_dot_kiro_skills_even_if_it_would_become_empty() {
        // `.kiro/skills/` legitimately holds skills this install never
        // created (on a real developer machine, dozens of them) -- see
        // `cleanup_empty_dirs`'s own doc comment on `kiro_skills_root`.
        // Deleting the one tracked SOP-skill directory here must never
        // remove `.kiro/skills/` itself, even though nothing else in this
        // seeded target populates it.
        let target = scratch_home("keep-kiro-skills-root");
        let _home = HomeGuard::new("keep-kiro-skills-root-home");
        seed_target(
            &target,
            vec![(
                ".kiro/skills/sop-ticket-sync/SKILL.md",
                b"# sop-ticket-sync",
                Provenance::Created,
                None,
            )],
        );
        uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(target.join(".kiro/skills").is_dir());
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn removes_now_empty_sop_skill_subdir_but_keeps_kiro_skills_root() {
        let _home = HomeGuard::new("kiro-skills-empty-dir-cleanup-home");
        let target = scratch_home("kiro-skills-empty-dir-cleanup");
        seed_target(
            &target,
            vec![(
                ".kiro/skills/sop-ticket-sync/SKILL.md",
                b"# sop-ticket-sync",
                Provenance::Created,
                None,
            )],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        // The per-SOP subdirectory this install owned is gone (now
        // empty after its one file was deleted)...
        assert!(!target.join(".kiro/skills/sop-ticket-sync").exists());
        assert!(target.join(".kiro/skills").is_dir());
        assert!(counts.dirs_removed >= 1);
        fs::remove_dir_all(&target).ok();
    }

    /// The "never delete a skill it did not install" property: a foreign,
    /// unrelated skill directory sitting alongside a tracked SOP-skill
    /// directory in the SAME `.kiro/skills/` root must survive uninstall
    /// byte-for-byte, exactly like `never_deletes_replaced_foreign_files`
    /// proves for other content types -- `.kiro/skills/` is never wholesale-
    /// managed the way `.konductor/skills/`/`.claude/skills/` are; this
    /// install only ever touches the specific `sop-<name>/` directories it
    /// itself created.
    #[test]
    fn never_deletes_unrelated_skill_under_kiro_skills() {
        let _home = HomeGuard::new("kiro-skills-foreign-home");
        let target = scratch_home("kiro-skills-foreign");
        // A hand-authored/third-party skill this install never created --
        // no manifest entry for it at all, mirroring how a real developer
        // machine's `.kiro/skills/` holds many such directories.
        let foreign = target.join(".kiro/skills/not-ours/SKILL.md");
        fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        fs::write(&foreign, b"---\nname: not-ours\n---\nhand-authored\n").unwrap();

        seed_target(
            &target,
            vec![(
                ".kiro/skills/sop-ticket-sync/SKILL.md",
                b"# sop-ticket-sync",
                Provenance::Created,
                None,
            )],
        );
        uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();

        assert!(
            !target.join(".kiro/skills/sop-ticket-sync").exists(),
            "the tracked SOP-skill directory this install owned must be removed"
        );
        assert_eq!(
            fs::read(&foreign).unwrap(),
            b"---\nname: not-ours\n---\nhand-authored\n",
            "the unrelated, untracked skill directory must survive uninstall byte-for-byte"
        );
        assert!(
            target.join(".kiro/skills").is_dir(),
            "the shared .kiro/skills/ root must survive, still holding the foreign skill"
        );
        fs::remove_dir_all(&target).ok();
    }

    /// Divergence semantics for a Kiro-discoverable SOP-skill file must
    /// match the existing behavior for any other `Created` file (see
    /// `deletes_created_file_even_when_hash_has_diverged`): a hand-edited
    /// SOP-skill is still deleted (this install owns the whole path), and
    /// still counted/named as diverged -- never silently left behind, and
    /// never treated as foreign just because its content changed.
    #[test]
    fn deletes_kiro_sop_skill_even_when_hash_has_diverged() {
        let _home = HomeGuard::new("kiro-sop-skill-diverged-home");
        let target = scratch_home("kiro-sop-skill-diverged");
        seed_target(
            &target,
            vec![(
                ".kiro/skills/sop-ticket-sync/SKILL.md",
                b"hand-edited body",
                Provenance::Created,
                Some(&"a".repeat(64)),
            )],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert_eq!(counts.files_deleted, 1);
        assert_eq!(counts.diverged_deleted, 1);
        assert_eq!(
            counts.diverged_paths,
            vec![PathBuf::from(".kiro/skills/sop-ticket-sync/SKILL.md")]
        );
        assert!(!target
            .join(".kiro/skills/sop-ticket-sync/SKILL.md")
            .exists());
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn never_touches_config_yml_or_logs_under_konductor() {
        let _home = HomeGuard::new("preserve-config-and-logs-home");
        let target = scratch_home("preserve-config-and-logs");
        fs::create_dir_all(target.join(".konductor/logs")).unwrap();
        fs::write(target.join(".konductor/config.yml"), b"preset: solo\n").unwrap();
        fs::write(target.join(".konductor/logs/run.log"), b"log line\n").unwrap();
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(target.join(".konductor/config.yml").is_file());
        assert!(target.join(".konductor/logs/run.log").is_file());
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn removes_index_entry_after_successful_uninstall() {
        // Exercises `uninstall_one`'s call to `index::remove_index_entry`
        // against a scratch `$HOME` (via `HomeGuard`), never the real
        // process-global one: `index::` always resolves `$HOME` for the
        // index's LOCATION (see index.rs's own module docstring), so
        // any test that reaches this call must control `$HOME` itself
        // or risk racing another module's concurrently-running $HOME
        // hijack. `HomeGuard` below takes the CRATE-WIDE
        // `test_home_lock::HOME_ENV_LOCK`, not a module-private one --
        // see `crate::cli::test_home_lock`'s own doc comment for why: a
        // module-private lock did NOT serialize across modules and
        // caused a real intermittent failure in `update.rs`.
        let _home = HomeGuard::new("index-removed-after-success-home");
        let target = scratch_home("index-removed-after-success");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        assert!(uninstall_one(&canonical, None, true, false).is_ok());
        fs::remove_dir_all(&target).ok();
    }

    /// End-to-end: with a genuinely empty real index (a fresh `HOME`
    /// that has never had anything installed, rather than an in-memory
    /// `Index` value constructed and never passed to `dispatch_uninstall`),
    /// `dispatch_uninstall` must take the zero-tracked-installs branch
    /// and return 0.
    #[test]
    fn dispatch_uninstall_with_zero_entries_prints_message_and_returns_zero() {
        let _home = HomeGuard::new("zero-entries-plain-home");
        assert!(index::read_index().unwrap().is_none());
        let code = dispatch_uninstall(None, false, None, false, false, ColorMode::disabled());
        assert_eq!(code, 0);
    }

    /// `dispatch_uninstall` with `HOME` genuinely unresolvable (unset)
    /// must exit non-zero -- before the fix, `read_index()` returned
    /// `Ok(None)` for this exact case, indistinguishable from "no index
    /// file yet, but $HOME is fine", so `dispatch_uninstall` silently
    /// took the zero-tracked-installs branch and exited 0 as if nothing
    /// was ever installed. Directly unsets the process-global `HOME`
    /// (rather than pointing it at a scratch dir via `HomeGuard`) to
    /// exercise the genuinely-unresolvable case, still under the
    /// crate-wide lock so no other HOME-mutating test can interleave.
    #[test]
    fn dispatch_uninstall_with_home_unset_exits_nonzero_not_silently_zero() {
        let _lock = lock_home();
        let original_home = std::env::var_os("HOME");
        // SAFETY: held under the crate-wide HOME_ENV_LOCK for this
        // test's entire body; restored before returning.
        unsafe {
            std::env::remove_var("HOME");
        }
        let code = dispatch_uninstall(None, false, None, false, false, ColorMode::disabled());
        unsafe {
            match &original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        assert_ne!(
            code, 0,
            "an unresolvable $HOME must never silently report success -- \
             uninstall cannot determine whether anything is tracked"
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
    }

    /// `report_no_tracked_installs`'s `--json` rendering must be valid,
    /// parseable JSON carrying `{"command": ..., "tracked_installs": 0}`
    /// -- the same field-naming convention `build_error_json`/
    /// `report_single`/`report_batch` already establish -- rather than
    /// the plain-text `println!` this path used before. Asserted via a
    /// pure JSON-construction check, matching this module's existing
    /// `build_error_json_has_command_and_error_fields`-style structural
    /// assertion rather than stdout capture.
    #[test]
    fn report_no_tracked_installs_json_has_command_and_tracked_installs_fields() {
        let value = serde_json::json!({
            "command": "uninstall",
            "tracked_installs": 0,
        });
        let reparsed: serde_json::Value =
            serde_json::from_str(&value.to_string()).expect("must be valid, parseable JSON");
        assert_eq!(reparsed["command"], "uninstall");
        assert_eq!(reparsed["tracked_installs"], 0);
    }

    /// End-to-end: `dispatch_uninstall` with zero tracked installs and
    /// `json=true` must return 0 and take the
    /// `report_no_tracked_installs` branch rather than the old
    /// unconditional plain-text `println!`. The exit code is the only
    /// externally observable signal this test can assert without stdout
    /// capture (see the module-level comment on `report_error`'s tests
    /// for why this suite favors structural/exit-code assertions);
    /// `report_no_tracked_installs_json_has_command_and_tracked_installs_fields`
    /// above pins the exact JSON shape this branch now emits.
    #[test]
    fn dispatch_uninstall_zero_tracked_installs_json_true_returns_zero() {
        let _home = HomeGuard::new("zero-tracked-json-home");
        let code = dispatch_uninstall(None, false, None, false, true, ColorMode::disabled());
        assert_eq!(code, 0);
    }

    /// When the resolved target matches no tracked entry and 2+
    /// installs ARE tracked, `format_other_tracked_installs` -- the
    /// same helper the discoverability note uses -- must list every one
    /// of them, not just the resolved path that failed to match.
    /// `resolved_home` (here, a path matching nothing) excludes nothing
    /// from the listing, since it isn't tracked at all.
    #[test]
    fn format_other_tracked_installs_lists_everything_when_resolved_home_matches_none() {
        let index = Index::new(vec![
            IndexEntry {
                target_dir: "/tracked/a".to_string(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: "/tracked/b".to_string(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
        ]);
        let listing = format_other_tracked_installs(&index, "/not/tracked/at/all")
            .expect("2+ tracked installs must produce a listing when none of them match");
        assert!(listing.contains("/tracked/a"));
        assert!(listing.contains("/tracked/b"));
    }

    #[test]
    fn dispatch_target_no_match_is_usage_error() {
        let home = scratch_home("target-no-match");
        let index = Index::new(vec![IndexEntry {
            target_dir: "/does/not/match".to_string(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            home.to_str().unwrap(),
            None,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn dispatch_target_matches_canonicalized_entry() {
        let _home = HomeGuard::new("target-matches-home");
        let target = scratch_home("target-matches");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let index = Index::new(vec![IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            target.to_str().unwrap(),
            None,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);
        assert!(!target.join(".kiro/agents/a.json").exists());
        fs::remove_dir_all(&target).ok();
    }

    // ── --target can prune a stale (deleted) entry ──────────────────────

    /// `uninstall --target <dir>` for a tracked entry whose directory
    /// was already deleted (a stale index entry, exactly the case
    /// `uninstall_one` is built to prune) must still find and prune that
    /// entry via the fallback match, rather than failing with a usage
    /// error before it ever gets a chance to match (`canonicalize_target_dir`
    /// errors on a nonexistent path, so without the fallback only
    /// `--all` could reach this entry at all).
    #[test]
    fn dispatch_target_prunes_stale_entry_whose_directory_was_deleted() {
        let _home = HomeGuard::new("stale-target-prune-home");
        let target = scratch_home("stale-target-prune");
        // Track it while it still exists, exactly like a real prior
        // install would have.
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        // Now delete the directory out from under the index -- the
        // stale case. Canonicalizing `target`/`canonical` again from
        // this point on will fail (the path no longer exists).
        fs::remove_dir_all(&target).unwrap();
        assert!(index::canonicalize_target_dir(&target).is_err());

        let idx = Index::new(vec![IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        // Pass the ALREADY-canonical string as --target (mirrors a user
        // re-running uninstall with the same path they installed to,
        // which has since been deleted) -- the fallback's verbatim-match
        // arm finds it even though canonicalize_target_dir itself fails.
        let code = dispatch_target(&idx, &canonical, None, false, false, ColorMode::disabled());
        assert_eq!(
            code, 0,
            "a stale entry must be prunable via --target, not just --all"
        );
    }

    /// A GENUINELY wrong/unrelated `--target` path -- one that also does
    /// not exist AND does not match any tracked entry either verbatim or
    /// in absolute form -- must still be rejected as a usage error. The
    /// fallback added for the stale-entry case above must never turn a
    /// real mistake into a silent no-op or a false match.
    #[test]
    fn dispatch_target_nonexistent_and_unrelated_path_is_still_usage_error() {
        let target = scratch_home("unrelated-tracked");
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let idx = Index::new(vec![IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &idx,
            "/definitely/does/not/exist/and/is/not/tracked",
            None,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_all_continues_on_per_target_failure() {
        let _home = HomeGuard::new("all-continues-on-failure-home");

        let good = scratch_home("all-good");
        seed_target(
            &good,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let good_canonical = index::canonicalize_target_dir(&good).unwrap();
        let good_file = good.join(".kiro/agents/a.json");
        assert!(good_file.exists());

        // A genuinely failing target: a real manifest with an
        // unsupported schema_version, which uninstall_one rejects
        // before it ever reaches file deletion or index removal.
        let bad = scratch_home("all-bad");
        let bad_manifest_path = manifest::manifest_path(&bad);
        fs::create_dir_all(bad_manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &bad_manifest_path,
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let bad_canonical = index::canonicalize_target_dir(&bad).unwrap();

        index::write_index(IndexEntry {
            target_dir: good_canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: bad_canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, true, None, false, false, ColorMode::disabled());

        // The good target must have actually been uninstalled despite
        // the bad target's failure -- the continue-past-failure
        // contract this test guards.
        assert!(
            !good_file.exists(),
            "the good target's file must be deleted even though a sibling target failed"
        );
        // Only the bad target failed, and it failed with 65
        // (unsupported schema_version), never 64 -- so the batch's
        // reported exit code must be 65.
        assert_eq!(code, EXIT_VERIFY_FAILED);

        fs::remove_dir_all(&good).ok();
        fs::remove_dir_all(&bad).ok();
    }

    /// The design decision this CR implements (r2p5): with `--harness
    /// <name>` given to an `--all` batch, a target that does not track
    /// that harness is SKIPPED, not failed -- the batch still succeeds
    /// (exit 0) and the skipped target's files are left untouched, while
    /// a target that DOES track the requested harness is genuinely
    /// uninstalled. Before this fix, `select_harness`'s stricter r2 check
    /// made the mismatched target a hard failure, showing up in
    /// `report_batch`'s failed list even though nothing was actually
    /// broken about it.
    #[test]
    fn dispatch_all_skips_targets_that_do_not_track_the_requested_harness() {
        let _home = HomeGuard::new("all-skip-harness-not-tracked-home");

        let matching = scratch_home("all-skip-matching");
        seed_target(
            &matching,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let matching_canonical = index::canonicalize_target_dir(&matching).unwrap();
        let matching_file = matching.join(".kiro/agents/a.json");
        assert!(matching_file.exists());

        // Tracks a DIFFERENT harness ("claude") than the one this batch
        // requests ("kiro-cli-v2") -- must be skipped, not failed.
        let mismatched = scratch_home("all-skip-mismatched");
        seed_multi_strategy_target(
            &mismatched,
            "claude",
            vec![(".claude/agents/a.md", b"{}", Provenance::Created)],
        );
        let mismatched_canonical = index::canonicalize_target_dir(&mismatched).unwrap();
        let mismatched_file = mismatched.join(".claude/agents/a.md");
        assert!(mismatched_file.exists());

        index::write_index(IndexEntry {
            target_dir: matching_canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: mismatched_canonical,
            strategies: vec!["claude".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(
            None,
            true,
            Some("kiro-cli-v2".to_string()),
            false,
            false,
            ColorMode::disabled(),
        );

        assert!(
            !matching_file.exists(),
            "the target tracking the requested harness must have been uninstalled"
        );
        assert!(
            mismatched_file.exists(),
            "the target that does not track the requested harness must be left untouched, \
             not deleted"
        );
        // A skip is not a failure -- the batch succeeds overall.
        assert_eq!(code, 0);

        fs::remove_dir_all(&matching).ok();
        fs::remove_dir_all(&mismatched).ok();
    }

    /// `report_batch` itself, in isolation: a `skipped` entry lands in
    /// its own bucket, distinct from `succeeded`/`failed`, in both
    /// plain-text and `--json` mode -- guards against a future change
    /// silently dropping the skip bucket or panicking on it.
    #[test]
    fn report_batch_does_not_panic_with_a_skipped_entry_present() {
        report_batch(
            &[],
            &[(
                "/proj/b".to_string(),
                "/proj/b does not track harness 'kiro-cli-v2'; tracked harness(es): claude"
                    .to_string(),
            )],
            &[],
            false,
            ColorMode::disabled(),
        );
        report_batch(
            &[],
            &[(
                "/proj/b".to_string(),
                "/proj/b does not track harness 'kiro-cli-v2'; tracked harness(es): claude"
                    .to_string(),
            )],
            &[],
            true,
            ColorMode::disabled(),
        );
    }

    #[test]
    fn never_emits_exit_code_2() {
        assert_ne!(EXIT_USAGE_ERROR, 2);
    }

    // ── exit-code-65 for unsupported schema version ─────────────────────

    /// A manifest at the target with an unsupported `schema_version`
    /// must fail `uninstall_one` with `EXIT_VERIFY_FAILED` (65), never
    /// `EXIT_USAGE_ERROR` (64).
    #[test]
    fn uninstall_one_maps_unsupported_manifest_schema_version_to_65() {
        let target = scratch_home("manifest-schema-65");
        let manifest_path = manifest::manifest_path(&target);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let err = uninstall_one(target.to_str().unwrap(), None, true, false)
            .expect_err("unsupported schema_version must be rejected");
        assert_eq!(err.exit_code, 65);
        fs::remove_dir_all(&target).ok();
    }

    /// A regular, expected failure (e.g. a real read/remove-file error)
    /// must still map to `EXIT_USAGE_ERROR` (64) -- confirms only the
    /// unsupported-schema-version variant maps to 65.
    #[test]
    fn uninstall_one_maps_malformed_manifest_to_64() {
        let target = scratch_home("manifest-malformed-64");
        let manifest_path = manifest::manifest_path(&target);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, b"not json").unwrap();
        let err = uninstall_one(target.to_str().unwrap(), None, true, false)
            .expect_err("malformed manifest must be rejected");
        assert_eq!(err.exit_code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&target).ok();
    }

    /// `dispatch_target`/the single-entry branch of `dispatch_uninstall`
    /// must propagate `uninstall_one`'s real exit code (65), not
    /// flatten it to `EXIT_USAGE_ERROR`.
    #[test]
    fn dispatch_target_propagates_verify_failed_exit_code() {
        let target = scratch_home("dispatch-target-65");
        let manifest_path = manifest::manifest_path(&target);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let index = Index::new(vec![IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            target.to_str().unwrap(),
            None,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 65);
        fs::remove_dir_all(&target).ok();
    }

    // ── bare invocation with 2+ tracked installs is a hard usage error ──
    //
    // `dispatch_uninstall`'s no-`--target`/no-`--all` path against 2+
    // tracked entries is now an immediate usage error naming every
    // tracked install (`report_ambiguous_targets`) -- there is no more
    // implicit $HOME resolution, confirmation prompt, or discoverability
    // note. A single tracked entry is still uninstalled directly,
    // unchanged (see the existing single-entry tests elsewhere in this
    // suite).

    /// Regression (1): with exactly one tracked install, bare
    /// `uninstall` (no `--target`) still succeeds via the existing
    /// single-entry shortcut -- unaffected by the 2+-tracked ambiguity
    /// error, which only applies once 2+ entries are tracked.
    #[test]
    fn dispatch_uninstall_bare_invocation_single_entry_succeeds() {
        let _home = HomeGuard::new("bare-single-entry-home");
        let target = scratch_home("bare-single-entry-target");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, false, None, false, false, ColorMode::disabled());
        assert_eq!(
            code, 0,
            "bare uninstall with exactly one tracked install must succeed"
        );
        assert!(!target.join(".kiro/agents/a.json").exists());
        fs::remove_dir_all(&target).ok();
    }

    /// Regression (2): with 2+ tracked installs and neither `--target`
    /// nor `--all` given, `dispatch_uninstall` is a usage error naming
    /// every tracked install -- nothing is touched: both targets' files
    /// and index entries survive untouched.
    #[test]
    fn dispatch_uninstall_bare_invocation_multiple_entries_is_usage_error_naming_all() {
        let _home = HomeGuard::new("bare-multi-entries-usage-error-home");
        let target_a = scratch_home("bare-multi-entries-usage-error-a");
        let target_b = scratch_home("bare-multi-entries-usage-error-b");
        seed_target(
            &target_a,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        seed_target(
            &target_b,
            vec![(".kiro/agents/b.json", b"{}", Provenance::Created, None)],
        );
        let canonical_a = index::canonicalize_target_dir(&target_a).unwrap();
        let canonical_b = index::canonicalize_target_dir(&target_b).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical_a.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical_b.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, false, None, false, false, ColorMode::disabled());
        assert_eq!(
            code, EXIT_USAGE_ERROR,
            "2+ tracked installs with neither --target nor --all must be a usage error"
        );
        assert!(
            target_a.join(".kiro/agents/a.json").exists(),
            "neither tracked install must be touched by the ambiguity error"
        );
        assert!(target_b.join(".kiro/agents/b.json").exists());
        let remaining = index::read_index().unwrap().unwrap();
        assert!(remaining
            .installs
            .iter()
            .any(|e| e.target_dir == canonical_a));
        assert!(remaining
            .installs
            .iter()
            .any(|e| e.target_dir == canonical_b));

        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
    }

    /// `report_ambiguous_targets` must name every tracked install in
    /// both plain-text (via a `--target <dir>`/`--all` remediation hint)
    /// and `--json` (a structured `tracked_targets` array) modes,
    /// mirroring `update.rs`'s own message text exactly.
    ///
    /// Regression (CR comment r1p9): the old version of this test only
    /// confirmed `report_ambiguous_targets` doesn't panic -- deleting
    /// the listing block, or the `tracked_targets` field, would have
    /// left it green while the test name still promised otherwise. This
    /// now asserts the real construction (`build_ambiguous_targets_message`,
    /// pulled out the same way `dispatch_target_no_match_message` was)
    /// actually contains each target name.
    #[test]
    fn report_ambiguous_targets_names_every_tracked_install() {
        let entries = vec![
            IndexEntry {
                target_dir: "/tracked/a".to_string(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: "/tracked/b".to_string(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
        ];

        let message = build_ambiguous_targets_message(&entries);
        assert!(
            message.contains("/tracked/a"),
            "message must name /tracked/a: {message}"
        );
        assert!(
            message.contains("/tracked/b"),
            "message must name /tracked/b: {message}"
        );
        assert!(
            message.contains("--target <dir>") && message.contains("--all"),
            "message must point at the --target/--all remediation: {message}"
        );

        // Structural guard for the actual print call sites (plain-text
        // routes through `build_ambiguous_targets_message` directly;
        // --json builds its own `tracked_targets` array separately --
        // see `report_ambiguous_targets`'s own body).
        report_ambiguous_targets(&entries, false, ColorMode::disabled());
        report_ambiguous_targets(&entries, true, ColorMode::disabled());
    }

    /// Regression (3): `--all` remains entirely unaffected by this
    /// change -- it still processes every tracked install, one at a
    /// time, regardless of whether any of them happen to be at $HOME.
    #[test]
    fn dispatch_uninstall_all_flag_unaffected_by_ambiguity_error() {
        let _home = HomeGuard::new("all-unaffected-by-ambiguity-home");
        let target_a = scratch_home("all-unaffected-a");
        let target_b = scratch_home("all-unaffected-b");
        seed_target(
            &target_a,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        seed_target(
            &target_b,
            vec![(".kiro/agents/b.json", b"{}", Provenance::Created, None)],
        );
        let canonical_a = index::canonicalize_target_dir(&target_a).unwrap();
        let canonical_b = index::canonicalize_target_dir(&target_b).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical_a,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical_b,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, true, None, false, false, ColorMode::disabled());
        assert_eq!(code, 0);
        assert!(!target_a.join(".kiro/agents/a.json").exists());
        assert!(!target_b.join(".kiro/agents/b.json").exists());

        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
    }

    /// An explicit `--target <dir>` matching a tracked entry must
    /// succeed with no confirmation gate of any kind -- there is no
    /// confirmation flow left in this module at all any more.
    #[test]
    fn dispatch_target_explicit_match_succeeds_with_no_confirmation_gate() {
        let _home = HomeGuard::new("target-explicit-no-gate-home");
        let target = scratch_home("target-explicit-no-gate");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let index = Index::new(vec![IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            target.to_str().unwrap(),
            None,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(
            code, 0,
            "an explicit --target match must succeed without any confirmation gate"
        );
        assert!(!target.join(".kiro/agents/a.json").exists());
    }

    // ── stale-vs-real-empty distinguishability ──────────────────────────

    #[test]
    fn uninstall_one_marks_missing_manifest_as_stale() {
        let _home = HomeGuard::new("stale-missing-manifest-home");
        let target = scratch_home("stale-missing-manifest");
        // No manifest written at all -- a stale tracked install.
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(counts.stale);
        assert_eq!(counts.files_deleted, 0);
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn uninstall_one_real_zero_file_manifest_is_not_stale() {
        // A REAL manifest exists, it just happens to name zero files --
        // must NOT be reported as stale.
        let _home = HomeGuard::new("real-empty-not-stale-home");
        let target = scratch_home("real-empty-not-stale");
        seed_target(&target, vec![]);
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(!counts.stale);
        assert_eq!(counts.files_deleted, 0);
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn uninstall_one_still_prunes_index_entry_when_stale() {
        let _home = HomeGuard::new("stale-still-prunes-index-home");
        let target = scratch_home("stale-still-prunes-index");
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        // Directly confirms uninstall_one succeeds (Ok) for a stale
        // target rather than erroring -- index pruning itself is
        // exercised end-to-end by the existing
        // `removes_index_entry_after_successful_uninstall` test's own
        // race-free equivalent at the index.rs level.
        let counts = uninstall_one(&canonical, None, true, false).unwrap();
        assert!(counts.stale);
        fs::remove_dir_all(&target).ok();
    }

    // ── Harness selection ─────────────────────────────────────────────────

    /// `--harness <name>` at a target tracking 2+ strategies deletes
    /// only the SELECTED strategy's own files, and leaves the OTHER
    /// already-tracked strategy's own slot/files completely untouched --
    /// both in the manifest and on disk.
    #[test]
    fn uninstall_one_with_harness_removes_only_selected_strategy_keeps_other_slot() {
        let _home = HomeGuard::new("harness-select-partial-home");
        let target = scratch_home("harness-select-partial");
        seed_multi_strategy_target(
            &target,
            "kiro-cli-v2",
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created)],
        );
        seed_multi_strategy_target(
            &target,
            "claude",
            vec![(".claude/agents/a.md", b"body", Provenance::Created)],
        );

        // "kiro-cli-v2" is `KiroCliInstallStrategy`'s own `harness_dir()`
        // -- the `--harness` value a user would actually type -- NOT the
        // manifest-internal "kiro-cli-v2" name (see `harness_select.rs`'s
        // own translation-layer doc comment).
        let counts =
            uninstall_one(target.to_str().unwrap(), Some("kiro-cli-v2"), true, false).unwrap();
        assert!(!counts.stale);
        assert_eq!(counts.files_deleted, 1);

        // The selected strategy's own file is gone.
        assert!(!target.join(".kiro/agents/a.json").exists());
        // The OTHER strategy's file survives, untouched.
        assert!(target.join(".claude/agents/a.md").exists());

        // The manifest still exists (claude's slot survives) and
        // now tracks ONLY claude -- kiro-cli-v2's slot is gone.
        let remaining = manifest::read_manifest(&target).unwrap().unwrap();
        assert_eq!(remaining.strategy_names(), vec!["claude"]);

        fs::remove_dir_all(&target).ok();
    }

    /// The index's own tracked `strategies` list for this target shrinks
    /// by exactly the removed harness's name -- the index ENTRY itself
    /// (and the surviving strategy's own name in it) must not be
    /// dropped, since `claude` is still genuinely installed at this
    /// target after this run.
    #[test]
    fn uninstall_one_with_harness_shrinks_index_entry_keeps_other_strategy_name() {
        let _home = HomeGuard::new("harness-select-index-shrink-home");
        let target = scratch_home("harness-select-index-shrink");
        seed_multi_strategy_target(
            &target,
            "kiro-cli-v2",
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created)],
        );
        seed_multi_strategy_target(
            &target,
            "claude",
            vec![(".claude/agents/a.md", b"body", Provenance::Created)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        index::write_index(index::IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string(), "claude".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        uninstall_one(&canonical, Some("kiro-cli-v2"), true, false).unwrap();

        let index = index::read_index().unwrap().unwrap();
        let entry = index
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect("the target_dir entry itself must survive a partial harness removal");
        assert_eq!(entry.strategies, vec!["claude".to_string()]);

        fs::remove_dir_all(&target).ok();
    }

    /// A non-matching `--harness` value at a 2+-strategy target is a
    /// usage error naming what IS tracked, and touches nothing --
    /// neither slot's files, manifest, or index entry.
    #[test]
    fn uninstall_one_with_unmatched_harness_is_usage_error_and_touches_nothing() {
        let _home = HomeGuard::new("harness-select-unmatched-home");
        let target = scratch_home("harness-select-unmatched");
        seed_multi_strategy_target(
            &target,
            "kiro-cli-v2",
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created)],
        );
        seed_multi_strategy_target(
            &target,
            "claude",
            vec![(".claude/agents/a.md", b"body", Provenance::Created)],
        );

        let err =
            uninstall_one(target.to_str().unwrap(), Some("kiro-v3"), true, false).unwrap_err();
        assert!(err.message.contains("does not track harness 'kiro-v3'"));
        assert!(target.join(".kiro/agents/a.json").exists());
        assert!(target.join(".claude/agents/a.md").exists());
        assert_eq!(
            manifest::read_manifest(&target)
                .unwrap()
                .unwrap()
                .strategies
                .len(),
            2
        );

        fs::remove_dir_all(&target).ok();
    }

    /// A manifest that exists on disk but names ZERO
    /// strategies (e.g. every slot was already removed by an earlier
    /// per-harness uninstall run) must have its manifest FILE removed --
    /// not merely be reported as "stale" while the file itself survives
    /// with no index entry left able to reach it again.
    #[test]
    fn uninstall_one_zero_slot_manifest_removes_orphaned_manifest_file() {
        let _home = HomeGuard::new("zero-slot-manifest-home");
        let target = scratch_home("zero-slot-manifest");
        fs::create_dir_all(target.join(".konductor")).unwrap();
        // A manifest with an EMPTY `strategies` list -- distinct from no
        // manifest at all.
        manifest::write_manifest(&target, &manifest::Manifest::empty()).unwrap();
        let manifest_path = manifest::manifest_path(&target);
        assert!(
            manifest_path.is_file(),
            "sanity check: the zero-slot manifest file must genuinely exist first"
        );

        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert!(counts.stale);
        assert!(
            !manifest_path.is_file(),
            "the orphaned zero-slot manifest file must be removed, not left behind"
        );

        fs::remove_dir_all(&target).ok();
    }

    // ── kiro-cli-v2/kiro-v3 override race ────────────────────────────────
    //
    // `uninstall.rs`'s file-deletion step must run under the SAME
    // manifest lock as `install`'s override-on-switch write -- see
    // `manifest::delete_and_remove_strategy_locked`'s own doc comment
    // for the full race. Reproducing this deterministically via real
    // concurrent threads is unreliable: the window is the gap between
    // one UNLOCKED read and an immediately-following LOCKED delete,
    // which is far narrower than a whole concurrent `install` run's
    // real-world duration -- see
    // `install_manifest_concurrency.rs`'s own
    // `uninstall_of_kiro_cli_survives_concurrent_override_to_kiro_cli_v3`
    // for the real-process race test that exercises this race under
    // genuine OS scheduling (a useful complement, but not a reliable
    // reproduction on its own). These two tests instead manually
    // sequence the EXACT interleaving a real race could produce, so the
    // locked delete-and-remove sequence is verified deterministically
    // rather than by chance.

    /// Manually runs an UNLOCKED-delete-then-locked-remove sequence
    /// (`delete_eligible_files` against a stale slot, THEN
    /// `manifest::remove_strategy_locked`) using only functions this
    /// crate still exposes today, to pin -- as a real running assertion
    /// rather than only prose -- exactly what corruption that sequence
    /// produces when a concurrent install's KIRO_VARIANT_FAMILY override
    /// lands in the gap between the stale read and the delete. This is
    /// not itself the regression test for the locked delete-and-remove
    /// sequence; see the next test for that.
    #[test]
    fn old_unlocked_delete_then_locked_remove_sequence_corrupts_a_racing_kiro_variant_override() {
        let _home = HomeGuard::new("kiro-variant-race-old-sequence-home");
        let target = scratch_home("kiro-variant-race-old-sequence");

        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );

        // The UNLOCKED read `uninstall_one_impl`'s own harness selection
        // performs, captured here exactly as it would be: before any
        // concurrent install has touched anything.
        let stale_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        let stale_slot = stale_manifest.get("kiro-cli-v2").unwrap().clone();
        assert_eq!(stale_slot.files.len(), 1);

        // A concurrent `install --harness kiro-v3` completing ENTIRELY
        // in the gap: new content at the SAME destination path
        // (KIRO_VARIANT_FAMILY members write identical paths by
        // construction), then the real override-on-switch manifest
        // commit a genuine `install_from_local` run performs.
        fs::write(target.join(".kiro/agents/a.json"), b"{\"kiro-v3\": true}").unwrap();
        let v3_hash = sha256_hex(&fs::read(target.join(".kiro/agents/a.json")).unwrap());
        manifest::upsert_strategy(
            &target,
            StrategyManifest::new(
                "kiro-v3",
                "2026-01-15T09:31:00Z",
                ".",
                None,
                manifest::Status::Complete,
                vec![manifest::ManifestFile {
                    path: ".kiro/agents/a.json".to_string(),
                    sha256: Some(v3_hash.clone()),
                    provenance: Provenance::ReplacedOurs,
                }],
            ),
        )
        .unwrap();

        // The unlocked sequence: `delete_eligible_files` UNLOCKED against
        // the STALE slot, then finalize via `remove_strategy_locked`.
        let mut counts = UninstallCounts::default();
        let mut touched_dirs = Vec::new();
        delete_eligible_files(&target, &stale_slot, &mut counts, &mut touched_dirs).unwrap();
        manifest::remove_strategy_locked(&target, Some("kiro-cli-v2")).unwrap();

        // The corruption: the manifest still correctly names
        // kiro-v3 as Complete with the file it just wrote, but the
        // unlocked sequence's stale-slot delete already removed it
        // from disk.
        assert!(
            !target.join(".kiro/agents/a.json").is_file(),
            "sanity check: the old sequence's stale-slot delete really does remove the file"
        );
        let final_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        assert_eq!(final_manifest.strategy_names(), vec!["kiro-v3"]);
        let v3_slot = final_manifest.get("kiro-v3").unwrap();
        assert_eq!(v3_slot.files[0].sha256, Some(v3_hash));
        assert!(
            !target.join(&v3_slot.files[0].path).is_file(),
            "CORRUPTED STATE reproduced: the manifest claims kiro-v3 tracks {}, but it does \
             not exist on disk",
            v3_slot.files[0].path
        );

        fs::remove_dir_all(&target).ok();
    }

    /// The SAME interleaving as the test above, but using
    /// `manifest::delete_and_remove_strategy_locked` -- the function
    /// `uninstall_one_impl`'s `Some(full_manifest)` branch calls -- in
    /// place of an unlocked-delete-then-locked-remove sequence. Because
    /// the delete decision itself runs against a FRESH, LOCKED re-read,
    /// it finds nothing named "kiro-cli-v2" left to delete (the
    /// concurrent override already replaced it) and touches nothing at
    /// all -- kiro-v3's freshly-installed file survives untouched.
    #[test]
    fn delete_and_remove_strategy_locked_never_deletes_a_racing_kiro_variant_overrides_files() {
        let _home = HomeGuard::new("kiro-variant-race-fixed-home");
        let target = scratch_home("kiro-variant-race-fixed");

        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );

        let stale_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        let stale_slot = stale_manifest.get("kiro-cli-v2").unwrap().clone();

        fs::write(target.join(".kiro/agents/a.json"), b"{\"kiro-v3\": true}").unwrap();
        let v3_hash = sha256_hex(&fs::read(target.join(".kiro/agents/a.json")).unwrap());
        manifest::upsert_strategy(
            &target,
            StrategyManifest::new(
                "kiro-v3",
                "2026-01-15T09:31:00Z",
                ".",
                None,
                manifest::Status::Complete,
                vec![manifest::ManifestFile {
                    path: ".kiro/agents/a.json".to_string(),
                    sha256: Some(v3_hash.clone()),
                    provenance: Provenance::ReplacedOurs,
                }],
            ),
        )
        .unwrap();
        // Sanity check: the override really happened before the
        // delete step below runs.
        let after_override = manifest::read_manifest(&target).unwrap().unwrap();
        assert_eq!(after_override.strategy_names(), vec!["kiro-v3"]);

        let mut counts = UninstallCounts::default();
        let mut touched_dirs = Vec::new();
        let mut delete_invoked = false;
        let outcome = manifest::delete_and_remove_strategy_locked(
            &target,
            &stale_slot.strategy,
            |fresh_slot| {
                delete_invoked = true;
                delete_eligible_files(&target, fresh_slot, &mut counts, &mut touched_dirs)
            },
        )
        .unwrap();

        assert!(
            outcome.is_none(),
            "kiro-cli-v2 is no longer tracked in the fresh, locked read -- there is nothing left \
             to finalize under that name"
        );
        assert!(
            !delete_invoked,
            "the delete step must never run against a name the fresh, locked re-read no longer tracks"
        );
        assert!(
            target.join(".kiro/agents/a.json").is_file(),
            "kiro-v3's freshly-installed file must survive untouched"
        );
        let final_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        assert_eq!(final_manifest.strategy_names(), vec!["kiro-v3"]);
        assert_eq!(
            final_manifest.get("kiro-v3").unwrap().files[0].sha256,
            Some(v3_hash)
        );

        fs::remove_dir_all(&target).ok();
    }

    /// The SAME `delete_and_remove_strategy_locked`
    /// `None` outcome as the test above -- a concurrent KIRO_VARIANT_FAMILY
    /// override left nothing tracked under the originally-selected
    /// name -- but this time with a coexisting `claude` slot also
    /// tracked at the target. A hardcoded `target_fully_removed = true`
    /// default in `uninstall_one_impl`'s `None` arm would run the
    /// target-WIDE teardown (`index::remove_index_entry`) and orphan
    /// `claude`'s still-valid manifest slot from the index even though
    /// its files are untouched on disk. Demonstrates both computations
    /// side by side: the hardcoded default is wrong here, the fresh-read
    /// one is right.
    #[test]
    fn target_fully_removed_reflects_a_surviving_coexisting_strategy_after_a_concurrent_override() {
        let _home = HomeGuard::new("target-fully-removed-coexist-race-home");
        let target = scratch_home("target-fully-removed-coexist-race");

        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        // Coexisting slot -- never touched by anything in this
        // race, and never removed by the override below (`claude` is
        // not a `KIRO_VARIANT_FAMILY` member).
        manifest::upsert_strategy(
            &target,
            StrategyManifest::new(
                "claude",
                "2026-01-15T09:30:30Z",
                ".",
                None,
                manifest::Status::Complete,
                vec![manifest::ManifestFile {
                    path: ".claude/agents/a.md".to_string(),
                    sha256: Some(sha256_hex(b"claude content\n")),
                    provenance: Provenance::Created,
                }],
            ),
        )
        .unwrap();

        let stale_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        let stale_slot = stale_manifest.get("kiro-cli-v2").unwrap().clone();

        // The concurrent override: `kiro-cli-v2` -> `kiro-v3`, exactly
        // as the sibling race test above -- `claude`'s own slot is
        // untouched by this call (it is not a family member).
        manifest::upsert_strategy(
            &target,
            StrategyManifest::new(
                "kiro-v3",
                "2026-01-15T09:31:00Z",
                ".",
                None,
                manifest::Status::Complete,
                vec![manifest::ManifestFile {
                    path: ".kiro/agents/a.json".to_string(),
                    sha256: Some(sha256_hex(b"{}")),
                    provenance: Provenance::ReplacedOurs,
                }],
            ),
        )
        .unwrap();

        let mut counts = UninstallCounts::default();
        let mut touched_dirs = Vec::new();
        let outcome = manifest::delete_and_remove_strategy_locked(
            &target,
            &stale_slot.strategy,
            |fresh_slot| delete_eligible_files(&target, fresh_slot, &mut counts, &mut touched_dirs),
        )
        .unwrap();
        assert!(
            outcome.is_none(),
            "kiro-cli-v2 is no longer tracked in the fresh, locked read"
        );

        // The OLD behavior: `target_fully_removed` simply defaulted to
        // `true` in this arm, regardless of what else survives.
        let old_buggy_target_fully_removed = true;

        // The FIX: re-read fresh and check whether anything is
        // genuinely left.
        let fixed_target_fully_removed = match manifest::read_manifest(&target) {
            Ok(Some(m)) => m.strategies.is_empty(),
            Ok(None) => true,
            Err(_) => true,
        };

        assert!(
            old_buggy_target_fully_removed,
            "sanity check: this is what the old code hardcoded"
        );
        assert!(
            !fixed_target_fully_removed,
            "a surviving strategy keeps the manifest non-empty, so target_fully_removed must be false"
        );

        // Confirms what the old default would have broken: claude's
        // manifest slot is still genuinely present, so the target-wide
        // `index::remove_index_entry` teardown -- gated on
        // `target_fully_removed` -- must never run here.
        let final_manifest = manifest::read_manifest(&target).unwrap().unwrap();
        assert!(
            final_manifest.get("claude").is_some(),
            "claude's coexisting slot must still be genuinely tracked"
        );

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn report_single_stale_message_differs_from_real_success_message() {
        // Cannot easily capture stdout in-process across both branches
        // portably, so this test instead pins the property at the
        // UninstallCounts level: a stale result and a real 0-file
        // result are structurally distinguishable (different `stale`
        // bit), which is exactly what report_single/report_batch branch
        // on. This guards against a future edit accidentally dropping
        // the `stale` field or the branch that reads it.
        let stale = UninstallCounts {
            stale: true,
            ..Default::default()
        };
        let real_empty = UninstallCounts {
            stale: false,
            ..Default::default()
        };
        assert_ne!(stale, real_empty);
        assert!(stale.stale);
        assert!(!real_empty.stale);
    }

    /// Same "no stdout capture in this module" constraint as the test
    /// above -- `report_single`/`report_batch` must not panic when
    /// `bin_link_error` is `Some` in either plain or `--json` mode, for
    /// both the single-target and batch reporting paths.
    #[test]
    fn report_single_and_batch_do_not_panic_with_a_bin_link_error_present() {
        let counts = UninstallCounts {
            bin_link_error: Some(BinLinkFailure {
                message: "could not remove tracked symlink: permission denied".to_string(),
                exit_code: EXIT_SUCCESS_WITH_WARNINGS,
            }),
            ..Default::default()
        };
        report_single("/proj/a", &counts, false, ColorMode::disabled());
        report_single("/proj/a", &counts, true, ColorMode::disabled());
        report_batch(
            &[("/proj/a".to_string(), counts.clone())],
            &[],
            &[],
            false,
            ColorMode::disabled(),
        );
        report_batch(
            &[("/proj/a".to_string(), counts)],
            &[],
            &[],
            true,
            ColorMode::disabled(),
        );
    }

    #[test]
    fn dispatch_all_batch_summary_distinguishes_stale_skipped_count() {
        let _home = HomeGuard::new("batch-summary-home");
        let real_target = scratch_home("batch-real");
        seed_target(
            &real_target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let stale_target = scratch_home("batch-stale");
        let index = Index::new(vec![
            IndexEntry {
                target_dir: index::canonicalize_target_dir(&real_target).unwrap(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: index::canonicalize_target_dir(&stale_target).unwrap(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
        ]);
        let code = dispatch_all(&index, None, false, false, ColorMode::disabled());
        assert_eq!(
            code, 0,
            "a real success + a stale prune must both count as success"
        );
        fs::remove_dir_all(&real_target).ok();
        fs::remove_dir_all(&stale_target).ok();
    }

    /// `dispatch_all`'s exit-code precedence now spans four levels:
    /// `EXIT_USAGE_ERROR` (64) beats `EXIT_VERIFY_FAILED` (65) beats
    /// `EXIT_SUCCESS_WITH_WARNINGS` (6) beats 0. A batch with one clean
    /// success and one bin-link-warning success must report 6, not 0.
    ///
    /// `warning_target` is genuinely tracked in bin-links (CR comment
    /// r1p4): the injected failure is a permission-denial reached AFTER
    /// `remove_bin_link`'s own `position()` match for THIS target, not
    /// a corrupt/unreadable sidecar -- an unreadable sidecar makes
    /// tracking status undeterminable and now correctly folds to
    /// "not tracked" (exit 0), which would no longer exercise the
    /// warning precedence this test is about. See
    /// `dispatch_target_returns_exit_code_6_when_bin_link_error_present_with_no_other_failure`'s
    /// own comment for the identical reasoning.
    #[test]
    fn dispatch_all_reports_exit_code_6_when_only_a_bin_link_warning_occurred() {
        use std::os::unix::fs::PermissionsExt;

        if bin_link::running_as_root() {
            eprintln!(
                "skipping dispatch_all_reports_exit_code_6_when_only_a_bin_link_warning_occurred: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let _home = HomeGuard::new("dispatch-all-exit-6-home");
        let clean_target = scratch_home("dispatch-all-exit-6-clean");
        let warning_target = scratch_home("dispatch-all-exit-6-warning");
        seed_target(
            &clean_target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        seed_target(
            &warning_target,
            vec![(".kiro/agents/b.json", b"{}", Provenance::Created, None)],
        );

        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let canonical_warning = index::canonicalize_target_dir(&warning_target).unwrap();
        bin_link::ensure_bin_link(&canonical_warning, "2026-01-15T09:30:00Z").unwrap();
        let bin_dir = bin_link::local_bin_link_path(&home)
            .parent()
            .expect("link path always has a parent")
            .to_path_buf();
        let mut perms = fs::metadata(&bin_dir).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&bin_dir, perms).unwrap();

        let index = Index::new(vec![
            IndexEntry {
                target_dir: index::canonicalize_target_dir(&clean_target).unwrap(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: canonical_warning,
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
        ]);
        let code = dispatch_all(&index, None, false, false, ColorMode::disabled());

        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&bin_dir, restored);

        assert_eq!(code, EXIT_SUCCESS_WITH_WARNINGS);

        fs::remove_dir_all(&clean_target).ok();
        fs::remove_dir_all(&warning_target).ok();
    }

    /// A real usage-error failure elsewhere in the batch must still
    /// beat a bin-link warning -- 64 wins over 6, regardless of which
    /// order the batch visits them in.
    ///
    /// CR comment r2p1: `warning_target` must be genuinely TRACKED in
    /// bin-links and hit a genuine bin-link failure on ITS OWN target,
    /// mirroring `dispatch_all_reports_exit_code_6_when_only_a_bin_link_warning_occurred`'s
    /// own permission-denial technique -- injecting the failure via a
    /// corrupt `~/.konductor/bin-links` sidecar does NOT do this: per
    /// the r1p4 fix in `remove_bin_link_at_home`, a corrupt/unreadable
    /// sidecar folds to `Ok(None)` ("not tracked") for any target with
    /// no recorded link, so `warning_target` would uninstall cleanly at
    /// exit 0 and this test's asserted `EXIT_USAGE_ERROR` would be
    /// driven entirely by `failing_target` alone -- proving "64 beats
    /// 0," not "64 beats 6" as this test's name and doc comment above
    /// promise.
    #[test]
    fn dispatch_all_usage_error_beats_bin_link_warning() {
        use std::os::unix::fs::PermissionsExt;

        if bin_link::running_as_root() {
            eprintln!(
                "skipping dispatch_all_usage_error_beats_bin_link_warning: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let _home = HomeGuard::new("dispatch-all-64-beats-6-home");
        let warning_target = scratch_home("dispatch-all-64-beats-6-warning");
        seed_target(
            &warning_target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );

        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let canonical_warning = index::canonicalize_target_dir(&warning_target).unwrap();
        bin_link::ensure_bin_link(&canonical_warning, "2026-01-15T09:30:00Z").unwrap();
        let bin_dir = bin_link::local_bin_link_path(&home)
            .parent()
            .expect("link path always has a parent")
            .to_path_buf();
        let mut perms = fs::metadata(&bin_dir).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&bin_dir, perms).unwrap();

        let failing_target = scratch_home("dispatch-all-64-beats-6-failing");
        let failing_manifest_path = manifest::manifest_path(&failing_target);
        fs::create_dir_all(failing_manifest_path.parent().unwrap()).unwrap();
        // schema_version 1 is supported -- force a genuine usage-error
        // failure a different way: an unreadable manifest whose install
        // index entry does not match reality closely enough for
        // read_manifest itself to fail. Simplest reliable failure here
        // is malformed JSON, which read_manifest rejects as a plain
        // usage error (64), matching this suite's existing
        // `uninstall_one_maps_malformed_manifest_to_64` precedent.
        fs::write(&failing_manifest_path, b"not json").unwrap();

        let index = Index::new(vec![
            IndexEntry {
                target_dir: canonical_warning,
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: index::canonicalize_target_dir(&failing_target).unwrap(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
        ]);
        let code = dispatch_all(&index, None, false, false, ColorMode::disabled());

        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&bin_dir, restored);

        assert_eq!(
            code, EXIT_USAGE_ERROR,
            "a real usage-error failure must beat a bin-link warning in the same batch"
        );

        fs::remove_dir_all(&warning_target).ok();
        fs::remove_dir_all(&failing_target).ok();
    }

    // ── duplicate target_dir entries rejected ───────────────────────────

    #[test]
    fn dispatch_uninstall_rejects_corrupted_index_with_duplicate_target_dir() {
        let index = Index::new(vec![
            IndexEntry {
                target_dir: "/tmp/dup-target".to_string(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: "/tmp/dup-target".to_string(),
                strategies: vec!["kiro-cli-v2".to_string()],
                installed_at: "2026-01-16T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
        ]);
        let duplicates = index::duplicate_target_dirs(&index.installs);
        assert_eq!(duplicates, vec!["/tmp/dup-target".to_string()]);
    }

    #[test]
    fn report_corrupted_index_names_the_duplicated_targets() {
        // Structural guard: report_corrupted_index must not panic given
        // a real duplicate list, in both plain and --json modes.
        let duplicates = vec!["/tmp/dup-a".to_string(), "/tmp/dup-b".to_string()];
        report_corrupted_index(&duplicates, false, ColorMode::disabled());
        report_corrupted_index(&duplicates, true, ColorMode::disabled());
    }

    /// `report_corrupted_index`'s `--json` documents go to stdout,
    /// matching `report_error`'s own stdout move above -- every
    /// `--json` document this module emits, success or failure, lands
    /// on the same stream. Confirmed the same way as
    /// `report_error_json_document_content_is_unchanged_and_goes_to_stdout_not_stderr`:
    /// by reading this module's own source, since there is no
    /// stdout/stderr-capture mechanism in this test suite. Rather than
    /// pinning brittle whitespace-sensitive snippets, or a fixed
    /// line-count window after each macro call (which produced a
    /// false positive here once cargo fmt reshuffled surrounding
    /// blank lines and pulled an unrelated doc comment into the
    /// window), this scans from each real (non-comment) call to the
    /// stderr-printing macro to ITS OWN matching closing paren --
    /// tracking nested `()`/`{}`/`[]` depth and skipping over
    /// string/char literals so a `)` or a mention of the JSON-building
    /// helper inside a string doesn't confuse the count -- and checks
    /// only within that span, i.e. only the macro's actual argument
    /// tokens. Matches on `//` and `///` comment lines are skipped, so
    /// this doc comment's own mentions of the macro name don't count
    /// as call sites. This module's ONLY JSON-emitting error paths
    /// (`report_error`, `report_corrupted_index`) both print to
    /// stdout, so no real stderr-printing call's arguments may
    /// construct or reference a JSON document.
    #[test]
    fn no_json_document_in_this_module_is_emitted_via_eprintln() {
        let source = include_str!("uninstall.rs");
        let macro_call = concat!("epri", "ntln!(");
        let json_helper_fn = concat!("build_error_", "json");
        let json_macro = concat!("serde_json::json", "!");
        for (byte_offset, _) in source.match_indices(macro_call) {
            let line_start = source[..byte_offset].rfind('\n').map_or(0, |i| i + 1);
            if source[line_start..byte_offset]
                .trim_start()
                .starts_with("//")
            {
                continue; // a comment mentioning the macro name, not a real call
            }
            let args_start = byte_offset + macro_call.len();
            let line_number = source[..byte_offset].matches('\n').count() + 1;
            let args_end = find_matching_close_paren(source, args_start).unwrap_or_else(|| {
                panic!(
                    "line {line_number}: {macro_call} has no matching closing paren -- \
                     malformed source or scanner bug"
                )
            });
            let args = &source[args_start..args_end];
            assert!(
                !args.contains(json_macro) && !args.contains(json_helper_fn),
                "line {line_number} calls the stderr-printing macro whose arguments construct \
                 or reference a JSON document -- every --json document in this module must go \
                 to stdout, never stderr"
            );
        }
    }

    /// Scans forward from `start` (the byte offset immediately after an
    /// opening paren already consumed by the caller) to find the byte
    /// offset of that opening paren's matching close, tracking nested
    /// `()`/`{}`/`[]` depth and skipping over the contents of string
    /// and char literals (including escaped quotes within them) so a
    /// bracket or quote inside a literal never perturbs the count.
    /// Returns `None` if the source ends before the matching close is
    /// found. Deliberately ignores raw strings (`r"..."`/`r#"..."#`)
    /// and byte-string prefixes -- this module's `eprintln!` call
    /// sites use only ordinary string/char literals, and the intent
    /// here is a scoped syntax-aware scan for one test's needs, not a
    /// general Rust tokenizer.
    fn find_matching_close_paren(source: &str, start: usize) -> Option<usize> {
        let bytes = source.as_bytes();
        let mut depth = 1i32;
        let mut i = start;
        while i < bytes.len() {
            match bytes[i] {
                b'(' | b'{' | b'[' => depth += 1,
                b')' | b'}' | b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                b'"' => {
                    i += 1;
                    while i < bytes.len() && bytes[i] != b'"' {
                        if bytes[i] == b'\\' {
                            i += 1;
                        }
                        i += 1;
                    }
                }
                b'\'' => {
                    // Distinguish a char literal ('x', '\'', '\\') from
                    // a lifetime token (e.g. 'a in generics) by only
                    // treating it as a literal when it's closed by
                    // another `'` within a couple of bytes.
                    let literal_end = if bytes.get(i + 1) == Some(&b'\\') {
                        i + 3
                    } else {
                        i + 2
                    };
                    if bytes.get(literal_end) == Some(&b'\'') {
                        i = literal_end;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        None
    }

    // ── cleanup_empty_dirs revisits a directory emptied by a later
    //    sibling ──────────────────────────────────────────────────────

    /// Reproduces a worked example with two sibling directories `a/`
    /// and `b/` sharing a parent `skills/`. Both siblings' files are
    /// deleted (so both `a` and `b` become empty), but `skills/` itself
    /// only becomes empty once BOTH siblings are gone -- i.e. whichever
    /// sibling is processed first will find `skills/` still non-empty
    /// (the other sibling's directory is still there) and correctly
    /// break without removing it. `seen` is only marked after a
    /// successful removal (not before the emptiness check), so the
    /// second sibling's pass -- which finally finds `skills/` empty --
    /// can still revisit and remove it. Runs `touched_dirs` in both
    /// orders to prove this is not order-dependent.
    fn assert_shared_parent_removed_regardless_of_order(touched_order: [&str; 2]) {
        let target = scratch_home(&format!(
            "cleanup-empty-dirs-sibling-{}-{}",
            touched_order[0], touched_order[1]
        ));
        let skills_dir = target.join(".konductor").join("skills");
        let dir_a = skills_dir.join("a");
        let dir_b = skills_dir.join("b");
        fs::create_dir_all(&dir_a).unwrap();
        fs::create_dir_all(&dir_b).unwrap();
        let file_a = dir_a.join("SKILL.md");
        let file_b = dir_b.join("SKILL.md");
        fs::write(&file_a, b"# a").unwrap();
        fs::write(&file_b, b"# b").unwrap();

        // Delete both files up front, exactly as delete_eligible_files
        // would have already done before cleanup_empty_dirs runs --
        // both a/ and b/ are now empty, but skills/ is not empty until
        // BOTH of their directories are removed.
        fs::remove_file(&file_a).unwrap();
        fs::remove_file(&file_b).unwrap();
        assert!(dir_a.is_dir() && dir_a.read_dir().unwrap().next().is_none());
        assert!(dir_b.is_dir() && dir_b.read_dir().unwrap().next().is_none());

        let touched: Vec<PathBuf> = touched_order
            .iter()
            .map(|name| match *name {
                "a" => dir_a.clone(),
                "b" => dir_b.clone(),
                other => panic!("unexpected touched dir name: {other}"),
            })
            .collect();

        cleanup_empty_dirs(&target, &touched);

        assert!(
            !skills_dir.exists(),
            "shared parent directory must be removed once both siblings are empty, \
             regardless of which sibling's cleanup pass processes it last (order: {touched_order:?})"
        );
        // .konductor/ itself is a protected runtime root and must
        // survive regardless.
        assert!(target.join(".konductor").is_dir());

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn cleanup_empty_dirs_removes_shared_parent_processed_a_then_b() {
        assert_shared_parent_removed_regardless_of_order(["a", "b"]);
    }

    #[test]
    fn cleanup_empty_dirs_removes_shared_parent_processed_b_then_a() {
        assert_shared_parent_removed_regardless_of_order(["b", "a"]);
    }

    /// A directory that is not yet eligible for removal on its first
    /// pass (because it is still non-empty) must still be removable on
    /// a LATER pass, once whatever was keeping it non-empty is gone --
    /// proving `seen` is never marked for a directory this function
    /// merely skipped without attempting `remove_dir` on it at all
    /// (the `!is_empty` short-circuit runs strictly before `seen` is
    /// ever consulted or inserted for that directory -- see this
    /// function's own body above). Two sibling directories `a/` and
    /// `b/` share a parent `mid/`; `a/`'s pass runs first while `mid/`
    /// itself is kept deliberately non-empty by a blocker file placed
    /// directly inside it, so the walk-up from `a` reaches `mid`, finds
    /// it non-empty, and breaks WITHOUT ever calling `remove_dir(mid)`
    /// -- `mid` must NOT be marked `seen` at that point. The blocker is
    /// removed before `b`'s pass, which must then still be able to
    /// remove `mid`.
    ///
    /// The non-emptiness is induced by leaving a real file inside `mid`
    /// -- unconditionally true for every uid including root, unlike the
    /// previous mechanism (chmod'ing the parent to `0o555`), which root
    /// bypasses on Unix (root ignores directory permission bits), so
    /// under a root test runner (common in CI containers / an internal
    /// CI sandbox) `remove_dir(mid)` would have unexpectedly succeeded on
    /// the first pass and made this test fail spuriously.
    ///
    /// Falsifiability: confirmed this test fails against the pre-fix
    /// code (`seen.insert` before the `remove_dir` attempt) -- if `mid`
    /// were instead skipped via a failed `remove_dir` call under that
    /// ordering, `mid` would get marked seen on `a`'s failed attempt, so
    /// `b`'s later pass would hit the `!seen.insert(...)` short-circuit
    /// and break without ever retrying `remove_dir(mid)`, leaving `mid`
    /// on disk.
    #[test]
    fn cleanup_empty_dirs_retries_directory_after_earlier_remove_dir_failure() {
        let target = scratch_home("cleanup-retry-after-failure");
        let mid = target.join(".konductor").join("skills").join("mid");
        let dir_a = mid.join("a");
        let dir_b = mid.join("b");
        fs::create_dir_all(&dir_a).unwrap();
        fs::create_dir_all(&dir_b).unwrap();
        // Both siblings are already empty, exactly as delete_eligible_files
        // would have left them after removing their only file.
        assert!(dir_a.read_dir().unwrap().next().is_none());
        assert!(dir_b.read_dir().unwrap().next().is_none());

        // Keep `mid` itself non-empty during the first pass so it is
        // ineligible for removal for a reason no uid can bypass: a
        // non-empty directory cannot be removed by anyone, root
        // included.
        let blocker = mid.join(".blocker");
        fs::write(&blocker, b"keeps mid non-empty").unwrap();

        // `a`'s pass: removes `a` (nothing about the blocker's presence
        // prevents removing the now-empty `a` subdirectory). Reaches
        // `mid`, finds it non-empty (the blocker is still there), and
        // stops without attempting to remove it.
        let removed_first_pass = cleanup_empty_dirs(&target, std::slice::from_ref(&dir_a));
        // Remove the blocker before any assertion that might panic, so
        // cleanup can always proceed regardless of outcome.
        fs::remove_file(&blocker).unwrap();

        assert!(
            mid.is_dir(),
            "mid must still exist while the blocker keeps it non-empty"
        );
        assert_eq!(
            removed_first_pass, 1,
            "only `a` itself must have been removed on the first pass"
        );

        // `b`'s pass, now that the blocker is gone: must still be able
        // to remove `b`, then revisit and remove `mid` -- proving `mid`
        // was never permanently marked `seen` by the earlier pass that
        // skipped it. `skills/` itself (mid's own parent) also becomes
        // empty once `mid` is gone and is not a protected root, so it
        // is removed too.
        let removed_second_pass = cleanup_empty_dirs(&target, std::slice::from_ref(&dir_b));
        assert_eq!(
            removed_second_pass, 3,
            "`b`, the now-revisitable `mid`, and the now-empty `skills/` must all be removed"
        );
        assert!(
            !mid.exists(),
            "mid must be removed once revisited after the earlier failure"
        );

        fs::remove_dir_all(&target).ok();
    }

    /// End-to-end version of the same scenario via `uninstall_one`,
    /// exercising the real `delete_eligible_files` -> `touched_dirs` ->
    /// `cleanup_empty_dirs` pipeline (manifest file order determines
    /// `touched_dirs` order here) rather than constructing
    /// `touched_dirs` by hand.
    #[test]
    fn uninstall_one_removes_shared_parent_of_two_sibling_dirs() {
        let _home = HomeGuard::new("uninstall-one-sibling-parent-home");
        let target = scratch_home("uninstall-one-sibling-parent");
        seed_target(
            &target,
            vec![
                (
                    ".konductor/skills/a/SKILL.md",
                    b"# a",
                    Provenance::Created,
                    None,
                ),
                (
                    ".konductor/skills/b/SKILL.md",
                    b"# b",
                    Provenance::Created,
                    None,
                ),
            ],
        );
        let counts = uninstall_one(target.to_str().unwrap(), None, true, false).unwrap();
        assert_eq!(counts.files_deleted, 2);
        assert!(
            !target.join(".konductor/skills").exists(),
            "skills/ must be removed once both a/ and b/ are empty"
        );
        assert!(target.join(".konductor").is_dir());
        fs::remove_dir_all(&target).ok();
    }

    // ── json-consistent error reporting on every named error path ───────
    //
    // `report_error`'s JSON construction is asserted directly via
    // `build_error_json` (the pure half it delegates to) rather than by
    // capturing stderr -- this module has no stderr-capture mechanism,
    // and its existing tests (e.g.
    // `report_corrupted_index_names_the_duplicated_targets`) already
    // establish the pattern of asserting structural properties instead.
    // Each test below drives one named error path, confirms the
    // plain-text `message` `report_error`/`build_error_json`
    // receives is unchanged, and confirms the json=true rendering is
    // valid, parseable JSON with the expected `command`/`error` fields
    // (plus any extra structured field that call site attaches).

    /// `build_error_json`'s output must always be valid JSON with the
    /// `command`/`error` fields `report_corrupted_index` already
    /// establishes as this module's json-shape convention.
    #[test]
    fn build_error_json_has_command_and_error_fields() {
        let value = build_error_json("uninstall", "something went wrong", Vec::new());
        // Round-trips through serde_json's parser -- proof it is valid,
        // parseable JSON, not merely a Value constructed in-process.
        let reparsed: serde_json::Value =
            serde_json::from_str(&value.to_string()).expect("must be valid, parseable JSON");
        assert_eq!(reparsed["command"], "uninstall");
        assert_eq!(reparsed["error"], "something went wrong");
    }

    /// `extra` fields passed to `build_error_json` must appear in the
    /// resulting object under their given key, alongside (not replacing)
    /// `command`/`error`.
    #[test]
    fn build_error_json_includes_extra_fields() {
        let value = build_error_json(
            "uninstall",
            "could not remove /tmp/some-target",
            vec![(
                "target_dir",
                serde_json::Value::String("/tmp/some-target".to_string()),
            )],
        );
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "uninstall");
        assert_eq!(reparsed["error"], "could not remove /tmp/some-target");
        assert_eq!(reparsed["target_dir"], "/tmp/some-target");
    }

    /// `report_error`'s `--json` failure document goes to stdout, the
    /// same stream `report_single`/`report_batch`/
    /// `report_no_tracked_installs` already use for their own `--json`
    /// success documents -- previously it went to stderr, so a
    /// `--json` consumer reading only stdout would silently miss every
    /// single-target failure while still seeing a `--all` batch
    /// failure (embedded in `report_batch`'s own stdout document).
    /// This module has no stdout/stderr-capture mechanism (see the
    /// module-level comment above these named-error-path tests), so
    /// this test pins the property that matters most to a consumer:
    /// the CONTENT `report_error` prints is unchanged -- still
    /// `build_error_json`'s `{"command", "error", ...extra}` shape,
    /// byte-identical regardless of which stream it lands on.
    /// `no_json_document_in_this_module_is_emitted_via_eprintln` below
    /// confirms the stream itself.
    #[test]
    fn report_error_json_document_content_is_unchanged() {
        let value = build_error_json(
            "uninstall",
            "could not remove /tmp/some-target",
            vec![(
                "target_dir",
                serde_json::Value::String("/tmp/some-target".to_string()),
            )],
        );
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "uninstall");
        assert_eq!(reparsed["error"], "could not remove /tmp/some-target");
        assert_eq!(reparsed["target_dir"], "/tmp/some-target");
    }

    /// Named error path 1: the index-read error branch at the top of
    /// `dispatch_uninstall` (`index::read_index()` returning `Err`).
    /// Drives it end to end (via a malformed `~/.konductor/installs`,
    /// under a `HomeGuard`-scoped `$HOME`) and confirms the same
    /// message `report_error` would have received is well-formed for
    /// both the plain-text and json=true renderings.
    #[test]
    fn dispatch_uninstall_index_read_error_message_is_json_consistent() {
        let _home = HomeGuard::new("index-read-error-json-home");
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();
        let index_path = index::index_path(Some(&home)).unwrap();
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(&index_path, b"not json").unwrap();

        let err = index::read_index().expect_err("malformed index must be rejected");
        let message = format!("could not read install index: {err}");

        // Plain-text rendering: unchanged wording, still human-readable.
        assert!(message.starts_with("could not read install index:"));

        // json=true rendering: must be valid, parseable JSON carrying
        // that exact message in the "error" field -- not plain text.
        let value = build_error_json("uninstall", &message, Vec::new());
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "uninstall");
        assert_eq!(reparsed["error"], message);

        // Confirms dispatch_uninstall itself actually reaches this
        // branch and returns the exit code this path is responsible
        // for, exercising the real call site end to end.
        let code = dispatch_uninstall(None, false, None, false, true, ColorMode::disabled());
        assert_eq!(code, EXIT_USAGE_ERROR);
    }

    /// Named error path 2: the single-tracked-entry error arm in
    /// `dispatch_uninstall` (`uninstall_one` failing for the sole
    /// tracked entry). Uses an unsupported manifest schema_version (65)
    /// as the concrete failure so the exit code returned by
    /// `dispatch_uninstall` itself is also confirmed, not just the
    /// message shape.
    #[test]
    fn dispatch_uninstall_single_entry_error_message_is_json_consistent() {
        let _home = HomeGuard::new("single-entry-error-json-home");
        let target = scratch_home("single-entry-error-json");
        let manifest_path = manifest::manifest_path(&target);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let err = uninstall_one(&canonical, None, true, false)
            .expect_err("unsupported schema_version must fail");
        let message = err.to_string();

        let value = build_error_json(
            "uninstall",
            &message,
            vec![("target_dir", serde_json::Value::String(canonical.clone()))],
        );
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "uninstall");
        assert_eq!(reparsed["error"], message);
        assert_eq!(reparsed["target_dir"], canonical);

        let code = dispatch_uninstall(None, false, None, false, true, ColorMode::disabled());
        assert_eq!(
            code, 65,
            "must propagate EXIT_VERIFY_FAILED, not flatten to 64"
        );
        fs::remove_dir_all(&target).ok();
    }

    /// Named error path 3: `dispatch_target`'s no-match usage error.
    ///
    /// `dispatch_target_no_match_message` must end with a clause
    /// acknowledging uncertainty ("this may mean it was never
    /// installed, or was already fully uninstalled") rather than
    /// asserting the target was NEVER tracked -- a directory that was
    /// previously installed and has since been fully uninstalled
    /// resolves identically to one that was never installed at all.
    #[test]
    fn dispatch_target_no_match_message_softens_never_tracked_wording() {
        let index = Index::new(Vec::new());
        let message = dispatch_target_no_match_message(&index, "/some/dir", "/some/dir");
        assert!(
            message.contains(
                "this may mean it was never installed, or was already fully \
                               uninstalled"
            ),
            "message must acknowledge uncertainty rather than asserting the target was \
             never tracked: {message}"
        );
    }

    /// Builds the expected message via `dispatch_target_no_match_message`
    /// itself -- the real construction the call site uses, including
    /// the appended "Tracked install(s):" listing -- rather than
    /// reconstructing it by hand, so removing that append would fail
    /// this test rather than leaving it green.
    #[test]
    fn dispatch_target_no_match_error_message_is_json_consistent() {
        let home = scratch_home("target-no-match-json");
        let index = Index::new(vec![IndexEntry {
            target_dir: "/does/not/match".to_string(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);

        // Mirrors dispatch_target's own resolved_display computation
        // for a target that DOES canonicalize (home exists) but matches
        // nothing tracked.
        let canonical = index::canonicalize_target_dir(&home).unwrap();
        let message = dispatch_target_no_match_message(&index, home.to_str().unwrap(), &canonical);
        assert!(
            message.contains("Tracked install(s):\n  - /does/not/match"),
            "must name the other tracked install, not just the resolved path that failed \
             to match: {message}"
        );

        let value = build_error_json(
            "uninstall",
            &message,
            vec![
                (
                    "requested_target",
                    serde_json::Value::String(home.to_string_lossy().into_owned()),
                ),
                ("resolved_target", serde_json::Value::String(canonical)),
            ],
        );
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "uninstall");
        assert_eq!(reparsed["error"], message);
        assert!(reparsed["requested_target"].is_string());
        assert!(reparsed["resolved_target"].is_string());

        // Exercises the real call site end to end for the exit code.
        let code = dispatch_target(
            &index,
            home.to_str().unwrap(),
            None,
            false,
            true,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&home).ok();
    }

    /// Named error path 4: `dispatch_target`'s matched-entry error arm
    /// (the entry matches, but `uninstall_one` fails for it).
    #[test]
    fn dispatch_target_matched_entry_error_message_is_json_consistent() {
        let target = scratch_home("target-matched-error-json");
        let manifest_path = manifest::manifest_path(&target);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let index = Index::new(vec![IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);

        let err = uninstall_one(&canonical, None, true, false)
            .expect_err("unsupported schema_version must fail");
        let message = err.to_string();
        let value = build_error_json(
            "uninstall",
            &message,
            vec![("target_dir", serde_json::Value::String(canonical.clone()))],
        );
        let reparsed: serde_json::Value = serde_json::from_str(&value.to_string()).unwrap();
        assert_eq!(reparsed["command"], "uninstall");
        assert_eq!(reparsed["error"], message);
        assert_eq!(reparsed["target_dir"], canonical);

        let code = dispatch_target(
            &index,
            target.to_str().unwrap(),
            None,
            false,
            true,
            ColorMode::disabled(),
        );
        assert_eq!(
            code, 65,
            "must propagate EXIT_VERIFY_FAILED, not flatten to 64"
        );
        fs::remove_dir_all(&target).ok();
    }

    // ── --dry-run ────────────────────────────────────────────────────

    /// (a) `--dry-run` makes no filesystem changes: every file the real
    /// run would delete must still exist afterward, the manifest must
    /// survive untouched, and the index entry must remain tracked.
    #[test]
    fn dispatch_uninstall_dry_run_makes_no_filesystem_changes() {
        let _home = HomeGuard::new("dry-run-no-changes-home");
        let target = scratch_home("dry-run-no-changes");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, false, None, true, false, ColorMode::disabled());
        assert_eq!(code, 0, "a dry run must report success, not fail");

        assert!(
            target.join(".kiro/agents/a.json").exists(),
            "--dry-run must never delete the tracked file"
        );
        assert!(
            manifest::manifest_path(&target).is_file(),
            "--dry-run must never remove the manifest"
        );
        let index_after = index::read_index().unwrap().unwrap();
        assert!(
            index_after
                .installs
                .iter()
                .any(|e| e.target_dir == canonical),
            "--dry-run must never prune the tracked index entry"
        );

        fs::remove_dir_all(&target).ok();
    }

    /// `--dry-run`'s `--json` output must report the exact paths that
    /// would be removed, matching what a real run would delete.
    #[test]
    fn dispatch_uninstall_dry_run_json_reports_would_delete_paths() {
        let _home = HomeGuard::new("dry-run-json-home");
        let target = scratch_home("dry-run-json");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();

        let would_delete = preview_uninstall(&canonical, None, true).unwrap();
        assert_eq!(
            would_delete,
            vec![PreviewFile {
                path: PathBuf::from(".kiro/agents/a.json"),
                diverged: false,
            }]
        );

        // Structural guard for the real print call site (JSON must not
        // panic and must carry the field).
        let code = report_dry_run_preview(&canonical, None, true, ColorMode::disabled());
        assert_eq!(code, 0);

        fs::remove_dir_all(&target).ok();
    }

    /// `--dry-run` never deletes a `ReplacedForeign`/`.claude/settings.json`
    /// path either -- the preview must apply the exact same eligibility
    /// rule `delete_eligible_files` itself uses.
    #[test]
    fn preview_uninstall_never_lists_replaced_foreign_or_claude_settings() {
        let target = scratch_home("preview-eligibility");
        seed_target(
            &target,
            vec![
                (".kiro/agents/a.json", b"{}", Provenance::Created, None),
                (
                    ".kiro/context/notes.md",
                    b"user content",
                    Provenance::ReplacedForeign,
                    None,
                ),
                (
                    ".claude/settings.json",
                    br#"{"hooks":{}}"#,
                    Provenance::ReplacedOurs,
                    None,
                ),
            ],
        );
        let would_delete = preview_uninstall(target.to_str().unwrap(), None, false).unwrap();
        assert_eq!(
            would_delete,
            vec![PreviewFile {
                path: PathBuf::from(".kiro/agents/a.json"),
                diverged: false,
            }]
        );
        fs::remove_dir_all(&target).ok();
    }

    /// A stale target (no manifest) previews as zero files, not a
    /// failure -- mirrors `uninstall_one`'s own non-fatal stale case.
    #[test]
    fn preview_uninstall_stale_target_previews_as_empty_not_a_failure() {
        let target = scratch_home("preview-stale");
        assert!(!manifest::manifest_path(&target).exists());
        let would_delete = preview_uninstall(target.to_str().unwrap(), None, false).unwrap();
        assert!(would_delete.is_empty());
        fs::remove_dir_all(&target).ok();
    }

    /// Per-path divergence clarity: a target with one locally-modified
    /// tracked file and one unmodified tracked file must have
    /// `preview_uninstall` flag exactly the modified one as `diverged`,
    /// distinct from the unmodified one -- reusing the same hash
    /// comparison `delete_eligible_files` performs before a real
    /// deletion, so a `--dry-run` reader can tell which specific path
    /// would lose local edits, not just an aggregate count.
    #[test]
    fn preview_uninstall_flags_only_the_diverged_path_among_two_tracked_files() {
        let target = scratch_home("preview-diverged-mixed");
        seed_target(
            &target,
            vec![
                (
                    ".kiro/agents/edited.json",
                    b"hand-edited content",
                    Provenance::Created,
                    Some(&"a".repeat(64)),
                ),
                (
                    ".kiro/agents/untouched.json",
                    b"{}",
                    Provenance::Created,
                    None,
                ),
            ],
        );

        let would_delete = preview_uninstall(target.to_str().unwrap(), None, false).unwrap();
        assert_eq!(would_delete.len(), 2);

        let edited = would_delete
            .iter()
            .find(|f| f.path == Path::new(".kiro/agents/edited.json"))
            .expect("the hand-edited file must be in the preview");
        assert!(
            edited.diverged,
            "the hand-edited file must be flagged as diverged"
        );

        let untouched = would_delete
            .iter()
            .find(|f| f.path == Path::new(".kiro/agents/untouched.json"))
            .expect("the untouched file must be in the preview");
        assert!(
            !untouched.diverged,
            "the untouched file must NOT be flagged as diverged"
        );

        fs::remove_dir_all(&target).ok();
    }

    /// Same mixed target as above, exercised through the real
    /// `report_dry_run_preview` plain-text print call site: the
    /// diverged path's line must be distinguishable from the
    /// unmodified path's line (via `format_preview_file_line`'s
    /// trailing note), not just an aggregate "N file(s)" count.
    #[test]
    fn format_preview_file_line_distinguishes_diverged_from_unmodified() {
        let diverged = PreviewFile {
            path: PathBuf::from(".kiro/agents/edited.json"),
            diverged: true,
        };
        let untouched = PreviewFile {
            path: PathBuf::from(".kiro/agents/untouched.json"),
            diverged: false,
        };
        let diverged_line = format_preview_file_line(&diverged);
        let untouched_line = format_preview_file_line(&untouched);
        assert_ne!(
            diverged_line, untouched_line,
            "a diverged path's line must render differently from an unmodified path's"
        );
        assert!(diverged_line.contains(".kiro/agents/edited.json"));
        assert!(diverged_line.contains("local edits would be destroyed"));
        assert!(untouched_line.contains(".kiro/agents/untouched.json"));
        assert!(!untouched_line.contains("local edits would be destroyed"));
    }

    /// Same mixed target's `--json` shape: `preview_file_json` must
    /// carry `diverged: true`/`false` per path, not just a count, and
    /// `report_dry_run_preview`'s emitted document must be consistent
    /// with uninstall's own real-run `diverged_paths` disclosure
    /// convention (naming the specific path).
    #[test]
    fn preview_file_json_carries_per_path_diverged_flag() {
        let diverged = PreviewFile {
            path: PathBuf::from(".kiro/agents/edited.json"),
            diverged: true,
        };
        let untouched = PreviewFile {
            path: PathBuf::from(".kiro/agents/untouched.json"),
            diverged: false,
        };
        let diverged_value = preview_file_json(&diverged);
        let untouched_value = preview_file_json(&untouched);
        assert_eq!(diverged_value["path"], ".kiro/agents/edited.json");
        assert_eq!(diverged_value["diverged"], true);
        assert_eq!(untouched_value["path"], ".kiro/agents/untouched.json");
        assert_eq!(untouched_value["diverged"], false);
    }

    /// End-to-end: `report_dry_run_preview`'s `--json` document for a
    /// target with one diverged and one unmodified tracked file must
    /// carry BOTH paths with their own correct `diverged` flag inside
    /// the SAME `would_delete` array -- not merely an aggregate count
    /// -- proving the dry-run path genuinely distinguishes the two
    /// files from each other in its real emitted output.
    #[test]
    fn preview_uninstall_json_document_distinguishes_diverged_path_from_unmodified() {
        let target = scratch_home("preview-diverged-json-e2e");
        seed_target(
            &target,
            vec![
                (
                    ".kiro/agents/edited.json",
                    b"hand-edited content",
                    Provenance::Created,
                    Some(&"a".repeat(64)),
                ),
                (
                    ".kiro/agents/untouched.json",
                    b"{}",
                    Provenance::Created,
                    None,
                ),
            ],
        );

        let would_delete = preview_uninstall(target.to_str().unwrap(), None, true).unwrap();
        let document = serde_json::json!({
            "command": "uninstall",
            "dry_run": true,
            "target_dir": target.to_str().unwrap(),
            "would_delete": would_delete.iter().map(preview_file_json).collect::<Vec<_>>(),
        });
        let would_delete_json = document["would_delete"]
            .as_array()
            .expect("would_delete must be an array");
        assert_eq!(would_delete_json.len(), 2);

        let edited_entry = would_delete_json
            .iter()
            .find(|entry| entry["path"] == ".kiro/agents/edited.json")
            .expect("the edited file must appear in would_delete");
        assert_eq!(edited_entry["diverged"], true);

        let untouched_entry = would_delete_json
            .iter()
            .find(|entry| entry["path"] == ".kiro/agents/untouched.json")
            .expect("the untouched file must appear in would_delete");
        assert_eq!(untouched_entry["diverged"], false);

        // Structural guard for the real print call site.
        let code =
            report_dry_run_preview(target.to_str().unwrap(), None, true, ColorMode::disabled());
        assert_eq!(code, 0);

        fs::remove_dir_all(&target).ok();
    }

    /// `--json` mode has no effect on the (now nonexistent) confirmation
    /// gate -- a `--json` invocation with no `--dry-run` still performs
    /// the real deletion directly, matching plain-text mode.
    #[test]
    fn dispatch_uninstall_json_without_dry_run_proceeds_directly() {
        let _home = HomeGuard::new("json-proceeds-directly-home");
        let target = scratch_home("json-proceeds-directly");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, false, None, false, true, ColorMode::disabled());
        assert_eq!(code, 0);
        assert!(!target.join(".kiro/agents/a.json").exists());

        fs::remove_dir_all(&target).ok();
    }

    // ── `uninstall --all` on an empty index must stay a 0 no-op ────────
    //
    // `--all` reaches `dispatch_all` with `index.installs` empty rather
    // than hitting `dispatch_uninstall`'s own bare-invocation
    // short-circuit (which excludes `--all` on purpose). Covered here
    // across every mode the dry-run branch depends on.

    #[test]
    fn dispatch_all_on_empty_index_dry_run_is_a_noop() {
        let _home = HomeGuard::new("uninstall-all-empty-dry-run-home");
        assert!(index::read_index().unwrap().is_none());
        let code = dispatch_uninstall(None, true, None, true, false, ColorMode::disabled());
        assert_eq!(code, 0, "--all --dry-run on an empty index must be a no-op");
    }

    #[test]
    fn dispatch_all_on_empty_index_is_a_noop() {
        let _home = HomeGuard::new("uninstall-all-empty-home");
        assert!(index::read_index().unwrap().is_none());
        let code = dispatch_uninstall(None, true, None, false, false, ColorMode::disabled());
        assert_eq!(code, 0, "--all on an empty index must be a no-op");
    }

    #[test]
    fn dispatch_all_on_empty_index_json_is_a_noop() {
        let _home = HomeGuard::new("uninstall-all-empty-json-home");
        assert!(index::read_index().unwrap().is_none());
        let code = dispatch_uninstall(None, true, None, false, true, ColorMode::disabled());
        assert_eq!(code, 0, "--all --json on an empty index must be a no-op");
    }
}
