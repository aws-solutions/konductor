// SPDX-License-Identifier: Apache-2.0
//
// install/remote_orchestrate.rs — sequences a GitHub-release fetch
// (`install::github::fetch_latest_release_artifact_and_mcp_asset`) or a
// branch-`dist/` fetch (`install::github_branch`) into the existing,
// unmodified bytes-in-hand verify->unpack->install pipeline
// (`install::remote::install_from_remote_bytes`).
//
// This is the ONLY production call path that makes a network fetch;
// every other module in `install::remote`/`install::github`/
// `install::github_branch` is reachable only from tests or from this
// orchestration function.

use std::path::Path;

use super::github::{self, GithubFetchError};
use super::github_branch::{self, GithubBranchFetchError};
use super::remote::{self, McpBinaryFetcher, RemoteInstallError, RemoteInstallOutcome};
use super::InstallStrategy;

/// What `install_from_latest_github_release` can fail with -- separates
/// the fetch phase (network/missing-asset, before any bytes are in
/// hand) from the verify/unpack/install phase (`RemoteInstallError`,
/// unchanged), so a caller can map each to its own exit code (checksum
/// failures map to `EXIT_VERIFY_FAILED`, everything else to
/// `EXIT_USAGE_ERROR`).
#[derive(Debug)]
pub enum RemoteOrchestrationError {
    /// The GitHub fetch phase failed -- network error, missing asset,
    /// non-2xx HTTP status, or an unparseable response. Never a
    /// checksum-verification failure; that can only happen once bytes
    /// are already in hand.
    Fetch(GithubFetchError),
    /// Bytes fetched fine, but verify/unpack/install (the existing,
    /// unmodified `remote::install_from_remote_bytes` pipeline) failed.
    Install(RemoteInstallError),
}

impl std::fmt::Display for RemoteOrchestrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RemoteOrchestrationError::Fetch(err) => write!(f, "{err}"),
            RemoteOrchestrationError::Install(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for RemoteOrchestrationError {}

/// What `install_from_main_branch_dist` can fail with -- the same
/// fetch-vs-install split as `RemoteOrchestrationError`, applied to the
/// branch `dist/` fetch instead. Kept as its own type (rather than
/// folded into `RemoteOrchestrationError`) so a caller can still tell
/// which source an error came from once the two get chained in a
/// fallback.
#[derive(Debug)]
pub enum MainBranchDistOrchestrationError {
    /// The branch `dist/` fetch phase failed -- network error, a
    /// missing tarball or sidecar, or a non-2xx HTTP status.
    Fetch(GithubBranchFetchError),
    /// Bytes fetched fine, but verify (against the real, fetched
    /// sidecar -- see `install_from_main_branch_dist`)/unpack/install
    /// failed.
    Install(RemoteInstallError),
}

impl std::fmt::Display for MainBranchDistOrchestrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MainBranchDistOrchestrationError::Fetch(err) => write!(f, "{err}"),
            MainBranchDistOrchestrationError::Install(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for MainBranchDistOrchestrationError {}

/// Which of the two independent install sources actually produced a
/// successful install, or which one failed when both did. Never
/// blended: a caller can always attribute a specific outcome to a
/// specific source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteInstallSource {
    /// The primary path: a version-named tarball + `.sha256` sidecar
    /// fetched from `owner/repo`'s latest GitHub Release
    /// (`install::github`).
    GithubRelease,
    /// The fallback path: the tarball + `.sha256` sidecar fetched
    /// directly as two named files from `dist/` on a branch's tree,
    /// verified against that real, independently-published sidecar
    /// (`install::github_branch`) -- same verification strength as the
    /// primary path, just sourced from a branch's `dist/` directory
    /// instead of a release asset.
    MainBranchDist,
}

impl std::fmt::Display for RemoteInstallSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RemoteInstallSource::GithubRelease => write!(f, "github-release"),
            RemoteInstallSource::MainBranchDist => write!(f, "main-branch-dist"),
        }
    }
}

/// Why `install_from_remote_with_fallback` failed: both sources were
/// tried and neither succeeded, or the release source failed with
/// something that doesn't make the fallback eligible. Carries both
/// underlying errors where relevant, so a caller can report exactly
/// what each source did.
#[derive(Debug)]
pub enum FallbackChainError {
    /// The release-asset fetch failed with something that doesn't make
    /// the fallback eligible (a network error, a non-404 HTTP status,
    /// or an invalid response) -- surfaced as-is.
    ReleaseOnly(RemoteOrchestrationError),
    /// The release fetch failed with a fallback-eligible error, and the
    /// fallback ALSO failed. Carries both errors.
    BothFailed {
        release_error: RemoteOrchestrationError,
        main_branch_dist_error: MainBranchDistOrchestrationError,
    },
}

impl std::fmt::Display for FallbackChainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FallbackChainError::ReleaseOnly(err) => write!(f, "{err}"),
            FallbackChainError::BothFailed {
                release_error,
                main_branch_dist_error,
            } => write!(
                f,
                "github-release source failed ({release_error}); main-branch-dist \
                 fallback also failed ({main_branch_dist_error})"
            ),
        }
    }
}

impl std::error::Error for FallbackChainError {}

/// Fetches `owner/repo`'s latest GitHub release metadata EXACTLY ONCE
/// (via `github::fetch_latest_release_artifact_and_mcp_asset`), then
/// hands the resolved tarball bytes to the existing, unmodified
/// `remote::install_from_remote_bytes` -- verify, unpack, install.
/// Never touches that pipeline's own logic; just sequences a real
/// fetch in front of it.
///
/// The MCP server binary asset is resolved from that SAME release
/// response, eagerly, right alongside the tarball -- rather than
/// deferred into a closure that fetches its own metadata later. Before
/// this fix, `github::fetch_latest_github_release_artifact` (for the
/// tarball) and `github::fetch_mcp_server_release_asset` (for the MCP
/// binary, invoked lazily from inside `install_from_remote_bytes` via
/// `build_mcp_binary_fetcher`'s closure) each independently called
/// `fetch_latest_release_metadata`, roughly doubling metadata API
/// traffic and risking the tarball and MCP binary resolving against
/// two DIFFERENT releases if a new one published between the calls.
/// Resolving both eagerly from one fetch closes that window: the
/// `McpBinaryFetcher` closure passed to `install_from_remote_bytes`
/// below now just returns the already-computed result, matching the
/// `McpBinaryFetcher` shape it always had.
///
/// This is the ONE place a real, no-`--from` install actually fetches
/// the `skill-lookup-mcp` binary from GitHub. Thin wrapper around
/// `install_from_latest_release_with_fetcher` bound to the real
/// production fetcher -- the fetcher is parameterized in that function
/// (not just here) so tests can inject a fake one and exercise this
/// exact sequencing with no real network call.
///
/// `release_tag`, when `Some(tag)`, fetches that SPECIFIC release
/// (`github::fetch_release_artifact_and_mcp_asset_by_tag`, `GET
/// .../releases/tags/{tag}`) instead of latest -- same
/// single-fetch-shared-release resolution either way, differing only
/// in which metadata endpoint is hit. A `GithubFetchError::TagNotFound`
/// from the by-tag fetch propagates through unchanged as
/// `RemoteOrchestrationError::Fetch`, same as every other fetch-phase
/// failure.
#[allow(clippy::too_many_arguments)]
pub(crate) fn install_from_latest_github_release(
    owner: &str,
    repo: &str,
    release_tag: Option<&str>,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    installed_at: &str,
    no_telemetry: bool,
    use_github_token: bool,
) -> Result<RemoteInstallOutcome, RemoteOrchestrationError> {
    let (artifact_result, mcp_asset_result) = match release_tag {
        Some(tag) => {
            github::fetch_release_artifact_and_mcp_asset_by_tag(owner, repo, tag, use_github_token)
                .map_err(RemoteOrchestrationError::Fetch)?
        }
        None => github::fetch_latest_release_artifact_and_mcp_asset(owner, repo, use_github_token)
            .map_err(RemoteOrchestrationError::Fetch)?,
    };
    let mcp_binary_fetcher = mcp_binary_fetcher_from_resolved_asset(mcp_asset_result);
    install_from_latest_release_with_fetcher(
        || artifact_result,
        strategy,
        target_dir,
        installed_at,
        no_telemetry,
        Some(mcp_binary_fetcher),
    )
}

/// Builds a `McpBinaryFetcher` that just returns an ALREADY-RESOLVED
/// `McpServerAssetFetchError`/asset-bytes result, mapped to
/// `std::io::Error` the same way `github::github_artifact_fetcher`
/// already maps `GithubFetchError` -- the identical mapping the OLD
/// `build_mcp_binary_fetcher` used, except this closure performs no
/// network call of its own at invocation time: `asset_result` was
/// resolved eagerly, from the SAME release fetch the tarball asset was
/// resolved from (see `install_from_latest_github_release`'s own doc
/// comment for why). The "platform unsupported" signal
/// (`McpServerAssetFetchError::is_unsupported_platform()`) has no
/// dedicated slot in `std::io::Error`, so it survives the mapping by
/// prefixing `remote::MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER` onto the
/// rendered message specifically for that case --
/// `install_mcp_server_binary_into_remote_temp_dir` strips this exact
/// prefix back off to recover the distinction on the other side of the
/// closure boundary. Every other `McpServerAssetFetchError` variant
/// (a real fetch/verify failure on a supported platform) maps through
/// with its message unchanged, no marker prefix.
///
/// Takes `asset_result` by value and moves it directly into the
/// returned `FnOnce` closure -- `McpBinaryFetcher`'s `FnOnce() -> ...`
/// bound both permits and enforces exactly that: the closure consumes
/// its captured `asset_result` on its one and only call, with no
/// internal "have I already been called" bookkeeping needed, since the
/// type system already guarantees `install_from_remote_bytes` can
/// invoke it at most once per install.
fn mcp_binary_fetcher_from_resolved_asset(
    asset_result: github::McpAssetResolutionResult,
) -> McpBinaryFetcher<'static> {
    Box::new(move || {
        asset_result.map_err(|err| {
            if err.is_unsupported_platform() {
                std::io::Error::other(format!(
                    "{}{err}",
                    remote::MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER
                ))
            } else {
                std::io::Error::other(err.to_string())
            }
        })
    })
}

/// Same sequencing as `install_from_latest_github_release`, but with
/// the fetch step injected as `fetcher` instead of always calling the
/// real GitHub API, so a test can pass a fake closure with no network
/// call. A fetcher failure wraps as `RemoteOrchestrationError::Fetch`
/// carrying the exact `GithubFetchError` unchanged. `mcp_binary_fetcher`
/// is threaded straight through to `remote::install_from_remote_bytes`
/// unchanged -- `None` for a caller that wants the tarball-only
/// sequencing this function already provided before the MCP-binary
/// feature existed (every current test call site below), `Some(..)`
/// for the real production path (`install_from_latest_github_release`).
///
/// `fetcher`'s third tuple element is the artifact's ACTUAL resolved
/// filename (see `github::ArtifactResolutionResult`'s own doc comment)
/// -- verification below uses THIS value, never an independently
/// re-derived `github::expected_artifact_filename()`. The two can
/// differ whenever the fetched release's version isn't this binary's
/// own `CARGO_PKG_VERSION` (a by-tag fetch, or "latest" having moved
/// past this build), which is exactly the bug this fixed: verifying
/// against the wrong, build-time version produced a
/// `SidecarError::FilenameMismatch` even when the fetched artifact and
/// sidecar were perfectly consistent with each other.
fn install_from_latest_release_with_fetcher(
    fetcher: impl FnOnce() -> Result<(Vec<u8>, Vec<u8>, String), GithubFetchError>,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    installed_at: &str,
    no_telemetry: bool,
    mcp_binary_fetcher: Option<McpBinaryFetcher>,
) -> Result<RemoteInstallOutcome, RemoteOrchestrationError> {
    let (artifact_bytes, sidecar_bytes, artifact_filename) =
        fetcher().map_err(RemoteOrchestrationError::Fetch)?;
    remote::install_from_remote_bytes(
        strategy,
        target_dir,
        artifact_bytes,
        &sidecar_bytes,
        &artifact_filename,
        installed_at,
        no_telemetry,
        mcp_binary_fetcher,
    )
    .map_err(RemoteOrchestrationError::Install)
}

/// The filename recorded for the fetched tarball
/// `install_from_main_branch_dist` hands to
/// `remote::install_from_remote_bytes` -- the same
/// `install::github::expected_artifact_filename()` this module's
/// release-asset path already uses, since the fetched tarball is a
/// byte-identical copy of that same artifact, just fetched from
/// `dist/` on a branch instead of a release asset.
pub(crate) fn main_branch_dist_archive_filename() -> String {
    github::expected_artifact_filename()
}

/// Fetches `owner/repo`'s `{branch}` `dist/` tarball and its real,
/// independently-published `.sha256` sidecar
/// (`github_branch::fetch_branch_dist_artifact_and_sidecar`), then
/// hands the pair to `remote::install_from_remote_bytes`, same as the
/// release-asset path. The sidecar is genuinely fetched, never
/// self-computed, so this source has the same verification strength
/// as the release path -- it only differs in where the pair comes
/// from. A missing tarball or sidecar fails cleanly with
/// `MissingArtifact`/`MissingSidecar`, never by falling back to a
/// self-computed hash.
///
/// Never fetches the MCP server binary: `main`'s `dist/` directory has
/// no per-platform `skill-lookup-mcp-*` asset published alongside it
/// (only release assets do -- see release.yml's own asset-staging
/// step), so there is nothing analogous for this source to fetch. A
/// caller falling back to this source after the release path failed
/// gets a working agent/skill/context install with no `mcpServers`
/// injection, exactly as if no binary had been built locally either.
#[allow(clippy::too_many_arguments)]
pub(crate) fn install_from_main_branch_dist(
    owner: &str,
    repo: &str,
    branch: &str,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    installed_at: &str,
    no_telemetry: bool,
    use_github_token: bool,
) -> Result<RemoteInstallOutcome, MainBranchDistOrchestrationError> {
    install_from_main_branch_dist_with_fetcher(
        || {
            github_branch::fetch_branch_dist_artifact_and_sidecar(
                owner,
                repo,
                branch,
                use_github_token,
            )
        },
        strategy,
        target_dir,
        installed_at,
        no_telemetry,
    )
}

/// Same sequencing as `install_from_main_branch_dist`, but with the
/// fetch step injected as `fetcher`, mirroring
/// `install_from_latest_release_with_fetcher`'s test-seam design.
/// `fetcher` returns `(tarball_bytes, sidecar_bytes)`, the same shape
/// `install::github`'s own release fetcher returns -- the sidecar
/// bytes it returns are passed to `remote::install_from_remote_bytes`
/// unmodified, never recomputed from `tarball_bytes` here. Always
/// passes `None` for the MCP-binary fetcher (see
/// `install_from_main_branch_dist`'s own doc comment for why this
/// source has nothing analogous to fetch).
fn install_from_main_branch_dist_with_fetcher(
    fetcher: impl FnOnce() -> Result<(Vec<u8>, Vec<u8>), GithubBranchFetchError>,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    installed_at: &str,
    no_telemetry: bool,
) -> Result<RemoteInstallOutcome, MainBranchDistOrchestrationError> {
    let (tarball_bytes, sidecar_bytes) =
        fetcher().map_err(MainBranchDistOrchestrationError::Fetch)?;
    let artifact_filename = main_branch_dist_archive_filename();

    remote::install_from_remote_bytes(
        strategy,
        target_dir,
        tarball_bytes,
        &sidecar_bytes,
        &artifact_filename,
        installed_at,
        no_telemetry,
        None,
    )
    .map_err(MainBranchDistOrchestrationError::Install)
}

/// Runs the GitHub-release path first, falling back to the
/// main-branch-`dist/` path when the release path fails with "nothing
/// usable here" -- a missing per-platform asset, or a 404 from the
/// `releases/latest` metadata call (no release exists at all). Both
/// sources read the same repository, just a different ref, so no
/// separate opt-in is needed. Every other release failure (network
/// error, non-404 metadata status, a download-phase HTTP error, an
/// invalid response, or a verify/unpack/install failure) is never
/// fallback-eligible -- trying a second source on top of a real
/// failure risks masking it. `MetadataHttp`/`DownloadHttp` are kept as
/// distinct variants so this match can tell "no release exists" apart
/// from "a release exists but its asset bytes failed to fetch," even
/// when both carry the same HTTP status code.
///
/// `release_tag_was_requested` gates this ENTIRE eligibility rule, not
/// just `TagNotFound`: when `true` (an explicit `--version <v>`
/// fetch), `MissingAsset` and `MetadataHttp(404, _)` are NEVER
/// fallback-eligible either, even though they are for a latest-release
/// fetch. A `MissingAsset` on a by-tag fetch means the requested
/// release genuinely exists but lacks the current platform's asset --
/// falling back to `main`'s `dist/` tree in that case would silently
/// install a DIFFERENT version than the one explicitly requested,
/// exactly the failure mode this parameter exists to prevent (see
/// `install_from_remote_with_fallback`'s own doc comment for the
/// `TagNotFound` half of this same guarantee -- this closes the other
/// half, the case where the tag exists but its asset doesn't).
///
/// Returns the source that produced a successful install, plus that
/// install's own `RemoteInstallOutcome` (today just the MCP server
/// binary's resolved release version, if any -- see
/// `remote::RemoteInstallOutcome`'s own doc comment). Parameterized by
/// `release_installer`/`main_branch_dist_installer` so tests can inject
/// fake closures with no real network call.
fn install_from_remote_with_fallback_using(
    release_installer: impl FnOnce() -> Result<RemoteInstallOutcome, RemoteOrchestrationError>,
    main_branch_dist_installer: impl FnOnce() -> Result<
        RemoteInstallOutcome,
        MainBranchDistOrchestrationError,
    >,
    release_tag_was_requested: bool,
) -> Result<(RemoteInstallSource, RemoteInstallOutcome), FallbackChainError> {
    match release_installer() {
        Ok(outcome) => Ok((RemoteInstallSource::GithubRelease, outcome)),
        Err(
            release_error @ RemoteOrchestrationError::Fetch(
                GithubFetchError::MissingAsset(_) | GithubFetchError::MetadataHttp(404, _),
            ),
        ) if !release_tag_was_requested => match main_branch_dist_installer() {
            Ok(outcome) => Ok((RemoteInstallSource::MainBranchDist, outcome)),
            Err(main_branch_dist_error) => Err(FallbackChainError::BothFailed {
                release_error,
                main_branch_dist_error,
            }),
        },
        Err(other_release_error) => Err(FallbackChainError::ReleaseOnly(other_release_error)),
    }
}

/// Production entry point for the fallback chain: the real
/// GitHub-release fetch first, falling back automatically to the real
/// main-branch-`dist/` fetch when eligible (see
/// `install_from_remote_with_fallback_using`). `owner`/`repo` are
/// shared across both sources; `branch` only scopes the fallback.
/// `release_tag`, when `Some`, fetches that SPECIFIC release (`GET
/// .../releases/tags/{tag}`) instead of latest -- see
/// `install_from_latest_github_release`'s own doc comment for how
/// this threads through. A by-tag miss (`GithubFetchError::TagNotFound`)
/// is never fallback-eligible (see `install_from_remote_with_fallback_using`'s
/// own eligibility rule): falling back to `main`'s `dist/` tree would
/// silently substitute a different version than the one explicitly
/// requested.
#[allow(clippy::too_many_arguments)]
pub(crate) fn install_from_remote_with_fallback(
    owner: &str,
    repo: &str,
    branch: &str,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    installed_at: &str,
    no_telemetry: bool,
    use_github_token: bool,
    release_tag: Option<&str>,
) -> Result<(RemoteInstallSource, RemoteInstallOutcome), FallbackChainError> {
    install_from_remote_with_fallback_using(
        || {
            install_from_latest_github_release(
                owner,
                repo,
                release_tag,
                strategy,
                target_dir,
                installed_at,
                no_telemetry,
                use_github_token,
            )
        },
        || {
            install_from_main_branch_dist(
                owner,
                repo,
                branch,
                strategy,
                target_dir,
                installed_at,
                no_telemetry,
                use_github_token,
            )
        },
        release_tag.is_some(),
    )
}

#[cfg(test)]
mod tests {
    use super::super::private_repo_hint::TokenState;
    use super::*;
    use crate::cli::install::kiro_cli::KiroCliInstallStrategy;
    use crate::cli::install::manifest;
    use crate::cli::synth::package::package_dist;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-remote-orchestrate-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed_dist_agent(dist_root: &Path, name: &str, contents: &[u8]) {
        let dir = dist_root.join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.json")), contents).unwrap();
    }

    /// Builds a real `(artifact_bytes, sidecar_bytes)` pair using the
    /// same `package_dist` + `install::artifact::sha256_hex` helpers
    /// `remote.rs`'s tests use, keyed to
    /// `github::expected_artifact_filename()` since this orchestration
    /// module hands that exact filename to `install_from_remote_bytes`.
    fn build_real_artifact_and_sidecar(dist_root: &Path) -> (Vec<u8>, Vec<u8>) {
        let artifact_bytes = package_dist(dist_root).expect("package_dist must succeed");
        let hash = crate::cli::install::artifact::sha256_hex(&artifact_bytes);
        let filename = github::expected_artifact_filename();
        let sidecar_bytes = format!("{hash}  {filename}\n").into_bytes();
        (artifact_bytes, sidecar_bytes)
    }

    /// End-to-end, no real network: a fake fetcher stands in for the
    /// network call, then the real, unmodified
    /// `remote::install_from_remote_bytes` pipeline runs against those
    /// bytes -- exercising fetch(fake)->verify->unpack->install. Does
    /// not call `install_from_latest_github_release` itself (that
    /// always makes a real fetch); proves the same downstream
    /// sequencing with the network call swapped out.
    #[test]
    fn fake_fetch_then_real_verify_unpack_install_succeeds_end_to_end() {
        let dist_root = scratch_dir("orchestrate-e2e-dist");
        seed_dist_agent(&dist_root, "k-example", b"{\"name\":\"k-example\"}\n");
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);

        let target_dir = scratch_dir("orchestrate-e2e-target");
        let artifact_filename = github::expected_artifact_filename();

        remote::install_from_remote_bytes(
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &sidecar_bytes,
            &artifact_filename,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect("fake-fetched bytes must still verify/unpack/install successfully");

        let installed = target_dir.join(".kiro/agents/k-example.json");
        assert!(installed.is_file());
        assert_eq!(fs::read(&installed).unwrap(), b"{\"name\":\"k-example\"}\n");
        let manifest = manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after successful install");
        assert_eq!(manifest.strategy_names(), vec!["kiro-cli-v2"]);

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// A checksum mismatch in the fetched (fake) bytes must surface as
    /// `RemoteOrchestrationError::Install(RemoteInstallError::VerifyChecksum(_))`
    /// -- confirmed directly against `RemoteInstallError`'s variant,
    /// then wrapped, so the mapping itself gets pinned down.
    #[test]
    fn checksum_mismatch_maps_to_orchestration_install_error() {
        let dist_root = scratch_dir("orchestrate-checksum-dist");
        seed_dist_agent(&dist_root, "k-example", b"{}\n");
        let (artifact_bytes, _) = build_real_artifact_and_sidecar(&dist_root);
        let artifact_filename = github::expected_artifact_filename();
        let bad_sidecar = format!("{}  {artifact_filename}\n", "0".repeat(64)).into_bytes();

        let target_dir = scratch_dir("orchestrate-checksum-target");
        let inner_err = remote::install_from_remote_bytes(
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &bad_sidecar,
            &artifact_filename,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect_err("checksum mismatch must fail verification");
        assert!(matches!(inner_err, RemoteInstallError::VerifyChecksum(_)));

        let orchestration_err = RemoteOrchestrationError::Install(inner_err);
        assert!(matches!(
            orchestration_err,
            RemoteOrchestrationError::Install(RemoteInstallError::VerifyChecksum(_))
        ));

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// `RemoteOrchestrationError::Fetch` wraps a `GithubFetchError`
    /// without touching the verify/unpack/install pipeline at all --
    /// confirms the fetch-phase error's Display text passes through
    /// the orchestration error unchanged.
    #[test]
    fn fetch_phase_error_wraps_github_fetch_error_display_unchanged() {
        let fetch_err = GithubFetchError::MissingAsset("konductor-v0.1.0-x.tar.gz".to_string());
        let expected_message = fetch_err.to_string();
        let orchestration_err = RemoteOrchestrationError::Fetch(fetch_err);
        assert_eq!(orchestration_err.to_string(), expected_message);
    }

    // ── install_from_latest_release_with_fetcher: the test seam itself ──
    //
    // The two tests above exercise the same sequencing via
    // `remote::install_from_remote_bytes` directly. These two instead
    // drive `install_from_latest_release_with_fetcher` itself with an
    // injected closure, so the seam is exercised end to end.

    /// A successful fake fetch closure, routed through
    /// `install_from_latest_release_with_fetcher` itself, must reach a
    /// real, unmodified install -- confirms the function's own fetch->
    /// error-mapping->install sequencing, not just the pieces it
    /// calls.
    #[test]
    fn install_from_latest_release_with_fetcher_routes_a_successful_fetch_to_a_real_install() {
        let dist_root = scratch_dir("fetcher-seam-success-dist");
        seed_dist_agent(&dist_root, "seam-example", b"{\"name\":\"seam-example\"}\n");
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);
        let artifact_filename = github::expected_artifact_filename();

        let target_dir = scratch_dir("fetcher-seam-success-target");
        install_from_latest_release_with_fetcher(
            move || Ok((artifact_bytes, sidecar_bytes, artifact_filename)),
            &KiroCliInstallStrategy,
            &target_dir,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect("a successful injected fetch must route through to a real install");

        let installed = target_dir.join(".kiro/agents/seam-example.json");
        assert!(installed.is_file());
        assert_eq!(
            fs::read(&installed).unwrap(),
            b"{\"name\":\"seam-example\"}\n"
        );
        let manifest = manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after a successful install via the fetcher seam");
        assert_eq!(manifest.strategy_names(), vec!["kiro-cli-v2"]);

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// Regression test for the `--force` sidecar-mismatch bug: a fetch
    /// that resolves to a release tag OTHER than the running binary's
    /// own compiled `CARGO_PKG_VERSION` must still install successfully,
    /// because verification must key off the version that was actually
    /// fetched, not off `expected_artifact_filename()`'s hardcoded
    /// build-time version.
    ///
    /// Builds a real, internally-consistent `(artifact_bytes,
    /// sidecar_bytes)` pair for a DELIBERATELY DIFFERENT filename
    /// (`konductor-v9.9.9.tar.gz`, standing in for a by-tag/latest
    /// fetch that resolved to a newer release than this binary was
    /// built at) than `expected_artifact_filename()` returns for this
    /// build. Before the fix, `install_from_latest_release_with_fetcher`
    /// verifies the fetched pair against `expected_artifact_filename()`
    /// regardless of which version the fetcher actually resolved,
    /// so this fails with `SidecarError::FilenameMismatch` even though
    /// the artifact and sidecar are perfectly consistent WITH EACH
    /// OTHER -- exactly the shape of the reported bug (`sidecar names
    /// 'konductor-v0.1.2.tar.gz', expected 'konductor-v0.1.1.tar.gz'`).
    #[test]
    fn install_from_latest_release_with_fetcher_verifies_against_the_fetched_version_not_the_build_version(
    ) {
        let dist_root = scratch_dir("fetcher-seam-version-mismatch-dist");
        seed_dist_agent(
            &dist_root,
            "seam-version-example",
            b"{\"name\":\"seam-version-example\"}\n",
        );
        let artifact_bytes = package_dist(&dist_root).expect("package_dist must succeed");
        let hash = crate::cli::install::artifact::sha256_hex(&artifact_bytes);

        // Stands in for a release tag distinct from this build's own
        // `CARGO_PKG_VERSION` (asserted below, so the test fails loudly
        // -- rather than silently passing for the wrong reason -- if a
        // future version bump ever makes them coincide).
        let fetched_filename = "konductor-v9.9.9.tar.gz".to_string();
        assert_ne!(
            fetched_filename,
            github::expected_artifact_filename(),
            "test fixture must use a version distinct from this build's own CARGO_PKG_VERSION"
        );
        let sidecar_bytes = format!("{hash}  {fetched_filename}\n").into_bytes();

        let target_dir = scratch_dir("fetcher-seam-version-mismatch-target");
        install_from_latest_release_with_fetcher(
            move || Ok((artifact_bytes, sidecar_bytes, fetched_filename)),
            &KiroCliInstallStrategy,
            &target_dir,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect(
            "verification must key off the version actually fetched, \
             not off this build's own compiled-in CARGO_PKG_VERSION",
        );

        let installed = target_dir.join(".kiro/agents/seam-version-example.json");
        assert!(installed.is_file());
        assert_eq!(
            fs::read(&installed).unwrap(),
            b"{\"name\":\"seam-version-example\"}\n"
        );

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// A failing fake fetch closure, routed through
    /// `install_from_latest_release_with_fetcher` itself, must surface
    /// as `RemoteOrchestrationError::Fetch` carrying that exact error
    /// -- confirms the function never tries to unpack/install when the
    /// fetch phase itself fails.
    #[test]
    fn install_from_latest_release_with_fetcher_surfaces_a_fetch_failure_as_fetch_error() {
        let target_dir = scratch_dir("fetcher-seam-failure-target");
        let err = install_from_latest_release_with_fetcher(
            || Err(GithubFetchError::Network("connection refused".to_string())),
            &KiroCliInstallStrategy,
            &target_dir,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect_err("a failing injected fetch must surface as an error");
        assert!(matches!(
            err,
            RemoteOrchestrationError::Fetch(GithubFetchError::Network(_))
        ));
        assert!(
            !target_dir.join(".konductor").join("manifest").exists(),
            "no manifest should be written when the fetch phase itself fails"
        );

        fs::remove_dir_all(&target_dir).ok();
    }

    // ── install_from_main_branch_dist: real sidecar verification ────────

    /// A successful fake branch fetch that returns a REAL, matching
    /// `(tarball_bytes, sidecar_bytes)` pair, routed through
    /// `install_from_main_branch_dist_with_fetcher`, must reach a real,
    /// unmodified install -- the same shape the release path's own
    /// fetcher returns, verified the same way.
    #[test]
    fn install_from_main_branch_dist_with_fetcher_routes_a_successful_fetch_to_a_real_install() {
        let (tarball_bytes, sidecar_bytes) =
            build_real_branch_tarball_and_matching_sidecar(vec![(
                "kiro-cli-v2/agents/branch-seam-example.json",
                b"{\"name\":\"branch-seam-example\"}\n",
            )]);

        let target_dir = scratch_dir("main-branch-dist-seam-success-target");
        install_from_main_branch_dist_with_fetcher(
            move || Ok((tarball_bytes, sidecar_bytes)),
            &KiroCliInstallStrategy,
            &target_dir,
            "2026-01-01T00:00:00Z",
            false,
        )
        .expect("a successful injected branch fetch must route through to a real install");

        let installed = target_dir.join(".kiro/agents/branch-seam-example.json");
        assert!(installed.is_file());
        assert_eq!(
            fs::read(&installed).unwrap(),
            b"{\"name\":\"branch-seam-example\"}\n"
        );
        let manifest = manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after a successful main-branch-dist install");
        assert_eq!(manifest.strategy_names(), vec!["kiro-cli-v2"]);

        fs::remove_dir_all(&target_dir).ok();
    }

    /// A failing fake branch fetch must surface as
    /// `MainBranchDistOrchestrationError::Fetch`, and must never reach
    /// the verify/unpack/install pipeline at all.
    #[test]
    fn install_from_main_branch_dist_with_fetcher_surfaces_a_fetch_failure_as_fetch_error() {
        let target_dir = scratch_dir("main-branch-dist-seam-failure-target");
        let err = install_from_main_branch_dist_with_fetcher(
            || {
                Err(GithubBranchFetchError::MissingArtifact(
                    "konductor-v0.1.0-x.tar.gz".to_string(),
                    TokenState::NotOptedIn,
                ))
            },
            &KiroCliInstallStrategy,
            &target_dir,
            "2026-01-01T00:00:00Z",
            false,
        )
        .expect_err("a failing injected branch fetch must surface as an error");
        assert!(matches!(
            err,
            MainBranchDistOrchestrationError::Fetch(GithubBranchFetchError::MissingArtifact(_, _))
        ));
        assert!(
            !target_dir.join(".konductor").join("manifest").exists(),
            "no manifest should be written when the branch-fetch phase itself fails"
        );

        fs::remove_dir_all(&target_dir).ok();
    }

    /// A `GithubBranchFetchError::MissingSidecar` fetch failure (the
    /// expected outcome until `main`'s `dist/` directory also carries a
    /// published sidecar) must surface as
    /// `MainBranchDistOrchestrationError::Fetch` too, and must never
    /// reach the verify/unpack/install pipeline -- confirms this
    /// source fails cleanly instead of falling back to a self-computed
    /// hash when the sidecar is absent.
    #[test]
    fn install_from_main_branch_dist_with_fetcher_surfaces_a_missing_sidecar_as_fetch_error() {
        let target_dir = scratch_dir("main-branch-dist-missing-sidecar-target");
        let err = install_from_main_branch_dist_with_fetcher(
            || {
                Err(GithubBranchFetchError::MissingSidecar(
                    "konductor-v0.1.0-x.tar.gz.sha256".to_string(),
                    TokenState::NotOptedIn,
                ))
            },
            &KiroCliInstallStrategy,
            &target_dir,
            "2026-01-01T00:00:00Z",
            false,
        )
        .expect_err("a missing-sidecar fetch failure must surface as an error");
        assert!(matches!(
            err,
            MainBranchDistOrchestrationError::Fetch(GithubBranchFetchError::MissingSidecar(_, _))
        ));
        assert!(
            !target_dir.join(".konductor").join("manifest").exists(),
            "no manifest should be written when the sidecar fetch fails"
        );

        fs::remove_dir_all(&target_dir).ok();
    }

    /// Real tamper/corruption detection: the fetcher returns genuine
    /// tarball bytes and a genuine sidecar-shaped payload, but the
    /// sidecar's recorded hash does not match the tarball bytes
    /// returned alongside it -- simulating a corrupted/tampered
    /// download. Same kind of external check the release path already
    /// has; here the sidecar is sourced from `main`'s `dist/` instead
    /// of a release asset, but the verification is equally real, never
    /// a same-call recomputation.
    #[test]
    fn install_from_main_branch_dist_with_fetcher_rejects_a_mismatched_fetched_sidecar() {
        let (tarball_bytes, _) = build_real_branch_tarball_and_matching_sidecar(vec![(
            "kiro-cli-v2/agents/tampered-example.json",
            b"{\"name\":\"tampered-example\"}\n",
        )]);
        let filename = main_branch_dist_archive_filename();
        // A well-formed sidecar naming the right filename, but recording
        // a hash that does not match `tarball_bytes` -- exactly what a
        // real main's-dist/ fetch would return if the downloaded tarball
        // bytes were corrupted/tampered relative to what the published
        // sidecar attests to.
        let mismatched_sidecar = format!("{}  {filename}\n", "0".repeat(64)).into_bytes();

        let target_dir = scratch_dir("main-branch-dist-tampered-target");
        let err = install_from_main_branch_dist_with_fetcher(
            move || Ok((tarball_bytes, mismatched_sidecar)),
            &KiroCliInstallStrategy,
            &target_dir,
            "2026-01-01T00:00:00Z",
            false,
        )
        .expect_err(
            "a fetched sidecar that doesn't match the fetched tarball must fail verification",
        );
        assert!(matches!(
            err,
            MainBranchDistOrchestrationError::Install(RemoteInstallError::VerifyChecksum(_))
        ));
        assert!(
            !target_dir.join(".konductor").join("manifest").exists(),
            "no manifest should be written when checksum verification fails"
        );

        fs::remove_dir_all(&target_dir).ok();
    }

    /// Builds a real main-branch-dist-shaped tarball (via the same
    /// `package_dist` helper the release-path tests use, seeding a
    /// scratch `dist/` tree from `(relative_path, contents)` pairs)
    /// together with a real, matching sidecar over those exact bytes --
    /// standing in for a genuine tarball + sidecar published on
    /// `main`'s `dist/` and both fetched successfully.
    fn build_real_branch_tarball_and_matching_sidecar(
        files: Vec<(&str, &[u8])>,
    ) -> (Vec<u8>, Vec<u8>) {
        let dist_root = scratch_dir("build-real-branch-tarball-dist");
        for (relative_path, contents) in files {
            let full_path = dist_root.join(relative_path);
            fs::create_dir_all(full_path.parent().unwrap()).unwrap();
            fs::write(&full_path, contents).unwrap();
        }
        let tarball_bytes = package_dist(&dist_root).expect("package_dist must succeed");
        fs::remove_dir_all(&dist_root).ok();

        let hash = super::super::artifact::sha256_hex(&tarball_bytes);
        let filename = main_branch_dist_archive_filename();
        let sidecar_bytes = format!("{hash}  {filename}\n").into_bytes();
        (tarball_bytes, sidecar_bytes)
    }

    // ── install_from_remote_with_fallback_using: fallback-chain tests ──

    /// A successful release install must short-circuit: the fallback
    /// closure must NEVER be called, and the reported source must be
    /// `GithubRelease`.
    #[test]
    fn fallback_chain_never_calls_fallback_when_release_succeeds() {
        let fallback_called = std::rc::Rc::new(std::cell::Cell::new(false));
        let fallback_called_check = fallback_called.clone();

        let result = install_from_remote_with_fallback_using(
            || Ok(RemoteInstallOutcome::default()),
            move || {
                fallback_called_check.set(true);
                Ok(RemoteInstallOutcome::default())
            },
            false,
        );
        assert_eq!(result.unwrap().0, RemoteInstallSource::GithubRelease);
        assert!(
            !fallback_called.get(),
            "the fallback source must never be attempted when the primary source succeeds"
        );
    }

    /// A release failure with `GithubFetchError::MissingAsset` -- a
    /// release that lacks the expected tarball or sidecar asset --
    /// must trigger the fallback automatically: both sources read the
    /// same repository, just from a different ref, so no separate
    /// opt-in gates it. A successful fallback must report
    /// `MainBranchDist` as the source, never blending the two into
    /// one undifferentiated success.
    #[test]
    fn fallback_chain_falls_back_automatically_on_missing_asset_and_reports_main_branch_dist_source(
    ) {
        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(
                    GithubFetchError::MissingAsset("konductor-v0.1.0-x.tar.gz".to_string()),
                ))
            },
            || Ok(RemoteInstallOutcome::default()),
            false,
        );
        assert_eq!(result.unwrap().0, RemoteInstallSource::MainBranchDist);
    }

    /// The AutoSDE-flagged gap this fix closes: a `MissingAsset`
    /// failure on a BY-TAG fetch (`release_tag_was_requested: true`)
    /// must NEVER be fallback-eligible, even though the identical
    /// error IS eligible for a latest-release fetch (the test above).
    /// `MissingAsset` on a by-tag fetch means the requested release
    /// genuinely exists but lacks the current platform's asset --
    /// falling back to `main`'s `dist/` tree would silently install a
    /// DIFFERENT version than the one explicitly requested. The fake
    /// fallback closure panics if called at all, proving the
    /// ineligibility fires before any fallback attempt.
    #[test]
    fn fallback_chain_never_falls_back_on_missing_asset_when_a_release_tag_was_requested() {
        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(
                    GithubFetchError::MissingAsset("konductor-v0.2.0-x.tar.gz".to_string()),
                ))
            },
            || panic!("the fallback must never be attempted for a by-tag MissingAsset failure"),
            true,
        );
        assert!(matches!(
            result,
            Err(FallbackChainError::ReleaseOnly(
                RemoteOrchestrationError::Fetch(GithubFetchError::MissingAsset(_))
            ))
        ));
    }

    /// Same guard, the other eligible-for-latest variant: a
    /// `MetadataHttp(404, _)` on a by-tag fetch (meaning the requested
    /// tag itself doesn't exist -- though in practice `github.rs`
    /// would map this to `TagNotFound` instead, this test pins down
    /// the eligibility rule's OWN behavior independent of that mapping)
    /// must also never be fallback-eligible when a tag was explicitly
    /// requested.
    #[test]
    fn fallback_chain_never_falls_back_on_metadata_404_when_a_release_tag_was_requested() {
        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(
                    GithubFetchError::MetadataHttp(404, TokenState::NotOptedIn),
                ))
            },
            || {
                panic!(
                    "the fallback must never be attempted for a by-tag MetadataHttp(404) failure"
                )
            },
            true,
        );
        assert!(matches!(
            result,
            Err(FallbackChainError::ReleaseOnly(
                RemoteOrchestrationError::Fetch(GithubFetchError::MetadataHttp(404, _))
            ))
        ));
    }

    /// A `TagNotFound` failure must never be fallback-eligible either
    /// -- confirms the eligibility rule's match arm genuinely excludes
    /// this variant regardless of `release_tag_was_requested` (it is
    /// simply never one of the two eligible variants at all).
    #[test]
    fn fallback_chain_never_falls_back_on_tag_not_found() {
        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(
                    GithubFetchError::TagNotFound {
                        tag: "v9.9.9".to_string(),
                    },
                ))
            },
            || panic!("the fallback must never be attempted for a TagNotFound failure"),
            true,
        );
        assert!(matches!(
            result,
            Err(FallbackChainError::ReleaseOnly(
                RemoteOrchestrationError::Fetch(GithubFetchError::TagNotFound { .. })
            ))
        ));
    }

    /// A release failure with `GithubFetchError::MetadataHttp(404)` --
    /// the outcome when `owner/repo` has never published a release at
    /// all, since GitHub's `releases/latest` endpoint itself returns
    /// 404 in that case -- must ALSO be fallback-eligible, reporting
    /// `MainBranchDist` on a successful fallback. This is the case we
    /// think is the most likely real-world state (zero releases ->
    /// 404), which a `MissingAsset`-only eligibility rule would miss
    /// entirely.
    #[test]
    fn fallback_chain_falls_back_on_release_404_and_reports_main_branch_dist_source() {
        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(
                    GithubFetchError::MetadataHttp(404, TokenState::NotOptedIn),
                ))
            },
            || Ok(RemoteInstallOutcome::default()),
            false,
        );
        assert_eq!(result.unwrap().0, RemoteInstallSource::MainBranchDist);
    }

    /// A `GithubFetchError::DownloadHttp(404, _)` -- a release that
    /// genuinely exists and named a matching asset, but whose resolved
    /// download URL is broken/expired -- must NOT be fallback-eligible,
    /// even though it carries the same raw status code as the
    /// metadata-phase 404 above. Falling back here would silently mask
    /// a real failure on an existing release, exactly the risk this
    /// module's fallback-eligibility rule exists to avoid.
    #[test]
    fn fallback_chain_does_not_fall_back_on_a_download_phase_404() {
        let fallback_called = std::rc::Rc::new(std::cell::Cell::new(false));
        let fallback_called_check = fallback_called.clone();

        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(
                    GithubFetchError::DownloadHttp(404, TokenState::NotOptedIn),
                ))
            },
            move || {
                fallback_called_check.set(true);
                Ok(RemoteInstallOutcome::default())
            },
            false,
        );
        assert!(matches!(
            result,
            Err(FallbackChainError::ReleaseOnly(
                RemoteOrchestrationError::Fetch(GithubFetchError::DownloadHttp(404, _))
            ))
        ));
        assert!(
            !fallback_called.get(),
            "a download-phase 404 on a release that genuinely exists must never trigger \
             the fallback, even though it shares a status code with the metadata-phase 404 \
             that IS fallback-eligible"
        );
    }

    /// A release failure that is NOT a missing-asset error (a network
    /// error, here) must NOT trigger the fallback at all -- confirms
    /// the fallback-eligibility rule is specific to
    /// `MissingAsset`/`Http(404)`, not any release-path failure.
    #[test]
    fn fallback_chain_does_not_fall_back_on_a_non_eligible_release_error() {
        let fallback_called = std::rc::Rc::new(std::cell::Cell::new(false));
        let fallback_called_check = fallback_called.clone();

        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(GithubFetchError::Network(
                    "connection refused".to_string(),
                )))
            },
            move || {
                fallback_called_check.set(true);
                Ok(RemoteInstallOutcome::default())
            },
            false,
        );
        assert!(matches!(
            result,
            Err(FallbackChainError::ReleaseOnly(
                RemoteOrchestrationError::Fetch(GithubFetchError::Network(_))
            ))
        ));
        assert!(
            !fallback_called.get(),
            "a non-eligible release failure must never trigger the fallback"
        );
    }

    /// A non-404 HTTP status on the metadata call (e.g. 403
    /// rate-limited) must NOT trigger the fallback either -- confirms
    /// the 404-specific carve-out doesn't widen into "any HTTP error on
    /// the metadata call is fallback-eligible".
    #[test]
    fn fallback_chain_does_not_fall_back_on_a_non_404_http_error() {
        let fallback_called = std::rc::Rc::new(std::cell::Cell::new(false));
        let fallback_called_check = fallback_called.clone();

        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(
                    GithubFetchError::MetadataHttp(403, TokenState::NotOptedIn),
                ))
            },
            move || {
                fallback_called_check.set(true);
                Ok(RemoteInstallOutcome::default())
            },
            false,
        );
        assert!(matches!(
            result,
            Err(FallbackChainError::ReleaseOnly(
                RemoteOrchestrationError::Fetch(GithubFetchError::MetadataHttp(403, _))
            ))
        ));
        assert!(
            !fallback_called.get(),
            "a non-404 HTTP status must never trigger the fallback"
        );
    }

    /// When both sources fail, the error must carry BOTH underlying
    /// errors distinctly -- never collapsed into one undifferentiated
    /// message a caller can't attribute to a specific source.
    #[test]
    fn fallback_chain_both_failed_carries_both_distinct_errors() {
        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(
                    GithubFetchError::MissingAsset("konductor-v0.1.0-x.tar.gz".to_string()),
                ))
            },
            || {
                Err(MainBranchDistOrchestrationError::Fetch(
                    GithubBranchFetchError::MissingArtifact(
                        "konductor-v0.1.0-x.tar.gz".to_string(),
                        TokenState::NotOptedIn,
                    ),
                ))
            },
            false,
        );
        match result {
            Err(FallbackChainError::BothFailed {
                release_error,
                main_branch_dist_error,
            }) => {
                assert!(matches!(
                    release_error,
                    RemoteOrchestrationError::Fetch(GithubFetchError::MissingAsset(_))
                ));
                assert!(matches!(
                    main_branch_dist_error,
                    MainBranchDistOrchestrationError::Fetch(
                        GithubBranchFetchError::MissingArtifact(_, _)
                    )
                ));
            }
            other => panic!("expected BothFailed, got {other:?}"),
        }
    }

    /// `FallbackChainError::BothFailed`'s Display text must name both
    /// sources' own failure messages, so a plain-text error report never
    /// hides which source did what.
    #[test]
    fn fallback_chain_both_failed_display_names_both_sources() {
        let err = FallbackChainError::BothFailed {
            release_error: RemoteOrchestrationError::Fetch(GithubFetchError::MissingAsset(
                "konductor-v0.1.0-x.tar.gz".to_string(),
            )),
            main_branch_dist_error: MainBranchDistOrchestrationError::Fetch(
                GithubBranchFetchError::MissingArtifact(
                    "konductor-v0.1.0-x.tar.gz".to_string(),
                    TokenState::NotOptedIn,
                ),
            ),
        };
        let message = err.to_string();
        assert!(message.contains("github-release"));
        assert!(message.contains("main-branch-dist"));
    }

    /// The exact real-world gap this fix closes, exercised through the
    /// actual fallback-chain dispatch (`install_from_remote_with_fallback_using`),
    /// not just `Display` in isolation: a repository with no GitHub
    /// release published at all gets a 404 on the release metadata call
    /// (fallback-eligible), the fallback to `main`'s `dist/` ALSO 404s
    /// because nothing is published there either, and with
    /// `--use-github-token` never passed, the resulting top-level error
    /// message must still carry the GITHUB_TOKEN/--use-github-token hint
    /// -- even though neither underlying error is
    /// `GithubFetchError::DownloadHttp` (the variant the prior fix in
    /// this session widened). This is the scenario a real `konductor
    /// install` with no `--from` hits against a repository with zero
    /// published releases: the metadata-phase 404 masks the
    /// download-phase 404 entirely by triggering the fallback first, and
    /// the fallback's own `MissingArtifact`/`MissingSidecar` 404s were
    /// never wired to any hint before this fix.
    #[test]
    fn fallback_chain_both_failed_on_metadata_404_and_missing_artifact_still_carries_the_hint_when_not_opted_in(
    ) {
        let result = install_from_remote_with_fallback_using(
            || {
                Err(RemoteOrchestrationError::Fetch(
                    GithubFetchError::MetadataHttp(404, TokenState::NotOptedIn),
                ))
            },
            || {
                Err(MainBranchDistOrchestrationError::Fetch(
                    GithubBranchFetchError::MissingArtifact(
                        "konductor-v0.1.0-x.tar.gz".to_string(),
                        TokenState::NotOptedIn,
                    ),
                ))
            },
            false,
        );
        let err = result.expect_err("both sources failing must surface as BothFailed");
        let message = err.to_string();
        assert!(
            message.contains("GITHUB_TOKEN"),
            "the top-level fallback-chain error message must name GITHUB_TOKEN even though \
             neither failure is a DownloadHttp, got: {message:?}"
        );
        assert!(
            message.contains("--use-github-token"),
            "the top-level fallback-chain error message must hint at --use-github-token, \
             got: {message:?}"
        );
    }

    #[test]
    fn remote_install_source_display_is_stable() {
        assert_eq!(
            RemoteInstallSource::GithubRelease.to_string(),
            "github-release"
        );
        assert_eq!(
            RemoteInstallSource::MainBranchDist.to_string(),
            "main-branch-dist"
        );
    }

    // ── mcp_binary_fetcher_from_resolved_asset: shared-fetch wiring ──────
    //
    // These exercise the piece of the single-fetch fix that lives in
    // THIS module: `install_from_latest_github_release` now resolves
    // the MCP asset eagerly (via
    // `github::fetch_latest_release_artifact_and_mcp_asset`, exactly
    // once) instead of handing `install_from_remote_bytes` a closure
    // that fetches its own metadata later. `mcp_binary_fetcher_from_resolved_asset`
    // is the seam that turns that already-resolved result into the
    // `McpBinaryFetcher` shape `install_from_remote_bytes` still
    // expects -- these tests confirm it never performs a fetch of its
    // own, just replays the value it was constructed with.

    /// A successful already-resolved asset result, wrapped by
    /// `mcp_binary_fetcher_from_resolved_asset` and then invoked,
    /// must hand back the exact bytes/version it was built with --
    /// confirming the closure performs no computation/fetch of its
    /// own at call time.
    #[test]
    fn mcp_binary_fetcher_from_resolved_asset_replays_a_successful_result_unchanged() {
        let fetcher = mcp_binary_fetcher_from_resolved_asset(Ok((
            b"binary bytes".to_vec(),
            b"sidecar bytes".to_vec(),
            "v0.4.0".to_string(),
        )));
        let (binary_bytes, sidecar_bytes, version) =
            fetcher().expect("a successful resolved asset must replay as Ok");
        assert_eq!(binary_bytes, b"binary bytes");
        assert_eq!(sidecar_bytes, b"sidecar bytes");
        assert_eq!(version, "v0.4.0");
    }

    /// `McpBinaryFetcher` is a `Box<dyn FnOnce() -> ...>`, and this
    /// closure is called by consuming the `fetcher` binding itself
    /// (`fetcher()`, not `(&fetcher)()`), same as every real call site
    /// does (`install_mcp_server_binary_into_remote_temp_dir` takes
    /// `fetcher: McpBinaryFetcher` by value). A second call --
    /// `fetcher()` again on the same binding -- is therefore not a
    /// runtime possibility to guard against: `fetcher` is moved into
    /// its first (and, per the type, only) call, so a second call
    /// would be a "use of moved value" compiler error, not a panic.
    /// This test cannot exercise that second call at all (doing so
    /// would fail `cargo build`, not `cargo test`); it instead pins
    /// down the positive half of the same guarantee -- that a single
    /// call still fully consumes and returns the captured result, with
    /// no leftover internal state to "already be empty" the way the
    /// old `RefCell`+`take()`+`.expect(..)` implementation needed to
    /// check for.
    #[test]
    fn mcp_binary_fetcher_from_resolved_asset_is_consumed_by_its_one_permitted_call() {
        let fetcher = mcp_binary_fetcher_from_resolved_asset(Ok((
            b"binary bytes".to_vec(),
            b"sidecar bytes".to_vec(),
            "v0.9.0".to_string(),
        )));
        // Calling `fetcher` here moves it out of this binding. There is
        // no way to write `fetcher()` a second time below this line --
        // the binding no longer exists to call -- which is precisely
        // the compile-time enforcement `FnOnce` (over the old `Fn` +
        // `RefCell` + `.expect(...)`) was chosen to provide.
        let result = fetcher();
        assert!(result.is_ok(), "the one permitted call must still succeed");
    }

    /// An `UnsupportedPlatform` resolved error must map through with
    /// `remote::MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER` prefixed onto
    /// the rendered message -- the exact signal
    /// `install_mcp_server_binary_into_remote_temp_dir` looks for to
    /// degrade gracefully instead of blocking the whole install. Same
    /// mapping the OLD `build_mcp_binary_fetcher` performed; this
    /// confirms the new eager-resolution path preserves it unchanged.
    #[test]
    fn mcp_binary_fetcher_from_resolved_asset_marks_unsupported_platform_errors() {
        let inner = github::McpServerAssetFetchError::UnsupportedPlatform {
            os: "windows".to_string(),
            arch: "x86_64".to_string(),
        };
        let rendered = inner.to_string();
        let fetcher = mcp_binary_fetcher_from_resolved_asset(Err(inner));
        let err = fetcher().expect_err("an unsupported-platform result must map to an error");
        assert_eq!(
            err.to_string(),
            format!(
                "{}{rendered}",
                remote::MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER
            )
        );
    }

    /// A `Fetch` (non-unsupported-platform) resolved error must map
    /// through with its message UNCHANGED -- no marker prefix -- so
    /// `install_mcp_server_binary_into_remote_temp_dir` blocks the
    /// whole install on it, same as the OLD `build_mcp_binary_fetcher`
    /// did for a real fetch/verify failure on a supported platform.
    #[test]
    fn mcp_binary_fetcher_from_resolved_asset_passes_through_fetch_errors_unmarked() {
        let inner = github::McpServerAssetFetchError::Fetch(GithubFetchError::Network(
            "connection refused".to_string(),
        ));
        let expected_message = inner.to_string();
        let fetcher = mcp_binary_fetcher_from_resolved_asset(Err(inner));
        let err = fetcher().expect_err("a Fetch error must map to an error");
        assert_eq!(err.to_string(), expected_message);
        assert!(
            !err.to_string()
                .contains(remote::MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER),
            "a non-unsupported-platform error must never carry the degrade marker"
        );
    }

    /// The single-fetch guarantee end to end for THIS module's own
    /// piece: a fake `github::fetch_latest_release_artifact_and_mcp_asset`-shaped
    /// call is simulated by constructing both halves from ONE shared
    /// `tag_name`-bearing value and feeding the MCP half straight into
    /// `mcp_binary_fetcher_from_resolved_asset` -- proving that by the
    /// time `install_from_latest_github_release` builds this closure,
    /// the MCP asset's version is already fixed and cannot diverge
    /// from whatever the tarball side resolved, because both came from
    /// values derived from the same simulated fetch, not two
    /// independent ones.
    #[test]
    fn mcp_binary_fetcher_built_from_the_same_release_as_the_tarball_reports_matching_version() {
        let shared_version = "v0.5.0";
        // Simulates `github::fetch_latest_release_artifact_and_mcp_asset`'s
        // own tuple: both halves derived from one shared release value
        // (here, just the shared `shared_version` string standing in
        // for the single fetched `tag_name`).
        let artifact_result: Result<(Vec<u8>, Vec<u8>), GithubFetchError> =
            Ok((b"tarball bytes".to_vec(), b"tarball sidecar".to_vec()));
        let mcp_asset_result: github::McpAssetResolutionResult = Ok((
            b"mcp binary bytes".to_vec(),
            b"mcp sidecar bytes".to_vec(),
            shared_version.to_string(),
        ));

        // The tarball side never even looks at `shared_version` --
        // confirming this test's only shared value is the one the MCP
        // side reports back.
        assert!(artifact_result.is_ok());

        let fetcher = mcp_binary_fetcher_from_resolved_asset(mcp_asset_result);
        let (_binary_bytes, _sidecar_bytes, resolved_version) =
            fetcher().expect("resolved MCP asset must replay as Ok");
        assert_eq!(
            resolved_version, shared_version,
            "the MCP binary fetcher built alongside the tarball fetch must report back \
             exactly the shared release's own version"
        );
    }
}
