// SPDX-License-Identifier: Apache-2.0
//
// Runs the real `konductor synth` over a copy of this repo's own agents,
// skills, SOPs and context, then checks the "Your skills" block synth
// appends to every Kiro agent's prompt and leaves out of every Claude
// Code agent. A copy keeps the checkout's own
// `dist/` untouched; `HOME` points at the scratch dir and telemetry at
// the loopback sink.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

const SKILLS_HEADING: &str = "## Your skills";
const ORCHESTRATOR_MARKER: &str = "You orchestrate.";
// Skills whose description starts "MUST USE for every "; synth leaves
// them out of the index.
const EVERY_TASK_SKILLS: &[&str] = &["constraints"];
const TRIGGER_SLACK_CHARS: usize = 165;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn scratch_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-synth-skill-index-e2e-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &dest);
        } else {
            std::fs::copy(entry.path(), &dest).unwrap();
        }
    }
}

/// Synths a copy of the repo's source tree once and returns its root.
fn synth_repo_copy() -> PathBuf {
    let dir = scratch_dir();
    for sub in ["agents", "skills", "agent-sops", "context"] {
        copy_tree(&repo_root().join(sub), &dir.join(sub));
    }
    let sink = telemetry_test_sink::TelemetrySink::start();
    let mut command = Command::new(env!("CARGO_BIN_EXE_konductor"));
    command
        .args(["synth", "--from", &dir.display().to_string()])
        .current_dir(&dir)
        .env("HOME", &dir);
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    let output = command.output().expect("failed to spawn konductor");
    assert!(
        output.status.success(),
        "synth failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    dir
}

struct SourceAgent {
    skill_names: Vec<String>,
}

fn source_agents(root: &Path) -> BTreeMap<String, SourceAgent> {
    let mut agents = BTreeMap::new();
    for entry in std::fs::read_dir(root.join("agents")).unwrap() {
        let path = entry.unwrap().path();
        let spec: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let strings = |v: &serde_json::Value| -> Vec<String> {
            v.as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|s| s.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        };
        agents.insert(
            spec["name"].as_str().unwrap().to_string(),
            SourceAgent {
                skill_names: strings(&spec["dependencies"]["skills"]["skillNames"]),
            },
        );
    }
    agents
}

fn block_of(prompt: &str) -> &str {
    let start = prompt
        .rfind(SKILLS_HEADING)
        .unwrap_or_else(|| panic!("no skills block in prompt"));
    &prompt[start..]
}

fn kiro_prompt(root: &Path, harness: &str, agent: &str) -> String {
    let path = root
        .join("dist")
        .join(harness)
        .join("agents")
        .join(format!("{agent}.json"));
    let parsed: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    parsed["prompt"].as_str().unwrap().to_string()
}

fn listed_names(block: &str) -> Vec<String> {
    block
        .lines()
        .filter_map(|l| l.strip_prefix("- "))
        .map(|rest| rest.split(':').next().unwrap().to_string())
        .collect()
}

#[test]
fn synth_appends_each_agents_own_skill_index_on_kiro_only() {
    let root = synth_repo_copy();
    let agents = source_agents(&root);
    assert!(agents.contains_key("k-developer") && agents.contains_key("konductor"));

    for harness in ["kiro-cli-v2", "kiro-v3"] {
        for (name, source) in &agents {
            let prompt = kiro_prompt(&root, harness, name);
            if source.skill_names.is_empty() {
                assert!(
                    !prompt.contains(SKILLS_HEADING),
                    "{harness}/{name}: an agent with no skills gets no skills block"
                );
                continue;
            }
            let block = block_of(&prompt);
            let expected: Vec<String> = source
                .skill_names
                .iter()
                .filter(|s| !EVERY_TASK_SKILLS.contains(&s.as_str()))
                .cloned()
                .collect();
            assert_eq!(
                listed_names(block),
                expected,
                "{harness}/{name}: index must list the declared skillNames in order, \
                 minus every-task skills"
            );
            for skill in EVERY_TASK_SKILLS {
                assert!(
                    !block.contains(&format!("`{skill}`")),
                    "{harness}/{name}: {skill} must not be named in the block"
                );
            }
            assert!(block.contains("`get_skill`") && block.contains("`tool_load`"));
            assert_eq!(
                block.contains(ORCHESTRATOR_MARKER),
                name.starts_with("konductor"),
                "{harness}/{name}: orchestrator paragraph"
            );
            for line in block.lines().filter(|l| l.starts_with("- ")) {
                let skill = line[2..].split(':').next().unwrap();
                assert!(
                    line.chars().count() <= skill.len() + TRIGGER_SLACK_CHARS,
                    "{harness}/{name}: line too long: {line}"
                );
            }
            assert!(!block.contains('\u{2014}') && !block.contains('\u{2013}'));
        }
    }

    for name in agents.keys() {
        let md =
            std::fs::read_to_string(root.join("dist/claude/agents").join(format!("{name}.md")))
                .unwrap();
        assert!(
            !md.contains(SKILLS_HEADING),
            "claude/{name}: Claude Code agents carry no skill block"
        );
        assert!(!md.contains(ORCHESTRATOR_MARKER), "claude/{name}");
    }

    let _ = std::fs::remove_dir_all(&root);
}
