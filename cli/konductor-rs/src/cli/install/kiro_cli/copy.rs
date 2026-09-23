// SPDX-License-Identifier: Apache-2.0
//
// install/kiro_cli/copy.rs — copy/install execution for the Kiro CLI
// install strategy. Every function here actually reads from the synth
// output tree and writes to `target_dir` -- see `kiro_cli.rs`'s own
// module doc comment for the full split rationale and the
// write-ahead-sequencing contract these copy passes fulfil.

use std::path::Path;

use super::super::artifact::sha256_hex;
use super::super::manifest::{ManifestFile, Provenance, StrategyManifest};
use super::fs_util::{is_executable, reject_unsafe_file_name, set_executable};
use super::plan::{content_manifest_path, read_skill_scopes_sidecar, read_sop_scopes_sidecar};
use super::{KIRO_DESTINATION_ROOT, KONDUCTOR_DESTINATION_ROOT};
use crate::cli::synth::kiro_cli_v2::{
    AGENTS_CONTENT_TYPE_DIR, CONTEXT_CONTENT_TYPE_DIR, SKILLS_CONTENT_TYPE_DIR,
    SKILL_SCOPES_SIDECAR_FILE, SOPS_CONTENT_TYPE_DIR, SOP_SCOPES_SIDECAR_FILE,
};

/// Prefix a synthed agent JSON's `resources` entry uses for a
/// per-agent context file. Used only for this file's cheap pre-parse
/// skip check below -- the authoritative copy each pass matches
/// against is `resource_rewrite`'s own constant of the same name; kept
/// separate since this one is a textual short-circuit, not a matching
/// rule, though the two must stay equal.
///
/// `pub(in crate::cli::install)`: the sibling `plan` module's own prediction
/// (`plan_claude_settings_grant`) checks the same raw substring, so it
/// re-imports this constant rather than redeclaring a second copy.
pub(in crate::cli::install) const CONTEXT_RESOURCE_PREFIX: &str = "file://context/";

// `resource_rewrite::SKILL_RESOURCE_PREFIX` is used directly below
// (both by this file's own pre-parse skip check, and by
// `plan_claude_settings_grant`'s prediction) rather than a locally
// redeclared copy like `CONTEXT_RESOURCE_PREFIX` above -- unlike that
// constant, this one is load-bearing for a real correctness property
// (`plan_claude_settings_grant`'s prediction must never silently drift
// from `SkillResourcePass`/`McpServerPass::matches`'s own definition),
// so it is shared rather than duplicated.

/// Copies every file from `<harness_dir>/context/` into
/// `<target_dir>/.kiro/context/`, returning manifest entries (`path`
/// relative to `target_dir`, e.g. `.kiro/context/routing-rules.md`).
/// Returns an empty `Vec` (not an error) when the source directory is
/// missing or empty -- `install_agents`' resources rewrite is what
/// actually needs a context file to exist, and it performs its own
/// stat-and-fail check against the destination (see
/// `resource_rewrite::ContextResourcePass::verify`) rather than relying
/// on this function's return value.
///
/// Limitation (shared with `install_agents`): this does not remove a
/// context file a PRIOR install wrote that the current source no longer
/// contains -- it becomes an untracked orphan (absent from the freshly
/// written manifest). Slot-driven cleanup of such orphaned
/// prior-install files across content types is `update`/`uninstall`'s
/// job (the per-file `provenance` this install records is the data that
/// makes it safe); only re-synthed *skills* get in-place dropped-file
/// cleanup today (see `install_skills`).
///
/// Visibility: `pub(in crate::cli::install)`, not private, so `phases.rs` -- a sibling
/// module under `cli::install`, not a dependency crate -- can call this
/// from `ContextInstallPhase::run`, this function's only caller.
/// `pub(in crate::cli::install)` scopes access to `cli::install` and its descendants
/// only, never the whole crate.
pub(in crate::cli::install) fn install_context(
    harness_dir: &Path,
    target_dir: &Path,
) -> Result<Vec<ManifestFile>, String> {
    let source_dir = harness_dir.join(CONTEXT_CONTENT_TYPE_DIR);
    let entries = list_agent_files_like(&source_dir)?;
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let destination = target_dir
        .join(KIRO_DESTINATION_ROOT)
        .join(CONTEXT_CONTENT_TYPE_DIR);
    std::fs::create_dir_all(&destination)
        .map_err(|e| format!("failed to create {}: {e}", destination.display()))?;

    let mut files = copy_agent_files(&source_dir, &destination, entries)?;
    for file in &mut files {
        file.path =
            content_manifest_path(KIRO_DESTINATION_ROOT, CONTEXT_CONTENT_TYPE_DIR, &file.path);
    }
    Ok(files)
}

/// Copies every staged `.sop.md` file from `<harness_dir>/sops/` into
/// `<target_dir>/.konductor/sops/` verbatim -- the raw files
/// `--agent-sop-paths` (see `resource_rewrite/mcp_server.rs`'s `McpServerPass`)
/// points `skill-lookup-mcp` at. Unconditional, not per-agent-filtered:
/// mirrors `install_skills`'s own "copy everything staged, let per-agent
/// scoping happen at MCP launch-arg time" contract -- `--agent-sop-
/// filter` (a glob applied by the launched server process itself, per
/// agent) is what actually scopes visibility, not a selective copy here.
/// Returns an empty `Vec` (not an error) when the source directory is
/// missing or empty, matching `install_context`'s own contract for the
/// exact same reason: nothing here has any use for "no SOPs staged"
/// being an install failure.
///
/// Kept out of `.kiro/`, like `.konductor/skills/` and `.konductor/bin/`
/// -- this is Konductor tooling shared across runtimes, not a Kiro CLI
/// concept.
pub(in crate::cli::install) fn install_sops(
    harness_dir: &Path,
    target_dir: &Path,
) -> Result<Vec<ManifestFile>, String> {
    let source_dir = harness_dir.join(SOPS_CONTENT_TYPE_DIR);
    let entries = list_agent_files_like(&source_dir)?;
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let destination = target_dir
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(SOPS_CONTENT_TYPE_DIR);
    std::fs::create_dir_all(&destination)
        .map_err(|e| format!("failed to create {}: {e}", destination.display()))?;

    let mut files = copy_agent_files(&source_dir, &destination, entries)?;
    for file in &mut files {
        file.path = content_manifest_path(
            KONDUCTOR_DESTINATION_ROOT,
            SOPS_CONTENT_TYPE_DIR,
            &file.path,
        );
    }
    Ok(files)
}

/// Converts every staged `.sop.md` file from `<harness_dir>/sops/` into a
/// `sop-<name>/SKILL.md` file under `<target_dir>/.kiro/skills/`, so each
/// SOP also shows up in Kiro IDE's own native `/` list (Skills, Steering,
/// Powers, Custom Agents) -- Kiro IDE's `/` list is populated only from
/// on-disk files it scans, never from MCP prompts (`skill-lookup-mcp`'s
/// own `.sop.md` serving, which is what `install_sops` above feeds), so
/// without this conversion a SOP served only over MCP would never appear
/// there.
///
/// Purely additive to `install_sops`: the raw `.konductor/sops/<name>.sop.md`
/// copy that `--agent-sop-paths`/`skill-lookup-mcp` reads for the CLI's
/// own `/prompts` remains unchanged -- this writes a SEPARATE, converted
/// file to a separate root, the same way `install::claude::install_sop_skills`
/// does for `.claude/skills/`. `skill-lookup-mcp` itself never scans
/// `.kiro/skills/`, so this file has no effect on `find_skills`/`/prompts`.
///
/// Thin wrapper around `install::claude::install_sop_skills_into`
/// (`destination_root: KIRO_DESTINATION_ROOT`, `disable_model_invocation:
/// false` -- Kiro CLI has no documented equivalent to Claude Code's
/// `disable-model-invocation` frontmatter key, so it is omitted entirely
/// rather than guessed at; see that function's own doc comment) -- reused
/// rather than re-implemented, so the rendered frontmatter/body shape can
/// never silently drift between the two runtimes. Returns an empty `Vec`
/// (not an error) when the source directory is missing or empty, matching
/// `install_sops`'s own contract.
///
/// Visibility: `pub(in crate::cli::install)`, not private -- see
/// `install_context`'s own doc comment above for the reasoning (identical
/// here, for this function's own two callers: `SopInstallPhase::run`'s
/// Kiro branch in `phases.rs`, and `KiroCliV3InstallStrategy::
/// install_from_local` in `kiro_cli_v3.rs`).
pub(in crate::cli::install) fn install_kiro_sop_skills(
    harness_dir: &Path,
    target_dir: &Path,
) -> Result<Vec<ManifestFile>, String> {
    super::super::claude::install_sop_skills_into(
        harness_dir,
        target_dir,
        KIRO_DESTINATION_ROOT,
        false,
    )
}

/// Copies `*.json` files from `<harness_dir>/agents/` into
/// `<target_dir>/.kiro/agents/`, returning their manifest entries
/// (`path` relative to `target_dir`, e.g. `.kiro/agents/foo.json`).
/// Returns an empty `Vec` (not an error) when the source directory is
/// missing or has no agent files -- the caller decides whether "nothing
/// to install anywhere" is an error.
///
/// Each agent file's `resources` entries of the form
/// `file://context/<name>` and `skill://skills/<name>/SKILL.md` are
/// rewritten to absolute paths as part of the copy (see
/// `copy_agent_files_rewriting_resources`), and every rewritten target
/// is stat'd to exist before this function returns -- the runtime's own
/// `agent validate`/`agent list` accept a dangling `resources` entry
/// silently, so this install path is the only check that catches it.
/// An agent's `mcpServers` block is rewritten the same way: an entry
/// naming one of `mcp_server::MCP_SERVER_BINARY_NAMES` gets that
/// binary's absolute installed path injected, only when this run
/// actually copied it.
///
/// Limitation: like `install_context`, this does not remove an agent
/// file a PRIOR install wrote that the current source no longer contains
/// -- it becomes an untracked orphan (absent from the freshly written
/// manifest). Orphan cleanup across content types is deferred to
/// `update`/`uninstall` (the recorded `provenance` is what will make it
/// safe).
///
/// `bin_files` is the set of MCP server binaries THIS run actually
/// copied (from `mcp_server::install_bin_files`, called before this
/// function) -- passed in rather than re-derived, so this can never
/// inject a path for a binary not actually copied to disk.
///
/// Visibility: `pub(in crate::cli::install)`, not private -- see `install_context`'s own
/// doc comment above for the reasoning (identical here, for this
/// function's own only caller, `AgentInstallPhase::run` in `phases.rs`,
/// instead of `ContextInstallPhase::run`).
///
/// The returned `bool` is whether the V2 `mcpServers.konductor-skills`
/// grant was actually injected into at least one agent this run --
/// `AgentInstallPhase::run` uses it to decide whether to also apply the
/// Claude/V3 settings grant (see `resource_rewrite/claude_settings.rs`'s "V3/Claude
/// Code permission grant" section), which must never fire on a run
/// where the V2 side injected nothing.
pub(in crate::cli::install) fn install_agents(
    harness_dir: &Path,
    target_dir: &Path,
    bin_files: &[ManifestFile],
) -> Result<(Vec<ManifestFile>, bool), String> {
    let source_dir = harness_dir.join(AGENTS_CONTENT_TYPE_DIR);
    let entries = list_agent_files(&source_dir)?;
    if entries.is_empty() {
        return Ok((Vec::new(), false));
    }

    let destination = target_dir
        .join(KIRO_DESTINATION_ROOT)
        .join(AGENTS_CONTENT_TYPE_DIR);
    std::fs::create_dir_all(&destination)
        .map_err(|e| format!("failed to create {}: {e}", destination.display()))?;

    let context_dir = target_dir
        .join(KIRO_DESTINATION_ROOT)
        .join(CONTEXT_CONTENT_TYPE_DIR);
    let skills_dir = target_dir
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(SKILLS_CONTENT_TYPE_DIR);
    let bin_dir = target_dir
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(super::super::mcp_server::BIN_CONTENT_TYPE_DIR);

    // Read once, before the per-agent install loop below -- never
    // re-read per agent -- so every agent this run installs sees the
    // exact same scoping snapshot from this one synth output tree.
    let agent_sop_names = read_sop_scopes_sidecar(&source_dir)?;
    let agent_skill_names = read_skill_scopes_sidecar(&source_dir)?;

    // Built here (rather than inside `copy_agent_files_rewriting_
    // resources`) so that function takes one `RewriteContext` instead
    // of seven separate fields -- keeps it under clippy's
    // `too_many_arguments` threshold now that `agent_sop_names`/
    // `agent_skill_names` are the fifth and sixth fields on the context.
    let ctx = super::super::resource_rewrite::RewriteContext {
        context_dir: &context_dir,
        skills_dir: &skills_dir,
        bin_dir: &bin_dir,
        bin_files,
        agent_sop_names: &agent_sop_names,
        agent_skill_names: &agent_skill_names,
    };
    let (mut files, any_mcp_server_injected) =
        copy_agent_files_rewriting_resources(&source_dir, &destination, &ctx, entries)?;
    for file in &mut files {
        file.path =
            content_manifest_path(KIRO_DESTINATION_ROOT, AGENTS_CONTENT_TYPE_DIR, &file.path);
    }
    Ok((files, any_mcp_server_injected))
}

/// Copies each skill directory under `<harness_dir>/skills/` into
/// `<target_dir>/.konductor/skills/<name>/`, returning manifest entries
/// for every file copied (`path` relative to `target_dir`, e.g.
/// `.konductor/skills/code-review/SKILL.md`). MERGES: only replaces
/// skill directories present in the source, never touching sibling
/// skill directories at the destination that this install did not
/// emit. Returns an empty `Vec` (not an error) when the source
/// directory is missing or has no skill subdirectories.
///
/// This never wholesale-removes a destination skill directory. It
/// copies the synthed skill in (overwriting colliding files), then
/// deletes ONLY the files a prior Konductor install recorded under this
/// exact skill (in `prior_manifest`) that this run did not re-write --
/// so a file dropped from the source doesn't linger. A file never in
/// our manifest (a foreign, hand-authored one that merely shares a
/// synthed skill's name) is therefore never removed, on the first
/// install OR any reinstall -- honoring the
/// `ReplacedForeign`/uninstall-safety contract the provenance system
/// establishes elsewhere. (A wholesale `remove_dir_all` gated on
/// "owned" would preserve foreign files only until this install
/// recorded the skill, then wipe them on the next run.)
///
/// Limitation: the dropped-file cleanup only visits skills still present
/// in the source (the loop below iterates the source skill list). A
/// skill removed ENTIRELY from the source is never visited, so its
/// prior-install files remain on disk as untracked orphans -- wholesale
/// orphan removal is `update`/`uninstall`'s job, as for agents/context.
///
/// Visibility: `pub(in crate::cli::install)`, not private -- see `install_context`'s own
/// doc comment above for the reasoning (identical here, for this
/// function's own only caller, `SkillInstallPhase::run` in `phases.rs`,
/// instead of `ContextInstallPhase::run`).
pub(in crate::cli::install) fn install_skills(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
) -> Result<Vec<ManifestFile>, String> {
    let source_root = harness_dir.join(SKILLS_CONTENT_TYPE_DIR);
    let skill_names = list_skill_dirs(&source_root)?;
    if skill_names.is_empty() {
        return Ok(Vec::new());
    }

    let destination_root = target_dir
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(SKILLS_CONTENT_TYPE_DIR);
    std::fs::create_dir_all(&destination_root)
        .map_err(|e| format!("failed to create {}: {e}", destination_root.display()))?;

    let mut files = Vec::new();
    for skill_name in skill_names {
        reject_unsafe_file_name(&skill_name)?;
        let skill_source = source_root.join(&skill_name);
        let skill_destination = destination_root.join(&skill_name);

        let manifest_prefix = content_manifest_path(
            KONDUCTOR_DESTINATION_ROOT,
            SKILLS_CONTENT_TYPE_DIR,
            &skill_name,
        );

        std::fs::create_dir_all(&skill_destination)
            .map_err(|e| format!("failed to create {}: {e}", skill_destination.display()))?;

        // Copy the synthed skill in, overwriting any colliding files.
        // Files that live ONLY in the destination -- whether foreign
        // (hand-authored, never in our manifest) or stale (ours from a
        // prior install, but dropped from the source since) -- are left
        // in place by the copy itself.
        let before_len = files.len();
        copy_skill_dir_recursive(
            &skill_source,
            &skill_destination,
            &manifest_prefix,
            &mut files,
        )?;

        // Then delete ONLY the files a prior Konductor install recorded
        // under this exact skill (present in `prior_manifest`) that this
        // run did NOT just re-write -- i.e. files the source dropped, so
        // they don't linger. A file that was never in our manifest (a
        // foreign, hand-authored one that merely shares a synthed skill's
        // name) is never eligible for removal, on the first install OR
        // any reinstall. This deliberately replaces a wholesale
        // `remove_dir_all` gated on "owned": that honored the
        // preserve-foreign-files contract only on the FIRST install,
        // then -- once this install recorded the skill and the directory
        // became "owned" -- wiped those same foreign files on the next
        // reinstall.
        let written_this_skill: std::collections::HashSet<String> =
            files[before_len..].iter().map(|f| f.path.clone()).collect();
        if let Some(prior) = prior_manifest {
            let prefix = format!("{manifest_prefix}/");
            for prior_file in &prior.files {
                if prior_file.path.starts_with(&prefix)
                    && !written_this_skill.contains(&prior_file.path)
                {
                    let stale = target_dir.join(&prior_file.path);
                    // Best-effort: the user may have already removed it.
                    let _ = std::fs::remove_file(&stale);
                    // Prune any now-empty ancestor directories up to (but
                    // not including) this skill's own root, so a
                    // source-dropped nested subdir (e.g. `scripts/deep/`)
                    // doesn't linger as an empty skeleton -- matching the
                    // exact on-disk tree the prior wholesale replace
                    // produced. `remove_dir` only succeeds on an EMPTY
                    // directory, so a dir still holding a foreign file is
                    // never removed, and the loop stops at the skill root.
                    let mut ancestor = stale.parent();
                    while let Some(dir) = ancestor {
                        if dir == skill_destination || !dir.starts_with(&skill_destination) {
                            break;
                        }
                        if std::fs::remove_dir(dir).is_err() {
                            break;
                        }
                        ancestor = dir.parent();
                    }
                }
            }
        }
    }
    Ok(files)
}

/// Recursively copies every file under `source` into `destination`
/// (creating subdirectories as needed), preserving each file's
/// executable bit and appending a `ManifestFile` per copied file with
/// `path` set to `<manifest_prefix>/<relative path from source>`.
/// Rejects any unsafe path segment (name or auxiliary relative path)
/// before it is used to build a destination path.
///
/// `pub(in crate::cli::install)`: no Kiro-specific literal anywhere in its body --
/// `install::claude` reuses this directly for its own skill copy.
pub(in crate::cli::install) fn copy_skill_dir_recursive(
    source: &Path,
    destination: &Path,
    manifest_prefix: &str,
    files: &mut Vec<ManifestFile>,
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
        reject_unsafe_file_name(name)?;

        let entry_source = source.join(name);
        let entry_destination = destination.join(name);
        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to stat {}: {e}", entry_source.display()))?;

        if file_type.is_dir() {
            std::fs::create_dir_all(&entry_destination)
                .map_err(|e| format!("failed to create {}: {e}", entry_destination.display()))?;
            copy_skill_dir_recursive(
                &entry_source,
                &entry_destination,
                &format!("{manifest_prefix}/{name}"),
                files,
            )?;
        } else if file_type.is_file() {
            let data = std::fs::read(&entry_source)
                .map_err(|e| format!("failed to read {}: {e}", entry_source.display()))?;
            let executable = is_executable(&entry_source)
                .map_err(|e| format!("failed to stat {}: {e}", entry_source.display()))?;
            crate::cli::atomic_write::write_atomic(&entry_destination, &data)
                .map_err(|e| format!("failed to write {}: {e}", entry_destination.display()))?;
            set_executable(&entry_destination, executable).map_err(|e| {
                format!(
                    "failed to set permissions on {}: {e}",
                    entry_destination.display()
                )
            })?;
            files.push(ManifestFile {
                path: format!("{manifest_prefix}/{name}"),
                sha256: Some(sha256_hex(&data)),
                // Overwritten by `attach_provenance` once the caller
                // matches this path back against the write-ahead plan
                // -- this placeholder is never the value actually
                // written to disk.
                provenance: Provenance::Created,
            });
        }
        // Symlinks and other non-regular entries are skipped: synth
        // output never contains them (see parse_canonical.rs's own
        // symlink rejection), so encountering one here would mean the
        // source tree was hand-modified after synth ran.
    }
    Ok(())
}

/// Lists immediate subdirectory names under `dir`, sorted for
/// deterministic install order. Returns an empty `Vec` (not an error)
/// when `dir` itself is missing.
///
/// `pub(in crate::cli::install)`: no Kiro-specific literal anywhere in its body --
/// `install::claude` reuses this directly for its own skill listing.
pub(in crate::cli::install) fn list_skill_dirs(dir: &Path) -> Result<Vec<String>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("failed to read directory {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        if !entry
            .file_type()
            .map_err(|e| format!("failed to stat directory entry: {e}"))?
            .is_dir()
        {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}

/// Copies each named file from `source_dir` into `destination`,
/// rejecting any unsafe name before it is used to build a destination
/// path. Called by `install_from_local` with a real directory listing;
/// takes the entry list as a parameter (rather than re-listing
/// `source_dir` itself) so this exact copy path can also be driven with
/// a crafted entry list in tests.
///
/// `pub(in crate::cli::install)`: a verbatim, no-rewrite copy with no Kiro-specific
/// literal in its body -- `install::claude` reuses this directly for
/// its own agent-file copy, which (unlike `install_agents` here) needs
/// no `resources`/`mcpServers` rewrite pass.
pub(in crate::cli::install) fn copy_agent_files(
    source_dir: &Path,
    destination: &Path,
    file_names: Vec<String>,
) -> Result<Vec<ManifestFile>, String> {
    let mut files = Vec::with_capacity(file_names.len());
    for file_name in file_names {
        reject_unsafe_file_name(&file_name)?;
        let src = source_dir.join(&file_name);
        let dst = destination.join(&file_name);
        let bytes =
            std::fs::read(&src).map_err(|e| format!("failed to read {}: {e}", src.display()))?;
        crate::cli::atomic_write::write_atomic(&dst, &bytes)
            .map_err(|e| format!("failed to write {}: {e}", dst.display()))?;
        files.push(ManifestFile {
            path: file_name,
            sha256: Some(sha256_hex(&bytes)),
            // Overwritten by `attach_provenance` -- see the comment on
            // the equivalent construction in `copy_skill_dir_recursive`.
            provenance: Provenance::Created,
        });
    }
    Ok(files)
}

/// Same as `copy_agent_files`, but also runs
/// `resource_rewrite::standard_passes` over each agent's parsed JSON
/// before writing it: rewrites `file://context/<name>` and
/// `skill://skills/<name>/SKILL.md` resources to absolute paths, and
/// injects an `mcpServers.konductor-skills` entry for a skill-bearing
/// agent when the MCP binary was installed. See `resource_rewrite`'s
/// module doc comment for how the passes are ordered.
///
/// Always reads `src` fresh from `dist/` (pristine relative form), so
/// a rewritten value is never actually re-encountered in practice.
/// After the pipeline runs, every rewritten target is stat-checked to
/// exist; a missing one is a hard error, since `agent validate`/`agent
/// list` accept a dangling `resources` entry silently.
fn copy_agent_files_rewriting_resources(
    source_dir: &Path,
    destination: &Path,
    ctx: &super::super::resource_rewrite::RewriteContext<'_>,
    file_names: Vec<String>,
) -> Result<(Vec<ManifestFile>, bool), String> {
    let passes = super::super::resource_rewrite::standard_passes();

    let mut files = Vec::with_capacity(file_names.len());
    let mut any_mcp_server_injected = false;
    for file_name in file_names {
        reject_unsafe_file_name(&file_name)?;
        let src = source_dir.join(&file_name);
        let dst = destination.join(&file_name);
        let original_bytes =
            std::fs::read(&src).map_err(|e| format!("failed to read {}: {e}", src.display()))?;

        // Whether THIS agent (by its file name, which is always
        // `<agent-name>.json` -- see `kiro_cli_v2::write_agent_file`)
        // has a non-empty `_sop_scopes.json`/`_skill_scopes.json` entry.
        // Checked from the FILE NAME rather than by parsing the JSON
        // first, so this widens the verbatim-copy fast path below
        // without paying for a parse on every agent: an agent's own
        // declared SOPs/skill names are never visible in its raw JSON
        // content (that's the whole point of the sidecars), so no
        // substring check on `contents` could ever detect this case the
        // way `CONTEXT_RESOURCE_PREFIX`/`SKILL_RESOURCE_PREFIX` detect
        // theirs.
        let agent_name = file_name.strip_suffix(".json").unwrap_or(&file_name);
        let agent_has_sop_names = ctx
            .agent_sop_names
            .get(agent_name)
            .is_some_and(|names| !names.is_empty());
        let agent_has_skill_names = ctx
            .agent_skill_names
            .get(agent_name)
            .is_some_and(|names| !names.is_empty());

        // No rewrite prefix present, and this agent has no SOP or
        // skill-name scoping either -> copy verbatim, skipping the
        // parse/re-serialize round trip, so an unaffected agent stays
        // byte-identical to synth's `dist/` output. Such an agent can
        // never have gotten an mcpServers injection either (that
        // injection is scoped to skill-bearing, SOP-scoped, or
        // skill-name-scoped agents, which always contain
        // SKILL_RESOURCE_PREFIX or have a non-empty sidecar entry), so
        // `any_mcp_server_injected` is left unchanged here.
        let contents = String::from_utf8(original_bytes.clone())
            .map_err(|e| format!("{} is not valid UTF-8: {e}", src.display()))?;
        if !contents.contains(CONTEXT_RESOURCE_PREFIX)
            && !contents.contains(super::super::resource_rewrite::SKILL_RESOURCE_PREFIX)
            && !agent_has_sop_names
            && !agent_has_skill_names
        {
            crate::cli::atomic_write::write_atomic(&dst, &original_bytes)
                .map_err(|e| format!("failed to write {}: {e}", dst.display()))?;
            files.push(ManifestFile {
                path: file_name,
                sha256: Some(sha256_hex(&original_bytes)),
                // Overwritten by `attach_provenance`.
                provenance: Provenance::Created,
            });
            continue;
        }

        let mut value: serde_json::Value = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {} as JSON: {e}", src.display()))?;
        super::super::resource_rewrite::apply_all(&passes, &mut value, ctx, &src)?;
        if value
            .get("mcpServers")
            .and_then(|m| m.get(super::super::resource_rewrite::MCP_SERVER_NAME))
            .is_some()
        {
            any_mcp_server_injected = true;
        }
        let mut bytes = serde_json::to_vec_pretty(&value)
            .map_err(|e| format!("failed to re-serialize {}: {e}", src.display()))?;
        bytes.push(b'\n');
        crate::cli::atomic_write::write_atomic(&dst, &bytes)
            .map_err(|e| format!("failed to write {}: {e}", dst.display()))?;
        files.push(ManifestFile {
            path: file_name,
            sha256: Some(sha256_hex(&bytes)),
            // Overwritten by `attach_provenance`.
            provenance: Provenance::Created,
        });
    }
    Ok((files, any_mcp_server_injected))
}

/// Lists `*.json` file names (not full paths) directly under `dir`,
/// sorted for deterministic install order. Returns an empty `Vec` (not
/// an error) when `dir` itself is missing -- the empty-source case is
/// handled uniformly by the caller regardless of which of "missing
/// directory" / "directory exists but has no agent files" occurred.
///
/// `pub(in crate::cli::install)`: the sibling `plan` module's own planning pass
/// (`plan_agent_files`, `plan_claude_settings_grant`) reuses this
/// directly rather than re-listing the same directory a second way.
pub(in crate::cli::install) fn list_agent_files(dir: &Path) -> Result<Vec<String>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("failed to read directory {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        // Use the DirEntry's own file type, which does NOT follow
        // symlinks on Unix, so a symlink named e.g. `foo.json` is
        // skipped rather than silently dereferenced and its target's
        // content copied in -- matching the skill path and the "synth
        // output never contains symlinks" guarantee, which applies
        // equally to agents. Also skips a directory literally named
        // `foo.json`, which would otherwise reach `copy_agent_files`'s
        // `std::fs::read(&src)` and fail reading a directory as a file,
        // aborting the whole install over one spurious entry.
        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to stat directory entry: {e}"))?;
        if !file_type.is_file() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            // The SOP-scope and skill-scope sidecars (`_sop_scopes.json`,
            // `_skill_scopes.json`) live in this same directory (see
            // `kiro_cli_v2::SOP_SCOPES_SIDECAR_FILE`/
            // `SKILL_SCOPES_SIDECAR_FILE`'s own doc comments) but are not
            // agent files -- neither must ever be copied to
            // `.kiro/agents/` or parsed/rewritten as one. Read separately
            // via `read_sop_scopes_sidecar`/`read_skill_scopes_sidecar`.
            if name == SOP_SCOPES_SIDECAR_FILE || name == SKILL_SCOPES_SIDECAR_FILE {
                continue;
            }
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}

/// Lists every regular file's name directly under `dir`, sorted for
/// deterministic install order, with no extension filter (unlike
/// `list_agent_files`, which only accepts synth's own `agents/`
/// output). Returns an empty `Vec` (not an error) when `dir` itself is
/// missing. A directory entry is skipped rather than erroring, for the
/// same "one spurious entry shouldn't abort the whole install" reason
/// documented on `list_agent_files`.
///
/// `pub(in crate::cli::install)`: the sibling `plan` module's own `plan_context_files`
/// reuses this directly rather than re-listing the same directory a
/// second way.
pub(in crate::cli::install) fn list_agent_files_like(dir: &Path) -> Result<Vec<String>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("failed to read directory {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        // DirEntry file type (does not follow symlinks on Unix): skip
        // symlinks and other non-regular entries, matching the "synth
        // output never contains symlinks" guarantee and the skill path.
        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to stat directory entry: {e}"))?;
        if !file_type.is_file() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}
