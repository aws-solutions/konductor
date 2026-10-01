// SPDX-License-Identifier: Apache-2.0
//
// telemetry — usage-analytics telemetry.
//
// identity: legacy per-project telemetry-id.json, no longer read for
// reporting; uninstall still removes it. instance: machine-scoped
// $HOME/.konductor/telemetry.json. install_info: per-target
// install-info.json, the per-install record and opt-in signal.
// envelope: event schema. report: report_* call-site API, transport,
// consent gating.

mod envelope;
mod identity;
mod install_info;
mod instance;
mod report;

// `doctor`'s telemetry-state check and `update`'s opt-out carry-forward
// both gate on `install_info::read_install_info_detailed`, which says
// why a read failed (absent vs. broken) so each can warn on a broken
// record without mistaking it for a genuine opt-out. `report_*` gates
// on the plain `read_install_info` instead. `install_info_exists` is
// re-exported here `#[cfg(test)]`-only, for `update.rs`'s tests.
#[allow(unused_imports)]
pub(crate) use identity::{ensure_identity, identity_path};
#[cfg(test)]
pub(crate) use install_info::install_info_exists;
pub(crate) use install_info::{
    agent_version_from_source, install_info_path, read_and_maybe_remove_locked, read_install_info,
    read_install_info_detailed, remove_install_info, write_install_info, InstallInfoAbsence,
};
pub(crate) use report::{
    report_agent_invocation, report_cli_error, report_cli_error_for_target,
    report_package_installed, report_package_uninstalled, report_package_uninstalled_for_target,
    report_package_version_updated, report_package_version_updated_for_target,
    report_subagent_invocation,
};
