// SPDX-License-Identifier: Apache-2.0
//
// init.rs — `konductor init` real scaffolding (Rust implementation).
//
// ── Scope (M1 declarative contract) ────────────────────────────────────────
// Creates `.konductor/` in the target directory (cwd by default) and
// writes a starter `.konductor/config.yml` copied/derived from the preset
// defaults at cli/gate-config/config.yml, plus a `.konductor/.gitignore`
// covering the design's documented secrets/state patterns (see
// `GITIGNORE_PATTERNS`) -- never clobbering an existing, possibly
// user-edited `.gitignore`. Does not clobber an existing `.konductor/`
// unless `--force` is passed.
//
// ── Exit-code contract ──────────────────────────────────────────────────────
// Every failure path here is a USAGE ERROR (exit 64), never exit code 2 --
// see config.rs's module docstring for the same rule applied to the
// loader. This module returns a `Result`, leaving the exit-code mapping to
// its caller (dispatch.rs), consistent with config.rs's design.
//
// ── Forward-looking note (flagged, not resolved, per M1 task scope) ───────
// This module creates `.konductor/config.yml` and `.konductor/.gitignore`.
// It does NOT create a `.konductor/runs/` subdirectory. Asana Feature 4.3
// (Storage & State) may need `.konductor/runs/` for the run-engine's
// run-state documents (cli/gate-config/run-state.json's shape) -- that
// overlaps a separate
// "Feature 1.3" per the roadmap notes, so is intentionally NOT scaffolded
// here to avoid building it twice before that overlap is reconciled. If a
// future milestone adds `.konductor/runs/`, this is the function to extend.

use std::fs;
use std::path::{Path, PathBuf};

use super::atomic_write::write_atomic;
use super::config;

/// `.konductor/.gitignore` filename, alongside `config::CONFIG_FILE_NAME`.
pub(crate) const GITIGNORE_FILE_NAME: &str = ".gitignore";

/// Patterns `run_init` writes into `.konductor/.gitignore`, verbatim per
/// the design doc's Security section ("`konductor init` writes a
/// `.gitignore` excluding `runs/`, `overrides.yml`, `*.key`, `*.pem`,
/// `.env`. `konductor doctor` validates these paths are git-ignored.").
/// Single source of truth -- `doctor.rs`'s `check_gitignore` reuses this
/// same list rather than duplicating it.
pub(crate) const GITIGNORE_PATTERNS: &[&str] =
    &["runs/", "overrides.yml", "*.key", "*.pem", ".env"];

/// All the ways `konductor init` can fail. Every variant maps to exit
/// code 64 (EX_USAGE) at the dispatch site -- never exit code 2.
#[derive(Debug)]
pub enum InitError {
    /// `.konductor/` already exists at the target and `--force` was not
    /// passed.
    AlreadyExists { path: PathBuf },
    /// Could not create the `.konductor/` directory (permissions,
    /// read-only filesystem, target path is not a directory, etc.).
    CreateDirFailed {
        path: PathBuf,
        source: std::io::Error,
    },
    /// Could not write the starter `.konductor/config.yml`.
    WriteConfigFailed {
        path: PathBuf,
        source: std::io::Error,
    },
    /// Could not write `.konductor/.gitignore`.
    WriteGitignoreFailed {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl std::fmt::Display for InitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InitError::AlreadyExists { path } => write!(
                f,
                "{} already exists. Re-run with --force to overwrite it.",
                path.display()
            ),
            InitError::CreateDirFailed { path, source } => {
                write!(f, "could not create {}: {source}", path.display())
            }
            InitError::WriteConfigFailed { path, source } => {
                write!(f, "could not write {}: {source}", path.display())
            }
            InitError::WriteGitignoreFailed { path, source } => {
                write!(f, "could not write {}: {source}", path.display())
            }
        }
    }
}

impl InitError {
    /// A stable, closed error-category string (design doc D.11) --
    /// never this error's own `Display` text, which routinely embeds a
    /// local filesystem path.
    pub(crate) fn error_code(&self) -> &'static str {
        match self {
            InitError::AlreadyExists { .. } => "init.already_exists",
            InitError::CreateDirFailed { .. } => "init.create_dir_failed",
            InitError::WriteConfigFailed { .. } => "init.write_config_failed",
            InitError::WriteGitignoreFailed { .. } => "init.write_gitignore_failed",
        }
    }
}

impl std::error::Error for InitError {}

/// Result of a successful `init` run, reported back to the caller for
/// user-facing output (dispatch.rs prints a summary from this).
#[derive(Debug)]
pub struct InitResult {
    pub konductor_dir: PathBuf,
    pub config_path: PathBuf,
    pub gitignore_path: PathBuf,
    /// Whether `gitignore_path` was newly written by this run (`true`)
    /// or left untouched because a `.gitignore` already existed there
    /// (`false`) -- see the "never clobber" comment at the write site
    /// below. Lets callers (dispatch.rs) report the actual outcome
    /// instead of a single message that would misleadingly claim a
    /// write happened even when the existing file was left alone.
    pub gitignore_written: bool,
}

/// Scaffolds `.konductor/` under `target_dir`: creates the directory (if
/// absent, or unconditionally when `force` is true) and writes a starter
/// `config.yml` derived from the preset defaults.
///
/// `target_dir` is the directory `.konductor/` should be created under
/// (the current working directory in normal CLI use; parameterized here
/// so tests can point at a scratch directory instead of mutating the
/// real cwd).
pub fn run_init(target_dir: &Path, force: bool) -> Result<InitResult, InitError> {
    let konductor_dir = target_dir.join(config::KONDUCTOR_DIR_NAME);

    if konductor_dir.exists() && !force {
        return Err(InitError::AlreadyExists {
            path: konductor_dir,
        });
    }

    fs::create_dir_all(&konductor_dir).map_err(|source| InitError::CreateDirFailed {
        path: konductor_dir.clone(),
        source,
    })?;

    // The starter config is a verbatim copy of the preset defaults'
    // compiled-in TEXT (not a round-tripped re-serialization of the
    // parsed Config struct), so the project's new `.konductor/config.yml`
    // keeps the preset's comments/formatting intact for the user to read
    // and edit -- re-serializing the already-validated `Config` would
    // lose comments and reorder keys per serde_yaml's own field order.
    // The preset is embedded at compile time (`config::PRESET_CONFIG_CONTENTS`),
    // so there is no filesystem read here to fail -- see config.rs's
    // `PRESET_CONFIG_CONTENTS` docstring for why.
    //
    // Written via `write_atomic` (write-temp-file-then-rename) rather
    // than a direct `fs::write`, so a crash/kill mid-write can never
    // leave a partially-written `config.yml` behind -- see
    // atomic_write.rs's module docstring.
    let config_path = konductor_dir.join(config::CONFIG_FILE_NAME);
    write_atomic(&config_path, config::PRESET_CONFIG_CONTENTS.as_bytes()).map_err(|source| {
        InitError::WriteConfigFailed {
            path: config_path.clone(),
            source,
        }
    })?;

    // Never clobber a user-edited `.gitignore` -- only write one if
    // absent, even under `--force` (which governs re-scaffolding
    // `.konductor/`, not overwriting hand-authored files inside it).
    let gitignore_path = konductor_dir.join(GITIGNORE_FILE_NAME);
    let gitignore_written = !gitignore_path.exists();
    if gitignore_written {
        let contents = format!("{}\n", GITIGNORE_PATTERNS.join("\n"));
        write_atomic(&gitignore_path, contents.as_bytes()).map_err(|source| {
            InitError::WriteGitignoreFailed {
                path: gitignore_path.clone(),
                source,
            }
        })?;
    }

    Ok(InitResult {
        konductor_dir,
        config_path,
        gitignore_path,
        gitignore_written,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-init-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_konductor_dir_and_config() {
        let root = scratch_dir("basic");
        let result = run_init(&root, false).expect("init must succeed on an empty target");
        assert!(result.konductor_dir.is_dir());
        assert!(result.config_path.is_file());
        assert!(
            result.gitignore_written,
            "gitignore_written must be true when a fresh .gitignore was written"
        );
        let contents = fs::read_to_string(&result.config_path).unwrap();
        assert!(contents.contains("version: 1"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn refuses_to_clobber_existing_dir_without_force() {
        let root = scratch_dir("no-clobber");
        run_init(&root, false).expect("first init must succeed");
        let err = run_init(&root, false).expect_err("second init without --force must fail");
        assert!(matches!(err, InitError::AlreadyExists { .. }));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn force_overwrites_existing_dir() {
        let root = scratch_dir("force-overwrite");
        run_init(&root, false).expect("first init must succeed");
        // Mutate the config so we can prove --force actually rewrites it.
        let config_path = root
            .join(config::KONDUCTOR_DIR_NAME)
            .join(config::CONFIG_FILE_NAME);
        fs::write(&config_path, "version: 1\ncorrupted: true\n").unwrap();

        run_init(&root, true).expect("init with --force must succeed even if .konductor exists");
        let contents = fs::read_to_string(&config_path).unwrap();
        assert!(!contents.contains("corrupted"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resulting_config_is_loadable() {
        // End-to-end: init's output must itself satisfy config::load_config,
        // otherwise a freshly-initialized project would immediately fail
        // its own config validation. Uses `load_config_with_home(&root,
        // None)` rather than `load_config(&root)` -- this only cares
        // about the project tier init just wrote, so it must not read
        // the real process-global $HOME env var (unsafe to do from
        // parallel `cargo test` threads without the crate-wide
        // HOME_ENV_LOCK; see config.rs's own `load_config_with_home` doc
        // comment and its sibling tests using the same pattern).
        let root = scratch_dir("loadable");
        run_init(&root, false).expect("init must succeed");
        config::load_config_with_home(&root, None)
            .expect("freshly-initialized config must load and validate");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn writes_gitignore_with_documented_patterns_on_fresh_init() {
        let root = scratch_dir("gitignore-fresh");
        let result = run_init(&root, false).expect("init must succeed on an empty target");
        assert!(result.gitignore_path.is_file());
        let contents = fs::read_to_string(&result.gitignore_path).unwrap();
        for pattern in GITIGNORE_PATTERNS {
            assert!(
                contents.contains(pattern),
                "gitignore must contain documented pattern {pattern}, got: {contents}"
            );
        }
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn does_not_clobber_existing_user_edited_gitignore() {
        let root = scratch_dir("gitignore-no-clobber");
        let konductor_dir = root.join(config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        let gitignore_path = konductor_dir.join(GITIGNORE_FILE_NAME);
        fs::write(&gitignore_path, "# hand-authored\nmy-custom-pattern/\n").unwrap();

        // Fresh init (no --force) refuses because .konductor/ already
        // exists -- exercise the --force path, which must still leave a
        // pre-existing .gitignore alone.
        let result = run_init(&root, true).expect("init with --force must succeed");
        assert!(
            !result.gitignore_written,
            "gitignore_written must be false when a pre-existing .gitignore was left untouched"
        );
        let contents = fs::read_to_string(&gitignore_path).unwrap();
        assert!(
            contents.contains("my-custom-pattern/"),
            "a user-edited .gitignore must not be clobbered, got: {contents}"
        );
        assert!(
            !contents.contains("overrides.yml"),
            "must not silently merge in the documented patterns either -- the file is left \
             completely untouched, got: {contents}"
        );
        fs::remove_dir_all(&root).ok();
    }
}
