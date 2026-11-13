// SPDX-License-Identifier: Apache-2.0
//
// synth/spawn_policy.rs -- spawn policy for every harness: which agents may
// spawn, and which tool ids, tags and names mean "start another agent". The
// transformers and the parser read this module and nothing else for that
// question.

use super::model::is_orchestrator;

/// Every agent that is not a `konductor*` orchestrator is a specialist. Only
/// the orchestrators delegate, so each harness transformer strips spawn tools
/// from every other agent's config; an agent outside both naming conventions
/// loses its spawn tools rather than keeping them.
pub(crate) fn is_specialist(agent_name: &str) -> bool {
    !is_orchestrator(agent_name)
}

/// Only `konductor` keeps the v2 engine's spawn tools. The mux and cmux
/// orchestrators dispatch through shell panes and never call `subagent`,
/// so the v2 transformer gives them the same explicit built-in list as a
/// specialist.
pub(crate) fn holds_kiro_v2_spawn_tools(agent_name: &str) -> bool {
    agent_name == "konductor"
}

/// Kiro's permission capability for spawning; also the v3 tool tag.
pub(crate) const SUBAGENT_CAPABILITY: &str = "subagent";

/// Every Kiro tool id or tag that starts another agent. `use_subagent` and
/// `agent_crew` are the ids v3 renames to the `subagent` tag.
pub(crate) const KIRO_SPAWN_TOOL_IDS: [&str; 3] = ["subagent", "use_subagent", "agent_crew"];

/// True for an id in `KIRO_SPAWN_TOOL_IDS` or a scoped `subagent/<agent>`
/// tag. `*` and `@builtin` are not spawn ids: they are wildcards the
/// transformers expand or exclude.
pub(crate) fn is_kiro_spawn_tool(id_or_tag: &str) -> bool {
    KIRO_SPAWN_TOOL_IDS.contains(&id_or_tag)
        || id_or_tag
            .strip_prefix(SUBAGENT_CAPABILITY)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// True for `{"availableAgents": [], "trustedAgents": []}`, the list every
/// specialist carries. It is not a grant, and it is not a block on Kiro CLI
/// v2 either: the v2 `subagent` tool stays in `@builtin`; #149 removes the
/// tool. A missing list or any named agent is a grant.
pub(crate) fn is_empty_subagent_target_list(settings: &serde_json::Value) -> bool {
    ["availableAgents", "trustedAgents"].iter().all(|key| {
        settings
            .get(key)
            .and_then(serde_json::Value::as_array)
            .is_some_and(Vec::is_empty)
    })
}

/// v3 built-ins a specialist must not hold even under `--trust-all-tools`.
/// Dropping the `subagent` tag is not enough: `@builtin` also carries
/// `run_workflow`, which runs any agent via `agent://<name>`, and no
/// permission rule gates it. `excludedTools` removes both (checked against
/// kiro-cli 2.35.0, engine v3).
///
/// Re-probe after a kiro-cli upgrade: open `kiro-cli chat --agent k-developer`
/// from a scratch install, run `/tools`, and confirm no tool whose name
/// contains `sub_agent`, `workflow`, `agent`, `delegate` or `spawn` is listed
/// outside this constant. No CI job does this (runners have no kiro-cli).
pub(crate) const KIRO_V3_SPECIALIST_EXCLUDED_TOOLS: [&str; 2] =
    ["invoke_sub_agent", "run_workflow"];

/// Claude Code tools that start another agent. `Task` is the older name of
/// `Agent`.
pub(crate) const CLAUDE_SPAWN_TOOLS: [&str; 3] = ["Agent", "Task", "Workflow"];

/// Matches a bare spawn tool or its scoped form, e.g. `Agent(k-developer)`.
pub(crate) fn is_claude_spawn_tool(tool: &str) -> bool {
    let base = tool.split('(').next().unwrap_or(tool).trim();
    CLAUDE_SPAWN_TOOLS.contains(&base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_specialist_is_every_agent_but_the_orchestrators() {
        assert!(is_specialist("k-architect"));
        assert!(is_specialist("reviewer"));
        assert!(!is_specialist("konductor"));
        assert!(!is_specialist("konductor-mux-orchestrator"));
        assert!(!is_specialist("konductor-cmux-orchestrator"));
    }

    #[test]
    fn only_konductor_holds_kiro_v2_spawn_tools() {
        assert!(holds_kiro_v2_spawn_tools("konductor"));
        assert!(!holds_kiro_v2_spawn_tools("konductor-mux-orchestrator"));
        assert!(!holds_kiro_v2_spawn_tools("konductor-cmux-orchestrator"));
        assert!(!holds_kiro_v2_spawn_tools("k-architect"));
    }

    #[test]
    fn is_kiro_spawn_tool_matches_ids_and_scoped_tags() {
        for id in KIRO_SPAWN_TOOL_IDS {
            assert!(is_kiro_spawn_tool(id), "{id}");
        }
        assert!(is_kiro_spawn_tool("subagent/k-developer"));
    }

    #[test]
    fn is_kiro_spawn_tool_rejects_wildcards_and_look_alikes() {
        for id in [
            "*",
            "@builtin",
            "shell",
            "agentCrew",
            "subagents",
            "subagent_x",
        ] {
            assert!(!is_kiro_spawn_tool(id), "{id}");
        }
    }

    #[test]
    fn is_empty_subagent_target_list_needs_both_lists_empty() {
        assert!(is_empty_subagent_target_list(&serde_json::json!({
            "availableAgents": [], "trustedAgents": []
        })));
        for settings in [
            serde_json::json!({}),
            serde_json::json!({"availableAgents": []}),
            serde_json::json!({"availableAgents": ["k-developer"], "trustedAgents": []}),
            serde_json::json!({"availableAgents": [], "trustedAgents": ["k-developer"]}),
        ] {
            assert!(!is_empty_subagent_target_list(&settings), "{settings}");
        }
    }

    #[test]
    fn is_claude_spawn_tool_matches_bare_and_scoped_forms() {
        for tool in ["Agent", "Task", "Workflow", "Agent(k-developer)"] {
            assert!(is_claude_spawn_tool(tool), "{tool}");
        }
        assert!(!is_claude_spawn_tool("Read"));
    }
}
