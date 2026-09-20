// SPDX-License-Identifier: Apache-2.0
//
// logging.rs — minimal invocation-logging convention for the Konductor CLI
// (Rust implementation).
//
// This is a stub-milestone convention: a minimal invocation log wired into
// the single `run()` choke point, fail-open on write errors -- not a full
// logging framework. Every invocation appends one line to
// ~/.konductor/logs/konductor.log: program basename + args, ISO-8601 UTC
// timestamp, exit code.
//
// ── Permission and content invariants (M1/MI3) ─────────────────────────────
// M1: the log dir is created with mode 0700 and the log file with mode
// 0600, via DirBuilder/OpenOptions' `.mode()` (std::os::unix::fs) rather
// than a separate chmod call -- on Unix these modes are applied atomically
// at creation time (still subject to umask for bits it *adds*, but umask
// can only ever narrow requested permissions, never widen them, so an
// 0700/0600 request can't end up more permissive than requested).
// MI3: the logged line records the program basename ("konductor") followed
// by just the passed arguments -- NOT the full argv (which included the
// absolute binary path, e.g. "/home/x/.cargo/bin/konductor").

use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;

use super::time::utc_now_iso;

/// Directory mode: owner-only rwx. See module docstring's M1 note.
const DIR_MODE: u32 = 0o700;
/// File mode: owner-only rw. See module docstring's M1 note.
const FILE_MODE: u32 = 0o600;

/// Resolves `~/.konductor/logs/`, or `None` if the home directory cannot
/// be determined (e.g. HOME unset). Fails open -- logging simply does
/// nothing if home can't be found.
fn log_dir() -> Option<PathBuf> {
    let home = env::var_os("HOME")?;
    if home.is_empty() {
        return None;
    }
    Some(
        PathBuf::from(home)
            .join(super::config::KONDUCTOR_DIR_NAME)
            .join("logs"),
    )
}

/// Appends one line to ~/.konductor/logs/konductor.log recording this
/// invocation's arguments (program basename + passed args, NOT the full
/// argv -- see module docstring's MI3 note) and final exit code, creating
/// the log directory first if it does not already exist.
///
/// Best-effort / fail-open: any I/O error (missing HOME, permissions,
/// read-only filesystem, disk full, ...) is swallowed. Logging must never
/// change the exit code a command would otherwise produce.
///
/// `argv` is the full `std::env::args()` output (element 0 = absolute
/// binary path); this function logs only `["konductor", ...argv[1:]]`.
pub fn log_invocation(argv: &[String], exit_code: u8) {
    let Some(dir) = log_dir() else {
        return;
    };
    if fs::DirBuilder::new()
        .recursive(true)
        .mode(DIR_MODE)
        .create(&dir)
        .is_err()
    {
        return;
    }
    // DirBuilder's mode() only governs newly-created path components; if
    // the directory already existed (e.g. left over from before this fix
    // shipped) with looser permissions, re-pin it explicitly so upgrading
    // still tightens a pre-existing world/group-readable directory.
    let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(DIR_MODE));

    let timestamp = utc_now_iso();
    let logged_args: Vec<&str> = std::iter::once("konductor")
        .chain(argv.iter().skip(1).map(String::as_str))
        .collect();
    let line = format!("{timestamp} argv={logged_args:?} exit_code={exit_code}\n");

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(FILE_MODE)
        .open(dir.join("konductor.log"))
    {
        // Mirrors the directory re-pin above: OpenOptions' mode() only
        // applies to a newly-created file, so re-pin explicitly in case
        // the file pre-existed with looser permissions.
        let _ = file.set_permissions(fs::Permissions::from_mode(FILE_MODE));
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::super::time::civil_from_days;

    /// Guards every test below that mutates the process-global `HOME`
    /// env var via `env::set_var`/`env::remove_var`.
    ///
    /// `std::env::set_var` has no per-thread scoping in std -- it mutates
    /// one process-wide table shared by every thread, including the
    /// default multi-threaded `cargo test` harness. Four tests in this
    /// module each save/restore `HOME` around a `log_invocation` call;
    /// without serialization, two of them running concurrently can
    /// interleave as: T1 sets HOME=scratch_A, T2 sets HOME=scratch_B
    /// (clobbering T1's value process-wide), T1's `log_invocation` then
    /// writes under scratch_B instead of scratch_A (or T2 restores/removes
    /// HOME before T1 reads it back), so T1's assertion against
    /// `scratch_A/.konductor/logs/konductor.log` sees a missing file
    /// (`NotFound`) or another test's log content. This reproduced
    /// reliably by inserting a short sleep between `set_var` and the
    /// `log_invocation` call to widen the interleaving window (mirroring
    /// how coverage instrumentation slows every instruction and widens
    /// the same window in coverage-instrumented test runs) --
    /// confirmed to fail with the exact same panic messages seen in the
    /// real coverage-instrumented build (`expected log file to be
    /// created`; and the log-content assertion seeing another test's
    /// line). Plain `cargo test` rarely hits this window because the
    /// critical section is short, but it is not actually safe -- it is a
    /// genuine data race that coverage instrumentation's slowdown makes
    /// far more likely to manifest, not a difference in the coverage
    /// runner's environment setup.
    ///
    /// Held for the *entire* body of each HOME-mutating test (not just
    /// around `set_var`) so no other HOME-mutating test can run at all
    /// until the current one has restored the original value. `HomeGuard`
    /// below acquires this internally, so callers can't forget it.
    ///
    /// This is the CRATE-WIDE lock from `test_home_lock` (imported
    /// below), not a module-private static: `install.rs`'s/
    /// `uninstall.rs`'s/`update.rs`'s own `HomeGuard`s mutate the exact
    /// same process-global `HOME` env var this module's tests do, so a
    /// module-private lock here would not serialize against theirs --
    /// two HOME-mutating tests in different modules could still run
    /// concurrently under `cargo test`'s default parallelism and race
    /// on `HOME` exactly as described above, just across module
    /// boundaries instead of within one module.
    use crate::cli::test_home_lock::HOME_ENV_LOCK;

    /// RAII guard for tests that mutate the process-global `HOME` env var.
    ///
    /// Acquires `HOME_ENV_LOCK` for its entire lifetime (see that static's
    /// doc comment), points `HOME` at a fresh scratch temp dir, and on
    /// `Drop` restores the original `HOME` and removes the scratch dir --
    /// so every call site gets both the lock and the cleanup without
    /// repeating the save/set/restore/remove sequence by hand.
    struct HomeGuard {
        _lock: MutexGuard<'static, ()>,
        scratch: PathBuf,
        original_home: Option<std::ffi::OsString>,
    }

    impl HomeGuard {
        /// Sets `HOME` to a fresh scratch dir under `env::temp_dir()`,
        /// named uniquely via `label` plus a nanosecond timestamp.
        fn new(label: &str) -> Self {
            let lock = HOME_ENV_LOCK.lock().unwrap();

            let scratch = std::env::temp_dir().join(format!(
                "konductor-{label}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&scratch).unwrap();

            let original_home = env::var_os("HOME");
            env::set_var("HOME", &scratch);

            Self {
                _lock: lock,
                scratch,
                original_home,
            }
        }

        /// `HOME`'s current scratch value, for building expected paths.
        fn path(&self) -> &PathBuf {
            &self.scratch
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match &self.original_home {
                Some(home) => env::set_var("HOME", home),
                None => env::remove_var("HOME"),
            }
            let _ = fs::remove_dir_all(&self.scratch);
        }
    }

    /// `civil_from_days` lives in `crate::cli::time`, shared with
    /// `install/kiro_cli.rs`'s copy to avoid duplicating the algorithm.
    /// This test re-verifies it here against this module's own reference
    /// dates to confirm behavior at this call site; the shared module
    /// carries the exhaustive coverage.
    #[test]
    fn civil_from_days_matches_known_epoch_dates() {
        // 1970-01-01 is day 0.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2000-03-01 is a well-known checkpoint used to validate this
        // exact algorithm in Howard Hinnant's reference implementation.
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
    }

    /// `format_utc_now` lives in `crate::cli::time::utc_now_iso`, shared
    /// with `install/kiro_cli.rs`'s copy to avoid duplication. This test
    /// still exercises it through this module's re-export path to confirm
    /// the timestamp `log_invocation` writes has the expected shape;
    /// `crate::cli::time` carries the exhaustive shape/algorithm coverage.
    #[test]
    fn format_utc_now_matches_iso8601_shape() {
        let ts = utc_now_iso();
        // YYYY-MM-DDTHH:MM:SSZ is exactly 20 characters.
        assert_eq!(ts.len(), 20);
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.as_bytes()[4], b'-');
        assert_eq!(ts.as_bytes()[7], b'-');
        assert_eq!(ts.as_bytes()[10], b'T');
        assert_eq!(ts.as_bytes()[13], b':');
        assert_eq!(ts.as_bytes()[16], b':');
    }

    #[test]
    fn log_invocation_creates_log_dir_and_appends_line() {
        let home = HomeGuard::new("logtest");

        log_invocation(&["konductor".to_string(), "doctor".to_string()], 0);

        let log_path = home
            .path()
            .join(super::super::config::KONDUCTOR_DIR_NAME)
            .join("logs")
            .join("konductor.log");
        assert!(log_path.exists(), "expected log file to be created");
        let contents = fs::read_to_string(&log_path).unwrap();
        assert!(contents.contains("argv="));
        assert!(contents.contains("exit_code=0"));
    }

    /// M1: the created log directory and file must be private to the
    /// owner (0700 / 0600), not readable/writable by group or other.
    #[test]
    fn log_invocation_creates_log_dir_and_file_with_restrictive_perms() {
        use std::os::unix::fs::PermissionsExt as _;

        let home = HomeGuard::new("permtest");

        log_invocation(&["konductor".to_string(), "doctor".to_string()], 0);

        let dir_path = home
            .path()
            .join(super::super::config::KONDUCTOR_DIR_NAME)
            .join("logs");
        let file_path = dir_path.join("konductor.log");

        let dir_mode = fs::metadata(&dir_path).unwrap().permissions().mode() & 0o777;
        let file_mode = fs::metadata(&file_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            dir_mode, 0o700,
            "log dir must be mode 0700, got {dir_mode:o}"
        );
        assert_eq!(
            file_mode, 0o600,
            "log file must be mode 0600, got {file_mode:o}"
        );
    }

    /// MI1: logging must fail open (no panic) when HOME is unset.
    #[test]
    fn log_invocation_fails_open_when_home_unset() {
        // Serializes against the other HOME-mutating tests via the same
        // lock HomeGuard uses -- but this test unsets HOME rather than
        // pointing it at a scratch dir, so it manages HOME directly
        // instead of using HomeGuard.
        let _guard = HOME_ENV_LOCK.lock().unwrap();

        let original_home = env::var_os("HOME");
        env::remove_var("HOME");

        // Must not panic.
        log_invocation(&["konductor".to_string(), "doctor".to_string()], 0);

        if let Some(home) = original_home {
            env::set_var("HOME", home);
        }
    }

    /// MI3: the logged line's argument representation must be exactly
    /// `["konductor", ...passed args]` -- the absolute binary path
    /// passed in as argv[0] must be dropped.
    #[test]
    fn log_invocation_normalizes_line_format_dropping_binary_path() {
        let home = HomeGuard::new("fmttest");

        let absolute_bin_path = "/home/someuser/.cargo/bin/konductor".to_string();
        log_invocation(
            &[
                absolute_bin_path.clone(),
                "config".to_string(),
                "get".to_string(),
            ],
            0,
        );

        let contents = fs::read_to_string(
            home.path()
                .join(super::super::config::KONDUCTOR_DIR_NAME)
                .join("logs")
                .join("konductor.log"),
        )
        .unwrap();
        assert!(
            !contents.contains(&absolute_bin_path),
            "log line must not contain the absolute binary path: {contents}"
        );
        assert!(contents.contains("\"konductor\""));
        assert!(contents.contains("\"config\""));
        assert!(contents.contains("\"get\""));
    }
}
