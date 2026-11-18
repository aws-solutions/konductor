// SPDX-License-Identifier: Apache-2.0
//
// skill_lookup_core — the reusable directory-scan / frontmatter-parse /
// in-memory-index core originally built for skill-lookup-mcp, extracted
// into its own crate so a second MCP server can depend on it without a
// third copy of frontmatter parsing (the duplication `frontmatter.rs`'s
// own module doc comment already discusses relative to
// `cli/konductor-rs`) or a second, independently-evolving scanner.
//
// This crate carries no MCP protocol types, no CLI argument parsing, and
// no server-process concerns (stdio transport, tool registration, `Cli`
// arg validation) — those stay in each consuming binary. What lives here
// is genuinely reusable: directory traversal (`scanner`), tolerant
// frontmatter parsing (`frontmatter`), the data model
// (`model`), the query/reload index built on top of them (`index`), and
// persistent leveled logging (`logging`) — the log file is a generic
// `mcp-*.log`, not per-server, so a second MCP server built on this
// crate could share `logging`'s file-writing/retention/line-format half
// as-is; see that module's own doc comment for the one function
// (`log`'s stderr prefix) that is not yet server-agnostic, since only
// one consumer exists today.

pub mod frontmatter;
pub mod index;
mod install_manifest;
pub mod logging;
pub mod model;
pub mod scanner;
pub mod telemetry;

/// Test-only shared lock for every test in this crate that mutates the
/// process-global `HOME` env var. `std::env::set_var`/`remove_var` have no
/// per-thread scoping -- they mutate one process-wide table shared by every
/// thread, including the default multi-threaded `cargo test` harness, which
/// runs `logging.rs`'s and `telemetry.rs`'s test modules concurrently in the
/// same binary. A lock scoped to just one of those modules only serializes
/// tests within that module; it does nothing to stop a `HOME`-mutating test
/// in the *other* module from running at the same instant and pointing the
/// real `HOME` at a different value mid-test. This single crate-wide lock is
/// the fix: every `HOME`-mutating test in the crate, in either module,
/// acquires this same mutex, so no two of them can ever run concurrently.
/// `cli/konductor-rs`'s own `cli.rs::test_home_lock` documents and fixes the
/// identical hazard for that crate's own modules.
#[cfg(test)]
pub(crate) mod test_home_lock {
    use std::ffi::OsString;
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard};
    use std::time::{SystemTime, UNIX_EPOCH};

    pub(crate) static HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Acquires `HOME_ENV_LOCK`, recovering the guard even if a previous
    /// holder panicked while it was held -- a prior test failing an
    /// assertion while holding this lock must not cascade into every later
    /// `HOME`-mutating test in the crate also failing with `PoisonError`,
    /// which would mask which test's assertion actually failed first.
    pub(crate) fn lock_home() -> MutexGuard<'static, ()> {
        HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// RAII guard: holds `HOME_ENV_LOCK` and points `HOME` at a fresh
    /// scratch dir for its lifetime. On drop, including during a panic,
    /// it restores the original `HOME` and removes the scratch dir.
    pub(crate) struct HomeGuard {
        _lock: MutexGuard<'static, ()>,
        pub(crate) scratch: PathBuf,
        original_home: Option<OsString>,
    }

    impl HomeGuard {
        pub(crate) fn new(label: &str) -> Self {
            let lock = lock_home();
            let scratch = std::env::temp_dir().join(format!(
                "skill-lookup-home-{label}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&scratch).unwrap();
            let original_home = std::env::var_os("HOME");
            std::env::set_var("HOME", &scratch);
            Self {
                _lock: lock,
                scratch,
                original_home,
            }
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            match &self.original_home {
                Some(home) => std::env::set_var("HOME", home),
                None => std::env::remove_var("HOME"),
            }
            let _ = std::fs::remove_dir_all(&self.scratch);
        }
    }
}
