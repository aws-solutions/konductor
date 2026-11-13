// SPDX-License-Identifier: Apache-2.0
//! The runner with in-memory ports and a fake clock: state transitions, limits, the lock and abandoned runs.

use std::cell::Cell;
use std::collections::BTreeMap;

use workflow_core::limits::{
    MAX_GOAL_CHARS, MAX_PARAM_BYTES, MAX_PROMPT_BYTES, MAX_SESSION_OUTPUT_BYTES,
    STAGE_TIME_LIMIT_MS,
};
use workflow_core::model::{Check, Intent, Param, Stage, Workflow};
use workflow_core::ports::{
    Claim, Clock, Harness, LockRecord, Owner, PortError, RunLock, RunStore, Session, SessionEnd,
    SessionOutcome,
};
use workflow_core::run::{CheckState, Run, RunStatus, StageStatus};
use workflow_core::runner::{
    acquire, end_abandoned, execute, judge, keep_tail, prepare, start, Prepared, StartError,
    UsageError,
};
use workflow_core::time::{format_timestamp, is_run_id, parse_timestamp, run_id_prefix};
use workflow_core::Reason;

// 2026-11-05T12:30:00Z
const T0: u64 = 1_793_881_800_000;

const SUCCESS: &str = "KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}";

struct FakeClock(Cell<u64>);

impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.0.get()
    }
}

/// One scripted session: what it says, how it ends and how long it takes on the fake clock.
#[derive(Clone)]
struct Reply {
    message: String,
    end: SessionEnd,
    duration_ms: u64,
}

fn reply(message: &str) -> Reply {
    Reply {
        message: message.to_string(),
        end: SessionEnd::Exited(0),
        duration_ms: 1000,
    }
}

struct FakeHarness<'a> {
    clock: &'a FakeClock,
    replies: BTreeMap<String, Reply>,
    sessions: Vec<(String, String, String)>,
}

impl Harness for FakeHarness<'_> {
    fn run_session(&mut self, session: &Session) -> SessionOutcome {
        self.sessions.push((
            session.stage.to_string(),
            session.agent.to_string(),
            session.prompt.to_string(),
        ));
        assert_eq!(session.time_limit_ms, STAGE_TIME_LIMIT_MS);
        let Some(reply) = self.replies.get(session.stage).cloned() else {
            return SessionOutcome {
                end: SessionEnd::NotStarted,
                final_message: String::new(),
            };
        };
        self.clock.0.set(self.clock.0.get() + reply.duration_ms);
        SessionOutcome {
            end: reply.end,
            final_message: reply.message,
        }
    }
}

/// A run store in memory. `writes` keeps every state document in the order it was written. A write to a run in
/// `unwritable` fails.
#[derive(Default)]
struct MemoryStore {
    states: BTreeMap<String, Option<String>>,
    writes: Vec<String>,
    next: usize,
    unwritable: Vec<String>,
}

impl RunStore for MemoryStore {
    fn reserve(&mut self, prefix: &str) -> Result<String, PortError> {
        self.next += 1;
        let id = format!("{prefix}-run{:02}", self.next);
        self.states.insert(id.clone(), None);
        Ok(id)
    }
    fn discard(&mut self, run_id: &str) -> Result<(), PortError> {
        self.states.remove(run_id);
        Ok(())
    }
    fn write_state(&mut self, run_id: &str, text: &str) -> Result<(), PortError> {
        if self.unwritable.iter().any(|id| id == run_id) {
            return Err(PortError(format!("{run_id} is read-only")));
        }
        self.states
            .insert(run_id.to_string(), Some(text.to_string()));
        self.writes.push(text.to_string());
        Ok(())
    }
    fn read_state(&self, run_id: &str) -> Result<Option<String>, PortError> {
        Ok(self.states.get(run_id).cloned().flatten())
    }
    fn list(&self) -> Result<Vec<String>, PortError> {
        Ok(self.states.keys().cloned().collect())
    }
}

impl MemoryStore {
    fn run(&self, run_id: &str) -> Run {
        Run::from_text(self.states[run_id].as_deref().expect("state")).expect("valid state")
    }
}

/// A lock in memory. `holder` is the record of whoever holds it. `unreadable` stands for a lock that another process
/// holds or is taking, whose record cannot be read.
#[derive(Default)]
struct MemoryLock {
    holder: Option<LockRecord>,
    unreadable: bool,
}

impl RunLock for MemoryLock {
    fn try_claim(&mut self, record: &LockRecord) -> Result<Claim, PortError> {
        if self.unreadable {
            return Ok(Claim::Held(None));
        }
        match &self.holder {
            Some(holder) => Ok(Claim::Held(Some(holder.clone()))),
            None => {
                self.holder = Some(record.clone());
                Ok(Claim::Acquired)
            }
        }
    }
    fn release(&mut self) {
        self.holder = None;
    }
}

fn owner(pid: u32, started: &str) -> Owner {
    Owner {
        pid,
        started: started.to_string(),
    }
}

fn me() -> Owner {
    owner(100, "2026-11-05T12:29:58Z")
}

fn stage(name: &str, agent: &str) -> Stage {
    Stage {
        name: name.to_string(),
        agent: agent.to_string(),
        prompt: Some(format!("Do {name}.")),
        prompt_file: None,
    }
}

fn workflow(stage_names: &[&str]) -> Workflow {
    let mut params = BTreeMap::new();
    params.insert(
        "goal".to_string(),
        Param {
            description: None,
            default: Some("Default goal.".to_string()),
        },
    );
    Workflow {
        format: "konductor/1".to_string(),
        name: "t".to_string(),
        version: "0.1.0".to_string(),
        intent: Intent {
            outcome: "Done.".to_string(),
            accept: vec![Check {
                id: "plan-exists".to_string(),
                file: "PLAN.md".to_string(),
            }],
        },
        params,
        stages: stage_names
            .iter()
            .map(|name| stage(name, "k-developer"))
            .collect(),
    }
}

fn prepared(stage_names: &[&str]) -> Prepared {
    prepare(workflow(stage_names), Some("Ship it."), &BTreeMap::new()).expect("prepared")
}

/// Starts and executes a run of `stage_names` with `replies`, from a fresh store and lock.
fn run_through(stage_names: &[&str], replies: &[(&str, Reply)]) -> (Run, MemoryStore, Vec<String>) {
    let clock = FakeClock(Cell::new(T0));
    let mut store = MemoryStore::default();
    let mut lock = MemoryLock::default();
    let prepared = prepared(stage_names);
    let started = start(&prepared, "fake", me(), &mut store, &mut lock, &clock).expect("start");
    let mut run = started.run;
    let mut harness = FakeHarness {
        clock: &clock,
        replies: replies
            .iter()
            .map(|(name, reply)| (name.to_string(), reply.clone()))
            .collect(),
        sessions: Vec::new(),
    };
    let mut reported = Vec::new();
    execute(
        &mut run,
        &prepared,
        &mut harness,
        &clock,
        &mut store,
        &mut |stage| {
            reported.push(format!("{}:{}", stage.name, stage.status.as_str()));
        },
    )
    .expect("execute");
    assert_eq!(lock.holder, Some(started.record.clone()));
    lock.release();
    assert_eq!(lock.holder, None);
    (run, store, reported)
}

fn statuses(run: &Run) -> Vec<StageStatus> {
    run.stages.iter().map(|s| s.status).collect()
}

// --- state transitions ---------------------------------------------------------------------------------------------

#[test]
fn a_run_whose_stages_all_succeed_passes_and_records_every_transition() {
    let (run, store, reported) = run_through(
        &["plan", "build"],
        &[
            ("plan", reply(SUCCESS)),
            (
                "build",
                reply("ok\nKONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": []}"),
            ),
        ],
    );
    assert_eq!(run.status, RunStatus::Passed);
    assert_eq!(run.exit_code, Some(0));
    assert_eq!(run.started_at, T0);
    assert_eq!(run.finished_at, Some(T0 + 2000));
    assert_eq!(statuses(&run), [StageStatus::Passed, StageStatus::Passed]);
    assert_eq!(run.stages[0].reported_outputs, ["PLAN.md"]);
    assert_eq!(run.checks["plan-exists"], CheckState::Deferred);
    assert_eq!(reported, ["plan:passed", "build:passed"]);
    assert_eq!(store.run(&run.run_id), run);

    let history: Vec<(RunStatus, Vec<StageStatus>)> = store
        .writes
        .iter()
        .map(|text| {
            let run = Run::from_text(text).expect("valid");
            (run.status, statuses(&run))
        })
        .collect();
    use StageStatus::{Passed, Pending, Running};
    assert_eq!(
        history,
        [
            (RunStatus::Running, vec![Pending, Pending]),
            (RunStatus::Running, vec![Running, Pending]),
            (RunStatus::Running, vec![Passed, Pending]),
            (RunStatus::Running, vec![Passed, Running]),
            (RunStatus::Running, vec![Passed, Passed]),
            (RunStatus::Passed, vec![Passed, Passed]),
        ]
    );
}

#[test]
fn each_session_gets_its_stage_agent_and_full_prompt() {
    let clock = FakeClock(Cell::new(T0));
    let mut store = MemoryStore::default();
    let mut lock = MemoryLock::default();
    let prepared = prepared(&["plan", "build"]);
    let mut run = start(&prepared, "fake", me(), &mut store, &mut lock, &clock)
        .expect("start")
        .run;
    let mut harness = FakeHarness {
        clock: &clock,
        replies: [("plan", reply(SUCCESS)), ("build", reply(SUCCESS))]
            .into_iter()
            .map(|(n, r)| (n.to_string(), r))
            .collect(),
        sessions: Vec::new(),
    };
    execute(
        &mut run,
        &prepared,
        &mut harness,
        &clock,
        &mut store,
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(harness.sessions.len(), 2);
    assert_eq!(harness.sessions[1].0, "build");
    assert_eq!(harness.sessions[1].1, "k-developer");
    assert_eq!(harness.sessions[1].2, prepared.prompts[1]);
    assert!(prepared.prompts[1].starts_with("Goal: Ship it.\n"));
    assert!(prepared.prompts[1].ends_with("or use []."));
}

#[test]
fn a_blocked_stage_halts_the_run_and_later_stages_stay_pending() {
    let (run, _, reported) = run_through(
        &["plan", "build", "check"],
        &[
            ("plan", reply(SUCCESS)),
            ("build", reply("I did it.")),
            ("check", reply(SUCCESS)),
        ],
    );
    assert_eq!(run.status, RunStatus::Halted);
    assert_eq!(run.exit_code, Some(1));
    assert_eq!(run.finished_at, Some(T0 + 2000));
    assert_eq!(
        statuses(&run),
        [
            StageStatus::Passed,
            StageStatus::Blocked(Reason::ResultMissing),
            StageStatus::Pending
        ]
    );
    assert_eq!(reported, ["plan:passed", "build:blocked"]);
}

#[test]
fn every_blocked_stage_records_its_reason() {
    let cases = [
        (reply("no line"), Reason::ResultMissing),
        (
            reply("KONDUCTOR_RESULT {\"status\": \"success\"}"),
            Reason::ResultInvalid,
        ),
        (
            reply("KONDUCTOR_RESULT {\"status\": \"failure\", \"outputs\": []}"),
            Reason::ResultFailure,
        ),
        (
            Reply {
                end: SessionEnd::Exited(3),
                ..reply(SUCCESS)
            },
            Reason::SessionFailed,
        ),
        (
            Reply {
                end: SessionEnd::TimedOut,
                ..reply(SUCCESS)
            },
            Reason::Timeout,
        ),
    ];
    for (reply, reason) in cases {
        let (run, store, _) = run_through(&["only"], &[("only", reply)]);
        assert_eq!(statuses(&run), [StageStatus::Blocked(reason)]);
        let text = store.states[&run.run_id].clone().unwrap();
        assert!(
            text.contains(&format!("\"reason\": \"{}\"", reason.as_str())),
            "{text}"
        );
    }
}

#[test]
fn a_session_that_does_not_start_is_session_failed() {
    let (run, _, _) = run_through(&["only"], &[]);
    assert_eq!(
        statuses(&run),
        [StageStatus::Blocked(Reason::SessionFailed)]
    );
}

// --- limits --------------------------------------------------------------------------------------------------------

#[test]
fn a_stage_that_runs_past_its_time_limit_is_blocked_with_timeout() {
    let late = Reply {
        duration_ms: STAGE_TIME_LIMIT_MS + 1,
        ..reply(SUCCESS)
    };
    let (run, _, _) = run_through(
        &["slow", "next"],
        &[("slow", late), ("next", reply(SUCCESS))],
    );
    assert_eq!(
        statuses(&run),
        [StageStatus::Blocked(Reason::Timeout), StageStatus::Pending]
    );
    assert_eq!(run.finished_at, Some(T0 + STAGE_TIME_LIMIT_MS));

    let on_time = Reply {
        duration_ms: STAGE_TIME_LIMIT_MS,
        ..reply(SUCCESS)
    };
    let (run, _, _) = run_through(&["slow"], &[("slow", on_time)]);
    assert_eq!(run.status, RunStatus::Passed);
}

#[test]
fn the_time_limit_comes_before_the_exit_status_and_the_exit_status_before_the_result() {
    let outcome = |end, message: &str| SessionOutcome {
        end,
        final_message: message.to_string(),
    };
    assert_eq!(
        judge(
            &outcome(SessionEnd::Exited(1), "x"),
            STAGE_TIME_LIMIT_MS + 1
        ),
        Err(Reason::Timeout)
    );
    assert_eq!(
        judge(&outcome(SessionEnd::Exited(1), SUCCESS), 0),
        Err(Reason::SessionFailed)
    );
    assert_eq!(
        judge(&outcome(SessionEnd::Exited(-1), SUCCESS), 0),
        Err(Reason::SessionFailed)
    );
    assert!(judge(&outcome(SessionEnd::Exited(0), SUCCESS), 0).is_ok());
}

#[test]
fn only_the_last_mebibyte_of_a_final_message_is_read() {
    let ok = |message: String| {
        judge(
            &SessionOutcome {
                end: SessionEnd::Exited(0),
                final_message: message,
            },
            0,
        )
    };
    let noise = "x".repeat(MAX_SESSION_OUTPUT_BYTES * 2);
    assert!(ok(format!("{noise}\n{SUCCESS}")).is_ok());
    let after = "y\n".repeat(MAX_SESSION_OUTPUT_BYTES / 2 + 1);
    assert_eq!(
        ok(format!("{SUCCESS}\n{after}")),
        Err(Reason::ResultMissing)
    );
}

#[test]
fn the_kept_tail_starts_on_a_character_boundary() {
    assert_eq!(keep_tail("aé", 1), "");
    assert_eq!(keep_tail("aé", 2), "é");
    assert_eq!(keep_tail("aé", 9), "aé");
}

#[test]
fn the_goal_comes_from_the_flag_or_the_default_and_a_missing_one_is_a_usage_error() {
    let none = BTreeMap::new();
    assert_eq!(
        prepare(workflow(&["a"]), None, &none).unwrap().goal,
        "Default goal."
    );
    assert_eq!(
        prepare(workflow(&["a"]), Some("Mine."), &none)
            .unwrap()
            .goal,
        "Mine."
    );
    let mut no_default = workflow(&["a"]);
    no_default.params.clear();
    assert_eq!(
        prepare(no_default, None, &none),
        Err(UsageError::GoalMissing)
    );
}

#[test]
fn a_blank_goal_is_a_usage_error() {
    let none = BTreeMap::new();
    for blank in ["", " ", "\t\n", "\u{3000}"] {
        assert_eq!(
            prepare(workflow(&["a"]), Some(blank), &none),
            Err(UsageError::GoalBlank),
            "{blank:?}"
        );
    }
    assert!(UsageError::GoalBlank
        .message()
        .contains("`--goal` is blank"));
    assert_eq!(
        prepare(workflow(&["a"]), Some(" x "), &none).unwrap().goal,
        " x "
    );
}

#[test]
fn a_goal_over_its_limit_is_a_usage_error() {
    let none = BTreeMap::new();
    let at_limit = "é".repeat(MAX_GOAL_CHARS);
    assert!(prepare(workflow(&["a"]), Some(&at_limit), &none).is_ok());
    let over = "é".repeat(MAX_GOAL_CHARS + 1);
    assert_eq!(
        prepare(workflow(&["a"]), Some(&over), &none),
        Err(UsageError::GoalTooLong {
            chars: MAX_GOAL_CHARS + 1
        })
    );
}

#[test]
fn a_param_over_its_cap_is_a_usage_error() {
    let mut params = BTreeMap::new();
    params.insert("notes".to_string(), "n".repeat(MAX_PARAM_BYTES));
    assert!(prepare(workflow(&["a"]), None, &params).is_ok());
    params.insert("notes".to_string(), "n".repeat(MAX_PARAM_BYTES + 1));
    let error = prepare(workflow(&["a"]), None, &params).unwrap_err();
    assert_eq!(
        error,
        UsageError::ParamTooLarge {
            name: "notes".to_string(),
            bytes: MAX_PARAM_BYTES + 1
        }
    );
    assert!(error.message().contains("65536"), "{}", error.message());
}

#[test]
fn a_rendered_prompt_over_its_cap_is_a_usage_error() {
    let none = BTreeMap::new();
    // The prompt rule allows 32768 characters, and four-byte characters take that past 100 KiB.
    let mut big = workflow(&["a", "b"]);
    big.stages[1].prompt = Some("😀".repeat(32_768));
    let error = prepare(big, None, &none).unwrap_err();
    let UsageError::PromptTooLarge { stage, bytes } = &error else {
        panic!("{error:?}");
    };
    assert_eq!(stage, "b");
    assert!(*bytes > MAX_PROMPT_BYTES);

    let mut fits = workflow(&["a"]);
    let shared = prepare(fits.clone(), None, &none).unwrap().prompts[0].len() - "Do a.".len();
    fits.stages[0].prompt = Some("p".repeat(MAX_PROMPT_BYTES - shared));
    assert_eq!(
        prepare(fits.clone(), None, &none).unwrap().prompts[0].len(),
        MAX_PROMPT_BYTES
    );
    fits.stages[0].prompt = Some("p".repeat(MAX_PROMPT_BYTES - shared + 1));
    assert!(matches!(
        prepare(fits, None, &none),
        Err(UsageError::PromptTooLarge { .. })
    ));
}

// --- the lock ------------------------------------------------------------------------------------------------------

fn record(owner: Owner, run_id: &str) -> LockRecord {
    LockRecord {
        owner,
        run_id: run_id.to_string(),
    }
}

#[test]
fn a_held_lock_refuses_a_second_run_and_no_run_folder_is_left() {
    let clock = FakeClock(Cell::new(T0));
    let mut store = MemoryStore::default();
    let holder = record(owner(42, "2026-11-05T11:59:40Z"), "20261105-1200-abcde");
    let mut lock = MemoryLock {
        holder: Some(holder.clone()),
        ..MemoryLock::default()
    };
    let error = start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap_err();
    assert_eq!(error, StartError::AlreadyRunning(holder.clone()));
    assert!(store.states.is_empty());
    assert_eq!(lock.holder, Some(holder));
}

#[test]
fn a_free_lock_is_taken_with_the_record_of_the_new_run() {
    let clock = FakeClock(Cell::new(T0));
    let mut store = MemoryStore::default();
    let mut lock = MemoryLock::default();
    let started = start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap();
    assert_eq!(lock.holder, Some(started.record.clone()));
    assert_eq!(started.record.owner, me());
    assert_eq!(started.record.run_id, started.run.run_id);
}

#[test]
fn a_run_whose_first_state_cannot_be_written_leaves_no_folder_and_no_lock() {
    struct Full(MemoryStore);
    impl RunStore for Full {
        fn reserve(&mut self, prefix: &str) -> Result<String, PortError> {
            self.0.reserve(prefix)
        }
        fn discard(&mut self, run_id: &str) -> Result<(), PortError> {
            self.0.discard(run_id)
        }
        fn write_state(&mut self, _: &str, _: &str) -> Result<(), PortError> {
            Err(PortError("disk full".to_string()))
        }
        fn read_state(&self, run_id: &str) -> Result<Option<String>, PortError> {
            self.0.read_state(run_id)
        }
        fn list(&self) -> Result<Vec<String>, PortError> {
            self.0.list()
        }
    }
    let clock = FakeClock(Cell::new(T0));
    let mut store = Full(MemoryStore::default());
    let mut lock = MemoryLock::default();
    let error = start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap_err();
    assert_eq!(error, StartError::Port(PortError("disk full".to_string())));
    assert!(store.0.states.is_empty());
    assert_eq!(lock.holder, None);
}

#[test]
fn an_unreadable_lock_refuses_the_run() {
    let mut lock = MemoryLock {
        unreadable: true,
        ..MemoryLock::default()
    };
    assert_eq!(
        acquire(&mut lock, &record(me(), "20261105-1200-abcde")),
        Err(StartError::UnreadableLock)
    );
}

// --- abandoned runs ------------------------------------------------------------------------------------------------

/// A store that holds one run left `running` by `left_by`, with the given stage states.
fn store_with_abandoned(left_by: Owner, stages: &[StageStatus]) -> (MemoryStore, String) {
    let clock = FakeClock(Cell::new(T0 - 60_000));
    let mut store = MemoryStore::default();
    let mut lock = MemoryLock::default();
    let names: Vec<String> = (0..stages.len()).map(|i| format!("s{i}")).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    let mut run = start(
        &prepared(&names),
        "fake",
        left_by,
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap()
    .run;
    for (state, status) in run.stages.iter_mut().zip(stages) {
        state.status = *status;
    }
    store
        .write_state(&run.run_id.clone(), &run.to_text())
        .unwrap();
    (store, run.run_id)
}

#[test]
fn a_run_whose_owner_is_gone_reads_halted_on_the_next_start() {
    use StageStatus::{Passed, Pending, Running};
    let (mut store, old) = store_with_abandoned(owner(9, "gone"), &[Passed, Running, Pending]);
    let clock = FakeClock(Cell::new(T0));
    let mut lock = MemoryLock::default();
    let started = start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap();
    let ended = store.run(&old);
    assert_eq!(ended.status, RunStatus::Halted);
    assert_eq!(ended.exit_code, Some(1));
    assert_eq!(ended.finished_at, Some(T0));
    assert_eq!(
        statuses(&ended),
        [Passed, StageStatus::Blocked(Reason::SessionFailed), Pending]
    );
    assert_eq!(started.recovered, [ended]);
}

#[test]
fn a_run_left_running_is_ended_whatever_its_owner_record_says() {
    // Holding the lock proves that no process runs it, even one whose PID and start time look live from here, such as
    // an owner in another PID namespace.
    use StageStatus::{Pending, Running};
    let (mut store, old) = store_with_abandoned(owner(9, "looks-alive"), &[Running, Pending]);
    let clock = FakeClock(Cell::new(T0));
    let mut lock = MemoryLock::default();
    let started = start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap();
    assert_eq!(store.run(&old).status, RunStatus::Halted);
    assert_eq!(started.recovered.len(), 1);
}

#[test]
fn an_abandoned_run_that_cannot_be_written_is_skipped_and_reported() {
    use StageStatus::{Pending, Running};
    let (mut store, stuck) = store_with_abandoned(owner(9, "gone"), &[Running]);
    // A second abandoned run that can still be ended. Its id sorts after the stuck one, so it is reached only if the
    // failed write does not stop recovery.
    let (other_store, _) = store_with_abandoned(owner(8, "gone"), &[Running, Pending]);
    let ended_id = format!("{}-zzzzz", run_id_prefix(T0 - 60_000));
    assert!(ended_id > stuck);
    let other_text = other_store
        .states
        .values()
        .next()
        .cloned()
        .flatten()
        .unwrap();
    let mut other = Run::from_text(&other_text).unwrap();
    other.run_id = ended_id.clone();
    store.states.insert(ended_id.clone(), Some(other.to_text()));
    store.unwritable.push(stuck.clone());

    let clock = FakeClock(Cell::new(T0));
    let mut lock = MemoryLock::default();
    let started = start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .expect("one unwritable run does not stop the start");
    assert_eq!(started.unrecovered.len(), 1);
    assert_eq!(started.unrecovered[0].run_id, stuck);
    assert!(started.unrecovered[0].error.0.contains("read-only"));
    assert_eq!(store.run(&stuck).status, RunStatus::Running);
    assert_eq!(started.recovered.len(), 1);
    assert_eq!(started.recovered[0].run_id, ended_id);
    assert_eq!(store.run(&ended_id).status, RunStatus::Halted);
    assert_eq!(store.run(&started.run.run_id).status, RunStatus::Running);
}

#[test]
fn a_run_that_did_not_start_ends_no_abandoned_run() {
    use StageStatus::Running;
    let (mut store, old) = store_with_abandoned(owner(9, "gone"), &[Running]);
    let clock = FakeClock(Cell::new(T0));
    let mut lock = MemoryLock {
        holder: Some(record(
            owner(42, "2026-11-05T11:59:40Z"),
            "20261105-1200-abcde",
        )),
        ..MemoryLock::default()
    };
    let error = start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap_err();
    assert!(matches!(error, StartError::AlreadyRunning(_)));
    assert_eq!(store.run(&old).status, RunStatus::Running);
}

#[test]
fn an_abandoned_run_blocks_the_next_pending_stage_or_passes_when_every_stage_passed() {
    use StageStatus::{Blocked, Passed, Pending};
    let (mut store, old) = store_with_abandoned(owner(9, "gone"), &[Passed, Pending]);
    let mut run = store.run(&old);
    end_abandoned(&mut run, T0);
    assert_eq!(statuses(&run), [Passed, Blocked(Reason::SessionFailed)]);

    let (s, old) = store_with_abandoned(owner(9, "gone"), &[Passed, Passed]);
    store = s;
    let mut run = store.run(&old);
    end_abandoned(&mut run, T0);
    assert_eq!((run.status, run.exit_code), (RunStatus::Passed, Some(0)));
}

#[test]
fn a_run_left_running_by_the_caller_itself_is_ended_too() {
    use StageStatus::Running;
    let (mut store, old) = store_with_abandoned(me(), &[Running]);
    let clock = FakeClock(Cell::new(T0));
    let mut lock = MemoryLock::default();
    start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap();
    assert_eq!(store.run(&old).status, RunStatus::Halted);
}

#[test]
fn a_run_that_finished_before_the_next_start_is_left_as_passed() {
    // The owner wrote `passed` before it ended, so recover reads the state inside its own lock, sees that the status
    // is not `running`, and leaves it. Nothing is written over.
    use StageStatus::Passed;
    let (mut store, old) = store_with_abandoned(owner(9, "gone"), &[Passed]);
    let mut run = store.run(&old);
    run.pass(T0 - 1000);
    store.write_state(&old, &run.to_text()).unwrap();
    let before = store.writes.len();
    let clock = FakeClock(Cell::new(T0));
    let mut lock = MemoryLock::default();
    let started = start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap();
    assert_eq!(store.run(&old), run);
    assert_eq!(started.recovered, Vec::<Run>::new());
    assert_eq!(started.unrecovered, Vec::new());
    // Only the new run's first state was written after the recover sweep.
    assert_eq!(store.writes.len() - before, 1);
    assert_eq!(
        Run::from_text(&store.writes[before]).unwrap().run_id,
        started.run.run_id,
    );
}

#[test]
fn a_start_sweeps_abandoned_runs_before_writing_its_own_first_state() {
    // The lock holder ends the abandoned run before it writes its own first state, so a reader of the store sees the
    // old run as `halted` before any trace of the new one.
    use StageStatus::Running;
    let (mut store, old) = store_with_abandoned(owner(9, "gone"), &[Running]);
    let before = store.writes.len();
    let clock = FakeClock(Cell::new(T0));
    let mut lock = MemoryLock::default();
    let started = start(
        &prepared(&["a"]),
        "fake",
        me(),
        &mut store,
        &mut lock,
        &clock,
    )
    .unwrap();
    let writes: Vec<Run> = store.writes[before..]
        .iter()
        .map(|text| Run::from_text(text).unwrap())
        .collect();
    assert_eq!(writes.len(), 2);
    assert_eq!(writes[0].run_id, old);
    assert_eq!(writes[0].status, RunStatus::Halted);
    assert_eq!(writes[1].run_id, started.run.run_id);
    assert_eq!(writes[1].status, RunStatus::Running);
}

// --- the state document --------------------------------------------------------------------------------------------

#[test]
fn the_state_document_has_the_contract_fields_and_reads_back() {
    let (run, store, _) = run_through(&["plan", "build"], &[("plan", reply(SUCCESS))]);
    let text = store.states[&run.run_id].clone().unwrap();
    let expected = format!(
        r#"{{
  "checks": {{
    "plan-exists": "deferred"
  }},
  "exit_code": 1,
  "finished_at": "2026-11-05T12:30:01Z",
  "harness": "fake",
  "order": [
    "plan",
    "build"
  ],
  "owner": {{
    "pid": 100,
    "started": "2026-11-05T12:29:58Z"
  }},
  "reported_outputs": {{
    "plan": [
      "PLAN.md"
    ]
  }},
  "run_id": "{}",
  "stages": {{
    "build": {{
      "reason": "SESSION_FAILED",
      "status": "blocked"
    }},
    "plan": {{
      "status": "passed"
    }}
  }},
  "started_at": "2026-11-05T12:30:00Z",
  "status": "halted",
  "workflow": "t"
}}
"#,
        run.run_id
    );
    assert_eq!(text, expected);
    assert_eq!(Run::from_text(&text), Some(run));
}

#[test]
fn a_state_document_that_breaks_the_rules_does_not_read() {
    let (run, _, _) = run_through(&["plan"], &[("plan", reply(SUCCESS))]);
    let good = run.to_text();
    for (from, to) in [
        ("\"status\": \"passed\",", "\"status\": \"done\","),
        (
            "\"status\": \"passed\"\n    }",
            "\"status\": \"blocked\"\n    }",
        ),
        ("\"exit_code\": 0", "\"exit_code\": 300"),
        ("\"deferred\"", "\"later\""),
        ("2026-11-05T12:30:00Z", "2026-11-05 12:30:00"),
        ("\"pid\": 100", "\"pid\": \"100\""),
    ] {
        let bad = good.replacen(from, to, 1);
        assert_ne!(bad, good, "{from}");
        assert_eq!(Run::from_text(&bad), None, "{from} -> {to}");
    }
    assert_eq!(Run::from_text(&good.replace(&run.run_id, "run-1")), None);
}

#[test]
fn the_lock_record_reads_back_from_its_text() {
    let lock = record(owner(4_000_000_000, "123"), "20261105-1230-abc12");
    assert_eq!(
        lock.to_text(),
        "{\"pid\":4000000000,\"run_id\":\"20261105-1230-abc12\",\"started\":\"123\"}"
    );
    assert_eq!(LockRecord::from_text(&lock.to_text()), Some(lock));
    assert_eq!(
        LockRecord::from_text("{\"pid\":1,\"run_id\":\"\\u001b[2Jx\",\"started\":\"1\"}"),
        None
    );
    assert_eq!(
        LockRecord::from_text("{\"pid\":5000000000,\"run_id\":\"x\",\"started\":\"1\"}"),
        None
    );
    assert_eq!(LockRecord::from_text(""), None);
}

#[test]
fn times_and_run_ids_follow_the_contract() {
    assert_eq!(format_timestamp(T0 + 999), "2026-11-05T12:30:00Z");
    assert_eq!(parse_timestamp("2026-11-05T12:30:00Z"), Some(T0));
    assert_eq!(format_timestamp(0), "1970-01-01T00:00:00Z");
    assert_eq!(
        parse_timestamp("2024-02-29T23:59:59Z")
            .map(format_timestamp)
            .as_deref(),
        Some("2024-02-29T23:59:59Z")
    );
    for bad in [
        "2023-02-29T00:00:00Z",
        "2026-13-01T00:00:00Z",
        "2026-11-05T24:00:00Z",
        "2026-11-05T12:30:00",
        "1969-12-31T23:59:59Z",
    ] {
        assert_eq!(parse_timestamp(bad), None, "{bad}");
    }
    assert_eq!(run_id_prefix(T0), "20261105-1230");
    assert!(is_run_id("20261105-1230-a1b2c"));
    for bad in [
        "20261105-1230-A1B2C",
        "20261105-1230-a1b2",
        "2026110-51230-a1b2c",
        "20261105_1230-a1b2c",
        "x",
    ] {
        assert!(!is_run_id(bad), "{bad}");
    }
}
