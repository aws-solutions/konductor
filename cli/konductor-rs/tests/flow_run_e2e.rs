// SPDX-License-Identifier: Apache-2.0
//
// flow_run_e2e.rs: drives the REAL compiled binary through `konductor flow run` on the `fake` harness, and through
// `konductor init` for the run folder's git-ignore line.
//
// Isolation: every run happens in a scratch directory under `std::env::temp_dir()`, with `HOME` set to a scratch
// directory too. `KONDUCTOR_FAKE_SCRIPT` is removed from the environment unless a test sets it. Telemetry, if a
// command reaches it, goes to a loopback `telemetry_test_sink`. The fake harness runs no agent and needs no network. No
// test sleeps: the one that keeps a run open holds it on a named pipe.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::time::Duration;

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-flow-run-e2e-{name}-{}-{}",
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

const SUCCESS: &str = r#"KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}"#;

/// A script whose stages all reply with a valid success line.
fn passing_script() -> String {
    format!(
        r#"{{"stages": {{"plan": {{"reply": "Wrote it.\n{SUCCESS}", "duration_ms": 1500}},
            "implement": {{"reply": "{SUCCESS}"}}}}}}"#
    )
}

/// A project with hello-plan in `.konductor/workflows/`, a home folder, and a script.
struct Project {
    root: PathBuf,
    home: PathBuf,
    sink: telemetry_test_sink::TelemetrySink,
}

impl Project {
    fn new(label: &str) -> Project {
        let project = Project::bare(label);
        project.write(".konductor/workflows/hello-plan.yml", &hello_plan());
        project
    }

    fn bare(label: &str) -> Project {
        let root = scratch_dir(&format!("{label}-project"));
        let home = scratch_dir(&format!("{label}-home"));
        let sink = telemetry_test_sink::TelemetrySink::start();
        Project { root, home, sink }
    }

    fn write(&self, relative: &str, text: &str) -> PathBuf {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        path
    }

    fn read(&self, relative: &str) -> String {
        std::fs::read_to_string(self.root.join(relative))
            .unwrap_or_else(|e| panic!("{relative}: {e}"))
    }

    fn command<S: AsRef<std::ffi::OsStr>>(&self, args: &[S]) -> Command {
        let mut command = Command::new(bin());
        command
            .args(args)
            .current_dir(&self.root)
            .env("HOME", &self.home)
            .env_remove("NO_COLOR")
            .env_remove("KONDUCTOR_LOG")
            .env_remove("KONDUCTOR_FAKE_SCRIPT")
            .stdin(Stdio::null());
        for var in self.sink.env_vars() {
            command.env(var.name, var.value);
        }
        command
    }

    /// Runs `konductor flow <args>`. A `run` is given the trust hash of its workflow, since these tests are about the
    /// run and not the trust gate (`flow_trust_e2e.rs` covers that). A test that passes `--trust` itself keeps it.
    fn flow(&self, args: &[&str]) -> Output {
        let mut full = vec!["flow".to_string()];
        full.extend(args.iter().map(|a| a.to_string()));
        if args.first() == Some(&"run") && !args.contains(&"--trust") {
            if let Some(hash) = args.get(1).and_then(|name| self.trust_hash(name)) {
                full.push("--trust".to_string());
                full.push(hash);
            }
        }
        self.command(&full).output().expect("spawn konductor")
    }

    /// The trust hash `flow check` prints for a workflow, or `None` if it prints none.
    fn trust_hash(&self, name: &str) -> Option<String> {
        let output = self
            .command(&["flow", "check", name, "--json"])
            .output()
            .expect("spawn konductor");
        let report: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
        Some(report.get("trust_hash")?.as_str()?.to_string())
    }

    /// `flow run hello-plan --harness fake --fake-script <script>`, plus `extra`.
    fn run_with_script(&self, script: &str, extra: &[&str]) -> Output {
        let path = self.write("script.json", script);
        let path = path.to_str().unwrap();
        let mut args = vec![
            "run",
            "hello-plan",
            "--harness",
            "fake",
            "--fake-script",
            path,
        ];
        args.extend_from_slice(extra);
        self.flow(&args)
    }

    /// The only run folder's state, as JSON.
    fn only_state(&self) -> serde_json::Value {
        let runs = self.run_ids();
        assert_eq!(runs.len(), 1, "{runs:?}");
        self.state(&runs[0])
    }

    fn state(&self, run_id: &str) -> serde_json::Value {
        serde_json::from_str(&self.read(&format!(".konductor/runs/{run_id}/state.json")))
            .expect("json")
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
        std::fs::remove_dir_all(&self.root).ok();
        std::fs::remove_dir_all(&self.home).ok();
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

// --- a run that passes, and one that halts -------------------------------------------------------------------------

#[test]
fn hello_plan_passes_on_the_fake_harness() {
    let project = Project::new("pass");
    let output = project.run_with_script(&passing_script(), &[]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let out = stdout(&output);
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(
        lines[..2],
        ["stage plan: passed", "stage implement: passed"]
    );
    let state = project.only_state();
    assert_eq!(
        lines[2],
        format!("run {}: passed", state["run_id"].as_str().unwrap())
    );
    assert_eq!(state["status"], "passed");
    assert_eq!(state["exit_code"], 0);
    assert_eq!(state["harness"], "fake");
    assert_eq!(state["checks"]["plan-exists"], "deferred");
    assert_eq!(state["stages"]["implement"]["status"], "passed");
    let run_id = state["run_id"].as_str().unwrap();
    let pattern = |c: char| c.is_ascii_digit() || c.is_ascii_lowercase();
    assert!(
        run_id.len() == 19 && run_id.chars().all(|c| pattern(c) || c == '-'),
        "{run_id}"
    );
    // The lock file stays, since it is never deleted, but the lock was given back: the next run starts.
    assert!(project.root.join(".konductor/runs/lock").is_file());
    assert_eq!(exit(&project.run_with_script(&passing_script(), &[])), 0);
}

#[test]
fn the_goal_flag_reaches_the_run_and_json_prints_the_state() {
    let project = Project::new("json");
    let output = project.run_with_script(&passing_script(), &["--goal", "Mine.", "--json"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let out = stdout(&output);
    assert_eq!(out.lines().count(), 1, "{out}");
    let printed: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(printed, project.only_state());
    assert_eq!(stderr(&output), "");
}

#[test]
fn a_missing_result_line_halts_the_run_with_exit_1_and_later_stages_stay_pending() {
    let project = Project::new("missing");
    let script = format!(
        r#"{{"stages": {{"plan": {{"reply": "I wrote PLAN.md."}}, "implement": {{"reply": "{SUCCESS}"}}}}}}"#
    );
    let output = project.run_with_script(&script, &[]);
    assert_eq!(exit(&output), 1, "{}", stderr(&output));
    assert!(
        stdout(&output).starts_with("stage plan: blocked (RESULT_MISSING)\nrun "),
        "{}",
        stdout(&output)
    );
    assert!(stdout(&output).ends_with(": halted\n"));
    let state = project.only_state();
    assert_eq!(state["status"], "halted");
    assert_eq!(state["exit_code"], 1);
    assert_eq!(state["stages"]["plan"]["status"], "blocked");
    assert_eq!(state["stages"]["plan"]["reason"], "RESULT_MISSING");
    assert_eq!(
        state["stages"]["implement"],
        serde_json::json!({"status": "pending"})
    );
}

#[test]
fn a_session_that_hangs_past_the_limit_halts_with_timeout() {
    let project = Project::new("hang");
    let script =
        format!(r#"{{"stages": {{"plan": {{"reply": "{SUCCESS}", "duration_ms": 1800001}}}}}}"#);
    let output = project.run_with_script(&script, &[]);
    assert_eq!(exit(&output), 1, "{}", stderr(&output));
    assert_eq!(project.only_state()["stages"]["plan"]["reason"], "TIMEOUT");
}

#[test]
fn a_failed_session_and_a_failure_result_have_their_reasons() {
    for (entry, reason) in [
        (
            format!(r#"{{"reply": "{SUCCESS}", "exit_status": 2}}"#),
            "SESSION_FAILED",
        ),
        (
            r#"{"reply": "KONDUCTOR_RESULT {\"status\": \"failure\", \"outputs\": []}"}"#
                .to_string(),
            "RESULT_FAILURE",
        ),
        (
            r#"{"reply": "KONDUCTOR_RESULT {\"status\": \"done\"}"}"#.to_string(),
            "RESULT_INVALID",
        ),
    ] {
        let project = Project::new("reasons");
        let output = project.run_with_script(&format!(r#"{{"stages": {{"plan": {entry}}}}}"#), &[]);
        assert_eq!(exit(&output), 1, "{reason}: {}", stderr(&output));
        assert_eq!(project.only_state()["stages"]["plan"]["reason"], reason);
    }
}

// --- a run left running by a process that is gone ------------------------------------------------------------------

/// The PID of a process that has ended and been reaped.
fn dead_pid() -> u32 {
    let mut child = Command::new("true").spawn().expect("spawn true");
    let pid = child.id();
    child.wait().expect("wait");
    pid
}

#[test]
fn a_run_left_running_by_a_dead_process_reads_halted_and_its_lock_does_not_block() {
    let project = Project::new("dead");
    let pid = dead_pid();
    let old = "20261105-1200-old01";
    let owner = format!(r#"{{"pid": {pid}, "started": "gone"}}"#);
    project.write(
        &format!(".konductor/runs/{old}/state.json"),
        &format!(
            r#"{{"checks": {{"plan-exists": "deferred"}}, "exit_code": null, "finished_at": null, "harness": "fake",
            "order": ["plan", "implement"], "owner": {owner}, "reported_outputs": {{}}, "run_id": "{old}",
            "stages": {{"implement": {{"status": "pending"}}, "plan": {{"status": "running"}}}},
            "started_at": "2026-11-05T12:00:00Z", "status": "running", "workflow": "hello-plan"}}"#
        ),
    );
    project.write(
        ".konductor/runs/lock",
        &format!(r#"{{"pid":{pid},"run_id":"{old}","started":"gone"}}"#),
    );
    let output = project.run_with_script(&passing_script(), &[]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert_eq!(
        stderr(&output),
        format!("note: Run {old} was left running by process {pid}, which is gone. It now reads as halted.\n")
    );
    let ended = project.state(old);
    assert_eq!(ended["status"], "halted");
    assert_eq!(ended["exit_code"], 1);
    assert_eq!(ended["stages"]["plan"]["reason"], "SESSION_FAILED");
    assert_eq!(ended["stages"]["implement"]["status"], "pending");
    assert!(ended["finished_at"].is_string());
    assert_eq!(project.run_ids().len(), 2);
}

/// Starts `flow run hello-plan` with a plan stage that waits on a named pipe, and returns once the run is inside that
/// stage, holding the lock. The returned writer ends the wait: write to it and drop it.
fn start_held_run(project: &Project) -> (std::process::Child, std::fs::File) {
    let fifo = project.root.join("hold");
    let made = Command::new("mkfifo").arg(&fifo).status().expect("mkfifo");
    assert!(made.success());
    let held = format!(
        r#"{{"stages": {{"plan": {{"reply": "{SUCCESS}", "wait_for": "{}"}}, "implement": {{"reply": "{SUCCESS}"}}}}}}"#,
        fifo.display()
    );
    let script = project.write("held.json", &held);
    let mut first = project
        .command(&[
            "flow",
            "run",
            "hello-plan",
            "--harness",
            "fake",
            "--fake-script",
            script.to_str().unwrap(),
        ])
        .env("KONDUCTOR_TRUST", project.trust_hash("hello-plan").unwrap())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn the first run");

    // Opening the pipe for writing returns once the first run opens it to read, which it does inside its first stage,
    // holding the lock. A run that fails before that would leave the open waiting, so it has a deadline.
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(std::fs::OpenOptions::new().write(true).open(fifo));
    });
    let Ok(Ok(writer)) = receiver.recv_timeout(Duration::from_secs(60)) else {
        let _ = first.kill();
        panic!(
            "the first run did not reach its first stage: {:?}",
            first.wait_with_output()
        );
    };
    (first, writer)
}

#[test]
fn a_run_killed_while_it_holds_the_lock_reads_halted_and_does_not_block() {
    let project = Project::new("killed");
    let (mut first, writer) = start_held_run(&project);
    let pid = first.id();
    let old = project.only_state()["run_id"].as_str().unwrap().to_string();
    // SIGKILL: the run gets no chance to give anything back. The kernel ends its lock.
    first.kill().expect("kill the first run");
    first.wait().expect("reap the first run");
    drop(writer);
    assert!(project.read(".konductor/runs/lock").contains(&old));

    let output = project.run_with_script(&passing_script(), &[]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert_eq!(
        stderr(&output),
        format!("note: Run {old} was left running by process {pid}, which is gone. It now reads as halted.\n")
    );
    let ended = project.state(&old);
    assert_eq!(ended["status"], "halted");
    assert_eq!(ended["exit_code"], 1);
    assert_eq!(ended["stages"]["plan"]["reason"], "SESSION_FAILED");
    assert_eq!(ended["stages"]["implement"]["status"], "pending");
    assert_eq!(project.run_ids().len(), 2);
}

// --- one run per workspace -----------------------------------------------------------------------------------------

#[test]
fn a_second_flow_run_is_refused_while_the_first_process_is_alive() {
    let project = Project::new("two");
    let (first, mut writer) = start_held_run(&project);

    let second = project.run_with_script(&passing_script(), &[]);
    assert_eq!(exit(&second), 75, "{}", stderr(&second));
    let message = stderr(&second);
    assert!(
        message.contains(&format!("owned by process {}", first.id())),
        "{message}"
    );
    assert!(
        message.starts_with("konductor flow: Another run is active in this workspace"),
        "{message}"
    );
    let json = project.run_with_script(&passing_script(), &["--json"]);
    assert_eq!(exit(&json), 75);
    let envelope: serde_json::Value = serde_json::from_str(&stdout(&json)).expect("json envelope");
    assert_eq!(envelope["code"], "already_running");
    assert_eq!(envelope["pid"], first.id());

    writer.write_all(b"go").unwrap();
    drop(writer);
    let first = first.wait_with_output().expect("wait for the first run");
    assert_eq!(exit(&first), 0, "{}", stderr(&first));
    // Only the first run has a folder; the refused ones left none.
    assert_eq!(project.run_ids().len(), 1);
    // With the first run done, a new one starts.
    assert_eq!(exit(&project.run_with_script(&passing_script(), &[])), 0);
}

#[test]
fn a_held_lock_whose_record_cannot_be_read_exits_75_with_the_owner_unknown() {
    let project = Project::new("unreadable");
    let (first, mut writer) = start_held_run(&project);
    // The first run holds the lock. Its record is cut short, as if it were still being written.
    let record = project.read(".konductor/runs/lock");
    project.write(".konductor/runs/lock", &record[..record.len() / 2]);
    let output = project.run_with_script(&passing_script(), &[]);
    assert_eq!(exit(&output), 75);
    assert!(
        stderr(&output)
            .contains("is held but its record cannot be read, or another start is taking it"),
        "{}",
        stderr(&output)
    );
    let json = project.run_with_script(&passing_script(), &["--json"]);
    assert_eq!(exit(&json), 75);
    let envelope: serde_json::Value = serde_json::from_str(&stdout(&json)).expect("json envelope");
    assert_eq!(envelope["code"], "lock_unreadable");
    assert!(envelope.get("run_id").is_none() && envelope.get("pid").is_none());
    assert_eq!(project.run_ids().len(), 1);

    writer.write_all(b"go").unwrap();
    drop(writer);
    let first = first.wait_with_output().expect("wait for the first run");
    assert_eq!(exit(&first), 0, "{}", stderr(&first));
    // With no holder, a record that cannot be read blocks nothing.
    project.write(".konductor/runs/lock", "not a record");
    assert_eq!(exit(&project.run_with_script(&passing_script(), &[])), 0);
}

#[test]
fn a_start_that_meets_another_start_taking_the_lock_exits_75_with_the_owner_unknown() {
    let project = Project::new("claiming");
    project.write(".konductor/runs/lock", "");
    // This test process holds `claim`, as a start does while it writes its record.
    let claim = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(project.root.join(".konductor/runs/claim"))
        .unwrap();
    claim.try_lock().expect("take claim");
    let json = project.run_with_script(&passing_script(), &["--json"]);
    assert_eq!(exit(&json), 75, "{}", stderr(&json));
    let envelope: serde_json::Value = serde_json::from_str(&stdout(&json)).expect("json envelope");
    assert_eq!(envelope["code"], "lock_unreadable");
    assert_eq!(project.run_ids().len(), 0);
    // No run is tried after `claim` is given back here. A process that another test is starting at that moment holds
    // a copy of this file until it runs its program, so `claim` could still look taken.
    drop(claim);
}

#[test]
fn a_lock_write_that_fails_is_a_runtime_error_and_the_next_run_starts() {
    let project = Project::new("write-fails");
    // With the line already there, `flow run` writes no file before the lock.
    project.write(".konductor/.gitignore", "runs/\n");
    let script = project.write("script.json", &passing_script());
    // `ulimit -f 0` makes every write to a file fail, and with SIGXFSZ ignored the write returns an error.
    let command = "trap '' XFSZ; ulimit -f 0; exec \"$0\" flow run hello-plan --harness fake --fake-script \"$1\"";
    let mut shell = Command::new("sh");
    shell
        .args(["-c", command, bin(), script.to_str().unwrap()])
        .current_dir(&project.root)
        .env("HOME", &project.home)
        .env_remove("NO_COLOR")
        .env_remove("KONDUCTOR_LOG")
        .env_remove("KONDUCTOR_FAKE_SCRIPT")
        .env("KONDUCTOR_TRUST", project.trust_hash("hello-plan").unwrap())
        .stdin(Stdio::null());
    for var in project.sink.env_vars() {
        shell.env(var.name, var.value);
    }
    let output = shell.output().expect("spawn sh");
    assert_eq!(exit(&output), 1, "{}", stderr(&output));
    assert!(
        stderr(&output).contains("could not write"),
        "{}",
        stderr(&output)
    );
    let mut names: Vec<String> = std::fs::read_dir(project.root.join(".konductor/runs"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    // The two lock files are made empty and stay; no temp file and no run folder is left.
    assert_eq!(names, ["claim", "lock"]);
    assert_eq!(project.read(".konductor/runs/lock"), "");
    let next = project.run_with_script(&passing_script(), &[]);
    assert_eq!(exit(&next), 0, "{}", stderr(&next));
}

#[test]
fn many_flow_runs_against_a_stale_record_leave_exactly_one_active() {
    const TRIALS: usize = 3;
    const STARTERS: usize = 6;
    for trial in 0..TRIALS {
        let project = Project::new("stress");
        project.write(
            ".konductor/runs/lock",
            &format!(
                r#"{{"pid":{},"run_id":"20261105-1200-stale","started":"gone"}}"#,
                dead_pid()
            ),
        );
        let fifo = project.root.join("hold");
        assert!(Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo")
            .success());
        let held = format!(
            r#"{{"stages": {{"plan": {{"reply": "{SUCCESS}", "wait_for": "{}"}}, "implement": {{"reply": "{SUCCESS}"}}}}}}"#,
            fifo.display()
        );
        let script = project.write("held.json", &held);
        let (sender, receiver) = mpsc::channel();
        let mut pids = Vec::new();
        let trust = project.trust_hash("hello-plan").unwrap();
        for _ in 0..STARTERS {
            let child = project
                .command(&[
                    "flow",
                    "run",
                    "hello-plan",
                    "--harness",
                    "fake",
                    "--fake-script",
                    script.to_str().unwrap(),
                    "--json",
                ])
                .env("KONDUCTOR_TRUST", &trust)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .expect("spawn flow run");
            let sender = sender.clone();
            pids.push(child.id().to_string());
            std::thread::spawn(move || {
                let pid = child.id();
                let _ = sender.send((pid, child.wait_with_output()));
            });
        }
        // Every start but the one that holds the lock is refused, and the holder waits on the pipe.
        let mut refused = Vec::new();
        for _ in 1..STARTERS {
            let Ok((pid, Ok(output))) = receiver.recv_timeout(Duration::from_secs(60)) else {
                let _ = Command::new("kill").args(&pids).status();
                panic!(
                    "trial {trial}: fewer than {} starts were refused",
                    STARTERS - 1
                );
            };
            assert_eq!(exit(&output), 75, "trial {trial}: {}", stdout(&output));
            let envelope: serde_json::Value =
                serde_json::from_str(&stdout(&output)).expect("json envelope");
            refused.push((pid, envelope));
        }
        let holder: serde_json::Value =
            serde_json::from_str(&project.read(".konductor/runs/lock")).expect("lock record");
        for (pid, envelope) in &refused {
            assert_ne!(holder["pid"], *pid, "trial {trial}");
            match envelope["code"].as_str() {
                // A refused start never names the stale record: records are only read under `claim`.
                Some("already_running") => assert_eq!(envelope["pid"], holder["pid"]),
                Some("lock_unreadable") => {}
                other => panic!("trial {trial}: {other:?} {envelope}"),
            }
        }
        let mut writer = std::fs::OpenOptions::new().write(true).open(&fifo).unwrap();
        writer.write_all(b"go").unwrap();
        drop(writer);
        let (pid, output) = receiver
            .recv_timeout(Duration::from_secs(60))
            .expect("the holder ends");
        let output = output.unwrap();
        assert_eq!(exit(&output), 0, "trial {trial}: {}", stderr(&output));
        assert_eq!(holder["pid"], pid, "trial {trial}");
        assert_eq!(project.run_ids().len(), 1, "trial {trial}");
    }
}

// --- choosing the harness ------------------------------------------------------------------------------------------

#[test]
fn a_missing_or_unknown_harness_is_a_usage_error_and_claude_needs_its_agents() {
    let project = Project::new("harness");
    let output = project.flow(&["run", "hello-plan"]);
    assert_eq!(exit(&output), 64);
    assert!(stderr(&output).contains("--harness"), "{}", stderr(&output));
    let output = project.flow(&["run", "hello-plan", "--harness", "claude"]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("Claude Code cannot see it"),
        "{}",
        stderr(&output)
    );
    let output = project.flow(&["run", "hello-plan", "--harness", "kiro"]);
    assert_eq!(exit(&output), 64);
    assert!(project.run_ids().is_empty());
}

#[test]
fn fake_needs_a_script_and_the_variable_works_in_place_of_the_flag() {
    let project = Project::new("fake-script");
    let output = project.flow(&["run", "hello-plan", "--harness", "fake"]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("KONDUCTOR_FAKE_SCRIPT"),
        "{}",
        stderr(&output)
    );
    assert!(!project.root.join(".konductor/runs").exists());

    let script = project.write("script.json", &passing_script());
    let output = project
        .command(&["flow", "run", "hello-plan", "--harness", "fake"])
        .env("KONDUCTOR_FAKE_SCRIPT", &script)
        .env("KONDUCTOR_TRUST", project.trust_hash("hello-plan").unwrap())
        .output()
        .unwrap();
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert_eq!(project.only_state()["status"], "passed");
}

#[test]
fn a_bad_script_is_a_usage_error() {
    let project = Project::new("bad-script");
    let output = project.run_with_script("{\"stages\": []}", &[]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("The fake script cannot be used"),
        "{}",
        stderr(&output)
    );
    let output = project.flow(&[
        "run",
        "hello-plan",
        "--harness",
        "fake",
        "--fake-script",
        "none.json",
    ]);
    assert_eq!(exit(&output), 64);
    assert!(project.run_ids().is_empty());
}

// --- inputs that refuse the run before it starts -------------------------------------------------------------------

#[test]
fn a_workflow_with_errors_exits_65_and_writes_nothing() {
    let project = Project::bare("broken");
    project.write(".konductor/workflows/hello-plan.yml", "a: [");
    let output = project.run_with_script(&passing_script(), &[]);
    assert_eq!(exit(&output), 65);
    assert!(
        stderr(&output).contains("YAML_SYNTAX"),
        "{}",
        stderr(&output)
    );
    assert!(!project.root.join(".konductor/runs").exists());
    assert!(!project.root.join(".konductor/.gitignore").exists());
}

#[test]
fn a_goal_or_a_prompt_over_its_limit_exits_64_before_anything_runs() {
    let project = Project::new("limits");
    let long_goal = "g".repeat(2049);
    let output = project.run_with_script(&passing_script(), &["--goal", &long_goal]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("2049 characters"),
        "{}",
        stderr(&output)
    );
    assert_eq!(
        exit(&project.run_with_script(&passing_script(), &["--goal", &"g".repeat(2048)])),
        0
    );

    let project = Project::bare("big-prompt");
    let big = "😀".repeat(32_768);
    project.write(
        ".konductor/workflows/hello-plan.yml",
        &format!(
            "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nparams:\n  goal:\n    default: g\n\
             stages:\n  - name: plan\n    agent: k-architect\n    prompt: {big}\n"
        ),
    );
    let output = project.run_with_script(&passing_script(), &[]);
    assert_eq!(exit(&output), 64, "{}", stderr(&output));
    assert!(
        stderr(&output).contains("The prompt of stage `plan`"),
        "{}",
        stderr(&output)
    );
    assert!(project.run_ids().is_empty());
}

#[test]
fn a_blank_goal_exits_64_before_anything_runs() {
    let project = Project::new("blank-goal");
    for blank in ["", "   ", "\t\n"] {
        let output = project.run_with_script(&passing_script(), &["--goal", blank]);
        assert_eq!(exit(&output), 64, "{blank:?}: {}", stderr(&output));
        assert!(
            stderr(&output).contains("`--goal` is blank"),
            "{}",
            stderr(&output)
        );
    }
    assert!(!project.root.join(".konductor/runs").exists());
}

#[test]
fn a_workflow_with_no_default_goal_needs_the_flag() {
    let project = Project::bare("no-goal");
    project.write(
        ".konductor/workflows/hello-plan.yml",
        "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nstages:\n  - name: plan\n    agent: k-architect\n",
    );
    let output = project.run_with_script(&passing_script(), &[]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("`--goal` is required"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn a_shipped_or_bad_name_is_a_usage_error() {
    let project = Project::new("names");
    let script = project.write("script.json", &passing_script());
    let script = script.to_str().unwrap();
    let output = project.flow(&[
        "run",
        "library/hello-plan",
        "--harness",
        "fake",
        "--fake-script",
        script,
    ]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("are not available yet"),
        "{}",
        stderr(&output)
    );
    for name in ["Bad", "ghost"] {
        let output = project.flow(&["run", name, "--harness", "fake", "--fake-script", script]);
        assert_eq!(exit(&output), 64, "{name}");
    }
}

#[test]
fn no_flow_run_ever_exits_2() {
    let project = Project::new("never-2");
    for args in [
        &["run"][..],
        &["run", "hello-plan"],
        &["run", "hello-plan", "--harness"],
        &["run", "hello-plan", "--harness", "fake", "--goal"],
        &["run", "hello-plan", "--harness", "fake", "--bogus"],
    ] {
        let code = exit(&project.flow(args));
        assert_eq!(code, 64, "{args:?}");
    }
}

// --- the git-ignore line for the runs ------------------------------------------------------------------------------

#[test]
fn init_writes_the_runs_line_to_the_konductor_gitignore() {
    let project = Project::bare("init");
    let output = project.command(&["init"]).output().unwrap();
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let text = project.read(".konductor/.gitignore");
    assert!(text.lines().any(|line| line == "runs/"), "{text}");
}

#[test]
fn flow_run_makes_the_konductor_gitignore_when_it_is_missing() {
    let project = Project::new("ignore-missing");
    assert_eq!(exit(&project.run_with_script(&passing_script(), &[])), 0);
    assert_eq!(project.read(".konductor/.gitignore"), "runs/\n");
}

#[test]
fn flow_run_adds_the_runs_line_once_and_keeps_the_other_lines() {
    let project = Project::new("ignore-keep");
    project.write(".konductor/.gitignore", "# mine\n*.key");
    assert_eq!(exit(&project.run_with_script(&passing_script(), &[])), 0);
    assert_eq!(exit(&project.run_with_script(&passing_script(), &[])), 0);
    assert_eq!(
        project.read(".konductor/.gitignore"),
        "# mine\n*.key\nruns/\n"
    );
}
