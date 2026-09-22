// SPDX-License-Identifier: Apache-2.0
//
// config_lock.rs — advisory exclusive file lock guarding `config set`'s
// read-merge-write cycle (Rust implementation).
//
// ── Scope (Fix for the `config set` lost-update race) ──────────────────────
// `config::set_config_value` reads the current `.konductor/config.yml`
// (or falls back to preset defaults), merges in the caller's single field
// change, and writes the FULL resulting document back via
// `atomic_write::write_atomic`. `write_atomic` guarantees the write
// itself is crash-safe, but does nothing to serialize the
// READ-MERGE-WRITE cycle around it: two concurrent `config set` calls
// can both read the same pre-update snapshot, each compute a rewrite
// reflecting only its own change, and whichever atomic-rename lands
// last silently discards the other's write -- both processes still
// exit 0, so the race is invisible to either caller.
//
// This module closes that gap with an advisory-lock-around-the-
// critical-section pattern: acquire an exclusive lock on a dedicated
// lock file BEFORE the read step, and hold it until AFTER the write step
// completes (dropped automatically at scope exit via `ConfigLockGuard`'s
// `Drop`). Concurrent callers then serialize through the lock instead of
// racing.
//
// ── Why a separate lock file, not a lock on `config.yml` itself ────────────
// `write_atomic` never mutates `config.yml` in place -- it writes a
// sibling temp file and renames it over the target, which replaces the
// inode `config.yml` points at. A lock held on the file handle open for
// `config.yml` would not be held on the *new* inode a concurrent writer
// renames into place, so it would not actually serialize concurrent
// writers. A dedicated, stable lock file (`.konductor/.config.lock`)
// sidesteps this entirely: it is never replaced, only ever opened, so
// every caller locks the same inode for the entire process lifetime.
//
// ── Bounded wait-and-retry, not an indefinite block ─────────────────────────
// `fs2`'s `try_lock_exclusive` (non-blocking) is polled in a short loop
// with a small sleep between attempts, up to `DEFAULT_TIMEOUT`. If the
// lock is still held by another process once the timeout elapses, this
// returns `ConfigLockError::Contended` rather than blocking forever, so
// a wedged/crashed holder can never hang every future `config set`
// invocation indefinitely. (`fs2::FileExt::lock_exclusive`, the blocking
// variant, is intentionally NOT used here for that reason.)
//
// ── Explicit file permissions (same class as atomic_write.rs's) ──────────
// `OpenOptions::create(true)` creates the lock file with mode
// `0o666 & ~umask` when it does not yet exist -- umask-derived, not a
// fixed value. The lock file's own permissions matter less than
// `config.yml`'s (its bytes are never meaningful, and only ever opened
// by holders of the same OS user in practice), but the same
// "make it explicit, don't rely on umask" principle applies. This module
// explicitly sets the lock file's permissions to `0o644` right after
// opening it (idempotent if the file already existed).

use fs2::FileExt;
use std::fs::{File, OpenOptions};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Total time to keep retrying before giving up on lock acquisition.
/// Chosen as "a few seconds" per this task's explicit bounded-wait
/// instruction -- long enough that a sibling `config set` invocation
/// (whose own read-merge-write critical section is a handful of small
/// file operations) has almost certainly finished, but short enough that
/// a genuinely wedged/crashed lock holder fails fast with a clear error
/// instead of hanging the caller indefinitely.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);

/// Delay between non-blocking lock-acquisition attempts while polling
/// within `DEFAULT_TIMEOUT`.
const RETRY_INTERVAL: Duration = Duration::from_millis(50);

/// Explicit, deterministic permissions for the lock file -- see the
/// "Explicit file permissions" module note above. Matches
/// atomic_write.rs's `FILE_MODE`.
const LOCK_FILE_MODE: u32 = 0o644;

/// The ways acquiring the config lock can fail. Both variants are USAGE
/// ERRORS from the CLI's perspective (mirroring `ConfigError`'s own
/// exit-code contract) -- callers must map this to `EXIT_USAGE_ERROR`
/// (64), never exit code 2.
#[derive(Debug)]
pub enum ConfigLockError {
    /// The lock file (or its parent directory) could not be created or
    /// opened (permissions, read-only filesystem, etc.) -- distinct from
    /// lock *contention*, since this means the lock was never even
    /// attempted.
    Unavailable {
        path: PathBuf,
        source: std::io::Error,
    },
    /// Another process held the lock for the entire `DEFAULT_TIMEOUT`
    /// bounded wait. Not a crash/bug -- just a sibling `config set` (or
    /// `init`, if it ever takes this same lock) that did not finish in
    /// time, or a stale lock from a killed process (advisory locks are
    /// released automatically by the OS when the holding process exits
    /// or is killed, so this self-heals on the next attempt).
    ///
    /// `path` is intentionally not rendered in the `Display` message
    /// (kept generic/user-facing per this task's specified error-message
    /// shape), but is retained on the variant for `Debug`-level
    /// diagnostics (logs, tests) rather than discarded.
    Contended {
        #[allow(dead_code)]
        path: PathBuf,
    },
}

impl std::fmt::Display for ConfigLockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigLockError::Unavailable { path, source } => {
                write!(f, "could not open config lock {}: {source}", path.display())
            }
            ConfigLockError::Contended { .. } => {
                write!(f, "config is locked by another process, try again")
            }
        }
    }
}

impl std::error::Error for ConfigLockError {}

/// An acquired exclusive lock on `.konductor/.config.lock`, held for as
/// long as this guard is alive. Dropping the guard releases the lock
/// (`fs2` releases the OS advisory lock when the underlying `File` is
/// closed, which happens automatically when `_file` drops).
///
/// `Debug` is derived only so test code can call `.expect_err()` /
/// `.expect()` on a `Result<ConfigLockGuard, _>` -- this type carries no
/// state worth inspecting outside tests.
#[derive(Debug)]
pub struct ConfigLockGuard {
    // Never read directly -- kept alive purely so the OS-level advisory
    // lock associated with this file descriptor stays held until this
    // guard (and thus the file) drops.
    _file: File,
}

/// Acquires an exclusive advisory lock on `<konductor_dir>/.config.lock`,
/// creating `konductor_dir` and the lock file if either does not yet
/// exist. Blocks (via short non-blocking polling, never an indefinite
/// OS-level blocking call) for up to `DEFAULT_TIMEOUT` before giving up.
///
/// Callers must acquire this lock BEFORE reading the current
/// `.konductor/config.yml` and hold the returned guard until AFTER the
/// updated document has been written back -- i.e. for the entire
/// read-merge-write critical section, not just the write.
pub fn acquire(konductor_dir: &Path) -> Result<ConfigLockGuard, ConfigLockError> {
    acquire_named(konductor_dir, ".config.lock")
}

/// Same mechanism as `acquire`, generalized to lock a caller-chosen file
/// name within `dir` instead of the hardcoded `.config.lock` -- so a
/// DIFFERENT read-modify-write critical section (e.g.
/// `install/bin_link.rs`'s `$HOME/.konductor/bin-links` sidecar, or
/// `install/resource_rewrite/claude_settings.rs`'s Claude settings merges) gets its own
/// independent lock file rather than contending with (or, worse,
/// silently sharing identity with) `config set`'s lock on an unrelated
/// document, or duplicating this module's bounded-retry/permissions
/// logic in a second implementation. `acquire` is the
/// `".config.lock"`-named special case of this function, kept as the
/// stable name every existing `config.rs` call site already uses.
pub fn acquire_named(dir: &Path, file_name: &str) -> Result<ConfigLockGuard, ConfigLockError> {
    let lock_path = dir.join(file_name);

    std::fs::create_dir_all(dir).map_err(|source| ConfigLockError::Unavailable {
        path: lock_path.clone(),
        source,
    })?;

    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .map_err(|source| ConfigLockError::Unavailable {
            path: lock_path.clone(),
            source,
        })?;

    // Explicit, deterministic permissions regardless of umask -- see
    // the "Explicit file permissions" module note above. Idempotent (a
    // no-op in effect) if the lock file already existed with different
    // permissions from a prior run.
    file.set_permissions(std::fs::Permissions::from_mode(LOCK_FILE_MODE))
        .map_err(|source| ConfigLockError::Unavailable {
            path: lock_path.clone(),
            source,
        })?;

    let deadline = Instant::now() + DEFAULT_TIMEOUT;
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => return Ok(ConfigLockGuard { _file: file }),
            Err(err) if is_lock_contended(&err) => {
                if Instant::now() >= deadline {
                    return Err(ConfigLockError::Contended { path: lock_path });
                }
                std::thread::sleep(RETRY_INTERVAL);
            }
            Err(source) => {
                return Err(ConfigLockError::Unavailable {
                    path: lock_path,
                    source,
                })
            }
        }
    }
}

/// Distinguishes "another process holds this lock" (expected, retryable)
/// from any other I/O error opening/locking the file (not retryable).
/// `fs2::FileExt::try_lock_exclusive` surfaces contention as
/// `io::ErrorKind::WouldBlock` (POSIX `EWOULDBLOCK`/`EAGAIN` from
/// `flock(2)`) on all platforms it supports.
fn is_lock_contended(err: &std::io::Error) -> bool {
    err.kind() == std::io::ErrorKind::WouldBlock
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-config-lock-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// `acquire_named` locks a caller-chosen file name, independent of
    /// `acquire`'s own hardcoded `.config.lock` -- two different named
    /// locks in the SAME directory must not contend with each other.
    #[test]
    fn acquire_named_uses_the_given_file_name_and_is_independent_of_config_lock() {
        let dir = scratch_dir("named");
        let _config_guard = acquire(&dir).expect("config lock must be acquirable");
        let _bin_links_guard = acquire_named(&dir, ".bin-links.lock")
            .expect("a differently-named lock in the same directory must not contend");
        assert!(dir.join(".config.lock").is_file());
        assert!(dir.join(".bin-links.lock").is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn acquire_named_second_acquisition_of_same_name_is_contended() {
        let dir = scratch_dir("named-contended");
        let _first =
            acquire_named(&dir, ".bin-links.lock").expect("first acquisition must succeed");
        let err = acquire_named(&dir, ".bin-links.lock")
            .expect_err("a second acquisition of the SAME named lock must be contended");
        assert!(matches!(err, ConfigLockError::Contended { .. }));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn acquires_lock_on_fresh_directory() {
        let dir = scratch_dir("fresh");
        let _guard = acquire(&dir).expect("lock must be acquirable when uncontended");
        assert!(dir.join(".config.lock").is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn lock_file_has_explicit_0o644_permissions() {
        // Regression test: the lock file must be `0o644` regardless of
        // the process umask.
        let dir = scratch_dir("permissions");
        let _guard = acquire(&dir).expect("lock must be acquirable when uncontended");

        let mode = std::fs::metadata(dir.join(".config.lock"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(
            mode, 0o644,
            "lock file must be 0o644 regardless of umask, got {mode:o}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn second_acquisition_is_contended_while_first_is_held() {
        let dir = scratch_dir("contended");
        let _first = acquire(&dir).expect("first acquisition must succeed");

        // A second attempt from the SAME process/thread against the same
        // path must observe contention (fs2's flock is process-scoped,
        // not held-thread-scoped, but the first guard's file descriptor
        // is still open and still holds the OS lock).
        let err = acquire(&dir).expect_err("second acquisition must be contended");
        assert!(matches!(err, ConfigLockError::Contended { .. }));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn lock_is_released_when_guard_drops() {
        let dir = scratch_dir("released");
        {
            let _guard = acquire(&dir).expect("first acquisition must succeed");
        } // guard drops here, releasing the lock

        acquire(&dir).expect("lock must be re-acquirable after the holder drops");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn acquire_named_uses_the_given_file_name_and_serializes_independently_per_name() {
        let dir = scratch_dir("named");
        let a = acquire_named(&dir, ".claude-settings.lock")
            .expect("a distinctly-named lock must be acquirable when uncontended");
        assert!(dir.join(".claude-settings.lock").is_file());
        // A lock under a DIFFERENT name in the same directory must not
        // contend with the one already held above -- these are two
        // independent locks, not accidentally aliased to the same file.
        let _b = acquire_named(&dir, ".other.lock")
            .expect("a different lock name in the same directory must not be contended");
        drop(a);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn concurrent_writers_serialize_with_no_lost_update() {
        // Reproduces the original bug's shape directly against the lock
        // primitive (not the full config.rs pipeline): N threads each
        // "hold the lock, read a shared counter, increment it, write it
        // back" -- the read-modify-write shape that raced in
        // `set_config_value` before this fix. Without the lock, this
        // loses updates; with it, every increment must land.
        let dir = scratch_dir("no-lost-update");
        let counter_path = dir.join("counter.txt");
        std::fs::write(&counter_path, "0").unwrap();

        let threads: Vec<_> = (0..20)
            .map(|_| {
                let dir = dir.clone();
                let counter_path = counter_path.clone();
                std::thread::spawn(move || {
                    let _guard = acquire(&dir).expect("lock must be acquirable within timeout");
                    let current: u64 = std::fs::read_to_string(&counter_path)
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    // Simulate the merge+write cost of a real config set.
                    std::thread::sleep(Duration::from_millis(1));
                    std::fs::write(&counter_path, (current + 1).to_string()).unwrap();
                })
            })
            .collect();

        for t in threads {
            t.join().unwrap();
        }

        let final_value: u64 = std::fs::read_to_string(&counter_path)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert_eq!(
            final_value, 20,
            "every one of the 20 serialized increments must be persisted -- lost updates indicate the lock failed to serialize"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
