// SPDX-License-Identifier: Apache-2.0
//! The parts of the workflow engine that touch the world. The core crate defines the ports, and this crate
//! implements them. Each step adds only the ports it needs: `WorkflowSource` (step 1c), and `Clock`, `RunStore`,
//! `RunLock` and the `fake` `Harness` (step 1d).

#![forbid(unsafe_code)]

pub mod clock;
pub mod fake_harness;
pub mod file_source;
pub mod harness_choice;
pub mod lookup;
pub mod process;
pub mod run_lock;
pub mod run_store;

pub use clock::{SimulatedClock, SystemClock};
pub use fake_harness::{FakeHarness, Script};
pub use file_source::{FileSource, Skip};
pub use harness_choice::{choose_harness, HarnessChoice, HarnessRefusal, FAKE_SCRIPT_ENV};
pub use lookup::{Found, Located, Lookup, Scope, Skipped};
pub use run_lock::FileRunLock;
pub use run_store::{ensure_runs_ignored, FileRunStore};
