// SPDX-License-Identifier: Apache-2.0
//
// install/resource_rewrite/hook_locator.rs - where each install strategy
// writes the orchestration session-start hook, and how `doctor` reads its
// commands back. The writers live in `telemetry_hook_pass.rs` and
// `claude_settings.rs`; this module shares their path and trigger constants
// and `command_is_hook`, and the round-trip tests below pin that it reads
// what they write.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::claude_settings::{command_is_hook, HookId};
use super::telemetry_hook_pass::{AGENT_SPAWN_TRIGGER_V2, V3_SESSION_START_TRIGGER};
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
            .filter(|hook| {
                hook.get("trigger").and_then(Value::as_str) == Some(V3_SESSION_START_TRIGGER)
            })
            .filter_map(|hook| hook.get("action").and_then(|action| action.get("command"))),
    )
}

/// `hooks.agentSpawn[].command` in the v2 `konductor` agent file.
fn v2_commands(agent: &Value) -> Vec<String> {
    orchestration_commands(
        json_array(
            agent
                .get("hooks")
                .and_then(|hooks| hooks.get(AGENT_SPAWN_TRIGGER_V2)),
        )
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

#[cfg(test)]
mod tests {
    use std::fs;

    use super::super::claude_settings::{hook_command_exe, hook_command_install_root};
    use super::super::telemetry_hook_pass::{
        apply_v3_orchestration_hook_with_exe, wire_v2_orchestration_hook,
    };
    use super::super::{claude_settings, ORCHESTRATION_HOOK_MARKER};
    use super::*;
    use crate::cli::install::manifest::{ManifestFile, Provenance, Status};

    const PLAIN_EXE: &str = "/opt/konductor/bin/konductor";
    const EXE_WITH_SPACE: &str = "/opt/Application Support/konductor/konductor";

    fn scratch_dir(label: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-hook-locator-{label}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn slot(strategy: &str, destination: &Path, listed: &[&str]) -> StrategyManifest {
        let files = listed
            .iter()
            .map(|path| ManifestFile {
                path: path.to_string(),
                sha256: None,
                provenance: Provenance::Created,
            })
            .collect();
        StrategyManifest::new(
            strategy,
            "2026-01-01T00:00:00Z",
            destination.display().to_string(),
            None,
            Status::Complete,
            files,
        )
    }

    fn assert_reads_back(destination: &Path, slot: &StrategyManifest, exe: &str) {
        let wiring = orchestration_hook_wiring(destination, slot).expect("a hook strategy");
        let commands = wiring.commands.expect("the written file is readable");
        assert_eq!(commands.len(), 1, "{}: {commands:?}", slot.strategy);
        assert_eq!(
            hook_command_exe(&commands[0], ORCHESTRATION_HOOK_MARKER).as_deref(),
            Some(exe),
            "{}",
            slot.strategy
        );
        assert_eq!(
            hook_command_install_root(&commands[0]),
            Some(fs::canonicalize(destination).unwrap().display().to_string()),
            "{}",
            slot.strategy
        );
    }

    #[test]
    fn kiro_v3_writer_output_reads_back() {
        for exe in [PLAIN_EXE, EXE_WITH_SPACE] {
            let destination = scratch_dir("v3");
            let (path, _) = apply_v3_orchestration_hook_with_exe(&destination, exe).unwrap();
            let slot = slot(kiro_cli_v3::STRATEGY_NAME, &destination, &[path.as_str()]);
            assert_reads_back(&destination, &slot, exe);
            fs::remove_dir_all(&destination).ok();
        }
    }

    #[test]
    fn kiro_v2_writer_output_reads_back() {
        for exe in [PLAIN_EXE, EXE_WITH_SPACE] {
            let destination = scratch_dir("v2");
            let mut agent = serde_json::json!({"name": crate::cli::orchestration_hook::MODE_AGENT});
            wire_v2_orchestration_hook(&mut agent, exe, Some(&destination));
            let file = destination.join(format!(
                ".kiro/agents/{}.json",
                crate::cli::orchestration_hook::MODE_AGENT
            ));
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, agent.to_string()).unwrap();
            let slot = slot(kiro_cli::STRATEGY_NAME, &destination, &[]);
            assert_reads_back(&destination, &slot, exe);
            fs::remove_dir_all(&destination).ok();
        }
    }

    #[test]
    fn claude_writer_output_reads_back() {
        for exe in [PLAIN_EXE, EXE_WITH_SPACE] {
            let destination = scratch_dir("claude");
            claude_settings::apply_claude_settings_hooks_with_exe(&destination, true, exe).unwrap();
            let slot = slot(claude::STRATEGY_NAME, &destination, &[]);
            assert_reads_back(&destination, &slot, exe);
            fs::remove_dir_all(&destination).ok();
        }
    }
}
