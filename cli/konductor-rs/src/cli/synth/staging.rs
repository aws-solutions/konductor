// SPDX-License-Identifier: Apache-2.0
//
// synth/staging.rs — shared atomic content-type staging helper, used by
// every `HarnessTransformer` that writes a directory tree per content
// type (agents/skills/sops/context) under `output_root.join(name())`.
//
// Extracted from `kiro_cli_v2.rs` (its original, and still primary,
// caller) when `claude.rs` needed the identical rename-old-away /
// rename-new-in / remove-old atomic-swap contract: duplicating this
// logic across transformers would mean duplicating its concurrency and
// crash-safety reasoning too, and letting the two copies drift is worse
// than a shared, single-source-of-truth module. `unique_suffix` moved
// alongside it since `stage_content_type` is its only caller.

use std::fs;
use std::path::Path;

/// Writes one content type's output into a fresh sibling temp directory
/// under `base_dir` (via `populate`), then swaps it into place at
/// `base_dir/content_type_dir`. The swap is a rename-old-away /
/// rename-new-in / remove-old sequence (never a delete-then-rename), so
/// at every point -- including a crash between any two of these steps --
/// `target_dir` exists and is a complete tree: either the previous
/// output (untouched or recoverable from the backup dir) or the new one,
/// never neither. On a `populate` failure the staging directory is
/// removed and `target_dir` is untouched.
pub(crate) fn stage_content_type(
    base_dir: &Path,
    content_type_dir: &str,
    populate: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    fs::create_dir_all(base_dir)
        .map_err(|e| format!("failed to create directory {}: {e}", base_dir.display()))?;
    let target_dir = base_dir.join(content_type_dir);
    let staging_dir = base_dir.join(format!("{content_type_dir}.staging-{}", unique_suffix()));
    fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("failed to create directory {}: {e}", staging_dir.display()))?;

    let result = populate(&staging_dir);
    if let Err(err) = result {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(err);
    }

    // Swap via rename-old-away / rename-new-in / remove-old, never
    // delete-then-rename: if `target_dir` doesn't exist yet (first
    // synth), skip straight to the rename-in step. Otherwise move it
    // aside first so a crash between steps still leaves `target_dir`
    // populated -- either the pre-swap tree (rename it back) or the
    // post-swap one.
    let backup_dir = base_dir.join(format!("{content_type_dir}.prev-{}", unique_suffix()));
    let had_prior = target_dir.exists();
    if had_prior {
        if let Err(e) = fs::rename(&target_dir, &backup_dir) {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(format!(
                "failed to move prior {} aside to {}: {e}",
                target_dir.display(),
                backup_dir.display()
            ));
        }
    }
    if let Err(e) = fs::rename(&staging_dir, &target_dir) {
        let _ = fs::remove_dir_all(&staging_dir);
        if had_prior {
            let _ = fs::rename(&backup_dir, &target_dir);
        }
        return Err(format!(
            "failed to move {} into place at {}: {e}",
            staging_dir.display(),
            target_dir.display()
        ));
    }
    if had_prior {
        let _ = fs::remove_dir_all(&backup_dir);
    }
    Ok(())
}

/// Process-local counter mixed into `unique_suffix`'s output so two
/// calls in the same process never produce the same token, even when
/// `SystemTime::now()` returns the same nanosecond twice in a row.
/// `Relaxed` ordering is sufficient: callers only need distinct values,
/// not any particular ordering relative to other memory operations.
static SUFFIX_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A unique token for a staging directory name: current Unix time in
/// nanoseconds, the process id, and a process-local counter. Distinct
/// across concurrent processes (pid) and across calls within one
/// process (counter), so two invocations can never collide (same bar
/// as `atomic_write.rs`'s own suffix).
fn unique_suffix() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let counter = SUFFIX_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{nanos}-{}-{counter}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-staging-test-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// When the rename-in step fails after the prior output has already
    /// been moved aside, the backup is restored: `target_dir` ends up
    /// with its original contents rather than being left empty or with
    /// the (undone) new output.
    #[test]
    fn stage_content_type_restores_backup_when_rename_in_fails() {
        let dir = temp_dir("restore-on-rename-in-failure");
        fs::create_dir_all(&dir).unwrap();

        let target_dir = dir.join("agents");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("prior.json"), b"prior").unwrap();

        // Removing the staging directory from inside `populate` (after
        // it returns `Ok`) makes the rename-in step fail with ENOENT,
        // without disturbing the rename-old-away step that precedes it.
        let result = stage_content_type(&dir, "agents", |staging_dir| {
            fs::write(staging_dir.join("new.json"), b"new").unwrap();
            fs::remove_dir_all(staging_dir).unwrap();
            Ok(())
        });

        assert!(result.is_err(), "expected the rename-in step to fail");
        assert_eq!(
            fs::read_to_string(target_dir.join("prior.json")).unwrap(),
            "prior"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Basic success path: `populate` writes a file, and it lands under
    /// `base_dir/content_type_dir` after the swap.
    #[test]
    fn stage_content_type_writes_populate_output_into_target_dir() {
        let dir = temp_dir("basic-success");
        stage_content_type(&dir, "skills", |staging_dir| {
            fs::write(staging_dir.join("example.txt"), b"hello").unwrap();
            Ok(())
        })
        .unwrap();

        let written = dir.join("skills").join("example.txt");
        assert!(written.exists());
        assert_eq!(fs::read_to_string(&written).unwrap(), "hello");

        let _ = fs::remove_dir_all(&dir);
    }

    /// A `populate` failure leaves `target_dir` untouched (never created
    /// if it didn't already exist) and cleans up the staging directory.
    #[test]
    fn stage_content_type_populate_failure_leaves_target_dir_untouched() {
        let dir = temp_dir("populate-failure");
        let result = stage_content_type(&dir, "context", |_staging_dir| {
            Err("populate failed".to_string())
        });

        assert!(result.is_err());
        assert!(!dir.join("context").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
