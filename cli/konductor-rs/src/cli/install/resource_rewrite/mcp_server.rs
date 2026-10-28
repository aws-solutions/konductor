// SPDX-License-Identifier: Apache-2.0
//
// install/resource_rewrite/mcp_server.rs — the `konductor-skills` MCP
// server injection pass, shared by Kiro CLI V2 (`McpServerPass`) and
// V3/KAS (`McpServerPassV3`). Both write the same `mcpServers` entry
// and CLI args; they differ only in how they authorize the agent to
// reach it once injected -- V2 via `tools`/`allowedTools`, V3 via a
// `tools` visibility tag plus a `permissions.rules[]` entry.

use std::path::Path;

use super::{push_unique_str, ResourceRewritePass, RewriteContext};

// ── Pass 3: MCP server injection ─────────────────────────────────────────

/// Name of the `mcpServers` entry this pass manages, and the binary it
/// launches. A single fixed pair for now; a second MCP server would
/// need a real lookup instead of a constant pair. `pub(in crate::
/// cli::install)`, not `pub(super)`: a `pub(super) use` re-export
/// cannot exceed the visibility of the item it re-exports, so `mod.rs`
/// re-exporting this one module level deeper needs the reach stated
/// explicitly. Also read by `kiro_cli.rs`, which checks for this exact
/// key in an agent's mutated JSON to decide whether the V2 grant
/// actually landed for that agent this run (see the "V3/Claude Code
/// permission grant" section below for why that decision matters).
pub(in crate::cli::install) const MCP_SERVER_NAME: &str = "konductor-skills";
/// `pub(in crate::cli::install)`, not `pub(super)`, for the same
/// re-export-visibility reason as `MCP_SERVER_NAME` above. Also read
/// by `kiro_cli.rs`'s `plan_claude_settings_grant` to predict, at plan
/// time, whether this run will install the binary this grant is gated
/// on -- kept as one shared constant so the prediction can never name
/// a different binary than the real `McpServerPass::rewrite` check
/// below does.
pub(in crate::cli::install) const MCP_SERVER_BINARY_NAME: &str = "skill-lookup-mcp";
/// CLI args for the injected entry: one `--skills-dir` for the
/// user-level root (`~/.konductor/skills`) and one for the
/// project-local root (`.konductor/skills`, resolved by the launched
/// process's own cwd) -- so the same absolute binary path still
/// discovers whichever project's skills the agent is run from.
const MCP_SERVER_ARGS: &[&str] = &[
    "--skills-dir",
    "~/.konductor/skills",
    "--skills-dir",
    ".konductor/skills",
];

/// `--agent-sop-paths` values appended (each preceded by its own
/// `--agent-sop-paths` flag, since the flag is repeatable -- see
/// `skill-lookup-mcp`'s own `Cli::agent_sop_paths`) when the current
/// agent has a non-empty `RewriteContext::agent_sop_names` entry.
/// Mirrors `MCP_SERVER_ARGS`'s own user-level + project-local pair
/// exactly: the launched process resolves `~`/the relative path itself,
/// so these are the same two literal strings, one directory segment
/// later (`sops` instead of `skills`).
const MCP_SERVER_SOP_PATHS: &[&str] = &["~/.konductor/sops", ".konductor/sops"];

/// The `tools` grant for the server as a whole, and the
/// `allowedTools` grants for its three tools. Specs never declare
/// either directly -- both are injected here alongside `mcpServers`,
/// so a spec can never advertise a grant for a server it doesn't have
/// wired up. Declaring them in the spec instead would let a downstream
/// agent that `includes` such a spec inherit the grants with no server
/// of its own, since AIM union-merges `tools`/`allowedTools` across
/// `includes`.
const MCP_SERVER_TOOLS_GRANT: &str = "@konductor-skills";
/// `pub(super)`, not private: `claude_settings.rs`, a sibling submodule
/// of this one, calls `claude_mcp_permission_grants()` for these
/// values, and Rust module privacy reaches descendants of the
/// declaring module but not sibling modules, so a plain private item
/// here isn't visible there.
pub(super) const MCP_SERVER_ALLOWED_TOOLS_GRANTS: &[&str] = &[
    "@konductor-skills/find_skills",
    "@konductor-skills/get_skill",
    "@konductor-skills/reload_skills",
];

/// Injects an absolute-path `mcpServers.konductor-skills` entry
/// launching the just-installed binary, but only when `ctx.bin_files`
/// shows this run actually copied it, and only for an agent that
/// already carries a rewritten packaged-skill resource (see
/// `matches`). `matches` re-derives the skill-resource shape rather
/// than taking a boolean from the caller, which is how the ordering
/// dependency on `SkillResourcePass` is expressed in code: if that
/// pass were removed or reordered, this one would just see no match
/// and skip, rather than reading a stale flag.
pub(in crate::cli::install) struct McpServerPass;

/// Whether `value`'s own agent name (its top-level `name` field) has a
/// non-empty entry in `ctx.agent_sop_names`. Shared between `matches`
/// (an agent with SOPs but no skill resources still needs the MCP
/// server) and `rewrite` (the same lookup decides whether to append
/// `--agent-sop-paths`/`--agent-sop-filter`), so the two can never
/// disagree about which agents this field applies to.
fn agent_has_sop_names(value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
    value
        .get("name")
        .and_then(|n| n.as_str())
        .and_then(|agent_name| ctx.agent_sop_names.get(agent_name))
        .is_some_and(|names| !names.is_empty())
}

/// Whether `value`'s own agent name (its top-level `name` field) has a
/// non-empty entry in `ctx.agent_skill_names`. Mirrors `agent_has_sop_
/// names` exactly. Shared between `matches` (an agent with skill-name
/// scoping but no `skill://` resource still needs the MCP server) and
/// `rewrite` (the same lookup decides whether to append
/// `--skill-name-filter`), so the two can never disagree about which
/// agents this field applies to.
fn agent_has_skill_names(value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
    value
        .get("name")
        .and_then(|n| n.as_str())
        .and_then(|agent_name| ctx.agent_skill_names.get(agent_name))
        .is_some_and(|names| !names.is_empty())
}

/// Whether `value` (by its own resources) or its own agent's SOP/skill-
/// name scoping in `ctx` triggers the `konductor-skills` MCP server
/// grant -- shared verbatim by both `McpServerPass` (V2) and
/// `McpServerPassV3` below, so the two engines can never disagree about
/// which agents this grant applies to.
fn agent_needs_mcp_server(value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
    // A bare starts_with("skill://") && ends_with("/SKILL.md") also
    // matches the ws-* workspace-skills glob, which SkillResourcePass
    // never touches. Excluding any entry containing '*' rejects the
    // glob while still accepting both the pre-rewrite
    // (skill://skills/<name>/SKILL.md) and post-rewrite
    // (skill://<skills_dir>/<name>/SKILL.md) forms.
    //
    // The post-rewrite form is built via `Path::display()`, which uses
    // `\` on non-Unix targets, so a bare ends_with("/SKILL.md") would
    // reject it there. Matching on the last path segment (either
    // separator) instead keeps the check working regardless of
    // platform.
    let has_skill_resource = value
        .get("resources")
        .and_then(|r| r.as_array())
        .is_some_and(|resources| {
            resources.iter().any(|entry| {
                entry.as_str().is_some_and(|text| {
                    text.starts_with("skill://")
                        && text
                            .rsplit(['/', '\\'])
                            .next()
                            .is_some_and(|last_segment| last_segment == "SKILL.md")
                        && !text.contains('*')
                })
            })
        });
    // Widened for SOP-only or skill-name-only agents (declares
    // `dependencies.agentSops.agentSopNames` and/or `dependencies.
    // skills.skillNames` but no `skill://` resource at all): without
    // this, such an agent would never even reach `rewrite`, so it
    // could never get the `--agent-sop-paths`/`--agent-sop-filter`
    // pair or the `--skill-name-filter` flag this pass injects (see
    // `agent_has_sop_names`/`agent_has_skill_names`'s own doc
    // comments).
    has_skill_resource || agent_has_sop_names(value, ctx) || agent_has_skill_names(value, ctx)
}

/// Whether THIS run actually installed the `konductor-skills` MCP server
/// binary, per `ctx.bin_files` -- shared by both `McpServerPass` and
/// `McpServerPassV3`'s `rewrite`. Matches the exact manifest path
/// `install_bin_files` produces for this binary -- built the same way,
/// so it can't drift.
fn mcp_server_binary_installed(ctx: &RewriteContext<'_>) -> bool {
    binary_in_bin_files(ctx.bin_files)
}

fn binary_in_bin_files(bin_files: &[super::super::manifest::ManifestFile]) -> bool {
    let expected_path = super::super::kiro_cli::content_manifest_path(
        super::super::kiro_cli::KONDUCTOR_DESTINATION_ROOT,
        super::super::mcp_server::BIN_CONTENT_TYPE_DIR,
        MCP_SERVER_BINARY_NAME,
    );
    bin_files.iter().any(|file| file.path == expected_path)
}

/// Generous for a `--help` run, but bounded so a binary that hangs
/// cannot stall the install.
const HELP_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Whether the `skill-lookup-mcp` this run copied into `bin_dir` accepts
/// `--install-info`. Released binaries through v1.2.0 reject the unknown
/// flag and exit at startup, and the binary comes from the content being
/// installed (an older `--version`, or a stale `--from` build), so its
/// `--help` is checked rather than assumed. Called once per
/// `install_agents` run. A binary this run did not copy counts as
/// unsupported. One that was copied but could not be probed counts as
/// unsupported too, with a warning naming the fallback args, since
/// `no_telemetry` decides what those are.
pub(in crate::cli::install) fn installed_server_supports_install_info(
    bin_dir: &Path,
    bin_files: &[super::super::manifest::ManifestFile],
    no_telemetry: bool,
) -> bool {
    if !binary_in_bin_files(bin_files) {
        return false;
    }
    let binary = bin_dir.join(MCP_SERVER_BINARY_NAME);
    match probe_install_info(&binary, HELP_PROBE_TIMEOUT) {
        InstallInfoProbe::Supported => true,
        InstallInfoProbe::Unsupported => false,
        InstallInfoProbe::Failed => {
            eprintln!("{}", probe_failed_warning(&binary, no_telemetry));
            false
        }
    }
}

/// What `--help` said about `--install-info`. `Failed` covers a binary
/// that could not be spawned, timed out, or produced no output, so it is
/// never mistaken for an older binary that lacks the flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InstallInfoProbe {
    Supported,
    Unsupported,
    Failed,
}

fn probe_install_info(binary: &Path, timeout: std::time::Duration) -> InstallInfoProbe {
    use std::io::Read;

    let Ok(mut child) = spawn_help(binary) else {
        return InstallInfoProbe::Failed;
    };
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let (sender, receiver) = std::sync::mpsc::channel();
    // Read on a thread so a binary that never closes stdout cannot block
    // past `timeout`.
    std::thread::spawn(move || {
        let mut output = Vec::new();
        let _ = sender.send(stdout.read_to_end(&mut output).map(|_| output));
    });
    let output = receiver.recv_timeout(timeout);
    let _ = child.kill();
    let _ = child.wait();
    match output {
        Ok(Ok(output)) if !output.is_empty() => {
            if String::from_utf8_lossy(&output).contains("--install-info") {
                InstallInfoProbe::Supported
            } else {
                InstallInfoProbe::Unsupported
            }
        }
        _ => InstallInfoProbe::Failed,
    }
}

/// Split out from `installed_server_supports_install_info` so a test can
/// assert on the text, for the same reason as
/// `mcp_server_binary_missing_warning`.
fn probe_failed_warning(binary: &Path, no_telemetry: bool) -> String {
    let fallback = if no_telemetry {
        "`--telemetry off`"
    } else {
        "no telemetry args, so it reports by default"
    };
    format!(
        "warning: could not run `{} --help` to check for --install-info support. \
         mcpServers.{MCP_SERVER_NAME} falls back to {fallback}, and will not follow \
         later opt-out changes until the next `konductor update`.",
        binary.display()
    )
}

fn spawn_help(binary: &Path) -> std::io::Result<std::process::Child> {
    use std::process::{Command, Stdio};

    let mut retries_left = 3;
    loop {
        let spawned = Command::new(binary)
            .arg("--help")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        match spawned {
            // A just-written binary can be briefly busy while another
            // thread's fork still holds the write handle.
            Err(err)
                if err.kind() == std::io::ErrorKind::ExecutableFileBusy && retries_left > 0 =>
            {
                retries_left -= 1;
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            other => return other,
        }
    }
}

/// Warns that `agent_name` will not get the `konductor-skills` MCP
/// server, because `mcp_server_binary_installed` returned `false` --
/// shared by `McpServerPass::rewrite` and `McpServerPassV3::rewrite`,
/// which both gate on that same check, so the warning text lives in one
/// place instead of being duplicated in each `rewrite` body. Fires once
/// per affected agent, since each is a distinct loss of skill lookup.
///
/// Deliberately non-fatal: a missing binary is not an install error, so
/// this only makes the existing silent skip visible -- it never changes
/// whether the install succeeds.
fn warn_mcp_server_binary_missing(agent_name: &str) {
    eprintln!("{}", mcp_server_binary_missing_warning(agent_name));
}

/// Builds the exact text `warn_mcp_server_binary_missing` prints, split
/// out as a pure function so a test can assert on the message directly.
/// `cargo test` captures `eprintln!` output before it reaches a real
/// file descriptor, so an in-process test has no way to read the printed
/// line back -- asserting on this return value is the direct check
/// available without a subprocess-based test harness.
fn mcp_server_binary_missing_warning(agent_name: &str) -> String {
    format!(
        "warning: skipping mcpServers.{MCP_SERVER_NAME} injection for agent \
         '{agent_name}' -- the {MCP_SERVER_BINARY_NAME} binary was not found \
         at <repo-root>/mcp/target/release/{MCP_SERVER_BINARY_NAME}. This \
         agent will have no skill lookup (find_skills/get_skill) once \
         installed. Build the binary with `cd mcp && cargo build --release` \
         and run `konductor install` again to pick it up."
    )
}

/// The absolute `command` path for the injected `konductor-skills`
/// entry, from `ctx.bin_dir` -- shared by both `McpServerPass` and
/// `McpServerPassV3`.
fn mcp_server_command_path(ctx: &RewriteContext<'_>) -> String {
    ctx.bin_dir
        .join(MCP_SERVER_BINARY_NAME)
        .display()
        .to_string()
}

/// Builds the CLI args array for the injected `konductor-skills`
/// `mcpServers` entry -- identical for both `McpServerPass` (V2) and
/// `McpServerPassV3` (V3): the same fixed `--skills-dir` pair, the same
/// conditional `--agent-sop-paths`/`--agent-sop-filter` pair, and the
/// same conditional `--skill-name-filter` flag, gated on the exact same
/// per-agent lookups (`agent_has_sop_names`/`agent_has_skill_names`),
/// and a trailing telemetry arg: `--install-info <path>` when the server
/// supports it, otherwise `--telemetry off` when opted out.
fn build_mcp_server_args(
    value: &serde_json::Value,
    ctx: &RewriteContext<'_>,
) -> Vec<serde_json::Value> {
    let mut args: Vec<serde_json::Value> = MCP_SERVER_ARGS
        .iter()
        .map(|a| serde_json::Value::String(a.to_string()))
        .collect();
    // Both-or-neither, unlike skills' single `--skill-name-filter`
    // flag: `--agent-sop-paths` on its own (with no filter) would
    // serve every SOP in those directories to an agent that declared
    // none, so the pair is gated together on the SAME condition.
    // Default rule (critical for backward compatibility): only
    // appended when THIS agent has a non-empty entry in
    // `ctx.agent_sop_names` -- an absent entry or an empty list both
    // leave `args` exactly as it was before this field existed.
    if agent_has_sop_names(value, ctx) {
        let agent_sop_names = value
            .get("name")
            .and_then(|n| n.as_str())
            .and_then(|agent_name| ctx.agent_sop_names.get(agent_name))
            .expect("agent_has_sop_names just confirmed a non-empty entry exists");
        for path in MCP_SERVER_SOP_PATHS {
            args.push(serde_json::Value::String("--agent-sop-paths".to_string()));
            args.push(serde_json::Value::String(path.to_string()));
        }
        args.push(serde_json::Value::String("--agent-sop-filter".to_string()));
        args.push(serde_json::Value::String(agent_sop_names.join(",")));
    }
    // Single `--skill-name-filter` flag (unlike SOPs' `--agent-sop-
    // paths`/`--agent-sop-filter` pair above): `skill-lookup-mcp`'s
    // `--skills-dir` roots are already fixed by `MCP_SERVER_ARGS`,
    // so there is no analogous "paths" flag to pair this with.
    // Default rule (critical for backward compatibility, mirroring
    // the SOP rule exactly): only appended when THIS agent has a
    // non-empty entry in `ctx.agent_skill_names` -- an absent entry
    // or an empty list both leave `args` exactly as it was before
    // this field existed. Uses `agent_has_skill_names` (shared with
    // `matches` above) so the two can never disagree about which
    // agents this applies to.
    if agent_has_skill_names(value, ctx) {
        let agent_skill_names = value
            .get("name")
            .and_then(|n| n.as_str())
            .and_then(|agent_name| ctx.agent_skill_names.get(agent_name))
            .expect("agent_has_skill_names just confirmed a non-empty entry exists");
        args.push(serde_json::Value::String("--skill-name-filter".to_string()));
        args.push(serde_json::Value::String(agent_skill_names.join(",")));
    }
    // With `--install-info` the server checks the record at startup, so
    // every harness at this target follows one opt-out without rewriting
    // the others' hash-tracked agent files. The record's absence is the
    // opt-out, so `--telemetry off` is not needed alongside it.
    if ctx.server_supports_install_info {
        args.push(serde_json::Value::String("--install-info".to_string()));
        args.push(serde_json::Value::String(
            ctx.install_info_path.display().to_string(),
        ));
    } else if ctx.no_telemetry {
        args.push(serde_json::Value::String("--telemetry".to_string()));
        args.push(serde_json::Value::String("off".to_string()));
    }
    args
}

/// Injects (or overwrites) the `mcpServers.konductor-skills` entry with
/// `command`/`args` -- identical full-overwrite-of-that-one-key
/// semantics for both `McpServerPass` (V2) and `McpServerPassV3` (V3):
/// the source spec never declares this entry, so the only way one
/// could already be present is a prior install's own injection -- which
/// can't happen here since `value` is always read fresh from `dist/`.
fn inject_mcp_server_entry(
    value: &mut serde_json::Value,
    command: String,
    args: Vec<serde_json::Value>,
) {
    let entry = serde_json::json!({
        "command": command,
        "args": args,
    });
    match value.get_mut("mcpServers").and_then(|m| m.as_object_mut()) {
        Some(mcp_servers) => {
            mcp_servers.insert(MCP_SERVER_NAME.to_string(), entry);
        }
        None => {
            let mut mcp_servers = serde_json::Map::new();
            mcp_servers.insert(MCP_SERVER_NAME.to_string(), entry);
            value["mcpServers"] = serde_json::Value::Object(mcp_servers);
        }
    }
}

/// Confirms the `mcpServers.konductor-skills.command` path this run just
/// injected (if any) exists on disk -- shared by both `McpServerPass`
/// and `McpServerPassV3`'s `verify`, since both inject the exact same
/// key/shape.
fn verify_mcp_server_command(value: &serde_json::Value, agent_file: &Path) -> Result<(), String> {
    let Some(command) = value
        .get("mcpServers")
        .and_then(|m| m.get(MCP_SERVER_NAME))
        .and_then(|s| s.get("command"))
        .and_then(|c| c.as_str())
    else {
        // No-op when rewrite injected nothing (binary not installed).
        return Ok(());
    };
    if !Path::new(command).is_file() {
        return Err(format!(
            "agent '{}' declares mcpServers.{MCP_SERVER_NAME}.command '{command}', but no \
             file exists there -- run `konductor install` again after building the MCP \
             server binary (`cd mcp && cargo build --release`)",
            agent_file.display()
        ));
    }
    Ok(())
}

/// Confirms that, whenever `rewrite` just injected `mcpServers.
/// konductor-skills` into `value`, the paired `tools` visibility tag
/// (`MCP_SERVER_TOOLS_GRANT`, i.e. `@konductor-skills`) is present in
/// `value["tools"]`. `McpServerPassV3`-only: V2 has no equivalent check
/// for its own `tools`/`allowedTools` pair. Guards against a future edit
/// to `rewrite` dropping the `push_unique_str(value, "tools", ...)`
/// call, which would otherwise ship an agent whose `mcpServers` entry
/// and `permissions` rule both look correct while its tools stay
/// unreachable ("Tool not available"), with no error anywhere in the
/// install.
///
/// Checks for the same string `push_unique_str` uses for its own
/// idempotency dedup, so this can never disagree with what a successful
/// `rewrite` actually writes.
///
/// Errors when `mcpServers` is present but the tag is not -- the one
/// case `push_unique_str`'s malformed-shape no-op (a pre-existing
/// `tools` field that isn't a JSON array) could produce. Fails the
/// install rather than silently ship an unreachable `mcpServers` entry.
fn verify_mcp_tools_tag_present(
    value: &serde_json::Value,
    agent_file: &Path,
) -> Result<(), String> {
    let mcp_server_injected = value
        .get("mcpServers")
        .and_then(|m| m.get(MCP_SERVER_NAME))
        .is_some();
    if !mcp_server_injected {
        // No-op when rewrite injected nothing (binary not installed) --
        // mirrors verify_mcp_server_command's early return.
        return Ok(());
    }

    let tag_present = value
        .get("tools")
        .and_then(|t| t.as_array())
        .is_some_and(|tools| {
            tools
                .iter()
                .any(|t| t.as_str() == Some(MCP_SERVER_TOOLS_GRANT))
        });

    if !tag_present {
        return Err(format!(
            "agent '{}' has an injected mcpServers.{MCP_SERVER_NAME} entry, but \
             \"{MCP_SERVER_TOOLS_GRANT}\" is missing from its tools[] array -- the agent \
             would install successfully with a permission rule authorizing konductor-skills \
             but no visibility tag granting it, so its tools are installed and authorized yet \
             unreachable (\"Tool not available\"). This means push_unique_str could not attach \
             the tag, most likely because this agent file's pre-existing \"tools\" field is not \
             a JSON array -- fix the agent file's tools shape (or remove the hand-edited \
             override) and run `konductor install` again",
            agent_file.display()
        ));
    }
    Ok(())
}

/// Confirms that, whenever `rewrite` just injected `mcpServers.
/// konductor-skills` into `value`, a matching `capability: "mcp"` rule
/// (built via `mcp_server_permission_match_patterns`) is actually
/// present in `value["permissions"]["rules"]`. `McpServerPassV3`-only:
/// V2's `McpServerPass` authorizes via `tools`/`allowedTools`
/// (`push_unique_str`, which never fails to attach an array element), so
/// it has no analogous gap to close.
///
/// Constructs the exact rule `rewrite` would have inserted and checks
/// for byte-for-byte presence in `permissions.rules[]` -- the same
/// equality check `upsert_mcp_permission_rule` itself uses for its own
/// idempotency dedup, so this can never disagree with what a successful
/// `rewrite` actually writes.
///
/// Errors when the `mcpServers` entry is present but the paired
/// permission rule is not -- exactly what `upsert_mcp_permission_rule`'s
/// two malformed-shape no-op branches could produce (a pre-existing
/// `permissions` that isn't a JSON object, or `permissions.rules` that
/// isn't a JSON array). Fails the whole install rather than let it
/// silently ship an `mcpServers` entry the agent has no grant to call.
fn verify_mcp_permission_rule_present(
    value: &serde_json::Value,
    agent_file: &Path,
) -> Result<(), String> {
    let mcp_server_injected = value
        .get("mcpServers")
        .and_then(|m| m.get(MCP_SERVER_NAME))
        .is_some();
    if !mcp_server_injected {
        // No-op when rewrite injected nothing (binary not installed) --
        // mirrors verify_mcp_server_command's own early return.
        return Ok(());
    }

    let expected_rule = serde_json::json!({
        "capability": "mcp",
        "match": mcp_server_permission_match_patterns(),
        "effect": "allow",
    });
    let rule_present = value
        .get("permissions")
        .and_then(|p| p.get("rules"))
        .and_then(|r| r.as_array())
        .is_some_and(|rules| rules.iter().any(|rule| rule == &expected_rule));

    if !rule_present {
        return Err(format!(
            "agent '{}' has an injected mcpServers.{MCP_SERVER_NAME} entry, but no matching \
             \"mcp\" permission rule was found in permissions.rules[] -- the agent would \
             install successfully with no actual authorization to call konductor-skills. \
             This means upsert_mcp_permission_rule could not attach the grant, most likely \
             because this agent file's pre-existing \"permissions\" or \"permissions.rules\" \
             field is not the JSON shape it expects (an object and an array, respectively) -- \
             fix the agent file's permissions shape (or remove the hand-edited override) and \
             run `konductor install` again",
            agent_file.display()
        ));
    }
    Ok(())
}

impl ResourceRewritePass for McpServerPass {
    fn matches(&self, value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
        agent_needs_mcp_server(value, ctx)
    }

    fn rewrite(&self, value: &mut serde_json::Value, ctx: &RewriteContext<'_>) {
        if !mcp_server_binary_installed(ctx) {
            let agent_name = value
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("<unknown agent>");
            warn_mcp_server_binary_missing(agent_name);
            return;
        }
        let command = mcp_server_command_path(ctx);
        let args = build_mcp_server_args(value, ctx);
        inject_mcp_server_entry(value, command, args);

        // Appends to the agent's existing tools/allowedTools (e.g.
        // k-developer's @aws-mcp grant) rather than overwriting.
        // push_unique_str keeps a reinstall idempotent.
        push_unique_str(value, "tools", MCP_SERVER_TOOLS_GRANT);
        for tool in MCP_SERVER_ALLOWED_TOOLS_GRANTS {
            push_unique_str(value, "allowedTools", tool);
        }
    }

    fn verify(
        &self,
        value: &serde_json::Value,
        _ctx: &RewriteContext<'_>,
        agent_file: &Path,
    ) -> Result<(), String> {
        verify_mcp_server_command(value, agent_file)
    }
}

// ── Pass 4: MCP server injection (V3/KAS) ────────────────────────────────

/// `permissions.rules[].match` patterns granting the same three
/// `konductor-skills` tools as `MCP_SERVER_ALLOWED_TOOLS_GRANTS` above,
/// in V3's own `server/tool` syntax (no leading `@`, unlike V2's own
/// `@server/tool` tool-ID convention). Derived from
/// `MCP_SERVER_ALLOWED_TOOLS_GRANTS` at call time, not a second
/// hand-written literal list, so the two can never drift apart.
///
/// Explicit per-tool matches, not a `konductor-skills/*` wildcard: a
/// wildcard would auto-grant any tool `skill-lookup-mcp` adds in the
/// future with no review of that tool's own scope, silently widening
/// this agent's authorization on the server's next release. Explicit
/// matches require a deliberate, reviewed update here before a new tool
/// is usable. This also mirrors V2's own precedent
/// (`MCP_SERVER_ALLOWED_TOOLS_GRANTS`, which never grants the whole
/// server either), so it's the more conservative choice on its own
/// merits, not merely for consistency.
fn mcp_server_permission_match_patterns() -> Vec<String> {
    MCP_SERVER_ALLOWED_TOOLS_GRANTS
        .iter()
        .map(|grant| {
            grant
                .strip_prefix('@')
                .expect("MCP_SERVER_ALLOWED_TOOLS_GRANTS entries always start with '@'")
                .to_string()
        })
        .collect()
}

/// Appends a `{"capability": capability, "match": match_patterns,
/// "effect": "allow"}` rule to `value["permissions"]["rules"]` unless an
/// identical rule is already present -- the object-shaped analog of
/// `push_unique_str` above, for V3's `permissions.rules[]` array. Only
/// ever appends; never touches any other rule already in that array
/// (e.g. a `shell`/`fs_read` rule `derive_permission_rules` produced at
/// synth time).
///
/// Handles three shapes, each pinned by a test in this module:
/// - `permissions` absent entirely: creates
///   `value["permissions"] = {"rules": [rule]}` fresh.
/// - `permissions` present as an object with no `"rules"` key: inserts
///   a fresh empty array before pushing into it.
/// - `permissions` present but not an object, or `permissions.rules`
///   present but not an array: no-ops, matching `push_unique_str`'s own
///   "don't crash on a malformed shape" contract, rather than
///   overwriting a hand-edited or foreign agent file (real synth output
///   always emits `permissions: {"rules": [...]}`, so this path is
///   defensive-only).
///
/// The no-op path is silent by design, matching `push_unique_str`'s own
/// contract -- but not unchecked: `McpServerPassV3::verify` calls
/// `verify_mcp_permission_rule_present` immediately after `rewrite`,
/// which asserts the exact rule this function would have inserted is
/// actually present whenever `mcpServers.konductor-skills` was injected,
/// and fails the install if it isn't.
fn upsert_mcp_permission_rule(
    value: &mut serde_json::Value,
    capability: &str,
    match_patterns: &[String],
) {
    let rule = serde_json::json!({
        "capability": capability,
        "match": match_patterns,
        "effect": "allow",
    });

    if value.get("permissions").is_none() {
        value["permissions"] = serde_json::json!({ "rules": [rule] });
        return;
    }
    let Some(permissions) = value.get_mut("permissions").and_then(|p| p.as_object_mut()) else {
        return;
    };
    let rules = match permissions.get_mut("rules") {
        Some(existing) => match existing.as_array_mut() {
            Some(array) => array,
            None => return,
        },
        None => {
            permissions.insert("rules".to_string(), serde_json::Value::Array(Vec::new()));
            permissions
                .get_mut("rules")
                .and_then(|r| r.as_array_mut())
                .expect("just inserted as array")
        }
    };
    let already_present = rules.iter().any(|entry| entry == &rule);
    if !already_present {
        rules.push(rule);
    }
}

/// V3 (KAS) analog of `McpServerPass`: injects the identical
/// `mcpServers.konductor-skills` entry. Under V3, visibility and
/// authorization are separate concerns: the `tools` tag array
/// (`@konductor-skills`, via the same `push_unique_str` call V2 uses)
/// controls which tools the agent can see, while `permissions.rules[]`
/// controls which of those it may call without a prompt -- V3 has no
/// `allowedTools` field. Both are required, or the server's tools are
/// authorized yet unreachable ("Tool not available").
///
/// Shares its `matches`/`rewrite`/`verify` logic with `McpServerPass` via
/// the free functions above, so the two passes can never disagree about
/// when to fire or what to inject -- only in how they author the grant.
pub(super) struct McpServerPassV3;

impl ResourceRewritePass for McpServerPassV3 {
    fn matches(&self, value: &serde_json::Value, ctx: &RewriteContext<'_>) -> bool {
        agent_needs_mcp_server(value, ctx)
    }

    fn rewrite(&self, value: &mut serde_json::Value, ctx: &RewriteContext<'_>) {
        if !mcp_server_binary_installed(ctx) {
            let agent_name = value
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("<unknown agent>");
            warn_mcp_server_binary_missing(agent_name);
            return;
        }
        let command = mcp_server_command_path(ctx);
        let args = build_mcp_server_args(value, ctx);
        inject_mcp_server_entry(value, command, args);

        // Visibility: without this tag the server's tools are authorized
        // (by the permissions rule below) but never reachable -- V3
        // loads a server's tools based on `tools`, not
        // `permissions.rules[]`. Uses the same `push_unique_str`
        // primitive as V2's `tools` grant, so this stays idempotent
        // across reinstall and never clobbers entries like `@builtin` or
        // `subagent`. Deliberately not `allowedTools` -- V3 has no such
        // field; see this pass's struct-level doc comment.
        push_unique_str(value, "tools", MCP_SERVER_TOOLS_GRANT);

        // Authorization: which of the now-visible tools may be called
        // without a per-call prompt.
        upsert_mcp_permission_rule(value, "mcp", &mcp_server_permission_match_patterns());
    }

    fn verify(
        &self,
        value: &serde_json::Value,
        _ctx: &RewriteContext<'_>,
        agent_file: &Path,
    ) -> Result<(), String> {
        verify_mcp_server_command(value, agent_file)?;
        verify_mcp_tools_tag_present(value, agent_file)?;
        verify_mcp_permission_rule_present(value, agent_file)
    }
}

#[cfg(test)]
mod tests {
    use super::super::{apply_all, standard_passes_v3};
    use super::*;
    use crate::cli::install::manifest::ManifestFile;
    use std::fs;

    const TEST_INSTALL_INFO_PATH: &str = ".konductor/install-info.json";

    /// `prefix` followed by the trailing `--install-info` pair every
    /// injected entry ends with.
    fn with_install_info(prefix: &[&str]) -> Vec<String> {
        prefix
            .iter()
            .copied()
            .chain(["--install-info", TEST_INSTALL_INFO_PATH])
            .map(str::to_string)
            .collect()
    }

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-resource-rewrite-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Empty by construction (a `'static` empty map, so every `ctx()`
    /// call site below can borrow it without needing its own live
    /// binding) -- exercises the default "no agent has opted in"
    /// backward-compatibility path for every existing test that doesn't
    /// care about SOP scoping at all. Tests that DO care (see the
    /// `agent_sop_names`-specific tests below) build their own map and
    /// pass it to `RewriteContext` directly rather than through this
    /// helper.
    fn empty_agent_sop_names() -> &'static std::collections::HashMap<String, Vec<String>> {
        static EMPTY: std::sync::OnceLock<std::collections::HashMap<String, Vec<String>>> =
            std::sync::OnceLock::new();
        EMPTY.get_or_init(std::collections::HashMap::new)
    }

    /// Empty by construction, mirroring `empty_agent_sop_names` exactly
    /// -- exercises the default "no agent has opted in" backward-
    /// compatibility path for every existing test that doesn't care
    /// about skill-name scoping at all. Tests that DO care (see the
    /// `agent_skill_names`-specific tests below) build their own map and
    /// pass it to `RewriteContext` directly rather than through this
    /// helper.
    fn empty_agent_skill_names() -> &'static std::collections::HashMap<String, Vec<String>> {
        static EMPTY: std::sync::OnceLock<std::collections::HashMap<String, Vec<String>>> =
            std::sync::OnceLock::new();
        EMPTY.get_or_init(std::collections::HashMap::new)
    }

    fn ctx<'a>(
        context_dir: &'a Path,
        skills_dir: &'a Path,
        bin_dir: &'a Path,
        bin_files: &'a [ManifestFile],
    ) -> RewriteContext<'a> {
        RewriteContext {
            context_dir,
            skills_dir,
            bin_dir,
            bin_files,
            agent_sop_names: empty_agent_sop_names(),
            agent_skill_names: empty_agent_skill_names(),
            no_telemetry: false,
            install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
            server_supports_install_info: true,
        }
    }

    /// A minimal, empty-everything `RewriteContext` for `matches`-only
    /// tests that don't exercise `rewrite`/`verify` and so don't need
    /// real scratch directories.
    fn matches_only_ctx() -> RewriteContext<'static> {
        RewriteContext {
            context_dir: Path::new(""),
            skills_dir: Path::new(""),
            bin_dir: Path::new(""),
            bin_files: &[],
            agent_sop_names: empty_agent_sop_names(),
            agent_skill_names: empty_agent_skill_names(),
            no_telemetry: false,
            install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
            server_supports_install_info: true,
        }
    }

    // ── McpServerPass ────────────────────────────────────────────────

    fn bin_file_entry() -> ManifestFile {
        ManifestFile {
            path: ".konductor/bin/skill-lookup-mcp".to_string(),
            sha256: Some("deadbeef".to_string()),
            provenance: crate::cli::install::manifest::Provenance::Created,
        }
    }

    #[test]
    fn mcp_pass_matches_only_when_skill_resource_already_rewritten() {
        let with_skill = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let without_skill = serde_json::json!({
            "resources": ["file://context/notes.md"]
        });
        assert!(McpServerPass.matches(&with_skill, &matches_only_ctx()));
        assert!(!McpServerPass.matches(&without_skill, &matches_only_ctx()));
        assert!(!McpServerPass.matches(&serde_json::json!({}), &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_matches_rejects_workspace_skills_glob_regression_f908d40db() {
        // An agent declaring ONLY the ws-* glob (no packaged skill)
        // must never match.
        let glob_only = serde_json::json!({
            "resources": ["skill://.kiro/skills/ws-*/SKILL.md"]
        });
        assert!(!McpServerPass.matches(&glob_only, &matches_only_ctx()));

        // The glob's presence must not mask a real packaged skill.
        let both = serde_json::json!({
            "resources": [
                "skill://.kiro/skills/ws-*/SKILL.md",
                "skill://skills/constraints/SKILL.md"
            ]
        });
        assert!(McpServerPass.matches(&both, &matches_only_ctx()));

        // The post-rewrite absolute form must also match.
        let rewritten = serde_json::json!({
            "resources": ["skill:///abs/skills-dir/constraints/SKILL.md"]
        });
        assert!(McpServerPass.matches(&rewritten, &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_matches_accepts_backslash_form_regression_f2ee0918c() {
        // The post-rewrite absolute form renders with `\` on non-Unix
        // targets; matches() must still accept it.
        let backslash_rewritten = serde_json::json!({
            "resources": ["skill://C:\\skills-dir\\constraints\\SKILL.md"]
        });
        assert!(McpServerPass.matches(&backslash_rewritten, &matches_only_ctx()));

        // The glob exclusion above must still hold in that form.
        let backslash_glob_only = serde_json::json!({
            "resources": ["skill://.kiro\\skills\\ws-*\\SKILL.md"]
        });
        assert!(!McpServerPass.matches(&backslash_glob_only, &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_rewrite_injects_absolute_command_when_binary_installed() {
        let dir = scratch_dir("mcp-rewrite-installed");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        let bin_files = [bin_file_entry()];
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        let expected_command = bin_dir.join("skill-lookup-mcp").display().to_string();
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_command)
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(with_install_info(MCP_SERVER_ARGS))
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_replaces_stale_mcp_servers_entry_cleanly() {
        // Proves the unconditional `mcp_servers.insert` in `rewrite`
        // (safe today only because `value` is always read fresh from
        // `dist/`, never carrying a stale `mcpServers.konductor-skills`
        // key) is replace-not-merge and non-corrupting even when that
        // invariant is violated: seed a pre-existing entry under a
        // DIFFERENT command, plus an unrelated sibling `mcpServers`
        // entry that must survive untouched.
        let dir = scratch_dir("mcp-rewrite-replaces-stale-entry");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "mcpServers": {
                "konductor-skills": {
                    "command": "/stale/old-path/skill-lookup-mcp",
                    "args": ["--stale-flag"]
                },
                "some-other-server": {
                    "command": "/unrelated/other-server",
                    "args": []
                }
            }
        });
        let bin_files = [bin_file_entry()];
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );

        let expected_command = bin_dir.join("skill-lookup-mcp").display().to_string();
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_command),
            "the stale command must be replaced by the freshly installed binary's path"
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(with_install_info(MCP_SERVER_ARGS)),
            "the stale args must be replaced, not merged with the new entry"
        );
        assert_eq!(
            value["mcpServers"]["some-other-server"],
            serde_json::json!({"command": "/unrelated/other-server", "args": []}),
            "an unrelated sibling mcpServers entry must be left completely untouched"
        );
        assert_eq!(
            value["mcpServers"].as_object().map(serde_json::Map::len),
            Some(2),
            "replace must not leave behind extra keys or duplicate the entry"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_appends_tool_grants_when_binary_installed() {
        let dir = scratch_dir("mcp-rewrite-grants-append");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        // Pre-existing tools/allowedTools entries (e.g. k-developer's
        // own `@aws-mcp` grant) must survive -- this pass appends,
        // never overwrites the array.
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "tools": ["@builtin", "subagent"],
            "allowedTools": ["fs_read", "fs_write"]
        });
        let bin_files = [bin_file_entry()];
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["tools"],
            serde_json::json!(["@builtin", "subagent", "@konductor-skills"]),
            "pre-existing tools entries must survive; grant must be appended"
        );
        assert_eq!(
            value["allowedTools"],
            serde_json::json!([
                "fs_read",
                "fs_write",
                "@konductor-skills/find_skills",
                "@konductor-skills/get_skill",
                "@konductor-skills/reload_skills"
            ]),
            "pre-existing allowedTools entries must survive; grants must be appended"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_grants_are_idempotent_across_reinstall() {
        let dir = scratch_dir("mcp-rewrite-grants-idempotent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "tools": ["@builtin", "subagent"],
            "allowedTools": ["fs_read"]
        });
        let bin_files = [bin_file_entry()];
        // Simulate two installs in a row against the same value (a
        // real reinstall re-reads pristine bytes from `dist/`, but the
        // dedup guard must hold even if that invariant were ever
        // violated).
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        McpServerPass.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["tools"],
            serde_json::json!(["@builtin", "subagent", "@konductor-skills"]),
            "reinstall must not append a duplicate @konductor-skills tools entry"
        );
        assert_eq!(
            value["allowedTools"],
            serde_json::json!([
                "fs_read",
                "@konductor-skills/find_skills",
                "@konductor-skills/get_skill",
                "@konductor-skills/reload_skills"
            ]),
            "reinstall must not append duplicate allowedTools grants"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_does_not_inject_grants_when_binary_not_installed() {
        let dir = scratch_dir("mcp-rewrite-grants-absent-binary");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "tools": ["@builtin", "subagent"],
            "allowedTools": ["fs_read"]
        });
        // No bin_files -- binary was never copied by this run, so
        // neither the mcpServers entry NOR the grants must appear.
        McpServerPass.rewrite(&mut value, &ctx(&context_dir, &skills_dir, &bin_dir, &[]));
        assert_eq!(value["tools"], serde_json::json!(["@builtin", "subagent"]));
        assert_eq!(value["allowedTools"], serde_json::json!(["fs_read"]));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_rewrite_is_noop_when_binary_not_installed() {
        let dir = scratch_dir("mcp-rewrite-absent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        // No bin_files entries -- binary was never copied by this run.
        McpServerPass.rewrite(&mut value, &ctx(&context_dir, &skills_dir, &bin_dir, &[]));
        assert!(
            value.get("mcpServers").is_none(),
            "no mcpServers entry must be injected when the binary was not installed"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_server_binary_missing_warning_names_server_binary_and_remedy() {
        let warning = mcp_server_binary_missing_warning("k-example");
        assert!(
            warning.contains(MCP_SERVER_NAME),
            "must name the server that was skipped: {warning}"
        );
        assert!(
            warning.contains(MCP_SERVER_BINARY_NAME),
            "must name the missing binary: {warning}"
        );
        assert!(
            warning.contains("k-example"),
            "must name the affected agent: {warning}"
        );
        assert!(
            warning.contains("mcp/target/release"),
            "must state where the binary was expected: {warning}"
        );
        assert!(
            warning.contains("skill lookup"),
            "must state the consequence (skill lookup unavailable): {warning}"
        );
        assert!(
            warning.contains("cargo build --release"),
            "must say what to do about it: {warning}"
        );
    }

    #[test]
    fn mcp_pass_rewrite_warning_path_only_taken_when_binary_absent() {
        let dir = scratch_dir("mcp-rewrite-warning-symmetry");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let agent_name = "k-example";

        // Binary absent: rewrite() takes the early-return branch this
        // warning is attached to (no-injection behavior already covered
        // by mcp_pass_rewrite_is_noop_when_binary_not_installed, above).
        // The message printed for THIS agent is the one asserted by
        // mcp_server_binary_missing_warning_names_server_binary_and_remedy,
        // above.
        let mut missing = serde_json::json!({
            "name": agent_name,
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        McpServerPass.rewrite(&mut missing, &ctx(&context_dir, &skills_dir, &bin_dir, &[]));
        assert!(
            missing.get("mcpServers").is_none(),
            "no injection when the binary is absent -- the warning branch must run instead"
        );

        // Binary present: rewrite() takes the injection branch instead.
        // The branches are mutually exclusive (`if !installed { warn();
        // return; } else inject`), so a successful injection here proves
        // the warning branch did not run -- the "does not appear when
        // present" half of the check.
        let mut present = serde_json::json!({
            "name": agent_name,
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        McpServerPass.rewrite(
            &mut present,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert!(
            present["mcpServers"]["konductor-skills"]["command"].is_string(),
            "mcpServers entry must be injected when the binary is present -- \
             proving the warning branch was skipped"
        );

        fs::remove_dir_all(&dir).ok();
    }

    // ── McpServerPass: --agent-sop-paths / --agent-sop-filter ─────────

    #[test]
    fn mcp_pass_matches_sop_only_agent_with_no_skill_resource() {
        let sop_only = serde_json::json!({"name": "k-example", "resources": []});
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert("k-example".to_string(), vec!["ticket-sync".to_string()]);
        let ctx = RewriteContext {
            context_dir: Path::new(""),
            skills_dir: Path::new(""),
            bin_dir: Path::new(""),
            bin_files: &[],
            agent_sop_names: &agent_sop_names,
            agent_skill_names: empty_agent_skill_names(),
            no_telemetry: false,
            install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
            server_supports_install_info: true,
        };
        assert!(
            McpServerPass.matches(&sop_only, &ctx),
            "an agent with SOPs but no skill resource must still match, so it can get the MCP \
             server injected"
        );
    }

    #[test]
    fn mcp_pass_matches_false_when_no_skill_resource_and_no_sop_names() {
        let neither = serde_json::json!({"name": "k-example", "resources": []});
        assert!(!McpServerPass.matches(&neither, &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_rewrite_appends_agent_sop_paths_and_filter_when_agent_has_sop_names() {
        let dir = scratch_dir("mcp-rewrite-sop-present");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"name": "k-example", "resources": []});
        let bin_files = [bin_file_entry()];
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert(
            "k-example".to_string(),
            vec!["ticket-sync".to_string(), "code-review".to_string()],
        );
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: &agent_sop_names,
                agent_skill_names: empty_agent_skill_names(),
                no_telemetry: false,
                install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
                server_supports_install_info: true,
            },
        );
        let mut expected_args: Vec<String> =
            MCP_SERVER_ARGS.iter().map(|a| a.to_string()).collect();
        expected_args.push("--agent-sop-paths".to_string());
        expected_args.push("~/.konductor/sops".to_string());
        expected_args.push("--agent-sop-paths".to_string());
        expected_args.push(".konductor/sops".to_string());
        expected_args.push("--agent-sop-filter".to_string());
        expected_args.push("ticket-sync,code-review".to_string());
        expected_args.push("--install-info".to_string());
        expected_args.push(TEST_INSTALL_INFO_PATH.to_string());
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(expected_args),
            "an agent with a non-empty agent_sop_names entry must get both --agent-sop-paths \
             (twice, user-level then project-local) and --agent-sop-filter appended"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Both-or-neither: an agent absent from `agent_sop_names` (never
    /// opted in) gets EXACTLY the same `args` as before this field
    /// existed -- no `--agent-sop-paths` and no `--agent-sop-filter`.
    #[test]
    fn mcp_pass_rewrite_omits_agent_sop_args_when_agent_absent_from_map() {
        let dir = scratch_dir("mcp-rewrite-sop-absent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert(
            "some-other-agent".to_string(),
            vec!["ticket-sync".to_string()],
        );
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: &agent_sop_names,
                agent_skill_names: empty_agent_skill_names(),
                no_telemetry: false,
                install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
                server_supports_install_info: true,
            },
        );
        let args = value["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        assert!(
            !args.iter().any(|v| v.as_str() == Some("--agent-sop-paths")),
            "no --agent-sop-paths must appear for an agent absent from the sidecar, got: {args:?}"
        );
        assert!(
            !args
                .iter()
                .any(|v| v.as_str() == Some("--agent-sop-filter")),
            "no --agent-sop-filter must appear for an agent absent from the sidecar, got: {args:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Same both-or-neither contract, empty-list case: an agent present
    /// in the map but with an empty `Vec` must be treated identically to
    /// being absent entirely.
    #[test]
    fn mcp_pass_rewrite_omits_agent_sop_args_when_agent_entry_is_empty() {
        let dir = scratch_dir("mcp-rewrite-sop-empty");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert("k-example".to_string(), Vec::<String>::new());
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: &agent_sop_names,
                agent_skill_names: empty_agent_skill_names(),
                no_telemetry: false,
                install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
                server_supports_install_info: true,
            },
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(with_install_info(MCP_SERVER_ARGS)),
            "an empty agent_sop_names entry must be treated the same as an absent one"
        );
        fs::remove_dir_all(&dir).ok();
    }

    // ── McpServerPass: --skill-name-filter (agent_skill_names) ───────

    /// Mirrors `mcp_pass_matches_sop_only_agent_with_no_skill_resource`:
    /// an agent that declares `dependencies.skills.skillNames` but has
    /// no `skill://` resource at all must still match, so it can get the
    /// MCP server injected and therefore `--skill-name-filter` applied.
    #[test]
    fn mcp_pass_matches_skill_names_only_agent_with_no_skill_resource() {
        let skill_names_only = serde_json::json!({"name": "k-example", "resources": []});
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert("k-example".to_string(), vec!["constraints".to_string()]);
        let ctx = RewriteContext {
            context_dir: Path::new(""),
            skills_dir: Path::new(""),
            bin_dir: Path::new(""),
            bin_files: &[],
            agent_sop_names: empty_agent_sop_names(),
            agent_skill_names: &agent_skill_names,
            no_telemetry: false,
            install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
            server_supports_install_info: true,
        };
        assert!(
            McpServerPass.matches(&skill_names_only, &ctx),
            "an agent with agent_skill_names but no skill:// resource must still match, so it \
             can get the MCP server injected"
        );
    }

    #[test]
    fn mcp_pass_matches_false_when_no_skill_resource_and_no_skill_names() {
        let neither = serde_json::json!({"name": "k-example", "resources": []});
        assert!(!McpServerPass.matches(&neither, &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_rewrite_appends_skill_name_filter_when_agent_has_skill_names() {
        let dir = scratch_dir("mcp-rewrite-skill-filter-present");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert(
            "k-example".to_string(),
            vec!["constraints".to_string(), "sdlc-navigator".to_string()],
        );
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: empty_agent_sop_names(),
                agent_skill_names: &agent_skill_names,
                no_telemetry: false,
                install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
                server_supports_install_info: true,
            },
        );
        let mut expected_args: Vec<String> =
            MCP_SERVER_ARGS.iter().map(|a| a.to_string()).collect();
        expected_args.push("--skill-name-filter".to_string());
        expected_args.push("constraints,sdlc-navigator".to_string());
        expected_args.push("--install-info".to_string());
        expected_args.push(TEST_INSTALL_INFO_PATH.to_string());
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(expected_args),
            "an agent with a non-empty agent_skill_names entry must get --skill-name-filter \
             appended, with names joined by comma in declared order"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// The single most important backward-compatibility rule: an agent
    /// absent from `agent_skill_names` (never opted in) gets EXACTLY the
    /// same `args` as before this field existed -- no
    /// `--skill-name-filter` at all.
    #[test]
    fn mcp_pass_rewrite_omits_skill_name_filter_when_agent_absent_from_map() {
        let dir = scratch_dir("mcp-rewrite-skill-filter-absent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        // A non-empty map, but with no entry for THIS agent -- proves the
        // lookup is per-agent, not "any populated map enables the filter
        // for everyone".
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert(
            "some-other-agent".to_string(),
            vec!["constraints".to_string()],
        );
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: empty_agent_sop_names(),
                agent_skill_names: &agent_skill_names,
                no_telemetry: false,
                install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
                server_supports_install_info: true,
            },
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(with_install_info(MCP_SERVER_ARGS)),
            "an agent with no agent_skill_names entry must see the exact pre-existing args, \
             with no --skill-name-filter appended"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Same backward-compatibility rule, empty-list case: an agent
    /// present in the map but with an empty `Vec` must be treated
    /// identically to being absent entirely.
    #[test]
    fn mcp_pass_rewrite_omits_skill_name_filter_when_agent_entry_is_empty() {
        let dir = scratch_dir("mcp-rewrite-skill-filter-empty");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert("k-example".to_string(), Vec::<String>::new());
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: empty_agent_sop_names(),
                agent_skill_names: &agent_skill_names,
                no_telemetry: false,
                install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
                server_supports_install_info: true,
            },
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(with_install_info(MCP_SERVER_ARGS)),
            "an empty agent_skill_names entry must be treated the same as an absent one"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Both scoping mechanisms can apply to the same agent independently:
    /// an agent with both `agentSopNames` and `skillNames` gets both the
    /// SOP pair and the skill-name filter appended, in the order
    /// `rewrite` applies them (SOP block first, then skill block).
    #[test]
    fn mcp_pass_rewrite_appends_both_sop_and_skill_args_when_agent_has_both() {
        let dir = scratch_dir("mcp-rewrite-both-sop-and-skill");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"name": "k-example", "resources": []});
        let bin_files = [bin_file_entry()];
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert("k-example".to_string(), vec!["ticket-sync".to_string()]);
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert("k-example".to_string(), vec!["constraints".to_string()]);
        McpServerPass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: &agent_sop_names,
                agent_skill_names: &agent_skill_names,
                no_telemetry: false,
                install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
                server_supports_install_info: true,
            },
        );
        let args = value["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        let args: Vec<&str> = args.iter().map(|v| v.as_str().unwrap()).collect();
        assert!(
            args.contains(&"--agent-sop-filter"),
            "expected --agent-sop-filter present, got: {args:?}"
        );
        assert!(
            args.contains(&"--skill-name-filter"),
            "expected --skill-name-filter present, got: {args:?}"
        );
        assert!(
            args.ends_with(&["constraints", "--install-info", TEST_INSTALL_INFO_PATH]),
            "expected the --skill-name-filter value right before the trailing --install-info \
             pair (skill block runs after the SOP block), got: {args:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    fn injected_args(value: &serde_json::Value) -> Vec<&str> {
        value["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array")
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect()
    }

    /// Runs `pass.rewrite` on a skill-bearing agent with SOP and skill-name
    /// scoping, so the trailing args are checked against the longest arg
    /// list the pass builds. `prior_args` seeds an entry a previous install
    /// injected.
    fn rewrite_scoped_agent(
        pass: &dyn ResourceRewritePass,
        server_supports_install_info: bool,
        no_telemetry: bool,
        prior_args: Option<&[&str]>,
        label: &str,
    ) -> serde_json::Value {
        let dir = scratch_dir(label);
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {"rules": []}
        });
        if let Some(prior_args) = prior_args {
            value["mcpServers"] = serde_json::json!({
                "konductor-skills": {"command": "skill-lookup-mcp", "args": prior_args}
            });
        }
        let bin_files = [bin_file_entry()];
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert("k-example".to_string(), vec!["ticket-sync".to_string()]);
        let mut agent_skill_names = std::collections::HashMap::new();
        agent_skill_names.insert("k-example".to_string(), vec!["constraints".to_string()]);
        pass.rewrite(
            &mut value,
            &RewriteContext {
                context_dir: &context_dir,
                skills_dir: &skills_dir,
                bin_dir: &bin_dir,
                bin_files: &bin_files,
                agent_sop_names: &agent_sop_names,
                agent_skill_names: &agent_skill_names,
                no_telemetry,
                install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
                server_supports_install_info,
            },
        );
        fs::remove_dir_all(&dir).ok();
        value
    }

    const SCOPED_AGENT_ARGS: &[&str] = &[
        "--skills-dir",
        "~/.konductor/skills",
        "--skills-dir",
        ".konductor/skills",
        "--agent-sop-paths",
        "~/.konductor/sops",
        "--agent-sop-paths",
        ".konductor/sops",
        "--agent-sop-filter",
        "ticket-sync",
        "--skill-name-filter",
        "constraints",
    ];

    const BOTH_MCP_PASSES: [&dyn ResourceRewritePass; 2] = [&McpServerPass, &McpServerPassV3];

    #[test]
    fn supported_server_gets_install_info_and_never_telemetry_off() {
        for pass in BOTH_MCP_PASSES {
            for no_telemetry in [false, true] {
                let value =
                    rewrite_scoped_agent(pass, true, no_telemetry, None, "mcp-args-supported");
                assert_eq!(injected_args(&value), with_install_info(SCOPED_AGENT_ARGS));
            }
        }
    }

    #[test]
    fn older_server_gets_telemetry_off_when_opted_out_and_no_install_info() {
        for pass in BOTH_MCP_PASSES {
            let opted_in = rewrite_scoped_agent(pass, false, false, None, "mcp-args-older-in");
            assert_eq!(injected_args(&opted_in), SCOPED_AGENT_ARGS);
            let opted_out = rewrite_scoped_agent(pass, false, true, None, "mcp-args-older-out");
            assert_eq!(
                injected_args(&opted_out),
                [SCOPED_AGENT_ARGS, &["--telemetry", "off"]].concat()
            );
        }
    }

    /// Re-running over either kind of prior entry rebuilds the args, so
    /// nothing is duplicated and a flag the current server cannot take
    /// is dropped.
    #[test]
    fn rewrite_replaces_prior_telemetry_args_without_duplicating() {
        let telemetry_off = [SCOPED_AGENT_ARGS, &["--telemetry", "off"]].concat();
        let install_info = with_install_info(SCOPED_AGENT_ARGS);
        let install_info: Vec<&str> = install_info.iter().map(String::as_str).collect();
        for pass in BOTH_MCP_PASSES {
            for prior in [&telemetry_off, &install_info] {
                let supported =
                    rewrite_scoped_agent(pass, true, true, Some(prior), "mcp-args-prior-new");
                assert_eq!(
                    injected_args(&supported),
                    with_install_info(SCOPED_AGENT_ARGS)
                );
                let older_in =
                    rewrite_scoped_agent(pass, false, false, Some(prior), "mcp-args-prior-in");
                assert_eq!(injected_args(&older_in), SCOPED_AGENT_ARGS);
                let older_out =
                    rewrite_scoped_agent(pass, false, true, Some(prior), "mcp-args-prior-out");
                assert_eq!(injected_args(&older_out), telemetry_off);
            }
        }
    }

    /// Both Kiro CLI harnesses at one target must read the same record,
    /// so an opt-out through either one reaches the other.
    #[test]
    fn v2_and_v3_slots_at_one_target_share_the_install_info_path() {
        let target = scratch_dir("mcp-args-shared-install-info");
        let record = super::super::install_info_arg(&target);
        let bin_dir = target.join(".konductor").join("bin");
        let bin_files = [bin_file_entry()];
        let rewrite = |pass: &dyn ResourceRewritePass, no_telemetry: bool| {
            let mut value = serde_json::json!({
                "name": "k-example",
                "resources": ["skill://skills/constraints/SKILL.md"],
                "permissions": {"rules": []}
            });
            pass.rewrite(
                &mut value,
                &RewriteContext {
                    context_dir: &target.join(".kiro").join("context"),
                    skills_dir: &target.join(".konductor").join("skills"),
                    bin_dir: &bin_dir,
                    bin_files: &bin_files,
                    agent_sop_names: empty_agent_sop_names(),
                    agent_skill_names: empty_agent_skill_names(),
                    no_telemetry,
                    install_info_path: &record,
                    server_supports_install_info: true,
                },
            );
            value
        };
        let v2 = rewrite(&McpServerPass, true);
        let v3 = rewrite(&McpServerPassV3, false);
        let expected = ["--install-info", ".konductor/install-info.json"].map(str::to_string);
        for value in [&v2, &v3] {
            let args = injected_args(value);
            assert!(
                args.ends_with(&expected.each_ref().map(String::as_str)),
                "got: {args:?}"
            );
            assert!(!args.contains(&"--telemetry"), "got: {args:?}");
        }
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn mcp_pass_verify_ok_when_no_entry_present() {
        let dir = scratch_dir("mcp-verify-no-entry");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({"resources": ["file://AGENTS.md"]});
        McpServerPass
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect("no mcpServers entry at all must not be an error");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_verify_errors_when_command_target_missing() {
        let dir = scratch_dir("mcp-verify-missing");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": "/definitely/not/a/real/path/skill-lookup-mcp",
                    "args": []
                }
            }
        });
        let err = McpServerPass
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect_err("a missing command target must be rejected");
        assert!(err.contains("konductor-skills"));
        assert!(err.contains("/definitely/not/a/real/path/skill-lookup-mcp"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_verify_ok_when_command_target_exists() {
        let dir = scratch_dir("mcp-verify-exists");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let binary_path = bin_dir.join("skill-lookup-mcp");
        fs::write(&binary_path, b"fake binary").unwrap();
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": binary_path.display().to_string(),
                    "args": []
                }
            }
        });
        McpServerPass
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect("an existing command target must verify ok");
        fs::remove_dir_all(&dir).ok();
    }

    // ── McpServerPassV3 (permissions.rules[] authorization) ───────────

    #[test]
    fn mcp_server_permission_match_patterns_derives_from_v2_allowed_tools_grants() {
        assert_eq!(
            mcp_server_permission_match_patterns(),
            vec![
                "konductor-skills/find_skills".to_string(),
                "konductor-skills/get_skill".to_string(),
                "konductor-skills/reload_skills".to_string(),
            ]
        );
    }

    #[test]
    fn mcp_pass_v3_matches_only_when_skill_resource_already_rewritten() {
        let with_skill = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let without_skill = serde_json::json!({
            "resources": ["file://context/notes.md"]
        });
        assert!(McpServerPassV3.matches(&with_skill, &matches_only_ctx()));
        assert!(!McpServerPassV3.matches(&without_skill, &matches_only_ctx()));
        assert!(!McpServerPassV3.matches(&serde_json::json!({}), &matches_only_ctx()));
    }

    #[test]
    fn mcp_pass_v3_matches_for_sop_only_agent_with_no_skill_resource() {
        let sop_only = serde_json::json!({});
        let mut agent_sop_names = std::collections::HashMap::new();
        agent_sop_names.insert("k-example".to_string(), vec!["ticket-sync".to_string()]);
        let ctx = RewriteContext {
            context_dir: Path::new(""),
            skills_dir: Path::new(""),
            bin_dir: Path::new(""),
            bin_files: &[],
            agent_sop_names: &agent_sop_names,
            agent_skill_names: empty_agent_skill_names(),
            no_telemetry: false,
            install_info_path: Path::new(TEST_INSTALL_INFO_PATH),
            server_supports_install_info: true,
        };
        let mut sop_only_named = sop_only.clone();
        sop_only_named["name"] = serde_json::json!("k-example");
        assert!(
            McpServerPassV3.matches(&sop_only_named, &ctx),
            "an agent with SOP scoping but no skill:// resource must still trigger the grant"
        );
    }

    #[test]
    fn mcp_pass_v3_rewrite_injects_absolute_command_when_binary_installed() {
        let dir = scratch_dir("mcp-v3-rewrite-installed");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        let expected_command = bin_dir.join("skill-lookup-mcp").display().to_string();
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_command)
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["args"],
            serde_json::json!(with_install_info(MCP_SERVER_ARGS))
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_rewrite_warning_path_only_taken_when_binary_absent() {
        let dir = scratch_dir("mcp-v3-rewrite-warning-symmetry");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let agent_name = "k-example";

        // Binary absent: rewrite() takes the early-return branch this
        // warning is attached to -- no mcpServers entry appears. The
        // message printed for THIS agent is the one asserted by
        // mcp_server_binary_missing_warning_names_server_binary_and_remedy
        // (shared by both passes -- see McpServerPass's equivalent test,
        // above).
        let mut missing = serde_json::json!({
            "name": agent_name,
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        McpServerPassV3.rewrite(&mut missing, &ctx(&context_dir, &skills_dir, &bin_dir, &[]));
        assert!(
            missing.get("mcpServers").is_none(),
            "no injection when the binary is absent -- the warning branch must run instead"
        );

        // Binary present: rewrite() takes the injection branch instead.
        // The branches are mutually exclusive (`if !installed { warn();
        // return; } else inject`), so a successful injection here proves
        // the warning branch did not run -- the "does not appear when
        // present" half of the check.
        let mut present = serde_json::json!({
            "name": agent_name,
            "resources": ["skill://skills/constraints/SKILL.md"]
        });
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut present,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert!(
            present["mcpServers"]["konductor-skills"]["command"].is_string(),
            "mcpServers entry must be injected when the binary is present -- \
             proving the warning branch was skipped"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_rewrite_injects_scoped_mcp_permission_rule() {
        let dir = scratch_dir("mcp-v3-rewrite-permission-rule");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        // Mirrors real synth output: `permissions.rules` is always
        // present (possibly empty), never absent -- see
        // `kiro_cli_v3.rs`'s own `render_agent_file` docstring.
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {"rules": []}
        });
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["permissions"]["rules"],
            serde_json::json!([{
                "capability": "mcp",
                "match": [
                    "konductor-skills/find_skills",
                    "konductor-skills/get_skill",
                    "konductor-skills/reload_skills"
                ],
                "effect": "allow"
            }])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_rewrite_preserves_other_permission_rules() {
        let dir = scratch_dir("mcp-v3-rewrite-preserves-other-rules");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        // A `shell` rule `derive_permission_rules` would have produced
        // at synth time from the agent's own `toolsSettings` -- must
        // survive completely untouched; this pass only ever appends.
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {
                "rules": [
                    {"capability": "shell", "match": ["git *"], "effect": "allow"}
                ]
            }
        });
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        let rules = value["permissions"]["rules"]
            .as_array()
            .expect("rules must remain an array");
        assert_eq!(
            rules.len(),
            2,
            "the pre-existing rule must survive alongside the new one"
        );
        assert_eq!(
            rules[0],
            serde_json::json!({"capability": "shell", "match": ["git *"], "effect": "allow"}),
            "the pre-existing shell rule must be left completely untouched"
        );
        assert_eq!(rules[1]["capability"], serde_json::json!("mcp"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_rewrite_permission_rule_is_idempotent_across_reinstall() {
        let dir = scratch_dir("mcp-v3-rewrite-idempotent");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {"rules": []}
        });
        let bin_files = [bin_file_entry()];
        // Simulate two installs in a row against the same value -- a
        // real reinstall re-reads pristine bytes from `dist/`, but the
        // dedup guard must hold even if that invariant were ever
        // violated.
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        let rules = value["permissions"]["rules"]
            .as_array()
            .expect("rules must remain an array");
        assert_eq!(
            rules.len(),
            1,
            "reinstall must not append a duplicate mcp permission rule, got: {rules:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_rewrite_creates_permissions_block_when_absent() {
        // Defensive fallback only -- real synth output always emits
        // `permissions: {"rules": [...]}` (see `upsert_mcp_permission_rule`'s
        // own docstring), but a hand-edited or foreign agent file might
        // not.
        let dir = scratch_dir("mcp-v3-rewrite-creates-permissions");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({"resources": ["skill://skills/constraints/SKILL.md"]});
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["permissions"]["rules"].as_array().map(Vec::len),
            Some(1)
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Distinct from the "absent entirely" case above: `permissions` IS
    /// present as an object, but has no `"rules"` key at all -- the one
    /// mutating branch of `upsert_mcp_permission_rule` that inserts a
    /// fresh empty array before pushing into it (`permissions.insert(
    /// "rules".to_string(), ...)`). Pins the documented behavior for a
    /// hand-edited or foreign agent file whose `permissions` block omits
    /// `rules` (e.g. `{"permissions": {}}`), rather than leaving it as
    /// an assertion in that function's own docstring.
    #[test]
    fn mcp_pass_v3_rewrite_inserts_rules_key_when_permissions_object_has_none() {
        let dir = scratch_dir("mcp-v3-rewrite-permissions-object-no-rules-key");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {}
        });
        let bin_files = [bin_file_entry()];
        McpServerPassV3.rewrite(
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
        );
        assert_eq!(
            value["permissions"]["rules"],
            serde_json::json!([{
                "capability": "mcp",
                "match": [
                    "konductor-skills/find_skills",
                    "konductor-skills/get_skill",
                    "konductor-skills/reload_skills"
                ],
                "effect": "allow"
            }]),
            "a `permissions` object with no pre-existing `rules` key must gain a fresh \
             one-element array, not be left untouched or overwritten wholesale"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_verify_errors_when_command_target_missing() {
        let dir = scratch_dir("mcp-v3-verify-missing");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": "/definitely/not/a/real/path/skill-lookup-mcp",
                    "args": []
                }
            }
        });
        let err = McpServerPassV3
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect_err("a missing command target must be rejected");
        assert!(err.contains("konductor-skills"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_verify_ok_when_command_target_exists() {
        let dir = scratch_dir("mcp-v3-verify-exists");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let binary_path = bin_dir.join("skill-lookup-mcp");
        fs::write(&binary_path, b"fake binary").unwrap();
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": binary_path.display().to_string(),
                    "args": []
                }
            },
            "tools": [MCP_SERVER_TOOLS_GRANT],
            "permissions": {
                "rules": [{
                    "capability": "mcp",
                    "match": mcp_server_permission_match_patterns(),
                    "effect": "allow"
                }]
            }
        });
        McpServerPassV3
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect(
                "an existing command target with the tools visibility tag and a matching \
                 permission rule must verify ok",
            );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_verify_errors_when_permission_rule_missing_despite_command_present() {
        // Pins the gap `upsert_mcp_permission_rule`'s malformed-shape
        // no-op could otherwise leave open: without this check, an
        // install completes "successfully" with an unusable
        // `mcpServers` entry and no error at all.
        let dir = scratch_dir("mcp-v3-verify-permission-rule-missing");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let binary_path = bin_dir.join("skill-lookup-mcp");
        fs::write(&binary_path, b"fake binary").unwrap();
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        // `mcpServers` was injected and the tools tag is present, but
        // `permissions` is malformed (a string, not an object) --
        // exactly the shape `upsert_mcp_permission_rule` no-ops on. The
        // tools tag is included so this fixture fails on the
        // permission-rule gap specifically, not the unrelated tools-tag
        // check `verify` also runs.
        let value = serde_json::json!({
            "mcpServers": {
                "konductor-skills": {
                    "command": binary_path.display().to_string(),
                    "args": []
                }
            },
            "tools": [MCP_SERVER_TOOLS_GRANT],
            "permissions": "not-an-object"
        });
        let err = McpServerPassV3
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect_err("a missing permission rule must be rejected, not silently ignored");
        assert!(
            err.contains("mcp"),
            "error must name the missing capability: {err}"
        );
        assert!(
            err.contains("agent.json"),
            "error must name the affected agent file: {err}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_pass_v3_verify_ok_when_mcp_server_not_injected_regardless_of_permissions() {
        // No-op case: `rewrite` injected nothing (binary not installed),
        // so there is nothing for the permission-rule check to assert --
        // mirrors `verify_mcp_server_command`'s own early return.
        let dir = scratch_dir("mcp-v3-verify-no-mcp-server");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join("bin");
        let value = serde_json::json!({"permissions": "not-an-object"});
        McpServerPassV3
            .verify(
                &value,
                &ctx(&context_dir, &skills_dir, &bin_dir, &[]),
                Path::new("/tmp/agent.json"),
            )
            .expect("no mcpServers entry means nothing to verify, regardless of permissions shape");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_all_v3_fails_closed_when_upsert_mcp_permission_rule_no_ops_on_malformed_permissions() {
        // End-to-end: `apply_all` runs `rewrite` then `verify`
        // immediately for `McpServerPassV3` -- confirms the full
        // pipeline surfaces the gap as a real `Err`, not just the
        // unit-level `verify` call in isolation above.
        let dir = scratch_dir("apply-all-v3-permission-rule-gap");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(skills_dir.join("constraints")).unwrap();
        fs::write(skills_dir.join("constraints/SKILL.md"), b"body").unwrap();
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("skill-lookup-mcp"), b"binary").unwrap();
        let bin_files = [bin_file_entry()];

        let mut value = serde_json::json!({
            "resources": ["skill://skills/constraints/SKILL.md"],
            // Malformed: `permissions.rules` is a string, not an array --
            // `upsert_mcp_permission_rule` no-ops rather than attaching
            // the grant.
            "permissions": {"rules": "not-an-array"}
        });
        let passes = standard_passes_v3();
        let err = apply_all(
            &passes,
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
            Path::new("/tmp/agent.json"),
        )
        .expect_err("a malformed permissions.rules shape must fail the whole pipeline");
        assert!(
            err.contains("mcp"),
            "error must name the missing capability: {err}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_all_v3_runs_context_then_skill_then_mcp_permission_rule_in_order() {
        let dir = scratch_dir("apply-all-v3-order");
        let context_dir = dir.join("context");
        let skills_dir = dir.join("skills");
        let bin_dir = dir.join(".konductor").join("bin");
        fs::create_dir_all(&context_dir).unwrap();
        fs::write(context_dir.join("notes.md"), b"body").unwrap();
        fs::create_dir_all(skills_dir.join("constraints")).unwrap();
        fs::write(skills_dir.join("constraints/SKILL.md"), b"body").unwrap();
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("skill-lookup-mcp"), b"binary").unwrap();
        let bin_files = [bin_file_entry()];

        let mut value = serde_json::json!({
            "resources": [
                "file://context/notes.md",
                "skill://skills/constraints/SKILL.md"
            ],
            "permissions": {"rules": []}
        });
        let passes = standard_passes_v3();
        apply_all(
            &passes,
            &mut value,
            &ctx(&context_dir, &skills_dir, &bin_dir, &bin_files),
            Path::new("/tmp/agent.json"),
        )
        .expect("full V3 pipeline must succeed");

        let expected_context = format!("file://{}", context_dir.join("notes.md").display());
        let expected_skill = format!(
            "skill://{}",
            skills_dir.join("constraints").join("SKILL.md").display()
        );
        assert_eq!(
            value["resources"],
            serde_json::json!([expected_context, expected_skill])
        );
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(bin_dir.join("skill-lookup-mcp").display().to_string())
        );
        assert_eq!(
            value["permissions"]["rules"][0]["capability"],
            serde_json::json!("mcp")
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    fn write_script(dir: &Path, contents: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(MCP_SERVER_BINARY_NAME);
        fs::write(&path, contents).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn probe_reports_support_only_when_help_lists_install_info() {
        let dir = scratch_dir("probe-help");
        let current = write_script(&dir, super::super::FAKE_SERVER_WITH_INSTALL_INFO);
        assert_eq!(
            probe_install_info(&current, HELP_PROBE_TIMEOUT),
            InstallInfoProbe::Supported
        );
        let older = write_script(&dir, "#!/bin/sh\necho '      --telemetry <TELEMETRY>'\n");
        assert_eq!(
            probe_install_info(&older, HELP_PROBE_TIMEOUT),
            InstallInfoProbe::Unsupported
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn probe_that_cannot_run_reports_failed_not_unsupported() {
        let dir = scratch_dir("probe-failure");
        assert_eq!(
            probe_install_info(&dir.join("missing"), HELP_PROBE_TIMEOUT),
            InstallInfoProbe::Failed
        );
        let not_executable = dir.join("not-executable");
        fs::write(&not_executable, b"fake binary").unwrap();
        assert_eq!(
            probe_install_info(&not_executable, HELP_PROBE_TIMEOUT),
            InstallInfoProbe::Failed
        );
        let silent = dir.join("silent");
        fs::write(&silent, b"#!/bin/sh\nexit 0\n").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&silent, fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(
            probe_install_info(&silent, HELP_PROBE_TIMEOUT),
            InstallInfoProbe::Failed
        );
        let hangs = write_script(&dir, "#!/bin/sh\nexec sleep 30\n");
        let started = std::time::Instant::now();
        assert_eq!(
            probe_install_info(&hangs, std::time::Duration::from_millis(200)),
            InstallInfoProbe::Failed
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_probe_of_an_installed_binary_falls_back_to_unsupported() {
        let dir = scratch_dir("probe-installed-but-broken");
        fs::write(dir.join(MCP_SERVER_BINARY_NAME), b"fake binary").unwrap();
        assert!(!installed_server_supports_install_info(
            &dir,
            &[bin_file_entry()],
            true
        ));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn probe_failed_warning_names_the_binary_and_the_fallback_args() {
        let binary = Path::new("/target/.konductor/bin/skill-lookup-mcp");
        let opted_out = probe_failed_warning(binary, true);
        assert!(opted_out.starts_with("warning: "), "got: {opted_out}");
        assert!(opted_out.contains("/target/.konductor/bin/skill-lookup-mcp"));
        assert!(opted_out.contains("`--telemetry off`"), "got: {opted_out}");
        let opted_in = probe_failed_warning(binary, false);
        assert!(opted_in.contains("no telemetry args"), "got: {opted_in}");
        assert!(!opted_in.contains("--telemetry off"), "got: {opted_in}");
    }

    #[cfg(unix)]
    #[test]
    fn probe_skips_a_binary_this_run_did_not_install() {
        let dir = scratch_dir("probe-not-installed");
        write_script(&dir, super::super::FAKE_SERVER_WITH_INSTALL_INFO);
        assert!(installed_server_supports_install_info(
            &dir,
            &[bin_file_entry()],
            false
        ));
        assert!(!installed_server_supports_install_info(&dir, &[], false));
        fs::remove_dir_all(&dir).ok();
    }
}
