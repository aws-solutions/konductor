// SPDX-License-Identifier: Apache-2.0
//
// install/kiro_cli_v3.rs -- `InstallStrategy` for the Kiro CLI V3 (KAS)
// runtime.
//
// Reuses V2's content-type layout and harness-agnostic planning/listing
// primitives verbatim (`plan_all_files`, `install_context`,
// `install_skills`, `install_sops`, `list_agent_files`), parameterized
// only by this harness's own directory name: `KiroCliV3Transformer`
// stages `dist/kiro-v3/` using the same content-type directory
// constants as `KiroCliV2Transformer`. Agent installation is the one
// exception.
//
// Agent installation runs the same `resource_rewrite::
// ResourceRewritePass` pipeline V2's `kiro_cli::install_agents` runs,
// via `standard_passes_v3`. `ContextResourcePass`/`SkillResourcePass`
// are reused unchanged. The one V3-specific piece is `McpServerPassV3`:
// it injects the same `mcpServers.konductor-skills` entry as V2's
// `McpServerPass`, but authorizes it via a `permissions.rules[]` entry
// instead of V2's `tools`/`allowedTools` pair, since V3 has no
// `allowedTools` field.
//
// Copies the `skill-lookup-mcp` MCP server binary before installing
// agents, the same ordering `phases.rs`'s `McpInstallPhase` enforces
// ahead of `AgentInstallPhase` for V2 -- agent installation needs to
// know whether the binary was copied this run before it can inject a
// path to it.
//
// No `InstallPhase` pipeline is used for agent installation: this
// strategy's agents are always freshly synthesized JSON files with no
// merge-into-existing-content concern, so the pipeline's per-phase
// ordering buys nothing a plain sequential call chain doesn't already
// give. `install_from_local` below calls the content-type functions
// directly, mirroring `ClaudeInstallStrategy`'s self-contained shape
// rather than `kiro_cli.rs`'s phase-based one.
//
// That does not extend to the two additive, `.claude`-marker-gated
// mechanisms V2's `SopInstallPhase`/`AgentInstallPhase` also perform:
// the dual-marker SOP-skill conversion and the Claude/V3
// settings.json grant, both for a shared, potentially pre-existing
// `.claude/` tree that isn't this strategy's own content.
// `install_from_local` calls the same shared functions those phases
// call, inlined directly rather than routed through the phase
// pipeline. Omitting them would leave `.claude/settings.json` and any
// dual-marker `.claude/skills/sop-<name>/SKILL.md` files unclaimed by
// any tracked slot after a `kiro-cli-v2` -> `kiro-v3` override switch,
// since `manifest::upsert_strategy` removes the prior variant's slot
// outright on that switch and this strategy's slot never wrote those
// paths.

use std::path::Path;

use super::kiro_cli::{
    attach_provenance, content_manifest_path, install_context, install_kiro_sop_skills,
    install_skills, install_sops, list_agent_files, plan_additive_claude_sop_skill_files,
    plan_all_files, plan_claude_settings_grant, read_skill_scopes_sidecar, read_sop_scopes_sidecar,
    reject_unsafe_file_name, PlannedFile, KIRO_DESTINATION_ROOT, KONDUCTOR_DESTINATION_ROOT,
};
use super::manifest::{classify_provenance, ManifestFile, Provenance, Status, StrategyManifest};
use super::resource_rewrite::{
    apply_all, apply_claude_settings_grant_and_hooks, apply_v3_standalone_telemetry_hook,
    standard_passes_v3, RewriteContext, MCP_SERVER_NAME, SKILL_RESOURCE_PREFIX,
    V3_STANDALONE_HOOKS_RELATIVE_PATH,
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
    /// Matches `KiroCliV3Transformer::name()` (`"kiro-v3"`) exactly --
    /// the harness/strategy name unification removes the translation
    /// layer that used to exist between `--harness kiro-v3` and this
    /// strategy's manifest-recorded name. Distinct from
    /// `KiroCliInstallStrategy::name()` (`"kiro-cli-v2"`) so the two
    /// remain individually addressable in the manifest --
    /// `KIRO_VARIANT_FAMILY` governs switching between them (warn, then
    /// override), not a hard refusal, since both write under the same
    /// `.kiro`/`.konductor` roots and only one can meaningfully occupy
    /// a target at a time.
    fn name(&self) -> &'static str {
        "kiro-v3"
    }

    /// Identical to `name()` by construction -- delegates directly
    /// rather than re-deriving the string from `KiroCliV3Transformer::name()`.
    fn harness_dir(&self) -> &'static str {
        self.name()
    }

    /// Applies when Kiro CLI is detected at the target. Not called by
    /// any production path today -- `KiroCliInstallStrategy` already
    /// claims every target as the sole default -- and can't
    /// disambiguate V2 from V3 for an existing `.kiro` marker: both key
    /// off the same directory, with no on-disk signal distinguishing a
    /// V2-installed `.kiro/` from a V3-installed one. A future
    /// `--auto`-detect mode would need to resolve that some other way
    /// (e.g. via `.konductor/manifest`'s recorded `strategy` field).
    fn matches(&self, target_dir: &Path) -> bool {
        detect_runtimes(target_dir).has(Runtime::KiroCli)
    }

    /// Same no-op pre-check contract as
    /// `KiroCliInstallStrategy::would_fail_as_noop`, scoped to this
    /// strategy's four content types and reusing the same
    /// `plan_all_files` `install_from_local` plans with below, so this
    /// check can't silently drift from what a real run would do.
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
        // A target with a built MCP binary but nothing else synthed
        // still has something to install, so this check must not
        // report a false no-op for it.
        let bin_plan = match super::mcp_server::plan_bin_files(repo_root, target_dir, None) {
            Ok(plan) => plan,
            Err(message) => return Some(message),
        };
        // `plan_additive_claude_sop_skill_files` is gated only on
        // `target_dir` already carrying a `.claude` marker, independent
        // of `plan`/`bin_plan`, so it can turn an otherwise-empty plan
        // into a non-empty one on its own. Omitting it would report a
        // false no-op for a target `install_from_local` would actually
        // install into.
        //
        // Deliberately doesn't also call `plan_claude_settings_grant`:
        // that function can only add an optional file to an otherwise
        // non-empty plan -- it never turns an empty plan non-empty --
        // so it can't change this function's verdict.
        let claude_sop_skill_plan =
            match plan_additive_claude_sop_skill_files(repo_root, target_dir, None) {
                Ok(plan) => plan,
                Err(message) => return Some(message),
            };
        if plan.is_empty() && bin_plan.is_empty() && claude_sop_skill_plan.is_empty() {
            return Some(no_source_message(&harness_dir, repo_root));
        }
        None
    }

    /// Same write-ahead sequencing as `KiroCliInstallStrategy::
    /// install_from_local`: plan every file first, write an
    /// `InProgress` manifest naming the plan, copy every content type
    /// in order (skills, SOPs, context, the MCP binary, then agents --
    /// so agent installation finds the other three already on disk and
    /// knows whether the binary was copied this run), attach real
    /// provenance, then mark the manifest `Complete`.
    ///
    /// Also applies the same two additive, `.claude`-marker-gated
    /// mechanisms V2 applies when this target also carries a
    /// pre-existing `.claude` marker: the dual-marker SOP-skill
    /// conversion and the shared Claude/V3 settings grant. Without
    /// these, a target that switches from `kiro-cli-v2` to this
    /// strategy would leave `.claude/settings.json` and any dual-marker
    /// SOP-skill files claimed by neither slot, since `kiro-cli-v2`'s
    /// slot is removed outright on the switch and this strategy's slot
    /// never wrote those paths. `no_telemetry` gates the telemetry-hook
    /// wiring exactly as it does in `AgentInstallPhase::run`.
    fn install_from_local(
        &self,
        target_dir: &Path,
        from: Option<&str>,
        installed_at: &str,
        no_telemetry: bool,
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

        // See `kiro_cli.rs`'s `install_from_local` for why this is
        // `effective_prior_slot`, not a bare `read_manifest` -- an
        // override-switch against the other Kiro variant borrows that
        // variant's slot for provenance purposes.
        let full_prior_manifest = super::manifest::read_manifest(target_dir)?;
        let prior_manifest: Option<StrategyManifest> = full_prior_manifest
            .as_ref()
            .and_then(|full| super::manifest::effective_prior_slot(full, self.name()))
            .cloned();

        let mut plan = plan_all_files(&harness_dir, target_dir, prior_manifest.as_ref())?;
        // Folded into the same plan the write-ahead manifest below
        // names -- `attach_provenance` below requires every file this
        // run actually copies (including the MCP binary) to already
        // appear here, or it fails as an internal error rather than
        // silently under-tracking a copied file.
        let bin_plan =
            super::mcp_server::plan_bin_files(repo_root, target_dir, prior_manifest.as_ref())?;
        plan.extend(bin_plan);
        // Must run after the bin plan is folded in: it checks `plan`
        // for the MCP binary's planned path to predict whether the
        // Claude/V3 settings grant applies (this prediction, not the
        // real run-time computation, is what closes the crash-safety
        // gap).
        let claude_plan =
            plan_claude_settings_grant(&harness_dir, target_dir, &plan, prior_manifest.as_ref())?;
        plan.extend(claude_plan);
        // Predicts the additive Claude-side SOP-skill conversion files
        // the dual-marker branch further down writes when this target
        // also has a pre-existing `.claude` marker -- must run before
        // the write-ahead `InProgress` manifest below, for the same
        // crash-safety reason as `plan_claude_settings_grant`. Without
        // this, `attach_provenance` fails the first time that branch
        // produces a file that was never in the plan.
        let claude_sop_skill_plan =
            plan_additive_claude_sop_skill_files(repo_root, target_dir, prior_manifest.as_ref())?;
        plan.extend(claude_sop_skill_plan);
        if plan.is_empty() {
            return Err(InstallError::Message(no_source_message(
                &harness_dir,
                repo_root,
            )));
        }

        // Predicts the standalone V3 SessionStart telemetry hook
        // document this run writes (unless `--no-telemetry`) --
        // deliberately folded in AFTER the no-op check above, not
        // before it: this file is written unconditionally for every V3
        // install with telemetry enabled, independent of whether any
        // OTHER synthed content exists at all -- including it in the
        // no-op check would let an otherwise genuinely-empty install
        // "succeed" by writing only this one file. Still folded into
        // `plan` before the write-ahead manifest below, for the
        // identical crash-safety reason `plan_claude_settings_grant`
        // documents: `attach_provenance` requires every file this run
        // actually writes to already appear here, or it fails as an
        // internal error.
        if !no_telemetry {
            let manifest_path = V3_STANDALONE_HOOKS_RELATIVE_PATH.to_string();
            let provenance = classify_provenance(
                &target_dir.join(&manifest_path),
                &manifest_path,
                prior_manifest.as_ref(),
            );
            plan.push(PlannedFile {
                manifest_path,
                provenance,
            });
        }

        // Mirrored from `KiroCliInstallStrategy::install_from_local`'s
        // identical exclusion: this strategy's own tracked slot must
        // never claim `.claude/skills/sop-<name>/SKILL.md`, at any
        // status, not just `Complete`. Defined here, before
        // `in_progress_files` is built, so the write-ahead record
        // excludes these paths too -- otherwise a crash between the
        // write-ahead write and the `Complete` write further down
        // would leave this slot's `InProgress` manifest claiming these
        // paths, and `uninstall` (which has no status gate) would
        // delete them even though `claude`'s slot may own them.
        const DUAL_MARKER_SOP_SKILL_PREFIX: &str = ".claude/skills/sop-";

        let in_progress_files: Vec<ManifestFile> = plan
            .iter()
            .filter(|planned| {
                !planned
                    .manifest_path
                    .starts_with(DUAL_MARKER_SOP_SKILL_PREFIX)
            })
            .map(|planned| ManifestFile {
                path: planned.manifest_path.clone(),
                sha256: None,
                provenance: planned.provenance,
            })
            .collect();
        let write_ahead = StrategyManifest::new(
            self.name(),
            installed_at,
            ".",
            source.clone(),
            Status::InProgress,
            in_progress_files,
        );
        super::manifest::upsert_strategy(target_dir, write_ahead)?;

        // Plain sequential copy, one call per content type (no
        // `InstallPhase` pipeline -- see module doc). Order matters:
        // agent installation needs skills/context already on disk and
        // needs to know whether the MCP binary was copied this run, so
        // those three plus the binary come before agents. Unlike V2's
        // `phases.rs`, this ordering is enforced only by call sequence
        // -- `assert_bin_files_are_on_disk` below guards the one piece
        // that would otherwise degrade silently.
        let mut raw_files = Vec::new();
        raw_files.extend(install_skills(
            &harness_dir,
            target_dir,
            prior_manifest.as_ref(),
        )?);
        raw_files.extend(install_sops(&harness_dir, target_dir)?);
        // Kiro-discoverable conversion, alongside the raw copy above --
        // see `install_kiro_sop_skills`'s own doc comment. Primary
        // content type for this strategy, not additive/marker-gated
        // (unlike the Claude branch immediately below).
        raw_files.extend(install_kiro_sop_skills(&harness_dir, target_dir)?);
        // Additive Claude branch, mirroring `SopInstallPhase::run`'s
        // dual-marker branch: this run is this strategy's own, but the
        // target also has a pre-existing `.claude` marker. Always
        // re-derives its source directory from `repo_root`
        // (`<repo_root>/dist/claude/sops/`), never from `harness_dir`,
        // which is this strategy's own (V3) harness dir, not Claude's.
        if detect_runtimes(target_dir).has(Runtime::ClaudeCode) {
            let claude_harness_dir = repo_root
                .join("dist")
                .join(super::claude::CLAUDE_HARNESS_DIR);
            raw_files.extend(super::claude::install_sop_skills(
                &claude_harness_dir,
                target_dir,
            )?);
        }
        raw_files.extend(install_context(&harness_dir, target_dir)?);
        let bin_files = super::mcp_server::install_bin_files(repo_root, target_dir)?;
        raw_files.extend(bin_files.clone());
        assert_bin_files_are_on_disk(target_dir, &bin_files)?;
        let (agent_files, any_mcp_server_injected) =
            install_agents(&harness_dir, target_dir, &bin_files)?;
        raw_files.extend(agent_files);

        // The standalone V3 SessionStart telemetry hook document --
        // written unconditionally for every V3 install unless
        // `--no-telemetry`, independent of `any_mcp_server_injected`/
        // Claude Code detection -- unlike the block below, this has
        // nothing to do with Claude Code at all. Non-fatal on failure,
        // matching `apply_claude_settings_grant_and_hooks`'s own
        // philosophy: a problem writing this additive, best-effort file
        // must never abort an otherwise-successful Kiro install.
        if !no_telemetry {
            match apply_v3_standalone_telemetry_hook(target_dir) {
                Ok((path, sha256)) => raw_files.push(ManifestFile {
                    path,
                    sha256: Some(sha256),
                    // Overwritten by `attach_provenance` below, which
                    // resolves the real provenance from `plan` (see the
                    // planning step above).
                    provenance: Provenance::Created,
                }),
                Err(err) => {
                    eprintln!(
                        "konductor install: warning: standalone telemetry hook wiring skipped \
                         ({err}) -- the rest of this install is unaffected"
                    );
                }
            }
        }

        // Additive, Claude/V3-only settings grant, mirroring
        // `AgentInstallPhase::run`'s identical branch: applies the
        // shared `.claude/settings.json` MCP-tool authorization grant
        // (and, unless `--no-telemetry`, the telemetry-hook wiring)
        // once for the whole run, only when this run injected an MCP
        // server grant into at least one agent and this target is a
        // detected Claude Code target. Both callers share this logic
        // via `apply_claude_settings_grant_and_hooks` rather than each
        // keeping its own copy.
        if any_mcp_server_injected && detect_runtimes(target_dir).has(Runtime::ClaudeCode) {
            if let Some(claude_settings_file) =
                apply_claude_settings_grant_and_hooks(target_dir, no_telemetry, "Kiro CLI V3")
            {
                raw_files.push(claude_settings_file);
            }
        }

        let files = attach_provenance(raw_files, &plan)?;

        // Mirrored from `KiroCliInstallStrategy::install_from_local`'s
        // identical exclusion: the dual-marker branch above wrote
        // `.claude/skills/sop-<name>/SKILL.md` -- this strategy's own
        // slot must never claim it, so a future `uninstall`/`update`
        // never deletes it. `claude`'s own slot, if separately
        // installed at this target, owns that path on its own.
        let (files, _dual_marker_claude_sop_skills): (Vec<ManifestFile>, Vec<ManifestFile>) = files
            .into_iter()
            .partition(|f| !f.path.starts_with(DUAL_MARKER_SOP_SKILL_PREFIX));

        let complete = StrategyManifest::new(
            self.name(),
            installed_at,
            ".",
            source,
            Status::Complete,
            files,
        );
        super::manifest::upsert_strategy(target_dir, complete)?;

        // Same call, same rationale, as `kiro_cli.rs`'s own identical
        // call site.
        if !no_telemetry {
            if let Err(err) = crate::cli::telemetry::write_install_info(
                target_dir,
                repo_root,
                self.name(),
                installed_at,
            ) {
                eprintln!(
                    "konductor install: warning: could not write install-info.json at {}: {err}",
                    target_dir.display()
                );
            }
        }
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
/// same contract as V2's `kiro_cli::install_agents`.
///
/// `bin_files` is the set of MCP server binaries this run actually
/// copied, passed in rather than re-derived, so this can never inject
/// a path for a binary not actually copied to disk.
///
/// The returned `bool` is whether the `mcpServers.konductor-skills`
/// grant was injected into at least one agent this run --
/// `install_from_local` uses it to decide whether to also apply the
/// additive Claude/V3 settings grant, which must never fire on a run
/// where this strategy injected nothing.
fn install_agents(
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

    let (mut files, any_mcp_server_injected) =
        copy_agent_files_rewriting_resources(&source_dir, &destination, &rewrite_ctx, entries)?;
    for file in &mut files {
        file.path =
            content_manifest_path(KIRO_DESTINATION_ROOT, AGENTS_CONTENT_TYPE_DIR, &file.path);
    }
    Ok((files, any_mcp_server_injected))
}

/// V3 (KAS) analog of `kiro_cli`'s own `copy_agent_files_rewriting_
/// resources`: parses each agent's JSON and runs `resource_rewrite::
/// standard_passes_v3` over it before writing, rewriting `file://context/
/// <name>` and `skill://skills/<name>/SKILL.md` resources to absolute
/// paths and injecting `mcpServers.konductor-skills` plus a scoped `mcp`
/// `permissions.rules[]` grant when the MCP binary was installed.
///
/// Also returns whether that `mcpServers.konductor-skills` grant was
/// actually injected into at least one agent this run -- mirrors V2's
/// own `copy_agent_files_rewriting_resources` return exactly, since
/// `install_from_local` now gates the additive Claude/V3 settings grant
/// on it the same way `AgentInstallPhase::run` gates the V2 grant on
/// V2's own flag.
///
/// Verbatim-copy fast path for an agent that matches no pass and has no
/// SOP/skill-name sidecar entry, since parsing and re-serializing it
/// would then be pure overhead.
fn copy_agent_files_rewriting_resources(
    source_dir: &Path,
    destination: &Path,
    ctx: &RewriteContext<'_>,
    file_names: Vec<String>,
) -> Result<(Vec<ManifestFile>, bool), String> {
    let passes = standard_passes_v3();
    let mut files = Vec::with_capacity(file_names.len());
    let mut any_mcp_server_injected = false;

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
        if value
            .get("mcpServers")
            .and_then(|m| m.get(MCP_SERVER_NAME))
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
            sha256: Some(super::artifact::sha256_hex(&bytes)),
            // Overwritten by `attach_provenance`.
            provenance: Provenance::Created,
        });
    }
    Ok((files, any_mcp_server_injected))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-kiro-v3-strategy-test-{name}-{}",
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
        assert_eq!(KiroCliV3InstallStrategy.name(), "kiro-v3");
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
        assert_eq!(manifest.strategies[0].strategy, "kiro-v3");
        assert_eq!(manifest.strategies[0].destination, ".");
        assert!(manifest.strategies[0]
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
        assert!(manifest.strategies[0]
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

    /// Alongside the `mcpServers.konductor-skills` entry and the `mcp`
    /// permissions rule, a skill-bearing agent with the `skill-lookup-mcp`
    /// binary present also gets the `@konductor-skills` visibility tag in
    /// `tools[]`. Without it, `mcpServers`/`permissions` look correct but
    /// the server's tools are unreachable ("Tool not available") -- the
    /// regression this test locks in.
    #[test]
    fn install_from_local_injects_mcp_tools_visibility_tag_for_skill_bearing_agent() {
        let target_dir = scratch_dir("install-mcp-tools-tag-target");
        let repo_root = scratch_dir("install-mcp-tools-tag-repo");
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

        let tools = installed_json["tools"]
            .as_array()
            .expect("tools must be an array once the MCP server was injected");
        assert!(
            tools
                .iter()
                .any(|t| t.as_str() == Some("@konductor-skills")),
            "tools must carry the @konductor-skills visibility tag alongside \
             the mcpServers entry and permissions rule, or the server's \
             tools are authorized but unreachable; got {tools:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Mirrors `install_from_local_skips_mcp_wiring_when_binary_not_built`
    /// for the `tools` visibility tag: without a built `skill-lookup-mcp`
    /// binary, `rewrite` returns before injecting anything, so the
    /// `@konductor-skills` tag never lands in `tools[]`.
    #[test]
    fn install_from_local_omits_mcp_tools_visibility_tag_when_binary_not_built() {
        let target_dir = scratch_dir("install-mcp-tools-tag-skip-target");
        let repo_root = scratch_dir("install-mcp-tools-tag-skip-repo");
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

        match installed_json.get("tools") {
            None => {}
            Some(tools) => {
                let tools = tools.as_array().expect("tools, if present, is an array");
                assert!(
                    !tools
                        .iter()
                        .any(|t| t.as_str() == Some("@konductor-skills")),
                    "tools must not carry the @konductor-skills tag when no \
                     MCP server was injected; got {tools:?}"
                );
            }
        }

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
        // Alongside the raw copy above, every staged SOP also gets a
        // Kiro-discoverable `sop-<name>/SKILL.md` conversion under
        // `.kiro/skills/` -- see `install_kiro_sop_skills`'s own doc
        // comment.
        let sop_skill =
            fs::read_to_string(target_dir.join(".kiro/skills/sop-ticket-sync/SKILL.md"))
                .expect("expected a Kiro-discoverable SOP-skill conversion");
        assert!(sop_skill.contains("name: \"sop-ticket-sync\""));
        assert!(
            !sop_skill.contains("disable-model-invocation"),
            "Kiro CLI has no documented equivalent to Claude Code's \
             disable-model-invocation key, so it must be omitted entirely"
        );

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert_eq!(
            manifest.strategies[0].status,
            super::super::manifest::Status::Complete
        );
        // 5 content-type files (agent, skill, sop, kiro-sop-skill,
        // context) plus the standalone V3 telemetry hook document --
        // written unconditionally with telemetry enabled (the default,
        // `no_telemetry: false` above).
        assert_eq!(manifest.strategies[0].files.len(), 6);
        assert!(manifest.strategies[0]
            .files
            .iter()
            .any(|f| f.path == ".kiro/skills/sop-ticket-sync/SKILL.md"));

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
        // The agent file, plus the standalone V3 telemetry hook document
        // written unconditionally with telemetry enabled (the default,
        // `no_telemetry: false` above). Manifest files are serialized
        // sorted by path, and ".kiro/agents/..." sorts before
        // ".kiro/hooks/...", so index 0 remains the agent.
        assert_eq!(manifest.strategies[0].files.len(), 2);
        assert_eq!(
            manifest.strategies[0].files[0].path,
            ".kiro/agents/agent.json"
        );
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
        assert_eq!(
            manifest.strategies[0].status,
            super::super::manifest::Status::Complete
        );
        assert!(manifest.strategies[0]
            .files
            .iter()
            .any(|f| f.path == ".kiro/agents/k-example.json"));
        assert!(manifest.strategies[0]
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

    /// Guards a dual-marker target (`.kiro` AND a pre-existing `.claude`
    /// marker) with `kiro-cli-v2` installed against losing track of the
    /// additive Claude/V3 `.claude/settings.json` grant across a
    /// strategy switch: that grant lives in `kiro-cli-v2`'s own manifest
    /// slot (`plan_claude_settings_grant`/`apply_claude_settings_grant`),
    /// and switching to `kiro-v3` via the override
    /// (`manifest::upsert_strategy`'s override-on-switch) removes
    /// `kiro-cli-v2`'s slot outright. `kiro_cli_v3.rs`'s
    /// `install_from_local` must predict and write
    /// `.claude/settings.json` itself in that case, or the grant ends up
    /// claimed by NEITHER slot after the switch -- permanently
    /// unreachable by a future `uninstall`/`update`, which only ever act
    /// on a tracked slot's own `files` list.
    ///
    /// Also guards the second, related case: the dual-marker
    /// `.claude/skills/sop-<name>/SKILL.md` conversion
    /// (`claude::install_sop_skills`). This file is
    /// deliberately excluded from BOTH Kiro variants' own manifest
    /// slots (confirmed by `kiro_cli.rs`'s own
    /// `install_from_local_dual_marker_target_converts_claude_sop_skill_without_provenance_error`
    /// test), so the risk here is not manifest-orphaning but staleness:
    /// `kiro_cli_v3.rs`'s `install_from_local` must perform this
    /// conversion itself on every install, or switching to `kiro-v3`
    /// would freeze the file at whatever `kiro-cli-v2` last wrote, never
    /// refreshing it from newly-staged `dist/claude/sops/` content on a
    /// subsequent `kiro-v3` install. This test proves the content is
    /// actually regenerated (not merely left untouched) by changing the
    /// staged Claude-side SOP body between the two installs and
    /// asserting the installed file picks up the NEW body.
    #[test]
    fn install_from_local_reclaims_dual_marker_files_after_kiro_variant_override_switch() {
        let target_dir = scratch_dir("variant-switch-dual-marker-target");
        let repo_root = scratch_dir("variant-switch-dual-marker-repo");

        // Dual-marker target: `.kiro` (kiro-cli-v2's own marker) AND
        // `.claude` (a pre-existing Claude Code setup) both present
        // before either install runs.
        fs::create_dir_all(target_dir.join(".kiro")).unwrap();
        fs::create_dir_all(target_dir.join(".claude")).unwrap();

        // kiro-cli-v2's own (V2) staged content: a skill-bearing agent (so
        // the MCP grant -- and therefore the additive Claude/V3
        // settings grant -- actually fires) and a staged SOP with a
        // Claude-side copy for the dual-marker conversion.
        let v2_dist = repo_root.join("dist/kiro-cli-v2");
        fs::create_dir_all(v2_dist.join("agents")).unwrap();
        fs::write(
            v2_dist.join("agents/k-example.json"),
            br#"{"name":"k-example","resources":["skill://skills/constraints/SKILL.md"]}"#,
        )
        .unwrap();
        fs::create_dir_all(v2_dist.join("skills/constraints")).unwrap();
        fs::write(v2_dist.join("skills/constraints/SKILL.md"), b"body\n").unwrap();

        // Claude's own staged copy of the SOP -- the additive
        // dual-marker branch's real source (never Kiro's own staged
        // copy, whichever variant is running it).
        let claude_sops_dir = repo_root.join("dist/claude/sops");
        fs::create_dir_all(&claude_sops_dir).unwrap();
        fs::write(
            claude_sops_dir.join("ticket-sync.sop.md"),
            b"## Overview\n\nOriginal body from the kiro-cli-v2 install.\n",
        )
        .unwrap();

        fs::create_dir_all(repo_root.join("mcp/target/release")).unwrap();
        fs::write(
            repo_root.join("mcp/target/release/skill-lookup-mcp"),
            b"fake binary",
        )
        .unwrap();

        super::super::kiro_cli::KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("kiro-cli-v2 install must succeed on the dual-marker target");

        // Sanity: before the switch, `.claude/settings.json` is tracked
        // in kiro-cli-v2's own slot, and the dual-marker SOP-skill file
        // exists on disk with the original body -- but is tracked in
        // NEITHER slot (§9.5), consistent with `kiro_cli.rs`'s own
        // established behavior.
        let manifest_before = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after the kiro-cli-v2 install");
        assert_eq!(manifest_before.strategies.len(), 1);
        assert_eq!(manifest_before.strategies[0].strategy, "kiro-cli-v2");
        assert!(
            manifest_before.strategies[0]
                .files
                .iter()
                .any(|f| f.path == ".claude/settings.json"),
            "sanity check: kiro-cli-v2's own slot must claim .claude/settings.json before the switch"
        );
        let sop_skill_path = target_dir.join(".claude/skills/sop-ticket-sync/SKILL.md");
        let original_sop_skill_body =
            fs::read_to_string(&sop_skill_path).expect("dual-marker SOP-skill file must exist");
        assert!(original_sop_skill_body.contains("Original body from the kiro-cli-v2 install."));
        assert!(
            manifest_before.strategies[0]
                .files
                .iter()
                .all(|f| f.path != ".claude/skills/sop-ticket-sync/SKILL.md"),
            "sanity check: the dual-marker SOP-skill file is never claimed by kiro-cli-v2's own \
             slot"
        );

        // Re-stage the Claude-side SOP with a NEW body, and seed
        // kiro-v3's own (V3) staged content, mirroring what a real
        // `konductor synth` re-run for the v3 harness would produce
        // before `konductor install --harness kiro-v3` overrides
        // the target.
        fs::write(
            claude_sops_dir.join("ticket-sync.sop.md"),
            b"## Overview\n\nNEW body from the kiro-v3 install.\n",
        )
        .unwrap();
        let v3_dist = repo_root.join("dist").join(KiroCliV3Transformer.name());
        fs::create_dir_all(v3_dist.join("agents")).unwrap();
        fs::write(
            v3_dist.join("agents/k-example.json"),
            br#"{"name":"k-example","resources":["skill://skills/constraints/SKILL.md"],"permissions":{"rules":[]}}"#,
        )
        .unwrap();
        fs::create_dir_all(v3_dist.join("skills/constraints")).unwrap();
        fs::write(v3_dist.join("skills/constraints/SKILL.md"), b"body\n").unwrap();

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:01:00Z",
                false,
            )
            .expect("kiro-v3 override-switch install must succeed");

        let manifest_after = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after the override switch");
        assert_eq!(
            manifest_after.strategies.len(),
            1,
            "the override switch must leave exactly one tracked Kiro-variant slot, not two"
        );
        let slot = &manifest_after.strategies[0];
        assert_eq!(slot.strategy, "kiro-v3");

        // THE BUG: `.claude/settings.json` must be re-claimed by
        // kiro-v3's own new slot, not left orphaned by kiro-cli-v2's
        // slot having been removed outright on the switch.
        assert!(
            slot.files.iter().any(|f| f.path == ".claude/settings.json"),
            "kiro-v3's own slot must claim .claude/settings.json after the override switch \
             -- before this fix, it was claimed by NEITHER slot, permanently unreachable by a \
             future uninstall/update"
        );

        // THE SECOND GAP: the dual-marker SOP-skill file must have been
        // ACTUALLY REGENERATED by kiro-v3's own dual-marker branch
        // from the newly-staged Claude-side content -- not merely left
        // untouched with its stale, kiro-cli-v2-written body.
        let refreshed_sop_skill_body =
            fs::read_to_string(&sop_skill_path).expect("dual-marker SOP-skill file must exist");
        assert!(
            refreshed_sop_skill_body.contains("NEW body from the kiro-v3 install."),
            "kiro-v3 must regenerate the dual-marker SOP-skill file from the currently \
             staged dist/claude/sops/ content, not leave it frozen at kiro-cli-v2's stale body"
        );
        assert!(!refreshed_sop_skill_body.contains("Original body from the kiro-cli-v2 install."));

        // The dual-marker SOP-skill file remains
        // excluded from EITHER Kiro variant's own slot after the
        // switch too -- only `claude`'s own slot, if and when
        // separately installed, ever owns and manages it.
        assert!(
            slot.files
                .iter()
                .all(|f| f.path != ".claude/skills/sop-ticket-sync/SKILL.md"),
            "the dual-marker SOP-skill file must remain unclaimed by kiro-v3's own slot too"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The ownership decision for `.kiro/skills/sop-<name>/SKILL.md`
    /// (both this strategy and `KiroCliInstallStrategy` write this
    /// identical path): manifest-tracked under whichever Kiro variant's
    /// own slot is CURRENTLY installed, relying on `KIRO_VARIANT_FAMILY`'s
    /// existing mutual-exclusion/override-switch mechanism -- not the
    /// Claude-style untracked dual-marker treatment. `kiro-cli-v2` and
    /// `kiro-v3` can never both be tracked at the same target at once (see
    /// `manifest::KIRO_VARIANT_FAMILY`'s own doc comment), so there is no
    /// "both installed simultaneously" state this path needs to survive
    /// the way `.claude/skills/sop-<name>/SKILL.md` does (Claude Code and
    /// a Kiro variant DO legitimately coexist).
    ///
    /// This test drives the realistic version of "both would write it":
    /// install `kiro-cli-v2` first (tracking the file in ITS slot), then
    /// switch to `kiro-v3` with the SOP's content changed. Proves the
    /// file (a) survives the switch, (b) is ACTUALLY regenerated from
    /// the newly-staged content (not left frozen), and (c) ends up
    /// tracked in kiro-v3's new slot, not orphaned in neither slot the
    /// way the Claude dual-marker file deliberately is -- i.e. the
    /// opposite assertion from
    /// `install_from_local_reclaims_dual_marker_files_after_kiro_variant_override_switch`
    /// above, for this different path.
    #[test]
    fn install_from_local_kiro_sop_skill_survives_variant_override_switch() {
        let target_dir = scratch_dir("kiro-sop-skill-variant-switch-target");
        let repo_root = scratch_dir("kiro-sop-skill-variant-switch-repo");

        let v2_dist = repo_root.join("dist/kiro-cli-v2");
        fs::create_dir_all(v2_dist.join("sops")).unwrap();
        fs::write(
            v2_dist.join("sops/ticket-sync.sop.md"),
            b"## Overview\n\nOriginal body from the kiro-cli-v2 install.\n",
        )
        .unwrap();

        super::super::kiro_cli::KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("kiro-cli-v2 install must succeed");

        let sop_skill_path = target_dir.join(".kiro/skills/sop-ticket-sync/SKILL.md");
        let original_body = fs::read_to_string(&sop_skill_path)
            .expect("SOP-skill file must exist after v2 install");
        assert!(original_body.contains("Original body from the kiro-cli-v2 install."));

        let manifest_before = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after the kiro-cli-v2 install");
        assert_eq!(manifest_before.strategies.len(), 1);
        assert_eq!(manifest_before.strategies[0].strategy, "kiro-cli-v2");
        assert!(
            manifest_before.strategies[0]
                .files
                .iter()
                .any(|f| f.path == ".kiro/skills/sop-ticket-sync/SKILL.md"),
            "sanity check: kiro-cli-v2's own slot must claim the SOP-skill file before the switch"
        );

        // Re-stage the SOP with a NEW body under kiro-v3's own harness
        // dir, mirroring what a real `konductor synth --harness kiro-v3`
        // re-run would produce before `konductor install --harness
        // kiro-v3` overrides the target.
        let v3_dist = repo_root.join("dist").join(KiroCliV3Transformer.name());
        fs::create_dir_all(v3_dist.join("sops")).unwrap();
        fs::write(
            v3_dist.join("sops/ticket-sync.sop.md"),
            b"## Overview\n\nNEW body from the kiro-v3 install.\n",
        )
        .unwrap();

        KiroCliV3InstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:01:00Z",
                false,
            )
            .expect("kiro-v3 override-switch install must succeed");

        let manifest_after = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after the override switch");
        assert_eq!(
            manifest_after.strategies.len(),
            1,
            "the override switch must leave exactly one tracked Kiro-variant slot, not two"
        );
        let slot = &manifest_after.strategies[0];
        assert_eq!(slot.strategy, "kiro-v3");

        let refreshed_body = fs::read_to_string(&sop_skill_path)
            .expect("SOP-skill file must exist after the switch");
        assert!(
            refreshed_body.contains("NEW body from the kiro-v3 install."),
            "kiro-v3 must regenerate the SOP-skill file from its own currently staged content, \
             not leave it frozen at kiro-cli-v2's stale body"
        );
        assert!(!refreshed_body.contains("Original body from the kiro-cli-v2 install."));

        assert!(
            slot.files
                .iter()
                .any(|f| f.path == ".kiro/skills/sop-ticket-sync/SKILL.md"),
            "the SOP-skill file must be reclaimed by kiro-v3's own new slot after the switch \
             -- unlike the Claude dual-marker file, it must never end up orphaned in neither slot"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }
}
