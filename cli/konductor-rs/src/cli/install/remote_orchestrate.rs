// SPDX-License-Identifier: Apache-2.0
//
// install/remote_orchestrate.rs — sequences a GitHub-release fetch
// (`install::github::fetch_latest_github_release_artifact`) or a
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
use super::remote::{self, RemoteInstallError};
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

/// Fetches `owner/repo`'s latest GitHub release artifact and sidecar,
/// then hands the resulting bytes to the existing, unmodified
/// `remote::install_from_remote_bytes` -- verify, unpack, install.
/// Never touches that pipeline's own logic; just sequences a real
/// fetch in front of it. Thin wrapper around
/// `install_from_latest_release_with_fetcher` bound to the real
/// production fetcher -- the fetcher is parameterized in that function
/// (not just here) so tests can inject a fake one and exercise this
/// exact sequencing with no real network call.
pub(crate) fn install_from_latest_github_release(
    owner: &str,
    repo: &str,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    installed_at: &str,
    no_telemetry: bool,
    use_github_token: bool,
) -> Result<(), RemoteOrchestrationError> {
    install_from_latest_release_with_fetcher(
        || github::fetch_latest_github_release_artifact(owner, repo, use_github_token),
        strategy,
        target_dir,
        installed_at,
        no_telemetry,
    )
}

/// Same sequencing as `install_from_latest_github_release`, but with
/// the fetch step injected as `fetcher` instead of always calling the
/// real GitHub API, so a test can pass a fake closure with no network
/// call. A fetcher failure wraps as `RemoteOrchestrationError::Fetch`
/// carrying the exact `GithubFetchError` unchanged.
fn install_from_latest_release_with_fetcher(
    fetcher: impl FnOnce() -> Result<(Vec<u8>, Vec<u8>), GithubFetchError>,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    installed_at: &str,
    no_telemetry: bool,
) -> Result<(), RemoteOrchestrationError> {
    let (artifact_bytes, sidecar_bytes) = fetcher().map_err(RemoteOrchestrationError::Fetch)?;
    let artifact_filename = github::expected_artifact_filename();
    remote::install_from_remote_bytes(
        strategy,
        target_dir,
        artifact_bytes,
        &sidecar_bytes,
        &artifact_filename,
        installed_at,
        no_telemetry,
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
) -> Result<(), MainBranchDistOrchestrationError> {
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
/// unmodified, never recomputed from `tarball_bytes` here.
fn install_from_main_branch_dist_with_fetcher(
    fetcher: impl FnOnce() -> Result<(Vec<u8>, Vec<u8>), GithubBranchFetchError>,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    installed_at: &str,
    no_telemetry: bool,
) -> Result<(), MainBranchDistOrchestrationError> {
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
/// Returns the source that produced a successful install. Parameterized
/// by `release_installer`/`main_branch_dist_installer` so tests can
/// inject fake closures with no real network call.
fn install_from_remote_with_fallback_using(
    release_installer: impl FnOnce() -> Result<(), RemoteOrchestrationError>,
    main_branch_dist_installer: impl FnOnce() -> Result<(), MainBranchDistOrchestrationError>,
) -> Result<RemoteInstallSource, FallbackChainError> {
    match release_installer() {
        Ok(()) => Ok(RemoteInstallSource::GithubRelease),
        Err(
            release_error @ RemoteOrchestrationError::Fetch(
                GithubFetchError::MissingAsset(_) | GithubFetchError::MetadataHttp(404, _),
            ),
        ) => match main_branch_dist_installer() {
            Ok(()) => Ok(RemoteInstallSource::MainBranchDist),
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
) -> Result<RemoteInstallSource, FallbackChainError> {
    install_from_remote_with_fallback_using(
        || {
            install_from_latest_github_release(
                owner,
                repo,
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

        let target_dir = scratch_dir("fetcher-seam-success-target");
        install_from_latest_release_with_fetcher(
            move || Ok((artifact_bytes, sidecar_bytes)),
            &KiroCliInstallStrategy,
            &target_dir,
            "2026-01-01T00:00:00Z",
            false,
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
            MainBranchDistOrchestrationError::Fetch(GithubBranchFetchError::MissingArtifact(_))
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
            MainBranchDistOrchestrationError::Fetch(GithubBranchFetchError::MissingSidecar(_))
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
            || Ok(()),
            move || {
                fallback_called_check.set(true);
                Ok(())
            },
        );
        assert_eq!(result.unwrap(), RemoteInstallSource::GithubRelease);
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
            || Ok(()),
        );
        assert_eq!(result.unwrap(), RemoteInstallSource::MainBranchDist);
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
            || Ok(()),
        );
        assert_eq!(result.unwrap(), RemoteInstallSource::MainBranchDist);
    }

    /// A `GithubFetchError::DownloadHttp(404)` -- a release that
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
                    GithubFetchError::DownloadHttp(404),
                ))
            },
            move || {
                fallback_called_check.set(true);
                Ok(())
            },
        );
        assert!(matches!(
            result,
            Err(FallbackChainError::ReleaseOnly(
                RemoteOrchestrationError::Fetch(GithubFetchError::DownloadHttp(404))
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
                Ok(())
            },
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
                Ok(())
            },
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
                    ),
                ))
            },
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
                        GithubBranchFetchError::MissingArtifact(_)
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
                GithubBranchFetchError::MissingArtifact("konductor-v0.1.0-x.tar.gz".to_string()),
            ),
        };
        let message = err.to_string();
        assert!(message.contains("github-release"));
        assert!(message.contains("main-branch-dist"));
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
}
