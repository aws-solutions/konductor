// SPDX-License-Identifier: Apache-2.0
//
// telemetry_hook.rs — `konductor __telemetry-hook <event-type>`: parses
// a runtime hook's stdin payload and calls
// straight into `telemetry::report_agent_invocation`/
// `report_subagent_invocation`.
//
// This is the one call site where a hook is genuinely necessary:
// `konductor-rs` has no process running at the moment a runtime session
// starts, or a delegation begins, to observe that event any other way.
// A malformed or non-JSON stdin payload exits quietly (0) without
// panicking and without calling `report_*` -- this subcommand's own
// failure must never surface as a visible error to the harness that
// invoked it.

use std::io::Read as _;

use super::telemetry;

/// `event_type` argument values this subcommand recognizes. `pub(crate)`
/// so `install::resource_rewrite`'s `TELEMETRY_HOOK_ENTRIES` can
/// reference these same constants when building the `__telemetry-hook`
/// command strings it wires into `.claude/settings.json`, rather than
/// duplicating the literal `"agent-invocation"`/`"subagent-invocation"`
/// strings there -- a rename on either side is then a compile error on
/// the other, not a silent runtime mismatch between what gets wired in
/// and what this match actually recognizes.
pub(crate) const AGENT_INVOCATION: &str = "agent-invocation";
pub(crate) const SUBAGENT_INVOCATION: &str = "subagent-invocation";

/// A runtime hook payload's fields this subcommand actually reads.
/// Every other field the real payload carries (cwd, transcript_path,
/// assistant_response, ...) is ignored -- this subcommand extracts
/// exactly `sessionId`/`agent_id`/`agent_type` and nothing else,
/// consistent with the "every field is a name or a one-way hash,
/// never file contents" principle applied one level up: it never even
/// reads the fields that WOULD carry file contents/paths.
///
/// Session id field name varies by harness convention in the wild
/// (`session_id` snake_case is Claude Code's documented payload shape;
/// `sessionId` camelCase is accepted too in case a future/alternate
/// payload uses it) -- both are attempted, first match wins.
#[derive(Debug, Default, serde::Deserialize)]
struct HookPayload {
    #[serde(default, alias = "sessionId")]
    session_id: Option<String>,
    /// The specialist/agent name for a `SubagentStart`-shaped payload.
    /// Field name is not fully confirmed for either harness -- `agent_type`
    /// is Claude Code's documented field for this; `agent_name` is
    /// accepted as a fallback.
    #[serde(default, alias = "agent_name")]
    agent_type: Option<String>,
}

/// Resolves a hook payload's `agent_type` field to a reportable agent
/// name, falling back to `"<unknown>"` -- treating an empty-string value
/// (a payload field present but blank) the SAME as a fully-absent
/// (`None`) one. `unwrap_or_else` alone only triggers on `None`, so a
/// present-but-empty value would otherwise report as agent name `""`
/// instead of falling back to `"<unknown>"`. Shared by both the
/// `AGENT_INVOCATION` and `SUBAGENT_INVOCATION` match arms below, and
/// directly unit-testable in isolation (unlike
/// `report_agent_invocation`/`report_subagent_invocation` themselves,
/// which read `install-info.json` per call and so need a real target
/// directory on disk to test against).
fn resolve_agent_name(agent_type: Option<String>) -> String {
    agent_type
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "<unknown>".to_string())
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

/// Parses `stdin_payload` as JSON and calls the matching `report_*`
/// function. Returns without calling anything if the payload is
/// oversized (see `MAX_HOOK_PAYLOAD_BYTES`), malformed, non-JSON, or
/// `event_type` is not one this subcommand recognizes -- never panics.
pub(crate) fn dispatch_telemetry_hook(target_dir: &std::path::Path, event_type: &str) {
    // Oversized/unreadable input is never surfaced as an error -- this
    // subcommand's own failure must stay invisible to the harness that
    // invoked it (see this module's own doc comment) -- just declined,
    // the same silent no-op every other malformed-input case in this
    // function already takes.
    let Some(buf) = read_capped(std::io::stdin()) else {
        return;
    };
    let Ok(payload) = serde_json::from_str::<HookPayload>(&buf) else {
        return;
    };

    match event_type {
        AGENT_INVOCATION => {
            let agent_name = resolve_agent_name(payload.agent_type);
            telemetry::report_agent_invocation(target_dir, &agent_name, payload.session_id);
        }
        SUBAGENT_INVOCATION => {
            let specialist_name = resolve_agent_name(payload.agent_type);
            // parentSessionId is derived from THIS hook's own
            // sessionId, the same value as this event's own sessionId --
            // never a lookup of the orchestrator's own agent_invocation
            // event, which fires independently in a different,
            // already-exited process.
            telemetry::report_subagent_invocation(
                target_dir,
                &specialist_name,
                payload.session_id.clone(),
                payload.session_id,
            );
        }
        // An `event_type` argument this subcommand doesn't recognize --
        // e.g. a stale wired hook command left over from an older
        // binary, or a hand-edited `settings.json`. Never silent: this
        // subcommand's own failure must not surface as a visible error
        // to the harness that invoked it (see this module's own doc
        // comment), so a warning to stderr -- not a panic, not a
        // `report_*` call -- is the most this call site can safely do.
        _ => {
            eprintln!(
                "warning: konductor __telemetry-hook received an unrecognized event_type \
                 {event_type:?}; no telemetry event was reported"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_payload_parses_camel_case_session_id() {
        let payload: HookPayload =
            serde_json::from_str(r#"{"sessionId":"abc123","agent_type":"orchestrator"}"#).unwrap();
        assert_eq!(payload.session_id, Some("abc123".to_string()));
        assert_eq!(payload.agent_type, Some("orchestrator".to_string()));
    }

    #[test]
    fn hook_payload_parses_snake_case_session_id() {
        let payload: HookPayload = serde_json::from_str(r#"{"session_id":"abc123"}"#).unwrap();
        assert_eq!(payload.session_id, Some("abc123".to_string()));
    }

    #[test]
    fn hook_payload_defaults_gracefully_on_kiro_cli_shaped_payload() {
        // Kiro CLI's `stop` payload is exactly
        // {hook_event_name, cwd, assistant_response} -- no session id
        // field at all. Must parse without error, with both
        // fields defaulting to None.
        let payload: HookPayload = serde_json::from_str(
            r#"{"hook_event_name":"stop","cwd":"/tmp","assistant_response":"done"}"#,
        )
        .unwrap();
        assert_eq!(payload.session_id, None);
        assert_eq!(payload.agent_type, None);
    }

    #[test]
    fn malformed_json_is_tolerated_without_panic() {
        let result = serde_json::from_str::<HookPayload>("not json at all");
        assert!(result.is_err());
    }

    /// Fix regression: a present-but-empty `agent_type` (`Some("")`)
    /// must fall back to `"<unknown>"` the same as a fully-absent
    /// (`None`) one -- `unwrap_or_else` alone only triggers on `None`,
    /// so without `resolve_agent_name`'s own filter this would report
    /// an empty agent name instead.
    #[test]
    fn resolve_agent_name_treats_empty_string_as_absent() {
        assert_eq!(resolve_agent_name(Some(String::new())), "<unknown>");
        assert_eq!(resolve_agent_name(None), "<unknown>");
    }

    /// Positive control: a genuinely non-empty `agent_type` must pass
    /// through unchanged, proving the empty-string filter doesn't also
    /// swallow real values.
    #[test]
    fn resolve_agent_name_passes_through_a_non_empty_value() {
        assert_eq!(
            resolve_agent_name(Some("k-developer".to_string())),
            "k-developer"
        );
    }

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
