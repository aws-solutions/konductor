// SPDX-License-Identifier: Apache-2.0
//
// install/kiro_cli_v3.rs — `InstallStrategy` for the Kiro CLI V3 (KAS)
// runtime.
//
// Reuses V2's content-type layout and harness-agnostic planning/listing
// primitives verbatim (`plan_all_files`, `install_context`,
// `install_skills`, `install_sops`, `list_agent_files`), parameterized
// only by this harness's own directory name: `KiroCliV3Transformer`
// stages `dist/kiro-v3/` using the same content-type directory constants
// as `KiroCliV2Transformer`. Agent installation is the one exception --
// see below.
//
// Runs the same `resource_rewrite::ResourceRewritePass` pipeline V2's
// `kiro_cli::install_agents` runs, via `standard_passes_v3`:
// `ContextResourcePass`/`SkillResourcePass` are reused UNCHANGED (V3's
// `resources` field is rendered in the identical shape as V2's). The one
// V3-specific piece is `McpServerPassV3`: it injects the same
// `mcpServers.konductor-skills` entry as V2's `McpServerPass`, but
// authorizes it via a `permissions.rules[]` entry instead of V2's
// `tools`/`allowedTools` pair, since V3 has no `allowedTools` field (see
// `resource_rewrite.rs`'s own doc comment on `McpServerPassV3` for the
// full authorization rationale).
//
// Copies the `skill-lookup-mcp` MCP server binary
// (`super::mcp_server::install_bin_files`) before installing agents, the
// same ordering `phases.rs`'s `McpInstallPhase` enforces ahead of
// `AgentInstallPhase` for V2 -- the resource-rewrite pipeline needs
// `bin_files` to know whether this run actually copied the binary before
// it can inject a path to it.
//
// No `InstallPhase` pipeline (`phases.rs`) is used: that pipeline's
// `AgentInstallPhase` also performs the ADDITIVE Claude/V3
// settings.json grant, a genuinely separate mechanism for a SHARED,
// potentially pre-existing `.claude/settings.json` file -- out of scope
// here, since this strategy's agents are always freshly synthesized JSON
// files with no merge-into-existing-content concern. This strategy
// instead calls the same content-type functions directly in one small,
// self-contained `install_from_local`, mirroring `ClaudeInstallStrategy`'s
// equally self-contained shape rather than `kiro_cli.rs`'s phase-based
// one.

use std::path::Path;

use super::kiro_cli::{
    attach_provenance, content_manifest_path, install_context, install_skills, install_sops,
    list_agent_files, plan_all_files, read_skill_scopes_sidecar, read_sop_scopes_sidecar,
    reject_unsafe_file_name, KIRO_DESTINATION_ROOT, KONDUCTOR_DESTINATION_ROOT,
};
use super::manifest::{Manifest, ManifestFile, Provenance, Status};
use super::resource_rewrite::{
    apply_all, standard_passes_v3, RewriteContext, SKILL_RESOURCE_PREFIX,
};
use super::runtime::{detect_runtimes, Runtime};
use super::InstallError;
use super::InstallStrategy;
use crate::cli::synth::kiro_cli_v2::{
    AGENTS_CONTENT_TYPE_DIR, CONTEXT_CONTENT_TYPE_DIR, SKILLS_CONTENT_TYPE_DIR,
};
use crate::cli::synth::kiro_cli_v3::KiroCliV3Transformer;
use crate::cli::synth::HarnessTransformer as _;

/// Installs Konductor for the Kiro CLI V3 (KAS) runtime: copies synthed
/// skill directories into `.konductor/skills/`, staged SOPs into
/// `.konductor/sops/`, synthed context files into `.kiro/context/`, the
/// `skill-lookup-mcp` MCP server binary (if built) into `.konductor/bin/`,
/// and synthed agent files into `.kiro/agents/` from a local
/// `--from <repo-root>` source -- rewriting each agent's `resources`/
/// `mcpServers`/`permissions.rules[]` entries the same way V2's
/// `kiro_cli::install_agents` does (see this module's own doc comment) --
/// then writes `.konductor/manifest`.
pub struct KiroCliV3InstallStrategy;

impl InstallStrategy for KiroCliV3InstallStrategy {
    /// Distinct from `KiroCliInstallStrategy::name()` (`"kiro-cli"`) so
    /// the two are never confused by `dispatch_install_with`'s existing
    /// strategy-conflict check (`install.rs`'s
    /// `existing.strategy != strategy.name()` guard): re-installing a V3
    /// target with V2 (or vice versa) is refused with a clear message,
    /// rather than silently corrupting the other strategy's tracked
    /// files -- both write under the SAME `.kiro`/`.konductor` roots.
    fn name(&self) -> &'static str {
        "kiro-cli-v3"
    }

    /// Imported directly from `KiroCliV3Transformer` rather than
    /// hand-duplicated as a literal, so this can never drift from the
    /// real synth-side value.
    fn harness_dir(&self) -> &'static str {
        KiroCliV3Transformer.name()
    }

    /// Applies when Kiro CLI is detected at the target. Not called by any
    /// production path today (`#[allow(dead_code)]` on the trait --
    /// `KiroCliInstallStrategy` already claims every target as the sole
    /// default, per `registry.rs`), and can't disambiguate V2 from V3 for
    /// an EXISTING `.kiro` marker either: both strategies key off the
    /// same directory, with no on-disk signal distinguishing a
    /// V2-installed `.kiro/` from a V3-installed one. A future
    /// `--auto`-detect mode would need to resolve that some other way
    /// (e.g. via `.konductor/manifest`'s own recorded `strategy` field).
    fn matches(&self, target_dir: &Path) -> bool {
        detect_runtimes(target_dir).has(Runtime::KiroCli)
    }

    /// Same no-op pre-check contract as
    /// `KiroCliInstallStrategy::would_fail_as_noop` (see that
    /// implementation's own doc comment), scoped to this strategy's
    /// four content types and re-using the exact same `plan_all_files`
    /// this strategy's `install_from_local` plans with below -- so this
    /// check can never silently drift from what a real run would do.
    fn would_fail_as_noop(&self, target_dir: &Path, from: Option<&str>) -> Option<String> {
        let Some(repo_root) = from else {
            return Some(super::NO_REMOTE_RELEASE_MESSAGE.to_string());
        };
        let repo_root = Path::new(repo_root);
        let harness_dir = repo_root.join("dist").join(KiroCliV3Transformer.name());

        let plan = match plan_all_files(&harness_dir, target_dir, None) {
            Ok(plan) => plan,
            Err(message) => return Some(message),
        };
        // Mirrors `install_from_local`'s own merged plan below: a target
        // with a built MCP binary but nothing else synthed still has
        // something to install, so this check must not report a false
        // no-op for it.
        let bin_plan = match super::mcp_server::plan_bin_files(repo_root, target_dir, None) {
            Ok(plan) => plan,
            Err(message) => return Some(message),
        };
        if plan.is_empty() && bin_plan.is_empty() {
            return Some(no_source_message(&harness_dir, repo_root));
        }
        None
    }

    /// Same write-ahead sequencing as `KiroCliInstallStrategy::
    /// install_from_local`: plan every file first (no copy), write an
    /// `InProgress` manifest naming the plan, copy every content type in
    /// order (skills, SOPs, context, the MCP binary, then agents -- so
    /// agent installation's resource-rewrite pipeline finds the other
    /// three already on disk and knows whether the binary was copied
    /// this run), attach real provenance, then mark the manifest
    /// `Complete`. `no_telemetry` has nothing to gate here: unlike
    /// `kiro_cli.rs`'s `AgentInstallPhase`, this strategy has no Claude
    /// settings-grant or telemetry-hook side effect.
    fn install_from_local(
        &self,
        target_dir: &Path,
        from: Option<&str>,
        installed_at: &str,
        _no_telemetry: bool,
    ) -> Result<(), InstallError> {
        let repo_root = from
            .ok_or_else(|| InstallError::Message(super::NO_REMOTE_RELEASE_MESSAGE.to_string()))?;
        let repo_root = Path::new(repo_root);
        let harness_dir = repo_root.join("dist").join(KiroCliV3Transformer.name());

        // Recorded into the manifest's `source` field, same rationale as
        // `kiro_cli.rs`'s and `claude.rs`'s own `install_from_local`.
        let source = Some(
            std::fs::canonicalize(repo_root)
                .unwrap_or_else(|_| {
                    std::env::current_dir()
                        .map(|cwd| cwd.join(repo_root))
                        .unwrap_or_else(|_| repo_root.to_path_buf())
                })
                .display()
                .to_string(),
        );

        let prior_manifest = super::manifest::read_manifest(target_dir)?;

        let mut plan = plan_all_files(&harness_dir, target_dir, prior_manifest.as_ref())?;
        // Folded into the SAME plan the write-ahead manifest below
        // names, mirroring `KiroCliInstallStrategy::install_from_local`'s
        // identical merge -- `attach_provenance` below requires every
        // file this run actually copies (including the MCP binary
        // `install_bin_files` copies further down) to already appear
        // here, or it fails as an internal-error rather than silently
        // under-tracking a copied file.
        let bin_plan =
            super::mcp_server::plan_bin_files(repo_root, target_dir, prior_manifest.as_ref())?;
        plan.extend(bin_plan);
        if plan.is_empty() {
            return Err(InstallError::Message(no_source_message(
                &harness_dir,
                repo_root,
            )));
        }

        let in_progress_files: Vec<ManifestFile> = plan
            .iter()
            .map(|planned| ManifestFile {
                path: planned.manifest_path.clone(),
                sha256: None,
                provenance: planned.provenance,
            })
            .collect();
        let write_ahead = Manifest::new(
            self.name(),
            installed_at,
            ".",
            source.clone(),
            Status::InProgress,
            in_progress_files,
        );
        super::manifest::write_manifest(target_dir, &write_ahead)?;

        // Plain sequential copy, one call per content type (no
        // `InstallPhase` pipeline -- see this module's own doc comment).
        // Order matters: agent installation's resource-rewrite pipeline
        // needs skills/context already on disk and needs to know
        // whether the MCP binary was copied this run, so those three
        // plus the binary come before agents. Unlike V2's `phases.rs`,
        // this ordering is enforced only by call sequence, not
        // structurally -- `assert_bin_files_are_on_disk` below guards
        // the one piece of it that would otherwise degrade silently.
        let mut raw_files = Vec::new();
        raw_files.extend(install_skills(
            &harness_dir,
            target_dir,
            prior_manifest.as_ref(),
        )?);
        raw_files.extend(install_sops(&harness_dir, target_dir)?);
        raw_files.extend(install_context(&harness_dir, target_dir)?);
        let bin_files = super::mcp_server::install_bin_files(repo_root, target_dir)?;
        raw_files.extend(bin_files.clone());
        assert_bin_files_are_on_disk(target_dir, &bin_files)?;
        raw_files.extend(install_agents(&harness_dir, target_dir, &bin_files)?);

        let files = attach_provenance(raw_files, &plan)?;

        let complete = Manifest::new(
            self.name(),
            installed_at,
            ".",
            source,
            Status::Complete,
            files,
        );
        super::manifest::write_manifest(target_dir, &complete)?;
        Ok(())
    }
}

/// Shared by `install_from_local` and `would_fail_as_noop` so the two
/// can never drift into two different wordings for the identical
/// no-source condition.
fn no_source_message(harness_dir: &Path, repo_root: &Path) -> String {
    format!(
        "no synthed agent, skill, sop, or context files -- and no built MCP server binary -- \
         found under {} / {} -- run `konductor synth --from {}` first, or `cd mcp && cargo \
         build --release`",
        harness_dir.display(),
        repo_root.display(),
        repo_root.display()
    )
}

/// Fails loudly with a clear `InstallError` if any entry in `bin_files`
/// (the MCP server binaries `install_bin_files` just reported copying,
/// in `install_from_local` immediately above) is not actually present
/// on disk under `target_dir`.
///
/// V3 has no `phases.rs`-style pipeline to enforce the skills/SOPs/
/// context/MCP-binary/agents copy order structurally, so it relies on
/// the literal sequence of calls in `install_from_local`. If a future
/// refactor ever reordered `install_agents` ahead of `install_bin_files`,
/// the failure would otherwise be silent: `mcp_server.rs`'s own "a
/// missing binary is not an error" contract means `McpServerPassV3`
/// would just quietly stop injecting the `mcpServers`/`permissions.
/// rules[]` grant, with no test or runtime signal calling it out. A
/// plain `debug_assert!` would not catch this in a release build -- the
/// shape real installs run in -- so this is an explicit runtime check
/// that returns a real `InstallError` instead, run as a precondition
/// immediately before `install_agents`. Trivially succeeds when
/// `bin_files` is empty (no binary was built/copied this run).
fn assert_bin_files_are_on_disk(
    target_dir: &Path,
    bin_files: &[ManifestFile],
) -> Result<(), InstallError> {
    for bin_file in bin_files {
        let path = target_dir.join(&bin_file.path);
        if !path.is_file() {
            return Err(InstallError::Message(format!(
                "install ordering invariant violated: {} is recorded in bin_files but is not \
                 yet on disk -- install_bin_files must run (and complete) before install_agents \
                 so McpServerPassV3 can inject a valid mcpServers/permissions.rules[] entry",
                path.display()
            )));
        }
    }
    Ok(())
}

/// Copies `*.json` files from `<harness_dir>/agents/` into
/// `<target_dir>/.kiro/agents/`, returning their manifest entries.
/// Returns an empty `Vec` (not an error) when the source directory is
/// missing or has no agent files -- the caller decides whether "nothing
/// to install anywhere" is an error, mirroring every other content-type
/// function this strategy reuses.
///
/// Rewrites each agent's `resources`, `mcpServers`, and
/// `permissions.rules[]` entries via `copy_agent_files_rewriting_
/// resources` below (using `resource_rewrite::standard_passes_v3`) --
/// same contract as `kiro_cli::install_agents`'s own doc comment for V2.
///
/// `bin_files` is the set of MCP server binaries THIS run actually
/// copied (from `mcp_server::install_bin_files`, called before this
/// function in `install_from_local`) -- passed in rather than
/// re-derived, so this can never inject a path for a binary not
/// actually copied to disk.
fn install_agents(
    harness_dir: &Path,
    target_dir: &Path,
    bin_files: &[ManifestFile],
) -> Result<Vec<ManifestFile>, String> {
    let source_dir = harness_dir.join(AGENTS_CONTENT_TYPE_DIR);
    let entries = list_agent_files(&source_dir)?;
    if entries.is_empty() {
        return Ok(Vec::new());
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
        .join(super::mcp_server::BIN_CONTENT_TYPE_DIR);

    // V3 synth writes the same `_sop_scopes.json`/`_skill_scopes.json`
    // sidecars V2 writes (both call the same harness-agnostic
    // `write_sop_scopes_sidecar`/`write_skill_scopes_sidecar`, which
    // depend only on `model.agents`), so this scopes the
    // `konductor-skills` MCP grant per agent the same way V2 does. An
    // older `dist/` tree with no sidecars yields empty maps here, the
    // safe "no scoping" default per `RewriteContext`'s own contract.
    let agent_sop_names = read_sop_scopes_sidecar(&source_dir)?;
    let agent_skill_names = read_skill_scopes_sidecar(&source_dir)?;

    let rewrite_ctx = RewriteContext {
        context_dir: &context_dir,
        skills_dir: &skills_dir,
        bin_dir: &bin_dir,
        bin_files,
        agent_sop_names: &agent_sop_names,
        agent_skill_names: &agent_skill_names,
    };

    let mut files =
        copy_agent_files_rewriting_resources(&source_dir, &destination, &rewrite_ctx, entries)?;
    for file in &mut files {
        file.path =
            content_manifest_path(KIRO_DESTINATION_ROOT, AGENTS_CONTENT_TYPE_DIR, &file.path);
    }
    Ok(files)
}

/// V3 (KAS) analog of `kiro_cli`'s own `copy_agent_files_rewriting_
/// resources`: parses each agent's JSON and runs `resource_rewrite::
/// standard_passes_v3` over it before writing, rewriting `file://context/
/// <name>` and `skill://skills/<name>/SKILL.md` resources to absolute
/// paths and injecting `mcpServers.konductor-skills` plus a scoped `mcp`
/// `permissions.rules[]` grant when the MCP binary was installed. Unlike
/// V2's own version, this never returns an `any_mcp_server_injected`
/// flag -- V3 has no additive Claude/settings grant of its own to gate
/// on it.
///
/// Verbatim-copy fast path for an agent that matches no pass and has no
/// SOP/skill-name sidecar entry, since parsing and re-serializing it
/// would then be pure overhead.
fn copy_agent_files_rewriting_resources(
    source_dir: &Path,
    destination: &Path,
    ctx: &RewriteContext<'_>,
    file_names: Vec<String>,
) -> Result<Vec<ManifestFile>, String> {
    let passes = standard_passes_v3();
    let mut files = Vec::with_capacity(file_names.len());

    for file_name in file_names {
        reject_unsafe_file_name(&file_name)?;
        let src = source_dir.join(&file_name);
        let dst = destination.join(&file_name);
        let original_bytes =
            std::fs::read(&src).map_err(|e| format!("failed to read {}: {e}", src.display()))?;

        // Checked by file name (always `<agent-name>.json`) rather than
        // by parsing the JSON first: an agent's own declared SOPs/skill
        // names are never visible in its raw JSON content, only in the
        // sidecar.
        let agent_name = file_name.strip_suffix(".json").unwrap_or(&file_name);
        let agent_has_sop_names = ctx
            .agent_sop_names
            .get(agent_name)
            .is_some_and(|names| !names.is_empty());
        let agent_has_skill_names = ctx
            .agent_skill_names
            .get(agent_name)
            .is_some_and(|names| !names.is_empty());

        let contents = String::from_utf8(original_bytes.clone())
            .map_err(|e| format!("{} is not valid UTF-8: {e}", src.display()))?;
        if !contents.contains(super::kiro_cli::CONTEXT_RESOURCE_PREFIX)
            && !contents.contains(SKILL_RESOURCE_PREFIX)
            && !agent_has_sop_names
            && !agent_has_skill_names
        {
            crate::cli::atomic_write::write_atomic(&dst, &original_bytes)
                .map_err(|e| format!("failed to write {}: {e}", dst.display()))?;
            files.push(ManifestFile {
                path: file_name,
                sha256: Some(super::artifact::sha256_hex(&original_bytes)),
                // Overwritten by `attach_provenance`.
                provenance: Provenance::Created,
            });
            continue;
        }

        let mut value: serde_json::Value = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse {} as JSON: {e}", src.display()))?;
        apply_all(&passes, &mut value, ctx, &src)?;

        let mut bytes = serde_json::to_vec_pretty(&value)
            .map_err(|e| format!("failed to re-serialize {}: {e}", src.display()))?;
        bytes.push(b'\n');
        crate::cli::atomic_write::write_atomic(&dst, &bytes)
            .map_err(|e| format!("failed to write {}: {e}", dst.display()))?;
        files.push(ManifestFile {
            path: file_name,
            sha256: Some(super::artifact::sha256_hex(&bytes)),
            // Overwritten by `attach_provenance`.
            provenance: Provenance::Created,
        });
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-kiro-cli-v3-strategy-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Seeds `<repo_root>/dist/kiro-v3/agents/<name>.json` with
    /// `contents`, mirroring real `KiroCliV3Transformer` output layout.
    fn seed_synthed_agent(repo_root: &Path, name: &str, contents: &[u8]) {
        let dir = repo_root
            .join("dist")
            .join(KiroCliV3Transformer.name())
            .join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.json")), contents).unwrap();
    }

    /// Seeds `<repo_root>/dist/kiro-v3/skills/<name>/SKILL.md` (plus any
    /// `extra_files`) with `contents`, mirroring real
    /// `KiroCliV3Transformer` output layout.
    fn seed_synthed_skill(
        repo_root: &Path,
        name: &str,
        contents: &[u8],
        extra_files: &[(&str, &[u8])],
    ) {
        let dir = repo_root
            .join("dist")
            .join(KiroCliV3Transformer.name())
            .join("skills")
            .join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), contents).unwrap();
        for (rel_path, data) in extra_files {
            let full = dir.join(rel_path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, data).unwrap();
        }
    }

    /// Seeds `<repo_root>/dist/kiro-v3/context/<file_name>` with
    /// `contents`, mirroring real `KiroCliV3Transformer` output layout.
    fn seed_synthed_context(repo_root: &Path, file_name: &str, contents: &[u8]) {
        let dir = repo_root
            .join("dist")
            .join(KiroCliV3Transformer.name())
            .join("context");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(file_name), contents).unwrap();
    }

    /// Seeds `<repo_root>/dist/kiro-v3/sops/<name>.sop.md` with
    /// `contents`, mirroring real `KiroCliV3Transformer` output layout.
    fn seed_synthed_sop(repo_root: &Path, name: &str, contents: &[u8]) {
        let dir = repo_root
            .join("dist")
            .join(KiroCliV3Transformer.name())
            .join("sops");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.sop.md")), contents).unwrap();
    }

    /// Seeds `<repo_root>/mcp/target/release/<name>` with `contents`,
    /// mirroring `cargo build --release`'s default output location for
    /// the `mcp/` Cargo workspace -- shared, harness-agnostic path (see
    /// `mcp_server.rs`), mirroring `kiro_cli.rs::test_support`'s own
    /// identically-named helper.
    fn seed_mcp_binary(repo_root: &Path, name: &str, contents: &[u8]) {
        let dir = repo_root.join("mcp/target/release");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(name), contents).unwrap();
    }

    #[test]
    fn name_returns_kiro_cli_v3() {
        assert_eq!(KiroCliV3InstallStrategy.name(), "kiro-cli-v3");
    }

    #[test]
    fn harness_dir_matches_the_real_v3_transformer_name() {
        assert_eq!(KiroCliV3InstallStrategy.harness_dir(), "kiro-v3");
        assert_eq!(
            KiroCliV3InstallStrategy.harness_dir(),
            KiroCliV3Transformer.name()
        );
    }

    #[test]
    fn matches_kiro_marker() {
        let dir = scratch_dir("matches-kiro-marker");
        fs::create_dir_all(dir.join(".kiro")).unwrap();
        assert!(KiroCliV3InstallStrategy.matches(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_not_match_empty_target() {
        let dir = scratch_dir("no-match-empty");
        assert!(!KiroCliV3InstallStrategy.matches(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_not_match_claude_only_target() {
        let dir = scratch_dir("no-match-claude-only");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        assert!(!KiroCliV3InstallStrategy.matches(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn install_without_local_fails_with_clear_message() {
        let dir = scratch_dir("no-local");
        let err = KiroCliV3InstallStrategy
            .install_from_local(&dir, None, "2026-01-01T00:00:00Z", false)
            .expect_err("install without --from must fail");
        assert!(err.contains("remote release installation is not yet available"));
        assert!(err.contains("--from"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn would_fail_as_noop_with_no_from() {
        let dir = scratch_dir("noop-no-from");
        let message = KiroCliV3InstallStrategy
            .would_fail_as_noop(&dir, None)
            .expect("missing --from must be a no-op failure");
        assert!(message.contains("--from"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn would_fail_as_noop_with_empty_source() {
        let dir = scratch_dir("noop-empty-source-target");
        let repo_root = scratch_dir("noop-empty-source-repo");
        let message = KiroCliV3InstallStrategy
            .would_fail_as_noop(&dir, Some(repo_root.to_str().unwrap()))
            .expect("a source with nothing to install must be a no-op failure");
        assert!(message.contains("no synthed agent, skill, sop, or context files"));
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn would_fail_as_noop_returns_none_when_there_is_something_to_install() {
        let dir = scratch_dir("noop-real-source-target");
        let repo_root = scratch_dir("noop-real-source-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{\"name\":\"k-example\"}\n");
        assert!(KiroCliV3InstallStrategy
            .would_fail_as_noop(&dir, Some(repo_root.to_str().unwrap()))
            .is_none());
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The ordering guard's positive case: `install_from_local` (further
    /// down in this file) always calls `install_bin_files` before
    /// `assert_bin_files_are_on_disk` -- the real binary is already on
    /// disk by the time this check runs, so it must succeed.
    #[test]
    fn assert_bin_files_are_on_disk_succeeds_when_the_file_is_present() {
        let target_dir = scratch_dir("assert-bin-files-present");
        let relative_path = ".konductor/bin/skill-lookup-mcp";
        let absolute_path = target_dir.join(relative_path);
        fs::create_dir_all(absolute_path.parent().unwrap()).unwrap();
        fs::write(&absolute_path, b"fake binary").unwrap();

        let bin_files = vec![ManifestFile {
            path: relative_path.to_string(),
            sha256: None,
            provenance: Provenance::Created,
        }];
        assert_bin_files_are_on_disk(&target_dir, &bin_files)
            .expect("must succeed when the recorded bin file really is on disk");

        fs::remove_dir_all(&target_dir).ok();
    }

    /// The ordering guard's negative case: a `bin_files` entry naming a
    /// path that is not actually on disk (exactly what a future reorder
    /// of `install_bin_files` after `install_agents` would produce) must
    /// fail loudly with a named `InstallError`, not silently proceed.
    #[test]
    fn assert_bin_files_are_on_disk_fails_loudly_when_a_bin_file_is_missing() {
        let target_dir = scratch_dir("assert-bin-files-missing");
        let relative_path = ".konductor/bin/skill-lookup-mcp";

        let bin_files = vec![ManifestFile {
            path: relative_path.to_string(),
            sha256: None,
            provenance: Provenance::Created,
        }];
        let err = assert_bin_files_are_on_disk(&target_dir, &bin_files)
            .expect_err("must fail loudly when a bin_files entry is not actually on disk yet");
        assert!(err.contains("install ordering invariant violated"));
        assert!(err.contains(relative_path));

        fs::remove_dir_all(&target_dir).ok();
    }

    /// An empty `bin_files` (no MCP binary built/copied this run --
    /// `mcp_server.rs`'s own "a missing binary is not an error"
    /// contract) must trivially succeed: there is nothing to check.
    #[test]
    fn assert_bin_files_are_on_disk_succeeds_when_there_is_nothing_to_check() {
        let target_dir = scratch_dir("assert-bin-files-empty");
        assert_bin_files_are_on_disk(&target_dir, &[])
            .expect("no bin_files entries means nothing to verify");
        fs::remove_dir_all(&target_dir).ok();
    }

    #[test]
    fn install_from_local_rewrites_context_resource_to_absolute_path_and_writes_manifest() {
        let target_dir = scratch_dir("install-agent-target");
        let repo_root = scratch_dir("install-agent-repo");
        let contents = br#"{"name":"k-example","resources":["file://context/routing-rules.md"]}"#;
        seed_synthed_agent(&repo_root, "k-example", contents);
        seed_synthed_context(&repo_root, "routing-rules.md", b"# Routing rules\n");

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed = target_dir.join(".kiro/agents/k-example.json");
        assert!(installed.is_file());
        // Rewritten: the relative `file://context/...` resource entry
        // must be rewritten to an absolute path pointing at the
        // installed context file -- this strategy now runs the same
        // resource-rewrite pipeline V2 does (see this module's own doc
        // comment).
        let expected_context_path = target_dir.join(".kiro/context/routing-rules.md");
        let installed_json: serde_json::Value =
            serde_json::from_slice(&fs::read(&installed).unwrap()).unwrap();
        assert_eq!(
            installed_json["resources"],
            serde_json::json!([format!("file://{}", expected_context_path.display())])
        );

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        assert_eq!(manifest.strategy, "kiro-cli-v3");
        assert_eq!(manifest.destination, ".");
        assert!(manifest
            .files
            .iter()
            .any(|f| f.path == ".kiro/agents/k-example.json"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// End-to-end: a skill-bearing agent, with the `skill-lookup-mcp`
    /// binary present at its `mcp/target/release/` source path, gets an
    /// absolute-path `mcpServers.konductor-skills` entry AND a scoped
    /// `mcp` `permissions.rules[]` grant -- the V3-specific piece on top
    /// of the resource-path rewriting above.
    #[test]
    fn install_from_local_injects_mcp_server_and_permission_rule_for_skill_bearing_agent() {
        let target_dir = scratch_dir("install-mcp-wiring-target");
        let repo_root = scratch_dir("install-mcp-wiring-repo");
        let contents = br#"{
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {"rules": []}
        }"#;
        seed_synthed_agent(&repo_root, "k-example", contents);
        seed_synthed_skill(&repo_root, "constraints", b"body\n", &[]);
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"fake binary");

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed = target_dir.join(".kiro/agents/k-example.json");
        let installed_json: serde_json::Value =
            serde_json::from_slice(&fs::read(&installed).unwrap()).unwrap();

        let expected_command = target_dir
            .join(".konductor/bin/skill-lookup-mcp")
            .display()
            .to_string();
        assert_eq!(
            installed_json["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_command)
        );
        assert_eq!(
            installed_json["permissions"]["rules"],
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

        assert!(
            target_dir.join(".konductor/bin/skill-lookup-mcp").is_file(),
            "the MCP server binary itself must have been copied"
        );
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        assert!(manifest
            .files
            .iter()
            .any(|f| f.path == ".konductor/bin/skill-lookup-mcp"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Without a built binary at `mcp/target/release/skill-lookup-mcp`,
    /// a skill-bearing agent's resources are still rewritten to absolute
    /// paths, but no `mcpServers`/`permissions.rules[]` grant is
    /// injected -- mirrors V2's own "a missing binary is not an error"
    /// contract (`mcp_server.rs`'s own module doc comment).
    #[test]
    fn install_from_local_skips_mcp_wiring_when_binary_not_built() {
        let target_dir = scratch_dir("install-mcp-wiring-skip-target");
        let repo_root = scratch_dir("install-mcp-wiring-skip-repo");
        let contents = br#"{
            "name": "k-example",
            "resources": ["skill://skills/constraints/SKILL.md"],
            "permissions": {"rules": []}
        }"#;
        seed_synthed_agent(&repo_root, "k-example", contents);
        seed_synthed_skill(&repo_root, "constraints", b"body\n", &[]);

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed even with no built MCP binary");

        let installed = target_dir.join(".kiro/agents/k-example.json");
        let installed_json: serde_json::Value =
            serde_json::from_slice(&fs::read(&installed).unwrap()).unwrap();
        assert!(installed_json.get("mcpServers").is_none());
        assert_eq!(
            installed_json["permissions"]["rules"],
            serde_json::json!([])
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_copies_skill_sop_and_context_files() {
        let target_dir = scratch_dir("install-all-content-types-target");
        let repo_root = scratch_dir("install-all-content-types-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{}\n");
        seed_synthed_skill(&repo_root, "constraints", b"body\n", &[]);
        seed_synthed_sop(&repo_root, "ticket-sync", b"# Ticket Sync\n");
        seed_synthed_context(&repo_root, "routing-rules.md", b"# Routing rules\n");

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        assert!(target_dir.join(".kiro/agents/k-example.json").is_file());
        assert!(target_dir
            .join(".konductor/skills/constraints/SKILL.md")
            .is_file());
        assert!(target_dir
            .join(".konductor/sops/ticket-sync.sop.md")
            .is_file());
        assert!(target_dir.join(".kiro/context/routing-rules.md").is_file());
        assert!(
            !target_dir.join(".kiro/sops").exists(),
            "SOPs are Konductor tooling shared across runtimes, not a Kiro CLI concept"
        );

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert_eq!(manifest.status, super::super::manifest::Status::Complete);
        assert_eq!(manifest.files.len(), 4);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_fails_when_nothing_at_all_to_install() {
        let target_dir = scratch_dir("nothing-target");
        let repo_root = scratch_dir("nothing-repo");
        fs::create_dir_all(&repo_root).unwrap();

        let err = KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect_err("install must fail when there is nothing to install");
        assert!(err.contains("no synthed agent, skill, sop, or context files"));
        assert!(!target_dir.join(".konductor/manifest").exists());
        assert!(!target_dir.join(".kiro").exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_ignores_non_json_agent_files() {
        let target_dir = scratch_dir("target-non-json");
        let repo_root = scratch_dir("repo-root-non-json");
        let dir = repo_root
            .join("dist")
            .join(KiroCliV3Transformer.name())
            .join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("agent.json"), b"{}\n").unwrap();
        fs::write(dir.join("README.md"), b"not an agent").unwrap();

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(manifest.files[0].path, ".kiro/agents/agent.json");
        assert!(!target_dir.join(".kiro/agents/README.md").exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_merges_skills_and_never_touches_foreign_agent_file() {
        let target_dir = scratch_dir("install-merge-target");
        let repo_root = scratch_dir("install-merge-repo");
        seed_synthed_agent(&repo_root, "k-example", b"first\n");

        // A hand-authored, foreign agent file this install never wrote.
        let foreign = target_dir.join(".kiro/agents/hand-authored.json");
        fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        fs::write(&foreign, b"do not touch\n").unwrap();

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        assert_eq!(fs::read(&foreign).unwrap(), b"do not touch\n");
        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_is_idempotent_across_two_installs() {
        let target_dir = scratch_dir("install-idempotent-target");
        let repo_root = scratch_dir("install-idempotent-repo");
        seed_synthed_agent(&repo_root, "k-example", b"content\n");
        seed_synthed_skill(&repo_root, "constraints", b"body\n", &[]);

        for i in 0..2 {
            KiroCliV3InstallStrategy
                .install_from_local(
                    &target_dir,
                    Some(repo_root.to_str().unwrap()),
                    &format!("2026-01-01T00:0{i}:00Z"),
                    false,
                )
                .expect("install must succeed on every run");
        }

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist");
        assert_eq!(manifest.status, super::super::manifest::Status::Complete);
        assert!(manifest
            .files
            .iter()
            .any(|f| f.path == ".kiro/agents/k-example.json"));
        assert!(manifest
            .files
            .iter()
            .any(|f| f.path == ".konductor/skills/constraints/SKILL.md"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A rerun after the source drops a previously-synthed skill file
    /// must not leave the stale file lingering -- exercises
    /// `install_skills`'s own dropped-file cleanup, reused unchanged
    /// from `kiro_cli.rs`.
    #[test]
    fn install_from_local_drops_stale_skill_file_removed_from_source() {
        let target_dir = scratch_dir("install-stale-skill-target");
        let repo_root = scratch_dir("install-stale-skill-repo");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"body\n",
            &[("extra.md", b"will be removed\n")],
        );

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        let extra_path = target_dir.join(".konductor/skills/constraints/extra.md");
        assert!(extra_path.is_file());

        fs::remove_file(
            repo_root
                .join("dist")
                .join(KiroCliV3Transformer.name())
                .join("skills")
                .join("constraints")
                .join("extra.md"),
        )
        .unwrap();

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:01:00Z",
                false,
            )
            .expect("second install must succeed");

        assert!(
            !extra_path.exists(),
            "a file dropped from the source must not linger after reinstall"
        );
        assert!(target_dir
            .join(".konductor/skills/constraints/SKILL.md")
            .is_file());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }
}
