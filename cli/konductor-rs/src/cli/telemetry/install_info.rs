// SPDX-License-Identifier: Apache-2.0
//
// telemetry/install_info.rs — `<target_dir>/.konductor/install-info.json`
// schema, `agent_version` derivation, and write mechanics.
//
// `agent_version` is the installed content's own version, reported
// separately from the running binary's version, which reaches every
// telemetry event as the envelope's own `Version` and needs no copy
// here.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::super::config::KONDUCTOR_DIR_NAME;

/// Independent of `identity::SCHEMA_VERSION`/`instance::SCHEMA_VERSION`.
pub(crate) const SCHEMA_VERSION: u64 = 1;

const INSTALL_INFO_FILE_NAME: &str = "install-info.json";

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
/// unconditionally, via `atomic_write`'s temp-file-then-`rename` (not
/// `identity.rs`/`instance.rs`'s temp-then-`hard_link`: those are
/// create-once records where a second writer must lose and read the
/// first writer's file back, but this record is rewritten on every
/// install by design, so it needs an overwrite-safe rename rather than
/// an exclusive-create link).
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

/// Concurrent installs to the same `target_dir` with different
/// harnesses each call this independently, after their own
/// `manifest::upsert_strategy` call has already returned (dropping
/// that call's lock) -- so nothing here is protected by the manifest
/// lock. `atomic_write::write_atomic_with_mode`'s temp-file-then-
/// `rename` means a reader always sees either the previous record or
/// this one in full, never a torn write from an interleaved truncate.
fn write_record(target_dir: &Path, record: &InstallInfoRecord) -> std::io::Result<()> {
    let dir = target_dir.join(KONDUCTOR_DIR_NAME);
    std::fs::create_dir_all(&dir)?;
    let mut rendered =
        serde_json::to_string_pretty(record).expect("InstallInfoRecord must always serialize");
    rendered.push('\n');
    let path = install_info_path(target_dir);
    crate::cli::atomic_write::write_atomic_with_mode(&path, rendered.as_bytes(), FILE_MODE)
}

/// Why a read did not produce a usable [`InstallInfoRecord`], for a
/// caller that needs to tell "nobody chose this" apart from "the
/// target opted out." `report_*`'s plain `read_install_info` collapses
/// all three into `None`, which is exactly right there -- opted-out and
/// broken are both "do not report," and no caller in that group needs
/// to say why. `check_telemetry_state` (`doctor.rs`) and `update`'s
/// opt-out carry-forward (`update.rs`) are the two callers that DO need
/// to explain a `None`-shaped result -- both warn on `Broken` rather
/// than silently treating it as `NotFound` -- hence this variant
/// alongside the existing `Option`-returning function rather than a
/// changed return type on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InstallInfoAbsence {
    /// No file at `install_info_path(target_dir)` -- the target's own
    /// `--no-telemetry` choice at install.
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
/// `report_*`'s consent gates, which are unaffected by this function
/// existing. Two callers need the WHY instead: `check_telemetry_state`
/// (`doctor.rs`), the original reason this function was added --
/// it used to call `read_install_info` then `install_info_exists` as
/// two separate filesystem accesses to answer the same question this
/// single read now answers directly -- and `update`'s opt-out
/// carry-forward (`update.rs`), which warns on `Broken` rather than
/// silently carrying it forward as an ordinary opt-out.
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
/// A thin projection of [`read_install_info_detailed`]: `report_*`'s
/// consent gates only ever need "usable or not," never why, so they
/// keep using this `Option` contract rather than taking on
/// `InstallInfoAbsence` for no benefit. `update`'s carry-forward
/// (`update.rs`) calls `read_install_info_detailed` directly instead,
/// since -- unlike `report_*` -- it needs to warn on a broken record
/// rather than treat it the same as a genuine opt-out.
pub(crate) fn read_install_info(target_dir: &Path) -> Option<InstallInfoRecord> {
    read_install_info_detailed(target_dir).ok()
}

/// Whether `install_info_path(target_dir)` exists on disk at all --
/// deliberately a plain existence check, not
/// `read_install_info(target_dir).is_some()`.
///
/// No production code calls this anymore. `doctor`'s telemetry-state
/// check was the last caller, and Fix 1 (the two-read race) replaced
/// its two-call `read_install_info` + `install_info_exists` sequence
/// with one call to `read_install_info_detailed`, which distinguishes
/// absent from broken from a single filesystem access -- the reason
/// this function existed. It stays for the tests in this module and
/// in `update.rs` that assert install-info's mere presence/absence
/// (as opposed to `read_install_info`'s validated content), where a
/// second filesystem read carries none of `check_telemetry_state`'s
/// TOCTOU risk. This doc comment has drifted to describe a caller
/// that no longer exists twice before; if a real caller reappears,
/// update it again to name that caller specifically rather than
/// leaving this note stale a third time.
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

    /// FIX 3 regression: a genuine permission error reading `VERSION`
    /// (as opposed to the file simply not existing) must still
    /// degrade to `None`, never be fabricated -- but the two causes
    /// are no longer silently conflated into identical behavior with
    /// no warning. This test only pins the return value (the
    /// unreadable-vs-absent distinction's externally observable
    /// contract); the warning itself goes to stderr, which is not
    /// captured here.
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
            .filter(|name| name != ".manifest.lock")
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

    /// `install_info_exists` is a plain existence check: false before
    /// any write, true once `write_install_info` publishes the file,
    /// and still true for a file whose content is corrupted -- it does
    /// not distinguish "wrote successfully" from "wrote something."
    /// This is exactly why no production consent decision reads it
    /// anymore (see its own doc comment): `read_install_info` is the
    /// validated read `update`, `doctor`, and `report_*` all consult.
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

    /// A target with neither `install-info.json` nor any other
    /// `.konductor` content present must not be reported as opted in.
    #[test]
    fn install_info_exists_is_false_when_neither_file_present() {
        let target = scratch_dir("exists-neither-file-target");
        assert!(!install_info_exists(&target));
        fs::remove_dir_all(&target).ok();
    }
}
