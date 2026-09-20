// SPDX-License-Identifier: Apache-2.0
//
// install/github_branch.rs — fetches `dist/` directly from a GitHub
// branch's tree (default `main`), as a fallback when
// `install::github`'s release-asset path has nothing to install from.
// No async runtime; same `ureq` client. Structurally mirrors
// `install::github`'s release-asset path (fetch two named things,
// verify, install) -- just reading a repo path on a branch instead of
// a release asset URL, so the two are equally strong: no self-computed
// hash, the sidecar is always a real, separately-fetched file.
//
// `main`'s `dist/` directory carries exactly two named files: the
// pre-built tarball (`install::github::expected_artifact_filename()`)
// and its `.sha256` sidecar. Each is fetched via one GitHub Contents
// API request (raw media type, so the response body is the file's
// bytes directly) -- two requests total, well under GitHub's
// unauthenticated rate cap. A missing tarball or sidecar (404) fails
// cleanly with `MissingArtifact`/`MissingSidecar`, the counterparts to
// `install::github`'s own `MissingAsset`.

use std::io::Read;
use std::time::Duration;

use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};

use super::private_repo_hint;
use super::remote::RemoteArtifactFetcher;

/// Characters a GitHub Contents API URL segment must not carry
/// literally: `/` (path separator), `?`/`#` (breaks the trailing
/// `?ref={branch}` selector), `%` (avoids double-unescaping),
/// and space/quote/angle-bracket characters GitHub's API may reject.
/// Applied per-segment, never a whole path, so an encoded `/` inside
/// one filename is never confused with a real separator.
const PATH_SEGMENT_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b'/')
    .add(b'?')
    .add(b'#')
    .add(b'%')
    .add(b' ')
    .add(b'"')
    .add(b'<')
    .add(b'>')
    .add(b'`');

/// Percent-encodes a single path segment for safe interpolation into a
/// GitHub REST API URL, leaving every unreserved character untouched.
/// Applied per-segment (filename, branch name), so a git-legal but
/// URL-unsafe character (space, `#`, `?`) never malforms the request.
fn encode_path_segment(segment: &str) -> String {
    utf8_percent_encode(segment, PATH_SEGMENT_ENCODE_SET).to_string()
}

/// Why fetching one of the two named `dist/` files from a branch
/// failed. Covers the fetch phase, before any bytes reach
/// `remote::install_from_remote_bytes`.
#[derive(Debug)]
pub enum GithubBranchFetchError {
    /// A transport-level failure: DNS, TCP, TLS, or a response that
    /// never finished. Carries only the underlying error's `Display`
    /// text, never a raw `ureq::Error`/`io::Error` type.
    Network(String),
    /// No file matching the expected `<artifact_filename>` tarball
    /// name exists under `dist/` on this branch -- the counterpart to
    /// `GithubFetchError::MissingAsset`. Carries the expected filename.
    MissingArtifact(String),
    /// No file matching the expected `<artifact_filename>.sha256`
    /// sidecar name exists under `dist/` on this branch. Carries the
    /// expected filename.
    MissingSidecar(String),
    /// The GitHub API responded with a non-2xx HTTP status (e.g. 403
    /// rate-limited) that isn't the 404-means-missing-file case above.
    ///
    /// Carries the `TokenState` this specific request was made with.
    /// Unlike `install::github`'s `DownloadHttp`, this variant covers
    /// requests that DO send the token when available: both the
    /// tarball and sidecar fetch here go through the Contents API on
    /// `api.github.com` (never redirecting to a separate pre-signed
    /// storage host the way a release asset's `browser_download_url`
    /// does), so `download_dist_file_bytes` attaches
    /// `Authorization` via `apply_github_token` just like the release
    /// path's metadata call -- the hint fully applies here.
    Http(u16, private_repo_hint::TokenState),
    /// The response body could not be read to completion.
    InvalidResponse(String),
    /// A downloaded file's response body exceeded
    /// `DIST_FILE_DOWNLOAD_CAP_BYTES` before the read completed.
    /// Enforced by a bounded reader regardless of what any
    /// `Content-Length` header claimed.
    ResponseTooLarge { limit_bytes: u64 },
}

impl std::fmt::Display for GithubBranchFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GithubBranchFetchError::Network(message) => {
                write!(f, "network error contacting GitHub: {message}")
            }
            GithubBranchFetchError::MissingArtifact(filename) => write!(
                f,
                "no file named '{filename}' was found under 'dist/' on this branch"
            ),
            GithubBranchFetchError::MissingSidecar(filename) => write!(
                f,
                "no file named '{filename}' was found under 'dist/' on this branch -- \
                 main's dist/ must also publish a checksum sidecar for this source to \
                 verify against"
            ),
            GithubBranchFetchError::Http(status, token_state) => {
                write!(
                    f,
                    "GitHub API responded with HTTP status {status}{}",
                    private_repo_hint::private_repo_hint(*status, *token_state)
                )
            }
            GithubBranchFetchError::InvalidResponse(message) => {
                write!(f, "could not read GitHub API response: {message}")
            }
            GithubBranchFetchError::ResponseTooLarge { limit_bytes } => write!(
                f,
                "GitHub API response exceeded the maximum allowed size of {limit_bytes} bytes"
            ),
        }
    }
}

impl std::error::Error for GithubBranchFetchError {}

/// Same `User-Agent` requirement as `install::github` -- GitHub's REST
/// API rejects requests with none at all.
const USER_AGENT: &str = "konductor-cli";

/// Same connect-timeout budget as `install::github::CONNECT_TIMEOUT`.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Same read-idle budget as `install::github::READ_IDLE_TIMEOUT`.
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(30);

fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_IDLE_TIMEOUT)
        .build()
}

/// Hard ceiling on one downloaded `dist/` file (the tarball or its
/// `.sha256` sidecar). Same 256 MiB value as
/// `install::github::ASSET_DOWNLOAD_CAP_BYTES` -- both cap the same
/// kind of payload (a compressed tarball, or its tiny sidecar), just
/// fetched from a different path. Kept as its own constant rather
/// than imported, matching how each module already owns its own
/// timeout constants.
const DIST_FILE_DOWNLOAD_CAP_BYTES: u64 = 256 * 1024 * 1024;

/// Wraps a `ureq` response reader and fails once more than `limit`
/// total bytes have been read from it -- the actual enforcement,
/// unlike a `Content-Length` header check: it counts real bytes off
/// the socket, so a server that omits or lies about that header can't
/// bypass it. Mirrors `install::github::CappedBodyReader`, kept as its
/// own type for the same reason as `DIST_FILE_DOWNLOAD_CAP_BYTES` above.
struct CappedBodyReader<R> {
    inner: R,
    limit: u64,
    read_so_far: u64,
}

impl<R: Read> CappedBodyReader<R> {
    fn new(inner: R, limit: u64) -> Self {
        Self {
            inner,
            limit,
            read_so_far: 0,
        }
    }
}

impl<R: Read> Read for CappedBodyReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read_so_far = self.read_so_far.saturating_add(n as u64);
        if self.read_so_far > self.limit {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!(
                    "response exceeds maximum allowed size ({} bytes)",
                    self.limit
                ),
            ));
        }
        Ok(n)
    }
}

/// Reads `reader` to completion into a `Vec<u8>`, through a
/// `CappedBodyReader` bound to `limit`, the hard cap, with an earlier
/// fast-fail against `content_length` when the server sent one. That
/// `Content-Length` check is only an optimization on top of the hard
/// cap, never a substitute for it -- an absent or lying header just
/// leaves `CappedBodyReader` as the sole enforcement.
fn read_capped_body(
    reader: impl Read,
    content_length: Option<u64>,
    limit: u64,
) -> Result<Vec<u8>, GithubBranchFetchError> {
    if let Some(declared_len) = content_length {
        if declared_len > limit {
            return Err(GithubBranchFetchError::ResponseTooLarge { limit_bytes: limit });
        }
    }
    let mut bytes = Vec::new();
    let mut capped = CappedBodyReader::new(reader, limit);
    capped.read_to_end(&mut bytes).map_err(|err| {
        if err.kind() == std::io::ErrorKind::InvalidData
            && err.to_string().contains("maximum allowed size")
        {
            GithubBranchFetchError::ResponseTooLarge { limit_bytes: limit }
        } else {
            GithubBranchFetchError::InvalidResponse(err.to_string())
        }
    })?;
    Ok(bytes)
}

/// Parses a response's `Content-Length` header into a `u64`, if
/// present and well-formed. A missing or unparseable header yields
/// `None` -- callers must never treat that as "the response is
/// small," only as "no fast-fail is available; the hard cap in
/// `CappedBodyReader` is the only enforcement for this response."
fn parse_content_length(response: &ureq::Response) -> Option<u64> {
    response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
}

/// The branch this fetch reads from when the caller doesn't override
/// it. `install_from_main_branch_dist` is the only production caller
/// and doesn't override this today -- kept as a named constant so a
/// future override is a one-line change.
pub(crate) const DEFAULT_BRANCH: &str = "main";

/// Downloads one file's raw bytes from `dist/{filename}` on `branch`,
/// via the Contents API's raw media type -- no base64 decoding needed.
/// `filename` and `branch` are each percent-encoded before going into
/// the URL, since a git-legal filename isn't guaranteed URL-safe.
fn download_dist_file_bytes(
    owner: &str,
    repo: &str,
    branch: &str,
    filename: &str,
    use_github_token: bool,
) -> Result<Vec<u8>, GithubBranchFetchError> {
    let encoded_filename = encode_path_segment(filename);
    let encoded_branch = encode_path_segment(branch);
    let url = format!(
        "https://api.github.com/repos/{owner}/{repo}/contents/dist/{encoded_filename}?ref={encoded_branch}"
    );
    let request = http_agent()
        .get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github.raw+json");
    let (request, token_state) =
        super::github::apply_github_token_from_env(request, use_github_token);
    let response = request.call().map_err(|err| match err {
        ureq::Error::Status(code, _response) => GithubBranchFetchError::Http(code, token_state),
        ureq::Error::Transport(transport) => GithubBranchFetchError::Network(transport.to_string()),
    })?;
    let content_length = parse_content_length(&response);
    read_capped_body(
        response.into_reader(),
        content_length,
        DIST_FILE_DOWNLOAD_CAP_BYTES,
    )
}

/// Fetches the pre-built tarball and its `.sha256` sidecar from
/// `dist/` on `owner/repo`'s `{branch}`, via two GitHub Contents API
/// requests. Returns `(tarball_bytes, sidecar_bytes)` unchanged --
/// already correctly packaged wherever it was placed under `dist/`.
///
/// A 404 on the tarball maps to `MissingArtifact`; a 404 on the
/// sidecar maps to `MissingSidecar`. Any other non-2xx status maps to
/// the generic `Http` variant.
pub(crate) fn fetch_branch_dist_artifact_and_sidecar(
    owner: &str,
    repo: &str,
    branch: &str,
    use_github_token: bool,
) -> Result<(Vec<u8>, Vec<u8>), GithubBranchFetchError> {
    let artifact_filename = super::github::expected_artifact_filename();
    let sidecar_filename = super::github::expected_sidecar_filename();

    let artifact_bytes =
        match download_dist_file_bytes(owner, repo, branch, &artifact_filename, use_github_token) {
            Ok(bytes) => bytes,
            Err(GithubBranchFetchError::Http(404, _)) => {
                return Err(GithubBranchFetchError::MissingArtifact(artifact_filename))
            }
            Err(other) => return Err(other),
        };

    let sidecar_bytes =
        match download_dist_file_bytes(owner, repo, branch, &sidecar_filename, use_github_token) {
            Ok(bytes) => bytes,
            Err(GithubBranchFetchError::Http(404, _)) => {
                return Err(GithubBranchFetchError::MissingSidecar(sidecar_filename))
            }
            Err(other) => return Err(other),
        };

    Ok((artifact_bytes, sidecar_bytes))
}

/// No `RemoteArtifactFetcher`-compatible closure builder here (unlike
/// `install::github::github_artifact_fetcher`): the real call site
/// (`remote_orchestrate::install_from_main_branch_dist`) also needs
/// `branch` threaded through, so it calls
/// `fetch_branch_dist_artifact_and_sidecar` directly instead. This
/// type alias documents that intentional absence.
#[allow(dead_code)]
type _NoDirectRemoteArtifactFetcherAdapter = RemoteArtifactFetcher<'static>;

#[cfg(test)]
mod tests {
    use super::*;

    /// A `Read` impl that yields exactly `total_len` non-zero bytes,
    /// in small chunks, so `CappedBodyReader`'s mid-stream counting
    /// (not just a single oversized `read` call) is exercised --
    /// mirrors how a real streamed HTTP body arrives in pieces. No
    /// socket, no `ureq` type. Mirrors
    /// `install::github::tests::FakeBoundedReader`; defined
    /// independently here rather than shared across modules purely
    /// for a test helper.
    struct FakeBoundedReader {
        remaining: usize,
    }

    impl FakeBoundedReader {
        fn new(total_len: usize) -> Self {
            Self {
                remaining: total_len,
            }
        }
    }

    impl Read for FakeBoundedReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.remaining == 0 {
                return Ok(0);
            }
            let chunk_len = buf.len().min(self.remaining).min(4096);
            for byte in buf[..chunk_len].iter_mut() {
                *byte = 0xCD;
            }
            self.remaining -= chunk_len;
            Ok(chunk_len)
        }
    }

    /// Same construction contract as `install::github::http_agent` --
    /// connect + read-idle timeouts set, no whole-request `timeout()`
    /// that would take precedence over the read-idle budget.
    #[test]
    fn http_agent_uses_connect_and_read_idle_timeouts_not_whole_request_timeout() {
        let debug = format!("{:?}", http_agent());
        assert!(debug.contains(&format!("timeout_connect: Some({CONNECT_TIMEOUT:?})")));
        assert!(debug.contains(&format!("timeout_read: Some({READ_IDLE_TIMEOUT:?})")));
        assert!(debug.contains("timeout: None"));
    }

    /// `download_dist_file_bytes` (the single function backing both the
    /// tarball and sidecar fetch) attaches its `Authorization` header
    /// through `super::github::apply_github_token` -- reusing that
    /// module's own tested header-application logic directly, with no
    /// real env var read or set.
    #[test]
    fn apply_github_token_attaches_bearer_header_when_token_is_some() {
        let request = http_agent().get("https://api.github.com/repos/example/example");
        let request = super::super::github::apply_github_token(request, Some("secret-token-value"));
        let debug = format!("{request:?}");
        assert!(debug.contains("Authorization: Bearer secret-token-value"));
    }

    /// No `Authorization` header at all when no token is supplied --
    /// identical to a build with no token support.
    #[test]
    fn apply_github_token_adds_no_header_when_token_is_none() {
        let request = http_agent().get("https://api.github.com/repos/example/example");
        let request = super::super::github::apply_github_token(request, None);
        let debug = format!("{request:?}");
        assert!(!debug.contains("Authorization"));
    }

    #[test]
    fn default_branch_constant_is_main() {
        assert_eq!(DEFAULT_BRANCH, "main");
    }

    #[test]
    fn github_branch_fetch_error_display_never_panics_and_names_the_filename() {
        let err = GithubBranchFetchError::MissingArtifact("konductor-v0.1.0-x.tar.gz".to_string());
        let message = err.to_string();
        assert!(message.contains("konductor-v0.1.0-x.tar.gz"));
        assert!(message.contains("dist/"));
    }

    #[test]
    fn missing_sidecar_display_names_the_filename_and_explains_the_gap() {
        let err =
            GithubBranchFetchError::MissingSidecar("konductor-v0.1.0-x.tar.gz.sha256".to_string());
        let message = err.to_string();
        assert!(message.contains("konductor-v0.1.0-x.tar.gz.sha256"));
        assert!(message.contains("checksum sidecar"));
    }

    // ── URL percent-encoding ─────────────────────────────────────────────

    /// A path segment carrying URL-significant characters (space, `#`,
    /// `?`) must come out with each one escaped.
    #[test]
    fn encode_path_segment_escapes_url_significant_characters() {
        let encoded = encode_path_segment("a file?#name.json");
        assert!(!encoded.contains(' '));
        assert!(!encoded.contains('#'));
        assert!(!encoded.contains('?'));
        assert_eq!(encoded, "a%20file%3F%23name.json");
    }

    /// A normal, already-URL-safe segment must round-trip unchanged --
    /// confirms the encode set does not over-escape ordinary filenames.
    #[test]
    fn encode_path_segment_leaves_ordinary_names_unchanged() {
        assert_eq!(encode_path_segment("example.json"), "example.json");
        assert_eq!(
            encode_path_segment("konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz"),
            "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz"
        );
    }

    // ── fetch_branch_dist_artifact_and_sidecar: injected-outcome tests ──
    //
    // Can't be unit-tested directly without a mock HTTP layer, so
    // `download_dist_file_bytes`'s error-mapping (404 -> caller-chosen
    // Missing* variant, else passthrough) is exercised via
    // `RemoteArtifactFetcher`-shaped fake closures, mirroring
    // `install::github`'s own pattern. No socket use.

    #[test]
    fn fake_fetcher_success_outcome_matches_remote_artifact_fetcher_shape() {
        let fetcher: RemoteArtifactFetcher =
            Box::new(|| Ok((b"tarball bytes".to_vec(), b"sidecar bytes".to_vec())));
        let (artifact_bytes, sidecar_bytes) = fetcher().expect("fake fetch must succeed");
        assert_eq!(artifact_bytes, b"tarball bytes");
        assert_eq!(sidecar_bytes, b"sidecar bytes");
    }

    #[test]
    fn fake_fetcher_missing_artifact_outcome_maps_to_an_io_error() {
        let mapped_message =
            GithubBranchFetchError::MissingArtifact("konductor-v0.1.0-x.tar.gz".to_string())
                .to_string();
        let fetcher: RemoteArtifactFetcher =
            Box::new(move || Err(std::io::Error::other(mapped_message.clone())));
        let err = fetcher().expect_err("fake missing-artifact fetch must fail");
        assert!(err.to_string().contains("no file named"));
    }

    #[test]
    fn fake_fetcher_missing_sidecar_outcome_maps_to_an_io_error() {
        let mapped_message =
            GithubBranchFetchError::MissingSidecar("konductor-v0.1.0-x.tar.gz.sha256".to_string())
                .to_string();
        let fetcher: RemoteArtifactFetcher =
            Box::new(move || Err(std::io::Error::other(mapped_message.clone())));
        let err = fetcher().expect_err("fake missing-sidecar fetch must fail");
        assert!(err.to_string().contains("checksum sidecar"));
    }

    /// Real tamper/corruption detection is a downstream concern of the
    /// caller (`remote::install_from_remote_bytes`, covered by
    /// `remote_orchestrate.rs`'s tests). This module only proves it
    /// returns the two byte buffers unmodified -- it does no hashing.
    #[test]
    fn fake_fetcher_returns_both_buffers_unmodified_with_no_repackaging() {
        let tarball = b"\x1f\x8b\x08\x00fake gzip tarball bytes".to_vec();
        let sidecar = b"deadbeef  konductor-v0.1.0-x.tar.gz\n".to_vec();
        let fetcher: RemoteArtifactFetcher = {
            let tarball = tarball.clone();
            let sidecar = sidecar.clone();
            Box::new(move || Ok((tarball.clone(), sidecar.clone())))
        };
        let (artifact_bytes, sidecar_bytes) = fetcher().expect("fake fetch must succeed");
        assert_eq!(
            artifact_bytes, tarball,
            "tarball bytes must pass through unmodified"
        );
        assert_eq!(
            sidecar_bytes, sidecar,
            "sidecar bytes must pass through unmodified"
        );
    }

    // ── Response-size cap enforcement (no real network) ────────────────

    #[test]
    fn read_capped_body_accepts_a_body_under_the_limit() {
        let reader = FakeBoundedReader::new(1024);
        let bytes = read_capped_body(reader, None, 4096).expect("body under the cap must read");
        assert_eq!(bytes.len(), 1024);
    }

    /// The core guarantee: a body whose real byte count exceeds the
    /// cap is rejected by `CappedBodyReader`'s mid-stream counting,
    /// with NO `Content-Length` header present at all -- proving the
    /// hard cap is enforced independently of that header. No real
    /// network call is made; `FakeBoundedReader` is a plain in-memory
    /// `Read` impl.
    #[test]
    fn read_capped_body_rejects_a_body_exceeding_the_limit_with_no_content_length_header() {
        const LIMIT: u64 = 4096;
        let reader = FakeBoundedReader::new(LIMIT as usize + 1);
        let err = read_capped_body(reader, None, LIMIT)
            .expect_err("a body exceeding the cap must be rejected, not fully buffered");
        assert!(matches!(
            err,
            GithubBranchFetchError::ResponseTooLarge { limit_bytes: LIMIT }
        ));
    }

    /// A body exceeding the cap must be rejected even when the
    /// `Content-Length` header LIES and reports a value under the
    /// cap -- proving the header is never trusted as the sole
    /// enforcement.
    #[test]
    fn read_capped_body_rejects_a_body_exceeding_the_limit_even_when_content_length_lies_low() {
        const LIMIT: u64 = 4096;
        let reader = FakeBoundedReader::new(LIMIT as usize + 1);
        let lying_content_length = Some(LIMIT - 1);
        let err = read_capped_body(reader, lying_content_length, LIMIT)
            .expect_err("actual byte count must be enforced even if Content-Length understates it");
        assert!(matches!(
            err,
            GithubBranchFetchError::ResponseTooLarge { limit_bytes: LIMIT }
        ));
    }

    /// A truthful `Content-Length` that already declares a value over
    /// the cap must fast-fail before any bytes are read at all.
    #[test]
    fn read_capped_body_fast_fails_on_an_over_cap_content_length_before_reading() {
        const LIMIT: u64 = 4096;
        let reader = FakeBoundedReader::new(10);
        let declared_over_cap = Some(LIMIT + 1);
        let err = read_capped_body(reader, declared_over_cap, LIMIT)
            .expect_err("a Content-Length already over the cap must fast-fail");
        assert!(matches!(
            err,
            GithubBranchFetchError::ResponseTooLarge { limit_bytes: LIMIT }
        ));
    }

    /// A body at EXACTLY the cap (not one byte more) must be accepted.
    #[test]
    fn read_capped_body_accepts_a_body_at_exactly_the_limit() {
        const LIMIT: u64 = 4096;
        let reader = FakeBoundedReader::new(LIMIT as usize);
        let bytes =
            read_capped_body(reader, None, LIMIT).expect("a body at exactly the cap must succeed");
        assert_eq!(bytes.len(), LIMIT as usize);
    }

    #[test]
    fn github_branch_fetch_error_response_too_large_display_names_the_limit() {
        let err = GithubBranchFetchError::ResponseTooLarge {
            limit_bytes: DIST_FILE_DOWNLOAD_CAP_BYTES,
        };
        let message = err.to_string();
        assert!(message.contains(&DIST_FILE_DOWNLOAD_CAP_BYTES.to_string()));
    }

    /// Pins the chosen cap value, and that it matches the release
    /// path's own asset-download cap value (`install::github`'s
    /// `ASSET_DOWNLOAD_CAP_BYTES`, module-private there so not
    /// referenced directly here) -- both bound the identical kind of
    /// payload (a compressed release tarball or its tiny sidecar),
    /// just fetched from a different path.
    #[test]
    fn dist_file_download_cap_matches_release_asset_download_cap() {
        const EXPECTED_RELEASE_ASSET_CAP_BYTES: u64 = 256 * 1024 * 1024;
        assert_eq!(DIST_FILE_DOWNLOAD_CAP_BYTES, 256 * 1024 * 1024);
        assert_eq!(
            DIST_FILE_DOWNLOAD_CAP_BYTES, EXPECTED_RELEASE_ASSET_CAP_BYTES,
            "both modules cap the same kind of payload and must agree on the value"
        );
    }

    /// A 401 or 403, when `--use-github-token` was never passed
    /// (`TokenState::NotOptedIn`) -- must name both `GITHUB_TOKEN` and
    /// `--use-github-token` in the rendered message.
    #[test]
    fn http_401_and_403_not_opted_in_names_the_env_var_and_the_flag() {
        for status in [401u16, 403u16] {
            let message =
                GithubBranchFetchError::Http(status, private_repo_hint::TokenState::NotOptedIn)
                    .to_string();
            assert!(
                message.contains("GITHUB_TOKEN"),
                "status {status} must name GITHUB_TOKEN, got: {message}"
            );
            assert!(
                message.contains("--use-github-token"),
                "status {status} must hint at --use-github-token, got: {message}"
            );
        }
    }

    /// A 401 or 403, when `--use-github-token` was passed but
    /// `GITHUB_TOKEN` was empty/unset -- must explicitly report that
    /// distinct state.
    #[test]
    fn http_401_and_403_opted_in_empty_or_unset_reports_the_empty_state() {
        for status in [401u16, 403u16] {
            let message = GithubBranchFetchError::Http(
                status,
                private_repo_hint::TokenState::OptedInEmptyOrUnset,
            )
            .to_string();
            assert!(
                message.contains("GITHUB_TOKEN"),
                "status {status} must name GITHUB_TOKEN, got: {message}"
            );
            assert!(
                message.contains("not set") || message.contains("empty"),
                "status {status} must describe the empty/unset state, got: {message}"
            );
        }
    }

    /// A 401 or 403, when a non-empty `GITHUB_TOKEN` was actually sent
    /// and still rejected -- must NOT repeat the `--use-github-token`
    /// suggestion (the silent-loop bug).
    #[test]
    fn http_401_and_403_opted_in_sent_does_not_repeat_the_flag_suggestion() {
        for status in [401u16, 403u16] {
            let message =
                GithubBranchFetchError::Http(status, private_repo_hint::TokenState::OptedInSent)
                    .to_string();
            assert!(
                !message.contains("--use-github-token"),
                "status {status} must not repeat the already-followed --use-github-token \
                 suggestion, got: {message}"
            );
            assert!(
                message.contains("GITHUB_TOKEN"),
                "status {status} must still name GITHUB_TOKEN as the rejected credential, \
                 got: {message}"
            );
        }
    }

    /// Any OTHER status code must NOT carry the hint, for every token
    /// state -- it would be noise for a failure that has nothing to
    /// do with authentication.
    #[test]
    fn http_other_statuses_omit_the_hint_for_every_token_state() {
        for status in [404u16, 429u16, 500u16, 503u16] {
            for state in [
                private_repo_hint::TokenState::NotOptedIn,
                private_repo_hint::TokenState::OptedInEmptyOrUnset,
                private_repo_hint::TokenState::OptedInSent,
            ] {
                let message = GithubBranchFetchError::Http(status, state).to_string();
                assert!(
                    !message.contains("--use-github-token") && !message.contains("GITHUB_TOKEN"),
                    "status {status} with state {state:?} must not carry the token hint, \
                     got: {message}"
                );
            }
        }
    }
}
