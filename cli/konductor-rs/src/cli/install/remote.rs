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
/// is a few MB; 256MB is over 100x that, generous for growth while
/// still bounding decompressed output. Hardcoded, no config override.
const MAX_UNPACKED_BYTES: u64 = 256 * 1024 * 1024;

/// Hard ceiling on total archive entry count, enforced during the same
/// per-entry loop that already applies `MAX_UNPACKED_BYTES` to total
/// bytes -- a separate cap from the byte cap, since many zero-byte
/// entries cost memory and inodes per entry without approaching it. A
/// real `dist/` tree today has on the order of a hundred files; 50,000
/// is generous for growth while keeping rejection cheap.
const MAX_ENTRY_COUNT: usize = 50_000;

/// What `install_from_remote_bytes` can fail with. `VerifySidecar`/
/// `VerifyChecksum` are split so a caller can map each to its own exit
/// code. `Unpack` covers a corrupt/unsafe archive or disk I/O.
/// `Install` passes `install_from_local`'s error through unchanged.
/// `McpBinaryFetch` covers a supported-platform MCP binary fetch/verify
/// failure that is NOT the "platform unsupported" case (see
/// `install_mcp_server_binary_into_remote_temp_dir`'s own doc comment).
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
/// existing `parse_sidecar`/`verify_sha256`. `expected_filename` is the
/// artifact's own filename, the same value `write_sidecar` embedded
/// when the sidecar was produced.
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
/// Production wires this to an already-resolved asset-fetch result;
/// tests inject a fake closure instead, so no test depends on network
/// access.
///
/// `FnOnce`, not `Fn`: invoked at most once per install, at the single
/// call site inside `install_mcp_server_binary_into_remote_temp_dir`.
/// The bound makes that single-call contract a compile-time property
/// of the type itself.
pub(crate) type McpBinaryFetcher<'a> =
    Box<dyn FnOnce() -> std::io::Result<(Vec<u8>, Vec<u8>, String)> + 'a>;

/// Sentinel prefix `install_mcp_server_binary_into_remote_temp_dir`
/// looks for in a mapped fetcher error's message to recover the
/// "platform unsupported" signal across the `std::io::Error` boundary
/// `McpBinaryFetcher`'s closure shape imposes. Production's real
/// fetcher prefixes exactly this marker whenever the underlying error
/// is `UnsupportedPlatform`, so the distinction survives the mapping.
pub(crate) const MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER: &str =
    "__konductor_mcp_binary_unsupported_platform__:";

/// The one MCP server binary this remote-fetch path installs --
/// `skill-lookup-mcp`, matching `mcp_server::MCP_SERVER_BINARY_NAMES`'s
/// sole entry.
fn mcp_binary_name() -> &'static str {
    "skill-lookup-mcp"
}

/// The explicit, actionable warning printed when the current host has
/// no published `skill-lookup-mcp` binary at all. `rendered_error_text`
/// is the already-rendered `UnsupportedPlatform` error's own `Display`
/// text, printed verbatim.
fn unsupported_platform_warning(rendered_error_text: &str) -> String {
    format!("konductor install: warning: {rendered_error_text}")
}

/// Parses `sidecar_bytes` as a `sha256sum`-format sidecar and returns
/// just the hash, checked against `expected_filename`.
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
/// its own fetched `.sha256` sidecar, and writes the verified bytes to
/// `<temp_dir_path>/mcp/target/release/skill-lookup-mcp` -- the exact
/// path `mcp_server::mcp_binary_source_path`/`install_bin_files`
/// already read from locally, so `McpInstallPhase` picks the binary up
/// transparently once `strategy.install_from_local` runs with
/// `temp_dir_path` as its own `repo_root`. Sets the executable bit via
/// the existing `kiro_cli::set_executable` helper.
///
/// Returns `Ok(None)` -- degrades gracefully, never blocking the rest
/// of the install -- when `fetcher()` fails with the unsupported-
/// platform marker (see `MCP_BINARY_UNSUPPORTED_PLATFORM_MARKER`): a
/// platform with no published binary at all is a permanent, expected
/// condition, not a transient failure, so failing the whole install
/// over it would block every agent/skill/context install too, for a
/// feature (skill lookup) that is optional at runtime. Prints a clear
/// warning via `unsupported_platform_warning` instead.
///
/// Returns `Err(RemoteInstallError::McpBinaryFetch)` -- blocking the
/// whole install -- for every other fetcher failure on a platform that
/// IS mapped to a real target triple: a network error, or a release
/// genuinely missing that platform's asset, are unexpected/transient
/// conditions, distinguishable from the "not supported at all" case by
/// not carrying the marker. A checksum mismatch instead maps to
/// `RemoteInstallError::VerifyChecksum`/`VerifySidecar`.
///
/// Returns `Ok(Some(release_version))` on success -- the release's own
/// version string, threaded back so a caller can report the
/// actually-installed content's version.
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
    // filename that was actually fetched, reconstructed the same way
    // `github::resolve_mcp_server_asset_from_release` built it. Valid
    // because this function only ever runs on the same host that
    // fetched the bytes.
    let binary_filename = match super::target_triple::current_host_target_triple() {
        Some(triple) => super::github::expected_mcp_server_asset_filename(&release_version, triple),
        // Unreachable in practice: a fetcher that succeeded already
        // proved the platform is supported. Falls back rather than
        // panicking, in case a future fake test fetcher exercises this
        // path with a mismatched host.
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
/// itself rather than something inside it.
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
    // `CurDir` segments) has zero meaningful components once `CurDir`
    // is filtered out. `dist_dir.join(path)` for such a path resolves
    // to `dist_dir` itself, so unpacking it would clobber the
    // destination root rather than write something inside it.
    path.components().any(|c| !matches!(c, Component::CurDir))
}

/// Wraps a decompressing reader and fails once more than `limit` total
/// bytes have been read from it, so a gzip/tar bomb is caught
/// mid-stream rather than after fully materializing into memory or
/// disk. Neither `flate2` nor `tar` provides this.
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
/// that resolves to nothing (which would otherwise clobber `dist_dir`
/// itself), and rejects symlink/hardlink entries outright, so an entry
/// can never write outside `dest_root` or overwrite its root. Preserves
/// the Unix executable bit via tar's own `unpack`. Bounds both total
/// decompressed bytes (via `CappedReader`) and total entry count (via
/// `MAX_ENTRY_COUNT`), each checked mid-stream/mid-iteration.
///
/// Thin, test-only wrapper around `unpack_dist_archive_with_limit`
/// fixed to the real caps. Production calls that function directly.
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
/// cap's mid-iteration rejection against tiny limits, instead of
/// allocating a real 256 MiB+ buffer or building 50,000+ real tar
/// entries per test. This is the real production function despite not
/// being `pub`: `install_from_remote_bytes_named_with_limit` calls it
/// directly with the real fixed caps on every GitHub-release install.
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
        // Rejects link entries outright: `is_safe_entry_path` only
        // checks an entry's own path, not where a symlink or hardlink
        // points.
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
/// every exit path without a manual `remove_dir_all` at each return.
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
        // `create_dir` (singular), not `create_dir_all`: fails with
        // `AlreadyExists` if the path is already occupied (e.g. by a
        // symlink), rather than silently following it. That
        // exclusivity check is the security boundary; the random tag
        // folded into the path name makes the path itself harder to
        // predict or race against ahead of time.
        std::fs::create_dir(&path)?;
        Ok(Self { path })
    }
}

/// Returns a per-call random `u64` for folding into `RemoteTempDir`'s
/// scratch path name, on top of the existing timestamp+counter. Not
/// cryptographically secure and doesn't need to be: the actual
/// exclusivity guarantee is `create_dir`'s `AlreadyExists` check, not
/// this value's secrecy -- it only needs to be hard to predict.
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
/// shape matches exactly what `install_from_remote_bytes` consumes. In
/// production this resolves the tarball asset from the fetched GitHub
/// Release (wired via `install::remote_orchestrate`); this type alias
/// also serves as the closure shape tests use to inject a fake fetcher.
pub type RemoteArtifactFetcher<'a> = Box<dyn Fn() -> std::io::Result<(Vec<u8>, Vec<u8>)> + 'a>;

/// What a successful `install_from_remote_bytes` call actually
/// installed, beyond "it succeeded" -- the MCP server binary's own
/// release version (`None` when no `mcp_binary_fetcher` was supplied,
/// or when the current host has no published binary) and the bare
/// names of every SOP staged for this install (see
/// `super::staged_sop_names`'s own doc comment). `staged_sop_names` is
/// threaded through because the staged `dist/` tree this outcome is
/// built from lives only in a scratch temp directory that is deleted
/// the instant `install_from_remote_bytes_named_with_limit` returns
/// (see `RemoteTempDir::drop`) -- by the time a caller could otherwise
/// re-read it to classify a `.claude/skills/sop-<name>` manifest entry,
/// it is already gone.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RemoteInstallOutcome {
    pub mcp_binary_version: Option<String>,
    pub staged_sop_names: std::collections::HashSet<String>,
}

/// Verifies the pair, unpacks into a fresh temp directory, hands that
/// directory's path to `strategy.install_from_local` unchanged, then
/// removes the temp directory before returning -- success or failure.
/// `artifact_filename` is the sidecar-recorded filename passed through
/// to verification. Wired into `dispatch_install_with`'s no-`--from`
/// branch via `install::remote_orchestrate::install_from_latest_github_release`.
///
/// `mcp_binary_fetcher` is `None` for a caller with no analogous
/// per-platform release asset to fetch (e.g.
/// `install_from_main_branch_dist`'s main-branch-`dist/` source);
/// `Some(fetcher)` for the real GitHub-release path. See
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
/// against other concurrently-running tests' scratch directories under
/// the same shared prefix.
///
/// Thin wrapper around `install_from_remote_bytes_named_with_limit`
/// fixed to the real `MAX_UNPACKED_BYTES` cap -- the only production
/// call path.
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
    // `install_from_local` runs, so `McpInstallPhase` finds it exactly
    // where it already looks for a local `--from` build. `None` or an
    // unsupported-platform outcome both leave this `None`, never an
    // error on their own.
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

    // Read while `temp_dir` is still alive -- `RemoteTempDir::drop`
    // deletes the staged `dist/` tree the instant this function
    // returns, so this is the last point the real staged SOP names are
    // reachable at all. Threaded out via `RemoteInstallOutcome` so a
    // caller can classify a `.claude/skills/sop-<name>` manifest entry
    // after the fact without the staged source still being on disk.
    let staged_sop_names =
        super::staged_sop_names(&temp_dir.path.join("dist").join(strategy.harness_dir()));

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

    Ok(RemoteInstallOutcome {
        mcp_binary_version,
        staged_sop_names,
    })
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
    /// name containing `tag` -- checks the real filesystem rather than
    /// trusting the guard's `Drop` alone. Checking an exact per-call tag
    /// (rather than the shared prefix) avoids flapping under parallel
    /// test execution.
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
        // A real entry whose content (not just a declared header size)
        // exceeds the cap, exercising CappedReader's mid-stream
        // rejection. Uses a tiny limit/payload instead of a real
        // 256 MiB+ buffer.
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
        // Streaming extraction may leave a partial file; what matters
        // is it was never fully written.
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
        // An oversized archive that passes checksum verification is
        // still rejected at unpack, and RemoteTempDir's cleanup still
        // fires. Uses a tiny limit/payload instead of a real
        // 256 MiB+ buffer.
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
        // With telemetry enabled, `TelemetryHookPass` re-serializes the
        // agent file, so check the field that survives rather than raw
        // bytes.
        let installed_value: serde_json::Value =
            serde_json::from_slice(&fs::read(&installed).unwrap()).unwrap();
        assert_eq!(installed_value["name"], serde_json::json!("k-example"));

        let manifest = crate::cli::install::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after remote install");
        assert_eq!(manifest.strategy_names(), vec!["kiro-cli-v2"]);

        // Temp dir must be cleaned up on success -- check this call's
        // own uniquely-tagged temp dir on the real filesystem.
        assert!(
            !any_temp_entry_contains(tag),
            "no leftover scratch temp directory should remain after a successful install"
        );

        fs::remove_dir_all(&dist_root).ok();
        fs::remove_dir_all(&target_dir).ok();
    }

    /// The manifest's `source` field must be the stable
    /// `remote:<artifact_filename>` marker, never the ephemeral scratch
    /// temp directory `install_from_local` was given -- that directory
    /// is deleted the instant this call returns, so recording it would
    /// make `doctor` always report the source as missing.
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
    /// source-overwrite tolerates `read_manifest` returning `Err` for a
    /// manifest `install_from_local` just wrote. This runs a real,
    /// successful end-to-end install, then corrupts the written
    /// manifest's bytes on disk to confirm `read_manifest` genuinely
    /// fails against it -- proving the guard's failure branch is
    /// reachable against real content from this exact code path.
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

        // Confirm the success path already ran and set the stable
        // source marker.
        let manifest_before = crate::cli::install::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after a successful install");
        assert_eq!(
            manifest_before.strategies[0].source,
            Some(format!("remote:{ARTIFACT_FILENAME}")),
            "sanity check: the success path must have already set the stable source marker"
        );

        // Corrupt the manifest file `install_from_local` really wrote
        // and confirm `read_manifest` genuinely fails against it.
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
        // manifest on disk.
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
        // `create_dir_all` would.
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

        // The planted symlink/dir must be untouched.
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
        // entropy suffix. Pins the concrete property the entropy
        // suffix adds: the same-name-tag path across two calls differs
        // in more than just the low-order nanosecond/counter fields.
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

        // Each name ends in a `-<16 hex digits>` random-entropy suffix.
        // Assert it is not a simple increment/decrement of the other.
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
        // Two calls in immediate succession must not produce the same
        // value.
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
    // `dist_dir` through an interaction the single-entry checks don't
    // catch on their own -- one entry creating something at a path, a
    // later entry traversing through/around it.
    //
    // One test below reproduces the entry ordering behind
    // RUSTSEC-2026-0067 / CVE-2026-33056: a symlink entry followed by a
    // directory entry at the same path. Our own per-entry link-type
    // rejection runs before any entry reaches `tar`'s internal unpack
    // logic, intercepting that shape independently of which `tar`
    // version is linked.

    #[test]
    fn unpack_dist_archive_rejects_cve_2026_33056_symlink_then_directory_ordering() {
        // A symlink entry pointing outside `dist_dir`, followed by a
        // directory entry at the identical path. Our per-entry loop
        // rejects the symlink entry on sight, before the second entry
        // is ever unpacked.
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
        // Entry 1: a benign directory "d". Entry 2: a hardlink entry
        // whose own path is nested inside that directory ("d/escape")
        // but whose link target is outside dest_root.
        // `is_safe_entry_path` alone would accept "d/escape"'s path --
        // only the separate link-type check rejects it.
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
        // Confirms a `..` component buried mid-path (not just leading)
        // is also caught.
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
        // Documents a platform limitation: `is_safe_entry_path` checks
        // `Component::Prefix`, a Windows-only concept. On Unix,
        // `std::path::Path` never constructs a `Prefix` component for
        // any input, so that arm is unreachable here. A literal string
        // like `"C:\\evil"` parses on Unix as one ordinary `Normal`
        // component -- not absolute, no `..`/`Prefix`, so it passes
        // `is_safe_entry_path`. That's safe on this platform:
        // `dist_dir.join("C:\\evil")` still creates a file literally
        // named `C:\evil` inside `dist_dir`.
        //
        // A genuine test of the Windows-specific attack surface requires
        // running on a Windows filesystem, which this environment
        // cannot provide.
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
        assert!(
            !is_safe_entry_path(Path::new("")),
            "an empty entry path must be rejected: it would clobber dist_dir itself"
        );
    }

    #[test]
    fn is_safe_entry_path_rejects_dot_path() {
        assert!(
            !is_safe_entry_path(Path::new(".")),
            "a \".\" entry path must be rejected: it would clobber dist_dir itself"
        );
    }

    #[test]
    fn is_safe_entry_path_rejects_curdir_only_path() {
        assert!(
            !is_safe_entry_path(Path::new("./.")),
            "a CurDir-only entry path must be rejected: it would clobber dist_dir itself"
        );
    }

    #[test]
    fn is_safe_entry_path_still_accepts_a_normal_relative_path() {
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
        // A single entry whose path is exactly "." -- without this
        // check, `entry.unpack(dist_dir.join("."))` resolves to
        // `dist_dir` itself, risking a silent clobber of the
        // destination root.
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
        // Same as the "." case above, for a literal empty path "" --
        // set directly on the header bytes since `set_path("")` may
        // itself reject/normalize an empty string before reaching our
        // own check.
        let dest_root = scratch_dir("unpack-empty-entry-dest");
        let mut buf = Vec::new();
        {
            let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
            let mut builder = tar::Builder::new(encoder);
            let mut header = tar::Header::new_gnu();
            // Leave the header's name field all-zero rather than
            // calling `set_path`, so the entry's path parses to an
            // empty `PathBuf`.
            header.set_entry_type(tar::EntryType::Regular);
            header.set_size(4);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append(&header, &b"evil"[..]).unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }

        let result = unpack_dist_archive(&buf, &dest_root);
        // An all-zero name field may be surfaced by `tar` itself as a
        // parse/read error rather than reaching our own check -- either
        // way, dist_dir must never be clobbered.
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
        // One more zero-byte entry than a tiny per-test cap allows.
        // Zero-byte entries never approach MAX_UNPACKED_BYTES, so this
        // proves the entry-count cap is a genuinely independent
        // defense from the byte cap.
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
        // entries may have been materialized.
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
        // The cap must reject "exceeds", not "reaches", the limit.
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
        // A real package_dist-built archive (not hand-built) whose
        // dist tree has more files than a tiny test-scoped cap allows.
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

    /// The sidecar-recorded filename is re-derived internally from the
    /// current host's own target triple -- tests must build fake
    /// sidecars against that same real triple, not a hardcoded one.
    /// Skips (returns `None`) on an unsupported test runner platform.
    fn current_host_mcp_binary_filename(release_version: &str) -> Option<String> {
        super::super::target_triple::current_host_target_triple().map(|triple| {
            super::super::github::expected_mcp_server_asset_filename(release_version, triple)
        })
    }

    /// Builds a real `(binary_bytes, sidecar_bytes)` pair with a
    /// matching sha256 sidecar, mirroring `build_real_artifact_and_sidecar`'s
    /// real-hash construction but for the MCP binary shape.
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

    /// Pins that this test module's own filename construction matches
    /// `github::expected_mcp_server_asset_filename`'s real
    /// construction, proving the sidecar text this test builds matches
    /// what production code expects.
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

    /// A fake fetcher returning real, checksum-matching bytes must land
    /// the binary, executable, at
    /// `<temp_dir>/mcp/target/release/skill-lookup-mcp`.
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
    /// unsupported-platform marker must degrade gracefully -- return
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
    /// `install_from_remote_bytes`: a real tarball install (with an
    /// agent declaring a packaged-skill resource) plus a real,
    /// checksum-matching MCP binary fetcher must result in an
    /// installed agent JSON carrying an injected
    /// `mcpServers.konductor-skills` entry pointing at the binary this
    /// run just fetched and installed.
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
