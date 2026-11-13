// SPDX-License-Identifier: Apache-2.0
//! The `fake` harness, for tests only. It runs no agent: it replays a scripted reply for each stage from a JSON file.
//!
//! The script is an object with one key, `stages`, that maps a stage name to an entry:
//!
//! ```json
//! {"stages": {"plan": {"reply": "...", "exit_status": 0, "duration_ms": 1000}}}
//! ```
//!
//! - `reply` (required) is the session's final message.
//! - `exit_status` (default 0) is the session's exit status, 0 to 255.
//! - `duration_ms` (default 0) is how long the session takes. The fake moves the [`SimulatedClock`] forward by it, so
//!   no one waits. A duration past the session's time limit stands for a session that hangs: the fake stops it at the
//!   limit, as a real harness would, and reports that it timed out.
//! - `wait_for` (optional) is a path the fake reads to its end before it replies. A test points it at a named pipe to
//!   hold a session open until the test writes to the pipe. The fake waits at most the session's time limit, in real
//!   time, and then reports that the session timed out, so a pipe that no one writes to cannot hold a run forever.
//!
//! A stage with no entry is a session that could not start.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use workflow_core::json::{self, Json};
use workflow_core::ports::{Harness, Session, SessionEnd, SessionOutcome};

use crate::clock::SimulatedClock;
use crate::run_store::read_regular;

/// A script bigger than this is refused. It is larger than the 1 MiB the runner keeps, so a test can send more.
pub const MAX_SCRIPT_BYTES: u64 = 16 * 1024 * 1024;

/// One scripted session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub reply: String,
    pub exit_status: i32,
    pub duration_ms: u64,
    pub wait_for: Option<PathBuf>,
}

/// The scripted sessions, by stage name.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Script {
    pub stages: BTreeMap<String, Entry>,
}

impl Script {
    /// Reads a script file. The error says what is wrong with it. A link is not followed, and anything but a regular
    /// file is refused, so a pipe cannot hold the run before it starts.
    pub fn load(path: &Path) -> Result<Script, String> {
        let shown = path.display();
        let text = read_regular(path, MAX_SCRIPT_BYTES)
            .map_err(|error| error.0)?
            .ok_or_else(|| format!("cannot read {shown}: there is no such file"))?;
        Script::parse(&text).map_err(|why| format!("{shown}: {why}"))
    }

    /// Reads the text of a script.
    pub fn parse(text: &str) -> Result<Script, String> {
        let root = json::parse(text).map_err(|_| "is not valid JSON".to_string())?;
        let Json::Object(top) = &root else {
            return Err("must be a JSON object".to_string());
        };
        if let Some(key) = top.keys().find(|k| *k != "stages") {
            return Err(format!("has an unknown key `{key}`"));
        }
        let Some(Json::Object(stages)) = root.get("stages") else {
            return Err("must have `stages`, an object of stage names".to_string());
        };
        let mut script = Script::default();
        for (name, entry) in stages {
            let entry = parse_entry(entry).map_err(|why| format!("stage `{name}` {why}"))?;
            script.stages.insert(name.clone(), entry);
        }
        Ok(script)
    }
}

fn parse_entry(value: &Json) -> Result<Entry, String> {
    let Json::Object(map) = value else {
        return Err("must be an object".to_string());
    };
    let known = ["reply", "exit_status", "duration_ms", "wait_for"];
    if let Some(key) = map.keys().find(|k| !known.contains(&k.as_str())) {
        return Err(format!("has an unknown key `{key}`"));
    }
    let reply = value
        .get("reply")
        .and_then(Json::as_str)
        .ok_or("needs `reply`, a string")?
        .to_string();
    let exit_status = match value.get("exit_status") {
        None => 0,
        Some(status) => status
            .as_u64()
            .filter(|n| *n <= 255)
            .ok_or("has an `exit_status` that is not a number from 0 to 255")?
            as i32,
    };
    let duration_ms = match value.get("duration_ms") {
        None => 0,
        Some(ms) => ms
            .as_u64()
            .ok_or("has a `duration_ms` that is not a whole number")?,
    };
    let wait_for = match value.get("wait_for") {
        None => None,
        Some(path) => Some(PathBuf::from(
            path.as_str()
                .ok_or("has a `wait_for` that is not a string")?,
        )),
    };
    Ok(Entry {
        reply,
        exit_status,
        duration_ms,
        wait_for,
    })
}

/// The fake harness. It shares the [`SimulatedClock`] with the runner.
#[derive(Debug)]
pub struct FakeHarness {
    script: Script,
    clock: Rc<SimulatedClock>,
}

impl FakeHarness {
    pub fn new(script: Script, clock: Rc<SimulatedClock>) -> FakeHarness {
        FakeHarness { script, clock }
    }
}

impl Harness for FakeHarness {
    fn run_session(&mut self, session: &Session) -> SessionOutcome {
        let Some(entry) = self.script.stages.get(session.stage) else {
            return SessionOutcome {
                end: SessionEnd::NotStarted,
                final_message: String::new(),
            };
        };
        if let Some(path) = &entry.wait_for {
            match wait_for(path, session.time_limit_ms) {
                Waited::Read => {}
                Waited::Failed => {
                    return SessionOutcome {
                        end: SessionEnd::NotStarted,
                        final_message: String::new(),
                    };
                }
                Waited::OutOfTime => {
                    self.clock.advance(session.time_limit_ms);
                    return SessionOutcome {
                        end: SessionEnd::TimedOut,
                        final_message: String::new(),
                    };
                }
            }
        }
        if entry.duration_ms > session.time_limit_ms {
            self.clock.advance(session.time_limit_ms);
            return SessionOutcome {
                end: SessionEnd::TimedOut,
                final_message: String::new(),
            };
        }
        self.clock.advance(entry.duration_ms);
        SessionOutcome {
            end: SessionEnd::Exited(entry.exit_status),
            final_message: entry.reply.clone(),
        }
    }
}

/// How a wait on a `wait_for` path ended.
enum Waited {
    Read,
    Failed,
    OutOfTime,
}

/// Reads `path` to its end, for at most `limit_ms` of real time. The read runs on its own thread, because opening a
/// pipe blocks until a writer opens it. A thread still reading at the limit is left behind and ends with the process.
fn wait_for(path: &Path, limit_ms: u64) -> Waited {
    let (sender, receiver) = mpsc::channel();
    let path = path.to_path_buf();
    let spawned = std::thread::Builder::new()
        .name("fake-wait-for".to_string())
        .spawn(move || {
            let read = std::fs::File::open(&path)
                .and_then(|mut file| std::io::copy(&mut file, &mut std::io::sink()));
            let _ = sender.send(read.is_ok());
        });
    if spawned.is_err() {
        return Waited::Failed;
    }
    match receiver.recv_timeout(Duration::from_millis(limit_ms)) {
        Ok(true) => Waited::Read,
        Ok(false) | Err(RecvTimeoutError::Disconnected) => Waited::Failed,
        Err(RecvTimeoutError::Timeout) => Waited::OutOfTime,
    }
}
