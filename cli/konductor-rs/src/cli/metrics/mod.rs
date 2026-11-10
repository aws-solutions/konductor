// SPDX-License-Identifier: Apache-2.0
//
// metrics/mod.rs — `konductor metrics`: scans harness session files,
// keeps those whose agent is a Konductor agent (per every install in
// `~/.konductor/installs`), caches one record per file, and reports
// usage in each harness's native unit. Local only; nothing is sent.

mod collect;
