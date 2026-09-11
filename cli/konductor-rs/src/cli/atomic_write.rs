// SPDX-License-Identifier: Apache-2.0
//
// atomic_write.rs — generic write-temp-file-then-rename helper (Rust
// implementation).
//
// ── Scope (Feature 4.3: Storage & State — atomic-write mechanics) ─────────
// A single, reusable primitive for crash-safe file writes: write the full
// contents to a sibling temp file in the SAME directory as the target
// (guaranteeing both live on the same filesystem, which `fs::rename`
// requires for atomicity), then atomically rename it over the target
// path. A process crash/kill between the write and the rename leaves
// either the old file untouched or the temp file orphaned -- never a
// half-written target.
//
// ── Platform assumption (stated per this task's explicit instruction) ────
// This only relies on `std::fs::rename`, which is atomic on Unix (POSIX
// `rename(2)`) when source and destination are on the same filesystem.
// `std::fs::rename` on Windows (`MoveFileExW` without
// `MOVEFILE_REPLACE_EXISTING`) is NOT guaranteed to atomically replace an
// existing destination file the same way. Per
// `.kiro/skills/ws-konductor-cli-notes/SKILL.md`, this binary is built as
// the default GNU target (dynamically linked against glibc/libgcc/
// libpthread, not a static musl cross-compile), i.e. Linux-only at this
// milestone -- there is no other target this codebase currently builds
// for. Assumption: Linux/Unix rename semantics are sufficient; revisit if
// a Windows or musl target is ever added.
//
// ── Explicit file permissions ───────────────────────────────────────────────
// `std::fs::write` does not hardcode a mode -- new files default to
// `0o666 & ~umask` (commonly `0o644`, but not deterministic: it varies
// with whatever umask the calling process/environment happens to have).
// `fs::rename` preserves the SOURCE (temp) file's permissions across the
// rename, so without an explicit mode, the resulting `config.yml` would
// non-deterministically vary run-to-run depending on environment umask.
// This module explicitly sets the temp file's permissions to `0o644`
// (owner read/write, group/other read) before renaming, so output is
// deterministic regardless of umask.

use std::fs::File;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Explicit, deterministic permissions for every file `write_atomic`
/// produces -- owner read/write, group/other read, regardless of the
/// process umask. Unix-only (`std::os::unix::fs::PermissionsExt`) --
/// consistent with this module's existing platform assumption (see the
/// "Platform assumption" note above): this codebase is Linux-only at
/// this milestone, with no Windows/musl target wired up anywhere else in
/// the tree.
const FILE_MODE: u32 = 0o644;

/// Writes `contents` to `path` atomically: writes to a sibling temp file
/// (`<filename>.tmp-<unique>`, in the same directory as `path` so the
/// later rename stays on one filesystem), explicitly chmods it to
/// `0o644` (see the "Explicit file permissions" module note above), and then
/// renames it over `path`.
///
/// On any failure, best-effort removes the temp file before returning the
/// original error (a failed cleanup is ignored -- the write itself
/// already failed, so a leftover temp file is a lesser concern than
/// masking the real error with a cleanup error).
pub(crate) fn write_atomic(path: &Path, contents: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} has no parent directory", path.display()),
        )
    })?;
    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} has no file name component", path.display()),
        )
    })?;

    let tmp_path = parent.join(format!(
        "{}.tmp-{}",
        file_name.to_string_lossy(),
        unique_suffix()
    ));

    let write_result = (|| -> io::Result<()> {
        let mut file = File::create(&tmp_path)?;
        file.set_permissions(std::fs::Permissions::from_mode(FILE_MODE))?;
        std::io::Write::write_all(&mut file, contents)
    })();

    if let Err(err) = write_result {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err);
    }

    if let Err(err) = std::fs::rename(&tmp_path, path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err);
    }

    Ok(())
}

/// A best-effort unique token for the temp file name: the current Unix
/// timestamp in nanoseconds combined with the process id. Not
/// cryptographically random -- this only needs to avoid collisions
/// between concurrent invocations on the same machine, the same
/// uniqueness bar this codebase's own test helpers already rely on (see
/// e.g. `cli/config.rs`'s `scratch_dir` test helper, which uses the same
/// nanos-since-epoch pattern). `pub(crate)` so other modules needing a
/// same-directory temp-name suffix for their own atomic rename (e.g.
/// `install/bin_link.rs`'s symlink swap) reuse this instead of
/// duplicating the nanos+pid formula.
pub(crate) fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos}-{}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-atomic-write-test-{name}-{}",
            unique_suffix()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_new_file() {
        let dir = scratch_dir("new-file");
        let target = dir.join("out.txt");

        write_atomic(&target, b"hello").expect("write must succeed");
        assert_eq!(fs::read_to_string(&target).unwrap(), "hello");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn overwrites_existing_file() {
        let dir = scratch_dir("overwrite");
        let target = dir.join("out.txt");
        fs::write(&target, b"old contents").unwrap();

        write_atomic(&target, b"new contents").expect("write must succeed");
        assert_eq!(fs::read_to_string(&target).unwrap(), "new contents");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn leaves_no_temp_file_behind_on_success() {
        let dir = scratch_dir("no-leftover");
        let target = dir.join("out.txt");

        write_atomic(&target, b"contents").expect("write must succeed");

        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "no .tmp- files should remain after a successful write"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writes_file_with_explicit_0o644_permissions() {
        // Regression test: the written file must be `0o644` regardless
        // of the process umask.
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch_dir("permissions");
        let target = dir.join("out.txt");

        write_atomic(&target, b"contents").expect("write must succeed");

        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o644,
            "written file must be 0o644 regardless of umask, got {mode:o}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writes_via_single_file_handle_not_a_second_reopen() {
        // Regression test for a double-open/TOCTOU risk: an earlier
        // version called `File::create` (opening the temp file once)
        // and then `std::fs::write` on the same path, which internally
        // re-opens the path from scratch -- a redundant second
        // open/create syscall racing against whatever else might touch
        // `tmp_path` between the two opens. The fix writes through the
        // SAME handle returned by `File::create` via `Write::write_all`,
        // so there is exactly one open for the whole operation.
        //
        // Not directly observable via a public API (the temp file's
        // name is an internal implementation detail), so this test
        // asserts the property a single-open implementation guarantees:
        // the final file's content and permissions are exactly what was
        // requested, with no intermediate/partial state visible.
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch_dir("single-open");
        let target = dir.join("out.txt");

        write_atomic(&target, b"single-open contents").expect("write must succeed");

        let contents = fs::read_to_string(&target).unwrap();
        assert_eq!(
            contents, "single-open contents",
            "content must match exactly what was written through the single file handle"
        );

        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o644,
            "permissions must still be 0o644 after writing through a single handle, got {mode:o}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fails_cleanly_when_parent_directory_is_missing() {
        let dir = scratch_dir("missing-parent");
        let target = dir.join("nonexistent-subdir").join("out.txt");

        let err = write_atomic(&target, b"contents")
            .expect_err("write must fail when the parent directory does not exist");
        assert_eq!(err.kind(), io::ErrorKind::NotFound);

        fs::remove_dir_all(&dir).ok();
    }
}
