// SPDX-License-Identifier: Apache-2.0
//! The parts of the workflow engine that touch the world. The core crate defines the ports, and this crate
//! implements them. Each step adds only the ports it needs: `WorkflowSource` (step 1c), and `Clock`, `RunStore`,
//! `RunLock` and the `fake` `Harness` (step 1d), and `TrustStore`, `Terminal` and `AgentCatalog` (step 1e).

#![forbid(unsafe_code)]

pub mod agent_catalog;
pub mod clock;
pub mod fake_harness;
pub mod file_source;
pub mod harness_choice;
pub mod lookup;
pub mod process;
pub mod repo_config;
pub mod run_lock;
pub mod run_store;
pub mod terminal;
pub mod trust_store;

pub use agent_catalog::FileAgentCatalog;
pub use clock::{SimulatedClock, SystemClock};
pub use fake_harness::{FakeHarness, Script};
pub use file_source::{FileSource, Skip};
pub use harness_choice::{choose_harness, HarnessChoice, HarnessRefusal, FAKE_SCRIPT_ENV};
pub use lookup::{Found, Located, Lookup, Scope, Skipped};
pub use repo_config::{config_folders, scan as scan_repo_config, InstalledFiles};
pub use run_lock::FileRunLock;
pub use run_store::{ensure_runs_ignored, FileRunStore};
pub use terminal::StdTerminal;
pub use trust_store::FileTrustStore;
