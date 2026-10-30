// SPDX-License-Identifier: Apache-2.0
//! The workflow file format and its checks.
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
pub mod reference;
pub mod report;
pub mod rules;
pub mod source;
pub mod source_map;
pub mod yaml;

pub use check::{check_text, Checked};
pub use diagnostic::{Code, Diagnostic, Severity};
pub use keys::{Slice, BUILD_SLICE};
pub use model::Workflow;
pub use reference::{parse_reference, Reference, ReferenceError};
pub use source::{read_workflow_text, WorkflowSource};
