// SPDX-License-Identifier: Apache-2.0
//
// End-to-end: `konductor __orchestration-hook` prints the coordinator
// persona only for Konductor's `konductor` session in `coordinator` mode,
// prints one fallback line for a bad config, and prints nothing (and
// exits 0) everywhere else. Payloads are the shapes captured from live
// Kiro v2, Kiro v3 and Claude Code sessions.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use telemetry_test_sink::TelemetrySink;

const RULES_LAST_HEADING: &str = "## Missing Tool = Delegate, Always";
const V3_SESSION: &str = "sess_8147fdc3-f3ec-4b32-a669-a0d26bd4cea0";

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-orchestration-hook-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::canonicalize(&dir).unwrap()
}

fn konductor(home: &Path, cwd: &Path, sink: &TelemetrySink) -> Command {
    let mut command = Command::new(bin());
    command
        .current_dir(cwd)
        .env("HOME", home)
        .env_remove("KIRO_HOME")
        .env_remove("KIRO_SESSION_ID")
        .env_remove("CLAUDE_CODE_AGENT");
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    command
}

fn seed_repo(agents: &[&str]) -> PathBuf {
    let repo = scratch_dir("repo");
    std::fs::create_dir_all(repo.join("agents")).unwrap();
    std::fs::create_dir_all(repo.join("context")).unwrap();
    for name in agents {
        std::fs::write(
            repo.join("agents").join(format!("{name}.agent-spec.json")),
            format!(
                r#"{{
  "schemaVersion": "1",
  "name": "{name}",
  "config": {{ "description": "An agent.", "model": "claude-sonnet-5", "systemPrompt": "Help." }},
  "clientConfig": {{ "kiroCli": {{}} }}
}}
"#
            ),
        )
        .unwrap();
    }
    std::fs::write(
        repo.join("context/k-orchestrator-routing-rules.md"),
        format!("# Rules\n\n## First\n\ntext\n\n{RULES_LAST_HEADING}\n\ntext\n"),
    )
    .unwrap();
    std::fs::write(
        repo.join("context/k-coordinator-digest.md"),
        "## Coordinator rules (digest)\n\n- Delegate every write.\n",
    )
    .unwrap();
    repo
}

/// A real kiro-v3 install of `agents` into `target`.
fn install_into(home: &Path, target: &Path, agents: &[&str]) {
    install_with(
        home,
        target,
        agents,
        &["--harness", "kiro-v3", "--no-telemetry"],
    );
}

fn install_with(home: &Path, target: &Path, agents: &[&str], flags: &[&str]) {
    let repo = seed_repo(agents);
    let repo_arg = repo.display().to_string();
    let sink = TelemetrySink::start();
    let synth = konductor(home, &repo, &sink)
        .args(["synth", "--from", &repo_arg])
        .output()
        .unwrap();
    assert!(
        synth.status.success(),
        "synth: {}",
        String::from_utf8_lossy(&synth.stderr)
    );
    let install = konductor(home, target, &sink)
        .args(["install", "--from", &repo_arg, "--target"])
        .arg(target)
        .args(flags)
        .output()
        .unwrap();
    assert!(
        install.status.success(),
        "install: {}",
        String::from_utf8_lossy(&install.stderr)
    );
    std::fs::remove_dir_all(&repo).ok();
}

fn set_mode(home: &Path, contents: &str) {
    std::fs::create_dir_all(home.join(".konductor")).unwrap();
    std::fs::write(home.join(".konductor/config.yml"), contents).unwrap();
}

fn seed_kiro_session(kiro_home: &Path, session_id: &str, agent: &str) {
    let dir = kiro_home.join("sessions/0b8bd61f2c902ceb").join(session_id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("session.json"),
        format!(r#"{{"id":"{session_id}","agentMode":"{agent}"}}"#),
    )
    .unwrap();
}

struct Fired {
    stdout: String,
    stderr: String,
}

fn fire_bytes(
    home: &Path,
    cwd: &Path,
    args: &[&str],
    env: &[(&str, &Path)],
    payload: &[u8],
) -> Fired {
    let sink = TelemetrySink::start();
    let mut command = konductor(home, cwd, &sink);
    command
        .arg("__orchestration-hook")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (name, value) in env {
        command.env(name, value);
    }
    let mut child = command.spawn().unwrap();
    // The hook may exit before reading an oversized payload.
    let _ = child.stdin.take().unwrap().write_all(payload);
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(0));
    Fired {
        stdout: String::from_utf8(output.stdout).unwrap(),
        stderr: String::from_utf8(output.stderr).unwrap(),
    }
}

fn fire(home: &Path, cwd: &Path, args: &[&str], env: &[(&str, &Path)], payload: &str) -> String {
    let fired = fire_bytes(home, cwd, args, env, payload.as_bytes());
    assert_eq!(fired.stderr, "");
    fired.stdout
}

fn claude_payload(agent_type: Option<&str>, source: &str) -> String {
    let agent = agent_type
        .map(|name| format!(r#""agent_type":"{name}","#))
        .unwrap_or_default();
    format!(
        r#"{{"session_id":"4a192073","transcript_path":"/x.jsonl","cwd":"/p",{agent}"hook_event_name":"SessionStart","source":"{source}"}}"#
    )
}

fn v3_payload() -> String {
    format!(r#"{{"session_id":"{V3_SESSION}","hook_event_name":"SessionStart","cwd":"/p"}}"#)
}

fn assert_persona(stdout: &str, install_root: &Path) {
    let rules = install_root.join(".kiro/context/k-orchestrator-routing-rules.md");
    assert!(
        stdout.starts_with("Orchestration: coordinator\nFor this session"),
        "{stdout}"
    );
    assert!(
        stdout.contains(&format!("read {} in full.", rules.display())),
        "{stdout}"
    );
    assert!(stdout.ends_with("- Delegate every write.\n"), "{stdout}");
    assert!(stdout.len() <= 2500);
    let named = std::fs::read_to_string(&rules).unwrap();
    assert!(named.contains(RULES_LAST_HEADING));
}

#[test]
fn only_a_konductor_session_in_coordinator_mode_gets_the_persona() {
    let home = scratch_dir("home");
    install_into(&home, &home, &["konductor", "k-developer"]);
    let project = home.join("workspace/project");
    std::fs::create_dir_all(&project).unwrap();
    let konductor_payload = claude_payload(Some("konductor"), "startup");

    // No config file, then `auto`: nothing.
    assert_eq!(fire(&home, &project, &[], &[], &konductor_payload), "");
    set_mode(&home, "orchestration:\n  mode: auto\n");
    assert_eq!(fire(&home, &project, &[], &[], &konductor_payload), "");

    // A bad value: one fallback line.
    set_mode(&home, "orchestration:\n  mode: strict\n");
    assert_eq!(
        fire(&home, &project, &[], &[], &konductor_payload),
        "Orchestration: auto (fallback: orchestration.mode is \"strict\"; expected auto or \
         coordinator)\n"
    );

    set_mode(&home, "orchestration:\n  mode: coordinator\n");
    assert_persona(&fire(&home, &project, &[], &[], &konductor_payload), &home);

    // Kiro v2 bakes the agent in.
    assert_persona(
        &fire(
            &home,
            &project,
            &["--agent", "konductor"],
            &[],
            r#"{"hook_event_name":"agentSpawn","cwd":"/p","session_id":"cb4556d5"}"#,
        ),
        &home,
    );

    // Other agents, unknown agents, no agent, and a sub-agent event.
    for payload in [
        claude_payload(Some("k-developer"), "startup"),
        claude_payload(Some("konductor-mux-orchestrator"), "startup"),
        claude_payload(None, "startup"),
        r#"{"session_id":"c1","hook_event_name":"SubagentStart","agent_type":"konductor"}"#
            .to_string(),
    ] {
        assert_eq!(fire(&home, &project, &[], &[], &payload), "", "{payload}");
    }
    std::fs::remove_dir_all(&home).ok();
}

#[cfg(unix)]
#[test]
fn the_pointer_keeps_a_symlinked_home_as_the_session_knows_it() {
    let physical_home = scratch_dir("home-physical");
    install_into(&physical_home, &physical_home, &["konductor"]);
    set_mode(&physical_home, "orchestration:\n  mode: coordinator\n");
    let links = scratch_dir("home-links");
    let logical_home = links.join("home-link");
    std::os::unix::fs::symlink(&physical_home, &logical_home).unwrap();
    let outside_project = scratch_dir("outside-project");

    let stdout = fire(
        &logical_home,
        &outside_project,
        &[],
        &[],
        &claude_payload(Some("konductor"), "startup"),
    );

    let logical_rules = logical_home.join(".kiro/context/k-orchestrator-routing-rules.md");
    assert!(
        stdout.contains(&format!("read {} in full.", logical_rules.display())),
        "{stdout}"
    );
    for dir in [&physical_home, &links, &outside_project] {
        std::fs::remove_dir_all(dir).ok();
    }
}

#[test]
fn a_session_inside_a_symlinked_home_gets_the_logical_pointer_and_fallback() {
    let physical_home = scratch_dir("home-physical-inside");
    install_into(&physical_home, &physical_home, &["konductor"]);
    set_mode(&physical_home, "orchestration:\n  mode: coordinator\n");
    let links = scratch_dir("home-links-inside");
    let logical_home = links.join("home-link");
    std::os::unix::fs::symlink(&physical_home, &logical_home).unwrap();
    let project = logical_home.join("project");
    std::fs::create_dir_all(&project).unwrap();

    let stdout = fire(
        &logical_home,
        &project,
        &[],
        &[],
        &claude_payload(Some("konductor"), "startup"),
    );
    let logical_rules = logical_home.join(".kiro/context/k-orchestrator-routing-rules.md");
    assert!(
        stdout.contains(&format!("read {} in full.", logical_rules.display())),
        "{stdout}"
    );

    std::fs::remove_file(physical_home.join(".kiro/context/k-orchestrator-routing-rules.md"))
        .unwrap();
    let stdout = fire(
        &logical_home,
        &project,
        &[],
        &[],
        &claude_payload(Some("konductor"), "startup"),
    );
    assert!(stdout.contains("~/.kiro/context/"), "{stdout}");
    assert!(
        !stdout.contains(&physical_home.display().to_string()),
        "{stdout}"
    );
    for dir in [&physical_home, &links] {
        std::fs::remove_dir_all(dir).ok();
    }
}

#[cfg(unix)]
#[test]
fn a_parent_of_project_install_under_a_symlinked_home_gets_the_logical_pointer() {
    let physical_home = scratch_dir("home-physical-parent");
    let links = scratch_dir("home-links-parent");
    let logical_home = links.join("home-link");
    std::os::unix::fs::symlink(&physical_home, &logical_home).unwrap();
    set_mode(&physical_home, "orchestration:\n  mode: coordinator\n");
    let logical_work = logical_home.join("work");
    std::fs::create_dir_all(&logical_work).unwrap();
    install_into(&physical_home, &logical_work, &["konductor"]);
    let project = logical_work.join("proj");
    std::fs::create_dir_all(&project).unwrap();
    let payload = claude_payload(Some("konductor"), "startup");
    let physical_prefix = physical_home.display().to_string();

    let stdout = fire(&logical_home, &project, &[], &[], &payload);
    let logical_dir = logical_work.join(".kiro/context/");
    assert!(
        stdout.contains(&logical_dir.display().to_string()),
        "{stdout}"
    );
    assert!(!stdout.contains(&physical_prefix), "{stdout}");

    std::fs::remove_file(logical_dir.join("k-orchestrator-routing-rules.md")).unwrap();
    let stdout = fire(&logical_home, &project, &[], &[], &payload);
    assert!(
        stdout.starts_with("Orchestration: auto (fallback: "),
        "{stdout}"
    );
    assert!(!stdout.contains(&physical_prefix), "{stdout}");
    for dir in [&physical_home, &links] {
        std::fs::remove_dir_all(dir).ok();
    }
}

#[test]
fn a_subdirectory_session_of_a_git_project_outside_the_home_gets_the_digest() {
    let home = scratch_dir("project-home");
    let shared = scratch_dir("project-shared");
    set_mode(&home, "orchestration:\n  mode: coordinator\n");
    install_into(&home, &shared, &["konductor"]);
    std::fs::create_dir_all(shared.join(".git")).unwrap();
    let subdirectory = shared.join("proj/sub");
    std::fs::create_dir_all(&subdirectory).unwrap();
    let install_root = shared.display().to_string();

    let stdout = fire(
        &home,
        &subdirectory,
        &["--install-root", &install_root],
        &[],
        &claude_payload(Some("konductor"), "startup"),
    );

    assert_persona(&stdout, &shared.canonicalize().unwrap());
    for dir in [&home, &shared] {
        std::fs::remove_dir_all(dir).ok();
    }
}

#[test]
fn a_session_under_an_install_outside_the_home_and_not_the_project_root_gets_the_fallback() {
    let home = scratch_dir("untrusted-home");
    let shared = scratch_dir("untrusted-shared");
    set_mode(&home, "orchestration:\n  mode: coordinator\n");
    install_into(&home, &shared, &["konductor"]);
    let subdirectory = shared.join("proj");
    std::fs::create_dir_all(&subdirectory).unwrap();
    let install_root = shared.display().to_string();

    let stdout = fire(
        &home,
        &subdirectory,
        &["--install-root", &install_root],
        &[],
        &claude_payload(Some("konductor"), "startup"),
    );

    assert!(
        stdout.starts_with("Orchestration: auto (fallback:"),
        "{stdout}"
    );
    assert!(
        stdout.contains("outside the locations konductor follows"),
        "{stdout}"
    );
    assert!(!stdout.contains("in full."), "{stdout}");
    for dir in [&home, &shared] {
        std::fs::remove_dir_all(dir).ok();
    }
}

#[test]
fn kiro_v3_identity_comes_from_the_kiro_home_session_store() {
    let home = scratch_dir("v3-home");
    install_into(&home, &home, &["konductor", "k-developer"]);
    set_mode(&home, "orchestration:\n  mode: coordinator\n");
    let kiro_home = scratch_dir("v3-kiro-home");

    let env: [(&str, &Path); 1] = [("KIRO_HOME", &kiro_home)];
    assert_eq!(fire(&home, &home, &[], &env, &v3_payload()), "");

    seed_kiro_session(&kiro_home, V3_SESSION, "konductor");
    assert_persona(&fire(&home, &home, &[], &env, &v3_payload()), &home);

    // The store wins over an inherited CLAUDE_CODE_AGENT.
    let other_kiro_home = scratch_dir("v3-kiro-home-dev");
    seed_kiro_session(&other_kiro_home, V3_SESSION, "k-developer");
    let konductor_name = PathBuf::from("konductor");
    let env: [(&str, &Path); 2] = [
        ("KIRO_HOME", &other_kiro_home),
        ("CLAUDE_CODE_AGENT", &konductor_name),
    ];
    assert_eq!(fire(&home, &home, &[], &env, &v3_payload()), "");
    std::fs::remove_dir_all(&home).ok();
    std::fs::remove_dir_all(&kiro_home).ok();
    std::fs::remove_dir_all(&other_kiro_home).ok();
}

#[test]
fn claude_code_agent_is_never_an_identity_source() {
    let home = scratch_dir("claude-env-home");
    install_into(&home, &home, &["konductor"]);
    set_mode(&home, "orchestration:\n  mode: coordinator\n");
    let konductor_name = PathBuf::from("konductor");
    let env: [(&str, &Path); 1] = [("CLAUDE_CODE_AGENT", &konductor_name)];
    for source in ["startup", "clear", "resume", "compact"] {
        assert_eq!(
            fire(&home, &home, &[], &env, &claude_payload(None, source)),
            "",
            "{source}"
        );
    }
    std::fs::remove_dir_all(&home).ok();
}

#[test]
fn only_the_nearest_install_prints() {
    let home = scratch_dir("nearest-home");
    install_into(&home, &home, &["konductor"]);
    let project = home.join("workspace/project");
    std::fs::create_dir_all(&project).unwrap();
    install_into(&home, &project, &["konductor"]);
    set_mode(&home, "orchestration:\n  mode: coordinator\n");
    let payload = claude_payload(Some("konductor"), "startup");

    let home_arg = home.display().to_string();
    let project_arg = project.display().to_string();
    assert_eq!(
        fire(
            &home,
            &project,
            &["--install-root", &home_arg],
            &[],
            &payload
        ),
        ""
    );
    assert_persona(
        &fire(
            &home,
            &project,
            &["--install-root", &project_arg],
            &[],
            &payload,
        ),
        &project,
    );
    std::fs::remove_dir_all(&home).ok();
}

#[test]
fn bad_stdin_exits_zero_with_no_output() {
    let home = scratch_dir("stdin-home");
    install_into(&home, &home, &["konductor"]);
    set_mode(&home, "orchestration:\n  mode: coordinator\n");
    let oversized = vec![b' '; 128 * 1024];
    for payload in [&b""[..], &b"not json"[..], &oversized[..]] {
        let fired = fire_bytes(&home, &home, &[], &[], payload);
        assert_eq!(fired.stdout, "");
        assert_eq!(fired.stderr, "");
    }
    std::fs::remove_dir_all(&home).ok();
}

#[test]
fn kiro_v3_wires_its_own_hook_document_under_no_telemetry_and_uninstall_removes_it() {
    let home = scratch_dir("v3-wiring-home");
    let project = scratch_dir("v3-wiring-project");
    install_into(&home, &project, &["konductor"]);
    let hooks = project.join(".kiro/hooks");
    assert!(!hooks.join("konductor-telemetry-hooks.json").exists());
    let document: serde_json::Value = serde_json::from_slice(
        &std::fs::read(hooks.join("konductor-orchestration-hooks.json")).unwrap(),
    )
    .unwrap();
    let entry = &document["hooks"][0];
    assert_eq!(entry["trigger"], "SessionStart");
    assert_eq!(entry["timeout"], 10);
    let command = entry["action"]["command"].as_str().unwrap();
    assert!(
        command.ends_with(&format!(
            " __orchestration-hook --install-root {}",
            project.display()
        )),
        "{command}"
    );

    let sink = TelemetrySink::start();
    let uninstall = konductor(&home, &project, &sink)
        .args(["uninstall", "--target"])
        .arg(&project)
        .output()
        .unwrap();
    assert!(
        uninstall.status.success(),
        "uninstall: {}",
        String::from_utf8_lossy(&uninstall.stderr)
    );
    assert!(!hooks.exists(), "{} must be gone", hooks.display());
    std::fs::remove_dir_all(&home).ok();
    std::fs::remove_dir_all(&project).ok();
}

#[test]
fn claude_uninstall_removes_the_context_files_and_keeps_memory() {
    let home = scratch_dir("claude-context-home");
    let project = scratch_dir("claude-context-project");
    std::fs::create_dir_all(project.join(".konductor/memory")).unwrap();
    std::fs::write(project.join(".konductor/memory/MEMORY.md"), "- a fact\n").unwrap();
    install_with(
        &home,
        &project,
        &["konductor"],
        &["--harness", "claude", "--no-telemetry"],
    );
    let context = project.join(".konductor/context");
    assert!(context.join("k-orchestrator-routing-rules.md").is_file());

    let sink = TelemetrySink::start();
    let uninstall = konductor(&home, &project, &sink)
        .args(["uninstall", "--harness", "claude", "--target"])
        .arg(&project)
        .output()
        .unwrap();
    assert!(
        uninstall.status.success(),
        "uninstall: {}",
        String::from_utf8_lossy(&uninstall.stderr)
    );
    assert!(!context.exists(), "{} must be gone", context.display());
    assert_eq!(
        std::fs::read_to_string(project.join(".konductor/memory/MEMORY.md")).unwrap(),
        "- a fact\n"
    );
    std::fs::remove_dir_all(&home).ok();
    std::fs::remove_dir_all(&project).ok();
}

#[test]
fn kiro_v2_wires_the_hook_on_konductor_only() {
    for flags in [
        &["--harness", "kiro-cli-v2"][..],
        &["--harness", "kiro-cli-v2", "--no-telemetry"][..],
    ] {
        let home = scratch_dir("v2-wiring-home");
        let project = scratch_dir("v2-wiring-project");
        install_with(&home, &project, &["konductor", "k-developer"], flags);
        let spawn_commands = |agent: &str| -> Vec<String> {
            let value: serde_json::Value = serde_json::from_slice(
                &std::fs::read(project.join(format!(".kiro/agents/{agent}.json"))).unwrap(),
            )
            .unwrap();
            value["hooks"]["agentSpawn"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|entry| entry["command"].as_str().map(str::to_string))
                .collect()
        };
        let konductor_hooks = spawn_commands("konductor");
        assert!(
            konductor_hooks.iter().any(|c| c.contains(&format!(
                " __orchestration-hook --agent konductor --install-root {}",
                project.display()
            ))),
            "{flags:?}: {konductor_hooks:?}"
        );
        assert!(
            !spawn_commands("k-developer")
                .iter()
                .any(|c| c.contains("__orchestration-hook")),
            "{flags:?}"
        );
        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_dir_all(&project).ok();
    }
}
