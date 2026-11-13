// SPDX-License-Identifier: Apache-2.0
//! The ports the runner reaches the world through. The core defines them and the adapters crate implements them.

use crate::json::{self, Json};
use crate::time::is_run_id;

/// A port that could not do its work, such as a file that could not be written. The text is for a person.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortError(pub String);

/// The time. Tests use a simulated one, so a session's duration takes no real time.
pub trait Clock {
    /// Milliseconds since the Unix epoch.
    fn now_ms(&self) -> u64;
}

/// One agent session: a fresh headless session per agent stage (D21).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session<'a> {
    pub stage: &'a str,
    pub agent: &'a str,
    pub prompt: &'a str,
    /// How long the session may run. A real harness stops the session when it runs out.
    pub time_limit_ms: u64,
}

/// How a session ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEnd {
    /// The session ended by itself with this exit status.
    Exited(i32),
    /// The harness stopped the session at its time limit.
    TimedOut,
    /// The session could not be started.
    NotStarted,
}

/// What a session gave back: how it ended and its final message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionOutcome {
    pub end: SessionEnd,
    pub final_message: String,
}

/// The program that runs each agent stage, such as Kiro CLI, Claude Code or the fake harness of the tests.
pub trait Harness {
    fn run_session(&mut self, session: &Session) -> SessionOutcome;
}

/// The run state of a workspace: one folder per run, each with one state document.
pub trait RunStore {
    /// Makes a new, empty run folder and gives its id, which starts with `prefix` and matches the run id pattern.
    fn reserve(&mut self, prefix: &str) -> Result<String, PortError>;
    /// Removes a run folder that [`RunStore::reserve`] made and nothing was written to.
    fn discard(&mut self, run_id: &str) -> Result<(), PortError>;
    /// Replaces the state document of a run as one step, so a reader never sees half of it. Only the holder of the
    /// workspace lock calls it, so no other writer is at work in any run folder at the same time.
    fn write_state(&mut self, run_id: &str, text: &str) -> Result<(), PortError>;
    /// The state document of a run, or `None` if it has none.
    fn read_state(&self, run_id: &str) -> Result<Option<String>, PortError>;
    /// The ids of every run folder.
    fn list(&self) -> Result<Vec<String>, PortError>;
}

/// The process that owns a run: its PID and its start time, so that a person can tell it from a later process that the
/// system gave the same PID. The adapters write `started` as a UTC time, `YYYY-MM-DDTHH:MM:SSZ`, and a reader takes it
/// as plain text. Nothing decides from it whether the owner still runs: the workspace lock does that.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Owner {
    pub pid: u32,
    pub started: String,
}

impl Owner {
    pub fn to_json(&self) -> Json {
        let mut object = Json::object();
        object.insert("pid", Json::Number(u64::from(self.pid)));
        object.insert("started", Json::str(&self.started));
        object
    }

    pub fn from_json(value: &Json) -> Option<Owner> {
        let pid = u32::try_from(value.get("pid")?.as_u64()?).ok()?;
        let started = value.get("started")?.as_str()?.to_string();
        Some(Owner { pid, started })
    }
}

/// What the workspace lock holds: who owns the active run, and which run it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockRecord {
    pub owner: Owner,
    pub run_id: String,
}

impl LockRecord {
    /// The text of the lock file. Keys are sorted, and there is no final newline.
    pub fn to_text(&self) -> String {
        let mut object = self.owner.to_json();
        object.insert("run_id", Json::str(&self.run_id));
        object.compact()
    }

    /// The record in a lock file's text, or `None` if the text is not one. The run id must match the run id pattern,
    /// since a message prints it.
    pub fn from_text(text: &str) -> Option<LockRecord> {
        let value = json::parse(text).ok()?;
        let run_id = value.get("run_id")?.as_str()?;
        if !is_run_id(run_id) {
            return None;
        }
        Some(LockRecord {
            owner: Owner::from_json(&value)?,
            run_id: run_id.to_string(),
        })
    }
}

/// The answer to an attempt to take the workspace lock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Claim {
    Acquired,
    /// Another process holds the lock. `Some` is the record it wrote. `None` when the owner is not known: its record
    /// cannot be read, or another start is taking or reading the lock at that moment.
    Held(Option<LockRecord>),
}

/// One active run per workspace, across processes. The lock is held from a claim that gives [`Claim::Acquired`] until
/// [`RunLock::release`], or until the process that holds it ends, however it ends. So while a caller holds it, no
/// other process runs a run in the workspace, and any run whose state still says `running` was abandoned.
pub trait RunLock {
    /// Takes the lock for `record` if no process holds it, and stores `record` for refused starts to read. Two callers
    /// can never both get [`Claim::Acquired`].
    fn try_claim(&mut self, record: &LockRecord) -> Result<Claim, PortError>;
    /// Gives the lock back. Does nothing if this caller does not hold it.
    fn release(&mut self);
}
