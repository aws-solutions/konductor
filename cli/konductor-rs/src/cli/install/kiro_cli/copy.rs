// SPDX-License-Identifier: Apache-2.0
//
// install/kiro_cli/copy.rs — copy/install execution for the Kiro CLI
// install strategy. Every function here reads from the synth output
// tree and writes to `target_dir` -- see `kiro_cli.rs`'s own module
// doc comment for the full split rationale and the write-ahead-
// sequencing contract these copy passes fulfil.

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
/// against is `resource_rewrite`'s own constant of the same name.
///
/// `pub(in crate::cli::install)`: the sibling `plan` module's own
/// prediction checks the same raw substring and reuses this constant.
pub(in crate::cli::install) const CONTEXT_RESOURCE_PREFIX: &str = "file://context/";

// `resource_rewrite::SKILL_RESOURCE_PREFIX` is used directly below
// rather than a locally redeclared copy like `CONTEXT_RESOURCE_PREFIX`
// above -- this one is load-bearing for a real correctness property
// (`plan_claude_settings_grant`'s prediction must never drift from
// `SkillResourcePass`/`McpServerPass::matches`'s own definition), so it
// is shared rather than duplicated.

/// Copies every file from `<harness_dir>/context/` into
/// `<target_dir>/.kiro/context/`, returning manifest entries. Returns
/// an empty `Vec` (not an error) when the source directory is missing
/// or empty -- `install_agents`'s resources rewrite is what actually
/// needs a context file to exist, and performs its own stat-and-fail
/// check against the destination.
///
/// Limitation (shared with `install_agents`): this does not remove a
/// context file a prior install wrote that the current source no
/// longer contains -- it becomes an untracked orphan. Orphan cleanup
/// across content types is `update`/`uninstall`'s job; only re-synthed
/// *skills* get in-place dropped-file cleanup today (see
/// `install_skills`).
///
/// Visibility: `pub(in crate::cli::install)` so `phases.rs` can call
/// this from `ContextInstallPhase::run`, this function's only caller.
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
/// `--agent-sop-paths` points `skill-lookup-mcp` at. Unconditional, not
/// per-agent-filtered: `--agent-sop-filter` (applied by the launched
/// server process itself, per agent) is what actually scopes
/// visibility, not a selective copy here. Returns an empty `Vec` (not
/// an error) when the source directory is missing or empty.
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

/// Converts every staged `.sop.md` file from `<harness_dir>/sops/` into
/// a `sop-<name>/SKILL.md` file under `<target_dir>/.kiro/skills/`, so
/// each SOP also shows up in Kiro IDE's own native `/` list -- that
/// list is populated only from on-disk files it scans, never from MCP
/// prompts (`skill-lookup-mcp`'s own `.sop.md` serving, which is what
/// `install_sops` feeds), so without this conversion a SOP served only
/// over MCP would never appear there.
///
/// Purely additive to `install_sops`: the raw
/// `.konductor/sops/<name>.sop.md` copy remains unchanged -- this
/// writes a separate, converted file to a separate root, the same way
/// `install::claude::install_sop_skills` does for `.claude/skills/`.
/// `skill-lookup-mcp` itself never scans `.kiro/skills/`.
///
/// Thin wrapper around `install::claude::install_sop_skills_into`
/// (`destination_root: KIRO_DESTINATION_ROOT`, `disable_model_invocation:
/// false` -- Kiro CLI has no documented equivalent to Claude Code's
/// `disable-model-invocation` frontmatter key, so it is omitted
/// entirely). Returns an empty `Vec` (not an error) when the source
/// directory is missing or empty, matching `install_sops`'s contract.
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
/// `<target_dir>/.kiro/agents/`, returning their manifest entries.
/// Returns an empty `Vec` (not an error) when the source directory is
/// missing or has no agent files.
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
/// file a prior install wrote that the current source no longer
/// contains -- it becomes an untracked orphan.
///
/// `bin_files` is the set of MCP server binaries THIS run actually
/// copied, passed in rather than re-derived, so this can never inject
/// a path for a binary not actually copied to disk.
///
/// The returned `bool` is whether the V2 `mcpServers.konductor-skills`
/// grant was actually injected into at least one agent this run --
/// `AgentInstallPhase::run` uses it to decide whether to also apply
/// the Claude/V3 settings grant and telemetry hooks, which must never
/// fire on a run where the V2 side injected nothing.
pub(in crate::cli::install) fn install_agents(
    harness_dir: &Path,
    target_dir: &Path,
    bin_files: &[ManifestFile],
    no_telemetry: bool,
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

    // Read once, before the per-agent install loop below, so every
    // agent this run installs sees the same scoping snapshot.
    let agent_sop_names = read_sop_scopes_sidecar(&source_dir)?;
    let agent_skill_names = read_skill_scopes_sidecar(&source_dir)?;

    // Built here rather than inline so `copy_agent_files_rewriting_
    // resources` takes one `RewriteContext` instead of separate fields.
    let ctx = super::super::resource_rewrite::RewriteContext {
        context_dir: &context_dir,
        skills_dir: &skills_dir,
        bin_dir: &bin_dir,
        bin_files,
        agent_sop_names: &agent_sop_names,
        agent_skill_names: &agent_skill_names,
    };
    let (mut files, any_mcp_server_injected) = copy_agent_files_rewriting_resources(
        &source_dir,
        &destination,
        &ctx,
        entries,
        no_telemetry,
    )?;
    for file in &mut files {
        file.path =
            content_manifest_path(KIRO_DESTINATION_ROOT, AGENTS_CONTENT_TYPE_DIR, &file.path);
    }
    Ok((files, any_mcp_server_injected))
}

/// Copies each skill directory under `<harness_dir>/skills/` into
/// `<target_dir>/.konductor/skills/<name>/`, returning manifest entries
/// for every file copied. Merges: only replaces skill directories
/// present in the source, never touching sibling skill directories at
/// the destination this install did not emit. Returns an empty `Vec`
/// (not an error) when the source directory is missing or has no skill
/// subdirectories.
///
/// This never wholesale-removes a destination skill directory. It
/// copies the synthed skill in (overwriting colliding files), then
/// deletes only the files a prior Konductor install recorded under
/// this exact skill that this run did not re-write, so a file dropped
/// from the source doesn't linger. A file never in our manifest (a
/// foreign, hand-authored one sharing a synthed skill's name) is never
/// removed, honoring the `ReplacedForeign`/uninstall-safety contract
/// the provenance system establishes elsewhere.
///
/// Limitation: the dropped-file cleanup only visits skills still
/// present in the source. A skill removed entirely from the source is
/// never visited, so its prior-install files remain on disk as
/// untracked orphans -- wholesale orphan removal is
/// `update`/`uninstall`'s job.
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
        // Files that live only in the destination (foreign or stale)
        // are left in place by the copy itself.
        let before_len = files.len();
        copy_skill_dir_recursive(
            &skill_source,
            &skill_destination,
            &manifest_prefix,
            &mut files,
        )?;

        // Then delete only the files a prior Konductor install recorded
        // under this exact skill that this run did not just re-write --
        // files the source dropped. A file never in our manifest (a
        // foreign, hand-authored one sharing a synthed skill's name) is
        // never eligible for removal. This deliberately replaces a
        // wholesale `remove_dir_all` gated on "owned": that honored the
        // preserve-foreign-files contract only on the first install,
        // then wiped those same foreign files on the next reinstall.
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
                    // Prune any now-empty ancestor directories up to
                    // (but not including) this skill's own root, so a
                    // source-dropped nested subdir doesn't linger as an
                    // empty skeleton. `remove_dir` only succeeds on an
                    // empty directory, so a dir still holding a foreign
                    // file is never removed.
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
/// Rejects any unsafe path segment before it is used to build a
/// destination path.
///
/// `pub(in crate::cli::install)`: no Kiro-specific literal anywhere in
/// its body -- `install::claude` reuses this directly for its own
/// skill copy.
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
                // Overwritten by `attach_provenance` once matched back
                // against the write-ahead plan.
                provenance: Provenance::Created,
            });
        }
        // Symlinks and other non-regular entries are skipped: synth
        // output never contains them.
    }
    Ok(())
}

/// Lists immediate subdirectory names under `dir`, sorted for
/// deterministic install order. Returns an empty `Vec` (not an error)
/// when `dir` itself is missing.
///
/// `pub(in crate::cli::install)`: no Kiro-specific literal anywhere in
/// its body -- `install::claude` reuses this directly for its own
/// skill listing.
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
/// path. Takes the entry list as a parameter (rather than re-listing
/// `source_dir` itself) so this exact copy path can also be driven
/// with a crafted entry list in tests.
///
/// `pub(in crate::cli::install)`: a verbatim, no-rewrite copy with no
/// Kiro-specific literal in its body -- `install::claude` reuses this
/// directly for its own agent-file copy, which (unlike `install_agents`
/// here) needs no `resources`/`mcpServers` rewrite pass.
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
            // Overwritten by `attach_provenance`.
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
/// agent when the MCP binary was installed, and, unless `no_telemetry`,
/// adds the `hooks.agentSpawn` telemetry hook. See `resource_rewrite`'s
/// module doc comment for how the passes are ordered.
///
/// Always reads `src` fresh from `dist/`, so a rewritten value is
/// never actually re-encountered. After the pipeline runs, every
/// rewritten target is stat-checked to exist; a missing one is a hard
/// error, since `agent validate`/`agent list` accept a dangling
/// `resources` entry silently.
fn copy_agent_files_rewriting_resources(
    source_dir: &Path,
    destination: &Path,
    ctx: &super::super::resource_rewrite::RewriteContext<'_>,
    file_names: Vec<String>,
    no_telemetry: bool,
) -> Result<(Vec<ManifestFile>, bool), String> {
    let passes = super::super::resource_rewrite::standard_passes(no_telemetry);

    let mut files = Vec::with_capacity(file_names.len());
    let mut any_mcp_server_injected = false;
    for file_name in file_names {
        reject_unsafe_file_name(&file_name)?;
        let src = source_dir.join(&file_name);
        let dst = destination.join(&file_name);
        let original_bytes =
            std::fs::read(&src).map_err(|e| format!("failed to read {}: {e}", src.display()))?;

        // Whether this agent has a non-empty `_sop_scopes.json`/
        // `_skill_scopes.json` entry, checked by file name rather than
        // by parsing the JSON first: an agent's declared SOPs/skill
        // names are never visible in its raw JSON content.
        let agent_name = file_name.strip_suffix(".json").unwrap_or(&file_name);
        let agent_has_sop_names = ctx
            .agent_sop_names
            .get(agent_name)
            .is_some_and(|names| !names.is_empty());
        let agent_has_skill_names = ctx
            .agent_skill_names
            .get(agent_name)
            .is_some_and(|names| !names.is_empty());

        // Fast path: no rewrite prefix present, this agent has no SOP
        // or skill-name scoping, and telemetry is disabled -> copy
        // verbatim, skipping the parse/re-serialize round trip, so an
        // unaffected agent stays byte-identical to synth's `dist/`
        // output.
        //
        // `no_telemetry` is required in this condition:
        // `TelemetryHookPass::matches` is unconditionally `true`, so
        // without this clause an agent matching none of the other
        // conditions would take this fast path and never reach
        // `apply_all` when telemetry is enabled, silently skipping hook
        // injection for exactly the agents that most need it.
        let contents = String::from_utf8(original_bytes.clone())
            .map_err(|e| format!("{} is not valid UTF-8: {e}", src.display()))?;
        if no_telemetry
            && !contents.contains(CONTEXT_RESOURCE_PREFIX)
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
/// an error) when `dir` itself is missing.
///
/// `pub(in crate::cli::install)`: the sibling `plan` module reuses this
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
        // DirEntry's own file type does not follow symlinks on Unix,
        // so a symlink or a directory named e.g. `foo.json` is skipped
        // rather than reaching `copy_agent_files`'s read and aborting
        // the whole install over one spurious entry.
        let file_type = entry
            .file_type()
            .map_err(|e| format!("failed to stat directory entry: {e}"))?;
        if !file_type.is_file() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            // The SOP-scope and skill-scope sidecars live in this same
            // directory but are not agent files -- never copy or
            // rewrite either as one.
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
/// `list_agent_files`). Returns an empty `Vec` (not an error) when
/// `dir` itself is missing.
///
/// `pub(in crate::cli::install)`: the sibling `plan` module's own
/// `plan_context_files` reuses this directly.
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
        // symlinks and other non-regular entries.
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
