// SPDX-License-Identifier: Apache-2.0
//
// install/artifact.rs — GitHub Release dist tarball fetch + SHA-256
// verification (Rust implementation, task 3.1).
//
// ── Scope ────────────────────────────────────────────────────────────────
// Verification (`verify_sha256`) is a pure function over local bytes, so
// it is unit-testable with no network access. The network fetch itself
// lives behind `ArtifactFetcher` (a boxed closure seam) so tests can
// supply a fake fetcher instead of hitting a real GitHub Release -- no
// test in this codebase may depend on network access.
//
// Verification here establishes integrity against corruption and partial
// re-upload: the fetched bytes match the digest recorded for them. It
// does not establish authenticity against replacement of both the
// artifact and its checksum, since both can originate from the same
// mutable source.

use std::path::Path;

use sha2::{Digest, Sha256};

/// Raised when a fetched artifact's SHA-256 doesn't match what we
/// expected. A runtime failure, not a usage error -- callers must map
/// it to `EXIT_VERIFY_FAILED` (65), never `EXIT_USAGE_ERROR` (64) or
/// exit code 2. Returned wrapped in `RemoteInstallError::VerifyChecksum`
/// by `remote::verify_artifact_pair`, reached in production from
/// `dispatch_install_with`'s no-`--from` branch. `--from` installs
/// still verify nothing (no committed sidecar to check against).
#[derive(Debug)]
pub struct VerificationError {
    pub expected: String,
    pub actual: String,
}

impl std::fmt::Display for VerificationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "checksum verification failed: expected sha256:{}, got sha256:{}",
            self.expected, self.actual
        )
    }
}

impl std::error::Error for VerificationError {}

/// A downloaded (or locally-supplied) dist tarball's bytes, plus the
/// checksum it was verified against. Built by `verify_sha256`/
/// `remote::verify_artifact_pair` -- see `VerificationError`'s doc
/// comment above for the call path. `sha256` is always filled in but
/// only read by this module's own tests, since the live call path only
/// needs `data`.
#[derive(Debug)]
pub struct FetchedArtifact {
    pub data: Vec<u8>,
    #[allow(dead_code)]
    pub sha256: String,
}

/// Lowercase hex SHA-256 digest of `data`. Single source of truth for
/// this encoding so every call site (verification, manifest hashing)
/// agrees on case.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Verifies `data` against `expected_sha256` (case-insensitive; we
/// always store/report a lowercase hex digest). Pure function, no I/O
/// -- testable directly against a local file's bytes with no network
/// access needed. `remote::verify_artifact_pair` calls this directly,
/// and it's reached in production from `dispatch_install_with`'s
/// no-`--from` branch -- see `VerificationError`'s doc comment above
/// for the full path.
///
/// Returns `Err(VerificationError)` on mismatch.
pub fn verify_sha256(
    data: Vec<u8>,
    expected_sha256: &str,
) -> Result<FetchedArtifact, VerificationError> {
    let actual = sha256_hex(&data);
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err(VerificationError {
            expected: expected_sha256.to_string(),
            actual,
        });
    }
    Ok(FetchedArtifact {
        data,
        sha256: actual,
    })
}

/// Seam for the network fetch: a boxed closure returning the
/// artifact's raw bytes (or an I/O error). Tests supply a fake with
/// fixed bytes; no network access needed. The real production fetch
/// (`github::fetch_latest_release_artifact_and_mcp_asset`) doesn't use
/// this seam -- it fetches over HTTP directly, and verification
/// happens in `remote::verify_artifact_pair`, which calls
/// `verify_sha256`/`parse_sidecar` directly rather than going through
/// `fetch_and_verify` below. This alias and `fetch_and_verify` exist
/// only to test `verify_sha256` against an injected fetch closure.
#[allow(dead_code)]
pub type ArtifactFetcher<'a> = Box<dyn Fn() -> std::io::Result<Vec<u8>> + 'a>;

/// Reads a local dist tarball's bytes. Test-only: this module's own
/// tests use it as a fake `ArtifactFetcher`. The real production fetch
/// (`github::fetch_latest_release_artifact_and_mcp_asset`) reads bytes
/// over HTTP, not from a local file.
#[allow(dead_code)]
pub fn fetch_local_file(path: &Path) -> std::io::Result<Vec<u8>> {
    std::fs::read(path)
}

/// Runs `fetcher()` to get the artifact's bytes, then verifies them
/// against `expected_sha256`. Returns `Err(FetchAndVerifyError::Fetch)`
/// if the fetcher itself fails (different from a verification
/// failure); `Err(FetchAndVerifyError::Verify)` on a checksum mismatch.
/// Test-only helper that pairs `ArtifactFetcher` with `verify_sha256`
/// -- the real production call path (`remote::verify_artifact_pair`)
/// calls `verify_sha256`/`parse_sidecar` directly instead.
#[allow(dead_code)]
pub fn fetch_and_verify(
    fetcher: &ArtifactFetcher,
    expected_sha256: &str,
) -> Result<FetchedArtifact, FetchAndVerifyError> {
    let data = fetcher().map_err(FetchAndVerifyError::Fetch)?;
    verify_sha256(data, expected_sha256).map_err(FetchAndVerifyError::Verify)
}

/// Distinguishes a fetch failure (I/O/network) from a verification
/// failure (checksum mismatch) -- callers map only `Verify` to
/// `EXIT_VERIFY_FAILED` (65); `Fetch` maps to `EXIT_USAGE_ERROR` (64).
/// Test-only: the real production fetch/verify path
/// (`remote_orchestrate`/`remote::verify_artifact_pair`) uses its own
/// `RemoteOrchestrationError`/`RemoteInstallError` enums instead,
/// because the real fetch failure type is `github::GithubFetchError`,
/// not `std::io::Error`.
#[derive(Debug)]
#[allow(dead_code)]
pub enum FetchAndVerifyError {
    Fetch(std::io::Error),
    Verify(VerificationError),
}

impl std::fmt::Display for FetchAndVerifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchAndVerifyError::Fetch(err) => write!(f, "artifact fetch failed: {err}"),
            FetchAndVerifyError::Verify(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for FetchAndVerifyError {}

/// A parsed `sha256sum`-format sidecar line: `<hash>  <filename>` (two
/// spaces). `hash` is the raw hex text as found -- callers compare it
/// case-insensitively, same as `verify_sha256` does. `parse_sidecar`
/// builds and returns this, and `remote::verify_artifact_pair` calls it
/// directly in production -- see `VerificationError`'s doc comment
/// above for the call path.
#[derive(Debug, PartialEq, Eq)]
pub struct SidecarEntry {
    pub hash: String,
    pub filename: String,
}

/// Why a sidecar's content couldn't be parsed, or didn't match the
/// artifact it's supposed to accompany. `remote::verify_artifact_pair`
/// returns this wrapped in `RemoteInstallError::VerifySidecar`, reached
/// in production from `dispatch_install_with`'s no-`--from` branch via
/// `remote_orchestrate::install_from_latest_github_release`.
#[derive(Debug, PartialEq, Eq)]
pub enum SidecarError {
    Empty,
    Malformed,
    WrongDigestLength(usize),
    FilenameMismatch { expected: String, found: String },
}

impl std::fmt::Display for SidecarError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SidecarError::Empty => write!(f, "sidecar file is empty"),
            SidecarError::Malformed => {
                write!(f, "sidecar line is not in '<hash>  <filename>' format")
            }
            SidecarError::WrongDigestLength(len) => {
                write!(f, "sidecar digest has {len} hex characters, expected 64")
            }
            SidecarError::FilenameMismatch { expected, found } => {
                write!(f, "sidecar names '{found}', expected '{expected}'")
            }
        }
    }
}

impl std::error::Error for SidecarError {}

const SHA256_HEX_LEN: usize = 64;

/// Parses a `sha256sum`-format sidecar's contents (`<hash>  <filename>`,
/// two spaces, one line) and checks it names `expected_filename`. Pure
/// function, no I/O. `remote::verify_artifact_pair` calls this
/// directly, and it's reached in production from
/// `dispatch_install_with`'s no-`--from` branch -- see
/// `VerificationError`'s doc comment above for the full call path.
pub fn parse_sidecar(
    contents: &str,
    expected_filename: &str,
) -> Result<SidecarEntry, SidecarError> {
    let line = contents.lines().next().ok_or(SidecarError::Empty)?;
    if line.is_empty() {
        return Err(SidecarError::Empty);
    }
    let (hash, filename) = line.split_once("  ").ok_or(SidecarError::Malformed)?;
    if hash.is_empty() || filename.is_empty() || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(SidecarError::Malformed);
    }
    if hash.len() != SHA256_HEX_LEN {
        return Err(SidecarError::WrongDigestLength(hash.len()));
    }
    if filename != expected_filename {
        return Err(SidecarError::FilenameMismatch {
            expected: expected_filename.to_string(),
            found: filename.to_string(),
        });
    }
    Ok(SidecarEntry {
        hash: hash.to_string(),
        filename: filename.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-artifact-test-{name}-{}-{}",
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
    fn verify_sha256_succeeds_on_matching_checksum() {
        let data = b"hello world".to_vec();
        let expected = sha256_hex(&data);
        let artifact = verify_sha256(data.clone(), &expected).expect("must verify");
        assert_eq!(artifact.sha256, expected);
        assert_eq!(artifact.data, data);
    }

    #[test]
    fn verify_sha256_is_case_insensitive() {
        let data = b"hello world".to_vec();
        let expected = sha256_hex(&data).to_uppercase();
        let artifact = verify_sha256(data.clone(), &expected).expect("must verify");
        assert_eq!(artifact.sha256, sha256_hex(&data));
    }

    #[test]
    fn verify_sha256_fails_on_mismatch() {
        let err = verify_sha256(b"hello world".to_vec(), &"0".repeat(64))
            .expect_err("mismatch must fail");
        assert_eq!(err.expected, "0".repeat(64));
        assert_eq!(err.actual, sha256_hex(b"hello world"));
    }

    #[test]
    fn fetch_and_verify_uses_no_network_seam() {
        let dir = scratch_dir("no-network");
        let file_path = dir.join("artifact.bin");
        fs::write(&file_path, b"artifact contents").unwrap();

        let fetcher: ArtifactFetcher = Box::new(move || fetch_local_file(&file_path));
        let artifact = fetch_and_verify(&fetcher, &sha256_hex(b"artifact contents"))
            .expect("must fetch and verify");
        assert_eq!(artifact.data, b"artifact contents");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fetch_and_verify_returns_verify_error_on_mismatch() {
        let dir = scratch_dir("mismatch");
        let file_path = dir.join("artifact.bin");
        fs::write(&file_path, b"artifact contents").unwrap();

        let fetcher: ArtifactFetcher = Box::new(move || fetch_local_file(&file_path));
        let err = fetch_and_verify(&fetcher, &"0".repeat(64)).expect_err("must fail");
        assert!(matches!(err, FetchAndVerifyError::Verify(_)));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sha256_hex_is_lowercase_and_64_chars() {
        let digest = sha256_hex(b"anything");
        assert_eq!(digest, digest.to_lowercase());
        assert_eq!(digest.len(), 64);
    }

    #[test]
    fn parse_sidecar_accepts_well_formed_line() {
        let hash = "a".repeat(64);
        let contents = format!("{hash}  konductor-v1.2.0-x86_64-unknown-linux-gnu.tar.gz\n");
        let entry = parse_sidecar(
            &contents,
            "konductor-v1.2.0-x86_64-unknown-linux-gnu.tar.gz",
        )
        .expect("well-formed sidecar must parse");
        assert_eq!(entry.hash, hash);
        assert_eq!(
            entry.filename,
            "konductor-v1.2.0-x86_64-unknown-linux-gnu.tar.gz"
        );
    }

    #[test]
    fn parse_sidecar_rejects_empty_file() {
        let err = parse_sidecar("", "artifact.tar.gz").expect_err("empty sidecar must fail");
        assert_eq!(err, SidecarError::Empty);
    }

    #[test]
    fn parse_sidecar_rejects_blank_first_line() {
        let err = parse_sidecar("\nsomething\n", "artifact.tar.gz")
            .expect_err("blank first line must fail");
        assert_eq!(err, SidecarError::Empty);
    }

    #[test]
    fn parse_sidecar_rejects_single_space_separator() {
        let hash = "a".repeat(64);
        let contents = format!("{hash} artifact.tar.gz\n");
        let err = parse_sidecar(&contents, "artifact.tar.gz")
            .expect_err("single-space separator must fail");
        assert_eq!(err, SidecarError::Malformed);
    }

    #[test]
    fn parse_sidecar_rejects_non_hex_digest() {
        let hash = "z".repeat(64);
        let contents = format!("{hash}  artifact.tar.gz\n");
        let err =
            parse_sidecar(&contents, "artifact.tar.gz").expect_err("non-hex digest must fail");
        assert_eq!(err, SidecarError::Malformed);
    }

    #[test]
    fn parse_sidecar_rejects_wrong_length_digest() {
        let hash = "a".repeat(63);
        let contents = format!("{hash}  artifact.tar.gz\n");
        let err =
            parse_sidecar(&contents, "artifact.tar.gz").expect_err("wrong-length digest must fail");
        assert_eq!(err, SidecarError::WrongDigestLength(63));
    }

    #[test]
    fn parse_sidecar_rejects_filename_mismatch() {
        let hash = "a".repeat(64);
        let contents = format!("{hash}  other-file.tar.gz\n");
        let err =
            parse_sidecar(&contents, "artifact.tar.gz").expect_err("filename mismatch must fail");
        assert_eq!(
            err,
            SidecarError::FilenameMismatch {
                expected: "artifact.tar.gz".to_string(),
                found: "other-file.tar.gz".to_string(),
            }
        );
    }

    #[test]
    fn parse_sidecar_digest_comparable_case_insensitively() {
        let hash = "ABCD".to_string() + &"a".repeat(60);
        let contents = format!("{hash}  artifact.tar.gz\n");
        let entry =
            parse_sidecar(&contents, "artifact.tar.gz").expect("mixed-case digest must parse");
        assert!(entry.hash.eq_ignore_ascii_case(&hash));
    }

    #[test]
    fn parse_sidecar_bare_cr_is_not_a_line_boundary() {
        let hash = "a".repeat(64);
        let contents = format!("{hash}  artifact.tar.gz\r");
        let err = parse_sidecar(&contents, "artifact.tar.gz")
            .expect_err("trailing bare CR must be treated as part of the filename");
        assert_eq!(
            err,
            SidecarError::FilenameMismatch {
                expected: "artifact.tar.gz".to_string(),
                found: "artifact.tar.gz\r".to_string(),
            }
        );
    }
}

/// Test fixture (see `tests/fixtures/sidecar_cases.json`) so sidecar
/// parsing is pinned from one source of truth rather than
/// hand-duplicated literals.
#[cfg(test)]
mod shared_fixture {
    use super::*;

    const SHARED_FIXTURE_JSON: &str = include_str!("../../../tests/fixtures/sidecar_cases.json");

    fn error_kind(err: &SidecarError) -> &'static str {
        match err {
            SidecarError::Empty => "empty",
            SidecarError::Malformed => "malformed",
            SidecarError::WrongDigestLength(_) => "wrong_digest_length",
            SidecarError::FilenameMismatch { .. } => "filename_mismatch",
        }
    }

    #[test]
    fn shared_fixture_cases_parse_as_expected() {
        let doc: serde_json::Value =
            serde_json::from_str(SHARED_FIXTURE_JSON).expect("shared fixture must be valid JSON");
        let cases = doc["cases"]
            .as_array()
            .expect("fixture must have a 'cases' array");
        assert!(!cases.is_empty(), "fixture must declare at least one case");

        for case in cases {
            let name = case["name"].as_str().unwrap();
            let contents = case["contents"].as_str().unwrap();
            let expected_filename = case["expected_filename"].as_str().unwrap();
            let expected_hash = case["expected"]["hash"].as_str().unwrap();
            let expected_name = case["expected"]["filename"].as_str().unwrap();

            let entry = parse_sidecar(contents, expected_filename)
                .unwrap_or_else(|err| panic!("[fixture:{name}] expected parse to succeed: {err}"));
            assert_eq!(entry.hash, expected_hash, "[fixture:{name}] hash mismatch");
            assert_eq!(
                entry.filename, expected_name,
                "[fixture:{name}] filename mismatch"
            );
        }
    }

    #[test]
    fn shared_fixture_error_cases_are_rejected_with_expected_kind() {
        let doc: serde_json::Value =
            serde_json::from_str(SHARED_FIXTURE_JSON).expect("shared fixture must be valid JSON");
        let cases = doc["error_cases"]
            .as_array()
            .expect("fixture must have an 'error_cases' array");
        assert!(
            !cases.is_empty(),
            "fixture must declare at least one error case"
        );

        for case in cases {
            let name = case["name"].as_str().unwrap();
            let contents = case["contents"].as_str().unwrap();
            let expected_filename = case["expected_filename"].as_str().unwrap();
            let expected_kind = case["expected"]["error_kind"].as_str().unwrap();

            match parse_sidecar(contents, expected_filename) {
                Ok(_) => panic!("[fixture:{name}] expected parse_sidecar to fail"),
                Err(err) => assert_eq!(
                    error_kind(&err),
                    expected_kind,
                    "[fixture:{name}] error_kind mismatch"
                ),
            }
        }
    }
}
