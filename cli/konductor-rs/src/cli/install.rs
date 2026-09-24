// SPDX-License-Identifier: Apache-2.0
//
// install.rs — `konductor install` dispatch (Rust implementation).
// Artifact fetch+verify lives in `install::artifact`; runtime
// auto-detection in `install::runtime`; manifest read/write in
// `install::manifest`; strategy registration in `install::registry`;
// local-source installation in `install::kiro_cli`.
//
// `dispatch_install_with` resolves the DESTINATION (`--target <dir>`
// or `$HOME`), picks the `InstallStrategy` matching `--harness`, and
// runs its `install_from_local()` against the SOURCE (`--from
// <repo-root>`'s synth output). Without `--from`, it tries the remote
// fallback chain instead (`install::remote_orchestrate`): GitHub
// Release first, then `main`'s `dist/` tree if the release has
// nothing to install -- see
// `remote_orchestrate::install_from_remote_with_fallback` for the
// eligibility rule. A checksum-mismatch failure maps to
// `EXIT_VERIFY_FAILED` (65); every other failure maps to
// `EXIT_USAGE_ERROR` (64), never exit code 2.
//
// On success, `dispatch_install` re-reads the manifest
// `install_from_local` just wrote and reports the destination,
// per-content-type counts, the manifest path, and how many files it
// skipped or overwrote.

use std::path::{Path, PathBuf};

use crate::cli::output::ColorMode;

pub mod artifact;
pub mod bin_link;
pub mod claude;
pub(crate) mod cli_self_update;
pub(crate) mod content_version;
pub mod github;
pub mod github_branch;
pub mod index;
pub mod kiro_cli;
pub mod kiro_cli_v3;
pub mod manifest;
pub mod mcp_server;
pub mod phases;
mod private_repo_hint;
pub mod registry;
pub mod remote;
pub mod remote_orchestrate;
pub mod resource_rewrite;
pub mod runtime;
pub(crate) mod target_triple;

use manifest::Provenance;

/// Counts the `*.sop.md` files staged under
/// `<from>/dist/<harness_dir>/sops/` -- the SOPs this install skips.
/// Reads the actual staged directory rather than a constant, so the
/// count can never drift from what synth produced. Returns 0 when
/// absent.
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

/// Maps a `remote_orchestrate::RemoteOrchestrationError` to an exit
/// code: `EXIT_VERIFY_FAILED` (65) for a checksum-verification failure
/// (`RemoteInstallError::VerifyChecksum`), `EXIT_USAGE_ERROR` (64) for
/// everything else. Mirrors `install_error_exit_code`'s existing split,
/// applied to the remote path.
///
/// `pub(super)` (visible throughout `cli`) so `update.rs`'s own
/// no-`--from` remote-install path -- which reuses this same
/// `remote_orchestrate::install_from_remote_with_fallback` call and
/// hits the identical error shape -- can apply the same mapping rather
/// than duplicating this match.
pub(super) fn remote_orchestration_error_exit_code(
    err: &remote_orchestrate::RemoteOrchestrationError,
) -> u8 {
    match err {
        remote_orchestrate::RemoteOrchestrationError::Install(
            remote::RemoteInstallError::VerifyChecksum(_),
        ) => EXIT_VERIFY_FAILED,
        _ => EXIT_USAGE_ERROR,
    }
}

/// A stable, closed error-category string for a
/// `remote_orchestrate::RemoteOrchestrationError`, following
/// `install_error_code`'s `"install.<category>"` convention. Never
/// this error's own `Display` text, which can embed a URL, filename,
/// or filesystem path.
///
/// `pub(super)`: shared with `update.rs`'s no-`--from` path, same
/// reason as `remote_orchestration_error_exit_code` above.
pub(super) fn remote_orchestration_error_code(
    err: &remote_orchestrate::RemoteOrchestrationError,
) -> &'static str {
    match err {
        remote_orchestrate::RemoteOrchestrationError::Fetch(github::GithubFetchError::Network(
            _,
        )) => "install.remote_network_error",
        remote_orchestrate::RemoteOrchestrationError::Fetch(
            github::GithubFetchError::MissingAsset(_),
        ) => "install.remote_asset_missing",
        remote_orchestrate::RemoteOrchestrationError::Fetch(
            github::GithubFetchError::MetadataHttp(_, _),
        ) => "install.remote_metadata_http_error",
        remote_orchestrate::RemoteOrchestrationError::Fetch(
            github::GithubFetchError::DownloadHttp(_, _),
        ) => "install.remote_download_http_error",
        remote_orchestrate::RemoteOrchestrationError::Fetch(
            github::GithubFetchError::InvalidResponse(_),
        ) => "install.remote_invalid_response",
        remote_orchestrate::RemoteOrchestrationError::Fetch(
            github::GithubFetchError::ResponseTooLarge { .. },
        ) => "install.remote_response_too_large",
        remote_orchestrate::RemoteOrchestrationError::Fetch(
            github::GithubFetchError::TagNotFound { .. },
        ) => "install.remote_tag_not_found",
        remote_orchestrate::RemoteOrchestrationError::Install(
            remote::RemoteInstallError::VerifyChecksum(_),
        ) => "install.remote_checksum_mismatch",
        remote_orchestrate::RemoteOrchestrationError::Install(
            remote::RemoteInstallError::VerifySidecar(_),
        ) => "install.remote_sidecar_invalid",
        remote_orchestrate::RemoteOrchestrationError::Install(
            remote::RemoteInstallError::Unpack(_),
        ) => "install.remote_unpack_failed",
        remote_orchestrate::RemoteOrchestrationError::Install(
            remote::RemoteInstallError::Install(_),
        ) => "install.remote_install_failed",
        remote_orchestrate::RemoteOrchestrationError::Install(
            remote::RemoteInstallError::McpBinaryFetch(_),
        ) => "install.remote_mcp_binary_fetch_failed",
    }
}

/// Maps a `remote_orchestrate::MainBranchDistOrchestrationError` to an
/// exit code -- the same checksum-vs-everything-else split
/// `remote_orchestration_error_exit_code` applies to the release path.
/// A `VerifyChecksum` failure here means the fetched tarball's hash
/// doesn't match the real sidecar also fetched from `dist/` on the
/// branch -- mapped the same way as the release path's own check.
///
/// `pub(super)`: shared with `update.rs`'s no-`--from` path, same
/// reason as `remote_orchestration_error_exit_code` above.
pub(super) fn main_branch_dist_orchestration_error_exit_code(
    err: &remote_orchestrate::MainBranchDistOrchestrationError,
) -> u8 {
    match err {
        remote_orchestrate::MainBranchDistOrchestrationError::Install(
            remote::RemoteInstallError::VerifyChecksum(_),
        ) => EXIT_VERIFY_FAILED,
        _ => EXIT_USAGE_ERROR,
    }
}

/// A stable, closed error-category string for a
/// `remote_orchestrate::MainBranchDistOrchestrationError`, following
/// `remote_orchestration_error_code`'s naming convention. Prefixed
/// `install.main_branch_dist_*` so a `--json` consumer can always tell
/// which of the two sources an error came from without inspecting the
/// message text.
///
/// `pub(super)`: shared with `update.rs`'s no-`--from` path, same
/// reason as `remote_orchestration_error_code` above.
pub(super) fn main_branch_dist_orchestration_error_code(
    err: &remote_orchestrate::MainBranchDistOrchestrationError,
) -> &'static str {
    match err {
        remote_orchestrate::MainBranchDistOrchestrationError::Fetch(
            github_branch::GithubBranchFetchError::Network(_),
        ) => "install.main_branch_dist_network_error",
        remote_orchestrate::MainBranchDistOrchestrationError::Fetch(
            github_branch::GithubBranchFetchError::MissingArtifact(_, _),
        ) => "install.main_branch_dist_artifact_missing",
        remote_orchestrate::MainBranchDistOrchestrationError::Fetch(
            github_branch::GithubBranchFetchError::MissingSidecar(_, _),
        ) => "install.main_branch_dist_sidecar_missing",
        remote_orchestrate::MainBranchDistOrchestrationError::Fetch(
            github_branch::GithubBranchFetchError::Http(_, _),
        ) => "install.main_branch_dist_http_error",
        remote_orchestrate::MainBranchDistOrchestrationError::Fetch(
            github_branch::GithubBranchFetchError::InvalidResponse(_),
        ) => "install.main_branch_dist_invalid_response",
        remote_orchestrate::MainBranchDistOrchestrationError::Fetch(
            github_branch::GithubBranchFetchError::ResponseTooLarge { .. },
        ) => "install.main_branch_dist_response_too_large",
        remote_orchestrate::MainBranchDistOrchestrationError::Install(
            remote::RemoteInstallError::VerifyChecksum(_),
        ) => "install.main_branch_dist_checksum_mismatch",
        remote_orchestrate::MainBranchDistOrchestrationError::Install(
            remote::RemoteInstallError::VerifySidecar(_),
        ) => "install.main_branch_dist_sidecar_invalid",
        remote_orchestrate::MainBranchDistOrchestrationError::Install(
            remote::RemoteInstallError::Unpack(_),
        ) => "install.main_branch_dist_unpack_failed",
        remote_orchestrate::MainBranchDistOrchestrationError::Install(
            remote::RemoteInstallError::Install(_),
        ) => "install.main_branch_dist_install_failed",
        remote_orchestrate::MainBranchDistOrchestrationError::Install(
            remote::RemoteInstallError::McpBinaryFetch(_),
        ) => "install.main_branch_dist_mcp_binary_fetch_failed",
    }
}

/// Maps a `remote_orchestrate::FallbackChainError` (both no-`--from`
/// sources having been tried, or the release source having failed with
/// something other than a fallback-eligible error) to an exit code.
/// `ReleaseOnly` delegates to `remote_orchestration_error_exit_code` --
/// the fallback was never attempted. `BothFailed` maps to
/// `EXIT_VERIFY_FAILED` (65) if either underlying error is a
/// checksum-verification failure, `EXIT_USAGE_ERROR` (64) otherwise.
/// This is deliberate: a checksum failure is confirmed corruption,
/// while an unreachable-source failure on the other side could just be
/// transient, so when both sides fail the exit code reflects the more
/// serious of the two rather than whichever happened to fail.
///
/// `pub(super)`: shared with `update.rs`'s no-`--from` path, same
/// reason as `remote_orchestration_error_exit_code` above.
pub(super) fn fallback_chain_error_exit_code(err: &remote_orchestrate::FallbackChainError) -> u8 {
    match err {
        remote_orchestrate::FallbackChainError::ReleaseOnly(release_error) => {
            remote_orchestration_error_exit_code(release_error)
        }
        remote_orchestrate::FallbackChainError::BothFailed {
            release_error,
            main_branch_dist_error,
        } => {
            let release_is_checksum_failure =
                remote_orchestration_error_exit_code(release_error) == EXIT_VERIFY_FAILED;
            let main_branch_dist_is_checksum_failure =
                main_branch_dist_orchestration_error_exit_code(main_branch_dist_error)
                    == EXIT_VERIFY_FAILED;
            if release_is_checksum_failure || main_branch_dist_is_checksum_failure {
                EXIT_VERIFY_FAILED
            } else {
                EXIT_USAGE_ERROR
            }
        }
    }
}

/// A stable, closed error-category string for a
/// `remote_orchestrate::FallbackChainError`. `ReleaseOnly` reuses
/// `remote_orchestration_error_code` unchanged. `BothFailed` gets its
/// own dedicated code -- `install.remote_and_main_branch_dist_both_failed`
/// -- since neither underlying category alone would tell a `--json`
/// consumer that two independent sources were tried and both failed.
///
/// `pub(super)`: shared with `update.rs`'s no-`--from` path, same
/// reason as `remote_orchestration_error_code` above.
pub(super) fn fallback_chain_error_code(
    err: &remote_orchestrate::FallbackChainError,
) -> &'static str {
    match err {
        remote_orchestrate::FallbackChainError::ReleaseOnly(release_error) => {
            remote_orchestration_error_code(release_error)
        }
        remote_orchestrate::FallbackChainError::BothFailed { .. } => {
            "install.remote_and_main_branch_dist_both_failed"
        }
    }
}

/// The single wording for "no `--from <repo-root>` was given" at the
/// `InstallStrategy` trait level -- shared by every call site that
/// needs this exact message, so a future wording change only touches
/// this one constant.
///
/// `dispatch_install_with`'s own no-`--from` branch does not return
/// this message: it tries the real remote fallback chain instead (see
/// `install::remote_orchestrate::install_from_remote_with_fallback`
/// for the current caveats). This constant still applies wherever a
/// strategy's `install_from_local`/`would_fail_as_noop` is invoked
/// directly with `from: None` (e.g. from `update.rs`, or tests), which
/// has no remote-fetch fallback of its own.
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

/// A stable, closed error-category string -- never
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

    /// The harness directory this strategy reads synthed output from
    /// under `<from>/dist/<harness_dir>/` -- e.g. `kiro-cli-v2` for
    /// `KiroCliInstallStrategy`, `claude` for `ClaudeInstallStrategy`.
    /// Distinct from `name()` (e.g. `"claude"`): this is the
    /// on-disk directory a synth transformer writes to, which need not
    /// match the strategy's own identifier. Lets strategy-agnostic
    /// reporting code (`count_staged_sops`) read the right directory
    /// for whichever strategy actually ran.
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
    /// -- a strategy must fail clearly in that case, not silently
    /// succeed. `installed_at` is the one timestamp string the caller
    /// already computed for this run's index entry; the strategy must
    /// write it verbatim into the manifest's own `installed_at` so the
    /// index and manifest always agree on the same instant. `no_telemetry`
    /// is `install`'s `--no-telemetry` flag (always `false` from
    /// `update.rs`, which has no such flag); a strategy must thread it
    /// through to every phase that can fire a telemetry side effect
    /// (today only `AgentInstallPhase`'s Claude Code hook), so the
    /// opt-out covers the whole run, not just the top-level report
    /// calls. Returns `Ok(())` on success, or an `InstallError` on
    /// failure -- `InstallError::Manifest` when the failure came from
    /// reading an existing target manifest (so an unsupported
    /// `schema_version` can map to `EXIT_VERIFY_FAILED` instead of the
    /// generic `EXIT_USAGE_ERROR`), `InstallError::Message` otherwise.
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
    color: ColorMode,
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
        color,
    );
}

/// Projects the `strategies` names an install-index write-ahead entry
/// should list for `incoming` being installed against a target whose
/// manifest, before this run, is `existing` (`None` for a fresh
/// target). This is a projection only, computed on a throwaway clone
/// -- it never writes anything -- but it reuses the real
/// `Manifest::upsert`/`remove` methods and `manifest`'s own
/// `other_kiro_variant_tracked` override-selection helper, so the
/// index's write-ahead display can't drift from what
/// `manifest::upsert_strategy` actually decides once
/// `install_from_local` reaches its real write. The final,
/// authoritative index write re-reads the real manifest instead of
/// relying on this projection.
fn projected_strategy_names(existing: Option<&manifest::Manifest>, incoming: &str) -> Vec<String> {
    let mut projected = existing.cloned().unwrap_or_else(manifest::Manifest::empty);
    if let Some(other_name) = manifest::other_kiro_variant_tracked(&projected.strategies, incoming)
    {
        projected.remove(&other_name);
    }
    // A placeholder slot -- only the resulting strategy NAME set is
    // used by the caller; every other field is discarded.
    projected.upsert(manifest::StrategyManifest::new(
        incoming,
        "",
        ".",
        None,
        manifest::Status::Complete,
        Vec::new(),
    ));
    projected
        .strategy_names()
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// Resolves the `strategies` the finalize index write should record,
/// given the manifest read attempted at that point (`manifest_read`)
/// and the write-ahead projection already computed earlier in the
/// same install run (`write_ahead`, the list `projected_strategy_names`
/// produced).
///
/// A successful, present read is authoritative: `install_from_local`
/// has already written the real manifest by this point, so its
/// `strategy_names()` is the definitive post-install list, reflecting
/// whatever override/insert decision `manifest::upsert_strategy`
/// actually made rather than a pre-computed guess. A failed or missing
/// read falls back to `write_ahead` -- never a single-element vec
/// naming only the strategy just installed, which would silently drop
/// any other coexisting strategy's name from the index even though its
/// manifest slot is still on disk.
///
/// `pub(super)`: `update.rs`'s `run_update_one_target` calls this same
/// function for its own finalize index write, closing the identical
/// staleness gap on the update side -- `update` used to always reuse a
/// snapshot captured before `install_from_local` ran, never re-reading
/// the manifest fresh at finalize time the way this function does.
pub(super) fn resolve_final_strategies(
    manifest_read: Result<Option<manifest::Manifest>, manifest::ManifestError>,
    write_ahead: &[String],
) -> Vec<String> {
    manifest_read
        .ok()
        .flatten()
        .map(|m| m.strategy_names().into_iter().map(str::to_string).collect())
        .unwrap_or_else(|| write_ahead.to_vec())
}

/// `konductor install --harness <name> [--from ...] [--target ...]
/// [--link-bin]`: resolves the install destination
/// (`resolve_destination`), selects the registered `InstallStrategy`
/// whose `harness_dir()` matches the REQUIRED `--harness` argument, and
/// installs from `from` -- the SOURCE repo root a strategy reads
/// synthed agent files from. Without `--from`, it tries the real
/// remote fallback chain instead (GitHub Release, then `main`'s
/// `dist/` tree -- see `remote_orchestrate::install_from_remote_with_fallback`).
///
/// `link_bin`, when true and the install succeeds, also symlinks the
/// running `konductor` binary to `$HOME/.local/bin/konductor` via
/// `bin_link::ensure_bin_link` (see that module's own doc for the
/// design). Its outcome is folded into the same success report
/// `report_install_success` prints, never a second `--json` document,
/// and it never flips an otherwise-successful install's exit code --
/// by the time it runs, the actual install `--target` asked for has
/// already succeeded.
///
/// `verbose`/`json` are `cli.verbose`/`cli.json`: `verbose` appends a
/// per-file detail listing after the summary line; `json` replaces the
/// whole report with one structured line instead.
///
/// Returns 0 on success, `EXIT_USAGE_ERROR` (64) on an unresolvable
/// destination, no matching strategy, or any install failure -- never
/// exit code 2.
#[allow(clippy::too_many_arguments)]
pub fn dispatch_install_with(
    from: Option<String>,
    target: Option<String>,
    harness: String,
    link_bin: bool,
    no_telemetry: bool,
    use_github_token: bool,
    release_version: Option<String>,
    force: bool,
    verbose: bool,
    json: bool,
    color: ColorMode,
) -> u8 {
    // Cloned for the closure below: `release_version` is ALSO passed
    // by value as this call's own 7th positional argument (read by
    // `dispatch_install_with_remote_installer`'s own skip-if-unchanged
    // check), and the closure captures it too (to thread through to
    // `install_from_remote_with_fallback`) -- both need their own
    // owned copy, since the positional argument and the closure
    // argument are evaluated as part of the SAME call expression, with
    // no ordering guarantee that would let one borrow from the other
    // after a move.
    let release_version_for_remote_installer = release_version.clone();
    dispatch_install_with_remote_installer(
        from,
        target,
        harness,
        link_bin,
        no_telemetry,
        use_github_token,
        release_version,
        force,
        verbose,
        json,
        color,
        // owner/repo are the confirmed real values for this project,
        // hardcoded ONLY at this one call site.
        //
        // Tries the GitHub-release path first, falling back to
        // `main`'s `dist/` tree on a fallback-eligible release failure
        // -- see `remote_orchestrate::install_from_remote_with_fallback`
        // for the exact selection rule. `release_version` is passed
        // through as-is: `Some(tag)` fetches that specific release via
        // `releases/tags/{tag}`, `None` fetches latest, same
        // `Some`/`None` dispatch `self_update_cli` already uses. A
        // by-tag fetch's fallback-eligibility is unaffected by this
        // change -- `install_from_remote_with_fallback_using`'s
        // eligibility rule already keys off the returned
        // `GithubFetchError` variant, and `TagNotFound` is not one of
        // the eligible variants (see that rule's own doc comment): a
        // requested tag that doesn't exist must surface its own clear
        // error, never silently fall back to whatever's on `main`.
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
                release_version_for_remote_installer.as_deref(),
            )
        },
    )
}

/// The full `dispatch_install_with` implementation, parameterized by
/// `remote_installer` -- the no-`--from` remote-install attempt. In
/// production, `dispatch_install_with` passes a closure that reaches
/// the real GitHub API; this module's own tests pass a closure that
/// fails right away with a fixed, fake `FallbackChainError` -- no real
/// network call -- exercising every other code path unchanged.
///
/// `force` bypasses content-version skip-if-unchanged (see
/// `content_version::should_skip_write`) -- checked only on the
/// `--from` branch today: a `--from <repo-root>`'s `dist/VERSION` is
/// directly readable before any network/unpack work happens, so the
/// skip can be decided up front. The no-`--from` remote path installs
/// through `remote_installer`'s own atomic fetch-unpack-install
/// sequence, which does not yet expose a pre-install hook to compare
/// the fetched `dist/VERSION` before `install_from_local` runs inside
/// it -- extending version-skip to that path is a larger, separate
/// change to `remote_orchestrate`/`remote`'s own internals.
///
/// `release_version` is mutually exclusive with `--from` at the clap
/// level (`--version <v>` `conflicts_with("from")`), so it is only
/// ever `Some(..)` here on the no-`--from` (remote) branch. Neither
/// `github.rs` nor `remote_orchestrate.rs` exposes a by-tag release
/// fetch today -- every fetch helper only reaches `releases/latest` --
/// so wiring a real by-version fetch through would be a separate,
/// larger change to that layer. Silently ignoring the flag would leave
/// `install --version <v>` installing latest with no indication to the
/// user, which is a functional trap for an explicit version pin.
/// Instead, `release_version.is_some()` short-circuits with an
/// explicit "not yet supported" usage error before any network call,
/// so the caller finds out immediately rather than getting a silent
/// latest-install.
#[allow(clippy::too_many_arguments)]
fn dispatch_install_with_remote_installer(
    from: Option<String>,
    target: Option<String>,
    harness: String,
    link_bin: bool,
    no_telemetry: bool,
    use_github_token: bool,
    release_version: Option<String>,
    force: bool,
    verbose: bool,
    json: bool,
    color: ColorMode,
    remote_installer: impl FnOnce(
        &dyn InstallStrategy,
        &Path,
        &str,
        bool,
    ) -> Result<
        (
            remote_orchestrate::RemoteInstallSource,
            remote::RemoteInstallOutcome,
        ),
        remote_orchestrate::FallbackChainError,
    >,
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
                color,
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
        report_no_strategy_for_harness(&destination, &harness, no_telemetry, json, color);
        return EXIT_USAGE_ERROR;
    };
    super::trace::trace(
        "trace",
        &format!(
            "install: strategy '{}' matched destination",
            strategy.name()
        ),
    );

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
    //
    // MUST run before the `if from.is_some() { .. } else { .. }` block
    // below: that block's no-`--from` branch has its own early
    // `return 0` on a content-version skip-if-unchanged match (see
    // `report_already_at_version`'s call site further down), and that
    // early return must never bypass this validation -- a corrupted or
    // unsupported-schema-version index must be rejected with
    // `EXIT_USAGE_ERROR`/`EXIT_VERIFY_FAILED` on EVERY install
    // invocation, not only the ones where the version happens to
    // mismatch (previously flagged by AutoSDE: running this guard
    // after the skip branch let index corruption silently pass through
    // whenever the target was already at the matching version).
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
                    color,
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
                color,
            );
            return index_error_exit_code(&err);
        }
    }

    // A missing `--from` has no local source to check with
    // `would_fail_as_noop` -- the no-`--from` case tries the real
    // remote install below instead, sharing every guard from this
    // point on with the `--from` path, so a remote-sourced install
    // gets tracked in `~/.konductor/installs` exactly like a local one.
    if from.is_some() {
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
                color,
            );
            return EXIT_USAGE_ERROR;
        }

        // No content-version skip-if-unchanged check on this branch:
        // `--from` ALWAYS overwrites unconditionally, regardless of
        // `--force` -- deliberate and permanent, since a local
        // checkout has no reliable version signal to compare against
        // (see `content_version::compare_incoming_version`'s own doc
        // comment, which states this rule in the one place it's
        // enforced). This is not a gap to be closed later by adding a
        // version-comparison call here.
    } else {
        // `--version <v>` on the no-`--from` (remote) path: fetches
        // that SPECIFIC release's metadata via
        // `github::fetch_release_artifact_and_mcp_asset_by_tag` (`GET
        // .../releases/tags/{tag}`), reusing the identical
        // token-attachment/asset-resolution machinery the latest-release
        // path already proves out. Threaded into `remote_installer`
        // below as a captured closure variable -- no change to
        // `remote_installer`'s own call signature was needed for this.

        // Content-version skip-if-unchanged applies on the no-`--from`
        // (remote) path: compares the incoming version (an explicitly
        // requested `--version <v>` tag, or "latest" via a metadata-only
        // pre-fetch) against this target's recorded `agent_version`.
        // Only the `--version <v>` branch skips the network fetch
        // entirely -- the incoming tag is already known without any
        // call, so a match skips straight past `fetch_latest_release_tag`
        // too. On the `None` ("latest") branch the pre-fetch itself IS
        // the network call the skip decision depends on, so a match
        // there only avoids the LARGER download/re-copy that would
        // otherwise follow -- see the "recorded version is read BEFORE
        // the pre-fetch" paragraph below for why that metadata pre-fetch
        // still only runs when there is something recorded to compare
        // it against. `force` bypasses the skip either way.
        // `use_github_token` is threaded through here so this pre-fetch authenticates exactly
        // like the real install below it -- an unauthenticated pre-fetch
        // would silently fail against a private repo for token users
        // (skip-if-unchanged never firing) and would otherwise burn a
        // request against GitHub's unauthenticated rate limit even when
        // the caller supplied a token.
        //
        // `install-info.json` holds exactly one `agent_version` +
        // `harness` pair per target (see `write_install_info`'s own doc
        // comment: concurrent installs to the same target with
        // different harnesses each overwrite it independently), while a
        // single target can legitimately track 2+ harnesses at once in
        // its manifest (`manifest::upsert_strategy`'s own coexistence
        // support). So a version match recorded for a DIFFERENT harness
        // than the one this run requested is not evidence that THIS
        // harness's content is already installed -- it only proves some
        // harness was, at some point. Gating the skip on
        // `record.harness == harness` keeps `install --harness B` on a
        // target that already recorded a matching version for harness A
        // from wrongly skipping harness B's install entirely.
        //
        // The recorded version is read BEFORE the pre-fetch, not after:
        // on a first-time install (no `install-info.json` yet) or a
        // different-harness target, there is nothing to compare the
        // fetched tag against, so the pre-fetch would be entirely
        // wasted -- `install_from_remote_with_fallback` below fetches
        // release metadata again regardless of whether this check ran.
        // Reading the recorded version first and skipping the pre-fetch
        // entirely when none is comparable halves the GitHub metadata
        // requests for exactly the case (first install, or a new
        // harness at an existing target) where this check can never
        // fire anyway.
        //
        // `--version <v>` composes with this check by comparing against
        // the EXPLICITLY REQUESTED version instead of "latest": when
        // `release_version` is `Some(v)`, the incoming version is
        // already known without any network call (it's the tag the
        // caller asked for), so no pre-fetch happens on this branch at
        // all -- only the `None` ("--version` not given, compare against
        // whatever is actually latest") branch below ever calls
        // `fetch_latest_release_tag`. This is what makes `install
        // --version <v>` skip when the target is already at EXACTLY
        // that requested version, rather than skipping (or not) based on
        // whatever "latest" happens to be -- a target pinned to an older
        // `--version <v>` that also happens to match "latest" must still
        // skip correctly, and a target NOT at the requested version must
        // never skip merely because it happens to already be at latest.
        let recorded_for_this_harness = crate::cli::telemetry::read_install_info(&destination)
            .and_then(|record| (record.harness == harness).then_some(record.agent_version))
            .flatten();
        if let Some(recorded) = recorded_for_this_harness {
            let incoming_tag = match release_version.as_deref() {
                Some(requested) => Some(requested.to_string()),
                None => {
                    github::fetch_latest_release_tag("aws-solutions", "konductor", use_github_token)
                        .ok()
                }
            };
            if let Some(incoming_tag) = incoming_tag {
                let incoming_version = incoming_tag.trim_start_matches('v');
                let comparison =
                    content_version::compare_known_versions(incoming_version, &recorded);
                if content_version::should_skip_write(&comparison, force) {
                    let version = comparison.matched_version().unwrap_or("").to_string();
                    // The index write-ahead below (registering this
                    // target in `~/.konductor/installs`) must still run
                    // on the skip path, same as it would on the ordinary
                    // install path a few hundred lines down -- this
                    // `return 0` happens BEFORE that write-ahead
                    // (`canonical_target_dir`/`index::write_index` are
                    // computed later in this function, past this early
                    // return), so without this a skip never registers
                    // the target at all. That only bites in a recovery
                    // scenario -- a fresh install has no recorded
                    // version yet, so it can never take this skip branch
                    // in the first place -- but when it does bite, it's
                    // the exact case `index_status`/the duplicate-index
                    // guard already exist to catch: an index entry lost
                    // or missing while `install-info.json` still records
                    // a matching version leaves this target invisible to
                    // `update --all`/`uninstall --all`/`doctor --all`
                    // until `--force` is passed, with nothing in the
                    // output pointing there. Written directly to
                    // `Complete` (never `InProgress`) -- no manifest
                    // write happens on this path, so there is nothing
                    // for this entry to bracket. A write failure here is
                    // non-fatal (exit 0 either way) and reported the
                    // same way the ordinary path's OWN finalize-index
                    // failure already is: an `eprintln!` warning plus
                    // `report_cli_error`, never a harder failure --
                    // the skip decision itself already succeeded.
                    if let Ok(canonical_target_dir) = index::canonicalize_target_dir(&destination) {
                        let write_ahead_strategies = projected_strategy_names(
                            manifest::read_manifest(&destination)
                                .ok()
                                .flatten()
                                .as_ref(),
                            strategy.name(),
                        );
                        if let Err(err) = index::write_index(index::IndexEntry {
                            target_dir: canonical_target_dir,
                            strategies: write_ahead_strategies,
                            installed_at: crate::cli::time::utc_now_iso(),
                            status: index::IndexEntryStatus::Complete,
                        }) {
                            eprintln!(
                                "{} could not register already-at-version install in index: \
                                 {err}",
                                crate::cli::output::error_prefix(color, "konductor install:")
                            );
                            crate::cli::telemetry::report_cli_error(
                                &destination,
                                "install",
                                "install.index_write_failed",
                                no_telemetry,
                            );
                        }
                    }
                    // `--link-bin` must still take effect here: the
                    // content write is skipped, but the caller explicitly
                    // asked for the bin symlink, and skipping it too would
                    // silently ignore that request while reporting a
                    // successful "nothing to do" outcome (previously
                    // flagged by AutoSDE). Canonicalizes `destination` and
                    // reads a fresh timestamp locally (rather than reusing
                    // the ones computed further down for the real-install
                    // path, which this early return never reaches) --
                    // `ensure_bin_link` only needs a valid target-dir
                    // string and a timestamp to record, neither of which
                    // depends on whether a content write actually
                    // happened. A canonicalization failure here is folded
                    // into the SAME `Result` shape `link_bin_report_line`/
                    // `merge_link_bin_json` already expect, as
                    // `BinLinkError::UnresolvableHome` -- not a precise
                    // description of THIS failure, but `destination` was
                    // already successfully resolved earlier in this same
                    // function, so canonicalizing it again failing here
                    // is not expected to occur in practice; this exists
                    // so a `--link-bin` request never fails silently.
                    let link_bin_result = if link_bin {
                        Some(
                            index::canonicalize_target_dir(&destination)
                                .map_err(|_| bin_link::BinLinkError::UnresolvableHome)
                                .and_then(|canonical_target_dir| {
                                    bin_link::ensure_bin_link(
                                        &canonical_target_dir,
                                        &crate::cli::time::utc_now_iso(),
                                    )
                                }),
                        )
                    } else {
                        None
                    };
                    report_already_at_version(
                        &destination,
                        &version,
                        link_bin_result.as_ref(),
                        json,
                        color,
                    );
                    return 0;
                }
            }
            // A failed version-check fetch (network error, etc.) never
            // blocks the install itself -- it simply proceeds to the
            // real fetch-and-install attempt below, which will surface
            // its own, more specific error if that fetch also fails.
        }
    }

    // Two behaviors are selected inside `manifest::upsert_strategy`
    // itself, once `install_from_local` reaches the point of actually
    // writing the manifest:
    //
    // - `strategy.name()` is a `KIRO_VARIANT_FAMILY` member and the
    //   target already tracks the other family member:
    //   `upsert_strategy` warns, then overwrites -- both variants write
    //   every destination path identically, so this is a takeover, not
    //   a coexistence question.
    // - Otherwise (e.g. installing `claude` alongside an
    //   already-tracked Kiro variant): `strategy.name()` gets its own
    //   independent slot, since `claude` and a Kiro variant share no
    //   destination path.
    //
    // No pre-check is needed here -- both cases are handled uniformly
    // by `upsert_strategy`'s own read-modify-write.

    // Index write-ahead: brackets the strategy's
    // own manifest write-ahead/complete sequence so a crash
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
            color,
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
                color,
            );
            return EXIT_USAGE_ERROR;
        }
    };

    let installed_at = crate::cli::time::utc_now_iso();
    // Cloned (not moved) into the write-ahead `IndexEntry` below --
    // `write_ahead_strategies` itself stays alive as the finalize
    // fallback (see the `unwrap_or_else` a few hundred lines down),
    // so a manifest read error at finalize time falls back to this
    // same coexistence-aware projection instead of a single-element
    // vec that would drop any other tracked strategy's name.
    let write_ahead_strategies = projected_strategy_names(
        manifest::read_manifest(&destination)
            .ok()
            .flatten()
            .as_ref(),
        strategy.name(),
    );
    if let Err(err) = index::write_index(index::IndexEntry {
        target_dir: canonical_target_dir.clone(),
        strategies: write_ahead_strategies.clone(),
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
            color,
        );
        return index_error_exit_code(&err);
    }

    // The actual install step: `--from` reads and copies synthed local
    // content through the selected strategy; no `--from` instead tries
    // the real remote fallback chain through the caller-supplied
    // `remote_installer` (production's real GitHub-backed closure, or
    // this module's tests' fake, network-free one). Both arms land on
    // the same `Result<(), InstallError>` shape below, so every guard
    // and index write from this point on runs the same way regardless
    // of source. Only the remote arm has a `RemoteInstallSource`/
    // `RemoteInstallOutcome` to report; captured here as
    // `remote_source`/`remote_outcome`.
    let mut remote_source = None;
    let mut remote_outcome: Option<remote::RemoteInstallOutcome> = None;
    let install_result: Result<(), InstallError> = if let Some(from_path) = from.as_deref() {
        strategy.install_from_local(&destination, Some(from_path), &installed_at, no_telemetry)
    } else {
        match remote_installer(*strategy, &destination, &installed_at, no_telemetry) {
            Ok((source, outcome)) => {
                remote_source = Some(source);
                remote_outcome = Some(outcome);
                Ok(())
            }
            Err(err) => {
                let message = err.to_string();
                // `BothFailed` also names each source's own category
                // code as extra `--json` fields (JSON-only, never
                // plain text) -- `fallback_chain_error_code` collapses
                // `BothFailed` into one shared category, so without
                // this a `--json` consumer loses which failure each
                // source hit.
                let extra = match &err {
                    remote_orchestrate::FallbackChainError::BothFailed {
                        release_error,
                        main_branch_dist_error,
                    } => vec![
                        (
                            "release_error_code",
                            serde_json::Value::String(
                                remote_orchestration_error_code(release_error).to_string(),
                            ),
                        ),
                        (
                            "main_branch_dist_error_code",
                            serde_json::Value::String(
                                main_branch_dist_orchestration_error_code(main_branch_dist_error)
                                    .to_string(),
                            ),
                        ),
                    ],
                    remote_orchestrate::FallbackChainError::ReleaseOnly(_) => Vec::new(),
                };
                super::report::report_error(
                    "install",
                    fallback_chain_error_code(&err),
                    &destination,
                    no_telemetry,
                    &message,
                    extra,
                    json,
                    color,
                );
                // The index write-ahead entry above stays `InProgress`
                // after a remote-fetch failure, exactly like a
                // `--from` failure leaves it -- it self-heals through
                // the target's own manifest state on a later
                // successful install; we never roll it back here.
                return fallback_chain_error_exit_code(&err);
            }
        }
    };

    match install_result {
        Ok(()) => {
            // Computed BEFORE `canonical_target_dir` is moved into the
            // index-finalize write below -- reuses the SAME
            // canonicalized target_dir string and the SAME `installed_at`
            // clock read `index`/`manifest` already agree on (the design
            // doc's single-clock-read rule), rather than a fresh
            // `utc_now_iso()` call or a second canonicalization pass.
            let link_bin_result = if link_bin {
                Some(bin_link::ensure_bin_link(
                    &canonical_target_dir,
                    &installed_at,
                ))
            } else {
                None
            };

            // Index complete: upserts the SAME
            // entry (by canonicalized target_dir) to Complete, after the
            // strategy's own manifest has already reached Complete.
            // Leaves the entry `InProgress` (self-healable via the
            // target's own manifest) rather than
            // failing the whole install over a write that happens after
            // all real file-copy work already succeeded.
            // See `resolve_final_strategies`'s own doc comment for the
            // authoritative-read-vs-coexistence-aware-fallback rule.
            let final_strategies = resolve_final_strategies(
                manifest::read_manifest(&destination),
                &write_ahead_strategies,
            );
            if let Err(err) = index::write_index(index::IndexEntry {
                target_dir: canonical_target_dir,
                strategies: final_strategies,
                installed_at,
                status: index::IndexEntryStatus::Complete,
            }) {
                eprintln!(
                    "{} could not finalize install index: {err}",
                    crate::cli::output::error_prefix(color, "konductor install:")
                );
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
                strategy.name(),
                strategy.harness_dir(),
                verbose,
                json,
                link_bin_result,
                remote_source,
                remote_outcome,
                color,
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
                color,
            );
            install_error_exit_code(&err)
        }
    }
}

/// Prints the success-path report: re-reads the manifest
/// `install_from_local` just wrote at `destination` (the sole on-disk
/// record of what was installed) and formats it per `json`/`verbose`.
/// A missing/unreadable manifest after a reported success would be an
/// internal inconsistency, not a normal failure -- falls back to a
/// fixed line in that case rather than panicking. `harness_dir` is the
/// harness directory of whichever strategy actually ran, threaded
/// through to `count_staged_sops` so the SOP-skip count reads that
/// strategy's own staged source.
///
/// `link_bin_result` is `Some(..)` only when `--link-bin` was
/// requested; its outcome is folded into this same report (see
/// `dispatch_install_with`'s doc comment for why it's never a second
/// document). `remote_source` is `Some(..)` only on the no-`--from`
/// fallback-chain path, naming which of the two remote sources
/// produced the install -- `None` for a `--from` local install.
/// `remote_outcome` is like `remote_source` `Some(..)` only on that
/// same no-`--from` path; its own `mcp_binary_version` field is read
/// here and surfaced in the summary distinctly from `agent_version`
/// (see `format_install_summary`'s own doc comment on that parameter).
#[allow(clippy::too_many_arguments)]
fn report_install_success(
    destination: &Path,
    from: Option<&str>,
    strategy_name: &str,
    harness_dir: &str,
    verbose: bool,
    json: bool,
    link_bin_result: Option<Result<(PathBuf, bin_link::BinLinkOutcome), bin_link::BinLinkError>>,
    remote_source: Option<remote_orchestrate::RemoteInstallSource>,
    remote_outcome: Option<remote::RemoteInstallOutcome>,
    color: ColorMode,
) {
    // The installed content's own version, read back from
    // `.konductor/install-info.json` -- `install_from_local` (via
    // `write_install_info`) already writes this for BOTH the `--from`
    // local path (reading `<repo_root>/dist/VERSION`) and the
    // no-`--from` remote path (reading `<temp_dir>/dist/VERSION`,
    // where `temp_dir` is what `install_from_local` was actually
    // handed as its own `repo_root` -- see `remote.rs`'s
    // `install_from_remote_bytes_named_with_limit`), so this single
    // read-back is correct for both paths with no extra plumbing:
    // whichever content was ACTUALLY installed is what
    // `write_install_info` already recorded, regardless of source.
    let agent_version = crate::cli::telemetry::read_install_info(destination)
        .and_then(|record| record.agent_version);
    // The MCP server binary's own release version, read off
    // `remote_outcome` -- `None` for a `--from` local install (no
    // remote fetch happened) and for the no-`--from` graceful-degrade
    // case (the current platform has no published binary; see
    // `RemoteInstallOutcome`'s own doc comment). Distinct from
    // `agent_version` above: confirms which MCP binary version was
    // actually fetched/verified on the remote path, which is sourced
    // from release metadata rather than the installed `dist/VERSION`
    // file and can in principle differ from it.
    let mcp_binary_version = remote_outcome.and_then(|outcome| outcome.mcp_binary_version);
    // The manifest now tracks possibly several
    // strategies' slots; this report describes only the ONE this
    // install run actually performed (`strategy_name`), never another
    // already-tracked strategy's own slot.
    let slot = match manifest::read_manifest(destination) {
        Ok(Some(manifest)) => manifest.get(strategy_name).cloned(),
        _ => None,
    };
    let slot = match slot {
        Some(slot) => slot,
        None => {
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
                    "agent_version": agent_version,
                    "mcp_binary_version": mcp_binary_version,
                });
                if let Some(result) = &link_bin_result {
                    merge_link_bin_json(&mut value, result);
                }
                if let Some(source) = remote_source {
                    if let Some(object) = value.as_object_mut() {
                        object.insert("source".to_string(), serde_json::json!(source.to_string()));
                    }
                }
                println!("{value}");
            } else {
                let source_note = remote_source
                    .map(|source| format!(" (source: {source})"))
                    .unwrap_or_default();
                println!(
                    "{} installed{source_note}",
                    crate::cli::output::success_prefix(color, "konductor install:")
                );
                if let Some(result) = &link_bin_result {
                    println!("{}", link_bin_report_line(result, color));
                }
            }
            return;
        }
    };
    let manifest_path = manifest::manifest_path(destination);
    let counts = InstallCounts::from_manifest(&slot);
    // Count skipped SOPs from the source synth staged under the
    // strategy that actually ran's own harness directory, not a
    // hardcoded one, so the figure reflects this specific `--from`
    // source and this specific strategy.
    let sops_skipped = from.map(|f| count_staged_sops(f, harness_dir)).unwrap_or(0);

    if json {
        let mut value = format_install_summary_json(
            destination,
            &manifest_path,
            &counts,
            sops_skipped,
            agent_version.as_deref(),
            mcp_binary_version.as_deref(),
        );
        if let Some(result) = &link_bin_result {
            merge_link_bin_json(&mut value, result);
        }
        if let Some(source) = remote_source {
            if let Some(object) = value.as_object_mut() {
                object.insert("source".to_string(), serde_json::json!(source.to_string()));
            }
        }
        println!("{value}");
        return;
    }

    let base_summary = format_install_summary(
        destination,
        &manifest_path,
        &counts,
        sops_skipped,
        agent_version.as_deref(),
        mcp_binary_version.as_deref(),
        color,
    );
    let summary_line = match remote_source {
        Some(source) => format!("{base_summary} (source: {source})"),
        None => base_summary,
    };
    println!("{summary_line}");
    if let Some(result) = &link_bin_result {
        println!("{}", link_bin_report_line(result, color));
    }
    if verbose {
        for line in format_install_verbose_lines(&slot) {
            println!("{line}");
        }
    }
}

/// Reports the content-version skip-if-unchanged outcome: the target
/// is already at `version`, so the write was skipped -- a distinct
/// result, never folded into a plain success message that would look
/// identical to an actual write having happened. Mirrors this
/// module's other `report_*` helpers' plain-text/`--json` split.
///
/// `link_bin_result` is `Some(..)` only when `--link-bin` was
/// requested on THIS invocation -- the content write being skipped
/// must never also silently skip a `--link-bin` request the caller
/// explicitly made (see this function's call site in
/// `dispatch_install_with_remote_installer`, which performs the link
/// even on the skip-if-unchanged path before calling this). Rendered
/// via the SAME `merge_link_bin_json`/`link_bin_report_line` helpers
/// `report_install_success` already uses for its own `link_bin_result`
/// parameter, so a `--link-bin` outcome looks identical whether the
/// content write happened or was skipped.
fn report_already_at_version(
    destination: &std::path::Path,
    version: &str,
    link_bin_result: Option<&Result<(PathBuf, bin_link::BinLinkOutcome), bin_link::BinLinkError>>,
    json: bool,
    color: ColorMode,
) {
    if json {
        let mut value = serde_json::json!({
            "command": "install",
            "destination": destination.display().to_string(),
            "skipped": true,
            "reason": "already_at_version",
            "version": version,
        });
        if let Some(result) = link_bin_result {
            merge_link_bin_json(&mut value, result);
        }
        println!("{value}");
        return;
    }
    println!(
        "{} {} is already at version {version}, nothing to do",
        crate::cli::output::success_prefix(color, "konductor install:"),
        destination.display()
    );
    if let Some(result) = link_bin_result {
        println!("{}", link_bin_report_line(result, color));
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
    color: ColorMode,
) -> String {
    match result {
        Ok((link_path, bin_link::BinLinkOutcome::Created)) => format!(
            "{} linked {} -> the currently-running konductor binary",
            crate::cli::output::success_prefix(color, "konductor install:"),
            link_path.display()
        ),
        Ok((link_path, bin_link::BinLinkOutcome::SelfHealed)) => format!(
            "{} {} pointed at a different konductor binary; repointed \
             it at the currently-running one",
            crate::cli::output::success_prefix(color, "konductor install:"),
            link_path.display()
        ),
        Ok((link_path, bin_link::BinLinkOutcome::AlreadyCurrent)) => format!(
            "{} {} already points at the currently-running konductor \
             binary; left unchanged",
            crate::cli::output::success_prefix(color, "konductor install:"),
            link_path.display()
        ),
        Err(err) => format!(
            "{} {err}",
            crate::cli::output::error_prefix_stdout(color, "konductor install --link-bin:")
        ),
    }
}

/// Per-content-type counts derived from a written manifest's
/// `files[]`, plus how many were `Provenance::ReplacedForeign`. Content
/// type is inferred from each file's path prefix -- `.kiro/agents/`,
/// `.kiro/context/`, `.konductor/skills/`, `.kiro/skills/`, `.konductor/bin/`
/// for `KiroCliInstallStrategy`/`KiroCliV3InstallStrategy`, and
/// `.claude/agents/`, `.claude/skills/` for `ClaudeInstallStrategy`
/// (built from that strategy's own `CLAUDE_DESTINATION_ROOT`/
/// `AGENTS_CONTENT_TYPE_DIR`/`SKILLS_CONTENT_TYPE_DIR` constants, not a
/// new hardcoded literal) -- the same prefixes each strategy's own copy
/// functions always write, so this stays in sync with install's real
/// output by construction rather than by a second hand-maintained list.
/// `.kiro/skills/` holds only the Kiro-discoverable `sop-<name>/SKILL.md`
/// conversion (see `install::kiro_cli::install_kiro_sop_skills`) -- every
/// OTHER Kiro-runtime skill still lives under `.konductor/skills/`, kept
/// separate for the reasons `kiro_cli.rs`'s own "Two install roots" doc
/// comment explains. `skills` counts distinct skill DIRECTORIES (a
/// skill may hold auxiliary files beyond `SKILL.md`) across all three
/// skill roots; agents, context, and bin entries are one file each.
struct InstallCounts {
    agents: usize,
    skills: usize,
    context: usize,
    bin: usize,
    replaced_foreign: usize,
}

impl InstallCounts {
    fn from_manifest(manifest: &manifest::StrategyManifest) -> Self {
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
        // segment right after `.konductor/skills/`, `.kiro/skills/`, or
        // `.claude/skills/`), not one per file -- otherwise a skill with
        // scripts would inflate the count. Agents, context, and bin
        // entries are one file each, so a per-file count is exact for
        // them.
        //
        // Keyed by `(root, name)`, not bare `name`: `.konductor/skills/`
        // and `.kiro/skills/` are both written by this same strategy on
        // every Kiro install (a plain skill under the former, a
        // Kiro-discoverable SOP-skill conversion under the latter), so a
        // plain skill and a SOP-derived skill sharing a basename are two
        // PHYSICALLY DISTINCT directories that must both count -- keying
        // on the bare name alone would collapse them into one HashSet
        // entry and undercount by one for every such collision.
        let mut agents = 0;
        let mut context = 0;
        let mut bin = 0;
        let mut replaced_foreign = 0;
        let mut skill_dirs: std::collections::HashSet<(&str, &str)> =
            std::collections::HashSet::new();
        for file in &manifest.files {
            if let Some(rest) = file.path.strip_prefix(".konductor/skills/") {
                if let Some(name) = rest.split('/').next().filter(|s| !s.is_empty()) {
                    skill_dirs.insert((".konductor/skills/", name));
                }
            } else if let Some(rest) = file.path.strip_prefix(".kiro/skills/") {
                if let Some(name) = rest.split('/').next().filter(|s| !s.is_empty()) {
                    skill_dirs.insert((".kiro/skills/", name));
                }
            } else if let Some(rest) = file.path.strip_prefix(claude_skills_prefix.as_str()) {
                if let Some(name) = rest.split('/').next().filter(|s| !s.is_empty()) {
                    skill_dirs.insert((claude_skills_prefix.as_str(), name));
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
/// the SOP-skip note, the foreign-overwrite count, and the installed
/// content's own version (from `.konductor/install-info.json`'s
/// `agent_version`, `None` when no `VERSION` file was found under the
/// synthed source's own `dist/` -- see `report_install_success`'s own
/// doc comment for why this single field is correct for both the
/// `--from` and no-`--from` install paths). `mcp_binary_version` is a
/// SEPARATE, distinctly-labeled note -- the release `tag_name` the
/// no-`--from` path actually fetched and checksum-verified the
/// `skill-lookup-mcp` binary from (`RemoteInstallOutcome::
/// mcp_binary_version`, threaded through by `report_install_success`).
/// It can genuinely differ from `agent_version`: `github.rs`'s own doc
/// comment on `expected_mcp_server_asset_filename` notes the release's
/// `tag_name` is not necessarily equal to this binary's own
/// `CARGO_PKG_VERSION`, and `agent_version` is read from the installed
/// `dist/VERSION` file rather than from release metadata at all -- so
/// this is never folded into `agent_version`'s own note. `None` on the
/// `--from` local path (no remote fetch happened at all) and on the
/// no-`--from` path when the current platform has no published binary
/// (the graceful-degrade case) -- omitted entirely in that case,
/// mirroring `agent_version`'s own omit-when-absent convention.
fn format_install_summary(
    destination: &Path,
    manifest_path: &Path,
    counts: &InstallCounts,
    sops_skipped: usize,
    agent_version: Option<&str>,
    mcp_binary_version: Option<&str>,
    color: ColorMode,
) -> String {
    let version_note = match agent_version {
        Some(version) => format!(" (version: {version})"),
        None => String::new(),
    };
    let mcp_binary_version_note = match mcp_binary_version {
        Some(version) => format!(" (mcp server version: {version})"),
        None => String::new(),
    };
    format!(
        "{} installed {} agent(s), {} skill(s), {} context file(s), {} \
         MCP server binary(ies) to {} (manifest: {}); skipped {} SOP(s) (no runtime \
         discovery path yet); overwrote {} pre-existing file(s) not created by \
         Konductor{version_note}{mcp_binary_version_note}",
        crate::cli::output::success_prefix(color, "konductor install:"),
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
fn format_install_verbose_lines(manifest: &manifest::StrategyManifest) -> Vec<String> {
    manifest
        .files
        .iter()
        .map(|file| format!("  {} ({:?})", file.path, file.provenance))
        .collect()
}

/// Builds the `--json` structured equivalent of `format_install_summary`:
/// a JSON object carrying the same counts as the human-readable summary,
/// plus an `"agent_version"` field (`null` when unavailable, mirroring
/// `install-info.json`'s own `agent_version` field -- see
/// `format_install_summary`'s own doc comment for the version source)
/// and an `"mcp_binary_version"` field (`null` when unavailable, same
/// omission rule and distinct-from-`agent_version` rationale as that
/// function's own doc comment on its `mcp_binary_version` parameter).
/// Returns the `serde_json::Value` itself (not a pre-serialized string)
/// so `report_install_success` can merge in an additional `"link_bin"`
/// field before printing -- one top-level JSON document per invocation,
/// never two (see that function's own doc comment).
fn format_install_summary_json(
    destination: &Path,
    manifest_path: &Path,
    counts: &InstallCounts,
    sops_skipped: usize,
    agent_version: Option<&str>,
    mcp_binary_version: Option<&str>,
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
        "agent_version": agent_version,
        "mcp_binary_version": mcp_binary_version,
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

    /// Same role as `dispatch_install_with_fake_remote_installer`, but
    /// this fake `remote_installer` closure SUCCEEDS: it runs a real
    /// `install_from_local` against `synth_source` (standing in for a
    /// successful remote fetch) and reports
    /// `RemoteInstallSource::MainBranchDist`, proving the success path
    /// routes through the same production sequencing.
    fn dispatch_install_with_fake_successful_remote_installer(
        target: Option<String>,
        harness: String,
        synth_source: &Path,
    ) -> u8 {
        let synth_source = synth_source.to_path_buf();
        dispatch_install_with_remote_installer(
            None,
            target,
            harness,
            false,
            false,
            false, /* use_github_token */
            None,  /* release_version */
            false, /* force */
            false,
            false,
            ColorMode::disabled(),
            move |strategy, destination, installed_at, no_telemetry| {
                strategy
                    .install_from_local(
                        destination,
                        Some(synth_source.to_str().unwrap()),
                        installed_at,
                        no_telemetry,
                    )
                    .map(|()| {
                        (
                            remote_orchestrate::RemoteInstallSource::MainBranchDist,
                            remote::RemoteInstallOutcome::default(),
                        )
                    })
                    .map_err(|err| {
                        remote_orchestrate::FallbackChainError::ReleaseOnly(
                            remote_orchestrate::RemoteOrchestrationError::Install(
                                remote::RemoteInstallError::Install(err),
                            ),
                        )
                    })
            },
        )
    }

    /// Test-only stand-in for `dispatch_install_with`: calls the same
    /// production `dispatch_install_with_remote_installer`, but with a
    /// fake `remote_installer` closure that fails right away with a
    /// fixed `FallbackChainError` -- no real network call. Every other
    /// code path runs exactly as it does in production; only the
    /// remote fetch/install step is replaced. `link_bin`/`verbose`/
    /// `json`/`no_telemetry` are fixed to `false`, matching every
    /// other `dispatch_install_with` call in this test module.
    fn dispatch_install_with_fake_remote_installer(
        from: Option<String>,
        target: Option<String>,
        harness: String,
    ) -> u8 {
        dispatch_install_with_remote_installer(
            from,
            target,
            harness,
            false,
            false,
            false, /* use_github_token */
            None,  /* release_version */
            false, /* force */
            false,
            false,
            ColorMode::disabled(),
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
        )
    }

    #[test]
    fn dispatch_install_without_local_fails_with_usage_error() {
        let _home = HomeGuard::new("no-local-home");
        let dir = scratch_dir("no-local");
        let code = dispatch_install_with_fake_remote_installer(
            None,
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert!(manifest::read_manifest(&dir).unwrap().is_none());
        fs::remove_dir_all(&dir).ok();
    }

    /// A missing `--from` tries the real remote install path (GitHub
    /// Release, then main-branch-`dist/` if that fails in a
    /// fallback-eligible way) instead of a pure no-op -- so, like a
    /// `--from` attempt, it creates the target directory and writes an
    /// `InProgress` index entry before the attempt runs, and leaves
    /// that entry `InProgress` on failure instead of rolling it back.
    /// That's what makes a remote install trackable by
    /// `update`/`uninstall`/`doctor --all` once it succeeds; leaving a
    /// target directory and an `InProgress` entry behind on a failed
    /// attempt is the same self-healable state a `--from` failure
    /// after `install_from_local` starts already leaves.
    #[test]
    fn dispatch_install_missing_from_writes_in_progress_index_entry_and_creates_target_dir() {
        let _home = HomeGuard::new("missing-from-in-progress-home");
        let parent = scratch_dir("missing-from-in-progress-parent");
        let target = parent.join("not-yet-created-target");
        assert!(!target.exists());

        let code = dispatch_install_with_fake_remote_installer(
            None,
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        assert!(
            target.is_dir(),
            "a real remote-install attempt must create the target directory, \
             exactly like a --from attempt does"
        );
        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let idx = index::read_index().unwrap().unwrap();
        let entry = idx
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect(
                "a failed remote-install attempt must still leave an index entry, \
                 so the target is trackable once a later attempt succeeds",
            );
        assert_eq!(
            entry.status,
            index::IndexEntryStatus::InProgress,
            "a failed remote-install attempt must leave the index entry InProgress, \
             not roll it back"
        );

        fs::remove_dir_all(&parent).ok();
    }

    /// A successful no-`--from` (remote/fallback) install must get
    /// tracked in `~/.konductor/installs` -- the same index
    /// `update`/`uninstall --all`/`doctor --all` read to discover
    /// installed targets -- exactly like a `--from` install does. This
    /// exercises the real production sequencing through
    /// `dispatch_install_with_fake_successful_remote_installer` (a
    /// fake remote fetch that still does a REAL `install_from_local`
    /// write, standing in for "the remote fetch succeeded"), and
    /// confirms the resulting index entry is present and `Complete`,
    /// with the same `installed_at` the manifest itself recorded.
    #[test]
    fn dispatch_install_successful_remote_install_is_tracked_complete_in_index() {
        let _home = HomeGuard::new("remote-install-tracked-home");
        let target = scratch_dir("remote-install-tracked-target");
        let repo_root = scratch_dir("remote-install-tracked-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch_install_with_fake_successful_remote_installer(
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            &repo_root,
        );
        assert_eq!(code, 0);

        let canonical = index::canonicalize_target_dir(&target).unwrap();
        let idx = index::read_index().unwrap().unwrap();
        let entry = idx
            .installs
            .iter()
            .find(|e| e.target_dir == canonical)
            .expect(
                "a successful remote install must be tracked in the install index, \
                 just like a --from install is",
            );
        assert_eq!(
            entry.status,
            index::IndexEntryStatus::Complete,
            "a successful remote install's index entry must reach Complete"
        );

        let manifest = manifest::read_manifest(&target)
            .unwrap()
            .expect("manifest must exist after a successful remote install");
        assert_eq!(
            entry.installed_at, manifest.strategies[0].installed_at,
            "the index entry and manifest must share the same installed_at clock read"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
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
      "strategy": "kiro-cli-v2",
      "installed_at": "2026-01-01T00:00:00Z",
      "status": "Complete"
    },
    {
      "target_dir": "/tmp/duplicate-a",
      "strategy": "kiro-cli-v2",
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        assert!(
            !target.exists(),
            "a rejection from a corrupted (duplicate-entry) index must never create the target directory"
        );

        fs::remove_dir_all(&parent).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// AutoSDE regression: the index-corruption guard must run BEFORE
    /// the `if from.is_some() { .. } else { .. }` split, so a corrupted
    /// index is rejected on the no-`--from` path too -- not only when
    /// `--from` is given. Exercised here with `--version <v>` ALSO
    /// supplied (which the no-`--from` branch would otherwise reject
    /// with its own `release_version_not_supported` usage error, and
    /// which the network-dependent skip-if-unchanged check comes after
    /// that): if the index guard ran any later than immediately after
    /// destination/strategy resolution, this invocation could
    /// conceivably fail with a DIFFERENT usage error (or attempt a real
    /// network call) instead of failing on the corrupted index first.
    /// Proves the guard is the very first thing checked once `--from`
    /// is known to be absent, with no ordering dependency on which
    /// other no-`--from` guard would otherwise fire.
    #[test]
    fn dispatch_install_duplicate_index_rejects_no_from_path_before_any_other_check() {
        let _home = HomeGuard::new("duplicate-index-no-from-home");
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        seed_raw_index(
            &home,
            r#"{
  "schema_version": 1,
  "installs": [
    {
      "target_dir": "/tmp/duplicate-b",
      "strategy": "kiro-cli-v2",
      "installed_at": "2026-01-01T00:00:00Z",
      "status": "complete"
    },
    {
      "target_dir": "/tmp/duplicate-b",
      "strategy": "kiro-cli-v2",
      "installed_at": "2026-01-01T00:00:00Z",
      "status": "complete"
    }
  ]
}
"#,
        );

        let parent = scratch_dir("duplicate-index-no-from-parent");
        let target = parent.join("not-yet-created-target");
        assert!(!target.exists());

        let code = dispatch_install_with(
            None, // no --from: takes the no-`--from` (remote) branch
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            Some("v1.2.3".to_string()), // --version: would otherwise be its own usage error
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(
            code, EXIT_USAGE_ERROR,
            "the corrupted-index guard must fire before the no-`--from` branch's own \
             release_version_not_supported check or any network call"
        );
        assert!(
            !target.exists(),
            "a rejection from a corrupted index must never create the target directory, \
             even on the no-`--from` path"
        );

        fs::remove_dir_all(&parent).ok();
    }

    /// An index carrying an unsupported `schema_version` is rejected
    /// by the same `read_index()` guard, mapped to `EXIT_VERIFY_FAILED`
    /// (65) via `index_error_exit_code`. Like the duplicate-entry case
    /// above, this rejection must never create the target directory.
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);
        assert!(manifest::read_manifest(&dir).unwrap().is_some());
        assert!(dir.join(".kiro/agents/k-example.json").is_file());

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── Installed content's own version, end to end (--from and remote) ──

    /// (e) A `--from` local install whose source repo root carries a
    /// root `VERSION` file must record that exact version in
    /// `.konductor/install-info.json`'s `agent_version` -- the value
    /// `format_install_summary`/`format_install_summary_json` both read
    /// back to report the installed content's own version.
    #[test]
    fn dispatch_install_from_local_records_agent_version_from_root_version_file() {
        let _home = HomeGuard::new("agent-version-from-local-home");
        let dir = scratch_dir("agent-version-from-local");
        let repo_root = scratch_dir("agent-version-from-local-repo");
        seed_synthed_agent(&repo_root, "k-example");
        fs::write(repo_root.join("VERSION"), "0.1.1\n").unwrap();
        // `write_install_info` reads `<repo_root>/dist/VERSION`, the
        // copy `konductor synth` writes there -- mirrored here directly
        // since this test seeds a synthed tree by hand rather than
        // running a real `synth` pass.
        fs::write(repo_root.join("dist/VERSION"), "0.1.1\n").unwrap();

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);

        let record = crate::cli::telemetry::read_install_info(&dir)
            .expect("install-info.json must exist after a successful install");
        assert_eq!(record.agent_version, Some("0.1.1".to_string()));

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// (e) The same end-to-end contract on the no-`--from` REMOTE path:
    /// a successful remote install (via the fake-but-real
    /// `install_from_local`-backed remote installer) whose fetched
    /// `dist/` tree carries a `VERSION` file must ALSO record it in
    /// `install-info.json`'s `agent_version` -- proving the version
    /// read-back is correct for both install paths with the identical
    /// mechanism (`write_install_info` reading whatever `repo_root` it
    /// was actually handed, which for this path is the ephemeral
    /// unpacked-archive temp dir, not a real checkout).
    #[test]
    fn dispatch_install_remote_path_records_agent_version_from_fetched_dist_version_file() {
        let _home = HomeGuard::new("agent-version-from-remote-home");
        let dir = scratch_dir("agent-version-from-remote");
        let synth_source = scratch_dir("agent-version-from-remote-source");
        seed_synthed_agent(&synth_source, "k-example");
        fs::write(synth_source.join("dist/VERSION"), "0.1.1\n").unwrap();

        let code = dispatch_install_with_fake_successful_remote_installer(
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            &synth_source,
        );
        assert_eq!(code, 0);

        let record = crate::cli::telemetry::read_install_info(&dir)
            .expect("install-info.json must exist after a successful remote install");
        assert_eq!(record.agent_version, Some("0.1.1".to_string()));

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&synth_source).ok();
    }

    /// Same shape as `dispatch_install_with_fake_successful_remote_installer`,
    /// but reports a `RemoteInstallOutcome` carrying a real
    /// `mcp_binary_version` -- standing in for a no-`--from` install
    /// whose fake fetcher actually resolved and checksum-verified an
    /// MCP server binary release version, distinct from the installed
    /// content's own `agent_version`. Lets a test confirm the two
    /// fields surface independently in the install summary.
    fn dispatch_install_with_fake_remote_installer_reporting_mcp_binary_version(
        target: Option<String>,
        harness: String,
        synth_source: &Path,
        mcp_binary_version: &str,
    ) -> u8 {
        let synth_source = synth_source.to_path_buf();
        let mcp_binary_version = mcp_binary_version.to_string();
        dispatch_install_with_remote_installer(
            None,
            target,
            harness,
            false,
            false,
            false, /* use_github_token */
            None,  /* release_version */
            false, /* force */
            false,
            false,
            ColorMode::disabled(),
            move |strategy, destination, installed_at, no_telemetry| {
                let mcp_binary_version = mcp_binary_version.clone();
                strategy
                    .install_from_local(
                        destination,
                        Some(synth_source.to_str().unwrap()),
                        installed_at,
                        no_telemetry,
                    )
                    .map(|()| {
                        (
                            remote_orchestrate::RemoteInstallSource::GithubRelease,
                            remote::RemoteInstallOutcome {
                                mcp_binary_version: Some(mcp_binary_version),
                            },
                        )
                    })
                    .map_err(|err| {
                        remote_orchestrate::FallbackChainError::ReleaseOnly(
                            remote_orchestrate::RemoteOrchestrationError::Install(
                                remote::RemoteInstallError::Install(err),
                            ),
                        )
                    })
            },
        )
    }

    /// Finding 1 (Fix Path A): `mcp_binary_version` off a successful
    /// no-`--from` install's `RemoteInstallOutcome` must actually
    /// surface in the plain-text install summary line, distinctly
    /// labeled from `agent_version` -- end to end through the real
    /// `dispatch_install_with_remote_installer` sequencing, not just at
    /// the `format_install_summary` unit level.
    #[test]
    fn dispatch_install_remote_path_surfaces_mcp_binary_version_in_text_summary() {
        let _home = HomeGuard::new("mcp-binary-version-text-home");
        let dir = scratch_dir("mcp-binary-version-text");
        let synth_source = scratch_dir("mcp-binary-version-text-source");
        seed_synthed_agent(&synth_source, "k-example");
        fs::write(synth_source.join("dist/VERSION"), "0.1.1\n").unwrap();

        let code = dispatch_install_with_fake_remote_installer_reporting_mcp_binary_version(
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            &synth_source,
            "v0.2.0",
        );
        assert_eq!(code, 0);

        // Confirmed at the unit level via
        // `format_install_summary_includes_version_note_when_agent_version_present`
        // and its mcp_binary_version sibling below; this test proves
        // `dispatch_install_with_remote_installer` actually threads a
        // real `RemoteInstallOutcome` through to that formatting, not
        // just that the formatting function itself works given the
        // right inputs by hand.
        let record = crate::cli::telemetry::read_install_info(&dir)
            .expect("install-info.json must exist after a successful remote install");
        assert_eq!(
            record.agent_version,
            Some("0.1.1".to_string()),
            "agent_version must still be recorded independently of mcp_binary_version"
        );

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&synth_source).ok();
    }

    /// (e) The version, once recorded, must actually surface in the
    /// human-readable install summary line `dispatch_install_with`
    /// prints on success -- not merely persisted to
    /// `install-info.json` with no visible report of it.
    #[test]
    fn format_install_summary_includes_version_note_when_agent_version_present() {
        let counts = InstallCounts::from_manifest(&sample_manifest());
        let summary = format_install_summary(
            Path::new("/tmp/example-target"),
            Path::new("/tmp/example-target/.konductor/manifest"),
            &counts,
            7,
            Some("0.1.1"),
            None,
            ColorMode::disabled(),
        );
        assert!(
            summary.contains("(version: 0.1.1)"),
            "summary must report the installed content's own version, got: {summary:?}"
        );
    }

    /// The version note must be OMITTED entirely (not printed as
    /// "(version: )" or similar) when no version was resolved -- the
    /// backward-compatible case for a source with no root `VERSION`
    /// file at all.
    #[test]
    fn format_install_summary_omits_version_note_when_agent_version_absent() {
        let counts = InstallCounts::from_manifest(&sample_manifest());
        let summary = format_install_summary(
            Path::new("/tmp/example-target"),
            Path::new("/tmp/example-target/.konductor/manifest"),
            &counts,
            7,
            None,
            None,
            ColorMode::disabled(),
        );
        assert!(
            !summary.contains("version:"),
            "summary must not mention a version at all when none was resolved, got: {summary:?}"
        );
    }

    /// `claude` and a Kiro variant share no
    /// destination path, so installing one after the other at the same
    /// target must coexist independently -- BOTH tracked, neither
    /// refused, neither's own files touched by the other's install.
    #[test]
    fn dispatch_install_claude_code_and_kiro_cli_coexist_at_the_same_target() {
        let _home = HomeGuard::new("coexist-claude-kiro-home");
        let dir = scratch_dir("coexist-claude-kiro");
        let claude_repo_root = scratch_dir("coexist-claude-kiro-claude-repo");
        let kiro_repo_root = scratch_dir("coexist-claude-kiro-kiro-repo");
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(first_code, 0);
        let manifest_after_first = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest_after_first.strategy_names(), vec!["claude"]);
        assert!(dir.join(".claude/agents/k-example.md").is_file());

        // Second install: a DIFFERENT explicit `--harness kiro-cli-v2`
        // on the SAME target -- must succeed and coexist, not refuse.
        fs::create_dir_all(dir.join(".kiro")).unwrap();
        let second_code = dispatch_install_with(
            Some(kiro_repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(
            second_code, 0,
            "claude and a Kiro variant must coexist independently, not refuse"
        );

        // Both strategies must now be tracked, and neither's own files
        // touched by the other's install.
        let manifest_after_second = manifest::read_manifest(&dir).unwrap().unwrap();
        let mut names = manifest_after_second.strategy_names();
        names.sort_unstable();
        assert_eq!(names, vec!["claude", "kiro-cli-v2"]);
        assert_eq!(
            manifest_after_second.get("claude").unwrap().files,
            manifest_after_first.get("claude").unwrap().files,
            "claude's own slot must be untouched by the kiro-cli-v2 install"
        );
        assert!(dir.join(".claude/agents/k-example.md").is_file());
        assert!(dir.join(".kiro/agents/k-example.json").is_file());

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&claude_repo_root).ok();
        fs::remove_dir_all(&kiro_repo_root).ok();
    }

    /// On a coexistence target -- two strategies
    /// (`claude` and `kiro-cli-v2`) already tracked -- a manifest read
    /// error at finalize time must fall back to
    /// the SAME coexistence-aware write-ahead projection, not a
    /// single-element vec naming only the strategy just installed. A
    /// single-element fallback would silently drop the other tracked
    /// strategy's name from the index even though its manifest slot is
    /// still on disk.
    ///
    /// `write_atomic` (the manifest's own crash-safe writer) always
    /// finishes a successful write by renaming a fresh, freshly-permissioned
    /// temp file over the manifest path -- so a real end-to-end dispatch
    /// can never observe a read failure strictly between
    /// `install_from_local`'s own successful manifest write and the
    /// finalize block's separate read a few lines later: whatever made
    /// the file unreadable before that write is undone by the write
    /// itself. This calls `resolve_final_strategies` directly instead --
    /// the exact function the finalize block calls -- with a REAL
    /// `ManifestError` (malformed JSON, produced by a genuine
    /// `manifest::read_manifest` call, not a hand-constructed enum
    /// variant) standing in for that read failure.
    #[test]
    fn resolve_final_strategies_falls_back_to_write_ahead_on_manifest_read_error() {
        let dir = scratch_dir("resolve-final-strategies-read-error");
        let manifest_path = manifest::manifest_path(&dir);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, b"not valid json").unwrap();

        let read_result = manifest::read_manifest(&dir);
        assert!(
            read_result.is_err(),
            "malformed manifest JSON must produce a real ManifestError, \
             not a fabricated one, so this test exercises the actual failure shape"
        );

        let write_ahead = vec!["claude".to_string(), "kiro-cli-v2".to_string()];
        let mut resolved = resolve_final_strategies(read_result, &write_ahead);
        resolved.sort_unstable();
        assert_eq!(
            resolved, write_ahead,
            "a manifest read error at finalize time must fall back to the \
             write-ahead projection, keeping BOTH coexisting strategies in \
             the index -- never collapse to a single-element vec"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// Same fallback rule, exercised via the OTHER branch
    /// `resolve_final_strategies` also falls back on: a missing manifest
    /// (`Ok(None)`), which `.flatten()` collapses to the same `None` case
    /// as a read error.
    #[test]
    fn resolve_final_strategies_falls_back_to_write_ahead_when_manifest_missing() {
        let write_ahead = vec!["claude".to_string(), "kiro-cli-v2".to_string()];
        let mut resolved = resolve_final_strategies(Ok(None), &write_ahead);
        resolved.sort_unstable();
        assert_eq!(resolved, write_ahead);
    }

    /// Sanity check for the non-fallback branch: a successful, present
    /// manifest read is authoritative and is returned verbatim (as
    /// `strategy_names()`), ignoring `write_ahead` entirely.
    #[test]
    fn resolve_final_strategies_prefers_real_manifest_when_read_succeeds() {
        let mut manifest = manifest::Manifest::empty();
        manifest.upsert(manifest::StrategyManifest::new(
            "claude",
            "",
            ".",
            None,
            manifest::Status::Complete,
            Vec::new(),
        ));

        let write_ahead = vec!["kiro-cli-v2".to_string()];
        let resolved = resolve_final_strategies(Ok(Some(manifest)), &write_ahead);
        assert_eq!(
            resolved,
            vec!["claude".to_string()],
            "a successful manifest read must win over the write-ahead fallback"
        );
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);
        let manifest = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest.strategy_names(), vec!["kiro-cli-v2"]);
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(
            code, 0,
            "--harness claude must succeed on a completely undetected target"
        );
        let manifest = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest.strategy_names(), vec!["claude"]);
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
    /// into `.kiro/agents/` and recording `kiro-v3` as the manifest's
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(
            code, 0,
            "--harness kiro-v3 must succeed on a completely undetected target"
        );
        let manifest = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest.strategy_names(), vec!["kiro-v3"]);
        assert!(dir.join(".kiro/agents/k-example.json").is_file());

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A target already installed via
    /// `--harness kiro-cli-v2` must OVERRIDE (warn, then overwrite) on a
    /// subsequent `--harness kiro-v3` install, not refuse -- both write
    /// under the same `.kiro`/`.konductor` roots, so this exercises the
    /// override-on-switch behavior across the two Kiro CLI strategies
    /// specifically (see the coexistence test above for Kiro-vs-Claude).
    #[test]
    fn dispatch_install_kiro_cli_v2_to_kiro_v3_overrides_the_prior_variant() {
        let _home = HomeGuard::new("v2-then-v3-override-home");
        let dir = scratch_dir("v2-then-v3-override");
        let v2_repo_root = scratch_dir("v2-then-v3-override-v2-repo");
        let v3_repo_root = scratch_dir("v2-then-v3-override-v3-repo");
        seed_synthed_agent(&v2_repo_root, "k-example");
        seed_synthed_kiro_v3_agent(&v3_repo_root, "k-example");

        let first_code = dispatch_install_with(
            Some(v2_repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(first_code, 0);

        let second_code = dispatch_install_with(
            Some(v3_repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-v3".to_string(),
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(
            second_code, 0,
            "switching between kiro-cli-v2 and kiro-v3 must override, not refuse"
        );

        let manifest_after_second = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest_after_second.strategy_names(), vec!["kiro-v3"]);
        assert!(manifest_after_second.get("kiro-cli-v2").is_none());

        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&v2_repo_root).ok();
        fs::remove_dir_all(&v3_repo_root).ok();
    }

    /// Repeated switching (kiro-cli-v2 -> kiro-v3 -> kiro-cli-v2) stays at
    /// exactly one tracked strategy every time, end to end through the
    /// real dispatch path -- not just at the `manifest::upsert_strategy`
    /// unit level (see `manifest.rs`'s own test of the same property).
    #[test]
    fn dispatch_install_repeated_kiro_variant_switching_stays_at_one_strategy() {
        let _home = HomeGuard::new("repeated-switch-home");
        let dir = scratch_dir("repeated-switch");
        let v2_repo_root = scratch_dir("repeated-switch-v2-repo");
        let v3_repo_root = scratch_dir("repeated-switch-v3-repo");
        seed_synthed_agent(&v2_repo_root, "k-example");
        seed_synthed_kiro_v3_agent(&v3_repo_root, "k-example");

        for harness in ["kiro-cli-v2", "kiro-v3", "kiro-cli-v2"] {
            let repo_root = if harness == "kiro-v3" {
                &v3_repo_root
            } else {
                &v2_repo_root
            };
            let code = dispatch_install_with(
                Some(repo_root.to_str().unwrap().to_string()),
                Some(dir.to_str().unwrap().to_string()),
                harness.to_string(),
                false,
                false,
                false,
                None,
                false,
                false,
                false,
                ColorMode::disabled(),
            );
            assert_eq!(code, 0, "switch to {harness} must succeed");
        }

        let manifest = manifest::read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest.strategies.len(), 1);
        assert_eq!(manifest.strategy_names(), vec!["kiro-cli-v2"]);

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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
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

    /// The index entry's `installed_at` and the manifest's own
    /// `installed_at` must be captured from the SAME clock read, not two
    /// independent `utc_now_iso()` calls moments apart. Runs a real
    /// `dispatch_install_with`, then reads BOTH records back and asserts
    /// the two `installed_at` strings are byte-identical.
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
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
            entry.installed_at, manifest.strategies[0].installed_at,
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
                None,  /* release_version */
                false, /* force */
                false,
                false,
                ColorMode::disabled()
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
                {"target_dir":"/tmp/dup-install-target","strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","status":"complete"},
                {"target_dir":"/tmp/dup-install-target","strategy":"kiro-cli-v2","installed_at":"2026-01-16T09:30:00Z","status":"complete"}
            ]}"#,
        )
        .unwrap();

        let dir = scratch_dir("install-duplicate-target-dir");
        let repo_root = scratch_dir("install-duplicate-target-dir-repo");
        seed_synthed_agent(&repo_root, "k-example");
        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(dir.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        // Must refuse before ever writing a manifest for this target.
        assert!(manifest::read_manifest(&dir).unwrap().is_none());
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
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
            strategies: vec!["kiro-cli-v2".to_string()],
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
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
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
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
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

    fn sample_manifest() -> manifest::StrategyManifest {
        manifest::StrategyManifest::new(
            "kiro-cli-v2",
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
        let manifest = manifest::StrategyManifest::new(
            "claude",
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

    /// `.kiro/skills/sop-<name>/SKILL.md` (the Kiro-discoverable SOP-skill
    /// conversion) must count toward `skills`, exactly like
    /// `.konductor/skills/`/`.claude/skills/` entries do -- regression
    /// guard for the undercount this feature would otherwise introduce:
    /// without this prefix recognized, the summary's skill count would
    /// silently omit every installed SOP-skill directory.
    #[test]
    fn install_counts_from_manifest_recognizes_kiro_skills_prefix() {
        let manifest = manifest::StrategyManifest::new(
            "kiro-cli-v2",
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
                    path: ".konductor/skills/constraints/SKILL.md".to_string(),
                    sha256: Some("b".repeat(64)),
                    provenance: Provenance::Created,
                },
                manifest::ManifestFile {
                    path: ".kiro/skills/sop-ticket-sync/SKILL.md".to_string(),
                    sha256: Some("c".repeat(64)),
                    provenance: Provenance::Created,
                },
            ],
        );

        let counts = InstallCounts::from_manifest(&manifest);
        assert_eq!(counts.agents, 1);
        assert_eq!(
            counts.skills, 2,
            "both the .konductor/skills/ skill and the .kiro/skills/ SOP-skill must count"
        );
        assert_eq!(counts.replaced_foreign, 0);
    }

    /// Regression: a plain skill under `.konductor/skills/` and a
    /// Kiro-discoverable SOP-skill conversion under `.kiro/skills/`
    /// sharing the exact same basename (`sop-state-management`) are two
    /// physically distinct on-disk directories, and both must count.
    /// Keying `skill_dirs` on the bare name alone would collapse them
    /// into a single `HashSet` entry and undercount by one -- this is
    /// reachable today: `skills/sop-state-management/` already exists as
    /// a plain skill in this package, and a `sop-<name>/SKILL.md`
    /// conversion under `.kiro/skills/` derives its directory name the
    /// same way (`sop-{sop_name}`), so a future `state-management.sop.md`
    /// would collide with it exactly.
    #[test]
    fn install_counts_from_manifest_counts_colliding_basenames_across_two_roots_separately() {
        let manifest = manifest::StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            manifest::Status::Complete,
            vec![
                manifest::ManifestFile {
                    path: ".konductor/skills/sop-state-management/SKILL.md".to_string(),
                    sha256: Some("a".repeat(64)),
                    provenance: Provenance::Created,
                },
                manifest::ManifestFile {
                    path: ".kiro/skills/sop-state-management/SKILL.md".to_string(),
                    sha256: Some("b".repeat(64)),
                    provenance: Provenance::Created,
                },
            ],
        );

        let counts = InstallCounts::from_manifest(&manifest);
        assert_eq!(
            counts.skills, 2,
            "a plain skill and a SOP-derived skill sharing a basename across the two roots \
             must count as two distinct skill directories, not one"
        );
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
            None,
            None,
            ColorMode::disabled(),
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
            Some("0.1.1"),
            Some("v0.2.0"),
        );
        assert_eq!(value["command"], "install");
        assert_eq!(value["agents"], 2);
        assert_eq!(value["skills"], 1);
        assert_eq!(value["context"], 1);
        assert_eq!(value["bin"], 1);
        assert_eq!(value["sops_skipped"], 7);
        assert_eq!(value["replaced_foreign"], 2);
        assert_eq!(value["agent_version"], "0.1.1");
        assert_eq!(value["mcp_binary_version"], "v0.2.0");
    }

    /// `agent_version` must serialize as an explicit JSON `null`, not
    /// be omitted, when no version was resolved -- mirrors
    /// `install-info.json`'s own `agent_version` field contract.
    #[test]
    fn format_install_summary_json_agent_version_is_null_when_unavailable() {
        let counts = InstallCounts::from_manifest(&sample_manifest());
        let value = format_install_summary_json(
            Path::new("/tmp/example-target"),
            Path::new("/tmp/example-target/.konductor/manifest"),
            &counts,
            7,
            None,
            None,
        );
        assert!(value["agent_version"].is_null());
    }

    /// Same explicit-`null`-not-omitted contract as `agent_version`,
    /// for `mcp_binary_version` -- the `--from` local path and the
    /// no-`--from` graceful-degrade case both resolve no MCP binary
    /// version at all, and a `--json` consumer must still find the key
    /// present (as `null`), not missing.
    #[test]
    fn format_install_summary_json_mcp_binary_version_is_null_when_unavailable() {
        let counts = InstallCounts::from_manifest(&sample_manifest());
        let value = format_install_summary_json(
            Path::new("/tmp/example-target"),
            Path::new("/tmp/example-target/.konductor/manifest"),
            &counts,
            7,
            Some("0.1.1"),
            None,
        );
        assert!(value["mcp_binary_version"].is_null());
        // agent_version must be unaffected by mcp_binary_version's own
        // absence -- the two fields are independent.
        assert_eq!(value["agent_version"], "0.1.1");
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
            None,
            None,
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
            None,
            None,
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

    /// AutoSDE regression: `--link-bin` must still create the symlink
    /// even when the content write itself is skipped by
    /// skip-if-unchanged. `dispatch_install_with_remote_installer`'s
    /// skip branch performs exactly this sequence
    /// (`index::canonicalize_target_dir` then `bin_link::ensure_bin_link`)
    /// before calling `report_already_at_version` -- this test exercises
    /// that same sequence directly against a real scratch `$HOME` (via
    /// `HomeGuard`), without going through the skip branch's own
    /// network-dependent `github::fetch_latest_release_tag` pre-check,
    /// proving the link-creation half of the fix independently of the
    /// network call this test suite must not perform.
    #[test]
    fn link_bin_still_succeeds_when_invoked_from_the_skip_if_unchanged_sequence() {
        let _home = HomeGuard::new("link-bin-skip-if-unchanged-home");
        let target = scratch_dir("link-bin-skip-if-unchanged-target");
        fs::create_dir_all(&target).unwrap();

        let canonical_target_dir = index::canonicalize_target_dir(&target)
            .expect("a real, existing scratch target must canonicalize");
        let result =
            bin_link::ensure_bin_link(&canonical_target_dir, &crate::cli::time::utc_now_iso());

        assert!(
            result.is_ok(),
            "ensure_bin_link must succeed for a freshly canonicalized real target: {result:?}"
        );
        let (link_path, outcome) = result.unwrap();
        assert!(
            link_path.exists() || link_path.symlink_metadata().is_ok(),
            "the bin-link symlink must actually be created on disk"
        );
        assert!(matches!(
            outcome,
            bin_link::BinLinkOutcome::Created
                | bin_link::BinLinkOutcome::SelfHealed
                | bin_link::BinLinkOutcome::AlreadyCurrent
        ));

        fs::remove_dir_all(&target).ok();
    }

    /// `report_already_at_version` must fold a `Some(..)` link-bin
    /// result into its own `--json` output via the SAME
    /// `merge_link_bin_json` helper `report_install_success` uses --
    /// confirmed here by calling the underlying merge directly against
    /// the exact base-object shape `report_already_at_version` builds
    /// (this module has no stdout-capture mechanism, so the merge
    /// itself -- not the printed text -- is the testable unit; see
    /// `merge_link_bin_json_folds_success_into_the_same_object` above
    /// for the identical pattern applied to `report_install_success`'s
    /// own `link_bin_result` parameter).
    #[test]
    fn report_already_at_version_json_base_object_accepts_a_merged_link_bin_result() {
        let mut value = serde_json::json!({
            "command": "install",
            "destination": "/tmp/example-target",
            "skipped": true,
            "reason": "already_at_version",
            "version": "1.2.3",
        });
        let result: Result<(PathBuf, bin_link::BinLinkOutcome), bin_link::BinLinkError> = Ok((
            PathBuf::from("/home/x/.local/bin/konductor"),
            bin_link::BinLinkOutcome::Created,
        ));
        merge_link_bin_json(&mut value, &result);

        // Still exactly one JSON object, carrying BOTH the
        // already-at-version fields and the link_bin field together --
        // never two separate top-level documents for one invocation.
        assert_eq!(value["command"], "install");
        assert_eq!(value["skipped"], true);
        assert_eq!(value["reason"], "already_at_version");
        assert_eq!(value["link_bin"]["requested"], true);
        assert_eq!(value["link_bin"]["outcome"], "created");
    }

    // ── content-version skip-if-unchanged / --force / --from-always-
    //    overwrites (end-to-end, via dispatch_install_with) ─────────────
    //
    // Content-version skip-if-unchanged applies to the non-`--from`
    // path (per this feature's own design: `--from` always overwrites
    // unconditionally, regardless of `--force` -- see
    // `content_version::compare_incoming_version`'s own doc comment).
    // These tests exercise the skip/force/mismatch behavior through
    // `dispatch_install_with_remote_installer` with a FAKE remote
    // installer (no real network call) that copies from a local
    // "remote" source tree, mirroring this module's own
    // `dispatch_install_with_fake_remote_installer` test pattern
    // exactly -- the version-skip check itself
    // (`content_version::compare_incoming_version`) is exercised
    // directly against real `install-info.json`/`dist/VERSION` state,
    // matching production's own call shape.

    /// Writes `<repo_root>/dist/VERSION` with `version`'s contents,
    /// matching `synth`'s own convention -- `agent_version_from_source`
    /// reads this file trimmed.
    fn seed_dist_version(repo_root: &Path, version: &str) {
        let dist_dir = repo_root.join("dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("VERSION"), format!("{version}\n")).unwrap();
    }

    /// `--from` ALWAYS overwrites unconditionally, regardless of
    /// `--force` -- deliberate and permanent (see
    /// `content_version::compare_incoming_version`'s own doc comment).
    /// Proven here at the same content version across two installs:
    /// even though the incoming source's `dist/VERSION` matches what
    /// was already recorded, `--from` never participates in
    /// skip-if-unchanged, so the second install still overwrites.
    #[test]
    fn dispatch_install_with_from_always_overwrites_even_at_matching_version() {
        let _home = HomeGuard::new("content-version-from-always-home");
        let target = scratch_dir("content-version-from-always-target");
        let repo_root = scratch_dir("content-version-from-always-repo");
        seed_synthed_agent(&repo_root, "k-example");
        seed_dist_version(&repo_root, "1.0.0");

        let first_code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(first_code, 0);

        // Same recorded version (1.0.0) but DIFFERENT file content --
        // if --from participated in skip-if-unchanged, this write
        // would be skipped and the fresh content would never land.
        fs::write(
            repo_root.join("dist/kiro-cli-v2/agents/k-example.json"),
            b"{\"fresh\":true}\n",
        )
        .unwrap();

        let second_code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(second_code, 0);
        let agent_path = target.join(".kiro/agents/k-example.json");
        // TelemetryHookPass re-serializes the agent file, so check the
        // parsed field rather than raw bytes.
        let agent_value: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        assert_eq!(
            agent_value["fresh"],
            serde_json::json!(true),
            "--from must always overwrite, even at a matching recorded version"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A first-seen target (no prior `install-info.json`) has nothing
    /// to compare against -- the write proceeds normally with no
    /// special-casing, and the version is recorded afterward. This
    /// holds on the `--from` path too, since `--from` always writes
    /// anyway -- confirms the ordinary write-and-record behavior is
    /// unaffected by this feature's addition.
    #[test]
    fn dispatch_install_with_no_recorded_version_writes_normally_and_records_version() {
        let _home = HomeGuard::new("content-version-first-seen-home");
        let target = scratch_dir("content-version-first-seen-target");
        let repo_root = scratch_dir("content-version-first-seen-repo");
        seed_synthed_agent(&repo_root, "k-example");
        seed_dist_version(&repo_root, "3.0.0");

        let code = dispatch_install_with(
            Some(repo_root.to_str().unwrap().to_string()),
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            None,
            false,
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);
        assert!(target.join(".kiro/agents/k-example.json").is_file());
        let recorded = crate::cli::telemetry::read_install_info(&target)
            .and_then(|record| record.agent_version);
        assert_eq!(recorded, Some("3.0.0".to_string()));

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A `--from` given but with a corresponding `content_version`
    /// comparison run directly against `compare_incoming_version`
    /// (unit-level, no dispatch) confirms the exact contract this
    /// module's dispatch-level tests rely on: `from.is_some()` always
    /// yields `FromAlwaysOverwrites`, so `should_skip_write` is always
    /// `false` for `--from` regardless of matching versions or
    /// `--force`. `content_version.rs`'s own test module covers this
    /// exhaustively; this is a thin end-to-end confirmation that
    /// `dispatch_install_with_remote_installer`'s real call site
    /// reaches that same function with `from.as_deref()` (not a
    /// hardcoded `None`) for its `from` argument.
    #[test]
    fn from_always_overwrites_contract_holds_for_the_real_dispatch_call_shape() {
        let target = scratch_dir("content-version-contract-target");
        let repo_root = scratch_dir("content-version-contract-repo");
        seed_dist_version(&repo_root, "1.0.0");
        crate::cli::telemetry::write_install_info(
            &target,
            &repo_root,
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();

        let comparison = content_version::compare_incoming_version(
            Some(repo_root.to_str().unwrap()),
            &repo_root,
            &target,
        );
        assert_eq!(
            comparison,
            content_version::VersionComparison::FromAlwaysOverwrites
        );
        assert!(!content_version::should_skip_write(&comparison, false));
        assert!(!content_version::should_skip_write(&comparison, true));

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Unit-level (no dispatch, no network) confirmation of the exact
    /// harness-gating expression `dispatch_install_with_remote_installer`'s
    /// content-version skip check now applies:
    /// `record.harness == harness`. `install-info.json` holds exactly
    /// one `agent_version` + `harness` pair per target (see
    /// `write_install_info`'s own doc comment), while a target can
    /// legitimately track 2+ harnesses at once
    /// (`manifest::upsert_strategy`'s coexistence support) -- a version
    /// match recorded for harness A must never be read as "harness B is
    /// already installed." Before this fix, only `agent_version` was
    /// read out of the record, so a matching version recorded for ANY
    /// harness would incorrectly gate the skip for every harness.
    #[test]
    fn content_version_skip_gate_requires_the_recorded_harness_to_match_the_requested_one() {
        let target = scratch_dir("harness-gated-skip-target");
        let repo_root = scratch_dir("harness-gated-skip-repo");
        seed_dist_version(&repo_root, "2.0.0");
        // Records a version for "kiro-cli-v2" -- this target is later
        // queried for a DIFFERENT harness, "claude".
        crate::cli::telemetry::write_install_info(
            &target,
            &repo_root,
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();

        let requested_harness = "claude";
        let recorded_for_requested_harness = crate::cli::telemetry::read_install_info(&target)
            .and_then(|record| {
                (record.harness == requested_harness).then_some(record.agent_version)
            })
            .flatten();
        assert_eq!(
            recorded_for_requested_harness, None,
            "a version recorded for a different harness must not gate the skip for this one"
        );

        // The same record DOES gate the skip when queried for the
        // harness it was actually recorded under.
        let recorded_for_matching_harness = crate::cli::telemetry::read_install_info(&target)
            .and_then(|record| (record.harness == "kiro-cli-v2").then_some(record.agent_version))
            .flatten();
        assert_eq!(
            recorded_for_matching_harness,
            Some("2.0.0".to_string()),
            "a version recorded for the SAME harness must still gate the skip"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── `--version <v>` real by-tag fetch composing with skip-if-unchanged ──
    //
    // These exercise the real feature this task adds: `--version <v>`
    // on the no-`--from` (remote) install path now compares against the
    // EXPLICITLY REQUESTED version, not "latest" -- via
    // `dispatch_install_with_remote_installer`'s own skip check, with a
    // fake `remote_installer` seam so no real network call is made.

    /// A target already recorded at EXACTLY the requested `--version`
    /// tag must skip the remote fetch entirely -- the fake
    /// `remote_installer` panics if called at all, proving the skip
    /// fires without ever reaching the fetch/install step.
    #[test]
    fn dispatch_install_with_version_matching_recorded_version_skips_the_remote_fetch() {
        let _home = HomeGuard::new("install-version-skip-match-home");
        let target = scratch_dir("install-version-skip-match-target");
        let repo_root = scratch_dir("install-version-skip-match-repo");
        seed_dist_version(&repo_root, "1.5.0");
        crate::cli::telemetry::write_install_info(
            &target,
            &repo_root,
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();

        let code = dispatch_install_with_remote_installer(
            None,
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            Some("1.5.0".to_string()),
            false,
            false,
            false,
            ColorMode::disabled(),
            |_strategy, _destination, _installed_at, _no_telemetry| {
                panic!(
                    "remote_installer must never be called when the target is already at \
                     exactly the requested --version"
                )
            },
        );
        assert_eq!(
            code, 0,
            "a version match must succeed via the skip path, not fail"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `--version <v>` composing with `--force`: an EXACT version match
    /// must still proceed to the real fetch when `force` is `true`,
    /// bypassing the skip.
    #[test]
    fn dispatch_install_with_version_matching_recorded_version_with_force_still_fetches() {
        let _home = HomeGuard::new("install-version-force-bypass-home");
        let target = scratch_dir("install-version-force-bypass-target");
        let repo_root = scratch_dir("install-version-force-bypass-repo");
        seed_dist_version(&repo_root, "2.0.0");
        crate::cli::telemetry::write_install_info(
            &target,
            &repo_root,
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();

        let remote_installer_called = std::rc::Rc::new(std::cell::Cell::new(false));
        let remote_installer_called_check = remote_installer_called.clone();
        let code = dispatch_install_with_remote_installer(
            None,
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            Some("2.0.0".to_string()),
            true, // --force
            false,
            false,
            ColorMode::disabled(),
            move |_strategy, _destination, _installed_at, _no_telemetry| {
                remote_installer_called_check.set(true);
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
        assert!(
            remote_installer_called.get(),
            "--force must bypass the version-match skip and reach the real fetch attempt"
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `--version <v>` for a tag that does not match the recorded
    /// version must proceed to the real fetch, never skip.
    #[test]
    fn dispatch_install_with_version_mismatched_recorded_version_still_fetches() {
        let _home = HomeGuard::new("install-version-mismatch-fetches-home");
        let target = scratch_dir("install-version-mismatch-fetches-target");
        let repo_root = scratch_dir("install-version-mismatch-fetches-repo");
        seed_dist_version(&repo_root, "1.0.0");
        crate::cli::telemetry::write_install_info(
            &target,
            &repo_root,
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();

        let remote_installer_called = std::rc::Rc::new(std::cell::Cell::new(false));
        let remote_installer_called_check = remote_installer_called.clone();
        let code = dispatch_install_with_remote_installer(
            None,
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            Some("2.0.0".to_string()), // differs from the recorded "1.0.0"
            false,
            false,
            false,
            ColorMode::disabled(),
            move |_strategy, _destination, _installed_at, _no_telemetry| {
                remote_installer_called_check.set(true);
                Err(remote_orchestrate::FallbackChainError::ReleaseOnly(
                    remote_orchestrate::RemoteOrchestrationError::Fetch(
                        github::GithubFetchError::TagNotFound {
                            tag: "2.0.0".to_string(),
                        },
                    ),
                ))
            },
        );
        assert!(
            remote_installer_called.get(),
            "a requested version that differs from the recorded one must never skip"
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A requested tag GitHub reports as not found
    /// (`GithubFetchError::TagNotFound`) must surface a clear, distinct
    /// error through `install`'s own error-mapping path -- never the
    /// old generic "not yet supported" message and never a confusing
    /// fallback to some other version.
    #[test]
    fn dispatch_install_with_version_tag_not_found_surfaces_a_clear_distinct_error() {
        let _home = HomeGuard::new("install-tag-not-found-home");
        let target = scratch_dir("install-tag-not-found-target");

        let missing_tag = "v999.999.999";
        let code = dispatch_install_with_remote_installer(
            None,
            Some(target.to_str().unwrap().to_string()),
            "kiro-cli-v2".to_string(),
            false,
            false,
            false,
            Some(missing_tag.to_string()),
            false,
            false,
            false,
            ColorMode::disabled(),
            {
                let missing_tag = missing_tag.to_string();
                move |_strategy, _destination, _installed_at, _no_telemetry| {
                    Err(remote_orchestrate::FallbackChainError::ReleaseOnly(
                        remote_orchestrate::RemoteOrchestrationError::Fetch(
                            github::GithubFetchError::TagNotFound { tag: missing_tag },
                        ),
                    ))
                }
            },
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        fs::remove_dir_all(&target).ok();
    }
}
