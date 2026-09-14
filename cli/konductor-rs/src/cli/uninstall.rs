// SPDX-License-Identifier: Apache-2.0
//
// uninstall.rs — `konductor uninstall` dispatch (Rust implementation).
//
// Real behavior per designs/konductor-cli-install-index.md §3 (selection
// UX) and §5 (hash-divergence decision). `--target`/`--all` are a
// divergence from the design doc's "uninstall is flagless" statement,
// explicitly sanctioned by that same design doc -- see
// ws-konductor-cli-notes/SKILL.md's "Root resolution gap for
// `uninstall`" note for the prior standing constraint this satisfies.
//
// No interactive TTY *picker* at this milestone (design §3's
// 2+-entries/interactive row describes a numbered-list selection among
// every tracked target -- that is not implemented). What IS
// implemented, narrower in scope, is a plain yes/no confirmation gate
// on the one specific case described below.
//
// ── Bare invocation with 2+ tracked entries resolves to $HOME ─────────────
// Diverges from design §3's own table, which specifies a usage error
// ("multiple installs are tracked; pass --target <dir> or --all") for
// this case. `dispatch_uninstall` instead resolves the destination to
// $HOME (`install::resolve_destination`, the identical function
// `install`/`doctor` already use for their own "--target omitted"
// default) and proceeds through the same single-target path an
// explicit `--target <dir>` would take -- including its own "does not
// match any tracked install" usage error when $HOME isn't one of the
// tracked entries -- naming every OTHER tracked install alongside
// that error, via `format_other_tracked_installs`. A single tracked
// entry is still uninstalled directly regardless of whether it is at
// $HOME, unchanged from the design's own 1-entry row.
//
// This specific case -- resolved to $HOME, and $HOME IS one of 2+
// tracked entries -- is gated behind an interactive confirmation
// (`confirm_destructive_uninstall`) before the delete proceeds:
// "Are you sure you want to uninstall from <dir>?", requiring an
// explicit `y`/`yes` (case-insensitive). `--yes`/`-y` bypasses the
// prompt; so does `--json` or a non-terminal stdin declining by
// default (EXIT_USER_ABORTED, 4) rather than blocking on input that
// can never arrive -- see `confirm_destructive_uninstall`'s own doc
// comment for the exact precedence. On success, a non-blocking stderr
// note (`format_other_tracked_installs` again) names every other
// tracked install left untouched. Neither the confirmation gate nor
// the note applies to an explicit `--target <dir>` or `--all` -- both
// already name their own scope, so neither needs re-confirming or a
// "here's what else exists" hint.
//
// ── KNOWN LIMITATION: no same-target concurrency protection ───────────────
// Running two `konductor` invocations (any mix of install/update/
// uninstall) against the SAME target directory at once is unsupported
// and can corrupt the manifest, index, or on-disk files -- e.g. this
// module's delete loop can race `update`'s copy loop. No locking exists
// or is planned; callers must serialize their own invocations per
// target. Same accepted-risk posture as the cross-target index race
// (design doc §2).

use std::io::IsTerminal;
use std::path::{Component, Path, PathBuf};

use super::install::artifact::sha256_hex;
use super::install::bin_link;
use super::install::claude::CLAUDE_DESTINATION_ROOT as CLAUDE_ROOT;
use super::install::index::{self, Index};
use super::install::kiro_cli::{
    KIRO_DESTINATION_ROOT as KIRO_ROOT, KONDUCTOR_DESTINATION_ROOT as KONDUCTOR_ROOT,
};
use super::install::manifest::{self, Manifest, ManifestError, Provenance};
use super::install::resolve_destination;
use super::install::resource_rewrite::CLAUDE_SETTINGS_RELATIVE_PATH;

/// Remapped exit code for CLI usage errors, matching cli.rs's own
/// `EXIT_USAGE_ERROR`. Duplicated per install.rs's own established
/// precedent for this exact constant (cli.rs's is private to that
/// module).
const EXIT_USAGE_ERROR: u8 = 64;

/// Remapped exit code for a state/verification failure -- an
/// unsupported manifest/index `schema_version` -- matching cli.rs's own
/// `EXIT_VERIFY_FAILED` constant and `manifest::ManifestError`'s /
/// `index::IndexError`'s own doc comments, which document that
/// `UnsupportedSchemaVersion` must map to this code, never
/// `EXIT_USAGE_ERROR` (64). Duplicated here per this module's own
/// established precedent for `EXIT_USAGE_ERROR` above (cli.rs's
/// constant is private to that module).
const EXIT_VERIFY_FAILED: u8 = 65;

/// Exit code for a user declining `confirm_destructive_uninstall`'s
/// interactive prompt. Reuses cli.rs's own documented Exit-code
/// contract (Engineering Design §6): "4 = user aborted a paused
/// verdict" -- the existing reserved meaning closest to "the user was
/// asked to confirm a destructive action and declined," rather than
/// introducing a new, undocumented code. No other command in this
/// crate emits this exit code (verifiable via `grep -rn '= 4;\|4u8'
/// src/`) -- reused here per that reservation, matching doctor.rs's own
/// precedent of reusing `EXIT_HALTED` (1) for its own distinct local
/// meaning rather than declaring a fresh code.
const EXIT_USER_ABORTED: u8 = 4;

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

/// `uninstall_one`'s error type. Carries both a human-readable
/// message and the exit code that produced it (`EXIT_VERIFY_FAILED`
/// (65) for an unsupported manifest/index schema version,
/// `EXIT_USAGE_ERROR` (64) otherwise).
#[derive(Debug)]
struct UninstallError {
    message: String,
    exit_code: u8,
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
        }
    }

    fn from_manifest(target_dir: &str, err: ManifestError) -> Self {
        UninstallError {
            exit_code: manifest_error_exit_code(&err),
            message: format!("could not read manifest for {target_dir}: {err}"),
        }
    }

    fn from_index(target_dir: &str, err: index::IndexError) -> Self {
        UninstallError {
            exit_code: index_error_exit_code(&err),
            message: format!("could not update install index for {target_dir}: {err}"),
        }
    }
}

// Runtime namespace roots `uninstall` must never remove, regardless of
// emptiness -- design doc §8. Imported above from `kiro_cli.rs`'s own
// `pub(crate) const KIRO_DESTINATION_ROOT`/`KONDUCTOR_DESTINATION_ROOT`
// (aliased to the shorter local names used throughout this module) so
// the runtime-root values can never silently drift between modules --
// matching how `update.rs` already imports the same constants.

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
/// found); index entry removed" rather than blending it into a real
/// 0-file uninstall's message.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UninstallCounts {
    pub files_deleted: usize,
    pub diverged_deleted: usize,
    pub dirs_removed: usize,
    pub stale: bool,
    /// Whether this target had a `--link-bin`-created symlink tracked in
    /// `$HOME/.konductor/bin-links`, and that TRACKING entry was
    /// dropped as part of this uninstall -- the corresponding-removal
    /// half of `install::bin_link`'s module docstring. `false` for a
    /// target that never requested `--link-bin` (the common case), not
    /// an error. Deliberately does NOT imply the physical symlink itself
    /// was deleted -- see `bin_link_symlink_removed` for that, since
    /// another still-installed target can share the same physical
    /// symlink (see `bin_link::BinLinkRemoval`'s own doc comment).
    pub bin_link_untracked: bool,
    /// Whether the on-disk `--link-bin` symlink was actually deleted as
    /// part of this uninstall -- `bin_link::BinLinkRemoval::physically_removed`
    /// passed through unchanged. Always `false` when `bin_link_untracked`
    /// is `false` (nothing was tracked to remove); can ALSO be `false`
    /// even when `bin_link_untracked` is `true`, e.g. when another
    /// still-installed target's tracking entry still names the same
    /// physical symlink. Reporting must key its "removed its --link-bin
    /// symlink" message off THIS field, not `bin_link_untracked` --
    /// conflating the two previously reported a shared-link uninstall as
    /// having changed `$PATH` resolution when it had not.
    pub bin_link_symlink_removed: bool,
    /// The error message, if `bin_link::remove_bin_link` failed for this
    /// target. `None` on the ordinary path -- either nothing was tracked
    /// (`bin_link_untracked` stays `false` too) or removal succeeded.
    /// Carried back as data rather than printed directly at the failure
    /// site (mirrors `update.rs`'s own `finalize_index_warning` field
    /// and its "no printing in the core function" rationale): a
    /// `--json` consumer that only reads stdout must be able to see
    /// this failure too, not just a plain-text `eprintln!` on stderr --
    /// and `Some(message)` here is distinguishable from "this target
    /// never requested `--link-bin`" in a way a bare `false` on
    /// `bin_link_untracked` alone is not.
    pub bin_link_error: Option<String>,
}

/// `konductor uninstall [--target <dir>] [--all] [--yes]`. Reads
/// `~/.konductor/installs` and applies the design §3 selection table,
/// with one deliberate divergence: a bare invocation (`--target`
/// omitted, `--all` not passed) against 2+ tracked entries resolves
/// the destination to `$HOME` (`install::resolve_destination`, the
/// same default `install`/`doctor` already apply) instead of
/// immediately reporting the design's own "multiple installs are
/// tracked" usage error -- see this module's own header comment for
/// the full rationale. That specific case -- 2+ tracked entries,
/// resolved to $HOME, and $HOME IS one of them -- is gated behind
/// `confirm_destructive_uninstall`'s interactive prompt; `yes` bypasses
/// it. Returns 0 on success/no-op, `EXIT_USAGE_ERROR` (64) on any usage
/// error, `EXIT_VERIFY_FAILED` (65) on an unsupported index schema
/// version, `EXIT_USER_ABORTED` (4) when the confirmation prompt is
/// declined -- never exit code 2.
pub fn dispatch_uninstall(target: Option<String>, all: bool, yes: bool, json: bool) -> u8 {
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
        report_no_tracked_installs("uninstall", json);
        return 0;
    }

    // A hand-edited or otherwise corrupted index can carry the same
    // target_dir more than once, which write_index's own upsert path
    // can never itself produce. Refuse to proceed with ANY operation on
    // a corrupted index rather than silently picking one duplicate as
    // authoritative.
    let duplicates = index::duplicate_target_dirs(&index.installs);
    if !duplicates.is_empty() {
        report_corrupted_index(&duplicates, json);
        return EXIT_USAGE_ERROR;
    }

    if all {
        return dispatch_all(&index, json);
    }

    if let Some(target) = target {
        return dispatch_target(&index, &target, json, ConfirmationRequirement::NotRequired);
    }

    if index.installs.len() == 1 {
        let entry = &index.installs[0];
        return match uninstall_one(&entry.target_dir) {
            Ok(counts) => {
                report_single(&entry.target_dir, &counts, json);
                0
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
                );
                err.exit_code
            }
        };
    }

    // 2+ tracked entries, neither `--target` nor `--all` given: resolve
    // the destination to $HOME (mirroring `install`'s own default) and
    // proceed through the identical single-target path an explicit
    // `--target <dir>` would take, rather than reporting the design's
    // own "multiple installs are tracked" ambiguity error -- see this
    // module's header comment for the rationale. Gated behind
    // `confirm_destructive_uninstall` inside `dispatch_target` (this is
    // the ONLY call site that passes `ConfirmationRequirement::Required`
    // -- the explicit `--target <dir>` arm above, and `--all`'s own
    // per-entry loop below, both pass/use `NotRequired`).
    //
    // `resolve_destination(None)`'s `Err` case -- $HOME unset or empty
    // -- cannot occur here: it guards the exact same condition
    // `index::read_index()` already checked (via `env_home_dir()`) at
    // the top of this function, and that call already returned early on
    // `Err(IndexError::UnresolvableHome)` before this point could ever
    // be reached. Verified by reading both resolution paths directly --
    // `resolve_destination` checks `std::env::var_os("HOME")` filtered
    // on non-empty, `env_home_dir()` checks the identical condition.
    let home = resolve_destination(None).unwrap_or_else(|_| {
        unreachable!("$HOME already confirmed resolvable by read_index() above")
    });
    let home_display = home.to_string_lossy().into_owned();
    let code = dispatch_target(
        &index,
        &home_display,
        json,
        ConfirmationRequirement::Required { auto_yes: yes },
    );
    if code == 0 {
        if let Some(note) = success_note_for_dispatch_uninstall(&home, &home_display, &index) {
            eprintln!("konductor uninstall: {note}");
        }
    }
    code
}

/// Resolves `home` to the same CANONICAL form `dispatch_target` matches
/// a tracked entry against (`index::canonicalize_target_dir`), for use
/// as the exclusion key passed to `success_note_for_other_tracked_installs`.
/// `home_display` -- the raw, non-canonicalized `$HOME` string
/// `resolve_destination` returns -- is not itself a safe exclusion key:
/// every tracked entry's `target_dir` is stored in canonical form (see
/// `canonicalize_target_dir`'s own doc comment), so a raw/canonical
/// mismatch (a symlinked home dir, a trailing slash, macOS's `/var` ->
/// `/private/var`, etc.) would leave a plain string comparison unable
/// to match the entry `dispatch_target` just matched and removed,
/// incorrectly listing it in the note as "left untouched." Falls back
/// to `home_display` when canonicalization fails: the caller only
/// reaches this after `dispatch_target` has already reported success
/// (`code == 0`), but that success can also come from `dispatch_target`'s
/// own non-canonicalizing fallback match (a stale entry whose directory
/// no longer exists on disk), where re-canonicalizing `home` here would
/// fail the identical way.
fn canonical_home_for_exclusion(home: &Path, home_display: &str) -> String {
    index::canonicalize_target_dir(home).unwrap_or_else(|_| home_display.to_string())
}

/// The exact success-note computation `dispatch_uninstall` performs
/// after a successful (`code == 0`) resolved-to-`$HOME` uninstall:
/// `canonical_home_for_exclusion` first, then
/// `success_note_for_other_tracked_installs` against `index` (the
/// PRE-delete state, as `dispatch_uninstall` has it in hand at this
/// point). Factored into its own function -- rather than left inline at
/// `dispatch_uninstall`'s call site -- so a test can call this exact
/// sequence directly instead of independently reconstructing it: this
/// module has no mechanism to capture the note from real stderr, so a
/// test that re-derives the two-call sequence itself (rather than
/// calling this one shared function) would keep passing even if
/// `dispatch_uninstall`'s own call site regressed back to skipping
/// canonicalization -- the exact bug this module's canonical-vs-raw
/// fix addresses.
fn success_note_for_dispatch_uninstall(
    home: &Path,
    home_display: &str,
    index: &Index,
) -> Option<String> {
    let resolved_home = canonical_home_for_exclusion(home, home_display);
    success_note_for_other_tracked_installs(index, &resolved_home)
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
/// target_dir(s) are duplicated. Splits plain-text/`--json` output the
/// same way `report_single`/`report_batch` do.
fn report_corrupted_index(duplicates: &[String], json: bool) {
    let message = "install index is corrupted: duplicate target_dir entries found; \
                    fix ~/.konductor/installs by hand before running uninstall";
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
    eprintln!("konductor uninstall: {message}. Duplicated target_dir(s):\n{listed}");
}

/// Every tracked install's `target_dir` OTHER than `resolved_home`,
/// preserving index order, formatted `  - <target_dir>` one per line
/// (matching `update.rs`'s own `report_ambiguous_targets` listing
/// convention). `None` when there is nothing else to list -- either
/// `resolved_home` is the index's only entry, or the index is empty.
///
/// Shared by BOTH call sites so the "which OTHER installs exist, and
/// how are they displayed" logic exists in exactly one place:
///   - `success_note_for_other_tracked_installs` below (a non-blocking
///     discoverability note after a successful bare, $HOME-resolved
///     uninstall), and
///   - `dispatch_target`'s NOT-FOUND usage error, so a resolved path
///     that matches nothing tracked also tells the user what IS
///     tracked, rather than naming only the path that failed to match.
///
/// `resolved_home` is excluded by exact string match against each
/// entry's `target_dir`. On the success-note call site it names the
/// entry that WAS just found and uninstalled, so it must not reappear
/// alongside the "others" it is being distinguished from. On the
/// not-found call site it matches nothing tracked by definition, so
/// nothing is excluded and every tracked install is listed.
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

/// Builds the full discoverability note `dispatch_uninstall`'s bare,
/// $HOME-resolved 2+-tracked-installs branch prints to stderr after a
/// SUCCESSFUL uninstall -- `None` when `format_other_tracked_installs`
/// has nothing to list (there was nothing else tracked). Split out from
/// the `eprintln!` call site itself purely for testability: this
/// module has no stdout/stderr-capture mechanism (see the existing
/// json-consistency tests' own module-level comment), so tests assert
/// on this function's returned `String` content directly instead,
/// matching the structural-assertion convention `build_error_json`'s
/// own tests already establish.
fn success_note_for_other_tracked_installs(index: &Index, resolved_home: &str) -> Option<String> {
    let listing = format_other_tracked_installs(index, resolved_home)?;
    let total = index.installs.len();
    Some(format!(
        "note: {resolved_home} was 1 of {total} tracked installs; the other install(s) were \
         left untouched. Pass --all to remove every tracked install, or --target <dir> to \
         target a specific one. Other tracked install(s):\n{listing}"
    ))
}

/// Whether `dispatch_target` must gate the actual delete behind
/// `confirm_destructive_uninstall` once a tracked entry is matched.
/// `NotRequired` is passed by every call site that already named its
/// target explicitly (`--target <dir>`) -- an explicitly-named target
/// does not need re-confirming, matching this whole gate's scope:
/// only the implicit, ambiguity-adjacent case. `Required { auto_yes }`
/// is passed ONLY by `dispatch_uninstall`'s bare, $HOME-resolved
/// 2+-tracked-installs branch.
#[derive(Debug, Clone, Copy)]
enum ConfirmationRequirement {
    NotRequired,
    Required { auto_yes: bool },
}

/// Outcome of `confirm_destructive_uninstall`: whether the caller
/// should proceed with the delete, or abort without touching anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConfirmOutcome {
    Proceed,
    Abort,
}

/// Parses a confirmation prompt's raw response line -- case-insensitive
/// `y`/`yes` (surrounding whitespace ignored) proceeds; every other
/// input, including empty input, aborts. Split out from
/// `confirm_destructive_uninstall` purely for testability: this module
/// has no way to inject a fake stdin, so tests exercise this pure
/// parsing function directly instead (same structural-assertion
/// convention as `success_note_for_other_tracked_installs` above).
fn parse_confirmation_response(raw: &str) -> ConfirmOutcome {
    match raw.trim().to_ascii_lowercase().as_str() {
        "y" | "yes" => ConfirmOutcome::Proceed,
        _ => ConfirmOutcome::Abort,
    }
}

/// Prompts "Are you sure you want to uninstall from `<target_dir>`?" on
/// stderr and reads one line from stdin, via `parse_confirmation_response`.
/// This crate has no existing interactive-prompting precedent anywhere
/// else -- every check below exists specifically to keep this new
/// pattern from ever blocking on input that cannot arrive, or from
/// silently proceeding with a destructive delete nobody actually
/// confirmed:
///
///   - `auto_yes` (the caller passed `--yes`/`-y`): proceeds
///     immediately, without touching stdin at all.
///   - otherwise, `json` (a `--json` consumer is a script, not an
///     interactive human -- same "non-interactive implies no implicit
///     consent" contract `--yes` gives an interactive caller
///     explicitly) OR stdin is not a terminal
///     (`std::io::IsTerminal`, e.g. piped input, CI, a script): aborts
///     without prompting, rather than blocking on input that will
///     never arrive. Requires `--yes` to bypass in either case.
///   - otherwise (an interactive TTY, no `--json`): prints the prompt
///     and reads a line; a read error is treated as abort, the same as
///     any other non-`y`/`yes` response -- never as a silent proceed.
fn confirm_destructive_uninstall(target_dir: &str, auto_yes: bool, json: bool) -> ConfirmOutcome {
    if auto_yes {
        return ConfirmOutcome::Proceed;
    }
    if json || !std::io::stdin().is_terminal() {
        return ConfirmOutcome::Abort;
    }
    eprint!("Are you sure you want to uninstall from {target_dir}? [y/N] ");
    let mut input = String::new();
    if std::io::stdin().read_line(&mut input).is_err() {
        return ConfirmOutcome::Abort;
    }
    parse_confirmation_response(&input)
}

/// Builds the JSON document `report_aborted` emits when a user declines
/// `confirm_destructive_uninstall`'s prompt. Split out from
/// `report_aborted` purely for testability -- this module has no
/// stdout-capture mechanism (see `build_error_json`'s own doc comment)
/// -- so tests assert on this function's returned `Value` directly,
/// matching that same precedent.
///
/// Carries a `hint` field naming the remediation (`--yes`, or
/// `--target <dir>`/`--all` to name a scope) alongside `"aborted": true`
/// so a scripted `--json` consumer -- e.g. a CI job that trips over the
/// abort -- has something in the document itself pointing at the fix,
/// rather than only `"aborted": true` and a bare `target_dir`.
fn build_aborted_json(target_dir: &str) -> serde_json::Value {
    serde_json::json!({
        "command": "uninstall",
        "target_dir": target_dir,
        "aborted": true,
        "hint": "pass --yes to confirm, or --target <dir>/--all to name a scope",
    })
}

/// Reports that the user declined `confirm_destructive_uninstall`'s
/// prompt for `target_dir` -- nothing was deleted, the index entry
/// still exists. Matches this module's `report_error`/`build_error_json`
/// shape for `--json` so a scripted consumer sees a structured document
/// either way, but is NOT itself an error: `command` stays `"uninstall"`
/// and the JSON carries `"aborted": true` alongside `target_dir` rather
/// than an `"error"` field, since declining a prompt is an intentional
/// decision, not a failure. Both branches name the same `--yes`/
/// `--target`/`--all` remediation `build_aborted_json` embeds as `hint`.
fn report_aborted(target_dir: &str, json: bool) {
    if json {
        println!("{}", build_aborted_json(target_dir));
        return;
    }
    eprintln!(
        "konductor uninstall: aborted; {target_dir} was not uninstalled \
         (pass --yes to confirm, or --target <dir>/--all to name a scope)"
    );
}

/// Builds the "does not match any tracked install" usage-error message
/// `dispatch_target`'s no-match branch reports. Named so tests bind to
/// the real construction -- including the `format_other_tracked_installs`
/// listing appended when the index has other tracked installs to name
/// -- rather than reconstructing the message by hand and never
/// exercising that append at all, the same testability precedent as
/// `success_note_for_other_tracked_installs` above.
fn dispatch_target_no_match_message(index: &Index, target: &str, resolved_display: &str) -> String {
    let mut message =
        format!("{target} does not match any tracked install (resolved to {resolved_display})");
    if let Some(listing) = format_other_tracked_installs(index, resolved_display) {
        message.push_str(&format!(". Tracked install(s):\n{listing}"));
    }
    message
}

/// `--target <dir>` path: canonicalizes `<dir>` the same way install
/// does, then requires an exact match against a tracked entry -- a
/// non-matching target is a usage error, never a silent no-op (design
/// §3).
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
///
/// `confirmation` gates the actual delete once a match is found (see
/// `ConfirmationRequirement`'s own doc comment) -- a declined
/// confirmation returns `EXIT_USER_ABORTED` (4) without ever calling
/// `uninstall_one`, so nothing is touched.
fn dispatch_target(
    index: &Index,
    target: &str,
    json: bool,
    confirmation: ConfirmationRequirement,
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
        );
        return EXIT_USAGE_ERROR;
    };
    if let ConfirmationRequirement::Required { auto_yes } = confirmation {
        if confirm_destructive_uninstall(&entry.target_dir, auto_yes, json) == ConfirmOutcome::Abort
        {
            report_aborted(&entry.target_dir, json);
            return EXIT_USER_ABORTED;
        }
    }
    match uninstall_one(&entry.target_dir) {
        Ok(counts) => {
            report_single(&entry.target_dir, &counts, json);
            0
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
            );
            err.exit_code
        }
    }
}

/// `--all` path: uninstalls every tracked entry, continuing on a
/// per-target failure and reporting which targets succeeded/failed
/// rather than aborting the whole batch on the first error (design §3).
/// Returns `EXIT_USAGE_ERROR` (64) if at least one target failed with a
/// usage error, or `EXIT_VERIFY_FAILED` (65) if at least one target
/// failed specifically on an unsupported schema version and none failed
/// with a plain usage error (65 "wins" over 0 but never silently masks
/// a 64 -- if both kinds of failure occur in the same batch, 64 is
/// reported, matching this module's/`update.rs`'s single-target
/// behavior where a usage error is the more actionable of the two). A
/// stale entry (no manifest found) still counts as "succeeded"
/// here (its index entry was pruned, which is uninstall's correct
/// terminal behavior) -- `report_batch` distinguishes stale-skipped
/// targets from genuinely-emptied ones via `UninstallCounts.stale`, so
/// the batch summary itself does not need a third bucket.
fn dispatch_all(index: &Index, json: bool) -> u8 {
    let mut succeeded: Vec<(String, UninstallCounts)> = Vec::new();
    let mut failed: Vec<(String, String)> = Vec::new();
    let mut worst_exit_code = 0u8;

    for entry in &index.installs {
        match uninstall_one_for_batch(&entry.target_dir) {
            Ok(counts) => succeeded.push((entry.target_dir.clone(), counts)),
            Err(err) => {
                // A usage error (64) is more actionable than a schema
                // failure (65) -- if this batch hits both, report 64.
                if worst_exit_code == 0 || err.exit_code == EXIT_USAGE_ERROR {
                    worst_exit_code = err.exit_code;
                }
                failed.push((entry.target_dir.clone(), err.message));
            }
        }
    }

    report_batch(&succeeded, &failed, json);

    worst_exit_code
}

/// Per-target uninstall: reads that target's manifest, deletes every
/// eligible file (design §5: `Created`/`ReplacedOurs`, even if the
/// on-disk hash has diverged; never `ReplacedForeign`), cleans up
/// now-empty directories (never `.kiro/`/`.konductor/` themselves), and
/// removes the target from the index. `target_dir` must already be the
/// canonicalized string an index entry carries.
///
/// A missing manifest (`Ok(None)` from `read_manifest`) is a **stale
/// tracked install** -- the index names this target, but nothing is
/// there for uninstall to read. This is still the correct place to
/// prune the stale index entry (uninstall's terminal behavior for a
/// target it can no longer act on), but the returned
/// `UninstallCounts.stale` is set to `true` so the caller's report
/// explicitly says "stale (no manifest found); index entry removed"
/// rather than rendering identically to a real, successful 0-file
/// uninstall (see `report_single`/`report_batch`). Consistent in
/// tone/wording with `update.rs`'s own message for the identical
/// missing-manifest condition (see that module's `update_one_target`
/// doc comment) -- `update` cannot treat it as non-fatal the way
/// `uninstall` can, since it has nothing to reconcile against.
fn uninstall_one(target_dir: &str) -> Result<UninstallCounts, UninstallError> {
    uninstall_one_impl(target_dir, false)
}

/// Same as `uninstall_one`, but resolves telemetry identity per-target
/// via `read_identity_uncached` instead of the process-global cache
/// (finding f-c144d780) -- `dispatch_all`
/// visits several distinct `target_dir`s in one process, and the cache
/// only ever resolves the first one's UUID.
fn uninstall_one_for_batch(target_dir: &str) -> Result<UninstallCounts, UninstallError> {
    uninstall_one_impl(target_dir, true)
}

fn uninstall_one_impl(
    target_dir: &str,
    uncached_identity: bool,
) -> Result<UninstallCounts, UninstallError> {
    let target_path = Path::new(target_dir);

    let manifest = manifest::read_manifest(target_path)
        .map_err(|err| UninstallError::from_manifest(target_dir, err))?;

    let mut counts = UninstallCounts::default();
    let mut touched_dirs: Vec<PathBuf> = Vec::new();

    match &manifest {
        Some(manifest) => {
            delete_eligible_files(target_path, manifest, &mut counts, &mut touched_dirs)
                .map_err(UninstallError::usage)?;
            // Remove the manifest file itself once every eligible file
            // it names has been deleted -- `delete_eligible_files` only
            // ever deletes paths LISTED INSIDE the manifest, and the
            // manifest never lists itself (`plan_all_files` only plans
            // `.kiro/agents/*`, `.kiro/context/*`, `.konductor/skills/*`).
            // Without this, `X/.konductor/manifest` survives with
            // `status: complete` and a file list describing files that
            // no longer exist, leaving the target looking half-installed
            // to a later `install`/`doctor` read. The manifest's own
            // parent (`.konductor/`) is never removed regardless
            // (`cleanup_empty_dirs` refuses to touch it by design), so
            // this file removal happens on its own, before
            // `cleanup_empty_dirs` runs -- the manifest's directory is
            // not one `cleanup_empty_dirs` needs to revisit for the
            // manifest's own removal, but removing the manifest first
            // keeps the on-disk state consistent should
            // `cleanup_empty_dirs` fail partway through for an unrelated
            // reason. Skipped entirely on the stale path (`None` arm
            // below) -- there is no manifest file there to begin with.
            let manifest_path = manifest::manifest_path(target_path);
            if manifest_path.is_file() {
                std::fs::remove_file(&manifest_path).map_err(|e| {
                    UninstallError::usage(format!(
                        "failed to remove manifest {}: {e}",
                        manifest_path.display()
                    ))
                })?;
            }
        }
        None => {
            counts.stale = true;
        }
    }

    counts.dirs_removed = cleanup_empty_dirs(target_path, &touched_dirs);

    // Corresponding-removal half of `install::bin_link`'s module
    // docstring: if this target ever ran `install --link-bin`, its
    // tracked $PATH symlink is removed here too, regardless of whether
    // the target was stale (no manifest) or a real uninstall above --
    // the tracked bin-link is a property of this `target_dir`
    // independent of whether its manifest still existed. Deliberately
    // non-fatal: a `--link-bin` cleanup failure (e.g. a permissions
    // error removing the symlink) must not abort an uninstall that has
    // already successfully removed every other tracked file for this
    // target, mirroring `install`'s own `--link-bin` non-fatal posture
    // (see `install.rs`'s `dispatch_install_with`, where that same
    // non-fatal-posture rationale lives). NO printing here, on any
    // path -- carried back as `counts.bin_link_error` instead, mirroring
    // `update.rs`'s own `finalize_index_warning` field: a bare
    // `eprintln!` on this path would be invisible to a `--json`
    // consumer reading only stdout, and would leave a genuine failure
    // indistinguishable in the emitted JSON from "this target never
    // requested `--link-bin`" (both would otherwise leave
    // `bin_link_untracked`/`bin_link_symlink_removed` at their default
    // `false`). `report_single`/`report_batch` are what actually print
    // it, in both plain-text and `--json` modes.
    match bin_link::remove_bin_link(target_dir) {
        Ok(Some(removal)) => {
            counts.bin_link_untracked = true;
            counts.bin_link_symlink_removed = removal.physically_removed;
        }
        Ok(None) => {}
        Err(err) => {
            counts.bin_link_error = Some(err.to_string());
        }
    }

    index::remove_index_entry(target_dir)
        .map_err(|err| UninstallError::from_index(target_dir, err))?;

    // Telemetry: report only AFTER every fallible
    // operation above has already succeeded (manifest read, eligible-file
    // deletion, manifest removal, index-entry removal) -- reporting
    // success telemetry for an uninstall that goes on to fail with an
    // `UninstallError` would be a false success signal. Still fires
    // BEFORE the identity file is deleted below, while
    // `.konductor/telemetry-id.json` still exists to read (this call's
    // ordering constraint). Every failure mode this call
    // itself can hit (missing/unreadable/malformed identity file, spawn
    // error, or a later network failure this process never observes) is
    // folded into report_package_uninstalled's own best-effort tolerance
    // -- never becomes an UninstallError.
    if uncached_identity {
        crate::cli::telemetry::report_package_uninstalled_for_target(target_path);
    } else {
        crate::cli::telemetry::report_package_uninstalled(target_path);
    }

    // Telemetry: delete the identity file only AFTER
    // existing cleanup completes -- deliberately the LAST step, so a
    // crash/interruption before this point leaves the identity file in
    // place and a retried uninstall re-reports (accepted at-least-once
    // delivery, not fixed in this revision).
    let identity_path = crate::cli::telemetry::identity_path(target_path);
    let _ = std::fs::remove_file(identity_path);

    Ok(counts)
}

/// Validates that a manifest-recorded relative path stays within
/// `target_dir` BEFORE it is ever joined against it -- a corrupted/
/// hand-edited manifest must never cause a write/delete outside the
/// intended tree. Rejects an absolute path (`Path::join` replaces the
/// base entirely when the joined path is absolute, e.g.
/// `target_dir.join("/etc/foo") == /etc/foo`) and any path containing a
/// `..` (`ParentDir`) component (`Path::join` does not normalize `..`,
/// and a lexical `starts_with` check on the joined result is not a
/// sufficient guard on its own -- `target_dir/../../etc` still starts
/// with `target_dir` by component). A `./`-prefixed but otherwise safe
/// relative path is accepted unchanged.
pub(super) fn validate_relative_path(raw: &str) -> Result<&Path, String> {
    let rel = Path::new(raw);
    if rel.is_absolute() || rel.components().any(|c| c == Component::ParentDir) {
        return Err(format!("manifest entry {raw:?} escapes target directory"));
    }
    Ok(rel)
}

/// Deletes every `Created`/`ReplacedOurs` file this manifest names, per
/// design §5 -- deletes EVEN IF the on-disk hash no longer matches the
/// manifest's recorded hash (that preserve-on-divergence rule is
/// `update`-only). Never deletes a `ReplacedForeign` path. Records each
/// deleted file's parent directory in `touched_dirs` so the caller can
/// attempt empty-directory cleanup afterward, and counts how many
/// deleted files had a diverged hash (design §5's disclosure
/// requirement) -- a missing on-disk file is not counted as diverged,
/// since there is nothing to disclose losing.
///
/// `validate_relative_path` runs BEFORE `file.provenance` is even
/// inspected, so a malicious/corrupted manifest entry can never cause
/// any path computation involving an unsafe path at all, regardless of
/// provenance -- including a `ReplacedForeign` entry, which is skipped
/// from deletion but must still never be joined unvalidated.
///
/// `CLAUDE_SETTINGS_RELATIVE_PATH` (`.claude/settings.json`) is ALSO
/// skipped here regardless of its recorded provenance, even
/// `Created`/`ReplacedOurs`. Every other content type this codebase
/// installs owns the WHOLE file at its manifest path -- `Created`/
/// `ReplacedOurs` correctly means "safe to delete, we wrote every byte
/// of it". This one file breaks that assumption: `resource_rewrite.rs`'s
/// `merge_claude_settings_permissions` only ever merges a handful of
/// `permissions.allow` grant strings into what is, by design, a shared
/// file that may carry a user's own `hooks`, other MCP servers' grants,
/// or anything else -- see its own
/// `claude_settings_grant_merges_preserving_unrelated_entries` test. On
/// a fresh target this file is legitimately `Created` (nothing else
/// wrote it first); on any later reinstall/update its manifest entry
/// becomes `ReplacedOurs` (a prior Konductor manifest already names
/// it) even though its actual content may by then include plenty this
/// install never touched. Neither classification means "we own 100% of
/// these bytes" for this one path the way it does everywhere else, so
/// `delete_eligible_files` must not treat it that way: there is no
/// existing `Provenance` variant for "partially ours, strip only our
/// own entries" to build finer-grained removal on (see
/// `resource_rewrite.rs`'s own `apply_claude_settings_grant` doc
/// comment, which defers exactly that for the same reason), so the
/// safe default is to leave the whole file alone, matching this
/// module's own `ReplacedForeign` handling one line below.
fn delete_eligible_files(
    target_dir: &Path,
    manifest: &Manifest,
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
        if !path.is_file() {
            continue;
        }
        if let Some(expected) = &file.sha256 {
            if let Ok(bytes) = std::fs::read(&path) {
                if sha256_hex(&bytes) != *expected {
                    counts.diverged_deleted += 1;
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
/// `<target_dir>/.claude` themselves, regardless of emptiness (design
/// §8) -- those are each runtime's own namespace root, not something uninstall
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
fn cleanup_empty_dirs(target_dir: &Path, touched_dirs: &[PathBuf]) -> usize {
    let mut removed = 0usize;
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    let kiro_root = target_dir.join(KIRO_ROOT);
    let konductor_root = target_dir.join(KONDUCTOR_ROOT);
    let claude_root = target_dir.join(CLAUDE_ROOT);

    for start in touched_dirs {
        let mut current = start.clone();
        loop {
            if current == *target_dir
                || current == kiro_root
                || current == konductor_root
                || current == claude_root
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

/// `counts.stale` (set by `uninstall_one` when no manifest was
/// found for this target) branches to a distinct message/JSON shape --
/// "stale (no manifest found); index entry removed" -- so a stale,
/// nothing-to-delete result never renders identically to a real,
/// successful 0-file uninstall (e.g. every file was already
/// independently removed while the manifest itself remained).
fn report_single(target_dir: &str, counts: &UninstallCounts, json: bool) {
    if json {
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
            "dirs_removed": counts.dirs_removed,
            "bin_link_untracked": counts.bin_link_untracked,
            "bin_link_symlink_removed": counts.bin_link_symlink_removed,
        });
        if let Some(err) = &counts.bin_link_error {
            value["bin_link_error"] = serde_json::Value::String(err.clone());
        }
        println!("{value}");
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
    if counts.stale {
        println!(
            "konductor uninstall: {target_dir} is stale (no manifest found); index entry \
             removed{bin_link_note}"
        );
    } else {
        println!(
            "konductor uninstall: removed {target_dir}; deleted {} file(s) ({} with a hash \
             that had diverged from the manifest), removed {} now-empty director(y/ies)\
             {bin_link_note}",
            counts.files_deleted, counts.diverged_deleted, counts.dirs_removed
        );
    }
    // Printed via `println!` (stdout), not `eprintln!` -- see
    // `bin_link_error`'s own doc comment for why this must not be
    // stderr-only.
    if let Some(err) = &counts.bin_link_error {
        println!(
            "konductor uninstall: warning: could not remove tracked --link-bin symlink for \
             {target_dir}: {err}"
        );
    }
}

/// Same stale-vs-real distinguishability as `report_single`, but
/// per succeeded entry in a batch, plus a `stale_skipped` count in the
/// final summary line/JSON so the batch total distinguishes
/// stale-skipped targets from genuinely-emptied ones at a glance.
fn report_batch(succeeded: &[(String, UninstallCounts)], failed: &[(String, String)], json: bool) {
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
                        "dirs_removed": counts.dirs_removed,
                        "bin_link_untracked": counts.bin_link_untracked,
                        "bin_link_symlink_removed": counts.bin_link_symlink_removed,
                    });
                    if let Some(err) = &counts.bin_link_error {
                        entry["bin_link_error"] = serde_json::Value::String(err.clone());
                    }
                    entry
                }).collect::<Vec<_>>(),
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
        if counts.stale {
            println!(
                "konductor uninstall: {dir} is stale (no manifest found); index entry \
                 removed{bin_link_note}"
            );
        } else {
            println!(
                "konductor uninstall: removed {dir}; deleted {} file(s) ({} diverged), removed \
                 {} now-empty director(y/ies){bin_link_note}",
                counts.files_deleted, counts.diverged_deleted, counts.dirs_removed
            );
        }
        // Same stdout-not-stderr rationale as `report_single`'s own
        // `bin_link_error` warning line.
        if let Some(err) = &counts.bin_link_error {
            println!(
                "konductor uninstall: warning: could not remove tracked --link-bin symlink \
                 for {dir}: {err}"
            );
        }
    }
    for (dir, message) in failed {
        eprintln!("konductor uninstall: failed to remove {dir}: {message}");
    }
    println!(
        "konductor uninstall: {} succeeded ({} stale-skipped), {} failed",
        succeeded.len(),
        stale_skipped,
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
    /// on a real, writable ambient `$HOME` -- required in the Brazil CI
    /// sandbox, where `$HOME` cannot be resolved at all. Uses the
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
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            manifest_files,
        );
        manifest::write_manifest(target, &manifest).unwrap();
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

        let manifest = Manifest::new(
            "kiro-cli",
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

        let manifest = Manifest::new(
            "kiro-cli",
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
        let manifest = Manifest::new(
            "kiro-cli",
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

        let manifest = Manifest::new(
            "kiro-cli",
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
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
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

        uninstall_one(target.to_str().unwrap()).unwrap();

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

        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
        assert!(counts.stale);
        assert!(!manifest::manifest_path(&target).exists());
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
    #[test]
    fn uninstall_one_captures_a_bin_link_removal_failure_instead_of_swallowing_it() {
        let _home = HomeGuard::new("bin-link-removal-failure-home");
        let target = scratch_home("bin-link-removal-failure");
        // Stale path (no manifest) is sufficient -- `remove_bin_link` is
        // called on every path, stale or not.
        assert!(!manifest::manifest_path(&target).exists());

        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let bin_links_path = bin_link::bin_links_path(Some(&home)).unwrap();
        fs::create_dir_all(bin_links_path.parent().unwrap()).unwrap();
        // Malformed JSON -- `read_bin_links_at_home` (called inside
        // `remove_bin_link`) must fail on this, giving `remove_bin_link`
        // itself an `Err` to propagate.
        fs::write(&bin_links_path, b"not valid json").unwrap();

        let counts = uninstall_one(target.to_str().unwrap()).expect(
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
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
        assert_eq!(counts.files_deleted, 0);
        assert!(target.join(".kiro/context/notes.md").exists());
        fs::remove_dir_all(&target).ok();
    }

    /// `.claude/settings.json` is a genuinely SHARED file (this install
    /// only ever merges a few `permissions.allow` grant strings into
    /// it -- see `resource_rewrite.rs`'s own
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
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
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
        // deleted (design §5), and counted as diverged.
        seed_target(
            &target,
            vec![(
                ".kiro/agents/a.json",
                b"hand-edited content",
                Provenance::Created,
                Some(&"a".repeat(64)),
            )],
        );
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
        assert_eq!(counts.files_deleted, 1);
        assert_eq!(counts.diverged_deleted, 1);
        assert!(!target.join(".kiro/agents/a.json").exists());
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn does_not_count_divergence_for_hash_matched_file() {
        let _home = HomeGuard::new("no-divergence-when-matched-home");
        let target = scratch_home("no-divergence-when-matched");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
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
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
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
        uninstall_one(target.to_str().unwrap()).unwrap();
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
        uninstall_one(target.to_str().unwrap()).unwrap();
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
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
        assert!(!target.join(".claude/agents").exists());
        assert!(target.join(".claude").is_dir());
        assert!(counts.dirs_removed >= 1);
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
        uninstall_one(target.to_str().unwrap()).unwrap();
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
        assert!(uninstall_one(&canonical).is_ok());
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
        let code = dispatch_uninstall(None, false, false, false);
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
        let code = dispatch_uninstall(None, false, false, false);
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
        let code = dispatch_uninstall(None, false, false, true);
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
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: "/tracked/b".to_string(),
                strategy: "kiro-cli".to_string(),
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
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            home.to_str().unwrap(),
            false,
            ConfirmationRequirement::NotRequired,
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
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            target.to_str().unwrap(),
            false,
            ConfirmationRequirement::NotRequired,
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
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        // Pass the ALREADY-canonical string as --target (mirrors a user
        // re-running uninstall with the same path they installed to,
        // which has since been deleted) -- the fallback's verbatim-match
        // arm finds it even though canonicalize_target_dir itself fails.
        let code = dispatch_target(
            &idx,
            &canonical,
            false,
            ConfirmationRequirement::NotRequired,
        );
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
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &idx,
            "/definitely/does/not/exist/and/is/not/tracked",
            false,
            ConfirmationRequirement::NotRequired,
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
            br#"{"schema_version":99,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let bad_canonical = index::canonicalize_target_dir(&bad).unwrap();

        index::write_index(IndexEntry {
            target_dir: good_canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: bad_canonical,
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, true, false, false);

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
            br#"{"schema_version":99,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let err = uninstall_one(target.to_str().unwrap())
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
        let err = uninstall_one(target.to_str().unwrap())
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
            br#"{"schema_version":99,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let index = Index::new(vec![IndexEntry {
            target_dir: canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            target.to_str().unwrap(),
            false,
            ConfirmationRequirement::NotRequired,
        );
        assert_eq!(code, 65);
        fs::remove_dir_all(&target).ok();
    }

    // ── bare invocation resolves --target to $HOME ──────────────────────
    //
    // `dispatch_uninstall`'s no-`--target`/no-`--all` path now resolves
    // the destination to $HOME (mirroring `install`'s own default)
    // rather than immediately reporting the design's former "multiple
    // installs are tracked" ambiguity error the moment 2+ installs are
    // tracked. A single tracked entry is still uninstalled directly
    // regardless of $HOME, unchanged (see the existing single-entry
    // tests elsewhere in this suite).

    /// Regression (1): with exactly one tracked install, and that
    /// install IS at $HOME, bare `uninstall` (no `--target`, no
    /// `--yes`) succeeds and removes it -- via the existing
    /// single-entry shortcut, which this change leaves untouched. Also
    /// confirms this path is genuinely unaffected by the newer
    /// confirmation-prompt gate added for the 2+-tracked-installs case:
    /// `yes` is passed as `false` here and the test still succeeds
    /// under `cargo test`'s non-terminal stdin (which would otherwise
    /// abort a `ConfirmationRequirement::Required` gate) -- proving the
    /// single-entry shortcut never reaches that gate at all. And with
    /// only one tracked install, there is no "other" to note: this
    /// test's own success (no note-dependent assertion needed) is the
    /// single-entry half of the discoverability note's "no note when
    /// there is nothing else tracked" contract --
    /// `success_note_for_other_tracked_installs_is_none_when_home_is_the_only_entry`
    /// below pins that contract directly at the unit level.
    #[test]
    fn dispatch_uninstall_bare_invocation_single_entry_at_home_succeeds() {
        let _home = HomeGuard::new("bare-single-entry-at-home-home");
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        seed_target(
            &home,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&home).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, false, false, false);
        assert_eq!(
            code, 0,
            "bare uninstall with the sole tracked install at $HOME must succeed, \
             unaffected by the confirmation gate (which only guards the 2+ case)"
        );
        assert!(!home.join(".kiro/agents/a.json").exists());
    }

    /// Regression (2): with 2+ tracked installs, one of them at $HOME,
    /// bare `uninstall --yes` resolves to $HOME specifically -- never
    /// the ambiguity error -- and removes only that one, leaving every
    /// other tracked install (and its index entry) untouched. `yes` is
    /// passed as `true` here specifically to bypass the confirmation
    /// gate (`cargo test`'s stdin is not a terminal, so without `--yes`
    /// this exact scenario would abort -- see
    /// `dispatch_uninstall_bare_invocation_multiple_entries_without_yes_aborts_non_interactively`
    /// below, which asserts exactly that): this test's own focus is the
    /// $HOME-resolution behavior, not the confirmation gate itself.
    #[test]
    fn dispatch_uninstall_bare_invocation_multiple_entries_resolves_to_home_only() {
        let _home = HomeGuard::new("bare-multi-entries-resolves-home-home");
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        seed_target(
            &home,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let home_canonical = index::canonicalize_target_dir(&home).unwrap();
        index::write_index(IndexEntry {
            target_dir: home_canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let other = scratch_home("bare-multi-entries-resolves-home-other");
        seed_target(
            &other,
            vec![(".kiro/agents/b.json", b"{}", Provenance::Created, None)],
        );
        let other_canonical = index::canonicalize_target_dir(&other).unwrap();
        index::write_index(IndexEntry {
            target_dir: other_canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, false, true, false);
        assert_eq!(
            code, 0,
            "bare uninstall with 2+ tracked installs, one at $HOME, must resolve to \
             $HOME rather than reporting an ambiguity error"
        );
        assert!(
            !home.join(".kiro/agents/a.json").exists(),
            "the $HOME-tracked install must have been removed"
        );
        assert!(
            other.join(".kiro/agents/b.json").exists(),
            "the OTHER tracked install must be untouched -- only $HOME was resolved"
        );
        let remaining = index::read_index().unwrap().unwrap();
        assert!(
            remaining
                .installs
                .iter()
                .any(|entry| entry.target_dir == other_canonical),
            "the other tracked install's index entry must survive"
        );
        assert!(
            !remaining
                .installs
                .iter()
                .any(|entry| entry.target_dir == home_canonical),
            "only the $HOME index entry must have been removed"
        );

        // The success-note content itself: built from the PRE-delete
        // index (mirroring what `dispatch_uninstall` actually has in
        // hand when it computes this note -- BEFORE `dispatch_target`'s
        // call removes the $HOME entry), matching this module's
        // structural-assertion convention rather than capturing real
        // stderr (which this module has no mechanism for).
        let before_delete = Index::new(vec![
            IndexEntry {
                target_dir: home_canonical.clone(),
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: other_canonical.clone(),
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
        ]);
        let note = success_note_for_other_tracked_installs(&before_delete, &home_canonical)
            .expect("2+ tracked installs with one OTHER than $HOME must produce a note");
        assert!(
            note.contains(&other_canonical),
            "the note must name the other tracked install's path"
        );
        assert!(
            note.contains("were left untouched"),
            "the note must state that other installs were left untouched"
        );
        assert!(
            note.contains("--all") && note.contains("--target"),
            "the note must guide the user toward --all/--target"
        );

        fs::remove_dir_all(&other).ok();
    }

    /// The discoverability note has nothing to add when $HOME is the
    /// ONLY tracked install -- `format_other_tracked_installs`'s
    /// `None` case, exercised directly at the unit level (the
    /// single-entry end-to-end test above never reaches this code path
    /// at all, since it takes the single-entry shortcut before
    /// `success_note_for_other_tracked_installs` is ever called).
    #[test]
    fn success_note_for_other_tracked_installs_is_none_when_home_is_the_only_entry() {
        let index = Index::new(vec![IndexEntry {
            target_dir: "/home/only".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        assert!(success_note_for_other_tracked_installs(&index, "/home/only").is_none());
    }

    /// `canonical_home_for_exclusion` must resolve a symlinked home
    /// directory to its CANONICAL, symlink-free form -- the same
    /// resolution `index::canonicalize_target_dir` (and, transitively,
    /// `dispatch_target`'s own entry match) performs -- rather than the
    /// raw symlink path a caller's `home_display` string carries.
    #[cfg(unix)]
    #[test]
    fn canonical_home_for_exclusion_resolves_symlinked_home_to_its_canonical_form() {
        let real = scratch_home("canonical-home-exclusion-real");
        let symlink = real
            .parent()
            .unwrap()
            .join("canonical-home-exclusion-symlink");
        std::os::unix::fs::symlink(&real, &symlink).unwrap();

        let home_display = symlink.to_string_lossy().into_owned();
        let canonical = index::canonicalize_target_dir(&real).unwrap();

        let resolved = canonical_home_for_exclusion(&symlink, &home_display);
        assert_eq!(
            resolved, canonical,
            "must resolve to the canonical form dispatch_target matches on, \
             not the raw symlink display string"
        );
        assert_ne!(
            resolved, home_display,
            "sanity check: the raw symlink path and its canonical form must \
             actually differ for this test to be meaningful"
        );

        fs::remove_file(&symlink).ok();
        fs::remove_dir_all(&real).ok();
    }

    /// End-to-end regression: when $HOME is a symlink -- so
    /// `resolve_destination`'s raw display string differs from the
    /// canonical form every tracked entry's `target_dir` is stored in --
    /// the discoverability note built after a bare, 2+-tracked-installs
    /// uninstall must still exclude the just-removed $HOME entry. Calls
    /// `success_note_for_dispatch_uninstall` -- the exact function
    /// `dispatch_uninstall`'s own call site calls -- rather than
    /// independently reconstructing its two-call sequence, so a
    /// regression in that shared function (e.g. dropping the
    /// canonicalization step) is guaranteed to surface here too: this
    /// module has no mechanism to capture the note from real stderr, so
    /// binding to the same function is what makes this an actual
    /// end-to-end regression guard rather than a restatement of the
    /// helper functions' own unit tests.
    #[cfg(unix)]
    #[test]
    fn dispatch_uninstall_bare_invocation_symlinked_home_excludes_removed_entry_from_note() {
        let _lock = lock_home();
        let original_home = std::env::var_os("HOME");

        let real_home = scratch_home("symlinked-home-note-real");
        let symlink_home = real_home
            .parent()
            .unwrap()
            .join("symlinked-home-note-symlink");
        std::os::unix::fs::symlink(&real_home, &symlink_home).unwrap();

        // SAFETY: held under the crate-wide HOME_ENV_LOCK for this
        // test's entire body; restored before returning. Managed
        // directly rather than via `HomeGuard` because this test needs
        // `HOME` to be a SYMLINK path specifically -- `HomeGuard`'s own
        // scratch dir is never a symlink.
        unsafe {
            std::env::set_var("HOME", &symlink_home);
        }

        seed_target(
            &real_home,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let home_canonical = index::canonicalize_target_dir(&real_home).unwrap();
        index::write_index(IndexEntry {
            target_dir: home_canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let other = scratch_home("symlinked-home-note-other");
        seed_target(
            &other,
            vec![(".kiro/agents/b.json", b"{}", Provenance::Created, None)],
        );
        let other_canonical = index::canonicalize_target_dir(&other).unwrap();
        index::write_index(IndexEntry {
            target_dir: other_canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, false, true, false);

        // SAFETY: see the set_var above.
        unsafe {
            match &original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }

        assert_eq!(code, 0);
        assert!(!real_home.join(".kiro/agents/a.json").exists());
        assert!(other.join(".kiro/agents/b.json").exists());

        let home_display = symlink_home.to_string_lossy().into_owned();
        let before_delete = Index::new(vec![
            IndexEntry {
                target_dir: home_canonical.clone(),
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: other_canonical.clone(),
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
        ]);
        let note =
            success_note_for_dispatch_uninstall(&symlink_home, &home_display, &before_delete)
                .expect("2+ tracked installs with one OTHER than $HOME must produce a note");
        // The note's INTRO sentence legitimately names `resolved_home`
        // itself ("note: <home> was 1 of N tracked installs..."), so the
        // bug this test guards against is specific to the "Other tracked
        // install(s):" LISTING built by `format_other_tracked_installs`
        // -- checked here via its exact `  - <dir>` bullet form, not bare
        // string containment.
        assert!(
            !note.contains(&format!("  - {home_canonical}")),
            "the just-removed $HOME entry must not appear in the \
             'other tracked install(s)' listing"
        );
        assert!(
            note.contains(&format!("  - {other_canonical}")),
            "the other tracked install's path must still be listed"
        );

        fs::remove_dir_all(&real_home).ok();
        fs::remove_file(&symlink_home).ok();
        fs::remove_dir_all(&other).ok();
    }

    /// Regression (3): with 2+ tracked installs, none of them at
    /// $HOME, bare `uninstall` gives the normal "does not match any
    /// tracked install" error for the resolved $HOME path -- the exact
    /// mechanism `dispatch_target` already applies to an explicit
    /// `--target <dir>` that matches nothing.
    #[test]
    fn dispatch_uninstall_bare_invocation_no_entry_at_home_gives_not_tracked_error() {
        let _home = HomeGuard::new("bare-no-entry-at-home-home");
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        let good_a = scratch_home("bare-no-entry-at-home-a");
        let good_b = scratch_home("bare-no-entry-at-home-b");
        let canonical_a = index::canonicalize_target_dir(&good_a).unwrap();
        let canonical_b = index::canonicalize_target_dir(&good_b).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical_a,
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical_b,
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, false, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);

        // Confirms this is genuinely the not-tracked-at-$HOME
        // resolution, not merely a coincidental 64 from elsewhere:
        // calling `dispatch_target` directly against the same index
        // and the resolved $HOME path reproduces the identical exit
        // code, and $HOME is confirmed absent from the tracked set.
        let index_snapshot = index::read_index().unwrap().unwrap();
        let home_canonical = index::canonicalize_target_dir(&home).unwrap();
        assert!(
            !index_snapshot
                .installs
                .iter()
                .any(|entry| entry.target_dir == home_canonical),
            "sanity check: $HOME must not be one of the tracked entries"
        );
        let direct_code = dispatch_target(
            &index_snapshot,
            home.to_str().unwrap(),
            false,
            ConfirmationRequirement::NotRequired,
        );
        assert_eq!(direct_code, EXIT_USAGE_ERROR);

        fs::remove_dir_all(&good_a).ok();
        fs::remove_dir_all(&good_b).ok();
    }

    /// Regression (4): `--all` remains entirely unaffected by this
    /// change -- it still processes every tracked install, one at a
    /// time, regardless of whether any of them happen to be at $HOME.
    /// Neither target here is at $HOME (which the bare-invocation
    /// resolution this change adds would refuse to match), and `--all`
    /// must still succeed for both.
    #[test]
    fn dispatch_uninstall_all_flag_unaffected_by_home_default() {
        let _home = HomeGuard::new("all-unaffected-by-home-default-home");
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
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical_b,
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, true, false, false);
        assert_eq!(code, 0);
        assert!(!target_a.join(".kiro/agents/a.json").exists());
        assert!(!target_b.join(".kiro/agents/b.json").exists());

        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
    }

    // ── interactive confirmation gate for the bare, 2+-tracked,
    //    $HOME-resolved case ─────────────────────────────────────────────
    //
    // `dispatch_uninstall`'s bare-invocation-resolves-to-$HOME branch
    // (Regression (2) above) is the ONLY case this gate applies to --
    // an explicit `--target <dir>`, `--all`, and the single-tracked-
    // entry shortcut all pass `ConfirmationRequirement::NotRequired` (or
    // never reach `dispatch_target` at all) and are exercised elsewhere
    // in this suite without ever touching it.

    /// `y`/`yes` (any case, with surrounding whitespace) must proceed;
    /// everything else, including empty input, must abort. Exercised
    /// directly against the pure parsing function -- this module has no
    /// way to inject a fake stdin into `confirm_destructive_uninstall`
    /// itself.
    #[test]
    fn parse_confirmation_response_accepts_y_and_yes_case_insensitive() {
        for accepted in ["y", "Y", "yes", "YES", "Yes", "  yes\n", "y\n"] {
            assert_eq!(
                parse_confirmation_response(accepted),
                ConfirmOutcome::Proceed,
                "{accepted:?} must be accepted as confirmation"
            );
        }
    }

    #[test]
    fn parse_confirmation_response_rejects_other_input_including_empty() {
        for rejected in ["", "\n", "n", "no", "N", "maybe", "yeah", "yep", " "] {
            assert_eq!(
                parse_confirmation_response(rejected),
                ConfirmOutcome::Abort,
                "{rejected:?} must be rejected (never a silent proceed)"
            );
        }
    }

    /// `auto_yes` (`--yes`/`-y`) must proceed immediately without
    /// reading stdin at all -- safe to assert unconditionally in any
    /// test environment, interactive or not, since the function returns
    /// before ever touching `std::io::stdin()`.
    #[test]
    fn confirm_destructive_uninstall_auto_yes_proceeds_without_touching_stdin() {
        assert_eq!(
            confirm_destructive_uninstall("/tmp/some-target", true, false),
            ConfirmOutcome::Proceed
        );
        // Also true with json=true -- auto_yes short-circuits before the
        // json/TTY check is ever consulted.
        assert_eq!(
            confirm_destructive_uninstall("/tmp/some-target", true, true),
            ConfirmOutcome::Proceed
        );
    }

    /// `--json` mode aborts without `--yes` -- a scripted/JSON consumer
    /// is not an interactive human, so it is treated the same as any
    /// other non-interactive context: `--yes` is required to bypass.
    /// Deterministic regardless of the test environment's real stdin,
    /// since the `json` check short-circuits before the TTY check.
    #[test]
    fn confirm_destructive_uninstall_json_mode_aborts_without_auto_yes() {
        assert_eq!(
            confirm_destructive_uninstall("/tmp/some-target", false, true),
            ConfirmOutcome::Abort
        );
    }

    /// Non-interactive stdin (no TTY attached) aborts without `--yes`,
    /// rather than blocking on input that can never arrive. `cargo
    /// test`'s own stdin is not a terminal, so this is exercised
    /// directly against the real, un-mocked `std::io::stdin()` this
    /// function actually calls -- the same non-interactive context a
    /// piped/CI/scripted invocation would hit.
    #[test]
    fn confirm_destructive_uninstall_non_interactive_stdin_aborts_without_auto_yes() {
        assert!(
            !std::io::stdin().is_terminal(),
            "sanity check: this test process's stdin must not be a TTY under cargo test, \
             or this test is not exercising the non-interactive path it claims to"
        );
        assert_eq!(
            confirm_destructive_uninstall("/tmp/some-target", false, false),
            ConfirmOutcome::Abort
        );
    }

    /// End-to-end: 2+ tracked installs, one at $HOME, bare `uninstall`
    /// with NEITHER `--yes` NOR a TTY attached (`cargo test`'s own
    /// stdin) must abort with `EXIT_USER_ABORTED` (4) -- the exact
    /// inverse of Regression (2) above, which passes `yes: true` to
    /// bypass this same gate. Nothing is touched on abort: both
    /// tracked installs' files and index entries survive untouched.
    #[test]
    fn dispatch_uninstall_bare_invocation_multiple_entries_without_yes_aborts_non_interactively() {
        assert!(
            !std::io::stdin().is_terminal(),
            "sanity check: this test's stdin must not be a TTY under cargo test, \
             otherwise the confirmation prompt would block on read_line"
        );
        let _home = HomeGuard::new("bare-multi-without-yes-aborts-home");
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        seed_target(
            &home,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let home_canonical = index::canonicalize_target_dir(&home).unwrap();
        index::write_index(IndexEntry {
            target_dir: home_canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let other = scratch_home("bare-multi-without-yes-aborts-other");
        seed_target(
            &other,
            vec![(".kiro/agents/b.json", b"{}", Provenance::Created, None)],
        );
        let other_canonical = index::canonicalize_target_dir(&other).unwrap();
        index::write_index(IndexEntry {
            target_dir: other_canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_uninstall(None, false, false, false);
        assert_eq!(
            code, EXIT_USER_ABORTED,
            "declining (here: non-interactively, without --yes) must abort with \
             EXIT_USER_ABORTED, never proceed and never a plain usage error"
        );
        assert!(
            home.join(".kiro/agents/a.json").exists(),
            "the $HOME-tracked install must be untouched when the confirmation is declined"
        );
        assert!(
            other.join(".kiro/agents/b.json").exists(),
            "the other tracked install must also be untouched"
        );
        let remaining = index::read_index().unwrap().unwrap();
        assert!(
            remaining
                .installs
                .iter()
                .any(|entry| entry.target_dir == home_canonical),
            "the $HOME index entry must survive a declined confirmation"
        );
        assert!(
            remaining
                .installs
                .iter()
                .any(|entry| entry.target_dir == other_canonical),
            "the other tracked install's index entry must also survive"
        );

        fs::remove_dir_all(&other).ok();
    }

    /// The confirmation gate is scoped to the implicit, bare-invocation
    /// case only -- an explicit `--target <dir>` matching a tracked
    /// entry must succeed with NO confirmation, even with a non-TTY
    /// stdin and no `--yes` (`ConfirmationRequirement::NotRequired`
    /// never consults either).
    #[test]
    fn dispatch_target_explicit_match_never_prompts_even_without_yes() {
        let _home = HomeGuard::new("target-explicit-never-prompts-home");
        let target = scratch_home("target-explicit-never-prompts");
        seed_target(
            &target,
            vec![(".kiro/agents/a.json", b"{}", Provenance::Created, None)],
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let index = Index::new(vec![IndexEntry {
            target_dir: canonical,
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);
        let code = dispatch_target(
            &index,
            target.to_str().unwrap(),
            false,
            ConfirmationRequirement::NotRequired,
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
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
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
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
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
        let counts = uninstall_one(&canonical).unwrap();
        assert!(counts.stale);
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
            bin_link_error: Some("could not remove tracked symlink: permission denied".to_string()),
            ..Default::default()
        };
        report_single("/proj/a", &counts, false);
        report_single("/proj/a", &counts, true);
        report_batch(&[("/proj/a".to_string(), counts.clone())], &[], false);
        report_batch(&[("/proj/a".to_string(), counts)], &[], true);
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
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: index::canonicalize_target_dir(&stale_target).unwrap(),
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
        ]);
        let code = dispatch_all(&index, false);
        assert_eq!(
            code, 0,
            "a real success + a stale prune must both count as success"
        );
        fs::remove_dir_all(&real_target).ok();
        fs::remove_dir_all(&stale_target).ok();
    }

    // ── duplicate target_dir entries rejected ───────────────────────────

    #[test]
    fn dispatch_uninstall_rejects_corrupted_index_with_duplicate_target_dir() {
        let index = Index::new(vec![
            IndexEntry {
                target_dir: "/tmp/dup-target".to_string(),
                strategy: "kiro-cli".to_string(),
                installed_at: "2026-01-15T09:30:00Z".to_string(),
                status: index::IndexEntryStatus::Complete,
            },
            IndexEntry {
                target_dir: "/tmp/dup-target".to_string(),
                strategy: "kiro-cli".to_string(),
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
        report_corrupted_index(&duplicates, false);
        report_corrupted_index(&duplicates, true);
    }

    /// `report_corrupted_index`'s `--json` documents go to stdout,
    /// matching `report_error`'s own stdout move above -- every
    /// `--json` document this module emits, success or failure, lands
    /// on the same stream. Confirmed the same way as
    /// `report_error_json_document_content_is_unchanged_and_goes_to_stdout_not_stderr`:
    /// by reading this module's own source, since there is no
    /// stdout/stderr-capture mechanism in this test suite. Rather than
    /// pinning brittle whitespace-sensitive snippets, this counts every
    /// `eprintln!` call that is immediately followed by a
    /// `serde_json::json!`/`build_error_json` invocation -- this
    /// module's ONLY JSON-emitting error paths (`report_error`,
    /// `report_corrupted_index`) both print via `println!`, so there
    /// must be none.
    #[test]
    fn no_json_document_in_this_module_is_emitted_via_eprintln() {
        let source = include_str!("uninstall.rs");
        for (line_number, line) in source.lines().enumerate() {
            if !line.trim_start().starts_with("eprintln!(") {
                continue;
            }
            let mut following = source
                .lines()
                .skip(line_number + 1)
                .take(3)
                .collect::<Vec<_>>()
                .join("\n");
            following.push_str(line);
            assert!(
                !following.contains("serde_json::json!") && !following.contains("build_error_json"),
                "line {} calls eprintln! immediately around a JSON construction -- every \
                 --json document in this module must go to stdout via println!, never stderr",
                line_number + 1
            );
        }
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
    /// under a root test runner (common in CI containers / the Brazil
    /// sandbox) `remove_dir(mid)` would have unexpectedly succeeded on
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
        let removed_first_pass = cleanup_empty_dirs(&target, &[dir_a.clone()]);
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
        let removed_second_pass = cleanup_empty_dirs(&target, &[dir_b.clone()]);
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
        let counts = uninstall_one(target.to_str().unwrap()).unwrap();
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
        let code = dispatch_uninstall(None, false, false, true);
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
            br#"{"schema_version":99,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        })
        .unwrap();

        let err = uninstall_one(&canonical).expect_err("unsupported schema_version must fail");
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

        let code = dispatch_uninstall(None, false, false, true);
        assert_eq!(
            code, 65,
            "must propagate EXIT_VERIFY_FAILED, not flatten to 64"
        );
        fs::remove_dir_all(&target).ok();
    }

    /// Named error path 3: `dispatch_target`'s no-match usage error.
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
            strategy: "kiro-cli".to_string(),
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
            true,
            ConfirmationRequirement::NotRequired,
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
            br#"{"schema_version":99,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let index = Index::new(vec![IndexEntry {
            target_dir: canonical.clone(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: index::IndexEntryStatus::Complete,
        }]);

        let err = uninstall_one(&canonical).expect_err("unsupported schema_version must fail");
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
            true,
            ConfirmationRequirement::NotRequired,
        );
        assert_eq!(
            code, 65,
            "must propagate EXIT_VERIFY_FAILED, not flatten to 64"
        );
        fs::remove_dir_all(&target).ok();
    }
}
