// SPDX-License-Identifier: Apache-2.0
//! Who this process is: its PID and its start time, which go into the lock record and the run state so that a person
//! can tell it from a later process with the same PID. Whether an owner still runs is decided by the workspace lock,
//! not here.
//!
//! The start time is the system clock's UTC time, to the second, when the process first asks for its owner, as
//! `YYYY-MM-DDTHH:MM:SSZ`. `flow run` asks just before it takes the lock. The time is read once and kept, so every
//! record the process writes carries the same one. It says nothing about the machine, so a record is safe to show.

use std::sync::OnceLock;

use workflow_core::ports::{Clock, Owner};
use workflow_core::time::format_timestamp;

use crate::clock::SystemClock;

/// The current process as a run owner.
pub fn current_owner() -> Owner {
    static STARTED: OnceLock<String> = OnceLock::new();
    let started = STARTED.get_or_init(|| format_timestamp(SystemClock.now_ms()));
    Owner {
        pid: std::process::id(),
        started: started.clone(),
    }
}
