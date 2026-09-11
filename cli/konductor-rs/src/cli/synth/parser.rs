// SPDX-License-Identifier: Apache-2.0
//
// synth/parser.rs — version-aware parser for source `*.agent-spec.json`
// files (task 2.1).
//
// Reads and deserializes agent-spec JSON into `ParsedAgentSpec`, an
// intermediate representation (IR) one seam removed from the raw file:
// downstream code (task 2.2's `CanonicalModel`) consumes `ParsedAgentSpec`
// values and never re-parses JSON or touches `serde_json::Value` for any
// field whose shape is fixed by the schema. Dispatch is on the spec's
// `schemaVersion` field so future schema versions can be normalized here
// without changing the IR's public shape.

use serde::Deserialize;
use std::fmt;
use std::fs;
use std::path::Path;

use super::path_safety::{
    case_insensitive_fold_key, RESERVED_SKILL_SCOPES_AGENT_NAME, RESERVED_SOP_SCOPES_AGENT_NAME,
};

/// Schema versions this parser understands. Only `"1"` exists today;
/// normalizing a future version into the same `ParsedAgentSpec` shape is
/// this module's extension seam.
const SUPPORTED_SCHEMA_VERSIONS: &[&str] = &["1"];

/// Files larger than this are rejected before being read into memory.
const MAX_SPEC_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// `ParsedAgentSpec.name` longer than this is rejected. Unlike a skill
/// name (`parse_canonical.rs::validate_skill_name`, capped at 64 ASCII
/// chars with no combining-mark risk), an agent name has no charset
/// restriction, so an unbounded name is also an unbounded input to
/// `path_safety::case_insensitive_fold_key`'s NFC normalization pass --
/// this cap keeps a pathological combining-mark run's absolute size
/// small as a second line of defense alongside that function's own
/// `.stream_safe()` guard, rather than relying on `stream_safe()` alone.
/// 128 gives generous headroom over any real agent name in this
/// package's own fixture corpus while staying far below anything that
/// could make per-name normalization cost noticeable.
const MAX_AGENT_NAME_CHARS: usize = 128;

/// Serde default for `KiroCliConfig::tools_settings`: an empty JSON
/// object rather than `Value::Null`.
fn default_empty_object() -> serde_json::Value {
    serde_json::Value::Object(Default::default())
}

/// Structured parse failure: which file, which field (if known), and why.
/// Mirrors the "structured error (file, field, reason)" contract from the
/// synth transformer design.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub file: String,
    pub field: Option<String>,
    pub reason: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.field {
            Some(field) => write!(f, "{}: field '{}': {}", self.file, field, self.reason),
            None => write!(f, "{}: {}", self.file, self.reason),
        }
    }
}

impl std::error::Error for ParseError {}

/// The parser's IR: a normalized, fully-typed view of one agent-spec file.
/// `CanonicalModel` (task 2.2) is built from a `Vec<ParsedAgentSpec>`
/// without needing to re-read or re-parse the source JSON. Built via
/// `From<SpecV1>` (see below), not deserialized directly, since its
/// field names are idiomatic snake_case rather than the wire format's
/// camelCase.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedAgentSpec {
    pub name: String,
    pub config: AgentConfig,
    pub dependencies: AgentDependencies,
    pub client_config: ClientConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentConfig {
    pub description: String,
    pub system_prompt: String,
    pub model: String,
}

/// All fields optional: a spec may declare none, some, or all of its
/// dependency kinds. Deserialized directly (shared by `SpecV1` with no
/// shadow type), so its fields are `rename_all`-mapped to the wire
/// format's camelCase keys.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDependencies {
    #[serde(default)]
    pub skills: std::collections::BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub context: ContextDeps,
    #[serde(default)]
    pub mcp_registry: std::collections::BTreeMap<String, McpServerDef>,
    #[serde(default)]
    pub agent_sops: AgentSopDeps,
}

/// Security contract: `context_names` is passed through verbatim and not
/// validated as a safe path/identifier. Consumers MUST validate/sanitize
/// before using it for file access.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDeps {
    #[serde(default)]
    pub context_names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSopDeps {
    #[serde(default)]
    pub agent_sop_names: Vec<String>,
}

/// MCP server launch definition. `command`/`args`/`url` are
/// launcher-specific and harness-consumed verbatim, not restructured
/// here.
///
/// Security contract: this parser does not validate or sanitize
/// `command`/`args`/`url`. Consumers MUST validate/sanitize these before
/// passing them to process execution or file access.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct McpServerDef {
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub url: Option<String>,
}

impl McpServerDef {
    /// Borrowed `(command, args, url)` triple, shared by every renderer
    /// that builds a per-target output shape from an `McpServerDef`:
    /// `claude.rs::render_mcp_servers` (a YAML sequence of single-key
    /// maps) and `kiro_cli_v2.rs::render_agent_file` (a JSON object
    /// keyed by server name). Both express the identical "`command`/
    /// `url` are `None` -> omitted downstream" rule on the same struct,
    /// so extracting it once here means a future field addition to
    /// `McpServerDef` only needs threading through in one place.
    ///
    /// `args` is returned unconditionally, never wrapped in an
    /// `Option`, because whether an EMPTY `args` is included in the
    /// rendered output is a genuine per-target-format decision, not
    /// part of this shared extraction: `kiro_cli_v2.rs`'s Kiro config
    /// format always emits `args: []` even when empty, while
    /// `claude.rs` omits an empty `args:` key entirely (see that
    /// module's own docstring, grounded against the real Claude Code
    /// live materialization). This method does not paper over that
    /// divergence -- each caller still decides for itself how to
    /// render `args`.
    pub(crate) fn command_args_url(&self) -> (Option<&str>, &[String], Option<&str>) {
        (self.command.as_deref(), &self.args, self.url.as_deref())
    }
}

/// Per-harness runtime configuration. Both fields optional: a spec may
/// target only one harness.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    #[serde(default)]
    pub kiro_cli: Option<KiroCliConfig>,
    #[serde(default)]
    pub claude_cli: Option<ClaudeCliConfig>,
}

/// Security contract: `resources` entries are passed through verbatim
/// and not validated as safe paths/URIs. Consumers MUST
/// validate/sanitize before using them for file access.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiroCliConfig {
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    /// Kept as raw JSON: shape varies per tool (e.g. `subagent`'s
    /// `trustedAgents`/`availableAgents`) and no downstream consumer
    /// needs a typed view of it yet. Defaults to an empty object when
    /// absent.
    #[serde(default = "default_empty_object")]
    pub tools_settings: serde_json::Value,
    /// Keeps keys in the order they appeared in the source JSON (unlike a
    /// sorted map, which would always alphabetize them) -- insertion
    /// order is load-bearing: downstream synth output must reproduce the
    /// author's original hook ordering.
    #[serde(default)]
    pub hooks: indexmap::IndexMap<String, serde_json::Value>,
    /// Keeps keys in the order they appeared in the source JSON (unlike a
    /// sorted map, which would always alphabetize them) -- insertion
    /// order is load-bearing: downstream synth output must reproduce the
    /// author's original server ordering.
    #[serde(default)]
    pub mcp_servers: indexmap::IndexMap<String, McpServerDef>,
    #[serde(default)]
    pub resources: Vec<String>,
}

/// Per-harness runtime configuration for the Claude Code target.
///
/// `hooks`/`mcp_servers`/`allowed_tools` are modeled because REAL,
/// currently committed agent-spec.json files across this workspace's
/// downstream packages -- not just synthetic test literals -- set
/// at least one of these three keys under `clientConfig.claudeCli` in
/// the majority of those packages' own real specs, and
/// `#[serde(deny_unknown_fields)]` (see below) requires every real key
/// to be modeled or parsing fails outright. Modeling them as
/// raw-JSON/typed passthrough (mirroring `KiroCliConfig`'s own
/// `hooks`/`mcp_servers`/`allowed_tools` shapes exactly -- same field
/// types, same insertion-order-preserving `IndexMap`) parses without
/// reintroducing the silent-drop problem `deny_unknown_fields` exists to
/// prevent. `claude.rs`'s transformer does not render any of the three
/// into Claude Code output yet -- that is a separate,
/// independently-scoped follow-up (rendering requires deciding how each
/// maps onto Claude Code's actual frontmatter/hooks-file shape, which
/// `render_agent_md`'s own module docstring already tracks for `tools`/
/// `skills`); this struct's scope is "parse real specs without data
/// loss," not "render everything they carry."
///
/// `#[serde(deny_unknown_fields)]`: with all three real fields modeled,
/// an unknown key is a genuine typo or a not-yet-discovered fourth
/// field, not a known-but-unmodeled one -- rejecting it loudly at parse
/// time (fail closed) is the safer default. `KiroCliConfig` does not
/// use this attribute, so this stays a deliberately narrower contract
/// for the newer side.
///
/// `tools` is `Option<Vec<String>>`, not `Vec<String>`: this preserves
/// the wire-level distinction between an OMITTED
/// `clientConfig.claudeCli.tools` key (per AIM's documented behavior,
/// "inherit the full default tool set" -- a permissive default) and an
/// EXPLICIT empty array (an empty allowlist -- no tools at all). A
/// plain `Vec<String>` with `#[serde(default)]` would collapse both
/// wire states to the same `vec![]` value, silently turning "inherit
/// defaults" into "grant zero tools" for any future spec that omits
/// the key. `skills` has no such documented absent-vs-empty semantic,
/// so it stays a plain `Vec<String>`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ClaudeCliConfig {
    #[serde(default)]
    pub tools: Option<Vec<String>>,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    /// Kept as raw JSON, same shape as `KiroCliConfig::hooks`: an event
    /// name (`"SessionStart"`, `"PreToolUse"`, ...) mapped to Claude
    /// Code's own matcher/hook array structure, which this parser has
    /// no typed model for and does not need one to parse-through and
    /// preserve. Order-preserving for the same reason as `KiroCliConfig`.
    #[serde(default)]
    pub hooks: indexmap::IndexMap<String, serde_json::Value>,
    /// Same shape and rationale as `KiroCliConfig::mcp_servers`.
    #[serde(default)]
    pub mcp_servers: indexmap::IndexMap<String, McpServerDef>,
}

/// Reads and parses one `*.agent-spec.json` file at `path` into a
/// `ParsedAgentSpec`. `path` is carried into any `ParseError` for
/// caller-side error reporting. Rejects files above
/// `MAX_SPEC_FILE_BYTES` before reading them into memory.
pub fn parse_agent_spec_file(path: &Path) -> Result<ParsedAgentSpec, ParseError> {
    let file_label = path.display().to_string();
    let metadata = fs::metadata(path).map_err(|e| ParseError {
        file: file_label.clone(),
        field: None,
        reason: format!("failed to read file: {e}"),
    })?;
    if metadata.len() > MAX_SPEC_FILE_BYTES {
        return Err(ParseError {
            file: file_label,
            field: None,
            reason: format!(
                "file size {} bytes exceeds maximum of {MAX_SPEC_FILE_BYTES} bytes",
                metadata.len()
            ),
        });
    }
    let raw = fs::read_to_string(path).map_err(|e| ParseError {
        file: file_label.clone(),
        field: None,
        reason: format!("failed to read file: {e}"),
    })?;
    parse_agent_spec_str(&raw, &file_label)
}

/// Parses agent-spec JSON already read into memory. Split from
/// `parse_agent_spec_file` so tests can exercise malformed input without
/// touching the filesystem.
pub fn parse_agent_spec_str(raw: &str, file_label: &str) -> Result<ParsedAgentSpec, ParseError> {
    let value: serde_json::Value = serde_json::from_str(raw).map_err(|e| ParseError {
        file: file_label.to_string(),
        field: None,
        reason: format!("invalid JSON: {e}"),
    })?;

    let schema_version = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ParseError {
            file: file_label.to_string(),
            field: Some("schemaVersion".to_string()),
            reason: "missing or not a string".to_string(),
        })?;

    if !SUPPORTED_SCHEMA_VERSIONS.contains(&schema_version) {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("schemaVersion".to_string()),
            reason: format!(
                "unsupported schema version '{schema_version}' (supported: {SUPPORTED_SCHEMA_VERSIONS:?})"
            ),
        });
    }

    // Only version "1" exists today; normalize_v1 is the seam for future
    // versions to convert into the same ParsedAgentSpec shape.
    normalize_v1(value, file_label)
}

/// Normalizes a schema-version-"1" JSON `Value` into `ParsedAgentSpec` via
/// serde's derived `Deserialize`, translating field-path errors into
/// `ParseError`.
fn normalize_v1(value: serde_json::Value, file_label: &str) -> Result<ParsedAgentSpec, ParseError> {
    let v1: SpecV1 = serde_json::from_value(value).map_err(|e| ParseError {
        file: file_label.to_string(),
        field: serde_path_to_field(&e),
        reason: e.to_string(),
    })?;
    let spec: ParsedAgentSpec = v1.into();
    validate_agent_name(&spec.name, file_label)?;
    Ok(spec)
}

/// Best-effort extraction of the offending field name from a
/// `serde_json::Error`'s `Display` output. Only applies the
/// backtick-extraction for two known message shapes -- "missing field
/// `x`" and "unknown field `x`, expected ..." (the latter matters
/// alongside `ClaudeCliConfig`'s `#[serde(deny_unknown_fields)]`: a
/// `deny_unknown_fields` violation's offending field name is right there
/// in the message, same as the missing-field case, so it is extracted
/// the same way rather than falling through to `None`).
/// Any other message shape (e.g. a type mismatch) falls back to `None`
/// rather than risk returning the offending value literal as a
/// misleading field name.
fn serde_path_to_field(err: &serde_json::Error) -> Option<String> {
    let msg = err.to_string();
    let rest = msg
        .strip_prefix("missing field ")
        .or_else(|| msg.strip_prefix("unknown field "))?;
    let field = rest.strip_prefix('`')?;
    let field = field.split('`').next()?;
    Some(field.to_string())
}

/// Wire shape for schema version "1", deserialized directly with serde's
/// `rename_all = "camelCase"` since the on-disk JSON uses camelCase keys
/// while `ParsedAgentSpec` and friends use idiomatic Rust snake_case.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpecV1 {
    name: String,
    config: ConfigV1,
    #[serde(default)]
    dependencies: AgentDependencies,
    client_config: ClientConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigV1 {
    description: String,
    system_prompt: String,
    model: String,
}

impl From<SpecV1> for ParsedAgentSpec {
    fn from(v1: SpecV1) -> Self {
        ParsedAgentSpec {
            name: v1.name,
            config: AgentConfig {
                description: v1.config.description,
                system_prompt: v1.config.system_prompt,
                model: v1.config.model,
            },
            dependencies: v1.dependencies,
            client_config: v1.client_config,
        }
    }
}

/// Validates a `ParsedAgentSpec.name`: non-empty, no path separators, not
/// `..`/absolute (a `HarnessTransformer` joins this value directly into
/// an output path, e.g. `kiro_cli_v2.rs`'s `write_agent_file`, so an
/// unvalidated name is a path-traversal vector), and not either reserved
/// name that collides with a sidecar file (see `path_safety::
/// RESERVED_SOP_SCOPES_AGENT_NAME`/`RESERVED_SKILL_SCOPES_AGENT_NAME`'s
/// own doc comments for the collisions this rejects). Defense-in-depth:
/// `path_safety::reject_unsafe_agent_name` also rejects an unsafe or
/// reserved name at the point of path construction, since this
/// parser-level check can be bypassed by constructing a `ParsedAgentSpec`
/// directly.
fn validate_agent_name(name: &str, file_label: &str) -> Result<(), ParseError> {
    if name.is_empty() {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must not be empty".to_string(),
        });
    }
    if name.chars().count() > MAX_AGENT_NAME_CHARS {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: format!("name must not exceed {MAX_AGENT_NAME_CHARS} characters"),
        });
    }
    if Path::new(name).is_absolute() {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must not be an absolute path".to_string(),
        });
    }
    if name == ".."
        || name.starts_with("../")
        || name.starts_with("..\\")
        || name.contains("/../")
        || name.contains("\\..\\")
        || name.ends_with("/..")
        || name.ends_with("\\..")
    {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must not be a parent-directory reference".to_string(),
        });
    }
    if name.contains('/') || name.contains('\\') {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: "name must not contain path separators".to_string(),
        });
    }
    if case_insensitive_fold_key(name) == case_insensitive_fold_key(RESERVED_SOP_SCOPES_AGENT_NAME)
    {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: format!(
                "name '{RESERVED_SOP_SCOPES_AGENT_NAME}' is reserved -- it collides with the \
                 SOP-scope sidecar file ({RESERVED_SOP_SCOPES_AGENT_NAME}.json) once written to \
                 the same output directory"
            ),
        });
    }
    if case_insensitive_fold_key(name)
        == case_insensitive_fold_key(RESERVED_SKILL_SCOPES_AGENT_NAME)
    {
        return Err(ParseError {
            file: file_label.to_string(),
            field: Some("name".to_string()),
            reason: format!(
                "name '{RESERVED_SKILL_SCOPES_AGENT_NAME}' is reserved -- it collides with the \
                 skill-scope sidecar file ({RESERVED_SKILL_SCOPES_AGENT_NAME}.json) once \
                 written to the same output directory"
            ),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_v1_json() -> &'static str {
        r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": {
                "description": "Example agent.",
                "model": "claude-sonnet-5",
                "systemPrompt": "You are an example agent."
            },
            "dependencies": {
                "skills": {},
                "context": { "contextNames": ["routing.md"] },
                "mcpRegistry": {
                    "example-mcp": { "command": "uvx", "args": ["example-mcp@latest"] }
                },
                "agentSops": { "agentSopNames": ["example-sop"] }
            },
            "clientConfig": {
                "kiroCli": {
                    "tools": ["@builtin"],
                    "allowedTools": ["fs_read"],
                    "resources": ["file://AGENTS.md"]
                },
                "claudeCli": {
                    "tools": ["Read"],
                    "skills": ["constraints"]
                }
            }
        }"#
    }

    #[test]
    fn parses_valid_v1_spec_into_expected_ir() {
        let spec = parse_agent_spec_str(sample_v1_json(), "test.agent-spec.json").unwrap();

        assert_eq!(spec.name, "k-example");
        assert_eq!(spec.config.model, "claude-sonnet-5");
        assert_eq!(spec.config.system_prompt, "You are an example agent.");
        assert_eq!(
            spec.dependencies.context.context_names,
            vec!["routing.md".to_string()]
        );
        assert_eq!(
            spec.dependencies.agent_sops.agent_sop_names,
            vec!["example-sop".to_string()]
        );
        assert!(spec.dependencies.mcp_registry.contains_key("example-mcp"));
        assert_eq!(
            spec.dependencies.mcp_registry["example-mcp"].command,
            Some("uvx".to_string())
        );

        let kiro = spec.client_config.kiro_cli.expect("kiroCli present");
        assert_eq!(kiro.tools, vec!["@builtin".to_string()]);
        assert_eq!(kiro.allowed_tools, vec!["fs_read".to_string()]);

        let claude = spec.client_config.claude_cli.expect("claudeCli present");
        assert_eq!(claude.skills, vec!["constraints".to_string()]);
    }

    #[test]
    fn parses_spec_with_absent_optional_dependency_sections() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "k-minimal",
            "config": {
                "description": "Minimal agent.",
                "model": "claude-sonnet-5",
                "systemPrompt": "Minimal."
            },
            "clientConfig": { "kiroCli": { "tools": ["@builtin"] } }
        }"#;

        let spec = parse_agent_spec_str(json, "minimal.agent-spec.json").unwrap();
        assert!(spec.dependencies.skills.is_empty());
        assert!(spec.dependencies.mcp_registry.is_empty());
        assert!(spec.client_config.claude_cli.is_none());
    }

    #[test]
    fn rejects_malformed_json_with_file_context() {
        let err = parse_agent_spec_str("{ not valid json", "broken.agent-spec.json").unwrap_err();
        assert_eq!(err.file, "broken.agent-spec.json");
        assert!(err.field.is_none());
        assert!(err.reason.contains("invalid JSON"));
    }

    #[test]
    fn rejects_missing_schema_version() {
        let json = r#"{ "name": "k-example" }"#;
        let err = parse_agent_spec_str(json, "no-version.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("schemaVersion".to_string()));
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        let json = r#"{ "schemaVersion": "99", "name": "k-example" }"#;
        let err = parse_agent_spec_str(json, "future.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("schemaVersion".to_string()));
        assert!(err.reason.contains("unsupported schema version"));
    }

    #[test]
    fn rejects_agent_name_with_path_traversal() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "../../evil",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let err = parse_agent_spec_str(json, "traversal.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("parent-directory"));
    }

    /// Bare `".."` has no path separator, so it's the one traversal shape
    /// the separator check (`contains('/') || contains('\\')`) does not
    /// also catch -- this is what makes the dedicated `..`-equality check
    /// non-redundant.
    #[test]
    fn rejects_bare_parent_directory_agent_name() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "..",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let err = parse_agent_spec_str(json, "bare-dotdot.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("parent-directory"));
    }

    #[test]
    fn rejects_agent_name_with_path_separator() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "sub/evil",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let err = parse_agent_spec_str(json, "separator.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("path separators"));
    }

    #[test]
    fn rejects_agent_name_that_is_absolute_path() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "/tmp/evil",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let err = parse_agent_spec_str(json, "absolute.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("absolute path"));
    }

    #[test]
    fn rejects_empty_agent_name() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let err = parse_agent_spec_str(json, "empty-name.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("must not be empty"));
    }

    /// Regression guard for the exact collision this reservation exists
    /// to prevent: an agent literally named `_sop_scopes` would write its
    /// own file to the same output path the SOP-scope sidecar file
    /// writes to a moment later, silently clobbering the agent's file and
    /// then being excluded from the install-side copy pass.
    /// `validate_agent_name` must reject it at parse time, before it ever
    /// reaches a `HarnessTransformer`.
    #[test]
    fn rejects_agent_name_reserved_for_sop_scopes_sidecar() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "_sop_scopes",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let err = parse_agent_spec_str(json, "sop-scopes-collision.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("reserved"), "got: {}", err.reason);
    }

    /// Case-insensitive variants of the reserved name must be rejected
    /// too -- they resolve to the identical on-disk path once `.json` is
    /// appended, on a case-insensitive filesystem (macOS APFS default).
    #[test]
    fn rejects_agent_name_reserved_for_sop_scopes_sidecar_case_variant() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "_Sop_Scopes",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let err =
            parse_agent_spec_str(json, "sop-scopes-collision-case.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("reserved"), "got: {}", err.reason);
    }

    /// A name that merely contains the reserved literal as a substring
    /// must remain accepted -- this reservation is deliberately narrow to
    /// the exact collision, not a broad substring ban.
    #[test]
    fn accepts_agent_name_that_merely_contains_reserved_sop_scopes_literal() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "my_sop_scopes_agent",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let spec = parse_agent_spec_str(json, "sop-scopes-substring.agent-spec.json").unwrap();
        assert_eq!(spec.name, "my_sop_scopes_agent");
    }

    /// Regression guard for the exact collision this reservation exists
    /// to prevent: an agent literally named `_skill_scopes` would write
    /// its own file to the same output path the skill-scope sidecar file
    /// writes to a moment later, silently clobbering the agent's file and
    /// then being excluded from the install-side copy pass.
    /// `validate_agent_name` must reject it at parse time, before it ever
    /// reaches a `HarnessTransformer`.
    #[test]
    fn rejects_agent_name_reserved_for_skill_scopes_sidecar() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "_skill_scopes",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let err = parse_agent_spec_str(json, "skill-scopes-collision.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("reserved"), "got: {}", err.reason);
    }

    /// Case-insensitive variants of the reserved name must be rejected
    /// too -- they resolve to the identical on-disk path once `.json` is
    /// appended, on a case-insensitive filesystem (macOS APFS default).
    #[test]
    fn rejects_agent_name_reserved_for_skill_scopes_sidecar_case_variant() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "_Skill_Scopes",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let err =
            parse_agent_spec_str(json, "skill-scopes-collision-case.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("reserved"), "got: {}", err.reason);
    }

    /// A genuine Unicode near-miss, not merely an ASCII case variant: the
    /// KELVIN SIGN (U+212A) is a distinct, non-ASCII codepoint whose
    /// Unicode-aware lowercase mapping is the plain ASCII letter `k`, so
    /// `case_insensitive_fold_key` folds it onto the same key as the
    /// reserved literal even though `eq_ignore_ascii_case` -- which folds
    /// ASCII letters only -- would never have caught it (see
    /// `path_safety.rs`'s mirrored test,
    /// `reject_unsafe_agent_name_rejects_unicode_near_miss_of_reserved_skill_scopes_name`,
    /// for the byte-level detail). `validate_agent_name` must reject this
    /// at parse time too, not just at the transformer's own
    /// `reject_unsafe_agent_name` layer.
    #[test]
    fn rejects_agent_name_reserved_for_skill_scopes_sidecar_unicode_near_miss() {
        let json = "{
            \"schemaVersion\": \"1\",
            \"name\": \"_s\u{212A}ill_scopes\",
            \"config\": { \"description\": \"d\", \"systemPrompt\": \"s\", \"model\": \"m\" },
            \"clientConfig\": {}
        }";
        let err = parse_agent_spec_str(json, "skill-scopes-collision-unicode.agent-spec.json")
            .unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("reserved"), "got: {}", err.reason);
    }

    /// A name that merely contains the reserved literal as a substring
    /// must remain accepted -- this reservation is deliberately narrow to
    /// the exact collision, not a broad substring ban.
    #[test]
    fn accepts_agent_name_that_merely_contains_reserved_skill_scopes_literal() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "_skill_scopes_v2",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let spec = parse_agent_spec_str(json, "skill-scopes-substring.agent-spec.json").unwrap();
        assert_eq!(spec.name, "_skill_scopes_v2");
    }

    /// Regression guard for the `MAX_AGENT_NAME_CHARS` cap: an agent name
    /// longer than the limit must be rejected before it ever reaches
    /// `path_safety::case_insensitive_fold_key`'s NFC normalization pass,
    /// which is the second (defense-in-depth) leg of the fix alongside
    /// that function's own `.stream_safe()` guard.
    #[test]
    fn rejects_agent_name_exceeding_max_length() {
        let too_long = "x".repeat(MAX_AGENT_NAME_CHARS + 1);
        let json = format!(
            r#"{{
            "schemaVersion": "1",
            "name": "{too_long}",
            "config": {{ "description": "d", "systemPrompt": "s", "model": "m" }},
            "clientConfig": {{}}
        }}"#
        );
        let err = parse_agent_spec_str(&json, "too-long-name.agent-spec.json").unwrap_err();
        assert_eq!(err.field, Some("name".to_string()));
        assert!(err.reason.contains("must not exceed"));
    }

    /// Companion to the test above: a name exactly at the cap must still
    /// be accepted -- the boundary itself, not just values beyond it.
    #[test]
    fn accepts_agent_name_at_max_length() {
        let at_limit = "x".repeat(MAX_AGENT_NAME_CHARS);
        let json = format!(
            r#"{{
            "schemaVersion": "1",
            "name": "{at_limit}",
            "config": {{ "description": "d", "systemPrompt": "s", "model": "m" }},
            "clientConfig": {{}}
        }}"#
        );
        let spec = parse_agent_spec_str(&json, "at-limit-name.agent-spec.json").unwrap();
        assert_eq!(spec.name.chars().count(), MAX_AGENT_NAME_CHARS);
    }

    #[test]
    fn rejects_spec_missing_required_field() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": { "description": "No model or prompt." },
            "clientConfig": {}
        }"#;
        let err = parse_agent_spec_str(json, "missing-field.agent-spec.json").unwrap_err();
        assert_eq!(err.file, "missing-field.agent-spec.json");
        assert_eq!(err.field, Some("systemPrompt".to_string()));
    }

    #[test]
    fn field_mismatch_reports_correct_field_or_none_never_a_value_literal() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": { "description": "d", "systemPrompt": "s", "model": 42 },
            "clientConfig": {}
        }"#;
        let err = parse_agent_spec_str(json, "type-mismatch.agent-spec.json").unwrap_err();
        // Must be the field name "model" or None -- never "42" (the
        // offending value literal) or any other backtick-delimited token
        // from the serde error message.
        assert!(matches!(err.field.as_deref(), Some("model") | None));
    }

    #[test]
    fn rejects_file_larger_than_max_size() {
        let dir =
            std::env::temp_dir().join(format!("konductor-parser-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("oversized.agent-spec.json");
        let oversized = "x".repeat((MAX_SPEC_FILE_BYTES + 1) as usize);
        fs::write(&path, oversized).unwrap();

        let err = parse_agent_spec_file(&path).expect_err("oversized file must error");
        assert!(err.reason.contains("exceeds maximum"));

        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn parse_agent_spec_file_reports_missing_file() {
        let err = parse_agent_spec_file(Path::new("/nonexistent/agent.agent-spec.json"))
            .expect_err("nonexistent file must error");
        assert!(err.reason.contains("failed to read file"));
    }

    #[test]
    fn rejects_schema_version_wrong_type_number() {
        let err = parse_agent_spec_str(r#"{ "schemaVersion": 1 }"#, "f.json").unwrap_err();
        assert_eq!(err.field, Some("schemaVersion".to_string()));
        assert!(err.reason.contains("missing or not a string"));
    }

    #[test]
    fn rejects_schema_version_wrong_type_null() {
        let err = parse_agent_spec_str(r#"{ "schemaVersion": null }"#, "f.json").unwrap_err();
        assert_eq!(err.field, Some("schemaVersion".to_string()));
        assert!(err.reason.contains("missing or not a string"));
    }

    #[test]
    fn rejects_schema_version_empty_string_as_unsupported() {
        let err = parse_agent_spec_str(r#"{ "schemaVersion": "" }"#, "f.json").unwrap_err();
        assert_eq!(err.field, Some("schemaVersion".to_string()));
        assert!(err.reason.contains("unsupported schema version"));
    }

    #[test]
    fn rejects_invalid_utf8_file_content() {
        let dir =
            std::env::temp_dir().join(format!("konductor-parser-utf8-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("invalid-utf8.agent-spec.json");
        fs::write(&path, [0xff, 0xfe, 0xfd]).unwrap();

        let err = parse_agent_spec_file(&path).expect_err("invalid UTF-8 must error");
        assert!(err.reason.contains("failed to read file"));

        let _ = fs::remove_file(&path);
        let _ = fs::remove_dir(&dir);
    }

    #[test]
    fn duplicate_json_key_last_value_wins() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "first",
            "name": "second",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let spec = parse_agent_spec_str(json, "dup.agent-spec.json").unwrap();
        assert_eq!(spec.name, "second");
    }

    #[test]
    fn unknown_top_level_field_is_tolerated() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {},
            "unknownTopLevelField": "ignored"
        }"#;
        let spec = parse_agent_spec_str(json, "extra.agent-spec.json").unwrap();
        assert_eq!(spec.name, "k-example");
    }

    /// Schema regression guard: an
    /// omitted `clientConfig.claudeCli.tools` key must parse to `None`
    /// (inherit Claude Code's default tool set), not `Some(vec![])`
    /// (an empty allowlist -- no tools). Collapsing the two would
    /// silently turn "inherit defaults" into "grant zero tools" for any
    /// spec that omits the key, with no parse error to catch it.
    #[test]
    fn claude_cli_tools_absent_parses_to_none_not_empty_vec() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": { "claudeCli": { "skills": ["constraints"] } }
        }"#;
        let spec = parse_agent_spec_str(json, "claude-tools-absent.agent-spec.json").unwrap();
        let claude = spec.client_config.claude_cli.expect("claudeCli present");
        assert_eq!(
            claude.tools, None,
            "omitted claudeCli.tools must parse to None (inherit defaults), not Some(vec![]) \
             (an empty allowlist)"
        );
    }

    /// Companion to the test above: an EXPLICIT empty `tools: []` (an
    /// empty allowlist) must parse to `Some(vec![])`, distinct from the
    /// omitted-key `None` case.
    #[test]
    fn claude_cli_tools_explicit_empty_array_parses_to_some_empty_vec() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": { "claudeCli": { "tools": [], "skills": [] } }
        }"#;
        let spec = parse_agent_spec_str(json, "claude-tools-empty.agent-spec.json").unwrap();
        let claude = spec.client_config.claude_cli.expect("claudeCli present");
        assert_eq!(
            claude.tools,
            Some(Vec::new()),
            "an explicit empty tools array must parse to Some(vec![]) (an empty allowlist -- \
             no tools), distinct from an omitted tools key (None, inherit defaults)"
        );
    }

    /// Schema regression guard: `ClaudeCliConfig`'s
    /// `#[serde(deny_unknown_fields)]` must reject a wire field this IR
    /// does not model (a genuine typo, or a real Claude-Code-targeting
    /// field not yet modeled -- see `claude.rs`'s module docstring for
    /// which fields are modeled) with a loud parse error, rather than
    /// silently dropping it.
    #[test]
    fn rejects_unknown_field_under_claude_cli() {
        // "toolz" is not a real field -- `allowedTools`/`hooks`/
        // `mcpServers` are all modeled (see the test below) -- so this
        // exercises the genuine typo/unmodeled-field case that
        // `deny_unknown_fields` must still catch.
        let json = r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": { "claudeCli": { "tools": ["Read"], "toolz": ["fs_read"] } }
        }"#;
        let err = parse_agent_spec_str(json, "claude-unknown-field.agent-spec.json").unwrap_err();
        assert!(
            err.reason.contains("toolz"),
            "expected a loud parse error naming the unmodeled claudeCli field, got: {}",
            err.reason
        );
        assert_eq!(
            err.field,
            Some("toolz".to_string()),
            "a deny_unknown_fields violation must populate ParseError.field, same as a \
             missing-field error -- the offending name is right there in serde's own message"
        );
    }

    /// Schema regression guard: a `clientConfig.claudeCli` block shaped
    /// like the REAL, currently committed agent-spec.json files across
    /// this workspace's downstream packages (which set `hooks`/
    /// `mcpServers`/`allowedTools` -- this shape is drawn directly from
    /// those packages' own real specs, not invented for this test) must
    /// parse successfully, not error, since all three keys are modeled on
    /// `ClaudeCliConfig`.
    #[test]
    fn claude_cli_with_hooks_mcp_servers_and_allowed_tools_parses_successfully() {
        let json = r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {
                "claudeCli": {
                    "tools": ["Read", "Bash"],
                    "skills": ["constraints"],
                    "allowedTools": ["mcp__appsec-mcp__foo"],
                    "hooks": {
                        "PreToolUse": [
                            {
                                "matcher": "Bash",
                                "hooks": [{ "type": "command", "command": "echo hi" }]
                            }
                        ]
                    },
                    "mcpServers": {
                        "appsec-mcp": { "command": "appsec-mcp" }
                    }
                }
            }
        }"#;
        let spec =
            parse_agent_spec_str(json, "claude-real-shape.agent-spec.json").unwrap_or_else(|e| {
                panic!("expected the real downstream-package claudeCli shape to parse, got: {e}")
            });
        let claude = spec.client_config.claude_cli.expect("claudeCli present");
        assert_eq!(
            claude.allowed_tools,
            vec!["mcp__appsec-mcp__foo".to_string()]
        );
        assert!(claude.hooks.contains_key("PreToolUse"));
        assert_eq!(
            claude.mcp_servers["appsec-mcp"].command,
            Some("appsec-mcp".to_string())
        );
    }

    #[test]
    fn dependencies_explicit_empty_matches_omitted() {
        let base = r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "clientConfig": {}
        }"#;
        let omitted = parse_agent_spec_str(base, "omitted.json").unwrap();

        let explicit_empty = r#"{
            "schemaVersion": "1",
            "name": "k-example",
            "config": { "description": "d", "systemPrompt": "s", "model": "m" },
            "dependencies": {},
            "clientConfig": {}
        }"#;
        let empty = parse_agent_spec_str(explicit_empty, "empty.json").unwrap();

        assert_eq!(omitted.dependencies, empty.dependencies);
    }

    /// Test fixture (see `tests/fixtures/parser_cases.json`) so
    /// assertions are derived from one source of truth rather than
    /// hand-duplicated literals.
    const SHARED_FIXTURE_CASES: &str = include_str!("../../../tests/fixtures/parser_cases.json");

    #[test]
    fn shared_fixture_ok_cases_match_expected_ir() {
        let doc: serde_json::Value = serde_json::from_str(SHARED_FIXTURE_CASES).unwrap();
        let cases = doc["cases"].as_array().unwrap();
        let mut checked_ok = 0;
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let raw = case["raw_input"].as_str().unwrap();
            let Some(expected_ok) = case["expected"].get("ok") else {
                continue;
            };
            checked_ok += 1;
            let spec = parse_agent_spec_str(raw, name)
                .unwrap_or_else(|e| panic!("case {name} expected ok, got error: {e}"));

            assert_eq!(
                spec.name,
                expected_ok["name"].as_str().unwrap(),
                "case {name}: name"
            );
            assert_eq!(
                spec.config.description,
                expected_ok["config"]["description"].as_str().unwrap(),
                "case {name}: config.description"
            );
            assert_eq!(
                spec.config.system_prompt,
                expected_ok["config"]["system_prompt"].as_str().unwrap(),
                "case {name}: config.system_prompt"
            );
            assert_eq!(
                spec.config.model,
                expected_ok["config"]["model"].as_str().unwrap(),
                "case {name}: config.model"
            );

            let expected_deps = &expected_ok["dependencies"];
            let expected_context_names: Vec<String> = expected_deps["context_names"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect();
            assert_eq!(
                spec.dependencies.context.context_names, expected_context_names,
                "case {name}: dependencies.context_names"
            );

            let expected_agent_sop_names: Vec<String> = expected_deps["agent_sop_names"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect();
            assert_eq!(
                spec.dependencies.agent_sops.agent_sop_names, expected_agent_sop_names,
                "case {name}: dependencies.agent_sop_names"
            );

            let mut actual_mcp_keys: Vec<String> =
                spec.dependencies.mcp_registry.keys().cloned().collect();
            actual_mcp_keys.sort();
            let mut expected_mcp_keys: Vec<String> = expected_deps["mcp_registry_keys"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect();
            expected_mcp_keys.sort();
            assert_eq!(
                actual_mcp_keys, expected_mcp_keys,
                "case {name}: dependencies.mcp_registry keys"
            );

            // Optional: full per-entry shape (command/args/url), not just key presence.
            if let Some(expected_entries) = expected_deps.get("mcp_registry_entries") {
                let expected_entries = expected_entries.as_object().unwrap();
                for (mcp_name, expected_entry) in expected_entries {
                    let actual_entry = spec
                        .dependencies
                        .mcp_registry
                        .get(mcp_name)
                        .unwrap_or_else(|| panic!("case {name}: mcp_registry[{mcp_name}] missing"));
                    let expected_command = expected_entry["command"].as_str().map(str::to_string);
                    assert_eq!(
                        actual_entry.command, expected_command,
                        "case {name}: mcp_registry[{mcp_name}].command"
                    );
                    let expected_args: Vec<String> = expected_entry["args"]
                        .as_array()
                        .unwrap_or_else(|| {
                            panic!("case {name}: mcp_registry_entries[{mcp_name}].args missing or not an array")
                        })
                        .iter()
                        .map(|v| v.as_str().unwrap().to_string())
                        .collect();
                    assert_eq!(
                        actual_entry.args, expected_args,
                        "case {name}: mcp_registry[{mcp_name}].args"
                    );
                    let expected_url = expected_entry["url"].as_str().map(str::to_string);
                    assert_eq!(
                        actual_entry.url, expected_url,
                        "case {name}: mcp_registry[{mcp_name}].url"
                    );
                }
            }

            let expected_kiro_tools = expected_ok["kiro_cli_tools"].as_array();
            match (spec.client_config.kiro_cli.as_ref(), expected_kiro_tools) {
                (Some(kiro), Some(expected)) => {
                    let expected: Vec<String> = expected
                        .iter()
                        .map(|v| v.as_str().unwrap().to_string())
                        .collect();
                    assert_eq!(kiro.tools, expected, "case {name}: kiro_cli.tools");
                }
                (None, None) => {}
                other => panic!("case {name}: kiro_cli tools presence mismatch: {other:?}"),
            }

            let expected_kiro_allowed_tools = expected_ok["kiro_cli_allowed_tools"].as_array();
            if let Some(expected) = expected_kiro_allowed_tools {
                let kiro = spec.client_config.kiro_cli.as_ref().unwrap_or_else(|| {
                    panic!("case {name}: expected kiro_cli present, got absent")
                });
                let expected: Vec<String> = expected
                    .iter()
                    .map(|v| v.as_str().unwrap().to_string())
                    .collect();
                assert_eq!(
                    kiro.allowed_tools, expected,
                    "case {name}: kiro_cli.allowed_tools"
                );
            }

            // Optional: only asserted when the fixture case declares an expectation.
            if let Some(expected_tools_settings) = expected_ok.get("kiro_cli_tools_settings") {
                let kiro = spec.client_config.kiro_cli.as_ref().unwrap_or_else(|| {
                    panic!("case {name}: expected kiro_cli present, got absent")
                });
                assert_eq!(
                    &kiro.tools_settings, expected_tools_settings,
                    "case {name}: kiro_cli.tools_settings"
                );
            }

            if let Some(expected_hooks) = expected_ok.get("kiro_cli_hooks") {
                let kiro = spec.client_config.kiro_cli.as_ref().unwrap_or_else(|| {
                    panic!("case {name}: expected kiro_cli present, got absent")
                });
                let actual_hooks = serde_json::to_value(&kiro.hooks).unwrap();
                assert_eq!(&actual_hooks, expected_hooks, "case {name}: kiro_cli.hooks");
            }

            if let Some(expected_resources) = expected_ok
                .get("kiro_cli_resources")
                .and_then(|v| v.as_array())
            {
                let kiro = spec.client_config.kiro_cli.as_ref().unwrap_or_else(|| {
                    panic!("case {name}: expected kiro_cli present, got absent")
                });
                let expected: Vec<String> = expected_resources
                    .iter()
                    .map(|v| v.as_str().unwrap().to_string())
                    .collect();
                assert_eq!(kiro.resources, expected, "case {name}: kiro_cli.resources");
            }

            if let Some(expected_claude_tools) = expected_ok
                .get("claude_cli_tools")
                .and_then(|v| v.as_array())
            {
                let claude = spec.client_config.claude_cli.as_ref().unwrap_or_else(|| {
                    panic!("case {name}: expected claude_cli present, got absent")
                });
                let expected: Vec<String> = expected_claude_tools
                    .iter()
                    .map(|v| v.as_str().unwrap().to_string())
                    .collect();
                assert_eq!(
                    claude.tools,
                    Some(expected),
                    "case {name}: claude_cli.tools"
                );
            }

            let expected_claude_skills = expected_ok["claude_cli_skills"].as_array();
            match (
                spec.client_config.claude_cli.as_ref(),
                expected_claude_skills,
            ) {
                (Some(claude), Some(expected)) => {
                    let expected: Vec<String> = expected
                        .iter()
                        .map(|v| v.as_str().unwrap().to_string())
                        .collect();
                    assert_eq!(claude.skills, expected, "case {name}: claude_cli.skills");
                }
                (None, None) => {}
                other => panic!("case {name}: claude_cli skills presence mismatch: {other:?}"),
            }
        }
        assert!(checked_ok > 0, "expected at least one ok fixture case");
    }

    #[test]
    fn shared_fixture_error_cases_match_expected_field_and_reason() {
        let doc: serde_json::Value = serde_json::from_str(SHARED_FIXTURE_CASES).unwrap();
        let cases = doc["cases"].as_array().unwrap();
        let mut checked_err = 0;
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let raw = case["raw_input"].as_str().unwrap();
            let Some(expected_error) = case["expected"].get("error") else {
                continue;
            };
            checked_err += 1;
            let err = parse_agent_spec_str(raw, name)
                .expect_err(&format!("case {name} expected error, got ok"));

            // `field_rust` overrides the shared `field` expectation for
            // cases where this implementation's serde-derived error path
            // diverges from the shared expectation (see the fixture
            // file's schema note).
            let expected_field = if expected_error.get("field_rust").is_some() {
                expected_error["field_rust"].as_str()
            } else {
                expected_error["field"].as_str()
            };
            assert_eq!(
                err.field.as_deref(),
                expected_field,
                "case {name}: error.field"
            );

            if let Some(substring) = expected_error["reason_substring"].as_str() {
                assert!(
                    err.reason.contains(substring),
                    "case {name}: expected reason to contain {substring:?}, got {:?}",
                    err.reason
                );
            }
        }
        assert!(checked_err > 0, "expected at least one error fixture case");
    }
}
