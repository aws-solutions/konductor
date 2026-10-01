// SPDX-License-Identifier: Apache-2.0
//
// telemetry_hook.rs — `konductor __telemetry-hook <event-type>`: parses
// a runtime hook's stdin payload, works out which agent ran and whether
// it was delegated to, and reports it through
// `telemetry::report_agent_invocation`/`report_subagent_invocation`.
//
// This is the one call site where a hook is genuinely necessary:
// `konductor-rs` has no process running at the moment a runtime session
// starts, or a delegation begins, to observe that event any other way.
// A malformed or non-JSON stdin payload exits quietly (0) without
// panicking and without calling `report_*` -- this subcommand's own
// failure must never surface as a visible error to the harness that
// invoked it.
//
// Only Konductor agents are reported: the name must be in the manifest
// of an install found from the hook's cwd (nearest ancestor first, then
// `$HOME`). Otherwise nothing is sent.
//
// Where each harness puts the agent name, per captured payloads:
//
// | Harness | Primary agent                      | Delegated agent                       |
// |---------|------------------------------------|---------------------------------------|
// | Kiro v2 | `--agent` baked into the per-agent | same hook in the child's own config;  |
// |         | `agentSpawn` command               | payload `session_id` differs from     |
// |         |                                    | env `KIRO_SESSION_ID` (the parent's)  |
// | Kiro v3 | `SessionStart` has only            | `PreToolUse` `tool_name`              |
// |         | `session_id`; the name is          | `subagent_<name>`, or                 |
// |         | `agentMode` in KAS's session.json  | `orchestrate_subagent` with           |
// |         |                                    | `tool_input.stages[].role`            |
// | Claude  | `SessionStart` `agent_type`        | `SubagentStart` `agent_type`; parent  |
// |         | (only when run with `--agent`)     | from env `CLAUDE_CODE_AGENT`          |

use std::io::Read as _;
use std::path::{Path, PathBuf};

use super::telemetry;

/// `event_type` argument values this subcommand recognizes. `pub(crate)`
/// so the install side (`claude_settings.rs`'s `TELEMETRY_HOOK_ENTRIES`
/// and `telemetry_hook_pass.rs`'s Kiro hooks) builds its
/// `__telemetry-hook` commands from these same constants, rather than
/// duplicating the literal `"agent-invocation"`/`"subagent-invocation"`
/// strings there -- a rename on either side is then a compile error on
/// the other, not a silent runtime mismatch between what gets wired in
/// and what this match actually recognizes.
pub(crate) const AGENT_INVOCATION: &str = "agent-invocation";
pub(crate) const SUBAGENT_INVOCATION: &str = "subagent-invocation";

/// Kiro v3 names its direct delegation tool `subagent_<agent>`.
const KIRO_DIRECT_SUBAGENT_TOOL_PREFIX: &str = "subagent_";
/// Kiro v3's multi-stage delegation tool; targets are `stages[].role`.
pub(crate) const KIRO_ORCHESTRATE_TOOL: &str = "orchestrate_subagent";

/// The payload fields this subcommand reads. Everything else the
/// harness sends (cwd, transcript_path, prompt text, ...) is ignored;
/// only names and a session id ever leave this process, the session id
/// one-way hashed.
///
/// Session id field name varies by harness convention in the wild
/// (`session_id` snake_case is Claude Code's documented payload shape;
/// `sessionId` camelCase is accepted too in case a future/alternate
/// payload uses it) -- both are attempted, first match wins.
#[derive(Debug, Default, serde::Deserialize)]
struct HookPayload {
    #[serde(default, alias = "sessionId")]
    session_id: Option<String>,
    /// Claude Code: the session's agent on `SessionStart`, the delegated
    /// agent on `SubagentStart`. `agent_name` is accepted as a fallback.
    #[serde(default, alias = "agent_name")]
    agent_type: Option<String>,
    /// Kiro v3 `PreToolUse`: the delegation tool's name.
    #[serde(default)]
    tool_name: Option<String>,
    /// Kiro v3 `PreToolUse`: read only for `orchestrate_subagent`'s
    /// `stages[].role`.
    #[serde(default)]
    tool_input: Option<serde_json::Value>,
}

/// The environment variables the resolver reads, gathered once so tests
/// can supply them directly.
#[derive(Debug, Default)]
struct HookEnv {
    /// Kiro: the root session. Inside a v2 delegated child's hook this
    /// still holds the parent's session id.
    kiro_session_id: Option<String>,
    /// Claude Code: the session's `--agent`, also set inside a
    /// sub-agent's hooks, so it names the delegating agent there.
    claude_agent: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InvocationKind {
    Agent,
    Subagent,
}

/// One event this hook firing should report, before the Konductor-agent
/// filter is applied.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Invocation {
    kind: InvocationKind,
    agent: String,
    session_id: Option<String>,
    parent_session_id: Option<String>,
    parent_agent: Option<String>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|name| !name.is_empty())
}

/// Returns an empty `Vec` when no name resolves, so nothing is reported
/// rather than `<unknown>`. `kiro_session_agent` maps a Kiro v3 session
/// id to its agent.
fn resolve_invocations(
    event_type: &str,
    payload: HookPayload,
    agent_arg: Option<&str>,
    env: &HookEnv,
    kiro_session_agent: &dyn Fn(&str) -> Option<String>,
) -> Vec<Invocation> {
    let session_id = non_empty(payload.session_id);
    match event_type {
        AGENT_INVOCATION => {
            if let Some(agent) = agent_arg.filter(|name| !name.is_empty()) {
                if let (Some(own), Some(root)) = (&session_id, &env.kiro_session_id) {
                    if own != root {
                        return vec![Invocation {
                            kind: InvocationKind::Subagent,
                            agent: agent.to_string(),
                            session_id: Some(own.clone()),
                            parent_session_id: Some(root.clone()),
                            parent_agent: kiro_session_agent(root),
                        }];
                    }
                }
                return vec![Invocation {
                    kind: InvocationKind::Agent,
                    agent: agent.to_string(),
                    session_id,
                    parent_session_id: None,
                    parent_agent: None,
                }];
            }
            let agent = non_empty(payload.agent_type)
                .or_else(|| session_id.as_deref().and_then(kiro_session_agent));
            agent
                .map(|agent| {
                    vec![Invocation {
                        kind: InvocationKind::Agent,
                        agent,
                        session_id,
                        parent_session_id: None,
                        parent_agent: None,
                    }]
                })
                .unwrap_or_default()
        }
        SUBAGENT_INVOCATION => {
            let targets: Vec<String> = match payload.tool_name.as_deref() {
                Some(KIRO_ORCHESTRATE_TOOL) => orchestrate_stage_roles(payload.tool_input.as_ref()),
                Some(tool) if tool.starts_with(KIRO_DIRECT_SUBAGENT_TOOL_PREFIX) => non_empty(
                    Some(tool[KIRO_DIRECT_SUBAGENT_TOOL_PREFIX.len()..].to_string()),
                )
                .into_iter()
                .collect(),
                _ => non_empty(payload.agent_type).into_iter().collect(),
            };
            let parent_agent = non_empty(env.claude_agent.clone())
                .or_else(|| session_id.as_deref().and_then(kiro_session_agent));
            targets
                .into_iter()
                .map(|agent| Invocation {
                    kind: InvocationKind::Subagent,
                    agent,
                    session_id: session_id.clone(),
                    parent_session_id: session_id.clone(),
                    parent_agent: parent_agent.clone(),
                })
                .collect()
        }
        _ => Vec::new(),
    }
}

/// `orchestrate_subagent`'s target agents, one per stage, in order.
fn orchestrate_stage_roles(tool_input: Option<&serde_json::Value>) -> Vec<String> {
    tool_input
        .and_then(|input| input.get("stages"))
        .and_then(|stages| stages.as_array())
        .map(|stages| {
            stages
                .iter()
                .filter_map(|stage| stage.get("role").and_then(|role| role.as_str()))
                .filter(|role| !role.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Accepts only the id shapes the harnesses actually emit, so a hostile
/// payload can't turn the session lookup into a path traversal.
fn is_safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Largest KAS session.json this will parse; real ones are a few KB.
const MAX_SESSION_FILE_BYTES: u64 = 1024 * 1024;

/// Kiro v3's agent for `session_id`, read from KAS's own session store at
/// `<home>/.kiro/sessions/<workspace-hash>/<session_id>/session.json`.
/// The store is KAS-internal, so any failure is a silent `None`.
fn kiro_session_agent_mode(home: &Path, session_id: &str) -> Option<String> {
    if !is_safe_session_id(session_id) {
        return None;
    }
    let entries = std::fs::read_dir(home.join(".kiro").join("sessions")).ok()?;
    for entry in entries.flatten() {
        let path = entry.path().join(session_id).join("session.json");
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_SESSION_FILE_BYTES {
            return None;
        }
        let bytes = std::fs::read(&path).ok()?;
        let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        return value
            .get("agentMode")
            .and_then(|mode| mode.as_str())
            .filter(|mode| !mode.is_empty())
            .map(str::to_string);
    }
    None
}

/// The agent name a manifest file path belongs to, for the two agent
/// layouts Konductor installs. Sidecar files (`_*.json`) are excluded.
fn agent_name_from_manifest_path(path: &str) -> Option<&str> {
    const AGENT_LAYOUTS: [(&str, &str); 2] =
        [(".kiro/agents/", ".json"), (".claude/agents/", ".md")];
    AGENT_LAYOUTS.iter().find_map(|(prefix, extension)| {
        path.strip_prefix(prefix)
            .and_then(|rest| rest.strip_suffix(extension))
            .filter(|name| !name.is_empty() && !name.contains('/') && !name.starts_with('_'))
    })
}

/// Agent names Konductor installed at `root`, per its manifest (every
/// strategy slot). Empty when there is no readable manifest.
pub(crate) fn installed_agent_names(root: &Path) -> Vec<String> {
    let Ok(Some(manifest)) = crate::cli::install::manifest::read_manifest(root) else {
        return Vec::new();
    };
    manifest
        .strategies
        .iter()
        .flat_map(|strategy| strategy.files.iter())
        .filter_map(|file| agent_name_from_manifest_path(&file.path))
        .map(str::to_string)
        .collect()
}

/// Install roots to check, local first: `cwd` and each ancestor that
/// carries a `.konductor` directory, nearest first, then `$HOME` (the
/// default global install target) if it wasn't already found on the way.
fn candidate_install_roots(cwd: &Path, home: Option<&Path>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = cwd
        .ancestors()
        .filter(|dir| dir.join(".konductor").is_dir())
        .map(Path::to_path_buf)
        .collect();
    if let Some(home) = home {
        if !roots.iter().any(|root| root == home) {
            roots.push(home.to_path_buf());
        }
    }
    roots
}

/// The candidate roots with their installed agent names, each manifest
/// read at most once per hook firing.
struct InstallIndex {
    roots: Vec<(PathBuf, Vec<String>)>,
}

impl InstallIndex {
    fn new(roots: Vec<PathBuf>) -> Self {
        let roots = roots
            .into_iter()
            .map(|root| {
                let names = installed_agent_names(&root);
                (root, names)
            })
            .collect();
        InstallIndex { roots }
    }

    /// The nearest install that has `agent` in its manifest.
    fn install_for(&self, agent: &str) -> Option<&Path> {
        self.roots
            .iter()
            .find(|(_, names)| names.iter().any(|name| name == agent))
            .map(|(root, _)| root.as_path())
    }
}

/// Hard cap on a `__telemetry-hook` stdin payload's size, checked
/// BEFORE any JSON parsing. A real hook payload (a session id, an
/// agent name, and a handful of other short fields -- see
/// `HookPayload`) is at most a few hundred bytes; this bound exists
/// purely as a guardrail against an oversized or malicious piped
/// payload driving an unbounded `String` allocation, not because any
/// real payload approaches it.
const MAX_HOOK_PAYLOAD_BYTES: u64 = 64 * 1024;

/// Reads at most `MAX_HOOK_PAYLOAD_BYTES + 1` bytes from `reader` and
/// returns the buffer only if it did NOT exceed the cap -- the `+1`
/// lets this DETECT an over-limit input (buffer length strictly
/// greater than the cap) rather than silently truncating it into
/// whatever partial data happens to still look valid to a later
/// parser. Returns `None` on any read error (e.g. invalid UTF-8) or on
/// exceeding the cap. Generic over `Read` so this is directly
/// unit-testable against an in-memory byte slice, without touching the
/// real process stdin `dispatch_telemetry_hook` reads from.
fn read_capped<R: std::io::Read>(mut reader: R) -> Option<String> {
    let mut buf = String::new();
    let mut limited = (&mut reader).take(MAX_HOOK_PAYLOAD_BYTES + 1);
    limited.read_to_string(&mut buf).ok()?;
    if buf.len() as u64 > MAX_HOOK_PAYLOAD_BYTES {
        return None;
    }
    Some(buf)
}

fn env_non_empty(name: &str) -> Option<String> {
    non_empty(std::env::var(name).ok())
}

/// Compares through symlinks (macOS `/tmp` is `/private/tmp`).
fn same_dir(a: &Path, b: &Path) -> bool {
    let canonical =
        |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    canonical(a) == canonical(b)
}

/// Never panics and never fails the harness: bad input or a
/// non-Konductor agent just means nothing is reported. The one thing it
/// prints is a stderr warning for an unrecognized `event_type` (a stale
/// or hand-edited hook command).
///
/// `own_install` is the install that wired this hook. A harness can load
/// hooks from several installs (global plus project), and each fires for
/// the same invocation; only the nearest install that owns the agent
/// reports. Hooks from older installs don't pass it and always report.
pub(crate) fn dispatch_telemetry_hook(
    cwd: &Path,
    event_type: &str,
    agent_arg: Option<&str>,
    own_install: Option<&Path>,
) {
    if event_type != AGENT_INVOCATION && event_type != SUBAGENT_INVOCATION {
        eprintln!(
            "warning: konductor __telemetry-hook received an unrecognized event_type \
             {event_type:?}; no telemetry event was reported"
        );
        return;
    }
    let Some(buf) = read_capped(std::io::stdin()) else {
        return;
    };
    let Ok(payload) = serde_json::from_str::<HookPayload>(&buf) else {
        return;
    };

    let home = std::env::var_os("HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from);
    let env = HookEnv {
        kiro_session_id: env_non_empty("KIRO_SESSION_ID"),
        claude_agent: env_non_empty("CLAUDE_CODE_AGENT"),
    };
    let kiro_session_agent = |session_id: &str| {
        home.as_deref()
            .and_then(|home| kiro_session_agent_mode(home, session_id))
    };
    let invocations =
        resolve_invocations(event_type, payload, agent_arg, &env, &kiro_session_agent);
    if invocations.is_empty() {
        return;
    }

    let index = InstallIndex::new(candidate_install_roots(cwd, home.as_deref()));
    for invocation in invocations {
        let Some(target_dir) = index.install_for(&invocation.agent) else {
            continue;
        };
        if own_install.is_some_and(|own| !same_dir(own, target_dir)) {
            continue;
        }
        match invocation.kind {
            InvocationKind::Agent => telemetry::report_agent_invocation(
                target_dir,
                &invocation.agent,
                invocation.session_id,
            ),
            InvocationKind::Subagent => {
                // A user's own delegating agent is never named on the wire.
                let parent_agent = invocation
                    .parent_agent
                    .filter(|parent| index.install_for(parent).is_some());
                telemetry::report_subagent_invocation(
                    target_dir,
                    &invocation.agent,
                    invocation.session_id,
                    invocation.parent_session_id,
                    parent_agent,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_kiro_session(_: &str) -> Option<String> {
        None
    }

    fn parse(json: &str) -> HookPayload {
        serde_json::from_str(json).expect("test payload must parse")
    }

    #[test]
    fn hook_payload_parses_camel_case_session_id() {
        let payload = parse(r#"{"sessionId":"abc123","agent_type":"orchestrator"}"#);
        assert_eq!(payload.session_id, Some("abc123".to_string()));
        assert_eq!(payload.agent_type, Some("orchestrator".to_string()));
    }

    #[test]
    fn hook_payload_parses_snake_case_session_id() {
        let payload = parse(r#"{"session_id":"abc123"}"#);
        assert_eq!(payload.session_id, Some("abc123".to_string()));
    }

    #[test]
    fn malformed_json_is_tolerated_without_panic() {
        let result = serde_json::from_str::<HookPayload>("not json at all");
        assert!(result.is_err());
    }

    // ── Resolution, fed the payloads captured from live sessions ─────

    #[test]
    fn kiro_v3_session_start_resolves_agent_from_the_session_store() {
        let payload = parse(
            r#"{"session_id":"sess_790a110a-09d2-4d60-97c1-f9272a040214","hook_event_name":"SessionStart","cwd":"/private/tmp"}"#,
        );
        let lookup = |sid: &str| {
            (sid == "sess_790a110a-09d2-4d60-97c1-f9272a040214").then(|| "konductor".to_string())
        };
        let resolved = resolve_invocations(
            AGENT_INVOCATION,
            payload,
            None,
            &HookEnv::default(),
            &lookup,
        );
        assert_eq!(
            resolved,
            vec![Invocation {
                kind: InvocationKind::Agent,
                agent: "konductor".to_string(),
                session_id: Some("sess_790a110a-09d2-4d60-97c1-f9272a040214".to_string()),
                parent_session_id: None,
                parent_agent: None,
            }]
        );
    }

    #[test]
    fn kiro_v3_direct_delegation_names_the_target_from_the_tool_name() {
        let payload = parse(
            r#"{"session_id":"sess_7142","hook_event_name":"PreToolUse","cwd":"/private/tmp","tool_name":"subagent_k-researcher","tool_input":{"prompt":"Reply with the single word: pong","explanation":"x"}}"#,
        );
        let lookup = |_: &str| Some("konductor".to_string());
        let resolved = resolve_invocations(
            SUBAGENT_INVOCATION,
            payload,
            None,
            &HookEnv::default(),
            &lookup,
        );
        assert_eq!(
            resolved,
            vec![Invocation {
                kind: InvocationKind::Subagent,
                agent: "k-researcher".to_string(),
                session_id: Some("sess_7142".to_string()),
                parent_session_id: Some("sess_7142".to_string()),
                parent_agent: Some("konductor".to_string()),
            }]
        );
    }

    #[test]
    fn kiro_v3_orchestration_reports_one_event_per_stage_role() {
        let payload = parse(
            r#"{"session_id":"sess_2c88","hook_event_name":"PreToolUse","tool_name":"orchestrate_subagent","tool_input":{"task":"t","stages":[{"name":"a","role":"k-researcher","prompt_template":"p"},{"name":"b","role":"k-developer","prompt_template":"p","depends_on":["a"]}],"repeat":null}}"#,
        );
        let resolved = resolve_invocations(
            SUBAGENT_INVOCATION,
            payload,
            None,
            &HookEnv::default(),
            &no_kiro_session,
        );
        let agents: Vec<&str> = resolved.iter().map(|i| i.agent.as_str()).collect();
        assert_eq!(agents, vec!["k-researcher", "k-developer"]);
        assert!(resolved.iter().all(|i| i.kind == InvocationKind::Subagent));
    }

    #[test]
    fn kiro_v2_primary_agent_uses_the_agent_argument() {
        let payload = parse(
            r#"{"hook_event_name":"agentSpawn","cwd":"/private/tmp/kv2probe","session_id":"cb4556d5-1aa1-46c5-ba9d-235ef054295d"}"#,
        );
        let env = HookEnv {
            kiro_session_id: Some("cb4556d5-1aa1-46c5-ba9d-235ef054295d".to_string()),
            claude_agent: None,
        };
        let resolved = resolve_invocations(
            AGENT_INVOCATION,
            payload,
            Some("konductor"),
            &env,
            &no_kiro_session,
        );
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].kind, InvocationKind::Agent);
        assert_eq!(resolved[0].agent, "konductor");
    }

    #[test]
    fn kiro_v2_child_spawn_is_a_subagent_of_the_root_session() {
        let payload = parse(
            r#"{"hook_event_name":"agentSpawn","cwd":"/private/tmp/kv2probe","session_id":"eb346416-d8f0-4579-80b4-3f0a9c9bbe9e"}"#,
        );
        let env = HookEnv {
            kiro_session_id: Some("cb4556d5-1aa1-46c5-ba9d-235ef054295d".to_string()),
            claude_agent: None,
        };
        let resolved = resolve_invocations(
            AGENT_INVOCATION,
            payload,
            Some("k-researcher"),
            &env,
            &no_kiro_session,
        );
        assert_eq!(
            resolved,
            vec![Invocation {
                kind: InvocationKind::Subagent,
                agent: "k-researcher".to_string(),
                session_id: Some("eb346416-d8f0-4579-80b4-3f0a9c9bbe9e".to_string()),
                parent_session_id: Some("cb4556d5-1aa1-46c5-ba9d-235ef054295d".to_string()),
                parent_agent: None,
            }]
        );
    }

    #[test]
    fn claude_session_start_uses_agent_type() {
        let payload = parse(
            r#"{"session_id":"bd3b7f9b","transcript_path":"/x.jsonl","cwd":"/private/tmp","agent_type":"konductor","hook_event_name":"SessionStart","source":"startup"}"#,
        );
        let resolved = resolve_invocations(
            AGENT_INVOCATION,
            payload,
            None,
            &HookEnv::default(),
            &no_kiro_session,
        );
        assert_eq!(resolved[0].agent, "konductor");
        assert_eq!(resolved[0].kind, InvocationKind::Agent);
    }

    #[test]
    fn claude_session_without_an_agent_reports_nothing() {
        let payload = parse(
            r#"{"session_id":"ae92fcfb","transcript_path":"/x.jsonl","cwd":"/private/tmp","hook_event_name":"SessionStart","source":"startup"}"#,
        );
        let resolved = resolve_invocations(
            AGENT_INVOCATION,
            payload,
            None,
            &HookEnv::default(),
            &no_kiro_session,
        );
        assert!(
            resolved.is_empty(),
            "no name must mean no event, not <unknown>"
        );
    }

    #[test]
    fn claude_subagent_start_takes_the_parent_from_the_environment() {
        let payload = parse(
            r#"{"session_id":"bd3b7f9b","cwd":"/private/tmp","agent_id":"a36b74abfeba46730","agent_type":"k-researcher","hook_event_name":"SubagentStart"}"#,
        );
        let env = HookEnv {
            kiro_session_id: None,
            claude_agent: Some("konductor".to_string()),
        };
        let resolved =
            resolve_invocations(SUBAGENT_INVOCATION, payload, None, &env, &no_kiro_session);
        assert_eq!(resolved[0].agent, "k-researcher");
        assert_eq!(resolved[0].parent_agent.as_deref(), Some("konductor"));
    }

    #[test]
    fn empty_names_resolve_to_nothing() {
        let payload = parse(r#"{"session_id":"s","agent_type":""}"#);
        assert!(resolve_invocations(
            AGENT_INVOCATION,
            payload,
            Some(""),
            &HookEnv::default(),
            &no_kiro_session
        )
        .is_empty());
        let payload = parse(r#"{"session_id":"s","tool_name":"subagent_"}"#);
        assert!(resolve_invocations(
            SUBAGENT_INVOCATION,
            payload,
            None,
            &HookEnv::default(),
            &no_kiro_session
        )
        .is_empty());
    }

    // ── Kiro v3 session store lookup ─────────────────────────────────

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-telemetry-hook-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn kiro_session_agent_mode_reads_agent_mode_from_the_session_store() {
        let home = scratch_dir("session-store");
        let session_dir = home.join(".kiro/sessions/11fe14a563f7aed6/sess_abc-123");
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(
            session_dir.join("session.json"),
            r#"{"id":"sess_abc-123","agentMode":"konductor"}"#,
        )
        .unwrap();
        assert_eq!(
            kiro_session_agent_mode(&home, "sess_abc-123"),
            Some("konductor".to_string())
        );
        assert_eq!(kiro_session_agent_mode(&home, "sess_missing"), None);
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn kiro_session_agent_mode_rejects_path_like_session_ids() {
        let home = scratch_dir("session-store-unsafe");
        for id in ["../etc", "a/b", "", "sess.json"] {
            assert_eq!(kiro_session_agent_mode(&home, id), None, "{id:?}");
        }
        std::fs::remove_dir_all(&home).ok();
    }

    // ── Konductor-agent filter and install lookup ────────────────────

    #[test]
    fn agent_names_come_only_from_agent_layout_paths() {
        assert_eq!(
            agent_name_from_manifest_path(".kiro/agents/konductor.json"),
            Some("konductor")
        );
        assert_eq!(
            agent_name_from_manifest_path(".claude/agents/k-developer.md"),
            Some("k-developer")
        );
        for other in [
            ".kiro/agents/_sop_scopes.json",
            ".kiro/context/routing.md",
            ".konductor/skills/x/SKILL.md",
            ".kiro/agents/nested/x.json",
            ".kiro/hooks/konductor-telemetry-hooks.json",
        ] {
            assert_eq!(agent_name_from_manifest_path(other), None, "{other}");
        }
    }

    fn seed_install(root: &Path, agents: &[&str]) {
        use crate::cli::install::manifest::{
            upsert_strategy, ManifestFile, Provenance, Status, StrategyManifest,
        };
        let files = agents
            .iter()
            .map(|agent| ManifestFile {
                path: format!(".kiro/agents/{agent}.json"),
                sha256: None,
                provenance: Provenance::Created,
            })
            .collect();
        upsert_strategy(
            root,
            StrategyManifest::new(
                "kiro-v3",
                "2026-01-01T00:00:00Z",
                ".",
                None,
                Status::Complete,
                files,
            ),
        )
        .unwrap();
    }

    #[test]
    fn local_install_is_preferred_and_global_is_the_fallback() {
        let home = scratch_dir("install-lookup-home");
        seed_install(&home, &["konductor", "k-researcher"]);
        let project = home.join("workspace/project");
        seed_install(&project, &["konductor"]);
        let cwd = project.join("src/deep");
        std::fs::create_dir_all(&cwd).unwrap();

        let index = InstallIndex::new(candidate_install_roots(&cwd, Some(&home)));
        assert_eq!(index.install_for("konductor"), Some(project.as_path()));
        assert_eq!(index.install_for("k-researcher"), Some(home.as_path()));
        assert_eq!(index.install_for("amzn-builder"), None);
        assert_eq!(index.install_for("Explore"), None);
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn global_install_serves_a_session_started_outside_any_project_install() {
        let home = scratch_dir("install-lookup-global");
        seed_install(&home, &["konductor"]);
        let elsewhere = scratch_dir("install-lookup-elsewhere");

        let index = InstallIndex::new(candidate_install_roots(&elsewhere, Some(&home)));
        assert_eq!(index.install_for("konductor"), Some(home.as_path()));
        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_dir_all(&elsewhere).ok();
    }

    // ── Payload size cap ─────────────────────────────────────────────

    /// A payload well under the cap round-trips unchanged.
    #[test]
    fn read_capped_returns_input_under_the_cap() {
        let input = br#"{"sessionId":"abc123"}"#;
        assert_eq!(
            read_capped(&input[..]),
            Some(String::from_utf8(input.to_vec()).unwrap())
        );
    }

    /// A payload of EXACTLY the cap size must still succeed -- the
    /// off-by-one boundary the `+1`-byte `Take` exists to get right.
    #[test]
    fn read_capped_returns_input_at_exactly_the_cap() {
        let input = vec![b'a'; MAX_HOOK_PAYLOAD_BYTES as usize];
        let result = read_capped(&input[..]);
        assert_eq!(result.as_ref().map(String::len), Some(input.len()));
    }

    /// Fix regression: an oversized payload (one byte over the cap)
    /// must be rejected (`None`), not silently truncated into a
    /// shorter string that might still happen to parse as JSON.
    #[test]
    fn read_capped_rejects_input_one_byte_over_the_cap() {
        let input = vec![b'a'; MAX_HOOK_PAYLOAD_BYTES as usize + 1];
        assert_eq!(read_capped(&input[..]), None);
    }

    /// A much larger oversized payload must also be rejected, not just
    /// the exact boundary case -- confirms the cap does not merely
    /// happen to work at one specific size.
    #[test]
    fn read_capped_rejects_a_much_larger_oversized_payload() {
        let input = vec![b'a'; MAX_HOOK_PAYLOAD_BYTES as usize * 4];
        assert_eq!(read_capped(&input[..]), None);
    }
}
