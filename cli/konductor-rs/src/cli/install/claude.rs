// SPDX-License-Identifier: Apache-2.0
//
// install/claude.rs — `InstallStrategy` for the Claude Code runtime.
//
// Installs agents and skills only, from a local synth output tree at
// `<repo_root>/dist/claude/{agents,skills}/**` (`--from <repo-root>`)
// into `<target_dir>/.claude/{agents,skills}/`. Both content types share
// the single `.claude/` root: unlike Kiro CLI, which scans
// `.kiro/skills/` unconditionally and so needs a separate
// `.konductor/skills/` root to keep skills out of that scan, Claude Code
// only loads a skill when an agent's own frontmatter names it or the
// agent invokes the `Skill` tool on demand — there is no unconditional
// directory scan to escape here. This `.claude/agents/`+`.claude/skills/`
// convention is the same one documented in this codebase's own
// `aim-agent-authoring`/`about-konductor` skill content
// (`clientConfig.claudeCli.skills` -> `skills:` frontmatter;
// `.claude/skills/<name>/SKILL.md` for the packaged bodies).
//
// No `resources`/`mcpServers` rewrite pass is needed the way
// `kiro_cli.rs`'s `install_agents` needs one: a Claude Code agent file is
// self-contained Markdown with no cross-file resource pointers, and its
// `skills:` frontmatter already carries the resolved skill content synth
// itself produced.
//
// Out of scope on THIS (install) side: a separate context-install phase
// or on-disk context directory. Unlike Kiro CLI (`.kiro/context/` +
// `file://context/<name>` resource entries), Claude Code has no
// runtime-scanned context directory to target at all -- the real
// materialization behavior confirms this: context content is spliced
// directly into the agent's rendered `.md` body at SYNTH time, wrapped in a
// `<Context: filename.md>...</Context: filename.md>` marker (see
// `synth/claude.rs`'s `render_agent_md`), not written as a sibling file
// `install` would need its own phase to copy. So there is genuinely
// nothing for `install` to do for context here -- it is already inline
// in the same agent file `AgentInstallPhase`-equivalent copying already
// handles. The MCP server binary / permission-grant wiring remains
// separately out of scope (owned by a separate, still-in-progress
// investigation).
//
// SOPs ARE in scope, via `install_sop_skills` (called from `phases.rs`'s
// shared `SopInstallPhase::run`, gated on `detect_runtimes` finding a
// `.claude` marker at the target): each staged `<name>.sop.md` is
// converted into a `sop-<name>/SKILL.md` under `.claude/skills/`, not
// copied verbatim -- Claude Code has no MCP-prompt equivalent to serve
// `.sop.md` files directly the way `skill-lookup-mcp` does for Kiro CLI,
// so each SOP becomes its own slash-invokable, non-model-triggered
// skill instead (`disable-model-invocation: true`).
//
// `ClaudeTransformer` — the synth side that produces `dist/claude/...`
// (`name()` returns `"claude"`) — lives on a separate, unmerged branch
// (CR-302063900, `wt-synth-transformers`). This module does not import
// it, to avoid stacking a second dependency on top of this CR's existing
// one on CR-302062531. `CLAUDE_HARNESS_DIR` below is a hand-kept copy of
// that `name()` value, and every test in this file seeds a
// `dist/claude/...` fixture tree directly rather than depending on that
// branch's code.

use std::path::Path;

use super::kiro_cli::{
    attach_provenance, copy_agent_files, copy_skill_dir_recursive, list_agent_files_like,
    list_skill_dirs, plan_skill_dir_recursive, reject_unsafe_file_name, PlannedFile,
};
use super::manifest::{classify_provenance, ManifestFile, Status, StrategyManifest};
use super::phases::{run_all_phases, InstallPhase, PhaseOutputs, SopInstallPhase};
use super::runtime::{detect_runtimes, Runtime};
use super::InstallError;
use super::InstallStrategy;
use crate::cli::synth::kiro_cli_v2::{
    AGENTS_CONTENT_TYPE_DIR, SKILLS_CONTENT_TYPE_DIR, SOPS_CONTENT_TYPE_DIR,
};

/// Harness directory name `ClaudeTransformer` (CR-302063900, not yet
/// merged) stages synth output under (`dist/<name>/`). A local string
/// literal, not an import of that transformer's own `name()` constant
/// (unlike `kiro_cli.rs`, which imports `KiroCliV2Transformer.name()`
/// directly), so it must be kept in sync by hand if that transformer's
/// `name()` ever changes.
pub(crate) const CLAUDE_HARNESS_DIR: &str = "claude";

/// Destination root, relative to `target_dir`, both agents and skills
/// install under.
pub(crate) const CLAUDE_DESTINATION_ROOT: &str = ".claude";

/// Installs Konductor for the Claude Code runtime: copies synthed agent
/// Markdown files into `.claude/agents/` and synthed skill directories
/// into `.claude/skills/` from a local `--from <repo-root>` source, then
/// writes `.konductor/manifest`.
pub struct ClaudeInstallStrategy;

impl InstallStrategy for ClaudeInstallStrategy {
    /// Matches `CLAUDE_HARNESS_DIR`/`ClaudeTransformer::name()`
    /// (`"claude"`) exactly -- the harness/strategy name unification
    /// removes the translation layer that used to exist between
    /// `--harness claude` and this strategy's own internal
    /// manifest-recorded name, which used to carry a `"-code"` suffix.
    fn name(&self) -> &'static str {
        "claude"
    }

    /// Now identical to `name()` by construction (see this impl's own
    /// `name()` doc comment) -- delegates directly rather than
    /// returning the separately-declared `CLAUDE_HARNESS_DIR` constant.
    fn harness_dir(&self) -> &'static str {
        self.name()
    }

    /// Applies only when Claude Code is detected at the target (a
    /// `.claude` marker directory already exists). Unlike
    /// `KiroCliInstallStrategy::matches`, this never claims an
    /// undetected/empty target as a default -- `KiroCliInstallStrategy`
    /// is registered first in `registry::STRATEGIES` and already claims
    /// every undetected target, so an empty target never reaches this
    /// strategy's `matches` under the current registration order (see
    /// `registry.rs`). Written this way regardless, so this strategy's
    /// own contract does not silently depend on that ordering.
    fn matches(&self, target_dir: &Path) -> bool {
        detect_runtimes(target_dir).has(Runtime::ClaudeCode)
    }

    /// Same no-op pre-check contract as
    /// `KiroCliInstallStrategy::would_fail_as_noop` (see that
    /// implementation's own doc comment), scoped to this strategy's
    /// two content types.
    fn would_fail_as_noop(&self, target_dir: &Path, from: Option<&str>) -> Option<String> {
        let Some(repo_root) = from else {
            return Some(super::NO_REMOTE_RELEASE_MESSAGE.to_string());
        };
        let repo_root = Path::new(repo_root);
        let harness_dir = repo_root.join("dist").join(CLAUDE_HARNESS_DIR);

        match plan_all_files(&harness_dir, target_dir, None) {
            Ok(plan) if plan.is_empty() => Some(format!(
                "no synthed agent or skill files found under {} -- run `konductor synth --from {}` first",
                harness_dir.display(),
                repo_root.display()
            )),
            Ok(_) => None,
            Err(message) => Some(message),
        }
    }

    /// Same write-ahead sequencing as `KiroCliInstallStrategy`'s own
    /// `install_from_local` (see that implementation's own doc
    /// comment): plan every file first (no copy), write an
    /// `InProgress` manifest naming the plan, run the phase chain,
    /// attach real provenance to what was actually copied, then
    /// rewrite the manifest as `Complete`.
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
        let harness_dir = repo_root.join("dist").join(CLAUDE_HARNESS_DIR);

        // Recorded into the manifest's `source` field, same rationale as
        // `kiro_cli.rs`'s own `install_from_local`.
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

        // `claude` is not a `KIRO_VARIANT_FAMILY` member,
        // so `effective_prior_slot` here always resolves to this
        // strategy's own tracked slot (or `None`, on a fresh install) --
        // never borrows another strategy's slot the way a Kiro-variant
        // override switch does (see `kiro_cli.rs`'s own doc comment on
        // the identical call).
        let full_prior_manifest = super::manifest::read_manifest(target_dir)?;
        let prior_manifest: Option<StrategyManifest> = full_prior_manifest
            .as_ref()
            .and_then(|full| super::manifest::effective_prior_slot(full, self.name()))
            .cloned();

        let plan = plan_all_files(&harness_dir, target_dir, prior_manifest.as_ref())?;
        if plan.is_empty() {
            return Err(InstallError::Message(format!(
                "no synthed agent or skill files found under {} -- run `konductor synth --from {}` first",
                harness_dir.display(),
                repo_root.display()
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
        let write_ahead = StrategyManifest::new(
            self.name(),
            installed_at,
            ".",
            source.clone(),
            Status::InProgress,
            in_progress_files,
        );
        super::manifest::upsert_strategy(target_dir, write_ahead)?;

        let raw_files = run_all_phases(
            &standard_claude_install_phases(),
            &harness_dir,
            target_dir,
            Some(repo_root),
            prior_manifest.as_ref(),
            no_telemetry,
        )?;
        let files = attach_provenance(raw_files, &plan)?;

        let complete = StrategyManifest::new(
            self.name(),
            installed_at,
            ".",
            source,
            Status::Complete,
            files,
        );
        super::manifest::upsert_strategy(target_dir, complete)?;
        Ok(())
    }
}

/// The Claude Code chain: skills, then the shared `SopInstallPhase`
/// (reused unchanged from `phases.rs` -- converts every staged
/// `.sop.md` into a `sop-<name>/SKILL.md` under `.claude/skills/`, see
/// that struct's own doc comment), then agents. Skills before agents
/// mirrors `kiro_cli.rs`'s own ordering, kept consistent so a future
/// addition that needs skills on disk first (e.g. a
/// reference-verification pass) does not have to also reorder this
/// chain.
pub(super) fn standard_claude_install_phases() -> Vec<Box<dyn InstallPhase>> {
    vec![
        Box::new(ClaudeSkillInstallPhase),
        Box::new(SopInstallPhase),
        Box::new(ClaudeAgentInstallPhase),
    ]
}

// ── Phase: skills ──────────────────────────────────────────────────────────

/// Wraps `install_skills` (below): copies every skill directory under
/// `<staged_root>/skills/` into `<target_dir>/.claude/skills/<name>/`,
/// merging exactly like `kiro_cli.rs`'s own `install_skills` (see that
/// function's own doc comment for the merge/cleanup contract, which
/// this one mirrors verbatim aside from the destination root).
pub(super) struct ClaudeSkillInstallPhase;

impl InstallPhase for ClaudeSkillInstallPhase {
    fn name(&self) -> &'static str {
        "claude-skills"
    }

    fn run(
        &self,
        staged_root: &Path,
        target_dir: &Path,
        _repo_root: Option<&Path>,
        prior_manifest: Option<&StrategyManifest>,
        _phase_outputs: &PhaseOutputs,
        _no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError> {
        Ok(install_skills(staged_root, target_dir, prior_manifest)?)
    }
}

// ── Phase: agents ──────────────────────────────────────────────────────────

/// Wraps `install_agents` (below): copies every `*.md` file under
/// `<staged_root>/agents/` verbatim into
/// `<target_dir>/.claude/agents/`. No resource rewrite, no MCP-binary
/// injection — a Claude Code agent Markdown file carries no such
/// cross-file resource pointers.
pub(super) struct ClaudeAgentInstallPhase;

impl InstallPhase for ClaudeAgentInstallPhase {
    fn name(&self) -> &'static str {
        "claude-agents"
    }

    fn run(
        &self,
        staged_root: &Path,
        target_dir: &Path,
        _repo_root: Option<&Path>,
        _prior_manifest: Option<&StrategyManifest>,
        _phase_outputs: &PhaseOutputs,
        _no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError> {
        Ok(install_agents(staged_root, target_dir)?)
    }
}

/// Builds the full write-ahead plan across both content types (skills,
/// agents), in the order `install_from_local`'s chain later copies them
/// in, without copying or writing anything. Mirrors
/// `kiro_cli::plan_all_files`, scoped to this strategy's two content
/// types and destination root.
fn plan_all_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
) -> Result<Vec<PlannedFile>, String> {
    let mut plan = Vec::new();
    plan.extend(plan_skill_files(harness_dir, target_dir, prior_manifest)?);
    plan.extend(plan_sop_skill_files(
        harness_dir,
        target_dir,
        prior_manifest,
    )?);
    plan.extend(plan_agent_files(harness_dir, target_dir, prior_manifest)?);
    Ok(plan)
}

/// Plans every file `install_sop_skills` will write: one `SKILL.md` per
/// staged `<name>.sop.md`, under a `sop-<name>/` directory -- same
/// source listing (`list_agent_files_like`, since `.sop.md` isn't the
/// `.md` extension `list_agent_files_md` expects) and same manifest-path
/// construction, but only classifies provenance against the destination
/// -- no read, no conversion, no write.
///
/// `pub(super)`: also called directly from `kiro_cli.rs`'s own
/// `plan_additive_claude_sop_skill_files`, which predicts these SAME
/// files for the additive dual-marker case `SopInstallPhase::run`'s
/// Kiro branch reaches into (see that struct's own doc comment) --
/// reusing this function rather than re-deriving an approximation is
/// what keeps that prediction from silently drifting out of sync with
/// what `install_sop_skills` actually writes.
pub(super) fn plan_sop_skill_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
) -> Result<Vec<PlannedFile>, String> {
    let source_dir = harness_dir.join(SOPS_CONTENT_TYPE_DIR);
    let entries = list_agent_files_like(&source_dir)?;
    let destination_root = target_dir
        .join(CLAUDE_DESTINATION_ROOT)
        .join(SKILLS_CONTENT_TYPE_DIR);

    let mut plan = Vec::with_capacity(entries.len());
    for file_name in entries {
        let Some(sop_name) = file_name.strip_suffix(".sop.md") else {
            continue;
        };
        let skill_relative_path = format!("sop-{sop_name}/SKILL.md");
        let manifest_path = content_manifest_path(SKILLS_CONTENT_TYPE_DIR, &skill_relative_path);
        let provenance = classify_provenance(
            &destination_root.join(&skill_relative_path),
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

/// Plans every file `install_skills` will copy: same source listing
/// (`list_skill_dirs`) and same manifest-path prefixing, but only
/// classifies provenance against the destination -- no copy. Mirrors
/// `kiro_cli::plan_skill_files`, using `CLAUDE_DESTINATION_ROOT`.
fn plan_skill_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
) -> Result<Vec<PlannedFile>, String> {
    let source_root = harness_dir.join(SKILLS_CONTENT_TYPE_DIR);
    let skill_names = list_skill_dirs(&source_root)?;
    let destination_root = target_dir
        .join(CLAUDE_DESTINATION_ROOT)
        .join(SKILLS_CONTENT_TYPE_DIR);

    let mut plan = Vec::new();
    for skill_name in skill_names {
        let skill_source = source_root.join(&skill_name);
        let skill_destination = destination_root.join(&skill_name);
        let manifest_prefix = content_manifest_path(SKILLS_CONTENT_TYPE_DIR, &skill_name);
        plan_skill_dir_recursive(
            &skill_source,
            &skill_destination,
            &manifest_prefix,
            prior_manifest,
            &mut plan,
        )?;
    }
    Ok(plan)
}

/// Plans every file `install_agents` will copy: same source listing
/// (`list_agent_files_md`) and same manifest-path prefixing, but only
/// classifies provenance against the destination -- no copy. Mirrors
/// `kiro_cli::plan_agent_files`, using `CLAUDE_DESTINATION_ROOT`.
fn plan_agent_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
) -> Result<Vec<PlannedFile>, String> {
    let source_dir = harness_dir.join(AGENTS_CONTENT_TYPE_DIR);
    let entries = list_agent_files_md(&source_dir)?;
    let destination = target_dir
        .join(CLAUDE_DESTINATION_ROOT)
        .join(AGENTS_CONTENT_TYPE_DIR);
    let mut plan = Vec::with_capacity(entries.len());
    for file_name in entries {
        let manifest_path = content_manifest_path(AGENTS_CONTENT_TYPE_DIR, &file_name);
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

/// The manifest-relative path for a content item under this strategy's
/// single `.claude/` root: `.claude/<content_dir>/<name>`. Spelled once
/// so the write-ahead PLAN side and the COPY side can never build it
/// differently -- delegates to `kiro_cli::content_manifest_path` (already
/// generic over `root`) fixed to `CLAUDE_DESTINATION_ROOT`, rather than
/// reimplementing the same one-line format string a second time.
fn content_manifest_path(content_dir: &str, name: &str) -> String {
    super::kiro_cli::content_manifest_path(CLAUDE_DESTINATION_ROOT, content_dir, name)
}

/// Copies each skill directory under `<harness_dir>/skills/` into
/// `<target_dir>/.claude/skills/<name>/`, returning manifest entries for
/// every file copied. Merges exactly like `kiro_cli::install_skills`
/// (see that function's own doc comment for the full merge/cleanup
/// contract -- copies the synthed skill in, overwriting colliding
/// files, then deletes only files a prior Konductor install recorded
/// under this exact skill that this run did not re-write, so a file
/// dropped from the source doesn't linger; a foreign, hand-authored file
/// sharing a synthed skill's name is never removed). Returns an empty
/// `Vec` (not an error) when the source directory is missing or has no
/// skill subdirectories.
pub(super) fn install_skills(
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
        .join(CLAUDE_DESTINATION_ROOT)
        .join(SKILLS_CONTENT_TYPE_DIR);
    std::fs::create_dir_all(&destination_root)
        .map_err(|e| format!("failed to create {}: {e}", destination_root.display()))?;

    let mut files = Vec::new();
    for skill_name in skill_names {
        reject_unsafe_file_name(&skill_name)?;
        let skill_source = source_root.join(&skill_name);
        let skill_destination = destination_root.join(&skill_name);
        let manifest_prefix = content_manifest_path(SKILLS_CONTENT_TYPE_DIR, &skill_name);

        std::fs::create_dir_all(&skill_destination)
            .map_err(|e| format!("failed to create {}: {e}", skill_destination.display()))?;

        let before_len = files.len();
        copy_skill_dir_recursive(
            &skill_source,
            &skill_destination,
            &manifest_prefix,
            &mut files,
        )?;

        let written_this_skill: std::collections::HashSet<String> =
            files[before_len..].iter().map(|f| f.path.clone()).collect();
        if let Some(prior) = prior_manifest {
            let prefix = format!("{manifest_prefix}/");
            for prior_file in &prior.files {
                if prior_file.path.starts_with(&prefix)
                    && !written_this_skill.contains(&prior_file.path)
                {
                    let stale = target_dir.join(&prior_file.path);
                    let _ = std::fs::remove_file(&stale);
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

/// Copies `*.md` files from `<harness_dir>/agents/` into
/// `<target_dir>/.claude/agents/`, returning their manifest entries.
/// Returns an empty `Vec` (not an error) when the source directory is
/// missing or has no agent files. Unlike `kiro_cli::install_agents`,
/// this performs a plain verbatim copy (`copy_agent_files`) -- no
/// `resources`/`mcpServers` rewrite pass, since a Claude Code agent
/// Markdown file carries no such cross-file resource pointers.
pub(super) fn install_agents(
    harness_dir: &Path,
    target_dir: &Path,
) -> Result<Vec<ManifestFile>, String> {
    let source_dir = harness_dir.join(AGENTS_CONTENT_TYPE_DIR);
    let entries = list_agent_files_md(&source_dir)?;
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let destination = target_dir
        .join(CLAUDE_DESTINATION_ROOT)
        .join(AGENTS_CONTENT_TYPE_DIR);
    std::fs::create_dir_all(&destination)
        .map_err(|e| format!("failed to create {}: {e}", destination.display()))?;

    let mut files = copy_agent_files(&source_dir, &destination, entries)?;
    for file in &mut files {
        file.path = content_manifest_path(AGENTS_CONTENT_TYPE_DIR, &file.path);
    }
    Ok(files)
}

/// Converts every staged `<name>.sop.md` file under
/// `<harness_dir>/sops/` into a `sop-<name>/SKILL.md` file under
/// `<target_dir>/.claude/skills/`, following AIM's own
/// `SopToSkillConverter` contract (see `render_sop_skill_md`'s own doc
/// comment for the exact frontmatter/body shape). Returns an empty
/// `Vec` (not an error) when the source directory is missing or has no
/// staged SOPs.
///
/// Unconditional over every staged SOP, not per-agent-filtered --
/// mirrors `install_skills`'s own "copy everything staged" contract:
/// Claude Code has no per-agent server-side filtering mechanism the way
/// Kiro's `--agent-sop-filter` provides (see `resource_rewrite.rs`'s
/// `McpServerPass`), so scoping which agent's frontmatter references
/// which SOP-skill is left to synth/authoring, not to selective
/// installation here.
pub(super) fn install_sop_skills(
    harness_dir: &Path,
    target_dir: &Path,
) -> Result<Vec<ManifestFile>, String> {
    let source_dir = harness_dir.join(SOPS_CONTENT_TYPE_DIR);
    let entries = list_agent_files_like(&source_dir)?;
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let destination_root = target_dir
        .join(CLAUDE_DESTINATION_ROOT)
        .join(SKILLS_CONTENT_TYPE_DIR);

    let mut files = Vec::with_capacity(entries.len());
    for file_name in entries {
        let Some(sop_name) = file_name.strip_suffix(".sop.md") else {
            // list_agent_files_like has no extension filter (unlike
            // list_agent_files_md above) -- skip anything that isn't
            // shaped like a SOP file rather than erroring, matching this
            // codebase's "one spurious entry shouldn't abort the whole
            // install" convention.
            continue;
        };
        reject_unsafe_file_name(sop_name)?;
        let skill_dir_name = format!("sop-{sop_name}");
        reject_unsafe_file_name(&skill_dir_name)?;

        let src = source_dir.join(&file_name);
        let body = std::fs::read_to_string(&src)
            .map_err(|e| format!("failed to read {}: {e}", src.display()))?;
        let rendered = render_sop_skill_md(sop_name, &body);

        let skill_dir = destination_root.join(&skill_dir_name);
        std::fs::create_dir_all(&skill_dir)
            .map_err(|e| format!("failed to create {}: {e}", skill_dir.display()))?;
        let dst = skill_dir.join("SKILL.md");
        crate::cli::atomic_write::write_atomic(&dst, rendered.as_bytes())
            .map_err(|e| format!("failed to write {}: {e}", dst.display()))?;

        let manifest_path = content_manifest_path(
            SKILLS_CONTENT_TYPE_DIR,
            &format!("{skill_dir_name}/SKILL.md"),
        );
        files.push(ManifestFile {
            path: manifest_path,
            sha256: Some(super::artifact::sha256_hex(rendered.as_bytes())),
            // Overwritten by `attach_provenance`.
            provenance: crate::cli::install::manifest::Provenance::Created,
        });
    }
    Ok(files)
}

/// Renders a `.sop.md` body as a Claude Code `SKILL.md`, following
/// AIM's own `SopToSkillConverter` contract, verified directly against a
/// real installed `sop-*/SKILL.md` produced by that converter (e.g.
/// `sop-about-konductor/SKILL.md`):
/// - frontmatter `name:` -- `sop-<sopName>`, rendered as a YAML
///   double-quoted scalar (see `yaml_double_quote`) for the same reason
///   as `description:` below: `sop_name` comes from the staged file
///   name minus `.sop.md` (see `install_sop_skills`), and
///   `reject_unsafe_file_name` only guards path safety, not YAML
///   plain-scalar shape -- a name containing `#` or `:` would otherwise
///   corrupt or silently truncate this line
/// - frontmatter `description:` -- AIM's real converter extracts this
///   from the source `.sop.md`'s own `## Overview` section: specifically
///   the first physical line of that section's body (see
///   `extract_overview_description`'s own doc comment), NOT the whole
///   paragraph and NOT a generated sentence. Rendered as a YAML
///   double-quoted scalar (see `yaml_double_quote`) so an embedded colon
///   -- present in essentially every real SOP's first Overview line, e.g.
///   "Onboards a new or lost user: install the CLI..." -- can never break
///   frontmatter parsing.
/// - an optional frontmatter `arguments: [...]` array (YAML flow-sequence
///   syntax, matching AIM's own real output), scraped from a
///   `## Parameters` section in the body (see
///   `scrape_sop_parameters`'s own doc comment for the scraping rule and
///   the invalid-identifier omission edge case)
/// - frontmatter `disable-model-invocation: true`
/// - a body wrapping the original SOP text in
///   `<agent-sop name="...">`/`<content>`/`<user-input>` tags, with
///   `sop_name` XML-attribute-escaped and the body guarded against a
///   literal `</content>`/`</agent-sop>` substring prematurely closing
///   the wrapper (see `escape_xml_attr`/`guard_sop_body`)
fn render_sop_skill_md(sop_name: &str, body: &str) -> String {
    let description = extract_overview_description(body)
        .unwrap_or_else(|| format!("Standard operating procedure: {sop_name}."));
    let mut frontmatter = format!(
        "---\nname: {}\ndescription: {}\n",
        yaml_double_quote(&format!("sop-{sop_name}")),
        yaml_double_quote(&description)
    );
    if let Some(arguments) = scrape_sop_parameters(body) {
        frontmatter.push_str(&format!("arguments: [{}]\n", arguments.join(", ")));
    }
    frontmatter.push_str("disable-model-invocation: true\n---\n\n");

    let escaped_name = escape_xml_attr(sop_name);
    let guarded_body = guard_sop_body(body);
    format!(
        "{frontmatter}<agent-sop name=\"{escaped_name}\"><content>\n{guarded_body}\n</content><user-input>$ARGUMENTS</user-input></agent-sop>\n"
    )
}

/// Extracts the generated skill's `description:` from `body`'s own
/// `## Overview` section, matching AIM's real `SopToSkillConverter`
/// behavior: the first non-blank physical line following a `## Overview`
/// heading, taken verbatim (not the whole paragraph, not truncated or
/// re-wrapped) -- confirmed against a real installed `sop-*/SKILL.md`
/// and its source `.sop.md`, where the source's manually-wrapped first
/// line ("Onboards a new or lost user: install the CLI, talk to the
/// orchestrator in") is exactly what the installed `description:` field
/// carries, mid-word cutoff and all.
///
/// Returns `None` when there is no `## Overview` heading, or the section
/// has no non-blank line before the next heading -- `render_sop_skill_md`
/// falls back to a generated sentence in that case.
fn extract_overview_description(body: &str) -> Option<String> {
    let mut lines = body.lines();
    loop {
        let line = lines.next()?;
        if line.trim() == "## Overview" {
            break;
        }
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            return None;
        }
        return Some(trimmed.to_string());
    }
    None
}

/// Renders `text` as a YAML double-quoted scalar: wraps it in `"..."`
/// with every embedded `\` and `"` backslash-escaped. Safe for any
/// single-line text with no control characters, which is what both
/// callers (a SOP's Overview line, a SOP name) are -- `.sop.md` bodies
/// and file-name-derived SOP names never contain embedded newlines or
/// other YAML-significant control characters. This is what makes an
/// Overview line containing a colon (e.g. "Onboards a new or lost user:
/// install the CLI...") safe as a YAML scalar: unlike a plain/unquoted
/// scalar, `": "` inside a double-quoted string is never interpreted as
/// a mapping separator.
fn yaml_double_quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Escapes `text` for safe interpolation into a double-quoted XML/HTML-
/// style attribute value (the `<agent-sop name="...">` wrapper this
/// module renders) -- escapes `&` first (so it never double-escapes an
/// entity this function itself just introduced), then `"`, `<`, `>`.
/// `sop_name` is derived from a staged file name only validated by
/// `reject_unsafe_file_name`/`reject_unsafe_sop_name` (path-traversal
/// safety, not attribute safety), so a name containing `"` would
/// otherwise prematurely close the attribute.
fn escape_xml_attr(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Guards a SOP body against the literal substrings `</content>` and
/// `</agent-sop>` appearing in its own text (plausible for any SOP that
/// documents this exact wrapper format, including this codebase's own
/// SOP-authoring guidance) from prematurely closing the wrapper
/// `render_sop_skill_md` builds around it. Breaks an exact match by
/// inserting a zero-width space between `<` and `/` -- invisible to a
/// reader or a model, but no longer byte-identical to either closing
/// tag, so the wrapper's own real closing tags (appended after this
/// guarded body, never containing the inserted character) remain the
/// only ones that match.
fn guard_sop_body(body: &str) -> String {
    body.replace("</content>", "<\u{200b}/content>")
        .replace("</agent-sop>", "<\u{200b}/agent-sop>")
}

/// Scrapes parameter names from a `## Parameters` section in `body`, up
/// to the next heading or the first line that fits neither of the two
/// real conventions below. Confirmed against every real `.sop.md` file
/// in `agent-sops/`, which use one of two shapes for this section:
///
/// 1. **Bullet list** (`- **name** (required|optional[, default: ...]):
///    description`, e.g. `- **question** (optional): The user's
///    specific question...`) -- the name is the text between the first
///    `**...**` pair. A bullet whose item does not start with `**` is
///    skipped, not treated as invalidating the whole section: some real
///    SOPs nest plain, non-bold detail bullets under a parameter's own
///    description (e.g. `k-adversarial-pull-request-review.sop.md`'s
///    `diff_input` lists three indented `- Git diff output...`-style
///    sub-bullets), and those are never parameter declarations of their
///    own.
/// 2. **Markdown table** (`| Parameter | Required | Description |`,
///    used by e.g. `k-e2e-test-generation.sop.md`) -- the name is the
///    first cell of each DATA row (backtick-wrapped, e.g. `` `url` ``),
///    skipping the header row and the `---`-style separator row that
///    follows it.
///
/// A line indented with leading whitespace is always a nested/continuation
/// detail (never a parameter of its own, never ends the section) --
/// checked against the RAW line, before any `trim()`, so indentation is
/// what distinguishes a top-level parameter bullet from a nested detail
/// bullet at the same "- " shape.
///
/// Returns `None` (omit `arguments` from the rendered frontmatter
/// entirely) when: no `## Parameters` section exists, the section
/// yields no parameter names at all, ANY scraped name is not a valid
/// identifier (`[A-Za-z_][A-Za-z0-9_]*`), or ANY scraped name is a YAML
/// 1.1 plain-scalar reserved word (see `is_yaml_1_1_reserved_word`) --
/// per AIM's own rule, a single malformed or unsafe-to-render parameter
/// name invalidates the whole `arguments` array rather than silently
/// emitting a partial/malformed one.
fn scrape_sop_parameters(body: &str) -> Option<Vec<String>> {
    enum Format {
        Bullet,
        Table,
    }

    let mut lines = body.lines();
    loop {
        let line = lines.next()?;
        if line.trim() == "## Parameters" {
            break;
        }
    }

    let mut names = Vec::new();
    let mut format: Option<Format> = None;
    let mut table_header_consumed = false;
    let mut table_separator_consumed = false;

    for line in lines {
        if line.starts_with(' ') || line.starts_with('\t') {
            // Indented continuation / nested detail bullet -- never a
            // parameter of its own, never ends the section.
            continue;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            break;
        }

        if let Some(row) = trimmed.strip_prefix('|') {
            match format {
                None => {
                    format = Some(Format::Table);
                    table_header_consumed = true; // this row is the header
                }
                Some(Format::Bullet) => break, // shape mismatch mid-section
                Some(Format::Table) => {
                    if table_header_consumed && !table_separator_consumed {
                        table_separator_consumed = true;
                        if is_table_separator_row(row) {
                            continue;
                        }
                        // Not actually a separator (malformed table) --
                        // fall through and treat it as a data row.
                    }
                    if let Some(name) = table_row_first_cell(row) {
                        names.push(name);
                    }
                }
            }
            continue;
        }

        let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
        else {
            // A non-bullet, non-table, non-heading line (e.g.
            // "**Constraints for parameter acquisition:**") marks the
            // end of the Parameters list.
            break;
        };
        match format {
            Some(Format::Table) => break, // shape mismatch mid-section
            _ => format = Some(Format::Bullet),
        }
        if let Some(name) = bullet_bold_name(item) {
            names.push(name);
        }
        // A bullet whose item is not `**name**...` (e.g. a nested detail
        // bullet at the top indentation level by mistake) is skipped
        // rather than invalidating the section -- only a scraped name
        // that fails `is_valid_identifier` below does that.
    }

    if names.is_empty() {
        return None;
    }
    if !names
        .iter()
        .all(|name| is_valid_identifier(name) && !is_yaml_1_1_reserved_word(name))
    {
        return None;
    }
    Some(names)
}

/// Extracts `name` from a bullet item shaped `**name** ...` -- the text
/// between the first `**` pair, trimmed. Returns `None` when `item`
/// doesn't open with `**` at all, or that `**` is never closed.
fn bullet_bold_name(item: &str) -> Option<String> {
    let after_open = item.strip_prefix("**")?;
    let end = after_open.find("**")?;
    let name = after_open[..end].trim();
    Some(name.to_string())
}

/// Whether `row` (the text of a table row after its leading `|` was
/// already stripped) is a Markdown header-separator row: every
/// character is one of `-`, `:`, `|`, or whitespace.
fn is_table_separator_row(row: &str) -> bool {
    !row.trim().is_empty() && row.chars().all(|c| matches!(c, '-' | ':' | '|' | ' '))
}

/// Extracts a table row's first cell (the parameter name column),
/// stripping surrounding whitespace and a backtick-code-span wrapper
/// (e.g. `` `url` `` -> `url`) -- `row` is the row's text after its
/// leading `|` was already stripped, so the first cell is everything up
/// to (not including) the next `|`.
fn table_row_first_cell(row: &str) -> Option<String> {
    let cell = row.split('|').next()?.trim();
    let name = cell.trim_matches('`').trim();
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

/// Whether `name` matches `[A-Za-z_][A-Za-z0-9_]*` -- a valid bare
/// identifier, with no leading digit and no characters outside
/// ASCII-alphanumeric-or-underscore.
fn is_valid_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Whether `name` (case-insensitively) is one of the YAML 1.1
/// plain-scalar words a YAML 1.1-compliant loader resolves to a boolean
/// or null rather than the literal string: `y`/`n`/`yes`/`no`/`true`/
/// `false`/`on`/`off`/`null`. Every one of these is ASCII-alphabetic, so
/// each also passes `is_valid_identifier` -- a parameter literally named
/// one of them would render unquoted inside the `arguments: [...]` flow
/// sequence (`render_sop_skill_md`) and silently corrupt to a boolean or
/// null under such a loader instead of staying the string it was named.
fn is_yaml_1_1_reserved_word(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "y" | "n" | "yes" | "no" | "true" | "false" | "on" | "off" | "null"
    )
}

/// Lists `*.md` file names directly under `dir`, sorted for
/// deterministic install order. Mirrors `kiro_cli::list_agent_files`'s
/// shape (extension filter, symlink/non-file skip), scoped to `.md`
/// rather than `.json` -- Claude Code's own agent-file extension.
/// Returns an empty `Vec` (not an error) when `dir` itself is missing.
fn list_agent_files_md(dir: &Path) -> Result<Vec<String>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("failed to read directory {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("failed to read directory entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        // DirEntry file type (does not follow symlinks on Unix): skip
        // symlinks and other non-regular entries, matching
        // `kiro_cli::list_agent_files`'s own "synth output never
        // contains symlinks" guarantee.
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-claude-strategy-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Seeds `<repo_root>/dist/claude/agents/<name>.md` with `contents`,
    /// matching the real `ClaudeTransformer`'s output layout -- a
    /// fixture, not a real `konductor synth` run, since that
    /// transformer's code is not merged into this branch.
    fn seed_synthed_agent(repo_root: &Path, name: &str, contents: &[u8]) {
        let dir = repo_root
            .join("dist")
            .join(CLAUDE_HARNESS_DIR)
            .join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.md")), contents).unwrap();
    }

    /// Seeds `<repo_root>/dist/claude/skills/<name>/SKILL.md` (plus any
    /// `extra_files`) with `contents`, matching the real
    /// `ClaudeTransformer`'s output layout.
    fn seed_synthed_skill(
        repo_root: &Path,
        name: &str,
        contents: &[u8],
        extra_files: &[(&str, &[u8])],
    ) {
        let dir = repo_root
            .join("dist")
            .join(CLAUDE_HARNESS_DIR)
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

    #[test]
    fn name_returns_claude_code() {
        assert_eq!(ClaudeInstallStrategy.name(), "claude");
    }

    #[test]
    fn matches_claude_marker() {
        let dir = scratch_dir("matches-claude-marker");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        assert!(ClaudeInstallStrategy.matches(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_not_match_empty_target() {
        // Unlike KiroCliInstallStrategy, this strategy never claims an
        // undetected/empty target as a default.
        let dir = scratch_dir("no-match-empty");
        assert!(!ClaudeInstallStrategy.matches(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_not_match_kiro_only_target() {
        let dir = scratch_dir("no-match-kiro-only");
        fs::create_dir_all(dir.join(".kiro")).unwrap();
        assert!(!ClaudeInstallStrategy.matches(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn install_without_local_fails_with_clear_message() {
        let dir = scratch_dir("no-local");
        let err = ClaudeInstallStrategy
            .install_from_local(&dir, None, "2026-01-01T00:00:00Z", false)
            .expect_err("install without --from must fail");
        assert!(err.contains("remote release installation is not yet available"));
        assert!(err.contains("--from"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn would_fail_as_noop_with_no_from() {
        let dir = scratch_dir("noop-no-from");
        let message = ClaudeInstallStrategy
            .would_fail_as_noop(&dir, None)
            .expect("missing --from must be a no-op failure");
        assert!(message.contains("--from"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn would_fail_as_noop_with_empty_source() {
        let dir = scratch_dir("noop-empty-source-target");
        let repo_root = scratch_dir("noop-empty-source-repo");
        let message = ClaudeInstallStrategy
            .would_fail_as_noop(&dir, Some(repo_root.to_str().unwrap()))
            .expect("a source with nothing to install must be a no-op failure");
        assert!(message.contains("no synthed agent or skill files"));
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn would_fail_as_noop_returns_none_when_there_is_something_to_install() {
        let dir = scratch_dir("noop-real-source-target");
        let repo_root = scratch_dir("noop-real-source-repo");
        seed_synthed_agent(&repo_root, "k-example", b"---\nname: k-example\n---\n");
        assert!(ClaudeInstallStrategy
            .would_fail_as_noop(&dir, Some(repo_root.to_str().unwrap()))
            .is_none());
        fs::remove_dir_all(&dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_copies_agent_and_writes_manifest() {
        let target_dir = scratch_dir("install-agent-target");
        let repo_root = scratch_dir("install-agent-repo");
        seed_synthed_agent(
            &repo_root,
            "k-example",
            b"---\nname: k-example\n---\nBody\n",
        );

        ClaudeInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed = target_dir.join(".claude/agents/k-example.md");
        assert!(installed.is_file());
        assert_eq!(
            fs::read_to_string(&installed).unwrap(),
            "---\nname: k-example\n---\nBody\n"
        );

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after a successful install");
        assert_eq!(manifest.strategies[0].strategy, "claude");
        assert!(manifest.strategies[0]
            .files
            .iter()
            .any(|f| f.path == ".claude/agents/k-example.md"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_copies_skill_directory_recursively() {
        let target_dir = scratch_dir("install-skill-target");
        let repo_root = scratch_dir("install-skill-repo");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[("scripts/run.sh", b"#!/bin/sh\necho hi\n")],
        );

        ClaudeInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        assert!(target_dir
            .join(".claude/skills/constraints/SKILL.md")
            .is_file());
        assert!(target_dir
            .join(".claude/skills/constraints/scripts/run.sh")
            .is_file());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_merges_skills_and_never_touches_foreign_agent_file() {
        let target_dir = scratch_dir("install-merge-target");
        let repo_root = scratch_dir("install-merge-repo");
        seed_synthed_agent(&repo_root, "k-example", b"first\n");

        // A hand-authored, foreign agent file this install never wrote.
        let foreign = target_dir.join(".claude/agents/hand-authored.md");
        fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        fs::write(&foreign, b"do not touch\n").unwrap();

        ClaudeInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        assert_eq!(fs::read_to_string(&foreign).unwrap(), "do not touch\n");
        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

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

        ClaudeInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        let extra_path = target_dir.join(".claude/skills/constraints/extra.md");
        assert!(extra_path.is_file());

        // Drop `extra.md` from the source and reinstall.
        fs::remove_file(
            repo_root
                .join("dist")
                .join(CLAUDE_HARNESS_DIR)
                .join("skills")
                .join("constraints")
                .join("extra.md"),
        )
        .unwrap();

        ClaudeInstallStrategy
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
            .join(".claude/skills/constraints/SKILL.md")
            .is_file());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_ignores_non_md_agent_files() {
        let target_dir = scratch_dir("install-ignore-non-md-target");
        let repo_root = scratch_dir("install-ignore-non-md-repo");
        let agents_dir = repo_root
            .join("dist")
            .join(CLAUDE_HARNESS_DIR)
            .join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(agents_dir.join("k-example.md"), b"real agent\n").unwrap();
        fs::write(agents_dir.join("README.txt"), b"not an agent\n").unwrap();

        ClaudeInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        assert!(target_dir.join(".claude/agents/k-example.md").is_file());
        assert!(!target_dir.join(".claude/agents/README.txt").exists());

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
            ClaudeInstallStrategy
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
            .any(|f| f.path == ".claude/agents/k-example.md"));
        assert!(manifest.strategies[0]
            .files
            .iter()
            .any(|f| f.path == ".claude/skills/constraints/SKILL.md"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn standard_claude_install_phases_returns_three_phases_with_unique_names() {
        let phases = standard_claude_install_phases();
        let names: Vec<&str> = phases.iter().map(|p| p.name()).collect();
        assert_eq!(names.len(), 3);
        let unique: std::collections::HashSet<&str> = names.iter().copied().collect();
        assert_eq!(names.len(), unique.len());
        assert!(names.contains(&"claude-skills"));
        assert!(names.contains(&"claude-agents"));
        assert!(names.contains(&"sops"));
    }

    #[test]
    fn list_agent_files_md_filters_by_extension_and_skips_missing_dir() {
        let dir = scratch_dir("list-agent-files-md");
        assert_eq!(
            list_agent_files_md(&dir.join("missing")).unwrap(),
            Vec::<String>::new()
        );
        fs::write(dir.join("a.md"), b"a").unwrap();
        fs::write(dir.join("b.json"), b"b").unwrap();
        let names = list_agent_files_md(&dir).unwrap();
        assert_eq!(names, vec!["a.md".to_string()]);
        fs::remove_dir_all(&dir).ok();
    }

    // ── install_sop_skills / render_sop_skill_md / scrape_sop_parameters ──
    //
    // Fixtures below are excerpts of REAL `.sop.md` files from
    // `agent-sops/` (not synthetic), reproducing the two real
    // `## Parameters` conventions found across all 19 real files at the
    // time of writing: a bullet list (`about-konductor.sop.md`,
    // `k-adversarial-pull-request-review.sop.md` -- the latter also
    // exercises real nested, non-bold detail bullets under a parameter)
    // and a Markdown table (`k-e2e-test-generation.sop.md`).

    /// Excerpt of the real `about-konductor.sop.md`: single-line
    /// Overview, one simple `- **name** (optional): description` bullet.
    const ABOUT_KONDUCTOR_EXCERPT: &str = "# About Konductor\n\n## Overview\n\nOnboards a new or lost user: install the CLI, talk to the orchestrator in\nplain language, and let it delegate.\n\n## Parameters\n\n- **question** (optional): The user's specific question, if any (e.g. \"how do I install this\", \"what can you take on\"). If omitted, give the general orientation below.\n\n## Steps\n\n1. Do it.\n";

    /// Excerpt of the real `k-adversarial-pull-request-review.sop.md`:
    /// its `diff_input` parameter has three real nested, non-bold detail
    /// bullets (`  - Git diff output...`) -- exactly the shape that
    /// broke the pre-fix parser, since a nested bullet's text (e.g.
    /// "Git diff output (\`git diff\`...)") is not a valid identifier
    /// and would have invalidated the whole array.
    const ADVERSARIAL_PR_REVIEW_EXCERPT: &str = "# Adversarial CR Review\n\n## Overview\n\nRuns an adversarial review of code changes. Not a replacement for standard code review.\n\n## Parameters\n\n- **diff_input** (required on ASDLC): The changes to review. Accepts:\n  - Git diff output (`git diff` or `git diff HEAD~N`)\n  - File paths to read directly\n  - Raw pull request diff content\n- **pr_url** (optional, context only on ASDLC): Pull request URL. **Diff auto-fetch from `pr_url` is unsupported on ASDLC**.\n- **output_file** (optional, default: `adversarial-review-report.md`): Path to write the findings report\n\n**Constraints for parameter acquisition:**\n\n- You MUST have `diff_input`\n";

    /// Excerpt of the real `k-e2e-test-generation.sop.md`: the
    /// table-shaped `## Parameters` convention, header row + separator
    /// row + data rows.
    const E2E_TEST_GENERATION_EXCERPT: &str = "# Web App Functional Test Generation\n\n## Overview\n\nDiscovers a deployed web application via browser automation.\n\n## Parameters\n\n| Parameter          | Required                                                      | Description                          |\n| ------------------ | ------------------------------------------------------------- | ------------------------------------- |\n| `url`              | Required unless `credentials_file` supplies it via `test_url` | URL of the deployed web application   |\n| `output_mode`      | Required                                                      | One of `unit-prompts` \\| `cypress` \\| `playwright` |\n\n**Parameter acquisition rules:**\n\n- If all required parameters are already provided, proceed\n";

    #[test]
    fn render_sop_skill_md_produces_expected_frontmatter_and_wrapping_with_no_parameters() {
        let rendered = render_sop_skill_md(
            "ticket-sync",
            "# Ticket Sync\n\n## Overview\n\nSyncs tickets.\n\nBody text.\n",
        );
        assert!(rendered.starts_with("---\n"));
        assert!(rendered.contains("name: \"sop-ticket-sync\"\n"));
        assert!(rendered.contains("description: \"Syncs tickets.\"\n"));
        assert!(rendered.contains("disable-model-invocation: true\n"));
        assert!(
            !rendered.contains("arguments:"),
            "no Parameters section -> no arguments key at all"
        );
        assert!(rendered.contains("<agent-sop name=\"ticket-sync\"><content>"));
        assert!(rendered.contains("Body text.\n"));
        assert!(rendered.contains("</content><user-input>$ARGUMENTS</user-input></agent-sop>"));
    }

    #[test]
    fn render_sop_skill_md_falls_back_to_generated_description_with_no_overview_section() {
        let rendered = render_sop_skill_md("ticket-sync", "# Ticket Sync\n\nBody text.\n");
        assert!(rendered.contains("description: \"Standard operating procedure: ticket-sync.\"\n"));
    }

    /// `sop_name` comes from the staged file name minus `.sop.md`, and
    /// `reject_unsafe_file_name` only guards path safety (empty, `..`,
    /// `/`, `\`) -- not YAML plain-scalar shape. A name containing `#`
    /// would otherwise have its suffix silently eaten as a YAML comment,
    /// and a name containing `:` would otherwise stop `name:` from
    /// parsing as a mapping at all. Quoting closes both.
    #[test]
    fn render_sop_skill_md_quotes_a_sop_name_containing_yaml_metacharacters() {
        let rendered = render_sop_skill_md("plan #2", "# Plan\n\n## Overview\n\nPlans.\n");
        assert!(rendered.contains("name: \"sop-plan #2\"\n"));

        let rendered = render_sop_skill_md(
            "state: management",
            "# State\n\n## Overview\n\nManages state.\n",
        );
        assert!(rendered.contains("name: \"sop-state: management\"\n"));
    }

    /// The real, exact fix for CRITICAL #1: a real bullet-format
    /// `## Parameters` section (`about-konductor.sop.md`'s own shape)
    /// now produces a non-empty `arguments` array.
    #[test]
    fn render_sop_skill_md_scrapes_arguments_from_real_bullet_format_sop() {
        let rendered = render_sop_skill_md("about-konductor", ABOUT_KONDUCTOR_EXCERPT);
        assert!(
            rendered.contains("arguments: [question]\n"),
            "arguments must use YAML flow-sequence syntax, got: {rendered}"
        );
    }

    /// Real nested, non-bold detail bullets under a parameter (see
    /// `ADVERSARIAL_PR_REVIEW_EXCERPT`'s own doc comment) must be
    /// skipped, not treated as invalidating the whole array -- this is
    /// exactly the real-world case the pre-fix parser broke on.
    #[test]
    fn render_sop_skill_md_skips_nested_detail_bullets_and_scrapes_real_top_level_names() {
        let rendered = render_sop_skill_md(
            "k-adversarial-pull-request-review",
            ADVERSARIAL_PR_REVIEW_EXCERPT,
        );
        assert!(
            rendered.contains("arguments: [diff_input, pr_url, output_file]\n"),
            "got: {rendered}"
        );
    }

    /// The real table-format `## Parameters` convention
    /// (`k-e2e-test-generation.sop.md`'s own shape) must also produce a
    /// non-empty `arguments` array.
    #[test]
    fn render_sop_skill_md_scrapes_arguments_from_real_table_format_sop() {
        let rendered = render_sop_skill_md("k-e2e-test-generation", E2E_TEST_GENERATION_EXCERPT);
        assert!(
            rendered.contains("arguments: [url, output_mode]\n"),
            "got: {rendered}"
        );
    }

    /// Per AIM's own rule: a single invalid-identifier parameter name
    /// invalidates the WHOLE `arguments` array, not just that one entry
    /// -- still exercised in the real `**name**` bold-bullet shape, not
    /// the fictional `- name:` shape the pre-fix tests used.
    #[test]
    fn render_sop_skill_md_omits_arguments_when_any_parameter_name_is_not_a_valid_identifier() {
        let body = "# Sync tickets\n\n## Overview\n\nSyncs tickets.\n\n## Parameters\n\n- **ticket-id** (required): the ticket to sync\n- **dryRun** (optional): skip the write\n";
        let rendered = render_sop_skill_md("ticket-sync", body);
        assert!(
            !rendered.contains("arguments:"),
            "ticket-id is not a valid identifier (contains a hyphen), so the whole \
             arguments array must be omitted, got: {rendered}"
        );
    }

    /// A parameter literally named `on` is a valid identifier
    /// (`is_valid_identifier` only checks character shape), so this
    /// exercises the separate YAML-1.1-reserved-word guard: the whole
    /// `arguments` array must still be omitted rather than rendering
    /// `arguments: [on]`, which a YAML 1.1-compliant loader would read
    /// back as the boolean `true`, not the string `"on"`.
    #[test]
    fn render_sop_skill_md_omits_arguments_when_any_parameter_name_is_a_yaml_1_1_reserved_word() {
        let body = "# Toggle\n\n## Overview\n\nToggles a setting.\n\n## Parameters\n\n- **on** (required): whether to enable the setting\n";
        let rendered = render_sop_skill_md("toggle", body);
        assert!(
            !rendered.contains("arguments:"),
            "on is a valid identifier but a YAML 1.1 reserved word, so the whole \
             arguments array must be omitted, got: {rendered}"
        );
    }

    /// The generated frontmatter, for every real fixture above, must
    /// actually parse as YAML -- a substring `.contains()` check alone
    /// cannot catch an unquoted colon breaking the mapping the way the
    /// pre-fix implementation did. Uses `serde_yaml`, already a
    /// workspace dependency (see `Cargo.toml`), not a newly-added crate.
    #[test]
    fn render_sop_skill_md_frontmatter_actually_parses_as_yaml_for_every_real_fixture() {
        for (name, body) in [
            ("about-konductor", ABOUT_KONDUCTOR_EXCERPT),
            (
                "k-adversarial-pull-request-review",
                ADVERSARIAL_PR_REVIEW_EXCERPT,
            ),
            ("k-e2e-test-generation", E2E_TEST_GENERATION_EXCERPT),
        ] {
            let rendered = render_sop_skill_md(name, body);
            let frontmatter = rendered
                .strip_prefix("---\n")
                .and_then(|rest| rest.split_once("\n---\n"))
                .map(|(fm, _)| fm)
                .unwrap_or_else(|| {
                    panic!(
                        "[fixture:{name}] rendered output has no --- frontmatter block: {rendered}"
                    )
                });
            let parsed: serde_yaml::Value = serde_yaml::from_str(frontmatter).unwrap_or_else(|e| {
                panic!("[fixture:{name}] frontmatter failed to parse as YAML: {e}\nfrontmatter was:\n{frontmatter}")
            });
            assert!(
                parsed.get("name").is_some(),
                "[fixture:{name}] parsed YAML must have a name field"
            );
            assert!(
                parsed.get("description").is_some(),
                "[fixture:{name}] parsed YAML must have a description field"
            );
        }
    }

    #[test]
    fn scrape_sop_parameters_returns_none_when_no_parameters_section() {
        assert_eq!(scrape_sop_parameters("# Just a heading\n\nBody.\n"), None);
    }

    #[test]
    fn scrape_sop_parameters_returns_none_when_parameters_section_has_no_bullets() {
        assert_eq!(
            scrape_sop_parameters("## Parameters\n\nNo bullets here.\n"),
            None
        );
    }

    #[test]
    fn scrape_sop_parameters_stops_at_next_heading() {
        let body = "## Parameters\n\n- **foo** (required): first\n- **bar** (required): second\n\n## Steps\n\n- notAParameter\n";
        assert_eq!(
            scrape_sop_parameters(body),
            Some(vec!["foo".to_string(), "bar".to_string()])
        );
    }

    #[test]
    fn scrape_sop_parameters_parses_real_about_konductor_bullet() {
        assert_eq!(
            scrape_sop_parameters(ABOUT_KONDUCTOR_EXCERPT),
            Some(vec!["question".to_string()])
        );
    }

    #[test]
    fn scrape_sop_parameters_skips_nested_non_bold_detail_bullets() {
        assert_eq!(
            scrape_sop_parameters(ADVERSARIAL_PR_REVIEW_EXCERPT),
            Some(vec![
                "diff_input".to_string(),
                "pr_url".to_string(),
                "output_file".to_string()
            ])
        );
    }

    #[test]
    fn scrape_sop_parameters_parses_real_table_format() {
        assert_eq!(
            scrape_sop_parameters(E2E_TEST_GENERATION_EXCERPT),
            Some(vec!["url".to_string(), "output_mode".to_string()])
        );
    }

    #[test]
    fn scrape_sop_parameters_returns_none_when_a_parameter_name_is_a_yaml_1_1_reserved_word() {
        let body = "## Parameters\n\n- **foo** (required): first\n- **off** (required): second\n";
        assert_eq!(scrape_sop_parameters(body), None);
    }

    #[test]
    fn is_valid_identifier_accepts_and_rejects_expected_shapes() {
        assert!(is_valid_identifier("foo"));
        assert!(is_valid_identifier("_foo"));
        assert!(is_valid_identifier("foo_bar2"));
        assert!(!is_valid_identifier("foo-bar"));
        assert!(!is_valid_identifier("2foo"));
        assert!(!is_valid_identifier(""));
    }

    #[test]
    fn is_yaml_1_1_reserved_word_accepts_and_rejects_expected_shapes() {
        for word in ["y", "n", "yes", "no", "true", "false", "on", "off", "null"] {
            assert!(
                is_yaml_1_1_reserved_word(word),
                "{word} must be a reserved word"
            );
            assert!(
                is_yaml_1_1_reserved_word(&word.to_ascii_uppercase()),
                "the check must be case-insensitive, failed on {word}"
            );
        }
        assert!(!is_yaml_1_1_reserved_word("question"));
        assert!(!is_yaml_1_1_reserved_word("output_mode"));
        assert!(!is_yaml_1_1_reserved_word(""));
    }

    // ── extract_overview_description / yaml_double_quote ─────────────

    #[test]
    fn extract_overview_description_takes_only_the_first_line() {
        assert_eq!(
            extract_overview_description(ABOUT_KONDUCTOR_EXCERPT),
            Some(
                "Onboards a new or lost user: install the CLI, talk to the orchestrator in"
                    .to_string()
            )
        );
    }

    #[test]
    fn extract_overview_description_returns_none_without_overview_heading() {
        assert_eq!(extract_overview_description("# Title\n\nBody.\n"), None);
    }

    #[test]
    fn yaml_double_quote_escapes_backslash_and_quote() {
        assert_eq!(
            yaml_double_quote(r#"say "hi" \ ok"#),
            r#""say \"hi\" \\ ok""#
        );
    }

    // ── escape_xml_attr / guard_sop_body ──────────────────────────────

    #[test]
    fn escape_xml_attr_escapes_quotes_and_angle_brackets() {
        assert_eq!(escape_xml_attr(r#"a"b<c>d&e"#), "a&quot;b&lt;c&gt;d&amp;e");
    }

    #[test]
    fn render_sop_skill_md_escapes_a_quote_in_the_sop_name_attribute() {
        let rendered = render_sop_skill_md("weird\"name", "# Weird\n\nBody.\n");
        assert!(
            rendered.contains("<agent-sop name=\"weird&quot;name\">"),
            "got: {rendered}"
        );
        assert!(
            !rendered.contains("<agent-sop name=\"weird\"name\">"),
            "an unescaped embedded quote must never reach the attribute value, got: {rendered}"
        );
    }

    #[test]
    fn guard_sop_body_breaks_literal_closing_tag_substrings() {
        let guarded = guard_sop_body("Documenting </content> and </agent-sop> tags here.");
        assert!(!guarded.contains("</content>"));
        assert!(!guarded.contains("</agent-sop>"));
        assert!(guarded.contains("content>"));
        assert!(guarded.contains("agent-sop>"));
    }

    /// A SOP body that documents this exact wrapper format (plausible --
    /// this codebase's own SOP-authoring guidance does) must not
    /// prematurely close the real wrapper `render_sop_skill_md` appends
    /// after it.
    #[test]
    fn render_sop_skill_md_guards_body_documenting_its_own_wrapper_tags() {
        let body = "# Self-documenting\n\n## Overview\n\nDocuments the wrapper.\n\nUse `</content>` and `</agent-sop>` to close the wrapper.\n";
        let rendered = render_sop_skill_md("self-documenting", body);
        // Exactly one real `</content>` and one real `</agent-sop>` --
        // the ones this function itself appends -- must survive; the
        // body's own literal occurrences must be broken.
        assert_eq!(rendered.matches("</content>").count(), 1);
        assert_eq!(rendered.matches("</agent-sop>").count(), 1);
    }

    #[test]
    fn install_sop_skills_converts_every_staged_sop_unconditionally() {
        let dir = scratch_dir("install-sop-skills");
        let harness_dir = dir.join("harness");
        let sops_dir = harness_dir.join(SOPS_CONTENT_TYPE_DIR);
        fs::create_dir_all(&sops_dir).unwrap();
        fs::write(sops_dir.join("ticket-sync.sop.md"), b"# Ticket Sync\n").unwrap();
        fs::write(sops_dir.join("code-review.sop.md"), b"# Code Review\n").unwrap();
        let target_dir = dir.join("target");

        let files = install_sop_skills(&harness_dir, &target_dir).unwrap();
        assert_eq!(files.len(), 2);

        let ticket_sync =
            fs::read_to_string(target_dir.join(".claude/skills/sop-ticket-sync/SKILL.md")).unwrap();
        assert!(ticket_sync.contains("name: \"sop-ticket-sync\""));
        let code_review =
            fs::read_to_string(target_dir.join(".claude/skills/sop-code-review/SKILL.md")).unwrap();
        assert!(code_review.contains("name: \"sop-code-review\""));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn install_sop_skills_returns_empty_when_source_missing() {
        let dir = scratch_dir("install-sop-skills-missing");
        let harness_dir = dir.join("harness");
        let target_dir = dir.join("target");
        let files = install_sop_skills(&harness_dir, &target_dir).unwrap();
        assert!(files.is_empty());
        fs::remove_dir_all(&dir).ok();
    }
}
