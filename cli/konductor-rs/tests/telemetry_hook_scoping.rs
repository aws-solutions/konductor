// SPDX-License-Identifier: Apache-2.0
//
// End-to-end: agent telemetry is reported only for Konductor agents, for
// each harness's payload shape, when the hook fires from a project
// directory and the only install is the global one in `$HOME`. Payloads
// are the shapes captured from live Kiro v2, Kiro v3, and Claude Code
// sessions.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use telemetry_test_sink::TelemetrySink;

const SINK_WAIT: Duration = Duration::from_secs(5);
const NEGATIVE_WAIT: Duration = Duration::from_millis(750);

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-telemetry-hook-scoping-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn konductor(home: &Path, cwd: &Path, sink: &TelemetrySink) -> Command {
    let mut command = Command::new(bin());
    command
        .current_dir(cwd)
        .env("HOME", home)
        // This suite may itself run inside a Kiro or Claude session.
        .env_remove("KIRO_SESSION_ID")
        .env_remove("CLAUDE_CODE_AGENT");
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    command
}

fn seed_agent(repo_root: &Path, name: &str) {
    let agents_dir = repo_root.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(
        agents_dir.join(format!("{name}.agent-spec.json")),
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

/// A real global install of `konductor` and `k-researcher` into `home`.
fn install_globally(home: &Path) {
    install_into(home, home, &["konductor", "k-researcher"]);
}

/// A real kiro-v3 install of `agents` into `target`, with `HOME=home`.
fn install_into(home: &Path, target: &Path, agents: &[&str]) {
    let repo = scratch_dir("repo");
    for agent in agents {
        seed_agent(&repo, agent);
    }
    let sink = TelemetrySink::start();
    let repo_arg = repo.display().to_string();
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
        .args(["--harness", "kiro-v3"])
        .output()
        .unwrap();
    assert!(
        install.status.success(),
        "install: {}",
        String::from_utf8_lossy(&install.stderr)
    );
    std::fs::remove_dir_all(&repo).ok();
}

/// Writes KAS's session record so a v3 session id resolves to `agent`.
fn seed_kiro_session(home: &Path, session_id: &str, agent: &str) {
    let dir = home
        .join(".kiro/sessions/11fe14a563f7aed6")
        .join(session_id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("session.json"),
        format!(r#"{{"id":"{session_id}","agentMode":"{agent}"}}"#),
    )
    .unwrap();
}

struct Fire<'a> {
    args: &'a [&'a str],
    payload: &'a str,
    env: &'a [(&'a str, &'a str)],
}

/// Fires the hook from `cwd` and returns the `Data` of every event the
/// sink received.
fn fire(home: &Path, cwd: &Path, fire: Fire<'_>, expect_events: usize) -> Vec<serde_json::Value> {
    let sink = TelemetrySink::start();
    let mut command = konductor(home, cwd, &sink);
    command
        .arg("__telemetry-hook")
        .args(fire.args)
        .envs(fire.env.iter().copied())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command.spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(fire.payload.as_bytes())
        .unwrap();
    assert!(child.wait().unwrap().success());

    if expect_events == 0 {
        assert!(
            !sink.wait_for_bodies(1, NEGATIVE_WAIT),
            "expected no event, got: {:?}",
            sink.received_bodies()
        );
        return Vec::new();
    }
    assert!(
        sink.wait_for_bodies(expect_events, SINK_WAIT),
        "expected {expect_events} event(s), got: {:?}",
        sink.received_bodies()
    );
    sink.received_bodies()
        .iter()
        .map(|body| serde_json::from_str::<serde_json::Value>(body).unwrap()["Data"].clone())
        .collect()
}

#[test]
fn only_konductor_agents_are_reported_across_harness_payload_shapes() {
    let home = scratch_dir("home");
    install_globally(&home);
    let project = home.join("workspace/some-project");
    std::fs::create_dir_all(&project).unwrap();
    seed_kiro_session(&home, "sess_konductor", "konductor");
    seed_kiro_session(&home, "sess_builder", "amzn-builder");

    // Kiro v3: primary agent from the session store.
    let events = fire(
        &home,
        &project,
        Fire {
            args: &["agent-invocation"],
            payload: r#"{"session_id":"sess_konductor","hook_event_name":"SessionStart","cwd":"/p"}"#,
            env: &[],
        },
        1,
    );
    assert_eq!(events[0]["eventType"], "agent_invocation");
    assert_eq!(events[0]["targetName"], "konductor");

    // Kiro v3: a non-Konductor session sends nothing.
    fire(
        &home,
        &project,
        Fire {
            args: &["agent-invocation"],
            payload: r#"{"session_id":"sess_builder","hook_event_name":"SessionStart","cwd":"/p"}"#,
            env: &[],
        },
        0,
    );

    // Kiro v3: direct delegation, parent named from the session store.
    let events = fire(
        &home,
        &project,
        Fire {
            args: &["subagent-invocation"],
            payload: r#"{"session_id":"sess_konductor","hook_event_name":"PreToolUse","tool_name":"subagent_k-researcher","tool_input":{"prompt":"p"}}"#,
            env: &[],
        },
        1,
    );
    assert_eq!(events[0]["eventType"], "subagent_invocation");
    assert_eq!(events[0]["targetName"], "k-researcher");
    assert_eq!(events[0]["parentAgentName"], "konductor");

    // Kiro v3: orchestration reports only the Konductor stage.
    let events = fire(
        &home,
        &project,
        Fire {
            args: &["subagent-invocation"],
            payload: r#"{"session_id":"sess_konductor","hook_event_name":"PreToolUse","tool_name":"orchestrate_subagent","tool_input":{"task":"t","stages":[{"name":"a","role":"k-researcher","prompt_template":"p"},{"name":"b","role":"someone-elses-agent","prompt_template":"p"}]}}"#,
            env: &[],
        },
        1,
    );
    assert_eq!(events[0]["targetName"], "k-researcher");

    // Kiro v2: the agent comes from --agent; a child's own spawn is a
    // delegation of the root session.
    let events = fire(
        &home,
        &project,
        Fire {
            args: &["agent-invocation", "--agent", "k-researcher"],
            payload: r#"{"hook_event_name":"agentSpawn","cwd":"/p","session_id":"child-sid"}"#,
            env: &[("KIRO_SESSION_ID", "root-sid")],
        },
        1,
    );
    assert_eq!(events[0]["eventType"], "subagent_invocation");
    assert_eq!(events[0]["targetName"], "k-researcher");

    // Claude Code: a built-in sub-agent is never reported.
    fire(
        &home,
        &project,
        Fire {
            args: &["subagent-invocation"],
            payload: r#"{"session_id":"c1","hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"Explore"}"#,
            env: &[("CLAUDE_CODE_AGENT", "konductor")],
        },
        0,
    );

    // Claude Code: a Konductor sub-agent delegated from a user's own
    // agent is reported, without naming the user's agent.
    let events = fire(
        &home,
        &project,
        Fire {
            args: &["subagent-invocation"],
            payload: r#"{"session_id":"c1","hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"k-researcher"}"#,
            env: &[("CLAUDE_CODE_AGENT", "my-own-agent")],
        },
        1,
    );
    assert_eq!(events[0]["targetName"], "k-researcher");
    assert!(events[0]["parentAgentName"].is_null());

    // Claude Code: a session with no named agent sends nothing.
    fire(
        &home,
        &project,
        Fire {
            args: &["agent-invocation"],
            payload: r#"{"session_id":"c2","hook_event_name":"SessionStart","source":"startup"}"#,
            env: &[],
        },
        0,
    );

    std::fs::remove_dir_all(&home).ok();
}

/// Fires every `SessionStart` command the harness would load for a
/// session in `project`: the global hook file and the project's own, as
/// the installs actually wrote them. Returns how many events arrived.
fn fire_all_installed_session_hooks(home: &Path, project: &Path, session_id: &str) -> usize {
    let sink = TelemetrySink::start();
    let mut roots = vec![home.to_path_buf()];
    if project
        .join(".kiro/hooks/konductor-telemetry-hooks.json")
        .is_file()
    {
        roots.push(project.to_path_buf());
    }
    for root in roots {
        let doc: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join(".kiro/hooks/konductor-telemetry-hooks.json")).unwrap(),
        )
        .unwrap();
        let command = doc["hooks"][0]["action"]["command"]
            .as_str()
            .unwrap()
            .to_string();
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(&command)
            .current_dir(project)
            .env("HOME", home)
            .env_remove("KIRO_SESSION_ID")
            .envs(sink.env_vars().into_iter().map(|v| (v.name, v.value)))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(
                format!(
                    r#"{{"session_id":"{session_id}","hook_event_name":"SessionStart","cwd":"/p"}}"#
                )
                .as_bytes(),
            )
            .unwrap();
        assert!(child.wait().unwrap().success());
    }
    sink.wait_for_bodies(2, NEGATIVE_WAIT);
    sink.received_bodies().len()
}

#[test]
fn global_and_project_hooks_count_each_invocation_once() {
    let home = scratch_dir("dedup-home");
    install_globally(&home);
    seed_kiro_session(&home, "sess_dedup", "konductor");

    // Project owns konductor: both hooks fire, only the project's reports.
    let project = home.join("workspace/owns-konductor");
    std::fs::create_dir_all(&project).unwrap();
    install_into(&home, &project, &["konductor"]);
    assert_eq!(
        fire_all_installed_session_hooks(&home, &project, "sess_dedup"),
        1
    );

    // No project install: the global hook reports.
    let bare = home.join("workspace/no-install");
    std::fs::create_dir_all(&bare).unwrap();
    assert_eq!(
        fire_all_installed_session_hooks(&home, &bare, "sess_dedup"),
        1
    );

    std::fs::remove_dir_all(&home).ok();
}
