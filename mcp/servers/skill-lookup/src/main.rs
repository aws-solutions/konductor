// SPDX-License-Identifier: Apache-2.0
//
// main.rs — skill-lookup-mcp: a stdio MCP (Model Context Protocol) server.
//
// This binary parses and validates `--skills-dir` (repeatable), scans
// every configured directory into an in-memory skill index, answers the
// MCP `initialize` handshake over stdio, and exposes three tools on top
// of the `SkillIndex` built here: `find_skills`, `get_skill`, and
// `reload_skills`.
//
// The reusable scanning/index/frontmatter core (`index`, `model`,
// `frontmatter`, `scanner`) lives in the `skill_lookup_core` library
// crate (`mcp/lib/skill-lookup-core`), not in this binary. What stays
// here is server-specific, split across two modules by concern:
//   - `cli`: `--skills-dir`/`--skill-name-filter`/`--agent-sop-paths`/
//     `--agent-sop-filter` argument parsing, this server's on-disk path
//     conventions (`~/.konductor/skills/` and friends), and directory
//     validation.
//   - `handlers`: MCP protocol wiring, tool registration, the three
//     skill tools, the `prompts/list`/`prompts/get` prompt handlers,
//     and their argument validation.
//   - `sops`: agent-SOP scanning and the in-memory SOP index the prompt
//     handlers serve from.
// This file is just the wiring between them: parse args, resolve and
// scan the configured skill and SOP directories, build both indexes,
// and serve them over stdio until the client disconnects.
mod cli;
mod handlers;
mod sops;

use clap::Parser;
use cli::Cli;
use handlers::SkillLookupServer;
use rmcp::ServiceExt;
use skill_lookup_core::index::SkillIndex;
use skill_lookup_core::logging::{self, Level};
use sops::SopIndex;

/// Ceiling on the `SKILL.md` body `get_skill` will hand back in one
/// response. Reuses `frontmatter::MAX_SKILL_FILE_BYTES` — the scan-time
/// and handler-time caps are one policy, not two coincidentally-equal
/// constants that could drift apart.
use skill_lookup_core::frontmatter::MAX_SKILL_FILE_BYTES as MAX_SKILL_BODY_BYTES;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    // Runs 7-day log retention "before writing its first entry" (§4.9),
    // ahead of every other line in this function.
    logging::init();

    let cli = Cli::parse();

    let resolved = cli::resolve_skills_dirs(&cli.skills_dir);
    for (level, message) in &resolved.messages {
        logging::log(*level, message);
    }

    let skills_dir_paths: Vec<std::path::PathBuf> =
        resolved.valid.iter().map(|d| d.path.clone()).collect();
    let (index, diagnostic, filtered_out, excluded_names) =
        SkillIndex::build(resolved.valid, cli.skill_name_filter.clone());
    diagnostic.emit_to_stderr(filtered_out);
    if filtered_out > 0 {
        logging::log(
            Level::Info,
            &format!("--skill-name-filter excluded {filtered_out} skill(s) from the index"),
        );
        logging::log_filter_exclusions(&cli.skill_name_filter, &excluded_names);
    }

    // Resolve and scan the agent-SOP directories the same way skills are
    // resolved and scanned, then surface every SOP diagnostic to stderr —
    // the same "no silent drop" channel the skill scan uses — and persist
    // each one via `logging::log_file_only_lines`, mirroring
    // `ScanDiagnostic::emit_to_stderr`'s own eprintln!-plus-persist pairing
    // (model.rs) so a SOP diagnostic reaches the durable log the same way
    // a skill-scan diagnostic does, instead of being lost once stderr is
    // gone. All of `resolved_sops.messages` and `sop_messages` are
    // skip/exclusion/error diagnostics (invalid `--agent-sop-paths`
    // entries, symlink/dangling/non-regular exclusions, entry-cap
    // truncation), matching the severity `emit_to_stderr` logs its own
    // analogous skip messages at.
    let resolved_sops = cli::resolve_agent_sop_paths(&cli.agent_sop_paths);
    for message in &resolved_sops.messages {
        eprintln!("skill-lookup-mcp: {message}");
    }
    logging::log_file_only_lines(Level::Warn, &resolved_sops.messages);
    let (sops, sop_messages) = SopIndex::build(&resolved_sops.valid, &cli.agent_sop_filter);
    for message in &sop_messages {
        eprintln!("skill-lookup-mcp: {message}");
    }
    logging::log_file_only_lines(Level::Warn, &sop_messages);
    // Distinct phrasing from the skill scan's "scan complete" summary so
    // the two are greppable apart — operators (and the reload-diagnostic
    // stderr tests) key on the skill line's exact wording.
    let sop_summary = format!(
        "SOP index built — {} prompt(s) available",
        sops.list().len()
    );
    eprintln!("skill-lookup-mcp: {sop_summary}");
    logging::log_file_only(Level::Info, &sop_summary);

    // Telemetry (design doc D.5/D.8): resolve the cached identity once,
    // before the flush task is spawned -- never per flush. Structural
    // opt-out: `--telemetry off` OR the fleet-wide `KONDUCTOR_TELEMETRY=off`
    // env var (published §Telemetry section's own "Opt-out" row) means
    // `tool_call_counters` stays `None` and the flush task is never
    // started at all, matching D.8's "omitted, not invoked-then-checked"
    // principle -- checked alongside the CLI flag here, not only inside
    // `resolve_endpoint`'s own later, per-flush check.
    let tool_call_counters = match cli.telemetry {
        cli::TelemetryMode::On if skill_lookup_core::telemetry::fleet_opted_out() => None,
        cli::TelemetryMode::On => {
            skill_lookup_core::telemetry::init_identity(&skills_dir_paths);
            let counters: skill_lookup_core::telemetry::ToolCallCounters =
                std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
            let flush_counters = counters.clone();
            // Decision (§6/§7 task 11, closed for this revision): a
            // fixed 60-second flush interval, batched one event PER
            // accumulated `(tool_name, skill_name, errorCode)` key per
            // cycle (see `report_mcp_tool_call`'s own `count` field) --
            // not per individual call. Chosen over a shorter interval
            // or per-call reporting because `skill-lookup-mcp` is a
            // long-lived process serving many calls per session; a
            // per-call report would multiply outbound spawns by call
            // volume for no attribution benefit this design needs (D.5
            // already only requires tool/skill/error attribution, not
            // per-call timing), while 60s keeps the accumulated-count
            // cardinality bounded and the reporting overhead
            // proportional to distinct KEYS touched, not calls made.
            // Not re-litigated as an open item elsewhere in this
            // module -- this comment IS the decision record for it.
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    skill_lookup_core::telemetry::flush_once(&flush_counters).await;
                }
            });
            Some(counters)
        }
        cli::TelemetryMode::Off => None,
    };
    let shutdown_counters = tool_call_counters.clone();

    let server = SkillLookupServer {
        index,
        sops,
        tool_call_counters,
    };
    let service = match server.serve(rmcp::transport::stdio()).await {
        Ok(service) => service,
        Err(e) => {
            logging::log(Level::Error, &format!("failed to start stdio server: {e}"));
            return std::process::ExitCode::FAILURE;
        }
    };

    // Wait for the client to close the connection (e.g. stdin EOF), then
    // exit cleanly. Tool and prompt requests are dispatched by `rmcp`
    // through the `ServerHandler` impl in `handlers.rs` while the session
    // is live; there's nothing else to drive from here.
    //
    // `.waiting()`'s `Err(e)` covers three distinct cases, not just a
    // handler panic: malformed JSON on stdin, the peer disconnecting
    // before sending `notifications/initialized`, and an actual handler
    // panic all surface as the same `Err` variant. The wording below
    // doesn't call this a "panic," since the first two are ordinary
    // protocol violations, not crashes — `{e}`'s message still carries
    // the specific cause.
    match service.waiting().await {
        Ok(_quit_reason) => {
            // Telemetry (design doc D.5): flush any counts accumulated
            // in the last (partial) window -- the periodic flush task
            // above only fires every 60s, so a clean exit between ticks
            // would otherwise silently drop up to a minute of counts.
            if let Some(counters) = shutdown_counters {
                skill_lookup_core::telemetry::flush_once(&counters).await;
            }
            std::process::ExitCode::SUCCESS
        }
        Err(e) => {
            // Telemetry (design doc D.5): flush any counts accumulated
            // in the last (partial) window here too -- this branch
            // covers ordinary protocol events (malformed stdin JSON,
            // the peer disconnecting before
            // `notifications/initialized`), not just a handler panic
            // (see the comment above `service.waiting().await` for
            // why), so it is reached often enough in practice that
            // skipping the flush here would silently and routinely
            // drop telemetry the `Ok` branch above already takes care
            // to flush.
            if let Some(counters) = shutdown_counters {
                skill_lookup_core::telemetry::flush_once(&counters).await;
            }
            logging::log(
                Level::Error,
                &format!("server session ended with an error: {e}"),
            );
            std::process::ExitCode::FAILURE
        }
    }
}
