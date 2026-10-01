// SPDX-License-Identifier: Apache-2.0
//
// install/resource_rewrite/claude_settings.rs — merges Konductor's
// entries into a Claude Code target's settings files: the
// `permissions.allow` grant for the `konductor-skills` MCP server's tools
// (in `.claude/settings.json`), and the telemetry hooks (in the file
// `claude_hooks_settings_relative_path` picks). Also strips those hooks
// for `--no-telemetry` and uninstall. None of this is a
// `ResourceRewritePass`: it runs once per install run against
// `target_dir`, merging into files the user also owns, not once per
// agent JSON.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use super::super::manifest::{ManifestFile, Provenance};
use super::mcp_server::{MCP_SERVER_ALLOWED_TOOLS_GRANTS, MCP_SERVER_NAME};

// ── V3/Claude Code permission grant ─────────────────────────────────────
//
// Kiro agents carry their `konductor-skills` grant in their own JSON
// (`mcp_server.rs`). Claude Code has no per-agent field: the grant goes
// in `<target_dir>/.claude/settings.json`'s `permissions.allow` (see
// <https://code.claude.com/docs/en/permissions#mcp>), so it is applied
// once per install run, not per agent.
//
// `apply_claude_settings_grant_and_hooks` applies it for the Kiro V2
// (`phases.rs`'s `AgentInstallPhase`) and V3 (`kiro_cli_v3.rs`) installs,
// both gated on at least one agent receiving the `mcpServers` injection
// this run and `detect_runtimes` finding a `.claude` marker. The file is
// planned ahead (`kiro_cli/plan.rs`'s `plan_claude_settings_grant`) and
// tracked in the manifest. Uninstall never deletes it and leaves the
// grant strings in place; doctor skips it for drift
// (`is_claude_settings_path`).
//
// `merge_claude_settings_permissions` refuses a symlinked `.claude` or
// `settings.json`, and refuses a grant an existing `permissions.deny`
// entry already shadows.
//
// Known gap: nothing registers `konductor-skills` as an MCP server for
// Claude Code, so the grant is inert unless the server is registered
// some other way. That is why `ClaudeInstallStrategy` skips it.

/// Claude Code's shared project settings file (the "Shared project" tier,
/// <https://code.claude.com/docs/en/settings>). Carries the
/// `permissions.allow` grant, and the telemetry hooks only for a `$HOME`
/// install (`claude_hooks_settings_relative_path`). Konductor merges into
/// it rather than owning it, so uninstall never deletes it and doctor
/// never reports it as drift (`is_claude_settings_path`).
pub(crate) const CLAUDE_SETTINGS_RELATIVE_PATH: &str = ".claude/settings.json";

/// Claude Code's personal, uncommitted project settings file. A project
/// install writes its telemetry hooks here, so the absolute binary path
/// and install root they carry never reach teammates through git.
pub(crate) const CLAUDE_LOCAL_SETTINGS_RELATIVE_PATH: &str = ".claude/settings.local.json";

/// Whether `path` is one of the Claude settings files Konductor merges
/// into rather than owns, so uninstall never deletes it and doctor never
/// reports its hash as drift.
pub(crate) fn is_claude_settings_path(path: &str) -> bool {
    path == CLAUDE_SETTINGS_RELATIVE_PATH || path == CLAUDE_LOCAL_SETTINGS_RELATIVE_PATH
}

/// The settings file that carries the telemetry hooks for `target_dir`:
/// the user-level `~/.claude/settings.json` for a `$HOME` install (it must
/// fire in every project, and `settings.local.json` at `$HOME` only applies
/// to sessions started there), `.claude/settings.local.json` otherwise.
pub(crate) fn claude_hooks_settings_relative_path(target_dir: &Path) -> &'static str {
    let canonical =
        |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let is_home = std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .is_some_and(|home| canonical(Path::new(&home)) == canonical(target_dir));
    if is_home {
        CLAUDE_SETTINGS_RELATIVE_PATH
    } else {
        CLAUDE_LOCAL_SETTINGS_RELATIVE_PATH
    }
}

/// The `permissions.allow` grant strings this pass writes into a Claude
/// Code target's settings file, one per tool this server exposes --
/// Claude's own `mcp__<server>__<tool>` rule syntax (see
/// <https://code.claude.com/docs/en/permissions#mcp>: `mcp__puppeteer__
/// puppeteer_navigate` matches one tool from the `puppeteer` server).
/// Derived from `MCP_SERVER_ALLOWED_TOOLS_GRANTS` at call time -- same
/// tool names, reformatted -- rather than a second hand-written literal
/// list, so the two can never drift apart.
fn claude_mcp_permission_grants() -> Vec<String> {
    MCP_SERVER_ALLOWED_TOOLS_GRANTS
        .iter()
        .map(|grant| {
            let tool = grant
                .rsplit('/')
                .next()
                .expect("MCP_SERVER_ALLOWED_TOOLS_GRANTS entries always contain '/'");
            format!("mcp__{MCP_SERVER_NAME}__{tool}")
        })
        .collect()
}

/// Whether `deny_entry` (a string already present in an existing
/// `permissions.deny` array) would shadow the allow-grant `grant` (an
/// exact `mcp__<server>__<tool>` string this pass is about to add) --
/// the three ways Claude's own deny syntax can cover an MCP tool (see
/// <https://code.claude.com/docs/en/permissions#mcp>): an exact match,
/// this server's own bare-name or `__*`-wildcard forms, and the global
/// `mcp__*` wildcard that denies every MCP tool from every server.
fn deny_entry_shadows_grant(deny_entry: &str, grant: &str) -> bool {
    if deny_entry == grant || deny_entry == "mcp__*" {
        return true;
    }
    let server_prefix = format!("mcp__{MCP_SERVER_NAME}");
    deny_entry == server_prefix || deny_entry == format!("{server_prefix}__*")
}

/// Errors if `path` exists and is a symlink (of any kind, dangling or
/// not) -- never follows it. Every settings merge and removal in this
/// module calls it for `.claude` and the settings file twice: once up
/// front, and again immediately before each disk-mutating call that path
/// feeds into
/// (`create_dir_all`, `write_atomic`) -- `create_dir_all`/`File::create`/
/// `std::fs::read_to_string` all resolve symlinks transparently, so a
/// symlinked `.claude` (a directory symlink, followed during normal
/// parent-path resolution) would silently redirect the write elsewhere,
/// and a symlinked `settings.json` (a file symlink) would have its
/// target's content read and preserved into a new location.
///
/// This is a check-then-act guard, not an atomic one: a symlink swapped
/// in between this call and the disk operation it guards (a real, if
/// narrow, TOCTOU/CWE-367 window) would not be caught by either check.
/// Calling it immediately before each disk operation -- rather than
/// once, up front -- shrinks that window to the smallest gap this
/// module's plain `std::fs` calls allow, but does not eliminate it;
/// doing so would need `openat`/`O_NOFOLLOW`-style primitives this
/// crate doesn't depend on anywhere else (see `atomic_write.rs`'s own
/// Linux-only, `std`-only platform assumption). Accepted, disclosed
/// limitation for the threat model this is a local CLI operating in --
/// closing it further would need a real security engagement, not a
/// speculative dependency addition here. A missing path is not an
/// error here -- `symlink_metadata` on a nonexistent path just means
/// there is nothing to reject yet.
fn reject_symlink(path: &Path, kind: &str) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(format!(
            "{} is a symlink, not a real {kind} -- refusing to write through it; fix or \
             remove it before installing",
            path.display()
        )),
        _ => Ok(()),
    }
}

/// Why a Claude settings merge failed, so callers match on the variant
/// instead of the rendered text (several failure modes share substrings).
/// `DenyShadowed` means the grant was deliberately not applied because
/// the target already denies it; every other failure (symlink, malformed
/// JSON, I/O) is `Other`. `Deref<Target = str>` keeps `err.contains(...)`
/// working. `apply_claude_settings_grant_and_hooks` matches on the
/// variant to pick its warning.
#[derive(Debug)]
pub(super) enum ClaudeGrantError {
    DenyShadowed(String),
    Other(String),
}

impl ClaudeGrantError {
    fn message(&self) -> &str {
        match self {
            ClaudeGrantError::DenyShadowed(message) | ClaudeGrantError::Other(message) => message,
        }
    }
}

impl std::fmt::Display for ClaudeGrantError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::ops::Deref for ClaudeGrantError {
    type Target = str;
    fn deref(&self) -> &str {
        self.message()
    }
}

impl From<String> for ClaudeGrantError {
    /// Every existing `.map_err(|e| format!(...))?` site in
    /// `merge_claude_settings_permissions` keeps compiling unchanged --
    /// `?`'s implicit `From::from` conversion routes a plain `String`
    /// error into `Other`. Only the one deny-shadow return site
    /// constructs `DenyShadowed` explicitly.
    fn from(message: String) -> Self {
        ClaudeGrantError::Other(message)
    }
}

/// A settings file's full on-disk state, captured before any mutation:
/// its parsed JSON root, the original bytes (for an unchanged no-op
/// return), and the mode to preserve across the rewrite (this file is
/// the user's, and may deliberately be narrower than the default, e.g.
/// `0600`, since it can carry an `env` block or an `apiKeyHelper` path).
/// `None` text/mode means the file did not exist yet.
struct SettingsFileState {
    root: serde_json::Value,
    original_text: Option<String>,
    original_mode: Option<u32>,
}

/// `target_dir.join(relative)` and its parent `.claude` directory,
/// rejecting either if it is a symlink. Safe to call before acquiring
/// `.settings.lock`, since it only resolves paths and does not read file
/// content.
fn settings_paths(
    target_dir: &Path,
    relative: &str,
) -> Result<(PathBuf, PathBuf), ClaudeGrantError> {
    let settings_path = target_dir.join(relative);
    let claude_dir = settings_path
        .parent()
        .expect("Claude settings paths always have a parent (\".claude\")")
        .to_path_buf();
    reject_symlink(&claude_dir, "directory")?;
    reject_symlink(&settings_path, "file")?;
    Ok((settings_path, claude_dir))
}

/// Reads and parses `settings_path`, re-checking it and `claude_dir` for
/// a symlink first. An absent file parses as an empty JSON object with
/// no recorded mode. Must be called only after acquiring
/// `.settings.lock` for `claude_dir`, since the read result is the basis
/// for a subsequent write, and reading before the lock would let a
/// concurrent writer's change be read, then silently overwritten.
fn read_settings_file(
    settings_path: &Path,
    claude_dir: &Path,
) -> Result<SettingsFileState, ClaudeGrantError> {
    reject_symlink(claude_dir, "directory")?;
    reject_symlink(settings_path, "file")?;

    let original_mode: Option<u32> = if settings_path.is_file() {
        Some(
            std::fs::metadata(settings_path)
                .map_err(|e| format!("failed to stat {}: {e}", settings_path.display()))?
                .permissions()
                .mode(),
        )
    } else {
        None
    };
    let original_text: Option<String> = if settings_path.is_file() {
        Some(
            std::fs::read_to_string(settings_path)
                .map_err(|e| format!("failed to read {}: {e}", settings_path.display()))?,
        )
    } else {
        None
    };
    let root: serde_json::Value = match &original_text {
        Some(text) => serde_json::from_str(text).map_err(|e| {
            format!(
                "failed to parse {} as JSON: {e} -- fix or remove the file before installing",
                settings_path.display()
            )
        })?,
        None => serde_json::Value::Object(serde_json::Map::new()),
    };

    Ok(SettingsFileState {
        root,
        original_text,
        original_mode,
    })
}

/// Serializes `root` and writes it to `settings_path` at `original_mode`
/// (or the write helper's own default for a freshly-created file),
/// re-checking for a symlink immediately before the disk-mutating calls
/// to narrow the TOCTOU window since the earlier check in
/// `read_settings_file`. Returns the bytes now on disk.
fn write_settings_file(
    settings_path: &Path,
    claude_dir: &Path,
    root: &serde_json::Value,
    original_mode: Option<u32>,
) -> Result<Vec<u8>, ClaudeGrantError> {
    let mut bytes = serde_json::to_vec_pretty(root)
        .map_err(|e| format!("failed to serialize {}: {e}", settings_path.display()))?;
    bytes.push(b'\n');

    reject_symlink(claude_dir, "directory")?;
    reject_symlink(settings_path, "file")?;
    std::fs::create_dir_all(claude_dir)
        .map_err(|e| format!("failed to create {}: {e}", claude_dir.display()))?;
    match original_mode {
        Some(mode) => crate::cli::atomic_write::write_atomic_with_mode(settings_path, &bytes, mode),
        None => crate::cli::atomic_write::write_atomic(settings_path, &bytes),
    }
    .map_err(|e| format!("failed to write {}: {e}", settings_path.display()))?;

    Ok(bytes)
}

/// Ensures `<target_dir>/.claude/settings.json` grants every string in
/// `grants` under `permissions.allow`, creating the file and scaffolding
/// when missing. Appends only entries not already present, so reinstall
/// is idempotent. Never disturbs any other key or pre-existing
/// `allow`/`deny` entry.
///
/// Errors rather than overwriting or writing an ineffective grant when
/// `.claude` or `settings.json` is a symlink (`reject_symlink`), when
/// the file, `permissions`, `permissions.deny` or `permissions.allow` is
/// not the expected JSON shape, or when a `permissions.deny` entry
/// shadows a grant (`deny_entry_shadows_grant`, reported as
/// `ClaudeGrantError::DenyShadowed`).
///
/// Returns the bytes now on disk: the new content, or the original bytes
/// when every grant was already present and the write was skipped. The
/// caller hashes these directly rather than re-reading the file.
fn merge_claude_settings_permissions(
    target_dir: &Path,
    grants: &[String],
) -> Result<Vec<u8>, ClaudeGrantError> {
    let (settings_path, claude_dir) = settings_paths(target_dir, CLAUDE_SETTINGS_RELATIVE_PATH)?;

    // `.claude/.settings.lock` serializes every read-modify-write this
    // module does under `.claude` (grant merge, hook merge, hook removal),
    // across threads and concurrent `konductor install` runs. Must be
    // acquired before the read below: reading first and locking only for
    // the write would let two merges both read the same pre-write
    // snapshot, each compute a rewrite from it, and the later rename
    // silently drop the other's change. Held until return.
    let _lock_guard = crate::cli::config_lock::acquire_named(&claude_dir, ".settings.lock")
        .map_err(|source| format!("failed to lock {}: {source}", claude_dir.display()))?;

    let state = read_settings_file(&settings_path, &claude_dir)?;
    let SettingsFileState {
        mut root,
        original_text,
        original_mode,
    } = state;

    let Some(root_obj) = root.as_object_mut() else {
        return Err(format!(
            "{} does not contain a JSON object at its top level -- fix or remove the file \
             before installing",
            settings_path.display()
        )
        .into());
    };
    let permissions = root_obj
        .entry("permissions")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let Some(permissions_obj) = permissions.as_object_mut() else {
        return Err(format!(
            "{}'s \"permissions\" key is not a JSON object -- fix or remove the file before \
             installing",
            settings_path.display()
        )
        .into());
    };

    if let Some(deny) = permissions_obj.get("deny") {
        let Some(deny_array) = deny.as_array() else {
            return Err(format!(
                "{}'s \"permissions.deny\" key is not a JSON array -- fix or remove the file \
                 before installing",
                settings_path.display()
            )
            .into());
        };
        for grant in grants {
            let shadowed = deny_array.iter().any(|entry| {
                entry
                    .as_str()
                    .is_some_and(|deny_entry| deny_entry_shadows_grant(deny_entry, grant))
            });
            if shadowed {
                return Err(ClaudeGrantError::DenyShadowed(format!(
                    "{} already denies '{grant}' via \"permissions.deny\" -- refusing to add \
                     a shadowed, ineffective allow entry; remove the conflicting deny rule \
                     first",
                    settings_path.display()
                )));
            }
        }
    }

    let allow = permissions_obj
        .entry("allow")
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    let Some(allow_array) = allow.as_array_mut() else {
        return Err(format!(
            "{}'s \"permissions.allow\" key is not a JSON array -- fix or remove the file \
             before installing",
            settings_path.display()
        )
        .into());
    };
    let mut any_added = false;
    for grant in grants {
        let already_present = allow_array
            .iter()
            .any(|entry| entry.as_str() == Some(grant.as_str()));
        if !already_present {
            allow_array.push(serde_json::Value::String(grant.clone()));
            any_added = true;
        }
    }

    if !any_added {
        // Every grant this pass wants is already present -- nothing to
        // write. Skip the write entirely rather than re-serializing:
        // `serde_json::to_vec_pretty` would otherwise reformat the
        // user's file to serde's own 2-space output and bump its mtime
        // on a reinstall that changed nothing, turning a tracked
        // `.claude/settings.json` into a spurious diff every time.
        // `original_text` is always `Some(..)` here -- reaching this
        // branch requires the `allow` array to already contain every
        // grant, which is only possible when the file pre-existed
        // (a freshly-created empty array can't already contain
        // anything). Return those exact bytes so the caller's content
        // hash reflects what is actually on disk, not a rewrite of it.
        let unchanged = original_text
            .expect(
                "any_added is false only when settings_path pre-existed with every grant \
                 already present",
            )
            .into_bytes();
        return Ok(unchanged);
    }

    write_settings_file(&settings_path, &claude_dir, &root, original_mode)
}

/// Applies the `permissions.allow` grant and returns `settings.json`'s
/// manifest path and content hash. Called once per install run by
/// `apply_claude_settings_grant_and_hooks`, whose callers decide whether
/// the grant applies; provenance comes from the write-ahead plan
/// (`plan_claude_settings_grant`) via `attach_provenance`.
pub(super) fn apply_claude_settings_grant(
    target_dir: &Path,
) -> Result<(String, String), ClaudeGrantError> {
    let bytes = merge_claude_settings_permissions(target_dir, &claude_mcp_permission_grants())?;
    Ok((
        CLAUDE_SETTINGS_RELATIVE_PATH.to_string(),
        super::super::artifact::sha256_hex(&bytes),
    ))
}

// ── V3/Claude Code telemetry hook wiring ──
//
// Wires `<exe> __telemetry-hook <event> --install-root <target>` into the
// `hooks` key of the file `claude_hooks_settings_relative_path` picks:
// `.claude/settings.local.json` for a project (kept out of git), or
// `~/.claude/settings.json` for a `$HOME` install. `SessionStart` reports
// an agent invocation; `SubagentStart`, matched to the installed agent
// names, reports a delegation.
//
// Two install paths wire them, both skipped under `--no-telemetry`:
// - Kiro V2/V3 on a target with a `.claude` marker, when the grant
//   applies: `apply_claude_settings_grant_and_hooks`, only after the
//   grant succeeds, so no hooks are wired next to a foreign,
//   deny-shadowed or malformed `settings.json`.
// - `ClaudeInstallStrategy`: `apply_claude_settings_hooks_only`, with no
//   grant (see the permission grant section above).
//
// Both first strip hooks this run must not keep (`strip_hooks_not_owned_this_run`):
// every hook under `--no-telemetry`, or an earlier release's hooks in the
// shared `settings.json`. Uninstall strips them via
// `remove_claude_telemetry_hooks` once no remaining strategy tracks the
// hooks file. Kiro's own hooks live in `telemetry_hook_pass.rs`.

/// A Konductor telemetry hook to keep in the hooks settings file.
/// `event_type_arg` comes from `telemetry_hook.rs`'s constants, so a
/// rename there is a compile error here. The command is built at merge
/// time because it embeds the resolved exe path and install root. A hook
/// is identified by its event argument, so a reinstall replaces a stale
/// block (moved binary, changed agent set) instead of adding another.
struct TelemetryHookEntry {
    event: &'static str,
    matcher: HookMatcher,
    event_type_arg: &'static str,
}

enum HookMatcher {
    Fixed(&'static str),
    /// Matches only the agent types Konductor installed at the target, so
    /// Claude never spawns the hook for a foreign sub-agent.
    InstalledAgents,
}

const TELEMETRY_HOOK_ENTRIES: &[TelemetryHookEntry] = &[
    TelemetryHookEntry {
        event: "SessionStart",
        // A genuine session start or a `/clear` both count as a fresh
        // `agent_invocation`.
        matcher: HookMatcher::Fixed("startup|clear"),
        event_type_arg: crate::cli::telemetry_hook::AGENT_INVOCATION,
    },
    TelemetryHookEntry {
        event: "SubagentStart",
        matcher: HookMatcher::InstalledAgents,
        event_type_arg: crate::cli::telemetry_hook::SUBAGENT_INVOCATION,
    },
];

/// `^(a|b)$` over `agent_names`, sorted and deduplicated; `None` when there
/// are no names. Claude evaluates a matcher containing `^` as an
/// unanchored JavaScript regex, hence the anchors and escaping.
fn installed_agents_matcher(agent_names: &[String]) -> Option<String> {
    let mut names: Vec<&str> = agent_names.iter().map(String::as_str).collect();
    names.sort_unstable();
    names.dedup();
    if names.is_empty() {
        return None;
    }
    let escaped: Vec<String> = names
        .iter()
        .map(|name| {
            name.chars()
                .flat_map(|c| {
                    let special = "\\^$.|?*+()[]{}/".contains(c);
                    special
                        .then_some('\\')
                        .into_iter()
                        .chain(std::iter::once(c))
                })
                .collect()
        })
        .collect();
    Some(format!("^({})$", escaped.join("|")))
}

/// The absolute path of the running `konductor` binary, so a hook
/// command invokes this install's binary without depending on `$PATH`
/// when it fires. Shared with the Kiro hooks in `telemetry_hook_pass.rs`.
/// Falls back to bare `"konductor"` if `current_exe()` fails, rather
/// than failing the install.
pub(super) fn resolve_konductor_exe_path() -> String {
    std::env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "konductor".to_string())
}

/// Whether `exe` is an absolute path rather than
/// `resolve_konductor_exe_path`'s bare `"konductor"` fallback. A run whose
/// `current_exe()` failed must not replace an already-wired absolute path
/// with the `$PATH`-dependent fallback.
pub(super) fn is_resolved_absolute_exe_path(exe: &str) -> bool {
    Path::new(exe).is_absolute()
}

/// Shell-quotes `exe` (or any other value) for embedding in a hook
/// `command` string, which Claude Code and Kiro run through a shell. An
/// absolute path can contain a space or other metacharacter (e.g.
/// `Application Support` on macOS), which would break the hook unquoted.
/// `McpServerPass`'s structured `{"command", "args"}` shape needs no
/// quoting; a single command string does.
///
/// Only quotes when `exe` actually needs it -- a bare word made
/// entirely of characters that are always safe unquoted on the
/// current platform (alphanumerics plus the handful of punctuation
/// marks an ordinary path/binary name uses) is returned unchanged.
/// Backslash is in that safe set on Windows only, where it is a
/// legitimate path separator: on POSIX shells an unquoted backslash
/// is an escape metacharacter, not a literal, so a POSIX exe path
/// containing one (legal in a POSIX filename) must take the
/// single-quote-wrapping branch below instead.
///
/// POSIX (`sh`/`bash`, every platform except Windows): wraps in single
/// quotes, which suppress all shell expansion; an embedded single
/// quote is escaped via the standard `'\''` idiom (close the quote,
/// emit a literal escaped quote, reopen).
///
/// Windows (`cmd.exe`): wraps in double quotes, which keep the path as
/// one token despite embedded spaces; an embedded double quote (never
/// legal in an actual Windows file path, but handled defensively) is
/// escaped by doubling it.
pub(super) fn shell_quote_for_hook_command(exe: &str) -> String {
    let is_safe_unquoted = exe.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || matches!(c, '/' | '.' | '-' | '_' | ':')
            || (cfg!(windows) && c == '\\')
    });
    if is_safe_unquoted {
        return exe.to_string();
    }

    #[cfg(windows)]
    {
        let mut out = String::with_capacity(exe.len() + 2);
        out.push('"');
        for ch in exe.chars() {
            if ch == '"' {
                out.push_str("\"\"");
            } else {
                out.push(ch);
            }
        }
        out.push('"');
        out
    }

    #[cfg(not(windows))]
    {
        let mut out = String::with_capacity(exe.len() + 2);
        out.push('\'');
        for ch in exe.chars() {
            if ch == '\'' {
                out.push_str("'\\''");
            } else {
                out.push(ch);
            }
        }
        out.push('\'');
        out
    }
}

/// The `__telemetry-hook ...` part of a hook command, without the leading
/// exe path, so commands that differ only in where the binary lives (or
/// in the bare-`"konductor"` fallback) are recognized as the same hook.
/// `None` when `command` is not a telemetry hook.
pub(super) fn stable_hook_command_suffix(command: &str) -> Option<&str> {
    const MARKER: &str = "__telemetry-hook ";
    let idx = command.find(MARKER)?;
    Some(&command[idx..])
}

/// The event argument of a telemetry hook command, so two commands that
/// differ only in exe path or trailing arguments identify the same hook.
pub(super) fn telemetry_hook_event(command: &str) -> Option<&str> {
    stable_hook_command_suffix(command)?
        .strip_prefix("__telemetry-hook ")?
        .split_whitespace()
        .next()
}

/// `<exe> __telemetry-hook <event> [--agent <name>] [--install-root <dir>]`.
/// `quoted_exe` is already shell-quoted; the other values are quoted here.
pub(super) fn telemetry_hook_command(
    quoted_exe: &str,
    event_type: &str,
    agent: Option<&str>,
    install_root: Option<&Path>,
) -> String {
    let mut command = format!("{quoted_exe} __telemetry-hook {event_type}");
    if let Some(agent) = agent {
        command.push_str(" --agent ");
        command.push_str(&shell_quote_for_hook_command(agent));
    }
    if let Some(root) = install_root {
        let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        command.push_str(" --install-root ");
        command.push_str(&shell_quote_for_hook_command(&root.display().to_string()));
    }
    command
}

/// Removes every Konductor telemetry hook for `event_type_arg` from one
/// event's block array, dropping blocks left empty. Returns how many hooks
/// it removed.
fn strip_telemetry_hooks(event_array: &mut Vec<serde_json::Value>, event_type_arg: &str) -> usize {
    let mut removed = 0;
    for block in event_array.iter_mut() {
        let Some(inner) = block.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
            continue;
        };
        let before = inner.len();
        inner.retain(|hook| {
            hook.get("command")
                .and_then(|c| c.as_str())
                .and_then(telemetry_hook_event)
                != Some(event_type_arg)
        });
        removed += before - inner.len();
    }
    if removed > 0 {
        event_array.retain(|block| {
            block
                .get("hooks")
                .and_then(|h| h.as_array())
                .is_none_or(|inner| !inner.is_empty())
        });
    }
    removed
}

/// Whether `event_array` holds exactly one Konductor hook for
/// `event_type_arg`, and it already has `matcher` and `command`.
fn telemetry_hook_is_current(
    event_array: &[serde_json::Value],
    event_type_arg: &str,
    matcher: &str,
    command: &str,
) -> bool {
    let mut ours = event_array.iter().flat_map(|block| {
        block
            .get("hooks")
            .and_then(|h| h.as_array())
            .into_iter()
            .flatten()
            .filter_map(|hook| hook.get("command").and_then(|c| c.as_str()))
            .filter(|existing| telemetry_hook_event(existing) == Some(event_type_arg))
            .map(move |existing| (block.get("matcher").and_then(|m| m.as_str()), existing))
    });
    matches!(
        (ours.next(), ours.next()),
        (Some((Some(existing_matcher), existing_command)), None)
            if existing_matcher == matcher && existing_command == command
    )
}

/// Ensures the settings file at `<target_dir>/<relative>` carries exactly
/// one hook block per entry in `entries`, creating the file when missing.
/// A stale Konductor block (different matcher, exe path or install root)
/// is replaced, never duplicated. Symlink safety, mode preservation, the
/// shared advisory lock, and skip-write-when-unchanged mirror
/// `merge_claude_settings_permissions`.
///
/// `agent_names` builds the `SubagentStart` matcher. With no names that
/// hook is removed rather than wired to match everything.
///
/// A bare-word `exe` (the `current_exe()` fallback) never replaces an
/// existing hook, so a transient resolution failure cannot downgrade an
/// absolute path to a `$PATH` lookup.
fn merge_claude_settings_hooks_with_exe(
    target_dir: &Path,
    relative: &str,
    entries: &[TelemetryHookEntry],
    exe: &str,
    agent_names: &[String],
) -> Result<Vec<u8>, ClaudeGrantError> {
    let (settings_path, claude_dir) = settings_paths(target_dir, relative)?;

    let _lock_guard = crate::cli::config_lock::acquire_named(&claude_dir, ".settings.lock")
        .map_err(|source| format!("failed to lock {}: {source}", claude_dir.display()))?;

    let state = read_settings_file(&settings_path, &claude_dir)?;
    let SettingsFileState {
        mut root,
        original_text,
        original_mode,
    } = state;

    let Some(root_obj) = root.as_object_mut() else {
        return Err(format!(
            "{} does not contain a JSON object at its top level -- fix or remove the file \
             before installing",
            settings_path.display()
        )
        .into());
    };
    let hooks = root_obj
        .entry("hooks")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let Some(hooks_obj) = hooks.as_object_mut() else {
        return Err(format!(
            "{}'s \"hooks\" key is not a JSON object -- fix or remove the file before installing",
            settings_path.display()
        )
        .into());
    };

    let exe_is_absolute = is_resolved_absolute_exe_path(exe);
    let quoted_exe = shell_quote_for_hook_command(exe);

    let mut any_changed = false;
    for entry in entries {
        let matcher = match entry.matcher {
            HookMatcher::Fixed(matcher) => Some(matcher.to_string()),
            HookMatcher::InstalledAgents => installed_agents_matcher(agent_names),
        };
        let command =
            telemetry_hook_command(&quoted_exe, entry.event_type_arg, None, Some(target_dir));
        let event_array = hooks_obj
            .entry(entry.event)
            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
        let Some(event_array) = event_array.as_array_mut() else {
            return Err(format!(
                "{}'s \"hooks.{}\" key is not a JSON array -- fix or remove the file before \
                 installing",
                settings_path.display(),
                entry.event
            )
            .into());
        };

        match &matcher {
            Some(matcher)
                if telemetry_hook_is_current(
                    event_array,
                    entry.event_type_arg,
                    matcher,
                    &command,
                ) => {}
            Some(matcher) => {
                let removed = if exe_is_absolute {
                    strip_telemetry_hooks(event_array, entry.event_type_arg)
                } else {
                    0
                };
                let has_existing = event_array
                    .iter()
                    .filter_map(|block| block.get("hooks").and_then(|h| h.as_array()))
                    .flatten()
                    .filter_map(|hook| hook.get("command").and_then(|c| c.as_str()))
                    .any(|existing| telemetry_hook_event(existing) == Some(entry.event_type_arg));
                if !has_existing {
                    event_array.push(serde_json::json!({
                        "matcher": matcher,
                        "hooks": [{"type": "command", "command": command}]
                    }));
                    any_changed = true;
                }
                any_changed |= removed > 0;
            }
            None => {
                any_changed |= strip_telemetry_hooks(event_array, entry.event_type_arg) > 0;
            }
        }
        if event_array.is_empty() {
            hooks_obj.remove(entry.event);
        }
    }
    if hooks_obj.is_empty() {
        root_obj.remove("hooks");
    }

    if !any_changed {
        if let Some(text) = original_text {
            return Ok(text.into_bytes());
        }
    }

    write_settings_file(&settings_path, &claude_dir, &root, original_mode)
}

/// Wires the telemetry hooks into `target_dir`'s hooks settings file
/// (`claude_hooks_settings_relative_path`) and returns that file's
/// manifest path and content hash.
fn apply_claude_settings_hooks(target_dir: &Path) -> Result<(String, String), ClaudeGrantError> {
    let relative = claude_hooks_settings_relative_path(target_dir);
    let agent_names = crate::cli::telemetry_hook::installed_agent_names(target_dir);
    let bytes = merge_claude_settings_hooks_with_exe(
        target_dir,
        relative,
        TELEMETRY_HOOK_ENTRIES,
        &resolve_konductor_exe_path(),
        &agent_names,
    )?;
    if relative == CLAUDE_LOCAL_SETTINGS_RELATIVE_PATH {
        exclude_from_git(target_dir, relative);
    }
    Ok((
        relative.to_string(),
        super::super::artifact::sha256_hex(&bytes),
    ))
}

/// Adds `relative` to the repository's `.git/info/exclude` when
/// `target_dir` is inside a git work tree that does not already ignore
/// it. Claude Code does this itself only for a `settings.local.json` it
/// writes. Best-effort: no git, no repository, or any failure is a no-op.
fn exclude_from_git(target_dir: &Path, relative: &str) {
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .arg("-C")
            .arg(target_dir)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()
    };
    let stdout_line = |args: &[&str]| {
        git(args)
            .filter(|out| out.status.success())
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .map(|text| text.trim_end_matches(['\n', '\r']).to_string())
    };

    // Exit 1: inside a work tree and not ignored. 0 is ignored, 128 is
    // not a repository.
    if git(&["check-ignore", "-q", "--", relative]).and_then(|out| out.status.code()) != Some(1) {
        return;
    }
    let Some(prefix) = stdout_line(&["rev-parse", "--show-prefix"]) else {
        return;
    };
    let Some(exclude) = stdout_line(&["rev-parse", "--git-path", "info/exclude"]) else {
        return;
    };
    let exclude = target_dir.join(exclude);

    let existing = std::fs::read_to_string(&exclude).unwrap_or_default();
    let mut addition = String::new();
    if !existing.is_empty() && !existing.ends_with('\n') {
        addition.push('\n');
    }
    addition.push_str(&format!("/{prefix}{relative}\n"));
    let written = exclude
        .parent()
        .is_some_and(|dir| std::fs::create_dir_all(dir).is_ok())
        && std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&exclude)
            .and_then(|mut file| std::io::Write::write_all(&mut file, addition.as_bytes()))
            .is_ok();
    if written {
        eprintln!(
            "konductor install: added {prefix}{relative} to {} so its machine-specific hooks \
             are not committed",
            exclude.display()
        );
    }
}

/// Strips the Konductor telemetry hooks from `<target_dir>/<relative>`,
/// leaving every other hook, event and key untouched, and removing any
/// `hooks` scaffolding left empty. Matches on the command's event
/// argument, so hooks wired by a moved binary or with an old matcher are
/// still found. Never deletes the file. Returns whether anything was
/// removed; a missing file is `Ok(false)`.
fn remove_claude_settings_hooks(
    target_dir: &Path,
    relative: &str,
    entries: &[TelemetryHookEntry],
) -> Result<bool, ClaudeGrantError> {
    let (settings_path, claude_dir) = settings_paths(target_dir, relative)?;
    if !settings_path.is_file() {
        return Ok(false);
    }

    let _lock_guard = crate::cli::config_lock::acquire_named(&claude_dir, ".settings.lock")
        .map_err(|source| format!("failed to lock {}: {source}", claude_dir.display()))?;

    let original_mode = std::fs::metadata(&settings_path)
        .map_err(|e| format!("failed to stat {}: {e}", settings_path.display()))?
        .permissions()
        .mode();
    let original_text = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("failed to read {}: {e}", settings_path.display()))?;
    let mut root: serde_json::Value = serde_json::from_str(&original_text).map_err(|e| {
        format!(
            "failed to parse {} as JSON: {e} -- fix or remove the file",
            settings_path.display()
        )
    })?;
    let Some(root_obj) = root.as_object_mut() else {
        return Err(format!(
            "{} does not contain a JSON object at its top level -- fix or remove the file",
            settings_path.display()
        )
        .into());
    };
    let Some(hooks_val) = root_obj.get_mut("hooks") else {
        return Ok(false);
    };
    let Some(hooks_obj) = hooks_val.as_object_mut() else {
        return Err(format!(
            "{}'s \"hooks\" key is not a JSON object -- fix or remove the file",
            settings_path.display()
        )
        .into());
    };

    let removed = strip_entries_from_hooks(hooks_obj, entries, &settings_path)?;
    if removed == 0 {
        return Ok(false);
    }
    if hooks_obj.is_empty() {
        root_obj.remove("hooks");
    }

    write_settings_file(&settings_path, &claude_dir, &root, Some(original_mode))?;
    Ok(true)
}

/// Removes every Konductor telemetry hook listed in `entries` from
/// `hooks_obj` (a settings file's parsed `"hooks"` object), dropping an
/// event's array once it has no blocks left. Returns how many hooks were
/// removed in total, across every event. Errors if an event's value is
/// present but not a JSON array.
fn strip_entries_from_hooks(
    hooks_obj: &mut serde_json::Map<String, serde_json::Value>,
    entries: &[TelemetryHookEntry],
    settings_path: &Path,
) -> Result<usize, ClaudeGrantError> {
    let mut removed = 0;
    for entry in entries {
        let Some(event_val) = hooks_obj.get_mut(entry.event) else {
            continue;
        };
        let Some(event_array) = event_val.as_array_mut() else {
            return Err(format!(
                "{}'s \"hooks.{}\" key is not a JSON array -- fix or remove the file",
                settings_path.display(),
                entry.event
            )
            .into());
        };
        removed += strip_telemetry_hooks(event_array, entry.event_type_arg);
        if event_array.is_empty() {
            hooks_obj.remove(entry.event);
        }
    }
    Ok(removed)
}

/// Strips the Konductor telemetry hooks from both Claude settings files at
/// `target_dir`, for `--no-telemetry` and `uninstall`. Returns the files it
/// changed; every file is attempted even when an earlier one fails.
pub(crate) fn remove_claude_telemetry_hooks(target_dir: &Path) -> (Vec<String>, Vec<String>) {
    let mut changed = Vec::new();
    let mut errors = Vec::new();
    for relative in [
        CLAUDE_SETTINGS_RELATIVE_PATH,
        CLAUDE_LOCAL_SETTINGS_RELATIVE_PATH,
    ] {
        match remove_claude_settings_hooks(target_dir, relative, TELEMETRY_HOOK_ENTRIES) {
            Ok(true) => changed.push(target_dir.join(relative).display().to_string()),
            Ok(false) => {}
            Err(err) => errors.push(err.to_string()),
        }
    }
    (changed, errors)
}

/// Removes hooks that must not stay after this run: from both settings
/// files under `--no-telemetry`, otherwise only an earlier release's hooks
/// in the shared `settings.json` when this target's hooks now live in
/// `settings.local.json`. Runs before any other write to `settings.json`
/// so the hash recorded for the grant is the final one. Non-fatal.
fn strip_hooks_not_owned_this_run(target_dir: &Path, no_telemetry: bool) {
    if no_telemetry {
        let (changed, errors) = remove_claude_telemetry_hooks(target_dir);
        for path in changed {
            eprintln!(
                "konductor install: removed a previously-installed telemetry hook from {path} \
                 (--no-telemetry)"
            );
        }
        for err in errors {
            eprintln!(
                "warning: could not remove a previously-installed telemetry hook from this \
                 Claude Code install: {err}"
            );
        }
        return;
    }
    if claude_hooks_settings_relative_path(target_dir) == CLAUDE_SETTINGS_RELATIVE_PATH {
        return;
    }
    if let Err(err) = remove_claude_settings_hooks(
        target_dir,
        CLAUDE_SETTINGS_RELATIVE_PATH,
        TELEMETRY_HOOK_ENTRIES,
    ) {
        eprintln!(
            "warning: could not move the telemetry hooks out of this target's shared \
             {CLAUDE_SETTINGS_RELATIVE_PATH}: {err}"
        );
    }
}

/// Wires only the telemetry hooks (no `permissions.allow` grant), for
/// `ClaudeInstallStrategy`: that path never registers `konductor-skills`
/// for Claude Code, so the grant would be inert there. Under
/// `no_telemetry` it strips hooks a prior install wired instead and
/// returns `None`, since this run owns no hook file. Non-fatal: a
/// symlinked or malformed settings file must not abort an otherwise
/// successful install.
pub(in crate::cli::install) fn apply_claude_settings_hooks_only(
    target_dir: &Path,
    no_telemetry: bool,
) -> Option<ManifestFile> {
    strip_hooks_not_owned_this_run(target_dir, no_telemetry);
    if no_telemetry {
        return None;
    }
    match apply_claude_settings_hooks(target_dir) {
        Ok((path, sha256)) => Some(ManifestFile {
            path,
            sha256: Some(sha256),
            provenance: Provenance::Created,
        }),
        Err(message) => {
            eprintln!(
                "warning: telemetry hooks were not wired for this Claude Code install: \
                 {message}"
            );
            None
        }
    }
}

/// Performs the `.claude`-marker-gated `permissions.allow` grant
/// (`apply_claude_settings_grant`) plus, unless `no_telemetry`, the
/// telemetry-hook wiring, for a whole install run. Returns one
/// `ManifestFile` per settings file written: `settings.json` for the
/// grant, and the hooks file when it differs (a project install). Empty
/// when the grant is skipped.
///
/// Shared by `AgentInstallPhase::run` (`phases.rs`) and
/// `KiroCliV3InstallStrategy::install_from_local` (`kiro_cli_v3.rs`), which
/// both gate the call on `any_mcp_server_injected &&
/// detect_runtimes(target_dir).has(Runtime::ClaudeCode)`.
///
/// Hooks are wired only after the grant succeeds, so a foreign,
/// deny-shadowed or malformed `settings.json` skips both. Every failure is
/// a warning: aborting an already-succeeded Kiro install over pre-existing
/// Claude-side content would be worse. `strategy_label` only affects the
/// warning text.
pub(in crate::cli::install) fn apply_claude_settings_grant_and_hooks(
    target_dir: &Path,
    no_telemetry: bool,
    strategy_label: &str,
) -> Vec<ManifestFile> {
    strip_hooks_not_owned_this_run(target_dir, no_telemetry);

    let mut written: Vec<(String, String)> = Vec::new();
    match apply_claude_settings_grant(target_dir) {
        Ok(grant) => {
            written.push(grant);
            if !no_telemetry {
                match apply_claude_settings_hooks(target_dir) {
                    Ok((hooks_path, hooks_sha256)) => {
                        // A `$HOME` install shares one file, so the hooks
                        // write supersedes the grant's hash.
                        written.retain(|(path, _)| *path != hooks_path);
                        written.push((hooks_path, hooks_sha256));
                    }
                    Err(message) => {
                        eprintln!(
                            "warning: Claude Code telemetry hook wiring skipped \
                             ({message}) -- the {strategy_label} portion of this install is \
                             unaffected"
                        );
                    }
                }
            }
        }
        Err(ClaudeGrantError::DenyShadowed(message)) => {
            eprintln!(
                "warning: Claude Code permission grant intentionally skipped -- \
                 an existing \"permissions.deny\" rule already blocks it \
                 ({message}). This is respected, not an error to fix; the \
                 {strategy_label} portion of this install is unaffected."
            );
        }
        Err(ClaudeGrantError::Other(message)) => {
            eprintln!(
                "warning: Claude Code permission grant skipped ({message}) -- \
                 the {strategy_label} portion of this install is unaffected"
            );
        }
    }

    written
        .into_iter()
        .map(|(path, sha256)| ManifestFile {
            path,
            sha256: Some(sha256),
            provenance: Provenance::Created,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-resource-rewrite-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ── Claude/V3 settings.json grant ────────────────────────────────
    // Exercises `merge_claude_settings_permissions` and
    // `apply_claude_settings_grant` directly against a plain `target_dir`.

    #[test]
    fn claude_mcp_permission_grants_derives_from_v2_allowed_tools_grants() {
        assert_eq!(
            claude_mcp_permission_grants(),
            vec![
                "mcp__konductor-skills__find_skills".to_string(),
                "mcp__konductor-skills__get_skill".to_string(),
                "mcp__konductor-skills__reload_skills".to_string(),
            ]
        );
    }

    #[test]
    fn claude_settings_grant_creates_fresh_file() {
        let dir = scratch_dir("claude-grant-fresh");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let (path, sha256) =
            apply_claude_settings_grant(&dir).expect("grant must succeed on a fresh target");
        assert_eq!(path, ".claude/settings.json");
        assert_eq!(sha256.len(), 64, "sha256 hex digest must be 64 chars");

        let written = fs::read_to_string(dir.join(".claude/settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(
            parsed["permissions"]["allow"],
            serde_json::json!([
                "mcp__konductor-skills__find_skills",
                "mcp__konductor-skills__get_skill",
                "mcp__konductor-skills__reload_skills"
            ])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_creates_claude_dir_when_missing() {
        // This function creates `.claude` itself when asked; whether
        // install ever calls it without one is the caller's concern.
        let dir = scratch_dir("claude-grant-creates-dir");
        assert!(!dir.join(".claude").exists());
        apply_claude_settings_grant(&dir).expect("grant must create .claude if missing");
        assert!(dir.join(".claude").is_dir());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_merges_preserving_unrelated_entries() {
        let dir = scratch_dir("claude-grant-merge");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        // Pre-existing settings.json with an unrelated top-level key (a
        // real repo-local settings.json this design was grounded in
        // carries exactly a "hooks" key, no "permissions" at all) and a
        // pre-existing permissions.allow entry from an unrelated server
        // (a real ~/.claude/settings.json this design was grounded in
        // carries exactly this shape).
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "hooks": {"PreToolUse": []},
                "permissions": {"allow": ["mcp__example-mcp__ExampleAction"]}
            }))
            .unwrap(),
        )
        .unwrap();

        apply_claude_settings_grant(&dir).expect("grant must merge into existing settings.json");

        let written = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(
            parsed["hooks"],
            serde_json::json!({"PreToolUse": []}),
            "an unrelated top-level key must survive the merge untouched"
        );
        assert_eq!(
            parsed["permissions"]["allow"],
            serde_json::json!([
                "mcp__example-mcp__ExampleAction",
                "mcp__konductor-skills__find_skills",
                "mcp__konductor-skills__get_skill",
                "mcp__konductor-skills__reload_skills"
            ]),
            "the pre-existing allow entry must survive; new grants must be appended"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_is_idempotent_across_reinstall() {
        let dir = scratch_dir("claude-grant-idempotent");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        apply_claude_settings_grant(&dir).expect("first grant must succeed");
        apply_claude_settings_grant(&dir).expect("second grant (reinstall) must succeed");
        let written = fs::read_to_string(dir.join(".claude/settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(
            parsed["permissions"]["allow"],
            serde_json::json!([
                "mcp__konductor-skills__find_skills",
                "mcp__konductor-skills__get_skill",
                "mcp__konductor-skills__reload_skills"
            ]),
            "reinstall must not append duplicate grants"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn claude_settings_grant_preserves_narrow_mode_on_preexisting_file() {
        let dir = scratch_dir("claude-grant-narrow-mode");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");
        fs::write(&settings_path, serde_json::json!({}).to_string()).unwrap();
        fs::set_permissions(&settings_path, fs::Permissions::from_mode(0o600)).unwrap();

        apply_claude_settings_grant(&dir).expect("grant must succeed on a narrow-mode file");

        let mode = fs::metadata(&settings_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "a pre-existing narrower mode must survive the grant unchanged, not be widened"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_skips_rewrite_when_all_grants_already_present() {
        let dir = scratch_dir("claude-grant-noop-rewrite");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");
        // Deliberately compact, non-pretty-printed JSON with every grant
        // already present. If `merge_claude_settings_permissions` did not
        // skip the write on a true no-op, `serde_json::to_vec_pretty`
        // would reformat this to its own 2-space output and the
        // byte-for-byte comparison below would fail.
        let original = "{\"permissions\":{\"allow\":[\"mcp__konductor-skills__find_skills\",\
                         \"mcp__konductor-skills__get_skill\",\
                         \"mcp__konductor-skills__reload_skills\"]}}";
        fs::write(&settings_path, original).unwrap();

        apply_claude_settings_grant(&dir).expect("grant must succeed as a no-op");

        let written = fs::read_to_string(&settings_path).unwrap();
        assert_eq!(
            written, original,
            "when every grant is already present the file must be left byte-for-byte \
             unchanged, not reformatted to serde's pretty-printed style"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_errors_on_non_object_settings() {
        let dir = scratch_dir("claude-grant-non-object");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(claude_dir.join("settings.json"), b"[1, 2, 3]").unwrap();
        let err = apply_claude_settings_grant(&dir)
            .expect_err("a non-object settings.json must be rejected, not overwritten");
        assert!(err.contains("settings.json"));
        let still_there = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        assert_eq!(still_there, "[1, 2, 3]", "must remain untouched");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_errors_on_non_object_permissions_key() {
        let dir = scratch_dir("claude-grant-bad-permissions");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string(&serde_json::json!({"permissions": "not-an-object"})).unwrap(),
        )
        .unwrap();
        let err = apply_claude_settings_grant(&dir)
            .expect_err("a non-object \"permissions\" key must be rejected");
        assert!(err.contains("\"permissions\""));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_errors_on_non_array_allow_key() {
        let dir = scratch_dir("claude-grant-bad-allow");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string(&serde_json::json!({"permissions": {"allow": "not-an-array"}}))
                .unwrap(),
        )
        .unwrap();
        let err = apply_claude_settings_grant(&dir)
            .expect_err("a non-array \"permissions.allow\" key must be rejected");
        assert!(err.contains("\"permissions.allow\""));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_errors_on_non_array_deny_key() {
        let dir = scratch_dir("claude-grant-bad-deny");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string(&serde_json::json!({"permissions": {"deny": "not-an-array"}}))
                .unwrap(),
        )
        .unwrap();
        let err = apply_claude_settings_grant(&dir)
            .expect_err("a non-array \"permissions.deny\" key must be rejected");
        assert!(err.contains("\"permissions.deny\""));
        // This error's rendered text also contains the literal
        // substring "permissions.deny" (same as the real deny-shadow
        // error below), so asserting the variant here -- `Other`, not
        // `DenyShadowed` -- is what proves a caller can tell this
        // malformed-JSON case apart from a genuine deny-shadow without
        // relying on message text.
        assert!(matches!(err, ClaudeGrantError::Other(_)));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_errors_when_deny_exactly_matches_a_grant() {
        let dir = scratch_dir("claude-grant-deny-exact");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string(&serde_json::json!({
                "permissions": {"deny": ["mcp__konductor-skills__find_skills"]}
            }))
            .unwrap(),
        )
        .unwrap();
        let err = apply_claude_settings_grant(&dir)
            .expect_err("an exact deny match must block the grant, not silently no-op it");
        assert!(err.contains("mcp__konductor-skills__find_skills"));
        // The real deny-shadow case must be the `DenyShadowed` variant --
        // see `claude_settings_grant_errors_on_non_array_deny_key` above
        // for why a caller must be able to tell this apart from a
        // malformed-settings error by variant, not by message text.
        assert!(matches!(err, ClaudeGrantError::DenyShadowed(_)));
        // Must remain untouched -- no allow entry added, deny preserved.
        let still_there = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        assert!(!still_there.contains("\"allow\""));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_errors_when_deny_has_server_wildcard() {
        let dir = scratch_dir("claude-grant-deny-server-wildcard");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(
            dir.join(".claude/settings.json"),
            serde_json::to_string(&serde_json::json!({
                "permissions": {"deny": ["mcp__konductor-skills__*"]}
            }))
            .unwrap(),
        )
        .unwrap();
        let err = apply_claude_settings_grant(&dir)
            .expect_err("a server-wide deny wildcard must block every grant for that server");
        assert!(err.contains("mcp__konductor-skills"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_errors_when_deny_has_bare_server_name() {
        let dir = scratch_dir("claude-grant-deny-bare-server");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(
            dir.join(".claude/settings.json"),
            serde_json::to_string(&serde_json::json!({
                "permissions": {"deny": ["mcp__konductor-skills"]}
            }))
            .unwrap(),
        )
        .unwrap();
        apply_claude_settings_grant(&dir)
            .expect_err("a bare server-name deny must also block every grant for that server");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_errors_when_deny_has_global_wildcard() {
        let dir = scratch_dir("claude-grant-deny-global-wildcard");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(
            dir.join(".claude/settings.json"),
            serde_json::to_string(&serde_json::json!({"permissions": {"deny": ["mcp__*"]}}))
                .unwrap(),
        )
        .unwrap();
        apply_claude_settings_grant(&dir)
            .expect_err("the global mcp__* deny wildcard must block every MCP grant");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_grant_ignores_unrelated_deny_entries() {
        // Positive control for the deny-shadow check above: a deny
        // list that does NOT cover any of our grants must not block
        // the merge.
        let dir = scratch_dir("claude-grant-deny-unrelated");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string(&serde_json::json!({
                "permissions": {"deny": ["mcp__some-other-server__some_tool"]}
            }))
            .unwrap(),
        )
        .unwrap();
        apply_claude_settings_grant(&dir)
            .expect("an unrelated deny entry must not block this server's grants");
        let written = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(
            parsed["permissions"]["allow"],
            serde_json::json!([
                "mcp__konductor-skills__find_skills",
                "mcp__konductor-skills__get_skill",
                "mcp__konductor-skills__reload_skills"
            ])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn claude_settings_grant_rejects_symlinked_claude_directory() {
        let dir = scratch_dir("claude-grant-symlink-dir");
        let real_elsewhere = scratch_dir("claude-grant-symlink-dir-target");
        std::os::unix::fs::symlink(&real_elsewhere, dir.join(".claude"))
            .expect("failed to create test symlink");

        let err = apply_claude_settings_grant(&dir)
            .expect_err("a symlinked .claude directory must be rejected, never written through");
        assert!(err.contains("symlink"));
        assert!(
            !real_elsewhere.join("settings.json").exists(),
            "nothing must be written through the symlink into the real target directory"
        );
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&real_elsewhere).ok();
    }

    #[cfg(unix)]
    #[test]
    fn claude_settings_grant_rejects_symlinked_settings_file() {
        let dir = scratch_dir("claude-grant-symlink-file");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let real_elsewhere = scratch_dir("claude-grant-symlink-file-target");
        let real_file = real_elsewhere.join("real-settings.json");
        fs::write(
            &real_file,
            serde_json::json!({"secret": "do-not-leak"}).to_string(),
        )
        .unwrap();
        std::os::unix::fs::symlink(&real_file, claude_dir.join("settings.json"))
            .expect("failed to create test symlink");

        let err = apply_claude_settings_grant(&dir).expect_err(
            "a symlinked settings.json must be rejected, never read through or replaced",
        );
        assert!(err.contains("symlink"));
        // The real file behind the symlink must be untouched, and the
        // symlink itself must still be a symlink (not replaced).
        assert_eq!(
            fs::read_to_string(&real_file).unwrap(),
            serde_json::json!({"secret": "do-not-leak"}).to_string()
        );
        assert!(
            fs::symlink_metadata(claude_dir.join("settings.json"))
                .unwrap()
                .file_type()
                .is_symlink(),
            "the symlink itself must survive untouched, not be replaced with a real file"
        );
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&real_elsewhere).ok();
    }

    // ── Claude telemetry hook wiring ─────────────────────────────────

    const LOCAL: &str = CLAUDE_LOCAL_SETTINGS_RELATIVE_PATH;

    fn wire(dir: &Path, relative: &str, exe: &str, agents: &[&str]) {
        let agents: Vec<String> = agents.iter().map(|name| name.to_string()).collect();
        merge_claude_settings_hooks_with_exe(dir, relative, TELEMETRY_HOOK_ENTRIES, exe, &agents)
            .expect("hook wiring must succeed");
    }

    fn read_json(path: &Path) -> serde_json::Value {
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }

    fn root_arg(dir: &Path) -> String {
        format!(
            " --install-root {}",
            std::fs::canonicalize(dir).unwrap().display()
        )
    }

    fn hook_block(matcher: &str, command: &str) -> serde_json::Value {
        serde_json::json!({"matcher": matcher, "hooks": [{"type": "command", "command": command}]})
    }

    #[test]
    fn project_install_wires_hooks_into_settings_local_json() {
        let dir = scratch_dir("claude-hooks-project-local");
        fs::create_dir_all(dir.join(".claude")).unwrap();

        let (path, sha256) = apply_claude_settings_hooks(&dir).expect("hook wiring must succeed");

        assert_eq!(path, LOCAL);
        assert_eq!(sha256.len(), 64);
        assert!(!dir.join(CLAUDE_SETTINGS_RELATIVE_PATH).exists());
        let quoted_exe = shell_quote_for_hook_command(&resolve_konductor_exe_path());
        let root = root_arg(&dir);
        assert_eq!(
            read_json(&dir.join(LOCAL))["hooks"]["SessionStart"],
            serde_json::json!([hook_block(
                "startup|clear",
                &format!("{quoted_exe} __telemetry-hook agent-invocation{root}")
            )])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn home_install_keeps_hooks_in_user_settings_json() {
        let _lock = crate::cli::test_home_lock::lock_home();
        let home = scratch_dir("claude-hooks-home");
        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);

        let home_path = claude_hooks_settings_relative_path(&home);
        let project_path = claude_hooks_settings_relative_path(&home.join("project"));

        match original_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        assert_eq!(home_path, CLAUDE_SETTINGS_RELATIVE_PATH);
        assert_eq!(project_path, LOCAL);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn subagent_matcher_lists_only_installed_agents() {
        let dir = scratch_dir("claude-hooks-agent-matcher");
        wire(
            &dir,
            LOCAL,
            "/opt/konductor",
            &["k-researcher", "k-architect", "k-architect"],
        );

        let subagent = &read_json(&dir.join(LOCAL))["hooks"]["SubagentStart"];
        assert_eq!(subagent.as_array().unwrap().len(), 1);
        assert_eq!(subagent[0]["matcher"], "^(k-architect|k-researcher)$");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn installed_agents_matcher_escapes_regex_metacharacters() {
        assert_eq!(
            installed_agents_matcher(&["a.b".to_string(), "c+d".to_string()]),
            Some("^(a\\.b|c\\+d)$".to_string())
        );
        assert_eq!(installed_agents_matcher(&[]), None);
    }

    #[test]
    fn no_installed_agents_removes_the_subagent_hook() {
        let dir = scratch_dir("claude-hooks-no-agents");
        wire(&dir, LOCAL, "/opt/konductor", &["k-architect"]);
        wire(&dir, LOCAL, "/opt/konductor", &[]);

        let hooks = &read_json(&dir.join(LOCAL))["hooks"];
        assert!(hooks.get("SubagentStart").is_none(), "got: {hooks}");
        assert!(hooks["SessionStart"].is_array());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_stale_block_is_replaced_not_duplicated() {
        // An old match-all matcher, a moved binary, and a pre-install-root
        // command are all stale forms of the same hook.
        let dir = scratch_dir("claude-hooks-stale-replaced");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(
            dir.join(LOCAL),
            serde_json::json!({"hooks": {
                "SessionStart": [hook_block("startup|clear", "/old/konductor __telemetry-hook agent-invocation")],
                "SubagentStart": [hook_block(".*", "/old/konductor __telemetry-hook subagent-invocation")]
            }})
            .to_string(),
        )
        .unwrap();

        wire(&dir, LOCAL, "/opt/konductor", &["k-architect"]);

        let root = root_arg(&dir);
        let hooks = &read_json(&dir.join(LOCAL))["hooks"];
        assert_eq!(
            hooks["SessionStart"],
            serde_json::json!([hook_block(
                "startup|clear",
                &format!("/opt/konductor __telemetry-hook agent-invocation{root}")
            )])
        );
        assert_eq!(
            hooks["SubagentStart"],
            serde_json::json!([hook_block(
                "^(k-architect)$",
                &format!("/opt/konductor __telemetry-hook subagent-invocation{root}")
            )])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn duplicate_konductor_hooks_collapse_to_one() {
        let dir = scratch_dir("claude-hooks-duplicates");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let current = format!(
            "/opt/konductor __telemetry-hook agent-invocation{}",
            root_arg(&dir)
        );
        fs::write(
            dir.join(LOCAL),
            serde_json::json!({"hooks": {"SessionStart": [
                hook_block("startup|clear", &current),
                hook_block("startup|clear", &current)
            ]}})
            .to_string(),
        )
        .unwrap();

        wire(&dir, LOCAL, "/opt/konductor", &[]);

        let session_start = read_json(&dir.join(LOCAL))["hooks"]["SessionStart"].clone();
        assert_eq!(
            session_start.as_array().unwrap().len(),
            1,
            "got: {session_start}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_skip_rewrite_when_current() {
        let dir = scratch_dir("claude-hooks-noop-rewrite");
        wire(&dir, LOCAL, "/opt/konductor", &["k-architect"]);
        let original = fs::read_to_string(dir.join(LOCAL)).unwrap();
        let compact = serde_json::to_string(&read_json(&dir.join(LOCAL))).unwrap();
        fs::write(dir.join(LOCAL), &compact).unwrap();

        wire(&dir, LOCAL, "/opt/konductor", &["k-architect"]);

        assert_ne!(original, compact);
        assert_eq!(
            fs::read_to_string(dir.join(LOCAL)).unwrap(),
            compact,
            "an up-to-date file must be left byte-for-byte unchanged"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_never_downgrade_an_absolute_path_to_the_bare_fallback() {
        let dir = scratch_dir("claude-hooks-never-downgrade");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let good = "/opt/konductor/bin/konductor __telemetry-hook agent-invocation";
        fs::write(
            dir.join(LOCAL),
            serde_json::json!({"hooks": {"SessionStart": [hook_block("startup|clear", good)]}})
                .to_string(),
        )
        .unwrap();

        wire(&dir, LOCAL, "konductor", &[]);

        assert_eq!(
            read_json(&dir.join(LOCAL))["hooks"]["SessionStart"],
            serde_json::json!([hook_block("startup|clear", good)])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn claude_settings_hooks_preserve_narrow_mode_on_preexisting_file() {
        let dir = scratch_dir("claude-hooks-narrow-mode");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(dir.join(LOCAL), "{}").unwrap();
        fs::set_permissions(dir.join(LOCAL), fs::Permissions::from_mode(0o600)).unwrap();

        wire(&dir, LOCAL, "/opt/konductor", &[]);

        let mode = fs::metadata(dir.join(LOCAL)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_preserve_unrelated_entries() {
        let dir = scratch_dir("claude-hooks-merge");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let foreign_stop = serde_json::json!([hook_block("*", "example-tool publish-metrics")]);
        fs::write(
            dir.join(LOCAL),
            serde_json::json!({
                "hooks": {"SubagentStop": foreign_stop},
                "permissions": {"allow": ["mcp__example-mcp__ExampleAction"]}
            })
            .to_string(),
        )
        .unwrap();

        wire(&dir, LOCAL, "/opt/konductor", &["k-architect"]);

        let parsed = read_json(&dir.join(LOCAL));
        assert_eq!(parsed["hooks"]["SubagentStop"], foreign_stop);
        assert_eq!(
            parsed["permissions"]["allow"],
            serde_json::json!(["mcp__example-mcp__ExampleAction"])
        );
        assert!(parsed["hooks"]["SessionStart"].is_array());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_quote_an_exe_path_containing_a_space() {
        let dir = scratch_dir("claude-hooks-space-in-exe-path");
        let space_exe = "/Users/dev/Application Support/konductor";
        wire(&dir, LOCAL, space_exe, &[]);
        wire(&dir, LOCAL, space_exe, &[]);

        let session_start = read_json(&dir.join(LOCAL))["hooks"]["SessionStart"].clone();
        assert_eq!(session_start.as_array().unwrap().len(), 1);
        assert_eq!(
            session_start[0]["hooks"][0]["command"],
            format!(
                "{} __telemetry-hook agent-invocation{}",
                shell_quote_for_hook_command(space_exe),
                root_arg(&dir)
            )
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn telemetry_hook_event_ignores_exe_path_and_trailing_arguments() {
        assert_eq!(
            telemetry_hook_event(
                "'/a b/konductor' __telemetry-hook agent-invocation --install-root /p"
            ),
            Some("agent-invocation")
        );
        assert_eq!(
            telemetry_hook_event("konductor __telemetry-hook subagent-invocation"),
            Some("subagent-invocation")
        );
        assert_eq!(telemetry_hook_event("some-other-hook --flag"), None);
    }

    // ── is_resolved_absolute_exe_path ──

    #[test]
    fn is_resolved_absolute_exe_path_true_for_a_genuine_absolute_path() {
        assert!(is_resolved_absolute_exe_path("/usr/local/bin/konductor"));
    }

    #[test]
    fn is_resolved_absolute_exe_path_false_for_the_bare_fallback_word() {
        // `resolve_konductor_exe_path`'s own fallback when
        // `current_exe()` fails -- must never be treated as a
        // genuinely resolved path.
        assert!(!is_resolved_absolute_exe_path("konductor"));
    }

    // ── shell_quote_for_hook_command ──

    #[test]
    fn shell_quote_for_hook_command_leaves_a_safe_path_unquoted() {
        // The hook-test fixture paths (e.g. "/opt/konductor/bin/konductor")
        // use only this safe set, so their exact-match assertions hold.
        assert_eq!(
            shell_quote_for_hook_command("/opt/konductor/bin/konductor"),
            "/opt/konductor/bin/konductor"
        );
        assert_eq!(shell_quote_for_hook_command("konductor"), "konductor");
    }

    #[test]
    fn shell_quote_for_hook_command_quotes_a_path_containing_a_space() {
        // A realistic scenario this quoting guards against: an install
        // under a space-containing directory (e.g. macOS's
        // "Application Support" or Windows' "Program Files").
        let quoted = shell_quote_for_hook_command("/Users/dev/Application Support/konductor");
        #[cfg(not(windows))]
        assert_eq!(quoted, "'/Users/dev/Application Support/konductor'");
        #[cfg(windows)]
        assert_eq!(quoted, "\"/Users/dev/Application Support/konductor\"");
    }

    #[test]
    #[cfg(not(windows))]
    fn shell_quote_for_hook_command_escapes_an_embedded_single_quote_on_posix() {
        // A path containing a literal single quote (legal on most
        // POSIX filesystems, however unusual) must not let the shell
        // see it as closing the surrounding quote early.
        let quoted = shell_quote_for_hook_command("/opt/dev's stuff/konductor");
        assert_eq!(quoted, "'/opt/dev'\\''s stuff/konductor'");
    }

    #[test]
    #[cfg(not(windows))]
    fn shell_quote_for_hook_command_quotes_a_posix_path_containing_a_backslash() {
        // A literal backslash is legal in a POSIX filename, but an
        // *unquoted* backslash is an escape metacharacter to sh/bash,
        // not a literal -- the exact class of mis-parsing this
        // function exists to prevent. Unlike Windows (where backslash
        // is the path separator and stays in the safe-unquoted set),
        // a POSIX path containing one must take the single-quote-
        // wrapping branch.
        let quoted = shell_quote_for_hook_command("/opt/dev\\legacy/konductor");
        assert_eq!(quoted, "'/opt/dev\\legacy/konductor'");
    }

    #[test]
    #[cfg(windows)]
    fn shell_quote_for_hook_command_leaves_a_backslash_path_unquoted_on_windows() {
        // Backslash is the native Windows path separator and stays in
        // the safe-unquoted set there, unlike on POSIX (see the
        // POSIX-side backslash test above).
        assert_eq!(
            shell_quote_for_hook_command("C:\\opt\\konductor\\bin\\konductor"),
            "C:\\opt\\konductor\\bin\\konductor"
        );
    }

    #[test]
    #[cfg(windows)]
    fn shell_quote_for_hook_command_escapes_an_embedded_double_quote_on_windows() {
        let quoted = shell_quote_for_hook_command("C:\\Program Files\\konductor \"beta\"");
        assert_eq!(quoted, "\"C:\\Program Files\\konductor \"\"beta\"\"\"");
    }

    // ── shared `.settings.lock` (concurrent-install lost-update race) ─

    /// Two concurrent merges into the same `settings.json`, one adding
    /// `hooks` and one `permissions`, must both survive: the shared
    /// `.settings.lock` serializes them.
    #[test]
    fn claude_settings_hooks_and_permissions_race_serialize_so_neither_change_is_lost() {
        let dir = scratch_dir("claude-settings-lock-race");
        let hooks_target = dir.clone();
        let perms_target = dir.clone();

        let hooks_thread = std::thread::spawn(move || {
            merge_claude_settings_hooks_with_exe(
                &hooks_target,
                CLAUDE_SETTINGS_RELATIVE_PATH,
                TELEMETRY_HOOK_ENTRIES,
                "/opt/konductor",
                &[],
            )
        });
        let perms_thread = std::thread::spawn(move || {
            merge_claude_settings_permissions(&perms_target, &["mcp__foo__bar".to_string()])
        });
        hooks_thread
            .join()
            .unwrap()
            .expect("hooks merge must succeed");
        perms_thread
            .join()
            .unwrap()
            .expect("permissions merge must succeed");

        let root = read_json(&dir.join(CLAUDE_SETTINGS_RELATIVE_PATH));
        assert!(root["hooks"]["SessionStart"].is_array(), "got: {root}");
        assert_eq!(
            root["permissions"]["allow"],
            serde_json::json!(["mcp__foo__bar"])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_errors_on_non_object_hooks_key() {
        let dir = scratch_dir("claude-hooks-non-object-hooks-key");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(dir.join(LOCAL), r#"{"hooks": "not-an-object"}"#).unwrap();
        let err = apply_claude_settings_hooks(&dir)
            .expect_err("a non-object \"hooks\" key must be rejected, not overwritten");
        assert!(err.contains("\"hooks\""));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_errors_on_non_array_event_key() {
        let dir = scratch_dir("claude-hooks-non-array-event");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(
            dir.join(LOCAL),
            r#"{"hooks": {"SessionStart": "not-an-array"}}"#,
        )
        .unwrap();
        let err = apply_claude_settings_hooks(&dir)
            .expect_err("a non-array \"hooks.SessionStart\" key must be rejected");
        assert!(err.contains("hooks.SessionStart"));
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn claude_settings_hooks_rejects_symlinked_claude_dir() {
        let dir = scratch_dir("claude-hooks-symlink-dir");
        let real_elsewhere = scratch_dir("claude-hooks-symlink-dir-target");
        std::os::unix::fs::symlink(&real_elsewhere, dir.join(".claude")).unwrap();

        let err = apply_claude_settings_hooks(&dir)
            .expect_err("a symlinked .claude directory must be rejected, never written through");
        assert!(err.contains("symlink"));
        assert!(!real_elsewhere.join("settings.local.json").exists());
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&real_elsewhere).ok();
    }

    // ── removing Konductor's telemetry hooks ─────────────────────────

    #[test]
    fn remove_claude_settings_hooks_strips_konductor_entries_and_preserves_foreign() {
        let dir = scratch_dir("claude-hooks-remove-preserve");
        wire(&dir, LOCAL, "/opt/konductor", &["k-architect"]);
        let mut root = read_json(&dir.join(LOCAL));
        root["hooks"]["SessionStart"]
            .as_array_mut()
            .unwrap()
            .push(hook_block("startup", "/usr/bin/env my-own-hook"));
        root["permissions"] = serde_json::json!({"allow": ["Read(*)"]});
        fs::write(dir.join(LOCAL), serde_json::to_vec_pretty(&root).unwrap()).unwrap();

        assert!(remove_claude_settings_hooks(&dir, LOCAL, TELEMETRY_HOOK_ENTRIES).unwrap());

        let after = read_json(&dir.join(LOCAL));
        assert_eq!(
            after["hooks"]["SessionStart"],
            serde_json::json!([hook_block("startup", "/usr/bin/env my-own-hook")])
        );
        assert!(
            after["hooks"].get("SubagentStart").is_none(),
            "got: {after}"
        );
        assert_eq!(
            after["permissions"],
            serde_json::json!({"allow": ["Read(*)"]})
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_claude_settings_hooks_removes_empty_hooks_scaffold() {
        let dir = scratch_dir("claude-hooks-remove-scaffold");
        wire(&dir, LOCAL, "/opt/konductor", &["k-architect"]);

        assert!(remove_claude_settings_hooks(&dir, LOCAL, TELEMETRY_HOOK_ENTRIES).unwrap());

        let after = read_json(&dir.join(LOCAL));
        assert!(after.get("hooks").is_none(), "got: {after}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_claude_settings_hooks_is_a_noop_when_no_file_exists() {
        let dir = scratch_dir("claude-hooks-remove-absent");
        assert!(!remove_claude_settings_hooks(&dir, LOCAL, TELEMETRY_HOOK_ENTRIES).unwrap());
        assert!(!dir.join(".claude").exists(), "nothing may be created");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_claude_telemetry_hooks_strips_both_settings_files() {
        let dir = scratch_dir("claude-hooks-remove-both");
        wire(&dir, CLAUDE_SETTINGS_RELATIVE_PATH, "/opt/konductor", &[]);
        wire(&dir, LOCAL, "/opt/konductor", &[]);

        let (changed, errors) = remove_claude_telemetry_hooks(&dir);

        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(changed.len(), 2, "{changed:?}");
        for relative in [CLAUDE_SETTINGS_RELATIVE_PATH, LOCAL] {
            assert!(read_json(&dir.join(relative)).get("hooks").is_none());
        }
        fs::remove_dir_all(&dir).ok();
    }

    // ── install entry points ─────────────────────────────────────────

    #[test]
    fn apply_claude_settings_hooks_only_with_no_telemetry_strips_a_prior_hook() {
        let dir = scratch_dir("claude-hooks-only-transition");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let tracked = apply_claude_settings_hooks_only(&dir, false)
            .expect("telemetry-on wiring must produce an entry");
        assert_eq!(tracked.path, LOCAL);

        assert!(apply_claude_settings_hooks_only(&dir, true).is_none());
        assert!(read_json(&dir.join(LOCAL)).get("hooks").is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_claude_settings_hooks_only_moves_hooks_out_of_shared_settings_json() {
        let dir = scratch_dir("claude-hooks-only-migrate");
        wire(
            &dir,
            CLAUDE_SETTINGS_RELATIVE_PATH,
            "/opt/konductor",
            &["k-architect"],
        );

        apply_claude_settings_hooks_only(&dir, false).expect("wiring must produce an entry");

        assert!(read_json(&dir.join(CLAUDE_SETTINGS_RELATIVE_PATH))
            .get("hooks")
            .is_none());
        assert!(read_json(&dir.join(LOCAL))["hooks"]["SessionStart"].is_array());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn grant_and_hooks_track_the_grant_and_hooks_files_separately() {
        let dir = scratch_dir("claude-grant-and-hooks");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        wire(&dir, CLAUDE_SETTINGS_RELATIVE_PATH, "/opt/konductor", &[]);

        let files = apply_claude_settings_grant_and_hooks(&dir, false, "Kiro CLI");

        let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, [CLAUDE_SETTINGS_RELATIVE_PATH, LOCAL]);
        let shared = fs::read(dir.join(CLAUDE_SETTINGS_RELATIVE_PATH)).unwrap();
        assert!(serde_json::from_slice::<serde_json::Value>(&shared)
            .unwrap()
            .get("hooks")
            .is_none());
        assert_eq!(
            files[0].sha256.as_deref(),
            Some(super::super::super::artifact::sha256_hex(&shared).as_str()),
            "the recorded grant hash must match settings.json after the legacy hooks were stripped"
        );
        assert!(read_json(&dir.join(LOCAL))["hooks"]["SessionStart"].is_array());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn grant_and_hooks_with_no_telemetry_strips_prior_hooks_from_both_files() {
        let dir = scratch_dir("claude-grant-and-hooks-no-telemetry");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        wire(
            &dir,
            CLAUDE_SETTINGS_RELATIVE_PATH,
            "/opt/konductor",
            &["k-architect"],
        );
        wire(&dir, LOCAL, "/opt/konductor", &["k-architect"]);

        let files = apply_claude_settings_grant_and_hooks(&dir, true, "Kiro CLI");

        let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, [CLAUDE_SETTINGS_RELATIVE_PATH]);
        let shared = read_json(&dir.join(CLAUDE_SETTINGS_RELATIVE_PATH));
        assert!(shared.get("hooks").is_none(), "got: {shared}");
        assert!(shared["permissions"]["allow"].is_array());
        assert!(read_json(&dir.join(LOCAL)).get("hooks").is_none());
        fs::remove_dir_all(&dir).ok();
    }
}
