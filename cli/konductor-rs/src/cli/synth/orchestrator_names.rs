// SPDX-License-Identifier: Apache-2.0
//
// synth/orchestrator_names.rs -- the three orchestrator agent names. The
// synth e2e tests include this file by path, so they check the same list.

pub const ORCHESTRATOR_NAMES: [&str; 3] = [
    "konductor",
    "konductor-mux-orchestrator",
    "konductor-cmux-orchestrator",
];
