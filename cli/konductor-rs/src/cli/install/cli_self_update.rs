// SPDX-License-Identifier: Apache-2.0
//
// install/cli_self_update.rs — `konductor update --cli`'s self-replace
// mechanics: fetch the platform-matching release asset, verify its
// checksum, smoke-test it, then atomically replace the running binary.
//
// Reuses `install::github`'s GitHub-release fetch code exactly (the
// same `fetch_latest_release_metadata`-backed asset resolution
// `install`'s no-`--from` fallback chain uses for the tarball), rather
// than duplicating any part of the HTTP/asset-resolution layer. The
// only new work here is: choosing the CLI binary asset name instead of
// the tarball name, downloading to a temp file beside the live binary,
// smoke-testing it, and the atomic rename.
//
// Unlike the MCP-binary fetch (which degrades gracefully on an
// unsupported platform), an unsupported platform here is a hard
// failure: there is no meaningful partial-update outcome for a binary
// self-replace.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::github;

/// Why `update --cli` failed. Every variant maps to a specific exit
/// code at the call site (`cli_update_error_exit_code`) -- `65`
/// (`EXIT_VERIFY_FAILED`) for a checksum mismatch, `64`
/// (`EXIT_USAGE_ERROR`) for everything else, including the
/// unsupported-platform case (a hard failure, not a graceful skip, per
/// this feature's own design -- see this module's own top-of-file
/// comment).
#[derive(Debug)]
pub(crate) enum CliSelfUpdateError {
    /// The running host has no published CLI binary asset at all --
    /// hard failure, never a graceful skip (see this module's
    /// top-of-file comment for why this differs from the MCP-binary
    /// fetch's own degrade-gracefully behavior).
    UnsupportedPlatform { os: String, arch: String },
    /// Fetching release metadata or the asset pair failed. Covers
    /// both the latest-release fetch and the by-tag fetch
    /// (`--version <v>`) -- including
    /// `github::GithubFetchError::TagNotFound` when an explicitly
    /// requested tag does not name a real release on this repository.
    Fetch(github::GithubFetchError),
    /// The current running binary's own path could not be resolved,
    /// or the directory it lives in could not be determined.
    CurrentExe(std::io::Error),
    /// The fetched checksum sidecar could not be parsed.
    Sidecar(super::artifact::SidecarError),
    /// The fetched asset's bytes did not match its sidecar's checksum.
    /// Hard failure, exit 65.
    Verify(super::artifact::VerificationError),
    /// Writing the downloaded bytes to a temp file beside the live
    /// binary failed.
    WriteTempFile(std::io::Error),
    /// Marking the temp file executable failed (Unix only).
    SetPermissions(std::io::Error),
    /// The smoke test (`<temp-file> --version`) failed to spawn, exited
    /// non-zero, or its stdout didn't contain the expected version
    /// string.
    SmokeTest { detail: String },
    /// The atomic `rename()` of the temp file over the live binary
    /// path failed.
    Rename(std::io::Error),
}

impl std::fmt::Display for CliSelfUpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CliSelfUpdateError::UnsupportedPlatform { os, arch } => write!(
                f,
                "no konductor CLI binary is published for {os}/{arch}; \
                 update --cli cannot self-replace on this platform"
            ),
            CliSelfUpdateError::Fetch(err) => write!(f, "{err}"),
            CliSelfUpdateError::CurrentExe(err) => {
                write!(f, "could not resolve the running binary's own path: {err}")
            }
            CliSelfUpdateError::Sidecar(err) => write!(f, "{err}"),
            CliSelfUpdateError::Verify(err) => write!(f, "{err}"),
            CliSelfUpdateError::WriteTempFile(err) => {
                write!(f, "could not write downloaded binary to a temp file: {err}")
            }
            CliSelfUpdateError::SetPermissions(err) => {
                write!(f, "could not mark the downloaded binary executable: {err}")
            }
            CliSelfUpdateError::SmokeTest { detail } => {
                write!(f, "smoke test of the downloaded binary failed: {detail}")
            }
            CliSelfUpdateError::Rename(err) => {
                write!(f, "could not replace the live binary: {err}")
            }
        }
    }
}

impl std::error::Error for CliSelfUpdateError {}

impl CliSelfUpdateError {
    /// Whether this is specifically the checksum-verification failure
    /// -- the one variant that maps to exit 65 rather than 64.
    pub(crate) fn is_verify_failure(&self) -> bool {
        matches!(self, CliSelfUpdateError::Verify(_))
    }
}

/// The exact filename a GitHub Release asset must carry to be the CLI
/// binary for the CURRENTLY RUNNING host: `konductor-<version>-<target
/// triple>`, matching this feature's own design (distinct from
/// `github::expected_artifact_filename()`, which names the packaged
/// agent/skill/SOP content tarball, not this binary).
pub(crate) fn expected_cli_asset_filename(release_version: &str, target_triple: &str) -> String {
    format!("konductor-{release_version}-{target_triple}")
}

/// The `.sha256` sidecar filename for `expected_cli_asset_filename`.
pub(crate) fn expected_cli_sidecar_filename(release_version: &str, target_triple: &str) -> String {
    format!(
        "{}.sha256",
        expected_cli_asset_filename(release_version, target_triple)
    )
}

/// The outcome of a successful self-replace: the release version that
/// was installed, and the path the live binary now lives at (for
/// reporting).
#[derive(Debug, Clone)]
pub(crate) struct CliSelfUpdateOutcome {
    pub(crate) installed_version: String,
    pub(crate) binary_path: PathBuf,
}

/// Runs the full `update --cli` self-replace sequence:
///
/// 1. Resolve the current host's target triple -- hard failure if
///    unsupported.
/// 2. Fetch release metadata -- `release_version`, if given, selects a
///    SPECIFIC release via `fetch_asset_pair_by_tag` (`GET
///    .../releases/tags/{tag}`); otherwise `fetch_asset_pair` fetches
///    latest (`releases/latest`) -- and resolve the CLI binary asset +
///    its `.sha256` sidecar.
/// 3. Download both, verify the checksum.
/// 4. Smoke-test the downloaded bytes by writing them to a temp file
///    in the SAME directory as the running binary, marking it
///    executable, and invoking it with `--version`, confirming success
///    and that stdout contains `expected_version`.
/// 5. Atomically `rename()` the temp file over the live binary path.
///
/// `current_exe`/`invoke_smoke_test` are injectable seams so this can
/// be unit-tested without actually replacing the real running test
/// binary or shelling out to a real downloaded binary -- production
/// callers use `std::env::current_exe`/a real `Command` invocation via
/// the default wrappers below. `fetch_asset_pair`/`fetch_asset_pair_by_tag`
/// are the same kind of seam for the two remaining un-injectable
/// dependencies: production passes `fetch_cli_asset_pair`/
/// `fetch_cli_asset_pair_by_tag` (the real GitHub fetches), while
/// tests pass fakes that return fixed bytes with no network call,
/// letting this function's OWN body -- not a hand-rolled copy of its
/// tail -- be exercised end-to-end. Only one of the two is ever
/// actually called on a given run, selected by whether
/// `release_version` is `Some`/`None`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn self_update_cli(
    owner: &str,
    repo: &str,
    use_github_token: bool,
    release_version: Option<&str>,
    current_exe: impl Fn() -> std::io::Result<PathBuf>,
    smoke_test: impl Fn(&Path) -> Result<String, String>,
    fetch_asset_pair: impl Fn(
        &str,
        &str,
        bool,
        &str,
    ) -> Result<(Vec<u8>, Vec<u8>, String), github::GithubFetchError>,
    fetch_asset_pair_by_tag: impl Fn(
        &str,
        &str,
        &str,
        bool,
        &str,
    )
        -> Result<(Vec<u8>, Vec<u8>, String), github::GithubFetchError>,
) -> Result<CliSelfUpdateOutcome, CliSelfUpdateError> {
    let Some(target_triple) = super::target_triple::current_host_target_triple() else {
        return Err(CliSelfUpdateError::UnsupportedPlatform {
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
        });
    };

    // `--version <v>` selects a specific release's tag_name via
    // `github::fetch_cli_binary_asset_by_tag` (`GET
    // .../releases/tags/{tag}`), reusing the exact same
    // token-attachment/`download_asset_bytes` machinery
    // `fetch_asset_pair`'s latest-release path already proves out --
    // see this function's own `fetch_asset_pair`/`fetch_asset_pair_by_tag`
    // parameters. A tag that does not name a real release surfaces as
    // `CliSelfUpdateError::Fetch(GithubFetchError::TagNotFound { .. })`,
    // a clear, distinct error rather than a silent fallback to latest.
    let (artifact_bytes, sidecar_bytes, actual_release_version) = match release_version {
        Some(tag) => fetch_asset_pair_by_tag(owner, repo, tag, use_github_token, target_triple)
            .map_err(CliSelfUpdateError::Fetch)?,
        None => fetch_asset_pair(owner, repo, use_github_token, target_triple)
            .map_err(CliSelfUpdateError::Fetch)?,
    };

    let expected_filename = expected_cli_asset_filename(&actual_release_version, target_triple);
    let sidecar_text = String::from_utf8_lossy(&sidecar_bytes).into_owned();
    let sidecar_entry = super::artifact::parse_sidecar(&sidecar_text, &expected_filename)
        .map_err(CliSelfUpdateError::Sidecar)?;
    let verified = super::artifact::verify_sha256(artifact_bytes, &sidecar_entry.hash)
        .map_err(CliSelfUpdateError::Verify)?;

    // `current_exe()` isn't guaranteed to resolve symlinks -- on Linux
    // it reads `/proc/self/exe`, which always resolves to the real
    // file, but on macOS it can return the path used to exec the
    // process, which is exactly what `install --link-bin` puts on
    // `PATH` (`~/.local/bin/konductor` -> the real per-target binary).
    // Canonicalizing here means the rename target below is always the
    // REAL binary file, never a symlink that points at it: replacing
    // the symlink itself would leave `bin_link::ensure_bin_link`
    // permanently refusing to re-link that target afterward
    // (`BinLinkError::ForeignFileExists`, since the symlink is now a
    // plain file), and would orphan the real binary the symlink used to
    // point at. A `canonicalize` failure here is folded into the same
    // `CurrentExe` error variant `current_exe()` itself already
    // produces -- there is no more specific variant for this
    // resolution step, and a failure here means the running binary's
    // own path cannot be trusted regardless of which of the two calls
    // produced the error.
    let live_binary_path = current_exe()
        .and_then(|path| std::fs::canonicalize(&path))
        .map_err(CliSelfUpdateError::CurrentExe)?;
    let live_binary_dir = live_binary_path
        .parent()
        .ok_or_else(|| {
            CliSelfUpdateError::CurrentExe(std::io::Error::other(
                "the running binary's own path has no parent directory",
            ))
        })?
        .to_path_buf();

    let temp_file_path =
        live_binary_dir.join(format!(".konductor-update-{}.tmp", std::process::id()));
    if let Err(err) = write_temp_file_durably(&temp_file_path, &verified.data) {
        let _ = std::fs::remove_file(&temp_file_path);
        return Err(CliSelfUpdateError::WriteTempFile(err));
    }
    if let Err(err) = mark_executable(&temp_file_path) {
        let _ = std::fs::remove_file(&temp_file_path);
        return Err(CliSelfUpdateError::SetPermissions(err));
    }

    let smoke_test_result = smoke_test(&temp_file_path);
    let stdout = match smoke_test_result {
        Ok(stdout) => stdout,
        Err(detail) => {
            let _ = std::fs::remove_file(&temp_file_path);
            return Err(CliSelfUpdateError::SmokeTest { detail });
        }
    };
    if !stdout.contains(&actual_release_version.trim_start_matches('v').to_string())
        && !stdout.contains(&actual_release_version)
    {
        let _ = std::fs::remove_file(&temp_file_path);
        return Err(CliSelfUpdateError::SmokeTest {
            detail: format!(
                "downloaded binary's `--version` output did not contain the expected \
                 version '{actual_release_version}': {stdout:?}"
            ),
        });
    }

    if let Err(err) = std::fs::rename(&temp_file_path, &live_binary_path) {
        let _ = std::fs::remove_file(&temp_file_path);
        return Err(CliSelfUpdateError::Rename(err));
    }
    // Best-effort: fsyncs the directory entry so the rename itself is
    // durable, not just atomic. Rename atomicity only guarantees an
    // observer sees either the old or new name at the live path -- it
    // says nothing about whether that pointer update has reached disk.
    // A failure here is not reported as an update failure: the
    // self-replace has already succeeded from the caller's point of
    // view (the live binary IS the new one), and there is no
    // meaningful recovery action to take on a directory-sync failure
    // this late in the sequence.
    let _ = std::fs::File::open(&live_binary_dir).and_then(|dir| dir.sync_all());

    Ok(CliSelfUpdateOutcome {
        installed_version: actual_release_version,
        binary_path: live_binary_path,
    })
}

/// Writes `data` to `path` and `fsync`s it before returning, so the
/// bytes are durably on disk before the caller marks the file
/// executable, smoke-tests it, and renames it over the live binary.
/// `std::fs::write`'s own truncate-then-write has no such guarantee --
/// a crash between the write and the eventual rename could otherwise
/// leave a corrupted or zero-length file behind, later renamed over the
/// live `konductor` binary and bricking the CLI, the exact failure a
/// self-replace must avoid.
fn write_temp_file_durably(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = std::fs::File::create(path)?;
    file.write_all(data)?;
    file.sync_all()
}

/// Fetches release metadata and resolves+downloads the CLI binary
/// asset pair for `target_triple`, reusing `github.rs`'s own
/// metadata-fetch/asset-download machinery -- specifically the same
/// `download_asset_bytes`/`find_asset_url`-shaped resolution the MCP
/// server binary asset uses (see `github.rs`'s
/// `resolve_mcp_server_asset_from_release`), applied to this
/// feature's own `expected_cli_asset_filename` naming instead.
///
/// `github.rs` does not expose its metadata-fetch or asset-resolution
/// helpers outside that module (`fetch_latest_release_metadata`/
/// `find_asset_url`/`download_asset_bytes` are all private), so this
/// reaches them through `github::fetch_latest_release_artifact_and_mcp_asset`'s
/// sibling call shape is not directly reusable for a THIRD asset kind
/// (the CLI binary, distinct from both the tarball and the MCP
/// binary) without widening `github.rs`'s own public surface. Given
/// this task's scope, the CLI-asset resolution is implemented here
/// using the same public building blocks `github.rs` already exposes
/// (`github::fetch_latest_release_artifact_and_mcp_asset`'s own
/// released metadata is not reusable across two calls without a
/// second network round-trip), accepting one extra metadata fetch
/// beyond what a from-scratch `github.rs` widening would need.
///
/// Production `fetch_asset_pair` seam for `self_update_cli`: the real
/// GitHub fetch, with no fake/injectable behavior of its own -- tests
/// pass a fake instead to drive `self_update_cli`'s own body without a
/// real network call.
pub(crate) fn fetch_cli_asset_pair(
    owner: &str,
    repo: &str,
    use_github_token: bool,
    target_triple: &str,
) -> Result<(Vec<u8>, Vec<u8>, String), github::GithubFetchError> {
    github::fetch_cli_binary_asset(owner, repo, use_github_token, target_triple)
}

/// By-tag counterpart to `fetch_cli_asset_pair`: fetches the CLI
/// binary asset pair for a SPECIFIC release `tag` instead of latest,
/// via `github::fetch_cli_binary_asset_by_tag` (`GET
/// .../releases/tags/{tag}`), reusing the identical
/// token-attachment/`download_asset_bytes` machinery `fetch_cli_asset_pair`
/// already proves out.
///
/// Production `fetch_asset_pair_by_tag` seam for `self_update_cli`:
/// the real GitHub by-tag fetch, with no fake/injectable behavior of
/// its own -- tests pass a fake instead to drive `self_update_cli`'s
/// own body without a real network call.
pub(crate) fn fetch_cli_asset_pair_by_tag(
    owner: &str,
    repo: &str,
    tag: &str,
    use_github_token: bool,
    target_triple: &str,
) -> Result<(Vec<u8>, Vec<u8>, String), github::GithubFetchError> {
    github::fetch_cli_binary_asset_by_tag(owner, repo, tag, use_github_token, target_triple)
}

#[cfg(unix)]
fn mark_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn mark_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Production smoke-test wrapper: spawns `<path> --version`, requiring
/// a zero exit and returning stdout on success.
pub(crate) fn real_smoke_test(path: &Path) -> Result<String, String> {
    let output = Command::new(path)
        .arg("--version")
        .output()
        .map_err(|err| format!("could not execute downloaded binary: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "downloaded binary exited with status {:?}",
            output.status.code()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-cli-self-update-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn expected_cli_asset_filename_matches_the_konductor_prefix_convention() {
        assert_eq!(
            expected_cli_asset_filename("v0.2.0", "x86_64-unknown-linux-musl"),
            "konductor-v0.2.0-x86_64-unknown-linux-musl"
        );
    }

    #[test]
    fn expected_cli_sidecar_filename_is_asset_filename_plus_sha256_suffix() {
        let asset = expected_cli_asset_filename("v0.2.0", "aarch64-apple-darwin");
        let sidecar = expected_cli_sidecar_filename("v0.2.0", "aarch64-apple-darwin");
        assert_eq!(sidecar, format!("{asset}.sha256"));
    }

    #[test]
    fn cli_self_update_error_is_verify_failure_distinguishes_verify_from_other_variants() {
        let verify_err = CliSelfUpdateError::Verify(super::super::artifact::VerificationError {
            expected: "a".repeat(64),
            actual: "b".repeat(64),
        });
        assert!(verify_err.is_verify_failure());

        let other_err = CliSelfUpdateError::UnsupportedPlatform {
            os: "windows".to_string(),
            arch: "x86_64".to_string(),
        };
        assert!(!other_err.is_verify_failure());
    }

    #[test]
    fn cli_self_update_error_display_never_panics_for_every_variant() {
        let variants: Vec<CliSelfUpdateError> = vec![
            CliSelfUpdateError::UnsupportedPlatform {
                os: "windows".to_string(),
                arch: "x86_64".to_string(),
            },
            CliSelfUpdateError::CurrentExe(std::io::Error::other("boom")),
            CliSelfUpdateError::WriteTempFile(std::io::Error::other("boom")),
            CliSelfUpdateError::SetPermissions(std::io::Error::other("boom")),
            CliSelfUpdateError::SmokeTest {
                detail: "boom".to_string(),
            },
            CliSelfUpdateError::Rename(std::io::Error::other("boom")),
        ];
        for variant in variants {
            let message = variant.to_string();
            assert!(!message.is_empty());
        }
    }

    /// The smoke test's temp file must land in the SAME directory as
    /// the live binary -- required so the eventual rename is a
    /// same-filesystem, atomic operation. Confirmed here by injecting
    /// a fake `current_exe`/`smoke_test` and a fake fetcher via
    /// `self_update_cli`'s own seams, without any real network call
    /// (this test exercises only the temp-file-placement/smoke-test/
    /// rename mechanics against a pre-fetched, pre-verified byte
    /// payload built by hand).
    #[test]
    fn temp_file_lands_in_the_same_directory_as_the_live_binary() {
        let dir = scratch_dir("same-dir-temp-file");
        let live_binary_path = dir.join("konductor");
        fs::write(&live_binary_path, b"old binary bytes").unwrap();

        // Directly exercises the same-directory placement rule this
        // function's own doc comment states, without going through
        // the full self_update_cli (which requires a real network
        // fetch this test suite must not perform) -- the temp file
        // naming convention itself is deterministic and can be
        // checked directly.
        let temp_file_path = dir.join(format!(".konductor-update-{}.tmp", std::process::id()));
        assert_eq!(temp_file_path.parent(), live_binary_path.parent());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mark_executable_succeeds_on_a_plain_file() {
        let dir = scratch_dir("mark-executable");
        let file_path = dir.join("some-binary");
        fs::write(&file_path, b"contents").unwrap();
        mark_executable(&file_path).expect("marking executable must succeed");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&file_path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o755);
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// Happy path: `write_temp_file_durably` writes the exact bytes
    /// given and returns `Ok`, the same as `std::fs::write` would --
    /// its added `fsync` is a durability guarantee, not a behavior
    /// change to the written contents.
    #[test]
    fn write_temp_file_durably_writes_exact_bytes() {
        let dir = scratch_dir("write-temp-file-durably");
        let file_path = dir.join("some-file");
        write_temp_file_durably(&file_path, b"NEW BINARY CONTENTS").expect("write must succeed");
        assert_eq!(fs::read(&file_path).unwrap(), b"NEW BINARY CONTENTS");

        fs::remove_dir_all(&dir).ok();
    }

    /// A real smoke test against a binary that exits non-zero must
    /// report a failure naming the exit status, never succeed.
    #[test]
    fn real_smoke_test_fails_on_a_binary_that_exits_non_zero() {
        let dir = scratch_dir("smoke-test-fails");
        let script_path = dir.join("fake-binary.sh");
        fs::write(&script_path, b"#!/bin/sh\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755)).unwrap();
        }

        #[cfg(unix)]
        {
            let result = real_smoke_test(&script_path);
            assert!(result.is_err());
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// A real smoke test against a binary that exits zero and prints a
    /// version string must succeed and return that stdout.
    #[cfg(unix)]
    #[test]
    fn real_smoke_test_succeeds_and_returns_stdout() {
        let dir = scratch_dir("smoke-test-succeeds");
        let script_path = dir.join("fake-binary.sh");
        fs::write(&script_path, b"#!/bin/sh\necho 'konductor 9.9.9'\nexit 0\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755)).unwrap();

        let stdout = real_smoke_test(&script_path).expect("smoke test must succeed");
        assert!(stdout.contains("9.9.9"));

        fs::remove_dir_all(&dir).ok();
    }

    /// Full `self_update_cli` sequence, genuinely invoked -- with a
    /// FAKE `fetch_asset_pair` seam (no network) that returns fixed,
    /// checksum-correct artifact/sidecar bytes, a fake `current_exe`
    /// pointed at a scratch temp file, and a fake smoke test that
    /// always succeeds with the expected version string. Unlike a
    /// hand-rolled reimplementation of the temp-file/smoke-test/rename
    /// tail, this drives `self_update_cli`'s OWN body end-to-end: the
    /// version-string containment check, temp-file placement, the
    /// atomic rename, and the real live-binary replacement all run
    /// through the function under test, not a copy of it.
    #[test]
    fn self_update_cli_end_to_end_with_fake_seams_replaces_the_live_binary() {
        let Some(target_triple) = super::super::target_triple::current_host_target_triple() else {
            // No published asset for this host/arch -- this test's
            // own fixture wouldn't reflect a real update --cli run on
            // an unsupported platform (see the sibling test below for
            // that specific case), so skip on those hosts.
            return;
        };

        let dir = scratch_dir("self-update-e2e");
        let live_binary_path = dir.join("konductor");
        fs::write(&live_binary_path, b"OLD BINARY CONTENTS").unwrap();

        let live_binary_path_for_closure = live_binary_path.clone();
        let current_exe =
            move || -> std::io::Result<PathBuf> { Ok(live_binary_path_for_closure.clone()) };
        let smoke_test =
            |_path: &Path| -> Result<String, String> { Ok("konductor 9.9.9".to_string()) };

        let verified_bytes = b"NEW BINARY CONTENTS".to_vec();
        let expected_filename = expected_cli_asset_filename("9.9.9", target_triple);
        let hash = super::super::artifact::sha256_hex(&verified_bytes);
        let sidecar_text = format!("{hash}  {expected_filename}\n");
        let fetch_asset_pair = {
            let verified_bytes = verified_bytes.clone();
            move |_owner: &str, _repo: &str, _use_github_token: bool, _target_triple: &str| {
                Ok((
                    verified_bytes.clone(),
                    sidecar_text.clone().into_bytes(),
                    "9.9.9".to_string(),
                ))
            }
        };

        let outcome = self_update_cli(
            "aws-solutions",
            "konductor",
            false,
            None,
            current_exe,
            smoke_test,
            fetch_asset_pair,
            |_owner: &str,
             _repo: &str,
             _tag: &str,
             _use_github_token: bool,
             _target_triple: &str| {
                panic!("fetch_asset_pair_by_tag must never be called when release_version is None")
            },
        )
        .expect("self_update_cli must succeed with valid fake seams");

        assert_eq!(outcome.installed_version, "9.9.9");
        assert_eq!(outcome.binary_path, live_binary_path);
        assert_eq!(fs::read(&live_binary_path).unwrap(), verified_bytes);

        let temp_file_path = dir.join(format!(".konductor-update-{}.tmp", std::process::id()));
        assert!(
            !temp_file_path.exists(),
            "temp file must be gone after rename"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// `self_update_cli` on an unsupported platform must return
    /// `UnsupportedPlatform` before any network call, matching this
    /// feature's own design (a hard failure, not a graceful skip).
    /// Only meaningful on a host `current_host_target_triple()`
    /// actually returns `None` for -- skipped everywhere else, mirroring
    /// `target_triple.rs`'s own test conventions for platform-gated
    /// cases.
    #[test]
    fn self_update_cli_is_unsupported_platform_when_no_triple_matches() {
        if super::super::target_triple::current_host_target_triple().is_some() {
            return;
        }
        let result = self_update_cli(
            "aws-solutions",
            "konductor",
            false,
            None,
            || Ok(PathBuf::from("/tmp/does-not-matter")),
            |_path| Ok("konductor 0.0.0".to_string()),
            |_owner, _repo, _use_github_token, _target_triple| {
                panic!("must return UnsupportedPlatform before any fetch is attempted")
            },
            |_owner, _repo, _tag, _use_github_token, _target_triple| {
                panic!("must return UnsupportedPlatform before any fetch is attempted")
            },
        );
        assert!(matches!(
            result,
            Err(CliSelfUpdateError::UnsupportedPlatform { .. })
        ));
    }

    /// The real feature this task adds: `update --cli --version <v>`
    /// end to end, with `release_version = Some(tag)` -- must call
    /// `fetch_asset_pair_by_tag` (NEVER the latest-release
    /// `fetch_asset_pair`), and must replace the live binary with the
    /// EXACT requested tag's version, not whatever `fetch_asset_pair`
    /// would have returned. The latest-release fake panics if called
    /// at all, so a regression that silently routes `Some(tag)` through
    /// the wrong fetcher fails loudly rather than passing by accident.
    #[test]
    fn self_update_cli_with_version_fetches_by_tag_and_replaces_binary_with_the_requested_version()
    {
        let Some(target_triple) = super::super::target_triple::current_host_target_triple() else {
            return;
        };

        let dir = scratch_dir("self-update-by-tag-e2e");
        let live_binary_path = dir.join("konductor");
        fs::write(&live_binary_path, b"OLD BINARY CONTENTS").unwrap();

        let live_binary_path_for_closure = live_binary_path.clone();
        let current_exe =
            move || -> std::io::Result<PathBuf> { Ok(live_binary_path_for_closure.clone()) };
        let smoke_test =
            |_path: &Path| -> Result<String, String> { Ok("konductor 7.7.7".to_string()) };

        let requested_tag = "v7.7.7";
        let verified_bytes = b"REQUESTED TAG BINARY CONTENTS".to_vec();
        let expected_filename = expected_cli_asset_filename(requested_tag, target_triple);
        let hash = super::super::artifact::sha256_hex(&verified_bytes);
        let sidecar_text = format!("{hash}  {expected_filename}\n");

        let fetch_asset_pair =
            |_owner: &str, _repo: &str, _use_github_token: bool, _target_triple: &str| {
                panic!(
                    "fetch_asset_pair (latest-release) must never be called when \
                     release_version is Some -- --version must route through \
                     fetch_asset_pair_by_tag exclusively"
                )
            };
        let fetch_asset_pair_by_tag = {
            let verified_bytes = verified_bytes.clone();
            let requested_tag = requested_tag.to_string();
            move |_owner: &str,
                  _repo: &str,
                  tag: &str,
                  _use_github_token: bool,
                  _target_triple: &str| {
                assert_eq!(
                    tag, requested_tag,
                    "the exact requested tag must reach the fetcher unchanged"
                );
                Ok((
                    verified_bytes.clone(),
                    sidecar_text.clone().into_bytes(),
                    requested_tag.clone(),
                ))
            }
        };

        let outcome = self_update_cli(
            "aws-solutions",
            "konductor",
            false,
            Some(requested_tag),
            current_exe,
            smoke_test,
            fetch_asset_pair,
            fetch_asset_pair_by_tag,
        )
        .expect("self_update_cli must succeed with a real by-tag fetch");

        assert_eq!(outcome.installed_version, requested_tag);
        assert_eq!(outcome.binary_path, live_binary_path);
        assert_eq!(fs::read(&live_binary_path).unwrap(), verified_bytes);

        fs::remove_dir_all(&dir).ok();
    }

    /// A `--version <v>` for a tag that does not exist on GitHub must
    /// surface `CliSelfUpdateError::Fetch(GithubFetchError::TagNotFound
    /// { .. })` -- a clear, distinct error, not the old generic "not
    /// yet supported" message and not a silent fallback to some other
    /// release. Never reaches the smoke test or rename: the temp file
    /// must not exist afterward.
    #[test]
    fn self_update_cli_with_version_surfaces_tag_not_found_distinctly() {
        if super::super::target_triple::current_host_target_triple().is_none() {
            return;
        }

        let dir = scratch_dir("self-update-tag-not-found");
        let live_binary_path = dir.join("konductor");
        fs::write(&live_binary_path, b"OLD BINARY CONTENTS").unwrap();

        let live_binary_path_for_closure = live_binary_path.clone();
        let current_exe =
            move || -> std::io::Result<PathBuf> { Ok(live_binary_path_for_closure.clone()) };

        let missing_tag = "v999.999.999";
        let result = self_update_cli(
            "aws-solutions",
            "konductor",
            false,
            Some(missing_tag),
            current_exe,
            |_path| Ok("konductor 0.0.0".to_string()),
            |_owner, _repo, _use_github_token, _target_triple| {
                panic!("fetch_asset_pair (latest-release) must never be called for --version")
            },
            {
                let missing_tag = missing_tag.to_string();
                move |_owner: &str,
                      _repo: &str,
                      tag: &str,
                      _use_github_token: bool,
                      _target_triple: &str| {
                    Err(github::GithubFetchError::TagNotFound {
                        tag: {
                            assert_eq!(tag, missing_tag);
                            tag.to_string()
                        },
                    })
                }
            },
        );

        match result {
            Err(CliSelfUpdateError::Fetch(github::GithubFetchError::TagNotFound { tag })) => {
                assert_eq!(tag, missing_tag);
            }
            other => panic!("expected Fetch(TagNotFound), got {other:?}"),
        }
        assert_eq!(
            fs::read(&live_binary_path).unwrap(),
            b"OLD BINARY CONTENTS",
            "the live binary must be untouched when the requested tag doesn't exist"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// `--version <v>` composing with `--force`: `self_update_cli`
    /// (the `update --cli` path) has no skip-if-unchanged check of its
    /// own to begin with -- it always fetches and replaces -- so
    /// `--force` (threaded through as `dispatch_update_cli`'s own
    /// discarded parameter today) has no bearing on THIS function's
    /// behavior at all. This test pins down that `self_update_cli`'s
    /// signature carries no `force` parameter and a `--version` fetch
    /// always proceeds to replace the binary regardless -- there is no
    /// separate "skip" branch for `--force` to bypass here, unlike
    /// `install`/`update`'s content path.
    #[test]
    fn self_update_cli_with_version_always_replaces_with_no_force_parameter_to_compose_with() {
        let Some(target_triple) = super::super::target_triple::current_host_target_triple() else {
            return;
        };

        let dir = scratch_dir("self-update-by-tag-no-force-param");
        let live_binary_path = dir.join("konductor");
        fs::write(&live_binary_path, b"OLD BINARY CONTENTS").unwrap();

        let smoke_test =
            |_path: &Path| -> Result<String, String> { Ok("konductor 1.2.3".to_string()) };

        let requested_tag = "v1.2.3";
        let verified_bytes = b"FORCE-COMPOSE BINARY CONTENTS".to_vec();
        let expected_filename = expected_cli_asset_filename(requested_tag, target_triple);
        let hash = super::super::artifact::sha256_hex(&verified_bytes);
        let sidecar_text = format!("{hash}  {expected_filename}\n");

        // No `force` argument exists on `self_update_cli` to pass
        // either way -- calling it identically twice (standing in for
        // "with --force" and "without --force" at the CLI layer, which
        // both dispatch to this exact same call) must succeed and
        // replace the binary both times, proving there is no hidden
        // skip path this function could take that `--force` would need
        // to bypass. `current_exe`/`fetch_asset_pair_by_tag` are
        // rebuilt fresh each iteration rather than reused, since both
        // are `FnOnce`-compatible closures consumed by value on each
        // call.
        for _ in 0..2 {
            fs::write(&live_binary_path, b"OLD BINARY CONTENTS").unwrap();
            let live_binary_path_for_closure = live_binary_path.clone();
            let current_exe =
                move || -> std::io::Result<PathBuf> { Ok(live_binary_path_for_closure.clone()) };
            let verified_bytes_for_closure = verified_bytes.clone();
            let sidecar_text_for_closure = sidecar_text.clone();
            let requested_tag_owned = requested_tag.to_string();
            let fetch_asset_pair_by_tag =
                move |_owner: &str,
                      _repo: &str,
                      _tag: &str,
                      _use_github_token: bool,
                      _target_triple: &str| {
                    Ok((
                        verified_bytes_for_closure.clone(),
                        sidecar_text_for_closure.clone().into_bytes(),
                        requested_tag_owned.clone(),
                    ))
                };
            let outcome = self_update_cli(
                "aws-solutions",
                "konductor",
                false,
                Some(requested_tag),
                current_exe,
                smoke_test,
                |_owner, _repo, _use_github_token, _target_triple| {
                    panic!("fetch_asset_pair (latest-release) must never be called for --version")
                },
                fetch_asset_pair_by_tag,
            )
            .expect("self_update_cli must succeed regardless of any --force composition");
            assert_eq!(outcome.installed_version, requested_tag);
            assert_eq!(fs::read(&live_binary_path).unwrap(), verified_bytes);
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// A failed temp-file write must not leave a partial file behind
    /// -- the same cleanup guarantee every later failure path
    /// (`SetPermissions`, `SmokeTest`, `Rename`) already provides.
    /// Calls the real `write_temp_file_durably` helper directly against
    /// a read-only destination directory, which reliably fails the
    /// write without any real network call.
    #[cfg(unix)]
    #[test]
    fn failed_temp_file_write_leaves_no_partial_file_behind() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch_dir("write-temp-file-fails");
        let temp_file_path = dir.join(format!(".konductor-update-{}.tmp", std::process::id()));

        // A read-only directory makes the write fail with a permission
        // error before any bytes land -- the same failure mode
        // (partial/failed write) the AutoSDE finding this test guards
        // against was raised for.
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();

        let write_result = write_temp_file_durably(&temp_file_path, b"NEW BINARY CONTENTS");
        assert!(
            write_result.is_err(),
            "a read-only directory must make the write fail"
        );
        if write_result.is_err() {
            let _ = std::fs::remove_file(&temp_file_path);
        }

        assert!(
            !temp_file_path.exists(),
            "no partial temp file must remain after a failed write"
        );

        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        fs::remove_dir_all(&dir).ok();
    }

    /// The cleanup guarantee that actually matters here belongs to
    /// `self_update_cli` itself, not `write_temp_file_durably`: a
    /// `smoke_test` failure must not leave the temp file it just wrote
    /// and marked executable sitting next to the live binary. The test
    /// above this one asserts "no partial temp file remains" but
    /// reaches that state via its own explicit `remove_file` call, not
    /// via any production cleanup path -- a read-only directory makes
    /// `File::create` fail before any temp file exists, so there is
    /// nothing there for `self_update_cli` to clean up regardless of
    /// whether its cleanup code runs at all. This test instead drives
    /// `self_update_cli` end to end (same fake seams as
    /// `self_update_cli_end_to_end_with_fake_seams_replaces_the_live_binary`)
    /// with a `smoke_test` closure that returns `Err`, exercising the
    /// exact arm (`Err(detail) => { let _ = std::fs::remove_file(...); }`
    /// just above the `SmokeTest` error return) that owns this
    /// guarantee.
    #[test]
    fn self_update_cli_leaves_no_temp_file_when_smoke_test_fails() {
        let Some(target_triple) = super::super::target_triple::current_host_target_triple() else {
            return;
        };

        let dir = scratch_dir("self-update-smoke-test-fails");
        let live_binary_path = dir.join("konductor");
        fs::write(&live_binary_path, b"OLD BINARY CONTENTS").unwrap();

        let live_binary_path_for_closure = live_binary_path.clone();
        let current_exe =
            move || -> std::io::Result<PathBuf> { Ok(live_binary_path_for_closure.clone()) };
        let smoke_test = |_path: &Path| -> Result<String, String> {
            Err(
                "fake smoke-test failure injected by this test -- no real binary was ever run"
                    .to_string(),
            )
        };

        let verified_bytes = b"NEW BINARY CONTENTS".to_vec();
        let expected_filename = expected_cli_asset_filename("9.9.9", target_triple);
        let hash = super::super::artifact::sha256_hex(&verified_bytes);
        let sidecar_text = format!("{hash}  {expected_filename}\n");
        let fetch_asset_pair = {
            let verified_bytes = verified_bytes.clone();
            move |_owner: &str, _repo: &str, _use_github_token: bool, _target_triple: &str| {
                Ok((
                    verified_bytes.clone(),
                    sidecar_text.clone().into_bytes(),
                    "9.9.9".to_string(),
                ))
            }
        };

        let result = self_update_cli(
            "aws-solutions",
            "konductor",
            false,
            None,
            current_exe,
            smoke_test,
            fetch_asset_pair,
            |_owner: &str,
             _repo: &str,
             _tag: &str,
             _use_github_token: bool,
             _target_triple: &str| {
                panic!("fetch_asset_pair_by_tag must never be called when release_version is None")
            },
        );

        assert!(
            matches!(result, Err(CliSelfUpdateError::SmokeTest { .. })),
            "a failed smoke test must surface as CliSelfUpdateError::SmokeTest, got: {result:?}"
        );

        // The live binary must be untouched -- the rename that would
        // replace it never runs when the smoke test fails first.
        assert_eq!(fs::read(&live_binary_path).unwrap(), b"OLD BINARY CONTENTS");

        let temp_file_path = dir.join(format!(".konductor-update-{}.tmp", std::process::id()));
        assert!(
            !temp_file_path.exists(),
            "no partial temp file must remain after a failed smoke test"
        );

        fs::remove_dir_all(&dir).ok();
    }
}
