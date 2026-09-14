// SPDX-License-Identifier: Apache-2.0
//
// install/github.rs — fetches the latest GitHub Release's dist
// artifact and its `.sha256` sidecar as raw bytes, over a synchronous
// (`ureq`) HTTP client. No async runtime.
//
// Expects release assets in the shape `synth::artifact_filename()`
// defines (per-platform tarball + `.sha256` sidecar). Today's
// `.github/workflows/release.yml` instead zips all of `dist/` into one
// fixed-name `konductor-release.zip` with no sidecar, so
// `fetch_latest_github_release_artifact` reliably fails with
// `GithubFetchError::MissingAsset` until that pipeline is fixed.
// Expected, not a bug here.
//
// No closure-based test seam of its own; a caller needing one supplies
// a fake `RemoteArtifactFetcher`. This module's own tests exercise the
// pure filename/URL-matching logic and never open a socket.

use std::io::Read;
use std::time::Duration;

use super::remote::RemoteArtifactFetcher;

/// GitHub API response shapes this module reads. Deliberately narrow:
/// only the fields needed to locate an asset by exact filename are
/// modeled.
mod api {
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    pub struct Release {
        /// Kept for API-shape completeness (documents what GitHub's
        /// response actually carries) even though no current caller
        /// reads it -- only `assets` is consumed today.
        #[allow(dead_code)]
        pub tag_name: String,
        #[serde(default)]
        pub assets: Vec<Asset>,
    }

    #[derive(Debug, Deserialize)]
    pub struct Asset {
        pub name: String,
        pub browser_download_url: String,
    }
}

/// Why fetching the latest release's artifact and sidecar failed.
/// Covers the network/API-resolution phase, before any bytes reach
/// `remote::install_from_remote_bytes`.
#[derive(Debug)]
pub enum GithubFetchError {
    /// A transport-level failure: DNS, TCP, TLS, or a response that
    /// never finished. Carries only the underlying error's `Display`
    /// text, never a raw `ureq::Error`/`io::Error` type.
    Network(String),
    /// The release metadata parsed fine, but no asset exactly matched
    /// the expected artifact or sidecar filename -- the expected
    /// outcome against today's `release.yml` (see top-of-file comment).
    MissingAsset(String),
    /// The `GET .../releases/latest` metadata call responded with a
    /// non-2xx HTTP status (404 = no release published, 403 =
    /// rate-limited, etc). The ONLY variant that means "nothing usable
    /// here" for fallback purposes: a 404 here proves no release
    /// exists to fall back away from.
    MetadataHttp(u16),
    /// The asset-download request responded with a non-2xx HTTP
    /// status, after a matching asset URL was already resolved. Kept
    /// distinct from `MetadataHttp`: here the release and asset both
    /// exist but the resolved (short-lived, pre-signed) download URL
    /// is broken/expired -- a real failure, never fallback-eligible.
    DownloadHttp(u16),
    /// The response body wasn't valid JSON, or didn't match the
    /// subset of the release-metadata shape this module reads.
    InvalidResponse(String),
    /// A response body (release metadata or asset download) exceeded
    /// its size cap (`METADATA_RESPONSE_CAP_BYTES` or
    /// `ASSET_DOWNLOAD_CAP_BYTES`) before the read completed. Enforced
    /// by `CappedBodyReader` regardless of what any `Content-Length`
    /// header claimed -- this is the only variant that means "a
    /// server sent more than we were ever willing to buffer."
    ResponseTooLarge { limit_bytes: u64 },
}

/// Self-diagnosis suffix appended to an HTTP-status error message when
/// `status` is specifically 401 or 403 -- the exact codes a private
/// repository without a token produces. Names the `--use-github-token`
/// flag directly, so a caller hitting one of these two hard-to-diagnose
/// statuses sees a concrete next step rather than a bare status code.
/// Empty for every other status, so an unrelated failure (404, 500,
/// etc) stays exactly as plain as it always has been.
fn private_repo_hint(status: u16) -> &'static str {
    match status {
        401 | 403 => " -- if this repository is private, consider passing --use-github-token",
        _ => "",
    }
}

impl std::fmt::Display for GithubFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GithubFetchError::Network(message) => {
                write!(f, "network error contacting GitHub: {message}")
            }
            GithubFetchError::MissingAsset(filename) => write!(
                f,
                "no release asset named '{filename}' was found on the latest GitHub release"
            ),
            GithubFetchError::MetadataHttp(status) => {
                write!(
                    f,
                    "GitHub API responded with HTTP status {status} while fetching release metadata{}",
                    private_repo_hint(*status)
                )
            }
            GithubFetchError::DownloadHttp(status) => {
                write!(
                    f,
                    "GitHub API responded with HTTP status {status} while downloading a release asset{}",
                    private_repo_hint(*status)
                )
            }
            GithubFetchError::InvalidResponse(message) => {
                write!(f, "could not parse GitHub API response: {message}")
            }
            GithubFetchError::ResponseTooLarge { limit_bytes } => write!(
                f,
                "GitHub API response exceeded the maximum allowed size of {limit_bytes} bytes"
            ),
        }
    }
}

impl std::error::Error for GithubFetchError {}

/// User-Agent header value sent on every GitHub API request. GitHub's
/// REST API rejects requests with no `User-Agent` header at all, so
/// this is not optional -- see
/// <https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api#user-agent-required>.
const USER_AGENT: &str = "konductor-cli";

/// Budget for establishing the TCP/TLS connection. `ureq`'s bare
/// `ureq::get(...)` runs with no read timeout at all, which would
/// otherwise block `konductor install` forever with no feedback on a
/// stalled connection. Connecting to GitHub should be fast, so this is
/// intentionally short -- a hung connection attempt gets a bounded,
/// visible failure quickly.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Budget between individual socket reads while a response body
/// streams in, not a ceiling on the transfer as a whole. Covers both
/// the small metadata call and the multi-MB asset download, so a
/// slow-but-progressing transfer isn't cut off by one fixed deadline.
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/// Shared `ureq::Agent` every request in this module issues through,
/// so the timeouts above apply uniformly. Uses `timeout_connect`/
/// `timeout_read` rather than `timeout()` (which bounds the whole
/// request) so a large download isn't cut off by a deadline sized for
/// the small metadata call.
fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_IDLE_TIMEOUT)
        .build()
}

/// Conditionally attaches a GitHub API bearer token to an
/// already-built request. When `token` is `Some`, adds
/// `Authorization: Bearer <token>`; when `None`, returns `request`
/// unchanged -- no header, byte-for-byte identical to an unauthenticated
/// call.
///
/// This is an ACCESS mechanism, not a rate-limit workaround: it exists
/// so `konductor install` can reach a currently-private repository
/// during development/testing. It is unrelated to GitHub's
/// unauthenticated rate limits, which this codebase's request volume
/// (2-3 requests per install) already comfortably fits under.
///
/// Takes the token as a parameter rather than reading
/// `std::env::var` itself, so tests can exercise both branches
/// (`Some`/`None`) directly without touching real process environment
/// state. See `github_token_from_env` for the thin wrapper that reads
/// the actual environment at the real call sites.
pub(crate) fn apply_github_token(request: ureq::Request, token: Option<&str>) -> ureq::Request {
    match token {
        Some(token) => request.set("Authorization", &format!("Bearer {token}")),
        None => request,
    }
}

/// Reads `GITHUB_TOKEN` fresh from the process environment (never
/// cached) when `use_token` is `true`, treating an unset or empty
/// value as "no token" -- the same outcome as if the variable didn't
/// exist at all. Called at each real GitHub API call site immediately
/// before the request is sent, so a change to the environment between
/// calls is always picked up.
///
/// `use_token` gates this at the source: `GITHUB_TOKEN` is an opt-in
/// mechanism (`konductor install --use-github-token`), not something
/// read just because it happens to be set in the caller's shell. When
/// `false`, this returns `None` immediately WITHOUT calling
/// `std::env::var` at all -- the short-circuit happens before any
/// environment access, not after, so "the flag is off" and "the
/// variable doesn't exist" are indistinguishable all the way down to
/// the syscall level.
///
/// `pub(crate)` so `install::github_branch`'s own call site reuses
/// this exact read instead of duplicating it.
pub(crate) fn github_token_from_env(use_token: bool) -> Option<String> {
    if !use_token {
        return None;
    }
    std::env::var("GITHUB_TOKEN")
        .ok()
        .filter(|token| !token.is_empty())
}

/// Hard ceiling on the release-metadata JSON response
/// (`fetch_latest_release_metadata`). This response is just a handful
/// of fields (tag name, a short asset list) -- GitHub's real payload
/// for a dozen platform assets runs a few KB. 8 MiB is many orders of
/// magnitude beyond any legitimate size, while still small enough that
/// buffering up to the cap is never itself a memory concern.
const METADATA_RESPONSE_CAP_BYTES: u64 = 8 * 1024 * 1024;

/// Hard ceiling on a downloaded release asset (`download_asset_bytes`)
/// -- the compressed tarball or its `.sha256` sidecar. Same 256 MiB
/// value as `install::remote::MAX_UNPACKED_BYTES`, the existing cap on
/// the archive's DECOMPRESSED size: a compressed tarball can never be
/// larger than what it decompresses to, so a compressed download that
/// reaches this cap is already far outside what a real `dist/`
/// artifact could be (a real tree is a few MB; 256 MiB is over 100x
/// that). Kept as its own constant rather than importing the private
/// `remote::MAX_UNPACKED_BYTES` -- the two share this value on
/// purpose, not by coincidence.
const ASSET_DOWNLOAD_CAP_BYTES: u64 = 256 * 1024 * 1024;

/// Wraps a `ureq` response reader and fails once more than `limit`
/// total bytes have been read from it, so a malicious or misconfigured
/// server (or a hijacked redirect) can never buffer an unbounded body
/// into memory before verification runs. This is the real enforcement
/// -- unlike a `Content-Length` check, it can't be bypassed by a
/// server that omits or lies about that header, since it counts bytes
/// as they're actually read off the socket.
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
/// fast-fail against `content_length` when the server sent one: a
/// response that already declares a length over the cap is rejected
/// before any bytes are read. That `Content-Length` check is only an
/// optimization on top of the hard cap, never a substitute for it --
/// an absent or lying header just leaves `CappedBodyReader` as the
/// sole enforcement.
fn read_capped_body(
    reader: impl Read,
    content_length: Option<u64>,
    limit: u64,
) -> Result<Vec<u8>, GithubFetchError> {
    if let Some(declared_len) = content_length {
        if declared_len > limit {
            return Err(GithubFetchError::ResponseTooLarge { limit_bytes: limit });
        }
    }
    let mut bytes = Vec::new();
    let mut capped = CappedBodyReader::new(reader, limit);
    capped.read_to_end(&mut bytes).map_err(|err| {
        if err.kind() == std::io::ErrorKind::InvalidData
            && err.to_string().contains("maximum allowed size")
        {
            GithubFetchError::ResponseTooLarge { limit_bytes: limit }
        } else {
            GithubFetchError::Network(err.to_string())
        }
    })?;
    Ok(bytes)
}

/// Parses a response's `Content-Length` header into a `u64`, if present
/// and well-formed. A missing or unparseable header yields `None` --
/// callers must never treat that as "the response is small," only as
/// "no fast-fail is available; the hard cap in `CappedBodyReader` is
/// the only enforcement for this response."
fn parse_content_length(response: &ureq::Response) -> Option<u64> {
    response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
}

/// The exact filename a GitHub Release asset must carry to be this
/// module's release tarball, for the CURRENTLY RUNNING host. Reuses
/// `synth::artifact_filename()` -- the same function `synth`'s own
/// packaging step calls when it names the artifact it writes -- so
/// there's one source of truth for this naming convention and the
/// fetch side and packaging side can never drift apart.
pub(crate) fn expected_artifact_filename() -> String {
    crate::cli::synth::artifact_filename()
}

/// The exact filename of the artifact's checksum sidecar --
/// `<expected_artifact_filename()>.sha256`, matching
/// `sidecar::write_sidecar`'s own naming (filename only, artifact and
/// sidecar travel together as siblings).
pub(crate) fn expected_sidecar_filename() -> String {
    format!("{}.sha256", expected_artifact_filename())
}

/// Fetches `owner/repo`'s latest release metadata from
/// `GET https://api.github.com/repos/{owner}/{repo}/releases/latest`.
/// Sets `User-Agent` (required by GitHub's API) and
/// `Accept: application/vnd.github+json` (GitHub's documented
/// recommendation for REST API requests).
fn fetch_latest_release_metadata(
    owner: &str,
    repo: &str,
    use_github_token: bool,
) -> Result<api::Release, GithubFetchError> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
    let request = http_agent()
        .get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json");
    let request = apply_github_token(request, github_token_from_env(use_github_token).as_deref());
    let response = request.call().map_err(|err| match err {
        ureq::Error::Status(code, _response) => GithubFetchError::MetadataHttp(code),
        ureq::Error::Transport(transport) => GithubFetchError::Network(transport.to_string()),
    })?;
    let content_length = parse_content_length(&response);
    let bytes = read_capped_body(
        response.into_reader(),
        content_length,
        METADATA_RESPONSE_CAP_BYTES,
    )?;
    let body = String::from_utf8(bytes)
        .map_err(|err| GithubFetchError::InvalidResponse(err.to_string()))?;
    serde_json::from_str::<api::Release>(&body)
        .map_err(|err| GithubFetchError::InvalidResponse(err.to_string()))
}

/// Finds the URL of the asset whose filename exactly matches
/// `exact_filename` among `release.assets`. Matches by EXACT filename
/// equality, never a loose suffix/prefix match -- a suffix match (e.g.
/// "ends with .tar.gz") risks matching a DIFFERENT platform's release
/// asset published alongside this one (e.g. matching the macOS tarball
/// while running on Linux).
fn find_asset_url<'a>(release: &'a api::Release, exact_filename: &str) -> Option<&'a str> {
    release
        .assets
        .iter()
        .find(|asset| asset.name == exact_filename)
        .map(|asset| asset.browser_download_url.as_str())
}

/// Downloads the raw bytes at `url` (a `browser_download_url` we
/// resolved from release metadata). No `Accept` header -- GitHub's
/// asset-download URLs redirect to short-lived, pre-signed storage
/// URLs that `ureq` follows automatically, and they don't need
/// `Accept: application/vnd.github+json` (that header is for the JSON
/// API, not asset bytes). Never carries `Authorization`, even when
/// `GITHUB_TOKEN` is set: `ureq` resends request headers across
/// redirects, and this URL redirects from `api.github.com` to a
/// short-lived, pre-signed storage host (S3/Azure blob) that doesn't
/// need -- and must never receive -- the GitHub token. The pre-signed
/// URL carries its own auth, so omitting the token here costs nothing;
/// `fetch_latest_release_metadata` already applies the token where a
/// private repo's release actually requires it.
fn download_asset_bytes(url: &str) -> Result<Vec<u8>, GithubFetchError> {
    let request = http_agent().get(url).set("User-Agent", USER_AGENT);
    let response = request.call().map_err(|err| match err {
        ureq::Error::Status(code, _response) => GithubFetchError::DownloadHttp(code),
        ureq::Error::Transport(transport) => GithubFetchError::Network(transport.to_string()),
    })?;
    let content_length = parse_content_length(&response);
    read_capped_body(
        response.into_reader(),
        content_length,
        ASSET_DOWNLOAD_CAP_BYTES,
    )
}

/// Fetches `owner/repo`'s latest release, finds the asset matching the
/// current host's expected artifact filename plus its `.sha256`
/// sidecar, and downloads both as raw bytes -- the
/// `(artifact_bytes, sidecar_bytes)` pair `remote::install_from_remote_bytes`
/// consumes.
///
/// Reliably returns `Err(GithubFetchError::MissingAsset)` against any
/// release published by today's `release.yml` (see top-of-file comment).
pub(crate) fn fetch_latest_github_release_artifact(
    owner: &str,
    repo: &str,
    use_github_token: bool,
) -> Result<(Vec<u8>, Vec<u8>), GithubFetchError> {
    let release = fetch_latest_release_metadata(owner, repo, use_github_token)?;

    let artifact_filename = expected_artifact_filename();
    let sidecar_filename = expected_sidecar_filename();

    let artifact_url = find_asset_url(&release, &artifact_filename)
        .ok_or_else(|| GithubFetchError::MissingAsset(artifact_filename.clone()))?
        .to_string();
    let sidecar_url = find_asset_url(&release, &sidecar_filename)
        .ok_or_else(|| GithubFetchError::MissingAsset(sidecar_filename.clone()))?
        .to_string();

    let artifact_bytes = download_asset_bytes(&artifact_url)?;
    let sidecar_bytes = download_asset_bytes(&sidecar_url)?;
    Ok((artifact_bytes, sidecar_bytes))
}

/// Builds a `RemoteArtifactFetcher` closure bound to `owner`/`repo`,
/// mapping `GithubFetchError` to `std::io::Error`. For a caller that
/// needs the boxed-closure seam instead of calling
/// `fetch_latest_github_release_artifact` directly.
/// `#[allow(dead_code)]`: nothing in production calls this yet; kept
/// as the tested way to get this shape from this module.
#[allow(dead_code)]
pub(crate) fn github_artifact_fetcher(
    owner: String,
    repo: String,
    use_github_token: bool,
) -> RemoteArtifactFetcher<'static> {
    Box::new(move || {
        fetch_latest_github_release_artifact(&owner, &repo, use_github_token)
            .map_err(|err| std::io::Error::other(err.to_string()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    /// Test-only shared lock for every test below that mutates the
    /// process-global `GITHUB_TOKEN` env var -- `std::env::set_var`/
    /// `remove_var` have no per-thread scoping, so two of these tests
    /// running concurrently under `cargo test`'s default multi-threaded
    /// harness could each mutate the same process-wide var at once and
    /// observe a torn or unrelated value. Mirrors
    /// `telemetry::report`'s own `TELEMETRY_ENV_LOCK` and
    /// `test_home_lock::HOME_ENV_LOCK` for `HOME` -- a SEPARATE lock
    /// from both, since no test anywhere in this crate mutates
    /// `GITHUB_TOKEN` alongside `HOME` or the telemetry vars in the
    /// same test.
    static GITHUB_TOKEN_ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Acquires `GITHUB_TOKEN_ENV_LOCK`, recovering the guard even if a
    /// previous holder panicked while it was held -- same
    /// poison-recovery rationale as `test_home_lock::lock_home`, so one
    /// failing assertion here never cascades into every later test in
    /// this module also failing with `PoisonError`.
    fn lock_github_token_env() -> MutexGuard<'static, ()> {
        GITHUB_TOKEN_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A `Read` impl that yields exactly `total_len` non-zero bytes,
    /// in small chunks, so `CappedBodyReader`'s mid-stream counting
    /// (not just a single oversized `read` call) is exercised --
    /// mirrors how a real streamed HTTP body arrives in pieces. No
    /// socket, no `ureq` type: this is the same fake-injection pattern
    /// this module already uses for `RemoteArtifactFetcher` below.
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
                *byte = 0xAB;
            }
            self.remaining -= chunk_len;
            Ok(chunk_len)
        }
    }

    fn sample_release(assets: Vec<(&str, &str)>) -> api::Release {
        api::Release {
            tag_name: "v0.1.0".to_string(),
            assets: assets
                .into_iter()
                .map(|(name, url)| api::Asset {
                    name: name.to_string(),
                    browser_download_url: url.to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn expected_artifact_filename_matches_synth_convention() {
        let filename = expected_artifact_filename();
        assert!(filename.starts_with("konductor-v"));
        assert!(filename.ends_with(".tar.gz"));
        assert_eq!(filename, crate::cli::synth::artifact_filename());
    }

    /// `http_agent()` must set connect/read-idle timeouts and leave the
    /// whole-request `timeout()` unset -- `ureq` documents that
    /// `.timeout()` takes precedence over `.timeout_read()`, so leaving
    /// it set would reintroduce one fixed deadline over the whole body.
    #[test]
    fn http_agent_uses_connect_and_read_idle_timeouts_not_whole_request_timeout() {
        let debug = format!("{:?}", http_agent());
        assert!(debug.contains(&format!("timeout_connect: Some({CONNECT_TIMEOUT:?})")));
        assert!(debug.contains(&format!("timeout_read: Some({READ_IDLE_TIMEOUT:?})")));
        assert!(debug.contains("timeout: None"));
    }

    /// Connect budget must stay shorter than the read-idle budget.
    #[test]
    fn connect_timeout_is_shorter_than_read_idle_timeout() {
        assert!(CONNECT_TIMEOUT < READ_IDLE_TIMEOUT);
    }

    /// `apply_github_token` must attach a literal `Authorization:
    /// Bearer <token>` header when given `Some` -- confirmed via
    /// `Debug`-formatting the resulting `ureq::Request`, this
    /// module's own existing precedent for verifying header/config
    /// state (see `http_agent_uses_connect_and_read_idle_timeouts_not_whole_request_timeout`
    /// above). No real env var is read or set here.
    #[test]
    fn apply_github_token_attaches_bearer_header_when_token_is_some() {
        let request = http_agent().get("https://api.github.com/repos/example/example");
        let request = apply_github_token(request, Some("secret-token-value"));
        let debug = format!("{request:?}");
        assert!(debug.contains("Authorization: Bearer secret-token-value"));
    }

    /// `apply_github_token` must leave the request byte-for-byte
    /// unchanged (no `Authorization` header at all) when given `None`
    /// -- the "GITHUB_TOKEN unset" case must be indistinguishable from
    /// a build with no token support.
    #[test]
    fn apply_github_token_adds_no_header_when_token_is_none() {
        let request = http_agent().get("https://api.github.com/repos/example/example");
        let request = apply_github_token(request, None);
        let debug = format!("{request:?}");
        assert!(!debug.contains("Authorization"));
    }

    /// The actual safety property `--use-github-token` exists to
    /// guarantee: with `use_token = false`, `github_token_from_env`
    /// returns `None` even when a REAL, non-empty `GITHUB_TOKEN` is set
    /// in this test process's real environment -- and the resulting
    /// request built through `apply_github_token` carries zero
    /// `Authorization` header, proven the same Debug-formatting way
    /// `apply_github_token_attaches_bearer_header_when_token_is_some`/
    /// `_adds_no_header_when_token_is_none` already do.
    ///
    /// Sets a real env var rather than only calling
    /// `github_token_from_env(false)` in isolation, specifically to
    /// prove the flag being off overrides a genuinely-present
    /// `GITHUB_TOKEN` -- not just that passing `None` downstream works,
    /// which the two tests above already cover.
    ///
    /// Guarded by `GITHUB_TOKEN_ENV_LOCK`: `std::env::set_var`/
    /// `remove_var` have no per-thread scoping (mutate one process-wide
    /// table), so this test and its sibling `github_token_from_env_*`
    /// tests below -- all of which mutate the same `GITHUB_TOKEN`
    /// var -- must be serialized against each other, mirroring
    /// `telemetry::report`'s own `TELEMETRY_ENV_LOCK` pattern for its
    /// own env vars and `test_home_lock::HOME_ENV_LOCK` for `HOME`. A
    /// SEPARATE lock from both: no test anywhere in this crate mutates
    /// `GITHUB_TOKEN` alongside `HOME` or the telemetry vars in the same
    /// test, so there is no cross-set race to guard against, only the
    /// same-set race among this module's own `GITHUB_TOKEN` tests.
    #[test]
    fn github_token_from_env_false_ignores_a_genuinely_set_token_end_to_end() {
        let _lock = lock_github_token_env();
        std::env::set_var("GITHUB_TOKEN", "a-real-non-empty-token-value");
        let token = github_token_from_env(false);
        std::env::remove_var("GITHUB_TOKEN");

        assert_eq!(
            token, None,
            "github_token_from_env(false) must ignore a genuinely-set GITHUB_TOKEN"
        );

        let request = http_agent().get("https://api.github.com/repos/example/example");
        let request = apply_github_token(request, token.as_deref());
        let debug = format!("{request:?}");
        assert!(
            !debug.contains("Authorization"),
            "with use_token=false, the request must carry zero Authorization header, \
             even though a real GITHUB_TOKEN was genuinely set in the environment"
        );
    }

    /// `github_token_from_env(false)` must short-circuit before ever
    /// calling `std::env::var` -- not read-then-discard. Proven
    /// indirectly: with NO `GITHUB_TOKEN` set at all, `true` and
    /// `false` must both yield `None` (nothing to read either way);
    /// the genuinely-set-token test above is what actually
    /// distinguishes "never read" from "read and discarded," since a
    /// read-then-discard implementation would also pass this one.
    #[test]
    fn github_token_from_env_true_and_false_both_none_when_unset() {
        let _lock = lock_github_token_env();
        std::env::remove_var("GITHUB_TOKEN");
        assert_eq!(github_token_from_env(true), None);
        assert_eq!(github_token_from_env(false), None);
    }

    /// `github_token_from_env(true)` preserves the pre-existing
    /// behavior: a genuinely-set, non-empty token is read back.
    #[test]
    fn github_token_from_env_true_reads_a_genuinely_set_token() {
        let _lock = lock_github_token_env();
        std::env::set_var("GITHUB_TOKEN", "another-real-token-value");
        let token = github_token_from_env(true);
        std::env::remove_var("GITHUB_TOKEN");
        assert_eq!(token, Some("another-real-token-value".to_string()));
    }

    /// `github_token_from_env(true)` still filters an empty value to
    /// `None`, same as before this parameter was added.
    #[test]
    fn github_token_from_env_true_filters_empty_string_to_none() {
        let _lock = lock_github_token_env();
        std::env::set_var("GITHUB_TOKEN", "");
        let token = github_token_from_env(true);
        std::env::remove_var("GITHUB_TOKEN");
        assert_eq!(token, None);
    }

    /// Regression: the asset-download request built inside
    /// `download_asset_bytes` must never carry `Authorization`, even
    /// with a token available -- `ureq` resends request headers
    /// across redirects, and a `browser_download_url` redirects from
    /// `api.github.com` to a short-lived, pre-signed storage host that
    /// must never receive the GitHub token. Exercised directly against
    /// the same construction `download_asset_bytes` uses (not through
    /// a real network call), since the function itself intentionally
    /// takes no token parameter.
    #[test]
    fn asset_download_request_never_carries_authorization_header() {
        let request = http_agent()
            .get("https://example.com/release-asset.tar.gz")
            .set("User-Agent", USER_AGENT);
        let debug = format!("{request:?}");
        assert!(
            !debug.contains("Authorization"),
            "asset-download request must never carry Authorization, regardless of GITHUB_TOKEN"
        );
    }

    #[test]
    fn expected_sidecar_filename_is_artifact_filename_plus_sha256_suffix() {
        let artifact = expected_artifact_filename();
        let sidecar = expected_sidecar_filename();
        assert_eq!(sidecar, format!("{artifact}.sha256"));
    }

    #[test]
    fn find_asset_url_matches_exact_filename_only() {
        let release = sample_release(vec![
            (
                "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz",
                "https://example.com/linux.tar.gz",
            ),
            (
                "konductor-v0.1.0-aarch64-apple-darwin.tar.gz",
                "https://example.com/macos.tar.gz",
            ),
        ]);

        let found = find_asset_url(&release, "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz");
        assert_eq!(found, Some("https://example.com/linux.tar.gz"));
    }

    /// Regression: a loose suffix match (e.g. "ends with .tar.gz")
    /// would incorrectly match the OTHER platform's asset. Exact
    /// equality must reject this.
    #[test]
    fn find_asset_url_does_not_loosely_match_a_different_platforms_asset() {
        let release = sample_release(vec![(
            "konductor-v0.1.0-aarch64-apple-darwin.tar.gz",
            "https://example.com/macos.tar.gz",
        )]);

        let found = find_asset_url(&release, "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz");
        assert_eq!(
            found, None,
            "a different platform's asset must never be matched via loose suffix logic"
        );
    }

    #[test]
    fn find_asset_url_returns_none_when_no_asset_matches() {
        let release = sample_release(vec![("konductor-release.zip", "https://example.com/zip")]);
        assert_eq!(
            find_asset_url(&release, "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz"),
            None,
            "today's release.yml-shaped single zip asset must never satisfy the \
             expected per-platform tarball filename match"
        );
    }

    #[test]
    fn find_asset_url_matches_the_sha256_sidecar_by_exact_filename_too() {
        let release = sample_release(vec![(
            "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz.sha256",
            "https://example.com/linux.tar.gz.sha256",
        )]);
        let found = find_asset_url(
            &release,
            "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz.sha256",
        );
        assert_eq!(found, Some("https://example.com/linux.tar.gz.sha256"));
    }

    #[test]
    fn release_metadata_deserializes_ignoring_unmodeled_fields() {
        let body = r#"{
            "tag_name": "v0.1.0",
            "name": "Release 0.1.0",
            "draft": false,
            "assets": [
                {
                    "name": "konductor-release.zip",
                    "browser_download_url": "https://example.com/konductor-release.zip",
                    "size": 12345,
                    "content_type": "application/zip"
                }
            ]
        }"#;
        let release: api::Release =
            serde_json::from_str(body).expect("release metadata must deserialize");
        assert_eq!(release.tag_name, "v0.1.0");
        assert_eq!(release.assets.len(), 1);
        assert_eq!(release.assets[0].name, "konductor-release.zip");
    }

    #[test]
    fn release_metadata_with_no_assets_field_defaults_to_empty() {
        let body = r#"{"tag_name": "v0.1.0"}"#;
        let release: api::Release =
            serde_json::from_str(body).expect("release metadata must deserialize");
        assert!(release.assets.is_empty());
    }

    #[test]
    fn github_fetch_error_display_never_panics_and_names_the_missing_filename() {
        let err = GithubFetchError::MissingAsset(
            "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz".to_string(),
        );
        let message = err.to_string();
        assert!(message.contains("konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz"));
    }

    // ── Injectable-fetcher outcome tests ───────────────────────────────
    //
    // `fetch_latest_github_release_artifact` always makes a real
    // network call, so it can't be unit-tested directly. These tests
    // exercise the same three outcomes (success, missing-asset,
    // network error) through a fake closure of the identical
    // `RemoteArtifactFetcher` shape -- mirroring `artifact::ArtifactFetcher`'s
    // no-network fake-injection pattern in artifact.rs. No socket use.

    #[test]
    fn fake_fetcher_success_outcome_matches_remote_artifact_fetcher_shape() {
        let fetcher: RemoteArtifactFetcher =
            Box::new(|| Ok((b"artifact bytes".to_vec(), b"sidecar bytes".to_vec())));
        let (artifact_bytes, sidecar_bytes) = fetcher().expect("fake fetch must succeed");
        assert_eq!(artifact_bytes, b"artifact bytes");
        assert_eq!(sidecar_bytes, b"sidecar bytes");
    }

    #[test]
    fn fake_fetcher_missing_asset_outcome_maps_to_an_io_error() {
        let mapped_message =
            GithubFetchError::MissingAsset(expected_artifact_filename()).to_string();
        let fetcher: RemoteArtifactFetcher =
            Box::new(move || Err(std::io::Error::other(mapped_message.clone())));
        let err = fetcher().expect_err("fake missing-asset fetch must fail");
        assert!(err.to_string().contains("no release asset named"));
    }

    #[test]
    fn fake_fetcher_network_error_outcome_maps_to_an_io_error() {
        let mapped_message =
            GithubFetchError::Network("connection refused".to_string()).to_string();
        let fetcher: RemoteArtifactFetcher =
            Box::new(move || Err(std::io::Error::other(mapped_message.clone())));
        let err = fetcher().expect_err("fake network-error fetch must fail");
        assert!(err.to_string().contains("network error contacting GitHub"));
    }

    /// `github_artifact_fetcher` itself (not a hand-rolled fake) must
    /// produce a closure of the exact `RemoteArtifactFetcher` shape.
    /// Does not call the closure (that would make a real network
    /// call) -- only proves the construction/type-shape contract holds.
    #[test]
    fn github_artifact_fetcher_produces_a_remote_artifact_fetcher_shaped_closure() {
        let _fetcher: RemoteArtifactFetcher =
            github_artifact_fetcher("aws-solutions".to_string(), "konductor".to_string(), false);
    }

    // ── Response-size cap enforcement (no real network) ────────────────

    /// A body under the cap must read through `read_capped_body`
    /// unchanged -- proves the cap doesn't reject legitimate traffic.
    #[test]
    fn read_capped_body_accepts_a_body_under_the_limit() {
        let reader = FakeBoundedReader::new(1024);
        let bytes = read_capped_body(reader, None, 4096).expect("body under the cap must read");
        assert_eq!(bytes.len(), 1024);
    }

    /// The core guarantee: a body whose real byte count exceeds the
    /// cap is rejected by `CappedBodyReader`'s mid-stream counting,
    /// with NO `Content-Length` header present at all -- proving the
    /// hard cap is enforced independently of that header, not merely
    /// as a fallback when it's absent. No real network call is made;
    /// `FakeBoundedReader` is a plain in-memory `Read` impl.
    #[test]
    fn read_capped_body_rejects_a_body_exceeding_the_limit_with_no_content_length_header() {
        const LIMIT: u64 = 4096;
        let reader = FakeBoundedReader::new(LIMIT as usize + 1);
        let err = read_capped_body(reader, None, LIMIT)
            .expect_err("a body exceeding the cap must be rejected, not fully buffered");
        assert!(matches!(
            err,
            GithubFetchError::ResponseTooLarge { limit_bytes: LIMIT }
        ));
    }

    /// A body exceeding the cap must be rejected even when the
    /// `Content-Length` header LIES and reports a value under the
    /// cap -- proving the header is never trusted as the sole
    /// enforcement. The fast-fail path only ever REJECTS early on an
    /// over-cap declared length; it never lets an under-cap declared
    /// length skip the hard mid-stream check that follows.
    #[test]
    fn read_capped_body_rejects_a_body_exceeding_the_limit_even_when_content_length_lies_low() {
        const LIMIT: u64 = 4096;
        let reader = FakeBoundedReader::new(LIMIT as usize + 1);
        let lying_content_length = Some(LIMIT - 1);
        let err = read_capped_body(reader, lying_content_length, LIMIT)
            .expect_err("actual byte count must be enforced even if Content-Length understates it");
        assert!(matches!(
            err,
            GithubFetchError::ResponseTooLarge { limit_bytes: LIMIT }
        ));
    }

    /// A truthful `Content-Length` that already declares a value over
    /// the cap must fast-fail before any bytes are read at all --
    /// the earlier-fail optimization layered on top of the hard cap.
    #[test]
    fn read_capped_body_fast_fails_on_an_over_cap_content_length_before_reading() {
        const LIMIT: u64 = 4096;
        // Reader would itself return only 10 bytes if ever read from --
        // proving rejection happened via the Content-Length fast-fail,
        // not because the reader ran out and organically exceeded the cap.
        let reader = FakeBoundedReader::new(10);
        let declared_over_cap = Some(LIMIT + 1);
        let err = read_capped_body(reader, declared_over_cap, LIMIT)
            .expect_err("a Content-Length already over the cap must fast-fail");
        assert!(matches!(
            err,
            GithubFetchError::ResponseTooLarge { limit_bytes: LIMIT }
        ));
    }

    /// A body at EXACTLY the cap (not one byte more) must be accepted
    /// -- the cap must reject "exceeds", not "reaches", the limit.
    #[test]
    fn read_capped_body_accepts_a_body_at_exactly_the_limit() {
        const LIMIT: u64 = 4096;
        let reader = FakeBoundedReader::new(LIMIT as usize);
        let bytes =
            read_capped_body(reader, None, LIMIT).expect("a body at exactly the cap must succeed");
        assert_eq!(bytes.len(), LIMIT as usize);
    }

    #[test]
    fn github_fetch_error_response_too_large_display_names_the_limit() {
        let err = GithubFetchError::ResponseTooLarge {
            limit_bytes: ASSET_DOWNLOAD_CAP_BYTES,
        };
        let message = err.to_string();
        assert!(message.contains(&ASSET_DOWNLOAD_CAP_BYTES.to_string()));
    }

    /// Pins the two chosen cap values so a future accidental change is
    /// caught by a failing test rather than silently drifting.
    #[test]
    fn cap_constants_have_the_expected_relative_sizes() {
        assert_eq!(METADATA_RESPONSE_CAP_BYTES, 8 * 1024 * 1024);
        assert_eq!(ASSET_DOWNLOAD_CAP_BYTES, 256 * 1024 * 1024);
        assert!(
            METADATA_RESPONSE_CAP_BYTES < ASSET_DOWNLOAD_CAP_BYTES,
            "the metadata cap must stay far smaller than the asset-download cap"
        );
    }

    /// A 401 or 403 on the metadata call -- the exact codes a private
    /// repository without a token produces -- must name
    /// `--use-github-token` in the rendered message, for both variants
    /// that carry an HTTP status.
    #[test]
    fn metadata_http_401_and_403_display_names_the_token_flag() {
        for status in [401u16, 403u16] {
            let message = GithubFetchError::MetadataHttp(status).to_string();
            assert!(
                message.contains("--use-github-token"),
                "status {status} must hint at --use-github-token, got: {message}"
            );
        }
    }

    #[test]
    fn download_http_401_and_403_display_names_the_token_flag() {
        for status in [401u16, 403u16] {
            let message = GithubFetchError::DownloadHttp(status).to_string();
            assert!(
                message.contains("--use-github-token"),
                "status {status} must hint at --use-github-token, got: {message}"
            );
        }
    }

    /// Any OTHER status code must NOT carry the hint -- it would be
    /// noise for a failure that has nothing to do with authentication.
    #[test]
    fn metadata_and_download_http_other_statuses_omit_the_token_flag_hint() {
        for status in [404u16, 429u16, 500u16, 503u16] {
            let metadata_message = GithubFetchError::MetadataHttp(status).to_string();
            let download_message = GithubFetchError::DownloadHttp(status).to_string();
            assert!(
                !metadata_message.contains("--use-github-token"),
                "status {status} must not carry the token hint, got: {metadata_message}"
            );
            assert!(
                !download_message.contains("--use-github-token"),
                "status {status} must not carry the token hint, got: {download_message}"
            );
        }
    }
}
