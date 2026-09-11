// SPDX-License-Identifier: Apache-2.0
//
// cli.rs — `--skills-dir`/`--skill-name-filter` argument parsing, this
// server's on-disk path conventions, and directory validation.
//
// Path conventions mirror the Konductor CLI's on-disk layout (see
// cli/konductor-rs/src/cli/logging.rs and src/cli/install/kiro_cli.rs):
//   - installed skills:       ~/.konductor/skills/
//   - workspace-local skills: <workspace>/.konductor/skills/
//   - this server's logs:     ~/.konductor/mcp/logs/mcp-YYYYMMDD.log
//     (per docs/design/konductor-skill-lookup-design.md §4.9; owned by
//     `skill_lookup_core::logging`, not by this file)
//
// Split out of main.rs (which originally held all server-specific code
// alongside the MCP protocol/handler wiring in `handlers.rs`) so each
// file holds one concern: this one resolves *where* to scan, `handlers.rs`
// answers MCP calls over *what was scanned*.
use std::path::{Path, PathBuf};

use clap::Parser;
use skill_lookup_core::{logging::Level, model::ResolvedDir, scanner};

/// Name of the `.konductor` directory used by both the CLI and this
/// server, matching `cli/konductor-rs/src/cli/config.rs`'s
/// `KONDUCTOR_DIR_NAME` constant.
pub(crate) const KONDUCTOR_DIR_NAME: &str = ".konductor";

/// Subdirectory (under a `.konductor/` root) holding installed/workspace
/// skills, matching the CLI's `install`/`uninstall` destination.
pub(crate) const SKILLS_SUBDIR: &str = "skills";

/// `--skills-dir` command-line arguments for skill-lookup-mcp.
///
/// Repeatable so callers can point the scanner at more than one skills
/// root at once — e.g. both the installed root and a workspace-local
/// root. Each value is validated to exist and be a directory at
/// startup. Collision precedence is provenance-based, not position-based:
/// `Provenance::Managed` always wins over `Provenance::Workspace`
/// regardless of scan order (see `scanner::should_replace`). The first
/// `--skills-dir` given is simply the one stamped `Managed` by
/// `resolve_skills_dirs`; every later one is stamped `Workspace`.
#[derive(Parser, Debug)]
#[command(name = "skill-lookup-mcp", about = "MCP server for skill lookup")]
pub(crate) struct Cli {
    /// Directory to search for skills. Repeatable, in precedence order
    /// (first wins on a name collision). If omitted, defaults to the
    /// installed root followed by the current-workspace root (see
    /// `default_skills_dirs`).
    #[arg(long = "skills-dir", value_name = "DIR")]
    pub(crate) skills_dir: Vec<PathBuf>,

    /// Comma-separated glob pattern(s) (only `*` is supported as a
    /// wildcard) matched case-insensitively against each skill's
    /// frontmatter `name`. Skills matching none of the patterns are
    /// excluded from the index. Applied once at startup and re-applied,
    /// unchanged, on every `reload_skills` call.
    #[arg(long = "skill-name-filter", value_name = "GLOB")]
    pub(crate) skill_name_filter: Option<String>,

    /// Directory to search for agent SOPs (`<name>.sop.md` files), each
    /// served as an MCP prompt. Repeatable, in precedence order (first
    /// wins on a name collision). Mirrors `--skills-dir`'s shape: each
    /// value is tilde-expanded, deduplicated, and validated to exist and
    /// be a directory at startup. Unlike `--skills-dir` there is no
    /// default — if omitted, the server serves no prompts.
    #[arg(long = "agent-sop-paths", value_name = "DIR")]
    pub(crate) agent_sop_paths: Vec<PathBuf>,

    /// Comma-separated glob pattern(s) (only `*` is supported as a
    /// wildcard) matched case-insensitively against each SOP's name (its
    /// filename with the `.sop.md` suffix stripped). SOPs matching none
    /// of the patterns are excluded. Mirrors `--skill-name-filter`'s
    /// shape and semantics, for prompts instead of skills.
    #[arg(long = "agent-sop-filter", value_name = "GLOB")]
    pub(crate) agent_sop_filter: Option<String>,

    /// Enable or disable usage-analytics telemetry for this server
    /// process (design doc D.8). A `ValueEnum`, not a bare `String`: an
    /// unrecognized value is rejected at parse time rather than silently
    /// leaving telemetry on. Structural: when `off`, the periodic flush
    /// task is never started at all.
    #[arg(long = "telemetry", value_enum, default_value = "on")]
    pub(crate) telemetry: TelemetryMode,
}

/// `--telemetry`'s accepted values (design doc §5.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum TelemetryMode {
    On,
    Off,
}

/// Returns the default installed-skills directory: `~/.konductor/skills/`,
/// built from the `home` value the caller passes in rather than reading
/// `HOME` itself. `None` if `home` is absent or empty (mirrors the CLI's
/// fail-open convention for home-directory resolution in
/// `cli/logging.rs`). Tests call this directly with `None` to exercise
/// the unset-`HOME` case without mutating the process environment, which
/// would be racy across Rust's parallel test threads.
fn default_installed_skills_dir_with_home(home: Option<std::ffi::OsString>) -> Option<PathBuf> {
    let home = home?;
    if home.is_empty() {
        return None;
    }
    Some(
        PathBuf::from(home)
            .join(KONDUCTOR_DIR_NAME)
            .join(SKILLS_SUBDIR),
    )
}

/// Returns the workspace-local skills directory for a given workspace
/// root: `<workspace>/.konductor/skills/`.
fn workspace_skills_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(KONDUCTOR_DIR_NAME).join(SKILLS_SUBDIR)
}

/// Default `--skills-dir` set when the flag isn't passed at all: the
/// installed root, then the current-directory-relative workspace root —
/// matching `konductor mcp --skills-dir ~/.konductor/skills --skills-dir
/// .konductor/skills`. Either half may be absent (no `HOME` drops the
/// first; the second is always relative to the process's cwd, so it
/// needs nothing).
///
/// Each root's `Provenance` is attached here, at the point the root is
/// derived, rather than left for `resolve_skills_dirs` to infer from
/// list position: the installed root is `Managed` because it IS the
/// installed root, not because it happens to land first. Deriving it
/// from position instead would mislabel the workspace root `Managed`
/// whenever a missing `HOME` drops the installed entry and leaves the
/// workspace root at position 0.
///
/// Built from the `home` value the caller passes in, rather than reading
/// `HOME` itself, so tests can exercise the unset-`HOME` case with `None`
/// instead of mutating the process environment, which would be racy
/// across Rust's parallel test threads.
fn default_skills_dirs_with_home(home: Option<std::ffi::OsString>) -> Vec<ResolvedDir> {
    let mut dirs = Vec::new();
    if let Some(installed) = default_installed_skills_dir_with_home(home) {
        dirs.push(ResolvedDir::managed(installed));
    }
    dirs.push(ResolvedDir::workspace(workspace_skills_dir(Path::new("."))));
    dirs
}

/// Expands a leading `~` in `path` to the current user's home directory.
///
/// Supports `~/rest/of/path` and a bare `~` (treated as `~/`). Does not
/// support `~user` — expanding another user's home directory needs a
/// passwd-database lookup this binary doesn't depend on — and returns an
/// error for that form rather than leaving it un-expanded, so a caller
/// doesn't end up scanning a literal directory named `~someuser`.
///
/// A `~` that isn't at the very start of the path (e.g. `foo/~bar`) is
/// left untouched; only leading-tilde expansion is a shell convention
/// worth replicating here.
///
/// This is a thin wrapper over `expand_tilde_with_home` that reads the
/// real `HOME` environment variable. Tests call `expand_tilde_with_home`
/// directly with a fake home instead of touching process environment,
/// which would be racy across Rust's parallel test threads and would
/// tie test outcomes to whatever `HOME` happens to be — including
/// unset, as it is in this crate's minimal build sandbox.
fn expand_tilde(path: &Path) -> Result<PathBuf, String> {
    expand_tilde_with_home(path, std::env::var_os("HOME"))
}

/// Pure core of tilde expansion: expands a leading `~` in `path` using
/// the `home` value the caller passes in, rather than reading any
/// environment variable itself. `home` being `None` and `home` being
/// present-but-empty are treated identically — both mean "no home
/// available," and both return the same diagnostic `expand_tilde`'s
/// callers expect. Never a panic, never a path that silently treats `~`
/// as a literal directory name.
///
/// Operates on raw bytes (`OsStrExt`, Unix-only) rather than
/// `to_string_lossy()`: a lossy `String` replaces any non-UTF-8 byte in
/// `path` with U+FFFD, and reconstructing a path from that lossy string
/// (as the `~/` branch below must, via `home.join(rest)`) would corrupt
/// a valid-on-disk-but-non-UTF-8 tail instead of preserving it
/// byte-for-byte. Only the leading byte(s) are inspected to classify the
/// path (bare `~`, `~/`, `~user`, or no leading `~`); the remainder is
/// never round-tripped through `str`/`String`. This crate is Unix-only
/// (see the `#[cfg(unix)]`-gated symlink/permission tests in
/// `scanner.rs`), so gating on `unix` here matches existing precedent
/// rather than introducing a new platform assumption.
#[cfg(unix)]
fn expand_tilde_with_home(
    path: &Path,
    home: Option<std::ffi::OsString>,
) -> Result<PathBuf, String> {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;

    let bytes = path.as_os_str().as_bytes();
    let Some(rest) = bytes.strip_prefix(b"~") else {
        return Ok(path.to_path_buf());
    };

    if rest.is_empty() {
        // Bare "~" — treated as "~/".
        return home_dir_or_err(path, home);
    }
    if let Some(after_slash) = rest.strip_prefix(b"/") {
        let home = home_dir_or_err(path, home)?;
        return Ok(if after_slash.is_empty() {
            home
        } else {
            home.join(OsStr::from_bytes(after_slash))
        });
    }

    // Anything else starting with "~" but not "~/" or bare "~" is the
    // unsupported "~user" form.
    Err(format!(
        "{}: ~user expansion is not supported; use an absolute path",
        path.display()
    ))
}

/// Non-Unix fallback: identical observable behavior to the `unix` build,
/// implemented over `to_string_lossy()` since `OsStrExt`'s raw-byte view
/// is Unix-only. This crate currently only ships/builds for Linux (see
/// the module doc comment's on-disk path conventions), so the lossy
/// corruption this function is otherwise vulnerable to has no real
/// non-Unix caller today — this arm exists so a hypothetical non-Unix
/// build still compiles and behaves sanely, not because it's exercised.
#[cfg(not(unix))]
fn expand_tilde_with_home(
    path: &Path,
    home: Option<std::ffi::OsString>,
) -> Result<PathBuf, String> {
    let path_str = path.to_string_lossy();
    let Some(rest) = path_str.strip_prefix('~') else {
        return Ok(path.to_path_buf());
    };

    if rest.is_empty() {
        // Bare "~" — treated as "~/".
        return home_dir_or_err(path, home);
    }
    if let Some(after_slash) = rest.strip_prefix('/') {
        let home = home_dir_or_err(path, home)?;
        return Ok(if after_slash.is_empty() {
            home
        } else {
            home.join(after_slash)
        });
    }

    // Anything else starting with "~" but not "~/" or bare "~" is the
    // unsupported "~user" form.
    Err(format!(
        "{}: ~user expansion is not supported; use an absolute path",
        path.display()
    ))
}

/// Resolves `home` into a home-directory `PathBuf`, or a diagnostic
/// naming `original` (the path that couldn't be expanded) if `home` is
/// absent or empty. Never panics — a missing or empty home directory is
/// an expected, handled condition, not a programming error.
fn home_dir_or_err(original: &Path, home: Option<std::ffi::OsString>) -> Result<PathBuf, String> {
    match home {
        Some(home) if !home.is_empty() => Ok(PathBuf::from(home)),
        _ => Err(format!(
            "{}: cannot expand '~' because HOME is not set",
            original.display()
        )),
    }
}

/// Where the skills-dir list being resolved came from, so a failure
/// message can name what the operator actually did. An operator who
/// passed no arguments at all shouldn't be told about a `--skills-dir`
/// flag they never used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DirSource {
    /// At least one `--skills-dir` was passed explicitly.
    Explicit,
    /// No `--skills-dir` was passed; `default_skills_dirs_with_home` supplied the
    /// list.
    Default,
}

impl DirSource {
    /// How to refer to one of these directories in a message.
    fn label(self) -> &'static str {
        match self {
            DirSource::Explicit => "--skills-dir",
            DirSource::Default => "default skills dir",
        }
    }
}

/// The label agent-SOP directory validation messages use, so a bad
/// `--agent-sop-paths` entry names the flag the operator actually
/// passed. Not a `DirSource` variant: `DirSource` is the skills-dir
/// source (explicit flag vs. default), and folding the SOP flag into it
/// would force the skills-only "all paths invalid" summary match to
/// carry an arm it can never reach.
const AGENT_SOP_PATHS_LABEL: &str = "--agent-sop-paths";

/// Validates a single directory (after tilde expansion): it must exist
/// and be a directory. Returns an error string on failure so the caller
/// can report every bad path at once instead of stopping at the first.
/// `label` decides how the path is described (`--skills-dir`, `default
/// skills dir`, or `--agent-sop-paths`), since the same check runs over
/// both the skill and SOP directory lists.
///
/// This is check-then-use, not an atomic guarantee — nothing stops the
/// directory from being removed or swapped for a symlink between this
/// check and the scanner actually reading it. That race is a known,
/// accepted gap: the scanner treats it as an ordinary per-entry I/O
/// error (`SkipReason::IoError`), not a crash.
fn validate_dir(path: &Path, label: &str) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("{label} {}: {e}", path.display()))?;
    if !metadata.is_dir() {
        return Err(format!("{label} {}: not a directory", path.display()));
    }
    Ok(())
}

/// Result of resolving the effective skills-dir list: the directories
/// that passed validation — each carrying the `Provenance` its requested
/// position earned it — plus every warning or error message collected
/// along the way (tilde-expansion failures, bad individual paths, and —
/// if every path turned out invalid — the "nothing to scan" summary).
/// `valid` can be empty while `messages` isn't: an all-invalid set is a
/// startup warning, not a fatal error, so the server still starts with an
/// empty catalog.
///
/// Each message carries the `Level` its caller should log it at, per
/// §4.9's table: an individual bad path (tilde-expansion failure, or a
/// `--skills-dir` that doesn't exist or isn't a directory) is `Warn`;
/// the "every configured path was invalid" summary — the only case where
/// the server ends up scanning nothing at all — is `Error`.
pub(crate) struct ResolvedSkillsDirs {
    pub(crate) valid: Vec<ResolvedDir>,
    pub(crate) messages: Vec<(Level, String)>,
}

/// Resolves the effective, deduplicated list of skills directories to
/// scan: falls back to `default_skills_dirs_with_home` when no `--skills-dir`
/// was passed, expands a leading `~` in each path, and drops duplicate
/// roots (keeping the first occurrence, preserving precedence order) — a
/// repeated root would otherwise double the scan work and make every
/// skill in it collide with itself.
///
/// Dedup compares canonicalized paths, using the same
/// `scanner::canonical_root` the scan itself uses, because two different
/// spellings of one directory are not textually equal but do produce
/// exactly that self-collision. The default list is such a pair whenever
/// the process runs with its cwd at `$HOME`: `~/.konductor/skills` and
/// `./.konductor/skills` are then the same directory. A path that can't
/// be canonicalized (it doesn't exist) falls back to its textual form as
/// the dedup key — it's about to fail validation anyway.
///
/// Each explicit `--skills-dir`'s `Provenance` is fixed from its
/// position in the *requested* order, before dedup or validation can
/// drop anything, and travels with it from this point on; see
/// `model::Provenance` for why re-deriving it later would be wrong. The
/// defaulted list instead arrives with provenance already attached
/// per-root by `default_skills_dirs_with_home`, carried through unchanged here
/// rather than re-stamped by this function's own candidate positions —
/// re-deriving it from position was the trust hole this fixes, since a
/// missing `HOME` drops the installed candidate and would otherwise
/// leave the workspace root at position 0, earning it `Managed`.
///
/// A path that fails tilde expansion or validation is dropped from
/// `valid` and recorded in `messages` rather than aborting the whole
/// resolution, so one bad entry doesn't block every other valid one from
/// being scanned.
pub(crate) fn resolve_skills_dirs(raw: &[PathBuf]) -> ResolvedSkillsDirs {
    resolve_skills_dirs_with_home(raw, std::env::var_os("HOME"))
}

/// Pure core of `resolve_skills_dirs`: identical behavior, but the
/// default-candidate branch (`raw.is_empty()`) builds its list via
/// `default_skills_dirs_with_home(home)` instead of reading `HOME`
/// itself. Tests call this directly with `home: None` to exercise the
/// unset-`HOME` default path without mutating the process environment,
/// which would be racy across Rust's parallel test threads.
fn resolve_skills_dirs_with_home(
    raw: &[PathBuf],
    home: Option<std::ffi::OsString>,
) -> ResolvedSkillsDirs {
    let (candidates, source) = if raw.is_empty() {
        (default_skills_dirs_with_home(home), DirSource::Default)
    } else {
        (
            raw.iter()
                .enumerate()
                .map(|(position, path)| {
                    if position == 0 {
                        ResolvedDir::managed(path.clone())
                    } else {
                        ResolvedDir::workspace(path.clone())
                    }
                })
                .collect(),
            DirSource::Explicit,
        )
    };

    // Tilde-expand each candidate's path, preserving the provenance it
    // already carries (stamped above for the explicit path, or by
    // `default_skills_dirs_with_home` for the default path) rather than
    // re-deriving it from this loop's own position.
    let mut messages = Vec::new();
    let mut expanded: Vec<ResolvedDir> = Vec::new();
    for dir in &candidates {
        match expand_tilde(&dir.path) {
            Ok(p) => expanded.push(ResolvedDir {
                path: p,
                provenance: dir.provenance,
            }),
            Err(e) => messages.push((Level::Warn, e)),
        }
    }

    let mut seen = std::collections::HashSet::new();
    let mut valid = Vec::new();
    for dir in expanded {
        let key = scanner::canonical_root(&dir.path).unwrap_or_else(|| dir.path.clone());
        if !seen.insert(key) {
            continue;
        }
        match validate_dir(&dir.path, source.label()) {
            Ok(()) => valid.push(dir),
            Err(e) => messages.push((Level::Warn, e)),
        }
    }
    if valid.is_empty() {
        let message = match source {
            DirSource::Explicit => {
                "all --skills-dir paths invalid — server starting with empty skill catalog"
                    .to_string()
            }
            DirSource::Default => {
                "no default skills directory found — server starting with empty skill catalog"
                    .to_string()
            }
        };
        messages.push((Level::Error, message));
    }

    ResolvedSkillsDirs { valid, messages }
}

/// Result of resolving the effective `--agent-sop-paths` list: the
/// directories that passed validation, plus every warning or error
/// message collected along the way. Simpler than `ResolvedSkillsDirs`:
/// SOP directories carry no `Provenance` (there is no managed/workspace
/// trust split for prompts), so this is a plain `Vec<PathBuf>`.
pub(crate) struct ResolvedAgentSopPaths {
    pub(crate) valid: Vec<PathBuf>,
    pub(crate) messages: Vec<String>,
}

/// Resolves the effective, deduplicated list of `--agent-sop-paths`
/// directories to scan, mirroring `resolve_skills_dirs`' shape for the
/// SOP flag: expands a leading `~` in each path, drops duplicate roots
/// (comparing canonicalized paths, keeping the first occurrence), and
/// validates each is an existing directory. A path that fails expansion
/// or validation is dropped from `valid` and recorded in `messages`
/// rather than aborting the whole resolution.
///
/// Unlike `resolve_skills_dirs` there is no default: an empty `raw`
/// returns an empty result with no messages — serving no prompts is the
/// normal state when the flag isn't passed, not a warnable condition. If
/// `raw` is non-empty but every path is invalid, a single summary
/// message is added (paralleling the "all --skills-dir paths invalid"
/// warning) so the empty prompt catalog is explained rather than silent.
pub(crate) fn resolve_agent_sop_paths(raw: &[PathBuf]) -> ResolvedAgentSopPaths {
    if raw.is_empty() {
        return ResolvedAgentSopPaths {
            valid: Vec::new(),
            messages: Vec::new(),
        };
    }

    let mut messages = Vec::new();
    let mut expanded: Vec<PathBuf> = Vec::new();
    for path in raw {
        match expand_tilde(path) {
            Ok(p) => expanded.push(p),
            Err(e) => messages.push(e),
        }
    }

    let mut seen = std::collections::HashSet::new();
    let mut valid = Vec::new();
    for path in expanded {
        let key = scanner::canonical_root(&path).unwrap_or_else(|| path.clone());
        if !seen.insert(key) {
            continue;
        }
        match validate_dir(&path, AGENT_SOP_PATHS_LABEL) {
            Ok(()) => valid.push(path),
            Err(e) => messages.push(e),
        }
    }

    if valid.is_empty() {
        messages
            .push("all --agent-sop-paths invalid — server starting with no agent SOPs".to_string());
    }

    ResolvedAgentSopPaths { valid, messages }
}

/// Test-only serialization point for the tests that have to change the
/// process's current directory to exercise a cwd-relative path (a
/// relative `--skills-dir`, and the cwd==`$HOME` default pair). The cwd
/// is per-process, not per-thread, so two such tests running on Rust's
/// parallel test threads would each scan the other's directory. Any test
/// that calls `set_current_dir` must hold this first.
#[cfg(test)]
pub(crate) mod cwd_lock {
    use std::sync::{Mutex, MutexGuard};

    static CWD_LOCK: Mutex<()> = Mutex::new(());

    /// Takes the lock, recovering rather than propagating if a previous
    /// holder panicked — poisoning here says nothing about the cwd.
    pub(crate) fn lock() -> MutexGuard<'static, ()> {
        CWD_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use skill_lookup_core::model::Provenance;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skill-lookup-main-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn expand_tilde_leaves_absolute_path_untouched() {
        let path = PathBuf::from("/absolute/path");
        assert_eq!(expand_tilde(&path).unwrap(), path);
    }

    #[test]
    fn expand_tilde_expands_leading_tilde_slash() {
        let home = std::ffi::OsString::from("/fake/home");
        let expanded =
            expand_tilde_with_home(&PathBuf::from("~/.konductor/skills"), Some(home.clone()))
                .unwrap();
        assert_eq!(
            expanded,
            PathBuf::from(home).join(".konductor").join("skills")
        );
    }

    #[test]
    fn expand_tilde_bare_tilde_is_home() {
        let home = std::ffi::OsString::from("/fake/home");
        let expanded = expand_tilde_with_home(&PathBuf::from("~"), Some(home.clone())).unwrap();
        assert_eq!(expanded, PathBuf::from(home));
    }

    #[test]
    fn expand_tilde_with_home_none_is_a_clean_error_not_a_panic() {
        // Pins the missing-HOME behavior: a clean `Err`, never a panic
        // and never a literal `~`, when there's no home directory at
        // all — the exact condition that always holds in this crate's
        // minimal build sandbox.
        let err = expand_tilde_with_home(&PathBuf::from("~/.konductor/skills"), None).unwrap_err();
        assert!(err.contains("cannot expand '~' because HOME is not set"));
    }

    #[test]
    fn expand_tilde_with_home_empty_is_treated_same_as_absent() {
        // `HOME=` (present but empty) must fail the same way as `HOME`
        // being unset entirely, not silently resolve to `PathBuf::from("")`.
        let err = expand_tilde_with_home(
            &PathBuf::from("~/.konductor/skills"),
            Some(std::ffi::OsString::from("")),
        )
        .unwrap_err();
        assert!(err.contains("cannot expand '~' because HOME is not set"));
    }

    #[test]
    fn expand_tilde_user_form_is_unsupported() {
        let err = expand_tilde(&PathBuf::from("~otheruser/skills")).unwrap_err();
        assert!(err.contains("~user expansion is not supported"));
    }

    #[cfg(unix)]
    #[test]
    fn expand_tilde_with_home_preserves_non_utf8_bytes_in_the_tail() {
        // `to_string_lossy()` replaces invalid UTF-8 with U+FFFD before
        // the "~/" branch rebuilds the path via `home.join(after_slash)`,
        // so a non-UTF-8 tail comes back corrupted instead of byte-for-byte.
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let home = std::ffi::OsString::from("/fake/home");
        let raw_tail: &[u8] = b"skills-\xFF\xFEbad";
        let mut raw_path_bytes = b"~/".to_vec();
        raw_path_bytes.extend_from_slice(raw_tail);
        let path = PathBuf::from(OsStr::from_bytes(&raw_path_bytes));

        let expanded = expand_tilde_with_home(&path, Some(home.clone())).unwrap();
        let expected = PathBuf::from(home).join(OsStr::from_bytes(raw_tail));
        assert_eq!(
            expanded, expected,
            "non-UTF-8 tail must be preserved byte-for-byte, not replaced with U+FFFD"
        );
    }

    /// Just the paths from a resolution, for the assertions that don't
    /// care about provenance.
    fn paths(resolved: &ResolvedSkillsDirs) -> Vec<PathBuf> {
        resolved.valid.iter().map(|d| d.path.clone()).collect()
    }

    #[test]
    fn resolve_skills_dirs_deduplicates_repeated_paths() {
        let dir = temp_dir("dedup");
        let raw = vec![dir.clone(), dir.clone()];
        let resolved = resolve_skills_dirs(&raw);
        assert_eq!(paths(&resolved), vec![dir.clone()]);
        assert!(resolved.messages.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_skills_dirs_deduplicates_two_spellings_of_one_dir() {
        // Textual dedup only catches a byte-identical repeat. These two
        // spellings name the same directory, so without canonicalizing
        // first, both survive and the root gets scanned twice.
        let dir = temp_dir("dedup-spellings");
        let child = dir.join("child");
        fs::create_dir_all(&child).unwrap();
        let round_trip = child.join("..");
        let raw = vec![dir.clone(), round_trip];
        let resolved = resolve_skills_dirs(&raw);
        assert_eq!(paths(&resolved), vec![dir.clone()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_skills_dirs_when_cwd_is_home_resolve_to_one_root() {
        // The default pair is `$HOME/.konductor/skills` and
        // `./.konductor/skills`. When the process's cwd IS `$HOME` — the
        // documented cwd==$HOME case — those are one directory under two
        // spellings, so the shipped defaults were themselves the
        // self-collision `resolve_skills_dirs` exists to prevent: two
        // scanned roots, and every skill in the root colliding with
        // itself (a WARN whose winning_path and losing_path were the
        // identical string).
        let home = temp_dir("cwd-equals-home");
        let skills = home.join(KONDUCTOR_DIR_NAME).join(SKILLS_SUBDIR);
        fs::create_dir_all(&skills).unwrap();
        let skill_dir = skills.join("thing");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: thing\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        // The exact default candidate list for HOME=`home`, built without
        // mutating the process's own HOME (racy across parallel tests).
        let candidates = vec![skills.clone(), workspace_skills_dir(Path::new("."))];

        let _cwd_guard = cwd_lock::lock();
        let original_cwd = std::env::current_dir().unwrap();
        std::env::set_current_dir(&home).unwrap();
        let resolved = resolve_skills_dirs(&candidates);
        let (index, diagnostic) = scanner::build_index(&resolved.valid);
        std::env::set_current_dir(&original_cwd).unwrap();

        assert_eq!(
            diagnostic.dir_count,
            1,
            "cwd==$HOME makes both defaults one directory; scanned roots: {:?}",
            paths(&resolved)
        );
        assert!(
            diagnostic.collisions.is_empty(),
            "no skill may collide with itself; got: {:?}",
            diagnostic.collisions
        );
        assert_eq!(index.len(), 1);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn resolve_skills_dirs_preserves_precedence_order() {
        let dir_a = temp_dir("order-a");
        let dir_b = temp_dir("order-b");
        let raw = vec![dir_a.clone(), dir_b.clone()];
        let resolved = resolve_skills_dirs(&raw);
        assert_eq!(paths(&resolved), vec![dir_a.clone(), dir_b.clone()]);
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn missing_managed_root_does_not_promote_a_workspace_root_to_managed() {
        // `~/.konductor/skills` not existing is the normal state before
        // anything has been installed. Deriving provenance from the
        // post-validation list's positions then made the workspace-local
        // root dirs[0], stamping every project-supplied skill `Managed` —
        // the "managed/installed root" trust label — purely because the
        // root above it was dropped.
        let workspace = temp_dir("missing-managed-root");
        let skill_dir = workspace.join("project-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: project-skill\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        let raw = vec![
            PathBuf::from("/definitely/no/such/managed/root"),
            workspace.clone(),
        ];
        let resolved = resolve_skills_dirs(&raw);

        assert_eq!(paths(&resolved), vec![workspace.clone()]);
        assert_eq!(resolved.valid[0].provenance, Provenance::Workspace);

        let (index, _diag) = scanner::build_index(&resolved.valid);
        assert_eq!(
            index.get("project-skill").unwrap().provenance,
            Provenance::Workspace
        );
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn home_unset_does_not_promote_the_default_workspace_root_to_managed() {
        // The trust hole this test regresses: `default_skills_dirs_with_home`
        // drops the installed candidate entirely when `HOME` is unset,
        // so the cwd-relative workspace root became `candidates[0]` —
        // and provenance used to be re-derived from that position, which
        // handed it `Managed`. This exercises the real `--skills-dir`-less
        // path via `resolve_skills_dirs_with_home(&[], None)` — the same
        // code `resolve_skills_dirs(&[])` runs, just with an injected
        // absent `HOME` instead of a mutated process environment, which
        // would be racy across Rust's parallel test threads.
        let cwd_workspace = temp_dir("home-unset-default");
        let skills_root = cwd_workspace.join(KONDUCTOR_DIR_NAME).join(SKILLS_SUBDIR);
        let real_skill_dir = skills_root.join("project-skill");
        fs::create_dir_all(&real_skill_dir).unwrap();
        fs::write(
            real_skill_dir.join("SKILL.md"),
            "---\nname: project-skill\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        let _cwd_guard = cwd_lock::lock();
        let original_cwd = std::env::current_dir().unwrap();
        std::env::set_current_dir(&cwd_workspace).unwrap();

        let resolved = resolve_skills_dirs_with_home(&[], None);
        // `build_index` must run before cwd is restored: `resolved.valid`
        // holds the relative path `./.konductor/skills`, which only
        // resolves to `cwd_workspace` while that's still the process cwd.
        let (index, _diag) = scanner::build_index(&resolved.valid);

        std::env::set_current_dir(&original_cwd).unwrap();

        assert_eq!(
            resolved.valid.len(),
            1,
            "HOME unset must drop the installed candidate, leaving only the workspace root"
        );
        assert_eq!(
            resolved.valid[0].provenance,
            Provenance::Workspace,
            "the cwd workspace root must stay Workspace, not be promoted to Managed \
             just because it landed at position 0 once HOME dropped the installed root"
        );

        assert_eq!(
            index.get("project-skill").unwrap().provenance,
            Provenance::Workspace
        );
        let _ = fs::remove_dir_all(&cwd_workspace);
    }

    #[test]
    fn managed_root_lost_to_tilde_expansion_does_not_promote_the_next_root() {
        // The same promotion hazard as the missing-managed-root case, but
        // reached through the other way a first entry can disappear: an
        // unsupported `~user` path never even makes it to validation.
        let workspace = temp_dir("tilde-failure-first");
        let raw = vec![PathBuf::from("~someuser/skills"), workspace.clone()];
        let resolved = resolve_skills_dirs(&raw);

        assert_eq!(paths(&resolved), vec![workspace.clone()]);
        assert_eq!(resolved.valid[0].provenance, Provenance::Workspace);
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn a_defaulted_path_does_not_report_a_flag_the_operator_never_passed() {
        // Asserted on `validate_dir` directly rather than through
        // `resolve_skills_dirs(&[])`, whose messages depend on whether
        // this host happens to have `~/.konductor/skills` — a vacuous
        // pass if both defaults resolve.
        let missing = Path::new("/definitely/does/not/exist/anywhere");

        let defaulted = validate_dir(missing, DirSource::Default.label()).unwrap_err();
        assert!(
            !defaulted.contains("--skills-dir"),
            "an operator who passed no arguments must not be told about a flag, got: {defaulted}"
        );
        assert!(defaulted.contains("default skills dir"), "got: {defaulted}");

        let explicit = validate_dir(missing, DirSource::Explicit.label()).unwrap_err();
        assert!(explicit.contains("--skills-dir"), "got: {explicit}");
    }

    #[test]
    fn explicit_paths_still_report_the_flag_by_name() {
        let raw = vec![PathBuf::from("/definitely/does/not/exist/anywhere")];
        let resolved = resolve_skills_dirs(&raw);
        assert!(resolved
            .messages
            .iter()
            .any(|(_, m)| m.contains("--skills-dir /definitely/does/not/exist/anywhere")));
    }

    /// §4.9's level table: an individual bad `--skills-dir` path is a
    /// `warn`, not an `error` — only the "every path was invalid"
    /// summary (see the next test) rises to `error`.
    #[test]
    fn an_individual_bad_path_is_logged_at_warn_level() {
        let raw = vec![PathBuf::from("/definitely/does/not/exist/anywhere")];
        let resolved = resolve_skills_dirs(&raw);
        assert!(resolved
            .messages
            .iter()
            .any(|(level, m)| *level == Level::Warn
                && m.contains("--skills-dir /definitely/does/not/exist/anywhere")));
    }

    #[test]
    fn resolve_skills_dirs_all_invalid_returns_empty_not_fatal() {
        let raw = vec![PathBuf::from("/definitely/does/not/exist/anywhere")];
        let resolved = resolve_skills_dirs(&raw);
        assert!(resolved.valid.is_empty());
        assert!(resolved
            .messages
            .iter()
            .any(|(_, m)| m.contains("all --skills-dir paths invalid")));
    }

    /// §4.9's level table: "ALL configured --skills-dir paths invalid
    /// (server starts with empty catalog)" is explicitly an `error`.
    #[test]
    fn all_paths_invalid_summary_is_logged_at_error_level() {
        let raw = vec![PathBuf::from("/definitely/does/not/exist/anywhere")];
        let resolved = resolve_skills_dirs(&raw);
        assert!(resolved.messages.iter().any(
            |(level, m)| *level == Level::Error && m.contains("all --skills-dir paths invalid")
        ));
    }

    #[test]
    fn resolve_skills_dirs_mix_of_valid_and_invalid_keeps_only_valid() {
        let dir = temp_dir("mixed");
        let raw = vec![
            dir.clone(),
            PathBuf::from("/definitely/does/not/exist/anywhere"),
        ];
        let resolved = resolve_skills_dirs(&raw);
        assert_eq!(paths(&resolved), vec![dir.clone()]);
        assert!(!resolved.messages.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_skills_dirs_is_nonempty() {
        // The workspace-relative default is always present, regardless
        // of HOME.
        assert!(!default_skills_dirs_with_home(std::env::var_os("HOME")).is_empty());
    }

    #[test]
    fn resolve_agent_sop_paths_empty_input_is_empty_with_no_messages() {
        // No `--agent-sop-paths` means no prompts — not a warnable
        // condition, unlike the "no default skills dir" case.
        let resolved = resolve_agent_sop_paths(&[]);
        assert!(resolved.valid.is_empty());
        assert!(resolved.messages.is_empty());
    }

    #[test]
    fn resolve_agent_sop_paths_keeps_valid_dirs_in_order() {
        let dir_a = temp_dir("sop-order-a");
        let dir_b = temp_dir("sop-order-b");
        let resolved = resolve_agent_sop_paths(&[dir_a.clone(), dir_b.clone()]);
        assert_eq!(resolved.valid, vec![dir_a.clone(), dir_b.clone()]);
        assert!(resolved.messages.is_empty());
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn resolve_agent_sop_paths_deduplicates_repeated_paths() {
        let dir = temp_dir("sop-dedup");
        let resolved = resolve_agent_sop_paths(&[dir.clone(), dir.clone()]);
        assert_eq!(resolved.valid, vec![dir.clone()]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_agent_sop_paths_all_invalid_returns_empty_with_summary_message() {
        let raw = vec![PathBuf::from("/definitely/does/not/exist/anywhere")];
        let resolved = resolve_agent_sop_paths(&raw);
        assert!(resolved.valid.is_empty());
        assert!(resolved
            .messages
            .iter()
            .any(|m| m.contains("all --agent-sop-paths invalid")));
    }

    #[test]
    fn resolve_agent_sop_paths_reports_the_flag_by_name_for_a_bad_path() {
        let raw = vec![PathBuf::from("/definitely/does/not/exist/anywhere")];
        let resolved = resolve_agent_sop_paths(&raw);
        assert!(resolved
            .messages
            .iter()
            .any(|m| m.contains("--agent-sop-paths /definitely/does/not/exist/anywhere")));
    }

    #[test]
    fn resolve_agent_sop_paths_mix_of_valid_and_invalid_keeps_only_valid() {
        let dir = temp_dir("sop-mixed");
        let raw = vec![
            dir.clone(),
            PathBuf::from("/definitely/does/not/exist/anywhere"),
        ];
        let resolved = resolve_agent_sop_paths(&raw);
        assert_eq!(resolved.valid, vec![dir.clone()]);
        assert!(!resolved.messages.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
