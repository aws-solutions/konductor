// SPDX-License-Identifier: Apache-2.0
//
// install/remote.rs — bytes-in-hand remote install: verify -> unpack
// -> reuse `InstallStrategy::install_from_local`. Reached from
// `dispatch_install_with`'s no-`--from` branch via
// `install::remote_orchestrate::install_from_latest_github_release`,
// which does the real HTTP fetch (`install::github`) before handing
// off here. See `install::github`'s own module doc for the release
// asset-naming contract this pipeline depends on.

use std::io::Read;
use std::path::{Path, PathBuf};

use super::artifact::{self, SidecarError, VerificationError};
use super::{InstallError, InstallStrategy};

/// Hard ceiling on total decompressed archive bytes, enforced while
/// streaming (see `CappedReader`). The real `dist/` tree this archives
/// (agents/skills/agent-sops) is a few MB; 256MB is over 100x that,
/// generous for growth while still bounding decompressed output.
/// Hardcoded, no config override -- this is the live cap on every
/// real GitHub-release install.
const MAX_UNPACKED_BYTES: u64 = 256 * 1024 * 1024;

/// Hard ceiling on total archive entry COUNT, enforced during the same
/// per-entry loop that already applies `MAX_UNPACKED_BYTES` to total
/// bytes. A separate cap from the byte cap: many zero-byte entries
/// cost memory and inodes per entry without ever approaching the byte
/// cap, so entry count needs its own bound. A real `dist/` tree this
/// archives today has on the order of a hundred files (123, measured
/// against this repo's own `agents/`+`skills/`+`agent-sops/` trees);
/// 50,000 is ~400x that -- generous for growth while keeping rejection
/// cheap and bounded.
const MAX_ENTRY_COUNT: usize = 50_000;

/// What `install_from_remote_bytes` can fail with. `VerifySidecar`/
/// `VerifyChecksum` are split so a caller can map each to its own exit
/// code (64 vs 65). `Unpack` covers a corrupt/unsafe
/// archive or disk I/O. `Install` passes `install_from_local`'s error
/// through unchanged. `McpBinaryFetch` covers a supported-platform MCP
/// binary fetch/verify failure that is NOT the "platform unsupported"
/// case (see `install_mcp_server_binary_into_remote_temp_dir`'s own
/// doc comment for that distinction) -- carries only the already-
/// rendered message text, mirroring `Unpack`'s own `std::io::Error`
/// wrapping but for the `McpBinaryFetcher` seam's `std::io::Error`
/// shape specifically.
#[derive(Debug)]
pub enum RemoteInstallError {
    VerifySidecar(SidecarError),
    VerifyChecksum(VerificationError),
    Unpack(std::io::Error),
    Install(InstallError),
    McpBinaryFetch(String),
}

impl std::fmt::Display for RemoteInstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RemoteInstallError::VerifySidecar(err) => write!(f, "{err}"),
            RemoteInstallError::VerifyChecksum(err) => write!(f, "{err}"),
            RemoteInstallError::Unpack(err) => write!(f, "failed to unpack artifact: {err}"),
            RemoteInstallError::Install(err) => write!(f, "{err}"),
            RemoteInstallError::McpBinaryFetch(message) => {
                write!(f, "failed to fetch the skill-lookup-mcp binary: {message}")
            }
        }
    }
}

impl std::error::Error for RemoteInstallError {}

/// Verifies `sidecar_bytes` against `artifact_bytes` by sequencing the
/// existing `parse_sidecar`/`verify_sha256` -- adds no verification
/// logic of its own. `expected_filename` is the artifact's own
/// filename, the same value `write_sidecar` embedded when the sidecar
/// was produced.
fn verify_artifact_pair(
    artifact_bytes: Vec<u8>,
    sidecar_bytes: &[u8],
    expected_filename: &str,
) -> Result<artifact::FetchedArtifact, RemoteInstallError> {
    let sidecar_text = String::from_utf8_lossy(sidecar_bytes);
    let entry = artifact::parse_sidecar(&sidecar_text, expected_filename)
        .map_err(RemoteInstallError::VerifySidecar)?;
    artifact::verify_sha256(artifact_bytes, &entry.hash).map_err(RemoteInstallError::VerifyChecksum)
}

// ── MCP server binary (skill-lookup-mcp) remote fetch ───────────────────

/// Seam for the MCP server binary's own network fetch, mirroring
/// `RemoteArtifactFetcher`'s shape: a boxed closure returning
/// `(binary_bytes, sidecar_bytes, release_version)` or an I/O error.
/// Production wires this to an already-resolved
/// `github::McpServerAssetFetchError`/asset-bytes result -- resolved
/// eagerly from the SAME release fetch the tarball asset was resolved
/// from (see `remote_orchestrate::install_from_latest_github_release`'s
/// own doc comment for why), mapped to `std::io::Error` -- see
/// `install_mcp_server_binary_into_remote_temp_dir`'s own doc comment
/// for how the "platform unsupported" vs. "fetch failed on a supported
/// platform" distinction survives that mapping. Tests inject a fake
/// closure instead, so no test in this codebase depends on network
/// access, matching `RemoteArtifactFetcher`'s own precedent.
///
/// `FnOnce`, not `Fn`: this fetcher is threaded through by value
/// (`Option<McpBinaryFetcher>`, never `Option<&McpBinaryFetcher>`) and
/// invoked at most once per install, at the single call site inside
/// `install_mcp_server_binary_into_remote_temp_dir`. The bound makes
/// that single-call contract a compile-time property of the type
/// itself, rather than a runtime invariant an implementation has to
/// uphold with its own internal bookkeeping.
pub(crate) type McpBinaryFetcher<'a> =
    Box<dyn FnOnce() -> std::io::Result<(Vec<u8>, Vec<u8>, String)> + 'a>;

/// Sentinel prefix `install_mcp_server_binary_into_remote_temp_dir`
/// looks for in a mapped fetcher error's message to recover the
/// "platform unsupported" signal across the `std::io::Error` boundary
/// `McpBinaryFetcher`'s closure shape imposes -- the closure can only
/// return `std::io::Result`, which has no room for
/// `github::McpServerAssetFetchError::is_unsupported_platform()`'s own
/// typed distinction once it crosses that seam. Production's real
/// fetcher (built in `remote_orchestrate.rs`) prefixes exactly this
/// marker onto the mapped message whenever the underlying error IS
/// `UnsupportedPlatform`, so the distinction survives the mapping
/// intact; a fake test fetcher can reproduce the identical shape with
/// no real network call.
pub(crate) const MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER: &str =
    "__konductor_mcp_binary_unsupported_platform__:";

/// The one MCP server binary this remote-fetch path installs --
/// `skill-lookup-mcp`, matching `mcp_server::MCP_SERVER_BINARY_NAMES`'s
/// sole entry. A bare constant (not a re-export of that slice) since
/// this module only ever needs the one name.
fn mcp_binary_name() -> &'static str {
    "skill-lookup-mcp"
}

/// The explicit, actionable warning printed (never panicking, never
/// silent) when the current host has no published `skill-lookup-mcp`
/// binary at all -- see `install_mcp_server_binary_into_remote_temp_dir`'s
/// own doc comment for the degrade-vs-block decision this backs.
/// `rendered_error_text` is the already-rendered
/// `github::McpServerAssetFetchError::UnsupportedPlatform`'s own
/// `Display` text (everything after the marker prefix at the call
/// site), so this prints it verbatim rather than re-deriving
/// `os`/`arch` a second time.
fn unsupported_platform_warning(rendered_error_text: &str) -> String {
    format!("konductor install: warning: {rendered_error_text}")
}

/// Parses `sidecar_bytes` as a `sha256sum`-format sidecar (reusing
/// `artifact::parse_sidecar`, the identical helper `verify_artifact_pair`
/// already uses for the tarball) and returns just the hash, checked
/// against `expected_filename`. Kept separate from `verify_artifact_pair`
/// itself (which owns both the artifact bytes and the parsed hash
/// together) since this call site verifies via `artifact::verify_sha256`
/// directly, so it can distinguish a `SidecarError` from a
/// `VerificationError` the same way `verify_artifact_pair` already does.
fn parse_mcp_sidecar_hash(
    sidecar_bytes: &[u8],
    expected_filename: &str,
) -> Result<String, RemoteInstallError> {
    let sidecar_text = String::from_utf8_lossy(sidecar_bytes);
    let entry = artifact::parse_sidecar(&sidecar_text, expected_filename)
        .map_err(RemoteInstallError::VerifySidecar)?;
    Ok(entry.hash)
}

/// Fetches the MCP server binary via `fetcher`, verifies it against
/// its own fetched `.sha256` sidecar (reusing `parse_mcp_sidecar_hash`/
/// `artifact::verify_sha256`, the identical verification primitives the
/// tarball fetch already uses), and writes the verified bytes to
/// `<temp_dir_path>/mcp/target/release/skill-lookup-mcp` -- the EXACT
/// path `mcp_server::mcp_binary_source_path`/`install_bin_files`
/// already read from locally, reused here rather than duplicated, so
/// `McpInstallPhase` (unchanged) picks the binary up transparently once
/// `strategy.install_from_local` runs with `temp_dir_path` as its own
/// `repo_root`. Sets the executable bit via the existing
/// `kiro_cli::set_executable` helper, same as the local `--from` path.
///
/// ── Degrade-vs-block decision (explicit, per this feature's design) ──
/// Returns `Ok(None)` -- DEGRADE GRACEFULLY, never blocking the rest of
/// the install -- when `fetcher()` fails with the unsupported-platform
/// marker (see `MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER`): a platform
/// with no published binary at all is a permanent, expected condition
/// (x86_64 macOS, Windows, or any other unmapped OS/ARCH), not a
/// transient failure, so failing the WHOLE install over it would block
/// every agent/skill/context install too, for a feature (skill lookup)
/// that is optional at runtime -- `resource_rewrite/mcp_server.rs`'s own
/// `McpServerPass` already tolerates "the binary was never installed"
/// as a normal, non-fatal state for the identical LOCAL `--from` case
/// (see that module's own doc comment: "a missing binary is not an
/// error"). This function extends that tolerance to the new
/// REMOTE-fetch path's own distinct failure mode, printing a clear
/// warning via `unsupported_platform_warning` rather than the SILENT
/// `continue` `mcp_server.rs`'s local path uses for its own (different)
/// "not yet built" case.
///
/// Returns `Err(RemoteInstallError::McpBinaryFetch)` -- BLOCKING the
/// whole install -- for every OTHER fetcher failure on a platform that
/// IS mapped to a real target triple: a network error, or a release
/// genuinely missing that platform's asset despite being mapped, are
/// unexpected/transient conditions on a platform the release build
/// matrix explicitly supports, distinguishable from the "not supported
/// at all" case by NOT carrying the marker. A checksum mismatch instead
/// maps to `RemoteInstallError::VerifyChecksum`/`VerifySidecar`, the
/// same variants the tarball's own verification failure uses, so a
/// caller mapping exit codes treats both identically.
///
/// Returns `Ok(Some(release_version))` on success -- the release's own
/// version string (its `tag_name`), threaded back so a caller can
/// report the actually-installed content's version.
fn install_mcp_server_binary_into_remote_temp_dir(
    fetcher: McpBinaryFetcher,
    temp_dir_path: &Path,
) -> Result<Option<String>, RemoteInstallError> {
    let (binary_bytes, sidecar_bytes, release_version) = match fetcher() {
        Ok(triple) => triple,
        Err(err) => {
            let message = err.to_string();
            if let Some(rest) = message.strip_prefix(MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER) {
                eprintln!("{}", unsupported_platform_warning(rest));
                return Ok(None);
            }
            return Err(RemoteInstallError::McpBinaryFetch(message));
        }
    };

    // The sidecar's own recorded filename must match the exact asset
    // filename that was actually fetched -- reconstructed the same way
    // `github::resolve_mcp_server_asset_from_release` built it, from
    // (release_version, current host's own target triple). Valid
    // because this function only ever runs on the SAME host that
    // fetched the bytes, never a cross-host fetch-then-verify split.
    let binary_filename = match super::target_triple::current_host_target_triple() {
        Some(triple) => super::github::expected_mcp_server_asset_filename(&release_version, triple),
        // Unreachable in practice: a fetcher that succeeded already
        // proved the platform is supported (see the early return
        // above). Falls back to a filename built from a bare name-only
        // fallback rather than panicking, in case a future fake test
        // fetcher exercises this path directly with a mismatched host.
        None => mcp_binary_name().to_string(),
    };

    let hash = parse_mcp_sidecar_hash(&sidecar_bytes, &binary_filename)?;
    let verified =
        artifact::verify_sha256(binary_bytes, &hash).map_err(RemoteInstallError::VerifyChecksum)?;

    let destination = super::mcp_server::mcp_binary_source_path(temp_dir_path, mcp_binary_name());
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(RemoteInstallError::Unpack)?;
    }
    crate::cli::atomic_write::write_atomic(&destination, &verified.data)
        .map_err(RemoteInstallError::Unpack)?;
    super::kiro_cli::set_executable(&destination, true).map_err(RemoteInstallError::Unpack)?;

    Ok(Some(release_version))
}

/// Rejects an archive entry path that would escape `dest_root` --
/// absolute paths and any `..` component -- or that names `dest_root`
/// itself rather than something inside it. Same discipline
/// `synth/path_safety.rs` already applies to untrusted relative paths
/// elsewhere in this codebase: never trust an archive-supplied path to
/// stay put.
fn is_safe_entry_path(path: &Path) -> bool {
    use std::path::Component;
    if path.is_absolute() {
        return false;
    }
    if path
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return false;
    }
    // An entry path of "" or "." (or any path made up entirely of
    // `Component::CurDir` segments, e.g. "./.") has zero meaningful
    // components once `CurDir` is filtered out. `dist_dir.join(path)`
    // for such a path resolves to `dist_dir` itself, so unpacking it
    // would overwrite/clobber the destination root rather than write
    // something inside it -- reject it outright rather than let it
    // reach `entry.unpack(...)`.
    path.components().any(|c| !matches!(c, Component::CurDir))
}

/// Wraps a decompressing reader and fails once more than
/// `limit` total bytes have been read from it, so a gzip/tar bomb is
/// caught mid-stream rather than after fully materializing into memory
/// or disk. Neither `flate2` nor `tar` provides this -- both leave
/// bounding decompressed output to the caller.
struct CappedReader<R> {
    inner: R,
    limit: u64,
    read_so_far: u64,
}

impl<R: Read> CappedReader<R> {
    fn new(inner: R, limit: u64) -> Self {
        Self {
            inner,
            limit,
            read_so_far: 0,
        }
    }
}

impl<R: Read> Read for CappedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read_so_far = self.read_so_far.saturating_add(n as u64);
        if self.read_so_far > self.limit {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!(
                    "archive exceeds maximum allowed uncompressed size ({} bytes)",
                    self.limit
                ),
            ));
        }
        Ok(n)
    }
}

/// Unpacks a gzip tar archive (already checksum-verified) into
/// `<dest_root>/dist/` -- the inverse of `synth::package::package_dist`,
/// whose entries are `dist_root`-relative. `dest_root` must already
/// exist.
///
/// Rejects any entry with an absolute path, `..` segment, or a path
/// that resolves to nothing (empty/`.`/`CurDir`-only, which would
/// otherwise clobber `dist_dir` itself), and rejects symlink/hardlink
/// entries outright, so an entry can never write outside `dest_root`
/// or overwrite its root. Preserves the Unix executable bit via tar's
/// own `unpack`. Bounds both total decompressed bytes (via
/// `CappedReader` around the gzip decoder) and total entry count (via
/// `MAX_ENTRY_COUNT`, counted in the same iteration loop), each cap
/// checked mid-stream/mid-iteration rather than after the archive is
/// fully consumed.
///
/// Thin, test-only wrapper around `unpack_dist_archive_with_limit`
/// fixed to the real `MAX_UNPACKED_BYTES`/`MAX_ENTRY_COUNT` caps --
/// lets tests invoke those caps by name instead of repeating them at
/// every call site. Production calls `unpack_dist_archive_with_limit`
/// directly instead (see that function's own doc for why).
#[allow(dead_code)]
fn unpack_dist_archive(archive_bytes: &[u8], dest_root: &Path) -> Result<(), RemoteInstallError> {
    unpack_dist_archive_with_limit(
        archive_bytes,
        dest_root,
        MAX_UNPACKED_BYTES,
        MAX_ENTRY_COUNT,
    )
}

/// Same as `unpack_dist_archive`, but with the decompressed-size cap
/// and entry-count cap both parameterized instead of fixed. Lets tests
/// exercise `CappedReader`'s mid-stream rejection and the entry-count
/// cap's mid-iteration rejection against tiny limits and correspondingly
/// tiny payloads, instead of allocating a real 256 MiB+ buffer or
/// building 50,000+ real tar entries per test -- expensive to repeat
/// across the parallel test runs Rust's harness runs by default, and a
/// source of flakiness on constrained CI runners. This is the real
/// production function despite not being `pub`:
/// `install_from_remote_bytes_named_with_limit` calls it directly with
/// the real fixed caps on every GitHub-release install.
/// `unpack_dist_archive` above only exists so tests can name those caps
/// by their constants.
fn unpack_dist_archive_with_limit(
    archive_bytes: &[u8],
    dest_root: &Path,
    max_unpacked_bytes: u64,
    max_entry_count: usize,
) -> Result<(), RemoteInstallError> {
    let dist_dir = dest_root.join("dist");
    std::fs::create_dir_all(&dist_dir).map_err(RemoteInstallError::Unpack)?;

    let decoder = flate2::read::GzDecoder::new(archive_bytes);
    let capped = CappedReader::new(decoder, max_unpacked_bytes);
    let mut archive = tar::Archive::new(capped);
    let entries = archive.entries().map_err(RemoteInstallError::Unpack)?;
    let mut entry_count: usize = 0;
    for entry in entries {
        entry_count += 1;
        if entry_count > max_entry_count {
            return Err(RemoteInstallError::Unpack(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("archive exceeds maximum allowed entry count ({max_entry_count} entries)"),
            )));
        }
        let mut entry = entry.map_err(RemoteInstallError::Unpack)?;
        let entry_path = entry
            .path()
            .map_err(RemoteInstallError::Unpack)?
            .into_owned();
        if !is_safe_entry_path(&entry_path) {
            return Err(RemoteInstallError::Unpack(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!(
                    "archive entry path escapes destination: {}",
                    entry_path.display()
                ),
            )));
        }
        // Rejects link entries outright: `is_safe_entry_path` only checks
        // an entry's own path, not where a symlink or hardlink points,
        // so a link with a benign path could still resolve outside
        // `dest_root` at extraction time.
        let entry_type = entry.header().entry_type();
        if entry_type.is_symlink() || entry_type.is_hard_link() {
            return Err(RemoteInstallError::Unpack(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!(
                    "archive contains a link entry, which is not allowed: {}",
                    entry_path.display()
                ),
            )));
        }
        entry
            .unpack(dist_dir.join(&entry_path))
            .map_err(RemoteInstallError::Unpack)?;
    }
    Ok(())
}

/// RAII guard for the scratch directory `install_from_remote_bytes`
/// unpacks into: removes it (best-effort) on drop, so cleanup runs on
/// every exit path -- verify failure, unpack failure, install failure,
/// or success -- without a manual `remove_dir_all` at each return.
struct RemoteTempDir {
    path: PathBuf,
}

impl RemoteTempDir {
    fn create(name: &str) -> std::io::Result<Self> {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "konductor-remote-install-{name}-{}-{}-{:016x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            random_entropy_tag()
        ));
        // `create_dir` (singular), not `create_dir_all`: `create_dir`
        // fails with `AlreadyExists` if the path is already occupied
        // (e.g. by a symlink), rather than silently following it the
        // way `create_dir_all` would. That exclusivity check is the
        // security boundary; the random tag folded into the path name
        // below makes the path itself harder to predict or race
        // against ahead of time, on top of it.
        std::fs::create_dir(&path)?;
        Ok(Self { path })
    }
}

/// Returns a per-call random `u64` for folding into `RemoteTempDir`'s
/// scratch path name, on top of the existing timestamp+counter. Not
/// cryptographically secure and doesn't need to be: the actual
/// exclusivity guarantee is `create_dir`'s `AlreadyExists` check, not
/// this value's secrecy -- it only needs to be hard to predict, so a
/// std-only source is used instead of pulling in a dedicated RNG
/// crate. `RandomState::new()` seeds from the OS's own random source
/// once per call (the same per-process-unpredictable seeding
/// `HashMap`/`HashSet`'s DoS-hardening already relies on), so the
/// resulting value can't be predicted from the timestamp/counter alone.
fn random_entropy_tag() -> u64 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    RandomState::new().build_hasher().finish()
}

impl Drop for RemoteTempDir {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.path).ok();
    }
}

/// Fetches a release artifact and its sidecar as raw bytes. Return
/// shape (`(artifact_bytes, sidecar_bytes)`) matches exactly what
/// `install_from_remote_bytes` consumes. In production this is
/// implemented by resolving the tarball asset from the release
/// `install::github::fetch_latest_release_artifact_and_mcp_asset`
/// fetched (a real GitHub Release fetch, wired into
/// `dispatch_install_with` via `install::remote_orchestrate`); this
/// type alias still exists as the closure shape tests use to inject a
/// fake fetcher instead of a real
/// network call. Modeled directly on `artifact::ArtifactFetcher`.
pub type RemoteArtifactFetcher<'a> = Box<dyn Fn() -> std::io::Result<(Vec<u8>, Vec<u8>)> + 'a>;

/// What a successful `install_from_remote_bytes` call actually
/// installed, beyond "it succeeded" -- today just the MCP server
/// binary's own release version (`None` when no `mcp_binary_fetcher`
/// was supplied, or when the current host has no published binary at
/// all -- see `install_mcp_server_binary_into_remote_temp_dir`'s own
/// degrade-vs-block doc comment for that second case). Named struct
/// rather than a bare `Option<String>` return so a future additional
/// piece of "what got installed" data has an obvious place to land
/// without changing every existing call site's return type again.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RemoteInstallOutcome {
    pub mcp_binary_version: Option<String>,
}

/// Verifies the pair, unpacks into a fresh temp directory, hands that
/// directory's path to `strategy.install_from_local` UNCHANGED, then
/// removes the temp directory before returning -- success or failure.
/// `artifact_filename` is the sidecar-recorded filename passed through
/// to verification (e.g. "konductor-dist.tar.gz"). Wired into
/// `dispatch_install_with`'s no-`--from` branch via
/// `install::remote_orchestrate::install_from_latest_github_release`,
/// which does the real GitHub Release fetch before calling this.
///
/// `mcp_binary_fetcher` is `None` for a caller that doesn't want the
/// additive MCP-binary fetch at all (e.g.
/// `install_from_main_branch_dist`'s own main-branch-`dist/` source,
/// which has no analogous per-platform release asset to fetch from a
/// branch tree); `Some(fetcher)` for the real GitHub-release path,
/// which always supplies a closure wrapping the already-resolved
/// `github::McpServerAssetFetchError`/asset-bytes result (see
/// `remote_orchestrate::mcp_binary_fetcher_from_resolved_asset`). See
/// `install_mcp_server_binary_into_remote_temp_dir`'s own doc comment
/// for the fetch/verify/degrade-vs-block behavior once supplied.
#[allow(clippy::too_many_arguments)]
pub fn install_from_remote_bytes(
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    artifact_bytes: Vec<u8>,
    sidecar_bytes: &[u8],
    artifact_filename: &str,
    installed_at: &str,
    no_telemetry: bool,
    mcp_binary_fetcher: Option<McpBinaryFetcher>,
) -> Result<RemoteInstallOutcome, RemoteInstallError> {
    install_from_remote_bytes_named(
        "install",
        strategy,
        target_dir,
        artifact_bytes,
        sidecar_bytes,
        artifact_filename,
        installed_at,
        no_telemetry,
        mcp_binary_fetcher,
    )
}

/// Same as `install_from_remote_bytes`, with the temp directory's own
/// name tag exposed so tests can pass a unique-per-test tag and check
/// for that exact directory's absence afterward, instead of racing
/// against every OTHER concurrently-running test's own scratch
/// directory under the same shared `konductor-remote-install-` prefix.
///
/// Thin wrapper around `install_from_remote_bytes_named_with_limit`
/// fixed to the real `MAX_UNPACKED_BYTES` cap -- the only production
/// call path. Parameterizing the cap here (rather than only inside
/// `unpack_dist_archive`) lets a test exercise this function's own
/// temp-dir-cleanup behavior end-to-end against a tiny limit/payload,
/// instead of duplicating this function's body just to swap in
/// `unpack_dist_archive_with_limit`.
#[allow(clippy::too_many_arguments)]
fn install_from_remote_bytes_named(
    temp_name_tag: &str,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    artifact_bytes: Vec<u8>,
    sidecar_bytes: &[u8],
    artifact_filename: &str,
    installed_at: &str,
    no_telemetry: bool,
    mcp_binary_fetcher: Option<McpBinaryFetcher>,
) -> Result<RemoteInstallOutcome, RemoteInstallError> {
    install_from_remote_bytes_named_with_limit(
        temp_name_tag,
        strategy,
        target_dir,
        artifact_bytes,
        sidecar_bytes,
        artifact_filename,
        installed_at,
        no_telemetry,
        mcp_binary_fetcher,
        MAX_UNPACKED_BYTES,
    )
}

#[allow(clippy::too_many_arguments)]
fn install_from_remote_bytes_named_with_limit(
    temp_name_tag: &str,
    strategy: &dyn InstallStrategy,
    target_dir: &Path,
    artifact_bytes: Vec<u8>,
    sidecar_bytes: &[u8],
    artifact_filename: &str,
    installed_at: &str,
    no_telemetry: bool,
    mcp_binary_fetcher: Option<McpBinaryFetcher>,
    max_unpacked_bytes: u64,
) -> Result<RemoteInstallOutcome, RemoteInstallError> {
    let temp_dir = RemoteTempDir::create(temp_name_tag).map_err(RemoteInstallError::Unpack)?;

    let verified = verify_artifact_pair(artifact_bytes, sidecar_bytes, artifact_filename)?;
    unpack_dist_archive_with_limit(
        &verified.data,
        &temp_dir.path,
        max_unpacked_bytes,
        MAX_ENTRY_COUNT,
    )?;

    // Additive: fetches the platform-specific skill-lookup-mcp binary
    // into `<temp_dir>/mcp/target/release/skill-lookup-mcp` BEFORE
    // `install_from_local` runs, so `McpInstallPhase` (unmodified)
    // finds it exactly where it already looks for a local `--from`
    // build. `None` (the main-branch-dist source) or an
    // unsupported-platform outcome both leave this `None` -- never an
    // error on their own; see the called function's own doc comment
    // for the full degrade-vs-block decision.
    let mcp_binary_version = match mcp_binary_fetcher {
        Some(fetcher) => install_mcp_server_binary_into_remote_temp_dir(fetcher, &temp_dir.path)?,
        None => None,
    };

    let from = temp_dir.path.to_str().ok_or_else(|| {
        RemoteInstallError::Unpack(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "temp directory path is not valid UTF-8",
        ))
    })?;
    strategy
        .install_from_local(target_dir, Some(from), installed_at, no_telemetry)
        .map_err(RemoteInstallError::Install)?;

    // `install_from_local` unconditionally records its `from` argument
    // (canonicalized) as the manifest's `source` field, for `doctor`'s
    // `check_source`/`check_config` to resolve against later. Here
    // that value is `temp_dir`, which `RemoteTempDir::drop` deletes
    // the instant this function returns -- so it gets overwritten with
    // a stable, synthetic `remote:<artifact_filename>` marker instead.
    // `doctor` treats an unresolvable synthetic source the same as any
    // other source it can't resolve on disk, rather than reporting a
    // false "missing" for a path that was never meant to persist.
    //
    // Best-effort: the install itself already succeeded above, so a
    // failure here (the freshly-written manifest being unreadable or
    // unwritable, or the lock below being contended) must not fail the
    // whole call and unwind a completed install.
    //
    // `update_strategy_field_locked` rewrites this single field under
    // the SAME lock `manifest::upsert_strategy` uses for a whole slot --
    // the same read-modify-write race the slot-level lock guards
    // against, just for one field. Without that lock, a concurrent
    // `install` of a DIFFERENT strategy at this same target, landing
    // between an unlocked read and write here, could have its own
    // just-committed slot silently dropped by this rewrite's stale
    // snapshot. Re-reading FRESH under the lock means this rewrite
    // can never race it.
    let rewrote =
        super::manifest::update_strategy_field_locked(target_dir, strategy.name(), |slot| {
            slot.source = Some(format!("remote:{artifact_filename}"));
        });
    if !matches!(rewrote, Ok(true)) {
        // Non-fatal by design (see above), but not silent: the source
        // field is left pointing at the now-deleted temp path, so
        // `doctor` will report it missing later -- surfaced here so
        // it's discoverable. Covers every non-success outcome alike
        // (no manifest, slot not tracked in the fresh read, or a
        // `ManifestError` including lock contention) -- none of them
        // change what the caller needs to know: the rewrite didn't
        // happen.
        eprintln!(
            "konductor install: warning: could not read back the manifest at {} to record a stable remote source; source will point at a deleted temp path",
            target_dir.display()
        );
    }

    Ok(RemoteInstallOutcome { mcp_binary_version })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::install::kiro_cli::KiroCliInstallStrategy;
    use crate::cli::synth::package::package_dist;
    use std::fs;

    const ARTIFACT_FILENAME: &str = "konductor-dist.tar.gz";

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-remote-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Builds a real `(artifact_bytes, sidecar_bytes)` pair from a
    /// fixture `dist/` tree using the real, unmodified `package_dist`
    /// and the same hashing/format `write_sidecar` uses (calling
    /// `sha256_hex` directly, since `write_sidecar` writes to disk
    /// rather than returning bytes) -- no fabricated tarball bytes.
    fn build_real_artifact_and_sidecar(dist_root: &Path) -> (Vec<u8>, Vec<u8>) {
        let artifact_bytes = package_dist(dist_root).expect("package_dist must succeed");
        let hash = artifact::sha256_hex(&artifact_bytes);
        let sidecar_bytes = format!("{hash}  {ARTIFACT_FILENAME}\n").into_bytes();
        (artifact_bytes, sidecar_bytes)
    }

    /// Seeds `<dist_root>/kiro-cli-v2/agents/<name>.json`, mirroring
    /// real synth output layout under a dist root.
    fn seed_dist_agent(dist_root: &Path, name: &str, contents: &[u8]) {
        let dir = dist_root.join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.json")), contents).unwrap();
    }

    /// Whether any entry directly under `std::env::temp_dir()` has a
    /// name containing `tag` -- used to assert a specific call's own
    /// scratch directory is gone, by checking the real filesystem
    /// rather than trusting the guard's `Drop` alone. Checking for an
    /// exact per-call tag (rather than the shared
    /// `konductor-remote-install-` prefix) avoids flapping under
    /// parallel test execution, where another concurrently-running
    /// test's still-alive temp directory would otherwise alias into
    /// this one's "leftover" check.
    fn any_temp_entry_contains(tag: &str) -> bool {
        let Ok(entries) = fs::read_dir(std::env::temp_dir()) else {
            return false;
        };
        entries
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(tag))
    }

    #[test]
    fn verify_artifact_pair_succeeds_on_real_bytes() {
        let dist_root = scratch_dir("verify-ok-dist");
        seed_dist_agent(&dist_root, "example", b"{\"name\":\"example\"}\n");
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);

        let verified =
            verify_artifact_pair(artifact_bytes.clone(), &sidecar_bytes, ARTIFACT_FILENAME)
                .expect("verification of real bytes must succeed");
        assert_eq!(verified.data, artifact_bytes);

        fs::remove_dir_all(&dist_root).ok();
    }

    #[test]
    fn verify_artifact_pair_rejects_checksum_mismatch() {
        let dist_root = scratch_dir("verify-mismatch-dist");
        seed_dist_agent(&dist_root, "example", b"{\"name\":\"example\"}\n");
        let (artifact_bytes, _) = build_real_artifact_and_sidecar(&dist_root);
        let bad_sidecar = format!("{}  {ARTIFACT_FILENAME}\n", "0".repeat(64)).into_bytes();

        let err = verify_artifact_pair(artifact_bytes, &bad_sidecar, ARTIFACT_FILENAME)
            .expect_err("mismatched checksum must fail");
        assert!(matches!(err, RemoteInstallError::VerifyChecksum(_)));

        fs::remove_dir_all(&dist_root).ok();
    }

    #[test]
    fn verify_artifact_pair_rejects_malformed_sidecar() {
        let dist_root = scratch_dir("verify-malformed-dist");
        seed_dist_agent(&dist_root, "example", b"{\"name\":\"example\"}\n");
        let (artifact_bytes, _) = build_real_artifact_and_sidecar(&dist_root);

        let err = verify_artifact_pair(artifact_bytes, b"not a valid sidecar", ARTIFACT_FILENAME)
            .expect_err("malformed sidecar must fail");
        assert!(matches!(err, RemoteInstallError::VerifySidecar(_)));

        fs::remove_dir_all(&dist_root).ok();
    }

    #[test]
    fn unpack_dist_archive_rejects_path_traversal_entry() {
        // Hand-build a tar.gz with an entry whose path escapes the
        // destination. Sets the header's path bytes directly, since
        // `append_data` itself refuses to build a `..`-containing entry.
        let dest_root = scratch_dir("unpack-traversal-dest");
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_path("../escape.txt").ok();
            header.as_gnu_mut().unwrap().name[..13].copy_from_slice(b"../escape.txt");
            header.set_size(4);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append(&header, &b"evil"[..]).unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }

        let err = unpack_dist_archive(&buf, &dest_root).expect_err("traversal must be rejected");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));
        // The entry path `../escape.txt` joins onto `dest_root/dist`, so
        // a successful escape lands at `dest_root/escape.txt`, not
        // `dest_root.parent()/escape.txt`.
        assert!(!dest_root.join("escape.txt").exists());

        fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn unpack_dist_archive_rejects_symlink_entry() {
        // Hand-build a tar.gz with a symlink entry whose own path is
        // benign but whose target points outside `dest_root` -- without
        // rejecting link entries, a later entry could escape "through"
        // this one even though its own path looks contained.
        let dest_root = scratch_dir("unpack-symlink-dest");
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_path("benign-link").ok();
            header.set_link_name("/etc").ok();
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_size(0);
            header.set_mode(0o777);
            header.set_cksum();
            builder.append(&header, &[][..]).unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }

        let err =
            unpack_dist_archive(&buf, &dest_root).expect_err("symlink entry must be rejected");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));
        assert!(!dest_root.join("dist").join("benign-link").exists());

        fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn unpack_dist_archive_rejects_corrupt_bytes() {
        let dest_root = scratch_dir("unpack-corrupt-dest");
        let err = unpack_dist_archive(b"not a gzip tarball at all", &dest_root)
            .expect_err("corrupt archive bytes must fail");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));
        fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn unpack_dist_archive_accepts_real_archive_under_the_cap() {
        // Regression check: a real, package_dist-built archive well
        // under MAX_UNPACKED_BYTES must still unpack successfully.
        let dist_root = scratch_dir("unpack-under-cap-dist");
        seed_dist_agent(&dist_root, "small", b"{\"name\":\"small\"}\n");
        let (artifact_bytes, _) = build_real_artifact_and_sidecar(&dist_root);

        let dest_root = scratch_dir("unpack-under-cap-dest");
        unpack_dist_archive(&artifact_bytes, &dest_root)
            .expect("archive well under the size cap must unpack successfully");
        assert!(dest_root
            .join("dist")
            .join("kiro-cli-v2")
            .join("agents")
            .join("small.json")
            .is_file());

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn unpack_dist_archive_rejects_archive_exceeding_the_size_cap() {
        // Real tar.gz built via the same tar::Builder/GzEncoder path as
        // package_dist, with one entry's actual content (not just a
        // declared header size) exceeding the cap, so the CappedReader's
        // mid-stream rejection is exercised honestly rather than via a
        // header-only size lie. Uses `unpack_dist_archive_with_limit`
        // with a tiny limit/payload instead of a real 256 MiB+ buffer --
        // exercises the identical cap-enforcement code path
        // (`unpack_dist_archive` is a thin wrapper around this same
        // function) without the memory/flakiness risk of allocating a
        // real MAX_UNPACKED_BYTES+1 buffer per test.
        let dest_root = scratch_dir("unpack-over-cap-dest");
        const TINY_LIMIT: u64 = 4 * 1024;
        let oversized_content = vec![0u8; (TINY_LIMIT + 1) as usize];
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::fast());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_path("huge.bin").unwrap();
            header.set_size(oversized_content.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append(&header, oversized_content.as_slice())
                .unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }

        let err = unpack_dist_archive_with_limit(&buf, &dest_root, TINY_LIMIT, MAX_ENTRY_COUNT)
            .expect_err("archive exceeding the size cap must be rejected");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));
        // Streaming extraction may leave a partially-written file behind
        // (the point of streaming is to never buffer the whole entry
        // first) -- what matters is it was never fully written.
        let partial_len = fs::metadata(dest_root.join("dist").join("huge.bin"))
            .map(|m| m.len())
            .unwrap_or(0);
        assert!(
            partial_len < oversized_content.len() as u64,
            "oversized entry must not be fully written to disk"
        );

        fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn install_from_remote_bytes_cleans_up_temp_dir_on_size_cap_rejection() {
        // End-to-end: an oversized archive that passes checksum
        // verification (verify only proves transport integrity, not
        // size) is still rejected at unpack, and RemoteTempDir's
        // Drop-based cleanup still fires. Uses
        // `install_from_remote_bytes_named_with_limit` with a tiny
        // limit/payload instead of a real 256 MiB+ buffer -- exercises
        // the identical end-to-end wiring `install_from_remote_bytes`
        // uses (verify -> unpack -> cleanup) without the memory/flakiness
        // risk of a real MAX_UNPACKED_BYTES+1 buffer per test.
        const TINY_LIMIT: u64 = 4 * 1024;
        let oversized_content = vec![0u8; (TINY_LIMIT + 1) as usize];
        let mut artifact_bytes = Vec::new();
        {
            let encoder =
                flate2::write::GzEncoder::new(&mut artifact_bytes, flate2::Compression::fast());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_path("huge.bin").unwrap();
            header.set_size(oversized_content.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append(&header, oversized_content.as_slice())
                .unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }
        let hash = artifact::sha256_hex(&artifact_bytes);
        let sidecar_bytes = format!("{hash}  {ARTIFACT_FILENAME}\n").into_bytes();

        let target_dir = scratch_dir("size-cap-fail-target");
        let tag = "size-cap-fail-tag";

        let err = install_from_remote_bytes_named_with_limit(
            tag,
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &sidecar_bytes,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            None,
            TINY_LIMIT,
        )
        .expect_err("oversized archive must fail unpack even after verify succeeds");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));

        assert!(
            !target_dir.join(".konductor").join("manifest").exists(),
            "no manifest should be written when unpack is rejected for exceeding the size cap"
        );
        assert!(
            !any_temp_entry_contains(tag),
            "temp directory must be cleaned up after a size-cap rejection"
        );

        fs::remove_dir_all(&target_dir).ok();
    }

    #[test]
    fn install_from_remote_bytes_end_to_end_with_real_bytes() {
        let dist_root = scratch_dir("e2e-dist");
        seed_dist_agent(&dist_root, "k-example", b"{\"name\":\"k-example\"}\n");
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);

        let target_dir = scratch_dir("e2e-target");
        let tag = "e2e-success-tag";

        install_from_remote_bytes_named(
            tag,
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &sidecar_bytes,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect("end-to-end remote install must succeed");

        let installed = target_dir.join(".kiro/agents/k-example.json");
        assert!(
            installed.is_file(),
            "expected file installed via existing copy logic"
        );
        assert_eq!(fs::read(&installed).unwrap(), b"{\"name\":\"k-example\"}\n");

        let manifest = crate::cli::install::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after remote install");
        assert_eq!(manifest.strategy_names(), vec!["kiro-cli-v2"]);

        // Temp dir must be cleaned up on success -- check the real
        // filesystem for this call's own uniquely-tagged temp dir,
        // not just trust the Drop impl.
        assert!(
            !any_temp_entry_contains(tag),
            "no leftover scratch temp directory should remain after a successful install"
        );

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// The manifest's `source` field must be the stable
    /// `remote:<artifact_filename>` marker, never the ephemeral scratch
    /// temp directory `install_from_local` was actually given -- that
    /// directory is deleted (via `RemoteTempDir::drop`) the instant
    /// this call returns, so a manifest recording it would make
    /// `doctor` always report the source as missing.
    #[test]
    fn install_from_remote_bytes_records_a_stable_source_not_the_deleted_temp_dir() {
        let dist_root = scratch_dir("source-field-dist");
        seed_dist_agent(&dist_root, "k-example", b"{\"name\":\"k-example\"}\n");
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);

        let target_dir = scratch_dir("source-field-target");
        let tag = "source-field-tag";

        install_from_remote_bytes_named(
            tag,
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &sidecar_bytes,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect("end-to-end remote install must succeed");

        let manifest = crate::cli::install::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after remote install");
        let source = manifest.strategies[0]
            .source
            .clone()
            .expect("remote install must record a source, not None");
        assert_eq!(
            source,
            format!("remote:{ARTIFACT_FILENAME}"),
            "source must be the stable synthetic marker, not the deleted temp dir path"
        );
        assert!(
            !source.contains("konductor-remote-install-"),
            "source must never contain the deleted scratch temp directory's own path fragment"
        );

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// The non-fatal `if let Ok(Some(...))` guard around the manifest
    /// source-overwrite (in `install_from_remote_bytes_named_with_limit`)
    /// tolerates `read_manifest` returning `Err` for a manifest that
    /// `install_from_local` just wrote. This test confirms that failure
    /// mode is reachable against a real manifest from this exact code
    /// path, not merely a defensive branch guarding against something
    /// that can never happen.
    ///
    /// This does NOT inject the corruption mid-call (there is no seam in
    /// `install_from_remote_bytes_named_with_limit` to pause between
    /// `install_from_local` returning and the source-overwrite block
    /// running, and adding one purely for a test would be a bigger, riskier
    /// change than the gap warrants). Instead it runs a real, successful
    /// end-to-end install, then proves against the REAL manifest that
    /// install just wrote: (a) corrupting those exact bytes on disk makes
    /// `read_manifest` fail with a real `ManifestError`, confirming the
    /// guard's failure branch is reachable against genuine on-disk content
    /// from this exact code path, and (b) the success path really did set
    /// the `remote:<filename>` marker beforehand, so this test is
    /// distinguishing the failure branch from the success branch rather
    /// than vacuously passing.
    #[test]
    fn read_manifest_fails_on_the_real_manifest_a_remote_install_writes_once_corrupted() {
        let dist_root = scratch_dir("source-overwrite-fail-dist");
        seed_dist_agent(&dist_root, "k-example", b"{\"name\":\"k-example\"}\n");
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);

        let target_dir = scratch_dir("source-overwrite-fail-target");
        let tag = "source-overwrite-fail-tag";
        let manifest_path = crate::cli::install::manifest::manifest_path(&target_dir);

        install_from_remote_bytes_named(
            tag,
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &sidecar_bytes,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect("end-to-end remote install must succeed even though this test then corrupts the manifest afterward");

        // Confirm the success path already ran and set the stable source
        // marker -- otherwise corrupting the manifest afterward wouldn't
        // be distinguishing anything from a test that never exercised the
        // success branch in the first place.
        let manifest_before = crate::cli::install::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after a successful install");
        assert_eq!(
            manifest_before.strategies[0].source,
            Some(format!("remote:{ARTIFACT_FILENAME}")),
            "sanity check: the success path must have already set the stable source marker"
        );

        // Corrupt the manifest file `install_from_local` really wrote --
        // non-JSON bytes -- and confirm `read_manifest` genuinely fails
        // against it, the same failure shape the production
        // `if let Ok(Some(...))` guard in
        // `install_from_remote_bytes_named_with_limit` is designed to
        // tolerate rather than unwind on.
        fs::write(&manifest_path, b"not valid json at all")
            .expect("must be able to corrupt the manifest for this test");
        let read_result = crate::cli::install::manifest::read_manifest(&target_dir);
        assert!(
            read_result.is_err(),
            "a corrupted manifest must make read_manifest fail -- proving the failure \
             mode the non-fatal manifest-overwrite guard tolerates is reachable against \
             a real manifest this exact code path wrote, not merely hypothetical"
        );

        // Restore valid bytes so cleanup below doesn't leave a corrupted
        // manifest on disk for anything scanning the temp tree afterward.
        let manifest_json =
            serde_json::to_string_pretty(&manifest_before).expect("manifest must re-serialize");
        fs::write(&manifest_path, manifest_json).expect("must be able to restore the manifest");

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    #[test]
    fn install_from_remote_bytes_cleans_up_temp_dir_on_verify_failure() {
        let dist_root = scratch_dir("verify-fail-dist");
        seed_dist_agent(&dist_root, "k-example", b"{\"name\":\"k-example\"}\n");
        let (artifact_bytes, _) = build_real_artifact_and_sidecar(&dist_root);
        let corrupted_sidecar = format!("{}  {ARTIFACT_FILENAME}\n", "f".repeat(64)).into_bytes();

        let target_dir = scratch_dir("verify-fail-target");
        let tag = "verify-fail-tag";

        let err = install_from_remote_bytes_named(
            tag,
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &corrupted_sidecar,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect_err("checksum mismatch must fail the install");
        assert!(matches!(err, RemoteInstallError::VerifyChecksum(_)));

        assert!(
            !target_dir.join(".konductor").join("manifest").exists(),
            "no manifest should be written on a verify failure"
        );
        assert!(
            !any_temp_entry_contains(tag),
            "temp directory must be cleaned up after a verify failure"
        );

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    #[test]
    fn install_from_remote_bytes_cleans_up_temp_dir_on_unpack_failure() {
        let hash = artifact::sha256_hex(b"not actually a tarball");
        let sidecar_bytes = format!("{hash}  {ARTIFACT_FILENAME}\n").into_bytes();

        let target_dir = scratch_dir("unpack-fail-target");
        let tag = "unpack-fail-tag";

        let err = install_from_remote_bytes_named(
            tag,
            &KiroCliInstallStrategy,
            &target_dir,
            b"not actually a tarball".to_vec(),
            &sidecar_bytes,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect_err("corrupt archive bytes must fail unpack after verify succeeds");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));

        assert!(
            !target_dir.join(".konductor").join("manifest").exists(),
            "no manifest should be written on an unpack failure"
        );
        assert!(
            !any_temp_entry_contains(tag),
            "temp directory must be cleaned up after an unpack failure"
        );

        fs::remove_dir_all(&target_dir).ok();
    }

    #[test]
    fn remote_temp_dir_create_succeeds_and_is_usable() {
        // Normal call still creates a real, writable directory -- the
        // exclusive-create fix must not regress the ordinary success path.
        let temp = RemoteTempDir::create("normal-create-tag")
            .expect("create must succeed when the path is free");
        assert!(temp.path.is_dir());
        fs::write(temp.path.join("probe.txt"), b"ok").expect("directory must be writable");
        assert!(temp.path.join("probe.txt").is_file());
    }

    #[test]
    fn remote_temp_dir_create_fails_instead_of_following_a_preplanted_symlink() {
        // A pre-planted symlink at the target path must fail with
        // `AlreadyExists`, not be silently followed the way
        // `create_dir_all` would. Tests `create_dir` directly (the real
        // path's nanosecond timestamp is unpredictable), since that's the
        // primitive the fix relies on.
        let elsewhere = scratch_dir("preplant-target");
        let planted_path = std::env::temp_dir().join(format!(
            "konductor-remote-install-preplant-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        #[cfg(unix)]
        std::os::unix::fs::symlink(&elsewhere, &planted_path).expect("symlink must be creatable");
        #[cfg(not(unix))]
        fs::create_dir(&planted_path).expect("pre-plant must be creatable");

        let err = std::fs::create_dir(&planted_path)
            .expect_err("create_dir must reject a pre-occupied path rather than following it");
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);

        // The planted symlink/dir must be untouched -- the fix must not
        // have followed it or written into `elsewhere`.
        assert!(elsewhere.is_dir());
        assert!(fs::read_dir(&elsewhere).unwrap().next().is_none());

        if planted_path.is_symlink() || planted_path.exists() {
            fs::remove_file(&planted_path)
                .or_else(|_| fs::remove_dir(&planted_path))
                .ok();
        }
        fs::remove_dir_all(&elsewhere).ok();
    }

    #[test]
    fn remote_temp_dir_create_paths_are_not_trivially_predictable() {
        // The scratch path name is timestamp+counter plus a random
        // entropy suffix (see `random_entropy_tag`). This does not
        // assert full unpredictability (impossible to prove from the
        // outside), but pins the concrete property the entropy suffix
        // adds: the same-name-tag path across two calls in quick
        // succession differs in more than just the low-order
        // nanosecond/counter fields -- i.e. it is not a sequential or
        // otherwise trivially-derivable suffix of the previous call's
        // path.
        let temp_a =
            RemoteTempDir::create("predictability-tag").expect("first create must succeed");
        let temp_b =
            RemoteTempDir::create("predictability-tag").expect("second create must succeed");

        let name_a = temp_a
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .expect("path must have a file name")
            .to_string();
        let name_b = temp_b
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .expect("path must have a file name")
            .to_string();

        assert_ne!(
            name_a, name_b,
            "two calls must not collide on the same path"
        );

        // Each name ends in a `-<16 hex digits>` random-entropy suffix
        // (see `random_entropy_tag`). Extract it and assert it is not a
        // simple increment/decrement of the other -- the property a
        // purely sequential counter-based suffix would have, and the
        // property injecting `RandomState`-derived entropy specifically
        // breaks. (The per-process `COUNTER` field earlier in the name
        // IS sequential by design; it's the random suffix, not that
        // counter, that is under test here.)
        let suffix_a = name_a
            .rsplit('-')
            .next()
            .expect("name must have a trailing suffix");
        let suffix_b = name_b
            .rsplit('-')
            .next()
            .expect("name must have a trailing suffix");
        assert_eq!(suffix_a.len(), 16, "random suffix must be 16 hex digits");
        assert_eq!(suffix_b.len(), 16, "random suffix must be 16 hex digits");
        let val_a = u64::from_str_radix(suffix_a, 16).expect("suffix must be valid hex");
        let val_b = u64::from_str_radix(suffix_b, 16).expect("suffix must be valid hex");
        assert_ne!(
            val_a, val_b,
            "random entropy tag must differ between two calls, not repeat or increment"
        );
        assert_ne!(
            val_a.wrapping_add(1),
            val_b,
            "random entropy tag must not be a simple sequential increment"
        );
    }

    #[test]
    fn random_entropy_tag_varies_across_calls() {
        // Direct unit check on the entropy source itself, independent
        // of path formatting: two calls in immediate succession must
        // not produce the same value (a `RandomState::new()` reseeds
        // per call, so a repeat would indicate the entropy source
        // regressed to something constant/deterministic).
        let a = random_entropy_tag();
        let b = random_entropy_tag();
        assert_ne!(
            a, b,
            "random_entropy_tag must vary between calls, not return a constant"
        );
    }

    // --- Entry-ordering / multi-entry traversal adversarial tests ---
    //
    // These tests check whether a multi-entry archive can escape
    // `dist_dir` through an interaction the single-entry checks
    // (`is_safe_entry_path` plus the symlink/hardlink type rejection in
    // `unpack_dist_archive_with_limit`) don't catch on their own -- one
    // entry creating something at a path, a later entry traversing
    // through/around it.
    //
    // One test below reproduces the entry ordering behind
    // RUSTSEC-2026-0067 / CVE-2026-33056 (fixed upstream in `tar`
    // 0.4.45): a symlink entry followed by a directory entry at the
    // same path. Our own per-entry link-type rejection runs before any
    // entry reaches `tar`'s internal unpack logic, so it intercepts
    // that shape independently of which `tar` version is linked.

    #[test]
    fn unpack_dist_archive_rejects_cve_2026_33056_symlink_then_directory_ordering() {
        // Reproduces the RUSTSEC-2026-0067 / CVE-2026-33056 entry
        // ordering: a symlink entry pointing outside `dist_dir`,
        // followed by a directory entry at the identical path. Our
        // per-entry loop rejects the symlink entry on sight -- entry-type
        // rejection fires on the first entry, before the second
        // (directory) entry is ever unpacked.
        let dest_root = scratch_dir("cve-2026-33056-dest");
        let outside_target = scratch_dir("cve-2026-33056-outside");
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut builder = tar::Builder::new(encoder);

            // Entry 1: symlink named "shared" pointing at a directory
            // outside dest_root.
            let mut symlink_header = tar::Header::new_gnu();
            symlink_header.set_path("shared").ok();
            symlink_header
                .set_link_name(outside_target.to_str().unwrap())
                .ok();
            symlink_header.set_entry_type(tar::EntryType::Symlink);
            symlink_header.set_size(0);
            symlink_header.set_mode(0o777);
            symlink_header.set_cksum();
            builder.append(&symlink_header, &[][..]).unwrap();

            // Entry 2: a directory entry at the same path "shared".
            let mut dir_header = tar::Header::new_gnu();
            dir_header.set_path("shared").ok();
            dir_header.set_entry_type(tar::EntryType::Directory);
            dir_header.set_size(0);
            dir_header.set_mode(0o755);
            dir_header.set_cksum();
            builder.append(&dir_header, &[][..]).unwrap();

            builder.into_inner().unwrap().finish().unwrap();
        }

        let err = unpack_dist_archive(&buf, &dest_root)
            .expect_err("symlink entry must be rejected before the directory entry is reached");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));

        // The outside target must be untouched -- proving rejection
        // fires before the symlink entry is ever unpacked.
        assert!(
            outside_target.is_dir(),
            "outside target must still exist and be untouched"
        );
        assert!(
            !dest_root.join("dist").join("shared").exists(),
            "no entry should be materialized under dest_root at all"
        );

        fs::remove_dir_all(&dest_root).ok();
        fs::remove_dir_all(&outside_target).ok();
    }

    #[test]
    fn unpack_dist_archive_rejects_directory_entry_then_hardlink_escape() {
        // Entry 1: a benign, safe directory entry "d". Entry 2: a
        // HARDLINK entry whose own path is nested inside that directory
        // ("d/escape") but whose link target is outside dest_root.
        // `is_safe_entry_path` alone would accept "d/escape"'s path (no
        // `..`, not absolute) -- only the separate link-type check
        // rejects it. This confirms the two checks are both required:
        // path safety alone is not enough once a directory from a prior
        // entry is in play.
        let dest_root = scratch_dir("dir-then-hardlink-dest");
        let outside_file = scratch_dir("dir-then-hardlink-outside").join("secret.txt");
        fs::write(&outside_file, b"do not touch").unwrap();

        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut builder = tar::Builder::new(encoder);

            let mut dir_header = tar::Header::new_gnu();
            dir_header.set_path("d").ok();
            dir_header.set_entry_type(tar::EntryType::Directory);
            dir_header.set_size(0);
            dir_header.set_mode(0o755);
            dir_header.set_cksum();
            builder.append(&dir_header, &[][..]).unwrap();

            let mut link_header = tar::Header::new_gnu();
            link_header.set_path("d/escape").ok();
            link_header
                .set_link_name(outside_file.to_str().unwrap())
                .ok();
            link_header.set_entry_type(tar::EntryType::Link);
            link_header.set_size(0);
            link_header.set_mode(0o644);
            link_header.set_cksum();
            builder.append(&link_header, &[][..]).unwrap();

            builder.into_inner().unwrap().finish().unwrap();
        }

        let err = unpack_dist_archive(&buf, &dest_root)
            .expect_err("hardlink entry nested under a benign directory must still be rejected");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));
        assert!(
            !dest_root.join("dist").join("d").join("escape").exists(),
            "hardlink target must never be materialized inside dest_root"
        );

        fs::remove_dir_all(&dest_root).ok();
        fs::remove_dir_all(outside_file.parent().unwrap()).ok();
    }

    #[test]
    fn unpack_dist_archive_rejects_parent_dir_component_buried_mid_path() {
        // The existing `unpack_dist_archive_rejects_path_traversal_entry`
        // test only exercises a LEADING `../escape.txt`. This confirms
        // `is_safe_entry_path`'s `components().any(...)` scan also
        // catches a `..` component buried in the MIDDLE of a
        // multi-segment path (e.g. "safe/../../escape.txt"), not just
        // at position 0 -- `Path::components()` is scanned in full via
        // `.any(...)`, so position should not matter, but this is
        // adversarial-tested rather than assumed.
        let dest_root = scratch_dir("mid-path-traversal-dest");
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            let evil_path = "safe/../../escape.txt";
            header.set_path(evil_path).ok();
            header.as_gnu_mut().unwrap().name[..evil_path.len()]
                .copy_from_slice(evil_path.as_bytes());
            header.set_size(4);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append(&header, &b"evil"[..]).unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }

        let err = unpack_dist_archive(&buf, &dest_root)
            .expect_err("a `..` component buried mid-path must be rejected");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));
        assert!(!dest_root.parent().unwrap().join("escape.txt").exists());
        assert!(!dest_root.join("escape.txt").exists());

        fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn is_safe_entry_path_platform_scope_note_windows_style_shapes_are_inert_on_unix() {
        // Documents a platform limitation rather than testing a real
        // escape: `is_safe_entry_path` checks `Component::Prefix` -- a
        // Windows-only concept (drive letters like "C:\", UNC paths
        // like "\\server\share"). On Unix, `std::path::Path`'s parser
        // never constructs a `Prefix` component for any input byte
        // sequence -- there is no drive letter or UNC prefix in POSIX
        // path syntax, so that arm of `is_safe_entry_path` is
        // unreachable dead logic here, not a tested defense. A literal
        // string like `"C:\\evil"` or `"\\\\server\\share\\evil"` is
        // parsed on Unix as a single, ordinary `Normal` path component
        // (backslash is a legal filename byte on Unix, not a separator)
        // -- it is not absolute, has no `..`/`Prefix` component, and so
        // passes `is_safe_entry_path`. That is correct and safe on this
        // platform: `dist_dir.join("C:\\evil")` still creates a file
        // literally named `C:\evil` inside `dist_dir` on Linux (backslash
        // is not a directory separator here), so nothing escapes.
        //
        // This is asserted directly below so the assumption is pinned
        // rather than left as a claim: any future change to
        // path-separator handling that made this fail would be a real
        // behavior change worth re-checking.
        //
        // A genuine test of the Windows-specific attack surface
        // (`Component::Prefix` rejection actually firing, ADS `:`-suffix
        // handling, etc.) requires running this suite on a Windows
        // filesystem, which this Linux environment cannot provide --
        // untestable here rather than faked.
        use std::path::Path;

        let windows_style_path = Path::new("C:\\evil");
        assert!(
            is_safe_entry_path(windows_style_path),
            "a Windows-style drive-letter string is parsed as one opaque Normal \
             component on Unix, not a Prefix -- it correctly passes is_safe_entry_path \
             because it cannot escape dist_dir under Unix path-separator semantics"
        );

        let unc_style_path = Path::new("\\\\server\\share\\evil");
        assert!(
            is_safe_entry_path(unc_style_path),
            "a UNC-style string is likewise one opaque Normal component on Unix"
        );
    }

    // --- "." / "" entry-path clobber-of-dist_dir tests ---

    #[test]
    fn is_safe_entry_path_rejects_empty_path() {
        // "" has zero components at all -- `dist_dir.join("")` resolves
        // to `dist_dir` itself, so an entry with this path must never
        // reach `entry.unpack(...)`.
        assert!(
            !is_safe_entry_path(Path::new("")),
            "an empty entry path must be rejected: it would clobber dist_dir itself"
        );
    }

    #[test]
    fn is_safe_entry_path_rejects_dot_path() {
        // "." parses to a single `Component::CurDir` -- after filtering
        // CurDir out, zero meaningful components remain, so this must be
        // rejected for the same reason as "".
        assert!(
            !is_safe_entry_path(Path::new(".")),
            "a \".\" entry path must be rejected: it would clobber dist_dir itself"
        );
    }

    #[test]
    fn is_safe_entry_path_rejects_curdir_only_path() {
        // "./." is entirely `CurDir` components (no `Normal` segment),
        // so it must be rejected for the same reason as "." and "" --
        // this confirms the filter isn't accidentally only checking the
        // first component.
        assert!(
            !is_safe_entry_path(Path::new("./.")),
            "a CurDir-only entry path must be rejected: it would clobber dist_dir itself"
        );
    }

    #[test]
    fn is_safe_entry_path_still_accepts_a_normal_relative_path() {
        // Regression guard: the "." rejection must not be so broad that
        // it rejects an ordinary safe path containing a leading "./"
        // component alongside a real, meaningful segment.
        assert!(
            is_safe_entry_path(Path::new("./real-file.txt")),
            "a path with a real segment alongside CurDir must still be accepted"
        );
        assert!(
            is_safe_entry_path(Path::new("agents/example.json")),
            "an ordinary nested relative path must still be accepted"
        );
    }

    #[test]
    fn unpack_dist_archive_rejects_dot_entry_path_before_any_unpack_call() {
        // Hand-build a tar.gz with a single entry whose path is exactly
        // "." -- without the Fix 2 check, `entry.unpack(dist_dir.join("."))`
        // resolves to `dist_dir` itself, risking a silent clobber of the
        // destination root. Assert the call is rejected and dist_dir is
        // left as an ordinary, still-empty directory -- proving rejection
        // happens before any unpack call is made, not as some partial
        // clobber artifact.
        let dest_root = scratch_dir("unpack-dot-entry-dest");
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            header.set_path(".").ok();
            header.set_entry_type(tar::EntryType::Regular);
            header.set_size(4);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append(&header, &b"evil"[..]).unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }

        let err = unpack_dist_archive(&buf, &dest_root)
            .expect_err("a \".\" entry path must be rejected before any unpack call");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));
        // dist_dir must still exist (created by create_dir_all above the
        // loop) and remain an ordinary, empty directory -- not
        // overwritten/clobbered by the rejected entry.
        let dist_dir = dest_root.join("dist");
        assert!(
            dist_dir.is_dir(),
            "dist_dir itself must still exist as a directory"
        );
        assert!(
            fs::read_dir(&dist_dir).unwrap().next().is_none(),
            "dist_dir must remain empty -- the \".\" entry must never have been unpacked into it"
        );

        fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn unpack_dist_archive_rejects_empty_entry_path_before_any_unpack_call() {
        // Same as the "." case above, but for a literal empty path "" --
        // set directly on the header bytes since `Header::set_path("")`
        // itself may reject/normalize an empty string before it ever
        // reaches our own check, and this test needs to prove OUR check
        // rejects it, not just that the tar crate refuses to build it.
        let dest_root = scratch_dir("unpack-empty-entry-dest");
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            // Leave the header's name field all-zero (its default state)
            // rather than calling `set_path`, so the entry's path parses
            // to an empty `PathBuf` rather than being rejected/altered by
            // `set_path`'s own validation.
            header.set_entry_type(tar::EntryType::Regular);
            header.set_size(4);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append(&header, &b"evil"[..]).unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }

        let result = unpack_dist_archive(&buf, &dest_root);
        // An all-zero name field may be surfaced by `tar` itself as a
        // parse/read error rather than reaching our `is_safe_entry_path`
        // check at all -- either way, the archive must be rejected and
        // dist_dir must never be clobbered. What matters for Fix 2 is
        // that a truly empty resolved path can never reach
        // `entry.unpack(...)`, regardless of which layer catches it.
        assert!(
            result.is_err(),
            "an empty entry path must never be unpacked"
        );
        let dist_dir = dest_root.join("dist");
        assert!(
            fs::read_dir(&dist_dir).unwrap().next().is_none(),
            "dist_dir must remain empty -- an empty-path entry must never have been unpacked into it"
        );

        fs::remove_dir_all(&dest_root).ok();
    }

    // --- Entry-COUNT cap (independent of the byte cap) tests ---

    #[test]
    fn unpack_dist_archive_rejects_archive_exceeding_the_entry_count_cap() {
        // Real tar.gz built via the same tar::Builder/GzEncoder path as
        // package_dist, containing one more ZERO-BYTE entry than
        // MAX_ENTRY_COUNT allows. Zero-byte entries deliberately never
        // approach MAX_UNPACKED_BYTES -- this proves the entry-count cap
        // is a genuinely independent defense, not a byte-cap side effect.
        // Built via `unpack_dist_archive_with_limit` with a tiny per-test
        // count-cap override so the test doesn't have to actually build
        // and stream 50,001 real entries -- exercising the identical
        // mid-iteration counting/rejection logic against a small,
        // fast-to-build archive instead.
        //
        // Local override avoids materializing MAX_ENTRY_COUNT+1 (50,001)
        // real tar entries in every test run; the counting/rejection code
        // path exercised is identical regardless of the cap's value.
        const TINY_ENTRY_CAP: usize = 5;
        let dest_root = scratch_dir("unpack-over-entry-cap-dest");
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::fast());
            let mut builder = tar::Builder::new(encoder);
            for i in 0..(TINY_ENTRY_CAP + 1) {
                let mut header = tar::Header::new_gnu();
                header.set_path(format!("zero-byte-{i}.bin")).unwrap();
                header.set_entry_type(tar::EntryType::Regular);
                header.set_size(0);
                header.set_mode(0o644);
                header.set_cksum();
                builder.append(&header, &[][..]).unwrap();
            }
            builder.into_inner().unwrap().finish().unwrap();
        }

        let err =
            unpack_dist_archive_with_limit(&buf, &dest_root, MAX_UNPACKED_BYTES, TINY_ENTRY_CAP)
                .expect_err("archive exceeding the entry-count cap must be rejected");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));

        // Rejected mid-iteration: strictly fewer than TINY_ENTRY_CAP + 1
        // entries (the full archive size) may have been materialized --
        // proving the cap is enforced DURING iteration, not after the
        // archive is fully consumed.
        let materialized = fs::read_dir(dest_root.join("dist"))
            .map(|rd| rd.count())
            .unwrap_or(0);
        assert!(
            materialized <= TINY_ENTRY_CAP,
            "no more than the cap's worth of entries may be materialized before rejection, got {materialized}"
        );

        fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn unpack_dist_archive_accepts_archive_at_exactly_the_entry_count_cap() {
        // Boundary check: an archive with EXACTLY the capped number of
        // entries (not one more) must succeed -- the cap must reject
        // "exceeds", not "reaches", the limit.
        const TINY_ENTRY_CAP: usize = 5;
        let dest_root = scratch_dir("unpack-at-entry-cap-dest");
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::fast());
            let mut builder = tar::Builder::new(encoder);
            for i in 0..TINY_ENTRY_CAP {
                let mut header = tar::Header::new_gnu();
                header.set_path(format!("zero-byte-{i}.bin")).unwrap();
                header.set_entry_type(tar::EntryType::Regular);
                header.set_size(0);
                header.set_mode(0o644);
                header.set_cksum();
                builder.append(&header, &[][..]).unwrap();
            }
            builder.into_inner().unwrap().finish().unwrap();
        }

        unpack_dist_archive_with_limit(&buf, &dest_root, MAX_UNPACKED_BYTES, TINY_ENTRY_CAP)
            .expect("an archive with exactly the cap's entry count must succeed");
        let materialized = fs::read_dir(dest_root.join("dist")).unwrap().count();
        assert_eq!(materialized, TINY_ENTRY_CAP);

        fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn unpack_dist_archive_rejects_real_package_dist_archive_exceeding_entry_count_cap() {
        // End-to-end with a REAL package_dist-built archive (not a
        // hand-built one) whose dist tree has more files than a tiny
        // test-scoped cap allows -- proves the cap fires on ordinary,
        // realistic archive construction too, not just hand-crafted
        // adversarial ones.
        const TINY_ENTRY_CAP: usize = 2;
        let dist_root = scratch_dir("real-over-entry-cap-dist");
        seed_dist_agent(&dist_root, "one", b"{}\n");
        seed_dist_agent(&dist_root, "two", b"{}\n");
        seed_dist_agent(&dist_root, "three", b"{}\n");
        let (artifact_bytes, _) = build_real_artifact_and_sidecar(&dist_root);

        let dest_root = scratch_dir("real-over-entry-cap-dest");
        let err = unpack_dist_archive_with_limit(
            &artifact_bytes,
            &dest_root,
            MAX_UNPACKED_BYTES,
            TINY_ENTRY_CAP,
        )
        .expect_err("a real archive with more entries than the cap must be rejected");
        assert!(matches!(err, RemoteInstallError::Unpack(_)));

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&dest_root).ok();
    }

    // ── MCP server binary (skill-lookup-mcp) remote fetch tests ─────────

    /// The sidecar-recorded filename `install_mcp_server_binary_into_remote_temp_dir`
    /// re-derives internally from the CURRENT host's own target triple
    /// (see that function's own doc comment) -- tests must build their
    /// fake sidecars against that same real triple, not a hardcoded
    /// one, so these tests pass regardless of which of the three
    /// supported CI runner architectures actually executes them. Skips
    /// (returns `None`) rather than asserting on an unsupported test
    /// runner platform -- none of the three supported CI runners hit
    /// that branch, and hardcoding a fallback string here would defeat
    /// the whole point of re-deriving it for real.
    fn current_host_mcp_binary_filename(release_version: &str) -> Option<String> {
        super::super::target_triple::current_host_target_triple().map(|triple| {
            super::super::github::expected_mcp_server_asset_filename(release_version, triple)
        })
    }

    /// Builds a real `(binary_bytes, sidecar_bytes)` pair with a
    /// matching sha256 sidecar, mirroring `build_real_artifact_and_sidecar`'s
    /// own real-hash construction but for the MCP binary shape instead
    /// of a packaged tarball. Sidecar filename is the CURRENT host's
    /// own real triple (see `current_host_mcp_binary_filename`).
    fn build_real_mcp_binary_and_sidecar(contents: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let filename = current_host_mcp_binary_filename("v0.1.1")
            .expect("test runner must be one of the three supported CI platforms");
        let hash = artifact::sha256_hex(contents);
        let sidecar_bytes = format!("{hash}  {filename}\n").into_bytes();
        (contents.to_vec(), sidecar_bytes)
    }

    /// A real fake fetcher: succeeds with real, checksum-matching bytes
    /// for a given `release_version`.
    fn fake_mcp_fetcher_success(
        contents: Vec<u8>,
        release_version: &str,
    ) -> McpBinaryFetcher<'static> {
        let (binary_bytes, sidecar_bytes) = build_real_mcp_binary_and_sidecar(&contents);
        let release_version = release_version.to_string();
        Box::new(move || {
            Ok((
                binary_bytes.clone(),
                sidecar_bytes.clone(),
                release_version.clone(),
            ))
        })
    }

    /// (a) Correct asset filename construction per platform: pins that
    /// this test module's own `MCP_BINARY_FILENAME` constant matches
    /// `github::expected_mcp_server_asset_filename`'s real construction
    /// -- proving the sidecar text this test builds is the SAME shape
    /// production code expects, not a hand-guessed string that happens
    /// to look right.
    #[test]
    fn mcp_binary_filename_construction_matches_github_module_for_every_supported_platform() {
        let cases = [
            ("v0.1.1", "x86_64-unknown-linux-musl"),
            ("v0.1.1", "aarch64-unknown-linux-musl"),
            ("v0.1.1", "aarch64-apple-darwin"),
        ];
        for (version, triple) in cases {
            let expected =
                super::super::github::expected_mcp_server_asset_filename(version, triple);
            assert_eq!(expected, format!("skill-lookup-mcp-{version}-{triple}"));
        }
    }

    /// (b) Checksum verification SUCCESS, end to end: a fake fetcher
    /// returning real, checksum-matching bytes must land the binary,
    /// executable, at `<temp_dir>/mcp/target/release/skill-lookup-mcp`
    /// -- the exact path `mcp_server::mcp_binary_source_path` reads
    /// from locally.
    #[cfg(unix)]
    #[test]
    fn install_mcp_server_binary_into_remote_temp_dir_succeeds_with_matching_checksum() {
        let temp_dir = scratch_dir("mcp-fetch-checksum-ok");
        let fetcher = fake_mcp_fetcher_success(b"fake mcp binary bytes".to_vec(), "v0.1.1");

        let result = install_mcp_server_binary_into_remote_temp_dir(fetcher, &temp_dir)
            .expect("a checksum-matching fetch must succeed");
        assert_eq!(result, Some("v0.1.1".to_string()));

        let installed = temp_dir
            .join("mcp")
            .join("target")
            .join("release")
            .join("skill-lookup-mcp");
        assert!(installed.is_file());
        assert_eq!(fs::read(&installed).unwrap(), b"fake mcp binary bytes");

        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&installed).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o755, "installed MCP binary must be executable");

        fs::remove_dir_all(&temp_dir).ok();
    }

    /// (b) Checksum verification FAILURE: a fetcher returning bytes
    /// that don't match the sidecar's recorded hash must fail with
    /// `VerifyChecksum`, and must never write anything to disk.
    #[test]
    fn install_mcp_server_binary_into_remote_temp_dir_fails_on_checksum_mismatch() {
        let temp_dir = scratch_dir("mcp-fetch-checksum-mismatch");
        let real_contents = b"fake mcp binary bytes".to_vec();
        let (binary_bytes, _) = build_real_mcp_binary_and_sidecar(&real_contents);
        let filename = current_host_mcp_binary_filename("v0.1.1").unwrap();
        let bad_sidecar = format!("{}  {filename}\n", "0".repeat(64)).into_bytes();
        let fetcher: McpBinaryFetcher = Box::new(move || {
            Ok((
                binary_bytes.clone(),
                bad_sidecar.clone(),
                "v0.1.1".to_string(),
            ))
        });

        let err = install_mcp_server_binary_into_remote_temp_dir(fetcher, &temp_dir)
            .expect_err("a checksum mismatch must fail");
        assert!(matches!(err, RemoteInstallError::VerifyChecksum(_)));
        assert!(
            !temp_dir.join("mcp").exists(),
            "no bytes must be written to disk when checksum verification fails"
        );

        fs::remove_dir_all(&temp_dir).ok();
    }

    /// A malformed sidecar (not the `<hash>  <filename>` shape) must
    /// fail with `VerifySidecar`, distinguishable from a checksum
    /// mismatch.
    #[test]
    fn install_mcp_server_binary_into_remote_temp_dir_fails_on_malformed_sidecar() {
        let temp_dir = scratch_dir("mcp-fetch-malformed-sidecar");
        let fetcher: McpBinaryFetcher = Box::new(|| {
            Ok((
                b"fake mcp binary bytes".to_vec(),
                b"not a valid sidecar".to_vec(),
                "v0.1.1".to_string(),
            ))
        });

        let err = install_mcp_server_binary_into_remote_temp_dir(fetcher, &temp_dir)
            .expect_err("a malformed sidecar must fail");
        assert!(matches!(err, RemoteInstallError::VerifySidecar(_)));

        fs::remove_dir_all(&temp_dir).ok();
    }

    /// (c) Unmapped-platform error path: a fetcher failing with the
    /// unsupported-platform marker must DEGRADE GRACEFULLY -- return
    /// `Ok(None)`, write nothing to disk, and never propagate as an
    /// install-blocking error.
    #[test]
    fn install_mcp_server_binary_into_remote_temp_dir_degrades_gracefully_on_unsupported_platform()
    {
        let temp_dir = scratch_dir("mcp-fetch-unsupported-platform");
        let fetcher: McpBinaryFetcher = Box::new(|| {
            Err(std::io::Error::other(format!(
                "{MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER}no skill-lookup-mcp binary is \
                 published for macos/x86_64; skill lookups will be unavailable for this install"
            )))
        });

        let result = install_mcp_server_binary_into_remote_temp_dir(fetcher, &temp_dir).expect(
            "an unsupported platform must degrade gracefully, never error the whole install",
        );
        assert_eq!(
            result, None,
            "no version is resolved when the platform has no published binary"
        );
        assert!(
            !temp_dir.join("mcp").exists(),
            "nothing must be written to disk for an unsupported platform"
        );

        fs::remove_dir_all(&temp_dir).ok();
    }

    /// A supported-platform fetch/verify failure that is NOT the
    /// unsupported-platform marker (a real network error on a mapped
    /// triple) must be a BLOCKING, non-panicking error -- distinguishable
    /// from the unsupported-platform case by returning `Err`, not
    /// `Ok(None)`.
    #[test]
    fn install_mcp_server_binary_into_remote_temp_dir_blocks_on_a_real_network_error() {
        let temp_dir = scratch_dir("mcp-fetch-network-error");
        let fetcher: McpBinaryFetcher =
            Box::new(|| Err(std::io::Error::other("connection refused")));

        let err = install_mcp_server_binary_into_remote_temp_dir(fetcher, &temp_dir)
            .expect_err("a real fetch failure on a supported platform must block the install");
        assert!(matches!(err, RemoteInstallError::McpBinaryFetch(_)));
        assert!(err.to_string().contains("connection refused"));

        fs::remove_dir_all(&temp_dir).ok();
    }

    /// (d) mcpServers injection on success, end to end through
    /// `install_from_remote_bytes` itself (not just the inner fetch
    /// helper): a real tarball install (with an agent declaring a
    /// packaged-skill resource) PLUS a real, checksum-matching MCP
    /// binary fetcher must result in an installed agent JSON carrying
    /// an injected `mcpServers.konductor-skills` entry pointing at the
    /// binary this run just fetched and installed -- proving
    /// `McpInstallPhase`/`resource_rewrite::McpServerPass` (both
    /// unmodified) transparently pick up the remotely-fetched binary
    /// the same way they already do for a local `--from` build.
    #[test]
    fn install_from_remote_bytes_injects_mcp_server_entry_when_binary_fetcher_supplied() {
        let dist_root = scratch_dir("mcp-e2e-dist");
        // An agent declaring a skill:// resource, plus the skill itself
        // -- the shape `resource_rewrite::McpServerPass::matches` gates
        // injection on.
        let agents_dir = dist_root.join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(
            agents_dir.join("k-example.json"),
            br#"{"name":"k-example","resources":["skill://skills/constraints/SKILL.md"]}"#,
        )
        .unwrap();
        let skills_dir = dist_root
            .join("kiro-cli-v2")
            .join("skills")
            .join("constraints");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(
            skills_dir.join("SKILL.md"),
            b"---\nname: constraints\n---\nBody\n",
        )
        .unwrap();
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);

        let mcp_fetcher = fake_mcp_fetcher_success(b"real mcp binary bytes".to_vec(), "v0.1.1");

        let target_dir = scratch_dir("mcp-e2e-target");
        let tag = "mcp-e2e-tag";

        let outcome = install_from_remote_bytes_named(
            tag,
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &sidecar_bytes,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            Some(mcp_fetcher),
        )
        .expect("end-to-end install with a real MCP-binary fetcher must succeed");
        assert_eq!(outcome.mcp_binary_version, Some("v0.1.1".to_string()));

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_slice(&fs::read(&installed_agent).unwrap()).unwrap();
        let command = value["mcpServers"]["konductor-skills"]["command"]
            .as_str()
            .expect("mcpServers.konductor-skills.command must be injected");
        assert!(
            Path::new(command).is_file(),
            "the injected command must point at the actually-installed binary on disk"
        );
        assert_eq!(
            std::path::Path::new(command),
            target_dir.join(".konductor/bin/skill-lookup-mcp")
        );

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// (e) No `mcp_binary_fetcher` supplied (e.g. the main-branch-dist
    /// source) must install successfully with no `mcpServers` injection
    /// at all -- the pre-existing tarball-only behavior every earlier
    /// test in this module already exercises, pinned once more here
    /// explicitly for the "no fetcher" contract this feature adds.
    #[test]
    fn install_from_remote_bytes_installs_with_no_mcp_injection_when_fetcher_is_none() {
        let dist_root = scratch_dir("mcp-e2e-no-fetcher-dist");
        seed_dist_agent(&dist_root, "k-example", b"{\"name\":\"k-example\"}\n");
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);

        let target_dir = scratch_dir("mcp-e2e-no-fetcher-target");
        let outcome = install_from_remote_bytes(
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &sidecar_bytes,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            None,
        )
        .expect("install with no MCP-binary fetcher must still succeed");
        assert_eq!(outcome.mcp_binary_version, None);
        assert!(!target_dir.join(".konductor/bin").exists());

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// The unsupported-platform case, exercised end to end through
    /// `install_from_remote_bytes`: the whole install must still
    /// succeed (agents/skills/context install normally), with no
    /// `mcpServers` injection and no MCP binary on disk -- degrade
    /// gracefully, never block.
    #[test]
    fn install_from_remote_bytes_succeeds_with_no_mcp_binary_when_platform_unsupported() {
        let dist_root = scratch_dir("mcp-e2e-unsupported-dist");
        seed_dist_agent(&dist_root, "k-example", b"{\"name\":\"k-example\"}\n");
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);

        let unsupported_fetcher: McpBinaryFetcher = Box::new(|| {
            Err(std::io::Error::other(format!(
                "{MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER}no skill-lookup-mcp binary is \
                 published for macos/x86_64; skill lookups will be unavailable for this install"
            )))
        });

        let target_dir = scratch_dir("mcp-e2e-unsupported-target");
        let outcome = install_from_remote_bytes(
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &sidecar_bytes,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            Some(unsupported_fetcher),
        )
        .expect("an unsupported platform must never block the rest of the install");
        assert_eq!(outcome.mcp_binary_version, None);
        assert!(target_dir.join(".kiro/agents/k-example.json").is_file());
        assert!(!target_dir.join(".konductor/bin").exists());

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// A real fetch/verify failure on a SUPPORTED platform (distinct
    /// from the unsupported-platform case) must block the WHOLE
    /// install, end to end -- no manifest written, no partial install.
    #[test]
    fn install_from_remote_bytes_blocks_whole_install_on_supported_platform_fetch_failure() {
        let dist_root = scratch_dir("mcp-e2e-blocking-dist");
        seed_dist_agent(&dist_root, "k-example", b"{\"name\":\"k-example\"}\n");
        let (artifact_bytes, sidecar_bytes) = build_real_artifact_and_sidecar(&dist_root);

        let failing_fetcher: McpBinaryFetcher =
            Box::new(|| Err(std::io::Error::other("connection refused")));

        let target_dir = scratch_dir("mcp-e2e-blocking-target");
        let err = install_from_remote_bytes(
            &KiroCliInstallStrategy,
            &target_dir,
            artifact_bytes,
            &sidecar_bytes,
            ARTIFACT_FILENAME,
            "2026-01-01T00:00:00Z",
            false,
            Some(failing_fetcher),
        )
        .expect_err("a real MCP-binary fetch failure on a supported platform must block install");
        assert!(matches!(err, RemoteInstallError::McpBinaryFetch(_)));
        assert!(
            !target_dir.join(".konductor").join("manifest").exists(),
            "no manifest should be written when the MCP-binary fetch blocks the install"
        );

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }
}
