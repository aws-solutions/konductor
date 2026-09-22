// SPDX-License-Identifier: Apache-2.0
//
// synth/kiro_cli_v3.rs — `HarnessTransformer` for Kiro CLI V3 (KAS)
// output. Structural sibling of `kiro_cli_v2.rs`: same four
// `stage_content_type` calls (agents/skills/sops/context), same
// skill/context resource normalization, same path-safety guards. The
// real differences are agent-file shape: V3 replaces V2's
// `toolsSettings` block with a unified `permissions.rules[]` array,
// uses tag-based tool IDs in `tools` instead of individual tool names,
// and requires `hooks` in KAS's array-of-documents form rather than
// V2's trigger-keyed object form (see `convert_hooks_for_v3`'s own
// docstring -- this is NOT one of the "no schema change" fields the
// rest of this module's rationale applies to).
//
// This module targets Kiro CLI V3 (the backend runtime Amazon calls
// "KAS" internally) specifically. Whether the same JSON shape is also
// consumed by the Kiro IDE agent picker is plausible but NOT formally
// confirmed by any of the public kiro.dev pages this module is grounded
// in -- verify against a real Kiro IDE install before assuming IDE
// compatibility.
//
// ── Source of truth ─────────────────────────────────────────────────────
// Every field mapping and capability name below is grounded in four
// kiro.dev pages, fetched directly on 2026-09-06/07 (not paraphrased
// from an earlier research pass):
//   - kiro.dev/docs/cli/v3/agent-config/   (V3 JSON + Markdown shape,
//     the tags-vs-capabilities split, the "toolsSettings is removed in
//     V3" statement, and the New Fields Reference Table)
//   - kiro.dev/docs/cli/v3/migration-guide/ (the toolsSettings ->
//     permissions.rules mapping table, the 2.x tool-ID table, and the
//     "both old camelCase IDs and new IDs are accepted... use the new
//     IDs going forward" backward-compat statement)
//   - kiro.dev/docs/permissions/            (the 12 permission
//     capabilities, the rule shape -- capability/match/effect/exclude
//     -- and the six-scope deny-overrides evaluation model)
//   - kiro.dev/docs/reference/built-in-tools/ (the confirmed tool-ID
//     alias pairs: read<->fs_read/fsRead, shell<->execute_bash/
//     execute_cmd, aws<->use_aws, subagent<->use_subagent)
//
// `hooks` conversion (`convert_hooks_for_v3`, `KAS_HOOK_TRIGGERS`) is the
// one exception to "grounded in the four kiro.dev pages above": no public
// page cited above documents KAS's hook-document schema. Confirmed instead
// against a vendored, canonically-derived copy of Kiro CLI's own
// `/upgrade-agent` engine's `kiro_config_migration/hooks.rs` module --
// the same copy `push_trusted_agent_rules` cites below -- whose `convert_hooks`/
// `object_form_to_docs`/`hook_entry_to_doc` functions implement this exact
// conversion: an object (even `{}`) fails whole-profile validation
// outright under KAS's `hooks: z.array(hookDocumentSchema)` schema, and
// the array-of-documents target shape (`{name, trigger, matcher?, action,
// timeout}`) is what that module emits. `convert_hooks_for_v3` below
// mirrors it (trigger validation against the five known triggers,
// `command`-less "tool hooks" dropped, `timeout_ms` -> seconds via
// ceiling-divide with a 1s floor, `name` synthesized as
// `<trigger>-<index>`) rather than leaving V2's trigger-keyed object
// shape as a raw passthrough, which is exactly the shape KAS's own
// validator rejects.
//
// ── Reconciling "rename" vs "alias" (no contradiction) ──────────────────
// The migration guide frames old tool IDs as renamed ("Old Tool ID
// (2.x)" / "New Tool ID" table); the built-in-tools reference frames a
// narrower subset of the same IDs as aliases of the current names. Both
// are true at once, not in tension: the migration guide's own prose
// settles it directly -- "Both old camelCase IDs and new IDs are
// accepted in agent profiles and permissions... Use the new IDs going
// forward." New tag names are canonical; old tool IDs remain accepted
// for backward compatibility. `TOOL_ID_TO_TAG` below emits the new
// canonical tag for every old ID this module has direct confirmation
// for; anything not in the table passes through unchanged rather than
// being invented (see the per-field comments on `map_tool_tag` and
// `resolve_allowed_tool`).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::content_writers::{write_all_context, write_all_skills, write_all_sops};
use super::kiro_cli_v2::{
    match_skill_resource, write_skill_scopes_sidecar, write_sop_scopes_sidecar,
    AGENTS_CONTENT_TYPE_DIR, CONTEXT_CONTENT_TYPE_DIR, SKILLS_CONTENT_TYPE_DIR,
    SOPS_CONTENT_TYPE_DIR,
};
use super::model::CanonicalModel;
use super::parser::KiroCliConfig;
use super::path_safety::reject_unsafe_agent_name;
use super::staging::stage_content_type;
use super::HarnessTransformer;

/// On-disk shape of a Kiro CLI V3 agent config file. Field order and
/// names mirror kiro.dev's own V3 agent-config reference, not
/// `KiroCliConfig`'s snake_case IR fields. `toolsSettings` has no
/// counterpart here -- confirmed removed in V3 (agent-config page:
/// "toolsSettings is removed in V3 — migrate per-tool rules to the
/// unified permissions block"), replaced by `permissions`.
///
/// V3-only fields the agent-config page's New Fields Reference Table
/// documents (`excludedTools`, `includeMcpJson`, `includePowers`) are
/// deliberately NOT emitted here: the source agent-spec schema
/// (`KiroCliConfig`) has no corresponding field to derive them from
/// today, and inventing a default would violate the "implement only
/// what's confirmed" contract this module is built under. A future
/// agent-spec schema change adding one of these would need a
/// corresponding `KiroCliConfig` field and a matching addition here, not
/// a fabricated default. This mirrors the existing project stance already
/// on record for these three fields.
///
/// `welcomeMessage` is emitted when the source spec's `clientConfig.kiroCli`
/// supplies it (`KiroCliConfig::welcome_message`), and omitted when absent.
/// It is a Kiro-only field, so it lives in the Kiro client config -- exactly
/// the "corresponding `KiroCliConfig` field plus a matching addition here"
/// the note above calls for.
#[derive(Serialize)]
struct KiroV3AgentFile<'a> {
    name: &'a str,
    description: &'a str,
    prompt: &'a str,
    model: &'a str,
    #[serde(rename = "welcomeMessage", skip_serializing_if = "Option::is_none")]
    welcome_message: Option<&'a str>,
    tools: Vec<String>,
    permissions: PermissionsBlock,
    #[serde(rename = "mcpServers")]
    mcp_servers: serde_json::Value,
    hooks: serde_json::Value,
    resources: Vec<String>,
}

/// The V3 `permissions` block. `rules` mirrors the shape confirmed on
/// kiro.dev/docs/permissions/ and corroborated by the migration guide's
/// own mapping table: an ordered list of `{capability, match, effect,
/// exclude}` objects. An agent with no derivable rules still emits
/// `permissions: {"rules": []}` rather than omitting the block --
/// minimal valid V3 output, not an absent key.
#[derive(Serialize)]
struct PermissionsBlock {
    rules: Vec<PermissionRule>,
}

/// One permission rule. `match` is a reserved word in Rust, so the
/// field is declared as the raw identifier `r#match` and renamed on the
/// wire via `#[serde(rename = "match")]` to match kiro.dev's own field
/// name exactly.
///
/// `match`/`exclude` are omitted from the rendered JSON when empty
/// (`skip_serializing_if`) rather than emitted as `[]` — kiro.dev's own
/// rule examples never show an empty `match`/`exclude` array alongside
/// a populated rule, so an empty array here would be this module's own
/// invention, not a confirmed shape.
#[derive(Serialize, Debug)]
struct PermissionRule {
    capability: String,
    #[serde(rename = "match", skip_serializing_if = "Vec::is_empty")]
    r#match: Vec<String>,
    effect: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    exclude: Vec<String>,
}

/// Confirmed old-tool-ID -> new-canonical-tag mappings for the `tools`
/// field, drawn directly from the two sources below (both fetched
/// 2026-09-06/07, see this module's header comment). Every entry here
/// is independently confirmed on at least one of the two pages; entries
/// NOT in this table (e.g. a bare individual MCP tool name, or a
/// server-scoped `@<server-name>` tag -- V3's tag table only confirms
/// the collective `@mcp`/`@builtin`/`*` forms, not per-server tags) pass
/// through `map_tool_tag` unchanged rather than being guessed at.
///
/// Sources, by row:
///   - `fs_read`/`fsRead` -> `read`, `execute_bash`/`execute_cmd` ->
///     `shell`, `use_aws` -> `aws`, `use_subagent` -> `subagent`:
///     built-in-tools reference's own "Aliases" field, confirmed
///     verbatim.
///   - `readFile` -> `read`, `writeFile`/`fsWrite` -> `write`,
///     `listDirectory` -> `glob`, `grepSearch` -> `grep`, `fileSearch`
///     -> `file_search`, `webFetch` -> `web_fetch`, `webSearch` ->
///     `web_search`: migration guide's "Old Tool ID (2.x)" / "New Tool
///     ID" table, confirmed verbatim (a second, stricter verbatim-only
///     fetch re-confirmed every row of this specific table).
///   - `todo`/`task` -> `todo_list`, `agent_crew` -> `subagent`: not
///     named on either public page above. Confirmed instead against
///     a vendored, canonically-derived copy of Kiro CLI's own
///     `/upgrade-agent` engine's `kiro_config_migration` module
///     (`tool_table.rs`/`vendored_types.rs` -- the same
///     copy `push_trusted_agent_rules` cites below): the vendored
///     `BuiltInToolName::Task`'s confirmed parse spellings are `todo`,
///     `task`, and `todo_list` (canonical display `todo_list`, upstream
///     `task/task_tool.rs`), and `BuiltInToolName::AgentCrew`'s are
///     `agent_crew` and `use_subagent` (canonical display `subagent`,
///     upstream `agent_crew.rs`). `todo` additionally has direct in-repo
///     evidence -- four real agent-spec.json files across this workspace
///     declare the literal `"todo"` tool (two in this repo's own
///     `agents/`, two in a downstream internal package), and an
///     unconverted `"todo"` in a V3
///     agent's `tools` array is exactly the shape the real engine's own
///     V2-authorship detection flags as still needing migration -- so
///     `map_tool_tag` must convert it, the same way it already converts
///     every other tag on those agents.
///
///     `agentCrew` (camelCase) remains deliberately absent: the vendored
///     module's `BuiltInToolName::AgentCrew` accepts `agent_crew` and
///     `use_subagent` as parse spellings, not `agentCrew`, and neither
///     kiro.dev/docs/reference/built-in-tools/ nor any agent-spec.json
///     file in this repo names it either. Treat it as an unconfirmed
///     spelling, not an alias, unless a real source confirms otherwise.
///
///     Known gap this table does NOT cover: the same vendored
///     `tool_table.rs` also folds `WebFetch`/`WebSearch` into tag
///     `"web"`, and `Grep`/`Glob`/`Code`/`Introspect` into tag `"read"`
///     -- conflicting with this table's own `webFetch -> web_fetch`/
///     `webSearch -> web_search` rows (confirmed verbatim against the
///     public migration guide instead) and leaving bare `grep`/`glob`/
///     `code`/`introspect` uncovered entirely. No agent spec in this
///     package uses any of these five spellings literally (verified
///     across every declared `clientConfig.kiroCli.tools` array), so
///     only the `todo`/`task`/`agent_crew` rows above are currently
///     load-bearing. Resolving the `web`/`read` conflict against the
///     public guide is left to this module's doc owner.
const TOOL_ID_TO_TAG: &[(&str, &str)] = &[
    ("fs_read", "read"),
    ("fsRead", "read"),
    ("readFile", "read"),
    ("fs_write", "write"),
    ("fsWrite", "write"),
    ("writeFile", "write"),
    ("execute_bash", "shell"),
    ("execute_cmd", "shell"),
    ("use_aws", "aws"),
    ("use_subagent", "subagent"),
    ("listDirectory", "glob"),
    ("grepSearch", "grep"),
    ("fileSearch", "file_search"),
    ("webFetch", "web_fetch"),
    ("webSearch", "web_search"),
    ("todo", "todo_list"),
    ("task", "todo_list"),
    ("agent_crew", "subagent"),
];

/// Confirmed tool-ID -> permission-capability mappings, used to derive
/// `permissions.rules[]` entries from `allowedTools`. This is a
/// DIFFERENT mapping target than `TOOL_ID_TO_TAG` above: per the
/// agent-config page's own tags-vs-capabilities distinction ("Tags...
/// control visibility... Capabilities... control authorization... They
/// don't map 1:1"), a tag like `web` fans out to two separate
/// capabilities (`web_fetch`, `web_search`); an old individual tool ID
/// maps directly to ONE capability, per the migration guide's own
/// "Capability" column.
///
/// `"@builtin"` -> `"builtin"` and `"*"` -> `"all"` are the two
/// meta-capabilities kiro.dev/docs/permissions/ confirms by name
/// ("`all` (everything), `builtin` (all built-in tools)").
///
/// `"@mcp"` -> `"mcp"` is a third row of the same shape, for a
/// different reason: the agent-config page's Tags vs Capabilities table
/// confirms `@mcp` as a collective TAG meaning "All MCP server tools"
/// (alongside `@builtin` and `*`), and the permissions page's own match
/// semantics (a rule with no `match` array applies unscoped) make an
/// unscoped `mcp` capability rule the correct permission-side
/// equivalent of that collective grant. Without this row, `@mcp` falls
/// through to `resolve_allowed_tool`'s `@<server>[/<tool>]`
/// prefix-parsing path below, which reads the literal text after `@` as
/// a server name -- misreading the collective grant as a scoped
/// reference to one (nonexistent) MCP server literally named `mcp`.
///
/// `"@<server>/<tool>"`-shaped entries (a namespaced MCP tool
/// reference, this repo's own convention -- see
/// `aim-agent-authoring`'s `allowedTools` syntax section) resolve to the
/// same confirmed `"mcp"` capability -- AND carry their own specific
/// `server/tool` match scope -- via `resolve_allowed_tool`'s own
/// prefix check below, not through this table.
///
/// `("tool_search", "mcp")`, `("code", "fs_read")`, and `("introspect",
/// "fs_read")` are NOT independently confirmed by kiro.dev's
/// agent-config page -- neither page names a capability for any of
/// these three tool IDs. They are inferred by analogy (`tool_search`
/// finds/loads MCP tools per the built-in-tools reference's own
/// description of it; `code`/`introspect` are named alongside
/// `grep`/`glob` in this repo's own `aim-agent-authoring` skill as
/// folding into the same `fs_read` capability), and corroborated by
/// that same `aim-agent-authoring` skill precedent, but treat them with
/// lower confidence than the rows above, which are drawn directly from
/// a cited table or field.
///
/// A `("delegate", "subagent")` row was considered and rejected: no
/// source confirms `delegate` as a real V2 tool ID or alias for
/// `subagent`. Checked against kiro.dev's built-in-tools reference
/// (confirms only `read<->fs_read/fsRead`,
/// `shell<->execute_bash/execute_cmd`, `aws<->use_aws`,
/// `subagent<->use_subagent`), a vendored, canonically-derived copy of
/// Kiro CLI's own `/upgrade-agent` engine's
/// `kiro_config_migration` module (`BuiltInToolName::AgentCrew`'s only
/// confirmed parse spellings are `agent_crew`/`use_subagent`, and its
/// `aliases()` returns only `agent_crew`), and the pinned
/// `testdata/upstream-aliases.txt` fixture (`AgentCrew = [agent_crew]`,
/// no `delegate`). Same treatment as the unconfirmed `agentCrew`
/// camelCase spelling: left out rather than guessed at.
///
/// `use_aws`/`aws` are deliberately ABSENT from this table (they exist
/// as tags in `TOOL_ID_TO_TAG`, mapping to the visibility tag `aws`, but
/// have no row here). kiro.dev/docs/permissions/ confirms exactly 12
/// capabilities and 3 meta-capabilities -- there is no `aws` capability
/// among them, and the migration guide's own §5 states "The built-in
/// `aws_tool` has been removed. Configure an AWS MCP server instead" --
/// which suggests AWS access is authorized via `mcp` in V3, not
/// `shell`, but that statement is about a different, removed tool
/// (`aws_tool`), not confirmed to describe the same `aws`/`use_aws` tool
/// ID this table would otherwise need a row for. Rather than guess at
/// either `shell` or `mcp`, this omits a row entirely: an `allowedTools`
/// entry naming `use_aws`/`aws` is skipped by `derive_permission_rules`
/// (see that function's `resolve_allowed_tool` call returning `None`),
/// same treatment as any other unconfirmed tool ID.
const TOOL_ID_TO_CAPABILITY: &[(&str, &str)] = &[
    ("fs_read", "fs_read"),
    ("fsRead", "fs_read"),
    ("readFile", "fs_read"),
    ("read", "fs_read"),
    ("fs_write", "fs_write"),
    ("fsWrite", "fs_write"),
    ("writeFile", "fs_write"),
    ("write", "fs_write"),
    ("execute_bash", "shell"),
    ("execute_cmd", "shell"),
    ("shell", "shell"),
    ("use_subagent", "subagent"),
    ("subagent", "subagent"),
    // agent_crew: same tool as use_subagent, see TOOL_ID_TO_TAG's sourcing note.
    ("agent_crew", "subagent"),
    ("listDirectory", "fs_read"),
    ("glob", "fs_read"),
    ("grepSearch", "fs_read"),
    ("grep", "fs_read"),
    ("grep_search", "fs_read"),
    ("fileSearch", "fs_read"),
    ("file_search", "fs_read"),
    ("code", "fs_read"),
    ("introspect", "fs_read"),
    ("webFetch", "web_fetch"),
    ("web_fetch", "web_fetch"),
    ("webSearch", "web_search"),
    ("web_search", "web_search"),
    ("tool_search", "mcp"),
    ("@builtin", "builtin"),
    ("@mcp", "mcp"),
    ("*", "all"),
];

/// Transforms `CanonicalModel` agents, skills, and SOPs into Kiro CLI V3
/// output. Same skip/staging/normalization contract as
/// `KiroCliV2Transformer` (see that type's own docstring) -- this
/// transformer differs only in the on-disk agent-file shape it renders.
///
/// Also writes the same `_sop_scopes.json`/`_skill_scopes.json` sidecars
/// `KiroCliV2Transformer` writes (via the identical, harness-agnostic
/// `write_sop_scopes_sidecar`/`write_skill_scopes_sidecar` functions,
/// which depend only on `model.agents` -- not on anything V2-specific),
/// so V3's install side (`install::kiro_cli_v3::install_agents`) can
/// scope the `konductor-skills` MCP grant per agent exactly the way V2
/// does, rather than granting it unscoped to every skill-bearing agent.
pub struct KiroCliV3Transformer;

impl HarnessTransformer for KiroCliV3Transformer {
    fn name(&self) -> &'static str {
        "kiro-v3"
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

/// Maps one `tools` entry to its V3 canonical tag via `TOOL_ID_TO_TAG`.
/// An entry not in the table passes through unchanged -- this includes
/// already-current tag names (`read`, `write`, `shell`, ...), the
/// collective markers (`@builtin`, `*`), and any server-scoped
/// `@<server-name>` entry, none of which this module's four source
/// pages confirm a rename for.
fn map_tool_tag(id: &str) -> String {
    TOOL_ID_TO_TAG
        .iter()
        .find(|(old, _)| *old == id)
        .map(|(_, new)| new.to_string())
        .unwrap_or_else(|| id.to_string())
}

/// Resolves one `allowedTools` entry to the permission capability it
/// authorizes, PLUS an optional scoped `match` pattern when the entry
/// itself carries one:
///   - a `TOOL_ID_TO_CAPABILITY` table entry (checked first, so a
///     recognized meta-marker like `"@builtin"` is never mistaken for
///     an MCP server named `builtin`) -> `(capability, None)` -- no
///     scope is encoded in the ID itself, so the only representable
///     grant is the whole capability.
///   - `@<server>/<tool>` -> `("mcp", Some("<server>/<tool>"))` -- the
///     entry names one specific tool on one specific server; kiro.dev/
///     docs/permissions/ confirms `server/tool` (and `server/*`) as the
///     MCP capability's own pattern syntax, so this is a direct
///     translation, not a guess.
///   - `@<server>` (bare, no `/`) -> `("mcp", Some("<server>/*"))` --
///     the entry names an entire server with no specific tool.
///     kiro.dev's own example shows `"my-server/*"` verbatim as the
///     "allow every tool on this server" form, so this is likewise a
///     confirmed translation, not a guess.
///   - anything else starting with `@` but malformed (`"@server/"`,
///     `"@/tool"`, bare `"@"`) -> `None`, same fail-closed treatment as
///     any other unconfirmed shape; this module does not guess at what
///     an empty server or tool name segment was supposed to mean.
///
/// Returns `None` entirely when the entry has no confirmed capability
/// mapping at all -- callers skip such entries rather than guess.
fn resolve_allowed_tool(id: &str) -> Option<(&'static str, Option<String>)> {
    if let Some((_, capability)) = TOOL_ID_TO_CAPABILITY.iter().find(|(old, _)| *old == id) {
        return Some((*capability, None));
    }
    let rest = id.strip_prefix('@')?;
    if rest.is_empty() {
        return None;
    }
    match rest.split_once('/') {
        Some((server, tool)) if !server.is_empty() && !tool.is_empty() => {
            Some(("mcp", Some(format!("{server}/{tool}"))))
        }
        None => Some(("mcp", Some(format!("{rest}/*")))),
        Some(_) => None,
    }
}

/// Direction-aware regex-to-glob conversion for `execute_bash.
/// allowedCommands`/`deniedCommands` entries, per the migration guide's
/// own stated scope: "Simple regex-to-glob conversion involves removing
/// anchors and swapping `.*` for `*`; complex regex requires splitting
/// into multiple glob rules." `regex_to_glob_simple` performs exactly
/// that simple half -- strip `^`/`$` anchors, replace `.*` with `*` --
/// and returns `None` when the result still contains a regex construct
/// the simple substitution does not understand: character classes
/// including negated ones like `[^&;]`, grouping, alternation, escapes,
/// a bare `.` (matches exactly one arbitrary character as regex, but
/// only a literal dot as glob), or a quantifier on any atom other than
/// `.` (e.g. the space-star in `git *`, which as regex means "zero or
/// more spaces" but as a literal glob character means "anything").
/// Those leftover constructs mean something DIFFERENT as a glob than
/// they did as regex -- e.g. the migration guide's own
/// `^cargo build[^&;]*$` (regex: "cargo build" plus any run of
/// non-`&`/`;` characters, i.e. explicitly excluding shell-chaining)
/// converts under the naive substitution alone to the glob
/// `cargo build[^&;]*`, which most glob engines do not give
/// bracket-negation semantics to, silently re-admitting exactly the
/// `&&`/`;`-chaining the source regex was written to exclude; and
/// `^git *$` converts under the same naive substitution to the glob
/// `git *`, where the space-star quantifier is left untouched and
/// misread as an unbounded glob wildcard, silently widening "git" plus
/// optional trailing spaces into "git" plus anything at all.
///
/// `regex_to_glob` wraps the simple conversion with a caller-chosen
/// safety direction, since "leftover regex construct" is not uniformly
/// unsafe -- it depends on which effect the resulting glob feeds:
///   - `for_allow_surface: true` (an `allowedCommands` entry, or the
///     `denyByDefault` `exclude` list -- which functions as an
///     allow-list INSIDE a deny rule) fails closed: a lossy glob that
///     matches MORE than the source regex would grant access the
///     source never intended, so an unconvertible pattern is DROPPED
///     (`None`) rather than emitted as a broadened "close enough" glob.
///   - `for_allow_surface: false` (a `deniedCommands` entry) has the
///     opposite safety direction: a lossy glob that matches MORE than
///     the source regex only denies a superset, which is the SAFE
///     direction (over-denying is conservative, not a security
///     regression). A bare `.` or a quantifier on a non-`.` atom is
///     widened to `*` (over-approximating "one arbitrary character" or
///     "zero or more of some atom" as "anything") rather than left as
///     a literal character that would UNDER-deny; character classes,
///     grouping, alternation, and escapes -- constructs this module
///     cannot parse precisely enough to widen span-by-span -- instead
///     collapse the WHOLE pattern to a bare `*` (guaranteed to match at
///     least everything the source regex denied, and typically much
///     more) rather than emitting the construct as literal glob text.
///     Literal text would UNDER-deny: e.g. `(foo|bar)` as glob matches
///     only the seven-character string "(foo|bar)", not "foo" or "bar"
///     as the source alternation intended, silently re-admitting both.
///     Dropping the deny rule outright, the allow-surface treatment
///     above, is not an option here -- it would REMOVE a restriction,
///     not add one, which is the wrong fail-safe direction for a deny
///     rule. Either way, an unanchored end (a
///     missing `^` or `$` in the source regex, meaning "starts
///     with"/"ends with" rather than an exact match) gets its own `*`
///     appended/prepended so the converted glob keeps matching as a
///     prefix/suffix under full-match glob semantics instead of
///     narrowing to an exact literal.
fn regex_to_glob_simple(pattern: &str) -> Option<String> {
    let stripped = pattern.strip_prefix('^').unwrap_or(pattern);
    let stripped = stripped.strip_suffix('$').unwrap_or(stripped);
    if has_bare_star_quantifier(stripped) {
        return None;
    }
    let converted = stripped.replace(".*", "*");
    let has_unsafe_leftover_regex_syntax = converted.chars().any(|c| {
        matches!(
            c,
            '[' | ']' | '(' | ')' | '\\' | '+' | '?' | '|' | '{' | '}' | '.'
        )
    });
    if has_unsafe_leftover_regex_syntax {
        return None;
    }
    Some(converted)
}

/// True when `pattern` contains a `*` that is not the second character
/// of a `.*` sequence -- i.e. a regex quantifier on some atom other
/// than `.` (e.g. the space-star in `git *`). This must run BEFORE
/// `regex_to_glob_simple`'s own `.replace(".*", "*")` step: afterward, a
/// `*` produced from a genuine `.*` and a `*` that was already a bare
/// quantifier in the source are indistinguishable in the output string.
fn has_bare_star_quantifier(pattern: &str) -> bool {
    pattern
        .match_indices('*')
        .any(|(i, _)| !pattern[..i].ends_with('.'))
}

/// Appends/prepends a `*` to `glob` when the source regex lacked the
/// corresponding anchor, so a converted deny-surface glob keeps its
/// "starts with"/"ends with" scope under full-match glob semantics
/// instead of silently narrowing to an exact-match literal. Only
/// meaningful, and only applied, on the deny surface: on the allow
/// surface, narrowing is the safe direction (matching LESS than the
/// source intended), so widening here would instead OVER-grant.
fn widen_unanchored_ends_for_deny(glob: String, original: &str, for_allow_surface: bool) -> String {
    if for_allow_surface {
        return glob;
    }
    let mut widened = glob;
    if !original.starts_with('^') && !widened.starts_with('*') {
        widened = format!("*{widened}");
    }
    if !original.ends_with('$') && !widened.ends_with('*') {
        widened = format!("{widened}*");
    }
    widened
}

/// Deny-surface-only widening for the two constructs
/// `regex_to_glob_simple` flags but that can still be represented
/// precisely as a broader glob: a bare `.` becomes `*` (any single
/// character over-approximated as "anything"), and an atom immediately
/// followed by `*` collapses to a bare `*` (a quantified atom
/// over-approximated as "anything"). Both directions only WIDEN the
/// match, which is safe on the deny surface. This function is only
/// reached when `pattern` contains none of the character-class/
/// grouping/alternation/escape syntax this module cannot parse (see the
/// caller) -- it never has to guess at a construct it does not
/// understand.
fn widen_dots_and_bare_quantifiers_for_deny(pattern: &str) -> String {
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next_is_star = chars.get(i + 1) == Some(&'*');
        if next_is_star {
            // Covers both `.` immediately followed by `*` (a leftover
            // `.*` pair the naive single-pass `.replace` did not catch,
            // e.g. from an input like `..*`) and any other atom
            // followed by `*` (a bare quantifier) -- both collapse to
            // the same widened `*`.
            out.push('*');
            i += 2;
        } else if c == '.' {
            out.push('*');
            i += 1;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

fn regex_to_glob(pattern: &str, for_allow_surface: bool) -> Option<String> {
    if let Some(glob) = regex_to_glob_simple(pattern) {
        return Some(widen_unanchored_ends_for_deny(
            glob,
            pattern,
            for_allow_surface,
        ));
    }
    if for_allow_surface {
        return None;
    }
    let stripped = pattern.strip_prefix('^').unwrap_or(pattern);
    let stripped = stripped.strip_suffix('$').unwrap_or(stripped);
    let naive = stripped.replace(".*", "*");
    let has_unparseable_regex_syntax = naive.chars().any(|c| {
        matches!(
            c,
            '[' | ']' | '(' | ')' | '\\' | '+' | '?' | '|' | '{' | '}'
        )
    });
    let widened = if has_unparseable_regex_syntax {
        // Character classes, grouping, alternation, and escapes can't be
        // widened span-by-span the way a bare `.` or quantifier can (see
        // this function's caller's docstring) -- leaving them as literal
        // glob text would UNDER-deny (e.g. `(foo|bar)` as glob only
        // matches the literal seven-character string, not "foo" or
        // "bar"). Collapse to a bare `*` instead: guaranteed to deny at
        // least everything the source regex denied.
        "*".to_string()
    } else {
        widen_dots_and_bare_quantifiers_for_deny(&naive)
    };
    Some(widen_unanchored_ends_for_deny(widened, pattern, false))
}

/// Derives `permissions.rules[]` from the source agent-spec's
/// `toolsSettings` (raw-JSON passthrough in the V2 IR) and `allowedTools`
/// fields, per the migration guide's own `toolsSettings` ->
/// `permissions.rules` table.
///
/// `toolsSettings` handling, one match arm per confirmed key:
///   - `execute_bash.allowedCommands`/`deniedCommands` -> `shell`
///     `allow`/`deny` rules (glob-converted via
///     `regex_to_glob_best_effort`). `execute_bash.denyByDefault: true`
///     -> a `shell` `deny` rule with `exclude` populated from
///     `allowedCommands` if present -- the migration guide's own
///     example row shows exactly this shape.
///   - `fs_read.allowedPaths`/`deniedPaths` -> `fs_read`
///     `allow`/`deny` rules, confirmed verbatim on the migration guide.
///   - `fs_write.allowedPaths`/`deniedPaths` -> `fs_write`
///     `allow`/`deny` rules. NOTE: the `fs_write.allowedPaths` row's
///     right-hand cell text was not independently re-confirmed by the
///     stricter verbatim-only re-fetch of this page (only its left-hand
///     `fs_write.allowedPaths` cell was) -- this arm is implemented by
///     direct structural analogy to the confirmed `fs_read` row (same
///     `toolsSettings` shape, same field name, same position in the
///     table), not by independent confirmation of its own right-hand
///     cell. Flagged here rather than silently treated as equally
///     confirmed.
///   - `subagent.trustedAgents` -> a scoped `subagent` `allow` rule (see
///     `push_trusted_agent_rules`'s own docstring for why this one
///     unconfirmed-by-the-migration-table key is deliberately mapped
///     anyway). `subagent.availableAgents` and any other `toolsSettings`
///     key (e.g. a hypothetical `web_fetch` settings block) have no
///     kiro.dev-documented mapping; deliberately skipped, not guessed
///     at.
///
/// `allowedTools` handling: each entry resolves to a capability (and,
/// for a namespaced MCP reference, a specific `server/tool` or
/// `server/*` scope) via `resolve_allowed_tool`. Per capability, a
/// SCOPED entry always wins: if any `allowedTools` entry for a
/// capability carried its own scope, exactly those scopes are emitted
/// and no unscoped fallback is added, even if a same-capability generic
/// entry (e.g. `tool_search` alongside a specific `@server/tool`) is
/// also present -- widening a proven-narrow grant back to "everything"
/// on the strength of one additional generic entry would silently
/// authorize more than the source ever granted. Only when NO entry for
/// a capability carries any scope at all does this fall back to an
/// unscoped `{capability, effect: "allow"}` rule -- the only
/// representable grant for a bare, unqualified V2 tool grant. A
/// capability that already has
/// an `allow` rule from the `toolsSettings` pass above is skipped
/// entirely here (that pass's rules are always at least as scoped as
/// what this loop could add). An entry with no confirmed capability
/// mapping is skipped.
fn derive_permission_rules(
    tools_settings: &serde_json::Value,
    allowed_tools: &[String],
) -> Vec<PermissionRule> {
    let mut rules = Vec::new();
    // Tracks capabilities with an ALLOW rule specifically -- NOT any
    // rule -- so a deny-only `toolsSettings` entry for a capability
    // never suppresses a legitimate allow grant for that same
    // capability from the `allowedTools` loop below. Tracking "any
    // rule" instead of "an allow rule" would make an
    // `fs_read.deniedPaths`-only settings block look like it already
    // "covers" `fs_read`, silently dropping a separate `fs_read` entry
    // in `allowedTools`.
    let mut capabilities_with_allow_rule: HashSet<&'static str> = HashSet::new();

    if let serde_json::Value::Object(map) = tools_settings {
        for (tool_key, settings) in map {
            match tool_key.as_str() {
                "execute_bash" => {
                    push_path_or_command_rules(
                        &mut rules,
                        &mut capabilities_with_allow_rule,
                        "shell",
                        settings,
                        "allowedCommands",
                        "deniedCommands",
                        true,
                    );
                }
                "fs_read" => {
                    push_path_or_command_rules(
                        &mut rules,
                        &mut capabilities_with_allow_rule,
                        "fs_read",
                        settings,
                        "allowedPaths",
                        "deniedPaths",
                        false,
                    );
                }
                "fs_write" => {
                    push_path_or_command_rules(
                        &mut rules,
                        &mut capabilities_with_allow_rule,
                        "fs_write",
                        settings,
                        "allowedPaths",
                        "deniedPaths",
                        false,
                    );
                }
                "subagent" => {
                    push_trusted_agent_rules(
                        &mut rules,
                        &mut capabilities_with_allow_rule,
                        settings,
                    );
                }
                _ => {
                    // No kiro.dev-documented mapping for this
                    // toolsSettings key -- deliberately skipped rather
                    // than guessed at (see this function's docstring).
                }
            }
        }
    }

    // Accumulate, per capability, every scoped match pattern seen (e.g.
    // every `@server/tool` reference for the same server ends up in one
    // rule listing every tool) plus whether any unscoped/generic entry
    // for that capability was also seen. One `IndexMap` (not `HashMap`)
    // keyed by capability keeps both pieces of state together in
    // first-seen order, so the emitted rule order is deterministic
    // across runs -- matching this crate's existing convention for
    // anything whose iteration order is user-visible -- without a
    // second unordered pass to de-duplicate capabilities afterward.
    #[derive(Default)]
    struct AllowedToolGrant {
        scoped_matches: Vec<String>,
        seen_scoped_matches: HashSet<String>,
        saw_unscoped: bool,
    }
    let mut grants: indexmap::IndexMap<&'static str, AllowedToolGrant> = indexmap::IndexMap::new();

    for tool_id in allowed_tools {
        let Some((capability, scope)) = resolve_allowed_tool(tool_id) else {
            continue;
        };
        let grant = grants.entry(capability).or_default();
        match scope {
            Some(pattern) => {
                if grant.seen_scoped_matches.insert(pattern.clone()) {
                    grant.scoped_matches.push(pattern);
                }
            }
            None => grant.saw_unscoped = true,
        }
    }

    for (capability, grant) in grants {
        if capabilities_with_allow_rule.contains(capability) {
            // Already covered by a scoped toolsSettings-derived allow
            // rule -- never redundant, never in tension with it.
            continue;
        }
        if !grant.scoped_matches.is_empty() {
            // At least one allowedTools entry for this capability
            // carried its own scope -- emit exactly that scope. A
            // same-capability unscoped/generic entry (`saw_unscoped`)
            // is deliberately NOT unioned into "allow everything": see
            // this function's own docstring.
            rules.push(PermissionRule {
                capability: capability.to_string(),
                r#match: grant.scoped_matches,
                effect: "allow",
                exclude: Vec::new(),
            });
        } else if grant.saw_unscoped {
            rules.push(PermissionRule {
                capability: capability.to_string(),
                r#match: Vec::new(),
                effect: "allow",
                exclude: Vec::new(),
            });
        }
    }

    rules
}

/// Shared implementation behind the three path/command `toolsSettings`
/// match arms in `derive_permission_rules`: extracts an
/// `allow_key`/`deny_key` glob list pair from `settings` and pushes the
/// corresponding `allow`/`deny` rules for `capability`. When
/// `apply_deny_by_default` is set (the `execute_bash`-only case), a
/// `denyByDefault: true` flag additionally pushes a `deny` rule with
/// `exclude` populated from the allow-list globs, per the migration
/// guide's own example row for that field. String values are
/// glob-converted via `regex_to_glob` when `convert_as_regex` is set
/// (shell commands are regex in V2 per the migration guide; filesystem
/// paths are already glob-shaped in both V2 and V3, so they pass
/// through unconverted) -- the allow-list conversion fails closed (a
/// pattern `regex_to_glob` cannot safely convert is DROPPED, not
/// emitted as a broadened glob), the deny-list conversion does not,
/// per `regex_to_glob`'s own docstring on why the two effects have
/// opposite safe directions.
///
/// Only inserts `capability` into `capabilities_with_allow_rule` when it
/// actually pushes an ALLOW rule -- a deny-only settings block (or a
/// denyByDefault rule, which is a deny variant despite carrying
/// allow-list globs in its `exclude`) must not mark the capability as
/// "has an allow rule".
fn push_path_or_command_rules(
    rules: &mut Vec<PermissionRule>,
    capabilities_with_allow_rule: &mut HashSet<&'static str>,
    capability: &'static str,
    settings: &serde_json::Value,
    allow_key: &str,
    deny_key: &str,
    convert_as_regex: bool,
) {
    let extract = |key: &str, for_allow_surface: bool| -> Vec<String> {
        settings
            .get(key)
            .and_then(serde_json::Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(serde_json::Value::as_str)
                    .filter_map(|s| {
                        if convert_as_regex {
                            regex_to_glob(s, for_allow_surface)
                        } else {
                            Some(s.to_string())
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    };

    let allow_globs = extract(allow_key, true);
    if !allow_globs.is_empty() {
        rules.push(PermissionRule {
            capability: capability.to_string(),
            r#match: allow_globs.clone(),
            effect: "allow",
            exclude: Vec::new(),
        });
        capabilities_with_allow_rule.insert(capability);
    }

    let deny_globs = extract(deny_key, false);
    if !deny_globs.is_empty() {
        rules.push(PermissionRule {
            capability: capability.to_string(),
            r#match: deny_globs,
            effect: "deny",
            exclude: Vec::new(),
        });
    }

    if convert_as_regex
        && settings
            .get("denyByDefault")
            .and_then(serde_json::Value::as_bool)
            == Some(true)
    {
        rules.push(PermissionRule {
            capability: capability.to_string(),
            r#match: Vec::new(),
            effect: "deny",
            exclude: allow_globs,
        });
    }
}

/// Converts `toolsSettings.subagent.trustedAgents` into a scoped
/// `subagent` `allow` rule. This is the one `toolsSettings` key this
/// module maps despite no migration-guide table row confirming it,
/// because silently dropping it would actively CAUSE a security
/// regression rather than merely under-implementing a feature: a V2
/// agent restricted to a specific trusted-subagent allowlist would
/// otherwise fall through to `allowedTools`'s generic `use_subagent`/
/// `subagent` entry (if present) and receive an UNSCOPED "allow any
/// subagent" rule instead, silently widening the grant.
/// `trustedAgents` is a real, existing V2 field (see
/// `KiroCliConfig::tools_settings`'s own docstring and
/// `kiro_cli_v2.rs`'s test fixtures).
///
/// kiro.dev's own public pages document no `subagent`-capability match
/// syntax at all (checked directly, not from memory, as part of this
/// fix), so `trustedAgents` specifically (as opposed to its sibling
/// `availableAgents`, see below) is not confirmed by a PUBLIC kiro.dev
/// source. It IS confirmed directly against a vendored,
/// canonically-derived copy of Kiro CLI's own
/// `/upgrade-agent` engine's `kiro_config_migration` module -- a vendored, canonically-derived
/// copy of Kiro CLI's own real `/upgrade-agent` engine, not a guess --
/// which shows, with a side-by-side per-agent table built from that
/// engine's actual installed output, that `permissions.rules`' derived
/// `subagent` allow/deny pair is bound to `trustedAgents` specifically
/// (the engine recomputes it from the agent's own composed
/// `toolsSettings.subagent.trustedAgents`), while the SEPARATE `tools`
/// array's `subagent/<name>` visibility TAGS are bound to the sibling
/// field `availableAgents` instead -- confirming the two artifacts are
/// driven by two different fields. This module's own tags-vs-capabilities
/// distinction (see `TOOL_ID_TO_CAPABILITY`'s docstring) is exactly that
/// same split: `trustedAgents` -> the `permissions.rules` capability this
/// function derives; `availableAgents` -> a `tools`-array visibility tag,
/// which is a DIFFERENT field (`tools`, not `toolsSettings`) that this
/// module's `map_tool_tag` path already handles independently and which
/// this function correctly does not touch.
///
/// `trustedAgents` entries are emitted as literal (non-glob) match
/// strings: kiro.dev/docs/permissions/'s "Pattern matching" section
/// documents glob syntax only for filesystem-capability and
/// shell/web/mcp-capability rules, NOT for `subagent` -- this
/// deliberately attempts no wildcard/glob interpretation of the agent
/// names, only exact literal strings, which match correctly under any
/// reasonable interpretation of `match` (literal or glob) since a plain
/// string with no metacharacters means the same thing either way.
///
/// `availableAgents` is deliberately NOT mapped into a `permissions.rules`
/// `subagent` entry by this function, per the internal evidence above:
/// it drives the `tools` array's visibility tags, not the authorization
/// rule this function derives. Mapping it here would conflate two
/// fields the vendored engine itself keeps separate.
fn push_trusted_agent_rules(
    rules: &mut Vec<PermissionRule>,
    capabilities_with_allow_rule: &mut HashSet<&'static str>,
    settings: &serde_json::Value,
) {
    let trusted: Vec<String> = settings
        .get("trustedAgents")
        .and_then(serde_json::Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    if trusted.is_empty() {
        return;
    }
    rules.push(PermissionRule {
        capability: "subagent".to_string(),
        r#match: trusted,
        effect: "allow",
        exclude: Vec::new(),
    });
    capabilities_with_allow_rule.insert("subagent");
}

/// KAS's five recognized hook triggers, camelCase, per Kiro CLI's own
/// real hook-trigger enum (see this module's header comment for the
/// provenance of this class of evidence). A V2 trigger spelling not in
/// this list has no KAS equivalent and is dropped by
/// `convert_hooks_for_v3` rather than guessed at.
const KAS_HOOK_TRIGGERS: &[&str] = &[
    "agentSpawn",
    "userPromptSubmit",
    "preToolUse",
    "postToolUse",
    "stop",
];

/// CLI absent-`timeout_ms` default, in milliseconds, per Kiro CLI's own
/// real V2 reader default -- KAS defaults an absent array-form `timeout`
/// to 60s, a different value, so an omitted V2 timeout is always emitted
/// explicitly here rather than left absent for KAS to default on its
/// own.
const DEFAULT_HOOK_TIMEOUT_MS: u64 = 10_000;

/// Converts V2's trigger-keyed `hooks` object into KAS's
/// array-of-documents form (`[{name, trigger, matcher?, action, timeout},
/// ...]`). Per this module's header comment, KAS's own validator rejects
/// object-form `hooks` outright ("fails whole-profile validation and
/// drops the entire agent") -- a raw passthrough of `kiro.hooks`'s
/// native, V2 object shape is exactly the shape that gets an agent's
/// entire profile rejected under V3, so this conversion is required, not
/// optional polish.
///
/// Mirrors Kiro CLI's own real hook-conversion algorithm (see this
/// module's header comment for why this class of evidence outranks the
/// four kiro.dev pages the rest of this module cites):
/// triggers are visited in sorted key order for deterministic output;
/// each trigger's entries are converted independently and indexed
/// (`<trigger>-<index>`) so KAS's required non-empty `name` is always
/// synthesized; a `timeout_ms` value converts to whole seconds via
/// ceiling division with a 1-second floor (an authored sub-second value,
/// or a literal `0`, maps to KAS's tightest expressible bound rather than
/// `0`, which KAS reads as "disabled" -- inverting the author's intent);
/// an absent `timeout_ms` still emits `timeout` at the CLI's own default
/// (10s), so the migrated hook does not silently run under KAS's larger
/// 60s default instead. A "tool hook" (no `command` key -- KAS's
/// `action` is a discriminated union with no non-command variant) and an
/// entry under an unrecognized trigger are both dropped rather than
/// emitted as an invalid document, matching the vendored engine's own
/// fail-safe: this crate has no warnings-collection mechanism to surface
/// the drop through (unlike the vendored engine's own
/// `MigrationWarning`), so silent omission is this module's equivalent of
/// that engine's "drop with a warning".
///
/// This function's array-form output does NOT reach AIM's own installer
/// merge path, so a known hazard elsewhere -- array-form hooks throwing
/// on that path, with the original silently kept on catch -- does not
/// apply to this output today. Verified, not assumed: `install/registry.rs`'s
/// `STRATEGIES` registers exactly two install strategies,
/// `KiroCliInstallStrategy` and `ClaudeInstallStrategy` -- there is no
/// `kiro-cli-v3` install strategy. `tests/synth_install_e2e.rs` states
/// this directly ("install (untouched by this CR) only ever reads from
/// the kiro-cli-v2 output today"), and this crate's `install` command
/// never reads `dist/kiro-cli-v3/` anywhere. Separately, the merge path
/// with that hazard (`adapter.rs`) lives entirely inside the vendored
/// upgrade-agent engine's own crate -- a different build tool (`aim-build`, driven by `aim
/// agents install`/`aim plugins install`) with its own separate pipeline
/// that composes `clientConfig.kiroCli` fragments from agent-spec.json
/// files directly; it never reads this crate's `dist/` output either.
/// `adapter.rs` does not exist anywhere in this crate's own source tree
/// (confirmed by search). So this is two genuinely separate,
/// non-intersecting pipelines today, not one gap silently glossed over:
/// this synth target's array-form hooks output has no current consumer
/// that could carry it into AIM's merge path. This determination holds
/// only as long as both stay true -- it must be re-checked if a
/// `kiro-cli-v3` install strategy is ever added, since that strategy
/// (unlike `KiroCliInstallStrategy` today) would be the first thing to
/// actually install this output into a live, possibly AIM-managed, agent
/// file.
fn convert_hooks_for_v3(
    hooks: &indexmap::IndexMap<String, serde_json::Value>,
) -> serde_json::Value {
    let mut trigger_keys: Vec<&String> = hooks.keys().collect();
    trigger_keys.sort();

    let mut docs: Vec<serde_json::Value> = Vec::new();
    for key in trigger_keys {
        if !KAS_HOOK_TRIGGERS.contains(&key.as_str()) {
            continue;
        }
        let Some(entries) = hooks[key].as_array() else {
            continue;
        };
        for (idx, entry) in entries.iter().enumerate() {
            if let Some(doc) = convert_hook_entry(key, idx, entry) {
                docs.push(doc);
            }
        }
    }
    serde_json::Value::Array(docs)
}

/// Converts one V2 hook entry (under `trigger`, at position `idx` within
/// that trigger's list) into a KAS hook document. Returns `None` for a
/// "tool hook" with no `command` -- see `convert_hooks_for_v3`'s own
/// docstring for why this is dropped rather than emitted.
///
/// `matcher` is carried over verbatim as an opaque string -- no
/// regex-to-glob rewrite, no alternation splitting, no validation of any
/// kind -- and this is deliberate, not an oversight. The vendored
/// `kiro_config_migration::hooks::hook_entry_to_doc` (a canonically-derived
/// copy of Kiro CLI's own `/upgrade-agent` engine,
/// `src/kiro_config_migration/hooks.rs`) is the canonical, real
/// `/upgrade-agent` conversion this function mirrors, and its own
/// handling of `matcher` is the identical single line: read the string if
/// present, insert it unchanged, nothing else. That module DOES carry a
/// dedicated regex-to-glob converter (`regex_to_glob.rs`), but it is wired
/// only into `permissions.rs` for the `shell`/`web_fetch` capability
/// `match` arrays derived from V2's `toolsSettings` -- `hooks.rs` never
/// calls it. So a hook's `matcher` and a `permissions.rules[].match`
/// entry are not the same kind of field despite the shared name: KAS
/// treats the latter as glob syntax (converted from V2's regex before
/// this crate ever sees it) but the vendored engine's own silence on any
/// matcher transformation for hooks is the evidence that KAS's hook
/// matcher is consumed as whatever raw string form the V2 hook already
/// used -- which already is a `|`-separated regex alternation in a real
/// agent spec elsewhere in this workspace (a security-gate hook's
/// matcher combining multiple guard patterns).
/// Converting or splitting that string here would not match the vendored
/// engine's own behavior and would risk breaking exactly the
/// security-gate matchers (read/write and push-gate guards)
/// this field exists to carry.
fn convert_hook_entry(
    trigger: &str,
    idx: usize,
    entry: &serde_json::Value,
) -> Option<serde_json::Value> {
    let obj = entry.as_object()?;
    let command = obj.get("command").and_then(serde_json::Value::as_str)?;

    let mut doc = serde_json::Map::new();
    doc.insert(
        "name".to_string(),
        serde_json::Value::String(format!("{trigger}-{idx}")),
    );
    doc.insert(
        "trigger".to_string(),
        serde_json::Value::String(trigger.to_string()),
    );
    if let Some(matcher) = obj.get("matcher").and_then(serde_json::Value::as_str) {
        doc.insert(
            "matcher".to_string(),
            serde_json::Value::String(matcher.to_string()),
        );
    }
    let mut action = serde_json::Map::new();
    action.insert(
        "type".to_string(),
        serde_json::Value::String("command".to_string()),
    );
    action.insert(
        "command".to_string(),
        serde_json::Value::String(command.to_string()),
    );
    doc.insert("action".to_string(), serde_json::Value::Object(action));

    let timeout_ms = obj
        .get("timeout_ms")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(DEFAULT_HOOK_TIMEOUT_MS);
    let timeout_secs = timeout_ms.div_ceil(1000).max(1);
    doc.insert("timeout".to_string(), serde_json::Value::from(timeout_secs));

    Some(serde_json::Value::Object(doc))
}

/// Builds the on-disk JSON shape for one V3 agent from its config and
/// `KiroCliConfig`. `tools`/`permissions`/`hooks` are the three fields
/// that differ from `kiro_cli_v2.rs::render_agent_file` (see
/// `convert_hooks_for_v3`'s own docstring for why `hooks` needs
/// converting, not just reusing V2's shape); `mcp_servers` and
/// `resources` follow the identical shape and rationale as the V2
/// transformer (see that function's own docstring) -- none of this
/// module's four kiro.dev source pages document a schema change for
/// those two fields between V2 and V3, so their V2 rendering is reused
/// as-is via the shared `match_skill_resource` helper rather than
/// re-implemented.
fn render_agent_file<'a>(
    name: &'a str,
    config: &'a super::parser::AgentConfig,
    kiro: &'a KiroCliConfig,
    context_names: &[String],
    skill_names: &HashSet<&str>,
) -> Result<KiroV3AgentFile<'a>, String> {
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

    let tools = kiro.tools.iter().map(|id| map_tool_tag(id)).collect();
    let rules = derive_permission_rules(&kiro.tools_settings, &kiro.allowed_tools);

    Ok(KiroV3AgentFile {
        name,
        description: &config.description,
        prompt: &config.system_prompt,
        model: &config.model,
        welcome_message: kiro.welcome_message.as_deref(),
        tools,
        permissions: PermissionsBlock { rules },
        mcp_servers,
        hooks: convert_hooks_for_v3(&kiro.hooks),
        resources,
    })
}

/// Identical normalization contract to
/// `kiro_cli_v2.rs::normalize_skill_resource` (see that function's own
/// docstring for the three-outcome behavior) -- shares its underlying
/// `match_skill_resource` match/prefix logic via the `pub(crate)` import
/// above so both transformers agree on exactly one definition of "is
/// this a packaged-skill reference," rather than duplicating it.
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

/// Writes `file` as pretty-printed JSON to `<output_dir>/<agent_name>.json`.
/// Same numeric-normalization and path-safety contract as
/// `kiro_cli_v2.rs::write_agent_file` (see that function's docstring) --
/// duplicated rather than shared because the two take different
/// `*AgentFile` types, and a shared generic seam is not worth the
/// indirection for two call sites with an otherwise-identical body.
fn write_agent_file(
    output_dir: &Path,
    agent_name: &str,
    file: &KiroV3AgentFile,
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

/// Identical to `kiro_cli_v2.rs::normalize_numbers` -- see that
/// function's docstring for why this normalization exists
/// (`arbitrary_precision` digit-text preservation). Duplicated rather
/// than shared for the same reason as `write_agent_file` above: no
/// shared type between the two call sites to hang a common helper off
/// without adding a generic seam neither module otherwise needs.
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

/// Identical to `kiro_cli_v2.rs::normalize_number` -- see that
/// function's docstring for the full overflow-handling rationale.
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
    use crate::cli::synth::kiro_cli_v2::{SKILL_SCOPES_SIDECAR_FILE, SOP_SCOPES_SIDECAR_FILE};
    use crate::cli::synth::parser::{
        AgentConfig, AgentDependencies, ClientConfig, ParsedAgentSpec,
    };

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
            "konductor-kiro-v3-transformer-test-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn expected_output_dir() -> PathBuf {
        Path::new(KiroCliV3Transformer.name()).join(AGENTS_CONTENT_TYPE_DIR)
    }

    #[test]
    fn name_returns_kiro_v3() {
        assert_eq!(KiroCliV3Transformer.name(), "kiro-v3");
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
        assert!(KiroCliV3Transformer.transform(&model, &dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    // ── Tool-ID / alias mapping ──────────────────────────────────────

    #[test]
    fn map_tool_tag_converts_confirmed_old_ids() {
        assert_eq!(map_tool_tag("fs_read"), "read");
        assert_eq!(map_tool_tag("fsRead"), "read");
        assert_eq!(map_tool_tag("readFile"), "read");
        assert_eq!(map_tool_tag("execute_bash"), "shell");
        assert_eq!(map_tool_tag("use_aws"), "aws");
        assert_eq!(map_tool_tag("use_subagent"), "subagent");
        assert_eq!(map_tool_tag("listDirectory"), "glob");
        assert_eq!(map_tool_tag("grepSearch"), "grep");
        assert_eq!(map_tool_tag("fileSearch"), "file_search");
        assert_eq!(map_tool_tag("webFetch"), "web_fetch");
        assert_eq!(map_tool_tag("webSearch"), "web_search");
    }

    /// The `todo`/`task` -> `todo_list`, `agent_crew` -> `subagent` rows
    /// in `TOOL_ID_TO_TAG` (see that table's own doc comment). Regression
    /// guard for a live agent-spec shape in this package
    /// (`konductor-mux-orchestrator` et al. declare the literal `"todo"`
    /// tool): an unconverted `"todo"` in a V3 agent's `tools` array is
    /// exactly the shape the real Kiro CLI V3 engine's own
    /// V2-authorship detection flags as still needing migration.
    #[test]
    fn map_tool_tag_converts_vendored_engine_sourced_ids() {
        assert_eq!(map_tool_tag("todo"), "todo_list");
        assert_eq!(map_tool_tag("task"), "todo_list");
        assert_eq!(map_tool_tag("agent_crew"), "subagent");
    }

    /// Unconfirmed entries (already-current tags, collection markers,
    /// server-scoped MCP tags, and the unconfirmed `agentCrew` camelCase
    /// spelling) must pass through unchanged rather than being invented
    /// -- see `map_tool_tag`'s docstring.
    #[test]
    fn map_tool_tag_passes_through_unconfirmed_entries() {
        assert_eq!(map_tool_tag("@builtin"), "@builtin");
        assert_eq!(map_tool_tag("@example-mcp"), "@example-mcp");
        assert_eq!(map_tool_tag("shell"), "shell");
        assert_eq!(map_tool_tag("*"), "*");
        assert_eq!(map_tool_tag("agentCrew"), "agentCrew");
    }

    #[test]
    fn render_agent_file_emits_welcome_message_when_present() {
        let kiro = KiroCliConfig {
            welcome_message: Some("Ready to help.".to_string()),
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        assert_eq!(file.welcome_message, Some("Ready to help."));
        let json = serde_json::to_value(&file).unwrap();
        assert_eq!(json["welcomeMessage"], "Ready to help.");
    }

    #[test]
    fn render_agent_file_omits_welcome_message_key_when_absent() {
        let kiro = KiroCliConfig::default();
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        assert_eq!(file.welcome_message, None);
        let json = serde_json::to_value(&file).unwrap();
        assert!(
            json.get("welcomeMessage").is_none(),
            "welcomeMessage key must be omitted when unset"
        );
    }

    #[test]
    fn render_agent_file_maps_tools_field_to_tags() {
        let kiro = KiroCliConfig {
            tools: vec![
                "@builtin".to_string(),
                "fs_read".to_string(),
                "execute_bash".to_string(),
            ],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let file =
            render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new()).unwrap();

        assert_eq!(file.tools, vec!["@builtin", "read", "shell"]);
    }

    // ── toolsSettings/allowedTools -> permissions.rules derivation ────

    #[test]
    fn derive_permission_rules_maps_execute_bash_allowed_and_denied_commands() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "allowedCommands": ["^git status$"],
                "deniedCommands": ["^rm -rf"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let allow = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "allow")
            .expect("expected a shell allow rule");
        assert_eq!(allow.r#match, vec!["git status"]);

        let deny = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "deny")
            .expect("expected a shell deny rule");
        // The source regex has no trailing `$`, i.e. "any command
        // starting with `rm -rf`" -- the converted glob keeps that
        // "starts with" scope via a trailing `*` rather than narrowing
        // to an exact-match literal.
        assert_eq!(deny.r#match, vec!["rm -rf*"]);
    }

    /// `^cargo build[^&;]*$` -- a regex written to allow `cargo build`
    /// followed by any run of characters EXCLUDING `&`/`;` (i.e.
    /// explicitly forbidding shell-chaining like `&& rm -rf /`) -- must
    /// NOT survive naive regex-to-glob substitution into the ALLOW
    /// list. A naive strip-anchors-and-swap-`.*`-for-`*` conversion
    /// alone produces the glob `cargo build[^&;]*`, which most glob
    /// engines give no negated-character-class meaning to, silently
    /// re-admitting the exact command-chaining the source regex
    /// excluded. This allow-list entry must be dropped entirely rather
    /// than emit a widened glob.
    #[test]
    fn derive_permission_rules_drops_unsafe_negated_character_class_allow_pattern() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "allowedCommands": ["^git status$", "^cargo build[^&;]*$"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let allow = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "allow")
            .expect("expected a shell allow rule for the one safely-convertible pattern");
        assert_eq!(
            allow.r#match,
            vec!["git status"],
            "the unsafe `[^&;]*`-bearing pattern must be dropped, not widened into a glob \
             that no longer excludes shell-chaining -- got: {allow:?}"
        );
    }

    /// The opposite safety direction from the test above: a
    /// `deniedCommands` entry that can't be safely converted still gets
    /// a deny rule, since dropping it would remove a restriction (the
    /// wrong fail-safe direction). It collapses to a bare `*` -- a
    /// character class like `[^&;]` can't be widened span-by-span the
    /// way a bare `.` can, and leaving it as literal glob text would
    /// UNDER-deny (see `regex_to_glob`'s docstring), so the whole
    /// pattern is over-approximated as "deny everything" instead.
    #[test]
    fn derive_permission_rules_collapses_unconvertible_deny_pattern_to_wildcard() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "deniedCommands": ["^rm -rf[^&;]*$"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let deny = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "deny")
            .expect("expected a shell deny rule even for an unconvertible pattern");
        assert_eq!(deny.r#match, vec!["*"]);
    }

    /// Alternation (`(foo|bar)`) has no bare `.`/quantifier for
    /// `widen_dots_and_bare_quantifiers_for_deny` to widen, so unlike the
    /// bracket-class case above, leaving it as literal glob text would
    /// under-deny with NO safety net at all: as a glob, `rm (foo|bar)`
    /// matches only the literal nine-character string "rm (foo|bar)",
    /// not "rm foo" or "rm bar" as the source regex intended -- silently
    /// re-admitting both. It must collapse to a bare `*` instead.
    #[test]
    fn derive_permission_rules_collapses_alternation_deny_pattern_to_wildcard() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "deniedCommands": ["^rm (foo|bar)$"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let deny = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "deny")
            .expect("expected a shell deny rule even for an unconvertible pattern");
        assert_eq!(deny.r#match, vec!["*"]);
    }

    /// A bare `.` alongside a character class (`rm.foo[abc]`) must not
    /// have its dot left as a literal glob character just because a
    /// class is also present -- the dot alone would under-deny (a glob
    /// literal `.` only matches an actual dot character, not "any
    /// character" as the source regex intended). The whole pattern
    /// collapses to a bare `*`, which also safely covers the dot.
    #[test]
    fn derive_permission_rules_collapses_dot_plus_class_deny_pattern_to_wildcard() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "deniedCommands": ["^rm.foo[abc]$"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let deny = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "deny")
            .expect("expected a shell deny rule even for an unconvertible pattern");
        assert_eq!(deny.r#match, vec!["*"]);
    }

    /// `denyByDefault: true` derives a `deny` rule whose `exclude` is
    /// populated from the allow-list globs, per the migration guide's
    /// own example row for this exact field.
    #[test]
    fn derive_permission_rules_maps_deny_by_default_to_exclude() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "allowedCommands": ["^git status$", "^npm test$"],
                "denyByDefault": true
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let deny_by_default = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "deny" && !r.exclude.is_empty())
            .expect("expected a deny-by-default rule with a populated exclude list");
        assert_eq!(deny_by_default.exclude, vec!["git status", "npm test"]);
    }

    /// A quantifier on a non-`.` atom (e.g. the space-star in `git *`)
    /// is not the same thing as the already-handled `.*` case -- as a
    /// literal glob character, `*` means "anything", not "zero or more
    /// of the preceding atom". On the allow surface this must be
    /// dropped entirely rather than emitted as an over-broad glob (an
    /// `allowedCommands`/`exclude` entry that silently admitted `git`
    /// plus any argument, including `git ; rm -rf /`).
    #[test]
    fn derive_permission_rules_drops_bare_quantifier_allow_pattern() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "allowedCommands": ["^git status$", "^git *$"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let allow = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "allow")
            .expect("expected a shell allow rule for the one safely-convertible pattern");
        assert_eq!(
            allow.r#match,
            vec!["git status"],
            "the bare-quantifier pattern `git *` must be dropped, not widened into an \
             unbounded glob -- got: {allow:?}"
        );
    }

    /// The opposite safety direction: on the deny surface, the same
    /// bare-quantifier construct is widened to `*` rather than left as
    /// a literal `*` glob character glued onto the untouched atom --
    /// over-denying (matching more than the source regex) is the safe
    /// direction here.
    #[test]
    fn derive_permission_rules_widens_bare_quantifier_deny_pattern() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "deniedCommands": ["^git *$"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let deny = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "deny")
            .expect("expected a shell deny rule");
        assert_eq!(deny.r#match, vec!["git*"]);
    }

    /// A bare `.` (regex: exactly one arbitrary character) left as a
    /// literal glob `.` would only match commands with an actual dot
    /// there, under-denying relative to the source regex -- the unsafe
    /// direction for a deny rule. It is widened to `*` instead.
    #[test]
    fn derive_permission_rules_widens_bare_dot_deny_pattern() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "deniedCommands": ["^rm.foo$"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let deny = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "deny")
            .expect("expected a shell deny rule");
        assert_eq!(deny.r#match, vec!["rm*foo"]);
    }

    /// The same bare-`.` construct on the allow surface is dropped
    /// entirely (fail closed), not widened -- widening would over-grant.
    #[test]
    fn derive_permission_rules_drops_bare_dot_allow_pattern() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "allowedCommands": ["^git status$", "^rm.foo$"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let allow = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "allow")
            .expect("expected a shell allow rule for the one safely-convertible pattern");
        assert_eq!(allow.r#match, vec!["git status"]);
    }

    /// An unanchored leading end (no `^`) on a deny pattern keeps its
    /// "ends with" scope via a prepended `*`, symmetric with the
    /// unanchored-tail case covered by
    /// `derive_permission_rules_maps_execute_bash_allowed_and_denied_commands`.
    #[test]
    fn derive_permission_rules_widens_unanchored_leading_end_deny_pattern() {
        let tools_settings = serde_json::json!({
            "execute_bash": {
                "deniedCommands": ["rm -rf$"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let deny = rules
            .iter()
            .find(|r| r.capability == "shell" && r.effect == "deny")
            .expect("expected a shell deny rule");
        assert_eq!(deny.r#match, vec!["*rm -rf"]);
    }

    #[test]
    fn derive_permission_rules_maps_fs_read_allowed_and_denied_paths() {
        let tools_settings = serde_json::json!({
            "fs_read": {
                "allowedPaths": ["src/**", "docs/**"],
                "deniedPaths": [".env", "secrets/**"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let allow = rules
            .iter()
            .find(|r| r.capability == "fs_read" && r.effect == "allow")
            .expect("expected an fs_read allow rule");
        assert_eq!(allow.r#match, vec!["src/**", "docs/**"]);

        let deny = rules
            .iter()
            .find(|r| r.capability == "fs_read" && r.effect == "deny")
            .expect("expected an fs_read deny rule");
        assert_eq!(deny.r#match, vec![".env", "secrets/**"]);
    }

    #[test]
    fn derive_permission_rules_maps_fs_write_allowed_paths_by_analogy() {
        let tools_settings = serde_json::json!({
            "fs_write": {
                "allowedPaths": ["src/**"],
                "deniedPaths": ["*.lock"]
            }
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let allow = rules
            .iter()
            .find(|r| r.capability == "fs_write" && r.effect == "allow")
            .expect("expected an fs_write allow rule");
        assert_eq!(allow.r#match, vec!["src/**"]);

        let deny = rules
            .iter()
            .find(|r| r.capability == "fs_write" && r.effect == "deny")
            .expect("expected an fs_write deny rule");
        assert_eq!(deny.r#match, vec!["*.lock"]);
    }

    /// An unconfirmed `toolsSettings` key (e.g. a hypothetical
    /// `web_fetch` settings block) has no kiro.dev-documented mapping
    /// and must be skipped, not guessed at. `subagent` is a distinct
    /// case, not an example of this rule -- see
    /// `derive_permission_rules_maps_trusted_agents_to_scoped_
    /// subagent_allow_rule` below for why `subagent.trustedAgents`
    /// specifically is deliberately mapped.
    #[test]
    fn derive_permission_rules_skips_unconfirmed_tools_settings_keys() {
        let tools_settings = serde_json::json!({
            "web_fetch": {"allowedDomains": ["example.com"]}
        });
        let rules = derive_permission_rules(&tools_settings, &[]);
        assert!(
            rules.is_empty(),
            "expected no rules derived from an unconfirmed toolsSettings key, got: {rules:?}"
        );
    }

    /// `subagent.availableAgents` is the one field of the `subagent`
    /// `toolsSettings` block that stays unmapped -- see
    /// `push_trusted_agent_rules`'s own docstring for why (a visibility/
    /// discovery concept, not a confirmed authorization boundary).
    #[test]
    fn derive_permission_rules_skips_available_agents_but_not_trusted_agents() {
        let tools_settings = serde_json::json!({
            "subagent": {"availableAgents": ["some-agent"]}
        });
        let rules = derive_permission_rules(&tools_settings, &[]);
        assert!(
            rules.is_empty(),
            "expected no rule derived from availableAgents alone, got: {rules:?}"
        );
    }

    /// Generic, unscoped `allowedTools` entries (a bare `fs_read` or
    /// `subagent` grant, neither of which carries any scope of its own)
    /// still map onto an unscoped `allow` rule -- this remains the only
    /// representable grant for V2's own "no additional scoping" case.
    /// Contrast with the `_scoped_` tests below, which cover a SCOPED
    /// entry (like a specific `@server/tool` MCP reference) that must
    /// NOT collapse into this same unscoped shape.
    #[test]
    fn derive_permission_rules_maps_generic_allowed_tools_to_unscoped_allow_rules() {
        let tools_settings = serde_json::json!({});
        let allowed_tools = vec!["fs_read".to_string(), "subagent".to_string()];
        let rules = derive_permission_rules(&tools_settings, &allowed_tools);

        assert!(rules
            .iter()
            .any(|r| r.capability == "fs_read" && r.effect == "allow" && r.r#match.is_empty()));
        assert!(rules
            .iter()
            .any(|r| r.capability == "subagent" && r.effect == "allow" && r.r#match.is_empty()));
    }

    /// A specific `@server/tool` MCP reference in `allowedTools` must
    /// produce a SCOPED `mcp` allow rule (`match: ["server/tool"]`),
    /// not an unscoped "allow every MCP server/tool" rule -- the scope
    /// already encoded in the tool ID string itself must be preserved,
    /// not discarded.
    #[test]
    fn derive_permission_rules_maps_scoped_mcp_allowed_tools_entry_to_scoped_match() {
        let allowed_tools = vec!["@example-mcp/ExampleSearch".to_string()];
        let rules = derive_permission_rules(&serde_json::json!({}), &allowed_tools);

        let mcp_rules: Vec<_> = rules.iter().filter(|r| r.capability == "mcp").collect();
        assert_eq!(
            mcp_rules.len(),
            1,
            "expected exactly one mcp rule, got: {rules:?}"
        );
        assert_eq!(mcp_rules[0].effect, "allow");
        assert_eq!(mcp_rules[0].r#match, vec!["example-mcp/ExampleSearch"]);
    }

    /// Multiple `@server/tool` grants for the SAME server accumulate
    /// into one rule's `match` list, rather than one rule per tool.
    #[test]
    fn derive_permission_rules_accumulates_multiple_mcp_tools_on_the_same_server() {
        let allowed_tools = vec![
            "@example-mcp/ExampleSearch".to_string(),
            "@example-mcp/ExampleFetch".to_string(),
        ];
        let rules = derive_permission_rules(&serde_json::json!({}), &allowed_tools);

        let mcp_rules: Vec<_> = rules.iter().filter(|r| r.capability == "mcp").collect();
        assert_eq!(mcp_rules.len(), 1, "expected one mcp rule, got: {rules:?}");
        assert_eq!(
            mcp_rules[0].r#match,
            vec!["example-mcp/ExampleSearch", "example-mcp/ExampleFetch"]
        );
    }

    /// A same-capability generic/unscoped entry (`tool_search`, which
    /// this module maps to `mcp` with no scope of its own) must NOT
    /// widen an already-scoped `@server/tool` grant back into an
    /// unscoped "allow everything" rule -- a narrow grant must stay
    /// narrow even when a broader-shaped entry for the same capability
    /// also happens to be present.
    #[test]
    fn derive_permission_rules_does_not_widen_scoped_mcp_grant_with_generic_entry() {
        let allowed_tools = vec![
            "@example-mcp/ExampleSearch".to_string(),
            "tool_search".to_string(),
        ];
        let rules = derive_permission_rules(&serde_json::json!({}), &allowed_tools);

        let mcp_rules: Vec<_> = rules.iter().filter(|r| r.capability == "mcp").collect();
        assert_eq!(mcp_rules.len(), 1, "expected one mcp rule, got: {rules:?}");
        assert_eq!(mcp_rules[0].r#match, vec!["example-mcp/ExampleSearch"]);
    }

    /// A bare `@<server-name>` reference (no `/tool` suffix) names an
    /// entire server with no specific tool. kiro.dev's own example shows
    /// `"my-server/*"` verbatim as the "allow every tool on this server"
    /// form -- this must translate to that confirmed glob, not be
    /// silently dropped.
    #[test]
    fn resolve_allowed_tool_maps_bare_server_reference_to_server_star_glob() {
        assert_eq!(
            resolve_allowed_tool("@example-mcp"),
            Some(("mcp", Some("example-mcp/*".to_string())))
        );
    }

    /// `@mcp` is the collective tag for "all MCP server tools" (per the
    /// agent-config page's Tags vs Capabilities table, alongside
    /// `@builtin` and `*`), not a reference to one server literally
    /// named `mcp`. It must resolve via `TOOL_ID_TO_CAPABILITY`'s exact
    /// match to an UNSCOPED `mcp` capability -- not fall through to the
    /// `@<server>[/<tool>]` prefix-parsing path below, which would
    /// misread the bare "mcp" text after `@` as a server name and
    /// narrow the collective grant to `("mcp", Some("mcp/*"))`.
    #[test]
    fn resolve_allowed_tool_maps_collective_mcp_tag_to_unscoped_capability() {
        assert_eq!(resolve_allowed_tool("@mcp"), Some(("mcp", None)));
    }

    /// Malformed `@`-prefixed entries (empty server or tool segment, or
    /// a bare `@`) have no confirmed translation and are skipped, not
    /// guessed at.
    #[test]
    fn resolve_allowed_tool_returns_none_for_malformed_at_prefixed_entries() {
        assert_eq!(resolve_allowed_tool("@"), None);
        assert_eq!(resolve_allowed_tool("@server/"), None);
        assert_eq!(resolve_allowed_tool("@/tool"), None);
    }

    /// `code` and `introspect` both fold into the `fs_read` capability,
    /// per `TOOL_ID_TO_CAPABILITY`'s own docstring on their shared,
    /// lower-confidence sourcing.
    #[test]
    fn resolve_allowed_tool_maps_code_and_introspect_to_fs_read() {
        assert_eq!(resolve_allowed_tool("code"), Some(("fs_read", None)));
        assert_eq!(resolve_allowed_tool("introspect"), Some(("fs_read", None)));
    }

    /// `toolsSettings.subagent.trustedAgents` must produce a SCOPED
    /// `subagent` allow rule (`match: [<agent names>]`), not be
    /// silently dropped -- dropping it would let a V2 agent restricted
    /// to a specific trusted-subagent allowlist fall through to any
    /// generic `use_subagent`/`subagent` `allowedTools` entry and get
    /// an UNSCOPED "allow any subagent" rule instead, silently
    /// widening the grant.
    #[test]
    fn derive_permission_rules_maps_trusted_agents_to_scoped_subagent_allow_rule() {
        let tools_settings = serde_json::json!({
            "subagent": {"trustedAgents": ["reviewer-agent", "linter-agent"]}
        });
        let rules = derive_permission_rules(&tools_settings, &[]);

        let subagent_rules: Vec<_> = rules
            .iter()
            .filter(|r| r.capability == "subagent")
            .collect();
        assert_eq!(
            subagent_rules.len(),
            1,
            "expected one subagent rule, got: {rules:?}"
        );
        assert_eq!(subagent_rules[0].effect, "allow");
        assert_eq!(
            subagent_rules[0].r#match,
            vec!["reviewer-agent", "linter-agent"]
        );
    }

    /// A same-capability generic `allowedTools` entry (`use_subagent`)
    /// must not widen an already-scoped `trustedAgents` grant back into
    /// an unscoped "allow any subagent" rule.
    #[test]
    fn derive_permission_rules_does_not_widen_scoped_subagent_grant_with_generic_entry() {
        let tools_settings = serde_json::json!({
            "subagent": {"trustedAgents": ["reviewer-agent"]}
        });
        let allowed_tools = vec!["use_subagent".to_string()];
        let rules = derive_permission_rules(&tools_settings, &allowed_tools);

        let subagent_rules: Vec<_> = rules
            .iter()
            .filter(|r| r.capability == "subagent")
            .collect();
        assert_eq!(
            subagent_rules.len(),
            1,
            "expected one subagent rule, got: {rules:?}"
        );
        assert_eq!(subagent_rules[0].r#match, vec!["reviewer-agent"]);
    }

    /// A `toolsSettings` entry that only produces a DENY rule for a
    /// capability (no `allowedPaths`/`allowedCommands` present) must
    /// not suppress a separate, legitimate ALLOW grant for that same
    /// capability coming from `allowedTools` -- allow/deny presence
    /// must be tracked independently per capability, not as a single
    /// "has any rule" flag that a deny-only settings block would
    /// satisfy on its own.
    #[test]
    fn derive_permission_rules_deny_only_settings_does_not_suppress_later_allow_grant() {
        let tools_settings = serde_json::json!({
            "fs_read": {"deniedPaths": [".env"]}
        });
        let allowed_tools = vec!["fs_read".to_string()];
        let rules = derive_permission_rules(&tools_settings, &allowed_tools);

        assert!(
            rules.iter().any(|r| r.capability == "fs_read"
                && r.effect == "deny"
                && r.r#match == vec![".env"]),
            "expected the deny rule to survive, got: {rules:?}"
        );
        assert!(
            rules
                .iter()
                .any(|r| r.capability == "fs_read" && r.effect == "allow" && r.r#match.is_empty()),
            "expected the allowedTools-derived allow rule to survive the deny-only \
             toolsSettings entry for the same capability, got: {rules:?}"
        );
    }

    /// An `allowedTools` entry that resolves to a capability already
    /// covered by a `toolsSettings`-derived rule must NOT get a
    /// redundant unscoped `allow` rule appended on top.
    #[test]
    fn derive_permission_rules_does_not_duplicate_capability_already_covered_by_tools_settings() {
        let tools_settings = serde_json::json!({
            "fs_read": {"allowedPaths": ["src/**"]}
        });
        let allowed_tools = vec!["fs_read".to_string()];
        let rules = derive_permission_rules(&tools_settings, &allowed_tools);

        let fs_read_rules: Vec<_> = rules.iter().filter(|r| r.capability == "fs_read").collect();
        assert_eq!(
            fs_read_rules.len(),
            1,
            "expected exactly one fs_read rule (from toolsSettings), got: {rules:?}"
        );
        assert_eq!(fs_read_rules[0].r#match, vec!["src/**"]);
    }

    /// An `allowedTools` entry with no confirmed capability mapping is
    /// skipped, not guessed at.
    #[test]
    fn derive_permission_rules_skips_unconfirmed_allowed_tools_entries() {
        let allowed_tools = vec!["some-unrecognized-tool".to_string()];
        let rules = derive_permission_rules(&serde_json::json!({}), &allowed_tools);
        assert!(
            rules.is_empty(),
            "expected no rule for an unconfirmed allowedTools entry, got: {rules:?}"
        );
    }

    /// Regression guard for the specific `use_aws`/`aws` mapping this
    /// module deliberately omits (see `TOOL_ID_TO_CAPABILITY`'s own
    /// docstring): kiro.dev/docs/permissions/ confirms no `aws`
    /// capability exists, so `resolve_allowed_tool` must return `None`
    /// for both spellings -- neither `shell` nor `mcp` is a confirmed
    /// stand-in. An `allowedTools` entry naming either must therefore be
    /// skipped by `derive_permission_rules`, not produce a guessed rule.
    #[test]
    fn resolve_allowed_tool_returns_none_for_use_aws_and_aws() {
        assert_eq!(resolve_allowed_tool("use_aws"), None);
        assert_eq!(resolve_allowed_tool("aws"), None);

        let allowed_tools = vec!["use_aws".to_string(), "aws".to_string()];
        let rules = derive_permission_rules(&serde_json::json!({}), &allowed_tools);
        assert!(
            rules.is_empty(),
            "expected no rule for use_aws/aws (no confirmed capability), got: {rules:?}"
        );
    }

    // ── hooks: V2 object-form -> KAS array-of-documents ────────────────

    /// A single-trigger, single-entry hook converts to a one-element KAS
    /// array with a synthesized `<trigger>-<index>` name and the CLI's
    /// own absent-timeout default (10s) -- mirrors the vendored engine's
    /// own `object_form_becomes_kas_array` fixture case.
    #[test]
    fn convert_hooks_for_v3_converts_single_trigger_entry() {
        let mut hooks = indexmap::IndexMap::new();
        hooks.insert(
            "agentSpawn".to_string(),
            serde_json::json!([{ "command": "git status" }]),
        );
        let converted = convert_hooks_for_v3(&hooks);
        assert_eq!(
            converted,
            serde_json::json!([
                {
                    "name": "agentSpawn-0",
                    "trigger": "agentSpawn",
                    "action": { "type": "command", "command": "git status" },
                    "timeout": 10
                }
            ])
        );
    }

    /// `matcher` carries over verbatim, and an authored `timeout_ms`
    /// converts to whole seconds (5000ms -> 5s).
    #[test]
    fn convert_hooks_for_v3_carries_matcher_and_converts_timeout_units() {
        let mut hooks = indexmap::IndexMap::new();
        hooks.insert(
            "preToolUse".to_string(),
            serde_json::json!([{
                "command": "fmt",
                "matcher": "fs_write",
                "timeout_ms": 5000
            }]),
        );
        let converted = convert_hooks_for_v3(&hooks);
        assert_eq!(
            converted,
            serde_json::json!([
                {
                    "name": "preToolUse-0",
                    "trigger": "preToolUse",
                    "matcher": "fs_write",
                    "action": { "type": "command", "command": "fmt" },
                    "timeout": 5
                }
            ])
        );
    }

    /// A real, metacharacter-bearing matcher -- a `|`-separated regex
    /// alternation, exactly the shape a preToolUse security-gate hook's
    /// matcher already takes in a real agent spec elsewhere in this
    /// workspace (combining multiple read/write guard patterns) -- must
    /// survive conversion byte-for-byte. `convert_hook_entry`'s docstring
    /// is the evidence trail for why this is correct: the vendored engine's own
    /// `hook_entry_to_doc` carries `matcher` over as an opaque string with
    /// no regex-to-glob rewrite and no alternation splitting, unlike the
    /// `shell`/`web_fetch` capability `match` arrays it derives elsewhere,
    /// which DO go through a dedicated regex-to-glob converter. A prior
    /// metacharacter-free fixture (`"fs_write"`, above) could not have
    /// distinguished "carried verbatim" from "converted, but the input
    /// had nothing for the conversion to change" -- this fixture can.
    #[test]
    fn convert_hooks_for_v3_carries_multi_alternation_matcher_verbatim() {
        let mut hooks = indexmap::IndexMap::new();
        let matcher = "@example-kb-mcp/search_items|@example-kb-mcp/explore_items";
        hooks.insert(
            "preToolUse".to_string(),
            serde_json::json!([{
                "command": "example-kb-guard.sh",
                "matcher": matcher,
            }]),
        );
        let converted = convert_hooks_for_v3(&hooks);
        assert_eq!(
            converted,
            serde_json::json!([
                {
                    "name": "preToolUse-0",
                    "trigger": "preToolUse",
                    "matcher": matcher,
                    "action": { "type": "command", "command": "example-kb-guard.sh" },
                    "timeout": 10
                }
            ])
        );
    }

    /// Sub-second and zero `timeout_ms` values clamp UP to a 1-second
    /// floor rather than down to 0 -- KAS reads a `0` timeout as
    /// "disabled", which would invert an author's short-timeout intent
    /// into no timeout at all. Mirrors the vendored engine's own
    /// `authored_timeout_clamps_up_to_at_least_one_second` fixture.
    #[test]
    fn convert_hooks_for_v3_clamps_sub_second_timeout_up_to_one_second() {
        for (ms, secs) in [
            (0u64, 1u64),
            (1, 1),
            (500, 1),
            (999, 1),
            (1000, 1),
            (1001, 2),
        ] {
            let mut hooks = indexmap::IndexMap::new();
            hooks.insert(
                "stop".to_string(),
                serde_json::json!([{ "command": "x", "timeout_ms": ms }]),
            );
            let converted = convert_hooks_for_v3(&hooks);
            let got = converted[0].get("timeout").cloned();
            assert_eq!(
                got,
                Some(serde_json::Value::from(secs)),
                "{ms}ms should map to {secs}s, got: {got:?}"
            );
        }
    }

    /// A "tool hook" (no `command` key -- e.g. a CLI-only hook shape KAS
    /// cannot represent as its `action` discriminated union has no
    /// non-command variant) is dropped, not emitted as an invalid
    /// document.
    #[test]
    fn convert_hooks_for_v3_drops_tool_hook_with_no_command() {
        let mut hooks = indexmap::IndexMap::new();
        hooks.insert(
            "postToolUse".to_string(),
            serde_json::json!([{ "tool_name": "my_tool", "args": {} }]),
        );
        let converted = convert_hooks_for_v3(&hooks);
        assert_eq!(converted, serde_json::json!([]));
    }

    /// A trigger spelling with no KAS equivalent has no confirmed
    /// translation and is dropped, not guessed at.
    #[test]
    fn convert_hooks_for_v3_drops_unknown_trigger() {
        let mut hooks = indexmap::IndexMap::new();
        hooks.insert(
            "postFileSave".to_string(),
            serde_json::json!([{ "command": "x" }]),
        );
        let converted = convert_hooks_for_v3(&hooks);
        assert_eq!(converted, serde_json::json!([]));
    }

    /// Multiple entries under one trigger get distinct, position-indexed
    /// names so KAS's required non-empty `name` is always unique.
    #[test]
    fn convert_hooks_for_v3_indexes_multiple_entries_under_one_trigger() {
        let mut hooks = indexmap::IndexMap::new();
        hooks.insert(
            "agentSpawn".to_string(),
            serde_json::json!([{ "command": "a" }, { "command": "b" }]),
        );
        let converted = convert_hooks_for_v3(&hooks);
        let names: Vec<&str> = converted
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d.get("name").and_then(serde_json::Value::as_str).unwrap())
            .collect();
        assert_eq!(names, vec!["agentSpawn-0", "agentSpawn-1"]);
    }

    /// An empty `hooks` object converts to an empty array -- KAS rejects
    /// `{}` but accepts `[]` -- matching this module's existing
    /// "minimal valid output" contract for `permissions`.
    #[test]
    fn convert_hooks_for_v3_empty_object_becomes_empty_array() {
        let hooks = indexmap::IndexMap::new();
        let converted = convert_hooks_for_v3(&hooks);
        assert_eq!(converted, serde_json::json!([]));
    }

    /// End-to-end guard, at the `transform` level rather than the unit
    /// level: a `hooks` object anywhere in the installed V3 agent file
    /// is exactly the shape KAS's own validator rejects (see this
    /// module's header comment), so the file `render_agent_file`
    /// produces must always carry `hooks` as an array.
    #[test]
    fn transform_emits_hooks_as_array_not_object() {
        let mut hooks_map = indexmap::IndexMap::new();
        hooks_map.insert(
            "stop".to_string(),
            serde_json::json!([{ "command": "echo done" }]),
        );
        let kiro = KiroCliConfig {
            hooks: hooks_map,
            ..Default::default()
        };
        let dir = temp_dir("hooks-array");
        let model = CanonicalModel {
            agents: vec![agent_with_kiro("k-hooked", kiro)],
            ..Default::default()
        };
        KiroCliV3Transformer.transform(&model, &dir).unwrap();

        let agent_file = dir.join(expected_output_dir()).join("k-hooked.json");
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&agent_file).unwrap()).unwrap();
        assert!(
            parsed["hooks"].is_array(),
            "expected hooks to be a KAS array-of-documents, got: {}",
            parsed["hooks"]
        );
        assert_eq!(
            parsed["hooks"][0]["trigger"],
            serde_json::json!("stop"),
            "got: {}",
            parsed["hooks"]
        );

        let _ = fs::remove_dir_all(&dir);
    }

    // ── Minimal valid output (no toolsSettings) ───────────────────────

    /// An agent-spec with no `toolsSettings` at all (the parser's own
    /// `default_empty_object` default) must still produce minimal valid
    /// V3 output: `permissions: {"rules": []}`, not an error and not an
    /// omitted `permissions` key.
    #[test]
    fn transform_on_agent_with_no_tools_settings_emits_empty_rules_array() {
        let dir = temp_dir("no-tools-settings");
        let model = CanonicalModel {
            agents: vec![agent_with_kiro("k-minimal", KiroCliConfig::default())],
            ..Default::default()
        };
        KiroCliV3Transformer.transform(&model, &dir).unwrap();

        let agent_file = dir.join(expected_output_dir()).join("k-minimal.json");
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&agent_file).unwrap()).unwrap();
        assert_eq!(parsed["permissions"], serde_json::json!({"rules": []}));
        assert!(
            parsed.get("toolsSettings").is_none(),
            "toolsSettings must not appear in V3 output, got: {parsed}"
        );
    }

    #[test]
    fn transform_writes_one_json_file_per_kiro_cli_agent() {
        let dir = temp_dir("write");
        let model = CanonicalModel {
            agents: vec![agent_with_kiro("k-example", KiroCliConfig::default())],
            ..Default::default()
        };
        KiroCliV3Transformer.transform(&model, &dir).unwrap();

        let written = dir.join(expected_output_dir()).join("k-example.json");
        assert!(written.exists());
        let contents = fs::read_to_string(&written).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed["name"], "k-example");
        assert!(contents.ends_with('\n'), "expected a trailing newline");

        let _ = fs::remove_dir_all(&dir);
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

    #[test]
    fn render_agent_file_rejects_dangling_skill_resource() {
        let kiro = KiroCliConfig {
            resources: vec!["skill://~/.kiro/skills/does-not-exist/SKILL.md".to_string()],
            ..Default::default()
        };
        let agent = agent_with_kiro("k-example", kiro);
        let kiro_cfg = agent.client_config.kiro_cli.as_ref().unwrap();
        let result = render_agent_file(&agent.name, &agent.config, kiro_cfg, &[], &HashSet::new());
        assert!(result.is_err());
    }

    #[test]
    fn transform_on_empty_model_writes_nothing_and_succeeds() {
        let dir = temp_dir("empty-model");
        let model = CanonicalModel::default();
        assert!(KiroCliV3Transformer.transform(&model, &dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }

    // ── _sop_scopes.json / _skill_scopes.json sidecars (mirrors
    // kiro_cli_v2.rs) ──────────────────────────────────────────────────
    //
    // These are what let install::kiro_cli_v3::install_agents scope the
    // `konductor-skills` MCP grant per agent instead of falling back to
    // the unscoped default -- see this module's own
    // `KiroCliV3Transformer` docstring for why V3 needs the identical
    // sidecars V2 already writes.

    /// Same as `agent_with_kiro`, but also populates `dependencies.
    /// agentSops.agentSopNames` -- mirrors kiro_cli_v2.rs's own
    /// `agent_with_kiro_and_sop_names` test helper exactly.
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

    /// Same as `agent_with_kiro`, but also populates `dependencies.
    /// skills.skillNames` -- mirrors kiro_cli_v2.rs's own
    /// `agent_with_kiro_and_skill_names` test helper exactly.
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
        KiroCliV3Transformer.transform(&model, &dir).unwrap();

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
    /// sidecar entirely, mirroring V2's own "absent means no scoping"
    /// contract that `install::resource_rewrite::RewriteContext` relies
    /// on.
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
        KiroCliV3Transformer.transform(&model, &dir).unwrap();

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
        KiroCliV3Transformer.transform(&model, &dir).unwrap();

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
    /// sidecar entirely -- mirrors
    /// `transform_omits_agents_with_no_sop_names_from_sop_scopes_sidecar`
    /// above for the skill-scope sidecar.
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
        KiroCliV3Transformer.transform(&model, &dir).unwrap();

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

    /// `list_agent_files` (install side) already excludes both sidecar
    /// filenames from the agent files it copies -- this pins that V3
    /// synth's own agent-file loop never writes a real agent JSON file
    /// literally named after either sidecar, which would otherwise be
    /// silently clobbered by the sidecar write immediately after the
    /// loop (checked directly rather than assumed from
    /// `reject_unsafe_agent_name`'s general path-safety contract, same
    /// as kiro_cli_v2.rs's own identical regression guard).
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

        let result = KiroCliV3Transformer.transform(&model, &output_root);
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

        let result = KiroCliV3Transformer.transform(&model, &output_root);
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

    // ── Security regression guards (mirrors kiro_cli_v2.rs) ───────────

    #[test]
    fn transform_rejects_path_traversal_agent_name_constructed_without_parser() {
        let output_root = temp_dir("traversal-bypass");
        let escape_target = output_root.join("evil.json");

        let model = CanonicalModel {
            agents: vec![agent_with_kiro("../../evil", KiroCliConfig::default())],
            ..Default::default()
        };

        let result = KiroCliV3Transformer.transform(&model, &output_root);
        assert!(result.is_err());
        assert!(!escape_target.exists());

        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn write_agent_file_rejects_absolute_agent_name() {
        let output_root = temp_dir("absolute-bypass");
        let output_dir = output_root.join(expected_output_dir());
        let absolute_escape = std::env::temp_dir().join(format!(
            "konductor-kiro-v3-transformer-absolute-escape-{}.json",
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
        assert!(result.is_err());
        assert!(!absolute_escape.exists());

        let _ = fs::remove_dir_all(&output_root);
    }
}
