// SPDX-License-Identifier: Apache-2.0
//
// konductor-telemetry — shared identity and transport-safety primitives
// for cli/konductor-rs's and mcp/lib/skill-lookup-core's telemetry
// reporting. Two modules mirroring the one thing this crate exists for
// (sending a telemetry event safely):
//   - `identity`: the machine-scoped instance record
//     (`$HOME/.konductor/telemetry.json`), the nil-UUID sentinel, and
//     UUID-shape validation.
//   - `net`: host-allowlist DNS classification, DNS-rebinding pin
//     construction, and the timeout-vs-failure resolution decision.
//
// Re-exported at the crate root so both existing call sites'
// submodule-qualified paths (`konductor_telemetry::X` for an identity
// symbol, `konductor_telemetry::Y` for a net symbol) work without a
// `identity::`/`net::` qualifier.

pub mod identity;
pub mod net;

pub use identity::*;
pub use net::*;
