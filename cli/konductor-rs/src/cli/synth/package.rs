// SPDX-License-Identifier: Apache-2.0
//
// synth/package.rs -- packages the finished `dist/` tree into a single
// tar.gz blob for `sidecar::write_sidecar` to hash. Transport-integrity
// only: no signing, no provenance, no authenticity guarantee.

use std::fs;
use std::path::{Path, PathBuf};

/// Packages every file under `dist_root` into an in-memory gzip tar
/// archive, with entry paths relative to `dist_root` (never absolute).
/// Returns the archive bytes; does no file I/O beyond reading `dist_root`.
///
/// Entries are collected via our own recursive walk (rather than tar's
/// `Builder::append_dir_all`, which appends in whatever order the OS's
/// `read_dir` happens to return) and sorted by relative path -- a plain
/// byte-order sort, not a locale-dependent one -- before being appended.
/// `read_dir` order is unspecified and not guaranteed stable across runs
/// or machines, so without this sort, two `synth` runs over a
/// byte-identical `dist/` tree could emit archive entries in a different
/// order and therefore produce different archive bytes (and a different
/// checksum) despite identical logical content.
pub fn package_dist(dist_root: &Path) -> std::io::Result<Vec<u8>> {
    let mut entries = collect_entries(dist_root, dist_root)?;
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    let mut buf = Vec::new();
    {
        let encoder = flate2::write::GzEncoder::new(&mut buf, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        for entry in &entries {
            let metadata = fs::metadata(&entry.absolute_path)?;
            let mut header = tar::Header::new_gnu();
            header.set_metadata(&metadata);
            // `append_data` sets the path (with GNU long-name support for
            // paths over the 100-byte fixed name field), size, and
            // checksum -- setting them here too would be redundant, and
            // `Header::set_path` actively breaks packaging for a long
            // `dist/` path: it writes into that fixed-width field and
            // errors out rather than falling back to a long-name entry.
            if entry.is_dir {
                builder.append_data(&mut header, &entry.relative_path, std::io::empty())?;
            } else {
                let mut file = fs::File::open(&entry.absolute_path)?;
                builder.append_data(&mut header, &entry.relative_path, &mut file)?;
            }
        }
        builder.into_inner()?.finish()?;
    }
    Ok(buf)
}

/// One archive entry collected by `collect_entries`: `relative_path` is a
/// forward-slash-joined, trailing-slash-free path relative to `root`
/// (never absolute); `absolute_path` is where to read its metadata/bytes
/// from; `is_dir` selects a zero-byte directory entry vs. a file entry
/// carrying that path's real contents.
struct DistEntry {
    relative_path: String,
    absolute_path: PathBuf,
    is_dir: bool,
}

/// Recursively collects every file AND directory under `dir` as
/// `DistEntry` values relative to `root`. Directory entries are included
/// (not just files) because an unpacker may not create missing parent
/// directories on its own -- `tar::Builder::append_dir_all`, what this
/// replaces, included them too, so dropping them would silently change
/// the archive's on-disk contract for any consumer. Unordered on return
/// -- `package_dist` sorts the result itself.
fn collect_entries(root: &Path, dir: &Path) -> std::io::Result<Vec<DistEntry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let relative_path = path
            .strip_prefix(root)
            .expect("path yielded by read_dir under root must have root as a prefix")
            .components()
            .map(|component| component.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        if file_type.is_dir() {
            entries.push(DistEntry {
                relative_path,
                absolute_path: path.clone(),
                is_dir: true,
            });
            entries.extend(collect_entries(root, &path)?);
        } else if file_type.is_file() {
            entries.push(DistEntry {
                relative_path,
                absolute_path: path,
                is_dir: false,
            });
        }
        // Symlinks and other non-regular entries are skipped: dist/ is
        // synth's own output, which never produces them.
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Read;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-package-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Unpacks a gzip-compressed tar archive's bytes into
    /// `(entry_path, contents)` pairs, for assertions against
    /// `package_dist`'s own output without depending on any file order.
    fn unpack_entries(archive_bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let decoder = flate2::read::GzDecoder::new(archive_bytes);
        let mut archive = tar::Archive::new(decoder);
        let mut entries = Vec::new();
        for entry in archive.entries().unwrap() {
            let mut entry = entry.unwrap();
            let path = entry.path().unwrap().to_string_lossy().into_owned();
            let mut contents = Vec::new();
            entry.read_to_end(&mut contents).unwrap();
            entries.push((path, contents));
        }
        entries
    }

    /// The core round-trip: every file under `dist_root` must appear in
    /// the archive at a path relative to `dist_root` (never an absolute
    /// host path), with byte-identical contents.
    #[test]
    fn package_dist_archives_every_file_with_relative_paths_and_identical_bytes() {
        let dir = scratch_dir("basic");
        fs::create_dir_all(dir.join("kiro-cli-v2/agents")).unwrap();
        fs::write(dir.join("kiro-cli-v2/agents/example.json"), b"agent bytes").unwrap();
        fs::create_dir_all(dir.join("claude/skills/example-skill")).unwrap();
        fs::write(
            dir.join("claude/skills/example-skill/SKILL.md"),
            b"skill bytes",
        )
        .unwrap();

        let archive_bytes = package_dist(&dir).expect("package_dist must succeed");
        let entries = unpack_entries(&archive_bytes);

        let agent_entry = entries
            .iter()
            .find(|(path, _)| path == "kiro-cli-v2/agents/example.json")
            .expect("archive must contain the agent file at a dist_root-relative path");
        assert_eq!(agent_entry.1, b"agent bytes");

        let skill_entry = entries
            .iter()
            .find(|(path, _)| path == "claude/skills/example-skill/SKILL.md")
            .expect("archive must contain the skill file at a dist_root-relative path");
        assert_eq!(skill_entry.1, b"skill bytes");

        for (path, _) in &entries {
            assert!(
                !Path::new(path).is_absolute(),
                "archive entry path must never be absolute, got: {path}"
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// Pins that `package_dist` preserves the Unix executable bit
    /// through the archive (tar's native capability).
    #[cfg(unix)]
    #[test]
    fn package_dist_preserves_unix_executable_permission_bit() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch_dir("permissions");
        let script_path = dir.join("run.sh");
        fs::write(&script_path, b"#!/bin/sh\necho hi\n").unwrap();
        fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755)).unwrap();

        let archive_bytes = package_dist(&dir).expect("package_dist must succeed");
        let decoder = flate2::read::GzDecoder::new(&archive_bytes[..]);
        let mut archive = tar::Archive::new(decoder);
        let mut found = false;
        for entry in archive.entries().unwrap() {
            let entry = entry.unwrap();
            if entry.path().unwrap().to_string_lossy() == "run.sh" {
                found = true;
                assert_eq!(entry.header().mode().unwrap() & 0o755, 0o755);
            }
        }
        assert!(found, "archive must contain run.sh");

        fs::remove_dir_all(&dir).ok();
    }

    /// An empty `dist_root` must still produce a valid (empty) archive,
    /// not an error -- packaging must not assume at least one file
    /// exists.
    #[test]
    fn package_dist_succeeds_on_empty_dist_root() {
        let dir = scratch_dir("empty");
        let archive_bytes = package_dist(&dir).expect("package_dist must succeed on empty dir");
        let entries = unpack_entries(&archive_bytes);
        assert!(entries.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    /// A nonexistent `dist_root` must return an `Err`, not panic.
    #[test]
    fn package_dist_rejects_nonexistent_dist_root() {
        let dir = scratch_dir("missing-parent");
        let missing = dir.join("does-not-exist");
        let err = package_dist(&missing).expect_err("nonexistent dist_root must error");
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
        fs::remove_dir_all(&dir).ok();
    }

    /// The determinism property this module exists to guarantee: two
    /// `package_dist` runs over the same real directory tree must
    /// produce byte-identical archives -- not merely the same file
    /// list, but the exact same bytes end to end. `read_dir`'s
    /// unspecified order is exactly what previously made this flaky
    /// (see `collect_entries`'s doc comment), so this asserts the
    /// actual archive bytes, not a derived comparison that could pass
    /// even with entries reordered.
    #[test]
    fn package_dist_produces_byte_identical_archives_across_repeated_runs() {
        let dir = scratch_dir("determinism");
        fs::create_dir_all(dir.join("kiro-cli-v2/agents")).unwrap();
        fs::write(dir.join("kiro-cli-v2/agents/example.json"), b"agent bytes").unwrap();
        fs::create_dir_all(dir.join("kiro-cli-v2/skills/zeta-skill")).unwrap();
        fs::write(
            dir.join("kiro-cli-v2/skills/zeta-skill/SKILL.md"),
            b"zeta skill bytes",
        )
        .unwrap();
        fs::create_dir_all(dir.join("claude/skills/alpha-skill")).unwrap();
        fs::write(
            dir.join("claude/skills/alpha-skill/SKILL.md"),
            b"alpha skill bytes",
        )
        .unwrap();
        fs::write(dir.join("top-level.txt"), b"top level bytes").unwrap();

        let first_run = package_dist(&dir).expect("first package_dist run must succeed");
        let second_run = package_dist(&dir).expect("second package_dist run must succeed");

        assert_eq!(
            first_run, second_run,
            "package_dist must produce byte-identical archives across repeated runs \
             over the same input tree"
        );

        fs::remove_dir_all(&dir).ok();
    }
}
