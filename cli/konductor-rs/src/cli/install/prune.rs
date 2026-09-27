// SPDX-License-Identifier: Apache-2.0
//! Removal of files a prior install recorded that a new install of the
//! same strategy no longer writes.
//!
//! Every install strategy rewrites its manifest slot from what the
//! current run wrote. A file the previous run wrote but the new source
//! no longer contains (a whole agent, skill, SOP or context file removed
//! upstream, or a skill that moved to a different install root) would
//! otherwise stay on disk and drop out of the manifest, so no later
//! `uninstall` could find it. `remove_source_deleted_files` runs after
//! the new slot is written `Complete` and deletes those files, but only
//! when doing so cannot destroy anything that is not provably ours:
//!
//! - the prior slot recorded the file as `Created` or `ReplacedOurs`
//!   (never `ReplacedForeign`), with a content hash;
//! - the file on disk is a regular file (not a symlink) whose current
//!   hash still equals that recorded hash, so a user edit is preserved;
//! - no strategy slot in the manifest as it now stands (this strategy's
//!   new slot included) names the path, and this run did not write it
//!   (`written_untracked`: files a run writes but deliberately leaves out
//!   of its own slot, such as the dual-marker `.claude/skills/sop-*`
//!   conversions a Kiro install writes for Claude Code);
//! - the path is not `.claude/settings.json`, which is shared with the
//!   user and only ever partially ours (see `uninstall`'s
//!   `delete_eligible_files`).
//!
//! The whole decision and every deletion happen while holding the
//! per-target manifest lock (`manifest::with_manifest_locked`), on a
//! manifest read inside that lock. Another install records its paths
//! (its `InProgress` slot) under the same lock before it copies
//! anything, so a path it is about to restore is either already named
//! in the manifest this module reads, and kept, or is written by that
//! install only after this module has finished.
//!
//! Directories emptied by a deletion are removed up to, but never
//! including, the runtime roots and `.kiro/skills/` (the same roots
//! `uninstall` protects). Failures are reported as warnings and never
//! fail the install, which has already succeeded by the time this runs.
//! A crash part-way leaves the remaining files exactly as they were
//! before this module existed: on disk and untracked.
//!
//! # Invariants
//!
//! 1. Only a path the previous slot of this strategy recorded is ever a
//!    candidate; nothing is discovered by scanning the filesystem.
//! 2. A candidate is deleted only if no slot in the manifest read under
//!    the lock names it, and this run did not write it untracked.
//! 3. The manifest read, every eligibility check, every deletion and the
//!    directory pruning all happen inside one hold of the per-target
//!    manifest lock, the same lock every install takes before recording
//!    the paths it will write.
//! 4. Content is deleted only when it is byte-identical to what the
//!    previous install recorded (hash match), was written by Konductor
//!    (`Created`/`ReplacedOurs`), is a regular file, and is not the shared
//!    `.claude/settings.json`.
//! 5. Paths stay inside `target_dir`: normal components only, and no
//!    directory between `target_dir` and the file may be a symlink.
//! 6. Pruning never removes `target_dir`, a runtime root or `.kiro/skills`.
//! 7. Any failure leaves files in place and never fails the install.
//!
//! The reasoning behind this design is recorded in
//! `docs/design/install-prune.md`.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use super::artifact::sha256_hex;
use super::manifest::{with_manifest_locked, Manifest, ManifestFile, Provenance, StrategyManifest};
use super::resource_rewrite::CLAUDE_SETTINGS_RELATIVE_PATH;

/// Directories under `target_dir` that pruning never removes, even when
/// empty: the runtime roots and Kiro's native skills directory, which
/// may hold content Konductor never wrote.
const PROTECTED_DIRS: &[&str] = &[".kiro", ".konductor", ".claude", ".kiro/skills"];

/// Deletes the files `prior_slot` recorded that no current manifest slot
/// names any more, under the rules in this module's doc comment.
/// Returns how many files were deleted. `prior_slot` is the slot this
/// run's provenance classification used (see
/// `manifest::effective_prior_slot`); `None` means a fresh install with
/// nothing to prune. `written_untracked` lists files this run wrote but
/// left out of every slot; they are never deleted.
pub(crate) fn remove_source_deleted_files(
    target_dir: &Path,
    prior_slot: Option<&StrategyManifest>,
    written_untracked: &[ManifestFile],
) -> usize {
    let Some(prior) = prior_slot else {
        return 0;
    };
    match with_manifest_locked(target_dir, |current| {
        remove_unnamed(target_dir, prior, current, written_untracked)
    }) {
        Ok(deleted) => deleted,
        Err(err) => {
            eprintln!(
                "konductor install: warning: could not lock and re-read the manifest to remove \
                 files the new source dropped ({err}); leaving them in place"
            );
            0
        }
    }
}

/// The body of `remove_source_deleted_files`, run with the manifest lock
/// held and `current` read inside it.
fn remove_unnamed(
    target_dir: &Path,
    prior: &StrategyManifest,
    current: Option<&Manifest>,
    written_untracked: &[ManifestFile],
) -> usize {
    let mut still_named: HashSet<String> = current
        .map(|manifest| {
            manifest
                .strategies
                .iter()
                .flat_map(|slot| slot.files.iter().map(|f| f.path.clone()))
                .collect()
        })
        .unwrap_or_default();
    still_named.extend(written_untracked.iter().map(|f| f.path.clone()));

    let mut deleted = 0;
    let mut touched: Vec<PathBuf> = Vec::new();
    for file in &prior.files {
        if still_named.contains(&file.path)
            || file.path == CLAUDE_SETTINGS_RELATIVE_PATH
            || file.provenance == Provenance::ReplacedForeign
        {
            continue;
        }
        let Some(recorded) = file.sha256.as_deref() else {
            continue;
        };
        let Some(relative) = safe_relative(&file.path) else {
            continue;
        };
        if has_symlinked_ancestor(target_dir, relative) {
            continue;
        }
        let path = target_dir.join(relative);
        match std::fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_file() => {}
            _ => continue,
        }
        let current = match std::fs::read(&path) {
            Ok(bytes) => sha256_hex(&bytes),
            Err(_) => continue,
        };
        if current != recorded {
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => {
                deleted += 1;
                if let Some(parent) = path.parent() {
                    touched.push(parent.to_path_buf());
                }
            }
            Err(err) => eprintln!(
                "konductor install: warning: could not remove {}, which the new source no longer \
                 contains: {err}",
                path.display()
            ),
        }
    }
    prune_empty_dirs(target_dir, &touched);
    deleted
}

/// A manifest path that stays inside `target_dir`: relative, and made of
/// normal components only.
fn safe_relative(raw: &str) -> Option<&Path> {
    let rel = Path::new(raw);
    if rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(rel)
}

/// Whether any directory between `target_dir` and the file `relative`
/// names is a symlink (or cannot be inspected). A symlinked ancestor
/// could point outside `target_dir`, so such a path is never read or
/// deleted. `target_dir` itself is the caller's chosen destination and
/// is not checked.
fn has_symlinked_ancestor(target_dir: &Path, relative: &Path) -> bool {
    let mut dir = target_dir.to_path_buf();
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        if components.peek().is_none() {
            // The last component is the file itself, checked by the caller.
            return false;
        }
        dir.push(component);
        match std::fs::symlink_metadata(&dir) {
            Ok(meta) if meta.file_type().is_dir() => {}
            _ => return true,
        }
    }
    false
}

/// Removes each touched directory and then its parents while they are
/// empty, stopping at `target_dir` and at `PROTECTED_DIRS`.
fn prune_empty_dirs(target_dir: &Path, touched: &[PathBuf]) {
    let protected: HashSet<PathBuf> = PROTECTED_DIRS
        .iter()
        .map(|dir| target_dir.join(dir))
        .chain(std::iter::once(target_dir.to_path_buf()))
        .collect();
    let mut dirs: Vec<PathBuf> = touched.to_vec();
    // Deepest first, so a child is removed before its parent is tried.
    dirs.sort_by_key(|dir| std::cmp::Reverse(dir.components().count()));
    dirs.dedup();
    for start in dirs {
        let mut dir = start;
        while dir.starts_with(target_dir) && !protected.contains(&dir) {
            if std::fs::remove_dir(&dir).is_err() {
                break;
            }
            match dir.parent() {
                Some(parent) => dir = parent.to_path_buf(),
                None => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::manifest::{upsert_strategy, Status};
    use super::*;
    use std::fs;

    fn scratch_dir(label: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "konductor-prune-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    fn write(target: &Path, rel: &str, contents: &[u8]) -> ManifestFile {
        let path = target.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, contents).unwrap();
        ManifestFile {
            path: rel.to_string(),
            sha256: Some(sha256_hex(contents)),
            provenance: Provenance::Created,
        }
    }

    fn slot(name: &str, files: Vec<ManifestFile>) -> StrategyManifest {
        StrategyManifest::new(
            name,
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            files,
        )
    }

    #[test]
    fn removes_unchanged_files_the_new_slot_no_longer_names_and_prunes_their_dirs() {
        let target = scratch_dir("removes");
        let kept = write(&target, ".kiro/skills/kept/SKILL.md", b"kept\n");
        let agent = write(&target, ".kiro/agents/old.json", b"{}\n");
        let skill = write(&target, ".konductor/skills/old/scripts/run.sh", b"echo\n");
        let prior = slot("kiro-cli-v2", vec![kept.clone(), agent, skill]);
        upsert_strategy(&target, slot("kiro-cli-v2", vec![kept])).unwrap();

        assert_eq!(remove_source_deleted_files(&target, Some(&prior), &[]), 2);
        assert!(target.join(".kiro/skills/kept/SKILL.md").is_file());
        assert!(!target.join(".kiro/agents/old.json").exists());
        assert!(!target.join(".kiro/agents").exists());
        assert!(!target.join(".konductor/skills").exists());
        // Runtime roots survive even when emptied.
        assert!(target.join(".kiro").is_dir());
        assert!(target.join(".konductor").is_dir());
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn preserves_edited_foreign_symlinked_shared_and_still_named_files() {
        let target = scratch_dir("preserves");
        let edited = write(&target, ".kiro/agents/edited.json", b"{}\n");
        fs::write(target.join(".kiro/agents/edited.json"), b"{\"mine\":1}\n").unwrap();
        let mut foreign = write(&target, ".kiro/agents/foreign.json", b"{}\n");
        foreign.provenance = Provenance::ReplacedForeign;
        let settings = write(&target, ".claude/settings.json", b"{}\n");
        let mut unhashed = write(&target, ".kiro/agents/unhashed.json", b"{}\n");
        unhashed.sha256 = None;
        let other = write(&target, ".claude/agents/k.md", b"x\n");
        let link_target = write(&target, "elsewhere.txt", b"same\n");
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            target.join("elsewhere.txt"),
            target.join(".kiro/agents/link.json"),
        )
        .unwrap();
        let link = ManifestFile {
            path: ".kiro/agents/link.json".to_string(),
            sha256: link_target.sha256.clone(),
            provenance: Provenance::Created,
        };
        let escape = ManifestFile {
            path: "../outside.txt".to_string(),
            sha256: Some(sha256_hex(b"x")),
            provenance: Provenance::Created,
        };
        let rewritten = write(&target, ".claude/skills/sop-k-plan/SKILL.md", b"sop\n");
        let prior = slot(
            "kiro-cli-v2",
            vec![
                edited,
                foreign,
                settings,
                unhashed,
                other.clone(),
                link,
                escape,
                rewritten.clone(),
            ],
        );
        upsert_strategy(&target, slot("kiro-cli-v2", vec![])).unwrap();
        // Another strategy's slot still names this path.
        upsert_strategy(&target, slot("claude", vec![other])).unwrap();

        assert_eq!(
            remove_source_deleted_files(&target, Some(&prior), &[rewritten]),
            0
        );
        for rel in [
            ".kiro/agents/edited.json",
            ".kiro/agents/foreign.json",
            ".claude/settings.json",
            ".kiro/agents/unhashed.json",
            ".claude/agents/k.md",
            ".claude/skills/sop-k-plan/SKILL.md",
            "elsewhere.txt",
        ] {
            assert!(target.join(rel).is_file(), "{rel} must be preserved");
        }
        #[cfg(unix)]
        assert!(fs::symlink_metadata(target.join(".kiro/agents/link.json")).is_ok());
        fs::remove_dir_all(&target).ok();
    }

    /// A managed directory replaced by a symlink to a location outside
    /// the target must not be followed: the file behind it keeps its
    /// content even though it matches the recorded hash.
    #[cfg(unix)]
    #[test]
    fn never_follows_a_symlinked_parent_directory_outside_the_target() {
        let target = scratch_dir("symlinked-parent");
        let outside = scratch_dir("symlinked-parent-outside");
        fs::write(outside.join("old.json"), b"{}\n").unwrap();
        fs::create_dir_all(target.join(".kiro")).unwrap();
        std::os::unix::fs::symlink(&outside, target.join(".kiro/agents")).unwrap();
        let prior = slot(
            "kiro-cli-v2",
            vec![ManifestFile {
                path: ".kiro/agents/old.json".to_string(),
                sha256: Some(sha256_hex(b"{}\n")),
                provenance: Provenance::Created,
            }],
        );
        upsert_strategy(&target, slot("kiro-cli-v2", vec![])).unwrap();

        assert_eq!(remove_source_deleted_files(&target, Some(&prior), &[]), 0);
        assert!(outside.join("old.json").is_file());
        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn fresh_install_prunes_nothing() {
        let target = scratch_dir("fresh");
        assert_eq!(remove_source_deleted_files(&target, None, &[]), 0);
        fs::remove_dir_all(&target).ok();
    }

    /// Interleaving with a concurrent install: while another process
    /// holds the manifest lock, that install records the prior path in
    /// its own slot (what its `InProgress` write does before it copies
    /// anything). The pruner must wait for the lock, read that record,
    /// and keep the file. Without the lock the pruner reads the stale
    /// manifest during the pause and deletes it.
    #[test]
    fn waits_for_the_manifest_lock_and_keeps_a_path_a_concurrent_install_recorded() {
        let target = scratch_dir("concurrent");
        let file = write(&target, ".kiro/skills/shared/SKILL.md", b"same\n");
        let prior = slot("kiro-cli-v2", vec![file.clone()]);
        upsert_strategy(&target, slot("kiro-cli-v2", vec![])).unwrap();

        let lock = crate::cli::config_lock::acquire_named(
            &target.join(crate::cli::config::KONDUCTOR_DIR_NAME),
            ".manifest.lock",
        )
        .unwrap();
        let pruner = {
            let target = target.clone();
            std::thread::spawn(move || remove_source_deleted_files(&target, Some(&prior), &[]))
        };
        std::thread::sleep(std::time::Duration::from_millis(300));
        // The concurrent install's record, written while it holds the lock.
        let mut manifest = super::super::manifest::read_manifest(&target)
            .unwrap()
            .unwrap();
        manifest.upsert(slot("kiro-v3", vec![file]));
        super::super::manifest::write_manifest(&target, &manifest).unwrap();
        drop(lock);

        assert_eq!(pruner.join().unwrap(), 0);
        assert!(target.join(".kiro/skills/shared/SKILL.md").is_file());
        fs::remove_dir_all(&target).ok();
    }
}
