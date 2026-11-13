// SPDX-License-Identifier: Apache-2.0
//! The process launcher, the `kiro-cli` harness and the orphan sweep, on fake executables: small shell scripts that
//! print a scripted reply, exit with a status, hang, or start a child. No test here starts a real Kiro CLI.

#![cfg(unix)]

mod common;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::rc::Rc;
use std::time::{Duration, Instant};

use common::TempDir;
use workflow_adapters::process::current_owner;
use workflow_adapters::{
    config_folders, scan_repo_config, FileAgentCatalog, FileRunLock, FileRunStore, FileSource,
    InstalledFiles, KiroHarness, SimulatedClock, SystemLauncher,
};
use workflow_core::limits::{MAX_PROMPT_BYTES, MAX_SESSION_OUTPUT_BYTES};
use workflow_core::ports::{
    GroupState, Harness, Launch, LaunchEnd, Launched, ProcessGroup, ProcessLauncher, RunLock,
    RunStore, Session, SessionEnd,
};
use workflow_core::run::{Run, RunStatus, StageStatus};
use workflow_core::runner::{execute, prepare, start, GuardedHarness, SweepResult, SweptGroup};
use workflow_core::{check_text, Reason};

const SUCCESS: &str = "KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}";

/// Tests that take the workspace lock or start a process run one at a time. A child process holds a copy of every
/// open file of this test binary from its fork to its exec, and so for that moment any lock another test thread has
/// just given back still looks held.
fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Writes an executable shell script. `body` runs under `/bin/sh`.
fn exe(dir: &TempDir, name: &str, body: &str) -> PathBuf {
    let path = dir.write(name, format!("#!/bin/sh\n{body}\n").as_bytes());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// Launches `program`, trying again if the system says the file is busy. A script that was just written can be held
/// open for a moment by a child that another test thread has forked.
fn launch(
    launcher: &mut SystemLauncher,
    program: &Path,
    args: &[&str],
    cwd: &Path,
    time_limit_ms: u64,
    started: &mut dyn FnMut(&ProcessGroup),
) -> Launched {
    let args: Vec<String> = args.iter().map(|a| (*a).to_string()).collect();
    for _ in 0..20 {
        let launched = launcher.launch(
            &Launch {
                program: program.to_str().unwrap(),
                args: &args,
                cwd: cwd.to_str().unwrap(),
                time_limit_ms,
                keep_output_bytes: MAX_SESSION_OUTPUT_BYTES,
            },
            started,
        );
        match &launched.end {
            LaunchEnd::NotStarted(why) if why.contains("busy") => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => return launched,
        }
    }
    panic!("the script stayed busy");
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

// --- the launcher ---------------------------------------------------------------------------------------------------

#[test]
fn the_reply_is_read_from_stdout_and_the_exit_status_is_given() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("launch-reply");
    let program = exe(
        &dir,
        "reply",
        &format!("echo 'thinking'; echo '{SUCCESS}'; echo 'to stderr' >&2; exit 3"),
    );
    let mut group = None;
    let launched = launch(
        &mut SystemLauncher::new(),
        &program,
        &[],
        dir.path(),
        60_000,
        &mut |g| group = Some(g.clone()),
    );
    assert_eq!(launched.end, LaunchEnd::Exited(3));
    assert_eq!(launched.output, format!("thinking\n{SUCCESS}\n"));
    // The group was reported while the program ran, and it is the program's own group.
    assert!(group.is_some_and(|g| g.pgid > 1 && !g.started.is_empty()));
}

#[test]
fn a_program_that_was_ended_by_a_signal_has_the_status_a_shell_reports() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("launch-signal");
    let program = exe(&dir, "killed", "kill -KILL $$");
    let launched = launch(
        &mut SystemLauncher::new(),
        &program,
        &[],
        dir.path(),
        60_000,
        &mut |_| {},
    );
    assert_eq!(launched.end, LaunchEnd::Exited(137));
}

#[test]
fn a_program_that_cannot_start_is_not_started_and_nothing_is_recorded() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("launch-missing");
    let mut called = false;
    let launched = SystemLauncher::new().launch(
        &Launch {
            program: dir.path().join("no-such-program").to_str().unwrap(),
            args: &[],
            cwd: dir.path().to_str().unwrap(),
            time_limit_ms: 1000,
            keep_output_bytes: 100,
        },
        &mut |_| called = true,
    );
    assert!(
        matches!(launched.end, LaunchEnd::NotStarted(_)),
        "{launched:?}"
    );
    assert!(!called);
}

#[test]
fn the_program_starts_in_the_folder_it_is_given_with_no_standard_input() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("launch-cwd");
    let program = exe(&dir, "where", "pwd; cat | wc -c");
    let work = dir.mkdir("work");
    let launched = launch(
        &mut SystemLauncher::new(),
        &program,
        &[],
        &work,
        60_000,
        &mut |_| {},
    );
    let canonical = fs::canonicalize(&work).unwrap();
    assert_eq!(
        launched.output.lines().next().map(Path::new),
        Some(canonical.as_path())
    );
    assert_eq!(launched.output.lines().nth(1).map(str::trim), Some("0"));
}

#[test]
fn a_hung_session_is_stopped_with_its_whole_group_after_the_grace_period() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("launch-hung");
    // Both the script and its child ignore the terminate signal, so only the kill ends them.
    let program = exe(
        &dir,
        "hang",
        &format!(
            "trap '' TERM\necho $$ > '{0}/leader'\nsleep 600 &\necho $! > '{0}/child'\nwait",
            dir.path().display()
        ),
    );
    let (limit_ms, grace_ms) = (300, 400);
    let begun = Instant::now();
    let launched = launch(
        &mut SystemLauncher::with_grace_ms(grace_ms),
        &program,
        &[],
        dir.path(),
        limit_ms,
        &mut |_| {},
    );
    let took = begun.elapsed();
    assert_eq!(launched.end, LaunchEnd::TimedOut);
    assert!(
        took >= Duration::from_millis(limit_ms + grace_ms),
        "{took:?}"
    );
    assert!(took < Duration::from_secs(10), "{took:?}");
    assert!(!alive(read_pid(&dir.path().join("leader"))));
    assert!(!alive(read_pid(&dir.path().join("child"))));
}

#[test]
fn a_session_that_stops_on_the_terminate_signal_is_not_killed() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("launch-term");
    let program = exe(
        &dir,
        "polite",
        &format!(
            "trap 'echo got-term > \"{0}/term\"; exit 0' TERM\necho $$ > '{0}/leader'\nwhile :; do sleep 0.05; done",
            dir.path().display()
        ),
    );
    let launched = launch(
        &mut SystemLauncher::with_grace_ms(5_000),
        &program,
        &[],
        dir.path(),
        300,
        &mut |_| {},
    );
    assert_eq!(launched.end, LaunchEnd::TimedOut);
    assert_eq!(
        fs::read_to_string(dir.path().join("term")).unwrap().trim(),
        "got-term"
    );
}

#[test]
fn processes_a_finished_session_left_behind_are_ended_with_its_group() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("launch-leftover");
    let program = exe(
        &dir,
        "leave",
        &format!(
            "sleep 600 &\necho $! > '{}/child'\necho done",
            dir.path().display()
        ),
    );
    let launched = launch(
        &mut SystemLauncher::with_grace_ms(2_000),
        &program,
        &[],
        dir.path(),
        60_000,
        &mut |_| {},
    );
    assert_eq!(launched.end, LaunchEnd::Exited(0));
    assert_eq!(launched.output, "done\n");
    assert!(!alive(read_pid(&dir.path().join("child"))));
}

#[test]
fn output_beyond_the_limit_keeps_the_tail() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("launch-tail");
    let program = exe(
        &dir,
        "flood",
        "yes 0123456789abcdef | head -c 3145728\necho\necho THE-END",
    );
    let launched = launch(
        &mut SystemLauncher::new(),
        &program,
        &[],
        dir.path(),
        60_000,
        &mut |_| {},
    );
    assert_eq!(launched.end, LaunchEnd::Exited(0));
    assert!(launched.output.len() <= MAX_SESSION_OUTPUT_BYTES);
    assert!(launched.output.len() > MAX_SESSION_OUTPUT_BYTES - 64);
    assert!(launched.output.ends_with("\nTHE-END\n"));
}

#[test]
fn a_prompt_at_the_cap_reaches_the_program_as_one_argument() {
    let _serial = one_at_a_time();
    let dir = TempDir::new("launch-argv");
    let program = exe(&dir, "count", "printf %s \"$1\" | wc -c; printf %s \"$#\"");
    let prompt = "x".repeat(MAX_PROMPT_BYTES);
    let launched = launch(
        &mut SystemLauncher::new(),
        &program,
        &[prompt.as_str()],
        dir.path(),
        60_000,
        &mut |_| {},
    );
    assert_eq!(launched.end, LaunchEnd::Exited(0));
    let mut lines = launched.output.lines();
    assert_eq!(
        lines.next().map(str::trim),
        Some(MAX_PROMPT_BYTES.to_string().as_str())
    );
    assert_eq!(lines.next(), Some("1"));
}

#[test]
fn a_session_does_not_hold_the_run_lock() {
    let _serial = one_at_a_time();
    let project = TempDir::new("launch-lock");
    let dir = TempDir::new("launch-lock-bin");
    FileRunStore::open(project.path()).unwrap();
    let mut lock = FileRunLock::new(project.path());
    let record = workflow_core::ports::LockRecord {
        owner: current_owner(),
        run_id: "20261105-1200-abcde".to_string(),
    };
    assert_eq!(
        lock.try_claim(&record).unwrap(),
        workflow_core::ports::Claim::Acquired
    );
    let program = exe(
        &dir,
        "hold",
        &format!(
            "echo $$ > '{0}/leader'\nwhile [ ! -e '{0}/go' ]; do sleep 0.05; done",
            dir.path().display()
        ),
    );
    let go = dir.path().join("go");
    let worker = {
        let (program, cwd) = (program.clone(), dir.path().to_path_buf());
        std::thread::spawn(move || {
            launch(
                &mut SystemLauncher::new(),
                &program,
                &[],
                &cwd,
                60_000,
                &mut |_| {},
            )
        })
    };
    // The session runs while this process gives the lock back. If it had inherited the lock file, the lock would
    // stay held until it ended.
    let leader = read_pid(&dir.path().join("leader"));
    assert!(alive(leader));
    lock.release();
    // A process that another test thread forks holds a copy of this lock for a moment, so a claim can fail once or
    // twice. A session that had inherited the lock would hold it until it ended, and the claim would never succeed.
    let mut other = FileRunLock::new(project.path());
    let mut claimed = other.try_claim(&record).unwrap();
    for _ in 0..50 {
        if claimed == workflow_core::ports::Claim::Acquired {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
        claimed = other.try_claim(&record).unwrap();
    }
    assert!(alive(leader), "the session ended before the check");
    fs::write(&go, "").unwrap();
    assert_eq!(worker.join().unwrap().end, LaunchEnd::Exited(0));
    assert_eq!(claimed, workflow_core::ports::Claim::Acquired);
}

// --- the group state and the sweep ---------------------------------------------------------------------------------

/// A leader in its own group that stays up until the returned guard is dropped, with the group as the launcher
/// records it. A thread reaps it once it ends, as the init process does for the session of a dead owner.
struct Orphan {
    group: ProcessGroup,
    reaper: Option<std::thread::JoinHandle<()>>,
}

impl Orphan {
    fn start() -> Orphan {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "sleep 600 & wait"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .expect("start the leader");
        let pid = child.id();
        let group = SystemLauncher::identify(pid).expect("identify the leader");
        let reaper = std::thread::spawn(move || {
            let _ = child.wait();
        });
        Orphan {
            group,
            reaper: Some(reaper),
        }
    }

    fn end(mut self) {
        let _ = SystemLauncher::with_grace_ms(200).end_group(&self.group);
        if let Some(reaper) = self.reaper.take() {
            let _ = reaper.join();
        }
    }
}

#[test]
fn a_group_is_matched_by_its_start_time() {
    let _serial = one_at_a_time();
    let orphan = Orphan::start();
    let mut launcher = SystemLauncher::with_grace_ms(200);
    assert_eq!(launcher.group_state(&orphan.group), GroupState::Matches);
    let other_start = ProcessGroup {
        pgid: orphan.group.pgid,
        started: format!("{}x", orphan.group.started),
    };
    assert_eq!(launcher.group_state(&other_start), GroupState::Differs);
    let group = orphan.group.clone();
    orphan.end();
    assert_eq!(launcher.group_state(&group), GroupState::Gone);
}

#[test]
fn a_group_number_that_reaches_every_process_is_never_signalled() {
    let _serial = one_at_a_time();
    let mut launcher = SystemLauncher::with_grace_ms(100);
    for pgid in [0, 1] {
        let group = ProcessGroup {
            pgid,
            started: "x".to_string(),
        };
        assert!(matches!(
            launcher.group_state(&group),
            GroupState::Unknown(_)
        ));
        assert!(launcher.end_group(&group).is_err());
    }
}

fn two_stage_workflow() -> workflow_core::runner::Prepared {
    let text = "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nstages:\n  - name: one\n    agent: k-one\n  - name: two\n    agent: k-two\n";
    let project = TempDir::new("unused");
    let workflow = check_text("t", text, &FileSource::under(project.path()))
        .workflow
        .expect("valid");
    prepare(workflow, Some("Goal."), &BTreeMap::new()).expect("prepared")
}

/// Starts a run in `project` and leaves it `running` with a stage `running` and `group` recorded, as a killed owner
/// does. Gives its run id. The lock is released, as the kernel does for a dead owner.
fn abandoned_run(project: &Path, group: &ProcessGroup) -> String {
    let prepared = two_stage_workflow();
    let mut store = FileRunStore::open(project).unwrap();
    let mut lock = FileRunLock::new(project);
    let clock = SimulatedClock::default();
    let mut run = start(
        &prepared,
        "kiro-cli",
        current_owner(),
        &mut store,
        &mut lock,
        &clock,
        &mut SystemLauncher::new(),
    )
    .unwrap()
    .run;
    run.stages[0].status = StageStatus::Running;
    run.session_group = Some(group.clone());
    store.write_state(&run.run_id, &run.to_text()).unwrap();
    lock.release();
    run.run_id
}

fn read_run(project: &Path, run_id: &str) -> Run {
    let store = FileRunStore::open(project).unwrap();
    Run::from_text(&store.read_state(run_id).unwrap().unwrap()).unwrap()
}

/// Starts a new run over whatever `project` holds, and gives the groups its sweep found.
fn start_new_run(project: &Path, launcher: &mut SystemLauncher) -> Vec<SweptGroup> {
    let mut store = FileRunStore::open(project).unwrap();
    let mut lock = FileRunLock::new(project);
    let started = start(
        &two_stage_workflow(),
        "kiro-cli",
        current_owner(),
        &mut store,
        &mut lock,
        &SimulatedClock::default(),
        launcher,
    )
    .unwrap();
    lock.release();
    started.swept
}

#[test]
fn a_group_left_by_a_killed_owner_is_ended_before_the_old_run_reads_halted() {
    let _serial = one_at_a_time();
    let project = TempDir::new("sweep-ends");
    let orphan = Orphan::start();
    let pgid = orphan.group.pgid;
    let old = abandoned_run(project.path(), &orphan.group);
    assert!(alive(pgid));
    let swept = start_new_run(project.path(), &mut SystemLauncher::with_grace_ms(500));
    assert_eq!(swept.len(), 1);
    assert_eq!(
        (&swept[0].run_id, &swept[0].result),
        (&old, &SweepResult::Ended)
    );
    assert!(!alive(pgid));
    let ended = read_run(project.path(), &old);
    assert_eq!(ended.status, RunStatus::Halted);
    assert_eq!(ended.session_group, None);
    orphan.end();
}

#[test]
fn a_group_whose_start_time_differs_is_left_alone() {
    let _serial = one_at_a_time();
    let project = TempDir::new("sweep-differs");
    let orphan = Orphan::start();
    let pgid = orphan.group.pgid;
    let stale = ProcessGroup {
        pgid,
        started: "linux:another-boot:1".to_string(),
    };
    let old = abandoned_run(project.path(), &stale);
    let swept = start_new_run(project.path(), &mut SystemLauncher::with_grace_ms(200));
    assert_eq!(swept[0].result, SweepResult::Differs);
    assert!(
        alive(pgid),
        "a group with another start time must not be signalled"
    );
    assert_eq!(read_run(project.path(), &old).status, RunStatus::Halted);
    orphan.end();
}

#[test]
fn a_group_that_is_already_gone_is_reported_as_gone() {
    let _serial = one_at_a_time();
    let project = TempDir::new("sweep-gone");
    let orphan = Orphan::start();
    let group = orphan.group.clone();
    orphan.end();
    abandoned_run(project.path(), &group);
    let swept = start_new_run(project.path(), &mut SystemLauncher::with_grace_ms(200));
    assert_eq!(swept[0].result, SweepResult::Gone);
}

// --- the kiro-cli harness -------------------------------------------------------------------------------------------

/// A project with an agent file for each of `agents`, V2 or V3 by `v3`, and a fake `kiro-cli` in `bin` that records
/// its arguments to `args.log` and the stage it ran to `sessions.log`, and replies with what `reply` holds.
struct Kiro {
    project: TempDir,
    bin: TempDir,
}

impl Kiro {
    fn new(agents: &[(&str, &str)]) -> Kiro {
        let project = TempDir::new("kiro-project");
        for (id, shape) in agents {
            project.write(&format!(".kiro/agents/{id}.json"), shape.as_bytes());
        }
        Kiro {
            project,
            bin: TempDir::new("kiro-bin"),
        }
    }

    fn program(&self, body: &str) -> PathBuf {
        exe(&self.bin, "kiro-cli", body)
    }

    fn catalog(&self) -> FileAgentCatalog {
        FileAgentCatalog::new(self.project.path(), None)
    }
}

const V2_AGENT: &str = r#"{"name":"a","allowedTools":["fs_read","fs_write"]}"#;
const V3_AGENT: &str = r#"{"name":"a","permissions":{"rules":[
  {"capability":"fs_read","effect":"allow"},
  {"capability":"fs_write","effect":"allow"},
  {"capability":"shell","match":["ls *"],"effect":"allow"},
  {"capability":"mcp","match":["aws-mcp/x"],"effect":"allow"}]}}"#;

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

#[test]
fn a_v2_agent_runs_with_the_v2_flag_and_no_trust_flag() {
    let _serial = one_at_a_time();
    let kiro = Kiro::new(&[("k-a", V2_AGENT)]);
    let log = kiro.bin.path().join("args.log");
    let program = kiro.program(&format!(
        "for a in \"$@\"; do echo \"$a\"; done > '{}'\necho '{SUCCESS}'",
        log.display()
    ));
    let (_, note) = notes();
    let mut launcher = SystemLauncher::new();
    let catalog = kiro.catalog();
    let mut harness = KiroHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        kiro.project.path().to_str().unwrap(),
        note,
    );
    let outcome = loop {
        let outcome = harness.run_session(&session("plan", "k-a", "Goal: write it."));
        // A script that was just written can be busy for a moment, which is a failed start and nothing else.
        if outcome.end != SessionEnd::NotStarted {
            break outcome;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(outcome.end, SessionEnd::Exited(0));
    assert_eq!(outcome.final_message, format!("{SUCCESS}\n"));
    let args = fs::read_to_string(&log).unwrap();
    assert_eq!(
        args.lines().collect::<Vec<_>>(),
        [
            "chat",
            "--no-interactive",
            "--agent",
            "k-a",
            "--v2",
            "Goal: write it."
        ]
    );
}

#[test]
fn a_v3_agent_runs_with_the_ids_of_its_unscoped_allow_rules_only() {
    let _serial = one_at_a_time();
    let kiro = Kiro::new(&[("k-a", V3_AGENT)]);
    let log = kiro.bin.path().join("args.log");
    let program = kiro.program(&format!(
        "for a in \"$@\"; do echo \"$a\"; done > '{}'\necho '{SUCCESS}'",
        log.display()
    ));
    let (_, note) = notes();
    let mut launcher = SystemLauncher::new();
    let catalog = kiro.catalog();
    let mut harness = KiroHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        kiro.project.path().to_str().unwrap(),
        note,
    );
    let outcome = loop {
        let outcome = harness.run_session(&session("plan", "k-a", "Goal: go."));
        if outcome.end != SessionEnd::NotStarted {
            break outcome;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(outcome.end, SessionEnd::Exited(0));
    let args = fs::read_to_string(&log).unwrap();
    // The `shell` rule has a scope and the `mcp` rule has a scope, so neither gets an id.
    assert_eq!(
        args.lines().collect::<Vec<_>>(),
        [
            "chat",
            "--no-interactive",
            "--agent",
            "k-a",
            "--v3",
            "--trust-tools=read,write",
            "Goal: go."
        ]
    );
}

#[test]
fn a_session_that_fails_says_why_in_one_line_and_ends_with_its_status() {
    let _serial = one_at_a_time();
    let kiro = Kiro::new(&[("k-a", V2_AGENT)]);
    let program = kiro.program("echo 'Mode not found'; exit 4");
    let (lines, note) = notes();
    let mut launcher = SystemLauncher::new();
    let catalog = kiro.catalog();
    let mut harness = KiroHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        kiro.project.path().to_str().unwrap(),
        note,
    );
    let outcome = loop {
        let outcome = harness.run_session(&session("plan", "k-a", "p"));
        if outcome.end != SessionEnd::NotStarted {
            break outcome;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(outcome.end, SessionEnd::Exited(4));
    assert_eq!(lines.borrow().len(), 1);
    assert!(lines.borrow()[0].contains("`plan`") && lines.borrow()[0].contains("status 4"));
}

#[test]
fn an_agent_that_cannot_be_seen_or_whose_engine_is_unclear_does_not_start_a_session() {
    let _serial = one_at_a_time();
    let kiro = Kiro::new(&[
        (
            "k-both",
            r#"{"allowedTools":[],"permissions":{"rules":[]}}"#,
        ),
        ("k-neither", r#"{"tools":["read"]}"#),
    ]);
    let marker = kiro.bin.path().join("ran");
    let program = kiro.program(&format!("echo ran > '{}'", marker.display()));
    let (lines, note) = notes();
    let mut launcher = SystemLauncher::new();
    let catalog = kiro.catalog();
    let mut harness = KiroHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        kiro.project.path().to_str().unwrap(),
        note,
    );
    for agent in ["k-missing", "k-both", "k-neither"] {
        let outcome = harness.run_session(&session("plan", agent, "p"));
        assert_eq!(outcome.end, SessionEnd::NotStarted, "{agent}");
    }
    assert!(!marker.exists());
    assert_eq!(lines.borrow().len(), 3);
}

#[test]
fn a_hung_kiro_session_blocks_its_stage_with_timeout_and_leaves_no_process() {
    let _serial = one_at_a_time();
    let kiro = Kiro::new(&[("k-a", V2_AGENT)]);
    let program = kiro.program(&format!(
        "echo $$ > '{0}/leader'\nsleep 600 &\necho $! > '{0}/child'\nwait",
        kiro.bin.path().display()
    ));
    let (_, note) = notes();
    let mut launcher = SystemLauncher::with_grace_ms(300);
    let catalog = kiro.catalog();
    let mut harness = KiroHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        kiro.project.path().to_str().unwrap(),
        note,
    );
    let outcome = loop {
        let outcome = harness.run_session(&Session {
            time_limit_ms: 300,
            ..session("plan", "k-a", "p")
        });
        if outcome.end != SessionEnd::NotStarted {
            break outcome;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    assert_eq!(outcome.end, SessionEnd::TimedOut);
    assert_eq!(
        workflow_core::runner::judge(&outcome, 300),
        Err(Reason::Timeout)
    );
    assert!(!alive(read_pid(&kiro.bin.path().join("leader"))));
    assert!(!alive(read_pid(&kiro.bin.path().join("child"))));
}

#[test]
fn the_group_is_in_the_state_while_the_session_runs_and_gone_when_it_ends() {
    let _serial = one_at_a_time();
    let kiro = Kiro::new(&[("k-one", V2_AGENT), ("k-two", V2_AGENT)]);
    let go = kiro.bin.path().join("go");
    let program = kiro.program(&format!(
        "while [ ! -e '{}' ]; do sleep 0.05; done\necho '{SUCCESS}'",
        go.display()
    ));
    let project = kiro.project.path().to_path_buf();
    let prepared = two_stage_workflow();
    let mut store = FileRunStore::open(&project).unwrap();
    let mut lock = FileRunLock::new(&project);
    let clock = Rc::new(SimulatedClock::default());
    let mut launcher = SystemLauncher::new();
    let started = start(
        &prepared,
        "kiro-cli",
        current_owner(),
        &mut store,
        &mut lock,
        &*clock,
        &mut launcher,
    )
    .unwrap();
    let mut run = started.run;
    let run_id = run.run_id.clone();
    // Watch the state document from another thread, and let the session finish once the record is there.
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
    let catalog = kiro.catalog();
    let (_, note) = notes();
    let mut harness = KiroHarness::new(
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
    let on_disk = read_run(&project, &run_id);
    assert_eq!(on_disk.session_group, None);
    assert!(!fs::read_to_string(
        project
            .join(".konductor/runs")
            .join(&run_id)
            .join("state.json")
    )
    .unwrap()
    .contains("session_group"));
}

#[test]
fn the_second_session_never_starts_when_a_tool_configuration_file_changes_between_two_stages() {
    let _serial = one_at_a_time();
    let kiro = Kiro::new(&[("k-one", V2_AGENT), ("k-two", V2_AGENT)]);
    let config = kiro.project.write(".mcp.json", b"{\"mcpServers\":{}}");
    let log = kiro.bin.path().join("sessions.log");
    // Every session logs its agent. The first one rewrites the tool configuration file, as an agent with a write tool
    // could.
    let program = kiro.program(&format!(
        "echo \"$4\" >> '{log}'\nif [ \"$4\" = k-one ]; then echo '{{\"mcpServers\":{{\"evil\":{{}}}}}}' > '{config}'; fi\necho '{SUCCESS}'",
        log = log.display(),
        config = config.display()
    ));
    let project = kiro.project.path().to_path_buf();
    let text = "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nstages:\n  - name: one\n    agent: k-one\n  - name: two\n    agent: k-two\n";
    let checked = check_text("t", text, &FileSource::under(&project));
    let prepared = prepare(
        checked.workflow.clone().unwrap(),
        Some("Goal."),
        &BTreeMap::new(),
    )
    .unwrap();

    // The same check `flow run` makes: the hash of the workflow and the tool configuration it was confirmed with.
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
        "kiro-cli",
        current_owner(),
        &mut store,
        &mut lock,
        &*clock,
        &mut launcher,
    )
    .unwrap()
    .run;
    let catalog = kiro.catalog();
    let (_, note) = notes();
    let mut kiro_harness = KiroHarness::new(
        &mut launcher,
        &catalog,
        program.to_str().unwrap(),
        project.to_str().unwrap(),
        note,
    );
    let mut guarded = GuardedHarness::new(&mut kiro_harness, &unchanged);
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
