// SPDX-License-Identifier: Apache-2.0
//
// handlers.rs — MCP protocol wiring and the three skill-lookup tools.
//
// This module holds everything that answers an MCP `call_tool`/`list_tools`
// request over the `SkillIndex` built at startup: the wire DTOs
// (`FindSkillsRecord`, `GetSkillResponse`, `ReloadDiagnosticResponse`
// and friends), the argument-validation helpers each tool handler uses,
// the advertised JSON-schema builders, `SkillLookupServer` itself, and
// its `ServerHandler` impl (`list_tools`/`call_tool`/`initialize`).
//
// `cli.rs` decides *where* to scan; this module answers calls over
// *what was scanned* — one file, one concern, matching the split
// `main.rs`'s module doc comment describes.
use rmcp::model::{
    CallToolRequestParams, CallToolResult, ContentBlock, ErrorData as McpErrorData,
    GetPromptRequestParams, GetPromptResult, Implementation, InitializeRequestParams,
    InitializeResult, ListPromptsResult, ListToolsResult, PaginatedRequestParams, Prompt,
    PromptMessage, Role, ServerCapabilities, ServerInfo, Tool,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData as McpError, RoleServer, ServerHandler};
use serde::Serialize;
use serde_json::json;
use skill_lookup_core::{
    frontmatter,
    index::SkillIndex,
    logging::{self, Level},
    model::Provenance,
};

use crate::sops::SopIndex;
use crate::MAX_SKILL_BODY_BYTES;

/// One `find_skills` result record — metadata only, per the tool's output
/// contract. Deliberately never carries a SKILL.md body: search stays
/// metadata-only so an agent can budget context before calling
/// `get_skill`.
///
/// A distinct type from `model::SkillRecord` on purpose: this is the
/// wire shape a caller sees, `SkillRecord` is the internal index entry
/// (it also carries `path`, which this response never exposes).
#[derive(Serialize)]
struct FindSkillsRecord {
    name: String,
    description: String,
    tags: Vec<String>,
    version: Option<String>,
    size_bytes: u64,
    provenance: &'static str,
}

/// Renders a `Provenance` as the two lowercase wire values `find_skills`
/// promises: `"managed"` for the first `--skills-dir`, `"workspace"` for
/// any later one.
fn provenance_str(p: Provenance) -> &'static str {
    match p {
        Provenance::Managed => "managed",
        Provenance::Workspace => "workspace",
    }
}

/// `get_skill`'s success response: the full body plus enough metadata
/// (`path`, `size_bytes`) for a caller to track context budget and to
/// know where the body came from on disk.
#[derive(Serialize)]
struct GetSkillResponse {
    name: String,
    content: String,
    path: String,
    size_bytes: u64,
}

/// `reload_skills`'s response — the same diagnostic shape emitted to
/// stderr at startup (`ScanDiagnostic::emit_to_stderr`), returned
/// in-band instead so the calling agent (not just an operator watching
/// stderr) can see what a reload actually did.
#[derive(Serialize)]
struct ReloadDiagnosticResponse {
    /// Effective, post-filter count — the number of skills the index
    /// actually serves. Equals `scan_diagnostic.indexed_count -
    /// filtered_out`; see `filtered_out` below for the raw pre-filter
    /// count and how many of those were removed.
    indexed: usize,
    skills_dirs: Vec<String>,
    skipped: Vec<SkipReport>,
    collisions: Vec<CollisionReport>,
    filtered_out: usize,
}

#[derive(Serialize)]
struct SkipReport {
    path: String,
    reason: String,
}

#[derive(Serialize)]
struct CollisionReport {
    name: String,
    winning_path: String,
    losing_path: String,
}

/// Message-shape markers shared between the error-construction call
/// sites below (`get_skill`'s unresolved-name/unreadable-file cases,
/// `too_large_error`) and `record_tool_call`/`mcp_error_code`'s
/// classification of those same errors. Using one constant at both
/// ends means a future reword of a message can't silently drift the
/// classification out of sync with the text it's actually matching.
const SKILL_NOT_FOUND_PREFIX: &str = "skill not found: ";
const SKILL_UNREADABLE_PREFIX: &str = "skill file unreadable: ";
const TOO_LARGE_MARKER: &str = "too large";

/// Rejects any key in `args` not present in `allowed`, naming every
/// offending key so the schemas' `"additionalProperties": false` is
/// actually enforced (it was previously advertised but never checked,
/// so e.g. `__proto__` was silently accepted and ignored).
fn reject_unknown_keys(
    args: &serde_json::Map<String, serde_json::Value>,
    allowed: &[&str],
) -> Result<(), McpError> {
    let unknown: Vec<&str> = args
        .keys()
        .map(String::as_str)
        .filter(|k| !allowed.contains(k))
        .collect();
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(McpErrorData::invalid_params(
            format!("unknown parameter(s): {}", unknown.join(", ")),
            None,
        ))
    }
}

/// The JSON type name to report in a wrong-type error message, matching
/// the vocabulary of the tool schemas (`"type": "string"`, etc.).
fn json_type_name(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

/// Reads an optional string argument, distinguishing "absent" (`Ok(None)`)
/// from "present but not a string" (`Err`) — `args.get(key).and_then(...)`
/// used to collapse both into `None`, so a caller sending `name:
/// ["a","b"]` saw the same "missing" message as sending nothing at all.
fn optional_str_arg<'a>(
    args: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<Option<&'a str>, McpError> {
    match args.get(key) {
        None => Ok(None),
        Some(v) => v.as_str().map(Some).ok_or_else(|| {
            McpErrorData::invalid_params(
                format!(
                    "parameter '{key}' must be a string, got {}",
                    json_type_name(v)
                ),
                None,
            )
        }),
    }
}

/// Reads a required string argument, using `optional_str_arg` so a
/// present-but-wrong-type value still reports its actual JSON type
/// rather than being folded into "missing".
fn required_str_arg<'a>(
    args: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<&'a str, McpError> {
    optional_str_arg(args, key)?.ok_or_else(|| {
        McpErrorData::invalid_params(format!("missing required parameter: {key}"), None)
    })
}

/// Reads an optional string argument like `optional_str_arg`, but also
/// rejects an empty string. Without this, `Ok(Some(""))` reaches
/// `index.rs::search()`, where `str::contains("")` is `true` for every
/// record — an empty filter would silently behave like an omitted one,
/// returning the whole catalog with no error.
fn non_empty_optional_str_arg<'a>(
    args: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<Option<&'a str>, McpError> {
    match optional_str_arg(args, key)? {
        Some("") => Err(McpErrorData::invalid_params(
            format!("parameter '{key}' must not be empty"),
            None,
        )),
        other => Ok(other),
    }
}

/// Builds the distinct "body too large" error `get_skill` returns when a
/// skill's body exceeds `MAX_SKILL_BODY_BYTES`, checked from either a
/// fresh pre-read `stat` or the freshly-read on-disk size — `stage`
/// names which one triggered it, so the message stays actionable about
/// where the size came from. Deliberately `InvalidParams`: distinct from
/// both "skill not found" (also `InvalidParams`, but a different
/// message) and "skill file unreadable" (`InternalError`).
fn too_large_error(name: &str, actual_bytes: u64, stage: &str) -> McpError {
    McpErrorData::invalid_params(
        format!(
            "skill body {TOO_LARGE_MARKER}: {name}: {actual_bytes} bytes ({stage}) exceeds the {MAX_SKILL_BODY_BYTES}-byte limit"
        ),
        None,
    )
}

/// The `get_prompt` counterpart of `too_large_error`, just above: same
/// distinct-from-"not found"/"unreadable" rationale and the same `stage`
/// marker distinguishing a stat-caught grow from the post-read TOCTOU
/// backstop, only the message says "SOP" instead of "skill".
fn sop_too_large_error(name: &str, actual_bytes: u64, stage: &str) -> McpError {
    McpErrorData::invalid_params(
        format!(
            "SOP body {TOO_LARGE_MARKER}: {name}: {actual_bytes} bytes ({stage}) exceeds the {MAX_SKILL_BODY_BYTES}-byte limit"
        ),
        None,
    )
}

/// Serializes `value` to a single JSON text `CallToolResult`. Every tool
/// here returns one JSON object (or array) as its sole content item, so
/// this is the one place that needs to reconcile "serialization can't
/// fail in practice for these DTOs" with the `Result` `Content::json`
/// still returns — the `expect` documents that this crate's own
/// `#[derive(Serialize)]` structs of plain strings/numbers/vecs have no
/// path to a serialization error (that's reserved for types with
/// fallible `Serialize` impls, none of which appear here).
fn json_result<T: Serialize>(value: &T) -> CallToolResult {
    let content = ContentBlock::json(value).expect("response DTOs cannot fail to serialize");
    CallToolResult::success(vec![content])
}

/// Builds the `find_skills` tool's advertised schema: three
/// optional string filters, no other properties accepted.
fn find_skills_tool() -> Tool {
    Tool::new(
        "find_skills",
        "Search the skill catalog by name, keyword, or tag (substring/exact filters, not a ranker). \
         All inputs are optional; when several are given, results must match all of them (AND). \
         With none given, every indexed skill is returned. Returns metadata only, never a SKILL.md body.",
        json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Substring match against skill name (case-insensitive)."
                },
                "keyword": {
                    "type": "string",
                    "description": "Substring match against name + description combined (case-insensitive)."
                },
                "tag": {
                    "type": "string",
                    "description": "Exact match against any tag in the skill's tags array (case-insensitive)."
                }
            },
            "additionalProperties": false
        })
        .as_object()
        .expect("object literal is always a JSON object")
        .clone(),
    )
}

/// Builds the `get_skill` tool's advertised schema: a single
/// required `name`, exact match, no other properties accepted.
fn get_skill_tool() -> Tool {
    Tool::new(
        "get_skill",
        "Fetch the full body (including frontmatter) of one skill by exact, case-insensitive name.",
        json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Exact skill name (case-insensitive match against the index). Must match exactly one skill."
                }
            },
            "required": ["name"],
            "additionalProperties": false
        })
        .as_object()
        .expect("object literal is always a JSON object")
        .clone(),
    )
}

/// Builds the `reload_skills` tool's advertised schema: no
/// arguments at all.
fn reload_skills_tool() -> Tool {
    Tool::new(
        "reload_skills",
        "Force a full re-scan of every configured --skills-dir, rebuilding the index from scratch. \
         Returns a diagnostics report: how many skills were indexed, which files were skipped and why, \
         and which name collisions were resolved.",
        json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        })
        .as_object()
        .expect("object literal is always a JSON object")
        .clone(),
    )
}

/// `ServerHandler` implementation exposing the three skill-lookup tools
/// on top of the `SkillIndex` this binary builds at startup.
///
/// This type's `initialize` method rejects every call after the first.
/// In `rmcp` 0.1.5, the crate's own handshake helper answered the
/// legitimate first `initialize` directly from `get_info()`, without
/// ever calling a `ServerHandler`'s own `initialize` override — so an
/// unconditional-reject override was safe there; any call reaching it
/// was necessarily a second, protocol-violating `initialize`.
///
/// `rmcp` 2.1.0 changed this (re-confirmed against
/// `rmcp-2.1.0/src/service/server.rs`'s `serve_server_with_ct_inner`,
/// which now dispatches the first `initialize` through the exact same
/// `Service::handle_request` -> `ServerHandler::initialize` path as
/// every later request — see also `rmcp-2.1.0/src/handler/server.rs`'s
/// default `initialize` impl, which calls `get_info()` itself). This
/// method is therefore reachable on a session's legitimate first call,
/// and an unconditional reject would break every real handshake. The
/// `initialized` flag below is this type's own replacement session-state
/// signal: `false` on the first call (accept, answer from `get_info()`,
/// flip the flag), `true` on every call after (reject). `AtomicBool`
/// rather than a plain `bool` because `ServerHandler`/`Service<RoleServer>`
/// dispatch through `&self`, not `&mut self` -- the handler instance is
/// shared for the session's lifetime, so this needs `Sync` interior
/// mutability, not exclusive access. Wrapped in `Arc` (like
/// `tool_call_counters` below) so a `Clone` of this type -- if `rmcp`'s
/// internals ever clone the handler mid-session -- still shares the
/// same session-state signal, rather than each clone silently starting
/// its own independent "first call" tracking.
#[derive(Clone, Debug)]
pub(crate) struct SkillLookupServer {
    pub(crate) index: SkillIndex,
    /// Agent SOPs served as MCP prompts via `list_prompts`/`get_prompt`.
    /// Built once at startup from `--agent-sop-paths`; empty when the
    /// flag isn't passed, in which case `prompts/list` returns an empty
    /// list and every `prompts/get` reports "prompt not found".
    pub(crate) sops: SopIndex,
    /// In-process tool-call counters, shared with
    /// the periodic flush task spawned in `main.rs`. `None` when
    /// `--telemetry off` was passed -- structural opt-out: the
    /// increment call is simply skipped, never invoked-then-discarded.
    pub(crate) tool_call_counters: Option<skill_lookup_core::telemetry::ToolCallCounters>,
    /// Session-state signal for `initialize`: `false` until the first
    /// `initialize` call succeeds, `true` after. See the struct-level
    /// doc comment above for why this replaced the unconditional-reject
    /// override the `rmcp` 0.1.5 version of this type used. Every
    /// construction site sets this to a fresh
    /// `Arc::new(AtomicBool::new(false))` -- a session always starts
    /// uninitialized, so there is no other value a fresh server should
    /// ever be built with.
    pub(crate) initialized: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl SkillLookupServer {
    /// Handles `find_skills`: a pure filter over the static index (TD-2
    /// — v1 is a filter, not a ranker; no relevance score is computed or
    /// returned). Always succeeds — "no skill matched" is an empty JSON
    /// array, never an error, so it can never be confused with the
    /// distinct `InternalError`/`InvalidParams` failures `get_skill` can
    /// return.
    fn find_skills(
        &self,
        args: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<CallToolResult, McpError> {
        reject_unknown_keys(args, &["name", "keyword", "tag"])?;
        let name = non_empty_optional_str_arg(args, "name")?;
        let keyword = non_empty_optional_str_arg(args, "keyword")?;
        let tag = non_empty_optional_str_arg(args, "tag")?;

        let records: Vec<FindSkillsRecord> = self
            .index
            .search(name, keyword, tag)
            .into_iter()
            .map(|r| FindSkillsRecord {
                name: r.name,
                description: r.description,
                tags: r.tags,
                version: r.version,
                size_bytes: r.size_bytes,
                provenance: provenance_str(r.provenance),
            })
            .collect();
        // Debug detail: query params and result count for each
        // find_skills call. Guarded on `debug_enabled()` here (not just
        // inside `logging::log`) so the `format!` allocation below is
        // skipped entirely when debug logging is off, since this runs on
        // every call, not just at startup/reload.
        if logging::debug_enabled() {
            logging::log(
                Level::Debug,
                &format!(
                    "find_skills: name={name:?} keyword={keyword:?} tag={tag:?} result_count={}",
                    records.len()
                ),
            );
        }
        Ok(json_result(&records))
    }

    /// Handles `get_skill`: exact-name lookup, then a fresh disk read of
    /// the body (never cached — every `get_skill` call re-reads the
    /// file fresh from disk, mirrored in the
    /// doc comment on this tool's schema). Three distinct,
    /// non-overlapping failure signals:
    ///   - unknown name: `InvalidParams`, `"skill not found: <name>"`.
    ///   - read failure on a name the index does have (file deleted,
    ///     moved, or permissions changed since the last scan):
    ///     `InternalError`, `"skill file unreadable: <name>: <io error>"`.
    ///   - the body is too large to hand back whole (checked twice: a
    ///     fresh `stat` before any read, then the freshly-read body as a
    ///     bounded TOCTOU backstop — the `stat` is what stops a
    ///     grew-after-scan file from ever being read into memory):
    ///     `InvalidParams`, distinct from both of the above.
    ///
    /// The index entry is left in place either way — it's a startup
    /// snapshot, not mutated by a per-call I/O failure; only
    /// `reload_skills` removes a now-gone entry.
    fn get_skill(
        &self,
        args: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<CallToolResult, McpError> {
        reject_unknown_keys(args, &["name"])?;
        let name = required_str_arg(args, "name")?;

        let found = self.index.get(name);
        // Debug detail: the requested name and hit/miss for each
        // get_skill call. Logged from the lookup itself, not from whichever
        // branch runs after it, so "hit" always means "the index had
        // this name" — independent of whether the subsequent read/size
        // check below then succeeds.
        if logging::debug_enabled() {
            logging::log(
                Level::Debug,
                &format!("get_skill: name={name:?} hit={}", found.is_some()),
            );
        }
        let record = found.ok_or_else(|| {
            McpErrorData::invalid_params(format!("{SKILL_NOT_FOUND_PREFIX}{name}"), None)
        })?;

        // First guard: stat the file fresh. Catches grew-after-scan
        // *without* reading the body — the whole point of the ceiling.
        let metadata = std::fs::metadata(&record.path).map_err(|e| {
            McpErrorData::internal_error(format!("{SKILL_UNREADABLE_PREFIX}{name}: {e}"), None)
        })?;
        if metadata.len() > MAX_SKILL_BODY_BYTES {
            return Err(too_large_error(&record.name, metadata.len(), "stat size"));
        }

        let content = std::fs::read_to_string(&record.path).map_err(|e| {
            McpErrorData::internal_error(format!("{SKILL_UNREADABLE_PREFIX}{name}: {e}"), None)
        })?;

        // Size the body we actually read, not the index snapshot: the file may
        // have changed since the last scan, and callers budget context off this.
        let size_bytes = content.len() as u64;

        // Second guard, backstop only: catches the file growing in the
        // narrow window between the stat above and this read. Free (no
        // extra I/O) — this residual TOCTOU gap is bounded and accepted.
        if size_bytes > MAX_SKILL_BODY_BYTES {
            return Err(too_large_error(&record.name, size_bytes, "post-read size"));
        }

        Ok(json_result(&GetSkillResponse {
            name: record.name,
            content,
            path: record.path.display().to_string(),
            size_bytes,
        }))
    }

    /// Handles `reload_skills`: forces `SkillIndex::reload` and reports
    /// the resulting `ScanDiagnostic` (plus the filtered-out count) as
    /// the tool's response, so the calling agent — not just an operator
    /// watching stderr — sees what the reload did. `reload_skills`
    /// takes no arguments.
    ///
    /// Also emits the diagnostic to stderr, same as startup — without
    /// this, reloading regressed operator visibility relative to boot,
    /// where `main` always calls `emit_to_stderr()`.
    fn reload_skills(
        &self,
        args: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<CallToolResult, McpError> {
        reject_unknown_keys(args, &[])?;
        let (diagnostic, filtered_out, excluded_names) = self.index.reload();
        diagnostic.emit_to_stderr(filtered_out);
        logging::log_filter_exclusions(self.index.skill_name_filter(), &excluded_names);
        Ok(json_result(&ReloadDiagnosticResponse {
            indexed: diagnostic.indexed_count.saturating_sub(filtered_out),
            skills_dirs: self
                .index
                .skills_dirs()
                .iter()
                .map(|d| d.path.display().to_string())
                .collect(),
            skipped: diagnostic
                .skipped
                .iter()
                .map(|s| SkipReport {
                    path: s.path.display().to_string(),
                    reason: frontmatter::skip_reason_message(&s.path, &s.reason),
                })
                .collect(),
            collisions: diagnostic
                .collisions
                .iter()
                .map(|c| CollisionReport {
                    name: c.name.clone(),
                    winning_path: c.winning_path.display().to_string(),
                    losing_path: c.losing_path.display().to_string(),
                })
                .collect(),
            filtered_out,
        }))
    }

    /// Handles `prompts/list`: advertises every indexed SOP as an MCP
    /// prompt (name only — SOPs carry no arguments and no separate
    /// description, so `Prompt.description`/`arguments` are `None`).
    /// Metadata-only, mirroring `find_skills`: the body is never returned
    /// here, only by `get_prompt`. Always succeeds — an empty
    /// `--agent-sop-paths` set is an empty prompt list, never an error.
    fn list_prompt_records(&self) -> ListPromptsResult {
        let prompts = self
            .sops
            .list()
            .iter()
            .map(|s| Prompt::new(s.name.clone(), None::<String>, None))
            .collect();
        ListPromptsResult::with_all_items(prompts)
    }

    /// Handles `prompts/get`: exact-name, case-insensitive lookup, then a
    /// fresh disk read of the SOP body (never cached). Mirrors
    /// `get_skill`'s failure contract exactly, "skill"/"SOP" substituted
    /// throughout (`"prompt not found"` / `"SOP file unreadable"` / a
    /// too-large body caught by `stat` then a post-read backstop).
    ///
    /// Any `arguments` the client sends are ignored: this server's
    /// prompts advertise no arguments (`Prompt.arguments` is `None`), so
    /// there are none to substitute.
    fn get_prompt_by_name(&self, name: &str) -> Result<GetPromptResult, McpError> {
        let record = self.sops.get(name).ok_or_else(|| {
            McpErrorData::invalid_params(format!("prompt not found: {name}"), None)
        })?;

        // Re-verify the stored (canonical, in-root at scan time) path
        // still resolves inside the root it was indexed under, before
        // reading. The SOP index has no `reload` tool (unlike the skill
        // index), so without this re-check a symlink swapped in at
        // `record.path` after startup would re-open the arbitrary-file-
        // read hole scan-time containment closed — `get_skill` can omit
        // this precisely because a reload re-validates the skill index.
        // Reading `resolved` (not `record.path`) also means a swapped
        // symlink is followed only after this containment gate, never
        // before it.
        let resolved = std::fs::canonicalize(&record.path).map_err(|e| {
            McpErrorData::internal_error(format!("SOP file unreadable: {name}: {e}"), None)
        })?;
        if !resolved.starts_with(&record.root) {
            return Err(McpErrorData::invalid_params(
                format!("SOP file resolves outside its --agent-sop-paths root: {name}"),
                None,
            ));
        }
        // Residual TOCTOU: a swap landing between this canonicalize and
        // the metadata/read below could still slip a symlink past the
        // check (metadata follows symlinks). The window is microseconds
        // and requires write access to the configured root; it is the
        // same bounded-and-accepted race the size guards note, narrower
        // than get_skill (which has no get-time re-check at all).

        // First guard: stat the file fresh. Catches a grew-after-startup
        // file *without* reading the body — the point of the ceiling.
        let metadata = std::fs::metadata(&resolved).map_err(|e| {
            McpErrorData::internal_error(format!("SOP file unreadable: {name}: {e}"), None)
        })?;
        if metadata.len() > MAX_SKILL_BODY_BYTES {
            return Err(sop_too_large_error(
                &record.name,
                metadata.len(),
                "stat size",
            ));
        }

        let content = std::fs::read_to_string(&resolved).map_err(|e| {
            McpErrorData::internal_error(format!("SOP file unreadable: {name}: {e}"), None)
        })?;

        // Second guard, backstop only: catches the file growing in the
        // narrow window between the stat above and this read. Free (no
        // extra I/O); this residual TOCTOU gap is bounded and accepted,
        // exactly as in `get_skill`.
        if content.len() as u64 > MAX_SKILL_BODY_BYTES {
            return Err(sop_too_large_error(
                &record.name,
                content.len() as u64,
                "post-read size",
            ));
        }

        Ok(GetPromptResult::new(vec![PromptMessage::new_text(
            Role::User,
            content,
        )]))
    }
}

/// Derives the `(tool_name, skill_name, errorCode)` counter key for one
/// `call_tool` invocation.
///
/// - A successful call: `errorCode: None`, `tool_name`/`skill_name` used
///   verbatim (both are closed/resolved values for a successful call --
///   see the doc comment below on the unresolved-name cases).
/// - An unrecognized `tool_name` (not one of the three known tools):
///   `errorCode: Some("mcp.unknown_tool")`, and the `tool_name` component
///   is the fixed sentinel `UNKNOWN_SENTINEL`, never the caller-supplied
///   string -- bounds cardinality to one entry regardless of how many
///   distinct unrecognized names a caller sends.
/// - `get_skill` with an unrecognized `skill_name` (an `InvalidParams`
///   whose message starts with `SKILL_NOT_FOUND_PREFIX`): `errorCode:
///   Some("mcp.unknown_skill")`, and the `skill_name` component is the
///   sentinel, never the caller-supplied string, for the identical
///   cardinality-bounding reason.
/// - Every other failure shape (`get_skill`'s internal-error/too-large
///   cases, `find_skills`/`reload_skills` argument-validation failures):
///   a closed, per-failure-shape `errorCode` derived from the `McpError`
///   variant, never the error's own `Display`/message text.
fn record_tool_call(
    counters: &skill_lookup_core::telemetry::ToolCallCounters,
    tool_name: &str,
    args: &serde_json::Map<String, serde_json::Value>,
    result: &Result<CallToolResult, McpError>,
) {
    use skill_lookup_core::telemetry::{increment_counter, UNKNOWN_SENTINEL};

    let known_tool = matches!(tool_name, "find_skills" | "get_skill" | "reload_skills");

    let skill_name_arg = || {
        args.get("name")
            .and_then(|v| v.as_str())
            .map(str::to_string)
    };

    match result {
        Ok(_) => {
            let skill_name = if tool_name == "get_skill" {
                skill_name_arg()
            } else {
                None
            };
            increment_counter(counters, tool_name, skill_name, None);
        }
        Err(err) if !known_tool => {
            increment_counter(counters, UNKNOWN_SENTINEL, None, Some("mcp.unknown_tool"));
            let _ = err; // message text intentionally never inspected further
        }
        Err(err) if tool_name == "get_skill" && err.message.starts_with(SKILL_NOT_FOUND_PREFIX) => {
            increment_counter(
                counters,
                "get_skill",
                Some(UNKNOWN_SENTINEL.to_string()),
                Some("mcp.unknown_skill"),
            );
        }
        Err(err) => {
            let error_code = mcp_error_code(err);
            // Argument-validation failures (`reject_unknown_keys`,
            // `required_str_arg`) can reach this arm before `get_skill`
            // ever calls `self.index.get(name)` -- e.g. an unknown extra
            // key alongside a well-formed `name`. The caller-supplied
            // name is therefore not guaranteed resolved/known here the
            // way it is on the success path, so use the sentinel for the
            // same cardinality-bounding reason as the other unresolved-
            // name arms above.
            //
            // A RESOLVED-but-failed case reaches this same arm too:
            // `get_skill`'s "skill file unreadable" (the file vanished
            // or became unreadable after `self.index.get(name)` already
            // succeeded) and "too large" (ditto, caught by the stat or
            // post-read size guard) both occur strictly after a
            // successful lookup -- the name WAS resolved. The sentinel
            // exists specifically for the
            // pre-lookup, attacker-arbitrary case above; it never
            // intended to hide real diagnostic signal (which skill has
            // the problem) for a name the lookup already confirmed
            // exists. Distinguish by message shape (via the same
            // shared constants the construction sites above use, so a
            // reword can't drift this out of sync), and use the real
            // caller-supplied name (verbatim, matching the success
            // arm's own convention) for those.
            let name_was_resolved = tool_name == "get_skill"
                && (err.message.starts_with(SKILL_UNREADABLE_PREFIX)
                    || err.message.contains(TOO_LARGE_MARKER));
            let skill_name = if name_was_resolved {
                skill_name_arg()
            } else if tool_name == "get_skill" {
                Some(UNKNOWN_SENTINEL.to_string())
            } else {
                None
            };
            increment_counter(counters, tool_name, skill_name, Some(error_code));
        }
    }
}

/// A stable, closed error-category string for an `McpError` -- never
/// the error's own `Display`/message text, which
/// routinely carries a caller-supplied argument (an oversized/malformed
/// skill name, an unknown key) verbatim.
///
/// Classifies on `err.code` (`rmcp::model::ErrorCode`, a stable, public
/// `PartialEq` field every `McpErrorData` constructor sets directly --
/// `reject_unknown_keys`/`required_str_arg`/`non_empty_optional_str_arg`
/// and `too_large_error` all set `INVALID_PARAMS`; `get_skill`'s
/// "skill file unreadable" case sets `INTERNAL_ERROR`), never on the
/// error's own message text: this arm is only reached for the closed
/// set of failure shapes above (the caller already intercepted
/// `get_skill`'s unresolved-name case and the unknown-tool case in the
/// earlier match arms), and every one of them maps to exactly one of
/// these two codes -- so a future reword of any of those messages
/// cannot silently reclassify the telemetry error code the way a
/// substring match would.
fn mcp_error_code(err: &McpError) -> &'static str {
    if err.code == rmcp::model::ErrorCode::INVALID_PARAMS {
        "mcp.invalid_params"
    } else {
        "mcp.internal_error"
    }
}

impl ServerHandler for SkillLookupServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_prompts()
                .build(),
        )
        .with_server_info(Implementation::new(
            "skill-lookup-mcp",
            env!("CARGO_PKG_VERSION"),
        ))
        .with_instructions(
            "Search the skill catalog with find_skills, fetch a skill's full body with \
             get_skill, and force a re-scan with reload_skills. List available agent SOPs \
             with the prompts/list method and fetch one with prompts/get.",
        )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        Ok(ListToolsResult::with_all_items(vec![
            find_skills_tool(),
            get_skill_tool(),
            reload_skills_tool(),
        ]))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let empty = serde_json::Map::new();
        let args = request.arguments.as_ref().unwrap_or(&empty);
        let tool_name = request.name.as_ref();
        // No generic per-call line here: each tool handler already logs
        // its own debug detail via its own `logging::log(Level::Debug,
        // ...)` calls above (query params/result count for find_skills,
        // requested name/hit-miss for get_skill).
        let result = match tool_name {
            "find_skills" => self.find_skills(args),
            "get_skill" => self.get_skill(args),
            "reload_skills" => self.reload_skills(args),
            other => Err(McpErrorData::invalid_params(
                format!("unknown tool: {other}"),
                None,
            )),
        };
        // One line per rejection, naming the tool and why — no per-result
        // spam on success (e.g. `find_skills`' matches aren't logged).
        if let Err(ref e) = result {
            logging::log(Level::Warn, &format!("tool rejected: {tool_name}: {e}"));
        }

        // Telemetry: in-process counter increment
        // only -- take the lock, bump one entry, release the lock; no
        // `.await` held across the critical section, no network call, no
        // process spawn on this hot path. Structurally skipped when
        // `--telemetry off`: `tool_call_counters` is `None`, so the
        // increment call is never invoked.
        if let Some(counters) = &self.tool_call_counters {
            record_tool_call(counters, tool_name, args, &result);
        }

        result
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, McpError> {
        Ok(self.list_prompt_records())
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResult, McpError> {
        let name = request.name.as_str();
        // Mirrors `find_skills`/`get_skill`'s own per-call debug line
        // and `call_tool`'s rejection line above: routed
        // through `logging::log` — not a raw `eprintln!` — so both the
        // request and any rejection reach the durable log, the same as
        // every tool call already does.
        if logging::debug_enabled() {
            logging::log(Level::Debug, &format!("prompt requested: {name}"));
        }
        let result = self.get_prompt_by_name(name);
        if let Err(ref e) = result {
            logging::log(Level::Warn, &format!("prompt rejected: {name}: {e}"));
        }
        result
    }

    async fn initialize(
        &self,
        request: InitializeRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, McpError> {
        // DEVIATION FROM THE MIGRATION PLAN, flagged explicitly per the
        // ESCALATION clause: `rmcp` 2.1.0 changed how the handshake
        // dispatches the *first* `initialize`, and the plan's own risk
        // assessment (correctly) named this exact method as the one
        // place a real behavioral regression could hide.
        //
        // Verified against `rmcp-2.1.0/src/service/server.rs`'s
        // `serve_server_with_ct_inner`: it now calls
        // `service.handle_request(request.clone(), context)` for the
        // *first* `initialize` too, which dispatches through the same
        // `Service::handle_request` -> `ServerHandler::initialize` path
        // (`rmcp-2.1.0/src/handler/server.rs`) as every later request —
        // there is no longer a special "answer directly from
        // `get_info()`, never call the handler's own override" path the
        // 0.1.5-era version of this method (and this crate's doc
        // comments) relied on. An unconditional-reject override, as
        // this method used to be, would therefore reject every
        // legitimate first handshake too.
        //
        // Fix: track "has this session already completed one
        // `initialize`" explicitly, in `self.initialized` (an
        // `Arc<AtomicBool>` — see the struct-level doc comment for why
        // an atomic, not a plain `bool`). `swap(true, ...)` both reads
        // the prior value and sets it to `true` in one atomic step, so
        // two `initialize` calls racing on the same session can't both
        // observe `false` and both proceed as though each were first.
        let already_initialized = self
            .initialized
            .swap(true, std::sync::atomic::Ordering::SeqCst);
        if already_initialized {
            return Err(McpError::invalid_request(
                "initialize has already been completed for this session; MCP `initialize` is a one-time handshake",
                None,
            ));
        }

        // Mirrors `rmcp`'s own default `ServerHandler::initialize` impl
        // (`rmcp-2.1.0/src/handler/server.rs`): answer from `get_info()`,
        // then negotiate the protocol version against what the client
        // requested. This handler still needs its own override (rather
        // than relying on the default impl) purely to add the
        // second-call rejection above -- the accept path below is
        // otherwise identical to what the default impl already does.
        //
        // `rmcp`'s own negotiation helper
        // (`service::server::negotiate_protocol_version`) is
        // `pub(crate)` and not reachable from here, so this replicates
        // its exact logic against the public `ProtocolVersion::KNOWN_VERSIONS`
        // list instead: echo the client's requested version if this SDK
        // knows it, otherwise fall back to this server's own advertised
        // version from `get_info()`.
        let mut info = self.get_info();
        if rmcp::model::ProtocolVersion::KNOWN_VERSIONS.contains(&request.protocol_version) {
            info.protocol_version = request.protocol_version;
        }
        Ok(info)
    }
}

/// Tests for the three MCP tool handlers (`find_skills`, `get_skill`,
/// `reload_skills`) built on `SkillIndex`.
#[cfg(test)]
mod tool_handlers {
    use super::*;
    use skill_lookup_core::model::ResolvedDir;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skill-lookup-tools-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_skill(dir: &Path, name: &str, description: &str, tags: &[&str]) {
        let skill_dir = dir.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        let tags_yaml = if tags.is_empty() {
            String::new()
        } else {
            format!(
                "\ntags:\n{}",
                tags.iter()
                    .map(|t| format!("  - {t}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        };
        fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {description}{tags_yaml}\n---\n\nBody.\n"),
        )
        .unwrap();
    }

    fn server(dir: &Path) -> SkillLookupServer {
        let (index, _diag, _filtered, _excluded_names) =
            SkillIndex::build(vec![ResolvedDir::managed(dir)], None);
        SkillLookupServer {
            index,
            sops: SopIndex::default(),
            tool_call_counters: None,
            initialized: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Builds a server whose SOP index is scanned from `sop_dir`, for the
    /// `list_prompts`/`get_prompt` handler tests. The skill index is
    /// empty (a separate temp dir) since these tests exercise only the
    /// prompt surface.
    fn server_with_sops(skills_dir: &Path, sop_dir: &Path) -> SkillLookupServer {
        let (index, _diag, _filtered, _excluded_names) =
            SkillIndex::build(vec![ResolvedDir::managed(skills_dir)], None);
        let (sops, _messages) = SopIndex::build(&[sop_dir.to_path_buf()], &None);
        SkillLookupServer {
            index,
            sops,
            tool_call_counters: None,
            initialized: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Writes a `<name>.sop.md` file with the given body directly under
    /// `dir` — the flat layout SOPs use.
    fn write_sop(dir: &Path, name: &str, body: &str) {
        fs::write(dir.join(format!("{name}.sop.md")), body).unwrap();
    }

    /// Extracts and parses the sole JSON text content item a tool
    /// handler returned, for assertions that need structured access
    /// rather than a substring check on the raw text.
    fn json_content(result: &CallToolResult) -> serde_json::Value {
        assert_eq!(result.content.len(), 1, "expected exactly one content item");
        let ContentBlock::Text(text) = &result.content[0] else {
            panic!("expected text content, got: {:?}", result.content[0]);
        };
        serde_json::from_str(&text.text).expect("content must be valid JSON")
    }

    fn args(pairs: &[(&str, &str)]) -> serde_json::Map<String, serde_json::Value> {
        pairs
            .iter()
            .map(|(k, v)| {
                (
                    (*k).to_string(),
                    serde_json::Value::String((*v).to_string()),
                )
            })
            .collect()
    }

    #[test]
    fn find_skills_with_no_args_returns_every_indexed_skill() {
        let dir = temp_dir("find-no-args");
        write_skill(&dir, "alpha", "first", &[]);
        write_skill(&dir, "beta", "second", &[]);
        let result = server(&dir).find_skills(&serde_json::Map::new()).unwrap();
        let body = json_content(&result);
        assert_eq!(body.as_array().unwrap().len(), 2);
        assert_eq!(result.is_error, Some(false));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_never_returns_a_score_field() {
        // TD-2: v1 is a filter, not a ranker — the response schema must
        // carry no relevance score.
        let dir = temp_dir("find-no-score");
        write_skill(&dir, "alpha", "first", &[]);
        let result = server(&dir).find_skills(&serde_json::Map::new()).unwrap();
        let body = json_content(&result);
        let record = &body.as_array().unwrap()[0];
        assert!(
            record.as_object().unwrap().get("score").is_none(),
            "find_skills must never include a score field, got: {record}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    // ── FIX: empty-string filters must be rejected, not treated as omitted ──

    #[test]
    fn find_skills_rejects_an_empty_name_filter() {
        let dir = temp_dir("find-empty-name");
        write_skill(&dir, "alpha", "first", &[]);
        let err = server(&dir)
            .find_skills(&args(&[("name", "")]))
            .unwrap_err();
        assert!(
            err.message.contains("parameter 'name' must not be empty"),
            "got: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_rejects_an_empty_keyword_filter() {
        let dir = temp_dir("find-empty-keyword");
        write_skill(&dir, "alpha", "first", &[]);
        let err = server(&dir)
            .find_skills(&args(&[("keyword", "")]))
            .unwrap_err();
        assert!(
            err.message
                .contains("parameter 'keyword' must not be empty"),
            "got: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_rejects_an_empty_tag_filter() {
        let dir = temp_dir("find-empty-tag");
        write_skill(&dir, "alpha", "first", &[]);
        let err = server(&dir).find_skills(&args(&[("tag", "")])).unwrap_err();
        assert!(
            err.message.contains("parameter 'tag' must not be empty"),
            "got: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_with_an_omitted_filter_still_returns_everything() {
        // Omitted and empty must stay distinguishable: omitting a filter
        // is the documented way to match everything; an empty string is
        // rejected above rather than silently behaving the same way.
        let dir = temp_dir("find-omitted-filter");
        write_skill(&dir, "alpha", "first", &[]);
        write_skill(&dir, "beta", "second", &[]);
        let result = server(&dir).find_skills(&serde_json::Map::new()).unwrap();
        let body = json_content(&result);
        assert_eq!(body.as_array().unwrap().len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    /// The parameter allowlist for one tool appears in three places that
    /// nothing enforces agreement between: the JSON schema's
    /// `properties` object (advertised to callers), the
    /// `reject_unknown_keys` array in the handler (what's actually
    /// rejected), and the individual `optional_str_arg`/`required_str_arg`
    /// calls (what's actually read). This drives each tool's real
    /// handler against its own advertised schema keys and fails if any
    /// of the three has silently drifted from the others: a schema key
    /// the handler doesn't recognize is rejected as "unknown parameter",
    /// and a handler-accepted key absent from the schema would leave an
    /// underscore-prefixed probe key wrongly accepted below.
    fn assert_allowlist_agrees(
        tool: &Tool,
        call: impl Fn(&serde_json::Map<String, serde_json::Value>) -> Result<CallToolResult, McpError>,
    ) {
        let schema_keys: Vec<String> = tool
            .input_schema
            .get("properties")
            .and_then(|p| p.as_object())
            .map(|obj| obj.keys().cloned().collect())
            .unwrap_or_default();

        // Every schema-declared key must be accepted together — proves
        // `reject_unknown_keys` and the arg readers aren't narrower than
        // the schema.
        let all_args: serde_json::Map<String, serde_json::Value> = schema_keys
            .iter()
            .map(|k| (k.clone(), serde_json::Value::String("probe".to_string())))
            .collect();
        let result = call(&all_args);
        assert!(
            !matches!(&result, Err(e) if format!("{e}").contains("unknown parameter")),
            "tool '{}' rejected its own advertised schema keys {schema_keys:?} as unknown: {result:?}",
            tool.name
        );

        // A key absent from the schema must still be rejected — proves
        // `reject_unknown_keys` isn't wider than the schema.
        let mut with_extra = all_args;
        with_extra.insert(
            "__not_in_schema__".to_string(),
            serde_json::Value::String("x".to_string()),
        );
        let result = call(&with_extra);
        assert!(
            matches!(&result, Err(e) if format!("{e}").contains("unknown parameter")),
            "tool '{}' must reject a key absent from its schema, got: {result:?}",
            tool.name
        );
    }

    #[test]
    fn find_skills_allowlist_agrees_across_schema_and_handler() {
        let dir = temp_dir("find-skills-allowlist-agreement");
        let srv = server(&dir);
        assert_allowlist_agrees(&find_skills_tool(), |args| srv.find_skills(args));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_allowlist_agrees_across_schema_and_handler() {
        let dir = temp_dir("get-skill-allowlist-agreement");
        write_skill(&dir, "probe", "d", &[]);
        let srv = server(&dir);
        assert_allowlist_agrees(&get_skill_tool(), |args| srv.get_skill(args));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reload_skills_allowlist_agrees_across_schema_and_handler() {
        let dir = temp_dir("reload-skills-allowlist-agreement");
        let srv = server(&dir);
        assert_allowlist_agrees(&reload_skills_tool(), |args| srv.reload_skills(args));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_never_returns_a_skill_md_body() {
        let dir = temp_dir("find-metadata-only");
        write_skill(&dir, "alpha", "first", &[]);
        let result = server(&dir).find_skills(&serde_json::Map::new()).unwrap();
        let body = json_content(&result);
        let record = body.as_array().unwrap()[0].as_object().unwrap();
        for forbidden in ["content", "body"] {
            assert!(
                !record.contains_key(forbidden),
                "find_skills record must not carry a body field '{forbidden}', got: {record:?}"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_applies_and_semantics_across_all_three_filters() {
        let dir = temp_dir("find-and-semantics");
        write_skill(&dir, "alpha", "first skill", &["rust"]);
        write_skill(&dir, "alpha-two", "second skill", &["python"]);
        let result = server(&dir)
            .find_skills(&args(&[
                ("name", "alpha"),
                ("keyword", "first"),
                ("tag", "rust"),
            ]))
            .unwrap();
        let body = json_content(&result);
        let names: Vec<&str> = body
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, vec!["alpha"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_name_filter_is_case_insensitive() {
        let dir = temp_dir("find-name-case-insensitive");
        write_skill(&dir, "FrontendDev", "d", &[]);
        let result = server(&dir)
            .find_skills(&args(&[("name", "frontend")]))
            .unwrap();
        let body = json_content(&result);
        assert_eq!(body.as_array().unwrap().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_tag_filter_is_case_insensitive() {
        let dir = temp_dir("find-tag-case-insensitive");
        write_skill(&dir, "alpha", "d", &["Rust"]);
        let result = server(&dir).find_skills(&args(&[("tag", "rust")])).unwrap();
        let body = json_content(&result);
        assert_eq!(body.as_array().unwrap().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_no_match_is_an_empty_array_not_an_error() {
        // Distinguishable empty vs. error: "no skill matched" must
        // not look like a failure.
        let dir = temp_dir("find-empty-not-error");
        write_skill(&dir, "alpha", "d", &[]);
        let result = server(&dir)
            .find_skills(&args(&[("name", "does-not-exist")]))
            .unwrap();
        assert_eq!(result.is_error, Some(false));
        let body = json_content(&result);
        assert_eq!(body.as_array().unwrap().len(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_reports_provenance_per_record() {
        let managed_dir = temp_dir("find-provenance-managed");
        let workspace_dir = temp_dir("find-provenance-workspace");
        write_skill(&managed_dir, "from-managed", "d", &[]);
        write_skill(&workspace_dir, "from-workspace", "d", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(
            vec![
                ResolvedDir::managed(&managed_dir),
                ResolvedDir::workspace(&workspace_dir),
            ],
            None,
        );
        let result = SkillLookupServer {
            index,
            sops: SopIndex::default(),
            tool_call_counters: None,
            initialized: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
        .find_skills(&serde_json::Map::new())
        .unwrap();
        let body = json_content(&result);
        let by_name: std::collections::HashMap<&str, &str> = body
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r["name"].as_str().unwrap(),
                    r["provenance"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(by_name["from-managed"], "managed");
        assert_eq!(by_name["from-workspace"], "workspace");
        let _ = fs::remove_dir_all(&managed_dir);
        let _ = fs::remove_dir_all(&workspace_dir);
    }

    #[test]
    fn get_skill_returns_full_body_for_a_known_name() {
        let dir = temp_dir("get-skill-known");
        write_skill(&dir, "alpha", "first", &[]);
        let result = server(&dir).get_skill(&args(&[("name", "alpha")])).unwrap();
        let body = json_content(&result);
        assert_eq!(body["name"], "alpha");
        assert!(body["content"].as_str().unwrap().contains("name: alpha"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_lookup_is_case_insensitive() {
        let dir = temp_dir("get-skill-case-insensitive");
        write_skill(&dir, "AlphaSkill", "first", &[]);
        let result = server(&dir)
            .get_skill(&args(&[("name", "alphaskill")]))
            .unwrap();
        let body = json_content(&result);
        assert_eq!(body["name"], "AlphaSkill");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_unknown_name_is_invalid_params_not_internal_error() {
        // Distinguishable empty vs. error: an unknown skill is a
        // client-input problem (`InvalidParams`), never conflated with
        // an index/I-O failure (`InternalError`).
        let dir = temp_dir("get-skill-unknown");
        write_skill(&dir, "alpha", "first", &[]);
        let err = server(&dir)
            .get_skill(&args(&[("name", "does-not-exist")]))
            .unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("skill not found: does-not-exist"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_unreadable_file_is_internal_error_not_invalid_params() {
        // The index still has the entry (it's a startup snapshot); the
        // body read fails because the file vanished after indexing —
        // that's an I/O failure, not a bad client parameter.
        let dir = temp_dir("get-skill-unreadable");
        write_skill(&dir, "alpha", "first", &[]);
        let srv = server(&dir);
        fs::remove_file(dir.join("alpha").join("SKILL.md")).unwrap();
        let err = srv.get_skill(&args(&[("name", "alpha")])).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INTERNAL_ERROR);
        assert!(err.message.contains("skill file unreadable: alpha"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_size_bytes_reflects_the_fresh_body_not_the_index_snapshot() {
        // f-ddab20aa: the index's size_bytes is a startup snapshot. If the
        // file changes on disk after indexing but before a reload, the
        // response must size the body it just read, not the stale entry.
        let dir = temp_dir("get-skill-size-bytes-fresh");
        write_skill(&dir, "alpha", "first", &[]);
        let srv = server(&dir);
        let indexed_size = srv.index.get("alpha").unwrap().size_bytes;

        let skill_path = dir.join("alpha").join("SKILL.md");
        fs::write(&skill_path, "---\nname: alpha\ndescription: first\n---\n\nA much longer body than before, to force a different byte length.\n").unwrap();
        let fresh_size = fs::metadata(&skill_path).unwrap().len();
        assert_ne!(
            fresh_size, indexed_size,
            "mutation must change the byte length or this test proves nothing"
        );

        let result = srv.get_skill(&args(&[("name", "alpha")])).unwrap();
        let body = json_content(&result);
        assert_eq!(
            body["size_bytes"].as_u64().unwrap(),
            fresh_size,
            "size_bytes must match the freshly-read body"
        );
        assert_ne!(
            body["size_bytes"].as_u64().unwrap(),
            indexed_size,
            "size_bytes must not equal the stale indexed size"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reload_skills_picks_up_a_newly_added_skill_and_reports_it() {
        let dir = temp_dir("reload-picks-up-new");
        write_skill(&dir, "existing", "d", &[]);
        let srv = server(&dir);
        write_skill(&dir, "new-arrival", "d", &[]);
        let result = srv.reload_skills(&serde_json::Map::new()).unwrap();
        let body = json_content(&result);
        assert_eq!(body["indexed"], 2);
        assert_eq!(body["skills_dirs"].as_array().unwrap().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    // ── FIX 1: get_skill size ceiling ────────────────────────────────

    /// Writes a skill whose body is at least `min_len` bytes long, so
    /// tests don't have to actually allocate megabytes of literal source
    /// to exercise the size ceiling.
    fn write_oversized_skill(dir: &Path, name: &str, min_len: usize) {
        let skill_dir = dir.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        let padding = "x".repeat(min_len);
        fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: d\n---\n\n{padding}\n"),
        )
        .unwrap();
    }

    #[test]
    fn get_skill_reports_not_found_for_a_file_oversized_at_scan_time() {
        // Layer boundary: a SKILL.md already oversized when `server()`
        // scans the directory is skipped by the scan-time cap
        // (frontmatter::parse_frontmatter's stat check) and so never
        // enters the index at all. `get_skill` therefore reports
        // "not found", never "too large" — the handler-time cap
        // (MAX_SKILL_BODY_BYTES, the same shared constant) only ever
        // fires for a file that grows or is swapped *after* indexing
        // (see get_skill_oversized_body_is_rejected_before_reading and
        // get_skill_grew_after_scan_rejection_comes_from_stat_not_post_read).
        let dir = temp_dir("get-skill-oversized-at-scan-time");
        write_oversized_skill(&dir, "huge", (MAX_SKILL_BODY_BYTES as usize) + 1);
        let srv = server(&dir);
        assert!(
            srv.index.get("huge").is_none(),
            "an oversized-at-scan-time file must never be indexed"
        );

        let err = srv.get_skill(&args(&[("name", "huge")])).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(
            err.message.contains("skill not found: huge"),
            "got: {}",
            err.message
        );
        assert!(
            !err.message.contains("too large"),
            "a never-indexed file must not surface as the too-large error: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_oversized_body_is_rejected_before_reading() {
        // Oversized-at-scan-time is unreachable here: the scan-time cap
        // (frontmatter::MAX_SKILL_FILE_BYTES, the same constant this
        // handler-time guard now shares) already keeps such a file out
        // of the index, so `get_skill` would report "not found", not
        // "too large" — see the scan-time-skip test below. The only
        // reachable too-large path is a file that grows past the limit
        // *after* it was indexed small, which must still be rejected
        // as InvalidParams (not read into memory and returned).
        let dir = temp_dir("get-skill-oversized-pre-read");
        write_skill(&dir, "huge", "d", &[]);
        let srv = server(&dir);
        let padding = "x".repeat((MAX_SKILL_BODY_BYTES as usize) + 1);
        fs::write(
            dir.join("huge").join("SKILL.md"),
            format!("---\nname: huge\ndescription: d\n---\n\n{padding}\n"),
        )
        .unwrap();

        let err = srv.get_skill(&args(&[("name", "huge")])).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("too large"), "got: {}", err.message);
        assert!(err.message.contains("huge"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_oversized_body_error_is_distinct_from_not_found_and_unreadable() {
        let dir = temp_dir("get-skill-oversized-distinct");
        write_skill(&dir, "huge", "d", &[]);
        let srv = server(&dir);
        let padding = "x".repeat((MAX_SKILL_BODY_BYTES as usize) + 1);
        fs::write(
            dir.join("huge").join("SKILL.md"),
            format!("---\nname: huge\ndescription: d\n---\n\n{padding}\n"),
        )
        .unwrap();

        let too_large = srv.get_skill(&args(&[("name", "huge")])).unwrap_err();
        let not_found = srv
            .get_skill(&args(&[("name", "does-not-exist")]))
            .unwrap_err();
        assert_ne!(
            too_large.message, not_found.message,
            "too-large and not-found must be distinguishable"
        );
        assert!(too_large
            .message
            .contains(&MAX_SKILL_BODY_BYTES.to_string()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_body_grown_after_scan_is_rejected_without_reading_the_body() {
        // The file was small enough to index, but has since grown past
        // the limit on disk. With the fix, this is caught by the fresh
        // `stat` — the body is never read into memory at all. Asserting
        // the "stat size" stage marker is what proves prevention rather
        // than post-hoc reporting (see the discriminating test below for
        // the full before/after proof).
        let dir = temp_dir("get-skill-grew-after-scan");
        write_skill(&dir, "grows", "first", &[]);
        let srv = server(&dir);
        let indexed_size = srv.index.get("grows").unwrap().size_bytes;
        assert!(
            indexed_size <= MAX_SKILL_BODY_BYTES,
            "must start under the limit"
        );

        let padding = "x".repeat((MAX_SKILL_BODY_BYTES as usize) + 1);
        fs::write(
            dir.join("grows").join("SKILL.md"),
            format!("---\nname: grows\ndescription: first\n---\n\n{padding}\n"),
        )
        .unwrap();

        let err = srv.get_skill(&args(&[("name", "grows")])).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("too large"), "got: {}", err.message);
        assert!(
            err.message.contains("stat size"),
            "grew-after-scan must be caught by the stat guard, not the post-read guard: got: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_grew_after_scan_rejection_comes_from_stat_not_post_read() {
        // Discriminating test: proves rejection happens BEFORE the full
        // read, not after. A file that only exceeds the limit on-disk
        // (never indexed at the large size) must be flagged by the
        // "stat size" stage. If the stat guard were absent or broken,
        // this would instead surface as "post-read size" (or succeed),
        // which is exactly what the PROOF step below demonstrates by
        // temporarily removing the stat check.
        let dir = temp_dir("get-skill-stat-vs-post-read");
        write_skill(&dir, "grows2", "first", &[]);
        let srv = server(&dir);

        let padding = "x".repeat((MAX_SKILL_BODY_BYTES as usize) + 1);
        fs::write(
            dir.join("grows2").join("SKILL.md"),
            format!("---\nname: grows2\ndescription: first\n---\n\n{padding}\n"),
        )
        .unwrap();

        let err = srv.get_skill(&args(&[("name", "grows2")])).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(
            err.message.contains("stat size"),
            "expected rejection via the stat stage (prevention), got: {}",
            err.message
        );
        assert!(
            !err.message.contains("post-read size"),
            "must not have fallen through to the post-read stage: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_body_within_limit_still_succeeds() {
        // Sanity check the ceiling doesn't reject ordinary bodies.
        let dir = temp_dir("get-skill-within-limit");
        write_skill(&dir, "small", "first", &[]);
        let result = server(&dir).get_skill(&args(&[("name", "small")])).unwrap();
        let body = json_content(&result);
        assert_eq!(body["name"], "small");
        let _ = fs::remove_dir_all(&dir);
    }

    // ── FIX 2: additionalProperties enforcement ──────────────────────

    #[test]
    fn find_skills_rejects_unknown_argument_key() {
        let dir = temp_dir("find-skills-unknown-key");
        write_skill(&dir, "alpha", "first", &[]);
        let mut bad_args = serde_json::Map::new();
        bad_args.insert("__proto__".to_string(), serde_json::json!("x"));
        let err = server(&dir).find_skills(&bad_args).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("__proto__"), "got: {}", err.message);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_rejects_unknown_argument_key() {
        let dir = temp_dir("get-skill-unknown-key");
        write_skill(&dir, "alpha", "first", &[]);
        let mut bad_args = args(&[("name", "alpha")]);
        bad_args.insert("__proto__".to_string(), serde_json::json!("x"));
        let err = server(&dir).get_skill(&bad_args).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("__proto__"), "got: {}", err.message);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reload_skills_rejects_unknown_argument_key() {
        let dir = temp_dir("reload-skills-unknown-key");
        write_skill(&dir, "alpha", "first", &[]);
        let mut bad_args = serde_json::Map::new();
        bad_args.insert("__proto__".to_string(), serde_json::json!("x"));
        let err = server(&dir).reload_skills(&bad_args).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("__proto__"), "got: {}", err.message);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_names_every_offending_unknown_key() {
        let dir = temp_dir("find-skills-multiple-unknown-keys");
        write_skill(&dir, "alpha", "first", &[]);
        let mut bad_args = serde_json::Map::new();
        bad_args.insert("bogus_one".to_string(), serde_json::json!("x"));
        bad_args.insert("bogus_two".to_string(), serde_json::json!("y"));
        let err = server(&dir).find_skills(&bad_args).unwrap_err();
        assert!(err.message.contains("bogus_one"), "got: {}", err.message);
        assert!(err.message.contains("bogus_two"), "got: {}", err.message);
        let _ = fs::remove_dir_all(&dir);
    }

    // ── FIX 3: wrong-typed input vs. missing input ───────────────────

    #[test]
    fn get_skill_wrong_typed_name_is_distinct_from_missing_name() {
        let dir = temp_dir("get-skill-wrong-type-name");
        write_skill(&dir, "alpha", "first", &[]);
        let srv = server(&dir);

        let mut wrong_type_args = serde_json::Map::new();
        wrong_type_args.insert("name".to_string(), serde_json::json!(["alpha", "beta"]));
        let wrong_type_err = srv.get_skill(&wrong_type_args).unwrap_err();

        let missing_err = srv.get_skill(&serde_json::Map::new()).unwrap_err();

        assert_eq!(wrong_type_err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert_eq!(missing_err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert_ne!(
            wrong_type_err.message, missing_err.message,
            "wrong-type and missing must be distinguishable"
        );
        assert!(
            wrong_type_err.message.contains("array"),
            "wrong-type message must name the actual JSON type, got: {}",
            wrong_type_err.message
        );
        assert!(
            missing_err.message.contains("missing"),
            "got: {}",
            missing_err.message
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_genuinely_absent_name_still_says_missing() {
        let dir = temp_dir("get-skill-absent-name");
        write_skill(&dir, "alpha", "first", &[]);
        let err = server(&dir).get_skill(&serde_json::Map::new()).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("missing required parameter: name"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_skill_null_name_is_wrong_type_not_missing() {
        // `null` is present-but-not-a-string, same bucket as an array or
        // number — distinct from the key being genuinely absent.
        let dir = temp_dir("get-skill-null-name");
        write_skill(&dir, "alpha", "first", &[]);
        let mut null_args = serde_json::Map::new();
        null_args.insert("name".to_string(), serde_json::Value::Null);
        let err = server(&dir).get_skill(&null_args).unwrap_err();
        assert!(err.message.contains("null"), "got: {}", err.message);
        assert!(!err.message.contains("missing"), "got: {}", err.message);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_wrong_typed_keyword_reports_actual_type() {
        let dir = temp_dir("find-skills-wrong-type-keyword");
        write_skill(&dir, "alpha", "first", &[]);
        let mut wrong_type_args = serde_json::Map::new();
        wrong_type_args.insert("keyword".to_string(), serde_json::json!(42));
        let err = server(&dir).find_skills(&wrong_type_args).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("keyword"), "got: {}", err.message);
        assert!(err.message.contains("number"), "got: {}", err.message);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_wrong_typed_tag_reports_actual_type() {
        let dir = temp_dir("find-skills-wrong-type-tag");
        write_skill(&dir, "alpha", "first", &[]);
        let mut wrong_type_args = serde_json::Map::new();
        wrong_type_args.insert("tag".to_string(), serde_json::json!(true));
        let err = server(&dir).find_skills(&wrong_type_args).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("tag"), "got: {}", err.message);
        assert!(err.message.contains("boolean"), "got: {}", err.message);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_skills_wrong_typed_name_reports_actual_type() {
        let dir = temp_dir("find-skills-wrong-type-name");
        write_skill(&dir, "alpha", "first", &[]);
        let mut wrong_type_args = serde_json::Map::new();
        wrong_type_args.insert("name".to_string(), serde_json::json!({"a": 1}));
        let err = server(&dir).find_skills(&wrong_type_args).unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("name"), "got: {}", err.message);
        assert!(err.message.contains("object"), "got: {}", err.message);
        let _ = fs::remove_dir_all(&dir);
    }

    // ── prompts: list_prompts / get_prompt ───────────────────────────

    #[test]
    fn list_prompts_advertises_every_indexed_sop_by_name_only() {
        let skills = temp_dir("prompts-list-skills");
        let sop_dir = temp_dir("prompts-list-sops");
        write_sop(&sop_dir, "reload-skills", "Reload body.");
        write_sop(&sop_dir, "adversarial-cr-review", "Review body.");

        let result = server_with_sops(&skills, &sop_dir).list_prompt_records();
        let names: Vec<&str> = result.prompts.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["adversarial-cr-review", "reload-skills"]);
        // Name only — no description, no arguments, per the tool contract.
        for prompt in &result.prompts {
            assert!(prompt.description.is_none(), "got: {prompt:?}");
            assert!(prompt.arguments.is_none(), "got: {prompt:?}");
        }
        assert!(result.next_cursor.is_none());
        let _ = fs::remove_dir_all(&skills);
        let _ = fs::remove_dir_all(&sop_dir);
    }

    #[test]
    fn list_prompts_with_no_sops_is_empty_not_an_error() {
        let skills = temp_dir("prompts-list-empty-skills");
        let sop_dir = temp_dir("prompts-list-empty-sops");
        let result = server_with_sops(&skills, &sop_dir).list_prompt_records();
        assert!(result.prompts.is_empty());
        let _ = fs::remove_dir_all(&skills);
        let _ = fs::remove_dir_all(&sop_dir);
    }

    #[test]
    fn get_prompt_returns_the_full_body_as_a_user_message() {
        let skills = temp_dir("prompts-get-skills");
        let sop_dir = temp_dir("prompts-get-sops");
        write_sop(&sop_dir, "reload-skills", "The reload SOP body.\n");

        let result = server_with_sops(&skills, &sop_dir)
            .get_prompt_by_name("reload-skills")
            .unwrap();
        assert!(result.description.is_none());
        assert_eq!(result.messages.len(), 1);
        assert_eq!(result.messages[0].role, Role::User);
        match &result.messages[0].content {
            ContentBlock::Text(text_content) => {
                assert_eq!(text_content.text, "The reload SOP body.\n");
            }
            other => panic!("expected text content, got: {other:?}"),
        }
        let _ = fs::remove_dir_all(&skills);
        let _ = fs::remove_dir_all(&sop_dir);
    }

    #[test]
    fn get_prompt_lookup_is_case_insensitive() {
        let skills = temp_dir("prompts-get-case-skills");
        let sop_dir = temp_dir("prompts-get-case-sops");
        write_sop(&sop_dir, "Reload-Skills", "body");

        let result = server_with_sops(&skills, &sop_dir)
            .get_prompt_by_name("reload-skills")
            .unwrap();
        assert_eq!(result.messages.len(), 1);
        let _ = fs::remove_dir_all(&skills);
        let _ = fs::remove_dir_all(&sop_dir);
    }

    #[test]
    fn get_prompt_unknown_name_is_invalid_params_not_internal_error() {
        let skills = temp_dir("prompts-get-unknown-skills");
        let sop_dir = temp_dir("prompts-get-unknown-sops");
        write_sop(&sop_dir, "real", "body");

        let err = server_with_sops(&skills, &sop_dir)
            .get_prompt_by_name("does-not-exist")
            .unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(
            err.message.contains("prompt not found: does-not-exist"),
            "got: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&skills);
        let _ = fs::remove_dir_all(&sop_dir);
    }

    #[test]
    fn get_prompt_unreadable_file_is_internal_error_not_invalid_params() {
        // The index still has the entry (a startup snapshot); the body
        // read fails because the file vanished after indexing — an I/O
        // failure, not a bad client parameter. Mirrors get_skill.
        let skills = temp_dir("prompts-get-unreadable-skills");
        let sop_dir = temp_dir("prompts-get-unreadable-sops");
        write_sop(&sop_dir, "gone", "body");
        let srv = server_with_sops(&skills, &sop_dir);
        fs::remove_file(sop_dir.join("gone.sop.md")).unwrap();

        let err = srv.get_prompt_by_name("gone").unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INTERNAL_ERROR);
        assert!(
            err.message.contains("SOP file unreadable: gone"),
            "got: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&skills);
        let _ = fs::remove_dir_all(&sop_dir);
    }

    #[test]
    fn get_prompt_body_grown_after_scan_is_rejected_by_the_stat_guard() {
        // The file was small enough to index, but has since grown past
        // the limit on disk. Caught by the fresh `stat` before the body
        // is read — the "stat size" stage marker proves prevention, not
        // post-hoc reporting. Mirrors get_skill's grew-after-scan guard.
        let skills = temp_dir("prompts-get-grew-skills");
        let sop_dir = temp_dir("prompts-get-grew-sops");
        write_sop(&sop_dir, "grows", "small body");
        let srv = server_with_sops(&skills, &sop_dir);

        let padding = "x".repeat((MAX_SKILL_BODY_BYTES as usize) + 1);
        fs::write(sop_dir.join("grows.sop.md"), padding).unwrap();

        let err = srv.get_prompt_by_name("grows").unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(err.message.contains("too large"), "got: {}", err.message);
        assert!(
            err.message.contains("stat size"),
            "grew-after-scan must be caught by the stat guard, not the post-read guard: {}",
            err.message
        );
        assert!(
            !err.message.contains("post-read size"),
            "must not fall through to the post-read stage: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&skills);
        let _ = fs::remove_dir_all(&sop_dir);
    }

    #[test]
    fn get_prompt_body_within_limit_still_succeeds() {
        let skills = temp_dir("prompts-get-within-skills");
        let sop_dir = temp_dir("prompts-get-within-sops");
        write_sop(&sop_dir, "small", "an ordinary SOP body");
        let result = server_with_sops(&skills, &sop_dir)
            .get_prompt_by_name("small")
            .unwrap();
        assert_eq!(result.messages.len(), 1);
        let _ = fs::remove_dir_all(&skills);
        let _ = fs::remove_dir_all(&sop_dir);
    }

    #[cfg(unix)]
    #[test]
    fn get_prompt_rejects_a_symlink_swapped_in_after_scan() {
        // The SOP index has no reload, so `get_prompt` re-checks
        // containment on every call. Index a real in-root SOP, then
        // replace it on disk with a symlink to an out-of-root secret
        // (the after-scan swap the scan-time check alone can't catch).
        // `get_prompt` must reject it rather than reading the secret.
        let skills = temp_dir("prompts-get-swap-skills");
        let sop_dir = temp_dir("prompts-get-swap-sops");
        let outside = temp_dir("prompts-get-swap-outside");
        let secret = outside.join("secret.txt");
        fs::write(&secret, "SENSITIVE CONTENTS").unwrap();
        write_sop(&sop_dir, "victim", "harmless indexed body");
        let srv = server_with_sops(&skills, &sop_dir);

        // Swap the indexed regular file for a symlink pointing outside
        // the root, after it was scanned in-root.
        let victim_path = sop_dir.join("victim.sop.md");
        fs::remove_file(&victim_path).unwrap();
        std::os::unix::fs::symlink(&secret, &victim_path).unwrap();

        let err = srv.get_prompt_by_name("victim").unwrap_err();
        assert_eq!(err.code, rmcp::model::ErrorCode::INVALID_PARAMS);
        assert!(
            err.message
                .contains("resolves outside its --agent-sop-paths root"),
            "expected the after-scan escape to be rejected, got: {}",
            err.message
        );
        let _ = fs::remove_dir_all(&skills);
        let _ = fs::remove_dir_all(&sop_dir);
        let _ = fs::remove_dir_all(&outside);
    }
}

/// Tests for `record_tool_call`'s counter-key derivation end to end
/// through real `call_tool` invocations.
#[cfg(test)]
mod telemetry_counters {
    use super::*;
    use skill_lookup_core::model::ResolvedDir;
    use skill_lookup_core::telemetry::ToolCallCounters;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skill-lookup-telemetry-counters-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn server_with_counters(dir: &Path) -> (SkillLookupServer, ToolCallCounters) {
        let (index, _diag, _filtered, _excluded) =
            SkillIndex::build(vec![ResolvedDir::managed(dir)], None);
        let counters: ToolCallCounters = Arc::new(Mutex::new(HashMap::new()));
        (
            SkillLookupServer {
                index,
                sops: SopIndex::default(),
                tool_call_counters: Some(counters.clone()),
                initialized: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            },
            counters,
        )
    }

    fn snapshot(
        counters: &ToolCallCounters,
    ) -> HashMap<(String, Option<String>, Option<&'static str>), u64> {
        counters.lock().unwrap().clone()
    }

    fn write_skill(dir: &Path, name: &str) {
        let skill_dir = dir.join(name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: d\n---\n\nBody.\n"),
        )
        .unwrap();
    }

    #[tokio::test]
    async fn concurrent_calls_increment_expected_keys_with_no_lost_updates() {
        let dir = temp_dir("concurrent");
        write_skill(&dir, "demo");
        let (server, counters) = server_with_counters(&dir);

        let mut handles = Vec::new();
        for _ in 0..20 {
            let server = server.clone();
            let counters = counters.clone();
            handles.push(tokio::spawn(async move {
                let result = server.find_skills(&serde_json::Map::new());
                record_tool_call(&counters, "find_skills", &serde_json::Map::new(), &result);
            }));
        }
        for h in handles {
            h.await.unwrap();
        }

        let snap = snapshot(&counters);
        assert_eq!(
            snap.get(&("find_skills".to_string(), None, None)),
            Some(&20)
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn successful_call_increments_success_key_never_error_key() {
        let dir = temp_dir("success-key");
        let (server, counters) = server_with_counters(&dir);
        let result = server.find_skills(&serde_json::Map::new());
        assert!(result.is_ok());
        record_tool_call(&counters, "find_skills", &serde_json::Map::new(), &result);

        let snap = snapshot(&counters);
        assert_eq!(snap.get(&("find_skills".to_string(), None, None)), Some(&1));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn failed_call_increments_key_with_matching_error_code() {
        let dir = temp_dir("error-key");
        let (server, counters) = server_with_counters(&dir);
        let mut args = serde_json::Map::new();
        args.insert("bogus_key".to_string(), serde_json::json!("x"));
        let result = server.find_skills(&args);
        assert!(result.is_err());
        record_tool_call(&counters, "find_skills", &args, &result);

        let snap = snapshot(&counters);
        assert_eq!(
            snap.get(&("find_skills".to_string(), None, Some("mcp.invalid_params"))),
            Some(&1),
            "a rejected call must never increment the success key"
        );
        assert!(
            !snap.contains_key(&("find_skills".to_string(), None, None)),
            "a rejected call must never increment the success key"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn repeated_unrecognized_tool_names_collapse_onto_one_key() {
        let dir = temp_dir("unknown-tool");
        let (_server, counters) = server_with_counters(&dir);
        for name in ["totally_bogus_1", "totally_bogus_2", "another_fake_tool"] {
            let result: Result<CallToolResult, McpError> = Err(McpErrorData::invalid_params(
                format!("unknown tool: {name}"),
                None,
            ));
            record_tool_call(&counters, name, &serde_json::Map::new(), &result);
        }

        let snap = snapshot(&counters);
        assert_eq!(snap.len(), 1, "must collapse onto exactly one key");
        assert_eq!(
            snap.get(&(
                skill_lookup_core::telemetry::UNKNOWN_SENTINEL.to_string(),
                None,
                Some("mcp.unknown_tool")
            )),
            Some(&3)
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn repeated_unrecognized_skill_names_collapse_onto_one_key() {
        let dir = temp_dir("unknown-skill");
        let (server, counters) = server_with_counters(&dir);
        for name in ["not-a-real-skill", "also-fake", "still-fake"] {
            let mut args = serde_json::Map::new();
            args.insert("name".to_string(), serde_json::json!(name));
            let result = server.get_skill(&args);
            assert!(result.is_err());
            record_tool_call(&counters, "get_skill", &args, &result);
        }

        let snap = snapshot(&counters);
        assert_eq!(snap.len(), 1, "must collapse onto exactly one key");
        assert_eq!(
            snap.get(&(
                "get_skill".to_string(),
                Some(skill_lookup_core::telemetry::UNKNOWN_SENTINEL.to_string()),
                Some("mcp.unknown_skill")
            )),
            Some(&3)
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolved_skill_name_is_transmitted_verbatim_in_the_counter_key() {
        let dir = temp_dir("resolved-skill");
        write_skill(&dir, "demo");
        let (server, counters) = server_with_counters(&dir);
        let mut args = serde_json::Map::new();
        args.insert("name".to_string(), serde_json::json!("demo"));
        let result = server.get_skill(&args);
        assert!(result.is_ok());
        record_tool_call(&counters, "get_skill", &args, &result);

        let snap = snapshot(&counters);
        assert_eq!(
            snap.get(&("get_skill".to_string(), Some("demo".to_string()), None)),
            Some(&1)
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn argument_validation_failure_before_lookup_uses_sentinel_not_raw_name() {
        // `reject_unknown_keys` can fail before `get_skill` ever calls
        // `self.index.get(name)` -- e.g. an unknown extra key alongside
        // a well-formed `name`. The caller-supplied name is therefore
        // never resolved/known here, so it must not reach the counter
        // key verbatim the way a genuinely resolved name does (see
        // `resolved_skill_name_is_transmitted_verbatim_in_the_counter_key`
        // above).
        let dir = temp_dir("pre-lookup-validation-failure");
        let (server, counters) = server_with_counters(&dir);
        let mut args = serde_json::Map::new();
        args.insert(
            "name".to_string(),
            serde_json::json!("some-caller-supplied-value"),
        );
        args.insert("bogus_key".to_string(), serde_json::json!("x"));
        let result = server.get_skill(&args);
        assert!(result.is_err());
        record_tool_call(&counters, "get_skill", &args, &result);

        let snap = snapshot(&counters);
        assert_eq!(
            snap.get(&(
                "get_skill".to_string(),
                Some(skill_lookup_core::telemetry::UNKNOWN_SENTINEL.to_string()),
                Some("mcp.invalid_params")
            )),
            Some(&1),
            "an argument-validation failure before the index lookup runs must use the sentinel"
        );
        assert!(
            !snap.contains_key(&(
                "get_skill".to_string(),
                Some("some-caller-supplied-value".to_string()),
                Some("mcp.invalid_params")
            )),
            "the raw caller-supplied name must never reach the counter key for an unresolved lookup"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// FINDING regression: a resolved-but-failed `get_skill` error (the
    /// file vanished after `self.index.get(name)` already succeeded)
    /// must record the REAL skill name, not the unresolved-name
    /// sentinel -- the lookup already confirmed this name exists, so
    /// collapsing it onto the sentinel discards which skill has the
    /// problem for no cardinality-bounding reason (unlike the
    /// genuinely-unresolved cases above, where the caller-supplied name
    /// is attacker-arbitrary).
    #[test]
    fn unreadable_file_failure_after_resolved_lookup_uses_real_name_not_sentinel() {
        let dir = temp_dir("unreadable-after-resolved");
        write_skill(&dir, "demo");
        let (server, counters) = server_with_counters(&dir);
        std::fs::remove_file(dir.join("demo").join("SKILL.md")).unwrap();

        let mut args = serde_json::Map::new();
        args.insert("name".to_string(), serde_json::json!("demo"));
        let result = server.get_skill(&args);
        assert!(result.is_err());
        record_tool_call(&counters, "get_skill", &args, &result);

        let snap = snapshot(&counters);
        assert_eq!(
            snap.get(&(
                "get_skill".to_string(),
                Some("demo".to_string()),
                Some("mcp.internal_error")
            )),
            Some(&1),
            "a resolved-but-unreadable name must be recorded verbatim, not as the sentinel"
        );
        assert!(
            !snap.contains_key(&(
                "get_skill".to_string(),
                Some(skill_lookup_core::telemetry::UNKNOWN_SENTINEL.to_string()),
                Some("mcp.internal_error")
            )),
            "must never fall back to the sentinel once the lookup itself already resolved \
             the name"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Same fix, the other resolved-but-failed shape: a body that grew
    /// past `MAX_SKILL_BODY_BYTES` after indexing. The name was
    /// resolved by `self.index.get(name)` before either size guard
    /// ever ran, so it must be recorded verbatim here too.
    #[test]
    fn oversized_body_failure_after_resolved_lookup_uses_real_name_not_sentinel() {
        let dir = temp_dir("oversized-after-resolved");
        write_skill(&dir, "demo");
        let (server, counters) = server_with_counters(&dir);
        let padding = "x".repeat((MAX_SKILL_BODY_BYTES as usize) + 1);
        std::fs::write(
            dir.join("demo").join("SKILL.md"),
            format!("---\nname: demo\ndescription: d\n---\n\n{padding}\n"),
        )
        .unwrap();

        let mut args = serde_json::Map::new();
        args.insert("name".to_string(), serde_json::json!("demo"));
        let result = server.get_skill(&args);
        assert!(result.is_err());
        record_tool_call(&counters, "get_skill", &args, &result);

        let snap = snapshot(&counters);
        assert_eq!(
            snap.get(&(
                "get_skill".to_string(),
                Some("demo".to_string()),
                Some("mcp.invalid_params")
            )),
            Some(&1),
            "a resolved-but-oversized name must be recorded verbatim, not as the sentinel"
        );
        assert!(
            !snap.contains_key(&(
                "get_skill".to_string(),
                Some(skill_lookup_core::telemetry::UNKNOWN_SENTINEL.to_string()),
                Some("mcp.invalid_params")
            )),
            "must never fall back to the sentinel once the lookup itself already resolved \
             the name"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn telemetry_off_leaves_tool_call_counters_none() {
        let dir = temp_dir("telemetry-off");
        let (index, _diag, _filtered, _excluded) =
            SkillIndex::build(vec![ResolvedDir::managed(&dir)], None);
        let server = SkillLookupServer {
            index,
            sops: SopIndex::default(),
            tool_call_counters: None,
            initialized: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        };
        assert!(server.tool_call_counters.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// FINDING regression: `mcp_error_code` must classify by
    /// `err.code` (the stable `ErrorCode` field every `McpErrorData`
    /// constructor sets), not by re-parsing `err.message`. Construct
    /// `McpError`s with deliberately reworded messages -- text that
    /// shares none of the substrings a message-scrubbing
    /// classification would have keyed on -- and confirm the
    /// classification still holds because it never looked at the
    /// message at all.
    #[test]
    fn mcp_error_code_classification_survives_a_reworded_message() {
        let reworded_invalid_params = McpErrorData::invalid_params(
            "this wording shares no keywords with any prior message",
            None,
        );
        assert_eq!(
            mcp_error_code(&reworded_invalid_params),
            "mcp.invalid_params"
        );

        let reworded_internal_error = McpErrorData::internal_error(
            "this wording shares no keywords with any prior message either",
            None,
        );
        assert_eq!(
            mcp_error_code(&reworded_internal_error),
            "mcp.internal_error"
        );
    }
}
