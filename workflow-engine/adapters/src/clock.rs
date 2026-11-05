// SPDX-License-Identifier: Apache-2.0
//! The clocks: the system clock, and a clock the fake harness moves forward to stand for the time a session took.

use std::cell::Cell;
use std::time::{SystemTime, UNIX_EPOCH};

use workflow_core::ports::Clock;

/// The system's wall clock. The runner takes a stage's elapsed time from two readings of its clock, so a clock that is
/// set back or forward during a stage changes it. The fake harness is the only harness so far, and its sessions take
/// simulated time, so step 1f should measure real sessions with a monotonic clock (`std::time::Instant`).
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| {
                u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
            })
    }
}

/// The system clock plus the simulated time the fake harness adds, so a scripted session of 31 minutes ends at once
/// and still reads as 31 minutes to the runner.
#[derive(Debug, Default)]
pub struct SimulatedClock {
    added_ms: Cell<u64>,
}

impl SimulatedClock {
    pub fn advance(&self, ms: u64) {
        self.added_ms.set(self.added_ms.get().saturating_add(ms));
    }
}

impl Clock for SimulatedClock {
    fn now_ms(&self) -> u64 {
        SystemClock.now_ms().saturating_add(self.added_ms.get())
    }
}
