// SPDX-License-Identifier: Apache-2.0
//! The workflow file format, its checks, the stage prompt and the runner.
//!
//! This crate does no IO. `tests/purity.rs` fails the build if it reads a file, opens a socket, starts a process,
//! reads the environment, the clock or a random source, or depends on a crate outside its allow list.

#![forbid(unsafe_code)]

pub mod check;
pub mod diagnostic;
pub mod json;
pub mod keys;
pub mod limits;
pub mod model;
pub mod ports;
pub mod prompt;
pub mod reference;
pub mod report;
pub mod result;
pub mod rules;
pub mod run;
pub mod runner;
pub mod source;
pub mod source_map;
pub mod time;
pub mod yaml;

pub use check::{check_text, Checked};
pub use diagnostic::{Code, Diagnostic, Severity};
pub use keys::{Slice, BUILD_SLICE};
pub use model::Workflow;
pub use prompt::{runner_prompt, stage_prompt};
pub use reference::{parse_reference, Reference, ReferenceError};
pub use result::{parse_result, Reason, StageResult};
pub use source::{read_workflow_text, WorkflowSource};
