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
    if super::target_dir_is_home(target_dir) {
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
// `remove_claude_konductor_hooks` once no remaining strategy tracks the
// hooks file. Kiro's own hooks live in `telemetry_hook_pass.rs`.

/// Which Konductor hook a command is. A telemetry hook's event argument
/// comes from `telemetry_hook.rs`'s constants, so a rename there is a
/// compile error here. A hook is identified by its subcommand (and event
/// argument), never by exe path, so a reinstall replaces a stale block
/// (moved binary, changed agent set) instead of adding another.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum HookId {
    Telemetry(&'static str),
    OrchestrationMode,
}

/// One hook block Konductor wires. The command is built at merge time
/// because it embeds the resolved exe path and install root. `always`
/// entries are wired even under `--no-telemetry`.
pub(super) struct KonductorHookEntry {
    event: &'static str,
    matcher: HookMatcher,
    id: HookId,
    always: bool,
}

enum HookMatcher {
    Fixed(&'static str),
    /// Matches only the agent types Konductor installed at the target, so
    /// Claude never spawns the hook for a foreign sub-agent.
    InstalledAgents,
}

const AGENT_INVOCATION_HOOK: KonductorHookEntry = KonductorHookEntry {
    event: "SessionStart",
    // A genuine session start or a `/clear` both count as a fresh
    // `agent_invocation`.
    matcher: HookMatcher::Fixed("startup|clear"),
    id: HookId::Telemetry(crate::cli::telemetry_hook::AGENT_INVOCATION),
    always: false,
};

const SUBAGENT_INVOCATION_HOOK: KonductorHookEntry = KonductorHookEntry {
    event: "SubagentStart",
    matcher: HookMatcher::InstalledAgents,
    id: HookId::Telemetry(crate::cli::telemetry_hook::SUBAGENT_INVOCATION),
    always: false,
};

const ORCHESTRATION_MODE_HOOK: KonductorHookEntry = KonductorHookEntry {
    event: "SessionStart",
    // Its own block: the persona must come back after `/clear`,
    // `/compact` and resume, which telemetry must not count.
    matcher: HookMatcher::Fixed("startup|clear|resume|compact"),
    id: HookId::OrchestrationMode,
    always: true,
};

/// Every hook Konductor wires: what a Claude Code install writes and
/// what `uninstall` removes.
pub(super) const KONDUCTOR_HOOK_ENTRIES: &[KonductorHookEntry] = &[
    AGENT_INVOCATION_HOOK,
    SUBAGENT_INVOCATION_HOOK,
    ORCHESTRATION_MODE_HOOK,
];

/// What a Kiro install writes into a dual-marker target's Claude settings.
/// The orchestration hook is the Claude strategy's alone: the hook
/// resolves its owner per harness, so an entry a Kiro install wrote
/// would never print.
const TELEMETRY_HOOK_ENTRIES: &[KonductorHookEntry] =
    &[AGENT_INVOCATION_HOOK, SUBAGENT_INVOCATION_HOOK];

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

const TELEMETRY_HOOK_MARKER: &str = "__telemetry-hook ";
pub(crate) const ORCHESTRATION_HOOK_MARKER: &str = "__orchestration-hook";

/// The `__telemetry-hook ...` or `__orchestration-hook ...` part of a
/// hook command, without the leading exe path, so commands that differ
/// only in where the binary lives (or in the bare-`"konductor"` fallback)
/// are recognized as the same hook. `None` when `command` is neither.
pub(super) fn stable_hook_command_suffix(command: &str) -> Option<&str> {
    if let Some(idx) = command.find(TELEMETRY_HOOK_MARKER) {
        return Some(&command[idx..]);
    }
    let idx = command.find(ORCHESTRATION_HOOK_MARKER)?;
    let rest = &command[idx + ORCHESTRATION_HOOK_MARKER.len()..];
    (rest.is_empty() || rest.starts_with(' ')).then(|| &command[idx..])
}

/// Whether `command` is the Konductor hook `id`.
pub(super) fn command_is_hook(command: &str, id: HookId) -> bool {
    match id {
        HookId::Telemetry(event) => telemetry_hook_event(command) == Some(event),
        HookId::OrchestrationMode => stable_hook_command_suffix(command)
            .is_some_and(|suffix| suffix.starts_with(ORCHESTRATION_HOOK_MARKER)),
    }
}

/// The event argument of a telemetry hook command, so two commands that
/// differ only in exe path or trailing arguments identify the same hook.
pub(super) fn telemetry_hook_event(command: &str) -> Option<&str> {
    stable_hook_command_suffix(command)?
        .strip_prefix(TELEMETRY_HOOK_MARKER)?
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
    let mut command = format!("{quoted_exe} {TELEMETRY_HOOK_MARKER}{event_type}");
    append_hook_args(&mut command, agent, install_root);
    command
}

/// `<exe> __orchestration-hook [--agent <name>] [--install-root <dir>] [--harness <id>]`.
/// `quoted_exe` is already shell-quoted; the other values are quoted here.
/// `harness` is the strategy name of the install that wires the hook, so
/// the hook resolves its owner among installs for that harness only.
pub(super) fn orchestration_hook_command(
    quoted_exe: &str,
    agent: Option<&str>,
    install_root: Option<&Path>,
    harness: Option<&str>,
) -> String {
    let mut command = format!("{quoted_exe} {ORCHESTRATION_HOOK_MARKER}");
    append_hook_args(&mut command, agent, install_root);
    if let Some(harness) = harness {
        command.push_str(" --harness ");
        command.push_str(&shell_quote_for_hook_command(harness));
    }
    command
}

/// The exe path a hook command runs, when the command's first word is
/// followed by `marker`. Reverses both quoting forms of
/// `shell_quote_for_hook_command`, so a command written on either
/// platform reads back the same path.
pub(crate) fn hook_command_exe(command: &str, marker: &str) -> Option<String> {
    let (exe, rest) = split_first_word(command)?;
    let rest = rest.strip_prefix(' ')?.strip_prefix(marker)?;
    (rest.is_empty() || rest.starts_with(' ')).then_some(exe)
}

/// The unquoted `--install-root` value of a hook command, or `None`
/// when the command carries none.
pub(crate) fn hook_command_install_root(command: &str) -> Option<String> {
    let (_, mut rest) = split_first_word(command)?;
    loop {
        let (word, after) = split_first_word(rest.strip_prefix(' ')?)?;
        if word == "--install-root" {
            return split_first_word(after.strip_prefix(' ')?).map(|(root, _)| root);
        }
        rest = after;
    }
}

/// The first shell word of `command`, unquoted, and the text after it.
fn split_first_word(command: &str) -> Option<(String, &str)> {
    match command.chars().next()? {
        '\'' => split_single_quoted(command),
        '"' => split_double_quoted(command),
        _ => {
            let end = command.find(' ').unwrap_or(command.len());
            Some((command[..end].to_string(), &command[end..]))
        }
    }
}

/// `'a'\''b'` reads as `a'b`.
fn split_single_quoted(command: &str) -> Option<(String, &str)> {
    let mut word = String::new();
    let mut rest = command;
    loop {
        let inner = rest.strip_prefix('\'')?;
        let close = inner.find('\'')?;
        word.push_str(&inner[..close]);
        rest = &inner[close + 1..];
        match rest.strip_prefix("\\'") {
            Some(after) => {
                word.push('\'');
                rest = after;
            }
            None => return Some((word, rest)),
        }
    }
}

/// `"a""b"` reads as `a"b`.
fn split_double_quoted(command: &str) -> Option<(String, &str)> {
    let mut word = String::new();
    let mut chars = command[1..].char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        if c != '"' {
            word.push(c);
            continue;
        }
        if chars.peek().is_some_and(|&(_, next)| next == '"') {
            chars.next();
            word.push('"');
            continue;
        }
        return Some((word, &command[index + 2..]));
    }
    None
}

fn append_hook_args(command: &mut String, agent: Option<&str>, install_root: Option<&Path>) {
    if let Some(agent) = agent {
        command.push_str(" --agent ");
        command.push_str(&shell_quote_for_hook_command(agent));
    }
    if let Some(root) = install_root {
        let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        command.push_str(" --install-root ");
        command.push_str(&shell_quote_for_hook_command(&root.display().to_string()));
    }
}

/// The command for `id`, wired for the install at `install_root`.
fn hook_command(quoted_exe: &str, id: HookId, install_root: &Path) -> String {
    match id {
        HookId::Telemetry(event) => {
            telemetry_hook_command(quoted_exe, event, None, Some(install_root))
        }
        HookId::OrchestrationMode => orchestration_hook_command(
            quoted_exe,
            None,
            Some(install_root),
            Some(crate::cli::install::claude::STRATEGY_NAME),
        ),
    }
}

/// Removes every Konductor hook `id` from one event's block array,
/// dropping blocks left empty. Returns how many hooks it removed.
fn strip_konductor_hooks(event_array: &mut Vec<serde_json::Value>, id: HookId) -> usize {
    let mut removed = 0;
    for block in event_array.iter_mut() {
        let Some(inner) = block.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
            continue;
        };
        let before = inner.len();
        inner.retain(|hook| {
            !hook
                .get("command")
                .and_then(|c| c.as_str())
                .is_some_and(|command| command_is_hook(command, id))
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

/// Whether `event_array` holds exactly one Konductor hook `id`, and it
/// already has `matcher` and `command`.
fn konductor_hook_is_current(
    event_array: &[serde_json::Value],
    id: HookId,
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
            .filter(|existing| command_is_hook(existing, id))
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
/// Under `no_telemetry` only the `always` entries are wired.
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
    entries: &[KonductorHookEntry],
    no_telemetry: bool,
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
    for entry in entries.iter().filter(|entry| entry.always || !no_telemetry) {
        let matcher = match entry.matcher {
            HookMatcher::Fixed(matcher) => Some(matcher.to_string()),
            HookMatcher::InstalledAgents => installed_agents_matcher(agent_names),
        };
        let command = hook_command(&quoted_exe, entry.id, target_dir);
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
                if konductor_hook_is_current(event_array, entry.id, matcher, &command) => {}
            Some(matcher) => {
                let removed = if exe_is_absolute {
                    strip_konductor_hooks(event_array, entry.id)
                } else {
                    0
                };
                let has_existing = event_array
                    .iter()
                    .filter_map(|block| block.get("hooks").and_then(|h| h.as_array()))
                    .flatten()
                    .filter_map(|hook| hook.get("command").and_then(|c| c.as_str()))
                    .any(|existing| command_is_hook(existing, entry.id));
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
                any_changed |= strip_konductor_hooks(event_array, entry.id) > 0;
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

/// Wires the hooks in `entries` (only the `always` ones under
/// `no_telemetry`) into `target_dir`'s hooks settings file
/// (`claude_hooks_settings_relative_path`) and returns that file's
/// manifest path and content hash.
fn apply_claude_settings_hooks(
    target_dir: &Path,
    entries: &[KonductorHookEntry],
    no_telemetry: bool,
) -> Result<(String, String), ClaudeGrantError> {
    apply_claude_settings_hooks_with_exe(
        target_dir,
        entries,
        no_telemetry,
        &resolve_konductor_exe_path(),
    )
}

pub(super) fn apply_claude_settings_hooks_with_exe(
    target_dir: &Path,
    entries: &[KonductorHookEntry],
    no_telemetry: bool,
    exe: &str,
) -> Result<(String, String), ClaudeGrantError> {
    let relative = claude_hooks_settings_relative_path(target_dir);
    let agent_names = crate::cli::telemetry_hook::installed_agent_names(target_dir);
    let bytes = merge_claude_settings_hooks_with_exe(
        target_dir,
        relative,
        entries,
        no_telemetry,
        exe,
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

/// Strips the Konductor hooks in `entries` (without the `always` ones
/// unless `include_always`) from `<target_dir>/<relative>`,
/// leaving every other hook, event and key untouched, and removing any
/// `hooks` scaffolding left empty. Matches on the command's event
/// argument, so hooks wired by a moved binary or with an old matcher are
/// still found. Never deletes the file. Returns whether anything was
/// removed; a missing file is `Ok(false)`.
fn remove_claude_settings_hooks(
    target_dir: &Path,
    relative: &str,
    entries: &[KonductorHookEntry],
    include_always: bool,
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

    let removed = strip_entries_from_hooks(hooks_obj, entries, include_always, &settings_path)?;
    if removed == 0 {
        return Ok(false);
    }
    if hooks_obj.is_empty() {
        root_obj.remove("hooks");
    }

    write_settings_file(&settings_path, &claude_dir, &root, Some(original_mode))?;
    Ok(true)
}

/// Removes every Konductor hook listed in `entries` (skipping `always`
/// entries unless `include_always`) from
/// `hooks_obj` (a settings file's parsed `"hooks"` object), dropping an
/// event's array once it has no blocks left. Returns how many hooks were
/// removed in total, across every event. Errors if an event's value is
/// present but not a JSON array.
fn strip_entries_from_hooks(
    hooks_obj: &mut serde_json::Map<String, serde_json::Value>,
    entries: &[KonductorHookEntry],
    include_always: bool,
    settings_path: &Path,
) -> Result<usize, ClaudeGrantError> {
    let mut removed = 0;
    for entry in entries
        .iter()
        .filter(|entry| include_always || !entry.always)
    {
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
        removed += strip_konductor_hooks(event_array, entry.id);
        if event_array.is_empty() {
            hooks_obj.remove(entry.event);
        }
    }
    Ok(removed)
}

/// Strips every Konductor hook from both Claude settings files at
/// `target_dir`, for `uninstall`. Returns the files it changed; every file
/// is attempted even when an earlier one fails.
pub(crate) fn remove_claude_konductor_hooks(target_dir: &Path) -> (Vec<String>, Vec<String>) {
    remove_claude_hooks_from_both_files(target_dir, true)
}

fn remove_claude_hooks_from_both_files(
    target_dir: &Path,
    include_always: bool,
) -> (Vec<String>, Vec<String>) {
    let mut changed = Vec::new();
    let mut errors = Vec::new();
    for relative in [
        CLAUDE_SETTINGS_RELATIVE_PATH,
        CLAUDE_LOCAL_SETTINGS_RELATIVE_PATH,
    ] {
        match remove_claude_settings_hooks(
            target_dir,
            relative,
            KONDUCTOR_HOOK_ENTRIES,
            include_always,
        ) {
            Ok(true) => changed.push(target_dir.join(relative).display().to_string()),
            Ok(false) => {}
            Err(err) => errors.push(err.to_string()),
        }
    }
    (changed, errors)
}

/// Removes hooks that must not stay after this run: an earlier release's
/// hooks in the shared `settings.json` when this target's hooks now live
/// in `settings.local.json`, and under `--no-telemetry` the telemetry
/// hooks from both files. Runs before any other write to `settings.json`
/// so the hash recorded for the grant is the final one. Non-fatal.
fn strip_hooks_not_owned_this_run(target_dir: &Path, no_telemetry: bool) {
    if claude_hooks_settings_relative_path(target_dir) != CLAUDE_SETTINGS_RELATIVE_PATH {
        if let Err(err) = remove_claude_settings_hooks(
            target_dir,
            CLAUDE_SETTINGS_RELATIVE_PATH,
            KONDUCTOR_HOOK_ENTRIES,
            true,
        ) {
            eprintln!(
                "warning: could not move the Konductor hooks out of this target's shared \
                 {CLAUDE_SETTINGS_RELATIVE_PATH}: {err}"
            );
        }
    }
    if !no_telemetry {
        return;
    }
    let (changed, errors) = remove_claude_hooks_from_both_files(target_dir, false);
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
}

/// Wires only the Konductor hooks (no `permissions.allow` grant), for
/// `ClaudeInstallStrategy`: that path never registers `konductor-skills`
/// for Claude Code, so the grant would be inert there. Under
/// `no_telemetry` it strips the telemetry hooks a prior install wired and
/// wires the orchestration hook alone. Non-fatal: a symlinked or
/// malformed settings file must not abort an otherwise successful
/// install.
pub(in crate::cli::install) fn apply_claude_settings_hooks_only(
    target_dir: &Path,
    no_telemetry: bool,
) -> Option<ManifestFile> {
    strip_hooks_not_owned_this_run(target_dir, no_telemetry);
    match apply_claude_settings_hooks(target_dir, KONDUCTOR_HOOK_ENTRIES, no_telemetry) {
        Ok((path, sha256)) => Some(ManifestFile {
            path,
            sha256: Some(sha256),
            provenance: Provenance::Created,
        }),
        Err(message) => {
            eprintln!(
                "warning: Konductor hooks were not wired for this Claude Code install: \
                 {message}"
            );
            None
        }
    }
}

/// Performs the `.claude`-marker-gated `permissions.allow` grant
/// (`apply_claude_settings_grant`) plus, unless `no_telemetry`, the
/// telemetry-hook wiring (`TELEMETRY_HOOK_ENTRIES`), for a whole Kiro
/// install run. Returns one `ManifestFile` per settings file written:
/// `settings.json` for the grant, and the hooks file when it differs (a
/// project install). Empty when the grant is skipped.
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
                match apply_claude_settings_hooks(target_dir, TELEMETRY_HOOK_ENTRIES, no_telemetry)
                {
                    Ok((hooks_path, hooks_sha256)) => {
                        // A `$HOME` install shares one file, so the hooks
                        // write supersedes the grant's hash.
                        written.retain(|(path, _)| *path != hooks_path);
                        written.push((hooks_path, hooks_sha256));
                    }
                    Err(message) => {
                        eprintln!(
                            "warning: Claude Code telemetry hook wiring skipped ({message}) -- \
                             the {strategy_label} portion of this install is unaffected"
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
        merge_claude_settings_hooks_with_exe(
            dir,
            relative,
            KONDUCTOR_HOOK_ENTRIES,
            false,
            exe,
            &agents,
        )
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

    /// An event's blocks without the orchestration hook's, so telemetry
    /// assertions stay about telemetry.
    fn telemetry_blocks(event: &serde_json::Value) -> serde_json::Value {
        let blocks = event.as_array().cloned().unwrap_or_default();
        serde_json::Value::Array(
            blocks
                .into_iter()
                .filter(|block| !block.to_string().contains("__orchestration-hook"))
                .collect(),
        )
    }

    fn orchestration_block(dir: &Path, exe: &str) -> serde_json::Value {
        hook_block(
            "startup|clear|resume|compact",
            &format!(
                "{exe} __orchestration-hook{} --harness claude",
                root_arg(dir)
            ),
        )
    }

    #[test]
    fn project_install_wires_hooks_into_settings_local_json() {
        let dir = scratch_dir("claude-hooks-project-local");
        fs::create_dir_all(dir.join(".claude")).unwrap();

        let (path, sha256) = apply_claude_settings_hooks(&dir, KONDUCTOR_HOOK_ENTRIES, false)
            .expect("hook wiring must succeed");

        assert_eq!(path, LOCAL);
        assert_eq!(sha256.len(), 64);
        assert!(!dir.join(CLAUDE_SETTINGS_RELATIVE_PATH).exists());
        let quoted_exe = shell_quote_for_hook_command(&resolve_konductor_exe_path());
        let root = root_arg(&dir);
        assert_eq!(
            read_json(&dir.join(LOCAL))["hooks"]["SessionStart"],
            serde_json::json!([
                hook_block(
                    "startup|clear",
                    &format!("{quoted_exe} __telemetry-hook agent-invocation{root}")
                ),
                orchestration_block(&dir, &quoted_exe)
            ])
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
            telemetry_blocks(&hooks["SessionStart"]),
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

        let session_start = telemetry_blocks(&read_json(&dir.join(LOCAL))["hooks"]["SessionStart"]);
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
            telemetry_blocks(&read_json(&dir.join(LOCAL))["hooks"]["SessionStart"]),
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

        let session_start = telemetry_blocks(&read_json(&dir.join(LOCAL))["hooks"]["SessionStart"]);
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
                KONDUCTOR_HOOK_ENTRIES,
                false,
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
        let err = apply_claude_settings_hooks(&dir, KONDUCTOR_HOOK_ENTRIES, false)
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
        let err = apply_claude_settings_hooks(&dir, KONDUCTOR_HOOK_ENTRIES, false)
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

        let err = apply_claude_settings_hooks(&dir, KONDUCTOR_HOOK_ENTRIES, false)
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

        assert!(remove_claude_settings_hooks(&dir, LOCAL, KONDUCTOR_HOOK_ENTRIES, true).unwrap());

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

        assert!(remove_claude_settings_hooks(&dir, LOCAL, KONDUCTOR_HOOK_ENTRIES, true).unwrap());

        let after = read_json(&dir.join(LOCAL));
        assert!(after.get("hooks").is_none(), "got: {after}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_claude_settings_hooks_is_a_noop_when_no_file_exists() {
        let dir = scratch_dir("claude-hooks-remove-absent");
        assert!(!remove_claude_settings_hooks(&dir, LOCAL, KONDUCTOR_HOOK_ENTRIES, true).unwrap());
        assert!(!dir.join(".claude").exists(), "nothing may be created");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_claude_konductor_hooks_strips_both_settings_files() {
        let dir = scratch_dir("claude-hooks-remove-both");
        wire(&dir, CLAUDE_SETTINGS_RELATIVE_PATH, "/opt/konductor", &[]);
        wire(&dir, LOCAL, "/opt/konductor", &[]);

        let (changed, errors) = remove_claude_konductor_hooks(&dir);

        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(changed.len(), 2, "{changed:?}");
        for relative in [CLAUDE_SETTINGS_RELATIVE_PATH, LOCAL] {
            assert!(read_json(&dir.join(relative)).get("hooks").is_none());
        }
        fs::remove_dir_all(&dir).ok();
    }

    // ── install entry points ─────────────────────────────────────────

    #[test]
    fn apply_claude_settings_hooks_only_with_no_telemetry_keeps_only_the_orchestration_hook() {
        let dir = scratch_dir("claude-hooks-only-transition");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let tracked = apply_claude_settings_hooks_only(&dir, false)
            .expect("telemetry-on wiring must produce an entry");
        assert_eq!(tracked.path, LOCAL);

        let tracked = apply_claude_settings_hooks_only(&dir, true)
            .expect("the orchestration hook is wired under --no-telemetry");
        assert_eq!(tracked.path, LOCAL);
        let quoted_exe = shell_quote_for_hook_command(&resolve_konductor_exe_path());
        assert_eq!(
            read_json(&dir.join(LOCAL))["hooks"],
            serde_json::json!({"SessionStart": [orchestration_block(&dir, &quoted_exe)]})
        );
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
    fn grant_and_hooks_with_no_telemetry_strips_telemetry_hooks_from_both_files() {
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

        // Only the grant is tracked: a Kiro run writes no hooks file, and
        // the orchestration hook a Claude install wired stays in place.
        let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, [CLAUDE_SETTINGS_RELATIVE_PATH]);
        let shared = read_json(&dir.join(CLAUDE_SETTINGS_RELATIVE_PATH));
        assert!(shared.get("hooks").is_none(), "got: {shared}");
        assert!(shared["permissions"]["allow"].is_array());
        assert_eq!(
            read_json(&dir.join(LOCAL))["hooks"],
            serde_json::json!({"SessionStart": [orchestration_block(&dir, "/opt/konductor")]})
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn grant_and_hooks_wires_only_the_telemetry_hooks() {
        let dir = scratch_dir("claude-grant-and-hooks-telemetry-only");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        fs::write(dir.join(CLAUDE_SETTINGS_RELATIVE_PATH), "{}").unwrap();

        apply_claude_settings_grant_and_hooks(&dir, false, "Kiro CLI");

        let local = read_json(&dir.join(LOCAL))["hooks"].to_string();
        assert!(local.contains("__telemetry-hook"), "{local}");
        assert!(
            !local.contains("__orchestration-hook"),
            "a Kiro install must not wire the orchestration hook; got: {local}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_project_install_moves_both_hook_kinds_out_of_shared_settings_json() {
        let dir = scratch_dir("claude-hooks-move-both-kinds");
        wire(
            &dir,
            CLAUDE_SETTINGS_RELATIVE_PATH,
            "/opt/konductor",
            &["k-architect"],
        );
        let shared = read_json(&dir.join(CLAUDE_SETTINGS_RELATIVE_PATH));
        assert_eq!(shared["hooks"]["SessionStart"].as_array().unwrap().len(), 2);

        apply_claude_settings_hooks_only(&dir, false).expect("wiring must succeed");

        assert!(read_json(&dir.join(CLAUDE_SETTINGS_RELATIVE_PATH))
            .get("hooks")
            .is_none());
        let local = &read_json(&dir.join(LOCAL))["hooks"]["SessionStart"];
        assert_eq!(local.as_array().unwrap().len(), 2, "got: {local}");
        assert!(local.to_string().contains("__orchestration-hook"));
        assert!(local.to_string().contains("__telemetry-hook"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_telemetry_reinstall_keeps_the_orchestration_hook() {
        let dir = scratch_dir("claude-hooks-no-telemetry-reinstall");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        apply_claude_settings_hooks_only(&dir, false).unwrap();
        apply_claude_settings_hooks_only(&dir, true).unwrap();
        let hooks = &read_json(&dir.join(LOCAL))["hooks"];
        assert!(hooks.get("SubagentStart").is_none());
        assert!(hooks.to_string().contains("__orchestration-hook"));
        assert!(!hooks.to_string().contains("__telemetry-hook"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn uninstall_strips_the_orchestration_hook_too() {
        let dir = scratch_dir("claude-hooks-uninstall-all");
        wire(&dir, LOCAL, "/opt/konductor", &[]);
        let (changed, errors) = remove_claude_konductor_hooks(&dir);
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(changed.len(), 1);
        assert!(read_json(&dir.join(LOCAL)).get("hooks").is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn orchestration_hook_commands_are_recognized_by_subcommand() {
        let command = orchestration_hook_command("/opt/k", None, None, None);
        assert_eq!(command, "/opt/k __orchestration-hook");
        assert!(command_is_hook(&command, HookId::OrchestrationMode));
        assert!(command_is_hook(
            "'/a b/k' __orchestration-hook --install-root /x",
            HookId::OrchestrationMode
        ));
        assert!(!command_is_hook(
            "/opt/k __orchestration-hookx",
            HookId::OrchestrationMode
        ));
        assert!(!command_is_hook(
            "/opt/k __telemetry-hook agent-invocation",
            HookId::OrchestrationMode
        ));
        assert_eq!(
            orchestration_hook_command("k", Some("konductor"), None, None),
            "k __orchestration-hook --agent konductor"
        );
        assert_eq!(
            orchestration_hook_command("k", None, None, Some("claude")),
            "k __orchestration-hook --harness claude"
        );
        assert!(command_is_hook(
            "k __orchestration-hook --install-root /x --harness claude",
            HookId::OrchestrationMode
        ));
    }

    #[test]
    fn hook_command_exe_round_trips_the_quoted_exe() {
        for exe in [
            "/opt/konductor/bin/konductor",
            "/Users/a b/bin/konductor",
            "/tmp/it's/konductor",
            "/tmp/ends-with-quote'",
        ] {
            let command = orchestration_hook_command(
                &shell_quote_for_hook_command(exe),
                Some("konductor"),
                Some(Path::new("/x y")),
                None,
            );
            assert_eq!(
                hook_command_exe(&command, ORCHESTRATION_HOOK_MARKER).as_deref(),
                Some(exe),
                "{command}"
            );
        }
    }

    #[test]
    fn hook_command_exe_reads_both_quoting_forms() {
        let marker = ORCHESTRATION_HOOK_MARKER;
        assert_eq!(
            hook_command_exe("'/a'\\''b/k' __orchestration-hook", marker).as_deref(),
            Some("/a'b/k")
        );
        assert_eq!(
            hook_command_exe(
                "\"C:\\P F\\k \"\"x\"\"\" __orchestration-hook --agent konductor",
                marker
            )
            .as_deref(),
            Some("C:\\P F\\k \"x\"")
        );
    }

    #[test]
    fn hook_command_install_root_round_trips_the_quoted_root() {
        let root = Path::new("/p q/r's");
        let command = orchestration_hook_command(
            &shell_quote_for_hook_command("/opt/k"),
            Some("konductor"),
            Some(root),
            None,
        );
        assert_eq!(
            hook_command_install_root(&command).as_deref(),
            Some("/p q/r's")
        );
        assert_eq!(
            hook_command_install_root(
                "\"C:\\a b\\k\" __orchestration-hook --install-root \"C:\\p q\""
            )
            .as_deref(),
            Some("C:\\p q")
        );
        assert_eq!(
            hook_command_install_root("/opt/k __orchestration-hook --agent konductor"),
            None
        );
    }

    #[test]
    fn hook_command_exe_needs_the_marker_right_after_the_exe() {
        let marker = ORCHESTRATION_HOOK_MARKER;
        assert_eq!(
            hook_command_exe("/opt/k __orchestration-hookx", marker),
            None
        );
        assert_eq!(
            hook_command_exe("/opt/k __telemetry-hook agent-invocation", marker),
            None
        );
        assert_eq!(
            hook_command_exe("/opt/k --x __orchestration-hook", marker),
            None
        );
        assert_eq!(
            hook_command_exe("'/unterminated __orchestration-hook", marker),
            None
        );
        assert_eq!(
            hook_command_exe("konductor __orchestration-hook", marker).as_deref(),
            Some("konductor")
        );
    }
}
