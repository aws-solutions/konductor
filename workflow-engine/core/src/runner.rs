// SPDX-License-Identifier: Apache-2.0
//! The runner: checks the inputs of a run, takes the workspace lock, runs each agent stage in a fresh session and
//! records the states (D8, D21).
//!
//! A stage passes on a valid result that reports success. Slice 1 has no declared outputs and no `done_when` checks, so
//! nothing else is judged yet, and every check in `intent.accept` stays `deferred`. A blocked stage halts the run, and
//! the stages after it stay `pending`.

use std::collections::BTreeMap;

use crate::limits::{
    MAX_GOAL_CHARS, MAX_PARAM_BYTES, MAX_PROMPT_BYTES, MAX_SESSION_OUTPUT_BYTES,
    STAGE_TIME_LIMIT_MS,
};
use crate::model::Workflow;
use crate::ports::{
    Claim, Clock, Harness, LockRecord, Owner, PortError, RunLock, RunStore, Session, SessionEnd,
    SessionOutcome,
};
use crate::prompt::runner_prompt;
use crate::result::{parse_result, Reason, StageResult};
use crate::rules::code_points;
use crate::run::{whole_second, CheckState, Run, RunStatus, StageState, StageStatus};
use crate::time::{is_run_id, run_id_prefix};

/// A run's inputs, checked, with the prompt of each stage rendered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prepared {
    pub workflow: Workflow,
    pub goal: String,
    /// The full text each stage's session is given, in stage order.
    pub prompts: Vec<String>,
}

/// An input of a run that breaks a limit. Each one is a usage error (exit 64) before anything runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UsageError {
    /// No `--goal`, and the workflow declares no default.
    GoalMissing,
    GoalTooLong {
        chars: usize,
    },
    /// `flow run` has no `--param` yet and passes no params, so only a direct caller of [`prepare`] meets this.
    ParamTooLarge {
        name: String,
        bytes: usize,
    },
    PromptTooLarge {
        stage: String,
        bytes: usize,
    },
}

impl UsageError {
    pub fn message(&self) -> String {
        match self {
            UsageError::GoalMissing => {
                "The workflow has no default goal, so `--goal` is required.".to_string()
            }
            UsageError::GoalTooLong { chars } => format!(
                "The goal has {chars} characters, and the limit is {MAX_GOAL_CHARS}."
            ),
            UsageError::ParamTooLarge { name, bytes } => format!(
                "The param `{name}` has {bytes} bytes, and the limit is {MAX_PARAM_BYTES}."
            ),
            UsageError::PromptTooLarge { stage, bytes } => format!(
                "The prompt of stage `{stage}` has {bytes} bytes, and the limit is {MAX_PROMPT_BYTES}."
            ),
        }
    }
}

/// Checks the goal and the params against their limits and renders the prompt of every stage, so that a prompt over its
/// limit is refused before the first stage starts. `goal` is the `--goal` text; without it the workflow's default is
/// used. `params` are the params other than `goal`.
pub fn prepare(
    workflow: Workflow,
    goal: Option<&str>,
    params: &BTreeMap<String, String>,
) -> Result<Prepared, UsageError> {
    let goal = goal
        .map(str::to_string)
        .or_else(|| workflow.params.get("goal").and_then(|p| p.default.clone()))
        .ok_or(UsageError::GoalMissing)?;
    let chars = code_points(&goal);
    if chars > MAX_GOAL_CHARS {
        return Err(UsageError::GoalTooLong { chars });
    }
    if let Some((name, value)) = params.iter().find(|(_, v)| v.len() > MAX_PARAM_BYTES) {
        return Err(UsageError::ParamTooLarge {
            name: name.clone(),
            bytes: value.len(),
        });
    }
    let mut prompts = Vec::with_capacity(workflow.stages.len());
    for (index, stage) in workflow.stages.iter().enumerate() {
        let prompt = runner_prompt(&goal, &workflow.intent.outcome, &workflow.stages, index);
        if prompt.len() > MAX_PROMPT_BYTES {
            return Err(UsageError::PromptTooLarge {
                stage: stage.name.clone(),
                bytes: prompt.len(),
            });
        }
        prompts.push(prompt);
    }
    Ok(Prepared {
        workflow,
        goal,
        prompts,
    })
}

/// Why a run did not start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartError {
    /// Another process holds the workspace lock, and this is its record.
    AlreadyRunning(LockRecord),
    /// Another process holds the workspace lock or is taking it, and which run it owns is not known.
    UnreadableLock,
    Port(PortError),
}

impl From<PortError> for StartError {
    fn from(error: PortError) -> StartError {
        StartError::Port(error)
    }
}

/// Takes the workspace lock for `record`. A lock that another process holds refuses the run. A lock whose owner died
/// is free, because the lock ends with its owner.
pub fn acquire(lock: &mut dyn RunLock, record: &LockRecord) -> Result<(), StartError> {
    match lock.try_claim(record)? {
        Claim::Acquired => Ok(()),
        Claim::Held(Some(holder)) => Err(StartError::AlreadyRunning(holder)),
        Claim::Held(None) => Err(StartError::UnreadableLock),
    }
}

/// Ends a run that was left `running` (spec: a run reads as `halted` only if its owner is gone, which holding the lock
/// proves). The stage that was running, or the next `pending` one if none was, is `blocked` with `SESSION_FAILED`. If
/// every stage had passed, the run reads as `passed`. This is the rule of the canvas contract's "One run per
/// workspace".
pub fn end_abandoned(run: &mut Run, now_ms: u64) {
    let open = run
        .stages
        .iter()
        .position(|s| s.status == StageStatus::Running)
        .or_else(|| {
            run.stages
                .iter()
                .position(|s| s.status == StageStatus::Pending)
        });
    match open {
        Some(stage) => run.halt(stage, Reason::SessionFailed, now_ms),
        None => run.pass(now_ms),
    }
}

/// Ends every run in the store other than `current` that is `running`, and saves it. The caller holds the workspace
/// lock, so no process is running any of them: each was left by an owner that ended. A state document that cannot be
/// read, or does not hold a run, is left as it is.
pub fn recover(
    store: &mut dyn RunStore,
    current: &str,
    now_ms: u64,
) -> Result<Vec<Run>, PortError> {
    let mut ended = Vec::new();
    for run_id in store.list()? {
        if run_id == current {
            continue;
        }
        let Ok(Some(text)) = store.read_state(&run_id) else {
            continue;
        };
        let Some(mut run) = Run::from_text(&text) else {
            continue;
        };
        if run.run_id != run_id || run.status != RunStatus::Running {
            continue;
        }
        end_abandoned(&mut run, now_ms);
        store.write_state(&run_id, &run.to_text())?;
        ended.push(run);
    }
    Ok(ended)
}

/// A run that started: its state, the lock it holds, and the runs that were found abandoned and ended.
#[derive(Debug)]
pub struct Started {
    pub run: Run,
    pub record: LockRecord,
    pub recovered: Vec<Run>,
}

/// Starts a run: makes its folder, takes the workspace lock, ends abandoned runs and saves the new run with every stage
/// `pending`. The caller runs it with [`execute`] and then gives the lock back.
pub fn start(
    prepared: &Prepared,
    harness: &str,
    owner: Owner,
    store: &mut dyn RunStore,
    lock: &mut dyn RunLock,
    clock: &dyn Clock,
) -> Result<Started, StartError> {
    let now = clock.now_ms();
    let run_id = store.reserve(&run_id_prefix(now))?;
    if !is_run_id(&run_id) {
        return Err(StartError::Port(PortError(format!(
            "the run store made the id `{run_id}`, which is not a run id"
        ))));
    }
    let record = LockRecord {
        owner: owner.clone(),
        run_id: run_id.clone(),
    };
    if let Err(error) = acquire(lock, &record) {
        // The folder is empty, and leaving it would list a run that never existed.
        let _ = store.discard(&run_id);
        return Err(error);
    }
    match begin(prepared, harness, &record, now, store) {
        Ok(run) => Ok(run),
        Err(error) => {
            // The new run's state was not written, so its folder is still empty.
            let _ = store.discard(&run_id);
            lock.release();
            Err(StartError::Port(error))
        }
    }
}

/// The part of [`start`] after the lock is taken.
fn begin(
    prepared: &Prepared,
    harness: &str,
    record: &LockRecord,
    now: u64,
    store: &mut dyn RunStore,
) -> Result<Started, PortError> {
    let run_id = &record.run_id;
    let recovered = recover(store, run_id, now)?;
    let workflow = &prepared.workflow;
    let run = Run {
        run_id: run_id.clone(),
        workflow: workflow.name.clone(),
        harness: harness.to_string(),
        status: RunStatus::Running,
        started_at: whole_second(now),
        finished_at: None,
        exit_code: None,
        stages: workflow
            .stages
            .iter()
            .map(|stage| StageState {
                name: stage.name.clone(),
                status: StageStatus::Pending,
                reported_outputs: Vec::new(),
            })
            .collect(),
        checks: workflow
            .intent
            .accept
            .iter()
            .map(|check| (check.id.clone(), CheckState::Deferred))
            .collect(),
        owner: record.owner.clone(),
    };
    store.write_state(run_id, &run.to_text())?;
    Ok(Started {
        run,
        record: record.clone(),
        recovered,
    })
}

/// Runs each stage of a started run in order and saves the state after each change. `report` is told about each stage
/// when it ends. Returns when the run has `passed` or `halted`. A store error stops the run and is returned; the run
/// then reads as `halted` on the next start, which takes the lock this run gave back.
pub fn execute(
    run: &mut Run,
    prepared: &Prepared,
    harness: &mut dyn Harness,
    clock: &dyn Clock,
    store: &mut dyn RunStore,
    report: &mut dyn FnMut(&StageState),
) -> Result<(), PortError> {
    for (index, stage) in prepared.workflow.stages.iter().enumerate() {
        run.stages[index].status = StageStatus::Running;
        store.write_state(&run.run_id, &run.to_text())?;
        let began = clock.now_ms();
        let outcome = harness.run_session(&Session {
            stage: &stage.name,
            agent: &stage.agent,
            prompt: &prepared.prompts[index],
            time_limit_ms: STAGE_TIME_LIMIT_MS,
        });
        let elapsed = clock.now_ms().saturating_sub(began);
        match judge(&outcome, elapsed) {
            Ok(result) => {
                run.stages[index].status = StageStatus::Passed;
                run.stages[index].reported_outputs = result.outputs;
            }
            Err(reason) => {
                run.halt(index, reason, clock.now_ms());
                store.write_state(&run.run_id, &run.to_text())?;
                report(&run.stages[index]);
                return Ok(());
            }
        }
        store.write_state(&run.run_id, &run.to_text())?;
        report(&run.stages[index]);
    }
    run.pass(clock.now_ms());
    store.write_state(&run.run_id, &run.to_text())
}

/// Whether a session passes its stage. The time limit comes first, then the exit status, then the result line, which is
/// read from the last [`MAX_SESSION_OUTPUT_BYTES`] of the final message.
pub fn judge(outcome: &SessionOutcome, elapsed_ms: u64) -> Result<StageResult, Reason> {
    if outcome.end == SessionEnd::TimedOut || elapsed_ms > STAGE_TIME_LIMIT_MS {
        return Err(Reason::Timeout);
    }
    if outcome.end != SessionEnd::Exited(0) {
        return Err(Reason::SessionFailed);
    }
    parse_result(keep_tail(&outcome.final_message, MAX_SESSION_OUTPUT_BYTES))
}

/// The last `max` bytes of `text` at most, starting on a character boundary.
pub fn keep_tail(text: &str, max: usize) -> &str {
    let mut start = text.len().saturating_sub(max);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}
