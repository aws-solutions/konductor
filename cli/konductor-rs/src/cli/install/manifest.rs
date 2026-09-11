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

/// Manifest document schema version. Bump when the shape changes
/// incompatibly.
pub(crate) const SCHEMA_VERSION: u64 = 1;

/// File name within `KONDUCTOR_DIR_NAME`. No `.json` suffix -- see
/// module docstring.
pub(crate) const MANIFEST_FILE_NAME: &str = "manifest";

/// Whether an install run has finished copying every file it intends to
/// write. `InProgress` is written BEFORE any file is copied (the
/// write-ahead record); `Complete` is written only after every file has
/// actually been copied successfully. Serialized as the lowercase
/// snake_case strings below -- stable, self-describing, and identical
/// in the manifest's JSON. Defaults to `Complete` when a
/// manifest predating this field is read back (a pre-write-ahead
/// manifest was only ever written on full success), so an older on-disk
/// manifest -- same `schema_version`, no `status` -- still deserializes
/// instead of failing `Malformed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    InProgress,
    #[default]
    Complete,
}

/// Which of three states produced a given installed file, determined by
/// stat-ing the destination and consulting any prior manifest BEFORE
/// that file is copied:
/// - `Created`: nothing was at this path before this install.
/// - `ReplacedOurs`: a previous Konductor install had already written
///   this exact path (present in the prior manifest) -- this install
///   replaced its own prior content.
/// - `ReplacedForeign`: something was at this path, but it was NOT ours
///   -- pre-existing content this install did not create, now
///   overwritten. A future `uninstall` must never delete a path in this
///   state.
///
/// Serialized as the lowercase snake_case strings below -- stable,
/// self-describing JSON strings.
/// Defaults to `ReplacedForeign` when a manifest predating this field is
/// read back -- the conservative choice, since `uninstall` must never
/// delete a `ReplacedForeign` path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provenance {
    Created,
    ReplacedOurs,
    #[default]
    ReplacedForeign,
}

/// One installed file's tracked path, content hash, and provenance.
/// `sha256` is `None` (serialized as JSON `null`) in the pre-copy
/// (`Status::InProgress`) record, since the real content -- and
/// therefore its hash -- does not exist yet; it is always `Some` once
/// the manifest is rewritten `Status::Complete`. `provenance` is
/// `#[serde(default)]` so a manifest predating the field still reads
/// back (defaulting to `ReplacedForeign`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    pub sha256: Option<String>,
    #[serde(default)]
    pub provenance: Provenance,
}

/// `.konductor/manifest`'s in-memory shape: the strategy that performed
/// the install, when, where (`destination`, relative to `target_dir`),
/// the SOURCE tree `--from` pointed at when this install ran (`source`,
/// see below), whether the install run has finished (`status`), and
/// which files (with hashes and provenance, relative to `destination`)
/// it wrote or intends to write. `status` is `#[serde(default)]` so a
/// manifest predating the field still reads back (defaulting to
/// `Complete`). Both defaults keep `schema_version` at 1
/// back-compatible: an old-shape v1 manifest deserializes rather than
/// failing, so re-installing over a target an older binary wrote does
/// not abort.
///
/// `source`: the absolute, canonicalized `--from <repo-root>` path
/// `install_from_local` was given -- the SOURCE tree that produced this
/// install's files, not `destination` (the install ROOT). `konductor
/// doctor`'s `check_source`/`check_config` resolve against this field
/// by default (see doctor.rs's module docstring), so they validate the
/// same tree that was actually installed rather than whatever
/// `--from`/cwd happens to be when `doctor` runs.
///
/// `Option<String>` for two reasons: (1) `install_from_local` takes
/// `from: Option<&str>`, and the type stays honest that `None` is
/// possible even though no real caller hits it on a successful install
/// today; (2) backward compatibility -- `#[serde(default)]` lets a
/// manifest written before this field existed deserialize as `None`,
/// same pattern as `status`/`provenance` elsewhere in this file.
/// `doctor` treats `None` as "no recorded source" and falls back to
/// `--from`/cwd with an explicit note.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: u64,
    pub strategy: String,
    pub installed_at: String,
    pub destination: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub status: Status,
    pub files: Vec<ManifestFile>,
}

impl Manifest {
    /// Builds a `Manifest` with the current `SCHEMA_VERSION`, so call
    /// sites never hand-type the discriminator. `source` is the
    /// absolute, canonicalized `--from <repo-root>` path this install
    /// run was given (`None` only if the caller genuinely has none to
    /// record -- see the field's own doc comment on `Manifest`).
    pub fn new(
        strategy: impl Into<String>,
        installed_at: impl Into<String>,
        destination: impl Into<String>,
        source: Option<String>,
        status: Status,
        files: Vec<ManifestFile>,
    ) -> Self {
        Manifest {
            schema_version: SCHEMA_VERSION,
            strategy: strategy.into(),
            installed_at: installed_at.into(),
            destination: destination.into(),
            source,
            status,
            files,
        }
    }
}

/// All the ways reading/writing a manifest can fail. Every variant except
/// `UnsupportedSchemaVersion` is a USAGE ERROR from the CLI's perspective
/// -- callers must map those to `EXIT_USAGE_ERROR` (64), never exit code
/// 2. `UnsupportedSchemaVersion` is a state/verification failure and maps
/// to `EXIT_VERIFY_FAILED` (65) instead.
// `read_manifest` has no production caller yet; ReadFailed/Malformed are
// constructed there and Malformed is asserted by `read_rejects_malformed_json`.
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
        }
    }
}

impl std::error::Error for ManifestError {}

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
    prior_manifest: Option<&Manifest>,
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
/// `files` sorted by path, 2-space indent (via
/// `serde_json::to_string_pretty`), trailing newline, UTF-8.
fn serialize(manifest: &Manifest) -> Result<Vec<u8>, serde_json::Error> {
    let mut sorted = manifest.clone();
    sorted.files.sort_by(|a, b| a.path.cmp(&b.path));
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
/// deserialization error a shape change happens to produce. Reserved
/// for future callers (`update`/`uninstall`, tasks 3.5/3.6) --
/// exercised directly by this module's own tests at this milestone.
#[allow(dead_code)]
pub fn read_manifest(target_dir: &Path) -> Result<Option<Manifest>, ManifestError> {
    let path = manifest_path(target_dir);
    if !path.is_file() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&path).map_err(|source| ManifestError::ReadFailed {
        path: path.clone(),
        source,
    })?;
    let raw: serde_json::Value =
        serde_json::from_str(&contents).map_err(|source| ManifestError::Malformed {
            path: path.clone(),
            source,
        })?;
    // `as_i64` (not `as_u64`) so a negative `schema_version` -- e.g. -1 --
    // is still recognized as "a number was found" rather than falling
    // through to a generic `Malformed`. This pre-deserialize check is
    // still load-bearing for catching a missing/non-numeric
    // `schema_version` early (the `None` arm below is a deliberate
    // fallthrough for exactly that case) -- it is NOT sufficient on its
    // own: a `schema_version` that IS a number but does not fit in
    // `i64` (a `u64` value above `i64::MAX`) also makes `as_i64` return
    // `None`, which would otherwise silently fall through to the same
    // "no numeric version" path as a genuinely missing field and be
    // accepted rather than rejected. The post-deserialize re-check below
    // closes that gap by comparing the actual deserialized `u64` field,
    // which has no range limitation `as_i64` does.
    let found_version = raw
        .get("schema_version")
        .and_then(serde_json::Value::as_i64);
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
    // Post-deserialize catch-all: `manifest.schema_version` is a real
    // `u64`, so this comparison is correct for every value the
    // pre-check above could not represent as `i64` -- in particular a
    // legal `u64` above `i64::MAX`, which made `found_version` above
    // `None` and let execution reach here without ever being rejected.
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(ManifestError::UnsupportedSchemaVersion {
            path,
            // Reuse `found_version` when present (matches every
            // existing caller's expectation of an `i64` here); it can
            // only be `None` here for a value `as_i64` could not
            // represent, which is exactly the u64-overflow case this
            // catch-all exists for -- report `i64::MAX` as the closest
            // representable stand-in rather than fabricating a
            // misleading small number.
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

    #[test]
    fn write_then_read_round_trips() {
        let dir = scratch_dir("round-trip");
        let manifest = Manifest::new(
            "kiro-cli",
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
        let manifest = Manifest::new(
            "kiro-cli",
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
        fs::write(
            &path,
            br#"{"schema_version":99,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".kiro/agents","status":"complete","files":[]}"#,
        )
        .unwrap();
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
        fs::write(
            &path,
            br#"{"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".kiro/agents","status":"complete","files":[]}"#,
        )
        .unwrap();
        let err = read_manifest(&dir).expect_err("missing schema_version must be rejected");
        assert!(matches!(err, ManifestError::Malformed { .. }));

        let path2 = manifest_path(&dir);
        fs::write(
            &path2,
            br#"{"schema_version":"abc","strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".kiro/agents","status":"complete","files":[]}"#,
        )
        .unwrap();
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
        fs::write(
            &path,
            br#"{"schema_version":-1,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".kiro/agents","status":"complete","files":[]}"#,
        )
        .unwrap();
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
            br#"{"schema_version":18446744073709551615,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".kiro/agents","status":"complete","files":[]}"#,
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
            br#"{"schema_version":9223372036854775808,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".kiro/agents","status":"complete","files":[]}"#,
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
        let manifest = Manifest::new(
            "kiro-cli",
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
        let manifest = Manifest::new(
            "kiro-cli",
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
    fn write_leaves_no_leftover_tmp_file() {
        let dir = scratch_dir("no-leftover");
        let manifest = Manifest::new(
            "kiro-cli",
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
    fn schema_version_is_present_and_equals_one() {
        let dir = scratch_dir("schema-version");
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-15T09:30:00Z",
            ".kiro/agents",
            None,
            Status::Complete,
            vec![],
        );
        let path = write_manifest(&dir, &manifest).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["schema_version"], 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn written_manifest_ends_with_trailing_newline() {
        let dir = scratch_dir("trailing-newline");
        let manifest = Manifest::new(
            "kiro-cli",
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
        let manifest = Manifest::new(
            "kiro-cli",
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
        assert_eq!(parsed["status"], "in_progress");
        assert!(parsed["files"][0]["sha256"].is_null());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn complete_status_serializes_as_complete_string() {
        let dir = scratch_dir("status-complete");
        let manifest = Manifest::new(
            "kiro-cli",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::Complete,
            vec![],
        );
        let path = write_manifest(&dir, &manifest).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["status"], "complete");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn null_sha256_round_trips_through_read_manifest() {
        let dir = scratch_dir("null-sha256-round-trip");
        let manifest = Manifest::new(
            "kiro-cli",
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
        assert_eq!(loaded.files[0].sha256, None);
        fs::remove_dir_all(&dir).ok();
    }

    /// A v1 manifest written by a pre-write-ahead binary (no `status`,
    /// no per-file `provenance`) must still read back: `install` reads
    /// the prior manifest as a hard prerequisite (to classify
    /// provenance), so a hard deserialize failure here would abort
    /// re-installing over such a target. Missing fields default to
    /// `Complete` / `ReplacedForeign` (the uninstall-safe choice).
    #[test]
    fn read_manifest_defaults_status_and_provenance_for_legacy_v1_manifest() {
        let dir = scratch_dir("legacy-v1-defaults");
        let path = manifest_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"strategy":"kiro-cli","installed_at":"2026-01-15T09:30:00Z","destination":".kiro","files":[{"path":"agents/a.json","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}"#,
        )
        .unwrap();
        let loaded = read_manifest(&dir).unwrap().unwrap();
        assert_eq!(loaded.status, Status::Complete);
        assert_eq!(loaded.files.len(), 1);
        assert_eq!(loaded.files[0].provenance, Provenance::ReplacedForeign);
        assert_eq!(loaded.files[0].sha256, Some("a".repeat(64)));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn provenance_variants_serialize_as_expected_strings() {
        let dir = scratch_dir("provenance-strings");
        let manifest = Manifest::new(
            "kiro-cli",
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
        let files = parsed["files"].as_array().unwrap();
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
        let prior = Manifest::new(
            "kiro-cli",
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
        // A prior manifest exists (this target has been installed
        // before), but the SPECIFIC path being classified was never one
        // of ITS files -- e.g. a foreign file sitting at a path this
        // install has never previously owned. Must still be classified
        // `ReplacedForeign`, not `ReplacedOurs`, purely because a prior
        // manifest happens to exist.
        let dir = scratch_dir("classify-foreign-despite-prior-manifest");
        let target = dir.join("foreign-alongside-ours.json");
        fs::write(&target, b"not ours").unwrap();
        let prior = Manifest::new(
            "kiro-cli",
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

            let manifest = Manifest::new(strategy, installed_at, destination, None, status, files);
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
