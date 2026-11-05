// SPDX-License-Identifier: Apache-2.0
//
// install/resource_rewrite/hook_locator.rs - where each install strategy
// writes the orchestration session-start hook, and how to read its
// commands back. It lives beside the writers so a change to a hook's path
// or JSON shape reaches `doctor` through this one module.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::claude_settings::{command_is_hook, HookId};
use super::{claude_hooks_settings_relative_path, V3_ORCHESTRATION_HOOKS_RELATIVE_PATH};
use crate::cli::install::manifest::StrategyManifest;
use crate::cli::install::{claude, kiro_cli, kiro_cli_v3};

/// Where a strategy slot's orchestration hook lives, and the hook
/// commands found there (or why none could be read).
pub(crate) struct HookWiring {
    pub(crate) file: PathBuf,
    pub(crate) commands: Result<Vec<String>, String>,
}

/// The hook file for `slot` and its orchestration hook commands. `None`
/// for a strategy that wires no orchestration hook.
pub(crate) fn orchestration_hook_wiring(
    destination: &Path,
    slot: &StrategyManifest,
) -> Option<HookWiring> {
    let v2_agent_file = format!(
        ".kiro/agents/{}.json",
        crate::cli::orchestration_hook::MODE_AGENT
    );
    let (relative, commands): (&str, fn(&Value) -> Vec<String>) = match slot.strategy.as_str() {
        kiro_cli_v3::STRATEGY_NAME => (V3_ORCHESTRATION_HOOKS_RELATIVE_PATH, v3_commands),
        kiro_cli::STRATEGY_NAME => (v2_agent_file.as_str(), v2_commands),
        claude::STRATEGY_NAME => (
            claude_hooks_settings_relative_path(destination),
            claude_commands,
        ),
        _ => return None,
    };
    let file = destination.join(relative);
    // A v3 document the slot does not list is a leftover or hand-placed
    // file, not one this install wrote.
    let unlisted = slot.strategy == kiro_cli_v3::STRATEGY_NAME
        && !slot.files.iter().any(|f| f.path == relative);
    let commands = if unlisted {
        Err("the file is not listed in the install manifest".to_string())
    } else {
        read_json(&file).map(|value| commands(&value))
    };
    Some(HookWiring { file, commands })
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => "the file does not exist".to_string(),
        _ => format!("the file could not be read ({err})"),
    })?;
    serde_json::from_str(&text).map_err(|err| format!("the file is not valid JSON ({err})"))
}

fn orchestration_commands<'a>(entries: impl Iterator<Item = &'a Value>) -> Vec<String> {
    entries
        .filter_map(Value::as_str)
        .filter(|command| command_is_hook(command, HookId::OrchestrationMode))
        .map(str::to_string)
        .collect()
}

fn json_array(value: Option<&Value>) -> impl Iterator<Item = &Value> {
    value.and_then(Value::as_array).into_iter().flatten()
}

/// `hooks[]` entries with `trigger: SessionStart`, their `action.command`.
fn v3_commands(document: &Value) -> Vec<String> {
    orchestration_commands(
        json_array(document.get("hooks"))
            .filter(|hook| hook.get("trigger").and_then(Value::as_str) == Some("SessionStart"))
            .filter_map(|hook| hook.get("action").and_then(|action| action.get("command"))),
    )
}

/// `hooks.agentSpawn[].command` in the v2 `konductor` agent file.
fn v2_commands(agent: &Value) -> Vec<String> {
    orchestration_commands(
        json_array(agent.get("hooks").and_then(|hooks| hooks.get("agentSpawn")))
            .filter_map(|entry| entry.get("command")),
    )
}

/// `hooks.SessionStart[].hooks[].command` in a Claude settings file.
fn claude_commands(settings: &Value) -> Vec<String> {
    orchestration_commands(
        json_array(
            settings
                .get("hooks")
                .and_then(|hooks| hooks.get("SessionStart")),
        )
        .flat_map(|block| json_array(block.get("hooks")))
        .filter_map(|hook| hook.get("command")),
    )
}
