// SPDX-License-Identifier: Apache-2.0
//! The run, stage and check states (spec: "Run, stage and check states"), and the state document a run store keeps.
//!
//! The document has the fields of the canvas contract's `Run` schema, which step 1g serves, and four more:
//! `checks` (the state of each check in `intent.accept`), `owner` (the process that runs it), `reported_outputs`
//! (the files each passed stage said it wrote, which are not proof) and `session_group` (the process group of the
//! session that is running, present only while it runs).

use std::collections::BTreeMap;

use crate::json::{self, Json};
use crate::ports::{Owner, ProcessGroup};
use crate::result::Reason;
use crate::time::{format_timestamp, is_run_id, parse_timestamp};

/// The exit code of a run that halted, in this version: a stage was blocked.
pub const HALTED_EXIT_CODE: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunStatus {
    Running,
    Passed,
    Halted,
}

impl RunStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            RunStatus::Running => "running",
            RunStatus::Passed => "passed",
            RunStatus::Halted => "halted",
        }
    }
}

/// A stage's state. Only a blocked stage has a reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StageStatus {
    Pending,
    Running,
    Passed,
    Blocked(Reason),
}

impl StageStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            StageStatus::Pending => "pending",
            StageStatus::Running => "running",
            StageStatus::Passed => "passed",
            StageStatus::Blocked(_) => "blocked",
        }
    }
}

/// `verified`: Konductor ran the check. `deferred`: not checked yet. Slice 1 runs no check, so every check is deferred.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckState {
    Verified,
    Deferred,
}

impl CheckState {
    pub const fn as_str(self) -> &'static str {
        match self {
            CheckState::Verified => "verified",
            CheckState::Deferred => "deferred",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StageState {
    pub name: String,
    pub status: StageStatus,
    /// The paths the stage's result reported. Empty until it passes.
    pub reported_outputs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Run {
    pub run_id: String,
    pub workflow: String,
    pub harness: String,
    pub status: RunStatus,
    /// Milliseconds since the Unix epoch, to the whole second, as the document keeps it.
    pub started_at: u64,
    pub finished_at: Option<u64>,
    pub exit_code: Option<u8>,
    /// In run order.
    pub stages: Vec<StageState>,
    /// The checks of `intent.accept`, by id.
    pub checks: BTreeMap<String, CheckState>,
    pub owner: Owner,
    /// The process group of the session that is running, so that a later run can end it if this owner is killed. Set
    /// while a session runs and cleared by the next state write after it ends, and by [`Run::halt`] and
    /// [`Run::pass`].
    pub session_group: Option<ProcessGroup>,
}

/// A time in milliseconds, cut to the whole second, which is what the state document keeps.
pub fn whole_second(ms: u64) -> u64 {
    ms - ms % 1000
}

impl Run {
    /// Ends the run as `halted` at `now_ms`, with `stage` (an index into `stages`) blocked for `reason`.
    pub fn halt(&mut self, stage: usize, reason: Reason, now_ms: u64) {
        self.stages[stage].status = StageStatus::Blocked(reason);
        self.status = RunStatus::Halted;
        self.finished_at = Some(whole_second(now_ms));
        self.exit_code = Some(HALTED_EXIT_CODE);
        self.session_group = None;
    }

    /// Ends the run as `passed` at `now_ms`.
    pub fn pass(&mut self, now_ms: u64) {
        self.status = RunStatus::Passed;
        self.finished_at = Some(whole_second(now_ms));
        self.exit_code = Some(0);
        self.session_group = None;
    }

    /// The state document. Keys are sorted.
    pub fn to_json(&self) -> Json {
        let mut root = Json::object();
        root.insert("run_id", Json::str(&self.run_id));
        root.insert("workflow", Json::str(&self.workflow));
        root.insert("harness", Json::str(&self.harness));
        root.insert("status", Json::str(self.status.as_str()));
        root.insert("started_at", Json::str(&format_timestamp(self.started_at)));
        root.insert(
            "finished_at",
            self.finished_at
                .map_or(Json::Null, |ms| Json::str(&format_timestamp(ms))),
        );
        root.insert(
            "exit_code",
            self.exit_code
                .map_or(Json::Null, |code| Json::Number(u64::from(code))),
        );
        let order = self.stages.iter().map(|s| Json::str(&s.name)).collect();
        root.insert("order", Json::Array(order));
        let mut stages = Json::object();
        let mut reported = Json::object();
        for stage in &self.stages {
            let mut object = Json::object();
            object.insert("status", Json::str(stage.status.as_str()));
            if let StageStatus::Blocked(reason) = stage.status {
                object.insert("reason", Json::str(reason.as_str()));
            }
            stages.insert(&stage.name, object);
            if !stage.reported_outputs.is_empty() {
                let paths = stage
                    .reported_outputs
                    .iter()
                    .map(|p| Json::str(p))
                    .collect();
                reported.insert(&stage.name, Json::Array(paths));
            }
        }
        root.insert("stages", stages);
        root.insert("reported_outputs", reported);
        let mut checks = Json::object();
        for (id, state) in &self.checks {
            checks.insert(id, Json::str(state.as_str()));
        }
        root.insert("checks", checks);
        root.insert("owner", self.owner.to_json());
        if let Some(group) = &self.session_group {
            root.insert("session_group", group.to_json());
        }
        root
    }

    /// The text a run store keeps: [`Run::to_json`] with a two-space indent and a final newline.
    pub fn to_text(&self) -> String {
        format!("{}\n", self.to_json().pretty())
    }

    /// The run in a state document, or `None` if the text is not one that [`Run::to_text`] could have written.
    pub fn from_text(text: &str) -> Option<Run> {
        let root = json::parse(text).ok()?;
        let run_id = root.get("run_id")?.as_str()?.to_string();
        if !is_run_id(&run_id) {
            return None;
        }
        let status = match root.get("status")?.as_str()? {
            "running" => RunStatus::Running,
            "passed" => RunStatus::Passed,
            "halted" => RunStatus::Halted,
            _ => return None,
        };
        let finished_at = match root.get("finished_at")? {
            Json::Null => None,
            value => Some(parse_timestamp(value.as_str()?)?),
        };
        let exit_code = match root.get("exit_code")? {
            Json::Null => None,
            value => Some(u8::try_from(value.as_u64()?).ok()?),
        };
        let stage_map = root.get("stages")?;
        let reported = root.get("reported_outputs")?;
        let mut stages = Vec::new();
        for name in root.get("order")?.as_array()? {
            let name = name.as_str()?;
            let entry = stage_map.get(name)?;
            let status = match (entry.get("status")?.as_str()?, entry.get("reason")) {
                ("pending", None) => StageStatus::Pending,
                ("running", None) => StageStatus::Running,
                ("passed", None) => StageStatus::Passed,
                ("blocked", Some(reason)) => {
                    StageStatus::Blocked(Reason::from_code(reason.as_str()?)?)
                }
                _ => return None,
            };
            let reported_outputs = match reported.get(name) {
                None => Vec::new(),
                Some(paths) => paths
                    .as_array()?
                    .iter()
                    .map(|p| p.as_str().map(str::to_string))
                    .collect::<Option<Vec<_>>>()?,
            };
            stages.push(StageState {
                name: name.to_string(),
                status,
                reported_outputs,
            });
        }
        let mut checks = BTreeMap::new();
        let Json::Object(check_map) = root.get("checks")? else {
            return None;
        };
        for (id, state) in check_map {
            let state = match state.as_str()? {
                "verified" => CheckState::Verified,
                "deferred" => CheckState::Deferred,
                _ => return None,
            };
            checks.insert(id.clone(), state);
        }
        Some(Run {
            run_id,
            workflow: root.get("workflow")?.as_str()?.to_string(),
            harness: root.get("harness")?.as_str()?.to_string(),
            status,
            started_at: parse_timestamp(root.get("started_at")?.as_str()?)?,
            finished_at,
            exit_code,
            stages,
            checks,
            owner: Owner::from_json(root.get("owner")?)?,
            // A document from before step 1f-1 has no record. A record that cannot be read counts as none, so a damaged
            // one never keeps its run from being ended.
            session_group: root.get("session_group").and_then(ProcessGroup::from_json),
        })
    }
}
