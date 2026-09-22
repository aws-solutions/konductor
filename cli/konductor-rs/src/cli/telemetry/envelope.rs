// SPDX-License-Identifier: Apache-2.0
//
// Per-invocation event schema and the ingestion API's outer envelope.
//
// `Data`'s seven fields have no documented counterpart to match by
// name, so they're camelCase by convention. The outer four fields
// (`Solution`/`Version`/`UUID`/`TimeStamp`) match the API's own
// documented casing exactly.

use serde::Serialize;

use super::super::time::utc_now_iso_millis;

/// This crate's closed, additive event-type enum -- seven values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EventType {
    AgentInvocation,
    SubagentInvocation,
    // Never constructed here: mcp_tool_call events come only from
    // skill-lookup-core's own copy of this enum, since the two crates
    // aren't workspace-linked. Kept so this enum still matches the
    // full 7-value schema it documents.
    #[allow(dead_code)]
    McpToolCall,
    CliError,
    PackageUninstalled,
    PackageInstalled,
    PackageVersionUpdated,
}

impl EventType {
    fn as_str(self) -> &'static str {
        match self {
            EventType::AgentInvocation => "agent_invocation",
            EventType::SubagentInvocation => "subagent_invocation",
            EventType::McpToolCall => "mcp_tool_call",
            EventType::CliError => "cli_error",
            EventType::PackageUninstalled => "package_uninstalled",
            EventType::PackageInstalled => "package_installed",
            EventType::PackageVersionUpdated => "package_version_updated",
        }
    }
}

/// The per-invocation event schema, nested under the outer envelope's
/// `Data` field. No `UUID`/`version`/`schemaVersion` here: identity and
/// version live only in the outer envelope; `schemaVersion` is dropped.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct EventEnvelope {
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(rename = "eventType")]
    pub event_type: &'static str,
    #[serde(rename = "targetName")]
    pub target_name: String,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(rename = "parentSessionId")]
    pub parent_session_id: Option<String>,
    #[serde(rename = "errorCode")]
    pub error_code: Option<String>,
    pub harness: Option<String>,
    /// `agent_version` degrades to null rather than defaulting --
    /// populated only on `package_installed`/`package_version_updated`.
    #[serde(rename = "agentVersion")]
    pub agent_version: Option<String>,
    #[serde(rename = "TimeStamp")]
    pub time_stamp: String,
}

impl EventEnvelope {
    /// Builds an event envelope, filling `eventId` and `TimeStamp`.
    /// `uuid` is used only as `eventId` entropy, never duplicated as a
    /// `Data`-level field. `agent_version` is `None` except for
    /// `package_installed`/`package_version_updated`.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build(
        event_type: EventType,
        target_name: impl Into<String>,
        uuid: &str,
        session_id: Option<String>,
        parent_session_id: Option<String>,
        error_code: Option<String>,
        harness: Option<String>,
        agent_version: Option<String>,
    ) -> Self {
        EventEnvelope {
            event_id: build_event_id(uuid),
            event_type: event_type.as_str(),
            target_name: target_name.into(),
            session_id,
            parent_session_id,
            error_code,
            harness,
            agent_version,
            time_stamp: utc_now_iso_millis(),
        }
    }
}

fn build_event_id(uuid: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let input = format!("{uuid}-{nanos}-{}", std::process::id());
    super::super::install::artifact::sha256_hex(input.as_bytes())
}

/// The ingestion API's outer envelope: `Solution`/`Version`/`UUID`/
/// `TimeStamp` wrapping a `Data` object holding the `EventEnvelope`.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct OuterEnvelope {
    #[serde(rename = "Solution")]
    pub solution: &'static str,
    #[serde(rename = "Version")]
    pub version: String,
    #[serde(rename = "UUID")]
    pub uuid: String,
    #[serde(rename = "TimeStamp")]
    pub time_stamp: String,
    #[serde(rename = "Data")]
    pub data: EventEnvelope,
}

impl OuterEnvelope {
    /// Wraps `data` in the outer envelope. `version` reads live from
    /// `env!("CARGO_PKG_VERSION")`, never a cached identity record's
    /// frozen `version` field.
    pub(crate) fn wrap(data: EventEnvelope, uuid: String) -> Self {
        OuterEnvelope {
            solution: super::report::SOLUTION_ID,
            version: env!("CARGO_PKG_VERSION").to_string(),
            uuid,
            time_stamp: wire_timestamp_now(),
            data,
        }
    }
}

/// Formats "now" as the outer envelope's `"YYYY-MM-DD HH:MM:SS.f"`
/// shape, independently of `Data.TimeStamp`.
fn wire_timestamp_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let (y, m, d) = super::super::time::civil_from_days((secs / 86400) as i64);
    let rem = secs % 86400;
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    format!(
        "{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}.{}",
        millis / 100
    )
}

/// Fixed all-zero 64-char hex sentinel used as the outer envelope's
/// `UUID` for unattributed usage, never random, so every unattributed
/// event groups together. Production imports it directly from
/// `konductor_telemetry`; this re-export is test-only.
#[cfg(test)]
use konductor_telemetry::NIL_UUID_SENTINEL;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nil_uuid_sentinel_is_64_zero_chars() {
        assert_eq!(NIL_UUID_SENTINEL.len(), 64);
        assert!(NIL_UUID_SENTINEL.chars().all(|c| c == '0'));
    }

    #[test]
    fn event_envelope_serializes_with_camelcase_field_names() {
        let env = EventEnvelope::build(
            EventType::CliError,
            "install",
            NIL_UUID_SENTINEL,
            None,
            None,
            Some("init.create_dir_failed".to_string()),
            Some("kiro-cli".to_string()),
            None,
        );
        let json = serde_json::to_value(&env).unwrap();
        assert_eq!(json["eventType"], "cli_error");
        assert_eq!(json["targetName"], "install");
        assert_eq!(json["errorCode"], "init.create_dir_failed");
        assert_eq!(json["harness"], "kiro-cli");
        assert!(
            json["agentVersion"].is_null(),
            "agentVersion must serialize as an explicit JSON null for a cli_error event, \
             never be omitted"
        );
        assert!(json.get("UUID").is_none(), "Data must never carry UUID");
        assert!(
            json.get("schemaVersion").is_none(),
            "Data must never carry schemaVersion"
        );
        assert!(
            json.get("version").is_none(),
            "Data must never carry version"
        );
    }

    /// `Data.TimeStamp` must carry millisecond precision, matching
    /// `docs/telemetry-schema.json`'s examples and the MCP-side
    /// producer's `iso8601_now()`.
    #[test]
    fn event_envelope_time_stamp_has_millisecond_precision() {
        let env = EventEnvelope::build(
            EventType::CliError,
            "install",
            NIL_UUID_SENTINEL,
            None,
            None,
            None,
            None,
            None,
        );
        assert_eq!(
            env.time_stamp.len(),
            24,
            "Data.TimeStamp must be millisecond-precision (24 chars), got: {:?}",
            env.time_stamp
        );
        assert_eq!(env.time_stamp.as_bytes()[19], b'.');
        assert!(env.time_stamp.ends_with('Z'));
    }

    #[test]
    fn event_envelope_carries_agent_version_when_present() {
        let env = EventEnvelope::build(
            EventType::PackageInstalled,
            "kiro-cli",
            "a".repeat(64).as_str(),
            None,
            None,
            None,
            None,
            Some("1.2.3".to_string()),
        );
        let json = serde_json::to_value(&env).unwrap();
        assert_eq!(json["agentVersion"], "1.2.3");
    }

    #[test]
    fn outer_envelope_wraps_with_required_fields() {
        let env = EventEnvelope::build(
            EventType::PackageInstalled,
            "kiro-cli",
            "a".repeat(64).as_str(),
            None,
            None,
            None,
            None,
            None,
        );
        let outer = OuterEnvelope::wrap(env, "a".repeat(64));
        let json = serde_json::to_value(&outer).unwrap();
        assert_eq!(json["Solution"], super::super::report::SOLUTION_ID);
        assert_eq!(json["Version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(json["UUID"], "a".repeat(64));
        assert!(json["TimeStamp"].as_str().unwrap().contains(' '));
        assert!(json["Data"].is_object());
    }
}
