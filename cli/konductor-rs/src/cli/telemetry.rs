// SPDX-License-Identifier: Apache-2.0
//
// telemetry — usage-analytics telemetry.
//
// `identity` owns `.konductor/telemetry-id.json`; `envelope`
// owns the per-invocation event schema and the real ingestion API's
// outer envelope; `report` owns the `telemetry::report_*`
// call-site API and transport. Re-exported flat from this
// module so callers write `telemetry::report_cli_error(...)`, not
// `telemetry::report::report_cli_error(...)`.

mod envelope;
mod identity;
mod report;

pub(crate) use identity::{ensure_identity, identity_file_exists, identity_path};
pub(crate) use report::{
    report_agent_invocation, report_cli_error, report_cli_error_for_target,
    report_package_installed, report_package_uninstalled, report_package_uninstalled_for_target,
    report_package_version_updated, report_package_version_updated_for_target,
    report_subagent_invocation,
};
