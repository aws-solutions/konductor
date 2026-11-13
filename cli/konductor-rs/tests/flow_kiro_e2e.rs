// SPDX-License-Identifier: Apache-2.0
//
// flow_kiro_e2e.rs: drives the REAL compiled binary through `konductor flow run` on the `kiro-cli` harness, with a
// fake `kiro-cli` (a shell script first on PATH) in place of the real one. It covers the choice of the harness from the
// install index, the agents the harness cannot see, a run that passes, and the orphan sweep after an owner is killed
// with SIGKILL during a session.
//
// Isolation: every run happens in a scratch directory under `std::env::temp_dir()`, with `HOME` set to a scratch
// directory too, so the user's own install index and agents are never read. No test starts the real Kiro CLI.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-flow-kiro-e2e-{name}-{}-{}",
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

const V2_AGENT: &str = r#"{"name":"agent","allowedTools":["fs_read","fs_write"]}"#;

/// A project with hello-plan, a home folder, and a folder of fake programs that comes first on PATH.
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

    /// An agent file for each stage agent of hello-plan, in the project root.
    fn with_agents(self) -> Project {
        for agent in ["k-architect", "k-developer"] {
            self.write(&format!(".kiro/agents/{agent}.json"), V2_AGENT);
        }
        self
    }

    /// The install index, with one entry for each `(target, strategies, status)`.
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

    /// Puts an executable `kiro-cli` script on PATH.
    fn fake_kiro(&self, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        let path = self.bin.join("kiro-cli");
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

    fn run_args(&self, extra: &[&str]) -> Vec<String> {
        let mut args: Vec<String> = ["flow", "run", "hello-plan", "--goal", "Do it."]
            .iter()
            .map(|a| (*a).to_string())
            .collect();
        args.extend(extra.iter().map(|a| (*a).to_string()));
        args.push("--trust".to_string());
        args.push(self.trust_hash());
        args
    }

    /// `flow run hello-plan --goal ...` plus `extra`, given the trust hash.
    fn run(&self, extra: &[&str]) -> Output {
        self.command(&self.run_args(extra))
            .output()
            .expect("spawn konductor")
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
        let mut ids: Vec<String> = entries
            .map(|e| e.unwrap())
            .filter(|e| e.file_type().unwrap().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        ids.sort();
        ids
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

/// Whether a process still runs. A zombie that nobody has reaped yet does not count.
fn alive(pid: u32) -> bool {
    let output = Command::new("/bin/ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .expect("run ps");
    let stat = String::from_utf8_lossy(&output.stdout);
    let stat = stat.trim();
    !stat.is_empty() && !stat.starts_with('Z')
}

fn wait_for(what: &str, mut ready: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(20);
    while Instant::now() < until {
        if ready() {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    panic!("timed out waiting for {what}");
}

// --- choosing the harness from the install index -------------------------------------------------------------------

#[test]
fn without_a_harness_the_one_installed_runner_harness_is_used() {
    for strategy in ["kiro-v3", "kiro-cli-v2"] {
        let project = Project::new("pick").with_agents();
        project.index(&[("/some/target", &[strategy], "complete")]);
        project.fake_kiro(&format!("echo 'done'\necho '{SUCCESS}'"));
        let output = project.run(&[]);
        assert_eq!(exit(&output), 0, "{strategy}: {}", stderr(&output));
        let ids = project.run_ids();
        assert_eq!(ids.len(), 1);
        assert_eq!(project.state(&ids[0])["harness"], "kiro-cli");
        assert_eq!(project.state(&ids[0])["status"], "passed");
    }
}

#[test]
fn a_hello_plan_run_passes_on_kiro_with_the_arguments_the_spec_gives() {
    let project = Project::new("args").with_agents();
    let log = project.bin.join("args.log");
    project.fake_kiro(&format!(
        "pwd >> '{0}'\nfor a in \"$@\"; do echo \"$a\"; done >> '{0}'\necho '{SUCCESS}'",
        log.display()
    ));
    let output = project.run(&["--harness", "kiro-cli"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert!(
        stdout(&output).contains("stage plan: passed"),
        "{}",
        stdout(&output)
    );
    let text = std::fs::read_to_string(&log).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    // The session starts in the project root, with the V2 engine flag and no trust flag.
    assert_eq!(
        Path::new(lines[0]),
        std::fs::canonicalize(&project.root).unwrap()
    );
    assert_eq!(
        &lines[1..6],
        ["chat", "--no-interactive", "--agent", "k-architect", "--v2"]
    );
    assert!(lines[6].starts_with("Goal: Do it."), "{}", lines[6]);
    assert!(!text.contains("--trust"), "{text}");
}

#[test]
fn a_session_that_fails_halts_the_run_and_says_why_in_one_line() {
    let project = Project::new("fails").with_agents();
    project.fake_kiro("echo 'Mode not found'; exit 4");
    let output = project.run(&["--harness", "kiro-cli"]);
    assert_eq!(exit(&output), 1);
    assert!(stdout(&output).contains("stage plan: blocked (SESSION_FAILED)"));
    let err = stderr(&output);
    assert_eq!(err.lines().count(), 1, "{err}");
    assert!(err.contains("exit status 4"), "{err}");
    let ids = project.run_ids();
    assert_eq!(project.state(&ids[0])["status"], "halted");
}

#[test]
fn both_or_neither_installed_makes_the_flag_required_and_claude_says_step_1f_2() {
    let neither = Project::new("neither").with_agents();
    let output = neither.run(&[]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("`--harness` is required"),
        "{}",
        stderr(&output)
    );

    let both = Project::new("both").with_agents();
    both.index(&[
        ("/a", &["kiro-v3"], "complete"),
        ("/b", &["claude"], "complete"),
    ]);
    let output = both.run(&[]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("both `kiro-cli` and `claude` are installed"),
        "{}",
        stderr(&output)
    );

    let only_claude = Project::new("claude").with_agents();
    only_claude.index(&[("/a", &["claude"], "complete")]);
    for extra in [&[][..], &["--harness", "claude"][..]] {
        let output = only_claude.run(extra);
        assert_eq!(exit(&output), 64, "{extra:?}");
        assert!(stderr(&output).contains("step 1f-2"), "{}", stderr(&output));
    }
    // Nothing ran, and nothing was written.
    for project in [&neither, &both, &only_claude] {
        assert!(project.run_ids().is_empty());
    }
}

#[test]
fn an_unfinished_install_does_not_count_as_installed() {
    let project = Project::new("unfinished").with_agents();
    project.index(&[("/a", &["kiro-v3"], "in_progress")]);
    let output = project.run(&[]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("`--harness` is required"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn every_refusal_under_json_is_the_error_envelope_on_standard_output() {
    let neither = Project::new("json-neither").with_agents();
    let both = Project::new("json-both").with_agents();
    both.index(&[
        ("/a", &["kiro-v3"], "complete"),
        ("/b", &["claude"], "complete"),
    ]);
    let claude = Project::new("json-claude").with_agents();
    let unseen = Project::new("json-unseen");
    unseen.index(&[("/a", &["kiro-v3"], "complete")]);
    let cases: [(&Project, &[&str], &str); 4] = [
        (&neither, &["--json"], "`--harness` is required"),
        (&both, &["--json"], "both `kiro-cli` and `claude`"),
        (&claude, &["--json", "--harness", "claude"], "step 1f-2"),
        (
            &unseen,
            &["--json", "--harness", "kiro-cli"],
            "cannot see it",
        ),
    ];
    for (project, extra, phrase) in cases {
        let output = project.run(extra);
        assert_eq!(exit(&output), 64, "{phrase}: {}", stderr(&output));
        assert_eq!(stderr(&output), "", "{phrase}");
        let envelope: serde_json::Value = serde_json::from_str(stdout(&output).trim())
            .unwrap_or_else(|e| panic!("{phrase}: {e}: {}", stdout(&output)));
        assert_eq!(envelope["command"], "flow");
        assert!(
            envelope["error"].as_str().unwrap().contains(phrase),
            "{envelope}"
        );
    }
}

// --- agents the harness cannot see ---------------------------------------------------------------------------------

#[test]
fn an_agent_installed_to_another_target_is_named_before_any_stage_runs() {
    let project = Project::new("target");
    let target = scratch_dir("target-elsewhere");
    std::fs::create_dir_all(target.join(".kiro/agents")).unwrap();
    std::fs::write(target.join(".kiro/agents/k-architect.json"), V2_AGENT).unwrap();
    project.index(&[(target.to_str().unwrap(), &["kiro-cli-v2"], "complete")]);
    let marker = project.bin.join("ran");
    project.fake_kiro(&format!("echo ran > '{}'", marker.display()));
    let output = project.run(&["--harness", "kiro-cli"]);
    let err = stderr(&output);
    assert_eq!(exit(&output), 64, "{err}");
    assert!(err.contains("`k-architect`"), "{err}");
    assert!(err.contains("~/.konductor/installs"), "{err}");
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
fn an_agent_in_no_install_says_so() {
    let project = Project::new("noagent");
    project.index(&[("/nowhere", &["kiro-v3"], "complete")]);
    let output = project.run(&["--harness", "kiro-cli"]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("lists no install that has this agent"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn an_agent_in_the_home_folder_is_seen() {
    let project = Project::new("homeagent");
    for agent in ["k-architect", "k-developer"] {
        let path = project.home.join(format!(".kiro/agents/{agent}.json"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, V2_AGENT).unwrap();
    }
    project.fake_kiro(&format!("echo '{SUCCESS}'"));
    let output = project.run(&["--harness", "kiro-cli"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
}

#[test]
fn an_agent_file_with_an_unclear_engine_fails_before_the_first_stage() {
    let project = Project::new("engine");
    for agent in ["k-architect", "k-developer"] {
        project.write(
            &format!(".kiro/agents/{agent}.json"),
            r#"{"tools":["read"]}"#,
        );
    }
    let output = project.run(&["--harness", "kiro-cli"]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("neither `allowedTools`"),
        "{}",
        stderr(&output)
    );
    assert!(project.run_ids().is_empty());
}

// --- the orphan sweep ----------------------------------------------------------------------------------------------

/// Ends the processes that a test started, even when the test fails.
struct Cleanup(Vec<PathBuf>);

impl Drop for Cleanup {
    fn drop(&mut self) {
        for file in &self.0 {
            if let Some(pid) = std::fs::read_to_string(file)
                .ok()
                .and_then(|text| text.trim().parse::<u32>().ok())
            {
                let _ = Command::new("/bin/kill")
                    .args(["-KILL", "--", &format!("-{pid}")])
                    .output();
            }
        }
    }
}

#[test]
fn a_session_left_running_by_a_killed_owner_is_ended_by_the_next_run() {
    let project = Project::new("sweep").with_agents();
    let pid_file = project.bin.join("session.pid");
    let hang = project.bin.join("hang");
    std::fs::write(&hang, "").unwrap();
    let _cleanup = Cleanup(vec![pid_file.clone()]);
    // While `hang` exists the session starts a child and waits. Without it the session replies at once.
    project.fake_kiro(&format!(
        "if [ -e '{hang}' ]; then echo $$ > '{pid}'; sleep 600 & wait; fi\necho '{SUCCESS}'",
        hang = hang.display(),
        pid = pid_file.display()
    ));

    let mut owner: Child = project
        .command(&project.run_args(&["--harness", "kiro-cli"]))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn owner");
    // The group is in the state document while the session runs.
    let mut old = String::new();
    wait_for("the session group in the run state", || {
        let ids = project.run_ids();
        let Some(id) = ids.first() else { return false };
        let ready = std::fs::read_to_string(
            project
                .root
                .join(format!(".konductor/runs/{id}/state.json")),
        )
        .is_ok_and(|text| text.contains("session_group"));
        if ready {
            old.clone_from(id);
        }
        ready
    });
    let record = project.state(&old)["session_group"].clone();
    let pgid = u32::try_from(record["pgid"].as_u64().unwrap()).unwrap();
    wait_for("the session to write its pid", || pid_file.is_file());
    let session: u32 = std::fs::read_to_string(&pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert_eq!(session, pgid, "the session leads its own process group");

    owner.kill().expect("SIGKILL the owner");
    owner.wait().unwrap();
    assert!(alive(session), "the session outlives its killed owner");
    assert_eq!(project.state(&old)["status"], "running");

    std::fs::remove_file(&hang).unwrap();
    let output = project.run(&["--harness", "kiro-cli"]);
    let err = stderr(&output);
    assert_eq!(exit(&output), 0, "{err}");
    assert!(!alive(session), "the next run ended the session's group");
    let group_note =
        format!("note: Run {old} left a session running in process group {pgid}. It was ended.");
    let halted_note = format!("note: Run {old} was left running by process");
    let at = |needle: &str| {
        err.find(needle)
            .unwrap_or_else(|| panic!("{needle}\n{err}"))
    };
    assert!(at(&group_note) < at(&halted_note), "{err}");
    let ended = project.state(&old);
    assert_eq!(ended["status"], "halted");
    assert!(ended.get("session_group").is_none());
}

#[test]
fn a_session_group_that_cannot_be_ended_is_a_warning_even_under_json() {
    // A record with a group number that no process has: nothing is signalled and the run still ends.
    let project = Project::new("gone").with_agents();
    project.fake_kiro(&format!("echo '{SUCCESS}'"));
    let first = project.run(&["--harness", "kiro-cli"]);
    assert_eq!(exit(&first), 0);
    let old = project.run_ids().remove(0);
    let path = project
        .root
        .join(format!(".konductor/runs/{old}/state.json"));
    let mut state: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    state["status"] = "running".into();
    state["finished_at"] = serde_json::Value::Null;
    state["exit_code"] = serde_json::Value::Null;
    state["stages"]["implement"] = serde_json::json!({"status": "running"});
    state["session_group"] = serde_json::json!({"pgid": 1, "started": "linux:x:1"});
    std::fs::write(&path, serde_json::to_string_pretty(&state).unwrap()).unwrap();

    let output = project.run(&["--harness", "kiro-cli", "--json"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert!(
        stderr(&output).contains(&format!("warning: Run {old} left a session running in process group 1, and it could not be ended")),
        "{}",
        stderr(&output)
    );
    assert_eq!(project.state(&old)["status"], "halted");
}
