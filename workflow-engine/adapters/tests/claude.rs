// SPDX-License-Identifier: Apache-2.0
//! The `claude` harness on fake executables: small shell scripts that print a scripted JSON reply, exit with a status,
//! hang, or start a child. No test here starts a real Claude Code. The checks against the real program are in
//! `claude_conformance.rs`.

#![cfg(unix)]

mod common;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Duration;

use common::TempDir;
use workflow_adapters::process::current_owner;
use workflow_adapters::{
    config_folders, scan_repo_config, ClaudeHarness, FileAgentCatalog, FileRunLock, FileRunStore,
    FileSource, InstalledFiles, SimulatedClock, SystemLauncher,
};
use workflow_core::ports::{
    GroupState, Harness, ProcessGroup, ProcessLauncher, RunLock, RunStore, Session, SessionEnd,
    SessionOutcome,
};
use workflow_core::run::{Run, RunStatus, StageStatus};
use workflow_core::runner::{execute, judge, prepare, start, GuardedHarness, SweepResult};
use workflow_core::{check_text, Reason};

const SUCCESS: &str = "KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}";

/// Tests that take the workspace lock or start a process run one at a time, as in `kiro.rs`: a child holds a copy of
/// every open file of this test binary from its fork to its exec.
fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn exe(dir: &TempDir, name: &str, body: &str) -> PathBuf {
    let path = dir.write(name, format!("#!/bin/sh\n{body}\n").as_bytes());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn alive(pid: u32) -> bool {
    let output = std::process::Command::new("/bin/ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .expect("run ps");
    let stat = String::from_utf8_lossy(&output.stdout);
    let stat = stat.trim();
    !stat.is_empty() && !stat.starts_with('Z')
}

fn read_pid(path: &Path) -> u32 {
    for _ in 0..200 {
        if let Some(pid) = fs::read_to_string(path)
            .ok()
            .and_then(|text| text.trim().parse().ok())
        {
            return pid;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("{} never held a pid", path.display());
}

/// A project with an agent file for each of `agents` (id and front matter) and a folder for the fake `claude`.
struct Claude {
    project: TempDir,
    bin: TempDir,
}

impl Claude {
    fn new(agents: &[(&str, &str)]) -> Claude {
        let project = TempDir::new("claude-project");
        for (id, front) in agents {
            project.write(
                &format!(".claude/agents/{id}.md"),
                format!("---\nname: {id}\n{front}\n---\nBody.\n").as_bytes(),
            );
        }
        Claude {
            project,
            bin: TempDir::new("claude-bin"),
        }
    }

    fn program(&self, body: &str) -> PathBuf {
        exe(&self.bin, "claude", body)
    }

    fn catalog(&self) -> FileAgentCatalog {
        FileAgentCatalog::new(self.project.path(), None)
    }
}

/// The shell text that prints `result` as the JSON reply of a session.
fn reply(result: &str) -> String {
    let json = format!(
        "{{\"type\":\"result\",\"is_error\":false,\"result\":{},\"usage\":{{\"cost\":0.5}}}}",
        workflow_core::json::Json::str(result).compact()
    );
    format!("printf '%s\\n' '{}'", json.replace('\'', "'\\''"))
}

fn session<'a>(stage: &'a str, agent: &'a str, prompt: &'a str) -> Session<'a> {
    Session {
        stage,
        agent,
        prompt,
        time_limit_ms: 60_000,
    }
}

type Lines = Rc<RefCell<Vec<String>>>;
type Sink = Box<dyn FnMut(&str)>;

fn notes() -> (Lines, Sink) {
    let lines = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&lines);
    (
        lines,
        Box::new(move |line| sink.borrow_mut().push(line.to_string())),
    )
}

/// Runs one session, trying again while the freshly written script is busy, which is a failed start and nothing else.
fn run_one(claude: &Claude, program: &Path, grace_ms: u64, s: &Session) -> (SessionOutcome, Lines) {
    let (lines, note) = notes();
    let mut launcher = SystemLauncher::with_grace_ms(grace_ms);
    let catalog = claude.catalog();
    let mut harness = ClaudeHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        claude.project.path().to_str().unwrap(),
        note,
    );
    loop {
        let outcome = harness.run_session(s);
        if outcome.end != SessionEnd::NotStarted {
            return (outcome, lines);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn logging_program(claude: &Claude, reply_line: &str) -> (PathBuf, PathBuf) {
    let log = claude.bin.path().join("args.log");
    let program = claude.program(&format!(
        "for a in \"$@\"; do echo \"$a\"; done > '{}'\n{reply_line}",
        log.display()
    ));
    (program, log)
}

#[test]
fn the_session_gets_the_prompt_after_dash_p_and_the_rules_of_its_tools_last() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[("k-a", "tools: Read, Agent(x, y), mcp__aws-mcp__*, Write")]);
    let (program, log) = logging_program(&claude, &reply(SUCCESS));
    let (outcome, lines) = run_one(
        &claude,
        &program,
        5_000,
        &session("plan", "k-a", "Goal: write it."),
    );
    assert_eq!(outcome.end, SessionEnd::Exited(0));
    assert!(lines.borrow().is_empty());
    assert_eq!(
        fs::read_to_string(&log)
            .unwrap()
            .lines()
            .collect::<Vec<_>>(),
        [
            "-p",
            "Goal: write it.",
            "--output-format",
            "json",
            "--agent",
            "k-a",
            "--allowedTools",
            "Read,Agent(x),Agent(y),mcp__aws-mcp__*,Write"
        ]
    );
}

#[test]
fn the_final_message_is_the_result_field_and_not_the_rest_of_the_reply() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[("k-a", "tools: Read")]);
    let (program, _) = logging_program(&claude, &reply(&format!("Done.\n{SUCCESS}")));
    let (outcome, _) = run_one(&claude, &program, 5_000, &session("plan", "k-a", "p"));
    assert_eq!(outcome.final_message, format!("Done.\n{SUCCESS}"));
    let judged = judge(&outcome, 1).expect("a passing result");
    assert_eq!(judged.outputs, ["PLAN.md"]);
}

#[test]
fn no_tools_key_an_empty_list_and_an_unreadable_list_pass_no_allowed_tools_flag() {
    let _serial = one_at_a_time();
    for (front, note_lines) in [
        ("description: none", 0),
        ("tools: []", 0),
        ("tools: Read Bash", 1),
    ] {
        let claude = Claude::new(&[("k-a", front)]);
        let (program, log) = logging_program(&claude, &reply(SUCCESS));
        let (outcome, lines) = run_one(&claude, &program, 5_000, &session("plan", "k-a", "p"));
        assert_eq!(outcome.end, SessionEnd::Exited(0), "{front}");
        let args = fs::read_to_string(&log).unwrap();
        assert!(!args.contains("--allowedTools"), "{front}: {args}");
        assert_eq!(lines.borrow().len(), note_lines, "{front}");
    }
}

#[test]
fn output_that_is_not_json_follows_the_exit_status() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[("k-a", "tools: Read")]);
    let ok = claude.program(&format!("echo 'plain text'\necho '{SUCCESS}'"));
    let (outcome, lines) = run_one(&claude, &ok, 5_000, &session("plan", "k-a", "p"));
    assert_eq!(outcome.end, SessionEnd::Exited(0));
    assert_eq!(outcome.final_message, "");
    assert_eq!(judge(&outcome, 1), Err(Reason::ResultMissing));
    assert_eq!(lines.borrow().len(), 1);

    let failing = claude.program("echo 'oops'; exit 3");
    let (outcome, lines) = run_one(&claude, &failing, 5_000, &session("plan", "k-a", "p"));
    assert_eq!(outcome.end, SessionEnd::Exited(3));
    assert_eq!(judge(&outcome, 1), Err(Reason::SessionFailed));
    assert_eq!(lines.borrow().len(), 1);
}

#[test]
fn a_reply_without_a_string_result_is_a_missing_result_when_the_status_is_zero() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[("k-a", "tools: Read")]);
    let program = claude.program("echo '{\"is_error\":false,\"result\":7}'");
    let (outcome, _) = run_one(&claude, &program, 5_000, &session("plan", "k-a", "p"));
    assert_eq!(judge(&outcome, 1), Err(Reason::ResultMissing));
}

#[test]
fn an_error_reply_fails_the_session_even_with_exit_status_zero_and_says_why() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[("k-a", "tools: Read")]);
    let program = claude.program("echo '{\"is_error\":true,\"result\":\"Not logged in\"}'");
    let (outcome, lines) = run_one(&claude, &program, 5_000, &session("plan", "k-a", "p"));
    assert_eq!(judge(&outcome, 1), Err(Reason::SessionFailed));
    assert_eq!(lines.borrow().len(), 1);
    assert!(lines.borrow()[0].contains("Not logged in") && lines.borrow()[0].contains("`plan`"));
}

#[test]
fn an_agent_that_cannot_be_seen_does_not_start_a_session() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[]);
    // A Kiro file of the same id does not count as a Claude definition.
    claude
        .project
        .write(".kiro/agents/k-a.json", b"{\"allowedTools\":[]}");
    let marker = claude.bin.path().join("ran");
    let program = claude.program(&format!("echo ran > '{}'", marker.display()));
    let (lines, note) = notes();
    let mut launcher = SystemLauncher::new();
    let catalog = claude.catalog();
    let mut harness = ClaudeHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        claude.project.path().to_str().unwrap(),
        note,
    );
    for agent in ["k-a", "k-missing"] {
        let outcome = harness.run_session(&session("plan", agent, "p"));
        assert_eq!(outcome.end, SessionEnd::NotStarted, "{agent}");
    }
    assert!(!marker.exists());
    assert_eq!(lines.borrow().len(), 2);
}

#[test]
fn a_hung_claude_session_blocks_its_stage_with_timeout_and_leaves_no_process() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[("k-a", "tools: Read")]);
    let program = claude.program(&format!(
        "trap '' TERM\necho $$ > '{0}/leader'\nsleep 600 &\necho $! > '{0}/child'\nwait",
        claude.bin.path().display()
    ));
    let began = std::time::Instant::now();
    let (outcome, _) = run_one(
        &claude,
        &program,
        300,
        &Session {
            time_limit_ms: 300,
            ..session("plan", "k-a", "p")
        },
    );
    assert_eq!(outcome.end, SessionEnd::TimedOut);
    assert!(began.elapsed() >= Duration::from_millis(600));
    assert_eq!(judge(&outcome, 300), Err(Reason::Timeout));
    assert!(!alive(read_pid(&claude.bin.path().join("leader"))));
    assert!(!alive(read_pid(&claude.bin.path().join("child"))));
}

fn two_stage_workflow() -> workflow_core::runner::Prepared {
    let text = "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nstages:\n  - name: one\n    agent: k-one\n  - name: two\n    agent: k-two\n";
    let project = TempDir::new("unused");
    let workflow = check_text("t", text, &FileSource::under(project.path()))
        .workflow
        .expect("valid");
    prepare(workflow, Some("Goal."), &BTreeMap::new()).expect("prepared")
}

fn read_run(project: &Path, run_id: &str) -> Run {
    let store = FileRunStore::open(project).unwrap();
    Run::from_text(&store.read_state(run_id).unwrap().unwrap()).unwrap()
}

#[test]
fn the_group_is_in_the_state_while_the_session_runs_and_gone_when_it_ends() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[("k-one", "tools: Read"), ("k-two", "tools: Read")]);
    let go = claude.bin.path().join("go");
    let program = claude.program(&format!(
        "while [ ! -e '{}' ]; do sleep 0.05; done\n{}",
        go.display(),
        reply(SUCCESS)
    ));
    let project = claude.project.path().to_path_buf();
    let prepared = two_stage_workflow();
    let mut store = FileRunStore::open(&project).unwrap();
    let mut lock = FileRunLock::new(&project);
    let clock = Rc::new(SimulatedClock::default());
    let mut launcher = SystemLauncher::new();
    let mut run = start(
        &prepared,
        "claude",
        current_owner(),
        &mut store,
        &mut lock,
        &*clock,
        &mut launcher,
    )
    .unwrap()
    .run;
    let run_id = run.run_id.clone();
    let watcher = {
        let (project, run_id, go) = (project.clone(), run_id.clone(), go.clone());
        std::thread::spawn(move || {
            for _ in 0..500 {
                let store = FileRunStore::open(&project).unwrap();
                if let Ok(Some(text)) = store.read_state(&run_id) {
                    if let Some(group) = Run::from_text(&text).and_then(|r| r.session_group) {
                        fs::write(&go, "").unwrap();
                        return Some(group);
                    }
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            None
        })
    };
    let catalog = claude.catalog();
    let (_, note) = notes();
    let mut harness = ClaudeHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        project.to_str().unwrap(),
        note,
    );
    execute(
        &mut run,
        &prepared,
        &mut harness,
        &*clock,
        &mut store,
        &mut |_| {},
    )
    .unwrap();
    let group = watcher
        .join()
        .unwrap()
        .expect("the record appeared while a session ran");
    assert!(group.pgid > 1);
    assert_eq!(run.status, RunStatus::Passed);
    assert_eq!(read_run(&project, &run_id).session_group, None);
}

#[test]
fn a_claude_session_left_by_a_killed_owner_is_ended_by_the_next_run() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[("k-a", "tools: Read")]);
    let program = claude.program(&format!(
        "echo $$ > '{0}/leader'\nsleep 600 &\necho $! > '{0}/child'\nwait",
        claude.bin.path().display()
    ));
    // Run the session on a thread and take the group the harness reports, as the runner records it.
    let (tx, rx) = std::sync::mpsc::channel::<ProcessGroup>();
    let worker = {
        let (project, program) = (
            claude.project.path().to_path_buf(),
            program.to_str().unwrap().to_string(),
        );
        std::thread::spawn(move || {
            let catalog = FileAgentCatalog::new(&project, None);
            let mut launcher = SystemLauncher::with_grace_ms(500);
            let mut harness = ClaudeHarness::new(
                &mut launcher,
                &catalog,
                &program,
                project.to_str().unwrap(),
                Box::new(|_| {}),
            );
            harness.run_session_recorded(
                &Session {
                    time_limit_ms: 120_000,
                    ..session("plan", "k-a", "p")
                },
                &mut |g| {
                    let _ = tx.send(g.clone());
                },
            )
        })
    };
    let group = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("the group was reported while the session ran");
    let leader = read_pid(&claude.bin.path().join("leader"));
    let child = read_pid(&claude.bin.path().join("child"));
    assert_eq!(group.pgid, leader);
    assert_eq!(
        SystemLauncher::new().group_state(&group),
        GroupState::Matches
    );

    // The old owner is gone: its run says `running` with the group recorded, and a new run sweeps it.
    let project = claude.project.path();
    let old = {
        let prepared = two_stage_workflow();
        let mut store = FileRunStore::open(project).unwrap();
        let mut lock = FileRunLock::new(project);
        let mut run = start(
            &prepared,
            "claude",
            current_owner(),
            &mut store,
            &mut lock,
            &SimulatedClock::default(),
            &mut SystemLauncher::new(),
        )
        .unwrap()
        .run;
        run.stages[0].status = StageStatus::Running;
        run.session_group = Some(group.clone());
        store.write_state(&run.run_id, &run.to_text()).unwrap();
        lock.release();
        run.run_id
    };
    let swept = {
        let mut store = FileRunStore::open(project).unwrap();
        let mut lock = FileRunLock::new(project);
        let started = start(
            &two_stage_workflow(),
            "claude",
            current_owner(),
            &mut store,
            &mut lock,
            &SimulatedClock::default(),
            &mut SystemLauncher::with_grace_ms(500),
        )
        .unwrap();
        lock.release();
        started.swept
    };
    assert_eq!(swept.len(), 1);
    assert_eq!(
        (&swept[0].run_id, &swept[0].result),
        (&old, &SweepResult::Ended)
    );
    assert!(!alive(leader) && !alive(child));
    assert_eq!(read_run(project, &old).status, RunStatus::Halted);
    let ended = worker.join().unwrap();
    assert!(matches!(ended.end, SessionEnd::Exited(_)));
}

#[test]
fn the_second_session_never_starts_when_a_tool_configuration_file_changes_between_two_stages() {
    let _serial = one_at_a_time();
    let claude = Claude::new(&[("k-one", "tools: Read"), ("k-two", "tools: Read")]);
    let config = claude.project.write(".mcp.json", b"{\"mcpServers\":{}}");
    let log = claude.bin.path().join("sessions.log");
    // The agent id is the sixth argument. The first session rewrites the tool configuration file, as an agent with a
    // write tool could.
    let program = claude.program(&format!(
        "echo \"$6\" >> '{log}'\nif [ \"$6\" = k-one ]; then echo '{{\"mcpServers\":{{\"evil\":{{}}}}}}' > '{config}'; fi\n{reply}",
        log = log.display(),
        config = config.display(),
        reply = reply(SUCCESS)
    ));
    let project = claude.project.path().to_path_buf();
    let text = "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nstages:\n  - name: one\n    agent: k-one\n  - name: two\n    agent: k-two\n";
    let checked = check_text("t", text, &FileSource::under(&project));
    let prepared = prepare(
        checked.workflow.clone().unwrap(),
        Some("Goal."),
        &BTreeMap::new(),
    )
    .unwrap();
    let scan = || scan_repo_config(&project, None, &InstalledFiles::new());
    let confirmed = checked.trust_inputs.hash(&scan().unwrap());
    let unchanged = || scan().is_ok_and(|files| checked.trust_inputs.hash(&files) == confirmed);
    assert!(unchanged());
    assert!(!config_folders(&project, None).is_empty());

    let mut store = FileRunStore::open(&project).unwrap();
    let mut lock = FileRunLock::new(&project);
    let clock = Rc::new(SimulatedClock::default());
    let mut launcher = SystemLauncher::new();
    let mut run = start(
        &prepared,
        "claude",
        current_owner(),
        &mut store,
        &mut lock,
        &*clock,
        &mut launcher,
    )
    .unwrap()
    .run;
    let catalog = claude.catalog();
    let (_, note) = notes();
    let mut inner = ClaudeHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        project.to_str().unwrap(),
        note,
    );
    let mut guarded = GuardedHarness::new(&mut inner, &unchanged);
    execute(
        &mut run,
        &prepared,
        &mut guarded,
        &*clock,
        &mut store,
        &mut |_| {},
    )
    .unwrap();
    let refused = guarded.refused_stage().map(str::to_string);
    assert_eq!(
        fs::read_to_string(&log)
            .unwrap()
            .lines()
            .collect::<Vec<_>>(),
        ["k-one"]
    );
    assert_eq!(refused.as_deref(), Some("two"));
    assert_eq!(run.status, RunStatus::Halted);
    assert_eq!(run.stages[0].status, StageStatus::Passed);
    assert_eq!(
        run.stages[1].status,
        StageStatus::Blocked(Reason::SessionFailed)
    );
}
