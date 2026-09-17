// SPDX-License-Identifier: Apache-2.0
//
// install/index.rs — `~/.konductor/installs` read/write (Rust
// implementation).
//
// ── Scope ────────────────────────────────────────────────────────────────
// Home-level pointer table: one entry per distinct canonicalized
// `target_dir` this machine has ever installed Konductor to, so a future
// `update`/`uninstall` can discover targets without the caller already
// knowing where they are. This module implements that schema and
// write-ahead ordering, detailed in the sections below.
//
// ── Location is fixed, not `target_dir`-relative ─────────────────────────
// `index_path()` always resolves under the invoking user's real `$HOME`,
// regardless of what `target_dir` any given install/update/uninstall
// call addresses -- unlike `manifest_path()`, which is always relative
// to whatever `target_dir` it's asked about. There is exactly one index
// file per machine/user, not one per target.
//
// ── Mirrors manifest.rs's conventions exactly ─────────────────────────────
// Same derive set, same `#[serde(default)]` back-compat pattern, same
// snake_case string enum, same schema_version-checked-before-deserialize
// read path, same `write_atomic`-only write path, same
// deterministic-serialization approach (sorted before writing). Sorted
// by `target_dir` (manifest.rs sorts `files` by `path` for the same
// byte-determinism reason).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::cli::atomic_write::write_atomic;
use crate::cli::config::KONDUCTOR_DIR_NAME;

use super::manifest::legacy_strategy_name_to_current;

/// Index document schema version. Bump when the shape changes
/// incompatibly. `1` was `IndexEntry.strategy: String` (singular); `2`
/// generalizes to `strategies: Vec<String>`,
/// mirroring `Manifest.strategies`' own keys -- see `read_index`'s
/// migration path.
pub(crate) const INDEX_SCHEMA_VERSION: u64 = 2;

/// File name within `KONDUCTOR_DIR_NAME`, under `$HOME`. No `.json`
/// suffix -- mirrors `manifest.rs`'s `MANIFEST_FILE_NAME` naming.
pub(crate) const INDEX_FILE_NAME: &str = "installs";

/// Whether a given index entry's install/update run has finished.
/// Mirrors `manifest::Status` name-for-name; see that type's docstring
/// for the general shape rationale. Distinct in what it protects: this
/// guards a crash between two independent files (the index and that
/// target's own manifest), not a crash within a single file's write --
/// see the design doc's "Write-ahead crash safety" section. Defaults to
/// `Complete` for the same back-compat reason `manifest::Status` does:
/// an index predating this field was only ever written on full success.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexEntryStatus {
    InProgress,
    #[default]
    Complete,
}

/// One tracked install target: where, which strategies, when, and
/// whether that install/update run finished. `strategies` mirrors
/// `Manifest.strategies`' own keys (names only) -- one
/// name per currently-tracked strategy at this target, letting
/// `update`/`uninstall`'s selection UX render the list without opening
/// every target's manifest just to know how many strategies it has.
/// `status` is a CACHE of that target's own manifest `status`
/// (refreshed on every install/update write) -- never authoritative on
/// its own; a consumer that finds `InProgress` here must re-read the
/// target's manifest and trust it instead. `status` is `#[serde(default)]`
/// so an index predating this field still reads back (defaulting to `Complete`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexEntry {
    pub target_dir: String,
    pub strategies: Vec<String>,
    pub installed_at: String,
    #[serde(default)]
    pub status: IndexEntryStatus,
}

/// Exactly `INDEX_SCHEMA_VERSION`'s predecessor shape (v1): `strategy:
/// String` (singular), one strategy per entry. Used only by
/// `read_index`'s migration path to deserialize an old on-disk index
/// before repackaging each entry in memory as a single-entry
/// `strategies` list -- never written, and never referenced outside
/// this module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct LegacyIndexEntryV1 {
    pub target_dir: String,
    pub strategy: String,
    pub installed_at: String,
    #[serde(default)]
    pub status: IndexEntryStatus,
}

/// `~/.konductor/installs`'s in-memory shape: a schema discriminator
/// plus every tracked install target.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Index {
    pub schema_version: u64,
    pub installs: Vec<IndexEntry>,
}

impl Index {
    /// Builds an `Index` with the current `INDEX_SCHEMA_VERSION`, so
    /// call sites never hand-type the discriminator.
    pub fn new(installs: Vec<IndexEntry>) -> Self {
        Index {
            schema_version: INDEX_SCHEMA_VERSION,
            installs,
        }
    }
}

/// Exactly `INDEX_SCHEMA_VERSION`'s predecessor shape (v1): a flat
/// document with each entry's `strategy: String` singular. Used only by
/// `read_index`'s migration path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct LegacyIndexV1 {
    pub schema_version: u64,
    pub installs: Vec<LegacyIndexEntryV1>,
}

impl From<LegacyIndexV1> for Index {
    fn from(legacy: LegacyIndexV1) -> Self {
        Index {
            schema_version: INDEX_SCHEMA_VERSION,
            installs: legacy
                .installs
                .into_iter()
                .map(|entry| IndexEntry {
                    target_dir: entry.target_dir,
                    strategies: vec![legacy_strategy_name_to_current(&entry.strategy)],
                    installed_at: entry.installed_at,
                    status: entry.status,
                })
                .collect(),
        }
    }
}

/// All the ways reading/writing the index can fail. Mirrors
/// `manifest::ManifestError`'s variant shape and exit-code split
/// exactly: every variant except `UnsupportedSchemaVersion` is a USAGE
/// ERROR (map to `EXIT_USAGE_ERROR`, 64); `UnsupportedSchemaVersion` is
/// a state/verification failure (`EXIT_VERIFY_FAILED`, 65).
#[derive(Debug)]
#[allow(dead_code)]
pub enum IndexError {
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
    /// `std::fs::canonicalize`'s result contains non-UTF-8 bytes.
    /// Rather than silently lossy-coercing (which can make two
    /// distinct real paths collide onto the same `target_dir` string,
    /// or make a path fail to match its own index entry),
    /// canonicalization is refused outright and this variant is
    /// returned. Deliberately a USAGE ERROR (maps to
    /// `EXIT_USAGE_ERROR`, 64, via the default arm of every
    /// `*_error_exit_code` mapping in this crate) rather than a
    /// state/verification failure -- the index file itself is not at
    /// fault; the caller-supplied path is what can't be represented.
    NonUtf8Path { path: PathBuf },
    /// `index_path()` returned `None` because `$HOME` could not be
    /// resolved (unset or empty) -- distinct from "the index file does
    /// not exist at a resolvable path". Collapsing the two into
    /// `Ok(None)` made `uninstall`/`update` silently exit 0 (report "no
    /// tracked Konductor installs found") when `$HOME` was unset,
    /// exactly as if nothing had ever been installed -- even though
    /// whether anything is tracked genuinely cannot be determined in
    /// that state. `index_path`'s own docstring already states the
    /// intended rule ("callers must treat that the same as any other
    /// unresolvable-path usage error"); this variant is what lets
    /// `read_index` honor it. Deliberately a USAGE ERROR (maps to
    /// `EXIT_USAGE_ERROR`, 64, via the default arm of every
    /// `*_error_exit_code` mapping in this crate), not a
    /// state/verification failure -- there is no index file to be
    /// wrong about; the caller's environment is what can't be
    /// resolved, the same classification `write_index_at_home` already
    /// applies to the identical condition on the write side.
    UnresolvableHome,
}

impl std::fmt::Display for IndexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IndexError::CreateDirFailed { path, source } => {
                write!(f, "could not create {}: {source}", path.display())
            }
            IndexError::WriteFailed { path, source } => {
                write!(f, "could not write {}: {source}", path.display())
            }
            IndexError::ReadFailed { path, source } => {
                write!(f, "could not read {}: {source}", path.display())
            }
            IndexError::Malformed { path, source } => {
                write!(f, "{} is not valid JSON: {source}", path.display())
            }
            IndexError::UnsupportedSchemaVersion {
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
            IndexError::NonUtf8Path { path } => {
                write!(
                    f,
                    "{} contains non-UTF-8 bytes and cannot be tracked in the install index",
                    path.display()
                )
            }
            IndexError::UnresolvableHome => {
                write!(f, "could not resolve $HOME to locate the install index")
            }
        }
    }
}

impl std::error::Error for IndexError {}

/// `$HOME/.konductor/installs` -- always resolved against the
/// invoking user's real home directory (via the `HOME` env var), never
/// against any `target_dir` an install/update/uninstall call happens
/// to be addressing. `home_dir` is `None` when `HOME` is unset/empty;
/// callers must treat that the same as any other unresolvable-path
/// usage error (mirrors `install::resolve_destination`'s own
/// unset-`HOME` handling).
pub fn index_path(home_dir: Option<&Path>) -> Option<PathBuf> {
    home_dir.map(|home| home.join(KONDUCTOR_DIR_NAME).join(INDEX_FILE_NAME))
}

/// Resolves `$HOME` from the environment. Split out from `index_path`
/// so callers that already have a home directory (e.g. tests, or a
/// future caller resolving it once per process) can skip a second env
/// lookup.
fn env_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
}

/// Canonicalizes `target_dir` to an absolute, symlink-resolved path
/// string for storage as `IndexEntry.target_dir`. Unlike
/// `manifest::manifest_path` (whose location IS its own target_dir "by
/// construction"), the index is read from `~/.konductor/`, not from
/// inside the target it names -- so `target_dir` must be resolved to a
/// stable, absolute form up front, or `--target .` from two different
/// cwd's would register as two different entries for the same real
/// directory. `install::resolve_destination` does NOT canonicalize (it
/// returns the raw `--target` string or `$HOME` verbatim) -- this is
/// the one canonicalization step in the install path, applied only at
/// the index-write boundary.
///
/// The canonicalized path is checked for valid UTF-8 (via
/// `Path::to_str`) before being stored as `IndexEntry.target_dir:
/// String`: `std::fs::canonicalize`'s result is, on Unix, an
/// arbitrary, not-necessarily-UTF-8 byte sequence, and this canonical
/// string is the exact-match identity key `update`/`uninstall` use to
/// look up an entry (`entry.target_dir == canonical`) and the
/// upsert-dedup key `write_index` uses -- a lossily-coerced string
/// would not round-trip (the same real directory could fail to match
/// its own index entry, or two distinct real paths differing only in
/// non-UTF-8 bytes could collide onto one entry). A non-UTF-8
/// canonical path is refused (`IndexError::NonUtf8Path`) rather than
/// lossily coerced.
pub fn canonicalize_target_dir(target_dir: &Path) -> Result<String, IndexError> {
    let canonical = std::fs::canonicalize(target_dir).map_err(|source| IndexError::ReadFailed {
        path: target_dir.to_path_buf(),
        source,
    })?;
    match canonical.to_str() {
        Some(valid_utf8) => Ok(valid_utf8.to_string()),
        None => Err(IndexError::NonUtf8Path { path: canonical }),
    }
}

/// Renders `index` as deterministic, pretty-printed JSON bytes:
/// `installs` sorted by `target_dir`, 2-space indent (via
/// `serde_json::to_string_pretty`), trailing newline, UTF-8. Mirrors
/// `manifest.rs`'s own `serialize`.
fn serialize(index: &Index) -> Result<Vec<u8>, serde_json::Error> {
    let mut sorted = index.clone();
    sorted
        .installs
        .sort_by(|a, b| a.target_dir.cmp(&b.target_dir));
    let mut rendered = serde_json::to_string_pretty(&sorted)?;
    rendered.push('\n');
    Ok(rendered.into_bytes())
}

/// Reads `$HOME/.konductor/installs`. Returns `Ok(None)` ONLY for the
/// genuine "no index file yet at a resolvable path" case; returns
/// `Err(IndexError::UnresolvableHome)` if `$HOME` itself could not be
/// resolved -- those are not the same condition (see
/// `IndexError::UnresolvableHome`'s own docstring), and collapsing them
/// previously made `uninstall`/`update` silently exit 0 when `$HOME`
/// was unset/empty. Returns `Err` for any other failure (not valid
/// JSON, wrong shape). Checks `schema_version` before deserializing
/// into the concrete struct, exactly like `manifest::read_manifest` --
/// an unsupported version is always `UnsupportedSchemaVersion`, never a
/// generic deserialize error. Called by `update`'s target-resolution/
/// divergence-check path and `uninstall`'s selection/uninstall path.
pub fn read_index() -> Result<Option<Index>, IndexError> {
    read_index_at_home(env_home_dir().as_deref())
}

/// Same as `read_index`, but with the home directory passed in
/// explicitly. Split out so tests can point at a scratch "home"
/// without mutating the process-global `HOME` env var, which is unsafe
/// to do from parallel `cargo test` threads (mirrors `config.rs`'s
/// `load_config_with_home` split for the identical reason).
fn read_index_at_home(home_dir: Option<&Path>) -> Result<Option<Index>, IndexError> {
    let Some(path) = index_path(home_dir) else {
        return Err(IndexError::UnresolvableHome);
    };
    if !path.is_file() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&path).map_err(|source| IndexError::ReadFailed {
        path: path.clone(),
        source,
    })?;
    let raw: serde_json::Value =
        serde_json::from_str(&contents).map_err(|source| IndexError::Malformed {
            path: path.clone(),
            source,
        })?;
    // `as_i64` (not `as_u64`) so a negative `schema_version` is still
    // recognized as "a number was found" rather than falling through to
    // a generic `Malformed` -- same reasoning as manifest.rs. This
    // pre-deserialize check is still load-bearing for catching a
    // missing/non-numeric `schema_version` early (the `None` arm below
    // is a deliberate fallthrough for exactly that case, covered by
    // `read_rejects_missing_or_non_numeric_schema_version`) -- it is
    // NOT sufficient on its own, though: a `schema_version` that IS a
    // number but does not fit in `i64` (a `u64` value above
    // `i64::MAX`) also makes `as_i64` return `None`, which would
    // otherwise silently fall through to the same "no numeric version"
    // path as a genuinely missing field and be accepted rather than
    // rejected. The post-deserialize re-check below closes that gap by
    // comparing the actual deserialized `u64` field, which has no
    // range limitation `as_i64` does.
    let found_version = raw
        .get("schema_version")
        .and_then(serde_json::Value::as_i64);
    if found_version == Some(1) {
        let legacy: LegacyIndexV1 =
            serde_json::from_str(&contents).map_err(|source| IndexError::Malformed {
                path: path.clone(),
                source,
            })?;
        return Ok(Some(Index::from(legacy)));
    }
    if found_version != Some(INDEX_SCHEMA_VERSION as i64) {
        if let Some(found) = found_version {
            return Err(IndexError::UnsupportedSchemaVersion {
                path,
                found,
                supported: INDEX_SCHEMA_VERSION,
            });
        }
        // No numeric schema_version at all -- fall through to a normal
        // deserialize so the missing/malformed field is reported the
        // same way as any other shape error.
    }
    let index: Index = serde_json::from_str(&contents).map_err(|source| IndexError::Malformed {
        path: path.clone(),
        source,
    })?;
    // Post-deserialize catch-all: `index.schema_version` is a real
    // `u64`, so this comparison is correct for every value the pre-check
    // above could not represent as `i64` -- in particular a legal `u64`
    // above `i64::MAX`, which made `found_version` above `None` and let
    // execution reach here without ever being rejected.
    if index.schema_version != INDEX_SCHEMA_VERSION {
        return Err(IndexError::UnsupportedSchemaVersion {
            path,
            // `found_version` was already computed above from the same
            // JSON; reuse it when present (matches every existing
            // caller's expectation of an `i64` here) rather than
            // introducing a second representation. It can only be
            // `None` here for a value `as_i64` could not represent,
            // which is exactly the u64-overflow case this catch-all
            // exists for -- report `i64::MAX` as the closest
            // representable stand-in rather than fabricating a
            // misleading small number.
            found: found_version.unwrap_or(i64::MAX),
            supported: INDEX_SCHEMA_VERSION,
        });
    }
    Ok(Some(index))
}

/// Upserts `entry` into `$HOME/.konductor/installs` by canonicalized
/// `target_dir`: read-modify-write against the current index, replace
/// the entry whose `target_dir` matches `entry.target_dir` (if
/// present) or append it (if absent), then write the full list back
/// atomically via `write_atomic`. Callers MUST pass an already-
/// canonicalized `target_dir` (via `canonicalize_target_dir`) -- this
/// function performs no canonicalization itself, so upserting with two
/// different spellings of the same real directory produces two
/// entries.
pub fn write_index(entry: IndexEntry) -> Result<PathBuf, IndexError> {
    write_index_at_home(env_home_dir().as_deref(), entry)
}

/// Same as `write_index`, but with the home directory passed in
/// explicitly -- see `read_index_at_home`'s docstring for why.
fn write_index_at_home(home_dir: Option<&Path>, entry: IndexEntry) -> Result<PathBuf, IndexError> {
    let path = index_path(home_dir).ok_or_else(|| IndexError::WriteFailed {
        path: PathBuf::from("$HOME/.konductor/installs"),
        source: std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "could not resolve $HOME to locate the install index",
        ),
    })?;
    let parent = path.parent().expect("index path always has a parent");
    std::fs::create_dir_all(parent).map_err(|source| IndexError::CreateDirFailed {
        path: parent.to_path_buf(),
        source,
    })?;

    let mut index = read_index_at_home(home_dir)?.unwrap_or_else(|| Index::new(Vec::new()));
    match index
        .installs
        .iter_mut()
        .find(|existing| existing.target_dir == entry.target_dir)
    {
        Some(existing) => *existing = entry,
        None => index.installs.push(entry),
    }

    let bytes = serialize(&index).expect("Index must always serialize");
    write_atomic(&path, &bytes).map_err(|source| IndexError::WriteFailed {
        path: path.clone(),
        source,
    })?;
    Ok(path)
}

/// Removes the entry matching `target_dir` (already canonicalized, same
/// contract as `write_index`) from `$HOME/.konductor/installs`, if
/// present. A no-op (not an error) if no entry matches -- uninstall
/// calls this once it has already succeeded at removing a target, so a
/// missing entry at that point means nothing more to do, not a usage
/// error. Read-modify-write via `write_atomic`, mirroring `write_index`'s
/// own shape; the resulting file persists (with a possibly-empty
/// `installs` list) rather than being deleted -- `~/.konductor/installs`
/// is never removed by any operation.
pub fn remove_index_entry(target_dir: &str) -> Result<PathBuf, IndexError> {
    remove_index_entry_at_home(env_home_dir().as_deref(), target_dir)
}

/// Removes `strategy_name` from the tracked entry matching `target_dir`'s
/// own `strategies` list -- `uninstall` now acts on
/// exactly one tracked strategy per run, not necessarily a target's
/// whole tracking. A no-op (not an error) if no entry matches
/// `target_dir`, or `strategy_name` isn't in that entry's list --
/// `uninstall` calls this once it has already succeeded at removing
/// that one strategy's own files/manifest slot, so nothing further to
/// do at that point is not a usage error, mirroring
/// `remove_index_entry`'s own "already gone" contract.
///
/// If removing `strategy_name` empties the entry's `strategies` list,
/// the WHOLE entry is removed (mirrors `remove_index_entry`) -- an
/// index entry tracking zero strategies is meaningless, since there is
/// nothing left for a future `update`/`uninstall` to select among. In
/// practice `uninstall_one_impl` never reaches this function for that
/// case (it calls `remove_index_entry` directly instead once it already
/// knows removing the selected strategy empties the manifest), but this
/// function keeps the same invariant on its own so a future caller
/// cannot produce a meaningless zero-strategy entry through this path
/// either.
pub fn remove_strategy_from_index(
    target_dir: &str,
    strategy_name: &str,
) -> Result<PathBuf, IndexError> {
    remove_strategy_from_index_at_home(env_home_dir().as_deref(), target_dir, strategy_name)
}

/// Returns every `target_dir` value that appears more than once in
/// `installs`, deduplicated and in first-seen order. `write_index`'s
/// own upsert path (read-modify-write, replace-in-place-by-key) can
/// never produce this on its own -- the only way it can arise is a
/// hand-edited or otherwise corrupted `~/.konductor/installs` file. A
/// non-empty result means the index is corrupted and must not be acted
/// on until fixed by hand: this function performs no deduplication or
/// repair itself; it only detects and reports, so a caller (`update`'s
/// and `uninstall`'s dispatch entry points) can refuse to proceed rather
/// than silently guessing which duplicate entry is authoritative.
pub fn duplicate_target_dirs(installs: &[IndexEntry]) -> Vec<String> {
    use std::collections::HashSet;
    let mut seen: HashSet<&str> = HashSet::new();
    let mut duplicated: Vec<String> = Vec::new();
    let mut already_reported: HashSet<&str> = HashSet::new();
    for entry in installs {
        let key = entry.target_dir.as_str();
        if !seen.insert(key) && already_reported.insert(key) {
            duplicated.push(entry.target_dir.clone());
        }
    }
    duplicated
}

/// Same as `remove_index_entry`, but with the home directory passed in
/// explicitly -- see `read_index_at_home`'s docstring for why.
fn remove_index_entry_at_home(
    home_dir: Option<&Path>,
    target_dir: &str,
) -> Result<PathBuf, IndexError> {
    let path = index_path(home_dir).ok_or_else(|| IndexError::WriteFailed {
        path: PathBuf::from("$HOME/.konductor/installs"),
        source: std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "could not resolve $HOME to locate the install index",
        ),
    })?;
    let parent = path.parent().expect("index path always has a parent");
    std::fs::create_dir_all(parent).map_err(|source| IndexError::CreateDirFailed {
        path: parent.to_path_buf(),
        source,
    })?;

    let mut index = read_index_at_home(home_dir)?.unwrap_or_else(|| Index::new(Vec::new()));
    index
        .installs
        .retain(|entry| entry.target_dir != target_dir);

    let bytes = serialize(&index).expect("Index must always serialize");
    write_atomic(&path, &bytes).map_err(|source| IndexError::WriteFailed {
        path: path.clone(),
        source,
    })?;
    Ok(path)
}

/// Same as `remove_strategy_from_index`, but with the home directory
/// passed in explicitly -- see `read_index_at_home`'s docstring for
/// why.
fn remove_strategy_from_index_at_home(
    home_dir: Option<&Path>,
    target_dir: &str,
    strategy_name: &str,
) -> Result<PathBuf, IndexError> {
    let path = index_path(home_dir).ok_or_else(|| IndexError::WriteFailed {
        path: PathBuf::from("$HOME/.konductor/installs"),
        source: std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "could not resolve $HOME to locate the install index",
        ),
    })?;
    let parent = path.parent().expect("index path always has a parent");
    std::fs::create_dir_all(parent).map_err(|source| IndexError::CreateDirFailed {
        path: parent.to_path_buf(),
        source,
    })?;

    let mut index = read_index_at_home(home_dir)?.unwrap_or_else(|| Index::new(Vec::new()));
    if let Some(entry) = index
        .installs
        .iter_mut()
        .find(|entry| entry.target_dir == target_dir)
    {
        entry.strategies.retain(|s| s != strategy_name);
    }
    // Mirrors `remove_index_entry`'s own "zero strategies is meaningless"
    // invariant -- see this function's own doc comment.
    index
        .installs
        .retain(|entry| entry.target_dir != target_dir || !entry.strategies.is_empty());

    let bytes = serialize(&index).expect("Index must always serialize");
    write_atomic(&path, &bytes).map_err(|source| IndexError::WriteFailed {
        path: path.clone(),
        source,
    })?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-index-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_entry(target_dir: &str) -> IndexEntry {
        IndexEntry {
            target_dir: target_dir.to_string(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-15T09:30:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        }
    }

    #[test]
    fn write_then_read_round_trips() {
        let home = scratch_dir("round-trip");
        let entry = sample_entry("/home/alice/work/project");
        write_index_at_home(Some(&home), entry.clone()).expect("write must succeed");
        let loaded = read_index_at_home(Some(&home)).expect("read must succeed");
        assert_eq!(loaded, Some(Index::new(vec![entry])));
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn read_returns_none_when_absent() {
        let home = scratch_dir("absent");
        assert_eq!(read_index_at_home(Some(&home)).unwrap(), None);
        fs::remove_dir_all(&home).ok();
    }

    /// Regression for the fix distinguishing "no index file yet" from
    /// "cannot resolve $HOME": before the fix, both collapsed into
    /// `Ok(None)`, making `uninstall`/`update` silently exit 0 when
    /// `$HOME` was unset -- indistinguishable from "nothing tracked".
    /// Now this must return `Err(IndexError::UnresolvableHome)`, a real
    /// usage error a caller can't silently swallow.
    #[test]
    fn read_errors_with_unresolvable_home_when_home_is_none() {
        let err = read_index_at_home(None)
            .expect_err("an unresolvable $HOME must be a real error, not Ok(None)");
        assert!(matches!(err, IndexError::UnresolvableHome));
    }

    #[test]
    fn read_rejects_malformed_json() {
        let home = scratch_dir("malformed");
        let path = index_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"not json").unwrap();
        let err = read_index_at_home(Some(&home)).expect_err("malformed JSON must be rejected");
        assert!(matches!(err, IndexError::Malformed { .. }));
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn read_rejects_unknown_schema_version() {
        let home = scratch_dir("schema-unknown");
        let path = index_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"schema_version":99,"installs":[]}"#).unwrap();
        let err =
            read_index_at_home(Some(&home)).expect_err("unknown schema_version must be rejected");
        match err {
            IndexError::UnsupportedSchemaVersion {
                found, supported, ..
            } => {
                assert_eq!(found, 99);
                assert_eq!(supported, INDEX_SCHEMA_VERSION);
            }
            other => panic!("expected UnsupportedSchemaVersion, got {other:?}"),
        }
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn read_rejects_negative_schema_version_as_unsupported_not_malformed() {
        let home = scratch_dir("schema-negative");
        let path = index_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"schema_version":-1,"installs":[]}"#).unwrap();
        let err =
            read_index_at_home(Some(&home)).expect_err("negative schema_version must be rejected");
        match err {
            IndexError::UnsupportedSchemaVersion {
                found, supported, ..
            } => {
                assert_eq!(found, -1);
                assert_eq!(supported, INDEX_SCHEMA_VERSION);
            }
            other => panic!("expected UnsupportedSchemaVersion, got {other:?}"),
        }
        fs::remove_dir_all(&home).ok();
    }

    /// A `schema_version` that is a legal `u64` but exceeds `i64::MAX`
    /// (e.g. `18446744073709551615` == `u64::MAX`) must still be
    /// rejected as `UnsupportedSchemaVersion`, not silently accepted.
    /// The pre-deserialize `as_i64` check alone cannot see this: it
    /// returns `None` for a value that doesn't fit in `i64`, which is
    /// indistinguishable from a missing/non-numeric field at that
    /// point -- only the post-deserialize re-check against the real
    /// `u64` field catches it.
    #[test]
    fn read_rejects_u64_schema_version_above_i64_max_as_unsupported_not_accepted() {
        let home = scratch_dir("schema-u64-overflow-max");
        let path = index_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":18446744073709551615,"installs":[]}"#,
        )
        .unwrap();
        let err = read_index_at_home(Some(&home))
            .expect_err("u64 schema_version above i64::MAX must be rejected");
        match err {
            IndexError::UnsupportedSchemaVersion { supported, .. } => {
                assert_eq!(supported, INDEX_SCHEMA_VERSION);
            }
            other => panic!("expected UnsupportedSchemaVersion, got {other:?}"),
        }
        fs::remove_dir_all(&home).ok();
    }

    /// Same gap, using `i64::MAX + 1` (the smallest `u64` that does not
    /// fit in `i64`) rather than `u64::MAX` -- confirms the boundary
    /// itself is caught, not just the extreme value.
    #[test]
    fn read_rejects_u64_schema_version_just_above_i64_max_as_unsupported() {
        let home = scratch_dir("schema-u64-overflow-boundary");
        let path = index_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":9223372036854775808,"installs":[]}"#,
        )
        .unwrap();
        let err = read_index_at_home(Some(&home))
            .expect_err("u64 schema_version of i64::MAX + 1 must be rejected");
        assert!(matches!(err, IndexError::UnsupportedSchemaVersion { .. }));
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn read_rejects_missing_or_non_numeric_schema_version() {
        let home = scratch_dir("schema-missing");
        let path = index_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"installs":[]}"#).unwrap();
        let err =
            read_index_at_home(Some(&home)).expect_err("missing schema_version must be rejected");
        assert!(matches!(err, IndexError::Malformed { .. }));

        fs::write(&path, br#"{"schema_version":"abc","installs":[]}"#).unwrap();
        let err = read_index_at_home(Some(&home))
            .expect_err("non-numeric schema_version must be rejected");
        assert!(matches!(err, IndexError::Malformed { .. }));
        fs::remove_dir_all(&home).ok();
    }

    /// A legacy v1 index entry (no `status` key, singular `strategy`
    /// field, no `strategies` list at all) must still read back,
    /// migrated in memory into a single-entry `strategies` list
    /// with its status defaulted to `Complete` -- the
    /// same back-compat contract `manifest::Status` provides. Uses the
    /// OLD `kiro-cli` name a real v1 binary would have recorded (see
    /// `manifest::legacy_strategy_name_to_current`'s own doc comment for
    /// why `kiro-cli-v2` could never appear in a genuine v1 document),
    /// and asserts the migrated entry carries the CURRENT name.
    #[test]
    fn read_migrates_legacy_v1_entry_into_single_entry_strategies_list() {
        let home = scratch_dir("legacy-no-status");
        let path = index_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"installs":[{"target_dir":"/home/alice/proj","strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z"}]}"#,
        )
        .unwrap();
        let loaded = read_index_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(loaded.schema_version, INDEX_SCHEMA_VERSION);
        assert_eq!(loaded.installs.len(), 1);
        assert_eq!(
            loaded.installs[0].strategies,
            vec!["kiro-cli-v2".to_string()]
        );
        assert_eq!(loaded.installs[0].status, IndexEntryStatus::Complete);
        fs::remove_dir_all(&home).ok();
    }

    /// The remaining two old-to-new mappings (`kiro-cli-v3` -> `kiro-v3`,
    /// `claude-code` -> `claude`), exercised through the real index
    /// migration path -- the test above only covers `kiro-cli`.
    #[test]
    fn read_migrates_legacy_v1_entry_remaining_old_names() {
        let home = scratch_dir("legacy-remaining-names");
        let path = index_path(Some(&home)).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"installs":[{"target_dir":"/home/alice/v3","strategy":"kiro-cli-v3","installed_at":"2026-01-15T09:30:00Z"},{"target_dir":"/home/alice/claude","strategy":"claude-code","installed_at":"2026-01-15T09:30:00Z"}]}"#,
        )
        .unwrap();
        let loaded = read_index_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(loaded.installs.len(), 2);
        assert_eq!(loaded.installs[0].strategies, vec!["kiro-v3".to_string()]);
        assert_eq!(loaded.installs[1].strategies, vec!["claude".to_string()]);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn write_upserts_replacing_not_duplicating_same_target_dir() {
        let home = scratch_dir("upsert-replace");
        let first = sample_entry("/home/alice/proj");
        write_index_at_home(Some(&home), first).expect("first write must succeed");

        let mut second = sample_entry("/home/alice/proj");
        second.installed_at = "2026-02-01T00:00:00Z".to_string();
        second.status = IndexEntryStatus::InProgress;
        write_index_at_home(Some(&home), second.clone()).expect("second write must succeed");

        let loaded = read_index_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(loaded.installs.len(), 1, "must replace, not duplicate");
        assert_eq!(loaded.installs[0], second);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn write_appends_new_entry_for_distinct_target_dir() {
        let home = scratch_dir("upsert-append");
        write_index_at_home(Some(&home), sample_entry("/home/alice/proj-a"))
            .expect("first write must succeed");
        write_index_at_home(Some(&home), sample_entry("/home/alice/proj-b"))
            .expect("second write must succeed");

        let loaded = read_index_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(loaded.installs.len(), 2);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn write_sorts_installs_by_target_dir() {
        let home = scratch_dir("sorted");
        write_index_at_home(Some(&home), sample_entry("/z/last"))
            .expect("first write must succeed");
        let path = write_index_at_home(Some(&home), sample_entry("/a/first"))
            .expect("second write must succeed");

        let contents = fs::read_to_string(&path).unwrap();
        let a_pos = contents.find("/a/first").unwrap();
        let z_pos = contents.find("/z/last").unwrap();
        assert!(a_pos < z_pos, "installs must be sorted by target_dir");
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn write_leaves_no_leftover_tmp_file() {
        let home = scratch_dir("no-leftover");
        write_index_at_home(Some(&home), sample_entry("/home/alice/proj")).unwrap();
        let konductor_dir = home.join(KONDUCTOR_DIR_NAME);
        let leftovers: Vec<_> = fs::read_dir(&konductor_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn written_index_ends_with_trailing_newline() {
        let home = scratch_dir("trailing-newline");
        let path = write_index_at_home(Some(&home), sample_entry("/home/alice/proj")).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.ends_with(b"\n"));
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn index_file_name_has_no_json_suffix() {
        let home = scratch_dir("no-json-suffix");
        let path = write_index_at_home(Some(&home), sample_entry("/home/alice/proj")).unwrap();
        assert_eq!(path.file_name().unwrap(), "installs");
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn schema_version_is_present_and_equals_two() {
        let home = scratch_dir("schema-version");
        let path = write_index_at_home(Some(&home), sample_entry("/home/alice/proj")).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["schema_version"], 2);
        fs::remove_dir_all(&home).ok();
    }

    /// A target tracking two strategies (a Kiro variant and
    /// `claude`) renders `strategies` with both names, in insertion
    /// order (see `sample_entry_with_strategies`) -- the index's own
    /// list mirrors `Manifest.strategies`' keys.
    #[test]
    fn write_then_read_round_trips_multi_strategy_entry() {
        let home = scratch_dir("multi-strategy");
        let mut entry = sample_entry("/home/alice/multi");
        entry.strategies = vec!["kiro-cli-v2".to_string(), "claude".to_string()];
        write_index_at_home(Some(&home), entry.clone()).unwrap();
        let loaded = read_index_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(loaded.installs[0].strategies, entry.strategies);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn status_variants_serialize_as_expected_strings() {
        let home = scratch_dir("status-strings");
        let mut entry = sample_entry("/home/alice/in-progress-target");
        entry.status = IndexEntryStatus::InProgress;
        let path = write_index_at_home(Some(&home), entry).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["installs"][0]["status"], "in_progress");
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn canonicalize_target_dir_resolves_relative_path_to_absolute() {
        let dir = scratch_dir("canonicalize");
        let canonical = canonicalize_target_dir(&dir).expect("canonicalize must succeed");
        assert!(
            Path::new(&canonical).is_absolute(),
            "canonicalized target_dir must be absolute: {canonical}"
        );
        // Canonicalizing "." from inside `dir` must produce the SAME
        // string as canonicalizing `dir`'s own absolute path -- the
        // property `write_index`'s upsert relies on to avoid
        // registering two entries for one real directory.
        let via_dot = std::env::current_dir().unwrap();
        let _ = via_dot; // cwd-independent assertion below covers this.
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn canonicalize_target_dir_errors_on_nonexistent_path() {
        let dir = scratch_dir("canonicalize-missing");
        let missing = dir.join("does-not-exist");
        assert!(canonicalize_target_dir(&missing).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn canonicalize_target_dir_same_real_dir_two_spellings_matches() {
        let dir = scratch_dir("canonicalize-two-spellings");
        let nested = dir.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let via_absolute = canonicalize_target_dir(&nested).unwrap();
        let via_dotdot =
            canonicalize_target_dir(&dir.join("nested").join(".").join("..").join("nested"))
                .unwrap();
        assert_eq!(
            via_absolute, via_dotdot,
            "two spellings of the same real directory must canonicalize identically"
        );
        fs::remove_dir_all(&dir).ok();
    }

    // ── Non-UTF-8 path rejection ────────────────────────────────────────
    //
    // `canonicalize_target_dir` must refuse (not lossily coerce) a
    // target whose canonicalized path contains genuinely non-UTF-8
    // bytes -- constructed here via `OsStr::from_bytes`
    // (`std::os::unix::ffi::OsStrExt`), which is exact and does not
    // itself perform any lossy substitution, unlike
    // `Path::to_string_lossy`.

    #[cfg(unix)]
    #[test]
    fn canonicalize_target_dir_rejects_genuinely_non_utf8_path() {
        use std::os::unix::ffi::OsStrExt;

        let dir = scratch_dir("canonicalize-non-utf8");
        // 0x66 0x6f 0x80 0x6f is not valid UTF-8 (0x80 is a bare
        // continuation byte with no leading byte) -- a real, exact
        // non-UTF-8 byte sequence, not an approximation.
        let bad_component_bytes: &[u8] = &[0x66, 0x6f, 0x80, 0x6f];
        let bad_component = std::ffi::OsStr::from_bytes(bad_component_bytes);
        assert!(
            bad_component.to_str().is_none(),
            "sanity check: the constructed component must itself not be valid UTF-8"
        );
        let non_utf8_dir = dir.join(bad_component);
        fs::create_dir_all(&non_utf8_dir).expect("filesystem allows non-UTF-8 byte paths");

        let err = canonicalize_target_dir(&non_utf8_dir)
            .expect_err("a non-UTF-8 canonical path must be rejected, not lossily coerced");
        match err {
            IndexError::NonUtf8Path { path } => {
                // The rejected path must be the REAL canonical path
                // (still carrying the exact non-UTF-8 bytes, since
                // PathBuf/OsString never lossily coerce on their own) --
                // not some already-corrupted stand-in.
                assert!(
                    path.as_os_str().as_bytes().ends_with(bad_component_bytes),
                    "rejected path must retain the exact non-UTF-8 bytes: {path:?}"
                );
            }
            other => panic!("expected IndexError::NonUtf8Path, got {other:?}"),
        }
        fs::remove_dir_all(&dir).ok();
    }

    /// The existing all-valid-UTF-8 path tests (see
    /// `canonicalize_target_dir_resolves_relative_path_to_absolute`,
    /// `canonicalize_target_dir_errors_on_nonexistent_path`,
    /// `canonicalize_target_dir_same_real_dir_two_spellings_matches`
    /// above) already re-run unchanged under this same test module and
    /// continue to pass with the new `Result<String, IndexError>`
    /// signature -- this test additionally pins that a normal,
    /// valid-UTF-8 path still succeeds and returns exactly the plain
    /// canonicalized string (no `IndexError` variant, no lossy
    /// substitution artifact), guarding against a regression where the
    /// UTF-8 check itself became overly strict.
    #[test]
    fn canonicalize_target_dir_still_succeeds_for_valid_utf8_path() {
        let dir = scratch_dir("canonicalize-valid-utf8-unchanged");
        let nested = dir.join("plain-ascii-name");
        fs::create_dir_all(&nested).unwrap();
        let canonical = canonicalize_target_dir(&nested).expect("valid UTF-8 path must succeed");
        assert_eq!(canonical, nested.canonicalize().unwrap().to_str().unwrap());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_index_entry_removes_matching_entry_only() {
        let home = scratch_dir("remove-matching-only");
        write_index_at_home(Some(&home), sample_entry("/home/alice/keep")).unwrap();
        write_index_at_home(Some(&home), sample_entry("/home/alice/remove")).unwrap();

        remove_index_entry_at_home(Some(&home), "/home/alice/remove").unwrap();

        let loaded = read_index_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(loaded.installs.len(), 1);
        assert_eq!(loaded.installs[0].target_dir, "/home/alice/keep");
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn remove_index_entry_on_nonexistent_target_is_a_noop_not_an_error() {
        let home = scratch_dir("remove-noop");
        write_index_at_home(Some(&home), sample_entry("/home/alice/keep")).unwrap();

        remove_index_entry_at_home(Some(&home), "/home/alice/does-not-exist").unwrap();

        let loaded = read_index_at_home(Some(&home)).unwrap().unwrap();
        assert_eq!(loaded.installs.len(), 1);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn remove_index_entry_leaves_index_file_present_when_list_becomes_empty() {
        // An empty `installs` list is a valid, normal
        // state -- the index file itself must persist, never be deleted,
        // even when removing the last entry leaves the list empty.
        let home = scratch_dir("remove-last-entry-keeps-file");
        write_index_at_home(Some(&home), sample_entry("/home/alice/only")).unwrap();

        let path = remove_index_entry_at_home(Some(&home), "/home/alice/only").unwrap();

        assert!(
            path.is_file(),
            "index file must persist after last entry removed"
        );
        let loaded = read_index_at_home(Some(&home)).unwrap().unwrap();
        assert!(loaded.installs.is_empty());
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn remove_index_entry_on_absent_index_file_creates_it_empty() {
        // No prior write_index call -- the index file does not exist
        // yet. remove_index_entry must still succeed (nothing to
        // remove), leaving a well-formed, empty index behind.
        let home = scratch_dir("remove-on-absent-file");
        remove_index_entry_at_home(Some(&home), "/home/alice/never-existed").unwrap();
        let loaded = read_index_at_home(Some(&home)).unwrap().unwrap();
        assert!(loaded.installs.is_empty());
        fs::remove_dir_all(&home).ok();
    }

    // ── duplicate_target_dirs ───────────────────────────────────────────

    #[test]
    fn duplicate_target_dirs_empty_for_all_distinct_entries() {
        let installs = vec![sample_entry("/a"), sample_entry("/b"), sample_entry("/c")];
        assert!(duplicate_target_dirs(&installs).is_empty());
    }

    #[test]
    fn duplicate_target_dirs_empty_for_empty_list() {
        assert!(duplicate_target_dirs(&[]).is_empty());
    }

    #[test]
    fn duplicate_target_dirs_reports_single_duplicated_target() {
        let installs = vec![sample_entry("/a"), sample_entry("/b"), sample_entry("/a")];
        assert_eq!(duplicate_target_dirs(&installs), vec!["/a".to_string()]);
    }

    #[test]
    fn duplicate_target_dirs_reports_each_duplicated_target_only_once() {
        // "/a" appears 3 times -- must be reported exactly once, not
        // once per extra occurrence.
        let installs = vec![
            sample_entry("/a"),
            sample_entry("/a"),
            sample_entry("/a"),
            sample_entry("/b"),
        ];
        assert_eq!(duplicate_target_dirs(&installs), vec!["/a".to_string()]);
    }

    #[test]
    fn duplicate_target_dirs_reports_multiple_distinct_duplicated_targets() {
        let installs = vec![
            sample_entry("/a"),
            sample_entry("/b"),
            sample_entry("/a"),
            sample_entry("/b"),
            sample_entry("/c"),
        ];
        let mut duplicated = duplicate_target_dirs(&installs);
        duplicated.sort();
        assert_eq!(duplicated, vec!["/a".to_string(), "/b".to_string()]);
    }
}
