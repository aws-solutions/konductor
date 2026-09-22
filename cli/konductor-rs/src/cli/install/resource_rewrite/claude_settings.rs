// SPDX-License-Identifier: Apache-2.0
//
// install/resource_rewrite/claude_settings.rs — one-time mutation of a
// Claude Code install target's shared `.claude/settings.json`: the
// `permissions.allow` grant for the `konductor-skills` MCP server's
// tools, and the telemetry hook wiring. Neither implements
// `ResourceRewritePass` -- unlike the passes in `mod.rs`/`mcp_server`,
// these run once per install run against a plain `target_dir: &Path`,
// not once per agent against a parsed agent JSON `Value` plus
// `RewriteContext`, and they merge into one shared file rather than
// rewriting a per-agent one.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use super::super::manifest::{ManifestFile, Provenance};
use super::mcp_server::{MCP_SERVER_ALLOWED_TOOLS_GRANTS, MCP_SERVER_NAME};

// ── V3/Claude Code permission grant (additive to the V2 pair above) ─────
//
// Kiro CLI V2 (above) grants access by writing `tools`/`allowedTools`
// directly into each agent's own JSON file -- which, being manifest-
// tracked as a whole file already, carries the grant's provenance for
// free. Claude Code has no equivalent per-agent field at all: the
// analogous grant lives in one shared, project-level settings file,
// `<target_dir>/.claude/settings.json`'s `permissions.allow` array (see
// <https://code.claude.com/docs/en/permissions#mcp>, and the real
// `~/.claude/settings.json` / repo-local `.claude/settings.json`
// examples this design was grounded in).
//
// Because that file is shared rather than per-agent, this grant is
// applied exactly ONCE per install run (`apply_claude_settings_grant`
// below, called from `kiro_cli.rs`'s `install_agents`/
// `install_from_local`), never once per skill-bearing agent -- unlike
// the V2 side, which is naturally per-agent. The caller gates the call
// on two conditions mirroring the V2 grant's own scope: `detect_runtimes`
// finding a `.claude` marker at the target, AND at least one agent this
// run actually having received the V2 `mcpServers` injection (checked
// by the caller via `MCP_SERVER_NAME` above), so this can never fire on
// a run where V2 injected nothing. The caller also constructs a real
// `ManifestFile` entry for the written settings.json, classified with
// `manifest::classify_provenance` against the file's state BEFORE this
// grant runs -- so the mutation is always accounted for in
// `.konductor/manifest`, visible to `konductor doctor`, and correctly
// reflected even if a later agent in the same install run fails.
// Deliberately NOT solved by that manifest entry: granular "remove
// exactly these grant strings on uninstall" support. There is no
// existing manifest concept for partial ownership of a shared file's
// content to build that on, and a foreign-classified entry is correctly
// left alone by `konductor uninstall` regardless (matching
// `install_skills`'s own foreign-file-preservation philosophy elsewhere
// in this codebase -- uninstall must never wholesale-delete a shared
// file that may carry unrelated hand-authored content). Inventing that
// mechanism is out of scope here.
//
// `merge_claude_settings_permissions` below guards against two risks a
// merge-into-a-pre-existing-file operation invites that the V2 side
// (which only ever writes fresh, synthesized content) never faces:
// - Symlink safety: both the `.claude` directory and `settings.json`
//   itself are rejected outright if either is a symlink -- this is the
//   only pass in this file that reads pre-existing content from the
//   target and republishes it, so a symlinked `settings.json` would
//   read and preserve whatever it points at, and a symlinked `.claude`
//   directory would silently redirect the write through the parent-
//   directory resolution `create_dir_all`/`rename` already follow.
// - Deny-shadow detection: if the target's `permissions.deny` already
//   covers a grant this pass is about to add (an exact match, this
//   server's own wildcard forms, or the global `mcp__*`), the merge
//   errors rather than silently writing an allow entry Claude Code
//   would never actually honor.
//
// Reachability today, precisely: there is no separate Claude
// `InstallStrategy` (`install::registry::STRATEGIES` registers only
// `KiroCliInstallStrategy`), so this fires only through THAT strategy's
// `install_from_local` -- which requires `.kiro` to already exist at
// the target (see `KiroCliInstallStrategy::matches`; a target with
// `.claude` but no PRE-EXISTING `.kiro` is a Claude-only target by
// `detect_runtimes`'s reckoning, since `.kiro` would be this same run's
// own output, and no registered strategy claims that). So this grant
// reaches disk on a reinstall/update over a target that already has
// `.kiro` (from a prior konductor install, or created by hand) AND
// already has `.claude` -- not on a from-scratch "first install ever,
// Claude Code only" target, which has no install path at all yet
// (Claude grant or otherwise), pending a real Claude `InstallStrategy`.
// Verified directly, not assumed: see `kiro_cli.rs`'s
// `install_from_local_grants_claude_settings_permissions_when_claude_marker_dir_present`
// (the reachable case, through the real unmodified strategy entry
// point) and its neighbor
// `install_from_local_rejects_claude_only_target_with_no_preexisting_kiro_dir`
// (the unreachable case).
//
// A further, deliberately unimplemented gap: this grants PERMISSION to
// call `konductor-skills`'s tools, but nothing anywhere in this
// codebase REGISTERS `konductor-skills` as an MCP server for Claude
// Code (the equivalent of the V2 side's own `mcpServers` JSON
// injection, which registers AND grants in one place because both live
// in the same agent file). Without a `.mcp.json` entry or equivalent
// server registration, an `mcp__konductor-skills__*` allow rule is
// inert on any target that doesn't happen to have that server
// registered through some out-of-band means. No concrete design for
// how this codebase should write that registration exists anywhere in
// this workspace -- the same "don't invent a schema from guesswork"
// reasoning as the Kiro V3/KAS gap below applies equally here.
//
// There is no Kiro CLI V3/KAS equivalent implemented here either. No
// concrete schema for a `.kiro/permissions` file -- the natural V3
// counterpart -- exists anywhere in this workspace (searched both
// packages' `docs/design/*.md` and `designs/*.md`, and the workspace
// generally) to ground an implementation in -- unlike the Claude Code
// side, which has two live, real examples on disk. Adding one here
// would mean inventing a schema from guesswork. Both this and
// the MCP-server-registration gap above remain open follow-ups pending
// design decisions.

/// Relative path, under an install target directory, of Claude Code's
/// shared-project settings file -- the "Shared project" tier documented
/// at <https://code.claude.com/docs/en/settings>. Deliberately
/// `.claude/settings.json`, not `.claude/settings.local.json` (personal,
/// gitignored, wrong tier for a project-wide grant this install writes
/// on every user's behalf) or `~/.claude/settings.json` (user-level,
/// outside any install target this pass ever sees). `pub(crate)` (not
/// just `pub(super)`): read by `kiro_cli.rs`, to build the destination
/// path it passes to `manifest::classify_provenance` before calling
/// `apply_claude_settings_grant`, AND by
/// `uninstall.rs`'s `delete_eligible_files`, which special-cases this
/// one manifest path to NEVER delete it regardless of `Provenance` --
/// see the comment there for why this file's merge-into-a-shared-file
/// write model breaks the whole-file-ownership assumption every other
/// `Provenance::Created`/`ReplacedOurs` path in this codebase relies on.
pub(crate) const CLAUDE_SETTINGS_RELATIVE_PATH: &str = ".claude/settings.json";

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
/// not) -- never follows it. Called by `merge_claude_settings_permissions`
/// twice for each of `.claude`/`settings.json`: once up front (rejecting
/// the common case cheaply, before any parsing work), and again
/// immediately before each disk-mutating call that path feeds into
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

/// Ensures `<target_dir>/.claude/settings.json` grants every string in
/// `grants` under its `permissions.allow` array: creates the file (and
/// its `permissions`/`allow` scaffolding) fresh when it does not exist,
/// or merges into the existing content otherwise. Appends only entries
/// not already present -- idempotent across reinstall, the same
/// append-only philosophy `push_unique_str` gives the V2 side above.
///
/// Errors rather than silently overwriting or writing an ineffective
/// grant when:
/// - either `.claude` or `settings.json` is a symlink (see
///   `reject_symlink`'s own doc comment for why);
/// - the existing content at any step of the path -- `settings.json`
///   itself, its `permissions` key, its `permissions.deny` key, or its
///   `permissions.allow` key -- is not the JSON shape this expects;
/// - an existing `permissions.deny` entry already shadows one of
///   `grants` (see `deny_entry_shadows_grant`).
///
/// Never disturbs any other top-level key, any other key under
/// `permissions`, or any pre-existing `allow`/`deny` entry (verified
/// directly: see `claude_settings_grant_merges_preserving_unrelated_entries`
/// below, seeded with both a sibling top-level key and a sibling
/// `permissions.allow` entry).
///
/// Distinguishes why `merge_claude_settings_permissions`/
/// `apply_claude_settings_grant` failed, so the caller can decide how
/// to report it by matching on the variant rather than pattern-matching
/// rendered error text (rendered text is not a reliable discriminator:
/// more than one failure mode here can share overlapping substrings).
/// `DenyShadowed` means the grant was correctly, deliberately not
/// applied because the target owner already denies it; every other
/// failure -- symlink, malformed JSON at any step, an I/O error -- is
/// `Other`. `Deref<Target = str>` (to the same message either variant
/// carries) keeps `err.contains(...)` call sites working unchanged;
/// callers that need to distinguish the two cases match on the variant
/// instead, as `kiro_cli.rs`'s non-fatal-warning branch does.
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

/// Returns, on success, the exact bytes now on disk at `settings_path`
/// -- freshly written ones when a grant was actually added, or the
/// file's own pre-existing bytes unchanged when every grant was
/// already present and the write was skipped (see the `any_added`
/// check below) -- so `apply_claude_settings_grant` can hash them
/// directly instead of reading `settings_path` back a second time.
/// That second, independent read (this function's own write, when it
/// happens, is already durable and correct via `write_atomic` by the
/// time this returns) could fail on its own for reasons unrelated to
/// whether the grant itself succeeded, which would otherwise make the
/// caller misreport a successful merge as a failed one.
///
/// Errors as `ClaudeGrantError::DenyShadowed` specifically for the
/// `permissions.deny`-shadow case (see `deny_entry_shadows_grant`) --
/// every other failure below is `ClaudeGrantError::Other`. Returning a
/// typed variant, rather than a shared `String` the caller would have
/// to distinguish by sniffing rendered text for a substring, is
/// deliberate: the "not a JSON array" error just below also contains
/// the literal substring `"permissions.deny"`, so a substring-based
/// check could not reliably tell that malformed-file case apart from a
/// genuine deny-shadow.
fn merge_claude_settings_permissions(
    target_dir: &Path,
    grants: &[String],
) -> Result<Vec<u8>, ClaudeGrantError> {
    let settings_relative = Path::new(CLAUDE_SETTINGS_RELATIVE_PATH);
    let claude_dir_relative = settings_relative
        .parent()
        .expect("CLAUDE_SETTINGS_RELATIVE_PATH always has a parent (\".claude\")");
    let claude_dir = target_dir.join(claude_dir_relative);
    reject_symlink(&claude_dir, "directory")?;

    let settings_path = target_dir.join(settings_relative);
    reject_symlink(&settings_path, "file")?;

    // Serializes this function's ENTIRE read-modify-write cycle against
    // any other caller mutating the SAME `settings.json` -- either
    // `merge_claude_settings_hooks` (held under the identical lock
    // file -- see that function's own doc comment) racing this one
    // within the same or a different process, or this same function
    // racing itself across two concurrent `konductor install` runs
    // against the same target. Without this, two concurrent merges
    // each read the same pre-update snapshot, each compute a rewrite
    // reflecting only their own change, and whichever atomic-rename
    // lands last silently discards the other's -- the exact
    // lost-update race `config_lock.rs`'s own locking exists to
    // prevent for `config set` against `.konductor/config.yml`,
    // reproduced here for this file. Held for the rest of this function's
    // scope (dropped automatically at return). Reuses `config_lock`'s
    // exact advisory-lock-around-the-critical-section primitive
    // (bounded retry, explicit permissions) rather than a second,
    // independent locking mechanism -- see that module's own
    // `acquire_named` doc comment.
    let _lock_guard = crate::cli::config_lock::acquire_named(&claude_dir, ".settings.lock")
        .map_err(|source| format!("failed to lock {}: {source}", claude_dir.display()))?;

    // Captured up front, before any mutation, for two reasons this
    // function needs later: (1) `original_mode` lets a pre-existing
    // file's permissions survive `write_atomic`'s fixed `0o644` below
    // -- right for a file Konductor generates itself, but this one is
    // the user's and may deliberately be narrower (e.g. `0600`,
    // since a Claude settings file can carry an `env` block or an
    // `apiKeyHelper` path); (2) `original_text` is returned verbatim
    // when the merge below finds every grant already present, so an
    // idempotent reinstall doesn't reformat the user's file or bump
    // its mtime for a run that changed nothing.
    let original_mode: Option<u32> = if settings_path.is_file() {
        Some(
            std::fs::metadata(&settings_path)
                .map_err(|e| format!("failed to stat {}: {e}", settings_path.display()))?
                .permissions()
                .mode(),
        )
    } else {
        None
    };
    let original_text: Option<String> = if settings_path.is_file() {
        Some(
            std::fs::read_to_string(&settings_path)
                .map_err(|e| format!("failed to read {}: {e}", settings_path.display()))?,
        )
    } else {
        None
    };

    let mut root: serde_json::Value = match &original_text {
        Some(text) => serde_json::from_str(text).map_err(|e| {
            format!(
                "failed to parse {} as JSON: {e} -- fix or remove the file before installing",
                settings_path.display()
            )
        })?,
        None => serde_json::Value::Object(serde_json::Map::new()),
    };

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

    let mut bytes = serde_json::to_vec_pretty(&root)
        .map_err(|e| format!("failed to serialize {}: {e}", settings_path.display()))?;
    bytes.push(b'\n');

    // Re-check immediately before the disk-mutating calls below --
    // narrows, per `reject_symlink`'s own doc comment, the window since
    // the earlier up-front check at the top of this function.
    reject_symlink(&claude_dir, "directory")?;
    reject_symlink(&settings_path, "file")?;
    std::fs::create_dir_all(&claude_dir)
        .map_err(|e| format!("failed to create {}: {e}", claude_dir.display()))?;

    // Writes directly at the file's own intended final mode: the
    // pre-existing mode when there was one (this file is the user's,
    // and may deliberately be narrower than `0o644`, e.g. `0600`, since
    // it can carry an `env` block or an `apiKeyHelper` path -- see the
    // `original_mode` capture above), or `write_atomic`'s own default
    // for a freshly-created file. `write_atomic_with_mode` chmods the
    // temp file to this mode BEFORE the rename, and `fs::rename`
    // preserves that mode across the rename (see `atomic_write.rs`'s
    // own "Explicit file permissions" module note), so `settings_path`
    // is never visible, before or after, at any mode other than the one
    // it is meant to end at. No separate post-rename chmod is needed:
    // there is no window where a narrower file sits world-readable at
    // `0o644`, and no possibility of that chmod call failing and
    // leaving it there.
    match original_mode {
        Some(mode) => {
            crate::cli::atomic_write::write_atomic_with_mode(&settings_path, &bytes, mode)
        }
        None => crate::cli::atomic_write::write_atomic(&settings_path, &bytes),
    }
    .map_err(|e| format!("failed to write {}: {e}", settings_path.display()))?;

    Ok(bytes)
}

/// Performs the Claude/V3 settings grant for a whole install run and
/// returns the resulting file's manifest-relative path and content
/// hash, so the caller (`kiro_cli.rs`'s `install_from_local`) can add a
/// real `ManifestFile` entry for it. Call this exactly once per install
/// run (never per-agent, unlike the V2 grant, which is naturally
/// per-agent because each agent owns its own JSON file) -- see this
/// module's "V3/Claude Code permission grant" section above for why a
/// single shared file makes per-agent writes both wasteful and racier
/// than necessary.
///
/// Does not decide whether to call itself: the caller checks both
/// "did the V2 side inject anything into at least one agent this run"
/// and "is this target's `.claude` a detected Claude Code target"
/// (`runtime::detect_runtimes`) before calling, and separately snapshots
/// the settings file's pre-write state for provenance classification
/// (`manifest::classify_provenance`) -- both of which must happen
/// before this function runs, not after, since this function's own job
/// is exactly the write those decisions gate.
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
// Wires `konductor __telemetry-hook <event-type>` into
// `<target_dir>/.claude/settings.json`'s `"hooks"` key so the runtime
// itself invokes the hidden `__telemetry-hook` subcommand at
// `SessionStart` (agent invocation) and `SubagentStart` (sub-agent
// delegation) -- `SessionStart`/`SubagentStart` fire at the START of an
// agent/sub-agent invocation, distinct from `SubagentStop` (a DIFFERENT,
// already-published workflow-level hook that fires at delegation END,
// not START -- both are real, distinct hooks legitimately in play in
// the same file for two different purposes).
//
// Scope boundary (disclosed, not silent), reachable path: this pass is
// wired ONLY into `KiroCliInstallStrategy`'s own `AgentInstallPhase`
// (`phases.rs`), immediately after `apply_claude_settings_grant`
// succeeds there -- the dual-marker install (a target where BOTH
// `.kiro` and `.claude` already exist, e.g. a reinstall/update; per
// that phase's own tests, "not hypothetical, this package's own
// workspace is set up exactly this way"). Two narrowings follow from
// reusing that exact call site rather than adding a new one:
// - Gated the same way the grant is: `any_mcp_server_injected &&
//   detect_runtimes(target_dir).has(Runtime::ClaudeCode)`, AND fires
//   only when the grant call immediately before it succeeded (not
//   independently) -- so a foreign, deny-shadowed, or malformed
//   pre-existing `settings.json` that skips the grant also skips
//   hooks wiring for that same run, leaving the foreign file
//   completely untouched (verified by
//   `install_from_local_does_not_abort_when_claude_grant_fails_on_foreign_content`
//   in `kiro_cli.rs`) rather than partially mutating it via a second,
//   independent write.
// - `ClaudeInstallStrategy` (`claude.rs`) -- the OTHER real install
//   path, reachable for a `.claude`-only target with no pre-existing
//   `.kiro` -- does NOT get this pass in this revision. Wiring it
//   there needs its own write-ahead-plan entry, and `claude.rs`'s
//   `plan_all_files` is also the exact function `would_fail_as_noop`
//   uses to decide "nothing to install" -- an unconditional new planned
//   entry there would make that check permanently non-empty, breaking
//   its own "no synthed agent or skill files" error path. A real fix
//   needs a plan function scoped to `install_from_local`'s own
//   write-ahead call, separate from the no-op pre-check's, which is a
//   real follow-up left out of this revision rather than risking that
//   existing, separately-tested contract.
// Widening either boundary is real follow-up work, not implemented
// here.
//
// Kiro CLI: no equivalent hook-registration point exists in this
// codebase today for the V2 (JSON agent-spec) surface. `hooks.stop`/
// `hooks.agentSpawn` are AIM-owned frontmatter fields on the SOURCE
// agent spec, rewritten at SYNTH time (before `konductor install` ever
// runs) -- not something `konductor install`'s own resource-rewrite
// passes inject the way this pass injects into Claude's shared,
// install-time-mutated `settings.json`. Wiring Kiro CLI hooks would
// mean adding a NEW resource-rewrite pass that mutates
// `hooks.agentSpawn`/`hooks.stop` on every installed Kiro agent JSON --
// a real, larger change with its own open design questions (whether
// `agentSpawn` re-fires on `invokeSubAgent` is not confirmed, and
// whether a per-agent single-entry or append semantics is right).
// Kiro CLI hook wiring is explicitly OUT OF SCOPE for this revision.

/// One konductor-owned hook entry this pass ensures exists under
/// `.claude/settings.json`'s `"hooks"` key -- one per event type that has
/// a real Claude Code hook to fire from. `event_type_arg` is the
/// `__telemetry-hook <event_type>` argument this entry's command
/// invokes -- imported directly from `telemetry_hook.rs`'s own
/// `AGENT_INVOCATION`/`SUBAGENT_INVOCATION` constants (never a
/// hand-duplicated literal), so a rename on either side is a compile
/// error here, not a silent runtime mismatch between what this pass
/// wires in and what `dispatch_telemetry_hook`'s match actually
/// recognizes. The full command string (with the resolved absolute
/// binary path prepended -- see `resolve_konductor_exe_path`) is built
/// at `merge_claude_settings_hooks` call time, not stored here: it
/// depends on `std::env::current_exe()`, which is not available in a
/// `const` context. The resulting full command is this entry's own
/// identity for idempotency purposes (see `find_hook_match`): a
/// reinstall must never add a second block for the same command under
/// the same event, and a relocated binary must self-heal the existing
/// block's command rather than appending a duplicate one.
struct TelemetryHookEntry {
    event: &'static str,
    matcher: &'static str,
    event_type_arg: &'static str,
}

const TELEMETRY_HOOK_ENTRIES: &[TelemetryHookEntry] = &[
    TelemetryHookEntry {
        event: "SessionStart",
        // A genuine session start or a `/clear` both count as a fresh
        // `agent_invocation`.
        matcher: "startup|clear",
        event_type_arg: crate::cli::telemetry_hook::AGENT_INVOCATION,
    },
    TelemetryHookEntry {
        event: "SubagentStart",
        // Unlike `metrics-collection-design.md`'s own per-specialist
        // `SubagentStart` matchers (one per named agent, since that
        // pipeline attributes BY specialist), this design's
        // `subagent_invocation` event already carries the specialist
        // name in its own payload (`agent_type`/`agent_name`, see
        // `telemetry_hook.rs`) -- so one match-everything matcher
        // suffices; there is no need for a name-specific entry per
        // agent.
        matcher: ".*",
        event_type_arg: crate::cli::telemetry_hook::SUBAGENT_INVOCATION,
    },
];

/// Resolves the absolute path to the currently-running `konductor`
/// binary via `std::env::current_exe()`, so the hook command this pass
/// wires into `.claude/settings.json` invokes THIS install's own
/// binary directly rather than a bare `"konductor"` that depends on
/// `$PATH` still resolving to the right binary whenever the hook later
/// fires (a different shell, a different user, a CI container with no
/// `$PATH` entry at all) -- mirrors `McpServerPass::rewrite`'s own
/// absolute-path pattern for the MCP server binary a few lines below in
/// this same file. Falls back to the bare `"konductor"` command (the
/// prior, `$PATH`-dependent behavior) if resolution fails for any
/// reason -- never fails the whole install over a diagnostics-only path
/// display concern, matching `kiro_cli.rs`'s own `install_from_local`
/// canonicalize fallback for its manifest `source` field.
fn resolve_konductor_exe_path() -> String {
    std::env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "konductor".to_string())
}

/// Whether `exe` looks like a genuinely resolved absolute executable
/// path, as opposed to `resolve_konductor_exe_path`'s own bare-word
/// `"konductor"` fallback (returned when `std::env::current_exe()`
/// fails). Gates self-healing a stale hook command below: a run whose OWN `current_exe()` call fails
/// transiently must not treat that failure as authoritative and
/// downgrade an already-wired absolute path down to the bare,
/// `$PATH`-dependent fallback -- the exact regression the self-healing
/// logic below exists to prevent, in reverse. A
/// non-absolute string is never a genuine `current_exe()` result on
/// any platform this fallback runs on, so this check is exact, not a
/// heuristic.
fn is_resolved_absolute_exe_path(exe: &str) -> bool {
    Path::new(exe).is_absolute()
}

/// Shell-quotes `exe` for safe embedding in a hook `command` string
/// that Claude Code executes as a shell command. `exe` comes from `resolve_konductor_exe_path()` ->
/// `std::env::current_exe()`, which can legitimately be an absolute
/// path containing a space or another shell metacharacter (e.g. an
/// install under `Application Support` on macOS or `Program Files` on
/// Windows) -- embedded unquoted, the shell that runs the hook
/// mis-splits/mis-parses such a path and the hook silently breaks at
/// fire time. Unlike `McpServerPass::rewrite`'s structured
/// `{"command": <path>, "args": [...]}` shape (no shell involved, so no
/// quoting hazard exists there), this pass builds a single command
/// STRING Claude Code hands to a shell, so this quoting step is load-
/// bearing.
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
fn shell_quote_for_hook_command(exe: &str) -> String {
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

/// Extracts the STABLE part of a telemetry hook command -- the
/// `__telemetry-hook <event-type>` subcommand invocation -- stripping
/// the leading, environment-dependent absolute binary path
/// (`resolve_konductor_exe_path()`'s own result, or its bare-word
/// `"konductor"` fallback) that precedes it. Two commands that differ
/// ONLY in that leading path (a relocated/reinstalled binary, or a
/// first-install fallback-to-bare-`"konductor"` followed by a later run
/// that resolves the real absolute path) must be treated as identifying
/// the SAME hook, not two different ones -- this extraction is what makes that comparison
/// possible. Returns `None` if `command` doesn't contain the marker at
/// all (not a telemetry-hook command shape this pass recognizes).
fn stable_hook_command_suffix(command: &str) -> Option<&str> {
    const MARKER: &str = "__telemetry-hook ";
    let idx = command.find(MARKER)?;
    Some(&command[idx..])
}

/// The result of searching an existing `"hooks".<event>"` array for a
/// block matching `matcher`, used by `merge_claude_settings_hooks` to
/// decide whether to skip, self-heal, or append fresh.
enum HookArrayMatch {
    /// No block with a matching `matcher` AND matching stable command
    /// suffix exists -- a fresh block must be appended.
    Absent,
    /// A block already carries the EXACT command already wired --
    /// nothing to do.
    UpToDate,
    /// A block's matcher and stable command suffix match, but its full
    /// command differs (a stale absolute exe path from a relocated or
    /// previously-unresolved binary) -- the entry at
    /// `array[block_index]["hooks"][hook_index]["command"]` must be
    /// REWRITTEN in place to the current command, self-healing the
    /// stale path rather than appending a duplicate block.
    Stale {
        block_index: usize,
        hook_index: usize,
    },
}

/// Searches `array` (an existing `"hooks".<event>" array) for a block
/// whose OWN `"matcher"` equals `matcher` and whose inner `"hooks"`
/// array carries an entry identifying the SAME hook as `command` --
/// the identity check `merge_claude_settings_hooks` uses to decide
/// "already wired exactly", "wired but stale (self-heal)", or "needs a
/// new block". Matches `merge_claude_settings_permissions`'s own
/// by-value idempotency check one level up in spirit (that case
/// matches allow-array values directly; this one matches a
/// `(matcher, command)` pair nested across two levels, since a hooks
/// entry is itself an array of blocks each carrying its OWN `matcher`
/// and its OWN nested `"hooks"` array).
///
/// Checks `matcher` exactly, not just the command's stable suffix: a
/// block whose command's stable suffix matches but whose `matcher` has
/// drifted (e.g. hand-edited, or wired by an older binary version with
/// a different matcher for the same event type) is treated as a
/// DIFFERENT block entirely (`Absent` for THIS `matcher`), so the
/// correct `(matcher, command)` pair gets appended fresh rather than
/// the drift being silently accepted as "already wired" -- this never
/// removes or rewrites a drifted-matcher block in place (consistent
/// with this function's own caller never disturbing pre-existing
/// content it doesn't own).
fn find_hook_match(array: &[serde_json::Value], matcher: &str, command: &str) -> HookArrayMatch {
    let wanted_suffix = stable_hook_command_suffix(command);
    // Scans the ENTIRE array for an exact match before committing to a
    // `Stale` self-heal candidate: an exact `UpToDate` match can appear
    // anywhere in the array, not necessarily before a stale-suffix
    // entry, and returning on the first stale-suffix hit would rewrite
    // that stale entry in place while leaving an already-current block
    // elsewhere untouched -- producing two blocks with the identical
    // command under the same event (a duplicate hook that double-counts
    // telemetry every session). The first stale candidate found is
    // remembered and returned only if no exact match turns up anywhere.
    let mut stale_candidate: Option<HookArrayMatch> = None;
    for (block_index, block) in array.iter().enumerate() {
        if block.get("matcher").and_then(|m| m.as_str()) != Some(matcher) {
            continue;
        }
        let Some(inner) = block.get("hooks").and_then(|h| h.as_array()) else {
            continue;
        };
        for (hook_index, entry) in inner.iter().enumerate() {
            let Some(existing_command) = entry.get("command").and_then(|c| c.as_str()) else {
                continue;
            };
            if existing_command == command {
                return HookArrayMatch::UpToDate;
            }
            if stale_candidate.is_none()
                && wanted_suffix.is_some()
                && stable_hook_command_suffix(existing_command) == wanted_suffix
            {
                stale_candidate = Some(HookArrayMatch::Stale {
                    block_index,
                    hook_index,
                });
            }
        }
    }
    stale_candidate.unwrap_or(HookArrayMatch::Absent)
}

/// Ensures `<target_dir>/.claude/settings.json` carries a hook block
/// for every entry in `entries` under its `"hooks"` key -- creates the
/// file (and its `hooks`/per-event scaffolding) fresh when it does not
/// exist, or merges into the existing content otherwise. Mirrors
/// `merge_claude_settings_permissions`'s own symlink-safety, mode-
/// preservation, and skip-write-when-unchanged behavior exactly (see
/// that function's own doc comment) -- the two differ only in WHICH
/// top-level key they mutate (`"hooks"` here, `"permissions"` there)
/// and in what "already present" means (a command string nested two
/// levels deep here, an allow-array value there).
///
/// Errors (as `ClaudeGrantError::Other` -- there is no hooks analog of
/// the permissions side's `DenyShadowed`, since Claude Code has no
/// "deny a hook" concept) when:
/// - either `.claude` or `settings.json` is a symlink;
/// - the existing content at any step of the path -- `settings.json`
///   itself, its `"hooks"` key, or `"hooks".<event>` -- is not the JSON
///   shape this expects.
///
/// Never disturbs any other top-level key, any other event under
/// `"hooks"`, or any pre-existing block under an event this pass also
/// writes to (e.g. the already-published `SubagentStop` hook the base
/// workflow-level metrics pipeline may have written into the SAME
/// file) -- appends only its own, missing blocks.
fn merge_claude_settings_hooks(
    target_dir: &Path,
    entries: &[TelemetryHookEntry],
) -> Result<Vec<u8>, ClaudeGrantError> {
    merge_claude_settings_hooks_with_exe(target_dir, entries, &resolve_konductor_exe_path())
}

/// Same as `merge_claude_settings_hooks`, but takes the resolved
/// `konductor` exe path as a parameter rather than resolving it
/// internally. This is what lets a test exercise the self-heal-vs-
/// leave-alone decision (`is_resolved_absolute_exe_path`) deterministically end to end -- by passing
/// `resolve_konductor_exe_path`'s own bare-word fallback directly --
/// without needing to force a real `std::env::current_exe()` failure,
/// which isn't reproducible from within a test process.
fn merge_claude_settings_hooks_with_exe(
    target_dir: &Path,
    entries: &[TelemetryHookEntry],
    exe: &str,
) -> Result<Vec<u8>, ClaudeGrantError> {
    let settings_relative = Path::new(CLAUDE_SETTINGS_RELATIVE_PATH);
    let claude_dir_relative = settings_relative
        .parent()
        .expect("CLAUDE_SETTINGS_RELATIVE_PATH always has a parent (\".claude\")");
    let claude_dir = target_dir.join(claude_dir_relative);
    reject_symlink(&claude_dir, "directory")?;

    let settings_path = target_dir.join(settings_relative);
    reject_symlink(&settings_path, "file")?;

    // Serializes this function's ENTIRE read-modify-write cycle against
    // any other caller mutating the SAME `settings.json` -- either
    // `merge_claude_settings_permissions` (held under the identical
    // lock file, see that function's own doc comment) racing this one
    // within the same or a different process, or this same function
    // racing itself across two concurrent `konductor install` runs
    // against the same target. Held for the rest of this function's
    // scope (dropped automatically at return). Reuses
    // `config_lock`'s exact advisory-lock-around-the-critical-section
    // primitive (bounded retry, explicit permissions) rather than a
    // second, independent locking mechanism -- see that module's own
    // `acquire_named` doc comment.
    let _lock_guard = crate::cli::config_lock::acquire_named(&claude_dir, ".settings.lock")
        .map_err(|source| format!("failed to lock {}: {source}", claude_dir.display()))?;

    let original_mode: Option<u32> = if settings_path.is_file() {
        Some(
            std::fs::metadata(&settings_path)
                .map_err(|e| format!("failed to stat {}: {e}", settings_path.display()))?
                .permissions()
                .mode(),
        )
    } else {
        None
    };
    let original_text: Option<String> = if settings_path.is_file() {
        Some(
            std::fs::read_to_string(&settings_path)
                .map_err(|e| format!("failed to read {}: {e}", settings_path.display()))?,
        )
    } else {
        None
    };

    let mut root: serde_json::Value = match &original_text {
        Some(text) => serde_json::from_str(text).map_err(|e| {
            format!(
                "failed to parse {} as JSON: {e} -- fix or remove the file before installing",
                settings_path.display()
            )
        })?,
        None => serde_json::Value::Object(serde_json::Map::new()),
    };

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

    // The caller's own resolved exe path (or its bare-word fallback --
    // see `merge_claude_settings_hooks_with_exe`'s own doc comment),
    // used for every entry's command below: every entry invokes the
    // SAME binary, just with a different `__telemetry-hook` argument.
    let exe_is_absolute = is_resolved_absolute_exe_path(exe);
    // Shell-quoted separately from the absoluteness check above, which
    // must see the raw, unquoted path: see `shell_quote_for_hook_command`'s own doc comment for why an
    // unquoted path containing a space or shell metacharacter breaks
    // this hook at fire time.
    let quoted_exe = shell_quote_for_hook_command(exe);

    let mut any_changed = false;
    for entry in entries {
        let command = format!("{quoted_exe} __telemetry-hook {}", entry.event_type_arg);
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
        match find_hook_match(event_array, entry.matcher, &command) {
            HookArrayMatch::UpToDate => {}
            HookArrayMatch::Stale {
                block_index,
                hook_index,
            } => {
                // Self-heal: rewrite the
                // existing entry's command in place to the current
                // resolved path instead of appending a duplicate block
                // -- a relocated/reinstalled binary must not accumulate
                // a second SessionStart/SubagentStart hook (which would
                // double-count telemetry events on every session).
                //
                // ONLY when the newly-resolved `exe` is a genuine
                // absolute path: a
                // TRANSIENT `current_exe()` failure THIS run resolves
                // to the bare, `$PATH`-dependent fallback word, and
                // treating that as authoritative would downgrade an
                // already-correct absolute-path command down to it --
                // the exact regression the self-heal above exists to
                // prevent, in reverse. Leave the existing (better,
                // already-absolute) entry untouched in that case
                // rather than either healing it downward or, worse,
                // falling through to `Absent` and appending a
                // duplicate block.
                if exe_is_absolute {
                    event_array[block_index]["hooks"][hook_index]["command"] =
                        serde_json::Value::String(command);
                    any_changed = true;
                }
            }
            HookArrayMatch::Absent => {
                event_array.push(serde_json::json!({
                    "matcher": entry.matcher,
                    "hooks": [{"type": "command", "command": command}]
                }));
                any_changed = true;
            }
        }
    }

    if !any_changed {
        // Same rationale as `merge_claude_settings_permissions`'s own
        // early return: every entry this pass wants is already present
        // with its current command, so skip the write entirely rather
        // than reformatting the user's file / bumping its mtime on a
        // reinstall that changed nothing.
        let unchanged = original_text
            .expect(
                "any_changed is false only when settings_path pre-existed: either every hook \
                 entry was already present and up to date, or the only outstanding change was \
                 a Stale match this run's non-absolute exe path declined to self-heal into -- \
                 both cases require an existing block, which requires the file to have \
                 pre-existed",
            )
            .into_bytes();
        return Ok(unchanged);
    }

    let mut bytes = serde_json::to_vec_pretty(&root)
        .map_err(|e| format!("failed to serialize {}: {e}", settings_path.display()))?;
    bytes.push(b'\n');

    // Re-check immediately before the disk-mutating calls below, same
    // TOCTOU-narrowing rationale as `merge_claude_settings_permissions`.
    reject_symlink(&claude_dir, "directory")?;
    reject_symlink(&settings_path, "file")?;
    std::fs::create_dir_all(&claude_dir)
        .map_err(|e| format!("failed to create {}: {e}", claude_dir.display()))?;

    // Same rationale as `merge_claude_settings_permissions`'s own
    // identical write, one function up: write directly at the file's
    // intended final mode (the pre-existing mode when there was one,
    // else `write_atomic`'s default for a freshly-created file) so
    // `settings_path` is never visible at any mode other than the one
    // it is meant to end at, with no separate post-rename chmod step
    // and so no `set_permissions` call here that could fail.
    match original_mode {
        Some(mode) => {
            crate::cli::atomic_write::write_atomic_with_mode(&settings_path, &bytes, mode)
        }
        None => crate::cli::atomic_write::write_atomic(&settings_path, &bytes),
    }
    .map_err(|e| format!("failed to write {}: {e}", settings_path.display()))?;

    Ok(bytes)
}

/// Performs the telemetry-hook wiring for a whole install run and
/// returns the resulting file's manifest-relative path and content
/// hash -- same call contract as `apply_claude_settings_grant` (see
/// that function's own doc comment). Called from the SAME gated call
/// site immediately after that function, so both mutations to the
/// shared `settings.json` land under one `ManifestFile` entry rather
/// than two (see `phases.rs`'s `AgentInstallPhase::run`).
pub(super) fn apply_claude_settings_hooks(
    target_dir: &Path,
) -> Result<(String, String), ClaudeGrantError> {
    let bytes = merge_claude_settings_hooks(target_dir, TELEMETRY_HOOK_ENTRIES)?;
    Ok((
        CLAUDE_SETTINGS_RELATIVE_PATH.to_string(),
        super::super::artifact::sha256_hex(&bytes),
    ))
}

/// Performs the additive, `.claude`-marker-gated Claude/V3 settings.json
/// grant (`apply_claude_settings_grant`) plus, unless `no_telemetry`,
/// the telemetry-hook wiring (`apply_claude_settings_hooks`), for a
/// whole install run, folding both into at most one `ManifestFile` --
/// both calls target the exact same manifest path
/// (`.claude/settings.json`), so exactly one entry is ever produced for
/// it, never two. Returns `None` when the grant itself is skipped (see
/// the `ClaudeGrantError` arms below), matching the call sites' own
/// prior behavior of pushing no `ManifestFile` in that case.
///
/// Shared by `AgentInstallPhase::run` (`phases.rs`,
/// `KiroCliInstallStrategy`) and `KiroCliV3InstallStrategy::
/// install_from_local` (`kiro_cli_v3.rs`), so this exact match-arm/
/// warning-string logic exists in exactly one place rather than two
/// near-verbatim copies kept in lockstep by hand. Both callers already
/// gate the call the same way (`any_mcp_server_injected &&
/// detect_runtimes(target_dir).has(Runtime::ClaudeCode)`) before
/// invoking this.
///
/// Deliberately non-fatal on every `ClaudeGrantError` branch -- see
/// `apply_claude_settings_grant`'s own doc comment for why aborting an
/// already-succeeded Kiro install over a problem in unrelated,
/// pre-existing Claude-side content would be the worse outcome.
///
/// `strategy_label` affects only the wording of the printed warnings
/// (e.g. `"Kiro CLI"` vs `"Kiro CLI V3"`, matching each caller's own
/// prior wording exactly) -- it has no effect on behavior.
pub(in crate::cli::install) fn apply_claude_settings_grant_and_hooks(
    target_dir: &Path,
    no_telemetry: bool,
    strategy_label: &str,
) -> Option<ManifestFile> {
    let mut claude_settings: Option<(String, String)> = None;

    match apply_claude_settings_grant(target_dir) {
        Ok((claude_path, claude_sha256)) => {
            claude_settings = Some((claude_path, claude_sha256));

            if !no_telemetry {
                match apply_claude_settings_hooks(target_dir) {
                    Ok((hooks_path, hooks_sha256)) => {
                        claude_settings = Some((hooks_path, hooks_sha256));
                    }
                    Err(ClaudeGrantError::DenyShadowed(message)) => {
                        eprintln!(
                            "warning: Claude Code telemetry hook wiring intentionally \
                             skipped ({message})"
                        );
                    }
                    Err(ClaudeGrantError::Other(message)) => {
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

    claude_settings.map(|(path, sha256)| ManifestFile {
        path,
        sha256: Some(sha256),
        provenance: Provenance::Created,
    })
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
    // (called once per install run via `apply_claude_settings_grant`,
    // never through the `ResourceRewritePass` pipeline above -- see
    // this module's own "V3/Claude Code permission grant" section for
    // why. These tests exercise `merge_claude_settings_permissions` and
    // `apply_claude_settings_grant` directly against a plain
    // `target_dir`, with no `RewriteContext` involved at all.)

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
        // Unlike the reachable-in-practice case (where `.claude`
        // already exists -- see kiro_cli.rs's reachability tests),
        // this function itself has no opinion on whether `.claude`
        // pre-exists; it must create it if asked to.
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

    // ── V3/Claude Code telemetry hook wiring ────────────────────────────
    // (exercises `merge_claude_settings_hooks`/`apply_claude_settings_hooks`
    // directly against a plain `target_dir`, same style as the settings-
    // grant tests above -- see this module's own "V3/Claude Code
    // telemetry hook wiring" section for the design this implements.)

    #[test]
    fn claude_settings_hooks_creates_fresh_file() {
        let dir = scratch_dir("claude-hooks-fresh");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let (path, sha256) =
            apply_claude_settings_hooks(&dir).expect("hook wiring must succeed on a fresh target");
        assert_eq!(path, ".claude/settings.json");
        assert_eq!(sha256.len(), 64, "sha256 hex digest must be 64 chars");

        let written = fs::read_to_string(dir.join(".claude/settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        // The wired command embeds the resolved absolute path to the
        // currently-running binary (fix for the bare "konductor"
        // finding), not the literal word "konductor" -- computed the
        // same way `resolve_konductor_exe_path` itself computes it, so
        // this test tracks whatever binary is actually running it.
        let exe = resolve_konductor_exe_path();
        // Built through the same helper production uses (see the
        // `merge_claude_settings_hooks_with_exe` call site), so this
        // assertion tracks production's shell-quoting instead of
        // assuming the resolved exe path never needs it.
        let quoted_exe = shell_quote_for_hook_command(&exe);
        assert_eq!(
            parsed["hooks"]["SessionStart"],
            serde_json::json!([{
                "matcher": "startup|clear",
                "hooks": [{"type": "command", "command": format!("{quoted_exe} __telemetry-hook agent-invocation")}]
            }])
        );
        assert_eq!(
            parsed["hooks"]["SubagentStart"],
            serde_json::json!([{
                "matcher": ".*",
                "hooks": [{"type": "command", "command": format!("{quoted_exe} __telemetry-hook subagent-invocation")}]
            }])
        );
        assert!(
            Path::new(&exe).is_absolute(),
            "the wired hook command must carry an absolute path, not a bare binary name \
             that depends on $PATH at hook-fire time: {exe:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn claude_settings_hooks_preserves_narrow_mode_on_preexisting_file() {
        let dir = scratch_dir("claude-hooks-narrow-mode");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");
        fs::write(&settings_path, serde_json::json!({}).to_string()).unwrap();
        fs::set_permissions(&settings_path, fs::Permissions::from_mode(0o600)).unwrap();

        apply_claude_settings_hooks(&dir).expect("hook wiring must succeed on a narrow-mode file");

        let mode = fs::metadata(&settings_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "a pre-existing narrower mode must survive hook wiring unchanged, not be widened"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_merges_preserving_unrelated_entries() {
        let dir = scratch_dir("claude-hooks-merge");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        // Pre-existing settings.json carrying the base workflow-level
        // pipeline's own SubagentStop hook (a real, unrelated hook this
        // pass must never touch) plus an unrelated permissions key.
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "hooks": {"SubagentStop": [{"matcher": "*", "hooks": [{"type": "command", "command": "example-tool publish-metrics"}]}]},
                "permissions": {"allow": ["mcp__example-mcp__ExampleAction"]}
            }))
            .unwrap(),
        )
        .unwrap();

        apply_claude_settings_hooks(&dir)
            .expect("hook wiring must merge into existing settings.json");

        let written = fs::read_to_string(claude_dir.join("settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(
            parsed["hooks"]["SubagentStop"],
            serde_json::json!([{"matcher": "*", "hooks": [{"type": "command", "command": "example-tool publish-metrics"}]}]),
            "an unrelated hook event must survive the merge untouched"
        );
        assert_eq!(
            parsed["permissions"]["allow"],
            serde_json::json!(["mcp__example-mcp__ExampleAction"]),
            "an unrelated top-level key must survive the merge untouched"
        );
        assert!(
            parsed["hooks"]["SessionStart"].is_array(),
            "the new SessionStart block must be added alongside the pre-existing SubagentStop"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_is_idempotent_across_reinstall() {
        let dir = scratch_dir("claude-hooks-idempotent");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        apply_claude_settings_hooks(&dir).expect("first hook wiring must succeed");
        apply_claude_settings_hooks(&dir).expect("second hook wiring (reinstall) must succeed");
        let written = fs::read_to_string(dir.join(".claude/settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(
            parsed["hooks"]["SessionStart"].as_array().unwrap().len(),
            1,
            "reinstall must not append a duplicate SessionStart block"
        );
        assert_eq!(
            parsed["hooks"]["SubagentStart"].as_array().unwrap().len(),
            1,
            "reinstall must not append a duplicate SubagentStart block"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// `find_hook_match` must compare `matcher`, not
    /// just `command` -- a pre-existing block whose
    /// command matches but whose matcher has DRIFTED (hand-edited, or
    /// left over from an older binary version with a different
    /// matcher for the same event) must be treated as NOT already
    /// present, so a fresh, correctly-matchered block gets appended
    /// rather than the drift being silently accepted as "already
    /// wired". The drifted block itself is left untouched (this pass
    /// never rewrites content it doesn't own), so the array ends up
    /// with BOTH the drifted block and the freshly-added correct one.
    #[test]
    fn claude_settings_hooks_repairs_a_drifted_matcher_by_appending_a_fresh_block() {
        let dir = scratch_dir("claude-hooks-drifted-matcher");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");
        let exe = resolve_konductor_exe_path();
        // Same command as this run would compute, but a DIFFERENT
        // matcher than TELEMETRY_HOOK_ENTRIES' own "startup|clear" for
        // SessionStart -- simulates hand-edited or stale-binary drift.
        let seeded = serde_json::json!({
            "hooks": {
                "SessionStart": [{
                    "matcher": "startup",
                    "hooks": [{"type": "command", "command": format!("{exe} __telemetry-hook agent-invocation")}]
                }]
            }
        });
        fs::write(&settings_path, seeded.to_string()).unwrap();

        apply_claude_settings_hooks(&dir)
            .expect("hook wiring must succeed even with a drifted pre-existing matcher");

        let written = fs::read_to_string(&settings_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        let session_start = parsed["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(
            session_start.len(),
            2,
            "the drifted block must be left in place AND a fresh, correctly-matchered block \
             appended alongside it, got: {session_start:?}"
        );
        assert_eq!(
            session_start[0]["matcher"], "startup",
            "the original drifted block must survive untouched"
        );
        assert_eq!(
            session_start[1]["matcher"], "startup|clear",
            "the freshly-appended block must carry the correct matcher"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// A relocated/reinstalled binary
    /// (or a first install whose `current_exe()` resolution fell back
    /// to the bare `"konductor"` word, followed by a later run that
    /// resolves the real absolute path) must SELF-HEAL the existing
    /// hook block's command in place, never accumulate a second,
    /// duplicate block for the same matcher/event. Simulates a
    /// "relocated binary" by seeding a command with a stale, obviously
    /// different exe path than what `resolve_konductor_exe_path()`
    /// resolves to in THIS test process, then confirms exactly one
    /// block remains after `apply_claude_settings_hooks` runs, and that
    /// its command carries the NEW (current) path, not the old one.
    #[test]
    fn claude_settings_hooks_self_heals_a_relocated_binarys_stale_command() {
        let dir = scratch_dir("claude-hooks-relocated-binary-self-heals");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");

        let current_exe = resolve_konductor_exe_path();
        let stale_exe = "/old/relocated/path/to/konductor";
        assert_ne!(
            stale_exe, current_exe,
            "the stale path fixture must genuinely differ from this process's own resolved path"
        );
        let stale_agent_command = format!("{stale_exe} __telemetry-hook agent-invocation");
        let stale_subagent_command = format!("{stale_exe} __telemetry-hook subagent-invocation");
        let seeded = serde_json::json!({
            "hooks": {
                "SessionStart": [{
                    "matcher": "startup|clear",
                    "hooks": [{"type": "command", "command": stale_agent_command}]
                }],
                "SubagentStart": [{
                    "matcher": ".*",
                    "hooks": [{"type": "command", "command": stale_subagent_command}]
                }]
            }
        });
        fs::write(&settings_path, seeded.to_string()).unwrap();

        apply_claude_settings_hooks(&dir)
            .expect("hook wiring must succeed and self-heal a stale relocated-binary command");

        let written = fs::read_to_string(&settings_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();

        let session_start = parsed["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(
            session_start.len(),
            1,
            "a relocated binary must self-heal the existing block in place, not append a \
             second SessionStart block: {session_start:?}"
        );
        assert_eq!(
            session_start[0]["hooks"][0]["command"],
            format!("{current_exe} __telemetry-hook agent-invocation"),
            "the self-healed command must carry the CURRENT resolved exe path, not the stale one"
        );

        let subagent_start = parsed["hooks"]["SubagentStart"].as_array().unwrap();
        assert_eq!(
            subagent_start.len(),
            1,
            "a relocated binary must self-heal the existing block in place, not append a \
             second SubagentStart block: {subagent_start:?}"
        );
        assert_eq!(
            subagent_start[0]["hooks"][0]["command"],
            format!("{current_exe} __telemetry-hook subagent-invocation"),
            "the self-healed command must carry the CURRENT resolved exe path, not the stale one"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// `find_hook_match` must scan the WHOLE array for an exact command
    /// match before committing to a stale-suffix self-heal candidate.
    /// Seeds a block that already carries BOTH a stale-exe-path entry
    /// (matching suffix, wrong path) AND an already-current entry
    /// (exact match) for the same event/matcher, with the stale one
    /// FIRST in iteration order -- the ordering that would make an
    /// eager first-match search return `Stale` and rewrite the stale
    /// entry in place, leaving two identical commands behind. Asserts
    /// the array is untouched: no rewrite of the stale entry, and no
    /// duplicate appended.
    #[test]
    fn claude_settings_hooks_does_not_duplicate_when_an_up_to_date_entry_already_exists() {
        let dir = scratch_dir("claude-hooks-stale-before-up-to-date-no-duplicate");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");

        let current_exe = resolve_konductor_exe_path();
        let stale_exe = "/old/relocated/path/to/konductor";
        assert_ne!(
            stale_exe, current_exe,
            "the stale path fixture must genuinely differ from this process's own resolved path"
        );
        let stale_command = format!("{stale_exe} __telemetry-hook agent-invocation");
        let current_command = format!("{current_exe} __telemetry-hook agent-invocation");
        let seeded = serde_json::json!({
            "hooks": {
                "SessionStart": [{
                    "matcher": "startup|clear",
                    "hooks": [
                        {"type": "command", "command": stale_command},
                        {"type": "command", "command": current_command}
                    ]
                }]
            }
        });
        fs::write(&settings_path, seeded.to_string()).unwrap();

        apply_claude_settings_hooks(&dir)
            .expect("hook wiring must succeed when a stale entry precedes an already-current one");

        let written = fs::read_to_string(&settings_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        let session_start = parsed["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(
            session_start.len(),
            1,
            "no fresh block must be appended when an exact match already exists: {session_start:?}"
        );
        let inner = session_start[0]["hooks"].as_array().unwrap();
        assert_eq!(
            inner.len(),
            2,
            "the stale entry must be left untouched (not rewritten) and no third entry \
             appended, once an exact match exists elsewhere in the array: {inner:?}"
        );
        assert_eq!(
            inner[0]["command"], stale_command,
            "the stale entry must not be rewritten when an exact match exists elsewhere"
        );
        assert_eq!(
            inner[1]["command"], current_command,
            "the already-current entry must remain unchanged"
        );

        fs::remove_dir_all(&dir).ok();
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

    /// A TRANSIENT `current_exe()`
    /// failure THIS run (simulated here via
    /// `merge_claude_settings_hooks_with_exe`'s injectable `exe`
    /// parameter set to `resolve_konductor_exe_path`'s own bare-word
    /// fallback, since a real failure isn't reproducible from within a
    /// test process) must NOT downgrade an already-wired absolute-path
    /// hook command down to the bare, `$PATH`-dependent fallback --
    /// the exact regression the absolute-path self-heal fix (see
    /// `claude_settings_hooks_self_heals_a_relocated_binarys_stale_command`
    /// above) exists to prevent, in reverse.
    #[test]
    fn claude_settings_hooks_never_downgrades_an_absolute_path_to_the_bare_fallback() {
        let dir = scratch_dir("claude-hooks-never-downgrades-to-fallback");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");

        let good_absolute_exe = "/opt/konductor/bin/konductor";
        let seeded = serde_json::json!({
            "hooks": {
                "SessionStart": [{
                    "matcher": "startup|clear",
                    "hooks": [{
                        "type": "command",
                        "command": format!("{good_absolute_exe} __telemetry-hook agent-invocation")
                    }]
                }]
            }
        });
        fs::write(&settings_path, seeded.to_string()).unwrap();

        merge_claude_settings_hooks_with_exe(&dir, TELEMETRY_HOOK_ENTRIES, "konductor").expect(
            "hook wiring must succeed even when the resolved exe path falls back to the bare \
             word",
        );

        let written = fs::read_to_string(&settings_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        let session_start = parsed["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(
            session_start.len(),
            1,
            "must not append a duplicate block: {session_start:?}"
        );
        assert_eq!(
            session_start[0]["hooks"][0]["command"],
            format!("{good_absolute_exe} __telemetry-hook agent-invocation"),
            "the already-wired absolute path must survive UNCHANGED -- a transient \
             current_exe() failure must never downgrade it to the bare, $PATH-dependent \
             fallback"
        );

        fs::remove_dir_all(&dir).ok();
    }

    // ── shell_quote_for_hook_command ──

    #[test]
    fn shell_quote_for_hook_command_leaves_a_safe_path_unquoted() {
        // Every existing fixture path in this module's own hook tests
        // (e.g. "/opt/konductor/bin/konductor") is made entirely of
        // this safe character set, so this is what keeps those tests'
        // exact-match assertions byte-for-byte unchanged by this fix.
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

    /// End-to-end: a `current_exe()` resolution under a space-containing
    /// install path must produce a hook `command` string that survives
    /// shell parsing intact -- i.e. the wired command is the QUOTED
    /// path, not the raw one, and the self-heal/idempotency logic
    /// (which compares by the `__telemetry-hook <arg>` marker suffix,
    /// unaffected by quoting on the exe portion) still recognizes a
    /// second wiring pass against the same quoted command as
    /// already-up-to-date rather than appending a duplicate block.
    #[test]
    fn claude_settings_hooks_quotes_an_exe_path_containing_a_space() {
        let dir = scratch_dir("claude-hooks-space-in-exe-path");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        let space_exe = "/Users/dev/Application Support/konductor";

        merge_claude_settings_hooks_with_exe(&dir, TELEMETRY_HOOK_ENTRIES, space_exe)
            .expect("hook wiring must succeed for an exe path containing a space");

        let written = fs::read_to_string(dir.join(".claude/settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        let expected_quoted = shell_quote_for_hook_command(space_exe);
        assert_eq!(
            parsed["hooks"]["SessionStart"][0]["hooks"][0]["command"],
            format!("{expected_quoted} __telemetry-hook agent-invocation"),
            "the wired command must embed the SHELL-QUOTED exe path, not the raw one \
             containing an unescaped space"
        );

        // Re-running with the SAME space-containing exe must be
        // recognized as already-up-to-date, not appended as a
        // duplicate block.
        merge_claude_settings_hooks_with_exe(&dir, TELEMETRY_HOOK_ENTRIES, space_exe)
            .expect("second hook wiring (reinstall) must succeed");
        let written = fs::read_to_string(dir.join(".claude/settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(
            parsed["hooks"]["SessionStart"].as_array().unwrap().len(),
            1,
            "reinstall with the same space-containing exe path must not append a duplicate \
             block"
        );

        fs::remove_dir_all(&dir).ok();
    }

    // ── shared `.settings.lock` (concurrent-install lost-update race) ─

    /// Reproduces the read-modify-write race directly: without a
    /// shared lock, two concurrent merges into the SAME
    /// `settings.json` -- one adding the `"hooks"` key, the other the
    /// `"permissions"` key -- each compute a full-document rewrite from
    /// their own stale read, and whichever atomic-rename lands last
    /// silently discards the other's change. Both merges here run on
    /// separate OS threads against the same `target_dir`, and both
    /// must be present in the final file: proof the shared
    /// `.settings.lock` (see `merge_claude_settings_hooks`/
    /// `merge_claude_settings_permissions`'s own doc comments) actually
    /// serializes them instead of letting them race.
    #[test]
    fn claude_settings_hooks_and_permissions_race_serialize_so_neither_change_is_lost() {
        let dir = scratch_dir("claude-settings-lock-race");
        let hooks_target = dir.clone();
        let perms_target = dir.clone();

        let hooks_thread = std::thread::spawn(move || {
            merge_claude_settings_hooks(&hooks_target, TELEMETRY_HOOK_ENTRIES)
        });
        let perms_thread = std::thread::spawn(move || {
            merge_claude_settings_permissions(&perms_target, &["mcp__foo__bar".to_string()])
        });

        hooks_thread
            .join()
            .expect("hooks thread must not panic")
            .expect("hooks merge must succeed");
        perms_thread
            .join()
            .expect("permissions thread must not panic")
            .expect("permissions merge must succeed");

        let settings_path = dir.join(CLAUDE_SETTINGS_RELATIVE_PATH);
        let content = fs::read_to_string(&settings_path).unwrap();
        let root: serde_json::Value = serde_json::from_str(&content).unwrap();

        assert!(
            root.get("hooks")
                .and_then(|h| h.get("SessionStart"))
                .is_some(),
            "the hooks merge's own change must survive the race, got: {content}"
        );
        assert_eq!(
            root["permissions"]["allow"],
            serde_json::json!(["mcp__foo__bar"]),
            "the permissions merge's own change must survive the race, got: {content}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_and_grant_compose_on_the_same_file() {
        // The real call site (`phases.rs`'s `AgentInstallPhase::run`)
        // calls both `apply_claude_settings_grant` and
        // `apply_claude_settings_hooks` against the SAME file in
        // sequence. Confirms neither clobbers the other's own key.
        let dir = scratch_dir("claude-hooks-and-grant-compose");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        apply_claude_settings_grant(&dir).expect("grant must succeed");
        apply_claude_settings_hooks(&dir).expect("hook wiring must succeed after the grant");

        let written = fs::read_to_string(dir.join(".claude/settings.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
        assert_eq!(
            parsed["permissions"]["allow"],
            serde_json::json!([
                "mcp__konductor-skills__find_skills",
                "mcp__konductor-skills__get_skill",
                "mcp__konductor-skills__reload_skills"
            ]),
            "the earlier grant's permissions must survive the later hooks merge"
        );
        assert!(parsed["hooks"]["SessionStart"].is_array());
        assert!(parsed["hooks"]["SubagentStart"].is_array());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_skips_rewrite_when_all_entries_already_present() {
        let dir = scratch_dir("claude-hooks-noop-rewrite");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");
        // Seeded with the SAME resolved absolute-path command
        // `merge_claude_settings_hooks` itself would compute for this
        // process, so `find_hook_match`'s identity check resolves to
        // `UpToDate` and this exercises the no-op path, not the
        // append/self-heal path.
        let exe = resolve_konductor_exe_path();
        // Seeded through the same helper production uses, so
        // `find_hook_match` resolves to `UpToDate` against the command
        // production would actually build, not an unquoted stand-in.
        let quoted_exe = shell_quote_for_hook_command(&exe);
        let original = format!(
            "{{\"hooks\":{{\"SessionStart\":[{{\"matcher\":\"startup|clear\",\"hooks\":\
             [{{\"type\":\"command\",\"command\":\"{quoted_exe} __telemetry-hook agent-invocation\"}}]}}],\
             \"SubagentStart\":[{{\"matcher\":\".*\",\"hooks\":\
             [{{\"type\":\"command\",\"command\":\"{quoted_exe} __telemetry-hook subagent-invocation\"}}]}}]}}}}"
        );
        fs::write(&settings_path, &original).unwrap();

        apply_claude_settings_hooks(&dir).expect("hook wiring must succeed as a no-op");

        let written = fs::read_to_string(&settings_path).unwrap();
        assert_eq!(
            written, original,
            "when every hook entry is already present the file must be left byte-for-byte \
             unchanged, not reformatted"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_errors_on_non_object_hooks_key() {
        let dir = scratch_dir("claude-hooks-non-object-hooks-key");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::json!({"hooks": "not-an-object"}).to_string(),
        )
        .unwrap();
        let err = apply_claude_settings_hooks(&dir)
            .expect_err("a non-object \"hooks\" key must be rejected, not overwritten");
        assert!(err.contains("\"hooks\""));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn claude_settings_hooks_errors_on_non_array_event_key() {
        let dir = scratch_dir("claude-hooks-non-array-event");
        let claude_dir = dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::json!({"hooks": {"SessionStart": "not-an-array"}}).to_string(),
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
        std::os::unix::fs::symlink(&real_elsewhere, dir.join(".claude"))
            .expect("failed to create test symlink");

        let err = apply_claude_settings_hooks(&dir)
            .expect_err("a symlinked .claude directory must be rejected, never written through");
        assert!(err.contains("symlink"));
        assert!(
            !real_elsewhere.join("settings.json").exists(),
            "nothing must be written through the symlink into the real target directory"
        );
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&real_elsewhere).ok();
    }
}
