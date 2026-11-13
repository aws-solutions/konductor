// SPDX-License-Identifier: Apache-2.0
//
// flow_claude_e2e.rs: drives the REAL compiled binary through `konductor flow run` on the `claude` harness, with a fake
// `claude` (a shell script first on PATH) in place of the real one. It covers the choice of the harness from the install
// index, the agents the harness cannot see, the folders Claude Code searches, and a run that passes or fails.
//
// Isolation: every run happens in a scratch directory under `std::env::temp_dir()`, with `HOME` set to a scratch
// directory too, so the user's own install index and agents are never read. No test starts the real Claude Code.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-flow-claude-e2e-{name}-{}-{}",
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

const SUCCESS: &str = r#"KONDUCTOR_RESULT {"status": "success", "outputs": ["PLAN.md"]}"#;

const AGENT: &str =
    "---\nname: agent\ndescription: x\ntools: Read, Write, Agent(a, b)\n---\nBody.\n";

/// The shell text that prints `result` as the JSON reply of a session.
fn reply(result: &str) -> String {
    let json = format!(r#"{{"type":"result","is_error":false,"result":"{result}"}}"#);
    format!("printf '%s\\n' '{json}'")
}

/// A project with hello-plan, a home folder, and a folder of fake programs that comes first on PATH.
struct Project {
    root: PathBuf,
    home: PathBuf,
    bin: PathBuf,
    /// Folders to remove besides the three above.
    extra: Vec<PathBuf>,
    /// Stands in for the telemetry endpoint, so no command reaches the network.
    sink: telemetry_test_sink::TelemetrySink,
}

impl Project {
    fn new(label: &str) -> Project {
        let project = Project {
            root: scratch_dir(&format!("{label}-project")),
            home: scratch_dir(&format!("{label}-home")),
            bin: scratch_dir(&format!("{label}-bin")),
            extra: Vec::new(),
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

    /// An agent file for each stage agent of hello-plan, in the project root.
    fn with_agents(self) -> Project {
        for agent in ["k-architect", "k-developer"] {
            self.write(&format!(".claude/agents/{agent}.md"), AGENT);
        }
        self
    }

    fn index(&self, entries: &[(&str, &[&str], &str)]) {
        let entries: Vec<String> = entries
            .iter()
            .map(|(target, strategies, status)| {
                let strategies: Vec<String> =
                    strategies.iter().map(|s| format!("\"{s}\"")).collect();
                format!(
                    r#"{{"target_dir":"{target}","strategies":[{}],"installed_at":"2026-11-01T00:00:00Z","status":"{status}"}}"#,
                    strategies.join(",")
                )
            })
            .collect();
        std::fs::create_dir_all(self.home.join(".konductor")).unwrap();
        std::fs::write(
            self.home.join(".konductor/installs"),
            format!(
                r#"{{"schema_version":2,"installs":[{}]}}"#,
                entries.join(",")
            ),
        )
        .unwrap();
    }

    /// Puts an executable `claude` script on PATH.
    fn fake_claude(&self, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        let path = self.bin.join("claude");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn command<S: AsRef<std::ffi::OsStr>>(&self, args: &[S]) -> Command {
        let mut command = Command::new(bin());
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut dirs = vec![self.bin.clone()];
        dirs.extend(std::env::split_paths(&path));
        command
            .args(args)
            .current_dir(&self.root)
            .env("HOME", &self.home)
            .env("PATH", std::env::join_paths(dirs).unwrap())
            .env_remove("NO_COLOR")
            .env_remove("KONDUCTOR_LOG")
            .env_remove("KONDUCTOR_FAKE_SCRIPT")
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

    /// `flow run hello-plan --goal ...` plus `extra`, given the trust hash.
    fn run(&self, extra: &[&str]) -> Output {
        let mut args: Vec<String> = ["flow", "run", "hello-plan", "--goal", "Do it."]
            .iter()
            .map(|a| (*a).to_string())
            .collect();
        args.extend(extra.iter().map(|a| (*a).to_string()));
        args.push("--trust".to_string());
        args.push(self.trust_hash());
        self.command(&args).output().expect("spawn konductor")
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
        for dir in [&self.root, &self.home, &self.bin]
            .into_iter()
            .chain(self.extra.iter())
        {
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
fn a_hello_plan_run_passes_on_claude_with_the_arguments_the_spec_gives() {
    let project = Project::new("args").with_agents();
    let log = project.bin.join("args.log");
    project.fake_claude(&format!(
        "echo SESSION >> '{0}'\npwd >> '{0}'\nfor a in \"$@\"; do echo \"$a\"; done >> '{0}'\n{1}",
        log.display(),
        reply(&SUCCESS.replace('"', "\\\""))
    ));
    let output = project.run(&["--harness", "claude"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert!(
        stdout(&output).contains("stage plan: passed"),
        "{}",
        stdout(&output)
    );
    let text = std::fs::read_to_string(&log).unwrap();
    // Two stages ran, and each session starts its record with a SESSION line. Look at the first.
    let first = text.split("SESSION\n").nth(1).expect("a session ran");
    let lines: Vec<&str> = first.lines().collect();
    assert_eq!(text.matches("SESSION\n").count(), 2);
    assert_eq!(
        Path::new(lines[0]),
        std::fs::canonicalize(&project.root).unwrap()
    );
    assert_eq!(lines[1], "-p");
    assert!(lines[2].starts_with("Goal: Do it."), "{}", lines[2]);
    // The prompt can hold line breaks, so the later arguments are the last six lines.
    let tail = &lines[lines.len() - 6..];
    assert_eq!(
        tail,
        [
            "--output-format",
            "json",
            "--agent",
            "k-architect",
            "--allowedTools",
            "Read,Write,Agent(a),Agent(b)"
        ]
    );
    assert!(
        !text.contains("permission") && !text.contains("dangerously"),
        "{text}"
    );
    let ids = project.run_ids();
    assert_eq!(project.state(&ids[0])["harness"], "claude");
    assert_eq!(project.state(&ids[0])["status"], "passed");
}

#[test]
fn a_claude_install_alone_makes_claude_the_default() {
    let project = Project::new("pick").with_agents();
    project.index(&[("/some/target", &["claude"], "complete")]);
    project.fake_claude(&reply(&SUCCESS.replace('"', "\\\"")));
    let output = project.run(&[]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let ids = project.run_ids();
    assert_eq!(project.state(&ids[0])["harness"], "claude");
}

#[test]
fn a_session_that_fails_halts_the_run_and_says_why_in_one_line() {
    let project = Project::new("fails").with_agents();
    project.fake_claude("echo 'Not logged in'; exit 1");
    let output = project.run(&["--harness", "claude"]);
    assert_eq!(exit(&output), 1);
    assert!(stdout(&output).contains("stage plan: blocked (SESSION_FAILED)"));
    let err = stderr(&output);
    assert_eq!(err.lines().count(), 1, "{err}");
    assert!(err.contains("exit status 1"), "{err}");
    let ids = project.run_ids();
    assert_eq!(project.state(&ids[0])["status"], "halted");
}

#[test]
fn an_error_reply_with_exit_status_zero_halts_the_run_with_its_text() {
    let project = Project::new("iserror").with_agents();
    project.fake_claude(r#"echo '{"is_error":true,"result":"Credit balance is too low"}'"#);
    let output = project.run(&["--harness", "claude"]);
    assert_eq!(exit(&output), 1);
    assert!(stdout(&output).contains("blocked (SESSION_FAILED)"));
    assert!(
        stderr(&output).contains("Credit balance is too low"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn a_reply_that_is_not_json_with_exit_zero_is_a_missing_result() {
    let project = Project::new("notjson").with_agents();
    project.fake_claude(&format!("echo '{SUCCESS}'"));
    let output = project.run(&["--harness", "claude"]);
    assert_eq!(exit(&output), 1);
    assert!(
        stdout(&output).contains("blocked (RESULT_MISSING)"),
        "{}",
        stdout(&output)
    );
    assert_eq!(stderr(&output).lines().count(), 1, "{}", stderr(&output));
}

#[test]
fn an_agent_that_only_kiro_has_fails_before_any_stage_and_the_message_names_the_target() {
    let project = Project::new("target");
    let target = scratch_dir("target-elsewhere");
    std::fs::create_dir_all(target.join(".claude/agents")).unwrap();
    std::fs::write(target.join(".claude/agents/k-architect.md"), AGENT).unwrap();
    // A Kiro definition in the project does not count for Claude.
    project.write(".kiro/agents/k-architect.json", r#"{"allowedTools":[]}"#);
    project.index(&[(target.to_str().unwrap(), &["claude"], "complete")]);
    let marker = project.bin.join("ran");
    project.fake_claude(&format!("echo ran > '{}'", marker.display()));
    let output = project.run(&["--harness", "claude"]);
    let err = stderr(&output);
    assert_eq!(exit(&output), 64, "{err}");
    assert!(err.contains("Claude Code cannot see it"), "{err}");
    assert!(err.contains(".claude/agents/k-architect.md"), "{err}");
    assert!(
        err.contains(&format!(
            "at {}, which is neither the project root nor the home folder",
            target.display()
        )),
        "{err}"
    );
    assert!(!marker.exists(), "a session started");
    assert!(project.run_ids().is_empty());
    std::fs::remove_dir_all(target).ok();
}

#[test]
fn an_agent_in_the_home_folder_is_seen() {
    let project = Project::new("homeagent");
    for agent in ["k-architect", "k-developer"] {
        let path = project.home.join(format!(".claude/agents/{agent}.md"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, AGENT).unwrap();
    }
    project.fake_claude(&reply(&SUCCESS.replace('"', "\\\"")));
    let output = project.run(&["--harness", "claude"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
}

#[test]
fn an_agent_in_a_folder_above_the_project_root_inside_the_git_top_folder_is_seen() {
    let mut project = Project::new("above");
    let top = project.root.clone();
    // The git top folder holds the agents. The project root is a folder below it that holds `.konductor`.
    std::fs::create_dir_all(top.join(".git")).unwrap();
    for agent in ["k-architect", "k-developer"] {
        let path = top.join(format!(".claude/agents/{agent}.md"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, AGENT).unwrap();
    }
    project.root = top.join("pkg");
    project.extra.push(top);
    project.write(".konductor/workflows/hello-plan.yml", &hello_plan());
    project.fake_claude(&reply(&SUCCESS.replace('"', "\\\"")));
    let output = project.run(&["--harness", "claude"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
}
