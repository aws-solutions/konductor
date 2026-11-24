// SPDX-License-Identifier: Apache-2.0
//
// metrics/collect.rs — per-harness session-file parsers producing one
// `Record` per file. Read-only against harness files; anything that
// can't be read as the expected shape becomes `Status::Unparsed`.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::cli::time::parse_iso_secs;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Harness {
    Claude,
    KiroCliV2,
    KiroV3,
}

impl Harness {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Harness::Claude => "claude",
            Harness::KiroCliV2 => "kiro-cli-v2",
            Harness::KiroV3 => "kiro-v3",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Status {
    Ok,
    Unparsed,
}

/// Token fields are `None` when the harness doesn't record them (Kiro),
/// never 0, so averages aren't dragged down by missing data.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct ModelUsage {
    pub model: String,
    /// Harness-native count, never comparable across harnesses: API
    /// requests (deduplicated assistant messages) for Claude Code,
    /// `total_request_count` for Kiro CLI v2, prompt turns for Kiro v3.
    pub requests: u64,
    pub input_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub thinking_tokens: Option<u64>,
    pub web_search_requests: Option<u64>,
    pub credits: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Record {
    pub path: String,
    pub mtime: u64,
    pub size: u64,
    pub harness: Harness,
    pub session_id: String,
    pub parent_session_id: Option<String>,
    pub agent: Option<String>,
    pub repo: Option<String>,
    pub first_ts: Option<i64>,
    pub last_ts: Option<i64>,
    pub harness_version: Option<String>,
    pub status: Status,
    pub subagent_runs: Option<u64>,
    pub models: Vec<ModelUsage>,
    /// The Konductor agent `agent` resolved to when the file was parsed
    /// (plugin `<plugin>:<agent>` names resolve to the bare agent). `None`
    /// means not Konductor: the record is kept without usage so the file
    /// isn't re-parsed every run.
    #[serde(default)]
    pub konductor_agent: Option<String>,
    /// `PARSER_VERSION` that produced the record; an older one is re-parsed
    /// while its source file still exists.
    #[serde(default)]
    pub parser_version: u32,
}

/// Bump whenever a collector change should re-read files already cached.
pub(crate) const PARSER_VERSION: u32 = 1;

impl Record {
    fn new(harness: Harness, path: &Path, mtime: u64, size: u64, session_id: String) -> Self {
        Record {
            path: path.to_string_lossy().into_owned(),
            mtime,
            size,
            harness,
            session_id,
            parent_session_id: None,
            agent: None,
            repo: None,
            first_ts: None,
            last_ts: None,
            harness_version: None,
            status: Status::Ok,
            subagent_runs: None,
            models: Vec::new(),
            konductor_agent: None,
            parser_version: PARSER_VERSION,
        }
    }

    /// Keeps only what's needed to skip re-parsing an unchanged file (and
    /// to count it as unparsed). Nothing about a non-Konductor session —
    /// its repo, ids, or timing — is stored.
    pub(crate) fn into_stub(self) -> Self {
        Record {
            path: self.path,
            mtime: self.mtime,
            size: self.size,
            harness: self.harness,
            session_id: String::new(),
            parent_session_id: None,
            agent: self.agent,
            repo: None,
            first_ts: None,
            last_ts: None,
            harness_version: None,
            status: self.status,
            subagent_runs: None,
            models: Vec::new(),
            konductor_agent: None,
            parser_version: self.parser_version,
        }
    }

    fn unparsed(mut self) -> Self {
        self.status = Status::Unparsed;
        self.models.clear();
        self
    }

    fn touch_ts(&mut self, ts: Option<i64>) {
        let Some(ts) = ts else { return };
        self.first_ts = Some(self.first_ts.map_or(ts, |t| t.min(ts)));
        self.last_ts = Some(self.last_ts.map_or(ts, |t| t.max(ts)));
    }
}

/// Drops the cloud-provider prefix (`global.anthropic.`, `us.anthropic.`)
/// and the `[1m]` context suffix so one model groups as one row.
pub(crate) fn normalize_model(raw: &str) -> String {
    let base = raw.rsplit_once("anthropic.").map_or(raw, |(_, rest)| rest);
    base.trim_end_matches("[1m]").to_string()
}

/// Reads a string field straight out of a JSONL line without parsing
/// the whole line; transcript lines can carry megabytes of tool output.
///
/// Tolerates whitespace around `:`, since a serialization change must not
/// silently drop fields, and decodes JSON escapes in the value. A `"key"`
/// preceded by a backslash is inside another string, so it's skipped.
fn str_field(line: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let mut from = 0;
    while let Some(pos) = line[from..].find(&needle) {
        let at = from + pos;
        from = at + needle.len();
        if at > 0 && line.as_bytes()[at - 1] == b'\\' {
            continue;
        }
        let Some(value) = line[from..].trim_start().strip_prefix(':') else {
            continue;
        };
        let value = value.trim_start();
        if !value.starts_with('"') {
            continue;
        }
        let mut escaped = false;
        for (i, c) in value.char_indices().skip(1) {
            match c {
                '\\' if !escaped => escaped = true,
                '"' if !escaped => return serde_json::from_str(&value[..=i]).ok(),
                _ => escaped = false,
            }
        }
        return None;
    }
    None
}

// ── Claude Code ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ClaudeLine {
    message: Option<ClaudeMessage>,
}

/// Only the top-level record type, so a non-assistant record whose fields
/// happen to have other shapes is never parsed as one.
#[derive(Deserialize)]
struct ClaudeLineKind {
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    id: Option<String>,
    model: Option<String>,
    usage: Option<ClaudeUsage>,
}

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
struct ClaudeUsage {
    input_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
    output_tokens: u64,
    output_tokens_details: Option<ClaudeOutputDetails>,
    server_tool_use: Option<ClaudeServerToolUse>,
}

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
struct ClaudeOutputDetails {
    thinking_tokens: u64,
}

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
struct ClaudeServerToolUse {
    web_search_requests: u64,
}

#[derive(Deserialize)]
struct ClaudeSubagentMeta {
    #[serde(rename = "agentType")]
    agent_type: Option<String>,
}

/// One Claude Code transcript: a main session
/// (`<proj>/<session>.jsonl`) or a subagent
/// (`<proj>/<session>/subagents/agent-<id>.jsonl`).
pub(crate) fn collect_claude(path: &Path, mtime: u64, size: u64) -> Record {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let subagents_dir = path
        .parent()
        .filter(|p| p.file_name().is_some_and(|n| n == "subagents"));
    let parent_session = subagents_dir
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .map(|n| n.to_string_lossy().into_owned());
    let mut rec = Record::new(Harness::Claude, path, mtime, size, stem);
    rec.parent_session_id = parent_session;

    if subagents_dir.is_some() {
        let meta = path.with_extension("meta.json");
        rec.agent = std::fs::read(&meta)
            .ok()
            .and_then(|b| serde_json::from_slice::<ClaudeSubagentMeta>(&b).ok())
            .and_then(|m| m.agent_type);
    }

    let Ok(file) = File::open(path) else {
        return rec.unparsed();
    };
    // Last write per message id wins: records repeat per content block.
    let mut by_message: HashMap<String, (String, ClaudeUsage)> = HashMap::new();
    for line in BufReader::new(file).lines() {
        // A line we can't read may have carried usage; skipping it would
        // silently undercount the session.
        let Ok(line) = line else {
            return rec.unparsed();
        };
        rec.touch_ts(
            str_field(&line, "timestamp")
                .as_deref()
                .and_then(parse_iso_secs),
        );
        if rec.repo.is_none() {
            rec.repo = str_field(&line, "cwd");
        }
        if rec.harness_version.is_none() {
            rec.harness_version = str_field(&line, "version");
        }
        if rec.parent_session_id.is_none() {
            if let Some(agent) = str_field(&line, "agentSetting") {
                rec.agent = Some(agent);
            }
        }
        // Cheap, formatting-independent prefilter; serde checks the shape.
        if !line.contains("\"assistant\"") || !line.contains("\"usage\"") {
            continue;
        }
        match serde_json::from_str::<ClaudeLineKind>(&line) {
            Ok(ClaudeLineKind { kind }) if kind.as_deref() != Some("assistant") => continue,
            Ok(_) => {}
            // Not even valid JSON, e.g. a truncated assistant line.
            Err(_) => return rec.unparsed(),
        }
        match serde_json::from_str::<ClaudeLine>(&line) {
            Ok(ClaudeLine {
                message:
                    Some(ClaudeMessage {
                        id: Some(id),
                        model: Some(model),
                        usage: Some(usage),
                    }),
            }) => {
                if model != "<synthetic>" {
                    by_message.insert(id, (normalize_model(&model), usage));
                }
            }
            // Usage we can't key by message id and model can't be counted.
            Ok(ClaudeLine {
                message: Some(ClaudeMessage { usage: Some(_), .. }),
            }) => return rec.unparsed(),
            // "usage" appeared elsewhere in the line, not as message usage.
            Ok(_) => {}
            // An assistant line with usage we can't read would silently
            // undercount the session.
            Err(_) => return rec.unparsed(),
        }
    }

    let mut models: HashMap<String, ModelUsage> = HashMap::new();
    for (model, u) in by_message.into_values() {
        let m = models.entry(model.clone()).or_insert_with(|| ModelUsage {
            model,
            input_tokens: Some(0),
            cache_write_tokens: Some(0),
            cache_read_tokens: Some(0),
            output_tokens: Some(0),
            thinking_tokens: Some(0),
            web_search_requests: Some(0),
            ..Default::default()
        });
        m.requests += 1;
        add(&mut m.input_tokens, u.input_tokens);
        add(&mut m.cache_write_tokens, u.cache_creation_input_tokens);
        add(&mut m.cache_read_tokens, u.cache_read_input_tokens);
        add(&mut m.output_tokens, u.output_tokens);
        add(
            &mut m.thinking_tokens,
            u.output_tokens_details.map_or(0, |d| d.thinking_tokens),
        );
        add(
            &mut m.web_search_requests,
            u.server_tool_use.map_or(0, |s| s.web_search_requests),
        );
    }
    let mut models = sorted(models);
    // Claude Code writes placeholder `output_tokens` (single digits per
    // message) into subagent transcripts; unavailable beats undercounted.
    if subagents_dir.is_some() {
        for m in &mut models {
            m.output_tokens = None;
            m.thinking_tokens = None;
        }
    }
    rec.models = models;
    rec
}

fn add(slot: &mut Option<u64>, v: u64) {
    *slot = Some(slot.unwrap_or(0) + v);
}

fn sorted(models: HashMap<String, ModelUsage>) -> Vec<ModelUsage> {
    let mut v: Vec<ModelUsage> = models.into_values().collect();
    v.sort_by(|a, b| a.model.cmp(&b.model));
    v
}

// ── Kiro CLI v2 ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct V2File {
    session_id: Option<String>,
    cwd: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    session_state: Option<V2State>,
}

#[derive(Deserialize)]
struct V2State {
    agent_name: Option<String>,
    conversation_metadata: Option<V2Meta>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct V2Meta {
    user_turn_metadatas: Vec<V2Turn>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct V2Turn {
    model: Option<String>,
    total_request_count: Option<u64>,
    metering_usage: Vec<Metering>,
}

#[derive(Deserialize)]
struct Metering {
    value: f64,
    unit: Option<String>,
}

/// `$KIRO_HOME/sessions/cli/<session>.json`. Child (delegated) sessions
/// are separate files and count on their own `agent_name`.
pub(crate) fn collect_kiro_v2(path: &Path, mtime: u64, size: u64) -> Record {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let rec = Record::new(Harness::KiroCliV2, path, mtime, size, stem);
    let Some(parsed) = File::open(path)
        .ok()
        .and_then(|f| serde_json::from_reader::<_, V2File>(BufReader::new(f)).ok())
    else {
        return rec.unparsed();
    };
    let mut rec = rec;
    if let Some(id) = parsed.session_id {
        rec.session_id = id;
    }
    rec.repo = parsed.cwd;
    rec.touch_ts(parsed.created_at.as_deref().and_then(parse_iso_secs));
    rec.touch_ts(parsed.updated_at.as_deref().and_then(parse_iso_secs));
    let Some(state) = parsed.session_state else {
        return rec;
    };
    rec.agent = state.agent_name;
    let mut models: HashMap<String, ModelUsage> = HashMap::new();
    for turn in state
        .conversation_metadata
        .unwrap_or_default()
        .user_turn_metadatas
    {
        let model = turn.model.unwrap_or_else(|| "unknown".to_string());
        let m = models.entry(model.clone()).or_insert_with(|| ModelUsage {
            model,
            ..Default::default()
        });
        m.requests += turn.total_request_count.unwrap_or(0);
        let credits: f64 = turn
            .metering_usage
            .iter()
            .filter(|u| u.unit.as_deref().is_none_or(|unit| unit == "credit"))
            .map(|u| u.value)
            .sum();
        if !turn.metering_usage.is_empty() {
            m.credits = Some(m.credits.unwrap_or(0.0) + credits);
        }
    }
    rec.models = sorted(models);
    rec
}

// ── Kiro v3 (KAS) ───────────────────────────────────────────────────────

#[derive(Default)]
struct V3SessionJson {
    model_id: Option<String>,
    workspace_path: Option<String>,
    agent_mode: Option<String>,
}

/// `Ok(default)` when `session.json` is absent; `Err` when it exists but
/// isn't a JSON object. Each field is read on its own, so one field
/// changing type loses only that field.
fn read_v3_session_json(path: &Path) -> Result<V3SessionJson, ()> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(V3SessionJson::default()),
        Err(_) => return Err(()),
    };
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| ())?;
    let obj = value.as_object().ok_or(())?;
    let text = |k: &str| obj.get(k).and_then(|v| v.as_str()).map(str::to_string);
    Ok(V3SessionJson {
        model_id: text("modelId"),
        workspace_path: obj
            .get("workspacePaths")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .map(str::to_string),
        agent_mode: text("agentMode"),
    })
}

#[derive(Deserialize)]
struct V3Line {
    timestamp: Option<String>,
    payload: V3Payload,
}

// A flat struct, not a `#[serde(tag = "type")]` enum: tagged enums buffer
// through serde's `Content`, which can't yield an f64 under this crate's
// `arbitrary_precision` serde_json feature.
#[derive(Deserialize)]
struct V3Payload {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "agentType")]
    agent_type: Option<String>,
    #[serde(rename = "promptTurnSummaries", default)]
    prompt_turn_summaries: Vec<V3TurnSummary>,
}

#[derive(Deserialize)]
struct V3TurnSummary {
    usage: f64,
    unit: Option<String>,
}

/// `$KIRO_HOME/sessions/<ws-hash>/<session>/messages.jsonl` plus its
/// sibling `session.json`. Subagents aren't saved separately, so only
/// their run count is recorded.
pub(crate) fn collect_kiro_v3(path: &Path, mtime: u64, size: u64) -> Record {
    let dir = path.parent().unwrap_or(path);
    let session_id = dir
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut rec = Record::new(Harness::KiroV3, path, mtime, size, session_id);
    let Ok(session) = read_v3_session_json(&dir.join("session.json")) else {
        return rec.unparsed();
    };
    rec.repo = session.workspace_path;
    // session.json's schemaVersion is "1.0.0" in every session seen, and KAS
    // writes no app version per session, so there's no version to record.
    // Credits are per session, so they go to the session's (last) model.
    let model = session.model_id.unwrap_or_else(|| "unknown".to_string());

    let Ok(file) = File::open(path) else {
        return rec.unparsed();
    };
    let (mut credits, mut saw_usage) = (0.0f64, false);
    let (mut turns, mut subagents) = (0u64, 0u64);
    let mut agent_type = None;
    let (mut parsed, mut failed) = (0u64, 0u64);
    let mut usage_failed = false;
    for line in BufReader::new(file).lines() {
        // An unreadable line may have been a usage_summary.
        let Ok(line) = line else {
            return rec.unparsed();
        };
        rec.touch_ts(
            str_field(&line, "timestamp")
                .as_deref()
                .and_then(parse_iso_secs),
        );
        let interesting = [
            "\"session_start\"",
            "\"usage_summary\"",
            "\"sub_agent_start\"",
            "\"turn_start\"",
        ];
        if !interesting.iter().any(|t| line.contains(t)) {
            continue;
        }
        match serde_json::from_str::<V3Line>(&line) {
            Ok(V3Line { payload, timestamp }) => {
                parsed += 1;
                rec.touch_ts(timestamp.as_deref().and_then(parse_iso_secs));
                match payload.kind.as_str() {
                    "session_start" => agent_type = agent_type.or(payload.agent_type),
                    "usage_summary" => {
                        saw_usage = true;
                        credits += payload
                            .prompt_turn_summaries
                            .iter()
                            .filter(|s| s.unit.as_deref().is_none_or(|u| u == "credit"))
                            .map(|s| s.usage)
                            .sum::<f64>();
                    }
                    "sub_agent_start" => subagents += 1,
                    "turn_start" => turns += 1,
                    _ => {}
                }
            }
            Err(_) => {
                failed += 1;
                usage_failed |= line.contains("\"usage_summary\"");
            }
        }
    }
    // A credit line we can't read would silently undercount the session.
    if usage_failed || (parsed == 0 && failed > 0) {
        return rec.unparsed();
    }
    // KAS often omits session_start.agentType for custom agents and keeps
    // the agent name in session.json agentMode (telemetry_hook.rs relies on
    // the same field). Built-in modes like "vibe" never match an installed
    // Konductor agent, so the fallback can't misattribute.
    rec.agent = agent_type.or(session.agent_mode);
    rec.subagent_runs = Some(subagents);
    rec.models = vec![ModelUsage {
        model,
        requests: turns,
        credits: saw_usage.then_some(credits),
        ..Default::default()
    }];
    rec
}

#[cfg(test)]
pub(crate) mod tests_support {
    use super::*;

    pub(crate) fn record(agent: &str) -> Record {
        let mut r = Record::new(Harness::Claude, Path::new("/x"), 0, 0, "s".to_string());
        r.agent = Some(agent.to_string());
        r.konductor_agent = Some(agent.to_string());
        r
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn write(dir: &Path, rel: &str, body: &str) -> std::path::PathBuf {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::File::create(&p)
            .unwrap()
            .write_all(body.as_bytes())
            .unwrap();
        p
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "konductor-metrics-{name}-{}",
            crate::cli::atomic_write::unique_suffix()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn normalizes_model_ids() {
        assert_eq!(
            normalize_model("global.anthropic.claude-opus-5-5"),
            "claude-opus-5-5"
        );
        assert_eq!(normalize_model("claude-opus-5-5[1m]"), "claude-opus-5-5");
        assert_eq!(normalize_model("claude-sonnet-5-5"), "claude-sonnet-5-5");
    }

    #[test]
    fn claude_dedupes_by_message_id_and_reads_agent() {
        let d = tmp("claude");
        let line = |id: &str, out: u64| {
            format!(
                r#"{{"type":"assistant","timestamp":"2026-11-01T10:00:00Z","cwd":"/repo","version":"2.1.316","message":{{"id":"{id}","model":"claude-opus-5-5[1m]","usage":{{"input_tokens":5,"cache_creation_input_tokens":100,"cache_read_input_tokens":1000,"output_tokens":{out},"output_tokens_details":{{"thinking_tokens":3}}}}}}}}"#
            )
        };
        let body = [
            r#"{"type":"agent-setting","agentSetting":"konductor","sessionId":"s1"}"#.to_string(),
            line("m1", 10),
            line("m1", 20),
            line("m2", 7),
            r#"{"type":"assistant","message":{"id":"m3","model":"<synthetic>","usage":{"output_tokens":9}}}"#.to_string(),
        ]
        .join("\n");
        let p = write(&d, "proj/s1.jsonl", &body);
        let r = collect_claude(&p, 0, 0);
        assert_eq!(r.status, Status::Ok);
        assert_eq!(r.agent.as_deref(), Some("konductor"));
        assert_eq!(r.repo.as_deref(), Some("/repo"));
        assert_eq!(r.models.len(), 1);
        let m = &r.models[0];
        assert_eq!(m.model, "claude-opus-5-5");
        assert_eq!(m.requests, 2);
        assert_eq!(m.output_tokens, Some(27));
        assert_eq!(m.cache_read_tokens, Some(2000));
        assert_eq!(m.thinking_tokens, Some(6));
        assert_eq!(m.credits, None);
    }

    #[test]
    fn claude_unreadable_usage_line_marks_record_unparsed() {
        let d = tmp("claude-bad-usage");
        let body = [
            r#"{"type":"assistant","timestamp":"2026-11-01T10:00:00Z","message":{"id":"a","model":"claude-opus-5-5","usage":{"output_tokens":5}}}"#,
            r#"{"type":"assistant","message":{"id":"b","model":"claude-opus-5-5","usage":{"output_tokens":"many"}}}"#,
        ]
        .join("\n");
        let p = write(&d, "proj/s.jsonl", &body);
        assert_eq!(collect_claude(&p, 0, 0).status, Status::Unparsed);
    }

    #[test]
    fn claude_usage_without_message_id_or_model_marks_record_unparsed() {
        let d = tmp("claude-no-id");
        for (name, message) in [
            (
                "no-id",
                r#"{"model":"claude-opus-5-5","usage":{"output_tokens":5}}"#,
            ),
            ("no-model", r#"{"id":"a","usage":{"output_tokens":5}}"#),
        ] {
            let p = write(
                &d,
                &format!("proj/{name}.jsonl"),
                &format!(r#"{{"type":"assistant","message":{message}}}"#),
            );
            assert_eq!(collect_claude(&p, 0, 0).status, Status::Unparsed, "{name}");
        }
    }

    #[test]
    fn claude_usage_mentioned_outside_message_is_ignored() {
        let d = tmp("claude-usage-text");
        let p = write(
            &d,
            "proj/s.jsonl",
            r#"{"type":"assistant","meta":{"usage":"n/a"},"message":{"id":"a","model":"claude-opus-5-5"}}"#,
        );
        let r = collect_claude(&p, 0, 0);
        assert_eq!(r.status, Status::Ok);
        assert!(r.models.is_empty());
    }

    #[test]
    fn claude_unreadable_line_marks_record_unparsed() {
        let d = tmp("claude-bad-utf8");
        let p = d.join("proj/s.jsonl");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let mut bytes = br#"{"type":"assistant","timestamp":"2026-11-01T10:00:00Z","message":{"id":"a","model":"claude-opus-5-5","usage":{"output_tokens":5}}}"#.to_vec();
        bytes.extend_from_slice(b"\n\xff\xfe not utf-8\n");
        std::fs::write(&p, bytes).unwrap();
        assert_eq!(collect_claude(&p, 0, 0).status, Status::Unparsed);
    }

    #[test]
    fn str_field_tolerates_whitespace_decodes_escapes_and_skips_nested_strings() {
        assert_eq!(
            str_field(r#"{"cwd" :  "/a/b"}"#, "cwd").as_deref(),
            Some("/a/b")
        );
        assert_eq!(
            str_field(r#"{"cwd":"/a \"q\" \\ café"}"#, "cwd").as_deref(),
            Some("/a \"q\" \\ café")
        );
        // "cwd" inside another string value, then the real key.
        assert_eq!(
            str_field(r#"{"note":"x \"cwd\":\"/fake\"","cwd":"/real"}"#, "cwd").as_deref(),
            Some("/real")
        );
        assert_eq!(str_field(r#"{"cwd":42,"x":1}"#, "cwd"), None);
        assert_eq!(str_field(r#"{"cwd":"unterminated"#, "cwd"), None);
    }

    #[test]
    fn claude_whitespace_formatted_json_is_still_counted() {
        let d = tmp("claude-spaced");
        let body = [
            r#"{"type": "agent-setting", "agentSetting": "konductor", "cwd": "/repo/x", "timestamp": "2026-11-01T10:00:00Z"}"#,
            r#"{"type": "assistant", "timestamp": "2026-11-01T10:00:05Z", "message": {"id": "m", "model": "claude-opus-5-5", "usage": {"input_tokens": 1, "output_tokens": 500}}}"#,
        ]
        .join("\n");
        let p = write(&d, "proj/s.jsonl", &body);
        let r = collect_claude(&p, 0, 0);
        assert_eq!(r.status, Status::Ok);
        assert_eq!(r.agent.as_deref(), Some("konductor"));
        assert_eq!(r.repo.as_deref(), Some("/repo/x"));
        assert_eq!(r.models[0].output_tokens, Some(500));
        assert_eq!(r.last_ts.unwrap() - r.first_ts.unwrap(), 5);
    }

    #[test]
    fn claude_non_assistant_line_with_usage_is_ignored() {
        let d = tmp("claude-non-assistant");
        let body = [
            r#"{"type":"agent-setting","agentSetting":"konductor"}"#,
            r#"{"type":"api-request","role":"assistant","message":{"id":"x","model":"m","usage":{"output_tokens":"not-a-number"}}}"#,
            r#"{"type":"assistant","message":{"id":"a","model":"claude-opus-5-5","usage":{"output_tokens":3}}}"#,
        ]
        .join("\n");
        let p = write(&d, "proj/s.jsonl", &body);
        let r = collect_claude(&p, 0, 0);
        assert_eq!(r.status, Status::Ok);
        assert_eq!(r.models[0].output_tokens, Some(3));
    }

    #[test]
    fn claude_subagent_takes_agent_from_meta_and_parent_from_dir() {
        let d = tmp("claude-sub");
        write(
            &d,
            "proj/s1/subagents/agent-a1.meta.json",
            r#"{"agentType":"k-researcher"}"#,
        );
        let p = write(
            &d,
            "proj/s1/subagents/agent-a1.jsonl",
            r#"{"type":"assistant","timestamp":"2026-11-01T10:00:00Z","message":{"id":"x","model":"claude-sonnet-5-5","usage":{"input_tokens":1,"output_tokens":2}}}"#,
        );
        let r = collect_claude(&p, 0, 0);
        assert_eq!(r.agent.as_deref(), Some("k-researcher"));
        assert_eq!(r.parent_session_id.as_deref(), Some("s1"));
        assert_eq!(r.models[0].input_tokens, Some(1));
        assert_eq!(r.models[0].output_tokens, None);
    }

    #[test]
    fn kiro_v2_sums_credits_per_model_and_leaves_tokens_null() {
        let d = tmp("v2");
        let p = write(
            &d,
            "cli/abc.json",
            r#"{"session_id":"abc","cwd":"/repo","created_at":"2026-11-01T10:00:00Z","updated_at":"2026-11-01T11:00:00Z",
               "session_state":{"agent_name":"k-developer","conversation_metadata":{"user_turn_metadatas":[
                 {"model":"claude-sonnet-5","total_request_count":2,"metering_usage":[{"value":0.5,"unit":"credit"},{"value":0.25,"unit":"credit"}]},
                 {"model":"claude-sonnet-5","total_request_count":1,"metering_usage":[{"value":1.0,"unit":"credit"}]}]}}}"#,
        );
        let r = collect_kiro_v2(&p, 0, 0);
        assert_eq!(r.agent.as_deref(), Some("k-developer"));
        assert_eq!(r.models.len(), 1);
        assert_eq!(r.models[0].requests, 3);
        assert_eq!(r.models[0].credits, Some(1.75));
        assert_eq!(r.models[0].input_tokens, None);
        assert_eq!(r.last_ts.unwrap() - r.first_ts.unwrap(), 3600);
    }

    #[test]
    fn kiro_v3_reads_agent_credits_and_subagent_runs() {
        let d = tmp("v3");
        write(
            &d,
            "ws/sess_1/session.json",
            r#"{"modelId":"claude-opus-4.6","workspacePaths":["/repo"],"agentMode":"vibe"}"#,
        );
        let body = [
            r#"{"id":"1","timestamp":"2026-11-01T10:00:00Z","payload":{"type":"session_start","agentType":"konductor","content":"..."}}"#,
            r#"{"id":"2","timestamp":"2026-11-01T10:00:01Z","payload":{"type":"turn_start","executionId":"e"}}"#,
            r#"{"id":"3","timestamp":"2026-11-01T10:00:02Z","payload":{"type":"sub_agent_start","subAgentName":"k-developer"}}"#,
            r#"{"id":"4","timestamp":"2026-11-01T10:05:00Z","payload":{"type":"usage_summary","promptTurnSummaries":[{"unit":"credit","usage":0.5},{"unit":"credit","usage":0.25}]}}"#,
        ]
        .join("\n");
        let p = write(&d, "ws/sess_1/messages.jsonl", &body);
        let r = collect_kiro_v3(&p, 0, 0);
        assert_eq!(r.agent.as_deref(), Some("konductor"));
        assert_eq!(r.repo.as_deref(), Some("/repo"));
        assert_eq!(r.subagent_runs, Some(1));
        assert_eq!(r.models[0].credits, Some(0.75));
        assert_eq!(r.models[0].requests, 1);
    }

    #[test]
    fn kiro_v3_sums_one_usage_summary_per_turn() {
        // Each event carries only its own turn's credits (checked against
        // real multi-turn KAS sessions), so summing across events is right.
        let d = tmp("v3-turns");
        let body = [
            r#"{"id":"1","timestamp":"2026-11-01T10:00:00Z","payload":{"type":"session_start","agentType":"konductor"}}"#,
            r#"{"id":"2","timestamp":"2026-11-01T10:00:01Z","payload":{"type":"turn_start"}}"#,
            r#"{"id":"3","timestamp":"2026-11-01T10:01:00Z","payload":{"type":"usage_summary","promptTurnSummaries":[{"unit":"credit","usage":0.256}]}}"#,
            r#"{"id":"4","timestamp":"2026-11-01T10:02:00Z","payload":{"type":"turn_start"}}"#,
            r#"{"id":"5","timestamp":"2026-11-01T10:03:00Z","payload":{"type":"usage_summary","promptTurnSummaries":[{"unit":"credit","usage":2.791}]}}"#,
        ]
        .join("\n");
        let p = write(&d, "ws/s/messages.jsonl", &body);
        let r = collect_kiro_v3(&p, 0, 0);
        assert_eq!(r.models[0].requests, 2);
        let credits = r.models[0].credits.unwrap();
        assert!((credits - 3.047).abs() < 1e-9, "{credits}");
    }

    #[test]
    fn kiro_v3_unreadable_usage_summary_marks_record_unparsed() {
        let d = tmp("v3-bad-usage");
        let body = [
            r#"{"id":"1","timestamp":"2026-11-01T10:00:00Z","payload":{"type":"session_start","agentType":"konductor"}}"#,
            r#"{"id":"2","timestamp":"2026-11-01T10:01:00Z","payload":{"type":"usage_summary","promptTurnSummaries":[{"unit":"credit"}]}}"#,
        ]
        .join("\n");
        let p = write(&d, "ws/s/messages.jsonl", &body);
        assert_eq!(collect_kiro_v3(&p, 0, 0).status, Status::Unparsed);
    }

    #[test]
    fn kiro_v3_unreadable_line_marks_record_unparsed() {
        let d = tmp("v3-bad-utf8");
        let p = d.join("ws/s/messages.jsonl");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let mut bytes = br#"{"id":"1","timestamp":"2026-11-01T10:00:00Z","payload":{"type":"session_start","agentType":"konductor"}}"#.to_vec();
        bytes.extend_from_slice(b"\n\xff\xfe not utf-8\n");
        std::fs::write(&p, bytes).unwrap();
        assert_eq!(collect_kiro_v3(&p, 0, 0).status, Status::Unparsed);
    }

    #[test]
    fn kiro_v3_malformed_session_json_marks_record_unparsed() {
        let d = tmp("v3-bad-session");
        write(&d, "ws/s/session.json", "{ not json");
        let p = write(
            &d,
            "ws/s/messages.jsonl",
            r#"{"id":"1","timestamp":"2026-11-01T10:00:00Z","payload":{"type":"session_start","agentType":"konductor"}}"#,
        );
        assert_eq!(collect_kiro_v3(&p, 0, 0).status, Status::Unparsed);
    }

    #[test]
    fn kiro_v3_missing_session_json_defaults_and_one_bad_field_loses_only_itself() {
        let d = tmp("v3-session-fields");
        let line = r#"{"id":"1","timestamp":"2026-11-01T10:00:00Z","payload":{"type":"session_start","agentType":"konductor"}}"#;
        let p = write(&d, "ws/a/messages.jsonl", line);
        let r = collect_kiro_v3(&p, 0, 0);
        assert_eq!(
            (r.status, r.models[0].model.as_str(), r.repo.as_deref()),
            (Status::Ok, "unknown", None)
        );

        write(
            &d,
            "ws/b/session.json",
            r#"{"modelId":42,"workspacePaths":["/repo"],"schemaVersion":2}"#,
        );
        let p = write(&d, "ws/b/messages.jsonl", line);
        let r = collect_kiro_v3(&p, 0, 0);
        assert_eq!(
            (r.status, r.models[0].model.as_str(), r.repo.as_deref()),
            (Status::Ok, "unknown", Some("/repo"))
        );
    }

    #[test]
    fn kiro_v3_all_garbage_messages_file_is_unparsed() {
        let d = tmp("v3-garbage");
        let p = write(
            &d,
            "ws/s/messages.jsonl",
            "{\"payload\": \"session_start\" oops\nmore \"turn_start\" junk",
        );
        assert_eq!(collect_kiro_v3(&p, 0, 0).status, Status::Unparsed);
    }

    #[test]
    fn kiro_v3_agent_falls_back_to_session_agent_mode() {
        let d = tmp("v3-agent-mode");
        write(&d, "ws/s/session.json", r#"{"agentMode":"konductor"}"#);
        let p = write(
            &d,
            "ws/s/messages.jsonl",
            r#"{"id":"1","timestamp":"2026-11-01T10:00:00Z","payload":{"type":"session_start"}}"#,
        );
        assert_eq!(
            collect_kiro_v3(&p, 0, 0).agent.as_deref(),
            Some("konductor")
        );
    }

    #[test]
    fn non_credit_units_are_not_counted_as_credits() {
        let d = tmp("units");
        let p = write(
            &d,
            "cli/u.json",
            r#"{"session_state":{"agent_name":"k","conversation_metadata":{"user_turn_metadatas":[
                 {"model":"m","total_request_count":1,"metering_usage":[{"value":1.0,"unit":"credit"},{"value":9.0,"unit":"token"}]}]}}}"#,
        );
        assert_eq!(collect_kiro_v2(&p, 0, 0).models[0].credits, Some(1.0));
        let p = write(
            &d,
            "ws/s/messages.jsonl",
            r#"{"id":"1","timestamp":"2026-11-01T10:00:00Z","payload":{"type":"usage_summary","promptTurnSummaries":[{"unit":"credit","usage":0.5},{"unit":"token","usage":9.0}]}}"#,
        );
        assert_eq!(collect_kiro_v3(&p, 0, 0).models[0].credits, Some(0.5));
    }

    #[test]
    fn kiro_v2_turn_with_empty_metering_leaves_credits_null() {
        let d = tmp("v2-empty-metering");
        let p = write(
            &d,
            "cli/e.json",
            r#"{"session_state":{"agent_name":"k","conversation_metadata":{"user_turn_metadatas":[
                 {"model":"m","total_request_count":2,"metering_usage":[]}]}}}"#,
        );
        let m = &collect_kiro_v2(&p, 0, 0).models[0];
        assert_eq!((m.requests, m.credits), (2, None));
    }

    #[test]
    fn kiro_v3_without_usage_summary_has_null_credits() {
        let d = tmp("v3-old");
        let p = write(
            &d,
            "ws/s/messages.jsonl",
            r#"{"id":"1","timestamp":"2026-06-01T10:00:00Z","payload":{"type":"session_start","agentType":"konductor"}}"#,
        );
        assert_eq!(collect_kiro_v3(&p, 0, 0).models[0].credits, None);
    }

    #[test]
    fn unreadable_shapes_are_unparsed_not_zero() {
        let d = tmp("bad");
        let p = write(&d, "cli/bad.json", "not json");
        assert_eq!(collect_kiro_v2(&p, 0, 0).status, Status::Unparsed);
        let p = write(&d, "proj/bad.jsonl", r#"{"type":"assistant","usage":"#);
        assert_eq!(collect_claude(&p, 0, 0).status, Status::Unparsed);
    }
}
