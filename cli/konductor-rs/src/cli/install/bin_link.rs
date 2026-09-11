// SPDX-License-Identifier: Apache-2.0
//
// install/bin_link.rs — `konductor install --link-bin` / `konductor
// uninstall`'s corresponding removal.
//
// ── Scope ────────────────────────────────────────────────────────────────
// `cli/README.md`'s "Getting started" walkthrough and `cli/Makefile`'s
// `link` target both already document/perform the same manual step:
// symlink the built `konductor` binary into `$HOME/.local/bin/konductor`
// so it is callable from anywhere on `$PATH`. Neither `install` nor
// `uninstall` has ever touched that symlink -- `install` only ever
// writes content scoped to `--target <dir>` (agents/context under
// `.kiro/`, skills under `.konductor/`; see install.rs's own module
// docstring), never its own running executable's location on `$PATH`.
// `--link-bin` closes that gap as an opt-in convenience; this module is
// its implementation.
//
// ── Why opt-in, not default-on ─────────────────────────────────────────
// A symlink at `$HOME/.local/bin/konductor` reaches OUTSIDE
// `--target <dir>` into a separate, fixed `$PATH` location regardless of
// what `--target` names -- a bigger, less containable side effect than
// anything `install` does by default today (entirely `--target`-scoped).
// `--link-bin` keeps that side effect opt-in.
//
// ── Why a separate sidecar, not a `Manifest` entry ─────────────────────
// `manifest::ManifestFile.path` is always relative to `destination`
// (== `target_dir`): "the file's real on-disk location is
// `<target_dir>/<files[i].path>`" (see manifest.rs's own docstring). The
// bin-link's real location is `$HOME/.local/bin/konductor`, which is
// NOT `<target_dir>`-relative once `--target` names anything other than
// `$HOME` -- forcing it into `Manifest.files` would break that
// invariant for every existing manifest reader (`uninstall`'s
// `delete_eligible_files`, `install.rs`'s `InstallCounts::from_manifest`,
// `doctor`). This module instead mirrors `install/index.rs`'s OWN
// precedent: a small, home-scoped sidecar (`$HOME/.konductor/bin-links`)
// alongside the install index, keyed by the SAME canonicalized
// `target_dir` string `index.rs` already uses -- so the install that
// requested `--link-bin` is exactly the uninstall that removes it, with
// no new path-resolution convention introduced. Same derive set, same
// schema-version-checked-before-deserialize read path, same
// sorted-before-serializing determinism as `index.rs`/`manifest.rs`.
//
// ── Ownership proof, not "is a symlink" ─────────────────────────────────
// A symlink already at `$HOME/.local/bin/konductor`, pointing somewhere
// OTHER than the current resolved exe, is only ever repointed
// ("self-healed") when its CURRENT target matches some tracked entry's
// own recorded `link_target` -- i.e. this module can prove it (or a
// prior run of it) is the one that pointed the symlink there. A symlink
// whose target matches no tracked entry at all -- e.g. a user's own
// manual `ln -s` to an unrelated script that happens to share this
// path -- is foreign, exactly like a non-symlink foreign file, and is
// refused with `ForeignFileExists` rather than silently repointed.
// Without this check, "is a symlink" alone is not proof of ownership:
// any symlink, including one this module never created, would have been
// treated as fair game to repoint and later delete.
//
// ── Multiple targets sharing one physical symlink ───────────────────────
// The fixed `$PATH` location is shared: two different `--target`
// installs both requesting `--link-bin` upsert two different
// `BinLinkEntry`s but point at the SAME on-disk symlink. Removing one
// target's tracking (via `remove_bin_link`) must never physically delete
// that symlink while another still-tracked target's entry names the
// same `link_path` -- doing so would silently break `$PATH` resolution
// for a sibling target that never asked for anything to change. The
// physical symlink is deleted only when the entry being removed was the
// LAST one naming that `link_path`.
//
// ── Concurrency safety ───────────────────────────────────────────────────
// `ensure_bin_link`/`remove_bin_link` each hold an exclusive advisory
// lock (`config_lock::acquire_named`, the same primitive `config set`
// already uses for its own read-modify-write race) for their ENTIRE
// critical section -- read the sidecar, decide the symlink outcome,
// perform the symlink swap, write the sidecar back -- not just the
// sidecar's own read-modify-write. Two concurrent `install --link-bin`
// invocations against distinct targets (sharing one `$HOME`) therefore
// serialize rather than racing to read-modify-write the same sidecar
// file and silently losing one caller's entry. The symlink swap itself
// uses an atomic create-elsewhere-then-rename (`atomic_symlink`, mirroring
// `atomic_write::write_atomic`'s own temp-then-rename pattern) rather
// than `remove_file` followed by `symlink`, which would leave the path
// briefly absent -- a window a concurrent reader of `$PATH` could
// observe as "konductor not found."
//
// Scope of this guarantee, stated precisely: this lock protects
// konductor-vs-konductor races -- two concurrent invocations of THIS
// binary, cooperating through the same advisory lock file. It does
// NOT and CANNOT protect against a non-konductor process writing to
// `local_bin_link_path` in the same narrow window, e.g. between
// `atomic_symlink`'s `symlink()` (to the temp sibling path) and its
// `rename()` over `link` -- an uncooperative external actor holds no
// advisory lock and is not made to wait by one. This is an inherent
// limit of advisory locking, not a gap a bigger lock closes; it is a
// disclosed, accepted limitation, not a comprehensive-protection
// claim.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::cli::atomic_write::{unique_suffix, write_atomic};
use crate::cli::config::KONDUCTOR_DIR_NAME;
use crate::cli::config_lock;

/// Sidecar document schema version. Bump when the shape changes
/// incompatibly. Mirrors `index::INDEX_SCHEMA_VERSION`'s naming and
/// role.
pub(crate) const BIN_LINK_SCHEMA_VERSION: u64 = 1;

/// File name within `KONDUCTOR_DIR_NAME`, under `$HOME`. No `.json`
/// suffix -- mirrors `index::INDEX_FILE_NAME`'s naming.
pub(crate) const BIN_LINK_FILE_NAME: &str = "bin-links";

/// Lock file name within `KONDUCTOR_DIR_NAME`, under `$HOME`, guarding
/// this sidecar's read-modify-write critical section (see module doc
/// "Concurrency safety" above). Distinct from `config_lock::acquire`'s
/// own hardcoded `.config.lock` -- an unrelated critical section must
/// never contend with (or be confused for) this one.
const BIN_LINK_LOCK_FILE_NAME: &str = ".bin-links.lock";

/// One tracked bin-link: which install (by canonicalized `target_dir`,
/// the exact same string `index::IndexEntry.target_dir` carries)
/// requested it, where the symlink actually lives on disk, the resolved
/// exe path this entry last pointed the symlink AT (the ownership proof
/// `ensure_bin_link`'s self-heal check and `remove_bin_link`'s deletion
/// check both rely on -- see module doc), and when it was
/// created/last self-healed. `#[serde(default)]` on `link_target` so an
/// entry predating this field still deserializes (as an empty string,
/// which matches no real `read_link` result and is therefore correctly
/// treated as unowned by the ownership check -- the conservative,
/// never-clobber default).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinLinkEntry {
    pub target_dir: String,
    pub link_path: String,
    #[serde(default)]
    pub link_target: String,
    pub created_at: String,
}

/// `$HOME/.konductor/bin-links`'s in-memory shape: a schema
/// discriminator plus every tracked bin-link.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BinLinks {
    pub schema_version: u64,
    pub links: Vec<BinLinkEntry>,
}

impl BinLinks {
    /// Builds a `BinLinks` with the current `BIN_LINK_SCHEMA_VERSION`,
    /// so call sites never hand-type the discriminator.
    pub fn new(links: Vec<BinLinkEntry>) -> Self {
        BinLinks {
            schema_version: BIN_LINK_SCHEMA_VERSION,
            links,
        }
    }
}

/// What ensuring or removing a bin-link can fail with. Every variant
/// except `UnsupportedSchemaVersion` is a USAGE ERROR from the CLI's
/// perspective (map to `EXIT_USAGE_ERROR`, 64, via `bin_link_error_exit_code`
/// below); `UnsupportedSchemaVersion` is a state/verification failure
/// (`EXIT_VERIFY_FAILED`, 65) -- same split every other sidecar/manifest
/// error type in this crate applies.
#[derive(Debug)]
pub enum BinLinkError {
    CreateDirFailed {
        path: PathBuf,
        source: std::io::Error,
    },
    WriteFailed {
        path: PathBuf,
        source: std::io::Error,
    },
    ReadFailed {
        path: PathBuf,
        source: std::io::Error,
    },
    Malformed {
        path: PathBuf,
        source: serde_json::Error,
    },
    UnsupportedSchemaVersion {
        path: PathBuf,
        found: i64,
        supported: u64,
    },
    /// `$HOME` could not be resolved (unset or empty) -- mirrors
    /// `index::IndexError::UnresolvableHome`'s own rationale: there is
    /// no sidecar file to be wrong about, only the caller's environment
    /// is unresolvable.
    UnresolvableHome,
    /// `std::env::current_exe()` failed to resolve the running
    /// process's own executable path -- nothing to point the symlink
    /// at.
    CurrentExeUnresolvable,
    /// Something already exists at the target symlink path that this
    /// module cannot prove it owns -- either a non-symlink foreign
    /// file/directory, or a symlink whose current target matches no
    /// tracked entry's own recorded `link_target` (see module doc
    /// "Ownership proof" above). Never returned for a symlink already
    /// pointing at the current resolved exe, or for one whose target
    /// matches a tracked entry's recorded target.
    ForeignFileExists { path: PathBuf },
    /// Creating, removing, or reading the target of the symlink itself
    /// failed.
    SymlinkFailed {
        path: PathBuf,
        source: std::io::Error,
    },
    /// Could not acquire the exclusive lock guarding this sidecar's
    /// read-modify-write critical section (see module doc "Concurrency
    /// safety" above) -- either the lock file itself was unavailable, or
    /// another process held it for the full bounded wait.
    Lock(config_lock::ConfigLockError),
    /// A sidecar write failed (`primary`, always a `WriteFailed` in
    /// practice) AFTER a physical symlink change had already landed, AND
    /// the best-effort rollback attempted to undo that change (see
    /// `rollback_symlink_swap`/removal's own rollback) itself failed with
    /// `rollback_source`. A double-fault: unlike a rollback that
    /// succeeds -- which restores the physical state to match the
    /// (unwritten, unchanged) sidecar -- a FAILED rollback means the
    /// physical symlink and the sidecar may now be in an unknown,
    /// possibly diverged state. Surfacing this as its own variant (rather
    /// than swallowing the rollback's error, or reporting only `primary`)
    /// is what keeps a double-fault visible to whoever debugs it later --
    /// see this module's rollback functions for why the rollback attempt
    /// itself never fails harder than the primary operation already did.
    RollbackAlsoFailed {
        primary: Box<BinLinkError>,
        rollback_source: std::io::Error,
    },
}

impl std::fmt::Display for BinLinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BinLinkError::CreateDirFailed { path, source } => {
                write!(f, "could not create {}: {source}", path.display())
            }
            BinLinkError::WriteFailed { path, source } => {
                write!(f, "could not write {}: {source}", path.display())
            }
            BinLinkError::ReadFailed { path, source } => {
                write!(f, "could not read {}: {source}", path.display())
            }
            BinLinkError::Malformed { path, source } => {
                write!(f, "{} is not valid JSON: {source}", path.display())
            }
            BinLinkError::UnsupportedSchemaVersion {
                path,
                found,
                supported,
            } => {
                write!(
                    f,
                    "{} has schema_version {found}, but only schema_version {supported} is supported",
                    path.display()
                )
            }
            BinLinkError::UnresolvableHome => {
                write!(f, "could not resolve $HOME to locate the bin-link sidecar")
            }
            BinLinkError::CurrentExeUnresolvable => {
                write!(
                    f,
                    "could not resolve the path to the currently-running konductor binary"
                )
            }
            BinLinkError::ForeignFileExists { path } => {
                write!(
                    f,
                    "{} already exists and konductor cannot verify it created it; \
                     refusing to overwrite it -- remove it by hand first if you want \
                     --link-bin to manage it",
                    path.display()
                )
            }
            BinLinkError::SymlinkFailed { path, source } => {
                write!(f, "could not update symlink {}: {source}", path.display())
            }
            BinLinkError::Lock(err) => write!(f, "{err}"),
            BinLinkError::RollbackAlsoFailed {
                primary,
                rollback_source,
            } => {
                write!(
                    f,
                    "{primary}; additionally, the automatic rollback of this failed \
                     operation also failed: {rollback_source}"
                )
            }
        }
    }
}

impl std::error::Error for BinLinkError {}

impl From<config_lock::ConfigLockError> for BinLinkError {
    fn from(err: config_lock::ConfigLockError) -> Self {
        BinLinkError::Lock(err)
    }
}

/// Remapped exit codes for CLI usage errors / state-verification
/// failures, matching cli.rs's own `EXIT_USAGE_ERROR`/`EXIT_VERIFY_FAILED`
/// constants. Duplicated here per this crate's own established
/// precedent for these exact constants (cli.rs's are private to that
/// module).
const EXIT_USAGE_ERROR: u8 = 64;
const EXIT_VERIFY_FAILED: u8 = 65;

/// Maps a `BinLinkError` to its correct exit code -- `EXIT_VERIFY_FAILED`
/// (65) for `UnsupportedSchemaVersion` and `RollbackAlsoFailed` (both
/// signal a state-consistency concern rather than an ordinary invalid
/// invocation: the former means the sidecar itself is from a future,
/// unreadable schema; the latter means a failed rollback may have left
/// the physical symlink and the sidecar diverged), `EXIT_USAGE_ERROR`
/// (64) for every other variant. Same split `index::IndexError`'s/
/// `manifest::ManifestError`'s own exit-code mapping functions apply.
/// No production caller yet -- `install.rs`'s `--link-bin` reporting is
/// deliberately non-fatal to the overall `install` exit code (see that
/// module's own doc comment for why), so this mapping is not consulted
/// for THIS process's exit code today. Reserved for a future caller
/// that does need to distinguish the two (e.g. a standalone `--link-bin`
/// command); exercised directly by this module's own tests.
#[allow(dead_code)]
pub(crate) fn bin_link_error_exit_code(err: &BinLinkError) -> u8 {
    match err {
        BinLinkError::UnsupportedSchemaVersion { .. } => EXIT_VERIFY_FAILED,
        BinLinkError::RollbackAlsoFailed { .. } => EXIT_VERIFY_FAILED,
        _ => EXIT_USAGE_ERROR,
    }
}

/// `$HOME/.konductor/bin-links` -- always resolved against the invoking
/// user's real home directory, never against any `target_dir` a given
/// install/uninstall call happens to be addressing. Mirrors
/// `index::index_path`'s contract exactly, including the `None`-when-
/// unresolvable-`$HOME` behavior.
pub fn bin_links_path(home_dir: Option<&Path>) -> Option<PathBuf> {
    home_dir.map(|home| home.join(KONDUCTOR_DIR_NAME).join(BIN_LINK_FILE_NAME))
}

/// Resolves `$HOME` from the environment. Split out from
/// `bin_links_path`/`local_bin_link_path` so callers that already have a
/// home directory (tests) can skip a second env lookup -- mirrors
/// `index.rs`'s own `env_home_dir`.
fn env_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
}

/// `$HOME/.local/bin/konductor` -- the fixed `$PATH` location this
/// module always targets, matching `cli/Makefile`'s own
/// `LOCAL_BIN_DIR`/`link` target precedent exactly (same directory, same
/// file name) and `cli/README.md`'s "Putting it on your PATH" manual
/// steps.
pub fn local_bin_link_path(home_dir: &Path) -> PathBuf {
    home_dir.join(".local").join("bin").join("konductor")
}

/// Renders `links` as deterministic, pretty-printed JSON bytes: `links`
/// sorted by `target_dir`, 2-space indent, trailing newline, UTF-8.
/// Mirrors `index.rs`'s own `serialize`.
fn serialize(links: &BinLinks) -> Result<Vec<u8>, serde_json::Error> {
    let mut sorted = links.clone();
    sorted.links.sort_by(|a, b| a.target_dir.cmp(&b.target_dir));
    let mut rendered = serde_json::to_string_pretty(&sorted)?;
    rendered.push('\n');
    Ok(rendered.into_bytes())
}

/// Reads `$HOME/.konductor/bin-links`. Returns `Ok(None)` only for the
/// genuine "no sidecar file yet at a resolvable path" case; returns
/// `Err(BinLinkError::UnresolvableHome)` if `$HOME` itself could not be
/// resolved. Mirrors `index::read_index`'s contract and schema-version
/// checking exactly. No production caller yet (mirrors
/// `manifest::read_manifest`'s own "reserved for future callers" --
/// `read_bin_links_at_home` is exercised directly by this module's own
/// tests) -- reserved for a future `doctor` check over tracked
/// bin-links, mirroring `doctor`'s existing manifest/index checks. Does
/// NOT itself take the sidecar lock -- callers that need a consistent
/// read-modify-write snapshot (`ensure_bin_link`/`remove_bin_link`)
/// acquire it themselves around the whole critical section.
#[allow(dead_code)]
pub fn read_bin_links() -> Result<Option<BinLinks>, BinLinkError> {
    read_bin_links_at_home(env_home_dir().as_deref())
}

fn read_bin_links_at_home(home_dir: Option<&Path>) -> Result<Option<BinLinks>, BinLinkError> {
    let Some(path) = bin_links_path(home_dir) else {
        return Err(BinLinkError::UnresolvableHome);
    };
    if !path.is_file() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&path).map_err(|source| BinLinkError::ReadFailed {
        path: path.clone(),
        source,
    })?;
    let raw: serde_json::Value =
        serde_json::from_str(&contents).map_err(|source| BinLinkError::Malformed {
            path: path.clone(),
            source,
        })?;
    let found_version = raw
        .get("schema_version")
        .and_then(serde_json::Value::as_i64);
    if found_version != Some(BIN_LINK_SCHEMA_VERSION as i64) {
        if let Some(found) = found_version {
            return Err(BinLinkError::UnsupportedSchemaVersion {
                path,
                found,
                supported: BIN_LINK_SCHEMA_VERSION,
            });
        }
        // No numeric schema_version at all -- fall through to a normal
        // deserialize so the missing/malformed field is reported the
        // same way as any other shape error.
    }
    let links: BinLinks =
        serde_json::from_str(&contents).map_err(|source| BinLinkError::Malformed {
            path: path.clone(),
            source,
        })?;
    if links.schema_version != BIN_LINK_SCHEMA_VERSION {
        return Err(BinLinkError::UnsupportedSchemaVersion {
            path,
            found: found_version.unwrap_or(i64::MAX),
            supported: BIN_LINK_SCHEMA_VERSION,
        });
    }
    Ok(Some(links))
}

fn write_bin_links_at_home(
    home_dir: Option<&Path>,
    links: BinLinks,
) -> Result<PathBuf, BinLinkError> {
    let Some(path) = bin_links_path(home_dir) else {
        return Err(BinLinkError::UnresolvableHome);
    };
    let parent = path.parent().expect("bin-links path always has a parent");
    std::fs::create_dir_all(parent).map_err(|source| BinLinkError::CreateDirFailed {
        path: parent.to_path_buf(),
        source,
    })?;

    let bytes = serialize(&links).expect("BinLinks must always serialize");
    write_atomic(&path, &bytes).map_err(|source| BinLinkError::WriteFailed {
        path: path.clone(),
        source,
    })?;
    Ok(path)
}

/// What `ensure_bin_link` actually did to the filesystem symlink, for
/// reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinLinkOutcome {
    /// Nothing was at `local_bin_link_path` before this call.
    Created,
    /// A symlink was already there, pointing at a DIFFERENT resolved
    /// exe path that this module could prove it owns -- repointed at
    /// the current one.
    SelfHealed,
    /// A symlink was already there, already pointing at the current
    /// resolved exe path -- no filesystem write performed.
    AlreadyCurrent,
}

/// Synchronizes every tracked entry sharing `link_path` (compared as a
/// string, matching `BinLinkEntry.link_path`'s own representation) to
/// record `new_target` as their own `link_target`. Multiple tracked
/// entries can share ONE physical symlink (see module doc "Multiple
/// targets sharing one physical symlink") -- whenever the physical
/// symlink's target actually changes on disk, every entry naming that
/// same `link_path` must be kept in sync, or a sibling's later
/// removal-time ownership re-check (which compares the on-disk target
/// against THAT entry's own recorded `link_target`) fails against a
/// stale value and orphans the physical symlink instead of deleting it
/// (see `remove_bin_link_at_home`'s own ownership re-check).
///
/// Never call this directly from a mutation site -- go through
/// `apply_link_target_sync`, whose exhaustive match is what keeps a
/// future disk-changing write path from forgetting to call this at all.
fn sync_link_target_for_all_sharers(links: &mut BinLinks, link_path: &str, new_target: &str) {
    for existing in links.links.iter_mut() {
        if existing.link_path == link_path {
            existing.link_target = new_target.to_string();
        }
    }
}

/// The single decision point for whether a given `BinLinkOutcome`
/// requires `sync_link_target_for_all_sharers`. Deliberately exhaustive
/// -- no wildcard arm -- so a new `BinLinkOutcome` variant that changes
/// the physical symlink must be explicitly routed here (today: `Created`
/// and `SelfHealed` both actually repoint the symlink and therefore
/// sync; `AlreadyCurrent` is the only true no-op) before this function
/// compiles again. This is the mechanism that keeps a future
/// disk-changing write path from silently skipping the sync this
/// module's ownership-proof invariant depends on -- see
/// `sync_link_target_for_all_sharers`'s own doc comment for what breaks
/// if a sync is skipped.
fn apply_link_target_sync(
    outcome: BinLinkOutcome,
    links: &mut BinLinks,
    link_path: &str,
    new_target: &str,
) {
    match outcome {
        BinLinkOutcome::Created | BinLinkOutcome::SelfHealed => {
            sync_link_target_for_all_sharers(links, link_path, new_target);
        }
        BinLinkOutcome::AlreadyCurrent => {}
    }
}

/// Ensures `$HOME/.local/bin/konductor` is a symlink to the currently-
/// running `konductor` binary, and records/refreshes a tracking entry
/// for `target_dir` (already canonicalized, same contract as
/// `index::write_index`) in `$HOME/.konductor/bin-links`. Resolves the
/// running exe path via `std::env::current_exe()` -- see this module's
/// own doc comment for why a failure there is `CurrentExeUnresolvable`
/// rather than falling back to a bare `"konductor"` word (unlike
/// `resource_rewrite.rs`'s `resolve_konductor_exe_path`, a real
/// filesystem symlink has nothing sensible to point AT for a bare word;
/// `resolve_konductor_exe_path`'s fallback exists only because a shell
/// `command` string tolerates a `$PATH`-dependent bare word, which a
/// `symlink()` syscall does not).
pub fn ensure_bin_link(
    target_dir: &str,
    created_at: &str,
) -> Result<(PathBuf, BinLinkOutcome), BinLinkError> {
    let current_exe = std::env::current_exe().map_err(|_| BinLinkError::CurrentExeUnresolvable)?;
    ensure_bin_link_at_home(
        env_home_dir().as_deref(),
        target_dir,
        created_at,
        &current_exe,
    )
}

fn ensure_bin_link_at_home(
    home_dir: Option<&Path>,
    target_dir: &str,
    created_at: &str,
    current_exe: &Path,
) -> Result<(PathBuf, BinLinkOutcome), BinLinkError> {
    let Some(home) = home_dir else {
        return Err(BinLinkError::UnresolvableHome);
    };
    let konductor_dir = home.join(KONDUCTOR_DIR_NAME);
    // Holds for the ENTIRE critical section below (read sidecar, decide
    // outcome, swap the symlink, write sidecar) -- not just the sidecar
    // write. See module doc "Concurrency safety". Dropped (releasing the
    // lock) when this function returns, on every path.
    let _lock = config_lock::acquire_named(&konductor_dir, BIN_LINK_LOCK_FILE_NAME)?;

    let link_path = local_bin_link_path(home);
    let parent = link_path.parent().expect("link path always has a parent");
    std::fs::create_dir_all(parent).map_err(|source| BinLinkError::CreateDirFailed {
        path: parent.to_path_buf(),
        source,
    })?;

    let mut links = read_bin_links_at_home(home_dir)?.unwrap_or_else(|| BinLinks::new(Vec::new()));
    let current_exe_str = current_exe.to_string_lossy().into_owned();
    let link_path_str = link_path.to_string_lossy().into_owned();

    // `performed_swap` records exactly what this match did to the
    // physical symlink, for `rollback_symlink_swap` to reverse if
    // `write_bin_links_at_home` fails below. `None` stands for
    // `BinLinkOutcome::AlreadyCurrent` (no physical write happened); see
    // `PerformedSwap`'s own doc comment for why this replaces a
    // separately-optional pre-swap-target variable.
    let (outcome, performed_swap) = match std::fs::symlink_metadata(&link_path) {
        // Only a genuine "nothing here" (ENOENT) is safe to treat as
        // clear-to-create. Any OTHER stat failure (EACCES, ELOOP, EIO,
        // ...) says nothing about whether something foreign sits at
        // this path -- treating every `Err` as absence would skip the
        // foreign-file protection the `Ok(_)` non-symlink branch below
        // enforces, and `atomic_symlink`'s `rename` would land on top
        // of whatever is actually there. Propagate anything else as a
        // real failure instead of silently proceeding.
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => {
            atomic_symlink(current_exe, &link_path)?;
            (BinLinkOutcome::Created, Some(PerformedSwap::Created))
        }
        Err(source) => {
            return Err(BinLinkError::SymlinkFailed {
                path: link_path,
                source,
            });
        }
        Ok(meta) if meta.file_type().is_symlink() => {
            let existing_target =
                std::fs::read_link(&link_path).map_err(|source| BinLinkError::SymlinkFailed {
                    path: link_path.clone(),
                    source,
                })?;
            // Ownership proof (see module doc): this check runs
            // UNCONDITIONALLY, before ever branching on whether
            // `existing_target` happens to already equal
            // `current_exe`. A symlink is only ever treated as ours if
            // some tracked entry's own recorded `link_target` matches
            // its CURRENT target -- proof this module (or a prior run
            // of it) is what pointed it there. Coincidentally already
            // pointing at the right resolved exe path is NOT proof of
            // ownership: `cli/README.md`/`make link` document a
            // supported manual `ln -s` workflow that lands exactly
            // there, and a symlink from that workflow must be refused
            // here just like any other foreign symlink -- adopting it
            // into the sidecar on a coincidental-match basis would let
            // a later `uninstall` delete a symlink this module never
            // actually created.
            let existing_target_str = existing_target.to_string_lossy();
            let owned_by_us = links
                .links
                .iter()
                .any(|entry| entry.link_target == existing_target_str);
            if !owned_by_us {
                return Err(BinLinkError::ForeignFileExists { path: link_path });
            }
            if existing_target == current_exe {
                (BinLinkOutcome::AlreadyCurrent, None)
            } else {
                let previous_target = existing_target.clone();
                atomic_symlink(current_exe, &link_path)?;
                (
                    BinLinkOutcome::SelfHealed,
                    Some(PerformedSwap::SelfHealed(previous_target)),
                )
            }
        }
        // Something is at this path and it is NOT a symlink -- never
        // clobber foreign content, mirroring manifest.rs's own
        // `Provenance::ReplacedForeign` caution for exactly this
        // reason.
        Ok(_) => return Err(BinLinkError::ForeignFileExists { path: link_path }),
    };

    // Every mutation site that changes the physical symlink is routed
    // through this single call rather than an inline per-branch update,
    // so the sync can never be forgotten on a future write path -- see
    // `apply_link_target_sync`'s own doc comment for the exhaustive
    // per-variant decision this makes.
    apply_link_target_sync(outcome, &mut links, &link_path_str, &current_exe_str);

    let entry = BinLinkEntry {
        target_dir: target_dir.to_string(),
        link_path: link_path.to_string_lossy().into_owned(),
        link_target: current_exe_str,
        created_at: created_at.to_string(),
    };
    match links
        .links
        .iter_mut()
        .find(|existing| existing.target_dir == entry.target_dir)
    {
        Some(existing) => *existing = entry,
        None => links.links.push(entry),
    }

    // The symlink swap above and this sidecar write are two independent
    // persistence steps with no combined atomicity. If the swap already
    // landed (`Created`/`SelfHealed`) but THIS write then fails, the
    // on-disk symlink now points at `current_exe` while the sidecar
    // (unchanged, since the write itself failed) still has no entry
    // recording that target -- the NEXT call's ownership check above
    // would find no tracked `link_target` matching it and refuse
    // konductor's own symlink as `ForeignFileExists`, permanently, until
    // a human manually removes it. Roll the swap back to its pre-call
    // state on failure so the symlink and the (still-intact) sidecar
    // stay in agreement, keeping the symlink adoptable on retry.
    if let Err(err) = write_bin_links_at_home(home_dir, links) {
        let rollback_result = rollback_symlink_swap(performed_swap, current_exe, &link_path);
        return Err(finalize_after_failed_write(err, rollback_result));
    }

    Ok((link_path, outcome))
}

/// What the forward swap in `ensure_bin_link_at_home` actually did to the
/// physical symlink -- exactly the state `rollback_symlink_swap` needs
/// to reverse it, and nothing more. Threaded through as a single
/// `Option<PerformedSwap>` (`None` standing for
/// `BinLinkOutcome::AlreadyCurrent`, which performs no physical write)
/// rather than an independent `BinLinkOutcome` paired with an
/// independent `Option<&Path>` pre-swap target: that pairing let
/// `SelfHealed` be combined with a missing target, a state the swap side
/// never actually produces but the rollback side still had to handle
/// defensively at runtime. With the target carried as `SelfHealed`'s own
/// payload, that combination no longer type-checks -- it is a compile
/// error, not a value `rollback_symlink_swap` has to guard against.
#[derive(Debug, Clone, PartialEq, Eq)]
enum PerformedSwap {
    /// Nothing was at `link_path` before the swap; rollback removes the
    /// symlink the swap created.
    Created,
    /// A symlink was already there, pointing at this target, before the
    /// swap repointed it; rollback restores that target.
    SelfHealed(PathBuf),
}

/// Best-effort reversal of the physical symlink swap `ensure_bin_link_at_home`
/// performed, invoked only when the sidecar write that follows the swap
/// fails -- see that function's own doc comment for why an unrecorded
/// swap makes the symlink permanently unadoptable otherwise. `None`
/// (`BinLinkOutcome::AlreadyCurrent`) never performed a swap, so there is
/// nothing to reverse. `Created` removes the freshly-created symlink,
/// restoring "nothing here" to match the sidecar's own unchanged,
/// still-absent state. `SelfHealed` re-points the symlink back at its
/// carried target, the value it held before this call, which the
/// sidecar (unchanged by the failed write) still records. This DOES
/// surface its own failure (as an `io::Error`) rather than swallowing it
/// -- see `finalize_after_failed_write` for how that failure is combined
/// with the write failure that triggered the rollback in the first
/// place, so a double-fault is never silently indistinguishable from a
/// clean single failure.
///
/// `swapped_to` is the target the forward swap that triggered this
/// rollback actually wrote to `link_path` (always `current_exe`). Before
/// either destructive branch below acts, `still_points_at` re-verifies
/// that `link_path` still holds exactly that value -- the same ownership
/// proof (see module doc "Ownership proof") the forward path already
/// requires before ever touching an existing symlink. This module's own
/// doc discloses an unprotected race window between `atomic_symlink`'s
/// `symlink()`/`rename()` steps and any later action on `link_path` (see
/// module doc "Concurrency safety" -- scope of the guarantee); this
/// rollback runs strictly after that window, in the SAME race exposure.
/// Without this check, `Created`'s `remove_file` would silently delete
/// whatever a non-konductor actor placed at `link_path` in that window,
/// and `SelfHealed`'s `recreate_symlink` would silently overwrite it --
/// both strictly worse than leaving the original write failure as the
/// only error, since a rollback exists to restore state, not to destroy
/// content it never created. If the check fails, the rollback declines
/// entirely and reports success (`Ok(())`): nothing was corrupted, and
/// `finalize_after_failed_write` returns the original error unchanged,
/// exactly as it would for a successful restoration.
fn rollback_symlink_swap(
    performed_swap: Option<PerformedSwap>,
    swapped_to: &Path,
    link_path: &Path,
) -> Result<(), std::io::Error> {
    let Some(performed_swap) = performed_swap else {
        return Ok(());
    };
    if !still_points_at(link_path, swapped_to) {
        return Ok(());
    }
    match performed_swap {
        PerformedSwap::Created => match std::fs::remove_file(link_path) {
            Ok(()) => Ok(()),
            // Already gone (e.g. removed by some other actor between the
            // failed write and this rollback attempt) -- the end state
            // this rollback is trying to reach ("nothing here") already
            // holds, so this is success, not failure.
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(source) => Err(source),
        },
        PerformedSwap::SelfHealed(previous_target) => recreate_symlink(&previous_target, link_path),
    }
}

/// True only if `link_path` is CURRENTLY a symlink pointing at exactly
/// `expected`. The proof-before-destructive-action check `rollback_symlink_swap`
/// and `remove_bin_link_at_home`'s own rollback both apply before their
/// destructive actions -- see `rollback_symlink_swap`'s own doc comment for
/// why. `false` covers every race outcome uniformly: the path is gone,
/// replaced by a foreign non-symlink file, or replaced by a foreign symlink
/// to something else -- in every case, the caller must decline rather than
/// delete or overwrite content this call did not create.
fn still_points_at(link_path: &Path, expected: &Path) -> bool {
    match std::fs::symlink_metadata(link_path) {
        Ok(meta) if meta.file_type().is_symlink() => std::fs::read_link(link_path)
            .map(|current| current == expected)
            .unwrap_or(false),
        _ => false,
    }
}

/// True only if NOTHING currently exists at `link_path` -- the end state
/// `remove_bin_link_at_home`'s own physical delete put it in. Used as the
/// proof-before-destructive-action check before that function's rollback
/// recreates the symlink: if some other actor has since placed a file or
/// symlink at this path, recreating would silently overwrite content this
/// call did not create, mirroring `still_points_at`'s rationale for the
/// swap side.
fn still_absent(link_path: &Path) -> bool {
    match std::fs::symlink_metadata(link_path) {
        Err(source) => source.kind() == std::io::ErrorKind::NotFound,
        Ok(_) => false,
    }
}

/// Recreates `link` as a symlink pointing at `target`, translating
/// `atomic_symlink`'s `BinLinkError` (in practice always `SymlinkFailed`)
/// down to the plain `io::Error` it wraps -- a rollback failure is itself
/// an I/O-level fact, not a fresh instance of the higher-level
/// `BinLinkError` taxonomy, and `finalize_after_failed_write` folds it
/// into `BinLinkError::RollbackAlsoFailed` at the one place that needs
/// the full `BinLinkError` shape. Shared by `rollback_symlink_swap` and
/// `remove_bin_link_at_home`'s own rollback, since both are "point this
/// path back at a previously-known target" -- the same operation
/// `atomic_symlink` already performs for the non-rollback case.
fn recreate_symlink(target: &Path, link: &Path) -> Result<(), std::io::Error> {
    atomic_symlink(target, link).map_err(|err| match err {
        BinLinkError::SymlinkFailed { source, .. } => source,
        // atomic_symlink only ever returns SymlinkFailed in practice;
        // this arm exists so a future variant added there degrades to a
        // generic I/O error (preserving the message) rather than this
        // match failing to compile or panicking.
        other => std::io::Error::other(other.to_string()),
    })
}

/// The one place `ensure_bin_link_at_home` and `remove_bin_link_at_home`
/// both combine a failed write (`primary`) with the outcome of the
/// rollback attempted afterward. A successful rollback (`Ok(())`)
/// restored the physical state to match the sidecar, so `primary` alone
/// is still the right and complete error to report. A FAILED rollback
/// (`Err(rollback_source)`) means that restoration did not happen -- the
/// physical symlink and the sidecar may now be diverged in a way neither
/// caller can fully characterize -- so it is wrapped into
/// `BinLinkError::RollbackAlsoFailed` instead of being dropped, keeping
/// the double-fault visible rather than indistinguishable from a clean
/// single failure.
fn finalize_after_failed_write(
    primary: BinLinkError,
    rollback_result: Result<(), std::io::Error>,
) -> BinLinkError {
    match rollback_result {
        Ok(()) => primary,
        Err(rollback_source) => BinLinkError::RollbackAlsoFailed {
            primary: Box::new(primary),
            rollback_source,
        },
    }
}

/// Atomically points `link` at `target`: creates the symlink at a
/// sibling temp path first, then `rename`s it over `link` -- the same
/// create-elsewhere-then-rename shape `atomic_write::write_atomic` uses
/// for regular file content, applied to a symlink instead. Used for
/// BOTH a fresh create and a self-heal repoint (one code path, not two)
/// so neither ever goes through a `remove_file` + `symlink` sequence
/// that would leave `link` briefly absent -- see module doc "Concurrency
/// safety" for why that window matters. On any failure, best-effort
/// removes the temp path before returning the error (mirrors
/// `write_atomic`'s own cleanup-is-best-effort rationale).
fn atomic_symlink(target: &Path, link: &Path) -> Result<(), BinLinkError> {
    let parent = link.parent().expect("link path always has a parent");
    let file_name = link.file_name().expect("link path always has a file name");
    let tmp_path = parent.join(format!(
        "{}.tmp-{}",
        file_name.to_string_lossy(),
        unique_suffix()
    ));

    if let Err(source) = std::os::unix::fs::symlink(target, &tmp_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(BinLinkError::SymlinkFailed {
            path: tmp_path,
            source,
        });
    }
    if let Err(source) = std::fs::rename(&tmp_path, link) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(BinLinkError::SymlinkFailed {
            path: link.to_path_buf(),
            source,
        });
    }
    Ok(())
}

/// What `remove_bin_link` actually did, for reporting. Distinguishes
/// "the tracking entry for this `target_dir` was dropped" (always true
/// for the `Some(..)` case) from "the physical on-disk symlink was
/// actually deleted" (only true when nothing else still needs it) --
/// callers that blend the two report a shared-link uninstall as having
/// removed a symlink that in fact survives for a sibling target. See
/// `remove_bin_link`'s own doc comment for exactly which conditions
/// gate `physically_removed`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinLinkRemoval {
    /// Where the (now-untracked) symlink lives, or would live --
    /// reported regardless of `physically_removed`, mirroring the prior
    /// `Ok(Some(PathBuf))` contract for callers that only care about the
    /// path.
    pub link_path: PathBuf,
    /// Whether `std::fs::remove_file` was actually called and succeeded
    /// against `link_path` as part of this removal. `false` covers every
    /// case where the on-disk symlink was left alone: still shared by
    /// another tracked target, already replaced by a foreign non-symlink
    /// file, or already gone.
    pub physically_removed: bool,
}

/// Removes the tracked bin-link for `target_dir` (already canonicalized,
/// same contract as `ensure_bin_link`), if one is tracked. `Ok(None)` --
/// not an error -- when no entry is tracked for this `target_dir`:
/// `uninstall` calls this once it has already succeeded at removing that
/// target's other content, so nothing tracked here means nothing more to
/// do, mirroring `index::remove_index_entry`'s own no-op-when-absent
/// contract.
///
/// `Ok(Some(removal))` always means the TRACKING entry was dropped;
/// `removal.physically_removed` is the separate, narrower signal for
/// whether the on-disk symlink itself was actually deleted -- only true
/// when BOTH: (1) it is STILL a symlink at the time of removal -- if
/// something has replaced it with a foreign regular file/directory since
/// it was created (the same caution `ensure_bin_link` applies on the
/// write side), the file is left alone; and (2) no OTHER tracked entry
/// still names this same `link_path` -- multiple targets can share the
/// one physical symlink (see module doc "Multiple targets sharing one
/// physical symlink"), and removing one target's tracking must never
/// break `$PATH` resolution for a sibling target that still depends on
/// it. The tracking entry itself is always removed regardless of either
/// condition: this module never continues claiming ownership of a path
/// once the target that requested it is gone.
pub fn remove_bin_link(target_dir: &str) -> Result<Option<BinLinkRemoval>, BinLinkError> {
    remove_bin_link_at_home(env_home_dir().as_deref(), target_dir)
}

fn remove_bin_link_at_home(
    home_dir: Option<&Path>,
    target_dir: &str,
) -> Result<Option<BinLinkRemoval>, BinLinkError> {
    let Some(home) = home_dir else {
        return Err(BinLinkError::UnresolvableHome);
    };
    let konductor_dir = home.join(KONDUCTOR_DIR_NAME);
    // Same full-critical-section lock as `ensure_bin_link_at_home` --
    // see module doc "Concurrency safety".
    let _lock = config_lock::acquire_named(&konductor_dir, BIN_LINK_LOCK_FILE_NAME)?;

    let mut links = read_bin_links_at_home(home_dir)?.unwrap_or_else(|| BinLinks::new(Vec::new()));
    let Some(pos) = links.links.iter().position(|e| e.target_dir == target_dir) else {
        return Ok(None);
    };
    let entry = links.links.remove(pos);
    let link_path = PathBuf::from(&entry.link_path);

    // Shared-link guard (see module doc "Multiple targets sharing one
    // physical symlink"): only consider physically deleting the symlink
    // when no OTHER remaining entry still names this same link_path.
    let still_shared = links.links.iter().any(|e| e.link_path == entry.link_path);
    let mut physically_removed = false;
    if !still_shared {
        match std::fs::symlink_metadata(&link_path) {
            // Genuinely nothing here -- already gone, nothing to remove.
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => {}
            // Any OTHER stat failure (EACCES, ELOOP, EIO, ...) says
            // nothing about whether the symlink actually exists.
            // Conflating it with "absent" would leave `physically_removed`
            // false while the tracking entry above is still dropped --
            // the symlink stays on `$PATH` with nothing left in the
            // sidecar to clean it up later. Propagate it as a real
            // failure instead, mirroring `ensure_bin_link_at_home`'s
            // identical narrowing on the install side.
            Err(source) => {
                return Err(BinLinkError::SymlinkFailed {
                    path: link_path,
                    source,
                });
            }
            Ok(meta) if meta.file_type().is_symlink() => {
                // Ownership re-check on the delete side, mirroring
                // `ensure_bin_link`'s own proof-before-repoint: only
                // delete if the on-disk symlink still points where THIS
                // entry last recorded pointing it -- if something
                // foreign has replaced it since, leave it alone.
                let points_where_we_left_it = std::fs::read_link(&link_path)
                    .map(|current_target| current_target.to_string_lossy() == entry.link_target)
                    .unwrap_or(false);
                if points_where_we_left_it {
                    std::fs::remove_file(&link_path).map_err(|source| {
                        BinLinkError::SymlinkFailed {
                            path: link_path.clone(),
                            source,
                        }
                    })?;
                    physically_removed = true;
                }
            }
            // Something is at this path and it is NOT a symlink -- never
            // clobber foreign content; the tracking entry is already
            // dropped above, same as before this stat is reached.
            Ok(_) => {}
        }
    }

    // Same two-independent-steps gap `ensure_bin_link_at_home` closes for
    // the swap side, mirrored here for the delete side: if this call
    // physically removed the symlink above but the sidecar write below
    // then fails, the on-disk symlink is now gone while the (unwritten,
    // unchanged) sidecar still records this entry as tracked -- rolling
    // the physical delete back keeps the two in agreement. No rollback
    // is needed when `physically_removed` is false: either the symlink
    // was shared and never touched, or it was already foreign/gone, so
    // a write failure there leaves the filesystem exactly as it was.
    if let Err(err) = write_bin_links_at_home(home_dir, links) {
        let rollback_result = if physically_removed {
            // Ownership proof before the destructive recreate, mirroring
            // `still_points_at`'s rationale on the swap side: only
            // recreate if `link_path` is STILL exactly what our own
            // delete above left it (absent). If some other actor placed
            // a file or symlink there in the race window since, recreating
            // would silently overwrite content this call did not create --
            // decline instead and let the original write failure stand.
            if still_absent(&link_path) {
                recreate_symlink(Path::new(&entry.link_target), &link_path)
            } else {
                Ok(())
            }
        } else {
            Ok(())
        };
        return Err(finalize_after_failed_write(err, rollback_result));
    }

    Ok(Some(BinLinkRemoval {
        link_path,
        physically_removed,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-bin-link-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Stand-in "currently-running exe" for tests -- a real file must
    /// exist for a symlink's target to be meaningful to compare against,
    /// though `std::fs::symlink` itself does not require the target to
    /// exist.
    fn fake_exe(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, b"#!/bin/sh\n").unwrap();
        path
    }

    /// Whether the current process is running as root (effective UID 0).
    /// The kernel grants root DAC-override, so a directory `chmod`ed to
    /// `0o000` still permits `symlink_metadata` on paths inside it for
    /// root -- a permission-denial repro that relies on that chmod (see
    /// `ensure_bin_link_propagates_a_non_not_found_stat_error_instead_of_treating_it_as_absence`
    /// below) cannot fire under root and must be skipped there instead of
    /// asserting on an outcome the platform will not produce. Shells out
    /// to `id -u` rather than adding a `libc` direct dependency for one
    /// test; a failure to determine (missing `id`, non-UTF8 output)
    /// conservatively reports non-root so the test still runs and either
    /// passes or fails on its own merits.
    fn running_as_root() -> bool {
        std::process::Command::new("id")
            .arg("-u")
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|stdout| stdout.trim() == "0")
            .unwrap_or(false)
    }

    #[test]
    fn ensure_bin_link_creates_fresh_symlink_and_tracks_entry() {
        let home = scratch_dir("create-fresh");
        let exe = fake_exe(&home, "konductor-exe-a");

        let (link_path, outcome) =
            ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe)
                .expect("must succeed");

        assert_eq!(outcome, BinLinkOutcome::Created);
        assert_eq!(link_path, local_bin_link_path(&home));
        assert!(link_path.is_symlink());
        assert_eq!(fs::read_link(&link_path).unwrap(), exe);

        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(links.links.len(), 1);
        assert_eq!(links.links[0].target_dir, "/proj/a");
        assert_eq!(links.links[0].link_path, link_path.to_string_lossy());
        assert_eq!(links.links[0].link_target, exe.to_string_lossy());

        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn ensure_bin_link_is_a_noop_when_already_pointing_at_current_exe() {
        let home = scratch_dir("already-current");
        let exe = fake_exe(&home, "konductor-exe-a");

        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();

        // A second call with the SAME exe path must report
        // AlreadyCurrent, not SelfHealed -- no filesystem write is
        // needed when the symlink is already correct.
        let (link_path, outcome) =
            ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-02-01T00:00:00Z", &exe)
                .expect("must succeed");
        assert_eq!(outcome, BinLinkOutcome::AlreadyCurrent);
        assert_eq!(fs::read_link(&link_path).unwrap(), exe);

        fs::remove_dir_all(&home).ok();
    }

    /// The self-heal case this module exists for: a relocated/rebuilt
    /// binary means `current_exe` now differs from what the symlink
    /// already points at -- must be repointed in place, not left stale
    /// or rejected, because the OLD target is still a tracked entry's
    /// own recorded `link_target` (ownership proof).
    #[test]
    fn ensure_bin_link_self_heals_a_symlink_pointing_at_a_different_exe() {
        let home = scratch_dir("self-heal");
        let old_exe = fake_exe(&home, "konductor-exe-old");
        let new_exe = fake_exe(&home, "konductor-exe-new");

        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &old_exe).unwrap();

        let (link_path, outcome) =
            ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-02-01T00:00:00Z", &new_exe)
                .expect("must succeed");
        assert_eq!(outcome, BinLinkOutcome::SelfHealed);
        assert_eq!(
            fs::read_link(&link_path).unwrap(),
            new_exe,
            "self-heal must repoint the symlink at the CURRENT resolved exe path"
        );

        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(links.links[0].link_target, new_exe.to_string_lossy());

        fs::remove_dir_all(&home).ok();
    }

    /// Regression (CR comment finding `f-847d1405`): `symlink_metadata`
    /// can fail for reasons OTHER than the path being absent (EACCES,
    /// ELOOP, EIO, ...). Treating every `Err` as "nothing here, safe to
    /// create" would skip the foreign-file protection the `Ok(_)`
    /// non-symlink branch enforces, and `atomic_symlink`'s `rename`
    /// would land on top of whatever is actually at that path. Only a
    /// genuine `NotFound` may be treated as absence; every other stat
    /// failure must propagate as a real error. Reproduces the exact
    /// repro shape: strip all permissions from the bin directory itself
    /// (not its parent) so `symlink_metadata` on the link path inside it
    /// fails with `PermissionDenied`, not `NotFound`.
    ///
    /// Root-proofed (CR comment finding `f-add0a80f`): root's DAC
    /// override means the `0o000` chmod below cannot deny root the
    /// traversal this repro depends on, so `symlink_metadata` would
    /// return `NotFound` (landing on `Created`, not the propagated error
    /// this test asserts) rather than `PermissionDenied` -- skip entirely
    /// under root rather than asserting on an outcome the platform will
    /// not produce there.
    #[test]
    fn ensure_bin_link_propagates_a_non_not_found_stat_error_instead_of_treating_it_as_absence() {
        use std::os::unix::fs::PermissionsExt;

        if running_as_root() {
            eprintln!(
                "skipping ensure_bin_link_propagates_a_non_not_found_stat_error_instead_of_treating_it_as_absence: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let home = scratch_dir("stat-error-not-absence");
        let exe = fake_exe(&home, "konductor-exe-a");
        let bin_dir = local_bin_link_path(&home)
            .parent()
            .expect("link path always has a parent")
            .to_path_buf();
        fs::create_dir_all(&bin_dir).unwrap();
        // Strip ALL permissions from the bin dir itself -- `create_dir_all`
        // above only needed execute on its PARENT (already unaffected) to
        // confirm it exists, but `symlink_metadata` on a path INSIDE this
        // directory needs execute (search) permission on this directory
        // itself, which is now denied.
        let mut perms = fs::metadata(&bin_dir).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&bin_dir, perms).unwrap();

        let result = ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe);

        // Restore permissions before any cleanup/assertion path, so
        // `remove_dir_all` below can actually walk this directory
        // regardless of the outcome.
        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&bin_dir, restored);

        let err = result.expect_err(
            "a non-NotFound stat error must be propagated, not silently treated as absence",
        );
        assert!(
            matches!(err, BinLinkError::SymlinkFailed { .. }),
            "expected SymlinkFailed, got {err:?}"
        );
        assert_eq!(
            read_bin_links_at_home(Some(&home)).unwrap(),
            None,
            "no tracking entry must be written when the stat itself failed"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// CRITICAL regression (adversarial review finding #1): a symlink
    /// that already exists at the shared `$PATH` location, but was
    /// created by the USER (never tracked by this module at all -- e.g.
    /// `ln -s /some/other/tool ~/.local/bin/konductor`), must never be
    /// silently repointed. Reproduces the exact reported repro: create
    /// a foreign symlink to an unrelated script, then run
    /// `ensure_bin_link` -- it must refuse, not report `self_healed`,
    /// and the foreign symlink must survive untouched.
    #[test]
    fn ensure_bin_link_refuses_to_repoint_a_foreign_symlink_it_never_created() {
        let home = scratch_dir("foreign-symlink-hijack");
        let unrelated_script = fake_exe(&home, "some-unrelated-script");
        let exe = fake_exe(&home, "konductor-exe-a");
        let link_path = local_bin_link_path(&home);
        fs::create_dir_all(link_path.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&unrelated_script, &link_path).unwrap();

        let err = ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe)
            .expect_err("a symlink this module never created must never be repointed");
        assert!(
            matches!(err, BinLinkError::ForeignFileExists { .. }),
            "expected ForeignFileExists, got {err:?}"
        );

        // The foreign symlink must survive pointing at the unrelated
        // script, completely unchanged -- and no tracking entry must
        // have been written for a symlink konductor never actually
        // touched.
        assert_eq!(fs::read_link(&link_path).unwrap(), unrelated_script);
        assert_eq!(read_bin_links_at_home(Some(&home)).unwrap(), None);

        fs::remove_dir_all(&home).ok();
    }

    /// Regression companion to the hijack test above: even when THIS
    /// module has tracked entries already (for OTHER target_dirs), a
    /// foreign symlink whose target matches none of their recorded
    /// `link_target`s must still be refused -- tracked-entries-exist is
    /// not itself proof of ownership of THIS particular symlink.
    #[test]
    fn ensure_bin_link_refuses_a_foreign_symlink_even_when_other_entries_are_tracked() {
        let home = scratch_dir("foreign-symlink-with-other-tracked");
        let tracked_exe = fake_exe(&home, "konductor-exe-tracked");
        let unrelated_script = fake_exe(&home, "some-unrelated-script");
        let new_exe = fake_exe(&home, "konductor-exe-new");

        // Establish a real tracked entry first (for a DIFFERENT target),
        // then simulate someone manually replacing the physical symlink
        // with a foreign one afterward.
        ensure_bin_link_at_home(
            Some(&home),
            "/proj/tracked",
            "2026-01-01T00:00:00Z",
            &tracked_exe,
        )
        .unwrap();
        let link_path = local_bin_link_path(&home);
        fs::remove_file(&link_path).unwrap();
        std::os::unix::fs::symlink(&unrelated_script, &link_path).unwrap();

        let err = ensure_bin_link_at_home(Some(&home), "/proj/b", "2026-02-01T00:00:00Z", &new_exe)
            .expect_err(
                "a foreign symlink must be refused even with unrelated tracked entries present",
            );
        assert!(matches!(err, BinLinkError::ForeignFileExists { .. }));
        assert_eq!(fs::read_link(&link_path).unwrap(), unrelated_script);

        fs::remove_dir_all(&home).ok();
    }

    /// CRITICAL regression (adversarial review round 2): a symlink that
    /// already exists at the shared `$PATH` location and ALREADY POINTS
    /// at the exact resolved exe path -- e.g. because the user set it up
    /// manually via the documented `make link` / README workflow, not
    /// because konductor created it -- must still be refused, not
    /// silently adopted into the sidecar. Coincidentally already
    /// pointing at the right place is not proof of ownership: only a
    /// tracked entry's own recorded `link_target` is. Reproduces the
    /// reviewer's exact repro: manually symlink to the exe's exact
    /// resolved path outside any konductor call, into a completely
    /// fresh (empty) sidecar, then call `ensure_bin_link_at_home`.
    #[test]
    fn ensure_bin_link_refuses_an_untracked_symlink_that_coincidentally_already_points_at_current_exe(
    ) {
        let home = scratch_dir("coincidental-already-current");
        let exe = fake_exe(&home, "konductor-exe-a");
        let link_path = local_bin_link_path(&home);
        fs::create_dir_all(link_path.parent().unwrap()).unwrap();
        // A manual `ln -s <exe> ~/.local/bin/konductor` -- exactly the
        // workflow `cli/README.md`/`make link` document -- landing on
        // the SAME path a real `current_exe` will resolve to, with NO
        // konductor call ever having run yet (fresh, empty sidecar).
        std::os::unix::fs::symlink(&exe, &link_path).unwrap();

        let err = ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe)
            .expect_err(
                "an untracked symlink must be refused even when it already points at the \
                 exact resolved exe path -- coincidence is not ownership proof",
            );
        assert!(
            matches!(err, BinLinkError::ForeignFileExists { .. }),
            "expected ForeignFileExists, got {err:?}"
        );

        // The user's manual symlink must survive untouched, and no
        // tracking entry must have been written for a symlink konductor
        // never actually created.
        assert_eq!(fs::read_link(&link_path).unwrap(), exe);
        assert_eq!(read_bin_links_at_home(Some(&home)).unwrap(), None);

        fs::remove_dir_all(&home).ok();
    }

    /// Companion to the above: the same coincidental-match hazard
    /// compounds if the sidecar is ever lost entirely. Two DIFFERENT
    /// targets, each hitting the "already points at current exe" path
    /// against a freshly-empty sidecar (simulating sidecar loss between
    /// the two calls), must each be refused independently rather than
    /// either one adopting sole ownership of a symlink it never created.
    #[test]
    fn ensure_bin_link_refuses_coincidental_match_independently_for_each_of_two_targets_after_sidecar_loss(
    ) {
        let home = scratch_dir("coincidental-match-sidecar-loss");
        let exe = fake_exe(&home, "konductor-exe-shared");
        let link_path = local_bin_link_path(&home);
        fs::create_dir_all(link_path.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&exe, &link_path).unwrap();

        let err_a = ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe)
            .expect_err("first target must refuse the untracked coincidental match");
        assert!(matches!(err_a, BinLinkError::ForeignFileExists { .. }));

        // Sidecar is still empty (the first call never wrote an entry),
        // so the second target hits the identical untracked state --
        // must ALSO refuse, not adopt ownership.
        let err_b = ensure_bin_link_at_home(Some(&home), "/proj/b", "2026-01-02T00:00:00Z", &exe)
            .expect_err("second target must independently refuse the same untracked match");
        assert!(matches!(err_b, BinLinkError::ForeignFileExists { .. }));

        assert_eq!(fs::read_link(&link_path).unwrap(), exe);
        assert_eq!(read_bin_links_at_home(Some(&home)).unwrap(), None);

        fs::remove_dir_all(&home).ok();
    }

    /// A second, distinct `target_dir` requesting `--link-bin` shares
    /// the SAME fixed `$PATH` location -- the sidecar upserts by
    /// `target_dir`, so both entries are tracked, but only one physical
    /// symlink ever exists.
    #[test]
    fn ensure_bin_link_tracks_a_second_target_dir_sharing_the_same_link_path() {
        let home = scratch_dir("second-target");
        let exe = fake_exe(&home, "konductor-exe-a");

        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();
        ensure_bin_link_at_home(Some(&home), "/proj/b", "2026-01-02T00:00:00Z", &exe).unwrap();

        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(links.links.len(), 2);
        let mut target_dirs: Vec<&str> =
            links.links.iter().map(|e| e.target_dir.as_str()).collect();
        target_dirs.sort();
        assert_eq!(target_dirs, vec!["/proj/a", "/proj/b"]);

        fs::remove_dir_all(&home).ok();
    }

    /// A foreign regular file already sitting at
    /// `$HOME/.local/bin/konductor` (never created by this module) must
    /// never be clobbered -- refuse with `ForeignFileExists` instead of
    /// silently overwriting a user's own unrelated binary of the same
    /// name.
    #[test]
    fn ensure_bin_link_refuses_to_overwrite_a_foreign_non_symlink_file() {
        let home = scratch_dir("foreign-file");
        let exe = fake_exe(&home, "konductor-exe-a");
        let link_path = local_bin_link_path(&home);
        fs::create_dir_all(link_path.parent().unwrap()).unwrap();
        fs::write(&link_path, b"#!/bin/sh\necho not konductor\n").unwrap();

        let err = ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe)
            .expect_err("must refuse to overwrite a foreign non-symlink file");
        assert!(matches!(err, BinLinkError::ForeignFileExists { .. }));

        // The foreign file must survive untouched, and no tracking
        // entry must have been written for a link that was never
        // actually created.
        assert!(!link_path.is_symlink());
        assert_eq!(
            fs::read(&link_path).unwrap(),
            b"#!/bin/sh\necho not konductor\n"
        );
        assert_eq!(read_bin_links_at_home(Some(&home)).unwrap(), None);

        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn remove_bin_link_removes_symlink_and_tracking_entry() {
        let home = scratch_dir("remove-happy-path");
        let exe = fake_exe(&home, "konductor-exe-a");
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();
        let link_path = local_bin_link_path(&home);
        assert!(link_path.is_symlink());

        let removed = remove_bin_link_at_home(Some(&home), "/proj/a")
            .expect("must succeed")
            .expect("a tracked entry must report the removed path");
        assert_eq!(removed.link_path, link_path);
        assert!(
            removed.physically_removed,
            "the only tracked target must report the symlink as physically removed"
        );
        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "the symlink must actually be gone from disk"
        );

        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert!(links.links.is_empty());

        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn remove_bin_link_on_untracked_target_dir_is_a_noop_not_an_error() {
        let home = scratch_dir("remove-noop");
        let exe = fake_exe(&home, "konductor-exe-a");
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();

        let result = remove_bin_link_at_home(Some(&home), "/proj/never-tracked")
            .expect("an untracked target_dir must not be an error");
        assert_eq!(result, None);

        // The unrelated tracked entry/symlink must be untouched.
        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(links.links.len(), 1);
        assert!(local_bin_link_path(&home).is_symlink());

        fs::remove_dir_all(&home).ok();
    }

    /// If the tracked path has since been replaced by a foreign
    /// non-symlink file, `remove_bin_link` must still drop the tracking
    /// entry (this module no longer owns that path) but must NOT delete
    /// the foreign file.
    #[test]
    fn remove_bin_link_untracks_but_never_deletes_a_foreign_replacement() {
        let home = scratch_dir("remove-foreign-replacement");
        let exe = fake_exe(&home, "konductor-exe-a");
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();
        let link_path = local_bin_link_path(&home);
        fs::remove_file(&link_path).unwrap();
        fs::write(&link_path, b"replaced by something else").unwrap();

        let removed = remove_bin_link_at_home(Some(&home), "/proj/a")
            .expect("must succeed")
            .expect("a tracked entry must still report the (untracked) path");
        assert_eq!(removed.link_path, link_path);
        assert!(
            !removed.physically_removed,
            "a foreign replacement must never be reported as physically removed"
        );
        assert_eq!(
            fs::read(&link_path).unwrap(),
            b"replaced by something else",
            "a foreign replacement at the tracked path must never be deleted"
        );

        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert!(
            links.links.is_empty(),
            "tracking must still be dropped even though the file itself was left alone"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// Mirrors `ensure_bin_link_propagates_a_non_not_found_stat_error_instead_of_treating_it_as_absence`
    /// on the removal side: a non-`NotFound` stat failure on `link_path`
    /// must propagate as a real error, not be silently treated as "the
    /// symlink is already gone". Reproduces the same repro shape --
    /// strip all permissions from the bin directory itself so
    /// `symlink_metadata` on the link path inside it fails with
    /// `PermissionDenied`, not `NotFound`.
    ///
    /// Root-proofed the same way as the install-side test: root's DAC
    /// override bypasses the `0o000` chmod this repro depends on, so
    /// skip entirely under root rather than asserting on an outcome the
    /// platform will not produce there.
    #[test]
    fn remove_bin_link_propagates_a_non_not_found_stat_error_instead_of_treating_it_as_absence() {
        use std::os::unix::fs::PermissionsExt;

        if running_as_root() {
            eprintln!(
                "skipping remove_bin_link_propagates_a_non_not_found_stat_error_instead_of_treating_it_as_absence: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let home = scratch_dir("remove-stat-error-not-absence");
        let exe = fake_exe(&home, "konductor-exe-a");
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();
        let bin_dir = local_bin_link_path(&home)
            .parent()
            .expect("link path always has a parent")
            .to_path_buf();
        let mut perms = fs::metadata(&bin_dir).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&bin_dir, perms).unwrap();

        let result = remove_bin_link_at_home(Some(&home), "/proj/a");

        // Restore permissions before any cleanup/assertion path, so
        // `remove_dir_all` below can actually walk this directory
        // regardless of the outcome.
        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&bin_dir, restored);

        let err = result.expect_err(
            "a non-NotFound stat error must be propagated, not silently treated as absence",
        );
        assert!(
            matches!(err, BinLinkError::SymlinkFailed { .. }),
            "expected SymlinkFailed, got {err:?}"
        );
        assert_eq!(
            read_bin_links_at_home(Some(&home))
                .unwrap()
                .unwrap()
                .links
                .len(),
            1,
            "the tracking entry must not be dropped when the stat itself failed \
             before the sidecar was ever rewritten"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// CRITICAL regression (adversarial review finding #2): two DIFFERENT
    /// target_dirs both requesting `--link-bin` share the ONE physical
    /// symlink. Removing the FIRST target's tracking must NOT delete the
    /// physical symlink, since the second target's entry still names it
    /// -- `$PATH` resolution must keep working for the still-installed
    /// target, and that target's own entry must survive untouched.
    #[test]
    fn remove_bin_link_never_deletes_a_symlink_still_shared_by_another_target() {
        let home = scratch_dir("shared-link-two-targets");
        let exe = fake_exe(&home, "konductor-exe-a");
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();
        ensure_bin_link_at_home(Some(&home), "/proj/b", "2026-01-02T00:00:00Z", &exe).unwrap();
        let link_path = local_bin_link_path(&home);
        assert!(link_path.is_symlink(), "sanity check: link must exist");

        let removed = remove_bin_link_at_home(Some(&home), "/proj/a")
            .expect("must succeed")
            .expect("target_dir /proj/a was tracked");
        assert_eq!(removed.link_path, link_path);
        assert!(
            !removed.physically_removed,
            "IMPORTANT regression: a still-shared symlink must be reported as NOT \
             physically removed, even though /proj/a's tracking entry itself was dropped -- \
             otherwise a caller (e.g. uninstall's report) would wrongly claim $PATH \
             resolution changed when it did not"
        );

        // The physical symlink must SURVIVE -- /proj/b still depends on
        // it -- and /proj/b's own tracking entry must be untouched.
        assert!(
            link_path.is_symlink(),
            "the shared symlink must not be deleted while another target still tracks it"
        );
        assert_eq!(
            fs::read_link(&link_path).unwrap(),
            exe,
            "the surviving symlink must still point at the correct exe"
        );
        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(links.links.len(), 1);
        assert_eq!(links.links[0].target_dir, "/proj/b");

        fs::remove_dir_all(&home).ok();
    }

    /// Companion to the shared-link test above: once the LAST target
    /// sharing a symlink is removed, the physical symlink IS deleted --
    /// confirms the shared-link guard only suppresses deletion while a
    /// sibling target still needs it, not permanently.
    #[test]
    fn remove_bin_link_deletes_the_symlink_once_the_last_sharing_target_is_removed() {
        let home = scratch_dir("shared-link-last-removed");
        let exe = fake_exe(&home, "konductor-exe-a");
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();
        ensure_bin_link_at_home(Some(&home), "/proj/b", "2026-01-02T00:00:00Z", &exe).unwrap();
        let link_path = local_bin_link_path(&home);

        let first_removal = remove_bin_link_at_home(Some(&home), "/proj/a")
            .unwrap()
            .unwrap();
        assert!(
            !first_removal.physically_removed,
            "not the last sharing target yet -- must not report a physical removal"
        );
        assert!(
            link_path.is_symlink(),
            "sanity check: still shared by /proj/b"
        );

        let last_removal = remove_bin_link_at_home(Some(&home), "/proj/b")
            .unwrap()
            .unwrap();
        assert!(
            last_removal.physically_removed,
            "the last sharing target's removal must report a physical removal"
        );
        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "the symlink must be deleted once the LAST sharing target is removed"
        );

        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert!(links.links.is_empty());

        fs::remove_dir_all(&home).ok();
    }

    /// Regression (CR comment finding `f-e3e9d4c0`): two target_dirs
    /// share one physical symlink, both originally pointing at
    /// `old_exe`. Self-healing via `/proj/a` (with `new_exe`) must
    /// refresh `/proj/b`'s recorded `link_target` too, not just
    /// `/proj/a`'s own -- otherwise, once `/proj/a` is removed and
    /// `/proj/b` becomes the LAST remaining sharer, the removal-side
    /// ownership re-check (comparing the on-disk target against
    /// `/proj/b`'s own recorded `link_target`) would wrongly fail
    /// against the now-stale `old_exe` and leave the symlink orphaned on
    /// `$PATH` instead of deleting it.
    #[test]
    fn ensure_bin_link_self_heal_refreshes_link_target_on_every_sharing_sibling() {
        let home = scratch_dir("self-heal-refreshes-siblings");
        let old_exe = fake_exe(&home, "konductor-exe-old");
        let new_exe = fake_exe(&home, "konductor-exe-new");

        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &old_exe).unwrap();
        ensure_bin_link_at_home(Some(&home), "/proj/b", "2026-01-02T00:00:00Z", &old_exe).unwrap();

        // Self-heal triggered via /proj/a only -- /proj/b never calls
        // `ensure_bin_link` again itself.
        let (_, outcome) =
            ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-02-01T00:00:00Z", &new_exe)
                .expect("must succeed");
        assert_eq!(outcome, BinLinkOutcome::SelfHealed);

        // BOTH entries must now record the new exe -- not just /proj/a's.
        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        let by_target = |dir: &str| links.links.iter().find(|e| e.target_dir == dir).unwrap();
        assert_eq!(by_target("/proj/a").link_target, new_exe.to_string_lossy());
        assert_eq!(
            by_target("/proj/b").link_target,
            new_exe.to_string_lossy(),
            "the sibling's link_target must be refreshed too, or its own later removal-time \
             ownership re-check will fail against the stale old_exe"
        );

        // Now remove /proj/a first (still shared -- symlink survives),
        // then /proj/b (the last sharer) -- the physical symlink MUST
        // actually be deleted this time, not orphaned.
        let removed_a = remove_bin_link_at_home(Some(&home), "/proj/a")
            .unwrap()
            .unwrap();
        assert!(!removed_a.physically_removed);

        let link_path = local_bin_link_path(&home);
        let removed_b = remove_bin_link_at_home(Some(&home), "/proj/b")
            .unwrap()
            .unwrap();
        assert!(
            removed_b.physically_removed,
            "the last sharer's removal must actually delete the symlink, not leave it \
             orphaned due to a stale link_target"
        );
        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "the symlink must be gone from disk, not orphaned on $PATH"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// CRITICAL regression: the sibling `link_target` refresh must fire on the
    /// `Created` outcome too, not just `SelfHealed`. Reproduces the
    /// exact repro: two targets share a symlink (both recorded pointing
    /// at `old_exe`); the physical symlink is then deleted OUT-OF-BAND
    /// (never through konductor -- simulates e.g. a user `rm`); the next
    /// `ensure_bin_link` call for ONE target lands on the `Created`
    /// outcome (since `symlink_metadata` fails first), not `SelfHealed`.
    /// Both siblings' `link_target` must still end up refreshed, and
    /// uninstalling both in order (non-last-sharer first, then the last
    /// sharer) must actually delete the symlink rather than leave it
    /// orphaned because the last sharer's stale `link_target` failed its
    /// own removal-time ownership re-check.
    #[test]
    fn ensure_bin_link_created_outcome_also_refreshes_link_target_on_every_sharing_sibling() {
        let home = scratch_dir("created-outcome-refreshes-siblings");
        let old_exe = fake_exe(&home, "konductor-exe-old");
        let new_exe = fake_exe(&home, "konductor-exe-new");

        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &old_exe).unwrap();
        ensure_bin_link_at_home(Some(&home), "/proj/b", "2026-01-02T00:00:00Z", &old_exe).unwrap();
        let link_path = local_bin_link_path(&home);
        assert!(link_path.is_symlink(), "sanity check: link must exist");

        // Delete the physical symlink OUT-OF-BAND -- never through
        // konductor. The sidecar still tracks both /proj/a and /proj/b
        // with link_target == old_exe.
        fs::remove_file(&link_path).unwrap();
        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "sanity check: the symlink is genuinely gone before the next call"
        );

        // Re-install /proj/a with a DIFFERENT exe -- symlink_metadata
        // fails first (nothing at the path), so this MUST land on
        // Created, not SelfHealed.
        let (_, outcome) =
            ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-02-01T00:00:00Z", &new_exe)
                .expect("must succeed");
        assert_eq!(
            outcome,
            BinLinkOutcome::Created,
            "symlink_metadata must fail first (nothing at the path after the out-of-band \
             delete), so this call must land on Created, not SelfHealed"
        );

        // BOTH entries must now record the new exe -- not just /proj/a's.
        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        let by_target = |dir: &str| links.links.iter().find(|e| e.target_dir == dir).unwrap();
        assert_eq!(by_target("/proj/a").link_target, new_exe.to_string_lossy());
        assert_eq!(
            by_target("/proj/b").link_target,
            new_exe.to_string_lossy(),
            "the sibling's link_target must be refreshed even on the Created outcome, or its \
             own later removal-time ownership re-check will fail against the stale old_exe"
        );

        // Now remove /proj/a first (still shared -- symlink survives),
        // then /proj/b (the last sharer) -- the physical symlink MUST
        // actually be deleted this time, not orphaned.
        let removed_a = remove_bin_link_at_home(Some(&home), "/proj/a")
            .unwrap()
            .unwrap();
        assert!(!removed_a.physically_removed);

        let removed_b = remove_bin_link_at_home(Some(&home), "/proj/b")
            .unwrap()
            .unwrap();
        assert!(
            removed_b.physically_removed,
            "the last sharer's removal must actually delete the symlink, not leave it \
             orphaned due to a stale link_target from the out-of-band-delete + Created path"
        );
        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "the symlink must be gone from disk, not orphaned on $PATH"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// Pins `apply_link_target_sync`'s per-variant behavior directly,
    /// independent of the end-to-end `ensure_bin_link_at_home` coverage
    /// above: `Created` and `SelfHealed` must both sync every entry
    /// sharing `link_path`; `AlreadyCurrent` must leave every entry's
    /// `link_target` untouched. `apply_link_target_sync`'s own match has
    /// no wildcard arm, so a new `BinLinkOutcome` variant added later
    /// without an explicit decision there fails this file's build before
    /// this test could ever catch it at runtime.
    #[test]
    fn apply_link_target_sync_dispatches_per_outcome_variant_exhaustively() {
        let make_links = || {
            BinLinks::new(vec![
                BinLinkEntry {
                    target_dir: "/proj/a".to_string(),
                    link_path: "/home/x/.local/bin/konductor".to_string(),
                    link_target: "old_exe".to_string(),
                    created_at: "2026-01-01T00:00:00Z".to_string(),
                },
                BinLinkEntry {
                    target_dir: "/proj/b".to_string(),
                    link_path: "/home/x/.local/bin/konductor".to_string(),
                    link_target: "old_exe".to_string(),
                    created_at: "2026-01-02T00:00:00Z".to_string(),
                },
            ])
        };

        for outcome in [BinLinkOutcome::Created, BinLinkOutcome::SelfHealed] {
            let mut links = make_links();
            apply_link_target_sync(
                outcome,
                &mut links,
                "/home/x/.local/bin/konductor",
                "new_exe",
            );
            assert!(
                links.links.iter().all(|e| e.link_target == "new_exe"),
                "{outcome:?} must sync every sharing entry's link_target"
            );
        }

        let mut links = make_links();
        apply_link_target_sync(
            BinLinkOutcome::AlreadyCurrent,
            &mut links,
            "/home/x/.local/bin/konductor",
            "new_exe",
        );
        assert!(
            links.links.iter().all(|e| e.link_target == "old_exe"),
            "AlreadyCurrent must be a true no-op -- no entry's link_target may change"
        );
    }

    /// CRITICAL regression: a failure of
    /// `write_bin_links_at_home` AFTER a successful physical symlink
    /// swap must not leave the on-disk symlink pointing somewhere the
    /// (unwritten, therefore unchanged) sidecar has no record of --
    /// otherwise the NEXT call's ownership check (`owned_by_us`) finds
    /// no tracked `link_target` matching the new on-disk target and
    /// refuses konductor's own symlink as `ForeignFileExists`,
    /// permanently locking the user out until they manually `rm` it.
    /// Reproduces the exact repro: self-heal an existing, legitimately
    /// tracked symlink onto a new exe, but with the sidecar's directory
    /// stripped of write permission so `write_bin_links_at_home` fails
    /// right after `atomic_symlink` already repointed the physical
    /// symlink. The rollback this pins must restore the symlink to its
    /// PRE-call target so it matches the (unchanged) on-disk sidecar
    /// again, and a subsequent retry (permissions restored) must then
    /// succeed normally -- not `ForeignFileExists`.
    #[test]
    fn ensure_bin_link_rolls_back_the_symlink_swap_when_the_sidecar_write_fails() {
        use std::os::unix::fs::PermissionsExt;

        if running_as_root() {
            eprintln!(
                "skipping ensure_bin_link_rolls_back_the_symlink_swap_when_the_sidecar_write_fails: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let home = scratch_dir("rollback-on-sidecar-write-failure");
        let old_exe = fake_exe(&home, "konductor-exe-old");
        let new_exe = fake_exe(&home, "konductor-exe-new");

        // Establish a real tracked entry first, so the second call below
        // hits the SelfHealed branch (an ownership-proven repoint), not
        // Created.
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &old_exe).unwrap();
        let link_path = local_bin_link_path(&home);
        assert_eq!(fs::read_link(&link_path).unwrap(), old_exe);

        // Strip write permission from the sidecar's directory (leave
        // read+execute so the sidecar can still be READ) -- this makes
        // `write_atomic`'s temp-file creation fail with PermissionDenied
        // while `read_bin_links_at_home`'s read of the existing sidecar
        // still succeeds.
        let konductor_dir = home.join(KONDUCTOR_DIR_NAME);
        let mut perms = fs::metadata(&konductor_dir).unwrap().permissions();
        perms.set_mode(0o500);
        fs::set_permissions(&konductor_dir, perms).unwrap();

        let result =
            ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-02-01T00:00:00Z", &new_exe);

        // Restore permissions before any further assertion/cleanup, so
        // the directory can be read/written/removed normally again.
        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&konductor_dir, restored);

        let err = result.expect_err("the sidecar write must fail given the stripped permissions");
        assert!(
            matches!(err, BinLinkError::WriteFailed { .. }),
            "expected WriteFailed, got {err:?}"
        );

        // The rollback this pins: the physical symlink must be restored
        // to its PRE-call target (old_exe), matching the sidecar's own
        // unchanged, still-intact on-disk contents -- not left pointing
        // at new_exe with no tracked entry to match it.
        assert_eq!(
            fs::read_link(&link_path).unwrap(),
            old_exe,
            "a failed sidecar write must roll the symlink swap back to its pre-call target"
        );

        // A subsequent retry, with permissions restored, must succeed
        // normally and must NOT hit ForeignFileExists -- the whole point
        // of the rollback is that the symlink and the sidecar remain in
        // agreement, so ownership can still be proven on retry.
        let (_, outcome) =
            ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-02-01T00:00:00Z", &new_exe)
                .expect("retry after rollback must succeed, not ForeignFileExists");
        assert_eq!(outcome, BinLinkOutcome::SelfHealed);
        assert_eq!(fs::read_link(&link_path).unwrap(), new_exe);

        fs::remove_dir_all(&home).ok();
    }

    /// Companion to the rollback test above, pinning the `Created`
    /// outcome specifically: a fresh install (nothing tracked yet, no
    /// symlink at the path yet) whose sidecar write fails must have the
    /// freshly-created symlink removed again -- restoring "nothing
    /// here", matching the sidecar's own unchanged (still-empty) state
    /// -- rather than leaving an untracked symlink at the shared $PATH
    /// location that a later call's coincidental-match check (see the
    /// dedicated tests for that earlier in this file) would then have to
    /// refuse as foreign.
    #[test]
    fn ensure_bin_link_rolls_back_a_freshly_created_symlink_when_the_sidecar_write_fails() {
        use std::os::unix::fs::PermissionsExt;

        if running_as_root() {
            eprintln!(
                "skipping ensure_bin_link_rolls_back_a_freshly_created_symlink_when_the_sidecar_write_fails: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let home = scratch_dir("rollback-created-on-sidecar-write-failure");
        let exe = fake_exe(&home, "konductor-exe-a");
        let link_path = local_bin_link_path(&home);
        let konductor_dir = home.join(KONDUCTOR_DIR_NAME);

        // A throwaway prep call, then a full removal, so the sidecar's
        // directory AND its lock file (see `config_lock::acquire_named`)
        // already exist before permissions are stripped below --
        // otherwise stripping write permission on a directory whose lock
        // file does not exist yet would fail lock ACQUISITION itself
        // (`BinLinkError::Lock`), before ever reaching the
        // `write_bin_links_at_home` failure this test targets. After
        // this prep+removal, the sidecar is back to empty and the
        // physical symlink is gone -- the exact "nothing here yet" state
        // the `Created` outcome below needs.
        let setup_exe = fake_exe(&home, "konductor-exe-setup");
        ensure_bin_link_at_home(
            Some(&home),
            "/proj/setup",
            "2026-01-01T00:00:00Z",
            &setup_exe,
        )
        .unwrap();
        let removed = remove_bin_link_at_home(Some(&home), "/proj/setup")
            .unwrap()
            .unwrap();
        assert!(
            removed.physically_removed,
            "sanity check: the only tracked entry's removal must delete the symlink"
        );
        assert!(std::fs::symlink_metadata(&link_path).is_err());

        // Strip write permission from the sidecar's directory (leave
        // read+execute so the already-existing lock file can still be
        // opened, and so the empty sidecar can still be READ) -- this
        // makes `write_atomic`'s temp-file creation fail with
        // PermissionDenied while lock acquisition and the sidecar read
        // both still succeed.
        let mut perms = fs::metadata(&konductor_dir).unwrap().permissions();
        perms.set_mode(0o500);
        fs::set_permissions(&konductor_dir, perms).unwrap();

        let result = ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe);

        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&konductor_dir, restored);

        let err = result.expect_err("the sidecar write must fail given the stripped permissions");
        assert!(
            matches!(err, BinLinkError::WriteFailed { .. }),
            "expected WriteFailed, got {err:?}"
        );

        // The rollback this pins: the freshly-created symlink must be
        // removed again -- "nothing here" matches the sidecar's own
        // unchanged, still-empty on-disk state.
        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "a failed sidecar write must roll back a freshly-created symlink, \
             leaving nothing at the path"
        );

        // A retry, with permissions restored, must succeed normally.
        let (_, outcome) =
            ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe)
                .expect("retry after rollback must succeed");
        assert_eq!(outcome, BinLinkOutcome::Created);
        assert_eq!(fs::read_link(&link_path).unwrap(), exe);

        fs::remove_dir_all(&home).ok();
    }

    /// Pins `rollback_symlink_swap`'s per-variant behavior directly,
    /// independent of the end-to-end `ensure_bin_link_at_home` coverage
    /// above: `Some(PerformedSwap::Created)` removes whatever symlink
    /// sits at `link_path`; `Some(PerformedSwap::SelfHealed(target))`
    /// re-points it back at its carried `target`; `None` is a no-op.
    /// Its own match has no wildcard arm, so a new `PerformedSwap`
    /// variant added later without an explicit decision here fails this
    /// file's build before this test could ever catch it at runtime.
    /// Each call's own `Ok(())` is asserted too -- the function reports
    /// its result rather than swallowing it (see
    /// `finalize_after_failed_write`), and a clean rollback must report
    /// success, not just leave the filesystem in the right state.
    /// `swapped_to` is passed as `&new_exe` throughout -- the value each
    /// scenario's own symlink actually points at, matching what the
    /// (simulated) forward swap wrote, so the ownership check
    /// (`still_points_at`) that gates the destructive branch passes and
    /// the rollback proceeds as normal; the companion tests below cover
    /// the ownership check REFUSING.
    #[test]
    fn rollback_symlink_swap_dispatches_per_outcome_variant() {
        let home = scratch_dir("rollback-dispatch-unit");
        let old_exe = fake_exe(&home, "konductor-exe-old");
        let new_exe = fake_exe(&home, "konductor-exe-new");
        let link_path = local_bin_link_path(&home);
        fs::create_dir_all(link_path.parent().unwrap()).unwrap();

        // Created: a symlink exists (standing in for the just-performed
        // swap); rollback must remove it.
        std::os::unix::fs::symlink(&new_exe, &link_path).unwrap();
        assert!(rollback_symlink_swap(Some(PerformedSwap::Created), &new_exe, &link_path).is_ok());
        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "Created rollback must remove the freshly-created symlink"
        );

        // Created, called again with nothing at the path: the ownership
        // check (`still_points_at`) finds nothing there and declines --
        // already at the target end state ("nothing here"), so this must
        // still report success rather than surfacing anything as a failure.
        assert!(rollback_symlink_swap(Some(PerformedSwap::Created), &new_exe, &link_path).is_ok());

        // SelfHealed: a symlink exists pointing at the NEW target;
        // rollback must repoint it back at the OLD (pre-swap) target.
        std::os::unix::fs::symlink(&new_exe, &link_path).unwrap();
        assert!(rollback_symlink_swap(
            Some(PerformedSwap::SelfHealed(old_exe.clone())),
            &new_exe,
            &link_path
        )
        .is_ok());
        assert_eq!(
            fs::read_link(&link_path).unwrap(),
            old_exe,
            "SelfHealed rollback must restore the pre-swap target"
        );

        // None (AlreadyCurrent): never performed a swap -- must be a
        // no-op, leaving whatever is at link_path untouched.
        assert!(rollback_symlink_swap(None, &old_exe, &link_path).is_ok());
        assert_eq!(
            fs::read_link(&link_path).unwrap(),
            old_exe,
            "a None performed_swap must be a no-op"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// Regression pin for the reuse-focused finding `PerformedSwap`
    /// exists to close: the previous `rollback_symlink_swap` signature
    /// paired an independent `BinLinkOutcome` with an independent
    /// `Option<&Path>` pre-swap target, so a caller could construct
    /// `(BinLinkOutcome::SelfHealed, None)` -- a combination the swap
    /// side never actually produces, but one `rollback_symlink_swap`
    /// still had to guard against at runtime (its `SelfHealed` arm
    /// matched on `pre_swap_target` and fell through to `Ok(())` if it
    /// was absent). With `PerformedSwap::SelfHealed`'s target carried as
    /// the variant's own required field, that mismatched pairing is no
    /// longer constructible at all: every `PerformedSwap::SelfHealed`
    /// value carries exactly one target, by construction, so this test
    /// pins the roundtrip rather than a runtime fallback path that no
    /// longer exists.
    #[test]
    fn performed_swap_self_healed_always_carries_its_target() {
        let target = PathBuf::from("/some/exe");
        let swap = PerformedSwap::SelfHealed(target.clone());
        match swap {
            PerformedSwap::SelfHealed(carried) => assert_eq!(carried, target),
            PerformedSwap::Created => panic!("expected SelfHealed"),
        }
    }

    /// CRITICAL regression (round 8 adversarial-cr-review): `Created`'s
    /// rollback must NOT unconditionally delete whatever sits at
    /// `link_path`. Reproduces the exact race the reviewer found: our own
    /// swap created the symlink pointing at `new_exe` (what `swapped_to`
    /// records), but before the rollback runs, a non-konductor actor
    /// replaces it with a FOREIGN file in the same unprotected race
    /// window this module's own docs already disclose (module doc
    /// "Concurrency safety" -- scope of the guarantee). The ownership
    /// check this test pins must detect that `link_path` no longer points
    /// at `swapped_to` and decline the delete entirely -- the foreign
    /// file must survive byte-for-byte, and the call must still report
    /// `Ok(())` (declined, not failed) so the original write error is
    /// what the caller ultimately sees.
    #[test]
    fn rollback_symlink_swap_declines_to_delete_a_foreign_file_that_replaced_the_link_in_the_race_window(
    ) {
        let home = scratch_dir("rollback-race-created-foreign-file");
        let new_exe = fake_exe(&home, "konductor-exe-new");
        let link_path = local_bin_link_path(&home);
        fs::create_dir_all(link_path.parent().unwrap()).unwrap();

        // Simulate: the race window has already closed with a foreign
        // actor's own file landing at link_path -- NOT the symlink our
        // swap actually created (which is what a real race would leave
        // behind; the symlink from the swap has already been replaced by
        // the time rollback runs).
        let foreign_content = b"#!/bin/sh\necho i am not konductor's symlink\n";
        fs::write(&link_path, foreign_content).unwrap();

        let result = rollback_symlink_swap(Some(PerformedSwap::Created), &new_exe, &link_path);
        assert!(
            result.is_ok(),
            "declining the rollback must report Ok, not a failure -- nothing was corrupted"
        );

        assert!(
            !link_path.is_symlink(),
            "the foreign file must survive as a regular file, never converted to a symlink"
        );
        assert_eq!(
            fs::read(&link_path).unwrap(),
            foreign_content,
            "the foreign file's content must be byte-for-byte untouched"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// Companion to the test above, pinning `SelfHealed`'s branch: rollback
    /// must NOT unconditionally overwrite whatever symlink sits at
    /// `link_path` with the carried pre-swap target. Reproduces the same
    /// race, this time with a foreign SYMLINK (not a regular file) taking
    /// the path after our swap but before rollback runs -- `atomic_symlink`'s
    /// `rename()` would otherwise silently replace it with no error,
    /// since a symlink is just as much "someone else's content" as a
    /// regular file. The foreign symlink's target must survive unchanged.
    #[test]
    fn rollback_symlink_swap_declines_to_overwrite_a_foreign_symlink_that_replaced_the_link_in_the_race_window(
    ) {
        let home = scratch_dir("rollback-race-selfhealed-foreign-symlink");
        let old_exe = fake_exe(&home, "konductor-exe-old");
        let new_exe = fake_exe(&home, "konductor-exe-new");
        let unrelated_script = fake_exe(&home, "some-unrelated-script");
        let link_path = local_bin_link_path(&home);
        fs::create_dir_all(link_path.parent().unwrap()).unwrap();

        // Simulate: a foreign symlink (to something entirely unrelated)
        // has replaced our swap's own symlink by the time rollback runs.
        std::os::unix::fs::symlink(&unrelated_script, &link_path).unwrap();

        let result = rollback_symlink_swap(
            Some(PerformedSwap::SelfHealed(old_exe.clone())),
            &new_exe,
            &link_path,
        );
        assert!(
            result.is_ok(),
            "declining the rollback must report Ok, not a failure -- nothing was corrupted"
        );

        assert_eq!(
            fs::read_link(&link_path).unwrap(),
            unrelated_script,
            "the foreign symlink's target must survive unchanged, not be overwritten with \
             the carried pre-swap target"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// Removal-side companion (round 8): `remove_bin_link_at_home`'s own
    /// rollback (`recreate_symlink` gated by `still_absent`) has the exact
    /// same class of vulnerability as `rollback_symlink_swap` -- it was
    /// introduced in the same round-7 fix and was not covered by the
    /// round-6/round-8 reviews, which only examined `rollback_symlink_swap`
    /// directly. Pins the fix applied here proactively: `still_absent`
    /// must detect that a foreign file has taken `link_path` in the race
    /// window between the physical delete and this rollback, and decline
    /// to recreate the symlink over it.
    #[test]
    fn still_absent_declines_when_a_foreign_file_has_taken_the_path_in_the_race_window() {
        let home = scratch_dir("still-absent-race-foreign-file");
        let link_path = local_bin_link_path(&home);
        fs::create_dir_all(link_path.parent().unwrap()).unwrap();

        // Nothing at link_path yet -- still_absent must report true.
        assert!(
            still_absent(&link_path),
            "an empty path must be reported as still absent"
        );

        // A foreign actor places its own file at link_path in the race
        // window -- still_absent must now report false.
        let foreign_content = b"#!/bin/sh\necho foreign\n";
        fs::write(&link_path, foreign_content).unwrap();
        assert!(
            !still_absent(&link_path),
            "a path with foreign content must no longer be reported as absent"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// CRITICAL regression (round 7 review): the removal-side mirror of
    /// `ensure_bin_link_rolls_back_the_symlink_swap_when_the_sidecar_write_fails`
    /// above. `remove_bin_link_at_home` physically deletes the symlink
    /// BEFORE writing the sidecar (see that function's own comment on
    /// the two-independent-steps gap this pins). If the write fails
    /// right after a real physical delete, the rollback this test pins
    /// must recreate the symlink pointing at the entry's own recorded
    /// `link_target`, so the physical state matches the (unwritten,
    /// unchanged) sidecar again -- otherwise the entry would still be
    /// tracked on disk while `$PATH` silently lost the binary. A
    /// subsequent retry (permissions restored) must then delete it for
    /// real.
    #[test]
    fn remove_bin_link_rolls_back_the_physical_delete_when_the_sidecar_write_fails() {
        use std::os::unix::fs::PermissionsExt;

        if running_as_root() {
            eprintln!(
                "skipping remove_bin_link_rolls_back_the_physical_delete_when_the_sidecar_write_fails: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let home = scratch_dir("remove-rollback-on-sidecar-write-failure");
        let exe = fake_exe(&home, "konductor-exe-a");
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();
        let link_path = local_bin_link_path(&home);
        assert!(link_path.is_symlink(), "sanity check: link must exist");

        let konductor_dir = home.join(KONDUCTOR_DIR_NAME);
        let mut perms = fs::metadata(&konductor_dir).unwrap().permissions();
        perms.set_mode(0o500);
        fs::set_permissions(&konductor_dir, perms).unwrap();

        let result = remove_bin_link_at_home(Some(&home), "/proj/a");

        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&konductor_dir, restored);

        let err = result.expect_err("the sidecar write must fail given the stripped permissions");
        assert!(
            matches!(err, BinLinkError::WriteFailed { .. }),
            "expected WriteFailed, got {err:?}"
        );

        // The rollback this pins: the symlink must be recreated pointing
        // at the SAME target it did before this call -- matching the
        // sidecar, which (write failed) still tracks /proj/a untouched.
        assert_eq!(
            fs::read_link(&link_path).unwrap(),
            exe,
            "a failed sidecar write during removal must recreate the deleted symlink"
        );
        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(
            links.links.len(),
            1,
            "the tracking entry must still be present -- the removal never actually completed"
        );

        // A retry, with permissions restored, must succeed and this time
        // actually delete the symlink for real.
        let removed = remove_bin_link_at_home(Some(&home), "/proj/a")
            .expect("retry after rollback must succeed")
            .expect("the entry is still tracked, so this must be Some, not None");
        assert!(
            removed.physically_removed,
            "the retried removal must actually delete the symlink this time"
        );
        assert!(std::fs::symlink_metadata(&link_path).is_err());

        fs::remove_dir_all(&home).ok();
    }

    /// Companion test for the two-target shared-link scenario (round 7
    /// review): removing a NON-last sharer whose sidecar write fails
    /// must leave the shared symlink and the tracking data exactly as
    /// they were -- neither corrupted nor prematurely deleted -- and,
    /// once that failed removal is retried and actually succeeds, the
    /// TRUE last sharer's later removal must still correctly delete the
    /// physical symlink. This is the retry-recovers story: a write
    /// failure while `still_shared` is true never touches the
    /// filesystem at all (no physical action is attempted for a
    /// still-shared link), so there is nothing to roll back here --
    /// unlike the solo-target case above, the fix that matters is that
    /// the failed attempt leaves state completely unchanged, so a retry
    /// is guaranteed to converge.
    #[test]
    fn remove_bin_link_leaves_state_consistent_when_the_non_last_sharers_write_fails_and_the_last_sharer_still_deletes_on_retry(
    ) {
        use std::os::unix::fs::PermissionsExt;

        if running_as_root() {
            eprintln!(
                "skipping remove_bin_link_leaves_state_consistent_when_the_non_last_sharers_write_fails_and_the_last_sharer_still_deletes_on_retry: \
                 running as root, which bypasses the DAC permission denial this test depends on"
            );
            return;
        }

        let home = scratch_dir("remove-shared-nonlast-write-failure");
        let exe = fake_exe(&home, "konductor-exe-shared");
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();
        ensure_bin_link_at_home(Some(&home), "/proj/b", "2026-01-02T00:00:00Z", &exe).unwrap();
        let link_path = local_bin_link_path(&home);

        let konductor_dir = home.join(KONDUCTOR_DIR_NAME);
        let mut perms = fs::metadata(&konductor_dir).unwrap().permissions();
        perms.set_mode(0o500);
        fs::set_permissions(&konductor_dir, perms).unwrap();

        // Remove /proj/a (NOT the last sharer -- /proj/b still tracks
        // the same link_path) while the sidecar is unwritable.
        let result_a = remove_bin_link_at_home(Some(&home), "/proj/a");

        let restored = std::fs::Permissions::from_mode(0o755);
        let _ = fs::set_permissions(&konductor_dir, restored);

        assert!(
            matches!(result_a, Err(BinLinkError::WriteFailed { .. })),
            "expected the non-last removal's write to fail, got {result_a:?}"
        );

        // State must be completely unchanged: the shared symlink still
        // exists and still points at the shared exe, and BOTH entries
        // are still tracked -- no physical action was attempted at all,
        // since /proj/a was not the last sharer.
        assert!(
            link_path.is_symlink(),
            "the shared symlink must survive a failed non-last removal untouched"
        );
        assert_eq!(fs::read_link(&link_path).unwrap(), exe);
        let links_after_failure = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(
            links_after_failure.links.len(),
            2,
            "a failed write must leave BOTH entries tracked -- nothing was actually removed"
        );

        // Retry /proj/a's removal now that permissions are restored --
        // this must succeed cleanly, converging to the state the first
        // attempt was trying (and failing) to reach.
        let removed_a = remove_bin_link_at_home(Some(&home), "/proj/a")
            .expect("retried removal must succeed")
            .expect("/proj/a is still tracked");
        assert!(
            !removed_a.physically_removed,
            "/proj/b still shares the link -- must not physically delete yet"
        );
        assert!(link_path.is_symlink(), "still shared by /proj/b");

        // NOW /proj/b is the true last sharer -- its removal must
        // actually delete the physical symlink, proving the earlier
        // failure (now resolved by retry) left no lingering corruption.
        let removed_b = remove_bin_link_at_home(Some(&home), "/proj/b")
            .expect("must succeed")
            .expect("/proj/b was tracked");
        assert!(
            removed_b.physically_removed,
            "the true last sharer's removal must delete the physical symlink"
        );
        assert!(std::fs::symlink_metadata(&link_path).is_err());

        fs::remove_dir_all(&home).ok();
    }

    /// IMPORTANT regression (round 7 review): `rollback_symlink_swap`'s
    /// own failure used to be fully swallowed (`let _ = ...`), giving a
    /// double-fault (write failed AND the rollback meant to undo it also
    /// failed) zero diagnostic signal in the returned error. This pins
    /// `finalize_after_failed_write`, the shared glue both
    /// `ensure_bin_link_at_home` and `remove_bin_link_at_home` route
    /// through: a successful rollback must return the primary error
    /// unchanged, and a FAILED rollback must be surfaced as
    /// `BinLinkError::RollbackAlsoFailed`, with both failure messages
    /// present in the rendered `Display` output -- so a caller reading
    /// only the error string can tell a double-fault apart from a clean
    /// single failure.
    #[test]
    fn finalize_after_failed_write_surfaces_a_rollback_failure_as_a_distinct_error() {
        let primary = BinLinkError::WriteFailed {
            path: PathBuf::from("/tmp/bin-links"),
            source: std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "primary write denied",
            ),
        };
        let rollback_source = std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "rollback recreate denied",
        );

        let combined = finalize_after_failed_write(primary, Err(rollback_source));

        let rendered = combined.to_string();
        assert!(
            rendered.contains("primary write denied"),
            "the primary failure must remain visible in the combined error: {rendered}"
        );
        assert!(
            rendered.contains("rollback recreate denied") && rendered.contains("rollback"),
            "the rollback's own failure must ALSO be visible, not silently swallowed: {rendered}"
        );
        assert!(
            matches!(combined, BinLinkError::RollbackAlsoFailed { .. }),
            "a double-fault must be its own distinct variant, not collapsed into WriteFailed"
        );
    }

    /// Companion to the double-fault test above: when the rollback
    /// SUCCEEDS, the combined error must be exactly the original primary
    /// error, unwrapped -- a clean single failure must never be dressed
    /// up as a double-fault just because a rollback was attempted.
    #[test]
    fn finalize_after_failed_write_returns_the_primary_error_unchanged_when_rollback_succeeds() {
        let primary = BinLinkError::WriteFailed {
            path: PathBuf::from("/tmp/bin-links"),
            source: std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "primary write denied",
            ),
        };
        let combined = finalize_after_failed_write(primary, Ok(()));
        assert!(
            matches!(combined, BinLinkError::WriteFailed { .. }),
            "a successful rollback must not be wrapped -- the original error passes through unchanged"
        );
    }

    /// `bin_link_error_exit_code` must map `RollbackAlsoFailed`
    /// specifically to `EXIT_VERIFY_FAILED` (65), matching
    /// `UnsupportedSchemaVersion`'s own treatment -- both signal a
    /// state-consistency concern rather than an ordinary invalid
    /// invocation.
    #[test]
    fn bin_link_error_exit_code_maps_rollback_also_failed_to_65() {
        let err = BinLinkError::RollbackAlsoFailed {
            primary: Box::new(BinLinkError::WriteFailed {
                path: PathBuf::from("/tmp/bin-links"),
                source: std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied"),
            }),
            rollback_source: std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied"),
        };
        assert_eq!(bin_link_error_exit_code(&err), EXIT_VERIFY_FAILED);
    }

    #[test]
    fn read_bin_links_returns_none_when_absent() {
        let home = scratch_dir("read-absent");
        assert_eq!(read_bin_links_at_home(Some(&home)).unwrap(), None);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn read_bin_links_rejects_unsupported_schema_version() {
        let home = scratch_dir("schema-unknown");
        let path = bin_links_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"schema_version":99,"links":[]}"#).unwrap();

        let err = read_bin_links_at_home(Some(&home))
            .expect_err("unsupported schema_version must be rejected");
        match err {
            BinLinkError::UnsupportedSchemaVersion {
                found, supported, ..
            } => {
                assert_eq!(found, 99);
                assert_eq!(supported, BIN_LINK_SCHEMA_VERSION);
            }
            other => panic!("expected UnsupportedSchemaVersion, got {other:?}"),
        }
        fs::remove_dir_all(&home).ok();
    }

    /// A sidecar entry predating the `link_target` field (e.g. written
    /// by an older binary before this field existed) must still
    /// deserialize -- defaulting to an empty string, which matches no
    /// real `read_link` result and is therefore treated as unowned by
    /// the ownership check (the conservative, never-clobber default).
    #[test]
    fn read_bin_links_defaults_link_target_for_a_legacy_entry_missing_the_field() {
        let home = scratch_dir("legacy-no-link-target");
        let path = bin_links_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"links":[{"target_dir":"/proj/a","link_path":"/home/x/.local/bin/konductor","created_at":"2026-01-01T00:00:00Z"}]}"#,
        )
        .unwrap();
        let loaded = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(loaded.links.len(), 1);
        assert_eq!(loaded.links[0].link_target, "");
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn bin_link_file_name_has_no_json_suffix() {
        let home = scratch_dir("no-json-suffix");
        let exe = fake_exe(&home, "konductor-exe-a");
        ensure_bin_link_at_home(Some(&home), "/proj/a", "2026-01-01T00:00:00Z", &exe).unwrap();
        let path = bin_links_path(Some(&home)).unwrap();
        assert_eq!(path.file_name().unwrap(), "bin-links");
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn local_bin_link_path_is_home_local_bin_konductor() {
        let home = PathBuf::from("/home/alice");
        assert_eq!(
            local_bin_link_path(&home),
            PathBuf::from("/home/alice/.local/bin/konductor")
        );
    }

    #[test]
    fn ensure_bin_link_errors_clearly_when_home_unresolvable() {
        let exe = PathBuf::from("/tmp/does-not-matter");
        let err = ensure_bin_link_at_home(None, "/proj/a", "2026-01-01T00:00:00Z", &exe)
            .expect_err("an unresolvable $HOME must be a real error");
        assert!(matches!(err, BinLinkError::UnresolvableHome));
    }

    /// IMPORTANT regression (adversarial review finding #3): the
    /// sidecar's own read-modify-write is now guarded by a full-critical-
    /// section lock, not just protected in spirit. Reproduces the
    /// reviewer's exact repro shape (mirrors `config_lock.rs`'s own
    /// `concurrent_writers_serialize_with_no_lost_update` test): N
    /// threads each call `ensure_bin_link` for a DISTINCT target_dir
    /// sharing one `$HOME` -- every one of the N entries must survive,
    /// none lost to an unserialized read-modify-write race.
    #[test]
    fn ensure_bin_link_concurrent_calls_for_distinct_targets_lose_no_entries() {
        let home = scratch_dir("concurrent-no-lost-entries");
        let exe = fake_exe(&home, "konductor-exe-shared");

        let threads: Vec<_> = (0..20)
            .map(|i| {
                let home = home.clone();
                let exe = exe.clone();
                std::thread::spawn(move || {
                    ensure_bin_link_at_home(
                        Some(&home),
                        &format!("/proj/target-{i}"),
                        "2026-01-01T00:00:00Z",
                        &exe,
                    )
                    .expect("must succeed under contention (bounded lock wait)")
                })
            })
            .collect();

        for t in threads {
            t.join().unwrap();
        }

        let links = read_bin_links_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(
            links.links.len(),
            20,
            "every one of the 20 concurrent target_dir entries must be persisted -- a \
             lost entry indicates the sidecar's read-modify-write was not serialized"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// `bin_link_error_exit_code` must map `UnsupportedSchemaVersion`
    /// specifically to `EXIT_VERIFY_FAILED` (65) -- this regression test pins
    /// the case where the exit-code split was missing entirely for this error type.
    #[test]
    fn bin_link_error_exit_code_maps_unsupported_schema_version_to_65() {
        let err = BinLinkError::UnsupportedSchemaVersion {
            path: PathBuf::from("/tmp/.konductor/bin-links"),
            found: 99,
            supported: BIN_LINK_SCHEMA_VERSION,
        };
        assert_eq!(bin_link_error_exit_code(&err), EXIT_VERIFY_FAILED);
    }

    /// Every other `BinLinkError` variant must map to `EXIT_USAGE_ERROR`
    /// (64), confirming only the schema-version case gets the 65
    /// treatment.
    #[test]
    fn bin_link_error_exit_code_maps_every_other_variant_to_64() {
        let foreign = BinLinkError::ForeignFileExists {
            path: PathBuf::from("/home/x/.local/bin/konductor"),
        };
        assert_eq!(bin_link_error_exit_code(&foreign), EXIT_USAGE_ERROR);

        let unresolvable_home = BinLinkError::UnresolvableHome;
        assert_eq!(
            bin_link_error_exit_code(&unresolvable_home),
            EXIT_USAGE_ERROR
        );
    }
}
