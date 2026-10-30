// SPDX-License-Identifier: Apache-2.0
//! The parts of the workflow engine that touch the world. The core crate defines the ports, and this crate
//! implements them. Each step adds only the ports it needs. This step adds `WorkflowSource`.

#![forbid(unsafe_code)]

pub mod file_source;
pub mod lookup;

pub use file_source::FileSource;
pub use lookup::{Found, Lookup, Scope};
