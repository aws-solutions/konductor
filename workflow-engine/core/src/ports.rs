// SPDX-License-Identifier: Apache-2.0
//! The ports the runner reaches the world through. The core defines them and the adapters crate implements them.

use crate::json::{self, Json};
use crate::time::is_run_id;

/// A port that could not do its work, such as a file that could not be written. The text is for a person.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortError(pub String);

/// The time. Tests use a fake one, so no test waits.
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
    /// Replaces the state document of a run as one step, so a reader never sees half of it.
    fn write_state(&mut self, run_id: &str, text: &str) -> Result<(), PortError>;
    /// The state document of a run, or `None` if it has none.
    fn read_state(&self, run_id: &str) -> Result<Option<String>, PortError>;
    /// The ids of every run folder.
    fn list(&self) -> Result<Vec<String>, PortError>;
}

/// The process that owns a run: its PID and its start time, so that a person can tell it from a later process that the
/// system gave the same PID. `started` is opaque. Nothing decides from it whether the owner still runs: the workspace
/// lock does that.
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

/// The record of the workflows the user has confirmed (D14). One entry holds the trust hash the user confirmed for one
/// workflow of one repository.
pub trait TrustStore {
    /// The hash confirmed for workflow `workflow` of the repository `repo`, which is its canonical root. A record that
    /// cannot be read or parsed holds nothing, so this gives `None` for every workflow then.
    fn recorded(&self, repo: &str, workflow: &str) -> Option<String>;
    /// Stores `hash` for the workflow. Two writers at once must not lose an update.
    fn record(&mut self, repo: &str, workflow: &str, hash: &str) -> Result<(), PortError>;
    /// Removes the entry. `Ok(false)` if there was none.
    fn revoke(&mut self, repo: &str, workflow: &str) -> Result<bool, PortError>;
    /// Whether a record could be kept at all. It is checked before the user is asked, so that a yes is never
    /// followed by a failure to keep it.
    fn can_record(&self) -> Result<(), PortError> {
        Ok(())
    }
}

/// The person at the keyboard, if there is one.
pub trait Terminal {
    /// Whether a person can be asked. A run with no terminal must not wait for an answer.
    fn is_available(&self) -> bool;
    /// Shows `summary`, asks `question` and gives `true` only for an explicit yes. Anything else, an empty answer and
    /// the end of the input included, is no.
    fn ask_yes_no(&mut self, summary: &str, question: &str) -> bool;
}

/// A harness that runs agent stages. The tools of an agent are defined differently for each one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Runner {
    KiroCli,
    Claude,
}

impl Runner {
    pub fn as_str(self) -> &'static str {
        match self {
            Runner::KiroCli => "kiro-cli",
            Runner::Claude => "claude",
        }
    }
}

/// Where an agent definition was found: the project root is searched first, then the home folder (spec: "Finding the
/// agent").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    Project,
    Home,
}

impl Placement {
    pub fn as_str(self) -> &'static str {
        match self {
            Placement::Project => "project",
            Placement::Home => "home folder",
        }
    }
}

/// The tools an agent definition lets the runner run without asking. The names are as the definition spells them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentTools {
    /// Kiro: the tools in the agent's own allow list. Claude: the tools in its `tools` key. Both can be empty.
    Listed(Vec<String>),
    /// A Claude definition with no `tools` key. Every tool is available, and the key pre-approves none, because the
    /// runner then passes no `--allowedTools`.
    EveryToolNonePreApproved,
    /// The definition is there but this build cannot say. The text says why.
    Unknown(String),
}

/// One agent definition that a harness would use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentDefinition {
    pub runner: Runner,
    pub placement: Placement,
    pub tools: AgentTools,
    /// Other keys of the definition that can change what runs, such as `hooks` and `mcpServers`, by name. This build
    /// does not read their values, so the summary names them and nothing more.
    pub also_sets: Vec<String>,
}

/// Finds agent definitions the way the harness will, from the project root and then from the home folder.
pub trait AgentCatalog {
    /// The definition of `agent` for each runner harness that has one: at most one for each, the nearest. Empty if
    /// none has. The Kiro definition comes first.
    fn definitions(&self, agent: &str) -> Vec<AgentDefinition>;
}
