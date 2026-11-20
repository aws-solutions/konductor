// SPDX-License-Identifier: Apache-2.0
//! Runs through the real run store and lock on the fake harness, and the parts they are made of.

mod common;

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::path::Path;
use std::rc::Rc;

use common::TempDir;
use workflow_adapters::fake_harness::Entry;
use workflow_adapters::process::current_owner;
use workflow_adapters::{
    choose_harness, ensure_runs_ignored, FakeHarness, FileRunLock, FileRunStore, HarnessChoice,
    HarnessRefusal, Script, SimulatedClock, SystemClock,
};
use workflow_core::limits::STAGE_TIME_LIMIT_MS;
use workflow_core::ports::{
    Claim, Clock, Harness, LockRecord, Owner, RunLock, RunStore, Session, SessionEnd,
};
use workflow_core::run::{Run, RunStatus, StageStatus};
use workflow_core::runner::{execute, prepare, start, Prepared, StartError};
use workflow_core::time::{is_run_id, parse_timestamp};
use workflow_core::{check_text, Reason};

const SUCCESS: &str = "KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}";

fn hello_plan() -> Prepared {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/hello-plan.yml");
    let text = fs::read_to_string(path).expect("read hello-plan.yml");
    let project = TempDir::new("unused");
    let source = workflow_adapters::FileSource::under(project.path());
    let workflow = check_text("hello-plan", &text, &source)
        .workflow
        .expect("valid");
    prepare(workflow, None, &BTreeMap::new()).expect("prepared")
}

fn script(entries: &[(&str, &str)]) -> Script {
    let mut script = Script::default();
    for (stage, reply) in entries {
        script.stages.insert(
            stage.to_string(),
            Entry {
                reply: reply.to_string(),
                exit_status: 0,
                duration_ms: 500,
                wait_for: None,
            },
        );
    }
    script
}

/// Tests that take the workspace lock or start a process run one at a time. A child process holds a copy of every
/// open file of this test binary from its fork to its exec, and so for that moment any lock another test thread has
/// just given back still looks held.
fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Runs hello-plan in `project` with `script`, as `flow run` does, and gives back the run.
fn run_hello_plan(project: &Path, script: Script) -> Result<Run, StartError> {
    let prepared = hello_plan();
    let mut store = FileRunStore::open(project).expect("open store");
    let mut lock = FileRunLock::new(project);
    let clock = Rc::new(SimulatedClock::default());
    let owner = current_owner();
    let started = start(&prepared, "fake", owner, &mut store, &mut lock, &*clock)?;
    let mut run = started.run;
    let mut harness = FakeHarness::new(script, Rc::clone(&clock));
    execute(
        &mut run,
        &prepared,
        &mut harness,
        &*clock,
        &mut store,
        &mut |_| {},
    )
    .expect("execute");
    lock.release();
    Ok(run)
}

fn state_on_disk(project: &Path, run_id: &str) -> Run {
    let text = fs::read_to_string(
        project
            .join(".konductor/runs")
            .join(run_id)
            .join("state.json"),
    )
    .expect("state.json");
    Run::from_text(&text).expect("valid state")
}

/// The PID of a process that has ended and been reaped.
fn dead_pid() -> u32 {
    let mut child = std::process::Command::new("true")
        .spawn()
        .expect("spawn true");
    let pid = child.id();
    child.wait().expect("wait");
    pid
}

/// Whether the workspace lock of `project` is free: a new claim takes it. The claim is given back at once.
fn lock_is_free(project: &Path) -> bool {
    let mut probe = FileRunLock::new(project);
    let free = probe.try_claim(&record(1, "20261105-1200-probe")).unwrap() == Claim::Acquired;
    probe.release();
    free
}

/// The names in `.konductor/runs/` of `project`, sorted.
fn runs_names(project: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(project.join(".konductor/runs"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

// --- runs ----------------------------------------------------------------------------------------------------------

#[test]
fn hello_plan_passes_through_the_real_run_store() {
    let _serial = one_at_a_time();
    let project = TempDir::new("run-pass");
    let run = run_hello_plan(
        project.path(),
        script(&[
            ("plan", SUCCESS),
            (
                "implement",
                "Done.\nKONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": []}",
            ),
        ]),
    )
    .expect("start");
    assert_eq!(run.status, RunStatus::Passed);
    assert!(is_run_id(&run.run_id), "{}", run.run_id);
    assert_eq!(state_on_disk(project.path(), &run.run_id), run);
    assert!(run.finished_at.unwrap() >= run.started_at);
    // The lock is given back, and the runs are git-ignored. The lock files stay, since they are never deleted.
    assert!(lock_is_free(project.path()));
    assert_eq!(
        runs_names(project.path()),
        [run.run_id.clone(), "claim".to_string(), "lock".to_string()]
    );
    assert_eq!(
        fs::read_to_string(project.path().join(".konductor/.gitignore")).unwrap(),
        "runs/\n"
    );
    // No temporary file is left behind.
    let names: Vec<String> = fs::read_dir(project.path().join(".konductor/runs").join(&run.run_id))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["state.json"]);
}

#[test]
fn a_missing_result_line_blocks_the_stage_and_the_next_stays_pending() {
    let _serial = one_at_a_time();
    let project = TempDir::new("run-missing");
    let run = run_hello_plan(
        project.path(),
        script(&[("plan", "I wrote PLAN.md."), ("implement", SUCCESS)]),
    )
    .expect("start");
    let on_disk = state_on_disk(project.path(), &run.run_id);
    assert_eq!(on_disk.status, RunStatus::Halted);
    assert_eq!(on_disk.exit_code, Some(1));
    let statuses: Vec<StageStatus> = on_disk.stages.iter().map(|s| s.status).collect();
    assert_eq!(
        statuses,
        [
            StageStatus::Blocked(Reason::ResultMissing),
            StageStatus::Pending
        ]
    );
}

#[test]
fn a_run_left_running_by_a_dead_process_reads_halted_and_its_lock_does_not_block() {
    let _serial = one_at_a_time();
    let project = TempDir::new("run-dead");
    let mut store = FileRunStore::open(project.path()).unwrap();
    let dead = Owner {
        pid: dead_pid(),
        started: "gone".to_string(),
    };
    let old_id = store.reserve("20261105-1200").unwrap();
    let mut old = Run::from_text(&run_hello_plan_text(&old_id, &dead)).unwrap();
    old.stages[0].status = StageStatus::Running;
    store.write_state(&old_id, &old.to_text()).unwrap();
    // The dead owner's record is still in the lock file, but the kernel gave its lock back when it ended. Dropping a
    // held lock stands in for that here; the CLI tests kill a real process.
    let mut lock = FileRunLock::new(project.path());
    let stale = LockRecord {
        owner: dead,
        run_id: old_id.clone(),
    };
    assert_eq!(lock.try_claim(&stale).unwrap(), Claim::Acquired);
    drop(lock);

    let run = run_hello_plan(
        project.path(),
        script(&[("plan", SUCCESS), ("implement", SUCCESS)]),
    )
    .expect("a dead owner does not block");
    assert_eq!(run.status, RunStatus::Passed);
    let ended = state_on_disk(project.path(), &old_id);
    assert_eq!(ended.status, RunStatus::Halted);
    assert_eq!(
        ended.stages[0].status,
        StageStatus::Blocked(Reason::SessionFailed)
    );
    assert_eq!(ended.stages[1].status, StageStatus::Pending);
    assert!(ended.finished_at.is_some());
}

/// The state text of a hello-plan run with every stage pending.
fn run_hello_plan_text(run_id: &str, owner: &Owner) -> String {
    format!(
        r#"{{"checks": {{"plan-exists": "deferred"}}, "exit_code": null, "finished_at": null, "harness": "fake",
        "order": ["plan", "implement"], "owner": {}, "reported_outputs": {{}}, "run_id": "{run_id}",
        "stages": {{"implement": {{"status": "pending"}}, "plan": {{"status": "pending"}}}},
        "started_at": "2026-11-05T12:00:00Z", "status": "running", "workflow": "hello-plan"}}"#,
        owner.to_json().compact()
    )
}

#[test]
fn a_live_owner_refuses_a_second_run_and_leaves_no_run_folder() {
    let _serial = one_at_a_time();
    let project = TempDir::new("run-live");
    FileRunStore::open(project.path()).unwrap();
    let mut lock = FileRunLock::new(project.path());
    let holder = LockRecord {
        owner: current_owner(),
        run_id: "20261105-1200-held1".to_string(),
    };
    assert_eq!(lock.try_claim(&holder).unwrap(), Claim::Acquired);
    let refused = run_hello_plan(project.path(), script(&[])).unwrap_err();
    assert_eq!(refused, StartError::AlreadyRunning(holder.clone()));
    let store = FileRunStore::open(project.path()).unwrap();
    assert_eq!(store.list().unwrap(), Vec::<String>::new());
    // The holder still holds it, and its record is untouched.
    assert!(!lock_is_free(project.path()));
    assert_eq!(fs::read_to_string(lock.path()).unwrap(), holder.to_text());
}

#[test]
fn the_current_owner_is_this_process_with_a_stable_start_time() {
    let owner = current_owner();
    assert_eq!(owner.pid, std::process::id());
    let started = parse_timestamp(&owner.started).expect("a contract timestamp");
    assert!(started <= SystemClock.now_ms(), "{}", owner.started);
    assert_eq!(current_owner(), owner);
}

// --- the lock ------------------------------------------------------------------------------------------------------

fn record(pid: u32, run_id: &str) -> LockRecord {
    LockRecord {
        owner: Owner {
            pid,
            started: "s".to_string(),
        },
        run_id: run_id.to_string(),
    }
}

#[test]
fn only_one_claim_succeeds_and_release_or_drop_gives_it_back() {
    let _serial = one_at_a_time();
    let project = TempDir::new("lock-one");
    FileRunStore::open(project.path()).unwrap();
    let mut a = FileRunLock::new(project.path());
    let mut b = FileRunLock::new(project.path());
    let first = record(1, "20261105-1200-aaaaa");
    let second = record(2, "20261105-1200-bbbbb");
    assert_eq!(a.try_claim(&first).unwrap(), Claim::Acquired);
    assert_eq!(
        b.try_claim(&second).unwrap(),
        Claim::Held(Some(first.clone()))
    );
    // A release by a caller that does not hold the lock does nothing.
    b.release();
    assert!(!lock_is_free(project.path()));
    assert_eq!(
        fs::read_to_string(a.path()).unwrap(),
        "{\"pid\":1,\"run_id\":\"20261105-1200-aaaaa\",\"started\":\"s\"}"
    );
    a.release();
    assert_eq!(b.try_claim(&second).unwrap(), Claim::Acquired);
    // A longer record from before is replaced whole, not written over.
    assert_eq!(fs::read_to_string(b.path()).unwrap(), second.to_text());
    drop(b);
    assert_eq!(a.try_claim(&first).unwrap(), Claim::Acquired);
}

#[test]
fn many_starters_against_a_stale_record_leave_exactly_one_holder() {
    let _serial = one_at_a_time();
    const TRIALS: usize = 40;
    const STARTERS: usize = 8;
    let me = current_owner();
    for trial in 0..TRIALS {
        let project = TempDir::new("lock-stress");
        FileRunStore::open(project.path()).unwrap();
        // A record left by an owner that died. No process holds the lock.
        let stale = LockRecord {
            owner: Owner {
                pid: dead_pid(),
                started: "gone".to_string(),
            },
            run_id: "20261105-1200-stale".to_string(),
        };
        project.write(".konductor/runs/lock", stale.to_text().as_bytes());
        let barrier = std::sync::Barrier::new(STARTERS);
        type Outcome = (LockRecord, Result<(), StartError>, FileRunLock);
        let results: Vec<Outcome> = std::thread::scope(|scope| {
            let starters: Vec<_> = (0..STARTERS)
                .map(|i| {
                    let (barrier, project, me) = (&barrier, project.path(), me.clone());
                    scope.spawn(move || {
                        let record = LockRecord {
                            owner: me,
                            run_id: format!("20261105-1200-s{i:04}"),
                        };
                        let mut lock = FileRunLock::new(project);
                        barrier.wait();
                        let result = workflow_core::runner::acquire(&mut lock, &record);
                        // The lock goes back with the thread's result, so the winner still holds it below.
                        (record, result, lock)
                    })
                })
                .collect();
            starters.into_iter().map(|s| s.join().unwrap()).collect()
        });
        let winners: Vec<&LockRecord> = results
            .iter()
            .filter(|(_, result, _)| result.is_ok())
            .map(|(record, _, _)| record)
            .collect();
        assert_eq!(winners.len(), 1, "trial {trial}: {results:?}");
        let winner = winners[0];
        for (_, result, _) in &results {
            match result {
                Ok(()) => {}
                // A refused start never names the stale record: records are only read under `claim`.
                Err(StartError::AlreadyRunning(holder)) => assert_eq!(holder, winner),
                Err(StartError::UnreadableLock) => {}
                Err(other) => panic!("trial {trial}: {other:?}"),
            }
        }
        assert_eq!(
            fs::read_to_string(project.path().join(".konductor/runs/lock")).unwrap(),
            winner.to_text()
        );
        assert!(!lock_is_free(project.path()), "trial {trial}");
        assert_eq!(
            runs_names(project.path()),
            ["claim", "lock"],
            "trial {trial}"
        );
        drop(results);
        assert!(lock_is_free(project.path()), "trial {trial}");
    }
}

#[test]
fn a_record_that_cannot_be_read_blocks_only_while_the_lock_is_held() {
    let _serial = one_at_a_time();
    let project = TempDir::new("lock-garbled");
    FileRunStore::open(project.path()).unwrap();
    // Not held: the garbled record is left over, and a claim takes the lock and replaces it.
    project.write(".konductor/runs/lock", b"not a record");
    let mut holder = FileRunLock::new(project.path());
    let first = record(1, "20261105-1200-aaaaa");
    assert_eq!(holder.try_claim(&first).unwrap(), Claim::Acquired);
    assert_eq!(fs::read_to_string(holder.path()).unwrap(), first.to_text());
    // Held: a record that is partial, empty or garbled gives an unknown owner.
    let mut other = FileRunLock::new(project.path());
    let text = first.to_text();
    for content in [&text[..text.len() / 2], "", "not a record"] {
        fs::write(holder.path(), content).unwrap();
        assert_eq!(
            other.try_claim(&record(2, "20261105-1200-bbbbb")).unwrap(),
            Claim::Held(None),
            "{content:?}"
        );
    }
}

#[cfg(unix)]
#[test]
fn a_lock_file_that_is_a_pipe_is_refused_and_not_waited_on() {
    let _serial = one_at_a_time();
    let project = TempDir::new("lock-pipe");
    FileRunStore::open(project.path()).unwrap();
    let mut lock = FileRunLock::new(project.path());
    let made = std::process::Command::new("mkfifo")
        .arg(lock.path())
        .status()
        .expect("mkfifo");
    assert!(made.success());
    let error = lock
        .try_claim(&record(1, "20261105-1200-aaaaa"))
        .unwrap_err();
    assert!(error.0.contains("is not a regular file"), "{}", error.0);
}

#[cfg(unix)]
#[test]
fn a_child_process_does_not_inherit_the_lock() {
    let _serial = one_at_a_time();
    let project = TempDir::new("lock-child");
    FileRunStore::open(project.path()).unwrap();
    let mut lock = FileRunLock::new(project.path());
    assert_eq!(
        lock.try_claim(&record(1, "20261105-1200-aaaaa")).unwrap(),
        Claim::Acquired
    );
    // `cat` waits on its input until the pipe closes, so it outlives the lock without a sleep.
    let mut child = std::process::Command::new("cat")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .expect("spawn cat");
    lock.release();
    let free = lock_is_free(project.path());
    drop(child.stdin.take());
    child.wait().expect("wait for cat");
    assert!(free, "the child kept the lock alive");
}

// --- the store -----------------------------------------------------------------------------------------------------

#[test]
fn reserved_ids_match_the_pattern_and_list_skips_other_names() {
    let project = TempDir::new("store-ids");
    let mut store = FileRunStore::open(project.path()).unwrap();
    let a = store.reserve("20261105-1200").unwrap();
    let b = store.reserve("20261105-1200").unwrap();
    assert!(is_run_id(&a) && is_run_id(&b) && a != b, "{a} {b}");
    project.mkdir(".konductor/runs/not-a-run");
    project.write(".konductor/runs/20261105-1200-zzzzz", b"a file");
    let mut listed = store.list().unwrap();
    listed.sort();
    let mut expected = vec![a.clone(), b];
    expected.sort();
    assert_eq!(listed, expected);
    store.discard(&a).unwrap();
    assert_eq!(store.list().unwrap().len(), 1);
    assert!(store.write_state("../../x", "{}").is_err());
}

#[test]
fn a_state_document_is_replaced_whole() {
    let project = TempDir::new("store-replace");
    let mut store = FileRunStore::open(project.path()).unwrap();
    let id = store.reserve("20261105-1200").unwrap();
    assert_eq!(store.read_state(&id).unwrap(), None);
    store.write_state(&id, "first, and longer").unwrap();
    store.write_state(&id, "second").unwrap();
    assert_eq!(store.read_state(&id).unwrap().as_deref(), Some("second"));
}

#[cfg(unix)]
#[test]
fn nothing_is_written_through_a_link() {
    use std::os::unix::fs::symlink;
    let project = TempDir::new("store-link");
    let elsewhere = TempDir::new("store-link-target");
    project.mkdir(".konductor");
    symlink(elsewhere.path(), project.path().join(".konductor/runs")).unwrap();
    assert!(FileRunStore::open(project.path()).is_err());
    assert_eq!(fs::read_dir(elsewhere.path()).unwrap().count(), 0);

    let project = TempDir::new("store-link-ignore");
    project.mkdir(".konductor");
    let target = elsewhere.write("ignore", b"x\n");
    symlink(&target, project.path().join(".konductor/.gitignore")).unwrap();
    assert!(ensure_runs_ignored(project.path()).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "x\n");

    let project = TempDir::new("store-link-state");
    let mut store = FileRunStore::open(project.path()).unwrap();
    let id = store.reserve("20261105-1200").unwrap();
    let target = elsewhere.write("state", b"theirs");
    symlink(
        &target,
        project
            .path()
            .join(".konductor/runs")
            .join(&id)
            .join("state.json"),
    )
    .unwrap();
    assert!(store.write_state(&id, "mine").is_err());
    assert!(store.read_state(&id).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "theirs");
}

// --- .konductor/.gitignore -----------------------------------------------------------------------------------------

fn gitignore(project: &TempDir) -> String {
    fs::read_to_string(project.path().join(".konductor/.gitignore")).unwrap()
}

#[test]
fn a_missing_gitignore_is_made_with_the_runs_line() {
    let project = TempDir::new("ignore-missing");
    ensure_runs_ignored(project.path()).unwrap();
    assert_eq!(gitignore(&project), "runs/\n");
}

#[test]
fn a_gitignore_without_the_line_gets_it_and_keeps_every_other_line() {
    let project = TempDir::new("ignore-add");
    project.write(".konductor/.gitignore", b"# mine\n*.key\n/runs-old");
    ensure_runs_ignored(project.path()).unwrap();
    assert_eq!(gitignore(&project), "# mine\n*.key\n/runs-old\nruns/\n");
}

#[test]
fn the_runs_line_is_never_added_twice() {
    for text in [
        "runs/\n",
        "*.key\nruns/\n.env\n",
        "a\r\nruns/\r\n",
        "  runs/  ",
    ] {
        let project = TempDir::new("ignore-once");
        project.write(".konductor/.gitignore", text.as_bytes());
        ensure_runs_ignored(project.path()).unwrap();
        ensure_runs_ignored(project.path()).unwrap();
        assert_eq!(gitignore(&project), text, "{text:?}");
    }
}

// --- the fake harness ----------------------------------------------------------------------------------------------

fn session<'a>(stage: &'a str) -> Session<'a> {
    Session {
        stage,
        agent: "k-developer",
        prompt: "p",
        time_limit_ms: STAGE_TIME_LIMIT_MS,
    }
}

#[test]
fn the_fake_replays_each_stage_and_moves_the_clock() {
    let script = Script::parse(
        r#"{"stages": {"a": {"reply": "hi", "exit_status": 3, "duration_ms": 2500}, "b": {"reply": "x"}}}"#,
    )
    .unwrap();
    let clock = Rc::new(SimulatedClock::default());
    let mut fake = FakeHarness::new(script, Rc::clone(&clock));
    let before = clock.now_ms();
    let a = fake.run_session(&session("a"));
    assert_eq!(
        (a.end, a.final_message.as_str()),
        (SessionEnd::Exited(3), "hi")
    );
    assert!(clock.now_ms() >= before + 2500);
    let b = fake.run_session(&session("b"));
    assert_eq!(b.end, SessionEnd::Exited(0));
    assert_eq!(fake.run_session(&session("c")).end, SessionEnd::NotStarted);
}

#[test]
fn a_fake_session_past_its_limit_hangs_until_the_limit_and_times_out() {
    let script = Script::parse(&format!(
        r#"{{"stages": {{"a": {{"reply": "{SUCCESS_ESCAPED}", "duration_ms": {}}}}}}}"#,
        STAGE_TIME_LIMIT_MS + 1
    ))
    .unwrap();
    let clock = Rc::new(SimulatedClock::default());
    let mut fake = FakeHarness::new(script, Rc::clone(&clock));
    let before = clock.now_ms();
    let outcome = fake.run_session(&session("a"));
    assert_eq!(outcome.end, SessionEnd::TimedOut);
    let waited = clock.now_ms() - before;
    assert!(
        (STAGE_TIME_LIMIT_MS..STAGE_TIME_LIMIT_MS + 60_000).contains(&waited),
        "{waited}"
    );
}

const SUCCESS_ESCAPED: &str =
    "KONDUCTOR_RESULT {\\\"status\\\": \\\"success\\\", \\\"outputs\\\": []}";

#[cfg(unix)]
#[test]
fn a_wait_for_pipe_that_no_one_writes_to_times_out_at_the_limit() {
    // `mkfifo` is a child process.
    let _serial = one_at_a_time();
    let project = TempDir::new("wait-for-limit");
    let fifo = project.path().join("hold");
    let made = std::process::Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .expect("mkfifo");
    assert!(made.success());
    let script = Script::parse(&format!(
        r#"{{"stages": {{"a": {{"reply": "{SUCCESS_ESCAPED}", "wait_for": "{}"}}}}}}"#,
        fifo.display()
    ))
    .unwrap();
    let clock = Rc::new(SimulatedClock::default());
    let mut fake = FakeHarness::new(script, Rc::clone(&clock));
    let before = clock.now_ms();
    let started = std::time::Instant::now();
    let outcome = fake.run_session(&Session {
        time_limit_ms: 200,
        ..session("a")
    });
    assert_eq!(outcome.end, SessionEnd::TimedOut);
    // The simulated clock moves by the limit, on top of the real time that passed.
    let waited = clock.now_ms() - before;
    assert!((200..60_000).contains(&waited), "{waited}");
    assert!(started.elapsed() >= std::time::Duration::from_millis(200));
}

#[test]
fn a_bad_script_says_what_is_wrong() {
    for (text, why) in [
        ("[", "is not valid JSON"),
        ("[]", "must be a JSON object"),
        ("{}", "must have `stages`"),
        (r#"{"stages": {}, "extra": 1}"#, "unknown key `extra`"),
        (r#"{"stages": {"a": "hi"}}"#, "stage `a` must be an object"),
        (r#"{"stages": {"a": {}}}"#, "stage `a` needs `reply`"),
        (
            r#"{"stages": {"a": {"reply": "x", "exit_status": 256}}}"#,
            "`exit_status`",
        ),
        (
            r#"{"stages": {"a": {"reply": "x", "exit_status": -1}}}"#,
            "`exit_status`",
        ),
        (
            r#"{"stages": {"a": {"reply": "x", "duration_ms": 1.5}}}"#,
            "`duration_ms`",
        ),
        (
            r#"{"stages": {"a": {"reply": "x", "wait_for": 1}}}"#,
            "`wait_for`",
        ),
        (
            r#"{"stages": {"a": {"reply": "x", "replay": 1}}}"#,
            "unknown key `replay`",
        ),
    ] {
        let error = Script::parse(text).unwrap_err();
        assert!(error.contains(why), "{text}: {error}");
    }
    let missing = TempDir::new("script-missing");
    let error = Script::load(&missing.path().join("none.json")).unwrap_err();
    assert!(error.contains("cannot read"), "{error}");
}

#[cfg(unix)]
#[test]
fn a_script_that_is_a_link_or_a_pipe_is_refused_without_waiting() {
    // `mkfifo` is a child process.
    let _serial = one_at_a_time();
    let project = TempDir::new("script-kinds");
    let real = project.write("real.json", br#"{"stages": {}}"#);
    assert!(Script::load(&real).is_ok());
    let link = project.path().join("link.json");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let error = Script::load(&link).unwrap_err();
    assert!(error.contains("not a regular file"), "{error}");
    let fifo = project.path().join("pipe.json");
    let made = std::process::Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .expect("mkfifo");
    assert!(made.success());
    // No one writes to the pipe, so a load that opened it to read would wait here for good.
    let error = Script::load(&fifo).unwrap_err();
    assert!(error.contains("not a regular file"), "{error}");
}

// --- choosing the harness ------------------------------------------------------------------------------------------

#[test]
fn fake_is_refused_without_a_script() {
    assert_eq!(
        choose_harness("fake", None, None),
        Err(HarnessRefusal::FakeWithoutScript)
    );
    assert_eq!(
        choose_harness("fake", Some(Path::new("")), Some(OsStr::new(""))),
        Err(HarnessRefusal::FakeWithoutScript)
    );
    let message = HarnessRefusal::FakeWithoutScript.to_string();
    assert!(
        message.contains("--fake-script") && message.contains("KONDUCTOR_FAKE_SCRIPT"),
        "{message}"
    );
}

#[test]
fn fake_is_accepted_with_a_flag_or_the_variable_and_the_flag_wins() {
    let fake = |path: &str| {
        Ok(HarnessChoice::Fake {
            script: path.into(),
        })
    };
    assert_eq!(
        choose_harness("fake", Some(Path::new("a.json")), None),
        fake("a.json")
    );
    assert_eq!(
        choose_harness("fake", None, Some(OsStr::new("b.json"))),
        fake("b.json")
    );
    assert_eq!(
        choose_harness(
            "fake",
            Some(Path::new("a.json")),
            Some(OsStr::new("b.json"))
        ),
        fake("a.json")
    );
    assert_eq!(
        choose_harness("fake", None, Some(OsStr::new("b.json")))
            .unwrap()
            .name(),
        "fake"
    );
}

#[test]
fn the_real_harnesses_wait_for_step_1f_and_other_names_are_unknown() {
    for name in ["kiro-cli", "claude"] {
        let refusal = choose_harness(name, Some(Path::new("a.json")), None).unwrap_err();
        assert_eq!(refusal, HarnessRefusal::NotInThisBuild(name.to_string()));
        assert!(refusal.to_string().contains("step 1f"), "{refusal}");
    }
    assert_eq!(
        choose_harness("kiro", None, None),
        Err(HarnessRefusal::Unknown("kiro".to_string()))
    );
}
