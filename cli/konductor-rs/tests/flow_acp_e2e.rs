// SPDX-License-Identifier: Apache-2.0
//
// flow_acp_e2e.rs: drives the REAL compiled binary through `konductor flow run` on the `kiro-cli-acp` and `claude-acp`
// harnesses, with a fake ACP agent (a shell script first on PATH, shared with the engine's tests) in place of the real
// adapters. It covers a run that passes, a missing adapter, an adapter that serves only ACP version 2, a denied
// permission, the time limit, and the names of the harnesses.
//
// Isolation: every run happens in a scratch directory under `std::env::temp_dir()`, with `HOME` set to a scratch
// directory too, and a PATH that holds the fake programs and the system folders only, so the user's own `kiro-cli` and
// `claude-agent-acp` are never started. No test starts a real adapter.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

/// The scripted ACP agent that the engine's tests use.
const FAKE_AGENT: &str =
    include_str!("../../../workflow-engine/adapters/tests/common/fake_acp_agent.sh");

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-flow-acp-e2e-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn hello_plan() -> String {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../workflow-engine/examples/hello-plan.yml");
    std::fs::read_to_string(path).expect("read workflow-engine/examples/hello-plan.yml")
}

/// A Claude definition for `id` that lists the tools Read and Write.
fn claude_agent(id: &str) -> String {
    format!("---\nname: {id}\ndescription: x\ntools: Read, Write\n---\nBody.\n")
}

/// A project with hello-plan, a home folder, and a folder of fake programs that is the first folder of PATH.
struct Project {
    root: PathBuf,
    home: PathBuf,
    bin: PathBuf,
    /// Stands in for the telemetry endpoint, so no command reaches the network.
    sink: telemetry_test_sink::TelemetrySink,
}

impl Project {
    fn new(label: &str) -> Project {
        let project = Project {
            root: scratch_dir(&format!("{label}-project")),
            home: scratch_dir(&format!("{label}-home")),
            bin: scratch_dir(&format!("{label}-bin")),
            sink: telemetry_test_sink::TelemetrySink::start(),
        };
        project.write(".konductor/workflows/hello-plan.yml", &hello_plan());
        project
    }

    fn write(&self, relative: &str, text: &str) -> PathBuf {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        path
    }

    /// The agents of hello-plan as Claude definitions in the project.
    fn with_claude_agents(self) -> Project {
        for agent in ["k-architect", "k-developer"] {
            self.write(&format!(".claude/agents/{agent}.md"), &claude_agent(agent));
        }
        self
    }

    /// The agents of hello-plan as Kiro V2 files in the project, with no allowed tool.
    fn with_kiro_agents(self) -> Project {
        for agent in ["k-architect", "k-developer"] {
            self.write(
                &format!(".kiro/agents/{agent}.json"),
                &format!("{{\"name\":\"{agent}\",\"allowedTools\":[\"fs_read\"]}}"),
            );
        }
        self
    }

    /// Puts an executable `name` on PATH with `body`.
    fn fake(&self, name: &str, body: &str) {
        let path = self.bin.join(name);
        std::fs::write(&path, body).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// Puts the fake ACP agent on PATH under the name of an adapter.
    fn fake_adapter(&self, name: &str) {
        self.fake(name, FAKE_AGENT);
    }

    fn index(&self, strategies: &[&str]) {
        let strategies: Vec<String> = strategies.iter().map(|s| format!("\"{s}\"")).collect();
        std::fs::create_dir_all(self.home.join(".konductor")).unwrap();
        std::fs::write(
            self.home.join(".konductor/installs"),
            format!(
                r#"{{"schema_version":2,"installs":[{{"target_dir":"/some/target","strategies":[{}],"installed_at":"2026-11-01T00:00:00Z","status":"complete"}}]}}"#,
                strategies.join(",")
            ),
        )
        .unwrap();
    }

    fn command<S: AsRef<std::ffi::OsStr>>(&self, args: &[S]) -> Command {
        let mut command = Command::new(bin());
        command
            .args(args)
            .current_dir(&self.root)
            .env("HOME", &self.home)
            .env("PATH", format!("{}:/usr/bin:/bin", self.bin.display()))
            .env_remove("NO_COLOR")
            .env_remove("KONDUCTOR_LOG")
            .env_remove("KONDUCTOR_FAKE_SCRIPT")
            .env_remove("KONDUCTOR_ACP_TEST_LIMIT_MS")
            .env_remove("KONDUCTOR_ACP_TEST_GRACE_MS")
            .stdin(Stdio::null());
        for var in self.sink.env_vars() {
            command.env(var.name, var.value);
        }
        command
    }

    fn trust_hash(&self) -> String {
        let output = self
            .command(&["flow", "check", "hello-plan", "--json"])
            .output()
            .expect("spawn konductor");
        let report: serde_json::Value = serde_json::from_slice(&output.stdout).expect("json");
        report["trust_hash"]
            .as_str()
            .expect("trust hash")
            .to_string()
    }

    /// `flow run hello-plan --goal ...` plus `extra`, given the trust hash and the extra environment `env`.
    fn run(&self, extra: &[&str], env: &[(&str, &str)]) -> Output {
        let mut args: Vec<String> = ["flow", "run", "hello-plan", "--goal", "Do it."]
            .iter()
            .map(|a| (*a).to_string())
            .collect();
        args.extend(extra.iter().map(|a| (*a).to_string()));
        args.push("--trust".to_string());
        args.push(self.trust_hash());
        let mut command = self.command(&args);
        for (name, value) in env {
            command.env(name, value);
        }
        // A script that was just written can be busy for a moment, which reads as a failed start.
        for _ in 0..20 {
            let output = command.output().expect("spawn konductor");
            if !String::from_utf8_lossy(&output.stderr).contains("busy") {
                return output;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("the script stayed busy");
    }

    fn state(&self, run_id: &str) -> serde_json::Value {
        let text = std::fs::read_to_string(
            self.root
                .join(format!(".konductor/runs/{run_id}/state.json")),
        )
        .expect("state");
        serde_json::from_str(&text).expect("json")
    }

    fn run_ids(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(self.root.join(".konductor/runs")) else {
            return Vec::new();
        };
        entries
            .map(|e| e.unwrap())
            .filter(|e| e.file_type().unwrap().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect()
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        for dir in [&self.root, &self.home, &self.bin] {
            std::fs::remove_dir_all(dir).ok();
        }
    }
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).to_string()
}

fn exit(output: &Output) -> i32 {
    output.status.code().expect("exit code")
}

#[test]
fn a_hello_plan_run_passes_through_the_claude_adapter() {
    let project = Project::new("claude-pass").with_claude_agents();
    project.fake_adapter("claude-agent-acp");
    let log = project.bin.join("log");
    let output = project.run(
        &["--harness", "claude-acp"],
        &[("FAKE_ACP_LOG", log.to_str().unwrap())],
    );
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let out = stdout(&output);
    assert!(
        out.contains("stage plan: passed") && out.contains("stage implement: passed"),
        "{out}"
    );
    let ids = project.run_ids();
    assert_eq!(ids.len(), 1);
    let state = project.state(&ids[0]);
    assert_eq!(state["harness"], "claude-acp");
    assert_eq!(state["status"], "passed");
    assert!(state["session_group"].is_null(), "{state}");
    let frames = std::fs::read_to_string(&log).unwrap();
    // One adapter for each stage, each in permission mode default and on the agent of its stage.
    assert_eq!(frames.matches(r#""method":"initialize""#).count(), 2);
    assert_eq!(frames.matches(r#""value":"default""#).count(), 2);
    assert!(
        frames.contains(r#""agent":"k-architect""#) && frames.contains(r#""agent":"k-developer""#)
    );
    assert!(frames.contains("Goal: Do it."), "{frames}");
}

#[test]
fn a_hello_plan_run_passes_through_the_kiro_adapter() {
    let project = Project::new("kiro-pass").with_kiro_agents();
    project.fake_adapter("kiro-cli");
    let log = project.bin.join("log");
    let output = project.run(
        &["--harness", "kiro-cli-acp"],
        &[("FAKE_ACP_LOG", log.to_str().unwrap())],
    );
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert!(
        stdout(&output).contains("stage implement: passed"),
        "{}",
        stdout(&output)
    );
    let ids = project.run_ids();
    assert_eq!(project.state(&ids[0])["harness"], "kiro-cli-acp");
    let frames = std::fs::read_to_string(&log).unwrap();
    assert_eq!(frames.matches(r#""method":"initialize""#).count(), 2);
    // The adapter was started with the V2 engine and the agent of each stage, and with no trust flag.
    assert!(
        frames.contains("ARGS acp --agent k-architect --agent-engine v2\n"),
        "{frames}"
    );
    assert!(
        frames.contains("ARGS acp --agent k-developer --agent-engine v2\n"),
        "{frames}"
    );
    assert!(!frames.contains("trust"), "{frames}");
}

#[test]
fn an_acp_adapter_is_never_chosen_without_its_name() {
    let project = Project::new("no-auto").with_claude_agents();
    project.index(&["claude"]);
    project.fake_adapter("claude-agent-acp");
    let marker = project.bin.join("ran");
    project.fake(
        "claude",
        &format!(
            "#!/bin/sh\necho ran > '{}'\necho '{{\"type\":\"result\",\"is_error\":false,\"result\":\"KONDUCTOR_RESULT {{\\\"status\\\": \\\"success\\\", \\\"outputs\\\": [\\\"PLAN.md\\\"]}}\"}}'\n",
            marker.display()
        ),
    );
    let output = project.run(&[], &[]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert!(marker.exists(), "the claude program ran");
    assert_eq!(project.state(&project.run_ids()[0])["harness"], "claude");
}

#[test]
fn a_missing_adapter_ends_the_run_with_the_exit_of_a_missing_cli_and_does_not_fall_back() {
    let project = Project::new("missing").with_claude_agents();
    // A `claude` program is there, and the run does not use it.
    let marker = project.bin.join("ran");
    project.fake(
        "claude",
        &format!("#!/bin/sh\necho ran > '{}'\n", marker.display()),
    );
    let acp = project.run(&["--harness", "claude-acp"], &[]);
    // A missing program is a usage error before the first stage, as it is for the CLI harness: exit 64, and no run.
    assert_eq!(exit(&acp), 64, "{}", stderr(&acp));
    assert!(
        stderr(&acp).contains("`claude-agent-acp` was not found in an absolute folder of `PATH`"),
        "{}",
        stderr(&acp)
    );
    assert!(project.run_ids().is_empty(), "a run was started");
    assert!(!marker.exists(), "the run fell back to the claude program");
    // A missing CLI ends the same way: the same exit code, and no run.
    std::fs::remove_file(project.bin.join("claude")).unwrap();
    let missing_cli = project.run(&["--harness", "claude"], &[]);
    assert_eq!(exit(&missing_cli), exit(&acp), "{}", stderr(&missing_cli));
    assert!(project.run_ids().is_empty());
    // The same holds for the Kiro adapter, which is `kiro-cli acp`.
    let kiro = Project::new("missing-kiro").with_kiro_agents();
    let acp = kiro.run(&["--harness", "kiro-cli-acp"], &[]);
    assert_eq!(exit(&acp), 64, "{}", stderr(&acp));
    assert!(
        stderr(&acp).contains("`kiro-cli` was not found"),
        "{}",
        stderr(&acp)
    );
}

#[test]
fn an_adapter_that_serves_only_acp_version_2_is_refused_with_the_version_named() {
    let project = Project::new("v2only").with_claude_agents();
    project.fake_adapter("claude-agent-acp");
    let output = project.run(
        &["--harness", "claude-acp"],
        &[("FAKE_ACP_CASE", "v2-only")],
    );
    assert_eq!(exit(&output), 1);
    assert!(
        stdout(&output).contains("stage plan: blocked (SESSION_FAILED)"),
        "{}",
        stdout(&output)
    );
    let err = stderr(&output);
    assert!(
        err.contains("ACP version 2") && err.contains("version 1 only"),
        "{err}"
    );
    // The second stage never started.
    assert!(
        !stdout(&output).contains("stage implement"),
        "{}",
        stdout(&output)
    );
}

#[test]
fn a_denied_permission_blocks_the_stage_names_the_tool_and_halts_the_run() {
    let project = Project::new("denied").with_claude_agents();
    project.fake_adapter("claude-agent-acp");
    let log = project.bin.join("log");
    let output = project.run(
        &["--harness", "claude-acp"],
        &[
            ("FAKE_ACP_CASE", "perm"),
            ("FAKE_ACP_TOOL", "Bash"),
            ("FAKE_ACP_LOG", log.to_str().unwrap()),
        ],
    );
    assert_eq!(exit(&output), 1);
    assert!(
        stdout(&output).contains("stage plan: blocked (SESSION_FAILED)"),
        "{}",
        stdout(&output)
    );
    let err = stderr(&output);
    assert!(
        err.contains("`Bash`") && err.contains("agent file"),
        "{err}"
    );
    let ids = project.run_ids();
    let state = project.state(&ids[0]);
    assert_eq!(state["status"], "halted");
    assert_eq!(state["stages"]["implement"]["status"], "pending");
    let frames = std::fs::read_to_string(&log).unwrap();
    assert!(
        frames.contains(r#""optionId":"reject","outcome":"selected""#),
        "{frames}"
    );
    assert!(!frames.contains(r#""optionId":"allow-always""#), "{frames}");
}

#[test]
fn a_listed_tool_is_allowed_once_and_the_run_passes() {
    let project = Project::new("allowed").with_claude_agents();
    project.fake_adapter("claude-agent-acp");
    let log = project.bin.join("log");
    let output = project.run(
        &["--harness", "claude-acp"],
        &[
            ("FAKE_ACP_CASE", "perm"),
            ("FAKE_ACP_TOOL", "Write"),
            ("FAKE_ACP_LOG", log.to_str().unwrap()),
        ],
    );
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let frames = std::fs::read_to_string(&log).unwrap();
    assert!(
        frames.contains(r#""optionId":"allow-once","outcome":"selected""#),
        "{frames}"
    );
}

// The limits come from two environment variables that only a debug build reads, so a release build would wait the
// full 30 minutes here.
#[cfg(debug_assertions)]
#[test]
fn the_time_limit_cancels_the_session_then_ends_the_adapter_and_blocks_the_stage() {
    let project = Project::new("limit").with_claude_agents();
    project.fake_adapter("claude-agent-acp");
    let begun = Instant::now();
    let output = project.run(
        &["--harness", "claude-acp"],
        &[
            ("FAKE_ACP_CASE", "hang"),
            ("KONDUCTOR_ACP_TEST_LIMIT_MS", "600"),
            ("KONDUCTOR_ACP_TEST_GRACE_MS", "300"),
        ],
    );
    assert_eq!(exit(&output), 1, "{}", stderr(&output));
    assert!(
        stdout(&output).contains("stage plan: blocked (TIMEOUT)"),
        "{}",
        stdout(&output)
    );
    assert!(
        stderr(&output).contains("passed its time limit"),
        "{}",
        stderr(&output)
    );
    assert!(begun.elapsed() < Duration::from_secs(20));
    let ids = project.run_ids();
    let state = project.state(&ids[0]);
    assert_eq!(state["status"], "halted");
    assert!(state["session_group"].is_null(), "{state}");
}

/// Ends the owner if a test fails before it did.
struct KillOnDrop(std::process::Child);

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn wait_for(what: &str, mut ready: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(30);
    while !ready() {
        assert!(Instant::now() < until, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Whether a process group still has a member.
fn group_alive(pgid: u64) -> bool {
    Command::new("/bin/kill")
        .args(["-0", "--", &format!("-{pgid}")])
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn a_signal_to_the_owner_ends_the_adapter(label: &str, signal: &str) {
    let project = Project::new(label).with_claude_agents();
    project.fake_adapter("claude-agent-acp");
    let log = project.bin.join("log");
    let mut args: Vec<String> = [
        "flow",
        "run",
        "hello-plan",
        "--goal",
        "Do it.",
        "--harness",
        "claude-acp",
    ]
    .iter()
    .map(|a| (*a).to_string())
    .collect();
    args.push("--trust".to_string());
    args.push(project.trust_hash());
    let owner = project
        .command(&args)
        .env("FAKE_ACP_CASE", "hang")
        .env("FAKE_ACP_LOG", &log)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn owner");
    let owner_pid = owner.id();
    let mut owner = KillOnDrop(owner);
    // The adapter has read the prompt once it has logged `session/prompt`.
    wait_for("the adapter to read the prompt", || {
        std::fs::read_to_string(&log).is_ok_and(|text| text.contains("session/prompt"))
    });
    let id = project.run_ids().remove(0);
    let state_path = project
        .root
        .join(format!(".konductor/runs/{id}/state.json"));
    wait_for("the adapter group in the run state", || {
        std::fs::read_to_string(&state_path).is_ok_and(|text| text.contains("session_group"))
    });
    let pgid = project.state(&id)["session_group"]["pgid"]
        .as_u64()
        .expect("pgid");
    assert!(group_alive(pgid));

    let sent = Command::new("/bin/kill")
        .args([
            format!("-{signal}"),
            "--".to_string(),
            owner_pid.to_string(),
        ])
        .status()
        .expect("run kill");
    assert!(sent.success());

    // Bounded: the owner gives the adapter a 10 second grace period at most.
    let until = Instant::now() + Duration::from_secs(30);
    let status = loop {
        if let Some(status) = owner.0.try_wait().unwrap() {
            break status;
        }
        assert!(
            Instant::now() < until,
            "the owner did not exit after {signal}"
        );
        std::thread::sleep(Duration::from_millis(25));
    };
    assert_eq!(status.code(), Some(1), "{status:?}");
    assert!(!group_alive(pgid), "the adapter group ended");
    let mut err = String::new();
    std::io::Read::read_to_string(owner.0.stderr.as_mut().unwrap(), &mut err).unwrap();
    assert!(err.contains("interrupted"), "{err}");
    let state = project.state(&id);
    assert_eq!(state["status"], "halted");
    assert_eq!(state["exit_code"], 1);
    assert!(state.get("session_group").is_none(), "{state}");
    assert_eq!(state["stages"]["plan"]["status"], "blocked", "{state}");
    assert_eq!(state["stages"]["implement"]["status"], "pending", "{state}");
}

#[test]
fn sigint_to_the_owner_ends_the_adapter_group_and_halts_the_run() {
    a_signal_to_the_owner_ends_the_adapter("acp-sigint", "INT");
}

#[test]
fn sigterm_to_the_owner_ends_the_adapter_group_and_halts_the_run() {
    a_signal_to_the_owner_ends_the_adapter("acp-sigterm", "TERM");
}

#[test]
fn sighup_to_the_owner_ends_the_adapter_group_and_halts_the_run() {
    a_signal_to_the_owner_ends_the_adapter("acp-sighup", "HUP");
}

#[test]
fn a_claude_agent_in_the_home_folder_is_a_usage_error_before_any_stage() {
    let project = Project::new("home-agent");
    for agent in ["k-architect", "k-developer"] {
        let path = project.home.join(format!(".claude/agents/{agent}.md"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, claude_agent(agent)).unwrap();
    }
    project.fake_adapter("claude-agent-acp");
    let output = project.run(&["--harness", "claude-acp"], &[]);
    assert_eq!(exit(&output), 64, "{}", stderr(&output));
    assert!(
        stderr(&output).contains("defined in the home folder"),
        "{}",
        stderr(&output)
    );
    assert!(project.run_ids().is_empty());
}

#[test]
fn a_tool_configuration_file_that_a_claude_acp_stage_edits_stops_the_next_stage_and_is_named() {
    let project = Project::new("guard").with_claude_agents();
    project.write(".claude/settings.json", "{}");
    project.fake_adapter("claude-agent-acp");
    let settings = project.root.join(".claude/settings.json");
    let output = project.run(
        &["--harness", "claude-acp"],
        &[("FAKE_ACP_REWRITE", settings.to_str().unwrap())],
    );
    assert_eq!(exit(&output), 1, "{}", stderr(&output));
    let out = stdout(&output);
    assert!(out.contains("stage plan: passed"), "{out}");
    assert!(
        out.contains("stage implement: blocked (SESSION_FAILED)"),
        "{out}"
    );
    let err = stderr(&output);
    assert!(
        err.contains(".claude/settings.json") && err.contains("Stage `implement` did not start"),
        "{err}"
    );
    let state = project.state(&project.run_ids()[0]);
    assert_eq!(state["status"], "halted");
}

#[test]
fn an_unknown_harness_is_a_usage_error_that_lists_every_value() {
    let project = Project::new("unknown").with_claude_agents();
    let output = project.run(&["--harness", "gemini-acp"], &[]);
    assert_eq!(exit(&output), 64, "{}", stderr(&output));
    let err = stderr(&output);
    for name in ["kiro-cli", "claude", "kiro-cli-acp", "claude-acp", "fake"] {
        assert!(err.contains(&format!("`{name}`")), "{err}");
    }
}

// There is no `flow view` command yet, so this exit 64 comes from the unknown subcommand and not from any rule about
// harness names: it only shows that the command line is a usage error and not a run. The rule that `flow view` takes
// no ACP harness, and the message that lists the accepted values, are in the unit tests of `choose_view_harness`.
#[test]
fn flow_view_with_an_acp_harness_is_a_usage_error_because_the_command_does_not_exist_yet() {
    let project = Project::new("view");
    let output = project
        .command(&["flow", "view", "hello-plan", "--harness", "claude-acp"])
        .output()
        .expect("spawn konductor");
    assert_eq!(exit(&output), 64, "{}", stderr(&output));
    assert!(
        stderr(&output).contains("unrecognized subcommand 'view'"),
        "{}",
        stderr(&output)
    );
}
