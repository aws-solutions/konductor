// SPDX-License-Identifier: Apache-2.0
//! The parts of the workflow engine that touch the world. The core crate defines the ports, and this crate
//! implements them. Each step adds only the ports it needs: `WorkflowSource` (step 1c), and `Clock`, `RunStore`,
//! `RunLock` and the `fake` `Harness` (step 1d), `TrustStore`, `Terminal` and `AgentCatalog` (step 1e), and
//! `ProcessLauncher` and the `kiro-cli` `Harness` (step 1f-1), the `claude` `Harness` (step 1f-2), and the ACP
//! `Harness` for Kiro CLI and Claude Code (step 1f-3).

#![forbid(unsafe_code)]

pub mod acp_client;
pub mod acp_frames;
pub mod acp_harness;
pub mod acp_permission;
pub mod acp_process;
pub mod agent_catalog;
pub mod claude_harness;
pub mod clock;
pub mod fake_harness;
pub mod file_source;
pub mod harness_choice;
pub mod kiro_harness;
pub mod launcher;
pub mod lookup;
pub mod process;
pub mod repo_config;
pub mod run_lock;
pub mod run_store;
pub mod terminal;
pub mod trust_store;

pub use acp_client::{converse, Adapter, Ending, Incoming, Outcome, Plan, Wire};
pub use acp_frames::{FrameError, Frames, MAX_FRAME_BYTES};
pub use acp_harness::{kiro_acp_args, AcpHarness, AcpKind};
pub use acp_permission::{decide, Decision, Request};
pub use acp_process::AcpProcess;
pub use agent_catalog::{kiro_engine, FileAgentCatalog, KiroAgent, KiroEngine};
pub use claude_harness::{
    claude_args, is_rule_name, read_reply, tool_rules, ClaudeHarness, Reply, ToolRules,
};
pub use clock::{SimulatedClock, SystemClock};
pub use fake_harness::{FakeHarness, Script};
pub use file_source::{FileSource, Skip};
pub use harness_choice::{
    choose_harness, choose_view_harness, resolve_harness, HarnessChoice, HarnessRefusal,
    InstalledRunners, FAKE_SCRIPT_ENV,
};
pub use kiro_harness::{kiro_args, KiroHarness};
pub use launcher::{SystemLauncher, TimeoutFlavor, NO_TIMEOUT_WARNING};
pub use lookup::{Found, Located, Lookup, Scope, Skipped};
pub use repo_config::{config_folders, scan as scan_repo_config, InstalledFiles};
pub use run_lock::FileRunLock;
pub use run_store::{ensure_runs_ignored, FileRunStore};
pub use terminal::StdTerminal;
pub use trust_store::FileTrustStore;
