// SPDX-License-Identifier: Apache-2.0
//
// install/manifest.rs — `.konductor/manifest` read/write (Rust
// implementation).
//
// ── Scope (task 3.3) ────────────────────────────────────────────────────────
// Tracks installed files and their hashes (design doc §11 task 3.3's only
// field-level detail; no schema is given, so this is modeled on
// cli/gate-config/'s existing schema conventions -- a `schema_version`
// discriminator plus the minimal field set the task requires). Named
// `.konductor/manifest` (no `.json` suffix) per the design doc's own
// naming, used consistently across all 5 of its references.
//
// ── `files[].path` meaning ───────────────────────────────────────────────
// `destination` is the install ROOT, relative to `target_dir` (always
// `.` -- installs now span two roots under `target_dir`: `.kiro/` for
// agents and context, `.konductor/` for skills, per-agent scoping's
// requirement that skills live outside `.kiro/skills/`, which Kiro's
// native discovery scans unconditionally). Each `files[].path` is that
// installed file's path relative to `destination`, carrying its own
// content-type prefix, e.g. `.kiro/agents/k-example.json` or
// `.konductor/skills/code-review/SKILL.md` -- so the file's real on-disk
// location is `<target_dir>/<files[i].path>` (destination is `.`, so it
// contributes no additional path segment).
//
// ── Where `target_dir` itself is recorded ─────────────────────────────────
// No field stores `target_dir`'s absolute path. The manifest already
// lives at `<target_dir>/.konductor/manifest`, so `target_dir` is
// exactly the manifest file's own grandparent directory -- a future
// `update`/`uninstall` locates the tree it owns by finding the manifest
// (e.g. `$HOME/.konductor/manifest` or `<--target dir>/.konductor/manifest`),
// never by reading a path field out of it. This avoids baking a
// machine-specific absolute path into the document (which would make a
// fixture produced on one machine fail to match on another) while still
// making the destination unambiguous: a manifest's location on disk IS
// its target_dir, by construction, not by convention that could drift.
//
// ── Deterministic bytes ─────────────────────────────────────────────────
// `files` is sorted by `path` before serialization so byte output is
// deterministic regardless of install order. JSON is rendered via
// `serde_json::to_string_pretty` (2-space indent, default separators),
// with a trailing newline appended.
//
// ── Write-ahead status (defect 1: orphaned files with no manifest) ───────
// Install used to copy every file THEN write the manifest last, so a
// crash/failure at the final step left every copied file on disk with NO
// manifest at all -- invisible and unremovable by a future `uninstall`.
// `status` closes this: the manifest is now written ONCE up front, before
// any file is copied, as `Status::InProgress` naming every path this
// install intends to touch, then rewritten as `Status::Complete` (with
// real hashes) only after every file has actually been copied. A crash in
// between always leaves a manifest naming exactly what may be on disk --
// the orphans become recoverable instead of invisible.
//
// `ManifestFile.sha256` is therefore `Option<String>`: the pre-copy
// record cannot know a file's real hash before it exists (and, for agent
// JSON, the hash depends on the install root -- `skill://`/`file://`
// entries are rewritten to absolute paths as part of the copy, so the
// bytes on disk differ per install target). Represented as an explicit
// JSON `null`, not an omitted key -- an omitted key would make
// `serde_json`'s default-derive behavior and `json.dumps`'s
// key-presence semantics two more places the two languages could drift
// out of byte-identical lockstep; an explicit `null` is unambiguous and
// identical to serialize in both.
//
// ── Per-file provenance (defect 2: hash-mismatching manifest after a
// failed re-install) ──────────────────────────────────────────────────────
// Before writing pre-copy record - Not just after a failed re-install:
// EVERY file this install is about to touch is classified into exactly
// one of three states below, determined by stat-ing the destination and
// consulting any prior manifest -- BEFORE that file is copied, so the
// classification can go in the write-ahead (`InProgress`) record too. A
// failed re-install with the OLD code left the previous manifest
// byte-identical while disk had already changed (one real file
// hash-mismatched in a measured run); the new pre-copy write means every
// re-install (failed or not) starts by overwriting the prior manifest
// with a fresh, current record naming what disk is ABOUT to become, so
// there is never a stale manifest sitting next to changed disk content.
//
// This provenance is also the future data an `uninstall` needs to be
// safe: it must delete only `Created`/`ReplacedOurs` paths (this install
// owns them), and must NEVER delete a `ReplacedForeign` path (pre-existing
// user content this install happened to overwrite) -- restoring the
// clobbered content is explicitly out of scope; this only records enough
// to make the deletion decision safely, not to undo the overwrite.
//
// ── `source` (doctor's manifest-based resolution) ─────────────────────
// Records the absolute, canonicalized `--from <repo-root>` path this
// install run was given (`None` if the caller has none to record).
// `konductor doctor`'s `check_source`/`check_config` resolve against
// this field by default, instead of `--from`/cwd -- see doctor.rs's
// module docstring for the full precedence rule. `#[serde(default)]`
// on read, so a manifest written before this field existed still
// deserializes (`source: None`), same back-compat pattern as
// `status`/`provenance` above.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::cli::atomic_write::write_atomic;
use crate::cli::config::KONDUCTOR_DIR_NAME;
use crate::cli::config_lock;

/// Manifest document schema version. Bump when the shape changes
/// incompatibly. `1` was the flat, single-strategy shape (`strategy`,
/// `installed_at`, `destination`, `source`, `status`, `files` all at
/// the top level -- see `LegacyManifestV1` below); `2` generalizes to
/// `strategies: Vec<StrategyManifest>`, one entry per currently-tracked
/// strategy. `read_manifest` recognizes both on read.
pub(crate) const SCHEMA_VERSION: u64 = 2;

/// Strategies that write to the exact same destination paths by
/// construction (`kiro_cli_v3.rs` calls V2's `plan_all_files`/
/// `install_context`/`install_skills`/`install_sops`/`list_agent_files`
/// verbatim; see that module's doc comment for the full rationale).
/// Because only one family member can meaningfully occupy a target at a
/// time, installing one while the other is tracked overrides it (warn,
/// then overwrite -- `upsert_strategy` below), never an
/// insert-alongside. Every other registered strategy (`claude`, and any
/// future harness with its own destination root) coexists independently.
pub(crate) const KIRO_VARIANT_FAMILY: &[&str] = &["kiro-cli-v2", "kiro-v3"];

/// The override-selection decision `upsert_strategy` makes when
/// `incoming` is about to occupy a slot: if `incoming` is a
/// `KIRO_VARIANT_FAMILY` member and `strategies` already tracks the
/// other family member, returns that other member's name -- the slot
/// an override-on-switch install must remove. `None` otherwise.
///
/// Shared by `install.rs`'s write-ahead projection
/// (`projected_strategy_names`) and `upsert_strategy` so the selection
/// rule can't drift between the two call sites.
pub(crate) fn other_kiro_variant_tracked(
    strategies: &[StrategyManifest],
    incoming: &str,
) -> Option<String> {
    if !KIRO_VARIANT_FAMILY.contains(&incoming) {
        return None;
    }
    strategies
        .iter()
        .find(|s| KIRO_VARIANT_FAMILY.contains(&s.strategy.as_str()) && s.strategy != incoming)
        .map(|s| s.strategy.clone())
}

/// File name within `KONDUCTOR_DIR_NAME`. No `.json` suffix -- see
/// module docstring.
pub(crate) const MANIFEST_FILE_NAME: &str = "manifest";

/// Dedicated lock file name for `upsert_strategy`'s read-modify-write
/// critical section -- distinct from `config set`'s `.config.lock` and
/// `bin_link.rs`'s `.bin-links.lock`, so this critical section never
/// contends with an unrelated one.
const MANIFEST_LOCK_FILE_NAME: &str = ".manifest.lock";

/// Whether an install run has finished copying every file it intends to
/// write. `InProgress` is written before any file is copied (the
/// write-ahead record); `Complete` only after every file has actually
/// been copied. Defaults to `Complete` when a manifest predating this
/// field is read back, since a pre-write-ahead manifest was only ever
/// written on full success.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    InProgress,
    #[default]
    Complete,
}

/// Which of three states produced a given installed file, determined by
/// stat-ing the destination and consulting any prior manifest before
/// that file is copied:
/// - `Created`: nothing was at this path before this install.
/// - `ReplacedOurs`: a previous Konductor install had already written
///   this exact path -- this install replaced its own prior content.
/// - `ReplacedForeign`: pre-existing content this install did not
///   create, now overwritten. `uninstall` must never delete a path in
///   this state.
///
/// Defaults to `ReplacedForeign` when a manifest predating this field is
/// read back -- the conservative choice, since deleting an unknown
/// path is worse than leaving one behind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    Created,
    ReplacedOurs,
    #[default]
    ReplacedForeign,
}

/// One installed file's tracked path, content hash, and provenance.
/// `sha256` is `None` in the pre-copy (`Status::InProgress`) record,
/// since the content doesn't exist yet; always `Some` once the
/// manifest is rewritten `Status::Complete`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    pub sha256: Option<String>,
    #[serde(default)]
    pub provenance: Provenance,
}

/// `.konductor/manifest`'s in-memory shape: a schema discriminator plus
/// a list of per-strategy slots, one entry per strategy currently
/// tracked at this target. Most targets carry exactly one slot; a
/// target can carry two when a Kiro variant and `claude` are both
/// installed there, since they share no destination path. No path is
/// ever legitimately named by two slots' `files` lists at once, so
/// `classify_provenance` only ever consults one slot's own prior list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: u64,
    pub strategies: Vec<StrategyManifest>,
}

impl Manifest {
    /// An empty manifest at the current `SCHEMA_VERSION` -- the starting
    /// point for a target with no prior manifest at all.
    pub fn empty() -> Self {
        Manifest {
            schema_version: SCHEMA_VERSION,
            strategies: Vec::new(),
        }
    }

    /// The tracked slot for `strategy_name`, if any.
    pub fn get(&self, strategy_name: &str) -> Option<&StrategyManifest> {
        self.strategies.iter().find(|s| s.strategy == strategy_name)
    }

    /// Mutable variant of `get`, for patching one field on an
    /// already-tracked slot in place (e.g. `install::remote`'s
    /// post-install `source` rewrite) without reconstructing it via
    /// `upsert`.
    pub fn get_mut(&mut self, strategy_name: &str) -> Option<&mut StrategyManifest> {
        self.strategies
            .iter_mut()
            .find(|s| s.strategy == strategy_name)
    }

    /// Every currently-tracked strategy's name, in list order (not
    /// sorted -- callers that need a stable display order sort it
    /// themselves).
    pub fn strategy_names(&self) -> Vec<&str> {
        self.strategies
            .iter()
            .map(|s| s.strategy.as_str())
            .collect()
    }

    /// Replaces the slot with the same `strategy` name as `slot` (if
    /// present) or appends it (if absent) -- one entry per distinct
    /// strategy name, always.
    pub fn upsert(&mut self, slot: StrategyManifest) {
        match self
            .strategies
            .iter_mut()
            .find(|s| s.strategy == slot.strategy)
        {
            Some(existing) => *existing = slot,
            None => self.strategies.push(slot),
        }
    }

    /// Removes and returns the slot named `strategy_name`, if present.
    pub fn remove(&mut self, strategy_name: &str) -> Option<StrategyManifest> {
        let index = self
            .strategies
            .iter()
            .position(|s| s.strategy == strategy_name)?;
        Some(self.strategies.remove(index))
    }
}

/// One tracked strategy's install record: which strategy performed the
/// install, when, where (`destination`, relative to `target_dir`), the
/// source tree `--from` pointed at (`source`), whether the run finished
/// (`status`), and which files (with hashes and provenance, relative to
/// `destination`) it wrote or intends to write. One of possibly several
/// entries in `Manifest::strategies`, keyed by `strategy`, with no
/// cross-slot ownership state.
///
/// `source` is the absolute, canonicalized `--from <repo-root>` path
/// `install_from_local` was given -- the source tree, not `destination`
/// (the install root). `konductor doctor`'s `check_source`/`check_config`
/// resolve against this field by default, so they validate the tree
/// that was actually installed rather than whatever `--from`/cwd is at
/// doctor time. `Option` because `install_from_local` takes `from:
/// Option<&str>`, and because `#[serde(default)]` lets a manifest
/// predating the field deserialize as `None`; `doctor` then falls back
/// to `--from`/cwd with an explicit note.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StrategyManifest {
    pub strategy: String,
    pub installed_at: String,
    pub destination: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub status: Status,
    pub files: Vec<ManifestFile>,
}

impl StrategyManifest {
    /// Builds a `StrategyManifest`. `source` is the absolute,
    /// canonicalized `--from <repo-root>` path this install run was
    /// given (`None` only if the caller has none to record).
    pub fn new(
        strategy: impl Into<String>,
        installed_at: impl Into<String>,
        destination: impl Into<String>,
        source: Option<String>,
        status: Status,
        files: Vec<ManifestFile>,
    ) -> Self {
        StrategyManifest {
            strategy: strategy.into(),
            installed_at: installed_at.into(),
            destination: destination.into(),
            source,
            status,
            files,
        }
    }
}

/// Maps a strategy name from a genuine v1-era manifest or index -- one
/// written before the harness/strategy name unification -- to the
/// current registered name. A legacy document fed through
/// `LegacyManifestV1`/`index.rs`'s `LegacyIndexV1` must have its
/// `strategy` value translated here before it becomes a
/// `StrategyManifest`/`IndexEntry` slot, or the migrated slot matches no
/// registered strategy, breaking `update` and an explicit `--harness
/// <old-name>`.
///
/// A name that is already current passes through unchanged, so this is
/// safe to call unconditionally on every legacy `strategy` value.
pub(crate) fn legacy_strategy_name_to_current(name: &str) -> String {
    match name {
        "kiro-cli" => "kiro-cli-v2",
        "kiro-cli-v3" => "kiro-v3",
        "claude-code" => "claude",
        other => return other.to_string(),
    }
    .to_string()
}

/// `SCHEMA_VERSION`'s predecessor shape (v1): a flat document with no
/// `strategies` list, one strategy per manifest. Used only by
/// `read_manifest`'s migration path to deserialize an old on-disk
/// manifest before repackaging it as a single-entry
/// `Manifest::strategies` list -- never written.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct LegacyManifestV1 {
    pub strategy: String,
    pub installed_at: String,
    pub destination: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub status: Status,
    pub files: Vec<ManifestFile>,
}

impl From<LegacyManifestV1> for Manifest {
    fn from(legacy: LegacyManifestV1) -> Self {
        Manifest {
            schema_version: SCHEMA_VERSION,
            strategies: vec![StrategyManifest {
                strategy: legacy_strategy_name_to_current(&legacy.strategy),
                installed_at: legacy.installed_at,
                destination: legacy.destination,
                source: legacy.source,
                status: legacy.status,
                files: legacy.files,
            }],
        }
    }
}

/// Resolves which slot's own prior `files` list `classify_provenance`
/// should consult when `strategy_name` is about to (re)install at a
/// target whose current manifest is `manifest`:
///
/// - `strategy_name` already has its own tracked slot -> that slot (the
///   ordinary reinstall/update case).
/// - `strategy_name` is a `KIRO_VARIANT_FAMILY` member and the other
///   family member is tracked instead -> that other slot. Both Kiro
///   variants write every destination path identically, so an
///   override-on-switch install takes over the paths the prior variant
///   owned; treating that slot as this install's "prior" lets the new
///   slot record those paths as `ReplacedOurs` (removable by a later
///   `uninstall`) rather than `ReplacedForeign` (which `uninstall`
///   refuses to delete).
/// - Neither -> `None` (a fresh install; every file classifies as
///   `Created`).
pub fn effective_prior_slot<'a>(
    manifest: &'a Manifest,
    strategy_name: &str,
) -> Option<&'a StrategyManifest> {
    if let Some(slot) = manifest.get(strategy_name) {
        return Some(slot);
    }
    other_kiro_variant_tracked(&manifest.strategies, strategy_name)
        .and_then(|name| manifest.get(&name))
}

/// Reads the manifest at `target_dir` (or an empty one if none exists),
/// applies `slot`, and writes the result back. Returns the merged
/// `Manifest` that was written.
///
/// - `slot.strategy` is a `KIRO_VARIANT_FAMILY` member and the other
///   family member is currently tracked: prints a non-blocking warning
///   to stderr, then removes the other member's slot before upserting
///   `slot` -- override-on-switch, never an insert-alongside. Calling
///   this again for the same `slot` (e.g. the write-ahead call, then
///   the complete call for one install run) finds no other family
///   member left the second time, so the warning never prints twice.
/// - Otherwise: `slot` replaces its own same-named slot, or is inserted
///   alongside every other slot untouched.
///
/// Locked for the entire read-modify-write cycle: `write_atomic`'s
/// crash-safety covers only the write, not the read-merge-write cycle
/// around it. Two concurrent installs to different strategies at the
/// same target would otherwise each read a manifest missing the
/// other's slot, and whichever write lands last would silently drop it
/// -- both processes still exit 0. Uses the same locking primitive
/// `config set` and `bin_link.rs`'s sidecar already use for this class
/// of race.
pub fn upsert_strategy(
    target_dir: &Path,
    slot: StrategyManifest,
) -> Result<Manifest, ManifestError> {
    let konductor_dir = target_dir.join(KONDUCTOR_DIR_NAME);
    let _lock = config_lock::acquire_named(&konductor_dir, MANIFEST_LOCK_FILE_NAME)?;

    let mut manifest = read_manifest(target_dir)?.unwrap_or_else(Manifest::empty);
    if let Some(other_name) = other_kiro_variant_tracked(&manifest.strategies, &slot.strategy) {
        eprintln!(
            "warning: {} is currently installed with '{other_name}'; switching to '{}' will overwrite its files.",
            target_dir.display(),
            slot.strategy,
        );
        manifest.remove(&other_name);
    }
    manifest.upsert(slot);
    write_manifest(target_dir, &manifest)?;
    Ok(manifest)
}

/// What a fresh, LOCKED re-read found immediately before
/// `remove_strategy_locked` acted on it.
#[derive(Debug)]
pub struct RemovedStrategyOutcome {
    /// The slot removed, or `None` if `strategy_name` was `None`, or
    /// was `Some` but not tracked in the fresh read (e.g. a concurrent
    /// uninstall of the same strategy already removed it). No
    /// production caller reads this back today; kept because it is
    /// exactly what a caller would need to detect a racing uninstall.
    #[allow(dead_code)]
    pub removed: Option<StrategyManifest>,
    /// `true` if no strategy remained tracked at this target after
    /// removal -- the manifest file was deleted rather than written
    /// back empty. `false` means `write_manifest` ran instead, with at
    /// least one other strategy still tracked on disk.
    pub target_fully_removed: bool,
}

/// Removes `strategy_name`'s slot (if given) from the manifest at
/// `target_dir`, then either deletes the manifest file (nothing left)
/// or writes back the survivors -- under the same per-target manifest
/// lock `upsert_strategy` uses, so a concurrent `install --harness
/// <other>` at the same target can never have its already-committed
/// slot silently discarded by an uninstall computing "is anything
/// left?" from a stale, unlocked snapshot.
///
/// Re-reads the manifest fresh here, under the lock -- a caller's own
/// earlier unlocked read (needed to drive an interactive
/// harness-selection prompt) must never be reused for the "is anything
/// else left?" decision. `strategy_name: None` covers
/// `uninstall.rs`'s already-empty-strategies-list case: nothing is
/// removed by name, but the delete-vs-rewrite decision is still
/// re-evaluated against a fresh read, since a concurrent `install`
/// could have added a slot since the caller's own unlocked read.
///
/// Returns `Ok(None)` if no manifest exists at `target_dir` in the
/// fresh read; otherwise `Ok(Some(RemovedStrategyOutcome))`.
pub fn remove_strategy_locked(
    target_dir: &Path,
    strategy_name: Option<&str>,
) -> Result<Option<RemovedStrategyOutcome>, ManifestError> {
    let konductor_dir = target_dir.join(KONDUCTOR_DIR_NAME);
    let _lock = config_lock::acquire_named(&konductor_dir, MANIFEST_LOCK_FILE_NAME)?;

    let mut manifest = match read_manifest(target_dir)? {
        None => return Ok(None),
        Some(m) => m,
    };

    let removed = strategy_name.and_then(|name| manifest.remove(name));

    let target_fully_removed = manifest.strategies.is_empty();
    if target_fully_removed {
        remove_manifest_file(target_dir)?;
    } else {
        write_manifest(target_dir, &manifest)?;
    }

    Ok(Some(RemovedStrategyOutcome {
        removed,
        target_fully_removed,
    }))
}

/// Same critical section as `remove_strategy_locked` above, but lets the
/// caller act on `strategy_name`'s freshly-read slot -- e.g. deleting
/// its on-disk files -- from inside the lock, before the slot is
/// removed and the manifest file is finalized.
///
/// Closes a race `remove_strategy_locked` alone cannot: a caller that
/// reads a slot unlocked, deletes its files, and only then calls
/// `remove_strategy_locked` is acting on a snapshot a concurrent
/// `install --harness <other>` can invalidate in the gap -- e.g. by
/// committing a new slot at the same destination paths (`KIRO_VARIANT_
/// FAMILY` members write identical paths by construction) after the
/// caller's unlocked read but before its delete runs. `before_remove`
/// is invoked here against the fresh, re-read slot, still under the
/// lock, so it only ever sees -- and only ever gets a chance to
/// delete -- whatever is genuinely tracked at the instant the lock is
/// held.
///
/// Unlike `remove_strategy_locked`, `strategy_name` must name a real
/// strategy -- a caller with nothing to delete (e.g. `uninstall.rs`'s
/// already-empty-strategies-list case) should call
/// `remove_strategy_locked` directly.
///
/// If the fresh, locked read no longer tracks `strategy_name` -- a
/// concurrent writer already replaced or removed it -- `before_remove`
/// is not invoked, and this returns `Ok(None)`: nothing this caller
/// could still legitimately delete remains tracked.
pub fn delete_and_remove_strategy_locked(
    target_dir: &Path,
    strategy_name: &str,
    before_remove: impl FnOnce(&StrategyManifest) -> Result<(), String>,
) -> Result<Option<RemovedStrategyOutcome>, ManifestError> {
    let konductor_dir = target_dir.join(KONDUCTOR_DIR_NAME);
    let _lock = config_lock::acquire_named(&konductor_dir, MANIFEST_LOCK_FILE_NAME)?;

    let mut manifest = match read_manifest(target_dir)? {
        None => return Ok(None),
        Some(m) => m,
    };

    let Some(slot) = manifest.get(strategy_name) else {
        return Ok(None);
    };
    before_remove(slot).map_err(ManifestError::DeleteFailed)?;

    let removed = manifest.remove(strategy_name);
    let target_fully_removed = manifest.strategies.is_empty();
    if target_fully_removed {
        remove_manifest_file(target_dir)?;
    } else {
        write_manifest(target_dir, &manifest)?;
    }

    Ok(Some(RemovedStrategyOutcome {
        removed,
        target_fully_removed,
    }))
}

/// Deletes `<target_dir>/.konductor/manifest` if present; a no-op
/// otherwise. Called only from inside `remove_strategy_locked`'s or
/// `delete_and_remove_strategy_locked`'s locked critical section --
/// never call this directly against a target another process could be
/// concurrently installing into.
fn remove_manifest_file(target_dir: &Path) -> Result<(), ManifestError> {
    let path = manifest_path(target_dir);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|source| ManifestError::WriteFailed {
            path: path.clone(),
            source,
        })?;
    }
    Ok(())
}

/// Best-effort: rewrites a single field on the slot named
/// `strategy_name` in the manifest at `target_dir`, under the same
/// per-target lock `upsert_strategy` uses -- closing the same
/// unlocked-read-modify-write race in `install::remote`'s post-install
/// `source` rewrite.
///
/// Returns `Ok(false)` (having touched nothing) if no manifest exists,
/// or `strategy_name` is not tracked in the fresh, locked read -- both
/// non-fatal; the caller decides what to report for either case.
pub fn update_strategy_field_locked(
    target_dir: &Path,
    strategy_name: &str,
    mutate: impl FnOnce(&mut StrategyManifest),
) -> Result<bool, ManifestError> {
    let konductor_dir = target_dir.join(KONDUCTOR_DIR_NAME);
    let _lock = config_lock::acquire_named(&konductor_dir, MANIFEST_LOCK_FILE_NAME)?;

    let mut manifest = match read_manifest(target_dir)? {
        None => return Ok(false),
        Some(m) => m,
    };

    let Some(slot) = manifest.get_mut(strategy_name) else {
        return Ok(false);
    };
    mutate(slot);

    write_manifest(target_dir, &manifest)?;
    Ok(true)
}

/// All the ways reading/writing a manifest can fail. Every variant
/// except `UnsupportedSchemaVersion` is a usage error from the CLI's
/// perspective -- callers must map those to `EXIT_USAGE_ERROR` (64),
/// never exit code 2. `UnsupportedSchemaVersion` is a state/verification
/// failure and maps to `EXIT_VERIFY_FAILED` (65) instead.
// `read_manifest` has no production caller yet; `ReadFailed`/`Malformed`
// are constructed there and covered by `read_rejects_malformed_json`.
#[derive(Debug)]
#[allow(dead_code)]
pub enum ManifestError {
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
    /// `upsert_strategy` could not acquire (or was contended for) the
    /// per-target manifest lock. A usage error, same as every other
    /// variant except `UnsupportedSchemaVersion` -- the manifest itself
    /// is not at fault; the caller should retry once the contending
    /// process finishes.
    Lock(config_lock::ConfigLockError),
    /// The caller-supplied step `delete_and_remove_strategy_locked`
    /// invokes against the freshly-read slot (e.g. `uninstall.rs`'s
    /// `delete_eligible_files`) failed. Carries the message already
    /// formatted by the caller rather than a structured payload, since
    /// the only caller today already returns `Result<(), String>`.
    DeleteFailed(String),
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ManifestError::CreateDirFailed { path, source } => {
                write!(f, "could not create {}: {source}", path.display())
            }
            ManifestError::WriteFailed { path, source } => {
                write!(f, "could not write {}: {source}", path.display())
            }
            ManifestError::ReadFailed { path, source } => {
                write!(f, "could not read {}: {source}", path.display())
            }
            ManifestError::Malformed { path, source } => {
                write!(f, "{} is not valid JSON: {source}", path.display())
            }
            ManifestError::UnsupportedSchemaVersion {
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
            ManifestError::Lock(err) => write!(f, "{err}"),
            ManifestError::DeleteFailed(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for ManifestError {}

impl From<config_lock::ConfigLockError> for ManifestError {
    fn from(err: config_lock::ConfigLockError) -> Self {
        ManifestError::Lock(err)
    }
}

/// `<target_dir>/.konductor/manifest`. Single source of truth for this
/// path, mirroring config.rs's `KONDUCTOR_DIR_NAME` convention.
pub fn manifest_path(target_dir: &Path) -> PathBuf {
    target_dir.join(KONDUCTOR_DIR_NAME).join(MANIFEST_FILE_NAME)
}

/// Classifies `destination_path`'s provenance BEFORE it is written, by
/// stat-ing it and consulting `prior_manifest` (the target's manifest as
/// it existed before this install run, or `None` if there wasn't one).
/// `manifest_relative_path` must match the `ManifestFile.path` form a
/// prior manifest would have recorded for this same file (i.e. already
/// prefixed with its `.kiro/`/`.konductor/` content-type root).
///
/// - Nothing at `destination_path` -> `Created`.
/// - Something at `destination_path`, AND `manifest_relative_path` is
///   present in `prior_manifest.files` -> `ReplacedOurs` (a previous
///   Konductor install owned this exact path).
/// - Something at `destination_path`, but `manifest_relative_path` is
///   NOT in `prior_manifest.files` (including when there was no prior
///   manifest at all) -> `ReplacedForeign`.
pub fn classify_provenance(
    destination_path: &Path,
    manifest_relative_path: &str,
    prior_manifest: Option<&StrategyManifest>,
) -> Provenance {
    // `symlink_metadata` (never `exists`/`metadata`, both of which
    // follow symlinks): a DANGLING symlink -- one whose target does
    // not exist -- is still something physically present at
    // `destination_path`, but `Path::exists()` follows the link and
    // reports `false` for it, which would misclassify a live symlink
    // as `Created` (nothing was here before) when in fact something
    // was. `symlink_metadata` succeeds for a symlink regardless of
    // whether its target resolves, so a dangling link is correctly
    // treated as "something is here" the same as a live link or a
    // regular file.
    if std::fs::symlink_metadata(destination_path).is_err() {
        return Provenance::Created;
    }
    let owned_by_prior = prior_manifest
        .map(|m| m.files.iter().any(|f| f.path == manifest_relative_path))
        .unwrap_or(false);
    if owned_by_prior {
        Provenance::ReplacedOurs
    } else {
        Provenance::ReplacedForeign
    }
}

/// Renders `manifest` as deterministic, pretty-printed JSON bytes:
/// `strategies` sorted by strategy name, each slot's `files` sorted by
/// path, 2-space indent (via `serde_json::to_string_pretty`), trailing
/// newline, UTF-8.
fn serialize(manifest: &Manifest) -> Result<Vec<u8>, serde_json::Error> {
    let mut sorted = manifest.clone();
    sorted
        .strategies
        .sort_by(|a, b| a.strategy.cmp(&b.strategy));
    for slot in &mut sorted.strategies {
        slot.files.sort_by(|a, b| a.path.cmp(&b.path));
    }
    let mut rendered = serde_json::to_string_pretty(&sorted)?;
    rendered.push('\n');
    Ok(rendered.into_bytes())
}

/// Writes `manifest` to `<target_dir>/.konductor/manifest` atomically via
/// `write_atomic` (never a direct `fs::write` -- see atomic_write.rs's
/// module docstring for the crash-safety rationale). Returns the path
/// written.
pub fn write_manifest(target_dir: &Path, manifest: &Manifest) -> Result<PathBuf, ManifestError> {
    let path = manifest_path(target_dir);
    let parent = path.parent().expect("manifest path always has a parent");
    std::fs::create_dir_all(parent).map_err(|source| ManifestError::CreateDirFailed {
        path: parent.to_path_buf(),
        source,
    })?;

    let bytes = serialize(manifest).expect("Manifest must always serialize");
    write_atomic(&path, &bytes).map_err(|source| ManifestError::WriteFailed {
        path: path.clone(),
        source,
    })?;
    Ok(path)
}

/// Reads `<target_dir>/.konductor/manifest`, or `Ok(None)` if it does
/// not exist. Returns `Err` if it exists but is not valid JSON or does
/// not match the expected shape. Checks `schema_version` before
/// deserializing into the concrete struct, so an unsupported version is
/// always reported as `UnsupportedSchemaVersion` rather than whatever
/// deserialization error a shape change happens to produce.
///
/// Migration: a v1 manifest (the flat, single-strategy shape) is
/// recognized by its `schema_version: 1`, deserialized as
/// `LegacyManifestV1`, then repackaged in memory as a `Manifest` whose
/// `strategies` holds that one slot -- a lazy, read-triggered upgrade
/// with no on-disk rewrite here; the next `upsert_strategy`/
/// `write_manifest` for this target writes it back at the current
/// `SCHEMA_VERSION`. Any other unrecognized version is
/// `UnsupportedSchemaVersion`.
///
/// No `is_file()` pre-check: this function has several unlocked
/// production callers (e.g. `kiro_cli_v3.rs`'s `full_prior_manifest`
/// provenance read, taken before `upsert_strategy`'s locked section
/// starts) that can race a concurrent `uninstall` deleting the manifest
/// via `remove_strategy_locked` between a check and a read -- which
/// would surface as a spurious `ReadFailed` instead of this function's
/// documented `Ok(None)` for "does not exist". Reading directly and
/// mapping `ErrorKind::NotFound` to `Ok(None)` leaves no such gap.
pub fn read_manifest(target_dir: &Path) -> Result<Option<Manifest>, ManifestError> {
    let path = manifest_path(target_dir);
    let contents = match std::fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(source) if source.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(ManifestError::ReadFailed { path, source }),
    };
    let raw: serde_json::Value =
        serde_json::from_str(&contents).map_err(|source| ManifestError::Malformed {
            path: path.clone(),
            source,
        })?;
    // `as_i64` (not `as_u64`) so a negative schema_version is still
    // recognized as "a number was found" rather than falling through to
    // a generic Malformed. Not sufficient alone: a u64 above i64::MAX
    // also makes as_i64 return None, which would otherwise fall through
    // to the same "no numeric version" path as a missing field and be
    // wrongly accepted. The post-deserialize re-check below closes that
    // gap using the real u64 field.
    let found_version = raw
        .get("schema_version")
        .and_then(serde_json::Value::as_i64);
    if found_version == Some(1) {
        let legacy: LegacyManifestV1 =
            serde_json::from_str(&contents).map_err(|source| ManifestError::Malformed {
                path: path.clone(),
                source,
            })?;
        return Ok(Some(Manifest::from(legacy)));
    }
    if found_version != Some(SCHEMA_VERSION as i64) {
        if let Some(found) = found_version {
            return Err(ManifestError::UnsupportedSchemaVersion {
                path,
                found,
                supported: SCHEMA_VERSION,
            });
        }
        // No numeric schema_version at all -- fall through to a normal
        // deserialize so the missing/malformed field is reported the
        // same way as any other shape error.
    }
    let manifest: Manifest =
        serde_json::from_str(&contents).map_err(|source| ManifestError::Malformed {
            path: path.clone(),
            source,
        })?;
    // Post-deserialize catch-all: schema_version is a real u64 here, so
    // this catches a legal value above i64::MAX that the pre-check
    // above couldn't represent (found_version = None) and let through.
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(ManifestError::UnsupportedSchemaVersion {
            path,
            // found_version is None only for the u64-overflow case this
            // catch-all exists for; report i64::MAX as the closest
            // representable stand-in.
            found: found_version.unwrap_or(i64::MAX),
            supported: SCHEMA_VERSION,
        });
    }
    Ok(Some(manifest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-manifest-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Builds a `Manifest` with exactly one strategy slot -- the shape
    /// most tests in this module need, since they exercise a single
    /// strategy's own read/write/serialization behavior, not the
    /// multi-strategy list itself (see the `upsert_strategy`/
    /// `effective_prior_slot`/coexistence tests below for that).
    fn single_strategy_manifest(
        strategy: impl Into<String>,
        installed_at: impl Into<String>,
        destination: impl Into<String>,
        source: Option<String>,
        status: Status,
        files: Vec<ManifestFile>,
    ) -> Manifest {
        Manifest {
            schema_version: SCHEMA_VERSION,
            strategies: vec![StrategyManifest::new(
                strategy,
                installed_at,
                destination,
                source,
                status,
                files,
            )],
        }
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = scratch_dir("round-trip");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".kiro/agents",
            None,
            Status::Complete,
            vec![ManifestFile {
                path: "dist.tar.gz".to_string(),
                sha256: Some("a".repeat(64)),
                provenance: Provenance::Created,
            }],
        );
        write_manifest(&dir, &manifest).expect("write must succeed");
        let loaded = read_manifest(&dir).expect("read must succeed");
        assert_eq!(loaded, Some(manifest));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_returns_none_when_absent() {
        let dir = scratch_dir("absent");
        assert_eq!(read_manifest(&dir).unwrap(), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_rejects_malformed_json() {
        let dir = scratch_dir("malformed");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"not json").unwrap();
        let err = read_manifest(&dir).expect_err("malformed JSON must be rejected");
        assert!(matches!(err, ManifestError::Malformed { .. }));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_accepts_valid_schema_version() {
        let dir = scratch_dir("schema-valid");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".kiro/agents",
            None,
            Status::Complete,
            vec![],
        );
        write_manifest(&dir, &manifest).unwrap();
        assert_eq!(read_manifest(&dir).unwrap(), Some(manifest));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_rejects_unknown_schema_version() {
        let dir = scratch_dir("schema-unknown");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"schema_version":99,"strategies":[]}"#).unwrap();
        let err = read_manifest(&dir).expect_err("unknown schema_version must be rejected");
        match err {
            ManifestError::UnsupportedSchemaVersion {
                found, supported, ..
            } => {
                assert_eq!(found, 99);
                assert_eq!(supported, SCHEMA_VERSION);
            }
            other => panic!("expected UnsupportedSchemaVersion, got {other:?}"),
        }
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_rejects_missing_or_non_numeric_schema_version() {
        let dir = scratch_dir("schema-missing");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"strategies":[]}"#).unwrap();
        let err = read_manifest(&dir).expect_err("missing schema_version must be rejected");
        assert!(matches!(err, ManifestError::Malformed { .. }));

        let path2 = manifest_path(&dir);
        fs::write(&path2, br#"{"schema_version":"abc","strategies":[]}"#).unwrap();
        let err = read_manifest(&dir).expect_err("non-numeric schema_version must be rejected");
        assert!(matches!(err, ManifestError::Malformed { .. }));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_rejects_negative_schema_version_as_unsupported_not_malformed() {
        // `-1` is a "found" schema_version, so it raises
        // `UnsupportedSchemaVersion`, not a generic malformed error.
        // `as_i64` (not `as_u64`) must treat -1 as "found" here too.
        let dir = scratch_dir("schema-negative");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"schema_version":-1,"strategies":[]}"#).unwrap();
        let err = read_manifest(&dir).expect_err("negative schema_version must be rejected");
        match err {
            ManifestError::UnsupportedSchemaVersion {
                found, supported, ..
            } => {
                assert_eq!(found, -1);
                assert_eq!(supported, SCHEMA_VERSION);
            }
            other => panic!("expected UnsupportedSchemaVersion, got {other:?}"),
        }
        fs::remove_dir_all(&dir).ok();
    }

    /// A `schema_version` that is a legal `u64` but exceeds `i64::MAX`
    /// (e.g. `18446744073709551615` == `u64::MAX`) must still be
    /// rejected as `UnsupportedSchemaVersion`, not silently accepted.
    /// The pre-deserialize `as_i64` check alone cannot see this: it
    /// returns `None` for a value that doesn't fit in `i64`, which is
    /// indistinguishable from a missing/non-numeric field at that
    /// point -- only the post-deserialize re-check against the real
    /// `u64` field (`Manifest.schema_version`) catches it.
    #[test]
    fn read_rejects_u64_schema_version_above_i64_max_as_unsupported_not_accepted() {
        let dir = scratch_dir("schema-u64-overflow-max");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":18446744073709551615,"strategies":[]}"#,
        )
        .unwrap();
        let err =
            read_manifest(&dir).expect_err("u64 schema_version above i64::MAX must be rejected");
        match err {
            ManifestError::UnsupportedSchemaVersion { supported, .. } => {
                assert_eq!(supported, SCHEMA_VERSION);
            }
            other => panic!("expected UnsupportedSchemaVersion, got {other:?}"),
        }
        fs::remove_dir_all(&dir).ok();
    }

    /// Same gap, using `i64::MAX + 1` (the smallest `u64` that does not
    /// fit in `i64`) rather than `u64::MAX` -- confirms the boundary
    /// itself is caught, not just the extreme value.
    #[test]
    fn read_rejects_u64_schema_version_just_above_i64_max_as_unsupported() {
        let dir = scratch_dir("schema-u64-overflow-boundary");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":9223372036854775808,"strategies":[]}"#,
        )
        .unwrap();
        let err =
            read_manifest(&dir).expect_err("u64 schema_version of i64::MAX + 1 must be rejected");
        assert!(matches!(
            err,
            ManifestError::UnsupportedSchemaVersion { .. }
        ));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn manifest_file_name_has_no_json_suffix() {
        let dir = scratch_dir("no-json-suffix");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".kiro/agents",
            None,
            Status::Complete,
            vec![],
        );
        let path = write_manifest(&dir, &manifest).unwrap();
        assert_eq!(path.file_name().unwrap(), "manifest");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_sorts_files_by_path() {
        let dir = scratch_dir("sorted");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".kiro/agents",
            None,
            Status::Complete,
            vec![
                ManifestFile {
                    path: "z.txt".to_string(),
                    sha256: Some("a".repeat(64)),
                    provenance: Provenance::Created,
                },
                ManifestFile {
                    path: "a.txt".to_string(),
                    sha256: Some("b".repeat(64)),
                    provenance: Provenance::Created,
                },
            ],
        );
        let path = write_manifest(&dir, &manifest).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let a_pos = contents.find("a.txt").unwrap();
        let z_pos = contents.find("z.txt").unwrap();
        assert!(a_pos < z_pos, "files must be sorted by path");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_sorts_strategies_by_name() {
        let dir = scratch_dir("sorted-strategies");
        let manifest = Manifest {
            schema_version: SCHEMA_VERSION,
            strategies: vec![
                StrategyManifest::new(
                    "kiro-cli-v2",
                    "2026-01-15T09:30:00Z",
                    ".",
                    None,
                    Status::Complete,
                    vec![],
                ),
                StrategyManifest::new(
                    "claude",
                    "2026-01-15T09:30:00Z",
                    ".",
                    None,
                    Status::Complete,
                    vec![],
                ),
            ],
        };
        let path = write_manifest(&dir, &manifest).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let claude_pos = contents.find("claude").unwrap();
        let kiro_pos = contents.find("kiro-cli-v2").unwrap();
        assert!(
            claude_pos < kiro_pos,
            "strategies must be sorted alphabetically by name"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_leaves_no_leftover_tmp_file() {
        let dir = scratch_dir("no-leftover");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".kiro/agents",
            None,
            Status::Complete,
            vec![],
        );
        write_manifest(&dir, &manifest).unwrap();
        let konductor_dir = dir.join(KONDUCTOR_DIR_NAME);
        let leftovers: Vec<_> = fs::read_dir(&konductor_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn schema_version_is_present_and_equals_two() {
        let dir = scratch_dir("schema-version");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".kiro/agents",
            None,
            Status::Complete,
            vec![],
        );
        let path = write_manifest(&dir, &manifest).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["schema_version"], 2);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn written_manifest_ends_with_trailing_newline() {
        let dir = scratch_dir("trailing-newline");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".kiro/agents",
            None,
            Status::Complete,
            vec![],
        );
        let path = write_manifest(&dir, &manifest).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.ends_with(b"\n"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn in_progress_status_serializes_as_in_progress_string() {
        let dir = scratch_dir("status-in-progress");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::InProgress,
            vec![ManifestFile {
                path: ".kiro/agents/a.json".to_string(),
                sha256: None,
                provenance: Provenance::Created,
            }],
        );
        let path = write_manifest(&dir, &manifest).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["strategies"][0]["status"], "in_progress");
        assert!(parsed["strategies"][0]["files"][0]["sha256"].is_null());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn complete_status_serializes_as_complete_string() {
        let dir = scratch_dir("status-complete");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        let path = write_manifest(&dir, &manifest).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["strategies"][0]["status"], "complete");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn null_sha256_round_trips_through_read_manifest() {
        let dir = scratch_dir("null-sha256-round-trip");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::InProgress,
            vec![ManifestFile {
                path: ".kiro/agents/a.json".to_string(),
                sha256: None,
                provenance: Provenance::Created,
            }],
        );
        write_manifest(&dir, &manifest).unwrap();
        let loaded = read_manifest(&dir).unwrap().unwrap();
        assert_eq!(loaded.strategies[0].files[0].sha256, None);
        fs::remove_dir_all(&dir).ok();
    }

    /// A v1 manifest written by a pre-write-ahead, pre-§9 binary (no
    /// `status`, no per-file `provenance`, no `strategies` list at all)
    /// must still read back: `install` reads the prior manifest as a
    /// hard prerequisite (to classify provenance), so a hard
    /// deserialize failure here would abort re-installing over such a
    /// target. Missing fields default to `Complete` / `ReplacedForeign`
    /// (the uninstall-safe choice); the flat shape itself is migrated
    /// in memory into a single-entry `strategies` list.
    /// A real v1 binary could only ever have written the OLD strategy
    /// name (`kiro-cli`, here) -- `kiro-cli-v2` did not exist as a
    /// strategy name while v1 was the only on-disk schema. The migrated
    /// slot must carry the CURRENT name so a later `update`/`--harness
    /// kiro-cli-v2` can find it (see `legacy_strategy_name_to_current`'s
    /// own doc comment for why).
    #[test]
    fn read_manifest_migrates_legacy_v1_manifest_into_single_entry_strategies_list() {
        let dir = scratch_dir("legacy-v1-defaults");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".kiro","files":[{"path":"agents/a.json","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}"#,
        )
        .unwrap();
        let loaded = read_manifest(&dir).unwrap().unwrap();
        assert_eq!(loaded.schema_version, SCHEMA_VERSION);
        assert_eq!(loaded.strategies.len(), 1);
        let slot = &loaded.strategies[0];
        assert_eq!(slot.strategy, "kiro-cli-v2");
        assert_eq!(slot.destination, ".kiro");
        assert_eq!(slot.status, Status::Complete);
        assert_eq!(slot.files.len(), 1);
        assert_eq!(slot.files[0].provenance, Provenance::ReplacedForeign);
        assert_eq!(slot.files[0].sha256, Some("a".repeat(64)));
        fs::remove_dir_all(&dir).ok();
    }

    /// A fully-populated legacy v1 manifest (real `status`/`provenance`
    /// values, not defaulted ones) migrates its exact values through,
    /// not just the defaults -- confirms the migration path preserves
    /// real data, not only the back-compat-default case above. Also uses
    /// the OLD `claude-code` name a real v1 binary would have recorded,
    /// same rationale as the test above.
    #[test]
    fn read_manifest_migrates_legacy_v1_manifest_preserving_real_values() {
        let dir = scratch_dir("legacy-v1-real-values");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"strategy":"claude-code","installed_at":"2026-02-01T00:00:00Z","destination":".","source":"/repo","status":"in_progress","files":[{"path":".claude/agents/a.md","sha256":null,"provenance":"replaced_ours"}]}"#,
        )
        .unwrap();
        let loaded = read_manifest(&dir).unwrap().unwrap();
        assert_eq!(loaded.strategies.len(), 1);
        let slot = &loaded.strategies[0];
        assert_eq!(slot.strategy, "claude");
        assert_eq!(slot.source, Some("/repo".to_string()));
        assert_eq!(slot.status, Status::InProgress);
        assert_eq!(slot.files[0].provenance, Provenance::ReplacedOurs);
        fs::remove_dir_all(&dir).ok();
    }

    /// `legacy_strategy_name_to_current` on its own: all three old-to-new
    /// mappings, plus the passthrough case for a name that is already
    /// current (or otherwise unrecognized).
    #[test]
    fn legacy_strategy_name_to_current_maps_all_three_old_names() {
        assert_eq!(legacy_strategy_name_to_current("kiro-cli"), "kiro-cli-v2");
        assert_eq!(legacy_strategy_name_to_current("kiro-cli-v3"), "kiro-v3");
        assert_eq!(legacy_strategy_name_to_current("claude-code"), "claude");
        assert_eq!(legacy_strategy_name_to_current("kiro-v3"), "kiro-v3");
        assert_eq!(legacy_strategy_name_to_current("claude"), "claude");
    }

    /// The `kiro-cli-v3` -> `kiro-v3` mapping specifically, exercised
    /// through the real migration path (not just the pure function
    /// above) -- the two tests above only cover `kiro-cli` and
    /// `claude-code`.
    #[test]
    fn read_manifest_migrates_legacy_v1_kiro_cli_v3_manifest() {
        let dir = scratch_dir("legacy-v1-kiro-cli-v3");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"strategy":"kiro-cli-v3","installed_at":"2026-01-15T09:30:00Z","destination":".kiro","files":[]}"#,
        )
        .unwrap();
        let loaded = read_manifest(&dir).unwrap().unwrap();
        assert_eq!(loaded.strategies[0].strategy, "kiro-v3");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn provenance_variants_serialize_as_expected_strings() {
        let dir = scratch_dir("provenance-strings");
        let manifest = single_strategy_manifest(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::Complete,
            vec![
                ManifestFile {
                    path: "a.json".to_string(),
                    sha256: Some("a".repeat(64)),
                    provenance: Provenance::Created,
                },
                ManifestFile {
                    path: "b.json".to_string(),
                    sha256: Some("b".repeat(64)),
                    provenance: Provenance::ReplacedOurs,
                },
                ManifestFile {
                    path: "c.json".to_string(),
                    sha256: Some("c".repeat(64)),
                    provenance: Provenance::ReplacedForeign,
                },
            ],
        );
        let path = write_manifest(&dir, &manifest).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        let files = parsed["strategies"][0]["files"].as_array().unwrap();
        assert_eq!(files[0]["provenance"], "created");
        assert_eq!(files[1]["provenance"], "replaced_ours");
        assert_eq!(files[2]["provenance"], "replaced_foreign");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn classify_provenance_reports_created_when_destination_absent() {
        let dir = scratch_dir("classify-created");
        let target = dir.join("does-not-exist.json");
        assert_eq!(
            classify_provenance(&target, ".kiro/agents/does-not-exist.json", None),
            Provenance::Created
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// A DANGLING symlink (its target does not exist) is still
    /// something physically present at `destination_path` -- must be
    /// classified `ReplacedForeign` (or `ReplacedOurs`, if owned),
    /// never `Created`. `Path::exists()` alone would report `false`
    /// here (it follows the link and finds nothing at the far end),
    /// which is exactly the misclassification this regression test
    /// guards against.
    #[cfg(unix)]
    #[test]
    fn classify_provenance_reports_present_for_dangling_symlink_not_created() {
        let dir = scratch_dir("classify-dangling-symlink");
        let link = dir.join("dangling-link");
        std::os::unix::fs::symlink(dir.join("never-created-target"), &link).unwrap();
        assert!(
            !link.exists(),
            "sanity check: Path::exists() must report false for a dangling symlink"
        );
        assert_eq!(
            classify_provenance(&link, ".local/bin/dangling-link", None),
            Provenance::ReplacedForeign,
            "a dangling symlink is physically present and must not be classified Created"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn classify_provenance_reports_replaced_foreign_when_present_but_not_in_prior_manifest() {
        let dir = scratch_dir("classify-foreign");
        let target = dir.join("foreign.json");
        fs::write(&target, b"pre-existing user content").unwrap();
        assert_eq!(
            classify_provenance(&target, ".kiro/agents/foreign.json", None),
            Provenance::ReplacedForeign
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn classify_provenance_reports_replaced_ours_when_present_in_prior_manifest() {
        let dir = scratch_dir("classify-ours");
        let target = dir.join("ours.json");
        fs::write(&target, b"content from a prior konductor install").unwrap();
        let prior = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-14T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![ManifestFile {
                path: ".kiro/agents/ours.json".to_string(),
                sha256: Some("a".repeat(64)),
                provenance: Provenance::Created,
            }],
        );
        assert_eq!(
            classify_provenance(&target, ".kiro/agents/ours.json", Some(&prior)),
            Provenance::ReplacedOurs
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn classify_provenance_reports_replaced_foreign_when_path_present_but_absent_from_prior_manifest(
    ) {
        // A prior manifest exists, but the path being classified was
        // never one of its files -- a foreign file at a path this
        // install never owned. Must still classify `ReplacedForeign`,
        // not `ReplacedOurs`, just because a prior manifest exists.
        let dir = scratch_dir("classify-foreign-despite-prior-manifest");
        let target = dir.join("foreign-alongside-ours.json");
        fs::write(&target, b"not ours").unwrap();
        let prior = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-14T00:00:00Z",
            ".",
            None,
            Status::Complete,
            vec![ManifestFile {
                path: ".kiro/agents/some-other-file.json".to_string(),
                sha256: Some("a".repeat(64)),
                provenance: Provenance::Created,
            }],
        );
        assert_eq!(
            classify_provenance(
                &target,
                ".kiro/agents/foreign-alongside-ours.json",
                Some(&prior)
            ),
            Provenance::ReplacedForeign
        );
        fs::remove_dir_all(&dir).ok();
    }

    // ── §9.2/§9.3/§9.4: Manifest helper methods, override, coexistence ──

    fn slot(strategy: &str) -> StrategyManifest {
        StrategyManifest::new(
            strategy,
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::Complete,
            vec![ManifestFile {
                path: format!(".kiro/agents/{strategy}.json"),
                sha256: Some("a".repeat(64)),
                provenance: Provenance::Created,
            }],
        )
    }

    #[test]
    fn manifest_get_and_strategy_names() {
        let mut manifest = Manifest::empty();
        manifest.upsert(slot("kiro-cli-v2"));
        manifest.upsert(slot("claude"));
        assert!(manifest.get("kiro-cli-v2").is_some());
        assert!(manifest.get("claude").is_some());
        assert!(manifest.get("kiro-v3").is_none());
        let mut names = manifest.strategy_names();
        names.sort_unstable();
        assert_eq!(names, vec!["claude", "kiro-cli-v2"]);
    }

    #[test]
    fn manifest_upsert_replaces_same_named_slot_in_place() {
        let mut manifest = Manifest::empty();
        manifest.upsert(slot("kiro-cli-v2"));
        let mut updated = slot("kiro-cli-v2");
        updated.installed_at = "2026-02-01T00:00:00Z".to_string();
        manifest.upsert(updated);
        assert_eq!(manifest.strategies.len(), 1);
        assert_eq!(manifest.strategies[0].installed_at, "2026-02-01T00:00:00Z");
    }

    #[test]
    fn manifest_remove_drops_only_the_named_slot() {
        let mut manifest = Manifest::empty();
        manifest.upsert(slot("kiro-cli-v2"));
        manifest.upsert(slot("claude"));
        let removed = manifest.remove("kiro-cli-v2");
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().strategy, "kiro-cli-v2");
        assert_eq!(manifest.strategies.len(), 1);
        assert_eq!(manifest.strategies[0].strategy, "claude");
    }

    /// §9.3: installing `kiro-v3` where `kiro-cli-v2` is tracked
    /// overrides it -- the prior variant's slot is replaced, not kept
    /// alongside.
    #[test]
    fn upsert_strategy_overrides_the_other_kiro_variant() {
        let dir = scratch_dir("upsert-override");
        upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();
        let manifest = upsert_strategy(&dir, slot("kiro-v3")).unwrap();
        assert_eq!(manifest.strategies.len(), 1);
        assert_eq!(manifest.strategies[0].strategy, "kiro-v3");
        assert!(manifest.get("kiro-cli-v2").is_none());
        fs::remove_dir_all(&dir).ok();
    }

    /// The reverse direction of the override -- v3 -> v2 -- to confirm
    /// the override is symmetric, not just one-directional.
    #[test]
    fn upsert_strategy_overrides_symmetrically_v3_to_v2() {
        let dir = scratch_dir("upsert-override-reverse");
        upsert_strategy(&dir, slot("kiro-v3")).unwrap();
        let manifest = upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();
        assert_eq!(manifest.strategies.len(), 1);
        assert_eq!(manifest.strategies[0].strategy, "kiro-cli-v2");
        assert!(manifest.get("kiro-v3").is_none());
        fs::remove_dir_all(&dir).ok();
    }

    /// Repeated switching (kiro-cli-v2 -> kiro-v3 -> kiro-cli-v2 -> ...)
    /// stays at exactly one slot every time -- no accumulation of stale
    /// entries across several switches.
    #[test]
    fn upsert_strategy_repeated_switching_stays_at_one_slot() {
        let dir = scratch_dir("upsert-repeated-switch");
        upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();
        upsert_strategy(&dir, slot("kiro-v3")).unwrap();
        upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();
        let manifest = upsert_strategy(&dir, slot("kiro-v3")).unwrap();
        assert_eq!(manifest.strategies.len(), 1);
        assert_eq!(manifest.strategies[0].strategy, "kiro-v3");
        fs::remove_dir_all(&dir).ok();
    }

    /// §9.4: `claude` installing alongside an existing Kiro slot
    /// coexists independently -- both tracked, neither's files touched.
    #[test]
    fn upsert_strategy_claude_code_coexists_with_kiro_cli() {
        let dir = scratch_dir("upsert-coexist");
        upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();
        let manifest = upsert_strategy(&dir, slot("claude")).unwrap();
        assert_eq!(manifest.strategies.len(), 2);
        assert!(manifest.get("kiro-cli-v2").is_some());
        assert!(manifest.get("claude").is_some());
        // The kiro-cli-v2 slot itself is untouched by the claude insert.
        assert_eq!(
            manifest.get("kiro-cli-v2").unwrap().files,
            slot("kiro-cli-v2").files
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Same coexistence in the other order: kiro-cli-v2 installing after
    /// claude already exists must not disturb claude's slot.
    #[test]
    fn upsert_strategy_kiro_cli_coexists_with_claude_code_installed_first() {
        let dir = scratch_dir("upsert-coexist-reverse");
        upsert_strategy(&dir, slot("claude")).unwrap();
        let manifest = upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();
        assert_eq!(manifest.strategies.len(), 2);
        assert_eq!(manifest.get("claude").unwrap().files, slot("claude").files);
        fs::remove_dir_all(&dir).ok();
    }

    /// A kiro-variant override must leave an already-tracked
    /// `claude` slot completely untouched (§9.3's own claim: "Every
    /// OTHER slot ... is left byte-for-byte untouched").
    #[test]
    fn upsert_strategy_kiro_variant_override_leaves_claude_code_slot_untouched() {
        let dir = scratch_dir("upsert-override-preserves-claude");
        upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();
        upsert_strategy(&dir, slot("claude")).unwrap();
        let manifest = upsert_strategy(&dir, slot("kiro-v3")).unwrap();
        assert_eq!(manifest.strategies.len(), 2);
        assert!(manifest.get("kiro-cli-v2").is_none());
        assert!(manifest.get("kiro-v3").is_some());
        assert_eq!(manifest.get("claude").unwrap().files, slot("claude").files);
        fs::remove_dir_all(&dir).ok();
    }

    /// `remove_strategy_locked` removes only the named slot, leaves an
    /// OTHER coexisting slot untouched, and reports
    /// `target_fully_removed: false` since something remains.
    #[test]
    fn remove_strategy_locked_drops_only_the_named_slot() {
        let dir = scratch_dir("remove-strategy-locked-partial");
        upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();
        upsert_strategy(&dir, slot("claude")).unwrap();

        let outcome = remove_strategy_locked(&dir, Some("kiro-cli-v2"))
            .unwrap()
            .expect("manifest was just written above");
        assert_eq!(outcome.removed.unwrap().strategy, "kiro-cli-v2");
        assert!(!outcome.target_fully_removed);

        let manifest = read_manifest(&dir).unwrap().unwrap();
        assert_eq!(manifest.strategies.len(), 1);
        assert_eq!(manifest.strategies[0].strategy, "claude");
        assert!(manifest_path(&dir).is_file());
        fs::remove_dir_all(&dir).ok();
    }

    /// Removing the LAST tracked slot deletes the manifest file itself
    /// rather than leaving behind an empty `{"strategies": []}`
    /// document, and reports `target_fully_removed: true`.
    #[test]
    fn remove_strategy_locked_deletes_the_file_when_nothing_is_left() {
        let dir = scratch_dir("remove-strategy-locked-last");
        upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();

        let outcome = remove_strategy_locked(&dir, Some("kiro-cli-v2"))
            .unwrap()
            .expect("manifest was just written above");
        assert_eq!(outcome.removed.unwrap().strategy, "kiro-cli-v2");
        assert!(outcome.target_fully_removed);
        assert!(!manifest_path(&dir).is_file());
        fs::remove_dir_all(&dir).ok();
    }

    /// `strategy_name: None` (`uninstall.rs`'s already-empty-strategies-
    /// list case) still re-checks under the lock: an empty manifest
    /// stays empty and gets deleted, with nothing reported as removed.
    #[test]
    fn remove_strategy_locked_with_no_name_finalizes_an_already_empty_manifest() {
        let dir = scratch_dir("remove-strategy-locked-empty");
        // Write a manifest with an already-empty `strategies` list
        // directly (the state `uninstall.rs`'s empty-strategies-list
        // branch handles), bypassing `upsert_strategy`.
        write_manifest(&dir, &Manifest::empty()).unwrap();

        let outcome = remove_strategy_locked(&dir, None)
            .unwrap()
            .expect("manifest was just written above");
        assert!(outcome.removed.is_none());
        assert!(outcome.target_fully_removed);
        assert!(!manifest_path(&dir).is_file());
        fs::remove_dir_all(&dir).ok();
    }

    /// No manifest at all -> `Ok(None)`, nothing touched.
    #[test]
    fn remove_strategy_locked_returns_none_when_no_manifest_exists() {
        let dir = scratch_dir("remove-strategy-locked-absent");
        assert!(remove_strategy_locked(&dir, Some("kiro-cli-v2"))
            .unwrap()
            .is_none());
        fs::remove_dir_all(&dir).ok();
    }

    /// Races `remove_strategy_locked` removing one
    /// strategy against `upsert_strategy` adding a DIFFERENT one at the
    /// SAME target, from the same starting state (only the strategy
    /// being removed tracked) -- the exact interleaving an unlocked
    /// read-modify-write would otherwise lose: an uninstall computing
    /// "is anything left?" from a stale snapshot that predates a
    /// concurrent install's already-committed slot. Runs `ITERATIONS`
    /// rounds and asserts, every round, that the removed strategy is
    /// gone AND the concurrently-installed one survives -- never both,
    /// and never the whole manifest wiped.
    #[test]
    fn remove_strategy_locked_never_drops_a_concurrently_installed_other_strategy() {
        const ITERATIONS: usize = 50;
        for i in 0..ITERATIONS {
            let dir = scratch_dir(&format!("remove-vs-upsert-race-{i}"));
            upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();

            let dir_a = dir.clone();
            let dir_b = dir.clone();
            let remover =
                std::thread::spawn(move || remove_strategy_locked(&dir_a, Some("kiro-cli-v2")));
            let installer = std::thread::spawn(move || upsert_strategy(&dir_b, slot("claude")));

            let remove_result = remover.join().expect("remover thread must not panic");
            let install_result = installer.join().expect("installer thread must not panic");

            assert!(
                remove_result.is_ok(),
                "round {i}: remove_strategy_locked must succeed"
            );
            assert!(
                install_result.is_ok(),
                "round {i}: upsert_strategy must succeed"
            );

            // Regardless of interleaving, the lock forces one complete
            // critical section to finish before the other starts, so the
            // final state is always exactly: kiro-cli-v2 gone, claude
            // present. An unlocked uninstall could instead delete
            // the whole manifest file here, discarding claude too.
            let manifest = read_manifest(&dir).unwrap().unwrap_or_else(|| {
                panic!("round {i}: manifest must still exist -- claude's slot must survive")
            });
            assert!(
                manifest.get("kiro-cli-v2").is_none(),
                "round {i}: kiro-cli-v2 must be removed"
            );
            assert!(
                manifest.get("claude").is_some(),
                "round {i}: claude's concurrently-installed slot must survive"
            );

            fs::remove_dir_all(&dir).ok();
        }
    }

    /// `update_strategy_field_locked` rewrites only the named slot's
    /// field via the mutator, leaving an OTHER slot's fields untouched.
    #[test]
    fn update_strategy_field_locked_rewrites_only_the_named_slot() {
        let dir = scratch_dir("update-field-locked");
        upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();
        upsert_strategy(&dir, slot("claude")).unwrap();

        let rewrote = update_strategy_field_locked(&dir, "kiro-cli-v2", |s| {
            s.source = Some("remote:test.tar.gz".to_string())
        })
        .unwrap();
        assert!(rewrote);

        let manifest = read_manifest(&dir).unwrap().unwrap();
        assert_eq!(
            manifest.get("kiro-cli-v2").unwrap().source,
            Some("remote:test.tar.gz".to_string())
        );
        assert_ne!(
            manifest.get("claude").unwrap().source,
            Some("remote:test.tar.gz".to_string())
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// `install::remote`'s sibling call site: races
    /// `update_strategy_field_locked` rewriting `kiro-cli-v2`'s `source`
    /// field against `upsert_strategy` concurrently INSERTING a
    /// different, brand-new `claude` slot at the same target --
    /// the exact interleaving an unlocked read-then-write pair would
    /// otherwise lose: the field rewrite's stale snapshot silently
    /// dropping a slot a concurrent install just committed. Runs
    /// `ITERATIONS` rounds and asserts, every round, that BOTH the
    /// rewritten field AND the concurrently-installed slot survive.
    #[test]
    fn update_strategy_field_locked_never_drops_a_concurrently_installed_other_strategy() {
        const ITERATIONS: usize = 50;
        for i in 0..ITERATIONS {
            let dir = scratch_dir(&format!("update-field-vs-upsert-race-{i}"));
            upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();

            let dir_a = dir.clone();
            let dir_b = dir.clone();
            let updater = std::thread::spawn(move || {
                update_strategy_field_locked(&dir_a, "kiro-cli-v2", |s| {
                    s.source = Some("remote:race-test.tar.gz".to_string())
                })
            });
            let installer = std::thread::spawn(move || upsert_strategy(&dir_b, slot("claude")));

            let update_result = updater.join().expect("updater thread must not panic");
            let install_result = installer.join().expect("installer thread must not panic");

            assert!(
                update_result.unwrap(),
                "round {i}: kiro-cli-v2 was tracked when the race started; the field rewrite must succeed"
            );
            assert!(
                install_result.is_ok(),
                "round {i}: upsert_strategy must succeed"
            );

            let manifest = read_manifest(&dir).unwrap().unwrap();
            assert_eq!(
                manifest.get("kiro-cli-v2").unwrap().source,
                Some("remote:race-test.tar.gz".to_string()),
                "round {i}: kiro-cli-v2's rewritten source field must survive"
            );
            assert!(
                manifest.get("claude").is_some(),
                "round {i}: claude's concurrently-installed slot must survive"
            );

            fs::remove_dir_all(&dir).ok();
        }
    }

    /// A strategy not tracked in the fresh, locked read is a no-op --
    /// `Ok(false)`, nothing written.
    #[test]
    fn update_strategy_field_locked_returns_false_when_strategy_not_tracked() {
        let dir = scratch_dir("update-field-locked-missing");
        upsert_strategy(&dir, slot("kiro-cli-v2")).unwrap();

        let rewrote = update_strategy_field_locked(&dir, "claude", |s| {
            s.source = Some("remote:test.tar.gz".to_string())
        })
        .unwrap();
        assert!(!rewrote);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn effective_prior_slot_returns_own_slot_when_present() {
        let mut manifest = Manifest::empty();
        manifest.upsert(slot("kiro-cli-v2"));
        let found = effective_prior_slot(&manifest, "kiro-cli-v2");
        assert_eq!(found.unwrap().strategy, "kiro-cli-v2");
    }

    /// The override-switch case: `kiro-v3` has no slot of its own
    /// yet, but `kiro-cli-v2` (the other family member) does -- its slot is
    /// the effective prior for provenance purposes, since both variants
    /// write the exact same destination paths (§9.1).
    #[test]
    fn effective_prior_slot_borrows_the_other_kiro_variant_slot_on_switch() {
        let mut manifest = Manifest::empty();
        manifest.upsert(slot("kiro-cli-v2"));
        let found = effective_prior_slot(&manifest, "kiro-v3");
        assert_eq!(found.unwrap().strategy, "kiro-cli-v2");
    }

    /// `claude` is not a `KIRO_VARIANT_FAMILY` member, so it never
    /// borrows a Kiro slot's provenance even if one is tracked.
    #[test]
    fn effective_prior_slot_never_borrows_across_non_family_strategies() {
        let mut manifest = Manifest::empty();
        manifest.upsert(slot("kiro-cli-v2"));
        assert!(effective_prior_slot(&manifest, "claude").is_none());
    }

    #[test]
    fn effective_prior_slot_returns_none_for_a_genuinely_fresh_install() {
        let manifest = Manifest::empty();
        assert!(effective_prior_slot(&manifest, "kiro-cli-v2").is_none());
    }

    // ── `other_kiro_variant_tracked` ────────────────────────────────────

    #[test]
    fn other_kiro_variant_tracked_finds_the_other_family_member() {
        let manifest = vec![slot("kiro-cli-v2")];
        assert_eq!(
            other_kiro_variant_tracked(&manifest, "kiro-v3"),
            Some("kiro-cli-v2".to_string())
        );
    }

    #[test]
    fn other_kiro_variant_tracked_is_none_when_incoming_is_not_a_family_member() {
        let manifest = vec![slot("kiro-cli-v2")];
        assert_eq!(other_kiro_variant_tracked(&manifest, "claude"), None);
    }

    #[test]
    fn other_kiro_variant_tracked_is_none_when_no_other_member_is_tracked() {
        let manifest = vec![slot("claude")];
        assert_eq!(other_kiro_variant_tracked(&manifest, "kiro-cli-v2"), None);
    }

    #[test]
    fn other_kiro_variant_tracked_is_none_when_incoming_already_owns_the_only_slot() {
        let manifest = vec![slot("kiro-cli-v2")];
        assert_eq!(other_kiro_variant_tracked(&manifest, "kiro-cli-v2"), None);
    }
}

/// Test fixture (see `tests/fixtures/manifest_cases.json`) so
/// serialization assertions are derived from one source of truth rather
/// than hand-duplicated literals.
#[cfg(test)]
mod shared_fixture {
    use super::*;
    use std::fs;

    const SHARED_FIXTURE_JSON: &str = include_str!("../../../tests/fixtures/manifest_cases.json");

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-manifest-shared-fixture-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Guards the fixture's own `sha256` shape per status before it's used
    /// to build a `Manifest` below: a `complete` entry must be exactly 64
    /// lowercase-hex characters, and an `in_progress` entry must be `null`.
    /// Catches a malformed fixture digest directly, rather than relying on
    /// it happening to also break a `serialized` byte comparison.
    fn assert_fixture_file_digest_shape_matches_status(
        name: &str,
        status_str: &str,
        f: &serde_json::Value,
    ) {
        let path = f["path"].as_str().unwrap();
        let sha = f
            .get("sha256")
            .expect("fixture file entry must have sha256");
        match status_str {
            "complete" => {
                let sha_str = sha.as_str().unwrap_or_else(|| {
                    panic!("[fixture:{name}] file {path:?} has status complete but sha256 is not a string: {sha:?}")
                });
                let is_valid_digest = sha_str.len() == 64
                    && sha_str
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
                assert!(
                    is_valid_digest,
                    "[fixture:{name}] file {path:?} has a malformed sha256 (want ^[0-9a-f]{{64}}$): {sha_str:?}"
                );
            }
            "in_progress" => {
                assert!(
                    sha.is_null(),
                    "[fixture:{name}] file {path:?} has status in_progress but sha256 is not null: {sha:?}"
                );
            }
            other => panic!("[fixture:{name}] unknown status {other:?}"),
        }
    }

    #[test]
    fn shared_fixture_cases_produce_expected_serialized_bytes() {
        let doc: serde_json::Value =
            serde_json::from_str(SHARED_FIXTURE_JSON).expect("shared fixture must be valid JSON");
        let cases = doc["cases"]
            .as_array()
            .expect("fixture must have a 'cases' array");
        assert!(!cases.is_empty(), "fixture must declare at least one case");

        for case in cases {
            let name = case["name"].as_str().unwrap();
            let strategy = case["strategy"].as_str().unwrap();
            let installed_at = case["installed_at"].as_str().unwrap();
            let destination = case["destination"].as_str().unwrap();
            let status_str = case["status"].as_str().unwrap();
            let status = match status_str {
                "in_progress" => Status::InProgress,
                "complete" => Status::Complete,
                other => panic!("[fixture:{name}] unknown status {other:?}"),
            };
            let files: Vec<ManifestFile> = case["files"]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| {
                    assert_fixture_file_digest_shape_matches_status(name, status_str, f);
                    ManifestFile {
                        path: f["path"].as_str().unwrap().to_string(),
                        sha256: f["sha256"].as_str().map(|s| s.to_string()),
                        provenance: match f["provenance"].as_str().unwrap() {
                            "created" => Provenance::Created,
                            "replaced_ours" => Provenance::ReplacedOurs,
                            "replaced_foreign" => Provenance::ReplacedForeign,
                            other => panic!("[fixture:{name}] unknown provenance {other:?}"),
                        },
                    }
                })
                .collect();
            let expected = case["expected"]["serialized"].as_str().unwrap();

            let manifest = Manifest {
                schema_version: SCHEMA_VERSION,
                strategies: vec![StrategyManifest::new(
                    strategy,
                    installed_at,
                    destination,
                    None,
                    status,
                    files,
                )],
            };
            let dir = scratch_dir(name);
            let path = write_manifest(&dir, &manifest).expect("write must succeed");
            let actual = fs::read_to_string(&path).unwrap();
            assert_eq!(
                actual, expected,
                "[fixture:{name}] serialized bytes mismatch"
            );
            fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn shared_fixture_error_cases_are_rejected_with_expected_message() {
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
            let raw_json = case["raw_json"].as_str().unwrap();
            let expected_substring = case["expected"]["reason_substring"].as_str().unwrap();

            let dir = scratch_dir(name);
            let path = manifest_path(&dir);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, raw_json).unwrap();

            let err = read_manifest(&dir).expect_err(&format!(
                "[fixture:{name}] expected read_manifest to reject this content"
            ));
            let message = err.to_string();
            assert!(
                message.contains(expected_substring),
                "[fixture:{name}] error message missing expected substring:\n  expected_substring={expected_substring:?}\n  actual={message:?}"
            );
            fs::remove_dir_all(&dir).ok();
        }
    }
}
