// SPDX-License-Identifier: Apache-2.0
//
// install/resource_rewrite/hook_locator.rs - where each install strategy
// writes the orchestration session-start hook, and how `doctor` reads its
// commands back. The writers live in `telemetry_hook_pass.rs` and
// `claude_settings.rs`; this module shares their path constants, the v2 and
// v3 trigger names and `command_is_hook`, and builds the v2 agent path with
// the installer's `content_manifest_path`. The Claude event key is a literal
// here, pinned by `claude_writer_output_reads_back`.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::claude_settings::{command_is_hook, HookId};
use super::telemetry_hook_pass::{AGENT_SPAWN_TRIGGER_V2, V3_SESSION_START_TRIGGER};
use super::{claude_hooks_settings_relative_path, V3_ORCHESTRATION_HOOKS_RELATIVE_PATH};
use crate::cli::install::manifest::StrategyManifest;
use crate::cli::install::{claude, kiro_cli, kiro_cli_v3};
use crate::cli::synth::kiro_cli_v2::AGENTS_CONTENT_TYPE_DIR;

/// Where a strategy slot's orchestration hook lives, and the hook
/// commands found there (or why none could be read).
pub(crate) struct HookWiring {
    pub(crate) file: PathBuf,
    /// The mode agent whose own file carries the hook (Kiro CLI v2 only).
    pub(crate) agent: Option<String>,
    pub(crate) commands: Result<Vec<String>, String>,
}

const UNLISTED: &str = "the file is not listed in the install manifest";

/// The hook files for `slot` and their orchestration hook commands: one
/// per mode agent on Kiro CLI v2, where each mode agent's own file
/// carries the hook, else one. Empty for a strategy that wires no
/// orchestration hook.
pub(crate) fn orchestration_hook_wirings(
    destination: &Path,
    slot: &StrategyManifest,
) -> Vec<HookWiring> {
    let (relative, commands): (&str, fn(&Value) -> Vec<String>) = match slot.strategy.as_str() {
        kiro_cli_v3::STRATEGY_NAME => (V3_ORCHESTRATION_HOOKS_RELATIVE_PATH, v3_commands),
        kiro_cli::STRATEGY_NAME => return v2_wirings(destination, slot),
        claude::STRATEGY_NAME => (
            claude_hooks_settings_relative_path(destination),
            claude_commands,
        ),
        _ => return Vec::new(),
    };
    let file = destination.join(relative);
    // A v3 document the slot does not list is a leftover or hand-placed
    // file, not one this install wrote.
    let unlisted = slot.strategy == kiro_cli_v3::STRATEGY_NAME
        && !slot.files.iter().any(|f| f.path == relative);
    let commands = if unlisted {
        Err(UNLISTED.to_string())
    } else {
        read_json(&file).map(|value| commands(&value))
    };
    vec![HookWiring {
        file,
        agent: None,
        commands,
    }]
}

fn v2_agent_path(name: &str) -> String {
    kiro_cli::content_manifest_path(
        kiro_cli::KIRO_DESTINATION_ROOT,
        AGENTS_CONTENT_TYPE_DIR,
        &format!("{name}.json"),
    )
}

/// One wiring per v2 mode agent the slot lists: `konductor`, and every
/// other agent whose file loads the Direct Work context (a renamed
/// orchestrator). Each file is read as the hook reads it, under its
/// 1 MiB cap, so a file too large to check is reported here as the hook
/// reports it. A missing or unparsable file is a mode agent only for
/// `konductor`. With no mode agent listed, `konductor`'s path, so the
/// gap is reported under its usual name.
fn v2_wirings(destination: &Path, slot: &StrategyManifest) -> Vec<HookWiring> {
    let agents_dir = kiro_cli::content_manifest_path(
        kiro_cli::KIRO_DESTINATION_ROOT,
        AGENTS_CONTENT_TYPE_DIR,
        "",
    );
    let mut wirings: Vec<HookWiring> = slot
        .files
        .iter()
        .map(|file| file.path.as_str())
        .filter_map(|path| {
            let name = path
                .strip_prefix(agents_dir.as_str())
                .and_then(|rest| rest.strip_suffix(".json"))
                .filter(|name| !name.is_empty() && !name.contains('/') && !name.starts_with('_'))?;
            let is_konductor = name == crate::cli::orchestration_hook::MODE_AGENT;
            let commands = match read_agent_json(&destination.join(path)) {
                Ok(agent) => {
                    let loads =
                        crate::cli::orchestration_hook::kiro_agent_loads_direct_work(&agent);
                    if !is_konductor && !loads {
                        return None;
                    }
                    Ok(v2_commands(&agent))
                }
                Err(AgentJsonError::TooLarge) => Err(format!(
                    "the file is larger than {} MiB, so the hook could not check whether it \
                     loads {}",
                    crate::cli::orchestration_hook::MAX_AGENT_FILE_BYTES / (1024 * 1024),
                    crate::cli::orchestration_hook::DIRECT_WORK_CONTEXT_FILE_NAME
                )),
                Err(AgentJsonError::Other(reason)) if is_konductor => Err(reason),
                Err(AgentJsonError::Other(_)) => return None,
            };
            Some(HookWiring {
                file: destination.join(path),
                agent: Some(name.to_string()),
                commands,
            })
        })
        .collect();
    if wirings.is_empty() {
        let default = v2_agent_path(crate::cli::orchestration_hook::MODE_AGENT);
        wirings.push(HookWiring {
            file: destination.join(&default),
            agent: Some(crate::cli::orchestration_hook::MODE_AGENT.to_string()),
            commands: Err(UNLISTED.to_string()),
        });
    }
    wirings
}

enum AgentJsonError {
    TooLarge,
    Other(String),
}

/// An agent file under the hook's own read cap; a truncated JSON
/// document never parses, so a file over the cap is not read.
fn read_agent_json(path: &Path) -> Result<Value, AgentJsonError> {
    let (bytes, over) = crate::cli::orchestration_hook::read_agent_file(path, true)
        .map_err(|err| AgentJsonError::Other(io_reason(&err)))?;
    if over {
        return Err(AgentJsonError::TooLarge);
    }
    serde_json::from_slice(&bytes)
        .map_err(|err| AgentJsonError::Other(format!("the file is not valid JSON ({err})")))
}

fn io_reason(err: &std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::NotFound => "the file does not exist".to_string(),
        _ => format!("the file could not be read ({err})"),
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|err| io_reason(&err))?;
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

/// `hooks.agentSpawn[].command` in the v2 mode agent file.
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

    fn only_wiring(destination: &Path, slot: &StrategyManifest) -> HookWiring {
        let mut wirings = orchestration_hook_wirings(destination, slot);
        assert_eq!(wirings.len(), 1, "{}", slot.strategy);
        wirings.remove(0)
    }

    fn assert_reads_back(destination: &Path, slot: &StrategyManifest, exe: &str) {
        let wiring = only_wiring(destination, slot);
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
            wire_v2_orchestration_hook(
                &mut agent,
                exe,
                crate::cli::orchestration_hook::MODE_AGENT,
                Some(&destination),
                Some(crate::cli::install::kiro_cli::STRATEGY_NAME),
            );
            let listed = v2_agent_manifest_path();
            let file = destination.join(&listed);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, agent.to_string()).unwrap();
            let slot = slot(kiro_cli::STRATEGY_NAME, &destination, &[listed.as_str()]);
            assert_reads_back(&destination, &slot, exe);
            fs::remove_dir_all(&destination).ok();
        }
    }

    fn v2_agent_manifest_path() -> String {
        kiro_cli::content_manifest_path(
            kiro_cli::KIRO_DESTINATION_ROOT,
            AGENTS_CONTENT_TYPE_DIR,
            &format!("{}.json", crate::cli::orchestration_hook::MODE_AGENT),
        )
    }

    #[test]
    fn v2_reader_path_equals_the_installer_manifest_entry() {
        let root = scratch_dir("v2-plan");
        let harness_dir = root.join("dist").join(kiro_cli::STRATEGY_NAME);
        let agents_dir = harness_dir.join(AGENTS_CONTENT_TYPE_DIR);
        fs::create_dir_all(&agents_dir).unwrap();
        let agent_name = format!("{}.json", crate::cli::orchestration_hook::MODE_AGENT);
        fs::write(agents_dir.join(&agent_name), r#"{"name":"konductor"}"#).unwrap();
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();

        let planned = kiro_cli::plan_all_files(&harness_dir, &target, None).unwrap();
        let agent_entry = planned
            .iter()
            .find(|entry| entry.manifest_path.ends_with(&agent_name))
            .expect("the installer plans the mode agent file");
        let slot = slot(
            kiro_cli::STRATEGY_NAME,
            &target,
            &[agent_entry.manifest_path.as_str()],
        );
        let wiring = only_wiring(&target, &slot);
        assert_eq!(wiring.file, target.join(&agent_entry.manifest_path));
        assert_ne!(
            wiring.commands.as_ref().err().map(String::as_str),
            Some("the file is not listed in the install manifest")
        );
        fs::remove_dir_all(&root).ok();
    }

    fn agent_path(name: &str) -> String {
        kiro_cli::content_manifest_path(
            kiro_cli::KIRO_DESTINATION_ROOT,
            AGENTS_CONTENT_TYPE_DIR,
            &format!("{name}.json"),
        )
    }

    /// Writes `.kiro/agents/<name>.json` loading `resource`, with an
    /// `agentSpawn` orchestration entry when `hook` is set.
    fn write_v2_agent(destination: &Path, name: &str, resource: &str, hook: bool) {
        let entries: Vec<Value> = hook
            .then(|| {
                serde_json::json!({
                    "command": format!(
                        "{PLAIN_EXE} __orchestration-hook --agent {name} --install-root {}",
                        destination.display()
                    )
                })
            })
            .into_iter()
            .collect();
        let file = destination.join(agent_path(name));
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(
            &file,
            serde_json::json!({
                "name": name,
                "resources": [resource],
                "hooks": {"agentSpawn": entries}
            })
            .to_string(),
        )
        .unwrap();
    }

    const DIRECT_WORK: &str = "file://context/k-direct-work.md";
    const ROUTING_RULES: &str = "file://context/k-orchestrator-routing-rules.md";

    fn v2_slot(destination: &Path, agents: &[&str]) -> StrategyManifest {
        let listed: Vec<String> = agents.iter().map(|name| agent_path(name)).collect();
        let listed: Vec<&str> = listed.iter().map(String::as_str).collect();
        slot(kiro_cli::STRATEGY_NAME, destination, &listed)
    }

    fn wired_agents(wirings: &[HookWiring]) -> Vec<(&str, usize)> {
        wirings
            .iter()
            .map(|wiring| {
                (
                    wiring.agent.as_deref().unwrap_or_default(),
                    wiring.commands.as_ref().map_or(0, Vec::len),
                )
            })
            .collect()
    }

    #[test]
    fn v2_reads_a_renamed_agent_that_loads_direct_work() {
        let destination = scratch_dir("v2-renamed");
        write_v2_agent(&destination, "acme-mux", ROUTING_RULES, false);
        write_v2_agent(&destination, "acme", DIRECT_WORK, true);
        let wiring = only_wiring(&destination, &v2_slot(&destination, &["acme-mux", "acme"]));
        assert_eq!(wiring.file, destination.join(agent_path("acme")));

        let wiring = only_wiring(&destination, &v2_slot(&destination, &["acme-mux"]));
        assert_eq!(wiring.file, destination.join(v2_agent_manifest_path()));
        assert_eq!(wiring.commands.unwrap_err(), UNLISTED);
        fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn v2_reads_konductor_and_every_renamed_mode_agent() {
        let destination = scratch_dir("v2-every-mode-agent");
        write_v2_agent(&destination, "konductor", DIRECT_WORK, true);
        write_v2_agent(&destination, "acme", DIRECT_WORK, true);
        write_v2_agent(
            &destination,
            "k-developer",
            "file://context/k-core-rules.md",
            false,
        );
        let slot = v2_slot(&destination, &["konductor", "k-developer", "acme"]);
        let wirings = orchestration_hook_wirings(&destination, &slot);
        assert_eq!(wired_agents(&wirings), [("konductor", 1), ("acme", 1)]);
        fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn v2_reports_a_renamed_mode_agent_without_its_hook() {
        let destination = scratch_dir("v2-one-unwired");
        write_v2_agent(&destination, "acme", DIRECT_WORK, true);
        write_v2_agent(&destination, "globex", DIRECT_WORK, false);
        let slot = v2_slot(&destination, &["acme", "globex"]);
        let wirings = orchestration_hook_wirings(&destination, &slot);
        assert_eq!(wired_agents(&wirings), [("acme", 1), ("globex", 0)]);
        fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn v2_reads_agent_files_under_the_hook_cap() {
        let destination = scratch_dir("v2-oversized");
        write_v2_agent(&destination, "acme", DIRECT_WORK, true);
        let file = destination.join(agent_path("acme"));
        let mut text = fs::read_to_string(&file).unwrap();
        text.push_str(&" ".repeat(crate::cli::orchestration_hook::MAX_AGENT_FILE_BYTES as usize));
        fs::write(&file, text).unwrap();
        let wiring = only_wiring(&destination, &v2_slot(&destination, &["acme"]));
        assert_eq!(wiring.agent.as_deref(), Some("acme"));
        assert_eq!(
            wiring.commands.unwrap_err(),
            "the file is larger than 1 MiB, so the hook could not check whether it loads \
             k-direct-work.md"
        );

        // `konductor` is a mode agent by name, so its oversized file is
        // reported the same way, not skipped.
        write_v2_agent(&destination, "konductor", DIRECT_WORK, true);
        fs::write(destination.join(agent_path("konductor")), {
            let mut text = fs::read_to_string(destination.join(agent_path("konductor"))).unwrap();
            text.push_str(
                &" ".repeat(crate::cli::orchestration_hook::MAX_AGENT_FILE_BYTES as usize),
            );
            text
        })
        .unwrap();
        let wiring = only_wiring(&destination, &v2_slot(&destination, &["konductor"]));
        assert!(wiring
            .commands
            .unwrap_err()
            .starts_with("the file is larger than 1 MiB"));
        fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn v2_unlisted_agent_file_is_reported() {
        let destination = scratch_dir("v2-unlisted");
        let file = destination.join(v2_agent_manifest_path());
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, r#"{"hooks":{}}"#).unwrap();
        let slot = slot(kiro_cli::STRATEGY_NAME, &destination, &[]);
        let wiring = only_wiring(&destination, &slot);
        assert_eq!(
            wiring.commands.unwrap_err(),
            "the file is not listed in the install manifest"
        );
        fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn claude_writer_output_reads_back() {
        for exe in [PLAIN_EXE, EXE_WITH_SPACE] {
            let destination = scratch_dir("claude");
            claude_settings::apply_claude_settings_hooks_with_exe(
                &destination,
                claude_settings::KONDUCTOR_HOOK_ENTRIES,
                true,
                exe,
            )
            .unwrap();
            let slot = slot(claude::STRATEGY_NAME, &destination, &[]);
            assert_reads_back(&destination, &slot, exe);
            fs::remove_dir_all(&destination).ok();
        }
    }
}
