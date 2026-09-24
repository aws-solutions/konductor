// SPDX-License-Identifier: Apache-2.0
//
// install/resource_rewrite/mod.rs — composable rewrite passes over a
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
//
// This module holds the pass-pipeline abstraction (this trait,
// `RewriteContext`, `apply_all`, `standard_passes`/`standard_passes_v3`)
// plus the two passes that implement it directly: `ContextResourcePass`
// and `SkillResourcePass`. The MCP-server injection pass, shared by V2
// and V3, lives in `mcp_server`; the one-time Claude Code
// `.claude/settings.json`/hooks mutation, which never implements
// `ResourceRewritePass`, lives in `claude_settings`.

use std::path::Path;

use super::manifest::ManifestFile;

mod claude_settings;
mod mcp_server;
mod telemetry_hook_pass;

pub(super) use claude_settings::apply_claude_settings_grant_and_hooks;
pub(crate) use claude_settings::CLAUDE_SETTINGS_RELATIVE_PATH;
pub(super) use mcp_server::{McpServerPass, MCP_SERVER_BINARY_NAME, MCP_SERVER_NAME};

use mcp_server::McpServerPassV3;
use telemetry_hook_pass::TelemetryHookPass;

pub(super) use telemetry_hook_pass::apply_v3_standalone_telemetry_hook;
// `pub(crate)`, not `pub(super)`: `uninstall.rs` (a sibling of `install`,
// not a descendant) also needs both names to clean up the untracked
// lock file alongside the manifest-tracked hook document -- see
// `V3_STANDALONE_HOOK_LOCK_FILE_NAME`'s own doc comment.
pub(crate) use telemetry_hook_pass::{
    V3_STANDALONE_HOOKS_RELATIVE_PATH, V3_STANDALONE_HOOK_LOCK_FILE_NAME,
};

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
    /// Takes `ctx` so `McpServerPass::matches` can look up the current
    /// agent's own `ctx.agent_sop_names` entry: a SOP-only agent has no
    /// skill-resource shape in `value` at all, so `matches` cannot
    /// decide whether this agent needs the MCP server from `value`
    /// alone. `ContextResourcePass`/`SkillResourcePass` ignore `ctx`;
    /// their own matching condition is fully determined by `value`.
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
/// can't be reordered), then -- unless `no_telemetry` -- the telemetry-
/// hook injection last. Adding a pass is a new `struct FooPass` plus
/// one line here -- no existing line changes.
///
/// `no_telemetry` gates `TelemetryHookPass` purely on this one flag,
/// not on `McpServerPass`'s `matches` outcome the way the Claude/V3
/// settings grant (`claude_settings.rs`) is gated on
/// `any_mcp_server_injected`: that gate is specific to Claude's
/// MCP-grant-triggered hook, while telemetry applies to every installed
/// Kiro agent regardless of MCP usage. `TelemetryHookPass::matches` is
/// itself unconditionally `true`, so omitting it from this `Vec` when
/// `no_telemetry` is the entire gate.
pub(super) fn standard_passes(no_telemetry: bool) -> Vec<Box<dyn ResourceRewritePass>> {
    let mut passes: Vec<Box<dyn ResourceRewritePass>> = vec![
        Box::new(ContextResourcePass),
        Box::new(SkillResourcePass),
        Box::new(McpServerPass),
    ];
    if !no_telemetry {
        passes.push(Box::new(TelemetryHookPass));
    }
    passes
}

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
        let passes = standard_passes(true);
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
        let passes = standard_passes(true);
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
        let passes = standard_passes(true);
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
    fn standard_passes_returns_three_passes_when_no_telemetry() {
        // Not a type-level assertion (trait objects erase concrete
        // type), but pins the count so a future accidental duplicate-push
        // or drop is caught immediately.
        assert_eq!(standard_passes(true).len(), 3);
    }

    #[test]
    fn standard_passes_includes_telemetry_hook_pass_unless_no_telemetry() {
        assert_eq!(
            standard_passes(false).len(),
            4,
            "TelemetryHookPass must be appended when telemetry is enabled"
        );
        assert_eq!(
            standard_passes(true).len(),
            3,
            "TelemetryHookPass must be omitted entirely when --no-telemetry is set"
        );
    }

    #[test]
    fn standard_passes_v3_returns_three_passes_in_documented_order() {
        assert_eq!(standard_passes_v3().len(), 3);
    }

    #[test]
    fn apply_all_with_telemetry_enabled_wires_agent_spawn_hook_for_v2() {
        let dir = scratch_dir("apply-all-telemetry-v2");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let mut value = serde_json::json!({"name": "k-example"});
        let passes = standard_passes(false);
        apply_all(
            &passes,
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
            Path::new("/tmp/agent.json"),
        )
        .expect("pipeline with telemetry enabled must succeed for a bare agent");
        assert!(
            value["hooks"]["agentSpawn"].is_array(),
            "the V2 pipeline must wire the telemetry hook under 'agentSpawn' when telemetry \
             is enabled, got: {value:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// The V3 per-agent pipeline never touches `hooks` at all -- V3's
    /// telemetry hook is a standalone `.kiro/hooks/*.json` document,
    /// written once per install run by
    /// `resource_rewrite::apply_v3_standalone_telemetry_hook`, never
    /// through this per-agent pipeline.
    #[test]
    fn apply_all_v3_never_touches_hooks_key_on_the_agent_json() {
        let dir = scratch_dir("apply-all-v3-no-hooks");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let mut value = serde_json::json!({"name": "k-example"});
        let passes = standard_passes_v3();
        apply_all(
            &passes,
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
            Path::new("/tmp/agent.json"),
        )
        .expect("v3 pipeline must succeed for a bare agent");
        assert!(
            value.get("hooks").is_none(),
            "the V3 per-agent pipeline must never write a \"hooks\" key on the agent's own \
             JSON -- telemetry for V3 is a standalone file now, got: {value:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }
}
