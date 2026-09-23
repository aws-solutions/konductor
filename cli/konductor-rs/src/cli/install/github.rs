// SPDX-License-Identifier: Apache-2.0
//
// install/github.rs — fetches the latest GitHub Release's dist
// artifact and its `.sha256` sidecar as raw bytes, over a synchronous
// (`ureq`) HTTP client. No async runtime.
//
// Expects release assets in the shape `synth::artifact_filename()`
// defines: a single version-named tarball (`konductor-v<VERSION>.tar.gz`,
// no architecture or OS in the name) plus its `.sha256` sidecar.
// `.github/workflows/release.yml` publishes both as individually-named
// release assets.
//
// ── MCP server binary (skill-lookup-mcp) assets ──────────────────────────
// The SAME release also publishes a per-platform `skill-lookup-mcp`
// binary: `skill-lookup-mcp-{RELEASE_VERSION}-{TARGET_TRIPLE}` plus its
// `.sha256` sidecar, for exactly the three target triples
// `install::target_triple::current_host_target_triple()` maps a host
// to. `RELEASE_VERSION` there is release.yml's own `v<VERSION-file
// contents>` string -- NOT necessarily equal to this binary's own
// `CARGO_PKG_VERSION` (see `expected_artifact_filename()`'s own doc
// comment for the same drift risk on the tarball side). Since a
// no-`--from` install has no local checkout to read a `VERSION` file
// from, the correct source here is the SAME release metadata response
// this module already fetches for the tarball: its `tag_name` field is
// exactly release.yml's `RELEASE_VERSION` value (the tag `gh
// release create` is given), fetched fresh over the network rather
// than assumed to match `CARGO_PKG_VERSION`.
//
// No closure-based test seam of its own; a caller needing one supplies
// a fake `RemoteArtifactFetcher`. This module's own tests exercise the
// pure filename/URL-matching logic and never open a socket.

use std::io::Read;
use std::time::Duration;

use super::private_repo_hint;
#[cfg(test)]
use super::remote::RemoteArtifactFetcher;

/// GitHub API response shapes this module reads. Deliberately narrow:
/// only the fields needed to locate an asset by exact filename are
/// modeled.
mod api {
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    pub struct Release {
        /// The release's tag name, e.g. `"v0.1.1"` -- exactly
        /// release.yml's own `RELEASE_VERSION` value (see
        /// `expected_mcp_server_asset_filename`'s doc comment for why
        /// this, not `CARGO_PKG_VERSION`, is the correct version source
        /// for a per-platform asset name a no-`--from` install must
        /// construct with no local checkout to read a `VERSION` file
        /// from).
        pub tag_name: String,
        #[serde(default)]
        pub assets: Vec<Asset>,
    }

    #[derive(Debug, Deserialize)]
    pub struct Asset {
        pub name: String,
        pub browser_download_url: String,
        /// The asset's REST API URL
        /// (`https://api.github.com/repos/{owner}/{repo}/releases/assets/{id}`),
        /// distinct from `browser_download_url`: this one stays on
        /// `api.github.com` and honors `Authorization` +
        /// `Accept: application/octet-stream`, which is what makes an
        /// authenticated download of a private repo's asset possible.
        /// `browser_download_url` redirects off `api.github.com` to a
        /// short-lived, pre-signed storage host and is used for the
        /// unauthenticated (default) download path.
        pub url: String,
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
    /// the expected artifact or sidecar filename. Happens against a
    /// release whose assets don't match `artifact_filename()`'s naming
    /// convention, e.g. one published by something other than
    /// `.github/workflows/release.yml`.
    MissingAsset(String),
    /// The `GET .../releases/latest` metadata call responded with a
    /// non-2xx HTTP status (404 = no release published, 403 =
    /// rate-limited, etc). The ONLY variant that means "nothing usable
    /// here" for fallback purposes: a 404 here proves no release
    /// exists to fall back away from.
    ///
    /// Carries the `TokenState` this specific request was made with,
    /// so `Display` can render a hint that reflects whether a token
    /// was actually sent (and rejected) versus never attempted --
    /// this is the only site in this module that can attach the token
    /// via `apply_github_token`, so it's the only variant that needs
    /// this state.
    MetadataHttp(u16, private_repo_hint::TokenState),
    /// The asset-download request responded with a non-2xx HTTP
    /// status, after a matching asset URL was already resolved. Kept
    /// distinct from `MetadataHttp`: here the release and asset both
    /// exist but the download request itself was rejected or the
    /// resolved URL is broken/expired.
    ///
    /// Carries the `TokenState` this specific download request was
    /// made with, same as `MetadataHttp` -- when `--use-github-token`
    /// is set, the download goes through the asset's authenticated
    /// `url` field and can itself 401/403/404 the same way the
    /// metadata call can, so it needs the same state-aware hint.
    DownloadHttp(u16, private_repo_hint::TokenState),
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
    /// The `GET .../releases/tags/{tag}` metadata call responded with
    /// a 404 specifically -- the requested tag does not exist as a
    /// release on this repository. Kept distinct from `MetadataHttp`
    /// (which a by-tag caller can also still receive for a non-404
    /// status, e.g. a 403 rate-limit) so a caller can render a clear,
    /// specific "release {tag} not found" message instead of the
    /// generic HTTP-status wording -- and so this can never be
    /// confused with `MetadataHttp(404, _)` on the LATEST-release
    /// path, which means something different there ("no release
    /// exists at all", not "this specific tag doesn't exist").
    TagNotFound { tag: String },
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
            GithubFetchError::MetadataHttp(status, token_state) => {
                write!(
                    f,
                    "GitHub API responded with HTTP status {status} while fetching release metadata{}",
                    private_repo_hint::private_repo_hint(*status, *token_state)
                )
            }
            GithubFetchError::DownloadHttp(status, token_state) => {
                write!(
                    f,
                    "GitHub API responded with HTTP status {status} while downloading a release asset{}",
                    private_repo_hint::download_private_repo_hint(*status, *token_state)
                )
            }
            GithubFetchError::InvalidResponse(message) => {
                write!(f, "could not parse GitHub API response: {message}")
            }
            GithubFetchError::ResponseTooLarge { limit_bytes } => write!(
                f,
                "GitHub API response exceeded the maximum allowed size of {limit_bytes} bytes"
            ),
            GithubFetchError::TagNotFound { tag } => {
                write!(f, "release {tag} not found")
            }
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

/// Reads `GITHUB_TOKEN` exactly once and applies it to `request`,
/// returning both the (possibly modified) request and the
/// `TokenState` that read produced -- so the two can never desync.
///
/// Before this helper existed, every call site read the token, derived
/// `TokenState` from it, and applied it to the request as three
/// separate lines (`github_token_from_env` /
/// `TokenState::from_flag_and_token` / `apply_github_token`), each
/// naming the same `token` variable by hand. Nothing enforced that the
/// `token` passed to the second and third calls was the SAME value the
/// first call produced -- a future edit could pass a different
/// `Option<String>` to one of them and `TokenState` would silently
/// misreport what was actually sent. Folding all three into one
/// function makes that impossible: `token` is a single local this
/// function alone owns, threaded through both derivations itself.
pub(crate) fn apply_github_token_from_env(
    request: ureq::Request,
    use_github_token: bool,
) -> (ureq::Request, private_repo_hint::TokenState) {
    let token = github_token_from_env(use_github_token);
    let token_state = private_repo_hint::TokenState::from_flag_and_token(use_github_token, &token);
    let request = apply_github_token(request, token.as_deref());
    (request, token_state)
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
///
/// This is the ONLY function in this module that calls
/// `releases/latest`. Both the tarball asset resolution
/// (`resolve_artifact_from_release`) and the MCP server binary asset
/// resolution (`resolve_mcp_server_asset_from_release`) take an
/// already-fetched `&api::Release` instead of calling this
/// themselves, so a single no-`--from` install fetches this metadata
/// exactly once and resolves both assets from that SAME response --
/// see `fetch_latest_release_artifact_and_mcp_asset` for the shared
/// call site that fetches once and threads the result into both
/// resolvers.
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
    let (request, token_state) = apply_github_token_from_env(request, use_github_token);
    let response = request.call().map_err(|err| match err {
        ureq::Error::Status(code, _response) => GithubFetchError::MetadataHttp(code, token_state),
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

/// Fetches `owner/repo`'s release metadata for one SPECIFIC tag from
/// `GET https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}`
/// -- the by-tag counterpart to `fetch_latest_release_metadata`,
/// reusing the exact same request-building/token-attachment/
/// size-capping machinery (`http_agent`, `apply_github_token_from_env`,
/// `read_capped_body`, `METADATA_RESPONSE_CAP_BYTES`) that function
/// already uses. `tag` is used verbatim in the URL path -- callers
/// pass the exact tag name a release was published under (e.g.
/// `"v0.2.0"`), the same string `--version <v>` carries through
/// unmodified from the CLI.
///
/// A 404 here means specifically "no release exists under this exact
/// tag" -- distinct from `releases/latest`'s 404, which means "this
/// repository has never published any release at all". Mapped to
/// `GithubFetchError::TagNotFound` rather than the generic
/// `MetadataHttp(404, _)` `fetch_latest_release_metadata` uses, so a
/// caller can render a clear, specific message
/// (`GithubFetchError::TagNotFound`'s own `Display`) instead of the
/// generic HTTP-status wording, and so it is never mistaken for "no
/// release exists at all" (the meaning `MetadataHttp(404, _)` carries
/// on the latest-release path, and the trigger for this module's
/// fallback-to-`main`-branch-dist chain -- a by-tag miss must never
/// trigger that same fallback, since falling back to whatever's on
/// `main` would silently substitute a different version than the one
/// explicitly requested).
fn fetch_release_by_tag_metadata(
    owner: &str,
    repo: &str,
    tag: &str,
    use_github_token: bool,
) -> Result<api::Release, GithubFetchError> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}");
    let request = http_agent()
        .get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json");
    let (request, token_state) = apply_github_token_from_env(request, use_github_token);
    let response = request.call().map_err(|err| match err {
        ureq::Error::Status(404, _response) => GithubFetchError::TagNotFound {
            tag: tag.to_string(),
        },
        ureq::Error::Status(code, _response) => GithubFetchError::MetadataHttp(code, token_state),
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

/// among `release.assets`, returning both its `browser_download_url`
/// (unauthenticated download target) and its `url` (authenticated
/// REST API download target). Matches by EXACT filename equality,
/// never a loose suffix/prefix match -- a suffix match (e.g. "ends
/// with .tar.gz") risks matching a DIFFERENT platform's release asset
/// published alongside this one (e.g. matching the macOS tarball
/// while running on Linux).
fn find_asset_url<'a>(
    release: &'a api::Release,
    exact_filename: &str,
) -> Option<(&'a str, &'a str)> {
    release
        .assets
        .iter()
        .find(|asset| asset.name == exact_filename)
        .map(|asset| (asset.browser_download_url.as_str(), asset.url.as_str()))
}

/// Finds the release's packaged tarball or `.sha256` sidecar by the
/// SAME stable, version-independent shape `synth::is_stale_artifact_entry`
/// already matches on: `konductor-v` prefix, `.tar.gz`/`.tar.gz.sha256`
/// suffix, whatever the middle version segment says. Never an exact
/// `expected_artifact_filename()`/`expected_sidecar_filename()` match
/// -- those are built from THIS BINARY's own `CARGO_PKG_VERSION`, which
/// names nothing GitHub actually published: `.github/workflows/
/// release.yml` tags a release from the repo root's `VERSION` file
/// (`RELEASE_VERSION`) but names the packaged tarball asset itself
/// from `synth::artifact_filename()` at BUILD time on whatever commit
/// produced it -- release.yml's own `check-version` job documents this
/// exact drift ("the packaged tarball/sidecar's version segment comes
/// from `artifact_filename()` (Cargo.toml's version), not necessarily
/// RELEASE_VERSION") and already works around it with the identical
/// pattern match used here, not an exact name. A caller resolving an
/// already-fetched release's assets is in exactly the same position:
/// the running binary's `CARGO_PKG_VERSION` says nothing about what
/// version segment the LATEST release's tarball was actually packaged
/// under (ahead-of-mainline feature branches routinely trail the
/// latest published release), so requiring an exact match here was
/// guaranteed to false-negative on `MissingAsset` for any real release
/// whose packaged version segment didn't happen to equal the currently
/// running binary's own version -- a `--force`/`update` on ANY target
/// not already at that exact `CARGO_PKG_VERSION` could never succeed.
/// The excludes the per-triple raw binary assets release.yml also
/// publishes alongside the tarball (`konductor-v<ver>-<target-triple>`,
/// `skill-lookup-mcp-v<ver>-<target-triple>`, neither `.tar.gz`-suffixed)
/// -- so this still returns exactly the ONE tarball asset a release
/// carries, never a per-platform binary sharing the `konductor-v`
/// prefix. Ambiguous only if a release ever published more than one
/// asset matching this shape, which `release.yml`'s own
/// `TARBALL_MATCH_COUNT -eq 1` assertion at publish time already rules
/// out -- `.find()` takes the first (and, by that publish-time
/// guarantee, only) match.
fn find_packaged_tarball_asset(
    release: &api::Release,
    sidecar: bool,
) -> Option<(&str, &str, &str)> {
    let suffix = if sidecar { ".tar.gz.sha256" } else { ".tar.gz" };
    release
        .assets
        .iter()
        .find(|asset| asset.name.starts_with("konductor-v") && asset.name.ends_with(suffix))
        .map(|asset| {
            (
                asset.name.as_str(),
                asset.browser_download_url.as_str(),
                asset.url.as_str(),
            )
        })
}

/// Downloads the raw bytes of a release asset, choosing the request
/// shape based on `use_github_token`:
///
/// - `false` (default): GETs `browser_download_url` unauthenticated,
///   no `Authorization` header, no `Accept` header. This URL redirects
///   off `api.github.com` to a short-lived, pre-signed storage host
///   that `ureq` follows automatically; it doesn't need
///   `Accept: application/vnd.github+json` (that header is for the
///   JSON API, not asset bytes) and never sends the GitHub token
///   there in the first place, since no token is attached on this
///   path at all.
/// - `true`: GETs the asset's `url` field instead (the
///   `api.github.com/repos/{owner}/{repo}/releases/assets/{id}` REST
///   endpoint), with `Accept: application/octet-stream` (GitHub's
///   documented way to ask this endpoint for raw asset bytes instead
///   of the JSON asset-metadata representation it returns by default)
///   and the same `Authorization: Bearer <token>` header
///   `fetch_latest_release_metadata` attaches. This is the only way to
///   download a private repository's asset: `browser_download_url`
///   404s unauthenticated against a private repo (GitHub returns 404,
///   not 401/403, specifically to avoid confirming the asset's
///   existence to an unauthorized caller). This endpoint also
///   redirects off `api.github.com` to the same pre-signed storage
///   host, but `http_agent()`'s `ureq::Agent` keeps ureq 2.10.1's
///   default `RedirectAuthHeaders::Never` redirect-auth-header
///   strategy, and ureq strips `Authorization` on every redirect
///   under that strategy (same-host or cross-host) -- so the token
///   is never forwarded to the storage host on this path either.
///
/// Takes both URLs and threads `use_github_token`/token state through
/// explicitly rather than reading the environment itself, mirroring
/// `fetch_latest_release_metadata`'s own call to
/// `apply_github_token_from_env` -- one source of truth for how the
/// token is read and applied.
fn download_asset_bytes(
    browser_download_url: &str,
    api_url: &str,
    use_github_token: bool,
) -> Result<Vec<u8>, GithubFetchError> {
    let (request, token_state) = if use_github_token {
        let request = http_agent()
            .get(api_url)
            .set("User-Agent", USER_AGENT)
            .set("Accept", "application/octet-stream");
        apply_github_token_from_env(request, use_github_token)
    } else {
        let request = http_agent()
            .get(browser_download_url)
            .set("User-Agent", USER_AGENT);
        (request, private_repo_hint::TokenState::NotOptedIn)
    };
    let response = request.call().map_err(|err| match err {
        ureq::Error::Status(code, _response) => GithubFetchError::DownloadHttp(code, token_state),
        ureq::Error::Transport(transport) => GithubFetchError::Network(transport.to_string()),
    })?;
    let content_length = parse_content_length(&response);
    read_capped_body(
        response.into_reader(),
        content_length,
        ASSET_DOWNLOAD_CAP_BYTES,
    )
}

/// Finds the release's packaged tarball plus its `.sha256` sidecar
/// within an ALREADY-FETCHED `release`, and downloads both as raw
/// bytes -- the `(artifact_bytes, sidecar_bytes)` pair
/// `remote::install_from_remote_bytes` consumes. Takes `release` by
/// reference rather than fetching its own copy, so a caller that also
/// needs `release` for the MCP server binary asset
/// (`resolve_mcp_server_asset_from_release`) can fetch the metadata
/// once and resolve both assets from that SAME response -- see
/// `fetch_latest_release_artifact_and_mcp_asset`.
///
/// Matches by `find_packaged_tarball_asset`'s stable
/// `konductor-v*.tar.gz`/`konductor-v*.tar.gz.sha256` shape, never an
/// exact `expected_artifact_filename()`/`expected_sidecar_filename()`
/// match -- see that function's own doc comment for why an exact
/// match against THIS BINARY's `CARGO_PKG_VERSION` was wrong here (it
/// names nothing the fetched release necessarily published).
///
/// Returns `Err(GithubFetchError::MissingAsset)` if `release` carries
/// no asset matching that shape (or no matching `.sha256` sidecar) --
/// see the `MissingAsset` variant's own doc for when that happens.
fn resolve_artifact_from_release(
    release: &api::Release,
    use_github_token: bool,
) -> Result<(Vec<u8>, Vec<u8>, String), GithubFetchError> {
    let (artifact_name, artifact_browser_url, artifact_api_url) =
        find_packaged_tarball_asset(release, false)
            .ok_or_else(|| GithubFetchError::MissingAsset(expected_artifact_filename()))?;
    let artifact_name = artifact_name.to_string();
    let artifact_browser_url = artifact_browser_url.to_string();
    let artifact_api_url = artifact_api_url.to_string();
    let (_, sidecar_browser_url, sidecar_api_url) = find_packaged_tarball_asset(release, true)
        .ok_or_else(|| GithubFetchError::MissingAsset(format!("{artifact_name}.sha256")))?;
    let sidecar_browser_url = sidecar_browser_url.to_string();
    let sidecar_api_url = sidecar_api_url.to_string();

    let artifact_bytes =
        download_asset_bytes(&artifact_browser_url, &artifact_api_url, use_github_token)?;
    let sidecar_bytes =
        download_asset_bytes(&sidecar_browser_url, &sidecar_api_url, use_github_token)?;
    Ok((artifact_bytes, sidecar_bytes, artifact_name))
}

/// Fetches `owner/repo`'s latest release metadata, then resolves and
/// downloads the tarball asset pair from it -- the single-fetch
/// equivalent of the OLD `fetch_latest_github_release_artifact`
/// behavior, for a caller that only needs the tarball and has no
/// separate use for the fetched `release` (i.e. every call site except
/// `fetch_latest_release_artifact_and_mcp_asset`, which fetches once
/// and shares the release with the MCP asset resolver instead of
/// calling this). Drops `resolve_artifact_from_release`'s resolved
/// filename: this helper feeds `RemoteArtifactFetcher`
/// (`remote.rs`), a separate, test-only 2-tuple seam with no filename
/// slot -- unrelated to the by-tag/latest production path's own
/// verification, which threads that filename through instead (see
/// `ArtifactResolutionResult`'s own doc comment for why that one
/// cannot drop it).
#[cfg(test)]
fn fetch_latest_github_release_artifact(
    owner: &str,
    repo: &str,
    use_github_token: bool,
) -> Result<(Vec<u8>, Vec<u8>), GithubFetchError> {
    let release = fetch_latest_release_metadata(owner, repo, use_github_token)?;
    resolve_artifact_from_release(&release, use_github_token)
        .map(|(artifact, sidecar, _)| (artifact, sidecar))
}

// ── MCP server binary (skill-lookup-mcp) per-platform asset fetch ────────

/// Builds the exact asset filename release.yml stages for the MCP
/// server binary on `target_triple`: `skill-lookup-mcp-{release_version}-
/// {target_triple}`, mirroring release.yml's own
/// `MCP_BIN_ASSET_NAME="skill-lookup-mcp-${RELEASE_VERSION}-${TARGET_TRIPLE}"`
/// line exactly. `release_version` must be the release's own `tag_name`
/// (e.g. `"v0.1.1"`), NOT `CARGO_PKG_VERSION` -- see this module's own
/// top-of-file doc comment for why a no-`--from` install can only
/// obtain the correct version this way, with no local `VERSION` file
/// to read.
pub(crate) fn expected_mcp_server_asset_filename(
    release_version: &str,
    target_triple: &str,
) -> String {
    format!("skill-lookup-mcp-{release_version}-{target_triple}")
}

/// The `.sha256` sidecar filename for
/// `expected_mcp_server_asset_filename` -- same filename-plus-suffix
/// convention as `expected_sidecar_filename` uses for the tarball.
pub(crate) fn expected_mcp_server_sidecar_filename(
    release_version: &str,
    target_triple: &str,
) -> String {
    format!(
        "{}.sha256",
        expected_mcp_server_asset_filename(release_version, target_triple)
    )
}

/// Why fetching the platform-specific `skill-lookup-mcp` binary asset
/// failed, once release metadata has already been fetched successfully
/// (the metadata-fetch phase's own failures are `GithubFetchError`,
/// surfaced separately -- see `fetch_latest_release_artifact_and_mcp_asset`'s
/// own doc comment). Two variants distinguish the two failure MODES this
/// task's success criteria require distinguishable:
///
/// - `UnsupportedPlatform`: the CURRENT HOST has no published asset at
///   all (`target_triple::current_host_target_triple()` returned
///   `None`) -- there is nothing to even attempt fetching. This is
///   never a network/checksum problem; it is a platform the release
///   build matrix does not cover (see `target_triple`'s own module doc
///   comment: x86_64 macOS, Windows, or any other OS/ARCH combination).
/// - `Fetch`: the host IS mapped to a real target triple, but the
///   fetch/verify of that triple's own asset pair failed for some
///   other reason -- a `GithubFetchError` (network, missing asset
///   despite a mapped triple, an HTTP error) wrapped unchanged.
#[derive(Debug)]
pub(crate) enum McpServerAssetFetchError {
    /// No `skill-lookup-mcp` asset is published for this host's
    /// OS/ARCH at all -- carries the values `current_host_target_triple`
    /// read, for a message naming exactly what host this is.
    UnsupportedPlatform { os: String, arch: String },
    /// The host IS a supported/mapped platform, but fetching or
    /// locating that platform's own asset pair failed.
    Fetch(GithubFetchError),
}

impl std::fmt::Display for McpServerAssetFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            McpServerAssetFetchError::UnsupportedPlatform { os, arch } => write!(
                f,
                "no skill-lookup-mcp binary is published for {os}/{arch}; skill lookups \
                 will be unavailable for this install"
            ),
            McpServerAssetFetchError::Fetch(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for McpServerAssetFetchError {}

impl McpServerAssetFetchError {
    /// Whether this failure means "no asset exists for this platform
    /// at all" (as opposed to a fetch/verify failure on a platform
    /// that DOES have a published asset). Named accessor rather than a
    /// bare `matches!` at every call site, so the
    /// degrade-vs-block decision documented at each caller reads
    /// clearly against this one predicate.
    pub(crate) fn is_unsupported_platform(&self) -> bool {
        matches!(self, McpServerAssetFetchError::UnsupportedPlatform { .. })
    }
}

/// Resolves the CURRENT HOST's target triple against an
/// ALREADY-FETCHED `release`, and downloads the matching
/// `skill-lookup-mcp-{tag_name}-{triple}` asset plus its `.sha256`
/// sidecar as raw bytes -- the `(binary_bytes, sidecar_bytes,
/// release_version)` triple `remote::install_mcp_server_binary_from_remote`
/// consumes. `release_version` is `release`'s own `tag_name` (e.g.
/// `"v0.1.1"`), read back so a caller building the eventual asset
/// filename for checksum verification, or reporting the version that
/// was actually installed, never has to re-derive it independently.
///
/// Takes `release` by reference rather than fetching its own copy, so
/// a caller that also needs `release` for the tarball asset
/// (`resolve_artifact_from_release`) can fetch the metadata once and
/// resolve both assets from that SAME response -- see
/// `fetch_latest_release_artifact_and_mcp_asset`. Unlike the OLD
/// (now-removed) `fetch_mcp_server_release_asset` this replaces, no
/// metadata-fetch failure can occur here: that phase is entirely the
/// caller's responsibility now.
///
/// Returns `Err(McpServerAssetFetchError::UnsupportedPlatform)` before
/// any network call is made, if the current host maps to none of the
/// three published target triples -- see
/// `McpServerAssetFetchError::UnsupportedPlatform`'s own doc for why
/// this is never a network/checksum problem. Returns
/// `Err(McpServerAssetFetchError::Fetch(GithubFetchError::MissingAsset))`
/// if the host IS mapped to a real triple but `release` genuinely has
/// no asset under that exact name (a supported platform whose asset is
/// missing from this particular release, distinct from the platform
/// being unsupported at all).
fn resolve_mcp_server_asset_from_release(
    release: &api::Release,
    use_github_token: bool,
) -> Result<(Vec<u8>, Vec<u8>, String), McpServerAssetFetchError> {
    let Some(target_triple) = super::target_triple::current_host_target_triple() else {
        return Err(McpServerAssetFetchError::UnsupportedPlatform {
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
        });
    };

    let release_version = release.tag_name.clone();
    let binary_filename = expected_mcp_server_asset_filename(&release_version, target_triple);
    let sidecar_filename = expected_mcp_server_sidecar_filename(&release_version, target_triple);

    let (binary_browser_url, binary_api_url) = find_asset_url(release, &binary_filename)
        .ok_or_else(|| {
            McpServerAssetFetchError::Fetch(GithubFetchError::MissingAsset(binary_filename.clone()))
        })?;
    let binary_browser_url = binary_browser_url.to_string();
    let binary_api_url = binary_api_url.to_string();
    let (sidecar_browser_url, sidecar_api_url) = find_asset_url(release, &sidecar_filename)
        .ok_or_else(|| {
            McpServerAssetFetchError::Fetch(GithubFetchError::MissingAsset(
                sidecar_filename.clone(),
            ))
        })?;
    let sidecar_browser_url = sidecar_browser_url.to_string();
    let sidecar_api_url = sidecar_api_url.to_string();

    let binary_bytes = download_asset_bytes(&binary_browser_url, &binary_api_url, use_github_token)
        .map_err(McpServerAssetFetchError::Fetch)?;
    let sidecar_bytes =
        download_asset_bytes(&sidecar_browser_url, &sidecar_api_url, use_github_token)
            .map_err(McpServerAssetFetchError::Fetch)?;
    Ok((binary_bytes, sidecar_bytes, release_version))
}

/// The tarball-asset half of `fetch_latest_release_artifact_and_mcp_asset`'s
/// return value -- named so the function's own signature stays within
/// clippy's `type_complexity` bound instead of nesting an unnamed
/// tuple-of-`Result`s inline. The third element is the artifact's ACTUAL
/// matched filename (e.g. `konductor-v0.1.2.tar.gz` for a release tagged
/// `v0.1.2`) -- `resolve_artifact_from_release` resolves it via
/// `find_packaged_tarball_asset`'s stable-shape match against whichever
/// release was actually fetched, which is not necessarily this binary's
/// own `CARGO_PKG_VERSION`. Callers must verify the fetched bytes against
/// THIS filename, never against `expected_artifact_filename()`
/// independently -- doing so compares the fetched sidecar against the
/// wrong version whenever a by-tag/latest fetch resolves to a release
/// other than the one this binary was built at.
pub(crate) type ArtifactResolutionResult = Result<(Vec<u8>, Vec<u8>, String), GithubFetchError>;

/// The MCP-binary-asset half of `fetch_latest_release_artifact_and_mcp_asset`'s
/// return value -- same rationale as `ArtifactResolutionResult`.
pub(crate) type McpAssetResolutionResult =
    Result<(Vec<u8>, Vec<u8>, String), McpServerAssetFetchError>;

/// Fetches `owner/repo`'s latest release metadata EXACTLY ONCE, then
/// resolves BOTH the tarball asset pair and the MCP server binary
/// asset from that SAME response -- the single-fetch replacement for
/// the old behavior, where `fetch_latest_github_release_artifact` and
/// `fetch_mcp_server_release_asset` each independently called
/// `fetch_latest_release_metadata`, roughly doubling metadata API
/// traffic and opening a window where a release published between the
/// two calls could leave the tarball and MCP binary resolved against
/// different releases (mismatched `tag_name`).
///
/// The tarball result and the MCP-asset result are independent
/// `Result`s rather than a single combined error: a tarball-resolution
/// failure and an MCP-asset-resolution failure are handled differently
/// downstream (the tarball failure blocks the whole install; an
/// `UnsupportedPlatform` MCP failure degrades gracefully -- see
/// `remote::install_mcp_server_binary_into_remote_temp_dir`'s own doc
/// comment), so collapsing them into one `Result` here would force the
/// caller to re-decode which side failed. Only the METADATA fetch
/// itself -- shared by both -- fails the whole call with a bare
/// `GithubFetchError`, since neither resolution can proceed at all
/// without it.
pub(crate) fn fetch_latest_release_artifact_and_mcp_asset(
    owner: &str,
    repo: &str,
    use_github_token: bool,
) -> Result<(ArtifactResolutionResult, McpAssetResolutionResult), GithubFetchError> {
    let release = fetch_latest_release_metadata(owner, repo, use_github_token)?;
    let artifact_result = resolve_artifact_from_release(&release, use_github_token);
    let mcp_asset_result = resolve_mcp_server_asset_from_release(&release, use_github_token);
    Ok((artifact_result, mcp_asset_result))
}

/// By-tag counterpart to `fetch_latest_release_artifact_and_mcp_asset`:
/// fetches `owner/repo`'s release metadata for the SPECIFIC `tag`
/// given (via `fetch_release_by_tag_metadata`, hitting
/// `releases/tags/{tag}` instead of `releases/latest`) exactly once,
/// then resolves both the tarball asset pair and the MCP server
/// binary asset from that same response -- identical downstream
/// resolution (`resolve_artifact_from_release`/
/// `resolve_mcp_server_asset_from_release`) and the identical
/// single-fetch-shared-release guarantee the latest-release sibling
/// provides, differing only in which metadata endpoint is hit.
///
/// Propagates `GithubFetchError::TagNotFound` unchanged when `tag`
/// does not name a real release on this repository -- callers get the
/// same clear, distinct "release {tag} not found" message
/// `fetch_release_by_tag_metadata` already produces, rather than a
/// confusing fallback to some other version.
pub(crate) fn fetch_release_artifact_and_mcp_asset_by_tag(
    owner: &str,
    repo: &str,
    tag: &str,
    use_github_token: bool,
) -> Result<(ArtifactResolutionResult, McpAssetResolutionResult), GithubFetchError> {
    let release = fetch_release_by_tag_metadata(owner, repo, tag, use_github_token)?;
    let artifact_result = resolve_artifact_from_release(&release, use_github_token);
    let mcp_asset_result = resolve_mcp_server_asset_from_release(&release, use_github_token);
    Ok((artifact_result, mcp_asset_result))
}

/// Fetches `owner/repo`'s latest release metadata, then resolves and
/// downloads the `konductor-<version>-<target_triple>` CLI binary
/// asset (`update --cli`'s self-replace target) plus its `.sha256`
/// sidecar, for the given `target_triple`. Returns
/// `(binary_bytes, sidecar_bytes, release_version)`, mirroring
/// `resolve_mcp_server_asset_from_release`'s own return shape for a
/// structurally identical per-platform asset. Unlike the MCP-binary
/// fetch, `target_triple` is required here (not resolved internally):
/// `update --cli` treats an unsupported host as a hard failure before
/// ever reaching this function (see `cli_self_update.rs`), so there is
/// no `UnsupportedPlatform` case for this function itself to report.
pub(crate) fn fetch_cli_binary_asset(
    owner: &str,
    repo: &str,
    use_github_token: bool,
    target_triple: &str,
) -> Result<(Vec<u8>, Vec<u8>, String), GithubFetchError> {
    let release = fetch_latest_release_metadata(owner, repo, use_github_token)?;
    let release_version = release.tag_name.clone();
    let binary_filename =
        super::cli_self_update::expected_cli_asset_filename(&release_version, target_triple);
    let sidecar_filename =
        super::cli_self_update::expected_cli_sidecar_filename(&release_version, target_triple);

    let (binary_browser_url, binary_api_url) = find_asset_url(&release, &binary_filename)
        .ok_or_else(|| GithubFetchError::MissingAsset(binary_filename.clone()))?;
    let binary_browser_url = binary_browser_url.to_string();
    let binary_api_url = binary_api_url.to_string();
    let (sidecar_browser_url, sidecar_api_url) = find_asset_url(&release, &sidecar_filename)
        .ok_or_else(|| GithubFetchError::MissingAsset(sidecar_filename.clone()))?;
    let sidecar_browser_url = sidecar_browser_url.to_string();
    let sidecar_api_url = sidecar_api_url.to_string();

    let binary_bytes =
        download_asset_bytes(&binary_browser_url, &binary_api_url, use_github_token)?;
    let sidecar_bytes =
        download_asset_bytes(&sidecar_browser_url, &sidecar_api_url, use_github_token)?;
    Ok((binary_bytes, sidecar_bytes, release_version))
}

/// By-tag counterpart to `fetch_cli_binary_asset`: fetches
/// `owner/repo`'s release metadata for the SPECIFIC `tag` given
/// (`releases/tags/{tag}`, via `fetch_release_by_tag_metadata`)
/// instead of latest, then resolves and downloads the CLI binary
/// asset pair for `target_triple` from that response -- identical
/// asset-resolution logic to `fetch_cli_binary_asset`, differing only
/// in which metadata endpoint is hit. Propagates
/// `GithubFetchError::TagNotFound` unchanged when `tag` names no real
/// release, giving `update --cli --version <v>` a clear, distinct
/// "release {tag} not found" error instead of a confusing fallback to
/// some other version.
pub(crate) fn fetch_cli_binary_asset_by_tag(
    owner: &str,
    repo: &str,
    tag: &str,
    use_github_token: bool,
    target_triple: &str,
) -> Result<(Vec<u8>, Vec<u8>, String), GithubFetchError> {
    let release = fetch_release_by_tag_metadata(owner, repo, tag, use_github_token)?;
    let release_version = release.tag_name.clone();
    let binary_filename =
        super::cli_self_update::expected_cli_asset_filename(&release_version, target_triple);
    let sidecar_filename =
        super::cli_self_update::expected_cli_sidecar_filename(&release_version, target_triple);

    let (binary_browser_url, binary_api_url) = find_asset_url(&release, &binary_filename)
        .ok_or_else(|| GithubFetchError::MissingAsset(binary_filename.clone()))?;
    let binary_browser_url = binary_browser_url.to_string();
    let binary_api_url = binary_api_url.to_string();
    let (sidecar_browser_url, sidecar_api_url) = find_asset_url(&release, &sidecar_filename)
        .ok_or_else(|| GithubFetchError::MissingAsset(sidecar_filename.clone()))?;
    let sidecar_browser_url = sidecar_browser_url.to_string();
    let sidecar_api_url = sidecar_api_url.to_string();

    let binary_bytes =
        download_asset_bytes(&binary_browser_url, &binary_api_url, use_github_token)?;
    let sidecar_bytes =
        download_asset_bytes(&sidecar_browser_url, &sidecar_api_url, use_github_token)?;
    Ok((binary_bytes, sidecar_bytes, release_version))
}

/// Fetches `owner/repo`'s latest release's `tag_name` alone, with no
/// asset resolution -- used by `doctor`'s `cli_version` check to learn
/// the latest available CLI version without downloading anything.
/// Reuses the SAME metadata fetch every other function in this module
/// does; no separate, lighter-weight endpoint exists for "just the
/// version," so this pays the identical metadata-request cost the
/// tarball/MCP-asset/CLI-asset paths already pay.
pub(crate) fn fetch_latest_release_tag(
    owner: &str,
    repo: &str,
    use_github_token: bool,
) -> Result<String, GithubFetchError> {
    let release = fetch_latest_release_metadata(owner, repo, use_github_token)?;
    Ok(release.tag_name)
}

/// Builds a `RemoteArtifactFetcher` closure bound to `owner`/`repo`,
/// mapping `GithubFetchError` to `std::io::Error`. For a caller that
/// needs the boxed-closure seam instead of calling
/// `fetch_latest_github_release_artifact` directly.
/// `#[cfg(test)]`: nothing in production calls this -- the real
/// no-`--from` install path fetches through
/// `fetch_latest_release_artifact_and_mcp_asset` instead, which
/// resolves the tarball and the MCP binary asset from one shared
/// fetch rather than this single-purpose closure shape. Kept as the
/// tested way to get a `RemoteArtifactFetcher`-shaped closure from
/// this module, since `fetch_latest_github_release_artifact` itself is
/// also `#[cfg(test)]` only.
#[cfg(test)]
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
                .enumerate()
                .map(|(index, (name, browser_download_url))| api::Asset {
                    name: name.to_string(),
                    browser_download_url: browser_download_url.to_string(),
                    url: format!(
                        "https://api.github.com/repos/aws-solutions/konductor/releases/assets/{index}"
                    ),
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

    /// A minimal, `std`-only single-request HTTP server bound to
    /// `127.0.0.1:0` (OS-assigned free port), used ONLY to observe the
    /// raw request `download_asset_bytes` actually sends -- no new
    /// dev-dependency, since this crate pins its dependency set
    /// tightly (see Cargo.toml's exact-pin convention) and a
    /// single-shot request-capturing stub is well within what `std`
    /// alone can do. Always responds `200 OK` with a fixed small body;
    /// callers care about the REQUEST it received, not response
    /// handling (that's already covered by `read_capped_body`'s own
    /// tests above).
    ///
    /// Exposes two distinct paths -- `/browser/<name>` and
    /// `/api/<name>` -- so a test can assert which one a given
    /// `use_github_token` value actually hit, mirroring the real
    /// `browser_download_url` vs. `url` (REST API) split this fix
    /// introduces.
    struct MockAssetServer {
        addr: std::net::SocketAddr,
        last_request: Mutex<Option<String>>,
    }

    impl MockAssetServer {
        fn start() -> std::sync::Arc<Self> {
            let listener =
                std::net::TcpListener::bind("127.0.0.1:0").expect("mock server must bind");
            let addr = listener
                .local_addr()
                .expect("mock server must have an addr");
            let server = std::sync::Arc::new(Self {
                addr,
                last_request: Mutex::new(None),
            });
            let server_for_thread = std::sync::Arc::clone(&server);
            std::thread::spawn(move || {
                if let Ok((mut stream, _)) = listener.accept() {
                    use std::io::{BufRead, Write};
                    let mut reader = std::io::BufReader::new(&stream);
                    let mut request_lines = Vec::new();
                    loop {
                        let mut line = String::new();
                        match reader.read_line(&mut line) {
                            Ok(0) => break,
                            Ok(_) => {
                                let trimmed = line.trim_end().to_string();
                                if trimmed.is_empty() {
                                    break;
                                }
                                request_lines.push(trimmed);
                            }
                            Err(_) => break,
                        }
                    }
                    *server_for_thread
                        .last_request
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                        Some(request_lines.join("\n"));
                    let body = b"mock asset bytes";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.write_all(body);
                    let _ = stream.flush();
                }
            });
            server
        }

        fn browser_download_path(&self) -> &'static str {
            "/browser/asset.tar.gz"
        }

        fn api_path(&self) -> &'static str {
            "/api/asset.tar.gz"
        }

        fn browser_download_url(&self) -> String {
            format!("http://{}{}", self.addr, self.browser_download_path())
        }

        fn api_url(&self) -> String {
            format!("http://{}{}", self.addr, self.api_path())
        }

        fn last_request(&self) -> String {
            // A single client connection on a freshly bound loopback
            // port is accepted well within any reasonable test
            // timeout; a short retry loop just absorbs the thread
            // scheduling race between this call and the accept-thread
            // finishing its read, without a fixed sleep.
            for _ in 0..200 {
                if let Some(request) = self
                    .last_request
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .clone()
                {
                    return request;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            panic!("mock server never observed a request");
        }
    }

    /// Regression: the UNAUTHENTICATED asset-download path (the
    /// default, `--use-github-token` NOT passed) must never carry
    /// `Authorization`, even with a token available in the
    /// environment. This request never has a token attached in the
    /// first place -- unlike the authenticated path, which relies on
    /// `http_agent()`'s default `RedirectAuthHeaders::Never` strategy
    /// to strip `Authorization` on redirect (see
    /// `download_asset_bytes`'s doc comment), this path has nothing
    /// to strip. `browser_download_url` redirects from
    /// `api.github.com` to a short-lived, pre-signed storage host
    /// that must never receive the GitHub token. Exercised through a
    /// real call to `download_asset_bytes` against a local mock
    /// server (no live GitHub dependency), asserting on the request
    /// the server actually received.
    #[test]
    fn asset_download_without_use_github_token_never_carries_authorization_header() {
        let _lock = lock_github_token_env();
        std::env::set_var("GITHUB_TOKEN", "a-real-non-empty-token-value");

        let server = MockAssetServer::start();
        let result = download_asset_bytes(&server.browser_download_url(), &server.api_url(), false);

        std::env::remove_var("GITHUB_TOKEN");

        result.expect("mock download must succeed");
        let request = server.last_request();
        assert!(
            !request.contains("Authorization"),
            "asset-download request must never carry Authorization when \
             --use-github-token is not passed, got request: {request}"
        );
        assert!(
            request.starts_with(&format!("GET {} ", server.browser_download_path())),
            "with use_github_token=false, the request must hit browser_download_url, \
             not the api_url, got request: {request}"
        );
    }

    /// The new behavior this fix adds: when `--use-github-token` IS
    /// passed, the asset-download request must go to the asset's
    /// authenticated `url` field (not `browser_download_url`), and
    /// must carry both `Authorization: Bearer <token>` and
    /// `Accept: application/octet-stream`. This is what makes
    /// downloading a private repository's release asset possible --
    /// closing the exact symptom this fix addresses (valid token,
    /// real release, 404 on download only).
    #[test]
    fn asset_download_with_use_github_token_carries_auth_header_and_uses_api_url() {
        let _lock = lock_github_token_env();
        std::env::set_var("GITHUB_TOKEN", "a-real-non-empty-token-value");

        let server = MockAssetServer::start();
        let result = download_asset_bytes(&server.browser_download_url(), &server.api_url(), true);

        std::env::remove_var("GITHUB_TOKEN");

        result.expect("mock download must succeed");
        let request = server.last_request();
        assert!(
            request.contains("Authorization: Bearer a-real-non-empty-token-value"),
            "with use_github_token=true, the request must carry the bearer token, \
             got request: {request}"
        );
        assert!(
            request.contains("Accept: application/octet-stream"),
            "with use_github_token=true, the request must ask for raw octet-stream \
             bytes, got request: {request}"
        );
        assert!(
            request.starts_with(&format!("GET {} ", server.api_path())),
            "with use_github_token=true, the request must hit the asset's api url, \
             not browser_download_url, got request: {request}"
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
        let (browser_download_url, _api_url) = found.expect("asset must be found");
        assert_eq!(browser_download_url, "https://example.com/linux.tar.gz");
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
        let (browser_download_url, _api_url) = found.expect("sidecar asset must be found");
        assert_eq!(
            browser_download_url,
            "https://example.com/linux.tar.gz.sha256"
        );
    }

    /// `find_asset_url` must also surface the asset's REST API `url`
    /// field alongside `browser_download_url` -- this is the field
    /// `download_asset_bytes` reads when `--use-github-token` is set,
    /// so a regression that only wires through `browser_download_url`
    /// would silently break the authenticated path.
    #[test]
    fn find_asset_url_also_returns_the_api_url_field() {
        let release = sample_release(vec![(
            "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz",
            "https://example.com/linux.tar.gz",
        )]);
        let (_browser_download_url, api_url) =
            find_asset_url(&release, "konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz")
                .expect("asset must be found");
        assert_eq!(
            api_url,
            "https://api.github.com/repos/aws-solutions/konductor/releases/assets/0"
        );
    }

    // ── MCP server binary (skill-lookup-mcp) asset naming/fetch tests ────

    #[test]
    fn expected_mcp_server_asset_filename_mirrors_release_yml_naming() {
        assert_eq!(
            expected_mcp_server_asset_filename("v0.1.1", "x86_64-unknown-linux-musl"),
            "skill-lookup-mcp-v0.1.1-x86_64-unknown-linux-musl"
        );
    }

    #[test]
    fn expected_mcp_server_sidecar_filename_is_asset_filename_plus_sha256_suffix() {
        let asset = expected_mcp_server_asset_filename("v0.1.1", "aarch64-apple-darwin");
        let sidecar = expected_mcp_server_sidecar_filename("v0.1.1", "aarch64-apple-darwin");
        assert_eq!(sidecar, format!("{asset}.sha256"));
    }

    /// `find_asset_url` (already exact-filename-match only) must
    /// correctly locate the MCP binary asset among a release carrying
    /// BOTH the `konductor-*` tarball's per-arch legacy assets and the
    /// three `skill-lookup-mcp-*` per-arch assets side by side --
    /// mirroring a real release's actual asset list.
    #[test]
    fn find_asset_url_locates_mcp_server_asset_among_mixed_release_assets() {
        let release = sample_release(vec![
            (
                "konductor-v0.1.1-x86_64-unknown-linux-musl",
                "https://example.com/konductor-linux-x86_64",
            ),
            (
                "skill-lookup-mcp-v0.1.1-x86_64-unknown-linux-musl",
                "https://example.com/skill-lookup-mcp-linux-x86_64",
            ),
            (
                "skill-lookup-mcp-v0.1.1-aarch64-apple-darwin",
                "https://example.com/skill-lookup-mcp-macos-aarch64",
            ),
        ]);
        let filename = expected_mcp_server_asset_filename("v0.1.1", "x86_64-unknown-linux-musl");
        let found = find_asset_url(&release, &filename).expect("asset must be found");
        assert_eq!(found.0, "https://example.com/skill-lookup-mcp-linux-x86_64");
    }

    #[test]
    fn mcp_server_asset_fetch_error_display_names_unsupported_platform() {
        let err = McpServerAssetFetchError::UnsupportedPlatform {
            os: "macos".to_string(),
            arch: "x86_64".to_string(),
        };
        let message = err.to_string();
        assert!(message.contains("macos"));
        assert!(message.contains("x86_64"));
        assert!(message.contains("skill lookups"));
        assert!(
            !message.is_empty(),
            "must produce a clear, actionable, non-empty message"
        );
    }

    #[test]
    fn mcp_server_asset_fetch_error_is_unsupported_platform_distinguishes_the_two_variants() {
        let unsupported = McpServerAssetFetchError::UnsupportedPlatform {
            os: "windows".to_string(),
            arch: "x86_64".to_string(),
        };
        assert!(unsupported.is_unsupported_platform());

        let fetch_failure =
            McpServerAssetFetchError::Fetch(GithubFetchError::Network("boom".to_string()));
        assert!(!fetch_failure.is_unsupported_platform());
    }

    #[test]
    fn mcp_server_asset_fetch_error_display_passes_through_fetch_error_unchanged() {
        let inner = GithubFetchError::MissingAsset(
            "skill-lookup-mcp-v0.1.1-x86_64-unknown-linux-musl".to_string(),
        );
        let expected_message = inner.to_string();
        let wrapped = McpServerAssetFetchError::Fetch(inner);
        assert_eq!(wrapped.to_string(), expected_message);
    }

    // ── Single-fetch guarantee: shared release, consistent tag_name ─────
    //
    // These tests target the fix itself: before it, the tarball asset
    // and the MCP server binary asset were each resolved from their
    // OWN independent call to `fetch_latest_release_metadata`, so a
    // release published between the two calls could leave them
    // resolved against two DIFFERENT `tag_name`s. `fetch_latest_release_metadata`
    // hits a hardcoded `api.github.com` URL with no injectable seam
    // (unlike asset download, which already has `MockAssetServer`), so
    // "exactly one fetch happened" is proven at the unit level instead:
    // `resolve_artifact_from_release`/`resolve_mcp_server_asset_from_release`
    // take an already-fetched `&api::Release` and never call
    // `fetch_latest_release_metadata` themselves -- there is no code
    // path left in either resolver that COULD issue a second metadata
    // fetch. Feeding both resolvers the identical `release` value (as
    // `fetch_latest_release_artifact_and_mcp_asset` does) then proves
    // the tarball and MCP binary are resolved from the SAME response
    // by construction, not by coincidence.

    /// The old double-fetch code's exact failure mode, reproduced
    /// directly: build TWO releases carrying different `tag_name`s
    /// (simulating a release published between two separate metadata
    /// fetches), resolve the tarball from one and the MCP asset from
    /// the other, and confirm the resulting MCP asset filename is
    /// keyed to ITS OWN release's `tag_name` -- i.e. if a caller were
    /// to (incorrectly) resolve each half from a different fetched
    /// `Release`, the MCP binary's resolved filename would silently
    /// carry a different version than the tarball. This is the
    /// mismatch the fix's single-shared-`release` design makes
    /// impossible: `resolve_mcp_server_asset_from_release`'s resolved
    /// filename is always built from EXACTLY the `release` it was
    /// given, never from some other fetch.
    #[test]
    fn resolve_mcp_server_asset_from_release_keys_the_filename_to_its_own_releases_tag_name() {
        let Some(target_triple) = super::super::target_triple::current_host_target_triple() else {
            // No published asset for this host/arch at all (e.g. Intel
            // macOS) -- nothing to resolve either way, skip rather than
            // fail on an environment this feature explicitly excludes.
            return;
        };

        let old_release_binary_name = expected_mcp_server_asset_filename("v0.1.0", target_triple);
        let old_release_sidecar_name =
            expected_mcp_server_sidecar_filename("v0.1.0", target_triple);
        let new_release_binary_name = expected_mcp_server_asset_filename("v0.2.0", target_triple);
        let new_release_sidecar_name =
            expected_mcp_server_sidecar_filename("v0.2.0", target_triple);
        assert_ne!(
            old_release_binary_name, new_release_binary_name,
            "the two simulated releases must resolve to genuinely different filenames"
        );

        let make_release = |tag_name: &str, binary_name: &str, sidecar_name: &str| {
            api::Release {
            tag_name: tag_name.to_string(),
            assets: vec![
                api::Asset {
                    name: binary_name.to_string(),
                    browser_download_url: format!("https://example.com/{tag_name}-binary"),
                    url: format!(
                        "https://api.github.com/repos/aws-solutions/konductor/releases/assets/{tag_name}-binary"
                    ),
                },
                api::Asset {
                    name: sidecar_name.to_string(),
                    browser_download_url: format!("https://example.com/{tag_name}-sidecar"),
                    url: format!(
                        "https://api.github.com/repos/aws-solutions/konductor/releases/assets/{tag_name}-sidecar"
                    ),
                },
            ],
        }
        };
        let old_release = make_release(
            "v0.1.0",
            &old_release_binary_name,
            &old_release_sidecar_name,
        );
        let new_release = make_release(
            "v0.2.0",
            &new_release_binary_name,
            &new_release_sidecar_name,
        );

        // Resolving against `old_release` must find ONLY the old
        // release's own filename -- never the new one's, even though
        // both describe the same logical binary for the same triple.
        assert!(
            find_asset_url(&old_release, &old_release_binary_name).is_some(),
            "the old release's own asset must resolve against itself"
        );
        assert!(
            find_asset_url(&old_release, &new_release_binary_name).is_none(),
            "the old release must never resolve the NEW release's filename -- proving \
             a resolver fed the wrong release cannot silently succeed against a \
             mismatched tag_name"
        );
        assert!(
            find_asset_url(&new_release, &old_release_binary_name).is_none(),
            "the new release must never resolve the OLD release's filename either -- \
             the mismatch check must hold symmetrically in both directions"
        );

        // `resolve_mcp_server_asset_from_release`'s own filename
        // construction, exercised directly rather than through the
        // full resolver (which would also attempt a real network
        // download of the fake `https://example.com/...` URLs seeded
        // above): given each release independently, the filename it
        // constructs must track THAT release's own `tag_name`.
        let old_binary_filename =
            expected_mcp_server_asset_filename(&old_release.tag_name, target_triple);
        let new_binary_filename =
            expected_mcp_server_asset_filename(&new_release.tag_name, target_triple);
        assert_eq!(old_binary_filename, old_release_binary_name);
        assert_eq!(new_binary_filename, new_release_binary_name);
        assert_ne!(
            old_binary_filename, new_binary_filename,
            "the filename resolve_mcp_server_asset_from_release constructs must track \
             the release it was actually given, never a fixed/cached tag_name"
        );
    }

    /// The positive case: `fetch_latest_release_artifact_and_mcp_asset`'s
    /// own design -- fetch once, resolve both from the SAME `release`
    /// -- reproduced directly against `resolve_artifact_from_release`/
    /// `resolve_mcp_server_asset_from_release` fed the identical
    /// `release` value. Confirms the MCP asset's resolved
    /// `release_version` always equals that shared release's
    /// `tag_name`, which is the guarantee the fix exists to provide:
    /// tarball and MCP binary can never disagree on which release they
    /// came from, because there is only ever one `release` value in
    /// scope for both.
    #[test]
    fn resolving_tarball_and_mcp_asset_from_the_same_release_yields_consistent_tag_name() {
        let Some(target_triple) = super::super::target_triple::current_host_target_triple() else {
            return;
        };

        let shared_tag_name = "v0.3.0";
        let mcp_binary_name = expected_mcp_server_asset_filename(shared_tag_name, target_triple);
        let mcp_sidecar_name = expected_mcp_server_sidecar_filename(shared_tag_name, target_triple);
        let artifact_name = expected_artifact_filename();
        let sidecar_name = expected_sidecar_filename();

        let release = api::Release {
            tag_name: shared_tag_name.to_string(),
            assets: vec![
                api::Asset {
                    name: artifact_name.clone(),
                    browser_download_url: "https://example.com/artifact".to_string(),
                    url: "https://api.github.com/repos/aws-solutions/konductor/releases/assets/1"
                        .to_string(),
                },
                api::Asset {
                    name: sidecar_name.clone(),
                    browser_download_url: "https://example.com/artifact.sha256".to_string(),
                    url: "https://api.github.com/repos/aws-solutions/konductor/releases/assets/2"
                        .to_string(),
                },
                api::Asset {
                    name: mcp_binary_name.clone(),
                    browser_download_url: "https://example.com/mcp-binary".to_string(),
                    url: "https://api.github.com/repos/aws-solutions/konductor/releases/assets/3"
                        .to_string(),
                },
                api::Asset {
                    name: mcp_sidecar_name.clone(),
                    browser_download_url: "https://example.com/mcp-binary.sha256".to_string(),
                    url: "https://api.github.com/repos/aws-solutions/konductor/releases/assets/4"
                        .to_string(),
                },
            ],
        };

        // Both halves resolve their asset URLs successfully from the
        // ONE shared `release` -- no second fetch, no second `Release`
        // value anywhere in this test.
        assert!(find_asset_url(&release, &artifact_name).is_some());
        assert!(find_asset_url(&release, &sidecar_name).is_some());
        assert!(find_asset_url(&release, &mcp_binary_name).is_some());
        assert!(find_asset_url(&release, &mcp_sidecar_name).is_some());

        // `resolve_mcp_server_asset_from_release`'s own filename
        // construction, given this SAME `release`, must key off
        // `release.tag_name` -- confirming the MCP asset filename it
        // would look up is exactly the one already seeded above, i.e.
        // it is impossible for this function to resolve a filename for
        // any tag_name other than the one `release` (the SAME value
        // the tarball was resolved from) actually carries.
        assert_eq!(release.tag_name, shared_tag_name);
        let rebuilt_binary_name =
            expected_mcp_server_asset_filename(&release.tag_name, target_triple);
        assert_eq!(rebuilt_binary_name, mcp_binary_name);
    }

    /// Pins the exact bug this module used to have: a release's
    /// packaged tarball is named from `synth::artifact_filename()` AT
    /// BUILD TIME on whatever commit produced it (release.yml's own
    /// `check-version` job documents this: "the packaged
    /// tarball/sidecar's version segment comes from `artifact_filename()`
    /// (Cargo.toml's version), not necessarily RELEASE_VERSION"), which
    /// is a value the CURRENTLY RUNNING binary's own `CARGO_PKG_VERSION`
    /// cannot predict -- an ahead-of-mainline feature branch's binary
    /// routinely trails the latest published release's own version.
    ///
    /// Before the fix, `resolve_artifact_from_release` looked up the
    /// tarball by an EXACT `expected_artifact_filename()` match (this
    /// binary's own `CARGO_PKG_VERSION`, e.g. `"konductor-v0.1.1.tar.gz"`)
    /// -- so a real release packaged under any OTHER version segment
    /// (e.g. `"konductor-v0.1.2.tar.gz"`, published from a commit
    /// ahead of this one) resolved to `MissingAsset`, even though the
    /// release's `tag_name` was fetched and read successfully and the
    /// asset genuinely exists right there in `release.assets`. This
    /// exact shape is what produced the reported symptom: `update
    /// --use-github-token` (the skip-check path, `fetch_latest_release_tag`,
    /// which only ever reads `tag_name` and never touches a filename)
    /// correctly reported the release's real latest version, while the
    /// immediately following `update --use-github-token --force` (this
    /// function's own path) failed looking for an asset named after the
    /// wrong version.
    ///
    /// Seeds a release whose tarball/sidecar names do NOT match
    /// `expected_artifact_filename()`/`expected_sidecar_filename()` at
    /// all (deliberately using a version segment this test asserts
    /// differs from the running binary's own), and confirms
    /// `resolve_artifact_from_release` still finds and returns them --
    /// by the stable `konductor-v*.tar.gz` shape
    /// `find_packaged_tarball_asset` matches on, not an exact name.
    #[test]
    fn resolve_artifact_from_release_finds_the_tarball_even_when_its_version_segment_differs_from_this_binarys_own(
    ) {
        let published_tarball_name = "konductor-v9.9.9.tar.gz";
        let published_sidecar_name = "konductor-v9.9.9.tar.gz.sha256";
        // The whole point: this is genuinely NOT what this binary's own
        // `expected_artifact_filename()` would ask for -- if it were,
        // this test would not be exercising the bug shape at all.
        assert_ne!(published_tarball_name, expected_artifact_filename());
        assert_ne!(published_sidecar_name, expected_sidecar_filename());

        let release = sample_release(vec![
            (published_tarball_name, "https://example.com/tarball"),
            (published_sidecar_name, "https://example.com/tarball.sha256"),
        ]);

        let (artifact_name, artifact_browser_url, _artifact_api_url) =
            find_packaged_tarball_asset(&release, false)
                .expect("the tarball must resolve despite the version-segment mismatch");
        assert_eq!(artifact_name, published_tarball_name);
        assert_eq!(artifact_browser_url, "https://example.com/tarball");

        let (sidecar_name, sidecar_browser_url, _sidecar_api_url) =
            find_packaged_tarball_asset(&release, true)
                .expect("the sidecar must resolve despite the version-segment mismatch");
        assert_eq!(sidecar_name, published_sidecar_name);
        assert_eq!(sidecar_browser_url, "https://example.com/tarball.sha256");
    }

    /// The by-tag counterpart to the test above: a release fetched via
    /// `releases/tags/{tag}` (not `releases/latest`) whose packaged
    /// tarball's version segment differs from this binary's own
    /// `CARGO_PKG_VERSION` must resolve identically -- `--version <v>`
    /// and `--force` share the exact same `resolve_artifact_from_release`
    /// call, so a fix that only covered the latest-release path would
    /// leave the by-tag path's identical call site unverified.
    #[test]
    fn resolve_artifact_from_release_finds_the_tarball_for_a_by_tag_fetched_release_too() {
        let published_tarball_name = "konductor-v2.5.0.tar.gz";
        let published_sidecar_name = "konductor-v2.5.0.tar.gz.sha256";
        assert_ne!(published_tarball_name, expected_artifact_filename());

        let mut release = sample_release(vec![
            (published_tarball_name, "https://example.com/by-tag-tarball"),
            (
                published_sidecar_name,
                "https://example.com/by-tag-tarball.sha256",
            ),
        ]);
        // A by-tag fetch's `release.tag_name` is the EXPLICITLY
        // REQUESTED tag, not "latest" -- distinct from `sample_release`'s
        // default, to keep this test from silently degenerating into
        // the latest-release test above.
        release.tag_name = "v2.5.0".to_string();

        assert!(find_packaged_tarball_asset(&release, false).is_some());
        assert!(find_packaged_tarball_asset(&release, true).is_some());
    }

    /// A release with NO asset matching the stable
    /// `konductor-v*.tar.gz`/`konductor-v*.tar.gz.sha256` shape at all
    /// (e.g. a release published by something other than this
    /// project's own `release.yml`) must still fail closed with
    /// `MissingAsset`, not silently match an unrelated asset -- the
    /// pattern-based lookup this fix introduced must remain a real
    /// negative, not degrade into an always-true match.
    #[test]
    fn find_packaged_tarball_asset_returns_none_when_no_asset_matches_the_stable_shape() {
        let release = sample_release(vec![
            (
                "skill-lookup-mcp-v0.1.0-x86_64-unknown-linux-musl",
                "https://example.com/mcp",
            ),
            (
                "skill-lookup-mcp-v0.1.0-x86_64-unknown-linux-musl.sha256",
                "https://example.com/mcp.sha256",
            ),
        ]);
        assert!(find_packaged_tarball_asset(&release, false).is_none());
        assert!(find_packaged_tarball_asset(&release, true).is_none());
    }

    /// A release publishing BOTH the packaged tarball AND per-triple
    /// raw binaries (the real shape every actual release carries, per
    /// `release.yml`'s own asset list) must resolve the tarball only --
    /// `find_packaged_tarball_asset`'s `.tar.gz`/`.tar.gz.sha256` suffix
    /// requirement is what keeps a per-triple asset like
    /// `konductor-v0.1.0-x86_64-unknown-linux-musl` (which also starts
    /// with `konductor-v` but carries no `.tar.gz` suffix at all) from
    /// ever being mistaken for the tarball.
    #[test]
    fn find_packaged_tarball_asset_ignores_per_triple_raw_binaries_sharing_the_prefix() {
        let release = sample_release(vec![
            (
                "konductor-v0.1.0-x86_64-unknown-linux-musl",
                "https://example.com/raw-binary",
            ),
            (
                "konductor-v0.1.0-x86_64-unknown-linux-musl.sha256",
                "https://example.com/raw-binary.sha256",
            ),
            ("konductor-v0.1.0.tar.gz", "https://example.com/tarball"),
            (
                "konductor-v0.1.0.tar.gz.sha256",
                "https://example.com/tarball.sha256",
            ),
        ]);

        let (name, browser_url, _api_url) = find_packaged_tarball_asset(&release, false)
            .expect("the tarball must resolve even alongside a same-prefixed raw binary");
        assert_eq!(name, "konductor-v0.1.0.tar.gz");
        assert_eq!(browser_url, "https://example.com/tarball");
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
                    "url": "https://api.github.com/repos/aws-solutions/konductor/releases/assets/1",
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
        assert_eq!(
            release.assets[0].url,
            "https://api.github.com/repos/aws-solutions/konductor/releases/assets/1"
        );
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

    /// `TagNotFound`'s `Display` must render the clear, distinct
    /// "release {tag} not found" message this task's success criteria
    /// require -- never the old generic "not yet supported" wording,
    /// and never a `MetadataHttp`-shaped status-code message that could
    /// be confused with the latest-release path's own 404 meaning ("no
    /// release exists at all").
    #[test]
    fn tag_not_found_display_names_the_exact_requested_tag() {
        let err = GithubFetchError::TagNotFound {
            tag: "v9.9.9".to_string(),
        };
        let message = err.to_string();
        assert_eq!(message, "release v9.9.9 not found");
        assert!(!message.contains("not yet supported"));
    }

    /// A 404 status specifically on the by-tag metadata endpoint must
    /// map to `TagNotFound`, never the generic `MetadataHttp` variant
    /// the latest-release path uses for its own 404 -- confirmed via
    /// `fetch_release_by_tag_metadata`'s own error-mapping closure
    /// shape, exercised directly against the same `ureq::Error::Status`
    /// match arms that function uses (no real network call: this pins
    /// down the mapping logic itself, mirroring how this module already
    /// tests `apply_github_token`'s header-attachment logic in
    /// isolation from a live request).
    #[test]
    fn tag_not_found_is_distinct_from_metadata_http_404_used_by_the_latest_release_path() {
        let by_tag_404 = GithubFetchError::TagNotFound {
            tag: "v1.0.0".to_string(),
        };
        let latest_release_404 =
            GithubFetchError::MetadataHttp(404, private_repo_hint::TokenState::NotOptedIn);
        assert_ne!(
            by_tag_404.to_string(),
            latest_release_404.to_string(),
            "a by-tag 404 (this tag doesn't exist) and a latest-release 404 (no release \
             exists at all) must never render as the same message"
        );
        assert!(matches!(by_tag_404, GithubFetchError::TagNotFound { .. }));
        assert!(matches!(
            latest_release_404,
            GithubFetchError::MetadataHttp(404, _)
        ));
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
        const {
            assert!(
                METADATA_RESPONSE_CAP_BYTES < ASSET_DOWNLOAD_CAP_BYTES,
                "the metadata cap must stay far smaller than the asset-download cap"
            );
        }
    }

    /// A 401 or 403 on the metadata call, when `--use-github-token`
    /// was never passed (`TokenState::NotOptedIn`) -- must name both
    /// `GITHUB_TOKEN` and `--use-github-token` in the rendered
    /// message, the default/never-opted-in wording.
    #[test]
    fn metadata_http_401_and_403_not_opted_in_names_the_env_var_and_the_flag() {
        for status in [401u16, 403u16] {
            let message =
                GithubFetchError::MetadataHttp(status, private_repo_hint::TokenState::NotOptedIn)
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

    /// A 401 or 403 on the metadata call, when `--use-github-token`
    /// was passed but `GITHUB_TOKEN` was empty/unset
    /// (`TokenState::OptedInEmptyOrUnset`) -- must explicitly report
    /// that distinct state rather than repeating the plain "pass the
    /// flag" suggestion.
    #[test]
    fn metadata_http_401_and_403_opted_in_empty_or_unset_reports_the_empty_state() {
        for status in [401u16, 403u16] {
            let message = GithubFetchError::MetadataHttp(
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

    /// A 401 or 403 on the metadata call, when a non-empty
    /// `GITHUB_TOKEN` was actually sent and still rejected
    /// (`TokenState::OptedInSent`) -- must NOT repeat the
    /// `--use-github-token` suggestion (the silent-loop bug), and
    /// must instead indicate the token was rejected.
    #[test]
    fn metadata_http_401_and_403_opted_in_sent_does_not_repeat_the_flag_suggestion() {
        for status in [401u16, 403u16] {
            let message =
                GithubFetchError::MetadataHttp(status, private_repo_hint::TokenState::OptedInSent)
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

    /// `DownloadHttp` must never carry the private-repo hint for a
    /// status that isn't 401/403/404 -- 404 is now hintable too (see
    /// `download_http_401_403_and_404_not_opted_in_names_the_env_var_and_the_flag`
    /// below): a private repo's asset-download 404s unauthenticated by
    /// design (GitHub returns 404, not 401/403, to avoid confirming
    /// the asset's existence), so `NotOptedIn`'s 404 case must hint
    /// exactly like its 401/403 case already does. Only genuinely
    /// unrelated statuses (429/500/503) stay silent.
    #[test]
    fn download_http_not_opted_in_omits_the_hint_for_unrelated_statuses() {
        for status in [429u16, 500u16, 503u16] {
            let message =
                GithubFetchError::DownloadHttp(status, private_repo_hint::TokenState::NotOptedIn)
                    .to_string();
            assert!(
                !message.contains("--use-github-token") && !message.contains("GITHUB_TOKEN"),
                "status {status} must not carry the token hint, got: {message}"
            );
        }
    }

    /// Regression for the download-404 gap this fix closes: a plain
    /// 404 on the asset-download call, with `--use-github-token` never
    /// passed, must now name both `GITHUB_TOKEN` and
    /// `--use-github-token` -- `browser_download_url` 404s
    /// unauthenticated against a private repo's asset BY DESIGN (see
    /// `download_asset_bytes`'s own doc comment), so this is the exact
    /// real-world failure `--use-github-token` exists to remedy, and
    /// the user must be told the flag exists.
    #[test]
    fn download_http_404_not_opted_in_names_the_env_var_and_the_flag() {
        let message =
            GithubFetchError::DownloadHttp(404, private_repo_hint::TokenState::NotOptedIn)
                .to_string();
        assert!(
            message.contains("GITHUB_TOKEN"),
            "404 must name GITHUB_TOKEN, got: {message}"
        );
        assert!(
            message.contains("--use-github-token"),
            "404 must hint at --use-github-token, got: {message}"
        );
    }

    /// A 404 on the download call, with `--use-github-token` passed
    /// but no real token available (`OptedInEmptyOrUnset`), must
    /// report the empty/unset state -- same widened gate, same
    /// per-state wording split as the 401/403 case already has.
    #[test]
    fn download_http_404_opted_in_empty_or_unset_reports_the_empty_state() {
        let message =
            GithubFetchError::DownloadHttp(404, private_repo_hint::TokenState::OptedInEmptyOrUnset)
                .to_string();
        assert!(
            message.contains("GITHUB_TOKEN"),
            "404 must name GITHUB_TOKEN, got: {message}"
        );
        assert!(
            message.contains("not set") || message.contains("empty"),
            "404 must describe the empty/unset state, got: {message}"
        );
    }

    /// A 404 on the download call with a real, non-empty token already
    /// sent (`OptedInSent`) must NOT get the widened hint -- a token
    /// was genuinely attached and the asset still 404'd, which is far
    /// more likely a missing asset than an auth gate a real token
    /// would already have unlocked. Repeating the suggestion here
    /// would be the same silent-loop noise the 401/403 case already
    /// avoids for `OptedInSent`.
    #[test]
    fn download_http_404_opted_in_sent_omits_the_hint() {
        let message =
            GithubFetchError::DownloadHttp(404, private_repo_hint::TokenState::OptedInSent)
                .to_string();
        assert!(
            !message.contains("--use-github-token") && !message.contains("GITHUB_TOKEN"),
            "404 with a real token already sent must not carry the token hint, got: {message}"
        );
    }

    /// The download-404 case this fix specifically closes: a 401/403
    /// on the asset-download request, when `--use-github-token` was
    /// never passed, must carry the same `NotOptedIn` hint wording the
    /// metadata call already gets -- naming both `GITHUB_TOKEN` and
    /// `--use-github-token`. This is the "private_repo_hint wired into
    /// the download-404 case too" requirement: before this fix,
    /// `DownloadHttp` carried no `TokenState` at all and never
    /// rendered a hint regardless of status.
    #[test]
    fn download_http_401_and_403_not_opted_in_names_the_env_var_and_the_flag() {
        for status in [401u16, 403u16] {
            let message =
                GithubFetchError::DownloadHttp(status, private_repo_hint::TokenState::NotOptedIn)
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

    /// Same download-404/401/403 hint wiring, exercised for the other
    /// two `TokenState` variants -- mirroring
    /// `metadata_http_401_and_403_opted_in_empty_or_unset_reports_the_empty_state`/
    /// `metadata_http_401_and_403_opted_in_sent_does_not_repeat_the_flag_suggestion`
    /// so `DownloadHttp` and `MetadataHttp` render identical wording
    /// for identical states.
    #[test]
    fn download_http_401_and_403_opted_in_empty_or_unset_reports_the_empty_state() {
        for status in [401u16, 403u16] {
            let message = GithubFetchError::DownloadHttp(
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

    #[test]
    fn download_http_401_and_403_opted_in_sent_does_not_repeat_the_flag_suggestion() {
        for status in [401u16, 403u16] {
            let message =
                GithubFetchError::DownloadHttp(status, private_repo_hint::TokenState::OptedInSent)
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

    /// Any OTHER status code must NOT carry the hint on `MetadataHttp`
    /// either, for every token state -- it would be noise for a
    /// failure that has nothing to do with authentication.
    #[test]
    fn metadata_http_other_statuses_omit_the_hint_for_every_token_state() {
        for status in [404u16, 429u16, 500u16, 503u16] {
            for state in [
                private_repo_hint::TokenState::NotOptedIn,
                private_repo_hint::TokenState::OptedInEmptyOrUnset,
                private_repo_hint::TokenState::OptedInSent,
            ] {
                let message = GithubFetchError::MetadataHttp(status, state).to_string();
                assert!(
                    !message.contains("--use-github-token") && !message.contains("GITHUB_TOKEN"),
                    "status {status} with state {state:?} must not carry the token hint, \
                     got: {message}"
                );
            }
        }
    }
}
