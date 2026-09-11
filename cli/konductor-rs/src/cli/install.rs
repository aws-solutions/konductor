// SPDX-License-Identifier: Apache-2.0
//
// install.rs — `konductor install` dispatch (Rust implementation).
// Artifact fetch+verify lives in `install::artifact`; runtime
// auto-detection in `install::runtime`; manifest read/write in
// `install::manifest`; strategy registration (task 3.2) and local-source
// installation (task 3.4) in `install::kiro_cli`.
//
// `dispatch_install` performs real work: it resolves the install
// DESTINATION (`--target <dir>` if given, else `$HOME`), selects the
// first registered `InstallStrategy` whose `matches()` accepts that
// destination, and runs its `install_from_local()`, which copies
// synthed agent files from the SOURCE (`--from <repo-root>`'s synth
// output) and writes `<destination>/.konductor/manifest`. Without
// `--from`, remote (GitHub Release) installation is not yet
// implemented -- this fails with a clear message rather than silently
// succeeding. No install failure at this milestone maps to
// `EXIT_VERIFY_FAILED` (65, reserved for a future real checksum
// mismatch); every failure here -- unresolvable destination, no
// matching strategy, missing `--from`, empty/missing source, or a
// write failure -- maps to `EXIT_USAGE_ERROR` (64), never exit code 2.
//
// ── Output reporting ────────────────────────────────────────────────────
// `dispatch_install` used to print exactly one fixed line
// ("installed via '<strategy>'") regardless of what happened. It now
// re-reads the manifest `install_from_local` just wrote (the sole
// on-disk record of what was installed -- see manifest.rs's module
// docstring) and reports: the destination, a per-content-type count
// derived from each file's `.kiro/`/`.konductor/` path prefix, the
// manifest path, how many SOPs were skipped (synth stages them under
// `dist/<harness>/sops/`, but no strategy has a runtime discovery path
// for them yet -- see kiro_cli.rs's module docstring), and how many
// installed files had `Provenance::ReplacedForeign` (a pre-existing,
// non-Konductor file this run overwrote).

use std::path::{Path, PathBuf};

pub mod artifact;
pub mod bin_link;
pub mod claude;
pub mod index;
pub mod kiro_cli;
pub mod kiro_cli_v3;
pub mod manifest;
pub mod mcp_server;
pub mod phases;
pub mod registry;
pub mod remote;
pub mod resource_rewrite;
pub mod runtime;

use manifest::Provenance;

/// Counts the `*.sop.md` files `konductor synth` staged under
/// `<from>/dist/<harness_dir>/sops/` -- the SOPs this install
/// intentionally skips (no runtime discovery path yet; see
/// kiro_cli.rs's module docstring for why). `harness_dir` is the
/// harness directory name of whichever strategy actually ran this
/// install (`InstallStrategy::harness_dir()`), not a fixed constant --
/// each registered strategy stages synth output under its own harness
/// name (`kiro-cli-v2` for `KiroCliInstallStrategy`, `claude` for
/// `ClaudeInstallStrategy`), so a single hardcoded name would report
/// the wrong strategy's staged-SOP count once more than one strategy
/// is registered. Derived from the actual staged source rather than a
/// hand-counted constant, so the reported figure always matches
/// whatever was installed `--from` and can never drift from
/// `agent-sops/`. Returns 0 when the directory is absent (a source
/// that staged no SOPs for this harness).
fn count_staged_sops(from: &str, harness_dir: &str) -> usize {
    use crate::cli::synth::kiro_cli_v2::SOPS_CONTENT_TYPE_DIR;
    let sops_dir = Path::new(from)
        .join("dist")
        .join(harness_dir)
        .join(SOPS_CONTENT_TYPE_DIR);
    let Ok(entries) = std::fs::read_dir(&sops_dir) else {
        return 0;
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".sop.md"))
        .count()
}

/// Remapped exit code for CLI usage errors, matching cli.rs's own
/// `EXIT_USAGE_ERROR` constant. Duplicated here (rather than imported)
/// per dispatch.rs's own established precedent for this exact constant
/// (cli.rs's constant is private to that module).
const EXIT_USAGE_ERROR: u8 = 64;

/// Same duplicated-per-module-constant precedent as `EXIT_USAGE_ERROR`
/// above, matching cli.rs's own `EXIT_VERIFY_FAILED` constant and
/// `index::IndexError`'s own doc comment, which documents that
/// `UnsupportedSchemaVersion` must map to this code, never
/// `EXIT_USAGE_ERROR` (64).
const EXIT_VERIFY_FAILED: u8 = 65;

/// Maps an `index::read_index()` error to its correct exit code --
/// `EXIT_VERIFY_FAILED` (65) specifically for
/// `index::IndexError::UnsupportedSchemaVersion`, `EXIT_USAGE_ERROR`
/// (64) for every other variant. Same mapping `update.rs`/
/// `uninstall.rs` already apply via their own `index_error_exit_code`
/// -- ports it here so `install`'s `read_index()` call site stops
/// unconditionally returning 64 for a corrupted-schema index that
/// `update`/`uninstall` would report as 65 for the identical index.
fn index_error_exit_code(err: &index::IndexError) -> u8 {
    match err {
        index::IndexError::UnsupportedSchemaVersion { .. } => EXIT_VERIFY_FAILED,
        _ => EXIT_USAGE_ERROR,
    }
}

/// Maps an `InstallStrategy::install_from_local` failure to its
/// correct exit code -- `EXIT_VERIFY_FAILED` (65) when the failure
/// traces back to an unsupported manifest `schema_version` (e.g.
/// re-installing over a target whose `.konductor/manifest` a newer
/// binary wrote), `EXIT_USAGE_ERROR` (64) for every other failure.
/// Mirrors `manifest_error_exit_code` in `update.rs`/`uninstall.rs`,
/// which apply the identical split to a manifest read they perform
/// themselves; this is the same split applied to the read
/// `install_from_local` performs internally, surfaced here via
/// `InstallError` so `install`'s call site no longer has to flatten
/// every failure to 64 regardless of cause. `pub(super)` (visible
/// throughout `cli`) so `update.rs`'s own `install_from_local` call
/// sites -- which hit the identical failure -- can apply the same
/// mapping rather than hand-rolling their own.
pub(super) fn install_error_exit_code(err: &InstallError) -> u8 {
    match err {
        InstallError::Manifest(manifest::ManifestError::UnsupportedSchemaVersion { .. }) => {
            EXIT_VERIFY_FAILED
        }
        _ => EXIT_USAGE_ERROR,
    }
}

/// The single wording for "no `--from <repo-root>` was given, and
/// remote (GitHub Release) installation is not yet implemented" --
/// shared by every call site that needs to fail with this exact
/// message (`kiro_cli.rs`'s `would_fail_as_noop` and
/// `install_from_local`, `phases.rs`'s `McpInstallPhase::check_preconditions`)
/// so a future wording change only touches this one constant.
pub(super) const NO_REMOTE_RELEASE_MESSAGE: &str =
    "remote release installation is not yet available; pass --from <repo-root>";

/// What `InstallStrategy::install_from_local` can fail with.
/// `Manifest` preserves the structured `manifest::ManifestError` a
/// strategy encountered while reading a target's existing manifest
/// (the read `install_from_local` performs before writing anything, to
/// classify provenance) -- specifically so a caller can distinguish an
/// unsupported `schema_version` from every other failure and map it to
/// `EXIT_VERIFY_FAILED` (65) instead of the generic `EXIT_USAGE_ERROR`
/// (64). `Message` covers every other failure (a missing `--from`, a
/// source with nothing to install, an I/O error while copying), where
/// no caller needs anything more specific than the human-readable
/// text.
#[derive(Debug)]
pub enum InstallError {
    Manifest(manifest::ManifestError),
    Message(String),
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InstallError::Manifest(err) => write!(f, "{err}"),
            InstallError::Message(message) => write!(f, "{message}"),
        }
    }
}

impl InstallError {
    /// Whether this error's displayed text contains `needle` -- lets
    /// call sites (mainly tests) check for a substring the same way
    /// they would against a plain `String`, without first converting
    /// via `.to_string()`.
    #[cfg(test)]
    pub fn contains(&self, needle: &str) -> bool {
        self.to_string().contains(needle)
    }
}

impl From<manifest::ManifestError> for InstallError {
    fn from(err: manifest::ManifestError) -> Self {
        InstallError::Manifest(err)
    }
}

impl From<String> for InstallError {
    fn from(message: String) -> Self {
        InstallError::Message(message)
    }
}

/// A stable, closed error-category string (design doc D.11) -- never
/// this error's own `Display` text, which routinely embeds a local
/// filesystem path. `InstallError::Message` has no structured variant
/// of its own (it wraps arbitrary free text from `install_from_local`'s
/// several distinct failure modes), so every `Message` collapses onto
/// one generic code -- coarser than `ManifestError`'s own per-variant
/// codes, but still a closed, non-message-derived string.
fn install_error_code(err: &InstallError) -> &'static str {
    match err {
        InstallError::Manifest(manifest::ManifestError::UnsupportedSchemaVersion { .. }) => {
            "install.manifest_unsupported_schema_version"
        }
        InstallError::Manifest(_) => "install.manifest_error",
        InstallError::Message(_) => "install.from_local_failed",
    }
}

/// A single install target's behavior (e.g. a specific CI/agent runtime).
/// Implementations register themselves in `install::registry::STRATEGIES`.
/// Requires `Sync` since strategies live in a `static` slice.
pub trait InstallStrategy: Sync {
    /// Stable identifier for this strategy, used for selection and logs.
    fn name(&self) -> &'static str;

    /// The harness directory name this strategy reads synthed output
    /// from under `<from>/dist/<harness_dir>/` -- e.g. `kiro-cli-v2`
    /// for `KiroCliInstallStrategy`, `claude` for
    /// `ClaudeInstallStrategy`. Distinct from `name()` (this strategy's
    /// own registry/log identifier, e.g. `"claude-code"`): `harness_dir`
    /// is the on-disk synth-output directory name a HARNESS
    /// TRANSFORMER stages under, which need not match the strategy's
    /// own identifier. Exists so strategy-agnostic reporting code
    /// (`count_staged_sops`) can read the right harness directory for
    /// whichever strategy actually ran, instead of hardcoding one.
    fn harness_dir(&self) -> &'static str;

    /// Whether this strategy applies to the given install target
    /// directory, by inspecting its existing `.kiro`/`.claude` marker(s)
    /// (`runtime::detect_runtimes`).
    ///
    /// `#[allow(dead_code)]`: strategy selection is now driven solely by
    /// `--harness` (`dispatch_install_with` matches on `harness_dir()`),
    /// so no production path calls this. Kept because each impl's own
    /// unit tests still pin its behavior, and a future `--auto`-detect
    /// mode or `doctor`-style diagnostic may want to reuse it.
    #[allow(dead_code)]
    fn matches(&self, target_dir: &Path) -> bool;

    /// Installs from `from`'s resolved synth output (`--from
    /// <repo-root>`). `from` is `None` when the user omitted `--from`
    /// -- a strategy must fail clearly in that case (remote release
    /// installation is not yet available) rather than silently
    /// succeed. `installed_at` is the single timestamp string the
    /// caller (`dispatch_install_with`/`update.rs`) already computed
    /// for this run's index entry -- the strategy must write it
    /// verbatim into the manifest's own `installed_at` rather than
    /// capturing a second, independent clock read, so the index entry
    /// and the manifest agree on one instant (design doc
    /// `konductor-cli-install-index.md` §1). `no_telemetry` carries
    /// `install`'s own `--no-telemetry` flag (`false` from `update.rs`,
    /// which has no such flag of its own -- see that call site's own
    /// comment) -- a strategy must thread it through to any phase that
    /// may fire a telemetry side effect (today, only
    /// `AgentInstallPhase`'s Claude Code telemetry-hook wiring; see
    /// `phases.rs`'s own doc comment), so the opt-out holds for
    /// EVERYTHING an install run does, not only the top-level
    /// `report_package_installed`/`report_cli_error` calls
    /// `dispatch_install_with` itself already gated on it. Returns
    /// `Ok(())` on success, or an `InstallError` on failure --
    /// `InstallError::Manifest` when the failure traces back to reading
    /// an existing target manifest (so a caller can map an unsupported
    /// `schema_version` to `EXIT_VERIFY_FAILED` rather than the generic
    /// `EXIT_USAGE_ERROR`), `InstallError::Message` for every other
    /// failure.
    fn install_from_local(
        &self,
        target_dir: &Path,
        from: Option<&str>,
        installed_at: &str,
        no_telemetry: bool,
    ) -> Result<(), InstallError>;

    /// Cheap, read-only check for whether `install_from_local(target_dir,
    /// from)` is about to fail as a pure no-op -- a usage error that
    /// happens before any file is written (missing/invalid `--from`,
    /// or a source with nothing to install). Returns the exact error
    /// message `install_from_local` would return in that case, or
    /// `None` if the run may actually touch the filesystem.
    ///
    /// Callers (`install`'s `dispatch_install_with`, `update`'s
    /// `update_one_target`) run this BEFORE writing an `InProgress`
    /// index entry, so a no-op failure never mutates a target's index
    /// -- mirroring the existing unregistered-strategy check in
    /// `update.rs`, which runs before the same write-ahead for the same
    /// reason. This performs no writes itself, and every check it
    /// makes must stay in lockstep with `install_from_local`'s own
    /// no-op conditions -- a mismatch here would only affect when the
    /// index is mutated, never what `install_from_local` itself does.
    fn would_fail_as_noop(&self, target_dir: &Path, from: Option<&str>) -> Option<String>;
}

/// Resolves the install DESTINATION directory: `--target <dir>` if
/// given, else `$HOME`. `--target .` reproduces the pre-`--target`
/// cwd-as-destination behavior exactly. Fails clearly (rather than
/// panicking) when no `--target` was given and `HOME` is unset or
/// empty -- a sandboxed/misconfigured environment with no resolvable
/// home directory has no sane implicit destination.
///
/// ── Shared with `doctor` ────────────────────────────────────────────
/// `doctor.rs` imports and calls this same function directly for its
/// own `--target`/`$HOME` destination resolution (see this module's
/// re-export at the top of `doctor.rs`) rather than duplicating the
/// precedence logic -- there is exactly one implementation to keep in
/// sync.
pub(crate) fn resolve_destination(target: Option<&str>) -> Result<PathBuf, String> {
    if let Some(dir) = target {
        return Ok(PathBuf::from(dir));
    }
    match std::env::var_os("HOME") {
        Some(home) if !home.is_empty() => Ok(PathBuf::from(home)),
        _ => Err(
            "could not resolve a default install destination: $HOME is unset or empty; \
             pass --target <dir> instead"
                .to_string(),
        ),
    }
}

/// Reports the `--harness <name>` scope gap: `name` is not the
/// `harness_dir()` of any registered `InstallStrategy`
/// (`registry::STRATEGIES`). `konductor synth` produces output for every
/// registered `synth::registry::TRANSFORMERS` entry, and `install` today
/// consumes all three of them (`KiroCliInstallStrategy`,
/// `KiroCliV3InstallStrategy`, and `ClaudeInstallStrategy`) -- but a
/// future synth harness (e.g. `kiro-ide` or `codex`, both reserved in
/// `synth::registry`'s own table) can still land with no install-side
/// consumer of its own. Distinguishes that case (a real, synthed
/// harness with no install-side consumer) from a genuinely unknown
/// string, so the message tells the caller which situation they hit
/// rather than a generic "invalid choice".
fn report_no_strategy_for_harness(
    destination: &Path,
    harness_name: &str,
    no_telemetry: bool,
    json: bool,
) {
    let supported: Vec<&str> = registry::STRATEGIES
        .iter()
        .map(|strategy| strategy.harness_dir())
        .collect();
    let has_synth_output = crate::cli::synth::registry::TRANSFORMERS
        .iter()
        .any(|transformer| transformer.name() == harness_name);
    let message = if has_synth_output {
        format!(
            "no install strategy is implemented for harness '{harness_name}' yet -- \
             `konductor synth` produces `dist/{harness_name}/` output for it, but `install` \
             has no strategy that consumes it. Supported --harness values today: {}",
            supported.join(", ")
        )
    } else {
        format!(
            "no install strategy is registered for harness '{harness_name}'. \
             Supported --harness values today: {}",
            supported.join(", ")
        )
    };
    super::report::report_error(
        "install",
        "install.no_strategy_for_harness",
        destination,
        no_telemetry,
        &message,
        Vec::new(),
        json,
    );
}

/// `konductor install --harness <name> [--from ...] [--target ...]
/// [--link-bin]`: resolves the install destination
/// (`resolve_destination`), selects the registered `InstallStrategy`
/// whose `harness_dir()` matches the REQUIRED `--harness` argument, and
/// runs its `install_from_local(destination, from)`. `from` is the
/// SOURCE repo root a strategy reads synthed agent files from; without
/// it, no strategy has a source to install from, so the selected
/// strategy is expected to fail with a clear "remote release
/// installation is not yet available" message.
///
/// `link_bin`, when true and the core install above succeeds, also
/// symlinks the currently-running `konductor` binary to
/// `$HOME/.local/bin/konductor` via `bin_link::ensure_bin_link` -- see
/// that module's own doc comment for the design (opt-in, home-scoped
/// sidecar, self-heal, ownership proof). Computed and reported as part
/// of the SAME success report `report_install_success` prints -- never
/// a second, separate top-level `--json` document for one invocation --
/// and deliberately non-fatal to this function's own return value: a
/// `--link-bin` failure is reported clearly but never flips an
/// otherwise-successful install's exit code, since by the time it runs
/// the core `--target`-scoped install (what `--target` actually asked
/// for) has already succeeded.
///
/// `verbose`/`json` are `cli.verbose`/`cli.json` (the global `-v`/
/// `--json` flags): `verbose` appends a per-file detail listing after
/// the summary line; `json` replaces the whole human-readable report
/// with one structured line instead.
///
/// Returns 0 on success, `EXIT_USAGE_ERROR` (64) on an unresolvable
/// destination, no matching strategy, or any install failure -- never
/// exit code 2.
pub fn dispatch_install_with(
    from: Option<String>,
    target: Option<String>,
    harness: String,
    link_bin: bool,
    no_telemetry: bool,
    verbose: bool,
    json: bool,
) -> u8 {
    let destination = match resolve_destination(target.as_deref()) {
        Ok(dir) => dir,
        Err(message) => {
            let home_dir_fallback = std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_default();
            super::report::report_error(
                "install",
                "install.destination_unresolved",
                &home_dir_fallback,
                no_telemetry,
                &message,
                Vec::new(),
                json,
            );
            return EXIT_USAGE_ERROR;
        }
    };
    super::trace::trace(
        "trace",
        &format!("install: resolved destination to {}", destination.display()),
    );

    // Selection is by exact `harness_dir()` match against the required
    // `--harness` value -- never by asking a strategy's own `matches()`
    // to inspect the destination. That avoids a target carrying both
    // `.kiro` and `.claude` markers being silently resolved by
    // registration order (see `registry.rs`). `matches()`/
    // `detect_runtimes()` are still used elsewhere (`kiro_cli/plan.rs`,
    // `doctor.rs`), just not for selection here.
    let Some(strategy) = registry::STRATEGIES
        .iter()
        .find(|strategy| strategy.harness_dir() == harness)
    else {
        report_no_strategy_for_harness(&destination, &harness, no_telemetry, json);
        return EXIT_USAGE_ERROR;
    };
    super::trace::trace(
        "trace",
        &format!(
            "install: strategy '{}' matched destination",
            strategy.name()
        ),
    );

    // No `--from`: attempt the bytes-in-hand remote path instead of the
    // bare usage error below. The fetch step isn't implemented yet, so
    // this always fails today with a distinct error, never a silent
    // no-op. Runs before any index write, so a failed attempt never
    // mutates a target's index entry.
    if from.is_none() {
        return match remote::fetch_release_artifact_stub() {
            Ok(_) => {
                // Unreachable today (the stub always returns `Err`), but
                // not a panic: if the stub is later changed to return
                // `Ok` without this call site being updated, we want a
                // failed command, not a crashed process.
                super::report::report_error(
                    "install",
                    "install.remote_fetch_returned_ok_unexpectedly",
                    &destination,
                    no_telemetry,
                    "internal error: remote release fetch returned Ok unexpectedly (no \
                     Ok-handling is implemented yet)",
                    Vec::new(),
                    json,
                );
                EXIT_USAGE_ERROR
            }
            Err(_) => {
                // Reuse NO_REMOTE_RELEASE_MESSAGE (not the stub's own
                // "not yet implemented" message) so the user gets the
                // same "pass --from <repo-root>" guidance as every other
                // no-`--from` call site. Routed through report_error like
                // every other failure path, so this also gets the
                // --json envelope and telemetry.
                super::report::report_error(
                    "install",
                    "install.no_remote_release",
                    &destination,
                    no_telemetry,
                    NO_REMOTE_RELEASE_MESSAGE,
                    Vec::new(),
                    json,
                );
                EXIT_USAGE_ERROR
            }
        };
    }

    // Pure, side-effect-free check for a no-op usage failure (missing
    // --from, or a source with nothing to install) -- must run BEFORE
    // any index write below, so a run that never touches the
    // filesystem never mutates a target's index entry either. Mirrors
    // update.rs's unregistered-strategy check, which runs before its
    // own write-ahead for the identical reason.
    if let Some(message) = strategy.would_fail_as_noop(&destination, from.as_deref()) {
        super::report::report_error(
            "install",
            "install.would_fail_as_noop",
            &destination,
            no_telemetry,
            &message,
            Vec::new(),
            json,
        );
        return EXIT_USAGE_ERROR;
    }

    // Refuse to silently switch strategies on a target already tracked
    // under a DIFFERENT strategy. `matches()` re-runs on every `install`
    // invocation (unlike `update.rs`, which pins to `current.strategy`
    // per design doc §7 -- see that module's own comment for why), and a
    // target directory can legitimately carry both a `.kiro` and a
    // `.claude` marker at once (see `runtime.rs`'s own `detects_both`
    // test), so two separate `install` runs against the same target can
    // genuinely select two different strategies. Both strategies write
    // to the SAME un-scoped `<target_dir>/.konductor/manifest`
    // (`manifest::manifest_path` takes no strategy parameter), and
    // `install_from_local` always wholesale-overwrites it with only the
    // CURRENT strategy's own file list -- switching strategies here
    // would silently drop the OTHER strategy's files from tracking
    // (they stay on disk but become invisible orphans to
    // `update`/`uninstall`) and would misclassify that strategy's own
    // still-present files as `Provenance::ReplacedForeign` on any later
    // re-install, since they are absent from the intervening manifest --
    // `uninstall.rs`'s `delete_eligible_files` never deletes a
    // `ReplacedForeign` path, so this corruption is permanent once it
    // happens. A read failure on the existing manifest is NOT this
    // check's concern: it falls through to `install_from_local`'s own
    // internal `read_manifest` call below, which surfaces the identical
    // error through the normal `install_error_exit_code` path.
    if let Ok(Some(existing)) = manifest::read_manifest(&destination) {
        if existing.strategy != strategy.name() {
            super::report::report_error(
                "install",
                "install.strategy_conflict",
                &destination,
                no_telemetry,
                &format!(
                    "{} was already installed with strategy '{}'; \
                     installing with '{}' would corrupt tracking for the prior \
                     strategy's files (they would become orphaned and un-removable). \
                     Run `konductor update` to refresh the existing '{}' install \
                     instead, or remove {} first if you intend to switch strategies.",
                    destination.display(),
                    existing.strategy,
                    strategy.name(),
                    existing.strategy,
                    manifest::manifest_path(&destination).display()
                ),
                Vec::new(),
                json,
            );
            return EXIT_USAGE_ERROR;
        }
    }

    // A hand-edited or otherwise corrupted index can carry the same
    // target_dir more than once. write_index's upsert (find-first,
    // replace-in-place) only fixes a duplicate that happens to match
    // THIS install's own canonical_target_dir, and even then only
    // replaces the first occurrence, leaving any further duplicate
    // stale rather than removing it -- so install is not exempt from
    // this guard; check and refuse exactly like update/uninstall do.
    // Runs BEFORE create_dir_all below: this validation reads the
    // whole index and does not depend on canonical_target_dir or the
    // destination existing at all, so -- like the would_fail_as_noop
    // check above it -- a rejection here must never leave a filesystem
    // side effect (an empty target directory) from a run that did no
    // real work.
    match index::read_index() {
        Ok(Some(index)) => {
            let duplicates = index::duplicate_target_dirs(&index.installs);
            if !duplicates.is_empty() {
                super::report::report_error(
                    "install",
                    "install.index_corrupted",
                    &destination,
                    no_telemetry,
                    &format!(
                        "install index is corrupted: duplicate target_dir \
                         entries found; fix ~/.konductor/installs by hand before running install. \
                         Duplicated target_dir(s):\n{}",
                        duplicates
                            .iter()
                            .map(|d| format!("  - {d}"))
                            .collect::<Vec<_>>()
                            .join("\n")
                    ),
                    vec![(
                        "duplicate_targets",
                        serde_json::Value::Array(
                            duplicates
                                .iter()
                                .map(|d| serde_json::Value::String(d.clone()))
                                .collect(),
                        ),
                    )],
                    json,
                );
                return EXIT_USAGE_ERROR;
            }
        }
        Ok(None) => {}
        Err(err) => {
            super::report::report_error(
                "install",
                "install.index_read_failed",
                &destination,
                no_telemetry,
                &format!("could not read install index: {err}"),
                Vec::new(),
                json,
            );
            return index_error_exit_code(&err);
        }
    }

    // Index write-ahead (design doc §2, step 2): brackets the strategy's
    // own manifest write-ahead/complete sequence (step 3-5) so a crash
    // anywhere from here on always leaves an index entry naming this
    // target -- never a fully-installed target invisible to `update`/
    // `uninstall`. Canonicalize BEFORE upserting, so `--target .` and an
    // equivalent absolute path register as the same entry. A failure to
    // canonicalize or write the index here is a usage error, same as any
    // other unresolvable-destination case -- install never proceeds with
    // an index write it can't perform.
    //
    // Destination must exist before canonicalizing: `std::fs::canonicalize`
    // errors on a path that doesn't exist yet, but a fresh, not-yet-created
    // `--target <dir>` is the primary use of `--target` --
    // `install_from_local` itself creates the destination on demand (every
    // per-content-type copy function calls `create_dir_all` on it; see
    // `kiro_cli.rs`). Create it first so canonicalization always has a real
    // path to resolve, keeping the write-ahead index entry genuinely
    // canonical (required for `update`/`uninstall`'s later exact-path
    // lookups). This runs AFTER the index corruption/schema check above,
    // so a rejection from that check never creates this directory either.
    if let Err(err) = std::fs::create_dir_all(&destination) {
        super::report::report_error(
            "install",
            "install.create_dir_failed",
            &destination,
            no_telemetry,
            &format!(
                "could not create install target {}: {err}",
                destination.display()
            ),
            Vec::new(),
            json,
        );
        return EXIT_USAGE_ERROR;
    }
    let canonical_target_dir = match index::canonicalize_target_dir(&destination) {
        Ok(path) => path,
        Err(err) => {
            super::report::report_error(
                "install",
                "install.canonicalize_failed",
                &destination,
                no_telemetry,
                &format!(
                    "could not resolve install target {}: {err}",
                    destination.display()
                ),
                Vec::new(),
                json,
            );
            return EXIT_USAGE_ERROR;
        }
    };

    let installed_at = crate::cli::time::utc_now_iso();
    if let Err(err) = index::write_index(index::IndexEntry {
        target_dir: canonical_target_dir.clone(),
        strategy: strategy.name().to_string(),
        installed_at: installed_at.clone(),
        status: index::IndexEntryStatus::InProgress,
    }) {
        super::report::report_error(
            "install",
            "install.index_write_failed",
            &destination,
            no_telemetry,
            &format!("could not write install index: {err}"),
            Vec::new(),
            json,
        );
        return index_error_exit_code(&err);
    }

    match strategy.install_from_local(&destination, from.as_deref(), &installed_at, no_telemetry) {
        Ok(()) => {
            // Computed BEFORE `canonical_target_dir` is moved into the
            // index-finalize write below -- reuses the SAME
            // canonicalized target_dir string and the SAME `installed_at`
            // clock read `index`/`manifest` already agree on (design doc
            // §1's single-clock-read rule), rather than a fresh
            // `utc_now_iso()` call or a second canonicalization pass.
            let link_bin_result = if link_bin {
                Some(bin_link::ensure_bin_link(
                    &canonical_target_dir,
                    &installed_at,
                ))
            } else {
                None
            };

            // Telemetry identity (design doc D.2/D.8/D.15): ensured here,
            // before the index finalize write below, so the identity file
            // is always on disk before any `report_cli_error` call in this
            // branch can populate the process-global identity cache. A
            // finalize failure calls `report_cli_error` on the way to
            // `report_package_installed` below -- if identity weren't
            // ensured until after that call, `report_cli_error` would
            // cache "no identity" (the file not yet written) for the rest
            // of the process, and `report_package_installed` would then
            // silently skip even though the install itself succeeded.
            // Structurally omitted when --no-telemetry is passed -- the
            // call is simply never invoked, rather than invoked-then-
            // checked.
            if !no_telemetry {
                crate::cli::telemetry::ensure_identity(&destination, strategy.name());
            }
            // Index complete (design doc §2, step 6): upserts the SAME
            // entry (by canonicalized target_dir) to Complete, after the
            // strategy's own manifest has already reached Complete.
            // Leaves the entry `InProgress` (self-healable via the
            // target's own manifest, per the design doc) rather than
            // failing the whole install over a write that happens after
            // all real file-copy work already succeeded.
            if let Err(err) = index::write_index(index::IndexEntry {
                target_dir: canonical_target_dir,
                strategy: strategy.name().to_string(),
                installed_at,
                status: index::IndexEntryStatus::Complete,
            }) {
                eprintln!("konductor install: could not finalize install index: {err}");
                crate::cli::telemetry::report_cli_error(
                    &destination,
                    "install",
                    "install.index_finalize_failed",
                    no_telemetry,
                );
            }
            // Fires report_package_installed alongside report_install_success,
            // once everything above has already succeeded.
            if !no_telemetry {
                crate::cli::telemetry::report_package_installed(&destination, strategy.name());
            }
            report_install_success(
                &destination,
                from.as_deref(),
                strategy.harness_dir(),
                verbose,
                json,
                link_bin_result,
            );
            0
        }
        Err(err) => {
            let message = err.to_string();
            super::report::report_error(
                "install",
                install_error_code(&err),
                &destination,
                no_telemetry,
                &message,
                Vec::new(),
                json,
            );
            install_error_exit_code(&err)
        }
    }
}

/// Prints the success-path report: re-reads the manifest
/// `install_from_local` just wrote at `destination` (the sole on-disk
/// record of what was installed -- see manifest.rs's module docstring)
/// and formats it per `json`/`verbose`. A missing/unreadable manifest
/// after a strategy reported success would be an internal
/// inconsistency, not a normal failure mode -- falls back to the old
/// fixed line in that case rather than panicking, so a future strategy
/// that doesn't yet write a manifest still gets SOME success output.
/// `harness_dir` is the harness directory name of whichever strategy
/// actually ran (`InstallStrategy::harness_dir()`), threaded through to
/// `count_staged_sops` so the reported SOP-skip count reads the correct
/// strategy's staged source rather than a fixed one.
///
/// `link_bin_result` is `Some(..)` only when `--link-bin` was requested
/// for this install. Its outcome is folded into the SAME report (a
/// `"link_bin"` field in `--json` mode, an extra line in plain-text
/// mode) rather than printed as its own separate document -- printing
/// two independent top-level JSON objects for one invocation broke
/// single-document `--json` consumers.
fn report_install_success(
    destination: &Path,
    from: Option<&str>,
    harness_dir: &str,
    verbose: bool,
    json: bool,
    link_bin_result: Option<Result<(PathBuf, bin_link::BinLinkOutcome), bin_link::BinLinkError>>,
) {
    let manifest = match manifest::read_manifest(destination) {
        Ok(Some(manifest)) => manifest,
        _ => {
            // Internal inconsistency (a strategy reported success but no
            // manifest is readable). Still honor `--json`, and emit the
            // SAME field shape as the normal path
            // (`format_install_summary_json`) with zeroed counts, so a
            // machine consumer never breaks on missing keys depending on
            // which branch ran.
            if json {
                let mut value = serde_json::json!({
                    "command": "install",
                    "destination": destination.display().to_string(),
                    "manifest_path": manifest::manifest_path(destination).display().to_string(),
                    "agents": 0,
                    "skills": 0,
                    "context": 0,
                    "bin": 0,
                    "sops_skipped": from
                        .map(|f| count_staged_sops(f, harness_dir))
                        .unwrap_or(0),
                    "replaced_foreign": 0,
                });
                if let Some(result) = &link_bin_result {
                    merge_link_bin_json(&mut value, result);
                }
                println!("{value}");
            } else {
                println!("konductor install: installed");
                if let Some(result) = &link_bin_result {
                    println!("{}", link_bin_report_line(result));
                }
            }
            return;
        }
    };
    let manifest_path = manifest::manifest_path(destination);
    let counts = InstallCounts::from_manifest(&manifest);
    // Count skipped SOPs from the source synth staged under the
    // strategy that actually ran's own harness directory, not a
    // hardcoded one, so the figure reflects this specific `--from`
    // source and this specific strategy.
    let sops_skipped = from.map(|f| count_staged_sops(f, harness_dir)).unwrap_or(0);

    if json {
        let mut value =
            format_install_summary_json(destination, &manifest_path, &counts, sops_skipped);
        if let Some(result) = &link_bin_result {
            merge_link_bin_json(&mut value, result);
        }
        println!("{value}");
        return;
    }

    println!(
        "{}",
        format_install_summary(destination, &manifest_path, &counts, sops_skipped)
    );
    if let Some(result) = &link_bin_result {
        println!("{}", link_bin_report_line(result));
    }
    if verbose {
        for line in format_install_verbose_lines(&manifest) {
            println!("{line}");
        }
    }
}

/// Inserts a `"link_bin"` field into `value` (which must be a JSON
/// object) describing `result` -- `{"requested": true, "link_path":
/// ..., "outcome": ...}` on success, or `{"requested": true, "error":
/// ...}` on failure. The single merge point every `--json` success
/// report (both the normal path and the missing-manifest fallback
/// above) uses, so the two never drift into different shapes for the
/// same field.
fn merge_link_bin_json(
    value: &mut serde_json::Value,
    result: &Result<(PathBuf, bin_link::BinLinkOutcome), bin_link::BinLinkError>,
) {
    let link_bin_value = match result {
        Ok((link_path, outcome)) => serde_json::json!({
            "requested": true,
            "link_path": link_path.display().to_string(),
            "outcome": bin_link_outcome_str(*outcome),
        }),
        Err(err) => serde_json::json!({
            "requested": true,
            "error": err.to_string(),
        }),
    };
    if let Some(object) = value.as_object_mut() {
        object.insert("link_bin".to_string(), link_bin_value);
    }
}

fn bin_link_outcome_str(outcome: bin_link::BinLinkOutcome) -> &'static str {
    match outcome {
        bin_link::BinLinkOutcome::Created => "created",
        bin_link::BinLinkOutcome::SelfHealed => "self_healed",
        bin_link::BinLinkOutcome::AlreadyCurrent => "already_current",
    }
}

/// Plain-text equivalent of `merge_link_bin_json`'s success/failure
/// content, printed as one extra line after the install summary line
/// (never a second top-level document -- see this function's own
/// callers).
fn link_bin_report_line(
    result: &Result<(PathBuf, bin_link::BinLinkOutcome), bin_link::BinLinkError>,
) -> String {
    match result {
        Ok((link_path, bin_link::BinLinkOutcome::Created)) => format!(
            "konductor install: linked {} -> the currently-running konductor binary",
            link_path.display()
        ),
        Ok((link_path, bin_link::BinLinkOutcome::SelfHealed)) => format!(
            "konductor install: {} pointed at a different konductor binary; repointed \
             it at the currently-running one",
            link_path.display()
        ),
        Ok((link_path, bin_link::BinLinkOutcome::AlreadyCurrent)) => format!(
            "konductor install: {} already points at the currently-running konductor \
             binary; left unchanged",
            link_path.display()
        ),
        Err(err) => format!("konductor install --link-bin: {err}"),
    }
}

/// Per-content-type counts derived from a written manifest's
/// `files[]`, plus how many were `Provenance::ReplacedForeign`. Content
/// type is inferred from each file's path prefix -- `.kiro/agents/`,
/// `.kiro/context/`, `.konductor/skills/`, `.konductor/bin/` for
/// `KiroCliInstallStrategy`, and `.claude/agents/`, `.claude/skills/`
/// for `ClaudeInstallStrategy` (built from that strategy's own
/// `CLAUDE_DESTINATION_ROOT`/`AGENTS_CONTENT_TYPE_DIR`/
/// `SKILLS_CONTENT_TYPE_DIR` constants, not a new hardcoded literal) --
/// the same prefixes each strategy's own copy functions always write,
/// so this stays in sync with install's real output by construction
/// rather than by a second hand-maintained list. `skills` counts
/// distinct skill DIRECTORIES (a skill may hold auxiliary files beyond
/// `SKILL.md`) across BOTH strategies' skill roots; agents, context,
/// and bin entries are one file each.
struct InstallCounts {
    agents: usize,
    skills: usize,
    context: usize,
    bin: usize,
    replaced_foreign: usize,
}

impl InstallCounts {
    fn from_manifest(manifest: &manifest::Manifest) -> Self {
        use crate::cli::synth::kiro_cli_v2::{AGENTS_CONTENT_TYPE_DIR, SKILLS_CONTENT_TYPE_DIR};
        let claude_agents_prefix = format!(
            "{}/{AGENTS_CONTENT_TYPE_DIR}/",
            claude::CLAUDE_DESTINATION_ROOT
        );
        let claude_skills_prefix = format!(
            "{}/{SKILLS_CONTENT_TYPE_DIR}/",
            claude::CLAUDE_DESTINATION_ROOT
        );

        // A skill is a DIRECTORY that may hold SKILL.md plus auxiliary
        // files, so count DISTINCT skill directories (the `<name>`
        // segment right after `.konductor/skills/` or `.claude/skills/`),
        // not one per file -- otherwise a skill with scripts would
        // inflate the count. Agents, context, and bin entries are one
        // file each, so a per-file count is exact for them.
        let mut agents = 0;
        let mut context = 0;
        let mut bin = 0;
        let mut replaced_foreign = 0;
        let mut skill_dirs: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for file in &manifest.files {
            if let Some(rest) = file.path.strip_prefix(".konductor/skills/") {
                if let Some(name) = rest.split('/').next().filter(|s| !s.is_empty()) {
                    skill_dirs.insert(name);
                }
            } else if let Some(rest) = file.path.strip_prefix(claude_skills_prefix.as_str()) {
                if let Some(name) = rest.split('/').next().filter(|s| !s.is_empty()) {
                    skill_dirs.insert(name);
                }
            } else if file.path.starts_with(".kiro/agents/")
                || file.path.starts_with(claude_agents_prefix.as_str())
            {
                agents += 1;
            } else if file.path.starts_with(".kiro/context/") {
                context += 1;
            } else if file.path.starts_with(".konductor/bin/") {
                bin += 1;
            }
            if file.provenance == Provenance::ReplacedForeign {
                replaced_foreign += 1;
            }
        }
        InstallCounts {
            agents,
            skills: skill_dirs.len(),
            context,
            bin,
            replaced_foreign,
        }
    }
}

/// Builds the one-line default-mode summary `dispatch_install` prints
/// on success: destination, per-content-type counts, manifest path,
/// the SOP-skip note, and the foreign-overwrite count.
fn format_install_summary(
    destination: &Path,
    manifest_path: &Path,
    counts: &InstallCounts,
    sops_skipped: usize,
) -> String {
    format!(
        "konductor install: installed {} agent(s), {} skill(s), {} context file(s), {} \
         MCP server binary(ies) to {} (manifest: {}); skipped {} SOP(s) (no runtime \
         discovery path yet); overwrote {} pre-existing file(s) not created by Konductor",
        counts.agents,
        counts.skills,
        counts.context,
        counts.bin,
        destination.display(),
        manifest_path.display(),
        sops_skipped,
        counts.replaced_foreign,
    )
}

/// Builds the additional per-file detail lines `-v`/`--verbose` prints
/// after the summary: one line per installed file's manifest path and
/// provenance.
fn format_install_verbose_lines(manifest: &manifest::Manifest) -> Vec<String> {
    manifest
        .files
        .iter()
        .map(|file| format!("  {} ({:?})", file.path, file.provenance))
        .collect()
}

/// Builds the `--json` structured equivalent of `format_install_summary`:
/// a JSON object carrying the same counts as the human-readable summary.
/// Returns the `serde_json::Value` itself (not a pre-serialized string)
/// so `report_install_success` can merge in an additional `"link_bin"`
/// field before printing -- one top-level JSON document per invocation,
/// never two (see that function's own doc comment).
fn format_install_summary_json(
    destination: &Path,
    manifest_path: &Path,
    counts: &InstallCounts,
    sops_skipped: usize,
) -> serde_json::Value {
    serde_json::json!({
        "command": "install",
        "destination": destination.display().to_string(),
        "manifest_path": manifest_path.display().to_string(),
        "agents": counts.agents,
        "skills": counts.skills,
        "context": counts.context,
        "bin": counts.bin,
        "sops_skipped": sops_skipped,
        "replaced_foreign": counts.replaced_foreign,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::MutexGuard;

    use crate::cli::test_home_lock::lock_home;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-install-dispatch-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed_synthed_agent(repo_root: &Path, name: &str) {
        let dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.json")), b"{}\n").unwrap();
    }

    /// Same role as `seed_synthed_agent`, scoped to
    /// `ClaudeInstallStrategy`'s own harness directory
    /// (`claude::CLAUDE_HARNESS_DIR`) and file extension (`.md`).
    fn seed_synthed_claude_agent(repo_root: &Path, name: &str) {
        let dir = repo_root
            .join("dist")
            .join(claude::CLAUDE_HARNESS_DIR)
            .join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.md")), b"---\nname: x\n---\n").unwrap();
    }

    /// Same role as `seed_synthed_agent`, scoped to
    /// `KiroCliV3InstallStrategy`'s own harness directory
    /// (`KiroCliV3Transformer.name()`, `"kiro-v3"`).
    fn seed_synthed_kiro_v3_agent(repo_root: &Path, name: &str) {
        let dir = repo_root.join("dist").join("kiro-v3").join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.json")), b"{}\n").unwrap();
    }

    /// RAII guard for tests that mutate the process-global `HOME` env
    /// var. Acquires the crate-wide `test_home_lock::HOME_ENV_LOCK` for
    /// its entire lifetime (see that module's doc comment for why this
    /// must be shared across every module, not private to this one),
    /// points `HOME` at a fresh scratch temp dir, and on `Drop` restores
    /// the original `HOME` and removes the scratch dir.
    struct HomeGuard {
        _lock: MutexGuard<'static, ()>,
        scratch: PathBuf,
        original_home: Option<std::ffi::OsString>,
    }

    impl HomeGuard {
        fn new(label: &str) -> Self {
            let lock = lock_home();

            let scratch = scratch_dir(label);
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

    #[test]
    fn dispatch_install_without_local_fails_with_usage_error() {
        let _home = HomeGuard::new("no-local-home");
        let dir = scratch_dir("no-local");
        let code = dispatch_install_with(
            None,
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert!(manifest::read_manifest(&dir).unwrap().is_none());
        fs::remove_dir_all(&dir).ok();
    }

    /// A missing `--from` is a pure no-op usage error -- `install`
    /// must never write ANY index entry for this target, and must
    /// never even create the target directory, since no filesystem
    /// work was ever going to happen. Confirms both: no entry exists
    /// in the index at all, and the target directory itself was never
    /// created.
    ///
    /// Falsifiability: confirmed this test fails against the pre-fix
    /// ordering (index write-ahead before the no-op check) -- the
    /// target directory gets created by `create_dir_all`, and an
    /// `InProgress` index entry is written for it before
    /// `install_from_local` ever runs its own `--from` validation and
    /// fails. Restored immediately after confirming the failure.
    #[test]
    fn dispatch_install_missing_from_leaves_no_index_entry_and_no_target_dir() {
        let _home = HomeGuard::new("missing-from-no-index-home");
        let parent = scratch_dir("missing-from-no-index-parent");
        let target = parent.join("not-yet-created-target");
        assert!(!target.exists());

        let code = dispatch_install_with(
            None,
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        assert!(
            !target.exists(),
            "a pure no-op failure must never create the target directory"
        );
        let index = index::read_index().unwrap();
        let has_entry = index
            .map(|i| {
                i.installs
                    .iter()
                    .any(|e| e.target_dir.contains("not-yet-created-target"))
            })
            .unwrap_or(false);
        assert!(
            !has_entry,
            "a missing --from must never write an index entry for this target"
        );

        fs::remove_dir_all(&parent).ok();
    }

    /// Writes a raw `~/.konductor/installs` file under `home`'s
    /// `.konductor/` directory, bypassing `write_index` entirely, so
    /// tests can seed an index in a state `write_index` itself would
    /// never produce (duplicate entries, an unsupported
    /// `schema_version`).
    fn seed_raw_index(home: &Path, contents: &str) {
        let dir = home.join(".konductor");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("installs"), contents).unwrap();
    }

    /// A corrupted index (duplicate `target_dir` entries) is rejected
    /// by the `read_index()` + `duplicate_target_dirs` guard -- this
    /// must run before `create_dir_all`, so the rejection never leaves
    /// an empty target directory on disk, exactly like the
    /// `would_fail_as_noop` no-op case above.
    ///
    /// Falsifiability: confirmed this test fails against the pre-fix
    /// ordering (create_dir_all before the index corruption check) --
    /// the target directory gets created before `read_index()` ever
    /// runs its duplicate check and fails. Restored immediately after
    /// confirming the failure.
    #[test]
    fn dispatch_install_duplicate_index_leaves_no_target_dir() {
        let _home = HomeGuard::new("duplicate-index-no-target-dir-home");
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        seed_raw_index(
            &home,
            r#"{
  "schema_version": 1,
  "installs": [
    {
      "target_dir": "/tmp/duplicate-a",
      "strategy": "kiro-cli",
      "installed_at": "2026-01-01T00:00:00Z",
      "status": "Complete"
    },
    {
      "target_dir": "/tmp/duplicate-a",
      "strategy": "kiro-cli",
      "installed_at": "2026-01-01T00:00:00Z",
      "status": "Complete"
    }
  ]
}
"#,
        );

        let parent = scratch_dir("duplicate-index-no-target-dir-parent");
        let target = parent.join("not-yet-created-target");
        assert!(!target.exists());
        let repo_root = scratch_dir("duplicate-index-no-target-dir-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        assert!(
            !target.exists(),
            "a rejection from a corrupted (duplicate-entry) index must never create the target directory"
        );

        fs::remove_dir_all(&parent).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// An index carrying an unsupported `schema_version` is rejected
    /// by the same `read_index()` guard, mapped to `EXIT_VERIFY_FAILED`
    /// (65) via `index_error_exit_code`. Like the duplicate-entry case
    /// above, this rejection must never create the target directory.
    ///
    /// Falsifiability: confirmed this test fails against the pre-fix
    /// ordering for the same reason as the duplicate-entry case above
    /// -- `create_dir_all` runs before `read_index()`'s schema check.
    /// Restored immediately after confirming the failure.
    #[test]
    fn dispatch_install_unsupported_schema_version_leaves_no_target_dir() {
        let _home = HomeGuard::new("bad-schema-no-target-dir-home");
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        seed_raw_index(
            &home,
            r#"{
  "schema_version": 999,
  "installs": []
}
"#,
        );

        let parent = scratch_dir("bad-schema-no-target-dir-parent");
        let target = parent.join("not-yet-created-target");
        assert!(!target.exists());
        let repo_root = scratch_dir("bad-schema-no-target-dir-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(
            code, EXIT_VERIFY_FAILED,
            "an unsupported index schema_version must map to EXIT_VERIFY_FAILED (65), \
             same as update/uninstall's read_index() handling"
        );

        assert!(
            !target.exists(),
            "a rejection from an unsupported index schema_version must never create the target directory"
        );

        fs::remove_dir_all(&parent).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn dispatch_install_with_local_writes_manifest_and_returns_zero() {
        let _home = HomeGuard::new("with-local-flag-home");
        let dir = scratch_dir("with-local-flag");
        let repo_root = scratch_dir("with-local-flag-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, 0);
        assert!(manifest::read_manifest(&dir).unwrap().is_some());
        assert!(dir.join(".kiro/agents/k-example.json").is_file());

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Regression: the strategy-mismatch guard in `dispatch_install_with`
    /// prevents a target already tracked under one strategy from being
    /// silently re-installed under a different one, which would overwrite
    /// `.konductor/manifest` and drop the other strategy's files from
    /// tracking. Exercised via two explicit, different `--harness` values
    /// on the same target. Dual-marker auto-detection is gone now that
    /// `--harness` is mandatory, but the guard must still hold when a
    /// caller explicitly asks to switch strategies -- mandatory
    /// `--harness` doesn't make that any safer.
    #[test]
    fn dispatch_install_refuses_to_switch_strategy_on_an_already_tracked_target() {
        let _home = HomeGuard::new("refuse-strategy-switch-home");
        let dir = scratch_dir("refuse-strategy-switch");
        let claude_repo_root = scratch_dir("refuse-strategy-switch-claude-repo");
        let kiro_repo_root = scratch_dir("refuse-strategy-switch-kiro-repo");
        seed_synthed_claude_agent(&claude_repo_root, "k-example");
        seed_synthed_agent(&kiro_repo_root, "k-example");

        // First install: explicit `--harness claude` selects
        // ClaudeInstallStrategy.
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let first_code = dispatch_install_with(
            Some(claude_repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "claude".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(first_code, 0);
        let manifest_after_first = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest_after_first.strategy, "claude-code");
        assert!(dir.join(".claude/agents/k-example.md").is_file());

        // Second install: a DIFFERENT explicit `--harness kiro-cli-v2` on
        // the SAME already-tracked target -- must be refused by the
        // strategy-mismatch guard, regardless of the `.kiro` marker
        // created below (irrelevant to selection now, but kept to show
        // the guard fires even when a marker would have agreed with the
        // switch).
        fs::create_dir_all(dir.join(".kiro")).unwrap();
        let second_code = dispatch_install_with(
            Some(kiro_repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(
            second_code, EXIT_USAGE_ERROR,
            "must refuse rather than silently switch strategies"
        );

        // The manifest must be UNCHANGED -- still Claude's, still
        // naming the Claude-installed file -- proving the refusal
        // happened before any write, not after a partial overwrite.
        let manifest_after_second = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest_after_second.strategy, "claude-code");
        assert!(dir.join(".claude/agents/k-example.md").is_file());
        assert!(
            !dir.join(".kiro/agents/k-example.json").is_file(),
            "the refused install must never have copied any Kiro file either"
        );

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&claude_repo_root).ok();
        fs::remove_dir_all(&kiro_repo_root).ok();
    }

    // ── explicit --harness selection ─────────────────────────────────────

    /// `--harness kiro-cli-v2` must select `KiroCliInstallStrategy` on a
    /// completely undetected target -- proving the flag actually drives
    /// selection through `harness_dir()`, not just happening to agree
    /// with what auto-detection would have picked anyway (this case
    /// would ALSO auto-select Kiro, since an undetected target is Kiro's
    /// own default -- the explicit-harness case is exercised more
    /// meaningfully by the override test below).
    #[test]
    fn dispatch_install_explicit_harness_kiro_cli_v2_selects_kiro_strategy() {
        let _home = HomeGuard::new("explicit-harness-kiro-home");
        let dir = scratch_dir("explicit-harness-kiro");
        let repo_root = scratch_dir("explicit-harness-kiro-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, 0);
        let manifest = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest.strategy, "kiro-cli");
        assert!(dir.join(".kiro/agents/k-example.json").is_file());

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `--harness claude` must select `ClaudeInstallStrategy` on a
    /// completely undetected target (no `.kiro` or `.claude` marker
    /// present at all) -- proving `--harness` is the SOLE input to
    /// strategy selection now: an undetected target has no marker for
    /// any `matches()`-based auto-detection to have read even if it
    /// still ran (which it does not any more; see `dispatch_install_with`'s
    /// own doc comment), so selecting Claude here can only come from the
    /// explicit `--harness` value.
    #[test]
    fn dispatch_install_explicit_harness_claude_selects_claude_on_undetected_target() {
        let _home = HomeGuard::new("explicit-harness-claude-home");
        let dir = scratch_dir("explicit-harness-claude");
        let repo_root = scratch_dir("explicit-harness-claude-repo");
        seed_synthed_claude_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "claude".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(
            code, 0,
            "--harness claude must succeed on a completely undetected target"
        );
        let manifest = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest.strategy, "claude-code");
        assert!(dir.join(".claude/agents/k-example.md").is_file());
        assert!(
            !dir.join(".kiro/agents/k-example.json").is_file(),
            "explicit --harness claude must never also install Kiro content"
        );

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `--harness kiro-v3` must select `KiroCliV3InstallStrategy` on a
    /// completely undetected target, copying the synthed agent verbatim
    /// into `.kiro/agents/` and recording `kiro-cli-v3` as the manifest's
    /// strategy -- proving `--harness kiro-v3` actually reaches a real,
    /// working install strategy end to end, with no "no consumer for
    /// this harness" scope gap.
    #[test]
    fn dispatch_install_explicit_harness_kiro_v3_selects_kiro_v3_strategy() {
        let _home = HomeGuard::new("explicit-harness-v3-home");
        let dir = scratch_dir("explicit-harness-v3");
        let repo_root = scratch_dir("explicit-harness-v3-repo");
        seed_synthed_kiro_v3_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-v3".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(
            code, 0,
            "--harness kiro-v3 must succeed on a completely undetected target"
        );
        let manifest = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest.strategy, "kiro-cli-v3");
        assert!(dir.join(".kiro/agents/k-example.json").is_file());

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A target already installed via `--harness kiro-cli-v2` must
    /// refuse a subsequent `--harness kiro-v3` install rather than
    /// silently corrupting the V2 install's tracked files -- both write
    /// under the same `.kiro`/`.konductor` roots, so this exercises
    /// `dispatch_install_with`'s existing strategy-conflict check
    /// (`existing.strategy != strategy.name()`) across the two Kiro CLI
    /// strategies specifically, not just Kiro-vs-Claude.
    #[test]
    fn dispatch_install_refuses_to_switch_from_kiro_cli_v2_to_kiro_v3() {
        let _home = HomeGuard::new("v2-then-v3-conflict-home");
        let dir = scratch_dir("v2-then-v3-conflict");
        let v2_repo_root = scratch_dir("v2-then-v3-conflict-v2-repo");
        let v3_repo_root = scratch_dir("v2-then-v3-conflict-v3-repo");
        seed_synthed_agent(&v2_repo_root, "k-example");
        seed_synthed_kiro_v3_agent(&v3_repo_root, "k-example");

        let first_code = dispatch_install_with(
            Some(v2_repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(first_code, 0);

        let second_code = dispatch_install_with(
            Some(v3_repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-v3".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(
            second_code, EXIT_USAGE_ERROR,
            "must refuse rather than silently switch strategies"
        );

        let manifest_after_second = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest_after_second.strategy, "kiro-cli");

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&v2_repo_root).ok();
        fs::remove_dir_all(&v3_repo_root).ok();
    }

    // ── --target into a fresh, not-yet-existing dir ─────────────────────

    /// `konductor install --target <dir>` where `<dir>` does not exist
    /// yet -- the primary, most common `--target` use case -- must
    /// succeed end to end. Exercises the real `dispatch_install_with`
    /// path (not just `canonicalize_target_dir` in isolation), against
    /// a directory obtained via scratch-dir creation plus an unrealized
    /// subdirectory appended, so the target itself is guaranteed not to
    /// exist before this call.
    #[test]
    fn dispatch_install_into_fresh_nonexistent_target_dir_succeeds() {
        let _home = HomeGuard::new("fresh-target-dir-home");
        let parent = scratch_dir("fresh-target-dir-parent");
        let fresh_target = parent.join("brand-new-subdir-that-does-not-exist-yet");
        assert!(!fresh_target.exists());

        let repo_root = scratch_dir("fresh-target-dir-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(fresh_target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(
            code, 0,
            "install --target into a fresh, not-yet-existing directory must succeed"
        );
        assert!(fresh_target.is_dir());
        assert!(manifest::read_manifest(&fresh_target).unwrap().is_some());
        assert!(fresh_target.join(".kiro/agents/k-example.json").is_file());

        // The index entry for this target must have been written with a
        // real, canonical (existence-requiring) path -- confirms
        // install creates the dir then canonicalizes, rather than
        // falling back to some non-canonical representation.
        let canonical = index::canonicalize_target_dir(&fresh_target).unwrap();
        let idx = index::read_index().unwrap().unwrap();
        let entry = idx
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect("fresh target must be tracked with its canonical path");
        assert_eq!(entry.status, index::IndexEntryStatus::Complete);

        fs::remove_dir_all(&parent).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Finding f-3e8df55d: the index entry's `installed_at` and the
    /// manifest's own `installed_at` must be captured from the SAME
    /// clock read, not two independent `utc_now_iso()` calls moments
    /// apart -- per `designs/konductor-cli-install-index.md` §1. Runs a
    /// real `dispatch_install_with`, then reads BOTH records back and
    /// asserts the two `installed_at` strings are byte-identical.
    #[test]
    fn dispatch_install_index_entry_and_manifest_installed_at_are_byte_identical() {
        let _home = HomeGuard::new("installed-at-identical-home");
        let target = scratch_dir("installed-at-identical-target");
        let repo_root = scratch_dir("installed-at-identical-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, 0);

        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let idx = index::read_index().unwrap().unwrap();
        let entry = idx
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect("target must be tracked in the index after install");

        let manifest = manifest::read_manifest(&target)
            .unwrap()
            .expect("manifest must exist after a successful install");

        assert_eq!(
            entry.installed_at, manifest.installed_at,
            "the index entry's installed_at and the manifest's installed_at must be the \
             SAME string -- captured at the same instant, not two independent clock reads"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn dispatch_install_never_returns_reserved_exit_code_2() {
        let _home = HomeGuard::new("never-code-2-home");
        let dir = scratch_dir("never-code-2");
        assert_ne!(
            dispatch_install_with(
                None,
                Some(dir.to_str().unwrap().to_string()),
                "kiro-cli-v2".to_string(),
                false,
                false,
                false,
                false,
            ),
            2
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// A corrupted index (duplicate `target_dir` entries, hand-edited or
    /// otherwise not producible by `write_index`'s own upsert path) must
    /// be rejected by `install` before it writes anything, exactly like
    /// `update`/`uninstall` already do -- `install`'s own upsert only
    /// safely fixes a duplicate matching its own target, and even then
    /// only the first occurrence (see the guard's own comment at its
    /// call site), so a pre-existing duplicate elsewhere is left
    /// unresolved by proceeding.
    #[test]
    fn dispatch_install_rejects_corrupted_index_with_duplicate_target_dir() {
        let _home = HomeGuard::new("install-duplicate-target-dir-home");
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();
        let index_path = home.join(".konductor").join("installs");
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(
            &index_path,
            br#"{"schema_version":1,"installs":[
                {"target_dir":"/tmp/dup-install-target","strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","status":"complete"},
                {"target_dir":"/tmp/dup-install-target","strategy":"kiro-cli","installed_at":"2026-01-16T09:30:00Z","status":"complete"}
            ]}"#,
        )
        .unwrap();

        let dir = scratch_dir("install-duplicate-target-dir");
        let code = dispatch_install_with(
            None,
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        // Must refuse before ever writing a manifest for this target.
        assert!(manifest::read_manifest(&dir).unwrap().is_none());
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

    /// `index_error_exit_code` must map `UnsupportedSchemaVersion`
    /// specifically to `EXIT_VERIFY_FAILED` (65) -- the same split
    /// `update.rs`/`uninstall.rs` already apply for the identical
    /// index error via their own `index_error_exit_code`.
    #[test]
    fn index_error_exit_code_maps_unsupported_schema_version_to_65() {
        let err = index::IndexError::UnsupportedSchemaVersion {
            path: PathBuf::from("/tmp/.konductor/installs"),
            found: 99,
            supported: 1,
        };
        assert_eq!(index_error_exit_code(&err), EXIT_VERIFY_FAILED);
    }

    /// Every other `IndexError` variant must map to `EXIT_USAGE_ERROR`
    /// (64) -- confirms only `UnsupportedSchemaVersion` gets the 65
    /// treatment.
    #[test]
    fn index_error_exit_code_maps_every_other_variant_to_64() {
        let read_failed = index::IndexError::ReadFailed {
            path: PathBuf::from("/tmp/.konductor/installs"),
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "gone"),
        };
        assert_eq!(index_error_exit_code(&read_failed), EXIT_USAGE_ERROR);

        let malformed = index::IndexError::Malformed {
            path: PathBuf::from("/tmp/.konductor/installs"),
            source: serde_json::from_str::<serde_json::Value>("not json").unwrap_err(),
        };
        assert_eq!(index_error_exit_code(&malformed), EXIT_USAGE_ERROR);

        let non_utf8 = index::IndexError::NonUtf8Path {
            path: PathBuf::from("/tmp/.konductor/installs"),
        };
        assert_eq!(index_error_exit_code(&non_utf8), EXIT_USAGE_ERROR);

        // An unresolvable $HOME is a "can't determine anything" usage
        // "can't determine anything" usage error, never a
        // state/verification failure -- there is no index file to be
        // wrong about, only the caller's environment is unresolvable.
        assert_eq!(
            index_error_exit_code(&index::IndexError::UnresolvableHome),
            EXIT_USAGE_ERROR,
            "UnresolvableHome must map to EXIT_USAGE_ERROR (64), not EXIT_VERIFY_FAILED (65)"
        );
    }

    /// End-to-end: `install`'s `read_index()` error arm must return
    /// `EXIT_VERIFY_FAILED` (65) for a real on-disk index carrying an
    /// unsupported `schema_version`, not the unconditional 64 it
    /// returned before this fix -- confirms `install` now exits the
    /// same way `update`/`uninstall` already do for the identical
    /// corrupted index (finding f-85517366). A valid `--from` with a
    /// real synthed source is supplied so `would_fail_as_noop`'s own
    /// pre-check (a no-op usage error unrelated to this finding) does
    /// not short-circuit before the index is ever read.
    #[test]
    fn dispatch_install_unsupported_index_schema_version_exits_65_not_64() {
        let _home = HomeGuard::new("install-schema-version-65-home");
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();
        let index_path = home.join(".konductor").join("installs");
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(&index_path, br#"{"schema_version":99,"installs":[]}"#).unwrap();

        let repo_root = scratch_dir("install-schema-version-65-repo");
        seed_synthed_agent(&repo_root, "k-example");
        let dir = scratch_dir("install-schema-version-65");
        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(
            code, EXIT_VERIFY_FAILED,
            "an unsupported install-index schema_version must exit 65, matching \
             update/uninstall's exit code for the identical corrupted index"
        );
        // Must refuse before ever writing a manifest for this target.
        assert!(manifest::read_manifest(&dir).unwrap().is_none());
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A real read error (e.g. malformed JSON, not an unsupported
    /// schema version) must still exit `EXIT_USAGE_ERROR` (64) --
    /// confirms the 65 split above is specific to
    /// `UnsupportedSchemaVersion`, not every index-read failure. Same
    /// valid-`--from` setup as the 65 case above, for the same reason.
    #[test]
    fn dispatch_install_malformed_index_still_exits_64() {
        let _home = HomeGuard::new("install-malformed-index-64-home");
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();
        let index_path = home.join(".konductor").join("installs");
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(&index_path, b"not json").unwrap();

        let repo_root = scratch_dir("install-malformed-index-64-repo");
        seed_synthed_agent(&repo_root, "k-example");
        let dir = scratch_dir("install-malformed-index-64");
        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Regression for the write_index(InProgress) call site inside
    /// `dispatch_install_with`: a schema-version race where the index
    /// passes the earlier `read_index()` corruption/schema check but
    /// then fails on the write_index(InProgress) call itself (another
    /// process rewrote the index with an unsupported schema_version in
    /// between) must still map to `EXIT_VERIFY_FAILED` (65), not a
    /// hardcoded 64. Exercised directly against `write_index` (which
    /// internally calls `read_index_at_home` and hits the exact same
    /// `UnsupportedSchemaVersion` error this call site must route
    /// through `index_error_exit_code` rather than hand-rolling its own
    /// exit code) -- this pins the mapping this call site now applies,
    /// matching install.rs's own `index_error_exit_code` unit tests
    /// above for the identical error variant.
    #[test]
    fn write_index_call_site_error_routes_through_index_error_exit_code() {
        let _home = HomeGuard::new("install-write-index-race-65-home");
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap();
        let index_path = home.join(".konductor").join("installs");
        fs::create_dir_all(index_path.parent().unwrap()).unwrap();
        fs::write(&index_path, br#"{"schema_version":99,"installs":[]}"#).unwrap();

        let err = index::write_index(index::IndexEntry {
            target_dir: "/tmp/whatever".to_string(),
            strategy: "kiro-cli".to_string(),
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: index::IndexEntryStatus::InProgress,
        })
        .expect_err("write_index against an unsupported-schema-version index must fail");
        assert_eq!(
            index_error_exit_code(&err),
            EXIT_VERIFY_FAILED,
            "a write_index failure caused by UnsupportedSchemaVersion must map to 65, \
             matching the mapping install.rs's write_index(InProgress) call site now applies \
             instead of a hardcoded 64"
        );
    }

    /// `install_error_exit_code` must map an `InstallError::Manifest`
    /// wrapping `UnsupportedSchemaVersion` to `EXIT_VERIFY_FAILED` (65)
    /// -- the same split `manifest_error_exit_code` already applies in
    /// `update.rs`/`uninstall.rs` for the identical condition.
    #[test]
    fn install_error_exit_code_maps_unsupported_schema_version_to_65() {
        let err = InstallError::Manifest(manifest::ManifestError::UnsupportedSchemaVersion {
            path: PathBuf::from("/tmp/.konductor/manifest"),
            found: 99,
            supported: manifest::SCHEMA_VERSION,
        });
        assert_eq!(install_error_exit_code(&err), EXIT_VERIFY_FAILED);
    }

    /// Every other `InstallError` -- a different `ManifestError`
    /// variant, or a plain `Message` (a missing `--from`, no synthed
    /// files, an I/O failure while copying) -- must map to
    /// `EXIT_USAGE_ERROR` (64), confirming only the schema-version case
    /// gets the 65 treatment.
    #[test]
    fn install_error_exit_code_maps_every_other_variant_to_64() {
        let read_failed = InstallError::Manifest(manifest::ManifestError::ReadFailed {
            path: PathBuf::from("/tmp/.konductor/manifest"),
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "gone"),
        });
        assert_eq!(install_error_exit_code(&read_failed), EXIT_USAGE_ERROR);

        let message =
            InstallError::Message("no synthed agent, skill, or context files found".to_string());
        assert_eq!(install_error_exit_code(&message), EXIT_USAGE_ERROR);
    }

    /// End-to-end: re-installing over a target whose `.konductor/manifest`
    /// carries an unsupported `schema_version` -- the exact scenario
    /// finding f-142c2fde describes -- must exit `EXIT_VERIFY_FAILED`
    /// (65) via `dispatch_install_with`'s own call to
    /// `install_from_local`, not the unconditional 64 it returned
    /// before this fix. Seeds the corrupted manifest directly (bypassing
    /// a real first install) so this exercises `install_from_local`'s
    /// own internal `read_manifest` call -- the exact read the finding
    /// says was being flattened to a string and reported as 64.
    #[test]
    fn dispatch_install_reinstall_over_unsupported_manifest_schema_version_exits_65_not_64() {
        let _home = HomeGuard::new("install-manifest-schema-65-home");
        let dir = scratch_dir("install-manifest-schema-65-target");
        let manifest_path = manifest::manifest_path(&dir);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(
            &manifest_path,
            br#"{"schema_version":99,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();

        let repo_root = scratch_dir("install-manifest-schema-65-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(
            code, EXIT_VERIFY_FAILED,
            "re-installing over a target with an unsupported manifest schema_version must exit \
             65, matching update/uninstall's exit code for the identical corrupted manifest"
        );

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The identical corrupted-manifest condition, but with a
    /// genuinely malformed (non-JSON) manifest rather than an
    /// unsupported schema_version, must still exit `EXIT_USAGE_ERROR`
    /// (64) -- confirming the 65 split is specific to
    /// `UnsupportedSchemaVersion`, not every manifest-read failure.
    #[test]
    fn dispatch_install_reinstall_over_malformed_manifest_still_exits_64() {
        let _home = HomeGuard::new("install-manifest-malformed-64-home");
        let dir = scratch_dir("install-manifest-malformed-64-target");
        let manifest_path = manifest::manifest_path(&dir);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, b"not json").unwrap();

        let repo_root = scratch_dir("install-manifest-malformed-64-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            false,
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn resolve_destination_uses_target_when_given() {
        let resolved = resolve_destination(Some("/tmp/some-target")).unwrap();
        assert_eq!(resolved, PathBuf::from("/tmp/some-target"));
    }

    #[test]
    fn resolve_destination_dot_target_reproduces_cwd_behavior() {
        // `--target .` must resolve to a relative "." path -- callers
        // that then join a relative subpath onto it behave exactly as
        // the pre-`--target` cwd-as-destination code did (a relative
        // path is resolved against the process's cwd by every
        // filesystem call downstream).
        let resolved = resolve_destination(Some(".")).unwrap();
        assert_eq!(resolved, PathBuf::from("."));
    }

    #[test]
    fn resolve_destination_falls_back_to_home_when_no_target() {
        // Reads the real process-global $HOME (no HomeGuard override --
        // this test wants the ambient value, not a scratch dir), so it
        // must still take the crate-wide HOME_ENV_LOCK for the duration
        // of the read: without it, this read can interleave with any
        // other HOME-mutating test's `set_var`/`remove_var` and observe
        // a torn or unrelated value (confirmed: this test raced
        // `HomeGuard`-holding tests in other modules under `cargo test`'s
        // default parallelism -- see `test_home_lock`'s own doc comment).
        let _lock = lock_home();
        let resolved = resolve_destination(None);
        // Whether this succeeds depends on the test-runner's own $HOME,
        // which this test does not control (see the safety requirement
        // that only integration-style tests override $HOME via a
        // dedicated home-dir parameter, never the global env var, from
        // parallel `cargo test` threads). Only assert it never panics
        // and, if $HOME is set, matches it exactly.
        if let Some(home) = std::env::var_os("HOME") {
            if !home.is_empty() {
                assert_eq!(resolved.unwrap(), PathBuf::from(home));
            }
        }
    }

    #[test]
    fn resolve_destination_errors_clearly_when_home_unset_and_no_target() {
        // Cannot mutate the real process-global $HOME from a parallel
        // `cargo test` thread (unsafe/racy across other tests in this
        // binary), so this exercises the *error message* the "unset"
        // branch would produce by constructing it the same way
        // `resolve_destination` does internally -- the branch itself is
        // covered structurally (empty-string case below drives the
        // exact same code path).
        //
        // Still reads (and, via the empty-string branch below, briefly
        // mutates) the real $HOME, so this must hold the crate-wide
        // HOME_ENV_LOCK for its entire body -- covering the delegated
        // `resolve_destination_with_empty_home_errors()` call too, which
        // is why that helper does not acquire its own lock (this Mutex
        // is not reentrant).
        let _lock = lock_home();
        let err = match std::env::var_os("HOME") {
            Some(home) if !home.is_empty() => {
                // $HOME is set in this environment; assert the empty-string
                // path instead, which exercises the identical branch.
                return assert!(resolve_destination_with_empty_home_errors());
            }
            _ => resolve_destination(None).expect_err("HOME is unset; must error, not panic"),
        };
        assert!(err.contains("--target"));
    }

    /// Exercises the "HOME set but empty" branch directly by temporarily
    /// setting an in-process override -- narrowly scoped to this single
    /// assertion and immediately restored. Only ever called from
    /// `resolve_destination_errors_clearly_when_home_unset_and_no_target`,
    /// which holds the crate-wide `HOME_ENV_LOCK` for its entire body
    /// (including this call) -- this helper does not acquire the lock
    /// itself, since `std::sync::Mutex` is not reentrant.
    fn resolve_destination_with_empty_home_errors() -> bool {
        let original = std::env::var_os("HOME");
        // SAFETY: held under the caller's crate-wide HOME_ENV_LOCK for
        // this helper's entire body, so no other HOME-mutating test
        // anywhere in this crate observes an interleaved value; the
        // original value is restored before returning.
        unsafe {
            std::env::set_var("HOME", "");
        }
        let result = resolve_destination(None);
        unsafe {
            match &original {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
        }
        result.is_err()
    }

    fn sample_manifest() -> manifest::Manifest {
        manifest::Manifest::new(
            "kiro-cli",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            vec![
                manifest::ManifestFile {
                    path: ".kiro/agents/k-example.json".to_string(),
                    sha256: Some("a".repeat(64)),
                    provenance: Provenance::Created,
                },
                manifest::ManifestFile {
                    path: ".konductor/skills/code-review/SKILL.md".to_string(),
                    sha256: Some("b".repeat(64)),
                    provenance: Provenance::ReplacedOurs,
                },
                // Second file in the SAME skill directory: `skills` must
                // still count this as one skill, not two.
                manifest::ManifestFile {
                    path: ".konductor/skills/code-review/scripts/run.sh".to_string(),
                    sha256: Some("e".repeat(64)),
                    provenance: Provenance::Created,
                },
                manifest::ManifestFile {
                    path: ".kiro/context/routing-rules.md".to_string(),
                    sha256: Some("c".repeat(64)),
                    provenance: Provenance::ReplacedForeign,
                },
                manifest::ManifestFile {
                    path: ".kiro/agents/second-agent.json".to_string(),
                    sha256: Some("d".repeat(64)),
                    provenance: Provenance::ReplacedForeign,
                },
                manifest::ManifestFile {
                    path: ".konductor/bin/skill-lookup-mcp".to_string(),
                    sha256: Some("f".repeat(64)),
                    provenance: Provenance::Created,
                },
            ],
        )
    }

    /// `InstallCounts` derives its per-content-type counts from each
    /// file's path prefix, and the `replaced_foreign` count from
    /// provenance -- both counted independently against a manifest
    /// with a deliberate mix, so a miscount in either dimension would
    /// fail this test rather than passing on a degenerate all-zero or
    /// all-one fixture.
    #[test]
    fn install_counts_from_manifest_counts_each_dimension_independently() {
        let counts = InstallCounts::from_manifest(&sample_manifest());
        assert_eq!(counts.agents, 2);
        assert_eq!(counts.skills, 1);
        assert_eq!(counts.context, 1);
        assert_eq!(counts.bin, 1);
        assert_eq!(counts.replaced_foreign, 2);
    }

    /// Regression: `InstallCounts::from_manifest` recognizes
    /// `.claude/agents/`/`.claude/skills/` prefixes alongside Kiro's
    /// `.kiro/`/`.konductor/` ones, so counts are correct regardless of
    /// which strategy wrote the manifest. Mixes a Claude-shaped manifest
    /// entry set with the same multi-file-per-skill-directory case
    /// `sample_manifest` exercises for Kiro, proving the skill-directory
    /// dedup applies identically under `.claude/skills/`.
    #[test]
    fn install_counts_from_manifest_recognizes_claude_prefixes() {
        let manifest = manifest::Manifest::new(
            "claude-code",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            vec![
                manifest::ManifestFile {
                    path: ".claude/agents/k-example.md".to_string(),
                    sha256: Some("a".repeat(64)),
                    provenance: Provenance::Created,
                },
                manifest::ManifestFile {
                    path: ".claude/skills/constraints/SKILL.md".to_string(),
                    sha256: Some("b".repeat(64)),
                    provenance: Provenance::ReplacedOurs,
                },
                // Second file in the SAME skill directory: must still
                // count as one skill, mirroring the Kiro-side case.
                manifest::ManifestFile {
                    path: ".claude/skills/constraints/scripts/run.sh".to_string(),
                    sha256: Some("c".repeat(64)),
                    provenance: Provenance::Created,
                },
                manifest::ManifestFile {
                    path: ".claude/agents/second-agent.md".to_string(),
                    sha256: Some("d".repeat(64)),
                    provenance: Provenance::ReplacedForeign,
                },
            ],
        );

        let counts = InstallCounts::from_manifest(&manifest);
        assert_eq!(counts.agents, 2);
        assert_eq!(counts.skills, 1);
        assert_eq!(counts.context, 0);
        assert_eq!(counts.bin, 0);
        assert_eq!(counts.replaced_foreign, 1);
    }

    /// The default-mode summary line names the exact counts, the
    /// destination, the manifest path, the SOP-skip count, and the
    /// foreign-overwrite count -- never implying SOPs were installed.
    #[test]
    fn format_install_summary_reports_exact_counts_and_never_implies_sops_installed() {
        let counts = InstallCounts::from_manifest(&sample_manifest());
        let summary = format_install_summary(
            Path::new("/tmp/example-target"),
            Path::new("/tmp/example-target/.konductor/manifest"),
            &counts,
            7,
        );
        assert_eq!(
            summary,
            "konductor install: installed 2 agent(s), 1 skill(s), 1 context file(s), 1 \
             MCP server binary(ies) to /tmp/example-target \
             (manifest: /tmp/example-target/.konductor/manifest); \
             skipped 7 SOP(s) (no runtime discovery path yet); \
             overwrote 2 pre-existing file(s) not created by Konductor"
        );
        assert!(
            !summary.contains("installed")
                || !summary[summary.find("SOP").unwrap()..].contains("installed"),
            "summary must never claim SOPs were installed: {summary:?}"
        );
    }

    /// `count_staged_sops` counts `*.sop.md` under the source's staged
    /// `dist/<harness_dir>/sops/` -- the figure the install summary
    /// reports as skipped -- ignoring non-SOP files, and returns 0 when
    /// the directory is absent. Derived at runtime, so it can never
    /// drift from a hand-maintained constant and reflects whatever
    /// `--from` source was installed under the given harness directory.
    #[test]
    fn count_staged_sops_counts_staged_sop_md_files() {
        use crate::cli::synth::kiro_cli_v2::{KiroCliV2Transformer, SOPS_CONTENT_TYPE_DIR};
        use crate::cli::synth::HarnessTransformer as _;

        let repo_root = scratch_dir("count-staged-sops");
        let harness_dir = KiroCliV2Transformer.name();
        // No dist/ tree yet -> 0.
        assert_eq!(
            count_staged_sops(repo_root.to_str().unwrap(), harness_dir),
            0
        );

        let sops_dir = repo_root
            .join("dist")
            .join(harness_dir)
            .join(SOPS_CONTENT_TYPE_DIR);
        fs::create_dir_all(&sops_dir).unwrap();
        fs::write(sops_dir.join("asdlc-plan.sop.md"), b"# Plan\n").unwrap();
        fs::write(sops_dir.join("asdlc-verify.sop.md"), b"# Verify\n").unwrap();
        // A non-`.sop.md` file must not be counted.
        fs::write(sops_dir.join("README.md"), b"notes\n").unwrap();

        assert_eq!(
            count_staged_sops(repo_root.to_str().unwrap(), harness_dir),
            2
        );

        fs::remove_dir_all(&repo_root).ok();
    }

    /// A second harness directory (e.g. Claude's own `"claude"`) is
    /// read independently of Kiro's `"kiro-cli-v2"` -- proves
    /// `count_staged_sops` genuinely reads whichever harness directory
    /// it is given, not a fixed one, and that a Kiro-staged `dist/`
    /// tree does not leak into a different harness's count.
    #[test]
    fn count_staged_sops_is_scoped_to_the_given_harness_dir() {
        use crate::cli::synth::kiro_cli_v2::{KiroCliV2Transformer, SOPS_CONTENT_TYPE_DIR};
        use crate::cli::synth::HarnessTransformer as _;

        let repo_root = scratch_dir("count-staged-sops-scoped");
        let kiro_harness = KiroCliV2Transformer.name();
        let claude_harness = "claude";

        // Stage 2 SOPs under Kiro's own harness directory only.
        let kiro_sops_dir = repo_root
            .join("dist")
            .join(kiro_harness)
            .join(SOPS_CONTENT_TYPE_DIR);
        fs::create_dir_all(&kiro_sops_dir).unwrap();
        fs::write(kiro_sops_dir.join("a.sop.md"), b"a\n").unwrap();
        fs::write(kiro_sops_dir.join("b.sop.md"), b"b\n").unwrap();

        assert_eq!(
            count_staged_sops(repo_root.to_str().unwrap(), kiro_harness),
            2,
            "must count what is actually staged under the Kiro harness dir"
        );
        assert_eq!(
            count_staged_sops(repo_root.to_str().unwrap(), claude_harness),
            0,
            "must not count Kiro's staged SOPs when asked about a different harness dir"
        );

        fs::remove_dir_all(&repo_root).ok();
    }

    /// `--verbose` lines name every installed file's manifest path and
    /// provenance, one per line, and produce as many lines as the
    /// manifest has files -- proving `-v` genuinely adds detail beyond
    /// the single summary line.
    #[test]
    fn format_install_verbose_lines_names_every_file_with_provenance() {
        let manifest = sample_manifest();
        let lines = format_install_verbose_lines(&manifest);
        assert_eq!(lines.len(), manifest.files.len());
        assert!(lines
            .iter()
            .any(|l| l.contains(".kiro/agents/k-example.json") && l.contains("Created")));
        assert!(lines
            .iter()
            .any(|l| l.contains(".konductor/skills/code-review/SKILL.md")
                && l.contains("ReplacedOurs")));
        assert!(
            lines
                .iter()
                .any(|l| l.contains(".kiro/context/routing-rules.md")
                    && l.contains("ReplacedForeign"))
        );
    }

    /// `--json` output parses as valid JSON and carries the same counts
    /// as the human-readable summary, including the SOP-skip and
    /// foreign-overwrite figures.
    #[test]
    fn format_install_summary_json_parses_and_matches_counts() {
        let counts = InstallCounts::from_manifest(&sample_manifest());
        let value = format_install_summary_json(
            Path::new("/tmp/example-target"),
            Path::new("/tmp/example-target/.konductor/manifest"),
            &counts,
            7,
        );
        assert_eq!(value["command"], "install");
        assert_eq!(value["agents"], 2);
        assert_eq!(value["skills"], 1);
        assert_eq!(value["context"], 1);
        assert_eq!(value["bin"], 1);
        assert_eq!(value["sops_skipped"], 7);
        assert_eq!(value["replaced_foreign"], 2);
    }

    /// IMPORTANT regression (adversarial review finding #4): `install
    /// --link-bin --json` must print exactly ONE top-level JSON
    /// document for one invocation, with the bin-link outcome folded in
    /// as a `"link_bin"` field -- not two separate top-level objects
    /// (the install summary, then a second standalone document), which
    /// breaks a single-`JSON.parse` consumer reading all of stdout.
    #[test]
    fn merge_link_bin_json_folds_success_into_the_same_object() {
        let counts = InstallCounts::from_manifest(&sample_manifest());
        let mut value = format_install_summary_json(
            Path::new("/tmp/example-target"),
            Path::new("/tmp/example-target/.konductor/manifest"),
            &counts,
            7,
        );
        let result: Result<(PathBuf, bin_link::BinLinkOutcome), bin_link::BinLinkError> = Ok((
            PathBuf::from("/home/x/.local/bin/konductor"),
            bin_link::BinLinkOutcome::Created,
        ));
        merge_link_bin_json(&mut value, &result);

        // Still exactly one JSON object -- `value` was mutated in place,
        // not replaced/concatenated -- and it carries BOTH the original
        // install fields and the new link_bin field together.
        assert_eq!(value["command"], "install");
        assert_eq!(value["agents"], 2);
        assert_eq!(value["link_bin"]["requested"], true);
        assert_eq!(value["link_bin"]["outcome"], "created");
        assert_eq!(
            value["link_bin"]["link_path"],
            "/home/x/.local/bin/konductor"
        );
    }

    #[test]
    fn merge_link_bin_json_folds_failure_into_the_same_object() {
        let counts = InstallCounts::from_manifest(&sample_manifest());
        let mut value = format_install_summary_json(
            Path::new("/tmp/example-target"),
            Path::new("/tmp/example-target/.konductor/manifest"),
            &counts,
            7,
        );
        let result: Result<(PathBuf, bin_link::BinLinkOutcome), bin_link::BinLinkError> =
            Err(bin_link::BinLinkError::ForeignFileExists {
                path: PathBuf::from("/home/x/.local/bin/konductor"),
            });
        merge_link_bin_json(&mut value, &result);

        assert_eq!(value["command"], "install");
        assert_eq!(value["link_bin"]["requested"], true);
        assert!(value["link_bin"]["error"].is_string());
    }
}
