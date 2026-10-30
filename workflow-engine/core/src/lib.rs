// SPDX-License-Identifier: Apache-2.0
//! The workflow file format and its checks.
//!
//! This crate does no IO. `tests/purity.rs` fails the build if it reads a file, opens a socket, starts a process,
//! reads the environment, the clock or a random source, or depends on a crate outside its allow list.

#![forbid(unsafe_code)]
