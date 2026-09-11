// SPDX-License-Identifier: Apache-2.0
//
// install/kiro_cli/plan.rs — write-ahead planning for the Kiro CLI
// install strategy. Every function here classifies what a real
// `install_from_local` run will write (manifest path + provenance)
// WITHOUT copying or writing anything -- see `kiro_cli.rs`'s own
// module doc comment for the full split rationale and the
// write-ahead-sequencing contract this plan feeds into.

use std::collections::HashMap;
use std::path::Path;

use super::super::manifest::{classify_provenance, Manifest, ManifestFile, Provenance};
use super::super::runtime::{detect_runtimes, Runtime};
use super::{
    list_agent_files, list_agent_files_like, list_skill_dirs, CONTEXT_RESOURCE_PREFIX,
    KIRO_DESTINATION_ROOT, KONDUCTOR_DESTINATION_ROOT,
};
use crate::cli::synth::kiro_cli_v2::{
    AGENTS_CONTENT_TYPE_DIR, CONTEXT_CONTENT_TYPE_DIR, SKILLS_CONTENT_TYPE_DIR,
    SKILL_SCOPES_SIDECAR_FILE, SOPS_CONTENT_TYPE_DIR, SOP_SCOPES_SIDECAR_FILE,
};

/// One file this install run intends to write: its manifest path and
/// the provenance `classify_provenance` assigned before content
/// changed. `pub(in crate::cli::install)` so `mcp_server` can construct/read plan
/// entries without a parallel type.
#[derive(Clone)]
pub(in crate::cli::install) struct PlannedFile {
    pub(in crate::cli::install) manifest_path: String,
    pub(in crate::cli::install) provenance: Provenance,
}

/// The manifest-relative path for a content item:
/// `<root>/<content_dir>/<name>`. Spelled once so the write-ahead PLAN
/// side and the COPY side can never build it differently. `pub(in crate::cli::install)`:
/// `mcp_server` reuses this for its own bin-file paths.
pub(in crate::cli::install) fn content_manifest_path(
    root: &str,
    content_dir: &str,
    name: &str,
) -> String {
    format!("{root}/{content_dir}/{name}")
}

/// Reads `<source_dir>/_sop_scopes.json` (synth's per-agent SOP-allowlist
/// sidecar -- see `kiro_cli_v2::write_sop_scopes_sidecar`'s doc comment
/// for what produces it) into an agent-name -> SOP-names map. Returns an
/// empty map, not an error, when the file does not exist -- a `dist/`
/// tree built by a synth binary from before this sidecar existed must
/// install exactly as it did before (see `RewriteContext::agent_sop_
/// names`'s own doc comment for why empty/absent is the deliberate
/// default-safe case this whole feature is built around). A file that
/// DOES exist but fails to parse as the expected shape is a hard error:
/// unlike a merely missing sidecar, a malformed one signals a real bug
/// (a synth/install version mismatch, or on-disk corruption) worth
/// surfacing rather than silently discarding.
///
/// `pub(in crate::cli::install)`: both this module's own `plan_claude_settings_grant` and
/// the sibling `copy` module's `install_agents` need this exact same
/// scoping snapshot -- shared here rather than duplicated, mirroring
/// `content_manifest_path`'s own cross-module reuse just above.
pub(in crate::cli::install) fn read_sop_scopes_sidecar(
    source_dir: &Path,
) -> Result<HashMap<String, Vec<String>>, String> {
    let path = source_dir.join(SOP_SCOPES_SIDECAR_FILE);
    if !path.is_file() {
        return Ok(HashMap::new());
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse {} as JSON: {e}", path.display()))
}

/// Reads `<source_dir>/_skill_scopes.json` (synth's per-agent
/// Kiro-runtime skill-allowlist sidecar -- see `kiro_cli_v2::
/// write_skill_scopes_sidecar`'s doc comment for what produces it) into
/// an agent-name -> skill-names map. Mirrors `read_sop_scopes_sidecar`
/// exactly: returns an empty map, not an error, when the file does not
/// exist (a `dist/` tree built by a synth binary from before this
/// sidecar existed must install exactly as it did before -- see
/// `RewriteContext::agent_skill_names`'s own doc comment for why empty/
/// absent is the deliberate default-safe case this whole feature is
/// built around), and errors hard on a file that exists but fails to
/// parse (a synth/install version mismatch or on-disk corruption, worth
/// surfacing rather than silently discarding).
///
/// `pub(in crate::cli::install)`: both this module's own
/// `plan_claude_settings_grant` and the sibling `copy` module's
/// `install_agents` need this exact same scoping snapshot -- shared here
/// rather than duplicated, mirroring `read_sop_scopes_sidecar`'s own
/// cross-module reuse just above.
pub(in crate::cli::install) fn read_skill_scopes_sidecar(
    source_dir: &Path,
) -> Result<HashMap<String, Vec<String>>, String> {
    let path = source_dir.join(SKILL_SCOPES_SIDECAR_FILE);
    if !path.is_file() {
        return Ok(HashMap::new());
    }
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("failed to parse {} as JSON: {e}", path.display()))
}

/// Builds the full write-ahead plan across all three content types
/// (context, skills, agents), without copying or writing anything.
/// Every entry's provenance is classified against `target_dir` and
/// `prior_manifest` BEFORE this function returns -- i.e. before any
/// file in the plan has been touched by this install run.
///
/// This function's own internal order (context, then skills, then
/// agents) does not need to match, and today does not match, the real
/// copy order the `InstallPhase` pipeline in `phases.rs` runs in
/// (skills, then the MCP binary, then SOPs, then context, then agents
/// -- see `standard_install_phases`). That's safe because
/// `attach_provenance` (the function that reconciles this plan against
/// the phases' real output) matches each copied file back to its
/// planned entry by manifest *path*, not by position in either list.
/// A future phase reordering therefore cannot silently desync from this
/// plan's order -- but it also means this list's order carries no
/// contract; don't read anything into it beyond "these are the three
/// content types this plans for."
pub(in crate::cli::install) fn plan_all_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&Manifest>,
) -> Result<Vec<PlannedFile>, String> {
    let mut plan = Vec::new();
    plan.extend(plan_context_files(harness_dir, target_dir, prior_manifest)?);
    plan.extend(plan_skill_files(harness_dir, target_dir, prior_manifest)?);
    plan.extend(plan_sop_files(harness_dir, target_dir, prior_manifest)?);
    plan.extend(plan_agent_files(harness_dir, target_dir, prior_manifest)?);
    Ok(plan)
}

/// Plans every file `install_sops` will copy: same source listing
/// (`list_agent_files_like`) and same manifest-path prefixing, but only
/// classifies provenance against the destination -- no copy. Mirrors
/// `plan_context_files` exactly, one content-type dir over.
fn plan_sop_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&Manifest>,
) -> Result<Vec<PlannedFile>, String> {
    let source_dir = harness_dir.join(SOPS_CONTENT_TYPE_DIR);
    let entries = list_agent_files_like(&source_dir)?;
    let destination = target_dir
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(SOPS_CONTENT_TYPE_DIR);
    let mut plan = Vec::with_capacity(entries.len());
    for file_name in entries {
        let manifest_path = content_manifest_path(
            KONDUCTOR_DESTINATION_ROOT,
            SOPS_CONTENT_TYPE_DIR,
            &file_name,
        );
        let provenance = classify_provenance(
            &destination.join(&file_name),
            &manifest_path,
            prior_manifest,
        );
        plan.push(PlannedFile {
            manifest_path,
            provenance,
        });
    }
    Ok(plan)
}

/// Plans every file `install_context` will copy: same source listing
/// (`list_agent_files_like`) and same manifest-path prefixing, but only
/// classifies provenance against the destination -- no copy.
fn plan_context_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&Manifest>,
) -> Result<Vec<PlannedFile>, String> {
    let source_dir = harness_dir.join(CONTEXT_CONTENT_TYPE_DIR);
    let entries = list_agent_files_like(&source_dir)?;
    let destination = target_dir
        .join(KIRO_DESTINATION_ROOT)
        .join(CONTEXT_CONTENT_TYPE_DIR);
    let mut plan = Vec::with_capacity(entries.len());
    for file_name in entries {
        let manifest_path =
            content_manifest_path(KIRO_DESTINATION_ROOT, CONTEXT_CONTENT_TYPE_DIR, &file_name);
        let provenance = classify_provenance(
            &destination.join(&file_name),
            &manifest_path,
            prior_manifest,
        );
        plan.push(PlannedFile {
            manifest_path,
            provenance,
        });
    }
    Ok(plan)
}

/// Plans every file `install_agents` will copy: same source listing
/// (`list_agent_files`) and same manifest-path prefixing, but only
/// classifies provenance against the destination -- no copy, no
/// resource rewrite.
fn plan_agent_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&Manifest>,
) -> Result<Vec<PlannedFile>, String> {
    let source_dir = harness_dir.join(AGENTS_CONTENT_TYPE_DIR);
    let entries = list_agent_files(&source_dir)?;
    let destination = target_dir
        .join(KIRO_DESTINATION_ROOT)
        .join(AGENTS_CONTENT_TYPE_DIR);
    let mut plan = Vec::with_capacity(entries.len());
    for file_name in entries {
        let manifest_path =
            content_manifest_path(KIRO_DESTINATION_ROOT, AGENTS_CONTENT_TYPE_DIR, &file_name);
        let provenance = classify_provenance(
            &destination.join(&file_name),
            &manifest_path,
            prior_manifest,
        );
        plan.push(PlannedFile {
            manifest_path,
            provenance,
        });
    }
    Ok(plan)
}

/// Predicts whether this run will apply the Claude/V3 settings grant
/// (see `resource_rewrite.rs`'s "V3/Claude Code permission grant"
/// section), and if so, includes `.claude/settings.json` in the
/// returned plan -- so the write-ahead `Status::InProgress` manifest
/// (written in `install_from_local` before any real content copy
/// happens) already names this file. This closes the crash-safety
/// window between `apply_claude_settings_grant`'s own write and the
/// final `Status::Complete` manifest rewrite: without it, a crash in
/// that window would leave the mutation completely unrecorded in any
/// manifest on disk, invisible to `konductor doctor`.
///
/// Mirrors the exact two conditions the real run computes:
/// `already_planned` (the combined agent + bin plan, built just before
/// this is called) is checked for `MCP_SERVER_BINARY_NAME`'s planned
/// path, and each agent source file is checked with the SAME predicate
/// that actually decides `any_mcp_server_injected` at real-install
/// time: `resource_rewrite::McpServerPass::matches`, called directly
/// (not re-derived) on the parsed JSON, so this prediction can never
/// drift out of sync with the real trigger. That predicate is
/// deliberately broader than a bare `SKILL_RESOURCE_PREFIX` check --
/// it also accepts the post-rewrite absolute form -- which is why this
/// function calls it directly instead of approximating it with that
/// narrower prefix (an approximation would under-predict for an agent
/// whose `resources` entry matches `McpServerPass` but not that exact
/// prefix, silently missing this file from the write-ahead plan). A
/// cheap raw-`contains("skill://")` pre-filter, widened by this agent's
/// own entry in the `_sop_scopes.json`/`_skill_scopes.json` sidecars
/// (an agent with SOP or skill-name scoping but no `skill://` resource
/// at all still needs its JSON parsed and checked), still skips the
/// JSON parse for every other agent where neither signal is present,
/// but is never itself the decision -- only the real `matches` call,
/// given a `RewriteContext` built from those same sidecars, is. If this
/// prediction ever diverges from the real computation in the "predicted
/// no, actual yes" direction anyway, `attach_provenance` fails loudly
/// (an internal-error message naming the unplanned path) rather than
/// silently mis-tracking, so the inconsistency cannot pass unnoticed.
pub(in crate::cli::install) fn plan_claude_settings_grant(
    harness_dir: &Path,
    target_dir: &Path,
    already_planned: &[PlannedFile],
    prior_manifest: Option<&Manifest>,
) -> Result<Vec<PlannedFile>, String> {
    if !detect_runtimes(target_dir).has(Runtime::ClaudeCode) {
        return Ok(Vec::new());
    }
    let binary_manifest_path = content_manifest_path(
        KONDUCTOR_DESTINATION_ROOT,
        super::super::mcp_server::BIN_CONTENT_TYPE_DIR,
        super::super::resource_rewrite::MCP_SERVER_BINARY_NAME,
    );
    let binary_will_be_installed = already_planned
        .iter()
        .any(|planned| planned.manifest_path == binary_manifest_path);
    if !binary_will_be_installed {
        return Ok(Vec::new());
    }

    let source_dir = harness_dir.join(AGENTS_CONTENT_TYPE_DIR);
    // Read once, mirroring `install_agents`'s own read-before-the-loop
    // pattern, so this prediction never diverges from the real run by
    // re-reading a different snapshot mid-loop.
    let agent_sop_names = read_sop_scopes_sidecar(&source_dir)?;
    let agent_skill_names = read_skill_scopes_sidecar(&source_dir)?;
    let empty_bin_files: [ManifestFile; 0] = [];
    let mut any_mcp_server_pass_match = false;
    for file_name in list_agent_files(&source_dir)? {
        let path = source_dir.join(&file_name);
        let contents = std::fs::read_to_string(&path)
            .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
        // This agent's own SOP/skill-name scoping, from the sidecars --
        // checked by file name (never visible via a raw substring
        // search of the agent's own JSON, unlike the skill/context
        // prefixes below; see `copy_agent_files_rewriting_resources`'s
        // own doc comment for the identical reasoning applied to its
        // fast path).
        let agent_name = file_name.strip_suffix(".json").unwrap_or(&file_name);
        let agent_has_sop_names = agent_sop_names
            .get(agent_name)
            .is_some_and(|names| !names.is_empty());
        let agent_has_skill_names = agent_skill_names
            .get(agent_name)
            .is_some_and(|names| !names.is_empty());
        // Cheap pre-filter (avoids parsing every agent's JSON when
        // neither signal is present at all -- every string
        // `McpServerPass::matches` accepts starts with the "skill://"
        // literal), THEN the real check: the exact same predicate that
        // decides `any_mcp_server_injected` at real-install time, called
        // directly rather than re-derived, so this prediction can never
        // silently diverge from it. See the doc comment above for why
        // that predicate, not a narrower prefix check, is the right one.
        if !contents.contains("skill://") && !agent_has_sop_names && !agent_has_skill_names {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(&contents) {
            Ok(value) => value,
            Err(e) => {
                // A file that contains the bare "skill://" substring
                // but neither of the two prefixes
                // `copy_agent_files_rewriting_resources`'s own
                // fast-path skip checks for (`SKILL_RESOURCE_PREFIX`,
                // `CONTEXT_RESOURCE_PREFIX`) -- the documented example
                // is a `ws-*` workspace-skills glob entry, which
                // `McpServerPass::matches` itself excludes via its own
                // `!contains('*')` check -- is NEVER actually parsed
                // at real install time: that fast path copies it
                // verbatim, byte for byte, regardless of whether it
                // is even valid JSON. Erroring here for such a file
                // would abort the WHOLE install over one the real run
                // installs successfully today. Only propagate the
                // parse error when the raw content also contains one
                // of those two real prefixes, OR this agent has SOP or
                // skill-name scoping (either of which also forces the
                // real run to parse it via the widened fast-path
                // condition above) -- meaning the real run would attempt
                // to parse it too, and would hit this exact same error
                // there, so failing the prediction the same way is not a
                // new failure mode.
                if contents.contains(super::super::resource_rewrite::SKILL_RESOURCE_PREFIX)
                    || contents.contains(CONTEXT_RESOURCE_PREFIX)
                    || agent_has_sop_names
                    || agent_has_skill_names
                {
                    return Err(format!("{} is not valid JSON: {e}", path.display()));
                }
                continue;
            }
        };
        let prediction_ctx = super::super::resource_rewrite::RewriteContext {
            context_dir: target_dir,
            skills_dir: target_dir,
            bin_dir: target_dir,
            bin_files: &empty_bin_files,
            agent_sop_names: &agent_sop_names,
            agent_skill_names: &agent_skill_names,
        };
        if super::super::resource_rewrite::ResourceRewritePass::matches(
            &super::super::resource_rewrite::McpServerPass,
            &value,
            &prediction_ctx,
        ) {
            any_mcp_server_pass_match = true;
            break;
        }
    }
    if !any_mcp_server_pass_match {
        return Ok(Vec::new());
    }

    let manifest_path = super::super::resource_rewrite::CLAUDE_SETTINGS_RELATIVE_PATH.to_string();
    let provenance = classify_provenance(
        &target_dir.join(&manifest_path),
        &manifest_path,
        prior_manifest,
    );
    Ok(vec![PlannedFile {
        manifest_path,
        provenance,
    }])
}

/// Predicts the additive Claude-side SOP-skill conversion files
/// `SopInstallPhase::run`'s dual-marker branch (see `phases.rs`'s own
/// doc comment) writes when this run's Kiro chain reaches a target that
/// ALSO has a pre-existing `.claude` marker -- so the write-ahead plan
/// already anticipates them, closing an `attach_provenance` crash-safety
/// gap: without this, those files land on disk during a real
/// dual-marker install but were never in the plan, and `attach_provenance`
/// fails with an internal-error message naming the unplanned path.
///
/// Reuses `claude::plan_sop_skill_files` directly -- the exact function
/// that plans the SAME files for `ClaudeInstallStrategy`'s own
/// `install_from_local` -- rather than re-deriving an approximation, so
/// this prediction can never silently drift from what
/// `claude::install_sop_skills` (the function `SopInstallPhase::run`'s
/// additive branch actually calls) writes. Mirrors
/// `plan_claude_settings_grant`'s own "predict, don't recompute"
/// contract.
///
/// `repo_root` (not `harness_dir`, which is Kiro's own) is required:
/// the additive branch's source is ALWAYS `<repo_root>/dist/claude/sops/`,
/// never `staged_root` -- see `SopInstallPhase`'s own doc comment for
/// why. Returns an empty plan when this target has no pre-existing
/// `.claude` marker at all -- the ordinary, non-dual-marker case, which
/// must see no change in behavior.
pub(in crate::cli::install) fn plan_additive_claude_sop_skill_files(
    repo_root: &Path,
    target_dir: &Path,
    prior_manifest: Option<&Manifest>,
) -> Result<Vec<PlannedFile>, String> {
    if !detect_runtimes(target_dir).has(Runtime::ClaudeCode) {
        return Ok(Vec::new());
    }
    let claude_harness_dir = repo_root
        .join("dist")
        .join(super::super::claude::CLAUDE_HARNESS_DIR);
    super::super::claude::plan_sop_skill_files(&claude_harness_dir, target_dir, prior_manifest)
}

/// Plans every file `install_skills` will copy: same source listing
/// (`list_skill_dirs` + a recursive walk mirroring
/// `copy_skill_dir_recursive`) and same manifest-path prefixing, but
/// only classifies provenance against the destination -- no copy.
fn plan_skill_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&Manifest>,
) -> Result<Vec<PlannedFile>, String> {
    let source_root = harness_dir.join(SKILLS_CONTENT_TYPE_DIR);
    let skill_names = list_skill_dirs(&source_root)?;
    let destination_root = target_dir
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(SKILLS_CONTENT_TYPE_DIR);

    let mut plan = Vec::new();
    for skill_name in skill_names {
        let skill_source = source_root.join(&skill_name);
        let skill_destination = destination_root.join(&skill_name);
        plan_skill_dir_recursive(
            &skill_source,
            &skill_destination,
            &content_manifest_path(
                KONDUCTOR_DESTINATION_ROOT,
                SKILLS_CONTENT_TYPE_DIR,
                &skill_name,
            ),
            prior_manifest,
            &mut plan,
        )?;
    }
    Ok(plan)
}

/// Recursive planning counterpart to `copy_skill_dir_recursive`: walks
/// `source` (the synth output tree) the same way, but only records each
/// file's planned manifest path and provenance -- it stats the
/// DESTINATION side (which may not mirror `source`'s tree at all yet),
/// never reads or writes any file content.
///
/// `pub(in crate::cli::install)`: fully generic over `source`/`destination`/
/// `manifest_prefix` (no Kiro-specific literal anywhere in its body) --
/// `install::claude`'s own skill-planning reuses this directly rather
/// than duplicating it.
pub(in crate::cli::install) fn plan_skill_dir_recursive(
    source: &Path,
    destination: &Path,
    manifest_prefix: &str,
    prior_manifest: Option<&Manifest>,
    plan: &mut Vec<PlannedFile>,
) -> Result<(), String> {
    let entries = std::fs::read_dir(source)
        .map_err(|e| format!("failed to read directory {}: {e}", source.display()))?;
    let mut children: Vec<_> = entries
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("failed to read directory entry: {e}"))?;
    children.sort_by_key(|e| e.file_name());

    for entry in children {
        let name = entry.file_name();
        let name = name
            .to_str()
            .ok_or_else(|| format!("non-UTF-8 file name under {}", source.display()))?;

        let entry_source = source.join(name);
        let entry_destination = destination.join(name);
        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to stat {}: {e}", entry_source.display()))?;

        if file_type.is_dir() {
            plan_skill_dir_recursive(
                &entry_source,
                &entry_destination,
                &format!("{manifest_prefix}/{name}"),
                prior_manifest,
                plan,
            )?;
        } else if file_type.is_file() {
            let manifest_path = format!("{manifest_prefix}/{name}");
            let provenance =
                classify_provenance(&entry_destination, &manifest_path, prior_manifest);
            plan.push(PlannedFile {
                manifest_path,
                provenance,
            });
        }
        // Symlinks and other non-regular entries are skipped, mirroring
        // `copy_skill_dir_recursive`'s own guard -- they never end up
        // in the manifest, so they must never end up in the plan.
    }
    Ok(())
}

// plan_bin_files, install_bin_files, resolve_home_dir, target_dir_is_home,
// plan_local_bin_links, link_bin_files_into_home_local_bin, and
// path_dir_is_on_path_env moved to the sibling `mcp_server` module -- see
// that module for the MCP-binary-copy and PATH-symlink implementation.

/// (already fully manifest-relative at this point, e.g.
/// `.kiro/agents/k-example.json`) and returns a new list with
/// `provenance` filled in. Errors if a copied file's path is not found
/// in the plan -- that would mean the plan and the actual copy pass
/// disagreed on what would be written, which must never happen since
/// both walk the same source listing.
///
/// `pub(in crate::cli::install)`: matches files purely by manifest-path string, with no
/// Kiro-specific literal in its body -- `install::claude` reuses this
/// directly for its own write-ahead-plan reconciliation.
pub(in crate::cli::install) fn attach_provenance(
    files: Vec<ManifestFile>,
    plan: &[PlannedFile],
) -> Result<Vec<ManifestFile>, String> {
    files
        .into_iter()
        .map(|file| {
            let provenance = plan
                .iter()
                .find(|planned| planned.manifest_path == file.path)
                .map(|planned| planned.provenance)
                .ok_or_else(|| {
                    format!(
                        "internal error: {} was copied but not present in the write-ahead plan",
                        file.path
                    )
                })?;
            Ok(ManifestFile {
                path: file.path,
                sha256: file.sha256,
                provenance,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    use super::super::test_support::{
        scratch_dir, seed_mcp_binary, seed_synthed_agent, seed_synthed_agent_with_skill_resource,
        seed_synthed_context, seed_synthed_skill,
    };

    /// The pre-copy (write-ahead) manifest exists and names every
    /// intended path BEFORE any content is written -- proven by
    /// snapshotting the manifest from inside a synthetic hook that runs
    /// before this test's own `install_from_local` call returns. Since
    /// there's no real seam to hook "mid-install" without adding a
    /// permanent test-only seam, this test instead proves the same fact
    /// indirectly and non-vacuously: it corrupts the write-ahead phase
    /// (see `install_from_local_leaves_not_complete_manifest_naming_orphans_on_failure`
    /// below for the actual crash-recovery proof) and, separately here,
    /// proves the plan step alone -- `plan_all_files` -- returns every
    /// intended path without touching disk, which is exactly what
    /// `install_from_local` writes as its first manifest.
    #[test]
    fn plan_all_files_names_every_intended_path_without_writing_anything() {
        let target_dir = scratch_dir("plan-no-write-target");
        let repo_root = scratch_dir("plan-no-write-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{}\n");
        seed_synthed_skill(&repo_root, "code-review", b"body\n", &[]);
        seed_synthed_context(&repo_root, "routing-rules.md", b"# notes\n");
        let harness_dir = repo_root.join("dist/kiro-cli-v2");

        let plan = plan_all_files(&harness_dir, &target_dir, None).expect("planning must succeed");
        let mut paths: Vec<_> = plan.iter().map(|p| p.manifest_path.clone()).collect();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                ".kiro/agents/k-example.json".to_string(),
                ".kiro/context/routing-rules.md".to_string(),
                ".konductor/skills/code-review/SKILL.md".to_string(),
            ]
        );
        // Planning must not have touched disk at all.
        assert!(!target_dir.join(".kiro").exists());
        assert!(!target_dir.join(".konductor").exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Direct proof of the write-ahead crash-safety guarantee
    /// `plan_claude_settings_grant` provides: the combined plan --
    /// exactly what `install_from_local` writes as its `Status::
    /// InProgress` manifest, BEFORE any real content copy happens --
    /// already names `.claude/settings.json` when the target has
    /// Claude Code set up, the MCP binary is built, and at least one
    /// agent declares a packaged skill resource. Without this, a crash
    /// between the Claude grant's own write (near the end of
    /// `install_from_local`) and the final `Status::Complete` rewrite
    /// would leave that mutation completely unrecorded in ANY manifest
    /// on disk.
    #[test]
    fn plan_claude_settings_grant_is_included_in_the_write_ahead_plan() {
        let target_dir = scratch_dir("plan-claude-target");
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        let repo_root = scratch_dir("plan-claude-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");
        let harness_dir = repo_root.join("dist/kiro-cli-v2");

        let mut plan =
            plan_all_files(&harness_dir, &target_dir, None).expect("planning must succeed");
        plan.extend(
            super::super::super::mcp_server::plan_bin_files(&repo_root, &target_dir, None)
                .expect("bin planning must succeed"),
        );
        let claude_plan = plan_claude_settings_grant(&harness_dir, &target_dir, &plan, None)
            .expect("claude planning must succeed");
        assert_eq!(
            claude_plan
                .iter()
                .map(|p| p.manifest_path.clone())
                .collect::<Vec<_>>(),
            vec![".claude/settings.json".to_string()]
        );
        assert_eq!(claude_plan[0].provenance, Provenance::Created);
        // Planning must not have touched disk beyond what the test
        // itself seeded.
        assert!(!target_dir.join(".claude/settings.json").exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn plan_claude_settings_grant_empty_when_claude_not_detected() {
        let target_dir = scratch_dir("plan-claude-no-claude-target");
        // Deliberately no `.claude` dir.
        let repo_root = scratch_dir("plan-claude-no-claude-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");
        let harness_dir = repo_root.join("dist/kiro-cli-v2");

        let mut plan =
            plan_all_files(&harness_dir, &target_dir, None).expect("planning must succeed");
        plan.extend(
            super::super::super::mcp_server::plan_bin_files(&repo_root, &target_dir, None)
                .expect("bin planning must succeed"),
        );
        let claude_plan = plan_claude_settings_grant(&harness_dir, &target_dir, &plan, None)
            .expect("claude planning must succeed");
        assert!(claude_plan.is_empty());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn plan_claude_settings_grant_empty_when_binary_not_planned() {
        let target_dir = scratch_dir("plan-claude-no-binary-target");
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        let repo_root = scratch_dir("plan-claude-no-binary-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        // Deliberately no seed_mcp_binary call.
        let harness_dir = repo_root.join("dist/kiro-cli-v2");

        let mut plan =
            plan_all_files(&harness_dir, &target_dir, None).expect("planning must succeed");
        plan.extend(
            super::super::super::mcp_server::plan_bin_files(&repo_root, &target_dir, None)
                .expect("bin planning must succeed"),
        );
        let claude_plan = plan_claude_settings_grant(&harness_dir, &target_dir, &plan, None)
            .expect("claude planning must succeed");
        assert!(
            claude_plan.is_empty(),
            "no MCP binary planned this run must mean no Claude grant predicted either"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn plan_claude_settings_grant_empty_when_no_skill_bearing_agent() {
        let target_dir = scratch_dir("plan-claude-no-skill-target");
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        let repo_root = scratch_dir("plan-claude-no-skill-repo");
        // An agent with no skill:// resource at all.
        seed_synthed_agent(&repo_root, "k-example", b"{}\n");
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");
        let harness_dir = repo_root.join("dist/kiro-cli-v2");

        let mut plan =
            plan_all_files(&harness_dir, &target_dir, None).expect("planning must succeed");
        plan.extend(
            super::super::super::mcp_server::plan_bin_files(&repo_root, &target_dir, None)
                .expect("bin planning must succeed"),
        );
        let claude_plan = plan_claude_settings_grant(&harness_dir, &target_dir, &plan, None)
            .expect("claude planning must succeed");
        assert!(
            claude_plan.is_empty(),
            "no skill-bearing agent must mean no Claude grant predicted either"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A raw-substring match on `SKILL_RESOURCE_PREFIX` outside the
    /// `resources` array (here, inside `systemPrompt`) must NOT be
    /// enough to predict the Claude grant -- pins the structural
    /// (parsed-array) check this function performs, rather than a
    /// plain `contents.contains(...)` scan of the whole file.
    #[test]
    fn plan_claude_settings_grant_ignores_prefix_outside_resources_array() {
        let target_dir = scratch_dir("plan-claude-prefix-outside-resources-target");
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        let repo_root = scratch_dir("plan-claude-prefix-outside-resources-repo");
        seed_synthed_agent(
            &repo_root,
            "k-example",
            br#"{"name":"k-example","systemPrompt":"mentions skill://skills/foo/SKILL.md in passing","resources":["file://context/AGENTS.md"]}"#,
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");
        let harness_dir = repo_root.join("dist/kiro-cli-v2");

        let mut plan =
            plan_all_files(&harness_dir, &target_dir, None).expect("planning must succeed");
        plan.extend(
            super::super::super::mcp_server::plan_bin_files(&repo_root, &target_dir, None)
                .expect("bin planning must succeed"),
        );
        let claude_plan = plan_claude_settings_grant(&harness_dir, &target_dir, &plan, None)
            .expect("claude planning must succeed");
        assert!(
            claude_plan.is_empty(),
            "a prefix match outside the `resources` array must not predict the Claude grant"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A `resources` entry matching `McpServerPass::matches`'s
    /// deliberately broader condition (`starts_with("skill://")`,
    /// ends with `/SKILL.md`, no `*`) but NOT the narrower
    /// `SKILL_RESOURCE_PREFIX` (`skill://skills/`) convention -- the
    /// post-rewrite absolute form `SkillResourcePass::rewrite` itself
    /// produces -- must still predict the Claude grant. A prediction
    /// that instead approximated via `resources_contain_prefix(...,
    /// SKILL_RESOURCE_PREFIX)`, a narrower check than the real trigger,
    /// would silently miss this case and cause `attach_provenance` to
    /// hard-fail the whole install at runtime (a real "predicted no,
    /// actual yes" divergence, not just a theoretical one).
    #[test]
    fn plan_claude_settings_grant_matches_post_rewrite_absolute_skill_form() {
        let target_dir = scratch_dir("plan-claude-post-rewrite-target");
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        let repo_root = scratch_dir("plan-claude-post-rewrite-repo");
        seed_synthed_agent(
            &repo_root,
            "k-example",
            br#"{"name":"k-example","resources":["skill:///abs/other-skills-dir/foo/SKILL.md"]}"#,
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");
        let harness_dir = repo_root.join("dist/kiro-cli-v2");

        let mut plan =
            plan_all_files(&harness_dir, &target_dir, None).expect("planning must succeed");
        plan.extend(
            super::super::super::mcp_server::plan_bin_files(&repo_root, &target_dir, None)
                .expect("bin planning must succeed"),
        );
        let claude_plan = plan_claude_settings_grant(&harness_dir, &target_dir, &plan, None)
            .expect("claude planning must succeed");
        assert_eq!(
            claude_plan.len(),
            1,
            "a resources entry matching McpServerPass::matches's broader condition \
             must predict the Claude grant even though it doesn't start with \
             SKILL_RESOURCE_PREFIX"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A `resources` entry containing the bare `skill://` substring but
    /// NEITHER real fast-path prefix (`SKILL_RESOURCE_PREFIX`,
    /// `CONTEXT_RESOURCE_PREFIX`) -- the `ws-*` workspace-skills glob
    /// case `McpServerPass::matches` itself excludes via its own
    /// `!contains('*')` check -- is never actually parsed as JSON at
    /// real install time (`copy_agent_files_rewriting_resources`'s own
    /// fast path copies it verbatim). This function's pre-filter is
    /// broader than that real fast path (needed to catch the case
    /// `plan_claude_settings_grant_matches_post_rewrite_absolute_skill_form`
    /// above proves), so a malformed (here: truncated, invalid JSON)
    /// agent file matching only the broad pre-filter must NOT abort
    /// planning -- it must be skipped, exactly as the real install
    /// would skip parsing it.
    #[test]
    fn plan_claude_settings_grant_tolerates_malformed_glob_only_agent() {
        let target_dir = scratch_dir("plan-claude-malformed-glob-target");
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        let repo_root = scratch_dir("plan-claude-malformed-glob-repo");
        // Deliberately invalid JSON (truncated) -- must not matter,
        // since a file whose ONLY "skill://" mention is a `ws-*` glob
        // entry is never actually parsed at real install time either.
        seed_synthed_agent(
            &repo_root,
            "k-example",
            br#"{"name":"k-example","resources":["skill://.kiro/skills/ws-*/SKILL.md""#,
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");
        let harness_dir = repo_root.join("dist/kiro-cli-v2");

        let mut plan =
            plan_all_files(&harness_dir, &target_dir, None).expect("planning must succeed");
        plan.extend(
            super::super::super::mcp_server::plan_bin_files(&repo_root, &target_dir, None)
                .expect("bin planning must succeed"),
        );
        let claude_plan = plan_claude_settings_grant(&harness_dir, &target_dir, &plan, None)
            .expect(
                "a malformed agent whose only skill:// mention is a ws-* glob entry \
                 must not abort planning -- the real install never parses it either",
            );
        assert!(
            claude_plan.is_empty(),
            "a ws-* glob-only entry must not itself predict the Claude grant"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }
}
