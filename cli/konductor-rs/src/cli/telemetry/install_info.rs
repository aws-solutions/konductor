// SPDX-License-Identifier: Apache-2.0
//
// telemetry/install_info.rs - `<target_dir>/.konductor/install-info.json`
// schema, `agent_version` derivation, and write and removal mechanics.
//
// `agent_version` is the installed content's own version, reported
// separately from the running binary's version, which reaches every
// telemetry event as the envelope's own `Version` and needs no copy
// here.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cli::config_lock;

use super::super::config::KONDUCTOR_DIR_NAME;

/// Independent of `identity::SCHEMA_VERSION`/`instance::SCHEMA_VERSION`.
pub(crate) const SCHEMA_VERSION: u64 = 1;

const INSTALL_INFO_FILE_NAME: &str = "install-info.json";

/// Per-target advisory lock guarding `install-info.json`'s write and its
/// read-check-remove critical section (`read_and_maybe_remove_locked`).
/// Independent of `manifest.rs`'s own `MANIFEST_LOCK_FILE_NAME` and
/// `bin_link.rs`'s `.bin-links.lock` -- a different document, a
/// different lock, so contention on one never blocks the other.
const INSTALL_INFO_LOCK_FILE_NAME: &str = ".install-info.lock";

/// `0o600`: owner read/write only. Matches the instance record's own
/// mode (`shared/konductor-telemetry`'s `identity.rs`), not the
/// per-target identity file's looser `0o644` -- this record carries
/// harness, installed content version, and install time, none of
/// which any other local user on a shared host needs to read.
const FILE_MODE: u32 = 0o600;

/// Relative to an install source's own root; written by `synth`'s
/// `dispatch_synth_with`.
const DIST_VERSION_RELATIVE_PATH: &str = "dist/VERSION";

/// `<target_dir>/.konductor/install-info.json`'s on-disk shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct InstallInfoRecord {
    pub schema_version: u64,
    /// Degrades to null rather than defaulting when there's no
    /// `VERSION` file under `dist/` or it doesn't parse.
    pub agent_version: Option<String>,
    pub harness: String,
    pub installed_at: String,
}

impl InstallInfoRecord {
    fn new(
        agent_version: Option<String>,
        harness: impl Into<String>,
        installed_at: impl Into<String>,
    ) -> Self {
        InstallInfoRecord {
            schema_version: SCHEMA_VERSION,
            agent_version,
            harness: harness.into(),
            installed_at: installed_at.into(),
        }
    }
}

pub(crate) fn install_info_path(target_dir: &Path) -> std::path::PathBuf {
    target_dir
        .join(KONDUCTOR_DIR_NAME)
        .join(INSTALL_INFO_FILE_NAME)
}

/// Reads `<source_root>/dist/VERSION`, trimmed. `None` if missing,
/// empty, or unreadable. A genuine `NotFound` is silent -- most
/// sources simply have no `VERSION` file. Any other read error
/// (permissions, I/O) is warned: it means a version this call
/// couldn't confirm is genuinely absent, so `agent_version` still
/// degrades to `None` rather than being fabricated, but silently
/// misreporting that as "no VERSION file" would hide a real problem
/// with the source tree.
pub(crate) fn agent_version_from_source(source_root: &Path) -> Option<String> {
    let path = source_root.join(DIST_VERSION_RELATIVE_PATH);
    let contents = match std::fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            eprintln!(
                "konductor install: warning: could not read {}: {err}",
                path.display()
            );
            return None;
        }
    };
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Overwrites `<target_dir>/.konductor/install-info.json`
/// unconditionally, via `atomic_write`'s temp-file-then-`rename` -- not
/// `identity.rs`/`instance.rs`'s temp-then-`hard_link`, since this
/// record is rewritten on every install by design and needs an
/// overwrite-safe rename rather than an exclusive-create link.
pub(crate) fn write_install_info(
    target_dir: &Path,
    source_root: &Path,
    harness: &str,
    installed_at: &str,
) -> std::io::Result<()> {
    let agent_version = agent_version_from_source(source_root);
    let record = InstallInfoRecord::new(agent_version, harness, installed_at);
    write_record(target_dir, &record)
}

/// Removes the opt-in record, so an `install --no-telemetry` over a target
/// that was installed with telemetry on actually opts it out. Leaving
/// the file would keep every `report_*` gate open and make the next
/// plain `update` carry telemetry forward as enabled. An absent file is
/// not an error.
///
/// Unlocked: a direct `fs::remove_file`, safe to call standalone when the
/// caller already holds `INSTALL_INFO_LOCK_FILE_NAME` itself (as
/// `read_and_maybe_remove_locked` does) or doesn't need the TOCTOU
/// guarantee that function provides. A caller that reads this record and
/// then decides whether to remove it should use
/// [`read_and_maybe_remove_locked`] instead of composing a read with this
/// function directly -- see that function's own doc comment for the race
/// doing so otherwise leaves open.
pub(crate) fn remove_install_info(target_dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(install_info_path(target_dir)) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// Reads the install-info record and, when `remove_if_enabled` is true
/// and that read currently finds a usable (`Ok`) record, removes it --
/// both steps inside ONE critical section under
/// `INSTALL_INFO_LOCK_FILE_NAME`, the same per-target lock `write_record`
/// holds for its own write.
///
/// Composing an unlocked `read_install_info_detailed` with a later,
/// separately unlocked `remove_install_info` call leaves a gap: a
/// concurrent `write_install_info` (a different harness's install or
/// update, telemetry on) can land a fresh record in between the two,
/// and the later call would then remove that fresh record based on a
/// decision made before it ever existed, rather than the one actually
/// read. Locking only the removal, not the read, still leaves that same
/// gap open -- the read and the removal decision it drives must share
/// one lock acquisition so the removal always acts on what the lock
/// holder itself just saw, never on a stale snapshot.
///
/// Returns the read's own three-way outcome (`Ok`/`NotFound`/`Broken`)
/// unchanged, so callers resolve a carry-forward opt-out or a
/// broken-record warning exactly as they would from a bare
/// `read_install_info_detailed` call. `remove_error` is `Some` only when
/// a removal was both called for and attempted (the locked read found an
/// `Ok` record) and either the removal itself failed, or the lock could
/// not be acquired at all with a removal pending.
pub(crate) fn read_and_maybe_remove_locked(
    target_dir: &Path,
    remove_if_enabled: bool,
) -> (
    Result<InstallInfoRecord, InstallInfoAbsence>,
    Option<std::io::Error>,
) {
    let dir = target_dir.join(KONDUCTOR_DIR_NAME);
    let guard = match config_lock::acquire_named(&dir, INSTALL_INFO_LOCK_FILE_NAME) {
        Ok(guard) => guard,
        Err(err) => {
            // Contention most plausibly means a concurrent writer holds
            // this exact lock right now -- i.e. the race this lock
            // exists to prevent is actually in progress. Skip the
            // removal rather than racing it unlocked; the read below is
            // still unlocked and best-effort, the same as calling
            // `read_install_info_detailed` directly with no lock held.
            let read = read_install_info_detailed(target_dir);
            let remove_error =
                (remove_if_enabled && read.is_ok()).then(|| std::io::Error::other(err.to_string()));
            return (read, remove_error);
        }
    };
    let read = read_install_info_detailed(target_dir);
    #[cfg(test)]
    if let Some(hook) = LOCKED_READ_SYNC_HOOK.with(|h| h.borrow_mut().take()) {
        hook();
    }
    let remove_error = if remove_if_enabled && read.is_ok() {
        remove_install_info(target_dir).err()
    } else {
        None
    };
    drop(guard);
    (read, remove_error)
}

// Test-only hook invoked by `read_and_maybe_remove_locked` right after
// it acquires its lock and performs the fresh read, but before any
// removal -- lets a test hold the critical section open for a
// controlled moment so a concurrent `write_install_info` call can be
// proven to block on the SAME lock rather than racing it. A no-op in
// every real build and in every test that never sets it, mirroring
// `update.rs`'s own `MID_UPDATE_SYNC_HOOK` test-only pattern.
//
// `pub(crate)`, not module-private: `install.rs`'s own race test for its
// `read_and_maybe_remove_locked` call site reuses this exact hook rather
// than duplicating it, re-exported at `telemetry.rs`'s own level (see
// that module's `#[cfg(test)]`-only `use install_info::LOCKED_READ_SYNC_HOOK`).
#[cfg(test)]
thread_local! {
    pub(crate) static LOCKED_READ_SYNC_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
}

/// Locked under `INSTALL_INFO_LOCK_FILE_NAME` for the whole write, not
/// just the rename: `write_atomic_with_mode`'s temp-file-then-`rename`
/// alone guarantees a reader never observes a torn write, but says
/// nothing about a concurrent [`read_and_maybe_remove_locked`] call
/// removing the file this write is in the middle of producing. The two
/// share this one lock so each one's critical section runs to
/// completion before the other's begins -- see
/// `read_and_maybe_remove_locked`'s own doc comment for the TOCTOU gap
/// this closes. Independent of `manifest.rs`'s own
/// `MANIFEST_LOCK_FILE_NAME`: a concurrent install's manifest write and
/// this record's write touch two different documents and must not
/// contend with each other.
fn write_record(target_dir: &Path, record: &InstallInfoRecord) -> std::io::Result<()> {
    let dir = target_dir.join(KONDUCTOR_DIR_NAME);
    std::fs::create_dir_all(&dir)?;
    let _lock = config_lock::acquire_named(&dir, INSTALL_INFO_LOCK_FILE_NAME)
        .map_err(|err| std::io::Error::other(err.to_string()))?;
    let mut rendered =
        serde_json::to_string_pretty(record).expect("InstallInfoRecord must always serialize");
    rendered.push('\n');
    let path = install_info_path(target_dir);
    crate::cli::atomic_write::write_atomic_with_mode(&path, rendered.as_bytes(), FILE_MODE)
}

/// Why a read did not produce a usable [`InstallInfoRecord`], for a
/// caller that needs to tell "nobody chose this" apart from "the
/// target opted out." `read_install_info` collapses both into `None`
/// for callers that only need a yes/no; callers that need to warn on
/// a broken record specifically use this type instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InstallInfoAbsence {
    /// No file at `install_info_path(target_dir)` -- the target's own
    /// `--no-telemetry` choice, made either at install or at a later
    /// `update --no-telemetry` (which deletes an existing record over
    /// an enabled target, rather than merely skipping that run's own
    /// write -- see `update.rs`'s carry-forward block).
    NotFound,
    /// A file exists but is not a record anyone chose to write this
    /// way: unreadable (I/O error), not valid JSON, or a
    /// `schema_version` this binary does not recognize. Nobody opted
    /// out; something wrote, or left, a file that cannot be trusted.
    Broken,
}

/// One filesystem read, three outcomes: `Ok` (a valid, current-schema
/// record), or `Err` naming which of the two ways a record can fail to
/// read back (see [`InstallInfoAbsence`]). `read_install_info` is a
/// thin projection of this that keeps its own `Option` contract for
/// `report_*`'s consent gates. Callers that need to warn specifically
/// on a broken record (as opposed to a plain opt-out) use this
/// function directly instead.
pub(crate) fn read_install_info_detailed(
    target_dir: &Path,
) -> Result<InstallInfoRecord, InstallInfoAbsence> {
    let path = install_info_path(target_dir);
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(InstallInfoAbsence::NotFound);
        }
        Err(_) => return Err(InstallInfoAbsence::Broken),
    };
    let record: InstallInfoRecord =
        serde_json::from_str(&contents).map_err(|_| InstallInfoAbsence::Broken)?;
    if record.schema_version != SCHEMA_VERSION {
        return Err(InstallInfoAbsence::Broken);
    }
    Ok(record)
}

/// `None` for missing, unreadable, or an unrecognized schema version.
/// No `NewerSchema` carve-out like `identity.rs`/`instance.rs`: this
/// record has no cross-process mint race to protect.
///
/// A thin projection of [`read_install_info_detailed`] for callers
/// that only need "usable or not," never why.
pub(crate) fn read_install_info(target_dir: &Path) -> Option<InstallInfoRecord> {
    read_install_info_detailed(target_dir).ok()
}

/// Whether `install_info_path(target_dir)` exists on disk at all --
/// deliberately a plain existence check, not
/// `read_install_info(target_dir).is_some()`. Test-only: used by
/// tests in this module and in `update.rs` that assert mere
/// presence/absence rather than validated content.
#[cfg(test)]
pub(crate) fn install_info_exists(target_dir: &Path) -> bool {
    install_info_path(target_dir).exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-install-info-test-{name}-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed_dist_version(source_root: &Path, contents: &str) {
        let dist_dir = source_root.join("dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("VERSION"), contents).unwrap();
    }

    #[test]
    fn fresh_install_writes_record_with_all_four_fields() {
        let target = scratch_dir("fresh-install-target");
        let source = scratch_dir("fresh-install-source");
        seed_dist_version(&source, "1.2.3\n");

        write_install_info(&target, &source, "kiro-cli-v2", "2026-01-15T09:30:00Z").unwrap();

        let record = read_install_info(&target).expect("must read back");
        assert_eq!(record.schema_version, SCHEMA_VERSION);
        assert_eq!(record.agent_version, Some("1.2.3".to_string()));
        assert_eq!(record.harness, "kiro-cli-v2");
        assert_eq!(record.installed_at, "2026-01-15T09:30:00Z");

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn fresh_install_record_has_four_json_keys_on_disk() {
        let target = scratch_dir("json-keys-target");
        let source = scratch_dir("json-keys-source");
        seed_dist_version(&source, "0.5.0");

        write_install_info(&target, &source, "claude", "2026-02-01T00:00:00Z").unwrap();

        let contents = fs::read_to_string(install_info_path(&target)).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        let obj = parsed.as_object().unwrap();
        for key in ["schema_version", "agent_version", "harness", "installed_at"] {
            assert!(obj.contains_key(key), "missing expected key: {key}");
        }
        assert_eq!(
            obj.len(),
            4,
            "record must have exactly four keys, got {obj:?}"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn agent_version_resolved_from_local_from_checkout_root() {
        let repo_root = scratch_dir("local-checkout-repo-root");
        seed_dist_version(&repo_root, "2.0.0\n");
        assert_eq!(
            agent_version_from_source(&repo_root),
            Some("2.0.0".to_string())
        );
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn agent_version_resolved_from_unpacked_release_artifact_temp_dir() {
        let temp_dir = scratch_dir("release-artifact-temp-dir");
        seed_dist_version(&temp_dir, "3.1.4\n");
        assert_eq!(
            agent_version_from_source(&temp_dir),
            Some("3.1.4".to_string())
        );
        fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn agent_version_resolved_from_branch_dist_fallback_temp_dir() {
        let temp_dir = scratch_dir("branch-dist-fallback-temp-dir");
        seed_dist_version(&temp_dir, "1.9.9-beta\n");
        assert_eq!(
            agent_version_from_source(&temp_dir),
            Some("1.9.9-beta".to_string())
        );
        fs::remove_dir_all(&temp_dir).ok();
    }

    #[test]
    fn missing_version_file_degrades_to_none_not_a_fabricated_default() {
        let source = scratch_dir("no-version-file-source");
        fs::create_dir_all(source.join("dist")).unwrap();
        assert_eq!(agent_version_from_source(&source), None);
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn missing_dist_directory_entirely_degrades_to_none() {
        let source = scratch_dir("no-dist-dir-source");
        assert_eq!(agent_version_from_source(&source), None);
        fs::remove_dir_all(&source).ok();
    }

    /// Only pins the return value; the warning itself goes to stderr,
    /// which is not captured here.
    #[cfg(unix)]
    #[test]
    fn unreadable_version_file_degrades_to_none_not_a_fabricated_default() {
        use std::os::unix::fs::PermissionsExt;

        // Root ignores file permission bits entirely, so this test
        // would be a false pass under `cargo test` as root (e.g. some
        // CI containers) -- skip visibly rather than silently pass
        // for the wrong reason.
        let is_root = std::process::Command::new("id")
            .arg("-u")
            .output()
            .ok()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim() == "0")
            .unwrap_or(false);
        if is_root {
            eprintln!(
                "SKIPPED unreadable_version_file_degrades_to_none_not_a_fabricated_default: \
                 running as root, which ignores file permission bits -- this test cannot \
                 exercise a real EACCES under root."
            );
            return;
        }

        let source = scratch_dir("unreadable-version-source");
        let dist_dir = source.join("dist");
        fs::create_dir_all(&dist_dir).unwrap();
        let version_path = dist_dir.join("VERSION");
        fs::write(&version_path, "1.2.3\n").unwrap();
        fs::set_permissions(&version_path, fs::Permissions::from_mode(0o000)).unwrap();

        assert_eq!(
            agent_version_from_source(&source),
            None,
            "an unreadable VERSION file must degrade to None, never fabricate a version"
        );

        fs::set_permissions(&version_path, fs::Permissions::from_mode(0o644)).unwrap();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn empty_version_file_degrades_to_none() {
        let source = scratch_dir("empty-version-source");
        seed_dist_version(&source, "");
        assert_eq!(agent_version_from_source(&source), None);
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn whitespace_only_version_file_degrades_to_none() {
        let source = scratch_dir("whitespace-version-source");
        seed_dist_version(&source, "   \n\t\n");
        assert_eq!(agent_version_from_source(&source), None);
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn version_file_trailing_newline_is_trimmed() {
        let source = scratch_dir("trailing-newline-source");
        seed_dist_version(&source, "0.1.0\n");
        assert_eq!(
            agent_version_from_source(&source),
            Some("0.1.0".to_string())
        );
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn fresh_install_with_no_version_file_writes_record_with_null_agent_version() {
        let target = scratch_dir("no-version-target");
        let source = scratch_dir("no-version-source");
        fs::create_dir_all(source.join("dist")).unwrap();

        write_install_info(&target, &source, "kiro-v3", "2026-03-01T00:00:00Z").unwrap();

        let record = read_install_info(&target).expect("must read back");
        assert_eq!(record.agent_version, None);
        assert_eq!(record.harness, "kiro-v3");

        let contents = fs::read_to_string(install_info_path(&target)).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert!(
            parsed["agent_version"].is_null(),
            "agent_version must serialize as an explicit JSON null, not be omitted"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn install_info_coexists_with_instance_and_manifest_files_in_one_konductor_dir() {
        let home = scratch_dir("three-file-coexistence-home");

        let source = scratch_dir("three-file-coexistence-source");
        seed_dist_version(&source, "4.5.6\n");
        write_install_info(&home, &source, "claude", "2026-04-01T00:00:00Z").unwrap();

        let instance_record = super::super::instance::ensure_instance(&home, true);

        // manifest.rs -- same target_dir.
        let manifest = crate::cli::install::manifest::StrategyManifest::new(
            "claude",
            "2026-04-01T00:00:00Z",
            ".",
            None,
            crate::cli::install::manifest::Status::Complete,
            vec![],
        );
        crate::cli::install::manifest::upsert_strategy(&home, manifest).unwrap();

        let konductor_dir = home.join(KONDUCTOR_DIR_NAME);
        assert!(install_info_path(&home).is_file());
        assert!(super::super::instance::instance_path(&home).is_file());
        assert!(crate::cli::install::manifest::manifest_path(&home).is_file());
        let names: std::collections::BTreeSet<String> = fs::read_dir(&konductor_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            // `.manifest.lock` and `.install-info.lock` are per-target
            // advisory lock sidecars `manifest::upsert_strategy` and
            // `write_install_info` each leave behind on disk once
            // acquired at least once -- real, expected artifacts of this
            // test's own two writes above, but not part of the three
            // content files this test's own invariant is about.
            .filter(|name| name != ".manifest.lock" && name != ".install-info.lock")
            .collect();
        assert_eq!(
            names,
            std::collections::BTreeSet::from([
                "install-info.json".to_string(),
                "telemetry.json".to_string(),
                "manifest".to_string(),
            ]),
            "expected exactly these three filenames in one .konductor/ dir, got {names:?}"
        );

        let reread_install_info = read_install_info(&home).unwrap();
        assert_eq!(reread_install_info.agent_version, Some("4.5.6".to_string()));
        assert_eq!(reread_install_info.harness, "claude");

        let reread_instance = super::super::instance::read_instance(&home).unwrap();
        assert_eq!(reread_instance.uuid, instance_record.uuid);

        let reread_manifest = crate::cli::install::manifest::read_manifest(&home)
            .unwrap()
            .unwrap();
        assert_eq!(reread_manifest.strategy_names(), vec!["claude"]);

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn second_install_of_same_target_overwrites_with_new_run_own_values() {
        let target = scratch_dir("second-install-target");
        let source_v1 = scratch_dir("second-install-source-v1");
        seed_dist_version(&source_v1, "1.0.0\n");
        write_install_info(&target, &source_v1, "kiro-cli-v2", "2026-01-01T00:00:00Z").unwrap();

        let first = read_install_info(&target).unwrap();
        assert_eq!(first.agent_version, Some("1.0.0".to_string()));

        let source_v2 = scratch_dir("second-install-source-v2");
        seed_dist_version(&source_v2, "1.1.0\n");
        write_install_info(&target, &source_v2, "kiro-cli-v2", "2026-02-01T00:00:00Z").unwrap();

        let second = read_install_info(&target).unwrap();
        assert_eq!(second.agent_version, Some("1.1.0".to_string()));
        assert_eq!(second.installed_at, "2026-02-01T00:00:00Z");
        assert_ne!(
            first.agent_version, second.agent_version,
            "a second install with new content must overwrite the old agent_version"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source_v1).ok();
        fs::remove_dir_all(&source_v2).ok();
    }

    #[test]
    fn record_still_exists_and_is_well_formed_after_second_install() {
        let target = scratch_dir("record-survives-target");
        let source = scratch_dir("record-survives-source");
        seed_dist_version(&source, "2.2.2\n");
        write_install_info(&target, &source, "claude", "2026-01-01T00:00:00Z").unwrap();
        write_install_info(&target, &source, "claude", "2026-01-02T00:00:00Z").unwrap();

        assert!(install_info_path(&target).is_file());
        let record = read_install_info(&target).expect("must still read back after two writes");
        assert_eq!(record.schema_version, SCHEMA_VERSION);
        assert_eq!(record.agent_version, Some("2.2.2".to_string()));

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[cfg(unix)]
    #[test]
    fn file_is_written_with_0o600_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let target = scratch_dir("permissions-target");
        let source = scratch_dir("permissions-source");
        seed_dist_version(&source, "1.0.0\n");
        write_install_info(&target, &source, "kiro-cli-v2", "2026-01-01T00:00:00Z").unwrap();

        let mode = fs::metadata(install_info_path(&target))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(
            mode, 0o600,
            "install-info.json carries harness/agent_version/install-time and must not be \
             world-readable on a shared host"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn install_info_filename_is_disjoint_from_sibling_konductor_files() {
        let home = scratch_dir("filename-disjointness-home");
        assert_ne!(
            install_info_path(&home).file_name(),
            super::super::identity::identity_path(&home).file_name()
        );
        assert_ne!(
            install_info_path(&home).file_name(),
            super::super::instance::instance_path(&home).file_name()
        );
        assert_ne!(
            install_info_path(&home).file_name().map(|n| n.to_owned()),
            crate::cli::install::manifest::manifest_path(&home)
                .file_name()
                .map(|n| n.to_owned())
        );
        fs::remove_dir_all(&home).ok();
    }

    // ── install_info_exists: a bare presence check, test-only ───────────

    #[test]
    fn install_info_exists_reflects_plain_presence_including_corrupted_content() {
        let target = scratch_dir("exists-plain-presence-target");
        let source = scratch_dir("exists-plain-presence-source");
        seed_dist_version(&source, "1.0.0\n");

        assert!(
            !install_info_exists(&target),
            "must be false before any write"
        );

        write_install_info(&target, &source, "kiro-cli-v2", "2026-01-01T00:00:00Z").unwrap();
        assert!(install_info_exists(&target), "must be true once written");

        // Overwrite with corrupted content: read_install_info now
        // reports None, but the file itself is still genuinely present.
        fs::write(install_info_path(&target), b"not json").unwrap();
        assert_eq!(read_install_info(&target), None);
        assert!(
            install_info_exists(&target),
            "the bare existence check does not distinguish corrupted content from a clean \
             write -- this is exactly why it is no longer the production consent read"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn install_info_exists_is_false_when_neither_file_present() {
        let target = scratch_dir("exists-neither-file-target");
        assert!(!install_info_exists(&target));
        fs::remove_dir_all(&target).ok();
    }

    // ── Unlocked read-check-then-delete race vs. a concurrent write ─────
    //
    // Composing an unlocked `read_install_info_detailed` with a later,
    // separately unlocked `remove_install_info` call -- as `update.rs`'s
    // sticky opt-out would without `read_and_maybe_remove_locked` --
    // leaves a gap for a concurrent `write_install_info` call to land a
    // fresh record in between the two. `read_and_maybe_remove_locked`
    // closes that gap by running both steps inside one critical section
    // under `INSTALL_INFO_LOCK_FILE_NAME`, the same lock `write_record`
    // holds for its own write. Mirrors `uninstall.rs`'s own
    // `old_unlocked_delete_then_locked_remove_sequence_corrupts_a_racing_kiro_variant_override`
    // / `delete_and_remove_strategy_locked_never_deletes_a_racing_kiro_variant_overrides_files`
    // pair for the identical shape of race on a different document.

    /// Not itself the regression test for the locked fix -- see the next
    /// test for that.
    #[test]
    fn old_unlocked_read_then_delete_sequence_destroys_a_racing_concurrent_write() {
        let target = scratch_dir("unlocked-race-old-sequence-target");
        let source = scratch_dir("unlocked-race-old-sequence-source");
        seed_dist_version(&source, "1.0.0\n");

        // An existing enabled record, as if this target was installed
        // earlier with telemetry on.
        write_install_info(&target, &source, "kiro-cli-v2", "2026-01-10T00:00:00Z").unwrap();

        // The UNLOCKED read the old carry-forward composition
        // performed, captured here exactly as it would be.
        let stale_read = read_install_info_detailed(&target);
        assert!(
            stale_read.is_ok(),
            "sanity check: the stale read must see the existing record"
        );

        // A concurrent writer (e.g. `install --harness claude`,
        // telemetry on) completing ENTIRELY in the gap: a fresh record
        // superseding the one just read.
        write_install_info(&target, &source, "claude", "2026-01-10T00:05:00Z").unwrap();
        assert_eq!(
            read_install_info(&target).map(|r| r.harness),
            Some("claude".to_string()),
            "sanity check: the concurrent writer's fresh record really did land"
        );

        // The old sequence: delete unconditionally, driven only by the
        // STALE read's `Ok`-ness above, with no fresh re-check.
        remove_install_info(&target).unwrap();

        // The corruption: the concurrent writer's fresh, successfully
        // committed record is gone -- destroyed by a delete decision
        // made from a snapshot taken before that write ever happened.
        assert!(
            !install_info_exists(&target),
            "CORRUPTED STATE reproduced: the concurrent writer's fresh record was destroyed \
             by the stale-read-driven delete"
        );

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }

    /// The regression test for the fix (see the test above for the
    /// unprotected pattern it's regressing against).
    #[test]
    fn read_and_maybe_remove_locked_never_loses_a_racing_concurrent_write() {
        let target = scratch_dir("locked-race-target");
        let source = scratch_dir("locked-race-source");
        seed_dist_version(&source, "1.0.0\n");

        // An existing enabled record -- `read_and_maybe_remove_locked`'s
        // fresh read must see this as `Ok`, triggering a removal
        // attempt.
        write_install_info(&target, &source, "kiro-cli-v2", "2026-01-01T00:00:00Z").unwrap();

        let (paused_tx, paused_rx) = std::sync::mpsc::channel::<()>();
        let (unblock_tx, unblock_rx) = std::sync::mpsc::channel::<()>();

        // `LOCKED_READ_SYNC_HOOK` is a `thread_local!` -- it must be set
        // on the SAME thread that will later call
        // `read_and_maybe_remove_locked` and consult it, not on this
        // (main) test thread. Setting it here would silently leave
        // thread A's own copy at its default `None`, so A would never
        // pause at all and `paused_rx.recv()` below would block forever
        // waiting for a signal nothing ever sends.
        let target_for_a = target.clone();
        let handle_a = std::thread::spawn(move || {
            LOCKED_READ_SYNC_HOOK.with(|hook| {
                *hook.borrow_mut() = Some(Box::new(move || {
                    // Signal the main thread that the lock is held and
                    // the fresh read has completed, then block until
                    // told to proceed -- holding the critical section
                    // open for the whole pause.
                    paused_tx.send(()).unwrap();
                    unblock_rx.recv().unwrap();
                }));
            });
            read_and_maybe_remove_locked(&target_for_a, true)
        });

        // Wait for A to be paused mid-critical-section, still holding
        // the lock.
        paused_rx.recv().unwrap();

        // A concurrent writer attempting to write while A still holds
        // the lock: must block on `write_record`'s own lock acquisition
        // rather than racing A's in-flight read-check-delete.
        let target_for_b = target.clone();
        let source_for_b = source.clone();
        let handle_b = std::thread::spawn(move || {
            write_install_info(
                &target_for_b,
                &source_for_b,
                "claude",
                "2026-01-02T00:00:00Z",
            )
        });

        // Not a correctness requirement (the assertions below hold
        // regardless of real scheduling order once the lock is
        // released) -- gives B a realistic chance to actually attempt,
        // and block on, the lock before A is released, rather than B
        // merely running entirely after A by scheduling luck alone.
        std::thread::sleep(std::time::Duration::from_millis(50));

        // Release A: it completes its fresh read-check-delete and drops
        // the lock, which must let B's blocked write proceed.
        unblock_tx.send(()).unwrap();

        let (a_read, a_remove_error) = handle_a.join().expect("thread A must not panic");
        assert!(
            a_read.is_ok(),
            "A's fresh read must see the seeded enabled record"
        );
        assert!(
            a_remove_error.is_none(),
            "A's removal must succeed: {a_remove_error:?}"
        );

        handle_b.join().expect("thread B must not panic").expect(
            "B's write must succeed once A releases the lock, not be lost or blocked \
                 forever",
        );

        let final_record = read_install_info(&target)
            .expect("B's write must still be readable after the race -- it must not be lost");
        assert_eq!(final_record.harness, "claude");

        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&source).ok();
    }
}
