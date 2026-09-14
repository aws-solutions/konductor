// SPDX-License-Identifier: Apache-2.0
//
// synth/claude.rs — `HarnessTransformer` for the Claude Code harness
// target: writes each agent, skill, and SOP in a `CanonicalModel` out
// as Claude Code output (agent markdown with YAML frontmatter,
// `SKILL.md` + auxiliary files, `.sop.md`).
//
// Agent output shape is grounded against AIM's own live Claude Code
// materialization for this package (`~/.claude/agents/<id>-<agent>.md`,
// as produced by `aim plugins install`), not a written spec: YAML
// frontmatter (`---`-delimited) with `name`/`description`/`model`/
// `tools`/`skills`, followed by the system prompt as a plain markdown
// body with no wrapping heading.
//
// Deliberate scope boundaries below (not oversights) -- implement each
// once a real spec actually needs it, rather than guessing at an
// unverified shape:
// - No `# System Prompt` heading in the body: the one real live
//   artifact available to verify this shape against has none.
// - `allowedTools`/`hooks`/`mcpServers` each render as their own
//   frontmatter key (see `ClaudeAgentFrontmatter`), grounded against the
//   same live materialization cited above: an agent whose spec sets
//   none of the three has no `allowedTools:`/`hooks:`/`mcpServers:` line
//   at all, so each is omitted entirely (not rendered empty) when the
//   corresponding `claudeCli` field is empty. `allowedTools` is a plain
//   string array, structurally identical to `tools`/`skills`. `hooks`
//   renders `ClaudeCliConfig::hooks`'s parsed `IndexMap<String,
//   serde_json::Value>` structurally as-is -- the live artifact's
//   `hooks:` block is exactly that passthrough structure -- but each
//   leaf goes through `hooks_to_yaml`/`json_value_to_yaml_value` first:
//   this crate's `serde_json` `arbitrary_precision` feature (see
//   `Cargo.toml`) makes `serde_json::Number`'s own `Serialize` impl
//   incompatible with `serde_yaml`, so a numeric leaf (e.g. a hook's
//   `timeout` field) would otherwise render as a corrupted nested map
//   instead of a scalar.
//   `mcpServers` renders as a YAML sequence of single-key maps
//   (`- <server-name>: {command, args, url}`), NOT a plain map keyed by
//   server name, so `render_mcp_servers` reshapes
//   `ClaudeCliConfig::mcp_servers`'s parsed `IndexMap<String,
//   McpServerDef>` into that sequence (see `McpServerRender`);
//   `command`/`args`/`url` are each omitted per-entry when absent/empty
//   in the source, matching the live artifact (an entry with only
//   `command` set has no `args:`/`url:` line).
// - No fallback to `dependencies.skills.skillNames` when
//   `claudeCli.skills` is absent, unlike AIM's documented behavior --
//   every real spec in this repo's fixture corpus sets both today, so
//   the fallback path is untested.
// - `agent.dependencies.context.context_names` isn't referenced in the
//   rendered frontmatter (Claude Code has no generic "resources" field
//   like Kiro's `file://context/<name>` entries) -- the context files
//   are still written unconditionally to `dist/claude/context/`, but
//   nothing in the agent `.md` tells Claude Code they exist.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde::Serialize;

use super::content_writers::{write_all_context, write_all_skills, write_all_sops};
use super::kiro_cli_v2::write_sop_scopes_sidecar;
#[cfg(test)]
use super::kiro_cli_v2::SOP_SCOPES_SIDECAR_FILE;
use super::model::CanonicalModel;
#[cfg(test)]
use super::model::{AuxiliaryFile, ContextDef, SkillDef, SopDef};
use super::parser::{ClaudeCliConfig, McpServerDef};
use super::path_safety::reject_unsafe_agent_name;
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

/// YAML frontmatter shape for a Claude Code agent markdown file (see
/// module docstring for the grounding).
///
/// `tools` is `Option<&[String]>`, not `&[String]`: it preserves the
/// distinction between an omitted `claudeCli.tools` key (inherit Claude
/// Code's default tools) and an explicit empty array (zero tools) --
/// collapsing both to `vec![]` would silently turn "inherit defaults"
/// into "grant zero tools". `#[serde(skip_serializing_if =
/// "Option::is_none")]` renders an omitted key as an omitted frontmatter
/// line, not `tools: []`.
///
/// `allowed_tools`/`hooks`/`mcp_servers` each skip their own frontmatter
/// line entirely when empty (`is_empty_str_slice`/`IndexMap::is_empty`/
/// `Vec::is_empty`), matching the live-materialization grounding in the
/// module docstring: unlike `tools`, none of the three has an
/// "omitted vs. explicit-empty" distinction to preserve in
/// `ClaudeCliConfig` (each defaults to an empty collection, not an
/// `Option`), so collapsing "not set" and "set empty" to "omit the key"
/// loses nothing.
///
/// `hooks` is `IndexMap<String, serde_yaml::Value>`, not the parsed
/// `IndexMap<String, serde_json::Value>` directly -- see
/// `json_value_to_yaml_value`'s docstring for why a leaf-by-leaf
/// conversion is required before this can reach `serde_yaml::to_string`
/// at all.
#[derive(Serialize)]
struct ClaudeAgentFrontmatter<'a> {
    name: &'a str,
    description: &'a str,
    model: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<&'a [String]>,
    skills: &'a [String],
    #[serde(rename = "allowedTools", skip_serializing_if = "is_empty_str_slice")]
    allowed_tools: &'a [String],
    #[serde(skip_serializing_if = "IndexMap::is_empty")]
    hooks: IndexMap<String, serde_yaml::Value>,
    #[serde(rename = "mcpServers", skip_serializing_if = "Vec::is_empty")]
    mcp_servers: Vec<IndexMap<&'a str, McpServerRender<'a>>>,
}

/// `skip_serializing_if` helper for a `&'a [String]` frontmatter field
/// (`allowed_tools`): the field itself is a reference, so the generated
/// call receives `&&[String]`, which derefs to `&[String]` here -- a
/// plain `Vec::is_empty` path doesn't apply since the field is a slice
/// reference, not an owned `Vec`.
fn is_empty_str_slice(v: &[String]) -> bool {
    v.is_empty()
}

/// Converts `claude.hooks`'s parsed `IndexMap<String, serde_json::Value>`
/// into an `IndexMap<String, serde_yaml::Value>`, preserving both the
/// outer key order and every nested object's key order (both are
/// `IndexMap`-backed under this crate's `preserve_order` feature -- see
/// `Cargo.toml`).
///
/// Required because this crate also enables `serde_json`'s
/// `arbitrary_precision` feature: under that feature,
/// `serde_json::Number`'s own `Serialize` impl emits a private
/// struct-shaped protocol (`$serde_json::private::Number`) that only
/// `serde_json`'s own `Serializer` recognizes. `serde_yaml` has no such
/// special case, so passing a `serde_json::Value` straight through
/// `serde_yaml::to_string` renders any numeric leaf (e.g. a hook's
/// `timeout` field) as a nested map instead of a plain scalar --
/// reproduced directly against this exact path before this function
/// existed. Converting to `serde_yaml::Value` first sidesteps
/// `serde_json::Number`'s `Serialize` impl entirely.
fn hooks_to_yaml(
    hooks: &IndexMap<String, serde_json::Value>,
) -> IndexMap<String, serde_yaml::Value> {
    hooks
        .iter()
        .map(|(k, v)| (k.clone(), json_value_to_yaml_value(v)))
        .collect()
}

/// Recursive leaf-by-leaf `serde_json::Value` -> `serde_yaml::Value`
/// conversion. See `hooks_to_yaml`'s docstring for why this exists
/// instead of a direct `serde_yaml::to_string(&serde_json::Value)` call.
fn json_value_to_yaml_value(value: &serde_json::Value) -> serde_yaml::Value {
    match value {
        serde_json::Value::Null => serde_yaml::Value::Null,
        serde_json::Value::Bool(b) => serde_yaml::Value::Bool(*b),
        serde_json::Value::Number(n) => serde_yaml::Value::Number(json_number_to_yaml_number(n)),
        serde_json::Value::String(s) => serde_yaml::Value::String(s.clone()),
        serde_json::Value::Array(items) => {
            serde_yaml::Value::Sequence(items.iter().map(json_value_to_yaml_value).collect())
        }
        serde_json::Value::Object(map) => {
            let mut yaml_map = serde_yaml::Mapping::new();
            for (k, v) in map {
                yaml_map.insert(
                    serde_yaml::Value::String(k.clone()),
                    json_value_to_yaml_value(v),
                );
            }
            serde_yaml::Value::Mapping(yaml_map)
        }
    }
}

/// Converts one `serde_json::Number` leaf to `serde_yaml::Number`,
/// trying `i64` then `u64` then `f64` in that order so an
/// integer-shaped literal within either range keeps its exact digits.
/// `serde_yaml::Number` has no arbitrary-precision variant, so an
/// integer-shaped literal *beyond* `u64::MAX` but still within `f64`'s
/// finite range necessarily loses precision through the `f64`
/// fallback -- an inherent limitation of `serde_yaml::Number` itself,
/// not something this function can avoid. No real hook field is
/// expected to carry such a value (see the `aim-agent-authoring`
/// skill's hooks schema: the only documented numeric field is
/// `timeout`, capped at 300).
///
/// A literal whose magnitude overflows `f64`'s own finite range
/// entirely (reachable via this crate's `arbitrary_precision` parsing
/// of something like `1e400`) hits a stricter case: `serde_json`'s
/// `as_f64()` internally filters to `is_finite()` results only, so it
/// returns `None` here rather than a saturated infinity -- verified
/// directly against the pinned `serde_json = "=1.0.150"`. `n.as_f64()
/// .unwrap_or(0.0)` would silently substitute `0.0` for such a value:
/// a *qualitatively* worse outcome than the lossy-but-nonzero case
/// above, since it reports "no timeout at all" for whatever enormous
/// value the source spec actually declared, with no error and no
/// warning. Saturating to the nearest finite value with the literal's
/// own sign preserved is a materially smaller information loss than
/// that silent zeroing, so this function reads the sign from `n`'s own
/// arbitrary-precision string form (available because of this crate's
/// `arbitrary_precision` feature) rather than from a `None` `as_f64()`
/// result, which carries no sign information at all.
///
/// `kiro_cli_v2.rs::normalize_number` solves the same underlying
/// problem class (a `serde_json::Number` produced under this crate's
/// `arbitrary_precision` feature needing to reach a downstream
/// serializer safely) via a different strategy, deliberately: it stays
/// entirely within `serde_json` (its target type is `serde_json::
/// Number`, which HAS an arbitrary-precision string representation),
/// so it can rebuild exact digit text for any integer-shaped literal
/// regardless of magnitude and only reaches for `f64` on a genuinely
/// fractional/exponential source literal. This function's target type
/// is `serde_yaml::Number`, which has no such arbitrary-precision
/// variant at all -- there is no digit-text-preserving path available
/// for a literal beyond `u64::MAX` here, so a typed `i64`/`u64`/`f64`
/// conversion is the only strategy this target type admits. The two
/// are not sharable behind one signature without dropping one of
/// their guarantees.
fn json_number_to_yaml_number(n: &serde_json::Number) -> serde_yaml::Number {
    if let Some(i) = n.as_i64() {
        return i.into();
    }
    if let Some(u) = n.as_u64() {
        return u.into();
    }
    if let Some(f) = n.as_f64() {
        return f.into();
    }
    let is_negative = n.to_string().starts_with('-');
    (if is_negative { f64::MIN } else { f64::MAX }).into()
}

/// Render-only shape for one `mcpServers` entry. Claude Code's real
/// materialized frontmatter (see module docstring) renders `mcpServers`
/// as a YAML sequence of single-key maps (`- <server-name>: {...}`),
/// structurally different from `McpServerDef`'s own parse-side shape
/// (a value inside a map keyed by server name) -- hence this separate
/// render struct rather than deriving `Serialize` on `McpServerDef`
/// itself. Each field is omitted when absent/empty, matching the live
/// artifact (an entry with only `command` set has no `args:`/`url:`
/// line).
#[derive(Serialize)]
struct McpServerRender<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<&'a str>,
    #[serde(skip_serializing_if = "is_empty_str_slice")]
    args: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<&'a str>,
}

/// Builds the `mcpServers` sequence from `claude.mcp_servers`'s parsed
/// `IndexMap<String, McpServerDef>`, preserving source key order (one
/// single-key map per entry -- see `McpServerRender`'s docstring for
/// why this reshaping is needed at all). Per-entry field extraction
/// goes through `McpServerDef::command_args_url` -- see that method's
/// docstring for why it's shared with `kiro_cli_v2.rs`'s own
/// `mcp_servers` renderer despite the two producing structurally
/// different container shapes.
fn render_mcp_servers(
    mcp_servers: &IndexMap<String, McpServerDef>,
) -> Vec<IndexMap<&str, McpServerRender<'_>>> {
    mcp_servers
        .iter()
        .map(|(server_name, def)| {
            let (command, args, url) = def.command_args_url();
            let mut entry = IndexMap::with_capacity(1);
            entry.insert(server_name.as_str(), McpServerRender { command, args, url });
            entry
        })
        .collect()
}

/// Transforms `CanonicalModel` agents, skills, and SOPs into Claude Code
/// output. Agents with no `clientConfig.claudeCli` section are skipped;
/// skills and SOPs are always emitted. Each content type is staged in a
/// sibling temp directory and atomically swapped into place via
/// `stage_content_type` (see `staging.rs`), so a failure partway through
/// never leaves a half-written `agents/`, `skills/`, or `sops/` tree.
///
/// The four `stage_content_type` calls below are each independently
/// atomic but not atomic as a group -- a failure after, say,
/// `AGENTS_CONTENT_TYPE_DIR` succeeds leaves `dist/claude/agents/`
/// updated while `dist/claude/skills/` stays stale, inside one
/// `transform()` call. Same accepted, self-healing torn-state window
/// `mod.rs`'s docstring documents across transformers, narrower here
/// (one harness's own four content types); `kiro_cli_v2.rs` carries the
/// identical structure.
pub struct ClaudeTransformer;

impl HarnessTransformer for ClaudeTransformer {
    fn name(&self) -> &'static str {
        "claude"
    }

    fn transform(&self, model: &CanonicalModel, output_root: &Path) -> Result<(), String> {
        let base_dir = output_root.join(self.name());

        stage_content_type(&base_dir, AGENTS_CONTENT_TYPE_DIR, |staging_dir| {
            let skill_names: HashSet<&str> = model.skills.iter().map(|s| s.name.as_str()).collect();
            for agent in &model.agents {
                let Some(claude) = &agent.client_config.claude_cli else {
                    continue;
                };
                let rendered = render_agent_md(&agent.name, &agent.config, claude, &skill_names)?;
                write_agent_file(staging_dir, &agent.name, &rendered)?;
            }
            write_sop_scopes_sidecar(staging_dir, &model.agents)?;
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

/// Renders one agent's YAML frontmatter + system prompt body -- the
/// body is the verbatim `system_prompt` text with no inserted heading
/// (see module docstring).
///
/// `skill_names` (every packaged skill's name) validates each
/// `claude.skills` entry before rendering: without this, a renamed,
/// removed, or typo'd skill name would synth successfully and ship a
/// `skills:` entry pointing at nothing under `dist/claude/skills/`,
/// silently, exit code 0. Unlike Kiro's `resources` (which mix skill
/// references with `file://` URIs and globs), every `claude.skills`
/// entry is already a bare skill name, so this is a direct
/// set-membership check, not URI parsing.
fn render_agent_md(
    name: &str,
    config: &super::parser::AgentConfig,
    claude: &ClaudeCliConfig,
    skill_names: &HashSet<&str>,
) -> Result<String, String> {
    for skill_name in &claude.skills {
        if !skill_names.contains(skill_name.as_str()) {
            return Err(format!(
                "agent '{name}' declares claudeCli skill '{skill_name}', but no skill named \
                 '{skill_name}' exists under skills/"
            ));
        }
    }

    let frontmatter = ClaudeAgentFrontmatter {
        name,
        description: &config.description,
        model: &config.model,
        tools: claude.tools.as_deref(),
        skills: &claude.skills,
        allowed_tools: &claude.allowed_tools,
        hooks: hooks_to_yaml(&claude.hooks),
        mcp_servers: render_mcp_servers(&claude.mcp_servers),
    };
    let yaml = serde_yaml::to_string(&frontmatter)
        .map_err(|e| format!("failed to serialize frontmatter for agent '{name}': {e}"))?;
    Ok(format!("---\n{yaml}---\n\n{}", config.system_prompt))
}

/// Writes `rendered` to `<output_dir>/<agent_name>.md`, creating
/// `output_dir` if needed.
fn write_agent_file(output_dir: &Path, agent_name: &str, rendered: &str) -> Result<(), String> {
    reject_unsafe_agent_name(agent_name)?;
    fs::create_dir_all(output_dir)
        .map_err(|e| format!("failed to create directory {}: {e}", output_dir.display()))?;
    let path: PathBuf = output_dir.join(format!("{agent_name}.md"));
    fs::write(&path, rendered).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::synth::parser::{
        AgentConfig, AgentDependencies, ClientConfig, ParsedAgentSpec,
    };

    fn agent_with_claude(name: &str, claude: ClaudeCliConfig) -> ParsedAgentSpec {
        ParsedAgentSpec {
            name: name.to_string(),
            config: AgentConfig {
                description: "A test agent.".to_string(),
                system_prompt: "You are a test agent.".to_string(),
                model: "claude-sonnet-5".to_string(),
            },
            dependencies: AgentDependencies::default(),
            client_config: ClientConfig {
                kiro_cli: None,
                claude_cli: Some(claude),
            },
        }
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-claude-transformer-test-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn expected_output_dir() -> PathBuf {
        Path::new(ClaudeTransformer.name()).join(AGENTS_CONTENT_TYPE_DIR)
    }

    fn minimal_skill(name: &str) -> SkillDef {
        SkillDef {
            name: name.to_string(),
            raw_frontmatter: format!("name: {name}\ndescription: A test skill."),
            body: "# Body\n\nContent.\n".to_string(),
            auxiliary_files: Vec::new(),
        }
    }

    #[test]
    fn name_returns_claude() {
        assert_eq!(ClaudeTransformer.name(), "claude");
    }

    #[test]
    fn skips_agents_without_claude_cli_client_config() {
        let mut agent = agent_with_claude("has-claude", ClaudeCliConfig::default());
        agent.client_config.claude_cli = None;
        let model = CanonicalModel {
            agents: vec![agent],
            ..Default::default()
        };
        let dir = temp_dir("skip");
        assert!(ClaudeTransformer.transform(&model, &dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    /// Regression guard for the exact frontmatter shape this
    /// transformer is grounded against (see module docstring): `name`,
    /// `description`, `model`, `tools`, `skills` present, and the body
    /// starts directly with the system prompt -- no `# System Prompt`
    /// heading or other synth-inserted wrapper.
    #[test]
    fn render_agent_md_produces_yaml_frontmatter_and_verbatim_body() {
        let claude = ClaudeCliConfig {
            tools: Some(vec!["Read".to_string(), "Write".to_string()]),
            skills: vec!["constraints".to_string()],
            ..Default::default()
        };
        let agent = agent_with_claude("k-example", claude);
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let skill_names: HashSet<&str> = ["constraints"].into_iter().collect();
        let rendered =
            render_agent_md("k-example", &agent.config, claude_cfg, &skill_names).unwrap();

        assert!(rendered.starts_with("---\n"));
        let mut parts = rendered.splitn(3, "---\n");
        assert_eq!(parts.next(), Some(""));
        let frontmatter_yaml = parts.next().expect("frontmatter section present");
        let body = parts.next().expect("body section present");

        let parsed: serde_yaml::Value = serde_yaml::from_str(frontmatter_yaml).unwrap();
        assert_eq!(parsed["name"], "k-example");
        assert_eq!(parsed["description"], "A test agent.");
        assert_eq!(parsed["model"], "claude-sonnet-5");
        assert_eq!(
            parsed["tools"].as_sequence().unwrap().len(),
            2,
            "expected both tools entries"
        );
        assert_eq!(
            parsed["skills"].as_sequence().unwrap(),
            &vec![serde_yaml::Value::String("constraints".to_string())]
        );

        // Body starts directly with the prompt text, no inserted heading.
        assert_eq!(body.trim_start_matches('\n'), "You are a test agent.");
        assert!(
            !rendered.contains("# System Prompt"),
            "must not insert a heading the real AIM-produced files don't have"
        );
    }

    /// Regression guard: `description`/`system_prompt` values containing
    /// YAML-significant characters (a colon followed by a space, double
    /// quotes, an embedded newline) must round-trip exactly through
    /// `serde_yaml`'s own quoting/escaping -- not get truncated at the
    /// first `: ` (which would happen if this were built via naive
    /// string interpolation instead of a real YAML serializer) or have
    /// its quotes/newlines corrupted.
    #[test]
    fn render_agent_md_round_trips_yaml_significant_characters_in_description() {
        let claude = ClaudeCliConfig::default();
        let mut agent = agent_with_claude("k-example", claude);
        agent.config.description =
            "Contains: a colon, \"quotes\", and\nan embedded newline.".to_string();
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let rendered =
            render_agent_md("k-example", &agent.config, claude_cfg, &HashSet::new()).unwrap();

        let frontmatter_yaml = rendered
            .split("---\n")
            .nth(1)
            .expect("frontmatter section present");
        let parsed: serde_yaml::Value = serde_yaml::from_str(frontmatter_yaml)
            .expect("frontmatter containing a colon/quotes/newline must still parse as valid YAML");
        assert_eq!(
            parsed["description"],
            "Contains: a colon, \"quotes\", and\nan embedded newline."
        );
    }

    /// Schema regression guard: an agent whose `claudeCli` OMITS `tools`
    /// entirely (`ClaudeCliConfig`
    /// default, `tools: None`) must render frontmatter with NO `tools:`
    /// key at all -- not an explicit `tools: []`, which would silently
    /// turn "inherit Claude Code's default tool set" into "grant zero
    /// tools" the moment the source spec omits the key.
    #[test]
    fn render_agent_md_omits_tools_key_when_claude_cli_tools_is_none() {
        let claude = ClaudeCliConfig::default();
        assert_eq!(
            claude.tools, None,
            "sanity: default must be None, not Some(vec![])"
        );
        let agent = agent_with_claude("k-example", claude);
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let rendered =
            render_agent_md("k-example", &agent.config, claude_cfg, &HashSet::new()).unwrap();

        assert!(
            !rendered.contains("tools:"),
            "omitted claudeCli.tools must not render any 'tools:' frontmatter line, got: {rendered}"
        );
    }

    /// Companion to the test above: an EXPLICIT empty `tools: []` (an
    /// empty allowlist, distinct from an omitted key) must still render
    /// as an explicit empty sequence, not be conflated with the omitted
    /// case.
    #[test]
    fn render_agent_md_renders_explicit_empty_tools_array_when_some_empty() {
        let claude = ClaudeCliConfig {
            tools: Some(Vec::new()),
            skills: Vec::new(),
            ..Default::default()
        };
        let agent = agent_with_claude("k-example", claude);
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let rendered =
            render_agent_md("k-example", &agent.config, claude_cfg, &HashSet::new()).unwrap();

        let frontmatter_yaml = rendered
            .split("---\n")
            .nth(1)
            .expect("frontmatter section present");
        let parsed: serde_yaml::Value = serde_yaml::from_str(frontmatter_yaml).unwrap();
        assert_eq!(
            parsed["tools"].as_sequence().map(|s| s.len()),
            Some(0),
            "an explicit empty tools array must still render as an explicit empty sequence"
        );
    }

    /// Regression guard for the CRITICAL fix to `json_number_to_yaml_number`:
    /// a JSON number literal whose magnitude overflows `f64`'s own finite
    /// range (reachable under this crate's `arbitrary_precision` feature,
    /// e.g. `1e400`) must saturate to a sign-preserving finite value, not
    /// silently collapse to `0.0` via the old `as_f64().unwrap_or(0.0)`
    /// fallback -- verified directly that `serde_json`'s `as_f64()` returns
    /// `None` (not `Some(f64::INFINITY)`) for such a literal, so the old
    /// code's fallback branch fired unconditionally and reported "zero" for
    /// whatever enormous value the source spec actually declared.
    #[test]
    fn json_number_to_yaml_number_saturates_instead_of_zeroing_out_of_range_magnitude() {
        let positive: serde_json::Number = serde_json::from_str("1e400").unwrap();
        assert_eq!(
            positive.as_f64(),
            None,
            "sanity: must reproduce the None case"
        );
        assert_eq!(
            json_number_to_yaml_number(&positive).as_f64(),
            Some(f64::MAX),
            "an out-of-range positive literal must saturate to f64::MAX, not 0.0"
        );

        let negative: serde_json::Number = serde_json::from_str("-1e400").unwrap();
        assert_eq!(
            negative.as_f64(),
            None,
            "sanity: must reproduce the None case"
        );
        assert_eq!(
            json_number_to_yaml_number(&negative).as_f64(),
            Some(f64::MIN),
            "an out-of-range negative literal must saturate to f64::MIN, not 0.0"
        );
    }

    /// End-to-end companion to the test above: an out-of-range numeric
    /// hook field must render as a large finite YAML scalar, never as
    /// `.inf`/`-.inf` (which this code path cannot even produce, since
    /// `as_f64()` returns `None` rather than an infinity for such a
    /// literal) and never as a silently-zeroed `0`.
    #[test]
    fn render_agent_md_saturates_out_of_range_numeric_hook_field_instead_of_zeroing_or_inf() {
        // Parsed at runtime via `serde_json::from_str`, not built with the
        // `json!` macro: the macro's `1e400` would be a Rust `f64` literal
        // evaluated at COMPILE time (overflowing to infinity and tripping
        // `#[deny(overflowing_literals)]`), whereas parsing this string at
        // RUNTIME goes through `serde_json`'s own `arbitrary_precision`
        // parser, which preserves the literal's exact digit text -- the
        // same path a real `agents/*.agent-spec.json` file takes.
        let mut hooks = IndexMap::new();
        hooks.insert(
            "PreToolUse".to_string(),
            serde_json::from_str(
                r#"[{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo hi", "timeout": 1e400}]}]"#,
            )
            .unwrap(),
        );
        let claude = ClaudeCliConfig {
            hooks,
            ..Default::default()
        };
        let agent = agent_with_claude("k-example", claude);
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let rendered =
            render_agent_md("k-example", &agent.config, claude_cfg, &HashSet::new()).unwrap();

        assert!(
            !rendered.contains(".inf"),
            "must never render a non-finite YAML scalar, got: {rendered}"
        );
        let frontmatter_yaml = rendered
            .split("---\n")
            .nth(1)
            .expect("frontmatter section present");
        let parsed: serde_yaml::Value = serde_yaml::from_str(frontmatter_yaml).unwrap();
        let rendered_timeout = parsed["hooks"]["PreToolUse"][0]["hooks"][0]["timeout"]
            .as_f64()
            .expect("timeout must parse back as a number");
        assert_eq!(
            rendered_timeout,
            f64::MAX,
            "an out-of-range timeout must saturate to f64::MAX, not silently render as 0, \
             got: {frontmatter_yaml}"
        );
    }

    /// Regression guard for the arbitrary_precision/serde_yaml Number
    /// mismatch `hooks_to_yaml` exists to close: a hook field containing
    /// a JSON number (e.g. `timeout`, the one numeric field the
    /// `aim-agent-authoring` skill's hooks schema documents) must render
    /// as a plain YAML scalar, not the `$serde_json::private::Number`
    /// nested-map artifact `serde_json::Number`'s `Serialize` impl
    /// produces under this crate's `arbitrary_precision` feature when
    /// passed to `serde_yaml` unconverted. Reproduced directly against
    /// this exact path before `hooks_to_yaml` existed.
    #[test]
    fn render_agent_md_renders_numeric_hook_field_as_plain_scalar_not_json_number_artifact() {
        let mut hooks = IndexMap::new();
        hooks.insert(
            "PreToolUse".to_string(),
            serde_json::json!([{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo hi", "timeout": 10}]}]),
        );
        let claude = ClaudeCliConfig {
            hooks,
            ..Default::default()
        };
        let agent = agent_with_claude("k-example", claude);
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let rendered =
            render_agent_md("k-example", &agent.config, claude_cfg, &HashSet::new()).unwrap();

        assert!(
            !rendered.contains("$serde_json::private::Number"),
            "numeric hook field leaked the serde_json arbitrary_precision \
             Serialize protocol into the rendered YAML, got: {rendered}"
        );
        let frontmatter_yaml = rendered
            .split("---\n")
            .nth(1)
            .expect("frontmatter section present");
        let parsed: serde_yaml::Value = serde_yaml::from_str(frontmatter_yaml).unwrap();
        assert_eq!(
            parsed["hooks"]["PreToolUse"][0]["hooks"][0]["timeout"].as_i64(),
            Some(10),
            "expected timeout to parse back as a plain integer, got: {frontmatter_yaml}"
        );
    }

    /// Regression guard: an agent whose `claudeCli` sets
    /// `allowedTools`/`hooks`/`mcpServers` must render all three as
    /// their own frontmatter keys, grounded against the real Claude Code
    /// materialization cited in the module docstring -- `mcpServers` in
    /// particular as a sequence of single-key maps, not a plain map
    /// keyed by server name.
    #[test]
    fn render_agent_md_renders_allowed_tools_hooks_and_mcp_servers_when_set() {
        let mut hooks = IndexMap::new();
        hooks.insert(
            "SessionStart".to_string(),
            serde_json::json!([{"matcher": "startup", "hooks": [{"type": "command", "command": "echo hi"}]}]),
        );
        let mut mcp_servers = IndexMap::new();
        mcp_servers.insert(
            "example-mcp".to_string(),
            McpServerDef {
                command: Some("uvx".to_string()),
                args: vec!["example-mcp@latest".to_string()],
                url: None,
            },
        );
        let claude = ClaudeCliConfig {
            allowed_tools: vec!["Read".to_string(), "Write".to_string()],
            hooks,
            mcp_servers,
            ..Default::default()
        };
        let agent = agent_with_claude("k-example", claude);
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let rendered =
            render_agent_md("k-example", &agent.config, claude_cfg, &HashSet::new()).unwrap();

        let frontmatter_yaml = rendered
            .split("---\n")
            .nth(1)
            .expect("frontmatter section present");
        let parsed: serde_yaml::Value = serde_yaml::from_str(frontmatter_yaml).unwrap();

        assert_eq!(
            parsed["allowedTools"].as_sequence().unwrap(),
            &vec![
                serde_yaml::Value::String("Read".to_string()),
                serde_yaml::Value::String("Write".to_string()),
            ]
        );
        assert_eq!(
            parsed["hooks"]["SessionStart"][0]["matcher"].as_str(),
            Some("startup"),
            "hooks must render as the raw passthrough structure, got: {frontmatter_yaml}"
        );
        let mcp_seq = parsed["mcpServers"]
            .as_sequence()
            .expect("mcpServers must render as a sequence, not a map");
        assert_eq!(mcp_seq.len(), 1);
        assert_eq!(
            mcp_seq[0]["example-mcp"]["command"].as_str(),
            Some("uvx"),
            "expected a single-key map per mcpServers entry, got: {frontmatter_yaml}"
        );
        assert_eq!(
            mcp_seq[0]["example-mcp"]["args"].as_sequence().unwrap(),
            &vec![serde_yaml::Value::String("example-mcp@latest".to_string())]
        );
    }

    /// Companion to the test above: an agent whose `claudeCli` sets NONE
    /// of `allowedTools`/`hooks`/`mcpServers` (the `ClaudeCliConfig`
    /// default -- each an empty collection) must omit all three
    /// frontmatter keys entirely, matching the live materialization
    /// grounding in the module docstring (an agent declaring none of
    /// the three has no `allowedTools:`/`hooks:`/`mcpServers:` line at
    /// all, not an empty value).
    #[test]
    fn render_agent_md_omits_allowed_tools_hooks_and_mcp_servers_when_empty() {
        let claude = ClaudeCliConfig::default();
        let agent = agent_with_claude("k-example", claude);
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let rendered =
            render_agent_md("k-example", &agent.config, claude_cfg, &HashSet::new()).unwrap();

        assert!(!rendered.contains("allowedTools:"), "got: {rendered}");
        assert!(!rendered.contains("hooks:"), "got: {rendered}");
        assert!(!rendered.contains("mcpServers:"), "got: {rendered}");
    }

    /// Regression guard: `hooks`/`mcp_servers` are `IndexMap`s, so their
    /// source key order must survive rendering unchanged rather than
    /// being alphabetized -- mirrors `kiro_cli_v2.rs`'s own
    /// `transform_preserves_non_alphabetical_hooks_key_order`/
    /// `transform_preserves_non_alphabetical_mcp_servers_key_order`.
    #[test]
    fn render_agent_md_preserves_non_alphabetical_hooks_and_mcp_servers_key_order() {
        let mut hooks = IndexMap::new();
        hooks.insert("zebra-hook".to_string(), serde_json::json!([]));
        hooks.insert("apple-hook".to_string(), serde_json::json!([]));

        let mut mcp_servers = IndexMap::new();
        mcp_servers.insert("zebra-mcp".to_string(), McpServerDef::default());
        mcp_servers.insert("apple-mcp".to_string(), McpServerDef::default());

        let claude = ClaudeCliConfig {
            hooks,
            mcp_servers,
            ..Default::default()
        };
        let agent = agent_with_claude("k-example", claude);
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let rendered =
            render_agent_md("k-example", &agent.config, claude_cfg, &HashSet::new()).unwrap();

        let hooks_zebra = rendered.find("zebra-hook").unwrap();
        let hooks_apple = rendered.find("apple-hook").unwrap();
        assert!(
            hooks_zebra < hooks_apple,
            "expected hooks keys in source order (zebra-hook, apple-hook), got: {rendered}"
        );
        let mcp_zebra = rendered.find("zebra-mcp").unwrap();
        let mcp_apple = rendered.find("apple-mcp").unwrap();
        assert!(
            mcp_zebra < mcp_apple,
            "expected mcpServers keys in source order (zebra-mcp, apple-mcp), got: {rendered}"
        );
    }

    /// Data-integrity regression guard: a `claudeCli.skills` entry naming
    /// a skill that does not exist in `model.skills` must be rejected
    /// loudly, mirroring `kiro_cli_v2.rs`'s own
    /// `render_agent_file_rejects_dangling_skill_resource`. This fails
    /// (returns `Ok` instead of `Err`) if `render_agent_md`'s
    /// `skill_names.contains(..)` guard is ever removed.
    #[test]
    fn render_agent_md_rejects_dangling_skill_reference() {
        let claude = ClaudeCliConfig {
            skills: vec!["does-not-exist".to_string()],
            ..Default::default()
        };
        let agent = agent_with_claude("k-example", claude);
        let claude_cfg = agent.client_config.claude_cli.as_ref().unwrap();
        let result = render_agent_md("k-example", &agent.config, claude_cfg, &HashSet::new());
        let err = match result {
            Ok(_) => panic!("expected a dangling claudeCli skill reference to be rejected"),
            Err(e) => e,
        };
        assert!(err.contains("k-example"));
        assert!(err.contains("does-not-exist"));
    }

    /// `transform` itself (not just `render_agent_md` in isolation) must
    /// surface the same dangling-skill failure as a transformer error,
    /// mapped to `EXIT_USAGE_ERROR` by the caller.
    #[test]
    fn transform_rejects_agent_with_dangling_claude_skill_reference() {
        let dir = temp_dir("dangling-skill-transform");
        let claude = ClaudeCliConfig {
            skills: vec!["does-not-exist".to_string()],
            ..Default::default()
        };
        let model = CanonicalModel {
            agents: vec![agent_with_claude("k-example", claude)],
            ..Default::default()
        };
        let result = ClaudeTransformer.transform(&model, &dir);
        assert!(
            result.is_err(),
            "expected transform to reject a dangling claudeCli skill reference"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// A `claudeCli.skills` entry naming a REAL packaged skill must
    /// still succeed once that skill is present in `model.skills` --
    /// proving the validation added above checks against the actual
    /// model, not a hardcoded rejection.
    #[test]
    fn transform_accepts_agent_whose_claude_skill_reference_exists_in_model() {
        let dir = temp_dir("real-skill-reference");
        let claude = ClaudeCliConfig {
            skills: vec!["constraints".to_string()],
            ..Default::default()
        };
        let model = CanonicalModel {
            agents: vec![agent_with_claude("k-example", claude)],
            skills: vec![minimal_skill("constraints")],
            ..Default::default()
        };
        let result = ClaudeTransformer.transform(&model, &dir);
        assert!(
            result.is_ok(),
            "expected transform to accept a claudeCli skill reference matching a real skill, got: {result:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transform_writes_one_md_file_per_claude_cli_agent() {
        let dir = temp_dir("write");
        let model = CanonicalModel {
            agents: vec![agent_with_claude("k-example", ClaudeCliConfig::default())],
            ..Default::default()
        };
        ClaudeTransformer.transform(&model, &dir).unwrap();

        let written = dir.join(expected_output_dir()).join("k-example.md");
        assert!(written.exists());
        let contents = fs::read_to_string(&written).unwrap();
        assert!(contents.starts_with("---\n"));
        assert!(contents.contains("name: k-example"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transform_on_empty_model_writes_nothing_and_succeeds() {
        let dir = temp_dir("empty-model");
        let model = CanonicalModel::default();
        assert!(ClaudeTransformer.transform(&model, &dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
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
        let model = CanonicalModel {
            skills: vec![skill],
            ..Default::default()
        };

        ClaudeTransformer.transform(&model, &dir).unwrap();

        let skill_dir = dir
            .join(ClaudeTransformer.name())
            .join(SKILLS_CONTENT_TYPE_DIR)
            .join("konductor-example-skill");
        let skill_md = skill_dir.join("SKILL.md");
        assert!(skill_md.exists());
        assert_eq!(
            fs::read_to_string(&skill_md).unwrap(),
            "---\nname: konductor-example-skill\ndescription: A test skill.\n---\n\n# Body\n\nContent.\n"
        );

        let script = skill_dir.join("scripts/run.sh");
        assert!(script.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let script_mode = fs::metadata(&script).unwrap().permissions().mode() & 0o777;
            assert_eq!(
                script_mode, 0o755,
                "executable auxiliary file must be 0o755"
            );
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transform_writes_one_sop_md_file_per_sop() {
        let dir = temp_dir("sop-write");
        let model = CanonicalModel {
            sops: vec![SopDef {
                name: "k-example-sop".to_string(),
                body: "# Example SOP\n\nBody.\n".to_string(),
            }],
            ..Default::default()
        };

        ClaudeTransformer.transform(&model, &dir).unwrap();

        let written = dir
            .join(ClaudeTransformer.name())
            .join(SOPS_CONTENT_TYPE_DIR)
            .join("k-example-sop.sop.md");
        assert!(written.exists());
        assert_eq!(
            fs::read_to_string(&written).unwrap(),
            "# Example SOP\n\nBody.\n"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transform_writes_context_file() {
        let dir = temp_dir("context-write");
        let model = CanonicalModel {
            context: vec![ContextDef {
                name: "routing-rules.md".to_string(),
                body: "# Routing rules\n".to_string(),
            }],
            ..Default::default()
        };

        ClaudeTransformer.transform(&model, &dir).unwrap();

        let written = dir
            .join(ClaudeTransformer.name())
            .join(CONTEXT_CONTENT_TYPE_DIR)
            .join("routing-rules.md");
        assert_eq!(fs::read_to_string(&written).unwrap(), "# Routing rules\n");

        let _ = fs::remove_dir_all(&dir);
    }

    /// Security regression guard: `ParsedAgentSpec` can be constructed
    /// directly (bypassing the parser's `validate_agent_name`), so
    /// `transform` must reject a path-traversal name on its own.
    #[test]
    fn transform_rejects_path_traversal_agent_name_constructed_without_parser() {
        let output_root = temp_dir("traversal-bypass");
        let escape_target = output_root.join("evil.md");

        let model = CanonicalModel {
            agents: vec![agent_with_claude("../../evil", ClaudeCliConfig::default())],
            ..Default::default()
        };

        let result = ClaudeTransformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject a path-traversal agent name"
        );
        assert!(
            !escape_target.exists(),
            "path-traversal agent name must not escape output_dir, but found: {}",
            escape_target.display()
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    /// Security regression guard: a `SkillDef` built directly with a
    /// path-traversal name must be rejected by `transform` itself.
    #[test]
    fn transform_rejects_path_traversal_skill_name_constructed_without_parser() {
        let output_root = temp_dir("skill-traversal-bypass");
        let escape_target = output_root.join("SKILL.md");

        let model = CanonicalModel {
            skills: vec![minimal_skill("../../evil")],
            ..Default::default()
        };

        let result = ClaudeTransformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject a path-traversal skill name"
        );
        assert!(!escape_target.exists());

        let _ = fs::remove_dir_all(&output_root);
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

        let result = ClaudeTransformer.transform(&model, &output_root);
        assert!(
            result.is_err(),
            "expected transform to reject a './SKILL.md' auxiliary file that would collide \
             with the real SKILL.md"
        );

        let _ = fs::remove_dir_all(&output_root);
    }

    /// Re-running `transform` after a skill is removed from the model
    /// must not leave the stale skill directory behind.
    #[test]
    fn transform_rerun_removes_stale_skill_output() {
        let dir = temp_dir("rerun-removes-stale");
        let first_model = CanonicalModel {
            skills: vec![minimal_skill("will-be-removed")],
            ..Default::default()
        };
        ClaudeTransformer.transform(&first_model, &dir).unwrap();
        assert!(dir
            .join(ClaudeTransformer.name())
            .join(SKILLS_CONTENT_TYPE_DIR)
            .join("will-be-removed")
            .exists());

        let second_model = CanonicalModel {
            skills: vec![minimal_skill("still-here")],
            ..Default::default()
        };
        ClaudeTransformer.transform(&second_model, &dir).unwrap();

        assert!(!dir
            .join(ClaudeTransformer.name())
            .join(SKILLS_CONTENT_TYPE_DIR)
            .join("will-be-removed")
            .exists());
        assert!(dir
            .join(ClaudeTransformer.name())
            .join(SKILLS_CONTENT_TYPE_DIR)
            .join("still-here")
            .exists());

        let _ = fs::remove_dir_all(&dir);
    }

    // ── _sop_scopes.json sidecar ──────────────────────────────────────

    /// Consistency regression guard for the Claude transformer, paired
    /// with `kiro_cli_v2.rs`'s own equivalent test. On Kiro CLI, an
    /// agent literally named `_sop_scopes` would clobber the real
    /// `_sop_scopes.json` sidecar, since both share the same `.json`
    /// output path -- see `RESERVED_SOP_SCOPES_AGENT_NAME`'s doc comment
    /// for that collision. Claude writes `<agent_name>.md` instead
    /// (`write_agent_file` below), a different filename from the `.json`
    /// sidecar, so no clobber is possible here. This test verifies only
    /// that Claude's transformer also rejects the reserved name
    /// (constructed directly via `CanonicalModel`, bypassing the
    /// parser's own `validate_agent_name` rejection), via the same
    /// `reject_unsafe_agent_name` call `write_agent_file` makes -- kept
    /// disallowed on both harnesses for naming consistency, not because
    /// Claude needs the same fix.
    #[test]
    fn transform_rejects_agent_name_constructed_without_parser_reserved_for_sop_scopes_sidecar() {
        let output_root = temp_dir("sop-scopes-reserved-name-bypass");
        let agents_dir = output_root.join(expected_output_dir());
        let sidecar_path = agents_dir.join(SOP_SCOPES_SIDECAR_FILE);

        let model = CanonicalModel {
            agents: vec![agent_with_claude("_sop_scopes", ClaudeCliConfig::default())],
            ..Default::default()
        };

        let result = ClaudeTransformer.transform(&model, &output_root);
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

    /// Same as `agent_with_claude`, but also populates
    /// `dependencies.agentSops.agentSopNames` -- the field
    /// `write_sop_scopes_sidecar` reads directly.
    fn agent_with_claude_and_sop_names(
        name: &str,
        claude: ClaudeCliConfig,
        sop_names: &[&str],
    ) -> ParsedAgentSpec {
        let mut agent = agent_with_claude(name, claude);
        agent.dependencies.agent_sops.agent_sop_names =
            sop_names.iter().map(|n| n.to_string()).collect();
        agent
    }

    #[test]
    fn transform_writes_sop_scopes_sidecar_for_agents_with_sop_names() {
        let dir = temp_dir("sop-scopes-sidecar");
        let model = CanonicalModel {
            agents: vec![agent_with_claude_and_sop_names(
                "claude-example",
                ClaudeCliConfig::default(),
                &["ticket-sync", "code-review"],
            )],
            ..Default::default()
        };
        ClaudeTransformer.transform(&model, &dir).unwrap();

        let sidecar = dir
            .join(expected_output_dir())
            .join(SOP_SCOPES_SIDECAR_FILE);
        assert!(sidecar.exists());
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar).unwrap()).unwrap();
        assert_eq!(
            parsed,
            serde_json::json!({"claude-example": ["ticket-sync", "code-review"]})
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// An agent with no declared `agentSopNames` is omitted from the
    /// sidecar entirely -- same contract as the Kiro CLI transformer's
    /// own sidecar (see `kiro_cli_v2::write_sop_scopes_sidecar`'s doc
    /// comment).
    #[test]
    fn transform_omits_agents_with_no_sop_names_from_sop_scopes_sidecar() {
        let dir = temp_dir("sop-scopes-sidecar-empty");
        let model = CanonicalModel {
            agents: vec![
                agent_with_claude_and_sop_names(
                    "has-sops",
                    ClaudeCliConfig::default(),
                    &["ticket-sync"],
                ),
                agent_with_claude("no-sops", ClaudeCliConfig::default()),
            ],
            ..Default::default()
        };
        ClaudeTransformer.transform(&model, &dir).unwrap();

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

    /// An agent with no `clientConfig.claudeCli` section at all (skipped
    /// by the main per-agent loop above) is also correctly excluded from
    /// the sidecar even if it declares `agentSopNames` -- the sidecar is
    /// scoped to this harness's own agents, same as the Markdown files.
    #[test]
    fn transform_still_writes_sop_scopes_sidecar_when_no_agents_target_claude() {
        let dir = temp_dir("sop-scopes-sidecar-no-claude-agents");
        let mut agent = agent_with_claude_and_sop_names(
            "kiro-only",
            ClaudeCliConfig::default(),
            &["ticket-sync"],
        );
        agent.client_config.claude_cli = None;
        let model = CanonicalModel {
            agents: vec![agent],
            ..Default::default()
        };
        ClaudeTransformer.transform(&model, &dir).unwrap();

        let sidecar = dir
            .join(expected_output_dir())
            .join(SOP_SCOPES_SIDECAR_FILE);
        assert!(
            sidecar.exists(),
            "the sidecar is written unconditionally per transform(), even with zero claudeCli agents"
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&sidecar).unwrap()).unwrap();
        assert_eq!(
            parsed,
            serde_json::json!({"kiro-only": ["ticket-sync"]}),
            "write_sop_scopes_sidecar reads dependencies.agentSops.agentSopNames directly from \
             CanonicalModel.agents, independent of whether the agent has a claudeCli client config"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
