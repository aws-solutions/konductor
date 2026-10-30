// SPDX-License-Identifier: Apache-2.0
//
// synth_claude_preload_e2e.rs: runs the real `konductor synth` over a
// copy of this repository's own agents/skills tree and checks the
// Claude Code skill preload (`clientConfig.claudeCli.skills`) of every
// agent. Claude Code injects each preloaded SKILL.md into every spawned
// subagent, so this test fails if any agent grows past the budget the
// synth lint warns about.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const BUDGET_BYTES: u64 = 32_768;
const NAME_CAP: usize = 32;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-synth-claude-preload-e2e-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// `HOME` points at the scratch dir so invocation logs stay out of the
/// real home directory; telemetry goes to the loopback `sink`.
fn run_konductor(cwd: &Path, sink: &telemetry_test_sink::TelemetrySink, args: &[&str]) -> Output {
    let mut command = Command::new(bin());
    command.args(args).current_dir(cwd).env("HOME", cwd);
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    command.output().expect("failed to spawn konductor binary")
}

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap_or_else(|e| panic!("create {}: {e}", to.display()));
    let entries =
        std::fs::read_dir(from).unwrap_or_else(|e| panic!("read {}: {e}", from.display()));
    for entry in entries {
        let entry = entry.unwrap();
        let file_type = entry.file_type().unwrap();
        let target = to.join(entry.file_name());
        if file_type.is_dir() {
            copy_tree(&entry.path(), &target);
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &target)
                .unwrap_or_else(|e| panic!("copy {}: {e}", entry.path().display()));
        }
    }
}

/// Copies the repository's `agents/`, `skills/`, `agent-sops/`,
/// `context/` and `VERSION` into a fresh scratch dir and returns it, so
/// `synth --from <dir>` writes `<dir>/dist` and never touches the real
/// checkout.
fn repo_copy(test_name: &str) -> PathBuf {
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let dir = scratch_dir(test_name);
    for sub in ["agents", "skills", "agent-sops", "context"] {
        copy_tree(&repo_root.join(sub), &dir.join(sub));
    }
    std::fs::copy(repo_root.join("VERSION"), dir.join("VERSION")).unwrap();
    dir
}

fn synth(dir: &Path, extra: &[&str]) -> Output {
    let sink = telemetry_test_sink::TelemetrySink::start();
    let from = dir.display().to_string();
    let mut args = vec!["synth", "--from", from.as_str()];
    args.extend_from_slice(extra);
    let output = run_konductor(dir, &sink, &args);
    assert!(
        output.status.success(),
        "synth failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

/// Each agent spec's distinct `clientConfig.claudeCli.skills`, first
/// occurrence wins, for agents that have a `claudeCli` section.
fn claude_preloads(dir: &Path) -> Vec<(String, Vec<String>)> {
    let mut specs: Vec<PathBuf> = std::fs::read_dir(dir.join("agents"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.to_string_lossy().ends_with(".agent-spec.json"))
        .collect();
    specs.sort();
    specs
        .into_iter()
        .filter_map(|path| {
            let spec: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let skills = spec["clientConfig"]["claudeCli"]["skills"].as_array()?;
            let mut names: Vec<String> = Vec::new();
            for name in skills.iter().filter_map(|v| v.as_str()) {
                if !names.iter().any(|n| n == name) {
                    names.push(name.to_string());
                }
            }
            Some((spec["name"].as_str().unwrap().to_string(), names))
        })
        .collect()
}

fn shipped_skill_bytes(dir: &Path, name: &str) -> u64 {
    let path = dir.join("dist/claude/skills").join(name).join("SKILL.md");
    std::fs::metadata(&path)
        .unwrap_or_else(|e| panic!("stat {}: {e}", path.display()))
        .len()
}

fn group_thousands(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

fn write_fixture_agent(dir: &Path, name: &str, claude_skills: &[String]) {
    let spec = serde_json::json!({
        "schemaVersion": "1",
        "name": name,
        "config": {"description": "Fixture.", "systemPrompt": "Fixture.", "model": "m"},
        "clientConfig": {"claudeCli": {"skills": claude_skills}},
    });
    std::fs::write(
        dir.join("agents").join(format!("{name}.agent-spec.json")),
        serde_json::to_string_pretty(&spec).unwrap(),
    )
    .unwrap();
}

#[test]
fn every_agent_preload_is_under_budget_and_cap() {
    let dir = repo_copy("budget");
    synth(&dir, &[]);
    let preloads = claude_preloads(&dir);
    assert!(!preloads.is_empty(), "expected Claude agents in the repo");
    for (agent, names) in preloads {
        let bytes: u64 = names.iter().map(|n| shipped_skill_bytes(&dir, n)).sum();
        assert!(
            bytes <= BUDGET_BYTES,
            "agent '{agent}' preloads {bytes} B, over the {BUDGET_BYTES} B budget"
        );
        assert!(
            names.len() <= NAME_CAP,
            "agent '{agent}' preloads {} names, over the {NAME_CAP}-name cap",
            names.len()
        );
    }
}

#[test]
fn synth_emits_no_preload_warning_for_this_repo() {
    let dir = repo_copy("no-warning");
    let output = synth(&dir, &[]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stderr.contains("preloads"), "unexpected warning: {stderr}");
}

#[test]
fn synth_warns_when_a_fixture_agent_exceeds_the_byte_budget() {
    let dir = repo_copy("fat");
    write_fixture_agent(&dir, "k-fixture-fat", &["dynamodb-design".to_string()]);
    let output = synth(&dir, &[]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let expected = group_thousands(shipped_skill_bytes(&dir, "dynamodb-design"));
    assert!(
        stderr.contains(&format!("agent 'k-fixture-fat' preloads {expected} B")),
        "got: {stderr}"
    );
    assert!(stderr.contains("budget 32,768 B"), "got: {stderr}");
}

#[test]
fn synth_warns_and_names_dropped_skills_past_the_name_cap() {
    let dir = repo_copy("wide");
    let mut skill_names: Vec<String> = std::fs::read_dir(dir.join("skills"))
        .unwrap()
        .map(|e| e.unwrap())
        .filter(|e| e.path().join("SKILL.md").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    skill_names.sort();
    skill_names.truncate(33);
    assert_eq!(skill_names.len(), 33, "repo needs at least 33 skills");
    write_fixture_agent(&dir, "k-fixture-wide", &skill_names);
    let output = synth(&dir, &[]);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains(&format!("1 would be dropped: {}", skill_names[32])),
        "got: {stderr}"
    );
}

#[test]
fn synth_json_reports_claude_preload_per_agent() {
    let dir = repo_copy("json");
    let output = synth(&dir, &["--json"]);
    let summary: serde_json::Value =
        serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).unwrap();
    let reported = summary["claude_preload"]
        .as_array()
        .expect("claude_preload array");
    let preloads = claude_preloads(&dir);
    assert_eq!(reported.len(), preloads.len());
    for (agent, names) in preloads {
        let entry = reported
            .iter()
            .find(|e| e["agent"] == agent.as_str())
            .unwrap_or_else(|| panic!("no claude_preload entry for {agent}"));
        let bytes: u64 = names.iter().map(|n| shipped_skill_bytes(&dir, n)).sum();
        assert_eq!(entry["bytes"].as_u64(), Some(bytes), "{agent}");
        assert_eq!(
            entry["skills"].as_u64(),
            Some(names.len() as u64),
            "{agent}"
        );
    }
}
