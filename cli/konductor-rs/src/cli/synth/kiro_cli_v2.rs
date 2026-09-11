// SPDX-License-Identifier: Apache-2.0
//
// synth/kiro_cli_v2.rs — `HarnessTransformer` for the Kiro CLI harness
// target: writes each agent, skill, and SOP in a `CanonicalModel` out
// as Kiro CLI output (agent config JSON, `SKILL.md` + auxiliary files,
// `.sop.md`).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::content_writers::{write_all_context, write_all_skills, write_all_sops};
#[cfg(test)]
use super::content_writers::{write_auxiliary_file, write_skill, write_sop};
use super::model::CanonicalModel;
#[cfg(test)]
use super::model::{AuxiliaryFile, ContextDef, SkillDef, SopDef};
use super::parser::KiroCliConfig;
use super::path_safety::reject_unsafe_agent_name;
#[cfg(test)]
use super::path_safety::{
    reject_unsafe_auxiliary_relative_path, reject_unsafe_name_segment, reject_unsafe_skill_name,
    reject_unsafe_sop_name,
};
use super::staging::stage_content_type;
use super::HarnessTransformer;

/// Content-type segment of the agent output directory. Joined onto
/// `name()` to form the full path relative to `output_root`.
pub(crate) const AGENTS_CONTENT_TYPE_DIR: &str = "agents";
/// Content-type segment of the skill output directory.
pub(crate) const SKILLS_CONTENT_TYPE_DIR: &str = "skills";
/// Content-type segment of the SOP output directory.
pub(crate) const SOPS_CONTENT_TYPE_DIR: &str = "sops";
/// Content-type segment of the context output directory.
pub(crate) const CONTEXT_CONTENT_TYPE_DIR: &str = "context";

/// On-disk shape of a Kiro CLI agent config file. Field order and names
/// mirror Kiro's own agent config format, not `KiroCliConfig`'s
/// snake_case IR fields.
#[derive(Serialize)]
struct KiroAgentFile<'a> {
    name: &'a str,
    description: &'a str,
    prompt: &'a str,
    model: &'a str,
    tools: &'a [String],
    #[serde(rename = "allowedTools")]
    allowed_tools: &'a [String],
    #[serde(rename = "toolsSettings")]
    tools_settings: &'a serde_json::Value,
    #[serde(rename = "mcpServers")]
    mcp_servers: serde_json::Value,
    hooks: serde_json::Value,
    resources: Vec<String>,
}

/// Transforms `CanonicalModel` agents, skills, and SOPs into Kiro CLI
/// output. Agents with no `clientConfig.kiroCli` section are skipped:
/// they don't target this harness. Every skill and SOP is emitted
/// unconditionally (skills/SOPs have no per-harness client config to
/// gate on). Each content type is staged in a sibling temp directory
/// and atomically swapped into place, so a failure partway through
/// never leaves a half-written `agents/`, `skills/`, or `sops/` tree.
pub struct KiroCliV2Transformer;

impl HarnessTransformer for KiroCliV2Transformer {
    fn name(&self) -> &'static str {
        "kiro-cli-v2"
    }

    fn transform(&self, model: &CanonicalModel, output_root: &Path) -> Result<(), String> {
        let base_dir = output_root.join(self.name());

        stage_content_type(&base_dir, AGENTS_CONTENT_TYPE_DIR, |staging_dir| {
            let skill_names: HashSet<&str> = model.skills.iter().map(|s| s.name.as_str()).collect();
            for agent in &model.agents {
                let Some(kiro) = &agent.client_config.kiro_cli else {
                    continue;
                };
                let file = render_agent_file(
                    &agent.name,
                    &agent.config,
                    kiro,
                    &agent.dependencies.context.context_names,
                    &skill_names,
                )?;
                write_agent_file(staging_dir, &agent.name, &file)?;
            }
            write_sop_scopes_sidecar(staging_dir, &model.agents)?;
            write_skill_scopes_sidecar(staging_dir, &model.agents)?;
            Ok(())
        })?;

        stage_content_type(&base_dir, SKILLS_CONTENT_TYPE_DIR, |staging_dir| {
            write_all_skills(staging_dir, &model.skills)
        })?;

        stage_content_type(&base_dir, SOPS_CONTENT_TYPE_DIR, |staging_dir| {
            write_all_sops(staging_dir, &model.sops)
        })?;

        stage_content_type(&base_dir, CONTEXT_CONTENT_TYPE_DIR, |staging_dir| {
            write_all_context(staging_dir, &model.context)
        })?;

        Ok(())
    }
}

/// Builds the on-disk JSON shape for one agent from its config and
/// `KiroCliConfig`. `mcp_servers` is re-keyed to a plain JSON object
/// since Kiro's config format has no typed `McpServerDef` shape.
///
/// `context_names` (an agent spec's `dependencies.context.contextNames`)
/// appends one `file://context/<name>` entry per name onto the source
/// spec's own `resources` list, preserving whatever it already
/// declared. The path is relative and deliberately not rewritten to an
/// absolute form here -- `dist/` must stay destination-agnostic;
/// `install` is what rewrites it to an absolute path (see
/// `install::kiro_cli`).
///
/// `skill_names` (every packaged skill's name, from
/// `CanonicalModel.skills`) drives normalization of each pre-existing
/// `resources` entry that names a packaged skill (see
/// `normalize_skill_resource`): matched entries become the relative
/// `skill://skills/<name>/SKILL.md` form; anything else (a glob like
/// `skill://.kiro/skills/ws-*/SKILL.md`, or a hand-authored `file://`
/// entry) passes through untouched. Returns `Err` when an entry looks
/// like a single packaged-skill reference but names no real skill.
fn render_agent_file<'a>(
    name: &'a str,
    config: &'a super::parser::AgentConfig,
    kiro: &'a KiroCliConfig,
    context_names: &[String],
    skill_names: &HashSet<&str>,
) -> Result<KiroAgentFile<'a>, String> {
    // Per-entry field extraction goes through `McpServerDef::
    // command_args_url` -- see that method's docstring for why it's
    // shared with `claude.rs`'s own `mcp_servers` renderer despite the
    // two producing structurally different container shapes (a JSON
    // object keyed by server name here, vs. a YAML sequence of
    // single-key maps there). `args` is always emitted as an array
    // (never omitted, even when empty) -- unlike `claude.rs`, which
    // omits an empty `args:` key -- because Kiro's own config schema
    // expects the key present.
    let mcp_servers = serde_json::Value::Object(
        kiro.mcp_servers
            .iter()
            .map(|(server_name, def)| {
                let (command, args, url) = def.command_args_url();
                let mut entry = serde_json::Map::new();
                if let Some(command) = command {
                    entry.insert(
                        "command".to_string(),
                        serde_json::Value::String(command.to_string()),
                    );
                }
                entry.insert(
                    "args".to_string(),
                    serde_json::Value::Array(
                        args.iter()
                            .cloned()
                            .map(serde_json::Value::String)
                            .collect(),
                    ),
                );
                if let Some(url) = url {
                    entry.insert(
                        "url".to_string(),
                        serde_json::Value::String(url.to_string()),
                    );
                }
                (server_name.clone(), serde_json::Value::Object(entry))
            })
            .collect(),
    );

    let mut resources = kiro
        .resources
        .iter()
        .map(|entry| normalize_skill_resource(entry, skill_names, name))
        .collect::<Result<Vec<_>, _>>()?;
    for context_name in context_names {
        resources.push(format!("file://{CONTEXT_CONTENT_TYPE_DIR}/{context_name}"));
    }

    Ok(KiroAgentFile {
        name,
        description: &config.description,
        prompt: &config.system_prompt,
        model: &config.model,
        tools: &kiro.tools,
        allowed_tools: &kiro.allowed_tools,
        tools_settings: &kiro.tools_settings,
        mcp_servers,
        hooks: serde_json::Value::Object(
            kiro.hooks
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        ),
        resources,
    })
}

/// Matches a hand-authored `skill://` resource entry naming a single
/// packaged skill's SKILL.md, regardless of the path prefix the spec
/// author used ahead of the skill name (`~/.kiro/skills/`,
/// `.kiro/skills/`, or already the normalized `skills/` form).
/// Deliberately does not match a glob (e.g. `ws-*`): a `*` in the name
/// segment fails this check, so a wildcard entry falls through to
/// `normalize_skill_resource`'s untouched-passthrough branch.
///
/// Shared with `parse_canonical::check_dangling_skill_references` so
/// synth/install/doctor agree on exactly one definition of "is this a
/// packaged-skill reference".
pub(crate) fn match_skill_resource(entry: &str) -> Option<&str> {
    let rest = entry.strip_prefix("skill://")?;
    let rest = rest.strip_prefix("~/").unwrap_or(rest);
    let rest = rest
        .strip_prefix(".kiro/skills/")
        .or_else(|| rest.strip_prefix("skills/"))?;
    let name = rest.strip_suffix("/SKILL.md")?;
    if name.is_empty() || name.contains('/') || name.contains('*') {
        return None;
    }
    Some(name)
}

/// Normalizes one `resources` entry so `dist/` output stays
/// destination-agnostic (see `render_agent_file`'s docstring). Three
/// outcomes:
///
/// 1. Not shaped like a single packaged-skill reference at all (any
///    other `file://`/`skill://` entry, or a `skill://` glob such as
///    `skill://.kiro/skills/ws-*/SKILL.md`) -- passed through exactly
///    as authored.
/// 2. Shaped like one, and `<name>` is a real packaged skill --
///    rewritten to the relative `skill://skills/<name>/SKILL.md` form;
///    `install` (not synth) makes this absolute, mirroring the
///    context-resource rewrite split between synth and install.
/// 3. Shaped like one, but `<name>` matches no packaged skill -- `Err`
///    (mapped to `EXIT_USAGE_ERROR` by `dispatch_synth`), naming the
///    agent and the missing skill, same treatment as a dangling
///    `contextNames` entry.
fn normalize_skill_resource(
    entry: &str,
    skill_names: &HashSet<&str>,
    agent_name: &str,
) -> Result<String, String> {
    let Some(skill_name) = match_skill_resource(entry) else {
        return Ok(entry.to_string());
    };
    if !skill_names.contains(skill_name) {
        return Err(format!(
            "agent '{agent_name}' declares skill resource '{entry}', but no skill named \
             '{skill_name}' exists under skills/"
        ));
    }
    Ok(format!(
        "skill://{SKILLS_CONTENT_TYPE_DIR}/{skill_name}/SKILL.md"
    ))
}

/// File name of the per-run SOP-scope sidecar, staged alongside the
/// per-agent output files under `dist/<harness>/agents/`. A leading
/// underscore is a valid, unrejected agent-name path segment on its
/// own, so the collision this filename could cause with a real agent
/// (an agent literally named `_sop_scopes`) is closed by a dedicated
/// reservation, not by the underscore: both `parser::validate_agent_name`
/// (parse time) and `path_safety::reject_unsafe_agent_name` (path
/// construction time, for a `ParsedAgentSpec` built directly without
/// going through the parser) reject the reserved literal
/// (`path_safety::RESERVED_SOP_SCOPES_AGENT_NAME`) case-insensitively --
/// see that constant's own doc comment for the full collision this
/// closes. `pub(crate)`: `claude.rs`'s own transformer imports this and
/// `write_sop_scopes_sidecar` directly rather than duplicating them,
/// since the sidecar's shape and write logic have no per-harness
/// variation -- only the destination root (`dist/kiro-cli-v2/agents/` vs
/// `dist/claude/agents/`) differs, and that's supplied by each caller's
/// own `staging_dir`.
pub(crate) const SOP_SCOPES_SIDECAR_FILE: &str = "_sop_scopes.json";

/// Writes `<staging_dir>/_sop_scopes.json`: a `{ "<agent-name>":
/// ["<sopName>", ...] }` map from every agent's own `dependencies.
/// agentSops.agentSopNames` declaration -- the per-agent SOP allowlist.
/// Only Kiro CLI's install side reads this back (`read_sop_scopes_sidecar`
/// in `install/kiro_cli/plan.rs`, to scope `--agent-sop-filter` for
/// `skill-lookup-mcp`). Claude Code's own `install_sop_skills` converts
/// every staged `.sop.md` file into a `sop-<name>/SKILL.md` unconditionally
/// (see `SopInstallPhase`'s own doc comment: Claude Code has no per-agent
/// server-side filtering mechanism to scope with), and its
/// `list_agent_files_md` filters to `.md` files only, so it never even
/// reads this `.json` sidecar back. The write for Claude still happens
/// unconditionally, same as for Kiro -- not for scoping, but so
/// `write_agent_file`'s `reject_unsafe_agent_name` collision guard against
/// an agent literally named `_sop_scopes` (see `RESERVED_SOP_SCOPES_
/// AGENT_NAME`) applies on both harness outputs. An agent
/// with no declared SOP names is omitted entirely (absent and
/// empty-list are deliberately equivalent on every read side -- see
/// `RewriteContext::agent_sop_names`'s own doc comment in
/// `install::resource_rewrite`), and entries are sorted by agent name (a
/// `BTreeMap`) so this file's bytes are reproducible across synth runs
/// regardless of `CanonicalModel.agents`' iteration order.
///
/// Rejects a SOP name containing a comma before writing: install joins
/// a filtered agent's SOP names with `,` to build
/// `--agent-sop-filter` (see `resource_rewrite::McpServerPass::rewrite`),
/// so a comma embedded in a SOP name would corrupt that joined filter
/// string -- `validate_sop_name` (`parse_canonical.rs`) does not reject
/// a comma today, so this check is the only thing standing between a
/// comma-containing SOP name and a silently-broken filter at install
/// time. The agent name itself is not re-validated here: `write_agent_file`
/// (called for every agent in the same `transform()` pass) already runs
/// `reject_unsafe_agent_name` on it, so a duplicate check here would be
/// redundant.
///
/// Unlike `dependencies.skills.skillNames` (a wrapper object requiring
/// `parse_canonical::skill_names_from_dependencies` to extract),
/// `dependencies.agentSops.agentSopNames` is already a plain
/// `Vec<String>` on the parsed IR (see `parser::AgentSopDeps`), so no
/// extraction helper is needed here.
///
/// Called unconditionally over every agent in the model -- independent
/// of whether that particular agent targets THIS harness, since the
/// sidecar's own destination (`staging_dir`) is already scoped to this
/// harness by the caller; there is no separate per-agent harness filter
/// to apply on top of that.
pub(crate) fn write_sop_scopes_sidecar(
    staging_dir: &Path,
    agents: &[super::parser::ParsedAgentSpec],
) -> Result<(), String> {
    let mut scopes: std::collections::BTreeMap<&str, &[String]> = std::collections::BTreeMap::new();
    for agent in agents {
        let names = &agent.dependencies.agent_sops.agent_sop_names;
        if names.is_empty() {
            continue;
        }
        for name in names {
            if name.contains(',') {
                return Err(format!(
                    "agent '{}' declares SOP name '{name}', which contains a comma -- \
                     install joins agentSopNames with ',' to build --agent-sop-filter, so \
                     a comma in a name would corrupt that filter string",
                    agent.name
                ));
            }
        }
        scopes.insert(agent.name.as_str(), names.as_slice());
    }

    let mut rendered = serde_json::to_string_pretty(&scopes)
        .map_err(|e| format!("failed to serialize {SOP_SCOPES_SIDECAR_FILE}: {e}"))?;
    rendered.push('\n');
    let path = staging_dir.join(SOP_SCOPES_SIDECAR_FILE);
    fs::write(&path, rendered).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// File name of the per-run skill-scope sidecar, staged alongside the
/// per-agent output files under `dist/<harness>/agents/`. Mirrors
/// `SOP_SCOPES_SIDECAR_FILE` exactly -- same underscore-prefix rationale,
/// same collision-closing mechanism (both `parser::validate_agent_name`
/// and `path_safety::reject_unsafe_agent_name` reject the reserved
/// literal, `path_safety::RESERVED_SKILL_SCOPES_AGENT_NAME`, case-
/// insensitively), and same reasoning for being written unconditionally
/// on both harness outputs. `pub(crate)`: read back by Kiro CLI's
/// install side (`read_skill_scopes_sidecar` in
/// `install/kiro_cli/plan.rs`) and by this module's own tests.
pub(crate) const SKILL_SCOPES_SIDECAR_FILE: &str = "_skill_scopes.json";

/// Writes `<staging_dir>/_skill_scopes.json`: a `{ "<agent-name>":
/// ["<skillName>", ...] }` map from every agent's own `dependencies.
/// skills.skillNames` declaration -- the Kiro-runtime skill allowlist
/// (see `parse_canonical::check_skill_scope_consistency`'s doc comment
/// for that field's documented meaning in this workspace). Only Kiro
/// CLI's install side reads this back (`read_skill_scopes_sidecar` in
/// `install/kiro_cli/plan.rs`, to scope `--skill-name-filter` for
/// `skill-lookup-mcp`) -- this file is the only thing that carries that
/// scoping decision from synth to install, since `KiroAgentFile`'s own
/// serialized shape has no field for it (see this crate's own convention
/// of never adding an unverified field to the struct that mirrors Kiro
/// CLI's real, external agent-config schema).
///
/// Unlike `dependencies.agentSops.agentSopNames` (already a plain
/// `Vec<String>` on the parsed IR), `dependencies.skills` is a wrapper
/// object requiring `parse_canonical::skill_names_from_dependencies` to
/// extract -- the same extraction `check_skill_scope_consistency` uses,
/// so the two can never define "the skillNames this agent declares"
/// differently.
///
/// Only agents with at least one declared skill name are included -- an
/// agent with none is indistinguishable, for the install-side consumer's
/// purposes, from one absent from the map entirely (both mean "do not
/// pass `--skill-name-filter`" -- see that consumer's own doc comment
/// for why empty/absent is the deliberate default-safe case), so
/// omitting empty entries keeps this sidecar's size proportional to the
/// specs that actually opt into scoping rather than to the full agent
/// count.
///
/// Rejects a skill name containing a comma before writing, mirroring
/// `write_sop_scopes_sidecar`'s own guard exactly: install joins a
/// filtered agent's skill names with `,` to build `--skill-name-filter`
/// (see `resource_rewrite::McpServerPass::rewrite`), so a comma embedded
/// in a skill name would corrupt that joined filter string --
/// `parse_canonical::validate_skill_name` does not reject a comma today
/// (skill names are lowercase/digits/hyphens by convention, so this is
/// belt-and-suspenders, not an expected real case), so this check is the
/// only thing standing between a comma-containing skill name and a
/// silently-broken filter at install time.
///
/// Sorted by agent name (a `BTreeMap`, not the model's own agent order)
/// so this file's content -- and therefore its bytes -- is reproducible
/// across synth runs regardless of `CanonicalModel.agents`' iteration
/// order, matching every other synth output's determinism contract.
///
/// Called unconditionally over every agent in the model -- independent
/// of whether that particular agent targets THIS harness, mirroring
/// `write_sop_scopes_sidecar`'s own unconditional scope (see that
/// function's own doc comment for why: the sidecar's own destination is
/// already scoped to this harness by the caller).
pub(crate) fn write_skill_scopes_sidecar(
    staging_dir: &Path,
    agents: &[super::parser::ParsedAgentSpec],
) -> Result<(), String> {
    let mut scopes: std::collections::BTreeMap<&str, Vec<&str>> = std::collections::BTreeMap::new();
    for agent in agents {
        let names: Vec<&str> =
            super::parse_canonical::skill_names_from_dependencies(&agent.dependencies.skills)
                .collect();
        if names.is_empty() {
            continue;
        }
        for name in &names {
            if name.contains(',') {
                return Err(format!(
                    "agent '{}' declares skill name '{name}', which contains a comma -- \
                     install joins skillNames with ',' to build --skill-name-filter, so a \
                     comma in a name would corrupt that filter string",
                    agent.name
                ));
            }
        }
        scopes.insert(agent.name.as_str(), names);
    }

    let mut rendered = serde_json::to_string_pretty(&scopes)
        .map_err(|e| format!("failed to serialize {SKILL_SCOPES_SIDECAR_FILE}: {e}"))?;
    rendered.push('\n');
    let path = staging_dir.join(SKILL_SCOPES_SIDECAR_FILE);
    fs::write(&path, rendered).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// Writes `file` as pretty-printed JSON to `<output_dir>/<agent_name>.json`,
/// creating `output_dir` if needed. A trailing newline is appended after
/// the pretty-printed JSON, matching POSIX text-file convention so the
/// output is diffable with standard line-based tooling.
///
/// Numeric leaves are normalized (see `normalize_numbers`) before
/// serializing, independent of `serde_json`'s `arbitrary_precision`
/// feature (see `Cargo.toml`): a float-shaped source literal like
/// `1.50`/`1e3` renders as `1.5`/`1000.0`, while a genuinely
/// integer-shaped literal (any magnitude) renders with its exact
/// digits.
fn write_agent_file(
    output_dir: &Path,
    agent_name: &str,
    file: &KiroAgentFile,
) -> Result<(), String> {
    reject_unsafe_agent_name(agent_name)?;
    fs::create_dir_all(output_dir)
        .map_err(|e| format!("failed to create directory {}: {e}", output_dir.display()))?;
    let value = serde_json::to_value(file)
        .map_err(|e| format!("failed to serialize agent '{agent_name}': {e}"))?;
    let mut rendered = serde_json::to_string_pretty(&normalize_numbers(value))
        .map_err(|e| format!("failed to serialize agent '{agent_name}': {e}"))?;
    rendered.push('\n');
    let path: PathBuf = output_dir.join(format!("{agent_name}.json"));
    fs::write(&path, rendered).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// Recursively normalizes every `Number` leaf in `value` to the digit
/// text `serde_json::to_string`/`to_string_pretty` would produce
/// without `arbitrary_precision` enabled: an integer-shaped literal
/// (no `.`/`e`/`E` in its source text, any magnitude) is left as-is;
/// any other numeric literal is re-rendered through `f64`, collapsing
/// a source form like `1.50` or `1e3` to `1.5`/`1000.0`. Object key
/// order is preserved (`preserve_order` is unaffected).
fn normalize_numbers(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Number(n) => serde_json::Value::Number(normalize_number(n)),
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.into_iter().map(normalize_numbers).collect())
        }
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, normalize_numbers(v)))
                .collect(),
        ),
        other => other,
    }
}

/// Normalizes one `Number`: unchanged if it already fits `i64`/`u64` or
/// is integer-shaped beyond that range, otherwise rebuilt from its
/// `f64` value so its digit text matches what parsing it without
/// `arbitrary_precision` would have produced.
///
/// `claude.rs::json_number_to_yaml_number` solves the same underlying
/// problem class (a `serde_json::Number` produced under this crate's
/// `arbitrary_precision` feature needing to reach a downstream
/// serializer safely) for a different output path, via a deliberately
/// different strategy -- see that function's docstring for why: its
/// target type (`serde_yaml::Number`) has no arbitrary-precision
/// variant, so it must saturate to a sign-preserving finite `f64` for a
/// literal whose magnitude overflows `f64`'s own finite range. This
/// function's target type is still `serde_json::Number` under
/// `arbitrary_precision`, which already carries the literal's exact
/// digit text regardless of whether `as_f64()` can represent it -- so
/// for that same overflow case, `as_f64()` returning `None` is handled
/// by returning `n` unchanged rather than substituting any numeric
/// stand-in: the exact original digits are already the correct answer,
/// and no lossy `f64` round-trip is needed to reach it.
fn normalize_number(n: serde_json::Number) -> serde_json::Number {
    if n.as_i64().is_some() || n.as_u64().is_some() {
        return n;
    }
    let text = n.to_string();
    if !text.contains('.') && !text.contains('e') && !text.contains('E') {
        return n;
    }
    let Some(f) = n.as_f64() else {
        return n;
    };
    serde_json::Number::from_f64(f).unwrap_or(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::synth::parser::{
        AgentConfig, AgentDependencies, ClientConfig, McpServerDef, ParsedAgentSpec,
    };
    use indexmap::IndexMap;

    fn agent_with_kiro(name: &str, kiro: KiroCliConfig) -> ParsedAgentSpec {
        ParsedAgentSpec {
            name: name.to_string(),
            config: AgentConfig {
                description: "A test agent.".to_string(),
                system_prompt: "You are a test agent.".to_string(),
                model: "claude-sonnet-5".to_string(),
            },
            dependencies: AgentDependencies::default(),
            client_config: ClientConfig {
                kiro_cli: Some(kiro),
                claude_cli: None,
            },
        }
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-kiro-cli-transformer-test-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The output dir `transform`/`write_agent_file` write into, relative
    /// to `output_root`: `<name()>/<content-type>`.
    fn expected_output_dir() -> PathBuf {
        Path::new(KiroCliV2Transformer.name()).join(AGENTS_CONTENT_TYPE_DIR)
    }

    fn minimal_skill(name: &str) -> SkillDef {
        SkillDef {
            name: name.to_string(),
            raw_frontmatter: format!("name: {name}\ndescription: A test skill."),
            body: "# Body\n\nContent.\n".to_string(),
            auxiliary_files: Vec::new(),
        }
    }

    /// Regression guard for the CRITICAL fix to `normalize_number`: a JSON
    /// number literal whose magnitude overflows `f64`'s own finite range
    /// (reachable under this crate's `arbitrary_precision` feature, e.g.
    /// `1e400`) must pass through with its exact original digits, not
    /// silently collapse to `0` via the old `as_f64().unwrap_or(0.0)`
    /// fallback -- verified directly that `serde_json`'s `as_f64()` returns
    /// `None` (not `Some(f64::INFINITY)`) for such a literal, so the old
    /// code's fallback branch fired unconditionally and reported "zero" for
    /// whatever enormous value the source spec actually declared.
    #[test]
    fn normalize_number_preserves_exact_digits_for_out_of_range_magnitude() {
        let positive: serde_json::Number = serde_json::from_str("1e400").unwrap();
        assert_eq!(
            positive.as_f64(),
            None,
            "sanity: must reproduce the None case"
        );
        let positive_text = positive.to_string();
        assert_eq!(
            normalize_number(positive).to_string(),
            positive_text,
            "an out-of-range positive literal must keep its exact digits, not become 0"
        );

        let negative: serde_json::Number = serde_json::from_str("-1e400").unwrap();
        assert_eq!(
            negative.as_f64(),
            None,
            "sanity: must reproduce the None case"
        );
        let negative_text = negative.to_string();
        assert_eq!(
            normalize_number(negative).to_string(),
            negative_text,
            "an out-of-range negative literal must keep its exact digits, not become 0"
        );
    }

    #[test]
    fn name_returns_kiro_cli_v2() {
        assert_eq!(KiroCliV2Transformer.name(), "kiro-cli-v2");
    }

    #[test]
    fn skips_agents_without_kiro_cli_client_config() {
        let mut agent = agent_with_kiro("has-kiro", KiroCliConfig::default());
        agent.client_config.kiro_cli = None;
        let model = CanonicalModel {
            agents: vec![agent],
            ..Default::default()
        };
        let dir = temp_dir("skip");
        // transform() writes into a name()-derived dir joined onto
        // output_root; skip exercises the loop's early-continue, not
        // filesystem output, so no directory assertion is needed here.
        assert!(KiroCliV2Transformer.transform(&model, &dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn render_agent_file_maps_config_and_kiro_fields() {
        let mut mcp_servers = IndexMap::new();
        mcp_servers.insert(
            "example-mcp".to_string(),
            McpServerDef {
                command: Some("uvx".to_string()),
                args: vec!["example-mcp@latest".to_string()],
                url: None,
            },
        );
        let kiro = KiroCliConfig {
            tools: vec!["@builtin".to_string()],
            allowed_tools: vec!["fs_read".to_string()],
            tools_settings: serde_json::json!({"subagent": {"trustedAgents": ["x"]}}),
            hooks: IndexMap::new(),
            mcp_servers,
            resources: vec!["file://AGENTS.md".to_string()],
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        assert_eq!(file.name, "k-example");
        assert_eq!(file.description, "A test agent.");
        assert_eq!(file.prompt, "You are a test agent.");
        assert_eq!(file.model, "claude-sonnet-5");
        assert_eq!(file.tools, &["@builtin".to_string()]);
        assert_eq!(file.allowed_tools, &["fs_read".to_string()]);
        assert_eq!(file.resources, &["file://AGENTS.md".to_string()]);
        assert_eq!(
            file.mcp_servers["example-mcp"]["command"],
            serde_json::Value::String("uvx".to_string())
        );
    }

    #[test]
    fn render_agent_file_appends_relative_context_resource_entries() {
        let kiro = KiroCliConfig {
            resources: vec!["file://AGENTS.md".to_string()],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let context_names = vec!["routing-rules.md".to_string()];
        let file = render_agent_file(
            &agent.name,
            &agent.config,
            kiro_cfg,
            &context_names,
            &HashSet::new(),
        )
        .unwrap();

        assert_eq!(
            file.resources,
            vec![
                "file://AGENTS.md".to_string(),
                "file://context/routing-rules.md".to_string(),
            ]
        );
    }

    #[test]
    fn render_agent_file_with_no_context_names_leaves_resources_unchanged() {
        let kiro = KiroCliConfig {
            resources: vec!["file://AGENTS.md".to_string()],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        assert_eq!(file.resources, vec!["file://AGENTS.md".to_string()]);
    }

    /// `match_skill_resource` is `pub(crate)` specifically so this one
    /// function backs BOTH call sites -- `normalize_skill_resource`
    /// here and `parse_canonical::check_dangling_skill_references` --
    /// rather than each duplicating its own prefix-stripping logic.
    /// Asserting its output here is the parity guarantee: any future
    /// change to its stripping rules is checked once, for both
    /// callers, instead of relying on them staying in sync by hand.
    #[test]
    fn match_skill_resource_parity_across_both_call_sites() {
        let cases: &[(&str, Option<&str>)] = &[
            // Normal single-prefixed cases, one per supported prefix.
            (
                "skill://~/.kiro/skills/constraints/SKILL.md",
                Some("constraints"),
            ),
            (
                "skill://.kiro/skills/constraints/SKILL.md",
                Some("constraints"),
            ),
            ("skill://skills/constraints/SKILL.md", Some("constraints")),
            // Double prefix: after stripping `~/` then `.kiro/skills/`,
            // the remainder is `skills/foo/SKILL.md` -- the embedded
            // `skills/` segment does NOT get stripped a second time
            // (only one of `.kiro/skills/`/`skills/` is ever
            // consumed), so the name portion still contains a `/` and
            // must be rejected (a skill name may not itself contain a
            // path separator).
            ("skill://~/.kiro/skills/skills/foo/SKILL.md", None),
            // Empty name segment: prefix strips cleanly but leaves
            // nothing before `/SKILL.md`.
            ("skill://.kiro/skills//SKILL.md", None),
            ("skill://skills//SKILL.md", None),
            // Trailing slash on the name itself (no SKILL.md suffix at
            // all) never matches the required `/SKILL.md` suffix.
            ("skill://.kiro/skills/constraints/", None),
            // Bare name with no recognized prefix at all.
            ("skill://constraints/SKILL.md", None),
            // Not a `skill://` entry at all.
            ("file://AGENTS.md", None),
            // A glob is never a single named skill.
            ("skill://.kiro/skills/ws-*/SKILL.md", None),
        ];

        for (entry, expected) in cases {
            assert_eq!(
                match_skill_resource(entry),
                *expected,
                "match_skill_resource({entry:?}) diverged from the expected normalized \
                 name -- this function is shared verbatim by normalize_skill_resource \
                 (kiroCli) and check_dangling_skill_references (parse_canonical), so any \
                 divergence here means those two call sites would disagree too"
            );
        }
    }

    /// Core normalization behavior: a hand-authored `skill://~/.kiro/skills/<name>/SKILL.md`
    /// entry naming a real packaged skill is rewritten to the relative
    /// `skill://skills/<name>/SKILL.md` form, so `dist/` stays
    /// destination-agnostic (mirrors the context-resource split between
    /// synth and install).
    #[test]
    fn render_agent_file_normalizes_packaged_skill_resource_to_relative_form() {
        let kiro = KiroCliConfig {
            resources: vec!["skill://~/.kiro/skills/constraints/SKILL.md".to_string()],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let skill_names: HashSet<&str> = ["constraints"].into_iter().collect();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &skill_names).unwrap();

        assert_eq!(
            file.resources,
            vec!["skill://skills/constraints/SKILL.md".to_string()]
        );
    }

    /// A `skill://` glob entry (the user's own workspace-skills
    /// convention, e.g. `konductor`'s `ws-*` reference) must
    /// pass through untouched -- it names no single packaged skill and
    /// must never be resolved or rewritten.
    #[test]
    fn render_agent_file_leaves_workspace_skill_glob_untouched() {
        let kiro = KiroCliConfig {
            resources: vec!["skill://.kiro/skills/ws-*/SKILL.md".to_string()],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        assert_eq!(
            file.resources,
            vec!["skill://.kiro/skills/ws-*/SKILL.md".to_string()]
        );
    }

    /// A hand-authored `file://` entry (e.g. `file://AGENTS.md`) is not
    /// a `skill://` entry at all and must pass through untouched.
    #[test]
    fn render_agent_file_leaves_file_resource_untouched() {
        let kiro = KiroCliConfig {
            resources: vec!["file://AGENTS.md".to_string()],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        assert_eq!(file.resources, vec!["file://AGENTS.md".to_string()]);
    }

    /// The exact bug this feature exists to prevent: a `skill://` entry
    /// shaped like a single packaged-skill reference, but naming a skill
    /// that doesn't exist under `skills/`, must fail loudly (mapped to
    /// `EXIT_USAGE_ERROR` by `dispatch_synth`) rather than silently
    /// shipping a dangling reference -- same treatment as a dangling
    /// `contextNames` entry.
    /// This fails (returns `Ok` instead of `Err`) if
    /// `normalize_skill_resource`'s `if !skill_names.contains(..)` guard
    /// is ever removed.
    #[test]
    fn render_agent_file_rejects_dangling_skill_resource() {
        let kiro = KiroCliConfig {
            resources: vec!["skill://~/.kiro/skills/does-not-exist/SKILL.md".to_string()],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let result = render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new());
        let err = match result {
            Ok(_) => panic!("expected a dangling skill resource to be rejected"),
            Err(e) => e,
        };
        assert!(err.contains("k-example"));
        assert!(err.contains("does-not-exist"));
    }

    /// `transform` itself (not just `render_agent_file` in isolation)
    /// must surface the same dangling-skill failure as a transformer
    /// error, mapped to `EXIT_USAGE_ERROR` by the caller.
    #[test]
    fn transform_rejects_agent_with_dangling_skill_resource() {
        let dir = temp_dir("dangling-skill-transform");
        let kiro = KiroCliConfig {
            resources: vec!["skill://~/.kiro/skills/does-not-exist/SKILL.md".to_string()],
            ..Default::default()
        };
        let model = CanonicalModel {
            agents: vec![agent_with_kiro("k-example", kiro)],
            ..Default::default()
        };
        let result = KiroCliV2Transformer.transform(&model, &dir);
        assert!(
            result.is_err(),
            "expected transform to reject a dangling skill resource"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Scoping proof: an agent's normalized `resources` only ever
    /// contains entries the spec itself declared -- normalizing one
    /// agent's skill reference must not leak a reference to some other
    /// packaged skill the agent never declared.
    #[test]
    fn render_agent_file_does_not_add_undeclared_skill_resources() {
        let kiro = KiroCliConfig {
            resources: vec!["skill://~/.kiro/skills/constraints/SKILL.md".to_string()],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        // Two packaged skills exist, but the agent only declared one.
        let skill_names: HashSet<&str> = ["constraints", "other-skill"].into_iter().collect();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &skill_names).unwrap();

        assert_eq!(
            file.resources,
            vec!["skill://skills/constraints/SKILL.md".to_string()],
            "must not gain a reference to 'other-skill', which the agent never declared"
        );
    }

    #[test]
    fn transform_writes_context_files_and_appends_resources_entry() {
        let dir = temp_dir("context-write");
        let mut agent = agent_with_kiro("k-example", KiroCliConfig::default());
        agent.dependencies.context.context_names = vec!["routing-rules.md".to_string()];

        let model = CanonicalModel {
            agents: vec![agent],
            context: vec![ContextDef {
                name: "routing-rules.md".to_string(),
                body: "# Routing rules\n".to_string(),
            }],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let context_file = dir
            .join(KiroCliV2Transformer.name())
            .join(CONTEXT_CONTENT_TYPE_DIR)
            .join("routing-rules.md");
        assert_eq!(
            fs::read_to_string(&context_file).unwrap(),
            "# Routing rules\n"
        );

        let agent_file = dir.join(expected_output_dir()).join("k-example.json");
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&agent_file).unwrap()).unwrap();
        assert_eq!(
            parsed["resources"],
            serde_json::json!(["file://context/routing-rules.md"])
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transform_agent_with_no_context_names_is_unaffected() {
        let dir = temp_dir("context-unaffected");
        let kiro = KiroCliConfig {
            resources: vec!["file://AGENTS.md".to_string()],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);

        let model = CanonicalModel {
            agents: vec![agent],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let agent_file = dir.join(expected_output_dir()).join("k-example.json");
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&agent_file).unwrap()).unwrap();
        assert_eq!(parsed["resources"], serde_json::json!(["file://AGENTS.md"]));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transform_writes_one_json_file_per_kiro_cli_agent() {
        let dir = temp_dir("write");

        let model = CanonicalModel {
            agents: vec![agent_with_kiro("k-example", KiroCliConfig::default())],
            ..Default::default()
        };
        let result = KiroCliV2Transformer.transform(&model, &dir);
        result.unwrap();

        let written = dir.join(expected_output_dir()).join("k-example.json");
        assert!(written.exists());
        let contents = fs::read_to_string(&written).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["name"], "k-example");
        // A trailing newline keeps output diffable and matches POSIX
        // text-file convention.
        assert!(contents.ends_with('\n'), "expected a trailing newline");

        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression guard: on-disk field must be `model`, not `modelId`.
    /// Confirmed against the installed `kiro-cli` binary: a bogus
    /// `modelId` is silently ignored (default model used), while a
    /// bogus `model` errors with "The model '...' is not available."
    /// Asserts on the serialized JSON text so a `#[serde(rename =
    /// "modelId")]` regression can't hide behind a struct-only check.
    #[test]
    fn transform_writes_model_field_not_model_id() {
        let dir = temp_dir("model-field-name");

        let kiro = KiroCliConfig::default();
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();
        write_agent_file(&dir, &agent.name, &file).unwrap();

        let written = dir.join("k-example.json");
        let contents = fs::read_to_string(&written).unwrap();
        assert!(
            contents.contains("\"model\": \"claude-sonnet-5\""),
            "expected a top-level \"model\" field, got: {contents}"
        );
        assert!(
            !contents.contains("modelId"),
            "\"modelId\" is not a real Kiro CLI agent config field, got: {contents}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transform_on_empty_model_writes_nothing_and_succeeds() {
        let dir = temp_dir("empty-model");
        let model = CanonicalModel::default();
        assert!(KiroCliV2Transformer.transform(&model, &dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression guard: `tools_settings` is raw-JSON passthrough with a
    /// tool-defined shape (see `KiroCliConfig::tools_settings`'s
    /// docstring), so its object key order must survive `transform()`
    /// unchanged rather than being alphabetized. Uses a deliberately
    /// non-alphabetical key order (`zebra`, `apple`, `middle`).
    #[test]
    fn transform_preserves_non_alphabetical_tools_settings_key_order() {
        let dir = temp_dir("key-order");

        let mut kiro = KiroCliConfig::default();
        kiro.tools_settings = serde_json::json!({
            "zebra": 1,
            "apple": 2,
            "middle": 3
        });
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        write_agent_file(&dir, &agent.name, &file).unwrap();

        let written = dir.join("k-example.json");
        let contents = fs::read_to_string(&written).unwrap();
        let zebra_pos = contents.find("\"zebra\"").unwrap();
        let apple_pos = contents.find("\"apple\"").unwrap();
        let middle_pos = contents.find("\"middle\"").unwrap();
        assert!(
            zebra_pos < apple_pos && apple_pos < middle_pos,
            "expected tools_settings keys in source order (zebra, apple, middle), got: {contents}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression guard: `mcp_servers` is an `IndexMap`, so key order
    /// must survive `transform()` unchanged rather than being
    /// alphabetized. Uses a deliberately non-alphabetical key order.
    #[test]
    fn transform_preserves_non_alphabetical_mcp_servers_key_order() {
        let dir = temp_dir("mcp-servers-key-order");

        let mut mcp_servers = IndexMap::new();
        mcp_servers.insert("zebra-mcp".to_string(), McpServerDef::default());
        mcp_servers.insert("apple-mcp".to_string(), McpServerDef::default());
        mcp_servers.insert("middle-mcp".to_string(), McpServerDef::default());
        let mut kiro = KiroCliConfig::default();
        kiro.mcp_servers = mcp_servers;
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        write_agent_file(&dir, &agent.name, &file).unwrap();

        let written = dir.join("k-example.json");
        let contents = fs::read_to_string(&written).unwrap();
        let zebra_pos = contents.find("\"zebra-mcp\"").unwrap();
        let apple_pos = contents.find("\"apple-mcp\"").unwrap();
        let middle_pos = contents.find("\"middle-mcp\"").unwrap();
        assert!(
            zebra_pos < apple_pos && apple_pos < middle_pos,
            "expected mcp_servers keys in source order (zebra-mcp, apple-mcp, middle-mcp), got: {contents}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression guard: `hooks` is an `IndexMap`, so key order must
    /// survive `transform()` unchanged rather than being alphabetized.
    /// Uses a deliberately non-alphabetical key order.
    #[test]
    fn transform_preserves_non_alphabetical_hooks_key_order() {
        let dir = temp_dir("hooks-key-order");

        let mut hooks = IndexMap::new();
        hooks.insert("zebra-hook".to_string(), serde_json::json!([]));
        hooks.insert("apple-hook".to_string(), serde_json::json!([]));
        hooks.insert("middle-hook".to_string(), serde_json::json!([]));
        let mut kiro = KiroCliConfig::default();
        kiro.hooks = hooks;
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        write_agent_file(&dir, &agent.name, &file).unwrap();

        let written = dir.join("k-example.json");
        let contents = fs::read_to_string(&written).unwrap();
        let zebra_pos = contents.find("\"zebra-hook\"").unwrap();
        let apple_pos = contents.find("\"apple-hook\"").unwrap();
        let middle_pos = contents.find("\"middle-hook\"").unwrap();
        assert!(
            zebra_pos < apple_pos && apple_pos < middle_pos,
            "expected hooks keys in source order (zebra-hook, apple-hook, middle-hook), got: {contents}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression guard: `serde_json::to_string_pretty` must keep
    /// emitting non-ASCII as raw UTF-8, not `\uXXXX` escapes. Uses
    /// `write_agent_file` directly rather than `transform()` to avoid
    /// this module's shared-process-cwd race under parallel `cargo test`.
    #[test]
    fn transform_writes_non_ascii_as_raw_utf8_not_u_escapes() {
        let dir = temp_dir("non-ascii");

        let mut kiro = KiroCliConfig::default();
        kiro.tools_settings = serde_json::json!({});
        let agent = agent_with_kiro("k-example", kiro);
        let mut config = agent.config.clone();
        config.system_prompt = "Skills — they load \u{2192} automatically \u{a7}1.".to_string();
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file = render_agent_file(&agent.name, &config, kiro_cfg, &[], &HashSet::new()).unwrap();

        write_agent_file(&dir, &agent.name, &file).unwrap();

        let written = dir.join("k-example.json");
        let contents = fs::read_to_string(&written).unwrap();
        assert!(
            !contents.contains("\\u2014"),
            "em-dash must be written as raw UTF-8, not escaped"
        );
        assert!(contents.contains('—'));
        assert!(contents.contains('→'));
        assert!(contents.contains('§'));
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(
            parsed["prompt"],
            "Skills — they load \u{2192} automatically \u{a7}1."
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression guard for the actual output-path bug this transform
    /// fix addresses: output must land under `<output_root>/<name()>/<content-type>`.
    /// `output_root` is an absolute temp dir, so resolution is
    /// independent of the process cwd; a cwd-relative regression would
    /// write outside `output_root`, which the `written.exists()`
    /// assertion below still catches without mutating the process cwd.
    #[test]
    fn transform_writes_under_output_root_not_process_cwd() {
        let output_root = temp_dir("output-root-not-cwd-source");

        let model = CanonicalModel {
            agents: vec![agent_with_kiro("k-example", KiroCliConfig::default())],
            ..Default::default()
        };
        KiroCliV2Transformer
            .transform(&model, &output_root)
            .unwrap();

        let written = output_root
            .join(expected_output_dir())
            .join("k-example.json");
        assert!(written.exists(), "expected output under output_root");

        let _ = fs::remove_dir_all(&output_root);
    }

    /// Security regression guard: `ParsedAgentSpec` can be constructed
    /// directly (bypassing the parser's `validate_agent_name`), so
    /// `transform` must reject a path-traversal name on its own.
    #[test]
    fn transform_rejects_path_traversal_agent_name_constructed_without_parser() {
        let output_root = temp_dir("traversal-bypass");
        // escape_target is where `<output_root>/<name()>/agents/../../evil.json`
        // would resolve to: two levels up from `<name()>/agents/`, i.e.
        // `output_root` itself. If the containment check were absent,
        // `evil.json` would land directly in `output_root`, outside
        // `output_root/<name()>/agents` (the intended `output_dir`).
        let escape_target = output_root.join("evil.json");

        let model = CanonicalModel {
            agents: vec![agent_with_kiro("../../evil", KiroCliConfig::default())],
            ..Default::default()
        };

        let result = KiroCliV2Transformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject a path-traversal agent name"
        );
        assert!(
            !escape_target.exists(),
            "path-traversal agent name must not escape output_dir, but found: {}",
            escape_target.display()
        );
        // Also confirm nothing was written under the intended output
        // directory either -- the whole write must be a no-op.
        assert!(
            !output_root.join(expected_output_dir()).exists()
                || fs::read_dir(output_root.join(expected_output_dir()))
                    .unwrap()
                    .next()
                    .is_none(),
            "expected no output written for a rejected agent name"
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    /// Same bypass, targeting `write_agent_file` directly (rather than
    /// via `transform`) to prove the check lives at the point of path
    /// construction itself, not merely somewhere upstream in the call
    /// chain.
    #[test]
    fn write_agent_file_rejects_path_traversal_agent_name() {
        let output_root = temp_dir("traversal-bypass-direct");
        let output_dir = output_root.join(expected_output_dir());
        let escape_target = output_root.join("evil.json");

        let kiro = KiroCliConfig::default();
        let agent = agent_with_kiro("../../evil", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        let result = write_agent_file(&output_dir, &agent.name, &file);
        assert!(
            result.is_err(),
            "expected write_agent_file to reject a path-traversal agent name"
        );
        assert!(
            !escape_target.exists(),
            "path-traversal agent name must not escape output_dir, but found: {}",
            escape_target.display()
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    /// An absolute agent name is a different escape shape than `..` --
    /// asserted separately since `reject_unsafe_agent_name` has a
    /// distinct branch for it.
    #[test]
    fn write_agent_file_rejects_absolute_agent_name() {
        let output_root = temp_dir("absolute-bypass");
        let output_dir = output_root.join(expected_output_dir());
        let absolute_escape = std::env::temp_dir().join(format!(
            "konductor-kiro-cli-transformer-absolute-escape-{}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&absolute_escape);

        let kiro = KiroCliConfig::default();
        let absolute_name = absolute_escape
            .to_str()
            .unwrap()
            .trim_end_matches(".json")
            .to_string();
        let agent = agent_with_kiro(&absolute_name, kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        let result = write_agent_file(&output_dir, &agent.name, &file);
        assert!(
            result.is_err(),
            "expected write_agent_file to reject an absolute agent name"
        );
        assert!(
            !absolute_escape.exists(),
            "absolute agent name must not escape output_dir, but found: {}",
            absolute_escape.display()
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    fn expected_skills_dir() -> PathBuf {
        Path::new(KiroCliV2Transformer.name()).join(SKILLS_CONTENT_TYPE_DIR)
    }

    fn expected_sops_dir() -> PathBuf {
        Path::new(KiroCliV2Transformer.name()).join(SOPS_CONTENT_TYPE_DIR)
    }

    #[test]
    fn transform_writes_skill_md_and_auxiliary_file_with_executable_bit() {
        let dir = temp_dir("skill-write");
        let mut skill = minimal_skill("konductor-example-skill");
        skill.auxiliary_files.push(AuxiliaryFile {
            relative_path: PathBuf::from("scripts/run.sh"),
            content: b"#!/bin/sh\necho hi\n".to_vec(),
            executable: true,
        });
        skill.auxiliary_files.push(AuxiliaryFile {
            relative_path: PathBuf::from("template.md"),
            content: b"template contents".to_vec(),
            executable: false,
        });
        let model = CanonicalModel {
            skills: vec![skill],
            ..Default::default()
        };

        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let skill_dir = dir
            .join(expected_skills_dir())
            .join("konductor-example-skill");
        let skill_md = skill_dir.join("SKILL.md");
        assert!(skill_md.exists());
        assert_eq!(
            fs::read_to_string(&skill_md).unwrap(),
            "---\nname: konductor-example-skill\ndescription: A test skill.\n---\n\n# Body\n\nContent.\n"
        );

        let script = skill_dir.join("scripts/run.sh");
        assert!(script.exists());
        assert_eq!(fs::read(&script).unwrap(), b"#!/bin/sh\necho hi\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let script_mode = fs::metadata(&script).unwrap().permissions().mode() & 0o777;
            assert_eq!(
                script_mode, 0o755,
                "executable auxiliary file must be 0o755"
            );

            let template = skill_dir.join("template.md");
            assert!(template.exists());
            let template_mode = fs::metadata(&template).unwrap().permissions().mode() & 0o777;
            assert_eq!(
                template_mode, 0o644,
                "non-executable auxiliary file must be 0o644"
            );
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transform_writes_one_sop_md_file_per_sop_preserving_naming_convention() {
        let dir = temp_dir("sop-write");
        let model = CanonicalModel {
            sops: vec![SopDef {
                name: "k-example-sop".to_string(),
                body: "# Example SOP\n\nBody.\n".to_string(),
            }],
            ..Default::default()
        };

        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let written = dir.join(expected_sops_dir()).join("k-example-sop.sop.md");
        assert!(written.exists());
        assert_eq!(
            fs::read_to_string(&written).unwrap(),
            "# Example SOP\n\nBody.\n"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transform_on_empty_model_writes_no_skills_or_sops() {
        let dir = temp_dir("empty-model-skills-sops");
        let model = CanonicalModel::default();
        KiroCliV2Transformer.transform(&model, &dir).unwrap();
        assert!(!dir.join(expected_skills_dir()).join("SKILL.md").exists());
        assert!(
            !dir.join(expected_sops_dir()).exists() || {
                fs::read_dir(dir.join(expected_sops_dir()))
                    .unwrap()
                    .next()
                    .is_none()
            }
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// Re-running `transform` after a skill is removed from the model
    /// must not leave the stale skill directory behind -- `stage_content_type`
    /// clears the previous output before swapping the new staging
    /// directory into place.
    #[test]
    fn transform_rerun_removes_stale_skill_output() {
        let dir = temp_dir("rerun-removes-stale");
        let first_model = CanonicalModel {
            skills: vec![minimal_skill("will-be-removed")],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&first_model, &dir).unwrap();
        assert!(dir
            .join(expected_skills_dir())
            .join("will-be-removed")
            .exists());

        let second_model = CanonicalModel {
            skills: vec![minimal_skill("still-here")],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&second_model, &dir).unwrap();

        assert!(!dir
            .join(expected_skills_dir())
            .join("will-be-removed")
            .exists());
        assert!(dir.join(expected_skills_dir()).join("still-here").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    /// Security regression guard, mirroring
    /// `transform_rejects_path_traversal_agent_name_constructed_without_parser`:
    /// a `SkillDef` built directly (bypassing `parse_canonical`'s own
    /// `validate_skill_name`) with a path-traversal name must be
    /// rejected by `transform` itself, and nothing may land outside the
    /// intended skills output directory.
    #[test]
    fn transform_rejects_path_traversal_skill_name_constructed_without_parser() {
        let output_root = temp_dir("skill-traversal-bypass");
        let escape_target = output_root.join("SKILL.md");

        let model = CanonicalModel {
            skills: vec![minimal_skill("../../evil")],
            ..Default::default()
        };

        let result = KiroCliV2Transformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject a path-traversal skill name"
        );
        assert!(
            !escape_target.exists(),
            "path-traversal skill name must not escape output_dir, but found: {}",
            escape_target.display()
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    /// Same bypass, targeting `write_skill` directly to prove the check
    /// lives at the point of path construction, not merely upstream.
    /// Uses a single `..` (not `../../evil`) so the target stays inside
    /// the writable `/tmp` tree: a deeper escape would also fail via a
    /// filesystem permission error even with the guard deleted, which
    /// would be a false-negative test (confirmed by deleting the guard
    /// call and observing exactly that before switching).
    #[test]
    fn write_skill_rejects_path_traversal_skill_name() {
        let output_root = temp_dir("skill-traversal-bypass-direct");
        let escape_target = output_root.parent().unwrap().join("evil").join("SKILL.md");
        let _ = fs::remove_dir_all(escape_target.parent().unwrap());

        let result = write_skill(&output_root, &minimal_skill("../evil"));
        assert!(
            result.is_err(),
            "expected write_skill to reject a path-traversal skill name"
        );
        assert!(!escape_target.exists());

        let _ = fs::remove_dir_all(&output_root);
        let _ = fs::remove_dir_all(escape_target.parent().unwrap());
    }

    /// Direct unit test of `reject_unsafe_skill_name` itself, independent
    /// of `write_skill`'s call into it.
    #[test]
    fn reject_unsafe_skill_name_rejects_traversal_and_accepts_plain_names() {
        assert!(reject_unsafe_skill_name("../../evil").is_err());
        assert!(reject_unsafe_skill_name("..").is_err());
        assert!(reject_unsafe_skill_name("/etc/passwd").is_err());
        assert!(reject_unsafe_skill_name("").is_err());
        assert!(reject_unsafe_skill_name("safe-skill-name").is_ok());
    }

    /// Security regression guard for SOP names, same shape as the skill
    /// and agent name guards above.
    #[test]
    fn transform_rejects_path_traversal_sop_name_constructed_without_parser() {
        let output_root = temp_dir("sop-traversal-bypass");
        let escape_target = output_root.join("evil.sop.md");

        let model = CanonicalModel {
            sops: vec![SopDef {
                name: "../../evil".to_string(),
                body: "body".to_string(),
            }],
            ..Default::default()
        };

        let result = KiroCliV2Transformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject a path-traversal SOP name"
        );
        assert!(
            !escape_target.exists(),
            "path-traversal SOP name must not escape output_dir, but found: {}",
            escape_target.display()
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    /// Same shape as `write_skill_rejects_path_traversal_skill_name`'s
    /// falsifiability note: a single `..` (not `../../evil`) keeps the
    /// escape target inside the writable `/tmp` tree, so the guard is
    /// the ONLY thing that can make this fail.
    #[test]
    fn write_sop_rejects_path_traversal_sop_name() {
        let output_root = temp_dir("sop-traversal-bypass-direct");
        let escape_target = output_root.parent().unwrap().join("evil.sop.md");
        let _ = fs::remove_file(&escape_target);

        let result = write_sop(
            &output_root,
            &SopDef {
                name: "../evil".to_string(),
                body: "body".to_string(),
            },
        );
        assert!(result.is_err());
        assert!(!escape_target.exists());

        let _ = fs::remove_dir_all(&output_root);
    }

    /// Security regression guard for an auxiliary file's relative path:
    /// even though `parse_canonical` already scopes `relative_path` to
    /// the skill directory via `strip_prefix`, `AuxiliaryFile` values
    /// can be constructed directly (as here) without going through the
    /// parser, so `write_auxiliary_file` must independently reject a
    /// `..`-containing relative path before joining it onto the output
    /// directory.
    #[test]
    fn transform_rejects_path_traversal_auxiliary_relative_path_constructed_without_parser() {
        let output_root = temp_dir("aux-traversal-bypass");
        let escape_target = output_root.join("evil.sh");

        let mut skill = minimal_skill("skill-with-bad-aux");
        skill.auxiliary_files.push(AuxiliaryFile {
            relative_path: PathBuf::from("../evil.sh"),
            content: b"#!/bin/sh\n".to_vec(),
            executable: true,
        });
        let model = CanonicalModel {
            skills: vec![skill],
            ..Default::default()
        };

        let result = KiroCliV2Transformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject a path-traversal auxiliary file path"
        );
        assert!(
            !escape_target.exists(),
            "path-traversal auxiliary path must not escape the skill directory, but found: {}",
            escape_target.display()
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn write_auxiliary_file_rejects_path_traversal_relative_path() {
        let output_root = temp_dir("aux-traversal-bypass-direct");
        let escape_target = output_root.parent().unwrap().join("evil.sh");
        let _ = fs::remove_file(&escape_target);

        let aux = AuxiliaryFile {
            relative_path: PathBuf::from("../evil.sh"),
            content: b"#!/bin/sh\n".to_vec(),
            executable: true,
        };
        let result = write_auxiliary_file(&output_root, &aux);
        assert!(result.is_err());
        assert!(!escape_target.exists());

        let _ = fs::remove_dir_all(&output_root);
    }

    /// Absolute-path escape shape, mirroring
    /// `write_agent_file_rejects_absolute_agent_name`. Targets a path
    /// under the process's own temp dir (not `/etc`) so the guard is
    /// the only thing preventing the write from succeeding.
    #[test]
    fn write_auxiliary_file_rejects_absolute_relative_path() {
        let output_root = temp_dir("aux-absolute-bypass");
        let absolute_escape = std::env::temp_dir().join(format!(
            "konductor-aux-absolute-escape-{}.sh",
            std::process::id()
        ));
        let _ = fs::remove_file(&absolute_escape);

        let aux = AuxiliaryFile {
            relative_path: absolute_escape.clone(),
            content: b"#!/bin/sh\n".to_vec(),
            executable: true,
        };
        let result = write_auxiliary_file(&output_root, &aux);
        assert!(result.is_err());
        assert!(!absolute_escape.exists());
        let _ = fs::remove_dir_all(&output_root);
    }

    // -- Embedded-NUL regression tests, one per containment guard. --

    #[test]
    fn reject_unsafe_name_segment_rejects_embedded_nul() {
        assert!(reject_unsafe_name_segment("evil\0name"));
        assert!(reject_unsafe_name_segment("\0"));
        assert!(!reject_unsafe_name_segment("safe-name"));
    }

    #[test]
    fn reject_unsafe_agent_name_rejects_embedded_nul() {
        assert!(reject_unsafe_agent_name("evil\0name").is_err());
        assert!(reject_unsafe_agent_name("safe-agent-name").is_ok());
    }

    #[test]
    fn write_agent_file_rejects_embedded_nul_agent_name() {
        let output_root = temp_dir("agent-nul-bypass");
        let output_dir = output_root.join(expected_output_dir());

        let kiro = KiroCliConfig::default();
        let agent = agent_with_kiro("evil\0name", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        let result = write_agent_file(&output_dir, &agent.name, &file);
        assert!(
            result.is_err(),
            "expected write_agent_file to reject an embedded-NUL agent name"
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn reject_unsafe_skill_name_rejects_embedded_nul() {
        assert!(reject_unsafe_skill_name("evil\0name").is_err());
    }

    #[test]
    fn write_skill_rejects_embedded_nul_skill_name() {
        let output_root = temp_dir("skill-nul-bypass");
        let result = write_skill(&output_root, &minimal_skill("evil\0name"));
        assert!(
            result.is_err(),
            "expected write_skill to reject an embedded-NUL skill name"
        );
        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn reject_unsafe_sop_name_rejects_embedded_nul() {
        assert!(reject_unsafe_sop_name("evil\0name").is_err());
    }

    #[test]
    fn write_sop_rejects_embedded_nul_sop_name() {
        let output_root = temp_dir("sop-nul-bypass");
        let result = write_sop(
            &output_root,
            &SopDef {
                name: "evil\0name".to_string(),
                body: "body".to_string(),
            },
        );
        assert!(
            result.is_err(),
            "expected write_sop to reject an embedded-NUL SOP name"
        );
        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn reject_unsafe_auxiliary_relative_path_rejects_embedded_nul() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("evil\0name.sh")).is_err());
    }

    /// Security regression guard: an `AuxiliaryFile` named exactly
    /// `SKILL.md` (constructed directly, bypassing `parse_canonical`,
    /// which already excludes this name) must be rejected -- auxiliary
    /// files are written after `write_skill` writes the real
    /// `SKILL.md`, so an unrejected same-named auxiliary file would
    /// silently overwrite it.
    #[test]
    fn reject_unsafe_auxiliary_relative_path_rejects_skill_md() {
        assert!(reject_unsafe_auxiliary_relative_path(Path::new("SKILL.md")).is_err());
    }

    /// Security regression guard: `write_skill`'s real call path -- not
    /// just the isolated `path_safety::reject_unsafe_auxiliary_relative_
    /// path` predicate -- must reject a `./SKILL.md`-named auxiliary
    /// file, which collides with the skill's own generated `SKILL.md`
    /// once joined onto `skill_dir` despite not being byte-equal to the
    /// bare `SKILL.md` literal.
    #[test]
    fn transform_rejects_curdir_prefixed_skill_md_collision_constructed_without_parser() {
        let output_root = temp_dir("aux-curdir-skill-md-bypass");
        let mut skill = minimal_skill("skill-with-curdir-skill-md-aux");
        skill.auxiliary_files.push(AuxiliaryFile {
            relative_path: PathBuf::from("./SKILL.md"),
            content: b"attacker-controlled content".to_vec(),
            executable: false,
        });
        let model = CanonicalModel {
            skills: vec![skill],
            ..Default::default()
        };

        let result = KiroCliV2Transformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject a './SKILL.md' auxiliary file that would collide \
             with the real SKILL.md"
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn write_auxiliary_file_rejects_embedded_nul_relative_path() {
        let output_root = temp_dir("aux-nul-bypass");
        let aux = AuxiliaryFile {
            relative_path: PathBuf::from("evil\0name.sh"),
            content: b"#!/bin/sh\n".to_vec(),
            executable: true,
        };
        let result = write_auxiliary_file(&output_root, &aux);
        assert!(
            result.is_err(),
            "expected write_auxiliary_file to reject an embedded-NUL relative path"
        );
        let _ = fs::remove_dir_all(&output_root);
    }

    // ── _sop_scopes.json sidecar ──────────────────────────────────────

    /// Security regression guard: an agent literally named `_sop_scopes`
    /// (constructed directly via `CanonicalModel`, bypassing the
    /// parser's own `validate_agent_name` rejection) would write its own
    /// file to `<agents-dir>/_sop_scopes.json` -- the identical path
    /// `write_sop_scopes_sidecar` writes the real sidecar to right after
    /// the per-agent loop finishes (see `transform`'s own call order) --
    /// silently clobbering the agent's file with the sidecar's map
    /// content, after which `list_agent_files` would exclude that exact
    /// filename from the agent files it copies on install, vanishing the
    /// agent with no error anywhere in the pipeline. `CanonicalModel` can
    /// be constructed directly, bypassing the parser's own
    /// `validate_agent_name` rejection, so `transform` (via
    /// `write_agent_file`'s `reject_unsafe_agent_name` call) must reject
    /// this name on its own too.
    #[test]
    fn transform_rejects_agent_name_constructed_without_parser_that_collides_with_sop_scopes_sidecar(
    ) {
        let output_root = temp_dir("sop-scopes-collision-bypass");
        let agents_dir = output_root.join(expected_output_dir());
        let sidecar_path = agents_dir.join(SOP_SCOPES_SIDECAR_FILE);

        let model = CanonicalModel {
            agents: vec![agent_with_kiro("_sop_scopes", KiroCliConfig::default())],
            ..Default::default()
        };

        let result = KiroCliV2Transformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject an agent name reserved for the SOP-scope sidecar"
        );
        assert!(
            !sidecar_path.exists(),
            "the whole agents/ content type is staged and atomically swapped in, so a rejected \
             agent must leave no half-written output at all, sidecar included; found: {}",
            sidecar_path.display()
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    /// Same as `agent_with_kiro`, but also populates
    /// `dependencies.agentSops.agentSopNames` -- the field
    /// `write_sop_scopes_sidecar` reads directly (no extraction helper
    /// needed, unlike skills' `skillNames` wrapper object).
    fn agent_with_kiro_and_sop_names(
        name: &str,
        kiro: KiroCliConfig,
        sop_names: &[&str],
    ) -> ParsedAgentSpec {
        let mut agent = agent_with_kiro(name, kiro);
        agent.dependencies.agent_sops.agent_sop_names =
            sop_names.iter().map(|n| n.to_string()).collect();
        agent
    }

    #[test]
    fn transform_writes_sop_scopes_sidecar_for_agents_with_sop_names() {
        let dir = temp_dir("sop-scopes-sidecar");
        let model = CanonicalModel {
            agents: vec![agent_with_kiro_and_sop_names(
                "k-example",
                KiroCliConfig::default(),
                &["ticket-sync", "code-review"],
            )],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let sidecar = dir
            .join(expected_output_dir())
            .join(SOP_SCOPES_SIDECAR_FILE);
        assert!(sidecar.exists());
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar).unwrap()).unwrap();
        assert_eq!(
            parsed,
            serde_json::json!({"k-example": ["ticket-sync", "code-review"]})
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// An agent with no declared `agentSopNames` is omitted from the
    /// sidecar entirely -- absent from the map and an empty array both
    /// mean "do not pass `--agent-sop-paths`/`--agent-sop-filter`" to the
    /// install-side consumer, so there's nothing to gain from carrying an
    /// empty entry.
    #[test]
    fn transform_omits_agents_with_no_sop_names_from_sop_scopes_sidecar() {
        let dir = temp_dir("sop-scopes-sidecar-empty");
        let model = CanonicalModel {
            agents: vec![
                agent_with_kiro_and_sop_names(
                    "has-sops",
                    KiroCliConfig::default(),
                    &["ticket-sync"],
                ),
                agent_with_kiro("no-sops", KiroCliConfig::default()),
            ],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let sidecar = dir
            .join(expected_output_dir())
            .join(SOP_SCOPES_SIDECAR_FILE);
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar).unwrap()).unwrap();
        assert_eq!(parsed, serde_json::json!({"has-sops": ["ticket-sync"]}));
        assert!(
            parsed.get("no-sops").is_none(),
            "an agent with an empty agentSopNames must be omitted, not written as an empty array"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// An agent with no `clientConfig.kiroCli` section at all (skipped by
    /// the main per-agent loop above) is also correctly excluded from the
    /// sidecar even if it declares `agentSopNames` -- the sidecar is
    /// scoped to this harness's own agents, same as the JSON files.
    #[test]
    fn transform_still_writes_sop_scopes_sidecar_when_no_agents_target_kiro_cli() {
        let dir = temp_dir("sop-scopes-sidecar-no-kiro-agents");
        let mut agent = agent_with_kiro_and_sop_names(
            "claude-only",
            KiroCliConfig::default(),
            &["ticket-sync"],
        );
        agent.client_config.kiro_cli = None;
        let model = CanonicalModel {
            agents: vec![agent],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let sidecar = dir
            .join(expected_output_dir())
            .join(SOP_SCOPES_SIDECAR_FILE);
        assert!(
            sidecar.exists(),
            "the sidecar is written unconditionally per transform(), even with zero kiroCli agents"
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar).unwrap()).unwrap();
        assert_eq!(
            parsed,
            serde_json::json!({"claude-only": ["ticket-sync"]}),
            "write_sop_scopes_sidecar reads dependencies.agentSops.agentSopNames directly from \
             CanonicalModel.agents, independent of whether the agent has a kiroCli client config"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    // ── _skill_scopes.json sidecar ──────────────────────────────────

    /// Same as `agent_with_kiro`, but also populates `dependencies.
    /// skills.skillNames` -- the wire shape `write_skill_scopes_sidecar`
    /// reads via `parse_canonical::skill_names_from_dependencies`.
    fn agent_with_kiro_and_skill_names(
        name: &str,
        kiro: KiroCliConfig,
        skill_names: &[&str],
    ) -> ParsedAgentSpec {
        let mut agent = agent_with_kiro(name, kiro);
        let mut skills = std::collections::BTreeMap::new();
        skills.insert(
            "skillNames".to_string(),
            serde_json::Value::Array(
                skill_names
                    .iter()
                    .map(|n| serde_json::Value::String(n.to_string()))
                    .collect(),
            ),
        );
        agent.dependencies.skills = skills;
        agent
    }

    #[test]
    fn transform_writes_skill_scopes_sidecar_for_agents_with_skill_names() {
        let dir = temp_dir("skill-scopes-sidecar");
        let model = CanonicalModel {
            agents: vec![agent_with_kiro_and_skill_names(
                "k-example",
                KiroCliConfig::default(),
                &["constraints", "sdlc-navigator"],
            )],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let sidecar = dir
            .join(expected_output_dir())
            .join(SKILL_SCOPES_SIDECAR_FILE);
        assert!(sidecar.exists());
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar).unwrap()).unwrap();
        assert_eq!(
            parsed,
            serde_json::json!({"k-example": ["constraints", "sdlc-navigator"]})
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// An agent with no declared `skillNames` is omitted from the
    /// sidecar entirely -- absent from the map and an empty array both
    /// mean "do not pass `--skill-name-filter`" to the install-side
    /// consumer, so there's nothing to gain from carrying an empty entry.
    #[test]
    fn transform_omits_agents_with_no_skill_names_from_skill_scopes_sidecar() {
        let dir = temp_dir("skill-scopes-sidecar-empty");
        let model = CanonicalModel {
            agents: vec![
                agent_with_kiro_and_skill_names(
                    "has-skills",
                    KiroCliConfig::default(),
                    &["constraints"],
                ),
                agent_with_kiro("no-skills", KiroCliConfig::default()),
            ],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let sidecar = dir
            .join(expected_output_dir())
            .join(SKILL_SCOPES_SIDECAR_FILE);
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar).unwrap()).unwrap();
        assert_eq!(parsed, serde_json::json!({"has-skills": ["constraints"]}));
        assert!(
            parsed.get("no-skills").is_none(),
            "an agent with an empty skillNames must be omitted, not written as an empty array"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// An agent with no `clientConfig.kiroCli` section at all (skipped by
    /// the main per-agent loop above) is also correctly excluded from the
    /// sidecar even if it declares `skillNames` -- the sidecar is scoped
    /// to this harness's own agents, same as the JSON files.
    #[test]
    fn transform_still_writes_skill_scopes_sidecar_when_no_agents_target_kiro_cli() {
        let dir = temp_dir("skill-scopes-sidecar-no-kiro-agents");
        let mut agent = agent_with_kiro_and_skill_names(
            "claude-only",
            KiroCliConfig::default(),
            &["constraints"],
        );
        agent.client_config.kiro_cli = None;
        let model = CanonicalModel {
            agents: vec![agent],
            ..Default::default()
        };
        KiroCliV2Transformer.transform(&model, &dir).unwrap();

        let sidecar = dir
            .join(expected_output_dir())
            .join(SKILL_SCOPES_SIDECAR_FILE);
        assert!(
            sidecar.exists(),
            "the sidecar is written unconditionally per transform(), even with zero kiroCli agents"
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar).unwrap()).unwrap();
        assert_eq!(
            parsed,
            serde_json::json!({"claude-only": ["constraints"]}),
            "write_skill_scopes_sidecar reads dependencies.skills.skillNames directly from \
             CanonicalModel.agents, independent of whether the agent has a kiroCli client \
             config -- included but inert, since list_agent_files never surfaces it for the \
             Kiro install loop"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Comma-safety guard: a skill name containing a comma must be a
    /// hard error at write time, mirroring `write_sop_scopes_sidecar`'s
    /// own guard exactly -- install joins names with `,` to build
    /// `--skill-name-filter`, so a comma embedded in a name would
    /// corrupt that joined filter string.
    #[test]
    fn transform_rejects_skill_name_containing_comma() {
        let dir = temp_dir("skill-scopes-sidecar-comma");
        let model = CanonicalModel {
            agents: vec![agent_with_kiro_and_skill_names(
                "k-example",
                KiroCliConfig::default(),
                &["constraints,sneaky"],
            )],
            ..Default::default()
        };
        let result = KiroCliV2Transformer.transform(&model, &dir);
        assert!(
            result.is_err(),
            "a skill name containing a comma must be rejected before writing the sidecar"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// Security regression guard: an agent literally named
    /// `_skill_scopes` (constructed directly via `CanonicalModel`,
    /// bypassing the parser's own `validate_agent_name` rejection) would
    /// write its own file to `<agents-dir>/_skill_scopes.json` -- the
    /// identical path `write_skill_scopes_sidecar` writes the real
    /// sidecar to right after the per-agent loop finishes (see
    /// `transform`'s own call order) -- silently clobbering the agent's
    /// file with the sidecar's map content, after which
    /// `list_agent_files` would exclude that exact filename from the
    /// agent files it copies on install, vanishing the agent with no
    /// error anywhere in the pipeline. `CanonicalModel` can be
    /// constructed directly, bypassing the parser's own
    /// `validate_agent_name` rejection, so `transform` (via
    /// `write_agent_file`'s `reject_unsafe_agent_name` call) must reject
    /// this name on its own too.
    #[test]
    fn transform_rejects_agent_name_constructed_without_parser_that_collides_with_skill_scopes_sidecar(
    ) {
        let output_root = temp_dir("skill-scopes-collision-bypass");
        let agents_dir = output_root.join(expected_output_dir());
        let sidecar_path = agents_dir.join(SKILL_SCOPES_SIDECAR_FILE);

        let model = CanonicalModel {
            agents: vec![agent_with_kiro("_skill_scopes", KiroCliConfig::default())],
            ..Default::default()
        };

        let result = KiroCliV2Transformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject an agent name reserved for the skill-scope sidecar"
        );
        assert!(
            !sidecar_path.exists(),
            "the whole agents/ content type is staged and atomically swapped in, so a rejected \
             agent must leave no half-written output at all, sidecar included; found: {}",
            sidecar_path.display()
        );

        let _ = fs::remove_dir_all(&output_root);
    }
}
