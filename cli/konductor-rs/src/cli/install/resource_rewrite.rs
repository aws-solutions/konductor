// SPDX-License-Identifier: Apache-2.0
//
// install/resource_rewrite.rs — composable rewrite passes over a
// single parsed agent JSON, applied during install (see
// `kiro_cli.rs`'s `copy_agent_files_rewriting_resources`).
//
// Each `ResourceRewritePass` bundles matches/rewrite/verify for one
// concern, so adding a pass means one new struct plus one line in
// `standard_passes` -- not a new arm in a growing if-chain. A trait
// (not an enum or a function-pointer table) because every pass needs
// all three methods to travel together and be driven uniformly by
// `apply_all`.
//
// Ordering matters and is enforced structurally, not just documented:
// `McpServerPass::matches` reads the `skill://<skills_dir>/...` shape
// that `SkillResourcePass::rewrite` produces, so it must run after
// that pass -- if reordered, it simply sees no match and skips,
// failing safe rather than misbehaving. Likewise `bin_files` in
// `RewriteContext` can only be populated once
// `mcp_server::install_bin_files` has actually copied the binary, so
// the binary-copy-before-agent-install ordering is a data-flow fact
// (the caller can't construct the context otherwise), not a comment.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use super::manifest::ManifestFile;

/// Everything a pass may need at install time beyond the JSON value
/// itself. Built once per agent file and passed by reference to every
/// pass in turn. All passes share one context type (rather than one
/// per pass) so they can live in the same `Vec<Box<dyn
/// ResourceRewritePass>>`; a pass that doesn't need a field just
/// doesn't read it.
pub(super) struct RewriteContext<'a> {
    /// Destination dir context files were copied into
    /// (`<target_dir>/.kiro/context/`). Read by `ContextResourcePass`.
    pub(super) context_dir: &'a Path,
    /// Destination dir skills were copied into
    /// (`<target_dir>/.konductor/skills/`). Read by `SkillResourcePass`
    /// and by `McpServerPass::matches`, which re-derives the same
    /// `skill://<skills_dir>/` prefix to detect its scoping condition.
    pub(super) skills_dir: &'a Path,
    /// Destination dir the MCP server binary was copied into
    /// (`<target_dir>/.konductor/bin/`). Read by `McpServerPass`.
    pub(super) bin_dir: &'a Path,
    /// Manifest entries for MCP server binaries THIS install run
    /// actually copied (from `mcp_server::install_bin_files`, called
    /// strictly before this pipeline runs). `McpServerPass::rewrite`
    /// checks this rather than re-deriving "was a binary copied" some
    /// other way, so it can never inject a path for a binary that
    /// wasn't just copied to disk.
    pub(super) bin_files: &'a [ManifestFile],
    /// Per-agent SOP allowlists, from synth's `_sop_scopes.json` sidecar
    /// (`kiro_cli_v2::SOP_SCOPES_SIDECAR_FILE`), keyed by agent name.
    /// Read by `McpServerPass::matches`/`rewrite`, which look up the
    /// CURRENT agent's own entry (from `value["name"]`, since neither
    /// method takes a separate agent-name parameter) to decide whether
    /// this agent needs the `konductor-skills` MCP server at all (an
    /// agent with SOPs but no skill resources still needs it), and
    /// whether to append `--agent-sop-paths`/`--agent-sop-filter` to its
    /// launch args.
    ///
    /// Absent entry or an empty `Vec` are deliberately equivalent and
    /// BOTH mean "this agent has no SOP scoping" -- the single most
    /// important backward-compatibility rule for this field: an agent
    /// with no `dependencies.agentSops.agentSopNames` declaration must
    /// see zero behavior change from before this field existed.
    /// `kiro_cli.rs`'s caller passes an empty map when the sidecar
    /// itself is missing (e.g. a `dist/` tree from before synth started
    /// emitting it), which falls through to this exact same no-op path.
    pub(super) agent_sop_names: &'a std::collections::HashMap<String, Vec<String>>,
    /// Per-agent Kiro-runtime skill allowlists, from synth's `_skill_
    /// scopes.json` sidecar (`kiro_cli_v2::SKILL_SCOPES_SIDECAR_FILE`),
    /// keyed by agent name. Read by `McpServerPass::matches`/`rewrite`
    /// via the shared `agent_has_skill_names` helper, which looks up the
    /// CURRENT agent's own entry (from `value["name"]`, since neither
    /// method takes a separate agent-name parameter) to decide whether
    /// this agent needs the `konductor-skills` MCP server at all (an
    /// agent with skill-name scoping but no `skill://` resource still
    /// needs it), and whether to append `--skill-name-filter` to its
    /// launch args.
    ///
    /// Absent entry or an empty `Vec` are deliberately equivalent and
    /// BOTH mean "do not pass `--skill-name-filter` at all" -- this is
    /// the single most important backward-compatibility rule for this
    /// field, mirroring `agent_sop_names`'s own rule exactly: every
    /// agent that has not opted in by populating `dependencies.skills.
    /// skillNames` must see zero behavior change from before this field
    /// existed. `kiro_cli.rs`'s caller passes an empty map when the
    /// sidecar itself is missing (e.g. a `dist/` tree from before synth
    /// started emitting it), which falls through to this exact same
    /// no-op path.
    pub(super) agent_skill_names: &'a std::collections::HashMap<String, Vec<String>>,
}

/// One self-contained install-time mutation over a parsed agent JSON:
/// what it matches, what it mutates, and how it verifies its own
/// mutation. Each method is independently callable with a hand-built
/// `serde_json::Value` and `RewriteContext`, which is what makes every
/// pass unit-testable without a real install.
pub(super) trait ResourceRewritePass {
    /// Whether this pass has anything to do for `value`'s current
    /// state, which may already reflect an earlier pass's `rewrite`.
    ///
    /// Takes `ctx` (unlike `rewrite`/`verify`'s pre-existing signature,
    /// this parameter is not new to this trait -- widened here so
    /// `McpServerPass::matches` can look up the current agent's own
    /// `ctx.agent_sop_names` entry: a SOP-only agent has no
    /// skill-resource shape in `value` at all, so `matches` cannot
    /// decide "this agent needs the MCP server" from `value` alone.
    /// `ContextResourcePass`/`SkillResourcePass` ignore it -- their own
    /// matching condition is fully determined by `value`.
    fn matches(&self, value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool;

    /// Applies this pass's mutation in place. Only called when
    /// `matches(value)` was just `true`.
    fn rewrite(&self, value: &mut serde_json::Value, ctx: &RewriteContext<'_>);

    /// Confirms every target this pass's `rewrite` just pointed at
    /// exists on disk, erroring with `agent_file` and the missing
    /// target otherwise. Only called immediately after this pass's own
    /// `rewrite`, so it never observes a later pass's mutation. Never
    /// mutates disk itself -- check-only, by design: see this module's
    /// own "V3/Claude Code permission grant" section for why that
    /// grant is deliberately NOT implemented as a `verify`-time side
    /// effect, even though its target also lives outside `value`.
    fn verify(
        &self,
        value: &serde_json::Value,
        ctx: &RewriteContext<'_>,
        agent_file: &Path,
    ) -> Result<(), String>;
}

/// Runs every pass in order: for each match, `rewrite` then
/// immediately `verify` before moving on. Returns the first `Err`,
/// stopping the pipeline there -- matching the pre-existing fail-fast
/// behavior.
pub(super) fn apply_all(
    passes: &[Box<dyn ResourceRewritePass>],
    value: &mut serde_json::Value,
    ctx: &RewriteContext<'_>,
    agent_file: &Path,
) -> Result<(), String> {
    for pass in passes {
        if !pass.matches(value, ctx) {
            continue;
        }
        pass.rewrite(value, ctx);
        pass.verify(value, ctx, agent_file)?;
    }
    Ok(())
}

/// The ordered pipeline: context resources, then skill resources, then
/// MCP-server injection, which depends on the skill-resource pass
/// having already run (see this module's own doc comment on why that
/// can't be reordered). Adding a fourth pass is a new `struct FooPass`
/// plus one `Box::new(FooPass)` line here -- no existing line changes.
pub(super) fn standard_passes() -> Vec<Box<dyn ResourceRewritePass>> {
    vec![
        Box::new(ContextResourcePass),
        Box::new(SkillResourcePass),
        Box::new(McpServerPass),
    ]
}

/// Whether `value` has a `resources` array containing at least one
/// string starting with `prefix`.
fn resources_contain_prefix(value: &serde_json::Value, prefix: &str) -> bool {
    value
        .get("resources")
        .and_then(|r| r.as_array())
        .is_some_and(|resources| {
            resources
                .iter()
                .any(|entry| entry.as_str().is_some_and(|text| text.starts_with(prefix)))
        })
}

/// Appends `item` to `value[key]` (creating the array if absent)
/// unless it's already present -- makes grant injection append-only,
/// never overwriting a spec's own array, and idempotent across
/// reinstall. A no-op if `key` exists but isn't an array.
fn push_unique_str(value: &mut serde_json::Value, key: &str, item: &str) {
    let array = match value.get_mut(key) {
        Some(existing) => match existing.as_array_mut() {
            Some(array) => array,
            None => return,
        },
        None => {
            value[key] = serde_json::Value::Array(Vec::new());
            value[key].as_array_mut().expect("just inserted as array")
        }
    };
    let already_present = array.iter().any(|entry| entry.as_str() == Some(item));
    if !already_present {
        array.push(serde_json::Value::String(item.to_string()));
    }
}

// ── Pass 1: context resources ───────────────────────────────────────────

/// Prefix a synthed agent JSON's `resources` entry uses for a
/// per-agent context file. Matched literally, never regex/glob, so an
/// unrelated `file://` entry (e.g. `file://AGENTS.md`) is left alone.
const CONTEXT_RESOURCE_PREFIX: &str = "file://context/";

/// Rewrites `file://context/<name>` entries to an absolute
/// `file://<context_dir>/<name>`, and verifies each resulting entry
/// exists on disk.
pub(super) struct ContextResourcePass;

impl ResourceRewritePass for ContextResourcePass {
    fn matches(&self, value: &serde_json::Value, _ctx: &RewriteContext<'_>) -> bool {
        resources_contain_prefix(value, CONTEXT_RESOURCE_PREFIX)
    }

    fn rewrite(&self, value: &mut serde_json::Value, ctx: &RewriteContext<'_>) {
        let Some(resources) = value.get_mut("resources").and_then(|r| r.as_array_mut()) else {
            return;
        };
        for entry in resources.iter_mut() {
            let Some(text) = entry.as_str() else {
                continue;
            };
            let Some(name) = text.strip_prefix(CONTEXT_RESOURCE_PREFIX) else {
                continue;
            };
            // Raw, not percent-encoded: kiro-cli opens the path
            // literally after stripping the prefix.
            let absolute = format!("file://{}", ctx.context_dir.join(name).display());
            if text == absolute {
                continue;
            }
            *entry = serde_json::Value::String(absolute);
        }
    }

    fn verify(
        &self,
        value: &serde_json::Value,
        ctx: &RewriteContext<'_>,
        agent_file: &Path,
    ) -> Result<(), String> {
        let Some(resources) = value.get("resources").and_then(|r| r.as_array()) else {
            return Ok(());
        };
        let context_dir_prefix = format!("file://{}/", ctx.context_dir.display());
        for entry in resources {
            let Some(text) = entry.as_str() else {
                continue;
            };
            let Some(rest) = text.strip_prefix(&context_dir_prefix) else {
                continue;
            };
            let target = ctx.context_dir.join(rest);
            if !target.is_file() {
                return Err(format!(
                    "agent '{}' declares context resource '{text}', but no file exists at {} \
                     -- run `konductor synth --from <repo-root>` again before installing",
                    agent_file.display(),
                    target.display()
                ));
            }
        }
        Ok(())
    }
}

// ── Pass 2: skill resources ──────────────────────────────────────────────

/// Prefix a synthed agent JSON's `resources` entry uses for a
/// normalized packaged-skill reference. Matched literally, never
/// regex/glob, so the `ws-*` workspace-skills glob is never mistaken
/// for one of these. `pub(super)`: also read by `kiro_cli.rs`'s
/// pre-existing fast-path skip in `copy_agent_files_rewriting_resources`
/// (mirroring this pass's own trigger), so that skip check stays tied
/// to this one definition rather than a separately-declared copy that
/// could silently drift from it.
///
/// NOT used to predict the Claude/V3 grant (`plan_claude_settings_grant`
/// in `kiro_cli.rs`) -- that grant's real trigger is
/// `McpServerPass::matches` below, which is a deliberately BROADER
/// check than this exact prefix (see its own doc comment: it also
/// matches the post-rewrite absolute form). `plan_claude_settings_grant`
/// calls `McpServerPass::matches` directly rather than re-deriving a
/// narrower approximation from this prefix, so its prediction can never
/// diverge from the real trigger (a divergence `attach_provenance`
/// would otherwise catch only as a hard failure at install time).
pub(super) const SKILL_RESOURCE_PREFIX: &str = "skill://skills/";
const SKILL_RESOURCE_SUFFIX: &str = "/SKILL.md";

/// Rewrites `skill://skills/<name>/SKILL.md` entries to an absolute
/// `skill://<skills_dir>/<name>/SKILL.md`, and verifies each resulting
/// entry exists on disk. Must run before `McpServerPass` in
/// `standard_passes` -- that pass's `matches` reads this rewrite's
/// output.
pub(super) struct SkillResourcePass;

impl ResourceRewritePass for SkillResourcePass {
    fn matches(&self, value: &serde_json::Value, _ctx: &RewriteContext<'_>) -> bool {
        resources_contain_prefix(value, SKILL_RESOURCE_PREFIX)
    }

    fn rewrite(&self, value: &mut serde_json::Value, ctx: &RewriteContext<'_>) {
        let Some(resources) = value.get_mut("resources").and_then(|r| r.as_array_mut()) else {
            return;
        };
        for entry in resources.iter_mut() {
            let Some(text) = entry.as_str() else {
                continue;
            };
            let Some(rest) = text.strip_prefix(SKILL_RESOURCE_PREFIX) else {
                continue;
            };
            let Some(name) = rest.strip_suffix(SKILL_RESOURCE_SUFFIX) else {
                continue;
            };
            let absolute = format!(
                "skill://{}",
                ctx.skills_dir.join(name).join("SKILL.md").display()
            );
            if text == absolute {
                continue;
            }
            *entry = serde_json::Value::String(absolute);
        }
    }

    fn verify(
        &self,
        value: &serde_json::Value,
        ctx: &RewriteContext<'_>,
        agent_file: &Path,
    ) -> Result<(), String> {
        let Some(resources) = value.get("resources").and_then(|r| r.as_array()) else {
            return Ok(());
        };
        let skills_dir_prefix = format!("skill://{}/", ctx.skills_dir.display());
        for entry in resources {
            let Some(text) = entry.as_str() else {
                continue;
            };
            let Some(rest) = text.strip_prefix(&skills_dir_prefix) else {
                continue;
            };
            let target = ctx.skills_dir.join(rest);
            if !target.is_file() {
                return Err(format!(
                    "agent '{}' declares skill resource '{text}', but no file exists at {} \
                     -- run `konductor synth --from <repo-root>` again before installing",
                    agent_file.display(),
                    target.display()
                ));
            }
        }
        Ok(())
    }
}

// ── Pass 3: MCP server injection ─────────────────────────────────────────

/// Name of the `mcpServers` entry this pass manages, and the binary it
/// launches. A single fixed pair for now; a second MCP server would
/// need a real lookup instead of a constant pair. `pub(super)`: also
/// read by `kiro_cli.rs`, which checks for this exact key in an
/// agent's mutated JSON to decide whether the V2 grant actually landed
/// for that agent this run (see the "V3/Claude Code permission grant"
/// section below for why that decision matters).
pub(super) const MCP_SERVER_NAME: &str = "konductor-skills";
/// `pub(super)`: also read by `kiro_cli.rs`'s `plan_claude_settings_grant`
/// to predict, at plan time, whether this run will install the binary
/// this grant is gated on -- kept as one shared constant so the
/// prediction can never name a different binary than the real
/// `McpServerPass::rewrite` check below does.
pub(super) const MCP_SERVER_BINARY_NAME: &str = "skill-lookup-mcp";
/// CLI args for the injected entry: one `--skills-dir` for the
/// user-level root (`~/.konductor/skills`) and one for the
/// project-local root (`.konductor/skills`, resolved by the launched
/// process's own cwd) -- so the same absolute binary path still
/// discovers whichever project's skills the agent is run from.
const MCP_SERVER_ARGS: &[&str] = &[
    "--skills-dir",
    "~/.konductor/skills",
    "--skills-dir",
    ".konductor/skills",
];

/// `--agent-sop-paths` values appended (each preceded by its own
/// `--agent-sop-paths` flag, since the flag is repeatable -- see
/// `skill-lookup-mcp`'s own `Cli::agent_sop_paths`) when the current
/// agent has a non-empty `RewriteContext::agent_sop_names` entry.
/// Mirrors `MCP_SERVER_ARGS`'s own user-level + project-local pair
/// exactly: the launched process resolves `~`/the relative path itself,
/// so these are the same two literal strings, one directory segment
/// later (`sops` instead of `skills`).
const MCP_SERVER_SOP_PATHS: &[&str] = &["~/.konductor/sops", ".konductor/sops"];

/// The `tools` grant for the server as a whole, and the
/// `allowedTools` grants for its three tools. Committed specs declare
/// neither anymore -- both are injected here alongside `mcpServers`,
/// so a spec can never advertise a grant for a server it doesn't have
/// wired up (previously, downstream agents that `includes` these specs
/// inherited the grants with no server of their own, since AIM
/// union-merges `tools`/`allowedTools` across `includes`).
const MCP_SERVER_TOOLS_GRANT: &str = "@konductor-skills";
const MCP_SERVER_ALLOWED_TOOLS_GRANTS: &[&str] = &[
    "@konductor-skills/find_skills",
    "@konductor-skills/get_skill",
    "@konductor-skills/reload_skills",
];

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
    // `config set` lost-update race `config_lock.rs` was originally
    // written to fix, reproduced here for this file instead of
    // `.konductor/config.yml`. Held for the rest of this function's
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
    crate::cli::atomic_write::write_atomic(&settings_path, &bytes)
        .map_err(|e| format!("failed to write {}: {e}", settings_path.display()))?;

    // `write_atomic` always chmods the file it just wrote to a fixed
    // `0o644` -- correct for every other caller, since those write
    // files Konductor generates itself, but wrong here: this file is
    // the user's, and if it pre-existed at a narrower mode (e.g.
    // `0600`), silently widening it on every reinstall changes exposure
    // the user didn't ask for and has no reason to notice. Restore the
    // original mode when there was one; a freshly-created file
    // (`original_mode: None`) keeps `write_atomic`'s default.
    //
    // Deliberately non-fatal: the content
    // write above has already landed on disk by this point, and `bytes`
    // already reflects it exactly. Propagating a `set_permissions`
    // failure as an `Err` here would make this function's caller
    // (`apply_claude_settings_grant`) return `Err` too -- discarding the
    // hash of content that IS genuinely on disk, and leaving the
    // manifest either stale (missing this file's real content hash) or
    // missing the entry entirely. A permission-mode mismatch is a real,
    // but strictly less severe, problem than a manifest that no longer
    // matches on-disk content -- warn and still return the bytes that
    // were actually written, so the caller's hash always matches
    // exactly what a later `doctor`/`update` run will read back.
    if let Some(mode) = original_mode {
        if let Err(e) =
            std::fs::set_permissions(&settings_path, std::fs::Permissions::from_mode(mode))
        {
            eprintln!(
                "warning: failed to restore original permissions on {}: {e} -- the file's \
                 content was still written successfully",
                settings_path.display()
            );
        }
    }

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
        super::artifact::sha256_hex(&bytes),
    ))
}

// ── V3/Claude Code telemetry hook wiring (usage-analytics design D.13) ──
//
// Wires `konductor __telemetry-hook <event-type>` into
// `<target_dir>/.claude/settings.json`'s `"hooks"` key so the runtime
// itself invokes the hidden `__telemetry-hook` subcommand at
// `SessionStart` (agent invocation) and `SubagentStart` (sub-agent
// delegation) -- see `docs/design/konductor-usage-analytics-design.md`
// D.13 for why these two events, not `SubagentStop` (the DIFFERENT,
// already-published workflow-level hook the base
// `konductor-cli-engineering-design.md` uses, which fires at delegation
// END, not START -- both are real, distinct hooks legitimately in play
// in the same file for two different purposes; D.13's own closing note
// spells this out).
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
// a real, larger change with its own open design questions (D.13's own
// "no confirmed `invokeSubAgent` re-fire" finding for `agentSpawn`, and
// whether a per-agent single-entry or append semantics is right).
// Kiro CLI hook wiring is explicitly OUT OF SCOPE for this revision.

/// One konductor-owned hook entry this pass ensures exists under
/// `.claude/settings.json`'s `"hooks"` key -- one per D.13 row that has
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
        // Same source-type alternation `metrics-collection-design.md`'s
        // own D.1 SessionStart hook uses (`startup|clear`) -- a genuine
        // session start or a `/clear` both count as a fresh
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
/// `$PATH`-dependent fallback -- the exact regression the absolute-path
/// self-heal fix (`f-bb016f29`) exists to prevent, in reverse. A
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
/// single-quote-wrapping branch below instead. This keeps every
/// existing fixture path in this module's own tests (none of which
/// contain a space or a POSIX backslash) byte-for-byte identical to
/// before this fix, while a path that DOES need quoting gets it.
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
    crate::cli::atomic_write::write_atomic(&settings_path, &bytes)
        .map_err(|e| format!("failed to write {}: {e}", settings_path.display()))?;

    // Deliberately non-fatal: the content
    // write above has already landed on disk by this point, and `bytes`
    // already reflects it exactly -- see `merge_claude_settings_permissions`'s
    // own identical rationale, one function up, for why a
    // `set_permissions` failure here must not discard an
    // already-correct hash. Without this, a failure on this specific
    // step would make `apply_claude_settings_hooks` return `Err`,
    // leaving `phases.rs`'s `claude_settings` holding the EARLIER
    // grant's own (pre-hooks) hash while the actual file on disk
    // already contains the hooks' own changes -- a manifest entry that
    // no longer matches on-disk content, which a later `doctor`/`update`
    // hash check would misreport as external drift.
    if let Some(mode) = original_mode {
        if let Err(e) =
            std::fs::set_permissions(&settings_path, std::fs::Permissions::from_mode(mode))
        {
            eprintln!(
                "warning: failed to restore original permissions on {}: {e} -- the file's \
                 content was still written successfully",
                settings_path.display()
            );
        }
    }

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
        super::artifact::sha256_hex(&bytes),
    ))
}

/// Injects an absolute-path `mcpServers.konductor-skills` entry
/// launching the just-installed binary, but only when `ctx.bin_files`
/// shows this run actually copied it, and only for an agent that
/// already carries a rewritten packaged-skill resource (see
/// `matches`). `matches` re-derives the skill-resource shape rather
/// than taking a boolean from the caller, which is how the ordering
/// dependency on `SkillResourcePass` is expressed in code: if that
/// pass were removed or reordered, this one would just see no match
/// and skip, rather than reading a stale flag.
pub(super) struct McpServerPass;

/// Whether `value`'s own agent name (its top-level `name` field) has a
/// non-empty entry in `ctx.agent_sop_names`. Shared between `matches`
/// (an agent with SOPs but no skill resources still needs the MCP
/// server) and `rewrite` (the same lookup decides whether to append
/// `--agent-sop-paths`/`--agent-sop-filter`), so the two can never
/// disagree about which agents this field applies to.
fn agent_has_sop_names(value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
    value
        .get("name")
        .and_then(|n| n.as_str())
        .and_then(|agent_name| ctx.agent_sop_names.get(agent_name))
        .is_some_and(|names| !names.is_empty())
}

/// Whether `value`'s own agent name (its top-level `name` field) has a
/// non-empty entry in `ctx.agent_skill_names`. Mirrors `agent_has_sop_
/// names` exactly. Shared between `matches` (an agent with skill-name
/// scoping but no `skill://` resource still needs the MCP server) and
/// `rewrite` (the same lookup decides whether to append
/// `--skill-name-filter`), so the two can never disagree about which
/// agents this field applies to.
fn agent_has_skill_names(value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
    value
        .get("name")
        .and_then(|n| n.as_str())
        .and_then(|agent_name| ctx.agent_skill_names.get(agent_name))
        .is_some_and(|names| !names.is_empty())
}

/// Whether `value` (by its own resources) or its own agent's SOP/skill-
/// name scoping in `ctx` triggers the `konductor-skills` MCP server
/// grant -- shared verbatim by both `McpServerPass` (V2) and
/// `McpServerPassV3` below, so the two engines can never disagree about
/// which agents this grant applies to.
fn agent_needs_mcp_server(value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
    // f-908d40db: a bare starts_with("skill://") &&
    // ends_with("/SKILL.md") also matches the ws-* workspace-skills
    // glob, which SkillResourcePass never touches. Excluding any
    // entry containing '*' rejects the glob while still accepting
    // both the pre-rewrite (skill://skills/<name>/SKILL.md) and
    // post-rewrite (skill://<skills_dir>/<name>/SKILL.md) forms.
    //
    // f-2ee0918c: the post-rewrite form is built via
    // `Path::display()`, which uses `\` on non-Unix targets, so a
    // bare ends_with("/SKILL.md") would reject it there. Matching
    // on the last path segment (either separator) instead keeps
    // the check working regardless of platform.
    let has_skill_resource = value
        .get("resources")
        .and_then(|r| r.as_array())
        .is_some_and(|resources| {
            resources.iter().any(|entry| {
                entry.as_str().is_some_and(|text| {
                    text.starts_with("skill://")
                        && text
                            .rsplit(['/', '\\'])
                            .next()
                            .is_some_and(|last_segment| last_segment == "SKILL.md")
                        && !text.contains('*')
                })
            })
        });
    // Widened for SOP-only or skill-name-only agents (declares
    // `dependencies.agentSops.agentSopNames` and/or `dependencies.
    // skills.skillNames` but no `skill://` resource at all): without
    // this, such an agent would never even reach `rewrite`, so it
    // could never get the `--agent-sop-paths`/`--agent-sop-filter`
    // pair or the `--skill-name-filter` flag this pass injects (see
    // `agent_has_sop_names`/`agent_has_skill_names`'s own doc
    // comments).
    has_skill_resource || agent_has_sop_names(value, ctx) || agent_has_skill_names(value, ctx)
}

/// Whether THIS run actually installed the `konductor-skills` MCP server
/// binary, per `ctx.bin_files` -- shared by both `McpServerPass` and
/// `McpServerPassV3`'s `rewrite`. Matches the exact manifest path
/// `install_bin_files` produces for this binary -- built the same way,
/// so it can't drift.
fn mcp_server_binary_installed(ctx: &RewriteContext<'_>) -> bool {
    let expected_path = super::kiro_cli::content_manifest_path(
        super::kiro_cli::KONDUCTOR_DESTINATION_ROOT,
        super::mcp_server::BIN_CONTENT_TYPE_DIR,
        MCP_SERVER_BINARY_NAME,
    );
    ctx.bin_files.iter().any(|file| file.path == expected_path)
}

/// The absolute `command` path for the injected `konductor-skills`
/// entry, from `ctx.bin_dir` -- shared by both `McpServerPass` and
/// `McpServerPassV3`.
fn mcp_server_command_path(ctx: &RewriteContext<'_>) -> String {
    ctx.bin_dir
        .join(MCP_SERVER_BINARY_NAME)
        .display()
        .to_string()
}

/// Builds the CLI args array for the injected `konductor-skills`
/// `mcpServers` entry -- identical for both `McpServerPass` (V2) and
/// `McpServerPassV3` (V3): the same fixed `--skills-dir` pair, the same
/// conditional `--agent-sop-paths`/`--agent-sop-filter` pair, and the
/// same conditional `--skill-name-filter` flag, gated on the exact same
/// per-agent lookups (`agent_has_sop_names`/`agent_has_skill_names`).
fn build_mcp_server_args(
    value: &serde_json::Value,
    ctx: &RewriteContext<'_>,
) -> Vec<serde_json::Value> {
    let mut args: Vec<serde_json::Value> = MCP_SERVER_ARGS
        .iter()
        .map(|a| serde_json::Value::String(a.to_string()))
        .collect();
    // Both-or-neither, unlike skills' single `--skill-name-filter`
    // flag: `--agent-sop-paths` on its own (with no filter) would
    // serve every SOP in those directories to an agent that declared
    // none, so the pair is gated together on the SAME condition.
    // Default rule (critical for backward compatibility): only
    // appended when THIS agent has a non-empty entry in
    // `ctx.agent_sop_names` -- an absent entry or an empty list both
    // leave `args` exactly as it was before this field existed.
    if agent_has_sop_names(value, ctx) {
        let agent_sop_names = value
            .get("name")
            .and_then(|n| n.as_str())
            .and_then(|agent_name| ctx.agent_sop_names.get(agent_name))
            .expect("agent_has_sop_names just confirmed a non-empty entry exists");
        for path in MCP_SERVER_SOP_PATHS {
            args.push(serde_json::Value::String("--agent-sop-paths".to_string()));
            args.push(serde_json::Value::String(path.to_string()));
        }
        args.push(serde_json::Value::String("--agent-sop-filter".to_string()));
        args.push(serde_json::Value::String(agent_sop_names.join(",")));
    }
    // Single `--skill-name-filter` flag (unlike SOPs' `--agent-sop-
    // paths`/`--agent-sop-filter` pair above): `skill-lookup-mcp`'s
    // `--skills-dir` roots are already fixed by `MCP_SERVER_ARGS`,
    // so there is no analogous "paths" flag to pair this with.
    // Default rule (critical for backward compatibility, mirroring
    // the SOP rule exactly): only appended when THIS agent has a
    // non-empty entry in `ctx.agent_skill_names` -- an absent entry
    // or an empty list both leave `args` exactly as it was before
    // this field existed. Uses `agent_has_skill_names` (shared with
    // `matches` above) so the two can never disagree about which
    // agents this applies to.
    if agent_has_skill_names(value, ctx) {
        let agent_skill_names = value
            .get("name")
            .and_then(|n| n.as_str())
            .and_then(|agent_name| ctx.agent_skill_names.get(agent_name))
            .expect("agent_has_skill_names just confirmed a non-empty entry exists");
        args.push(serde_json::Value::String("--skill-name-filter".to_string()));
        args.push(serde_json::Value::String(agent_skill_names.join(",")));
    }
    args
}

/// Injects (or overwrites) the `mcpServers.konductor-skills` entry with
/// `command`/`args` -- identical full-overwrite-of-that-one-key
/// semantics for both `McpServerPass` (V2) and `McpServerPassV3` (V3):
/// the source spec no longer declares this entry, so the only way one
/// could already be present is a prior install's own injection -- which
/// can't happen here since `value` is always read fresh from `dist/`.
fn inject_mcp_server_entry(
    value: &mut serde_json::Value,
    command: String,
    args: Vec<serde_json::Value>,
) {
    let entry = serde_json::json!({
        "command": command,
        "args": args,
    });
    match value.get_mut("mcpServers").and_then(|m| m.as_object_mut()) {
        Some(mcp_servers) => {
            mcp_servers.insert(MCP_SERVER_NAME.to_string(), entry);
        }
        None => {
            let mut mcp_servers = serde_json::Map::new();
            mcp_servers.insert(MCP_SERVER_NAME.to_string(), entry);
            value["mcpServers"] = serde_json::Value::Object(mcp_servers);
        }
    }
}

/// Confirms the `mcpServers.konductor-skills.command` path this run just
/// injected (if any) exists on disk -- shared by both `McpServerPass`
/// and `McpServerPassV3`'s `verify`, since both inject the exact same
/// key/shape.
fn verify_mcp_server_command(value: &serde_json::Value, agent_file: &Path) -> Result<(), String> {
    let Some(command) = value
        .get("mcpServers")
        .and_then(|m| m.get(MCP_SERVER_NAME))
        .and_then(|s| s.get("command"))
        .and_then(|c| c.as_str())
    else {
        // No-op when rewrite injected nothing (binary not installed).
        return Ok(());
    };
    if !Path::new(command).is_file() {
        return Err(format!(
            "agent '{}' declares mcpServers.{MCP_SERVER_NAME}.command '{command}', but no \
             file exists there -- run `konductor install` again after building the MCP \
             server binary (`cd mcp && cargo build --release`)",
            agent_file.display()
        ));
    }
    Ok(())
}

/// Confirms that, whenever `rewrite` just injected `mcpServers.
/// konductor-skills` into `value`, a matching `capability: "mcp"` rule
/// (built via `mcp_server_permission_match_patterns`) is actually
/// present in `value["permissions"]["rules"]`. `McpServerPassV3`-only:
/// V2's `McpServerPass` authorizes via `tools`/`allowedTools`
/// (`push_unique_str`, which never fails to attach an array element), so
/// it has no analogous gap to close.
///
/// Constructs the exact rule `rewrite` would have inserted and checks
/// for byte-for-byte presence in `permissions.rules[]` -- the same
/// equality check `upsert_mcp_permission_rule` itself uses for its own
/// idempotency dedup, so this can never disagree with what a successful
/// `rewrite` actually writes.
///
/// Errors when the `mcpServers` entry is present but the paired
/// permission rule is not -- exactly what `upsert_mcp_permission_rule`'s
/// two malformed-shape no-op branches could produce (a pre-existing
/// `permissions` that isn't a JSON object, or `permissions.rules` that
/// isn't a JSON array). Fails the whole install rather than let it
/// silently ship an `mcpServers` entry the agent has no grant to call.
fn verify_mcp_permission_rule_present(
    value: &serde_json::Value,
    agent_file: &Path,
) -> Result<(), String> {
    let mcp_server_injected = value
        .get("mcpServers")
        .and_then(|m| m.get(MCP_SERVER_NAME))
        .is_some();
    if !mcp_server_injected {
        // No-op when rewrite injected nothing (binary not installed) --
        // mirrors verify_mcp_server_command's own early return.
        return Ok(());
    }

    let expected_rule = serde_json::json!({
        "capability": "mcp",
        "match": mcp_server_permission_match_patterns(),
        "effect": "allow",
    });
    let rule_present = value
        .get("permissions")
        .and_then(|p| p.get("rules"))
        .and_then(|r| r.as_array())
        .is_some_and(|rules| rules.iter().any(|rule| rule == &expected_rule));

    if !rule_present {
        return Err(format!(
            "agent '{}' has an injected mcpServers.{MCP_SERVER_NAME} entry, but no matching \
             \"mcp\" permission rule was found in permissions.rules[] -- the agent would \
             install successfully with no actual authorization to call konductor-skills. \
             This means upsert_mcp_permission_rule could not attach the grant, most likely \
             because this agent file's pre-existing \"permissions\" or \"permissions.rules\" \
             field is not the JSON shape it expects (an object and an array, respectively) -- \
             fix the agent file's permissions shape (or remove the hand-edited override) and \
             run `konductor install` again",
            agent_file.display()
        ));
    }
    Ok(())
}

impl ResourceRewritePass for McpServerPass {
    fn matches(&self, value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
        agent_needs_mcp_server(value, ctx)
    }

    fn rewrite(&self, value: &mut serde_json::Value, ctx: &RewriteContext<'_>) {
        if !mcp_server_binary_installed(ctx) {
            return;
        }
        let command = mcp_server_command_path(ctx);
        let args = build_mcp_server_args(value, ctx);
        inject_mcp_server_entry(value, command, args);

        // Appends to the agent's existing tools/allowedTools (e.g.
        // k-developer's @aws-mcp grant) rather than overwriting.
        // push_unique_str keeps a reinstall idempotent.
        push_unique_str(value, "tools", MCP_SERVER_TOOLS_GRANT);
        for tool in MCP_SERVER_ALLOWED_TOOLS_GRANTS {
            push_unique_str(value, "allowedTools", tool);
        }
    }

    fn verify(
        &self,
        value: &serde_json::Value,
        _ctx: &RewriteContext<'_>,
        agent_file: &Path,
    ) -> Result<(), String> {
        verify_mcp_server_command(value, agent_file)
    }
}

// ── Pass 4: MCP server injection (V3/KAS) ────────────────────────────────

/// `permissions.rules[].match` patterns granting the same three
/// `konductor-skills` tools as `MCP_SERVER_ALLOWED_TOOLS_GRANTS` above,
/// in V3's own `server/tool` syntax (no leading `@`, unlike V2's own
/// `@server/tool` tool-ID convention). Derived from
/// `MCP_SERVER_ALLOWED_TOOLS_GRANTS` at call time, not a second
/// hand-written literal list, so the two can never drift apart.
///
/// Explicit per-tool matches, not a `konductor-skills/*` wildcard: a
/// wildcard would auto-grant any tool `skill-lookup-mcp` adds in the
/// future with no review of that tool's own scope, silently widening
/// this agent's authorization on the server's next release. Explicit
/// matches require a deliberate, reviewed update here before a new tool
/// is usable. This also mirrors V2's own precedent
/// (`MCP_SERVER_ALLOWED_TOOLS_GRANTS`, which never grants the whole
/// server either), so it's the more conservative choice on its own
/// merits, not merely for consistency.
fn mcp_server_permission_match_patterns() -> Vec<String> {
    MCP_SERVER_ALLOWED_TOOLS_GRANTS
        .iter()
        .map(|grant| {
            grant
                .strip_prefix('@')
                .expect("MCP_SERVER_ALLOWED_TOOLS_GRANTS entries always start with '@'")
                .to_string()
        })
        .collect()
}

/// Appends a `{"capability": capability, "match": match_patterns,
/// "effect": "allow"}` rule to `value["permissions"]["rules"]` unless an
/// identical rule is already present -- the object-shaped analog of
/// `push_unique_str` above, for V3's `permissions.rules[]` array. Only
/// ever appends; never touches any other rule already in that array
/// (e.g. a `shell`/`fs_read` rule `derive_permission_rules` produced at
/// synth time).
///
/// Handles three shapes, each pinned by a test in this module:
/// - `permissions` absent entirely: creates
///   `value["permissions"] = {"rules": [rule]}` fresh.
/// - `permissions` present as an object with no `"rules"` key: inserts
///   a fresh empty array before pushing into it.
/// - `permissions` present but not an object, or `permissions.rules`
///   present but not an array: no-ops, matching `push_unique_str`'s own
///   "don't crash on a malformed shape" contract, rather than
///   overwriting a hand-edited or foreign agent file (real synth output
///   always emits `permissions: {"rules": [...]}`, so this path is
///   defensive-only).
///
/// The no-op path is silent by design, matching `push_unique_str`'s own
/// contract -- but not unchecked: `McpServerPassV3::verify` calls
/// `verify_mcp_permission_rule_present` immediately after `rewrite`,
/// which asserts the exact rule this function would have inserted is
/// actually present whenever `mcpServers.konductor-skills` was injected,
/// and fails the install if it isn't.
fn upsert_mcp_permission_rule(
    value: &mut serde_json::Value,
    capability: &str,
    match_patterns: &[String],
) {
    let rule = serde_json::json!({
        "capability": capability,
        "match": match_patterns,
        "effect": "allow",
    });

    if value.get("permissions").is_none() {
        value["permissions"] = serde_json::json!({ "rules": [rule] });
        return;
    }
    let Some(permissions) = value.get_mut("permissions").and_then(|p| p.as_object_mut()) else {
        return;
    };
    let rules = match permissions.get_mut("rules") {
        Some(existing) => match existing.as_array_mut() {
            Some(array) => array,
            None => return,
        },
        None => {
            permissions.insert("rules".to_string(), serde_json::Value::Array(Vec::new()));
            permissions
                .get_mut("rules")
                .and_then(|r| r.as_array_mut())
                .expect("just inserted as array")
        }
    };
    let already_present = rules.iter().any(|entry| entry == &rule);
    if !already_present {
        rules.push(rule);
    }
}

/// V3 (KAS) analog of `McpServerPass`: injects the identical
/// `mcpServers.konductor-skills` entry, but authorizes it via a
/// `permissions.rules[]` entry instead of V2's `tools`/`allowedTools`
/// pair -- V3 has no `allowedTools` field, and `permissions.rules[]` is
/// the correct place to scope MCP-server authorization under V3, not the
/// `tools` tag array (`kiro_cli_v3.rs`'s own `render_agent_file` treats
/// `tools` as a bare pass-through of the source spec's own visibility
/// tags, with no grant semantics of its own).
///
/// Shares its `matches`/`rewrite`/`verify` logic with `McpServerPass` via
/// the free functions above, so the two passes can never disagree about
/// when to fire or what to inject -- only in how they author the grant.
pub(super) struct McpServerPassV3;

impl ResourceRewritePass for McpServerPassV3 {
    fn matches(&self, value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
        agent_needs_mcp_server(value, ctx)
    }

    fn rewrite(&self, value: &mut serde_json::Value, ctx: &RewriteContext<'_>) {
        if !mcp_server_binary_installed(ctx) {
            return;
        }
        let command = mcp_server_command_path(ctx);
        let args = build_mcp_server_args(value, ctx);
        inject_mcp_server_entry(value, command, args);

        upsert_mcp_permission_rule(value, "mcp", &mcp_server_permission_match_patterns());
    }

    fn verify(
        &self,
        value: &serde_json::Value,
        _ctx: &RewriteContext<'_>,
        agent_file: &Path,
    ) -> Result<(), String> {
        verify_mcp_server_command(value, agent_file)?;
        verify_mcp_permission_rule_present(value, agent_file)
    }
}

/// The V3 (KAS) ordered pipeline: reuses `ContextResourcePass` and
/// `SkillResourcePass` UNCHANGED (V3's `resources` field is rendered in
/// the identical shape as V2's -- see `kiro_cli_v3.rs`'s own
/// `render_agent_file` doc comment), swapping only the MCP-wiring pass
/// for `McpServerPassV3` (`permissions.rules[]`-based authorization
/// instead of V2's `tools`/`allowedTools` pair). Ordering is identical
/// to `standard_passes` for the identical reason: `McpServerPassV3::matches`
/// reads `SkillResourcePass::rewrite`'s output.
pub(super) fn standard_passes_v3() -> Vec<Box<dyn ResourceRewritePass>> {
    vec![
        Box::new(ContextResourcePass),
        Box::new(SkillResourcePass),
        Box::new(McpServerPassV3),
    ]
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

    /// Empty by construction (a `'static` empty map, so every `ctx()`
    /// call site below can borrow it without needing its own live
    /// binding) -- exercises the default "no agent has opted in"
    /// backward-compatibility path for every existing test that doesn't
    /// care about SOP scoping at all. Tests that DO care (see the
    /// `agent_sop_names`-specific tests below) build their own map and
    /// pass it to `RewriteContext` directly rather than through this
    /// helper.
    fn empty_agent_sop_names() -> &'static std::collections::HashMap<String, Vec<String>> {
        static EMPTY: std::sync::OnceLock<std::collections::HashMap<String, Vec<String>>> =
            std::sync::OnceLock::new();
        EMPTY.get_or_init(std::collections::HashMap::new)
    }

    /// Empty by construction, mirroring `empty_agent_sop_names` exactly
    /// -- exercises the default "no agent has opted in" backward-
    /// compatibility path for every existing test that doesn't care
    /// about skill-name scoping at all. Tests that DO care (see the
    /// `agent_skill_names`-specific tests below) build their own map and
    /// pass it to `RewriteContext` directly rather than through this
    /// helper.
    fn empty_agent_skill_names() -> &'static std::collections::HashMap<String, Vec<String>> {
        static EMPTY: std::sync::OnceLock<std::collections::HashMap<String, Vec<String>>> =
            std::sync::OnceLock::new();
        EMPTY.get_or_init(std::collections::HashMap::new)
    }

    fn ctx<'a>(
        context_dir: &'a Path,
        skills_dir: &'a Path,
        bin_dir: &'a Path,
        bin_files: &'a [ManifestFile],
    ) -> RewriteContext<'a> {
        RewriteContext {
            context_dir,
            skills_dir,
            bin_dir,
            bin_files,
            agent_sop_names: empty_agent_sop_names(),
            agent_skill_names: empty_agent_skill_names(),
        }
    }

    /// A minimal, empty-everything `RewriteContext` for `matches`-only
    /// tests that don't exercise `rewrite`/`verify` and so don't need
    /// real scratch directories.
    fn matches_only_ctx() -> RewriteContext<'static> {
        RewriteContext {
            context_dir: Path::new(""),
            skills_dir: Path::new(""),
            bin_dir: Path::new(""),
            bin_files: &[],
            agent_sop_names: empty_agent_sop_names(),
            agent_skill_names: empty_agent_skill_names(),
        }
    }

    // ── ContextResourcePass ──────────────────────────────────────────

    #[test]
    fn context_pass_matches_only_context_prefixed_resource() {
        let with = serde_json::json!({"resources": ["file://context/notes.md"]});
        let without = serde_json::json!({"resources": ["file://AGENTS.md"]});
        assert!(ContextResourcePass.matches(&with, &matches_only_ctx()));
        assert!(!ContextResourcePass.matches(&without, &matches_only_ctx()));
        assert!(!ContextResourcePass.matches(&serde_json::json!({}), &matches_only_ctx()));
    }

    #[test]
    fn context_pass_rewrite_produces_absolute_raw_path() {
        let dir = scratch_dir("context-rewrite");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let mut value = serde_json::json!({"resources": ["file://context/notes.md"]});
        ContextResourcePass.rewrite(&mut value, &ctx(&context_dir, &skills_dir, &bin_dir, &[]));
        let expected = format!("file://{}", context_dir.join("notes.md").display());
        assert_eq!(value["resources"], serde_json::json!([expected]));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn context_pass_rewrite_leaves_unrelated_entries_untouched() {
        let dir = scratch_dir("context-rewrite-untouched");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let mut value = serde_json::json!({"resources": ["file://AGENTS.md"]});
        ContextResourcePass.rewrite(&mut value, &ctx(&context_dir, &skills_dir, &bin_dir, &[]));
        assert_eq!(value["resources"], serde_json::json!(["file://AGENTS.md"]));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn context_pass_verify_ok_when_target_exists() {
        let dir = scratch_dir("context-verify-ok");
        let context_dir = dir.join("context");
        fs::create_dir_all(&context_dir).unwrap();
        fs::write(context_dir.join("notes.md"), b"body").unwrap();
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({
            "resources": [format!("file://{}", context_dir.join("notes.md").display())]
        });
        ContextResourcePass
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect("existing target must verify ok");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn context_pass_verify_errors_when_target_missing() {
        let dir = scratch_dir("context-verify-missing");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({
            "resources": [format!("file://{}", context_dir.join("missing.md").display())]
        });
        let err = ContextResourcePass
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect_err("missing target must error");
        assert!(err.contains("missing.md"));
        fs::remove_dir_all(&dir).ok();
    }

    // ── SkillResourcePass ────────────────────────────────────────────

    #[test]
    fn skill_pass_matches_only_skill_prefixed_resource() {
        let with = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        let glob = serde_json::json!({"resources": ["skill://.kiro/skills/ws-*/SKILL.md"]});
        assert!(SkillResourcePass.matches(&with, &matches_only_ctx()));
        assert!(!SkillResourcePass.matches(&glob, &matches_only_ctx()));
    }

    #[test]
    fn skill_pass_rewrite_produces_absolute_raw_path() {
        let dir = scratch_dir("skill-rewrite");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let mut value = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        SkillResourcePass.rewrite(&mut value, &ctx(&context_dir, &skills_dir, &bin_dir, &[]));
        let expected = format!(
            "skill://{}",
            skills_dir.join("constraints").join("SKILL.md").display()
        );
        assert_eq!(value["resources"], serde_json::json!([expected]));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn skill_pass_verify_errors_when_target_missing() {
        let dir = scratch_dir("skill-verify-missing");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({
            "resources": [format!(
                "skill://{}",
                skills_dir.join("missing-skill").join("SKILL.md").display()
            )]
        });
        let err = SkillResourcePass
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect_err("missing skill target must error");
        assert!(err.contains("missing-skill"));
        fs::remove_dir_all(&dir).ok();
    }

    // ── McpServerPass ────────────────────────────────────────────────

    fn bin_file_entry() -> ManifestFile {
        ManifestFile {
            path: ".konductor/bin/skill-lookup-mcp".to_string(),
            sha256: Some("deadbeef".to_string()),
            provenance: crate::cli::install::manifest::Provenance::Created,
        }
    }

    #[test]
    fn mcp_pass_matches_only_when_skill_resource_already_rewritten() {
        let with_skill = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let without_skill = serde_json::json!({
            "resources": ["file://context/notes.md"]
        });
        assert!(McpServerPass.matches(&with_skill, &matches_only_ctx()));
        assert!(!McpServerPass.matches(&without_skill, &matches_only_ctx()));
        assert!(!McpServerPass.matches(&serde_json::json!({}), &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_matches_rejects_workspace_skills_glob_regression_f908d40db() {
        // f-908d40db: an agent declaring ONLY the ws-* glob (no
        // packaged skill) must never match.
        let glob_only = serde_json::json!({
            "resources": ["skill://.kiro/skills/ws-*/SKILL.md"]
        });
        assert!(!McpServerPass.matches(&glob_only, &matches_only_ctx()));

        // The glob's presence must not mask a real packaged skill.
        let both = serde_json::json!({
            "resources": [
                "skill://.kiro/skills/ws-*/SKILL.md",
                "skill://skills/constraints/SKILL.md"
            ]
        });
        assert!(McpServerPass.matches(&both, &matches_only_ctx()));

        // The post-rewrite absolute form must also match.
        let rewritten = serde_json::json!({
            "resources": ["skill:///abs/skills-dir/constraints/SKILL.md"]
        });
        assert!(McpServerPass.matches(&rewritten, &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_matches_accepts_backslash_form_regression_f2ee0918c() {
        // f-2ee0918c: the post-rewrite absolute form renders with `\`
        // on non-Unix targets; matches() must still accept it.
        let backslash_rewritten = serde_json::json!({
            "resources": ["skill://C:\\skills-dir\\constraints\\SKILL.md"]
        });
        assert!(McpServerPass.matches(&backslash_rewritten, &matches_only_ctx()));

        // The f-908d40db glob exclusion must still hold in that form.
        let backslash_glob_only = serde_json::json!({
            "resources": ["skill://.kiro\\skills\\ws-*\\SKILL.md"]
        });
        assert!(!McpServerPass.matches(&backslash_glob_only, &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_rewrite_injects_absolute_command_when_binary_installed() {
        let dir = scratch_dir("mcp-rewrite-installed");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        let bin_files = [bin_file_entry()];
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        let expected_command = bin_dir.join("skill-lookup-mcp").display().to_string();
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_command)
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(MCP_SERVER_ARGS)
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_replaces_stale_mcp_servers_entry_cleanly() {
        // Proves the unconditional `mcp_servers.insert` in `rewrite`
        // (safe today only because `value` is always read fresh from
        // `dist/`, never carrying a stale `mcpServers.konductor-skills`
        // key) is replace-not-merge and non-corrupting even when that
        // invariant is violated: seed a pre-existing entry under a
        // DIFFERENT command, plus an unrelated sibling `mcpServers`
        // entry that must survive untouched.
        let dir = scratch_dir("mcp-rewrite-replaces-stale-entry");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "mcpServers": {
                "konductor-skills": {
                    "command": "/stale/old-path/skill-lookup-mcp",
                    "args": ["--stale-flag"]
                },
                "some-other-server": {
                    "command": "/unrelated/other-server",
                    "args": []
                }
            }
        });
        let bin_files = [bin_file_entry()];
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );

        let expected_command = bin_dir.join("skill-lookup-mcp").display().to_string();
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_command),
            "the stale command must be replaced by the freshly installed binary's path"
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(MCP_SERVER_ARGS),
            "the stale args must be replaced, not merged with the new entry"
        );
        assert_eq!(
            value["mcpServers"]["some-other-server"],
            serde_json::json!({"command": "/unrelated/other-server", "args": []}),
            "an unrelated sibling mcpServers entry must be left completely untouched"
        );
        assert_eq!(
            value["mcpServers"].as_object().map(serde_json::Map::len),
            Some(2),
            "replace must not leave behind extra keys or duplicate the entry"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_appends_tool_grants_when_binary_installed() {
        let dir = scratch_dir("mcp-rewrite-grants-append");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        // Pre-existing tools/allowedTools entries (e.g. k-developer's
        // own `@aws-mcp` grant) must survive -- this pass appends,
        // never overwrites the array.
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "tools": ["@builtin", "subagent"],
            "allowedTools": ["fs_read", "fs_write"]
        });
        let bin_files = [bin_file_entry()];
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["tools"],
            serde_json::json!(["@builtin", "subagent", "@konductor-skills"]),
            "pre-existing tools entries must survive; grant must be appended"
        );
        assert_eq!(
            value["allowedTools"],
            serde_json::json!([
                "fs_read",
                "fs_write",
                "@konductor-skills/find_skills",
                "@konductor-skills/get_skill",
                "@konductor-skills/reload_skills"
            ]),
            "pre-existing allowedTools entries must survive; grants must be appended"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_grants_are_idempotent_across_reinstall() {
        let dir = scratch_dir("mcp-rewrite-grants-idempotent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "tools": ["@builtin", "subagent"],
            "allowedTools": ["fs_read"]
        });
        let bin_files = [bin_file_entry()];
        // Simulate two installs in a row against the same value (a
        // real reinstall re-reads pristine bytes from `dist/`, but the
        // dedup guard must hold even if that invariant were ever
        // violated).
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["tools"],
            serde_json::json!(["@builtin", "subagent", "@konductor-skills"]),
            "reinstall must not append a duplicate @konductor-skills tools entry"
        );
        assert_eq!(
            value["allowedTools"],
            serde_json::json!([
                "fs_read",
                "@konductor-skills/find_skills",
                "@konductor-skills/get_skill",
                "@konductor-skills/reload_skills"
            ]),
            "reinstall must not append duplicate allowedTools grants"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_does_not_inject_grants_when_binary_not_installed() {
        let dir = scratch_dir("mcp-rewrite-grants-absent-binary");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "tools": ["@builtin", "subagent"],
            "allowedTools": ["fs_read"]
        });
        // No bin_files -- binary was never copied by this run, so
        // neither the mcpServers entry NOR the grants must appear.
        McpServerPass.rewrite(&mut value, &ctx(&context_dir, &skills_dir, &bin_dir, &[]));
        assert_eq!(value["tools"], serde_json::json!(["@builtin", "subagent"]));
        assert_eq!(value["allowedTools"], serde_json::json!(["fs_read"]));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_is_noop_when_binary_not_installed() {
        let dir = scratch_dir("mcp-rewrite-absent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        // No bin_files entries -- binary was never copied by this run.
        McpServerPass.rewrite(&mut value, &ctx(&context_dir, &skills_dir, &bin_dir, &[]));
        assert!(
            value.get("mcpServers").is_none(),
            "no mcpServers entry must be injected when the binary was not installed"
        );
        fs::remove_dir_all(&dir).ok();
    }

    // ── McpServerPass: --agent-sop-paths / --agent-sop-filter ─────────

    #[test]
    fn mcp_pass_matches_sop_only_agent_with_no_skill_resource() {
        let sop_only = serde_json::json!({"name": "k-example", "resources": []});
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert("k-example".to_string(), vec!["ticket-sync".to_string()]);
        let ctx = RewriteContext {
            context_dir: Path::new(""),
            skills_dir: Path::new(""),
            bin_dir: Path::new(""),
            bin_files: &[],
            agent_sop_names: &agent_sop_names,
            agent_skill_names: empty_agent_skill_names(),
        };
        assert!(
            McpServerPass.matches(&sop_only, &ctx),
            "an agent with SOPs but no skill resource must still match, so it can get the MCP \
             server injected"
        );
    }

    #[test]
    fn mcp_pass_matches_false_when_no_skill_resource_and_no_sop_names() {
        let neither = serde_json::json!({"name": "k-example", "resources": []});
        assert!(!McpServerPass.matches(&neither, &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_rewrite_appends_agent_sop_paths_and_filter_when_agent_has_sop_names() {
        let dir = scratch_dir("mcp-rewrite-sop-present");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"name": "k-example", "resources": []});
        let bin_files = [bin_file_entry()];
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert(
            "k-example".to_string(),
            vec!["ticket-sync".to_string(), "code-review".to_string()],
        );
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: &agent_sop_names,
                agent_skill_names: empty_agent_skill_names(),
            },
        );
        let mut expected_args: Vec<String> =
            MCP_SERVER_ARGS.iter().map(|a| a.to_string()).collect();
        expected_args.push("--agent-sop-paths".to_string());
        expected_args.push("~/.konductor/sops".to_string());
        expected_args.push("--agent-sop-paths".to_string());
        expected_args.push(".konductor/sops".to_string());
        expected_args.push("--agent-sop-filter".to_string());
        expected_args.push("ticket-sync,code-review".to_string());
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(expected_args),
            "an agent with a non-empty agent_sop_names entry must get both --agent-sop-paths \
             (twice, user-level then project-local) and --agent-sop-filter appended"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Both-or-neither: an agent absent from `agent_sop_names` (never
    /// opted in) gets EXACTLY the same `args` as before this field
    /// existed -- no `--agent-sop-paths` and no `--agent-sop-filter`.
    #[test]
    fn mcp_pass_rewrite_omits_agent_sop_args_when_agent_absent_from_map() {
        let dir = scratch_dir("mcp-rewrite-sop-absent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert(
            "some-other-agent".to_string(),
            vec!["ticket-sync".to_string()],
        );
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: &agent_sop_names,
                agent_skill_names: empty_agent_skill_names(),
            },
        );
        let args = value["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        assert!(
            !args.iter().any(|v| v.as_str() == Some("--agent-sop-paths")),
            "no --agent-sop-paths must appear for an agent absent from the sidecar, got: {args:?}"
        );
        assert!(
            !args
                .iter()
                .any(|v| v.as_str() == Some("--agent-sop-filter")),
            "no --agent-sop-filter must appear for an agent absent from the sidecar, got: {args:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Same both-or-neither contract, empty-list case: an agent present
    /// in the map but with an empty `Vec` must be treated identically to
    /// being absent entirely.
    #[test]
    fn mcp_pass_rewrite_omits_agent_sop_args_when_agent_entry_is_empty() {
        let dir = scratch_dir("mcp-rewrite-sop-empty");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert("k-example".to_string(), Vec::<String>::new());
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: &agent_sop_names,
                agent_skill_names: empty_agent_skill_names(),
            },
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(MCP_SERVER_ARGS),
            "an empty agent_sop_names entry must be treated the same as an absent one"
        );
        fs::remove_dir_all(&dir).ok();
    }

    // ── McpServerPass: --skill-name-filter (agent_skill_names) ───────

    /// Mirrors `mcp_pass_matches_sop_only_agent_with_no_skill_resource`:
    /// an agent that declares `dependencies.skills.skillNames` but has
    /// no `skill://` resource at all must still match, so it can get the
    /// MCP server injected and therefore `--skill-name-filter` applied.
    #[test]
    fn mcp_pass_matches_skill_names_only_agent_with_no_skill_resource() {
        let skill_names_only = serde_json::json!({"name": "k-example", "resources": []});
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert("k-example".to_string(), vec!["constraints".to_string()]);
        let ctx = RewriteContext {
            context_dir: Path::new(""),
            skills_dir: Path::new(""),
            bin_dir: Path::new(""),
            bin_files: &[],
            agent_sop_names: empty_agent_sop_names(),
            agent_skill_names: &agent_skill_names,
        };
        assert!(
            McpServerPass.matches(&skill_names_only, &ctx),
            "an agent with agent_skill_names but no skill:// resource must still match, so it \
             can get the MCP server injected"
        );
    }

    #[test]
    fn mcp_pass_matches_false_when_no_skill_resource_and_no_skill_names() {
        let neither = serde_json::json!({"name": "k-example", "resources": []});
        assert!(!McpServerPass.matches(&neither, &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_rewrite_appends_skill_name_filter_when_agent_has_skill_names() {
        let dir = scratch_dir("mcp-rewrite-skill-filter-present");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert(
            "k-example".to_string(),
            vec!["constraints".to_string(), "sdlc-navigator".to_string()],
        );
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: empty_agent_sop_names(),
                agent_skill_names: &agent_skill_names,
            },
        );
        let mut expected_args: Vec<String> =
            MCP_SERVER_ARGS.iter().map(|a| a.to_string()).collect();
        expected_args.push("--skill-name-filter".to_string());
        expected_args.push("constraints,sdlc-navigator".to_string());
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(expected_args),
            "an agent with a non-empty agent_skill_names entry must get --skill-name-filter \
             appended, with names joined by comma in declared order"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// The single most important backward-compatibility rule: an agent
    /// absent from `agent_skill_names` (never opted in) gets EXACTLY the
    /// same `args` as before this field existed -- no
    /// `--skill-name-filter` at all.
    #[test]
    fn mcp_pass_rewrite_omits_skill_name_filter_when_agent_absent_from_map() {
        let dir = scratch_dir("mcp-rewrite-skill-filter-absent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        // A non-empty map, but with no entry for THIS agent -- proves the
        // lookup is per-agent, not "any populated map enables the filter
        // for everyone".
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert(
            "some-other-agent".to_string(),
            vec!["constraints".to_string()],
        );
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: empty_agent_sop_names(),
                agent_skill_names: &agent_skill_names,
            },
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(MCP_SERVER_ARGS),
            "an agent with no agent_skill_names entry must see the exact pre-existing args, \
             with no --skill-name-filter appended"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Same backward-compatibility rule, empty-list case: an agent
    /// present in the map but with an empty `Vec` must be treated
    /// identically to being absent entirely.
    #[test]
    fn mcp_pass_rewrite_omits_skill_name_filter_when_agent_entry_is_empty() {
        let dir = scratch_dir("mcp-rewrite-skill-filter-empty");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert("k-example".to_string(), Vec::<String>::new());
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: empty_agent_sop_names(),
                agent_skill_names: &agent_skill_names,
            },
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(MCP_SERVER_ARGS),
            "an empty agent_skill_names entry must be treated the same as an absent one"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Both scoping mechanisms can apply to the same agent independently:
    /// an agent with both `agentSopNames` and `skillNames` gets both the
    /// SOP pair and the skill-name filter appended, in the order
    /// `rewrite` applies them (SOP block first, then skill block).
    #[test]
    fn mcp_pass_rewrite_appends_both_sop_and_skill_args_when_agent_has_both() {
        let dir = scratch_dir("mcp-rewrite-both-sop-and-skill");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"name": "k-example", "resources": []});
        let bin_files = [bin_file_entry()];
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert("k-example".to_string(), vec!["ticket-sync".to_string()]);
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert("k-example".to_string(), vec!["constraints".to_string()]);
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: &agent_sop_names,
                agent_skill_names: &agent_skill_names,
            },
        );
        let args = value["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        let args: Vec<&str> = args.iter().map(|v| v.as_str().unwrap()).collect();
        assert!(
            args.contains(&"--agent-sop-filter"),
            "expected --agent-sop-filter present, got: {args:?}"
        );
        assert!(
            args.contains(&"--skill-name-filter"),
            "expected --skill-name-filter present, got: {args:?}"
        );
        assert_eq!(
            args.last().copied(),
            Some("constraints"),
            "expected the --skill-name-filter value as the last arg (skill block runs after \
             the SOP block), got: {args:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_verify_ok_when_no_entry_present() {
        let dir = scratch_dir("mcp-verify-no-entry");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({"resources": ["file://AGENTS.md"]});
        McpServerPass
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect("no mcpServers entry at all must not be an error");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_verify_errors_when_command_target_missing() {
        let dir = scratch_dir("mcp-verify-missing");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": "/definitely/not/a/real/path/skill-lookup-mcp",
                    "args": []
                }
            }
        });
        let err = McpServerPass
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect_err("a missing command target must be rejected");
        assert!(err.contains("konductor-skills"));
        assert!(err.contains("/definitely/not/a/real/path/skill-lookup-mcp"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_verify_ok_when_command_target_exists() {
        let dir = scratch_dir("mcp-verify-exists");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let binary_path = bin_dir.join("skill-lookup-mcp");
        fs::write(&binary_path, b"fake binary").unwrap();
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": binary_path.display().to_string(),
                    "args": []
                }
            }
        });
        McpServerPass
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect("an existing command target must verify ok");
        fs::remove_dir_all(&dir).ok();
    }

    // ── apply_all (pipeline composition + ordering) ─────────────────

    #[test]
    fn apply_all_runs_context_then_skill_then_mcp_in_order() {
        let dir = scratch_dir("apply-all-order");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&context_dir).unwrap();
        fs::write(context_dir.join("notes.md"), b"body").unwrap();
        fs::create_dir_all(skills_dir.join("constraints")).unwrap();
        fs::write(skills_dir.join("constraints/SKILL.md"), b"body").unwrap();
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("skill-lookup-mcp"), b"binary").unwrap();
        let bin_files = [bin_file_entry()];

        let mut value = serde_json::json!({
            "resources": [
                "file://context/notes.md",
                "skill://skills/constraints/SKILL.md"
            ]
        });
        let passes = standard_passes();
        apply_all(
            &passes,
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
            Path::new("/tmp/agent.json"),
        )
        .expect("full pipeline must succeed");

        let expected_context = format!("file://{}", context_dir.join("notes.md").display());
        let expected_skill = format!(
            "skill://{}",
            skills_dir.join("constraints").join("SKILL.md").display()
        );
        assert_eq!(
            value["resources"],
            serde_json::json!([expected_context, expected_skill])
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(bin_dir.join("skill-lookup-mcp").display().to_string())
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_all_skips_mcp_pass_when_no_skill_resource_present() {
        let dir = scratch_dir("apply-all-no-skill");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&context_dir).unwrap();
        fs::write(context_dir.join("notes.md"), b"body").unwrap();
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("skill-lookup-mcp"), b"binary").unwrap();
        let bin_files = [bin_file_entry()];

        let mut value = serde_json::json!({"resources": ["file://context/notes.md"]});
        let passes = standard_passes();
        apply_all(
            &passes,
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
            Path::new("/tmp/agent.json"),
        )
        .expect("pipeline must succeed for a context-only agent");

        assert!(
            value.get("mcpServers").is_none(),
            "an agent with no skill resource must never get an mcpServers injection, \
             even when the binary is present"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_all_stops_at_first_failing_pass() {
        let dir = scratch_dir("apply-all-stop-early");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        // Neither context/notes.md nor the skill dir exist on disk --
        // the context pass must fail first, and the skill/MCP passes
        // must never even be attempted (there is nothing to assert
        // about their output directly, but a real bug that ran them
        // anyway would still return Ok for this same input, which the
        // Err below rules out).
        let mut value = serde_json::json!({
            "resources": [
                "file://context/notes.md",
                "skill://skills/constraints/SKILL.md"
            ]
        });
        let passes = standard_passes();
        let err = apply_all(
            &passes,
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
            Path::new("/tmp/agent.json"),
        )
        .expect_err("a missing context target must fail the whole pipeline");
        assert!(err.contains("notes.md"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn standard_passes_returns_three_passes_in_documented_order() {
        // Not a type-level assertion (trait objects erase concrete
        // type), but pins the count so a future accidental duplicate-push
        // or drop is caught immediately.
        assert_eq!(standard_passes().len(), 3);
    }

    // ── McpServerPassV3 (permissions.rules[] authorization) ───────────

    #[test]
    fn mcp_server_permission_match_patterns_derives_from_v2_allowed_tools_grants() {
        assert_eq!(
            mcp_server_permission_match_patterns(),
            vec![
                "konductor-skills/find_skills".to_string(),
                "konductor-skills/get_skill".to_string(),
                "konductor-skills/reload_skills".to_string(),
            ]
        );
    }

    #[test]
    fn mcp_pass_v3_matches_only_when_skill_resource_already_rewritten() {
        let with_skill = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let without_skill = serde_json::json!({
            "resources": ["file://context/notes.md"]
        });
        assert!(McpServerPassV3.matches(&with_skill, &matches_only_ctx()));
        assert!(!McpServerPassV3.matches(&without_skill, &matches_only_ctx()));
        assert!(!McpServerPassV3.matches(&serde_json::json!({}), &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_v3_matches_for_sop_only_agent_with_no_skill_resource() {
        let sop_only = serde_json::json!({});
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert("k-example".to_string(), vec!["ticket-sync".to_string()]);
        let ctx = RewriteContext {
            context_dir: Path::new(""),
            skills_dir: Path::new(""),
            bin_dir: Path::new(""),
            bin_files: &[],
            agent_sop_names: &agent_sop_names,
            agent_skill_names: empty_agent_skill_names(),
        };
        let mut sop_only_named = sop_only.clone();
        sop_only_named["name"] = serde_json::json!("k-example");
        assert!(
            McpServerPassV3.matches(&sop_only_named, &ctx),
            "an agent with SOP scoping but no skill:// resource must still trigger the grant"
        );
    }

    #[test]
    fn mcp_pass_v3_rewrite_injects_absolute_command_when_binary_installed() {
        let dir = scratch_dir("mcp-v3-rewrite-installed");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        let expected_command = bin_dir.join("skill-lookup-mcp").display().to_string();
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_command)
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(MCP_SERVER_ARGS)
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_rewrite_injects_scoped_mcp_permission_rule() {
        let dir = scratch_dir("mcp-v3-rewrite-permission-rule");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        // Mirrors real synth output: `permissions.rules` is always
        // present (possibly empty), never absent -- see
        // `kiro_cli_v3.rs`'s own `render_agent_file` docstring.
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {"rules": []}
        });
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["permissions"]["rules"],
            serde_json::json!([{
                "capability": "mcp",
                "match": [
                    "konductor-skills/find_skills",
                    "konductor-skills/get_skill",
                    "konductor-skills/reload_skills"
                ],
                "effect": "allow"
            }])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_rewrite_preserves_other_permission_rules() {
        let dir = scratch_dir("mcp-v3-rewrite-preserves-other-rules");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        // A `shell` rule `derive_permission_rules` would have produced
        // at synth time from the agent's own `toolsSettings` -- must
        // survive completely untouched; this pass only ever appends.
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {
                "rules": [
                    {"capability": "shell", "match": ["git *"], "effect": "allow"}
                ]
            }
        });
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        let rules = value["permissions"]["rules"]
            .as_array()
            .expect("rules must remain an array");
        assert_eq!(
            rules.len(),
            2,
            "the pre-existing rule must survive alongside the new one"
        );
        assert_eq!(
            rules[0],
            serde_json::json!({"capability": "shell", "match": ["git *"], "effect": "allow"}),
            "the pre-existing shell rule must be left completely untouched"
        );
        assert_eq!(rules[1]["capability"], serde_json::json!("mcp"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_rewrite_permission_rule_is_idempotent_across_reinstall() {
        let dir = scratch_dir("mcp-v3-rewrite-idempotent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {"rules": []}
        });
        let bin_files = [bin_file_entry()];
        // Simulate two installs in a row against the same value -- a
        // real reinstall re-reads pristine bytes from `dist/`, but the
        // dedup guard must hold even if that invariant were ever
        // violated.
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        let rules = value["permissions"]["rules"]
            .as_array()
            .expect("rules must remain an array");
        assert_eq!(
            rules.len(),
            1,
            "reinstall must not append a duplicate mcp permission rule, got: {rules:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_rewrite_creates_permissions_block_when_absent() {
        // Defensive fallback only -- real synth output always emits
        // `permissions: {"rules": [...]}` (see `upsert_mcp_permission_rule`'s
        // own docstring), but a hand-edited or foreign agent file might
        // not.
        let dir = scratch_dir("mcp-v3-rewrite-creates-permissions");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["permissions"]["rules"].as_array().map(Vec::len),
            Some(1)
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Distinct from the "absent entirely" case above: `permissions` IS
    /// present as an object, but has no `"rules"` key at all -- the one
    /// mutating branch of `upsert_mcp_permission_rule` that inserts a
    /// fresh empty array before pushing into it (`permissions.insert(
    /// "rules".to_string(), ...)`). Pins the documented behavior for a
    /// hand-edited or foreign agent file whose `permissions` block omits
    /// `rules` (e.g. `{"permissions": {}}`), rather than leaving it as
    /// an assertion in that function's own docstring.
    #[test]
    fn mcp_pass_v3_rewrite_inserts_rules_key_when_permissions_object_has_none() {
        let dir = scratch_dir("mcp-v3-rewrite-permissions-object-no-rules-key");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {}
        });
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["permissions"]["rules"],
            serde_json::json!([{
                "capability": "mcp",
                "match": [
                    "konductor-skills/find_skills",
                    "konductor-skills/get_skill",
                    "konductor-skills/reload_skills"
                ],
                "effect": "allow"
            }]),
            "a `permissions` object with no pre-existing `rules` key must gain a fresh \
             one-element array, not be left untouched or overwritten wholesale"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_verify_errors_when_command_target_missing() {
        let dir = scratch_dir("mcp-v3-verify-missing");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": "/definitely/not/a/real/path/skill-lookup-mcp",
                    "args": []
                }
            }
        });
        let err = McpServerPassV3
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect_err("a missing command target must be rejected");
        assert!(err.contains("konductor-skills"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_verify_ok_when_command_target_exists() {
        let dir = scratch_dir("mcp-v3-verify-exists");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let binary_path = bin_dir.join("skill-lookup-mcp");
        fs::write(&binary_path, b"fake binary").unwrap();
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": binary_path.display().to_string(),
                    "args": []
                }
            },
            "permissions": {
                "rules": [{
                    "capability": "mcp",
                    "match": mcp_server_permission_match_patterns(),
                    "effect": "allow"
                }]
            }
        });
        McpServerPassV3
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect("an existing command target with a matching permission rule must verify ok");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_verify_errors_when_permission_rule_missing_despite_command_present() {
        // Pins the gap `upsert_mcp_permission_rule`'s malformed-shape
        // no-op could otherwise leave open: without this check, an
        // install completes "successfully" with an unusable
        // `mcpServers` entry and no error at all.
        let dir = scratch_dir("mcp-v3-verify-permission-rule-missing");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let binary_path = bin_dir.join("skill-lookup-mcp");
        fs::write(&binary_path, b"fake binary").unwrap();
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        // `mcpServers` was injected, but `permissions` is a malformed
        // shape (a string, not an object) -- exactly the shape
        // `upsert_mcp_permission_rule` no-ops on.
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": binary_path.display().to_string(),
                    "args": []
                }
            },
            "permissions": "not-an-object"
        });
        let err = McpServerPassV3
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect_err("a missing permission rule must be rejected, not silently ignored");
        assert!(
            err.contains("mcp"),
            "error must name the missing capability: {err}"
        );
        assert!(
            err.contains("agent.json"),
            "error must name the affected agent file: {err}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_verify_ok_when_mcp_server_not_injected_regardless_of_permissions() {
        // No-op case: `rewrite` injected nothing (binary not installed),
        // so there is nothing for the permission-rule check to assert --
        // mirrors `verify_mcp_server_command`'s own early return.
        let dir = scratch_dir("mcp-v3-verify-no-mcp-server");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({"permissions": "not-an-object"});
        McpServerPassV3
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect("no mcpServers entry means nothing to verify, regardless of permissions shape");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_all_v3_fails_closed_when_upsert_mcp_permission_rule_no_ops_on_malformed_permissions() {
        // End-to-end: `apply_all` runs `rewrite` then `verify`
        // immediately for `McpServerPassV3` -- confirms the full
        // pipeline surfaces the gap as a real `Err`, not just the
        // unit-level `verify` call in isolation above.
        let dir = scratch_dir("apply-all-v3-permission-rule-gap");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(skills_dir.join("constraints")).unwrap();
        fs::write(skills_dir.join("constraints/SKILL.md"), b"body").unwrap();
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("skill-lookup-mcp"), b"binary").unwrap();
        let bin_files = [bin_file_entry()];

        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            // Malformed: `permissions.rules` is a string, not an array --
            // `upsert_mcp_permission_rule` no-ops rather than attaching
            // the grant.
            "permissions": {"rules": "not-an-array"}
        });
        let passes = standard_passes_v3();
        let err = apply_all(
            &passes,
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
            Path::new("/tmp/agent.json"),
        )
        .expect_err("a malformed permissions.rules shape must fail the whole pipeline");
        assert!(
            err.contains("mcp"),
            "error must name the missing capability: {err}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn standard_passes_v3_returns_three_passes_in_documented_order() {
        assert_eq!(standard_passes_v3().len(), 3);
    }

    #[test]
    fn apply_all_v3_runs_context_then_skill_then_mcp_permission_rule_in_order() {
        let dir = scratch_dir("apply-all-v3-order");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&context_dir).unwrap();
        fs::write(context_dir.join("notes.md"), b"body").unwrap();
        fs::create_dir_all(skills_dir.join("constraints")).unwrap();
        fs::write(skills_dir.join("constraints/SKILL.md"), b"body").unwrap();
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("skill-lookup-mcp"), b"binary").unwrap();
        let bin_files = [bin_file_entry()];

        let mut value = serde_json::json!({
            "resources": [
                "file://context/notes.md",
                "skill://skills/constraints/SKILL.md"
            ],
            "permissions": {"rules": []}
        });
        let passes = standard_passes_v3();
        apply_all(
            &passes,
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
            Path::new("/tmp/agent.json"),
        )
        .expect("full V3 pipeline must succeed");

        let expected_context = format!("file://{}", context_dir.join("notes.md").display());
        let expected_skill = format!(
            "skill://{}",
            skills_dir.join("constraints").join("SKILL.md").display()
        );
        assert_eq!(
            value["resources"],
            serde_json::json!([expected_context, expected_skill])
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(bin_dir.join("skill-lookup-mcp").display().to_string())
        );
        assert_eq!(
            value["permissions"]["rules"][0]["capability"],
            serde_json::json!("mcp")
        );
        fs::remove_dir_all(&dir).ok();
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
            "a pre-existing narrower mode must survive write_atomic's fixed 0o644, not be \
             silently widened"
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
        assert_eq!(
            parsed["hooks"]["SessionStart"],
            serde_json::json!([{
                "matcher": "startup|clear",
                "hooks": [{"type": "command", "command": format!("{exe} __telemetry-hook agent-invocation")}]
            }])
        );
        assert_eq!(
            parsed["hooks"]["SubagentStart"],
            serde_json::json!([{
                "matcher": ".*",
                "hooks": [{"type": "command", "command": format!("{exe} __telemetry-hook subagent-invocation")}]
            }])
        );
        assert!(
            Path::new(&exe).is_absolute(),
            "the wired hook command must carry an absolute path, not a bare binary name \
             that depends on $PATH at hook-fire time: {exe:?}"
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

    /// Fix regression: `find_hook_match` must compare `matcher`, not
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
        let original = format!(
            "{{\"hooks\":{{\"SessionStart\":[{{\"matcher\":\"startup|clear\",\"hooks\":\
             [{{\"type\":\"command\",\"command\":\"{exe} __telemetry-hook agent-invocation\"}}]}}],\
             \"SubagentStart\":[{{\"matcher\":\".*\",\"hooks\":\
             [{{\"type\":\"command\",\"command\":\"{exe} __telemetry-hook subagent-invocation\"}}]}}]}}}}"
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
