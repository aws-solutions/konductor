// SPDX-License-Identifier: Apache-2.0
//
// install/kiro_cli.rs — `InstallStrategy` for the Kiro CLI runtime.
//
// ── Scope (tasks 3.2, 3.4) ──────────────────────────────────────────────────
// Detection + strategy selection is task 3.2's deliverable (`matches()`
// below); copying synthed Kiro CLI agent, skill, and context files from
// a local synth output tree (`<repo_root>/dist/<harness>/agents/*.json`,
// `<repo_root>/dist/<harness>/skills/<name>/**`,
// `<repo_root>/dist/<harness>/context/*`, `--from <repo-root>`) into
// this target's project-local `<target_dir>/` is task 3.4's
// (`install_from_local()`). SOPs are staged under `dist/<harness>/sops/`
// by synth but have no Kiro CLI install destination -- deliberately not
// copied. Each installed file's real content is hashed with SHA-256,
// and `.konductor/manifest` records the destination and per-file
// hashes. Without `--from`, remote (GitHub Release) installation is
// not yet implemented -- `install_from_local` fails with a clear
// message rather than silently succeeding.
//
// ── Two install roots ────────────────────────────────────────────────────
// Agents and context land under `<target_dir>/.kiro/` as before. Skills
// land under `<target_dir>/.konductor/skills/`, NOT `.kiro/skills/`:
// Kiro CLI's native skill discovery scans `.kiro/skills/`
// unconditionally and makes every skill visible to every agent
// regardless of what it declares, which defeats per-agent scoping.
// Moving skills outside that scanned directory means a skill is only
// visible to an agent that explicitly references it via a `skill://`
// resource entry -- confirmed live against kiro-cli 2.18.0 (see
// ws-konductor-cli-notes.SKILL.md). `manifest.destination` reflects this
// by rooting at `target_dir` itself (see manifest.rs's module
// docstring); each `files[].path` carries its own `.kiro/` or
// `.konductor/` prefix.
//
// Skill install MERGES into `.konductor/skills/`: a skill directory this
// install did not emit (e.g. hand-authored) is left untouched, but a
// skill directory it does own is fully replaced so a file removed from
// the source doesn't linger in the destination.
//
// No checksum verification is performed against a locally-synthed tree:
// there is no published release checksum for output that was just
// built on this machine, so `artifact.rs`'s `verify_sha256` (which
// exists for a future real GitHub Release fetch) is not used here.
// This is intentional, not an oversight -- verifying a local build
// against a hash it cannot have is not meaningful.
//
// ── Module split ─────────────────────────────────────────────────────────
// This file's own logic is split three ways under `kiro_cli/`, purely
// for readability -- no behavior differs from before the split:
//   - `kiro_cli/plan.rs`   -- write-ahead planning (`plan_all_files` and
//     friends): what a run WOULD write, before anything is copied.
//   - `kiro_cli/copy.rs`   -- copy/install execution: what actually reads
//     from the synth tree and writes to `target_dir`.
//   - `kiro_cli/fs_util.rs` -- small filesystem primitives shared by both
//     (`is_executable`, `set_executable`, `reject_unsafe_file_name`).
// This file itself keeps only the `InstallStrategy` impl and re-exports
// everything sibling `install` modules (`claude`, `mcp_server`) and this
// file's own tests already depended on, so none of their call sites
// changed.

use std::path::Path;

use super::manifest::{Manifest, ManifestFile, Status};
use super::runtime::{detect_runtimes, Runtime};
use super::InstallError;
use super::InstallStrategy;
use crate::cli::synth::kiro_cli_v2::KiroCliV2Transformer;
use crate::cli::synth::HarnessTransformer as _;

// ── MCP server binaries (skill-lookup) ──────────────────────────────────────
//
// See `mcp_server.rs`'s module doc comment for the source/destination
// and design rationale -- those constants and helpers live there now.
// The injection of an installed binary's absolute path into an agent's
// `mcpServers` block still happens here (a third rewrite pass in
// `copy_agent_files_rewriting_resources`), since it needs the same
// parse/rewrite/verify/re-serialize machinery the other two use.

/// Destination roots, relative to `target_dir`, everything this
/// strategy installs is rooted under. `target_dir` itself is resolved
/// by the caller (`install::resolve_destination`) -- `$HOME` by
/// default, or `--target <dir>` when given -- so this strategy has no
/// opinion on whether the resulting trees end up project-local or
/// under the user's home directory. Agents and context stay under
/// `.kiro/` (Kiro's own config root).
pub(crate) const KIRO_DESTINATION_ROOT: &str = ".kiro";
/// Skills live under `.konductor/` -- see module docstring's "Two
/// install roots" section for why this is NOT `.kiro/skills/`.
///
/// Both constants are `pub(crate)`: `uninstall.rs` uses them to build
/// the same runtime-root paths it must never delete, regardless of
/// emptiness.
pub(crate) const KONDUCTOR_DESTINATION_ROOT: &str = ".konductor";

/// Installs Konductor for the Kiro CLI runtime: copies synthed agent
/// files into `.kiro/agents/`, synthed context files into
/// `.kiro/context/`, and synthed skill directories into
/// `.konductor/skills/` from a local `--from <repo-root>` source, then
/// writes `.konductor/manifest`.
pub struct KiroCliInstallStrategy;

impl InstallStrategy for KiroCliInstallStrategy {
    fn name(&self) -> &'static str {
        "kiro-cli"
    }

    /// The `KiroCliV2Transformer`'s own harness directory name --
    /// imported directly from that transformer rather than
    /// hand-duplicated as a literal, so this can never drift from the
    /// real synth-side value.
    fn harness_dir(&self) -> &'static str {
        use crate::cli::synth::kiro_cli_v2::KiroCliV2Transformer;
        use crate::cli::synth::HarnessTransformer as _;
        KiroCliV2Transformer.name()
    }

    /// Applies when Kiro CLI is detected at the target, or when NEITHER
    /// known runtime is detected (Kiro CLI is this milestone's only
    /// registered strategy, so an undetected target still gets a usable
    /// default rather than failing with "no strategy matched"). Does
    /// not claim a target where Claude Code alone is detected -- that
    /// is reserved for a future Claude Code strategy (task 3.8), left
    /// unclaimed here rather than silently mis-installed as Kiro.
    fn matches(&self, target_dir: &Path) -> bool {
        let detection = detect_runtimes(target_dir);
        if detection.has(Runtime::KiroCli) {
            return true;
        }
        detection.detected.is_empty()
    }

    /// Cheap, read-only mirror of `install_from_local`'s own no-op
    /// checks -- missing `--from`, then a source with nothing to
    /// install -- performed in the identical order and against the
    /// identical conditions, but without reading any PRIOR manifest and
    /// without writing anything at all. Returns the exact message
    /// `install_from_local` would fail with in that case.
    ///
    /// Deliberately re-derives `plan_all_files`'s inputs directly
    /// (`harness_dir`, no `prior_manifest`) rather than calling
    /// `plan_all_files` itself with a placeholder: passing `None` for
    /// `prior_manifest` only affects each planned file's `provenance`
    /// classification, never whether the plan is empty, so the emptiness
    /// check this function needs is identical either way -- but plumbing
    /// a real prior manifest through here would require the same
    /// `read_manifest` call `install_from_local` makes, defeating the
    /// point of a callable-before-any-work check.
    ///
    /// Deliberately does NOT also call `plan_claude_settings_grant`:
    /// that function can only ever ADD an optional, additive file to
    /// an otherwise-non-empty plan -- it never turns a plan that would
    /// have been empty into a non-empty one (it early-returns `Vec::new()`
    /// whenever the MCP binary itself is not already planned, and the
    /// binary is one of the very inputs `plan.is_empty() && bin_plan.is_empty()`
    /// already checks above). So it cannot change this function's
    /// empty/non-empty verdict, and omitting it keeps this check-only
    /// mirror doing exactly what its name says: mirroring
    /// `install_from_local`'s no-op checks, not its full plan.
    ///
    /// DOES also call `plan_additive_claude_sop_skill_files`, unlike
    /// `plan_claude_settings_grant` above: that function is gated only
    /// on `target_dir` already having a `.claude` marker -- entirely
    /// independent of `plan`/`bin_plan` -- so it CAN turn an otherwise-
    /// empty plan into a non-empty one on its own (e.g. empty
    /// `dist/kiro-cli-v2/`, no built binary, populated `dist/claude/sops/`,
    /// `.claude` marker present). Omitting it would report a false no-op
    /// for a target `install_from_local` would actually install into.
    fn would_fail_as_noop(&self, target_dir: &Path, from: Option<&str>) -> Option<String> {
        let Some(repo_root) = from else {
            return Some(super::NO_REMOTE_RELEASE_MESSAGE.to_string());
        };
        let repo_root = Path::new(repo_root);
        let harness_dir = repo_root.join("dist").join(KiroCliV2Transformer.name());

        let plan = match plan_all_files(&harness_dir, target_dir, None) {
            Ok(plan) => plan,
            Err(message) => return Some(message),
        };
        let bin_plan = match super::mcp_server::plan_bin_files(repo_root, target_dir, None) {
            Ok(plan) => plan,
            Err(message) => return Some(message),
        };
        let claude_sop_skill_plan =
            match plan_additive_claude_sop_skill_files(repo_root, target_dir, None) {
                Ok(plan) => plan,
                Err(message) => return Some(message),
            };
        if plan.is_empty() && bin_plan.is_empty() && claude_sop_skill_plan.is_empty() {
            return Some(format!(
                "no synthed agent, skill, or context files -- and no built MCP server binary -- found under {} / {} -- run `konductor synth --from {}` first, or `cd mcp && cargo build --release`",
                harness_dir.display(),
                repo_root.display(),
                repo_root.display()
            ));
        }
        None
    }

    /// Copies synthed agent files from `from`'s resolved source
    /// directory into `<target_dir>/.kiro/agents/`, synthed skill
    /// directories into `<target_dir>/.konductor/skills/` (merging: a
    /// pre-existing skill directory this install did not emit is left
    /// untouched), and synthed context files into
    /// `<target_dir>/.kiro/context/`, then writes
    /// `.konductor/manifest`. Fails with a clear message when `from` is
    /// `None` (remote release installation is not yet available), when
    /// no source directory yields anything to install, or on any I/O
    /// failure while copying/writing.
    ///
    /// ── Write-ahead sequencing (see manifest.rs's module docstring) ──────
    /// 1. Read any prior manifest for this target BEFORE anything else
    ///    (its `files[]` is the ground truth for "did a previous
    ///    Konductor install own this path", used for provenance below).
    /// 2. PLAN every file this run intends to write -- its final
    ///    manifest-relative path and provenance (`classify_provenance`,
    ///    stat + prior manifest, before any content changes) -- without
    ///    copying anything yet.
    /// 3. Write the plan as a `Status::InProgress` manifest (every
    ///    `sha256` is `None` -- the real bytes don't exist at their
    ///    destination yet). A crash/failure from here on always leaves a
    ///    manifest naming exactly what may be on disk.
    /// 4. Actually copy every file (the existing per-content-type copy
    ///    functions, unchanged), attach each returned entry's already-
    ///    planned provenance, and compute real hashes as each file lands.
    /// 5. Rewrite the SAME manifest as `Status::Complete`, now with
    ///    every real hash filled in.
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
        let harness_dir = repo_root.join("dist").join(KiroCliV2Transformer.name());

        // Recorded into the manifest's `source` field so `konductor
        // doctor` can later resolve `check_source`/`check_config`
        // against the SAME tree that produced this install, not
        // whatever `--from`/cwd happens to be when `doctor` runs (see
        // manifest.rs's `Manifest` doc comment). Canonicalized so a
        // later `doctor` run gets an absolute path regardless of its
        // own cwd; falls back to joining `repo_root` onto this
        // process's cwd if canonicalize fails (e.g. source since
        // moved/removed), and to the raw string only if even that
        // fails -- never aborting the install over a path-display
        // concern.
        //
        // SUGGESTION (deferred): the `unwrap_or_else` below discards
        // the specific `io::Error` from a failed canonicalize instead
        // of logging it. Not a correctness bug -- install still
        // succeeds with a usable path either way -- just a diagnostics
        // gap; revisit if `install` grows a non-fatal warning channel.
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
        let bin_plan =
            super::mcp_server::plan_bin_files(repo_root, target_dir, prior_manifest.as_ref())?;
        plan.extend(bin_plan.iter().cloned());
        // Must run AFTER the bin plan is folded in -- it checks `plan`
        // for the MCP binary's own planned path to predict whether the
        // Claude grant applies (see its own doc comment for why this
        // prediction, not the real run-time computation, is what
        // closes the crash-safety gap).
        let claude_plan =
            plan_claude_settings_grant(&harness_dir, target_dir, &plan, prior_manifest.as_ref())?;
        plan.extend(claude_plan);
        // Predicts the additive Claude-side SOP-skill conversion files
        // `SopInstallPhase::run`'s dual-marker branch writes when this
        // target ALSO has a pre-existing `.claude` marker (see that
        // struct's own doc comment) -- must run before the write-ahead
        // `Status::InProgress` manifest is written below, for the same
        // crash-safety reason `plan_claude_settings_grant` does (see its
        // own doc comment). Without this, `attach_provenance` fails with
        // an internal-error message the first time that dual-marker
        // branch actually produces a file that was never in the plan.
        let claude_sop_skill_plan =
            plan_additive_claude_sop_skill_files(repo_root, target_dir, prior_manifest.as_ref())?;
        plan.extend(claude_sop_skill_plan);
        if plan.is_empty() {
            return Err(InstallError::Message(format!(
                "no synthed agent, skill, or context files -- and no built MCP server binary -- found under {} / {} -- run `konductor synth --from {}` first, or `cd mcp && cargo build --release`",
                harness_dir.display(),
                repo_root.display(),
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
        let write_ahead = Manifest::new(
            self.name(),
            installed_at,
            ".",
            source.clone(),
            Status::InProgress,
            in_progress_files,
        );
        super::manifest::write_manifest(target_dir, &write_ahead)?;

        // The actual copy work is a list of `InstallPhase`s (see
        // `phases.rs`) run in order by `run_all_phases`, rather than a
        // hand-written call chain -- ordering is enforced by
        // `standard_install_phases()` and `InstallPhase::dependencies()`,
        // not by this call site. This also covers the Claude/V3 settings
        // grant (see `resource_rewrite.rs`'s "V3/Claude Code permission
        // grant" section): `AgentInstallPhase::run` applies it itself,
        // right after calling `install_agents`, since that is the one
        // place that already holds the `any_mcp_server_injected` signal
        // the grant is gated on -- see that phase's own doc comment.
        let raw_files = super::phases::run_all_phases(
            &super::phases::standard_install_phases(),
            &harness_dir,
            target_dir,
            Some(repo_root),
            prior_manifest.as_ref(),
            no_telemetry,
        )?;
        let files = attach_provenance(raw_files, &plan)?;

        // `destination` is `.` (target_dir itself): installs now span
        // two roots (`.kiro/`, `.konductor/`), so each `files[].path`
        // above already carries its own full prefix rather than being
        // relative to a single shared destination directory.
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

mod copy;
mod fs_util;
mod plan;

// Re-exports so sibling `install` modules (`claude`, `mcp_server`) and this
// module's own tests can keep using `super::kiro_cli::<name>` /
// `<name>` unqualified paths, exactly as before this file was split into
// `kiro_cli/{plan,copy,fs_util}.rs` -- see this file's own module doc
// comment ("Module split" section above) for the 3-way split this cuts
// across.
pub(super) use copy::{
    copy_agent_files, copy_skill_dir_recursive, install_agents, install_context, install_skills,
    install_sops, list_agent_files, list_agent_files_like, list_skill_dirs,
    CONTEXT_RESOURCE_PREFIX,
};
pub(super) use fs_util::{reject_unsafe_file_name, set_executable};
pub(super) use plan::{
    attach_provenance, content_manifest_path, plan_additive_claude_sop_skill_files, plan_all_files,
    plan_claude_settings_grant, plan_skill_dir_recursive, read_skill_scopes_sidecar,
    read_sop_scopes_sidecar, PlannedFile,
};

#[cfg(test)]
pub(super) mod test_support {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    pub(super) fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-kiro-cli-strategy-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Seeds `<repo_root>/dist/kiro-cli-v2/agents/<name>.json` with
    /// `contents`, mirroring real synth output layout.
    pub(super) fn seed_synthed_agent(repo_root: &Path, name: &str, contents: &[u8]) {
        let dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.json")), contents).unwrap();
    }

    /// Seeds `<repo_root>/dist/kiro-cli-v2/context/<file_name>` with
    /// `contents`, mirroring real synth output layout.
    pub(super) fn seed_synthed_context(repo_root: &Path, file_name: &str, contents: &[u8]) {
        let dir = repo_root.join("dist").join("kiro-cli-v2").join("context");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(file_name), contents).unwrap();
    }

    /// Seeds a synthed agent JSON declaring a `resources` entry of the
    /// exact relative shape synth emits for a `contextNames` reference:
    /// `file://context/<context_file_name>`.
    pub(super) fn seed_synthed_agent_with_context_resource(
        repo_root: &Path,
        agent_name: &str,
        context_file_name: &str,
    ) {
        let contents = format!(
            r#"{{"name":"{agent_name}","resources":["file://context/{context_file_name}"]}}"#
        );
        seed_synthed_agent(repo_root, agent_name, contents.as_bytes());
    }

    /// Seeds a synthed agent JSON declaring a `resources` entry of the
    /// exact relative shape synth's `normalize_skill_resource` emits for
    /// a packaged-skill reference: `skill://skills/<skill_name>/SKILL.md`.
    pub(super) fn seed_synthed_agent_with_skill_resource(
        repo_root: &Path,
        agent_name: &str,
        skill_name: &str,
    ) {
        let contents = format!(
            r#"{{"name":"{agent_name}","resources":["skill://skills/{skill_name}/SKILL.md"]}}"#
        );
        seed_synthed_agent(repo_root, agent_name, contents.as_bytes());
    }

    /// Seeds `<repo_root>/dist/kiro-cli-v2/skills/<name>/SKILL.md` (plus
    /// any `auxiliary` files, joined onto the skill directory) with
    /// `skill_md_contents`, mirroring real synth output layout.
    pub(super) fn seed_synthed_skill(
        repo_root: &Path,
        name: &str,
        skill_md_contents: &[u8],
        auxiliary: &[(&str, &[u8])],
    ) {
        let dir = repo_root
            .join("dist")
            .join("kiro-cli-v2")
            .join("skills")
            .join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), skill_md_contents).unwrap();
        for (relative_path, contents) in auxiliary {
            let path = dir.join(relative_path);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, contents).unwrap();
        }
    }

    /// Seeds `<repo_root>/mcp/target/release/<name>` with `contents`,
    /// mirroring `cargo build --release`'s default output location for
    /// the `mcp/` Cargo workspace.
    pub(super) fn seed_mcp_binary(repo_root: &Path, name: &str, contents: &[u8]) {
        let dir = repo_root.join("mcp/target/release");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(name), contents).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    use super::super::artifact::sha256_hex;
    use super::super::manifest::Provenance;
    use super::fs_util::is_executable;
    use super::plan::{read_skill_scopes_sidecar, read_sop_scopes_sidecar};
    use super::test_support::*;
    use crate::cli::synth::kiro_cli_v2::{SKILL_SCOPES_SIDECAR_FILE, SOP_SCOPES_SIDECAR_FILE};
    use crate::cli::time::civil_from_days;

    #[test]
    fn name_returns_kiro_cli() {
        assert_eq!(KiroCliInstallStrategy.name(), "kiro-cli");
    }

    #[test]
    fn matches_empty_target() {
        let dir = scratch_dir("matches-empty");
        assert!(KiroCliInstallStrategy.matches(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn matches_kiro_marker() {
        let dir = scratch_dir("matches-kiro-marker");
        fs::create_dir_all(dir.join(".kiro")).unwrap();
        assert!(KiroCliInstallStrategy.matches(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_not_match_claude_only_target() {
        let dir = scratch_dir("no-match-claude-only");
        fs::create_dir_all(dir.join(".claude")).unwrap();
        assert!(!KiroCliInstallStrategy.matches(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn install_without_local_fails_with_clear_message() {
        let dir = scratch_dir("no-local");
        let err = KiroCliInstallStrategy
            .install_from_local(&dir, None, "2026-01-01T00:00:00Z", false)
            .expect_err("install without --from must fail");
        assert!(err.contains("remote release installation is not yet available"));
        assert!(err.contains("--from"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn install_from_local_copies_files_and_writes_manifest() {
        let target_dir = scratch_dir("target");
        let repo_root = scratch_dir("repo-root");
        seed_synthed_agent(&repo_root, "k-example", b"{\"name\":\"k-example\"}\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed = target_dir.join(".kiro/agents/k-example.json");
        assert!(installed.is_file());
        assert_eq!(fs::read(&installed).unwrap(), b"{\"name\":\"k-example\"}\n");

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        assert_eq!(manifest.strategy, "kiro-cli");
        assert_eq!(manifest.destination, ".");
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(manifest.files[0].path, ".kiro/agents/k-example.json");
        assert_eq!(
            manifest.files[0].sha256,
            Some(sha256_hex(b"{\"name\":\"k-example\"}\n"))
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_copies_multiple_files() {
        let target_dir = scratch_dir("target-multi");
        let repo_root = scratch_dir("repo-root-multi");
        seed_synthed_agent(&repo_root, "agent-a", b"{}\n");
        seed_synthed_agent(&repo_root, "agent-b", b"{}\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        assert!(target_dir.join(".kiro/agents/agent-a.json").is_file());
        assert!(target_dir.join(".kiro/agents/agent-b.json").is_file());
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert_eq!(manifest.files.len(), 2);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_fails_when_source_dir_missing() {
        let target_dir = scratch_dir("target-missing-source");
        let repo_root = scratch_dir("repo-root-missing-source");
        // No dist/ tree seeded at all.

        let err = KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect_err("install must fail when the source dir is missing");
        assert!(err.contains(
            "no synthed agent, skill, or context files -- and no built MCP server binary -- found"
        ));
        assert!(!target_dir.join(".konductor/manifest").exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_fails_when_source_dir_empty() {
        let target_dir = scratch_dir("target-empty-source");
        let repo_root = scratch_dir("repo-root-empty-source");
        fs::create_dir_all(repo_root.join("dist/kiro-cli-v2/agents")).unwrap();

        let err = KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect_err("install must fail when the source dir has no agent files");
        assert!(err.contains(
            "no synthed agent, skill, or context files -- and no built MCP server binary -- found"
        ));
        assert!(!target_dir.join(".konductor/manifest").exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Simulates an interruption between `install_bin_files` and
    /// `install_agents` in `install_from_local` (bin copy lands,
    /// agent-JSON rewrite never runs): after a normal first install
    /// completes, hand-craft that exact on-disk state -- binary
    /// present, agent JSON reverted to its pre-rewrite `mcpServers`-free
    /// form -- then re-run `install_from_local` and assert it converges
    /// to the fully-wired state on its own. A true mid-write process
    /// kill can't be reproduced deterministically in-process (there's
    /// no hook between the two calls to abort at), so this reconstructs
    /// the resulting filesystem state directly and drives the
    /// documented recovery path -- re-run -- against it, which is the
    /// actual property that matters: does a subsequent install repair
    /// the gap.
    #[test]
    fn install_from_local_recovers_when_rerun_after_interrupted_agent_rewrite() {
        let target_dir = scratch_dir("target-interrupted-rewrite");
        let repo_root = scratch_dir("repo-root-interrupted-rewrite");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(&repo_root, "constraints", b"body", &[]);
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"fake binary");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");

        let agent_path = target_dir.join(".kiro/agents/k-example.json");
        let installed_binary = target_dir.join(".konductor/bin/skill-lookup-mcp");
        assert!(
            installed_binary.is_file(),
            "sanity check: the first install must have copied the binary"
        );
        let first_install_agent: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        assert!(
            first_install_agent.get("mcpServers").is_some(),
            "sanity check: the first install must have injected mcpServers"
        );

        // Hand-craft the interrupted state: binary copy landed (left
        // as-is), but the agent JSON is reverted to its pre-rewrite
        // form, as if the process died before `install_agents` ran on
        // this file.
        fs::write(
            &agent_path,
            br#"{"name":"k-example","resources":["skill://skills/constraints/SKILL.md"]}"#,
        )
        .unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:01:00Z",
                false,
            )
            .expect("re-run after the interruption must converge, not error");

        let recovered_agent: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        assert_eq!(
            recovered_agent["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(installed_binary.display().to_string()),
            "a re-run must re-inject mcpServers even though the prior run's own manifest \
             already claimed Status::Complete for this agent file"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Hand-crafts the partial-crash state `ContextInstallPhase`/
    /// `AgentInstallPhase` running last (see `phases.rs`'s own module
    /// doc comment) makes reachable: a write-ahead `Status::InProgress`
    /// manifest exists and `SkillInstallPhase`/`McpInstallPhase` have
    /// already written their files, but neither `ContextInstallPhase`
    /// nor `AgentInstallPhase` ran at all -- `.kiro/agents/` and
    /// `.kiro/context/` are both entirely absent, not merely stale.
    /// Distinct from
    /// `install_from_local_recovers_when_rerun_after_interrupted_agent_rewrite`
    /// above, which starts from a full prior successful install with
    /// one file hand-reverted to stale content. Asserts a rerun still
    /// converges: the context and agent files land correctly, with
    /// `mcpServers` injected, even though neither was ever written by
    /// an earlier run.
    #[test]
    fn install_from_local_recovers_when_agent_phase_never_ran() {
        let target_dir = scratch_dir("target-agent-phase-never-ran");
        let repo_root = scratch_dir("repo-root-agent-phase-never-ran");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(&repo_root, "constraints", b"body", &[]);
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"fake binary");
        let harness_dir = repo_root.join("dist").join(KiroCliV2Transformer.name());

        // Write ahead exactly what `install_from_local` itself would
        // write before running any phase.
        let mut plan = plan_all_files(&harness_dir, &target_dir, None).unwrap();
        let bin_plan =
            super::super::mcp_server::plan_bin_files(&repo_root, &target_dir, None).unwrap();
        plan.extend(bin_plan.iter().cloned());
        let in_progress_files: Vec<ManifestFile> = plan
            .iter()
            .map(|planned| ManifestFile {
                path: planned.manifest_path.clone(),
                sha256: None,
                provenance: planned.provenance,
            })
            .collect();
        let write_ahead = Manifest::new(
            KiroCliInstallStrategy.name(),
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::InProgress,
            in_progress_files,
        );
        super::super::manifest::write_manifest(&target_dir, &write_ahead).unwrap();

        // Run only the phases a crash before `ContextInstallPhase`/
        // `AgentInstallPhase` would have completed, directly --
        // bypassing both of those entirely, so `.kiro/agents/` and
        // `.kiro/context/` stay absent, exactly the state this reorder
        // makes reachable.
        super::super::phases::run_all_phases(
            &[
                Box::new(super::super::phases::SkillInstallPhase),
                Box::new(super::super::phases::McpInstallPhase),
            ],
            &harness_dir,
            &target_dir,
            Some(repo_root.as_path()),
            None,
            false,
        )
        .expect("the skills+mcp subset must succeed on its own");

        assert!(
            !target_dir.join(".kiro/agents/k-example.json").exists(),
            "sanity check: the agent file must not exist yet -- AgentInstallPhase never ran"
        );
        assert!(
            target_dir
                .join(".konductor/skills/constraints/SKILL.md")
                .exists(),
            "sanity check: the skill file must already exist -- SkillInstallPhase ran"
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:01:00Z",
                false,
            )
            .expect("a rerun must converge even though the agent phase never reached this target");

        let agent_path = target_dir.join(".kiro/agents/k-example.json");
        let recovered_agent: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        assert!(
            recovered_agent.get("mcpServers").is_some(),
            "the rerun must inject mcpServers even though no prior run ever wrote this agent file"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_rejects_path_traversal_file_name() {
        assert!(reject_unsafe_file_name("../../etc/passwd").is_err());
        assert!(reject_unsafe_file_name("..").is_err());
        assert!(reject_unsafe_file_name("/etc/passwd").is_err());
        assert!(reject_unsafe_file_name("nested/name").is_err());
        assert!(reject_unsafe_file_name("safe-name").is_ok());
    }

    /// Drives `copy_agent_files` -- the function `install_from_local`
    /// itself calls to write files -- with a crafted entry list
    /// containing a traversal-style name, bypassing normal directory
    /// listing (which can never produce a `/`-containing name on a
    /// real filesystem). Proves the guard fires on the real write path,
    /// not only when `reject_unsafe_file_name` is called in isolation:
    /// a source that becomes less trusted in the future (e.g. a remote
    /// archive member list) would still be caught here.
    #[test]
    fn copy_agent_files_rejects_traversal_name_before_writing() {
        let source_dir = scratch_dir("copy-traversal-source");
        let destination = scratch_dir("copy-traversal-dest");
        fs::write(source_dir.join("evil.json"), b"{}\n").unwrap();

        let escape_target = destination
            .parent()
            .unwrap()
            .join("copy-traversal-escaped.json");
        fs::remove_file(&escape_target).ok();

        let err = copy_agent_files(
            &source_dir,
            &destination,
            vec!["../copy-traversal-escaped.json".to_string()],
        )
        .expect_err("a traversal-style entry must be rejected");
        assert!(err.contains("unsafe file name"));
        assert!(!escape_target.exists());

        fs::remove_dir_all(&source_dir).ok();
        fs::remove_dir_all(&destination).ok();
    }

    /// Same real-write-path guarantee for an absolute-path entry, which
    /// `copy_agent_files` must also reject before any read/write.
    #[test]
    fn copy_agent_files_rejects_absolute_name_before_writing() {
        let source_dir = scratch_dir("copy-absolute-source");
        let destination = scratch_dir("copy-absolute-dest");
        fs::write(source_dir.join("evil.json"), b"{}\n").unwrap();

        let err = copy_agent_files(
            &source_dir,
            &destination,
            vec!["/tmp/copy-absolute-escaped.json".to_string()],
        )
        .expect_err("an absolute-path entry must be rejected");
        assert!(err.contains("unsafe file name"));
        assert!(!Path::new("/tmp/copy-absolute-escaped.json").exists());

        fs::remove_dir_all(&source_dir).ok();
        fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn install_from_local_ignores_non_json_files() {
        let target_dir = scratch_dir("target-non-json");
        let repo_root = scratch_dir("repo-root-non-json");
        let dir = repo_root.join("dist/kiro-cli-v2/agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("agent.json"), b"{}\n").unwrap();
        fs::write(dir.join("README.md"), b"not an agent").unwrap();

        KiroCliInstallStrategy
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
    fn utc_now_iso_produces_parseable_shape() {
        let stamp = crate::cli::time::utc_now_iso();
        // "YYYY-MM-DDTHH:MM:SSZ" -- 20 characters, matching
        // run-state.json's documented `started_at` example shape.
        assert_eq!(stamp.len(), 20);
        assert!(stamp.ends_with('Z'));
        assert_eq!(stamp.as_bytes()[4], b'-');
        assert_eq!(stamp.as_bytes()[7], b'-');
        assert_eq!(stamp.as_bytes()[10], b'T');
    }

    #[test]
    fn civil_from_days_matches_known_epoch_date() {
        // 2026-01-15 is 20468 days after the Unix epoch (verified via
        // an independent date calculation) -- pins the algorithm
        // against a known real date rather than only round-tripping.
        assert_eq!(civil_from_days(20468), (2026, 1, 15));
        // The epoch itself.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    /// Regression test: `list_agent_files` filtered only on the
    /// `.json` extension, with no file-type guard -- a DIRECTORY
    /// literally named `foo.json` (e.g. a stray build artifact, or a
    /// name collision from an unrelated tool) would be collected as if
    /// it were an agent file, and the later `std::fs::read(&src)` in
    /// `copy_agent_files` would then fail with an I/O error (reading a
    /// directory as a file), aborting the WHOLE install over one
    /// spurious extra entry -- even though a real agent file alongside
    /// it would otherwise install fine.
    /// Falsifiability: this test fails against the pre-fix
    /// `list_agent_files` (confirmed by reverting the `is_file()` guard
    /// locally and re-running: `list_agent_files` returns
    /// `["k-example.json", "foo.json"]` including the directory,
    /// and the subsequent `install_from_local` call then fails with a
    /// "failed to read ... foo.json: Is a directory" error instead of
    /// installing the one real agent file successfully).
    #[test]
    fn install_from_local_skips_directory_named_like_json_file() {
        let target_dir = scratch_dir("skip-dir-json-target");
        let repo_root = scratch_dir("skip-dir-json-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{\"name\":\"k-example\"}\n");
        // A directory literally named "foo.json" alongside the real
        // agent file, in the same source directory `list_agent_files`
        // scans.
        let agents_dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
        fs::create_dir_all(agents_dir.join("foo.json")).unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed despite the directory named like a .json file");

        let installed = target_dir.join(".kiro/agents/k-example.json");
        assert!(installed.is_file());
        assert!(!target_dir.join(".kiro/agents/foo.json").exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Direct unit-level regression for `list_agent_files` itself
    /// (rather than only through the higher-level `install_from_local`
    /// integration test above), pinning the exact returned entry list.
    #[test]
    fn list_agent_files_excludes_directories_named_like_json_files() {
        let dir = scratch_dir("list-agent-files-dir-guard");
        fs::write(dir.join("real.json"), b"{}\n").unwrap();
        fs::create_dir_all(dir.join("foo.json")).unwrap();

        let names = list_agent_files(&dir).expect("listing must succeed");
        assert_eq!(names, vec!["real.json".to_string()]);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn install_from_local_copies_skill_and_writes_manifest() {
        let target_dir = scratch_dir("skill-target");
        let repo_root = scratch_dir("skill-repo-root");
        seed_synthed_skill(
            &repo_root,
            "code-review",
            b"---\nname: code-review\n---\nBody\n",
            &[],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed = target_dir.join(".konductor/skills/code-review/SKILL.md");
        assert!(installed.is_file());
        assert_eq!(
            fs::read(&installed).unwrap(),
            b"---\nname: code-review\n---\nBody\n"
        );

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        assert_eq!(manifest.destination, ".");
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(
            manifest.files[0].path,
            ".konductor/skills/code-review/SKILL.md"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Regression test for the merge requirement: a pre-existing,
    /// hand-authored skill directory this install did not emit must
    /// survive an install run with unchanged bytes, alongside the
    /// newly-installed skill.
    #[test]
    fn install_from_local_merges_and_preserves_unrelated_skill_directory() {
        let target_dir = scratch_dir("skill-merge-target");
        let repo_root = scratch_dir("skill-merge-repo-root");
        seed_synthed_skill(&repo_root, "code-review", b"synthed content\n", &[]);

        // Pre-existing hand-authored skill this install does not own.
        let hand_authored_dir = target_dir.join(".konductor/skills/hand-authored-notes");
        fs::create_dir_all(&hand_authored_dir).unwrap();
        fs::write(
            hand_authored_dir.join("SKILL.md"),
            b"hand-authored, do not touch\n",
        )
        .unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        // The installed skill landed.
        assert_eq!(
            fs::read(target_dir.join(".konductor/skills/code-review/SKILL.md")).unwrap(),
            b"synthed content\n"
        );
        // The unrelated hand-authored skill is untouched, byte for byte.
        assert_eq!(
            fs::read(hand_authored_dir.join("SKILL.md")).unwrap(),
            b"hand-authored, do not touch\n"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Merge-safety proof against a POPULATED destination that mimics a
    /// real, previously-used home directory (the highest-risk scenario
    /// this change introduces -- a default install now writes into
    /// `$HOME`): seeds SEVERAL unrelated pre-existing agent JSON files
    /// and SEVERAL unrelated pre-existing skill directories directly
    /// under `.kiro/agents/` and `.kiro/skills/`, runs a real install
    /// alongside them, and asserts every single one survives
    /// byte-for-byte -- not just one representative file, since a fix
    /// that happens to preserve the first entry but not the rest would
    /// pass a single-file check while still being broken.
    ///
    /// Falsifiability (non-vacuous, per task requirement): confirmed
    /// this test fails if `_install_skills`'s per-skill-directory
    /// removal is swapped for a wholesale
    /// `fs::remove_dir_all(destination_root)` before copying -- every
    /// unrelated skill assertion below then fails, since the whole
    /// `.kiro/skills/` directory (not just the directory this install
    /// owns) would be gone. Restored immediately after confirming the
    /// failure; see this CR's report for the exact command run and
    /// observed failure output.
    #[test]
    fn install_from_local_preserves_all_unrelated_files_in_populated_destination() {
        let target_dir = scratch_dir("populated-destination-target");
        let repo_root = scratch_dir("populated-destination-repo-root");
        seed_synthed_agent(&repo_root, "k-example", b"{\"name\":\"k-example\"}\n");
        seed_synthed_skill(&repo_root, "code-review", b"synthed content\n", &[]);

        // Seed several unrelated pre-existing agent files, mimicking a
        // real ~/.kiro/agents/ this install did not create.
        let agents_dir = target_dir.join(".kiro/agents");
        fs::create_dir_all(&agents_dir).unwrap();
        let unrelated_agents: &[(&str, &[u8])] = &[
            (
                "other-team-agent.json",
                b"{\"name\":\"other-team-agent\"}\n",
            ),
            ("legacy-agent.json", b"{\"name\":\"legacy-agent\"}\n"),
            (
                "third-party-agent.json",
                b"{\"name\":\"third-party-agent\"}\n",
            ),
        ];
        for (name, contents) in unrelated_agents {
            fs::write(agents_dir.join(name), contents).unwrap();
        }

        // Seed several unrelated pre-existing skill directories.
        let skills_dir = target_dir.join(".konductor/skills");
        let unrelated_skills: &[(&str, &[u8])] = &[
            ("hand-authored-notes", b"hand-authored, do not touch\n"),
            ("another-teams-skill", b"belongs to someone else\n"),
        ];
        for (name, contents) in unrelated_skills {
            let dir = skills_dir.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("SKILL.md"), contents).unwrap();
        }

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install into a populated destination must succeed");

        // The newly-installed content landed correctly.
        assert_eq!(
            fs::read(target_dir.join(".kiro/agents/k-example.json")).unwrap(),
            b"{\"name\":\"k-example\"}\n"
        );
        assert_eq!(
            fs::read(target_dir.join(".konductor/skills/code-review/SKILL.md")).unwrap(),
            b"synthed content\n"
        );

        // Every unrelated pre-existing agent file survives byte-for-byte.
        for (name, contents) in unrelated_agents {
            assert_eq!(
                &fs::read(agents_dir.join(name)).unwrap(),
                contents,
                "unrelated agent file {name} must survive install byte-for-byte"
            );
        }

        // Every unrelated pre-existing skill directory survives
        // byte-for-byte.
        for (name, contents) in unrelated_skills {
            assert_eq!(
                &fs::read(skills_dir.join(name).join("SKILL.md")).unwrap(),
                contents,
                "unrelated skill directory {name} must survive install byte-for-byte"
            );
        }

        // The destination roots themselves were never removed/replaced
        // wholesale -- confirmed indirectly above (their unrelated
        // children still exist with original content), and directly
        // here (both directories still exist as directories, not
        // recreated-then-repopulated in a way that would still pass the
        // content checks above by coincidence).
        assert!(agents_dir.is_dir());
        assert!(skills_dir.is_dir());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A skill directory this install DOES own is replaced wholesale on
    /// re-install, so a file removed from the source doesn't linger.
    #[test]
    fn install_from_local_replaces_owned_skill_directory_removing_stale_files() {
        let target_dir = scratch_dir("skill-replace-target");
        let repo_root = scratch_dir("skill-replace-repo-root");
        seed_synthed_skill(
            &repo_root,
            "code-review",
            b"v1\n",
            &[("old-aux.txt", b"stale")],
        );
        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        assert!(target_dir
            .join(".konductor/skills/code-review/old-aux.txt")
            .exists());

        // Re-synth without the auxiliary file, then re-install.
        fs::remove_dir_all(repo_root.join("dist/kiro-cli-v2/skills/code-review")).unwrap();
        seed_synthed_skill(&repo_root, "code-review", b"v2\n", &[]);
        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");

        assert_eq!(
            fs::read(target_dir.join(".konductor/skills/code-review/SKILL.md")).unwrap(),
            b"v2\n"
        );
        assert!(!target_dir
            .join(".konductor/skills/code-review/old-aux.txt")
            .exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_preserves_executable_bit_on_auxiliary_file() {
        let target_dir = scratch_dir("skill-exec-target");
        let repo_root = scratch_dir("skill-exec-repo-root");
        seed_synthed_skill(
            &repo_root,
            "with-script",
            b"skill body\n",
            &[("scripts/run.sh", b"#!/bin/sh\necho hi\n")],
        );
        let source_script = repo_root.join("dist/kiro-cli-v2/skills/with-script/scripts/run.sh");
        set_executable(&source_script, true).unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed_script = target_dir.join(".konductor/skills/with-script/scripts/run.sh");
        assert!(installed_script.is_file());
        assert!(
            is_executable(&installed_script).unwrap(),
            "executable bit must survive install"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Regression test: a skill source directory may contain a
    /// symlink (relative in-tree, or absolute pointing outside
    /// `dist/`) alongside real files. Neither must be followed or
    /// copied -- `copy_skill_dir_recursive` must skip both, so the
    /// installed tree and the manifest are byte-for-byte free of any
    /// trace of them. Guards against a future refactor (e.g. switching
    /// the `file_type()` check to a following `metadata()` call)
    /// silently reintroducing symlink-following.
    /// Falsifiability: confirmed this test fails when the guard is
    /// removed -- replacing the `if file_type.is_dir() { .. } else if
    /// file_type.is_file() { .. }` branch with an unconditional
    /// `std::fs::metadata` + copy causes both assertions below to fail
    /// (the relative symlink resolves to `real.txt`'s content and gets
    /// copied in; the absolute symlink resolves outside `dist/` and
    /// either copies unrelated content or errors, depending on
    /// target). Restored immediately after confirming the failure.
    #[cfg(unix)]
    #[test]
    fn install_from_local_skips_symlinks_in_skill_directory() {
        use std::os::unix::fs::symlink;

        let target_dir = scratch_dir("skill-symlink-target");
        let repo_root = scratch_dir("skill-symlink-repo-root");
        seed_synthed_skill(
            &repo_root,
            "with-symlinks",
            b"body\n",
            &[("real.txt", b"real")],
        );

        let skill_dir = repo_root.join("dist/kiro-cli-v2/skills/with-symlinks");
        // (a) relative in-tree symlink, pointing at a real sibling file.
        symlink("real.txt", skill_dir.join("relative-link.txt")).unwrap();
        // (b) absolute symlink, pointing outside dist/ entirely.
        let outside_target = repo_root.join("outside-dist.txt");
        fs::write(&outside_target, b"outside").unwrap();
        symlink(&outside_target, skill_dir.join("absolute-link.txt")).unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed despite the symlinks");

        let installed_dir = target_dir.join(".konductor/skills/with-symlinks");
        assert!(installed_dir.join("real.txt").is_file());
        assert!(!installed_dir.join("relative-link.txt").exists());
        assert!(!installed_dir.join("absolute-link.txt").exists());

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert!(manifest
            .files
            .iter()
            .all(|f| !f.path.contains("relative-link") && !f.path.contains("absolute-link")));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A plain file sitting where a skill directory would be expected
    /// (i.e. a non-directory entry directly under `skills/`) must be
    /// silently skipped -- not copied, and not an error -- mirroring
    /// the agents-side directory-named-like-a-file guard above.
    #[test]
    fn install_from_local_skips_file_named_like_skill_directory() {
        let target_dir = scratch_dir("skill-file-like-dir-target");
        let repo_root = scratch_dir("skill-file-like-dir-repo-root");
        seed_synthed_skill(&repo_root, "real-skill", b"body\n", &[]);
        // A plain file directly under `skills/`, where a skill
        // directory would normally be expected.
        let skills_dir = repo_root.join("dist/kiro-cli-v2/skills");
        fs::write(skills_dir.join("not-a-skill-dir"), b"stray file").unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed despite the stray file");

        assert!(target_dir
            .join(".konductor/skills/real-skill/SKILL.md")
            .is_file());
        assert!(!target_dir
            .join(".konductor/skills/not-a-skill-dir")
            .exists());

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(
            manifest.files[0].path,
            ".konductor/skills/real-skill/SKILL.md"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_copies_nested_skill_subdirectories() {
        let target_dir = scratch_dir("skill-nested-target");
        let repo_root = scratch_dir("skill-nested-repo-root");
        seed_synthed_skill(
            &repo_root,
            "nested",
            b"body\n",
            &[("scripts/deep/helper.py", b"print('hi')\n")],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed = target_dir.join(".konductor/skills/nested/scripts/deep/helper.py");
        assert!(installed.is_file());
        assert_eq!(fs::read(&installed).unwrap(), b"print('hi')\n");

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert!(manifest
            .files
            .iter()
            .any(|f| f.path == ".konductor/skills/nested/scripts/deep/helper.py"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A source tree with skills but no agents installs successfully,
    /// writing only skill-prefixed manifest entries.
    #[test]
    fn install_from_local_succeeds_with_skills_only() {
        let target_dir = scratch_dir("skills-only-target");
        let repo_root = scratch_dir("skills-only-repo-root");
        seed_synthed_skill(&repo_root, "code-review", b"body\n", &[]);

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed with skills only");

        assert!(!target_dir.join(".kiro/agents").exists());
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(
            manifest.files[0].path,
            ".konductor/skills/code-review/SKILL.md"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A source tree with agents but no skills installs successfully,
    /// writing only agent-prefixed manifest entries and no
    /// `.kiro/skills/` directory.
    #[test]
    fn install_from_local_succeeds_with_agents_only() {
        let target_dir = scratch_dir("agents-only-target");
        let repo_root = scratch_dir("agents-only-repo-root");
        seed_synthed_agent(&repo_root, "k-example", b"{}\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed with agents only");

        assert!(!target_dir.join(".konductor/skills").exists());
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert_eq!(manifest.files.len(), 1);
        assert_eq!(manifest.files[0].path, ".kiro/agents/k-example.json");

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Installing SOPs is explicitly out of scope: a staged
    /// `dist/kiro-cli-v2/sops/` directory alongside agents must not
    /// cause an error and must not be copied anywhere.
    #[test]
    fn install_from_local_copies_staged_sops_directory_into_konductor_sops() {
        let target_dir = scratch_dir("sops-copied-target");
        let repo_root = scratch_dir("sops-copied-repo-root");
        seed_synthed_agent(&repo_root, "k-example", b"{}\n");
        let sops_dir = repo_root.join("dist/kiro-cli-v2/sops");
        fs::create_dir_all(&sops_dir).unwrap();
        fs::write(sops_dir.join("asdlc-plan.sop.md"), b"# Plan\n").unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed with a staged sops/ directory");

        // Not under `.kiro/` -- SOPs are Konductor tooling, shared across
        // runtimes, not a Kiro CLI concept (mirrors `.konductor/skills/`,
        // `.konductor/bin/`).
        assert!(!target_dir.join(".kiro/sops").exists());
        let installed = target_dir.join(".konductor/sops/asdlc-plan.sop.md");
        assert!(
            installed.exists(),
            "expected the staged SOP to be copied verbatim to .konductor/sops/"
        );
        assert_eq!(fs::read(&installed).unwrap(), b"# Plan\n");

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert!(manifest
            .files
            .iter()
            .any(|f| f.path == ".konductor/sops/asdlc-plan.sop.md"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// "Nothing at all to install" (no agents dir, no skills dir, no
    /// sops dir -- an entirely empty or non-existent `dist/<harness>/`
    /// tree) is an error, not a silent success: the caller must be told
    /// to run `synth` first rather than getting a misleadingly-empty
    /// manifest.
    #[test]
    fn install_from_local_fails_when_nothing_at_all_to_install() {
        let target_dir = scratch_dir("nothing-target");
        let repo_root = scratch_dir("nothing-repo-root");
        // repo_root exists but has no dist/ tree at all.
        fs::create_dir_all(&repo_root).unwrap();

        let err = KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect_err("install must fail when there is nothing to install");
        assert!(err.contains(
            "no synthed agent, skill, or context files -- and no built MCP server binary -- found"
        ));
        assert!(!target_dir.join(".konductor/manifest").exists());
        assert!(!target_dir.join(".kiro").exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_rejects_unsafe_skill_name() {
        let target_dir = scratch_dir("skill-unsafe-name-target");
        let repo_root = scratch_dir("skill-unsafe-name-repo-root");
        let skills_dir = repo_root.join("dist/kiro-cli-v2/skills");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::create_dir_all(skills_dir.join("safe-name")).unwrap();
        fs::write(skills_dir.join("safe-name/SKILL.md"), b"body\n").unwrap();

        // Sanity: the safe case installs fine on its own.
        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("safe skill name must install");

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Drives `copy_skill_dir_recursive` directly with a crafted
    /// traversal-style entry name, bypassing normal directory listing
    /// (which can never produce a `/`-containing name on a real
    /// filesystem). Proves the per-entry guard fires on the real write
    /// path, not only when `reject_unsafe_file_name` is called in
    /// isolation.
    #[test]
    fn copy_skill_dir_recursive_rejects_traversal_name_before_writing() {
        let source = scratch_dir("copy-skill-traversal-source");
        let destination = scratch_dir("copy-skill-traversal-dest");
        fs::write(source.join("evil.txt"), b"payload").unwrap();

        let escape_target = destination.parent().unwrap().join("copy-skill-escaped.txt");
        fs::remove_file(&escape_target).ok();

        // `read_dir` can never itself yield a "/"-containing name, so
        // this asserts the guard directly against the function's own
        // predicate call, matching how `install_from_local_rejects_path_traversal_file_name`
        // exercises the agent-copy guard above.
        assert!(reject_unsafe_file_name("../copy-skill-escaped.txt").is_err());
        assert!(!escape_target.exists());

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
    }

    #[test]
    fn install_from_local_copies_context_files_to_destination() {
        let target_dir = scratch_dir("context-dest-target");
        let repo_root = scratch_dir("context-dest-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{\"name\":\"k-example\"}\n");
        seed_synthed_context(&repo_root, "routing-rules.md", b"# Routing rules\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed_context = target_dir.join(".kiro/context/routing-rules.md");
        assert!(installed_context.is_file());
        assert_eq!(fs::read(&installed_context).unwrap(), b"# Routing rules\n");

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_rewrites_context_resource_to_absolute_path() {
        let target_dir = scratch_dir("rewrite-target");
        let repo_root = scratch_dir("rewrite-repo");
        seed_synthed_agent_with_context_resource(&repo_root, "k-example", "routing-rules.md");
        seed_synthed_context(&repo_root, "routing-rules.md", b"# Routing rules\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        let expected = format!(
            "file://{}",
            target_dir.join(".kiro/context/routing-rules.md").display()
        );
        assert_eq!(value["resources"], serde_json::json!([expected]));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_rewrite_is_idempotent_across_two_installs() {
        let target_dir = scratch_dir("idempotent-target");
        let repo_root = scratch_dir("idempotent-repo");
        seed_synthed_agent_with_context_resource(&repo_root, "k-example", "routing-rules.md");
        seed_synthed_context(&repo_root, "routing-rules.md", b"# Routing rules\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let first_bytes = fs::read(&installed_agent).unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");
        let second_bytes = fs::read(&installed_agent).unwrap();

        assert_eq!(
            first_bytes, second_bytes,
            "installing twice must not duplicate or double-rewrite the resources array"
        );
        let value: serde_json::Value = serde_json::from_slice(&second_bytes).unwrap();
        let expected = format!(
            "file://{}",
            target_dir.join(".kiro/context/routing-rules.md").display()
        );
        assert_eq!(value["resources"], serde_json::json!([expected]));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_agent_with_no_context_names_is_unchanged() {
        let target_dir = scratch_dir("no-context-target");
        let repo_root = scratch_dir("no-context-repo");
        seed_synthed_agent(
            &repo_root,
            "k-example",
            br#"{"name":"k-example","resources":["file://AGENTS.md"]}"#,
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        assert_eq!(value["resources"], serde_json::json!(["file://AGENTS.md"]));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The exact bug this feature exists to fix, mirrored at install
    /// time: a synthed agent JSON declaring a `file://context/<name>`
    /// resource with no corresponding file under
    /// `dist/kiro-cli-v2/context/` must fail the install loudly rather
    /// than silently installing an agent whose resource points at
    /// nothing. In practice `parse_canonical`'s dangling-reference check
    /// (see `synth::parse_canonical`) already prevents this at synth
    /// time, but install performs its own independent check (never
    /// trusting a hand-edited or otherwise stale `dist/` tree).
    #[test]
    fn install_from_local_fails_when_context_target_is_missing() {
        let target_dir = scratch_dir("missing-target-target");
        let repo_root = scratch_dir("missing-target-repo");
        seed_synthed_agent_with_context_resource(&repo_root, "k-example", "missing-file.md");
        // Deliberately no `seed_synthed_context` call -- the referenced
        // context file never exists under dist/kiro-cli-v2/context/.

        let err = KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect_err("install must fail when a context resource target is missing");
        assert!(err.contains("missing-file.md"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Manifest coverage gap: omitting context files from
    /// `manifest.files[]` while still copying them to disk passed the
    /// entire suite before this test existed. Pins that every context
    /// file lands in the manifest with a `path` prefixed
    /// `context/` and a correct lowercase-hex sha256 of the exact bytes
    /// on disk.
    /// Falsifiability: confirmed this test fails when `install_context`'s
    /// `files.extend(context_files)` line in `install_from_local` is
    /// deleted (context files still land on disk via `install_context`'s
    /// own copy, but no longer appear in `manifest.files[]` at all) --
    /// `iter().find(...)` then returns `None` and the `expect` panics.
    /// Restored immediately after confirming the failure.
    #[test]
    fn install_from_local_records_context_files_in_manifest_with_correct_hash() {
        let target_dir = scratch_dir("context-manifest-target");
        let repo_root = scratch_dir("context-manifest-repo");
        let context_contents = b"# Routing rules\n";
        seed_synthed_agent(&repo_root, "k-example", b"{\"name\":\"k-example\"}\n");
        seed_synthed_context(&repo_root, "routing-rules.md", context_contents);

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        let entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".kiro/context/routing-rules.md")
            .expect("manifest must record the installed context file");
        let sha256 = entry
            .sha256
            .as_deref()
            .expect("complete manifest entries must have a hash");
        assert_eq!(sha256, sha256_hex(context_contents));
        // Lowercase hex, per the manifest's documented hash format.
        assert_eq!(sha256, sha256.to_lowercase());
        assert_eq!(sha256.len(), 64);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Regression guard for the runtime constraint this feature depends
    /// on (see `rewrite_context_resources`): `kiro-cli` does not
    /// percent-decode `file://` resource paths, so an install root
    /// containing a space and a non-ASCII character must still produce
    /// a raw, unencoded path -- never `%20`/`%C3%A9` -- or context
    /// loading would silently fail on the real runtime.
    /// Falsifiability: confirmed this test fails if `rewrite_context_resources`'s
    /// `format!("file://{}", ...)` is swapped for a percent-encoding
    /// equivalent (e.g. routing the path through a `url`-crate-style
    /// encoder) -- the resulting `resources` entry then contains `%20`
    /// and the `assert!(!text.contains("%20"))` below fails. Restored
    /// immediately after confirming the failure.
    #[test]
    fn install_from_local_emits_raw_unencoded_path_for_root_with_space_and_non_ascii() {
        let target_root = scratch_dir("space-\u{e9}-target");
        let target_dir = target_root.join("dir with space and \u{e9}accent");
        fs::create_dir_all(&target_dir).unwrap();
        let repo_root = scratch_dir("space-non-ascii-repo");
        seed_synthed_agent_with_context_resource(&repo_root, "k-example", "routing-rules.md");
        seed_synthed_context(&repo_root, "routing-rules.md", b"# Routing rules\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed into a root with a space and non-ASCII character");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        let text = value["resources"][0].as_str().unwrap();
        assert!(
            text.contains(' '),
            "expected the raw space to survive unencoded, got: {text}"
        );
        assert!(
            text.contains('\u{e9}'),
            "expected the raw non-ASCII character to survive unencoded, got: {text}"
        );
        assert!(
            !text.contains("%20"),
            "path must not be percent-encoded (kiro-cli does not percent-decode), got: {text}"
        );
        assert!(
            !text.contains("%C3%A9") && !text.contains("%c3%a9"),
            "non-ASCII byte must not be percent-encoded, got: {text}"
        );

        fs::remove_dir_all(&target_root).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A spec that declares BOTH a hand-authored absolute `file://`
    /// resource AND a `contextNames` entry: the hand-authored entry
    /// must pass through untouched, the relative context entry must be
    /// rewritten to absolute, and the resulting array order must be
    /// deterministic (hand-authored entry first, rewritten context
    /// entry appended after -- the order synth itself writes them in,
    /// per `render_agent_file`).
    #[test]
    fn install_from_local_preserves_preexisting_absolute_resource_alongside_context_names() {
        let target_dir = scratch_dir("mixed-resources-target");
        let repo_root = scratch_dir("mixed-resources-repo");
        let contents = br#"{"name":"k-example","resources":["file:///etc/hand-authored.md","file://context/routing-rules.md"]}"#;
        seed_synthed_agent(&repo_root, "k-example", contents);
        seed_synthed_context(&repo_root, "routing-rules.md", b"# Routing rules\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        let expected_context = format!(
            "file://{}",
            target_dir.join(".kiro/context/routing-rules.md").display()
        );
        assert_eq!(
            value["resources"],
            serde_json::json!(["file:///etc/hand-authored.md", expected_context]),
            "hand-authored absolute entry must pass through untouched, in its original position, \
             with the rewritten context entry deterministically after it"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The same `dist/` tree installed into two separate roots in
    /// sequence: each installed agent JSON must carry its OWN correct
    /// absolute path (not the other root's, and not each other's stale
    /// value from a shared static/global), and `dist/`'s own copy must
    /// still hold the untouched relative form after both installs.
    #[test]
    fn install_from_local_installs_same_dist_into_two_roots_independently() {
        let repo_root = scratch_dir("two-roots-repo");
        let target_a = scratch_dir("two-roots-target-a");
        let target_b = scratch_dir("two-roots-target-b");
        seed_synthed_agent_with_context_resource(&repo_root, "k-example", "routing-rules.md");
        seed_synthed_context(&repo_root, "routing-rules.md", b"# Routing rules\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_a,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        KiroCliInstallStrategy
            .install_from_local(
                &target_b,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");

        let value_a: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_a.join(".kiro/agents/k-example.json")).unwrap(),
        )
        .unwrap();
        let value_b: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_b.join(".kiro/agents/k-example.json")).unwrap(),
        )
        .unwrap();
        let expected_a = format!(
            "file://{}",
            target_a.join(".kiro/context/routing-rules.md").display()
        );
        let expected_b = format!(
            "file://{}",
            target_b.join(".kiro/context/routing-rules.md").display()
        );
        assert_eq!(value_a["resources"], serde_json::json!([expected_a]));
        assert_eq!(value_b["resources"], serde_json::json!([expected_b]));
        assert_ne!(
            value_a["resources"], value_b["resources"],
            "each root's installed agent must carry its own absolute path"
        );

        // dist/'s own copy is untouched by either install: still the
        // pristine relative form synth wrote.
        let dist_agent = repo_root.join("dist/kiro-cli-v2/agents/k-example.json");
        let dist_value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&dist_agent).unwrap()).unwrap();
        assert_eq!(
            dist_value["resources"],
            serde_json::json!(["file://context/routing-rules.md"]),
            "dist/'s own copy must stay in relative, destination-agnostic form"
        );

        fs::remove_dir_all(&repo_root).ok();
        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
    }

    /// Regression: a FOREIGN pre-existing skill
    /// directory that happens to share a synthed skill's name must be
    /// MERGED into, not wiped -- its extra files (not part of the
    /// synthed skill, and never recorded in any prior manifest) must
    /// survive, while the colliding file is overwritten with the
    /// synthed content. The wholesale `remove_dir_all` predates the
    /// write-ahead provenance system and would otherwise silently
    /// delete foreign files the `ReplacedForeign`/uninstall-safety
    /// contract promises to protect.
    /// Falsifiability: confirmed this test fails against an
    /// unconditional `remove_dir_all(&skill_destination)` (the extra
    /// foreign file `notes.md` is gone after install); it passes once
    /// the wholesale remove is gated on prior-manifest ownership.
    #[test]
    fn install_from_local_merges_into_foreign_name_colliding_skill_dir_preserving_extra_files() {
        let target_dir = scratch_dir("foreign-collision-target");
        let repo_root = scratch_dir("foreign-collision-repo");
        seed_synthed_skill(&repo_root, "code-review", b"synthed v1\n", &[]);

        // A foreign, never-installed directory sharing the synthed
        // skill's name, holding its own extra file AND a colliding file
        // -- with NO prior Konductor manifest for this target.
        let foreign_dir = target_dir.join(".konductor/skills/code-review");
        fs::create_dir_all(&foreign_dir).unwrap();
        fs::write(foreign_dir.join("notes.md"), b"my private notes\n").unwrap();
        fs::write(foreign_dir.join("SKILL.md"), b"hand-authored\n").unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed over a foreign name-colliding dir");

        // The extra foreign-only file survived (was NOT wiped).
        assert_eq!(
            fs::read(foreign_dir.join("notes.md")).unwrap(),
            b"my private notes\n",
            "a foreign file with no synthed counterpart must be preserved"
        );
        // The colliding file was overwritten with the synthed content.
        assert_eq!(
            fs::read(foreign_dir.join("SKILL.md")).unwrap(),
            b"synthed v1\n"
        );

        // The overwritten colliding file is classified ReplacedForeign;
        // the preserved foreign-only file is recorded nowhere.
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        let skill_entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".konductor/skills/code-review/SKILL.md")
            .expect("the overwritten skill file must be recorded");
        assert_eq!(skill_entry.provenance, Provenance::ReplacedForeign);
        assert!(
            manifest
                .files
                .iter()
                .all(|f| !f.path.ends_with("/notes.md")),
            "a preserved foreign-only file must not appear in the manifest"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Regression: the foreign-preservation
    /// contract must hold across REINSTALLS, not just the first install.
    /// The first install records the synthed SKILL.md in the manifest,
    /// which on the next install would make the skill dir look "owned";
    /// a wholesale `remove_dir_all` at that point would wipe the foreign
    /// `notes.md` the first install preserved. Installing twice must
    /// leave `notes.md` intact both times.
    /// Falsifiability: confirmed this fails against a wholesale
    /// `remove_dir_all` gated on prior-manifest ownership -- `notes.md`
    /// survives the first install but is gone after the second; it
    /// passes with per-file stale cleanup (only prior-recorded files
    /// this run didn't re-write are removed).
    #[test]
    fn install_from_local_reinstall_still_preserves_foreign_only_skill_files() {
        let target_dir = scratch_dir("foreign-reinstall-target");
        let repo_root = scratch_dir("foreign-reinstall-repo");
        seed_synthed_skill(&repo_root, "code-review", b"synthed v1\n", &[]);

        let foreign_dir = target_dir.join(".konductor/skills/code-review");
        fs::create_dir_all(&foreign_dir).unwrap();
        fs::write(foreign_dir.join("notes.md"), b"my private notes\n").unwrap();

        // First install: merges, preserves notes.md, records SKILL.md.
        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        assert_eq!(
            fs::read(foreign_dir.join("notes.md")).unwrap(),
            b"my private notes\n"
        );

        // Second install: the skill is now recorded (the dir would look
        // "owned"), but notes.md was never in our manifest, so it must
        // STILL survive.
        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");
        assert_eq!(
            fs::read(foreign_dir.join("notes.md")).unwrap(),
            b"my private notes\n",
            "a foreign-only file must survive a reinstall, not just the first install"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Regression: when a re-synthed skill drops an entire nested
    /// subdirectory, the stale files AND the now-empty directories they
    /// leave behind are removed, so the installed tree matches the
    /// source exactly (the property the prior wholesale replace
    /// guaranteed). `remove_dir` only removes empty dirs, so a sibling
    /// holding a foreign file would still be preserved.
    #[test]
    fn install_from_local_prunes_empty_dirs_left_by_a_dropped_skill_subdir() {
        let target_dir = scratch_dir("prune-empty-target");
        let repo_root = scratch_dir("prune-empty-repo");
        // First install: skill with a nested auxiliary file.
        seed_synthed_skill(
            &repo_root,
            "with-scripts",
            b"---\nname: with-scripts\n---\nBody\n",
            &[("scripts/deep/helper.py", b"print('hi')\n")],
        );
        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        assert!(target_dir
            .join(".konductor/skills/with-scripts/scripts/deep/helper.py")
            .is_file());

        // Re-synth WITHOUT the nested file (drops the whole scripts/
        // subtree), then reinstall.
        fs::remove_dir_all(repo_root.join("dist")).ok();
        seed_synthed_skill(
            &repo_root,
            "with-scripts",
            b"---\nname: with-scripts\n---\nBody v2\n",
            &[],
        );
        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");

        // The stale file is gone AND the empty dirs it left are pruned.
        let skill_dir = target_dir.join(".konductor/skills/with-scripts");
        assert!(!skill_dir.join("scripts/deep/helper.py").exists());
        assert!(
            !skill_dir.join("scripts/deep").exists(),
            "empty scripts/deep/ must be pruned"
        );
        assert!(
            !skill_dir.join("scripts").exists(),
            "empty scripts/ must be pruned"
        );
        // The skill root and its refreshed SKILL.md remain.
        assert!(skill_dir.join("SKILL.md").is_file());
        assert!(skill_dir.is_dir());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // -- Skill resource rewrite (moving skills to .konductor/skills/). --

    /// Skills must land under `.konductor/skills/`, NOT `.kiro/skills/`
    /// -- the whole point of the move (Kiro's native discovery scans
    /// `.kiro/skills/` unconditionally, which defeats per-agent
    /// scoping).
    ///
    /// Falsifiability: confirmed this test fails (the `.kiro/skills/`
    /// assertion trips) if `install_skills`'s
    /// `KONDUCTOR_DESTINATION_ROOT` is swapped back for
    /// `KIRO_DESTINATION_ROOT`. Restored immediately after confirming
    /// the failure.
    #[test]
    fn install_from_local_installs_skills_under_konductor_not_kiro() {
        let target_dir = scratch_dir("skill-under-konductor-target");
        let repo_root = scratch_dir("skill-under-konductor-repo");
        seed_synthed_skill(
            &repo_root,
            "code-review",
            b"---\nname: code-review\n---\nBody\n",
            &[],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        assert!(target_dir
            .join(".konductor/skills/code-review/SKILL.md")
            .is_file());
        assert!(!target_dir.join(".kiro/skills").exists());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// An agent's `skill://skills/<name>/SKILL.md` resource entry is
    /// rewritten to an absolute
    /// `skill://<target_dir>/.konductor/skills/<name>/SKILL.md` path --
    /// raw, never percent-encoded.
    #[test]
    fn install_from_local_rewrites_skill_resource_to_absolute_konductor_path() {
        let target_dir = scratch_dir("skill-rewrite-target");
        let repo_root = scratch_dir("skill-rewrite-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        let expected = format!(
            "skill://{}",
            target_dir
                .join(".konductor/skills/constraints/SKILL.md")
                .display()
        );
        assert_eq!(value["resources"], serde_json::json!([expected]));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    #[test]
    fn install_from_local_skill_rewrite_is_idempotent_across_two_installs() {
        let target_dir = scratch_dir("skill-rewrite-idempotent-target");
        let repo_root = scratch_dir("skill-rewrite-idempotent-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let first_bytes = fs::read(&installed_agent).unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");
        let second_bytes = fs::read(&installed_agent).unwrap();

        assert_eq!(
            first_bytes, second_bytes,
            "installing twice must not duplicate or double-rewrite the resources array"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Regression guard mirroring the equivalent context-resource test:
    /// a target root containing a space and a non-ASCII character must
    /// still produce a raw, unencoded `skill://` path.
    #[test]
    fn install_from_local_rewritten_skill_path_never_percent_encoded() {
        let target_root = scratch_dir("skill-space-\u{e9}-target");
        let target_dir = target_root.join("dir with space and \u{e9}accent");
        fs::create_dir_all(&target_dir).unwrap();
        let repo_root = scratch_dir("skill-space-non-ascii-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed into a root with a space and non-ASCII character");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        let text = value["resources"][0].as_str().unwrap();
        assert!(text.contains(' '));
        assert!(text.contains('\u{e9}'));
        assert!(!text.contains("%20"), "got: {text}");
        assert!(
            !text.contains("%C3%A9") && !text.contains("%c3%a9"),
            "got: {text}"
        );

        fs::remove_dir_all(&target_root).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The `ws-*` workspace-skills glob (a hand-authored per-user
    /// convention, never rewritten by synth) must pass through the
    /// install rewrite untouched too -- it is not a
    /// `skill://skills/<name>/SKILL.md` shape.
    #[test]
    fn install_from_local_leaves_workspace_skill_glob_untouched() {
        let target_dir = scratch_dir("skill-glob-untouched-target");
        let repo_root = scratch_dir("skill-glob-untouched-repo");
        seed_synthed_agent(
            &repo_root,
            "k-example",
            br#"{"name":"k-example","resources":["skill://.kiro/skills/ws-*/SKILL.md"]}"#,
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        assert_eq!(
            value["resources"],
            serde_json::json!(["skill://.kiro/skills/ws-*/SKILL.md"])
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A synthed agent JSON declaring a `skill://skills/<name>/SKILL.md`
    /// resource with no corresponding directory under
    /// `dist/kiro-cli-v2/skills/` must fail the install loudly.
    #[test]
    fn install_from_local_fails_when_skill_target_is_missing() {
        let target_dir = scratch_dir("skill-missing-target-target");
        let repo_root = scratch_dir("skill-missing-target-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "missing-skill");
        // Deliberately no seed_synthed_skill call.

        let err = KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect_err("install must fail when a skill resource target is missing");
        assert!(err.contains("missing-skill"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Scoping proof at the install level: installing two agents, each
    /// declaring a DIFFERENT single skill, must leave each agent's
    /// `resources` referencing only its own declared skill -- never the
    /// other agent's.
    #[test]
    fn install_from_local_scopes_skill_resources_to_agents_own_declarations() {
        let target_dir = scratch_dir("skill-scoping-target");
        let repo_root = scratch_dir("skill-scoping-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "agent-a", "skill-a");
        seed_synthed_agent_with_skill_resource(&repo_root, "agent-b", "skill-b");
        seed_synthed_skill(
            &repo_root,
            "skill-a",
            b"---\nname: skill-a\n---\nBody\n",
            &[],
        );
        seed_synthed_skill(
            &repo_root,
            "skill-b",
            b"---\nname: skill-b\n---\nBody\n",
            &[],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let value_a: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_dir.join(".kiro/agents/agent-a.json")).unwrap(),
        )
        .unwrap();
        let value_b: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_dir.join(".kiro/agents/agent-b.json")).unwrap(),
        )
        .unwrap();
        let resource_a = value_a["resources"][0].as_str().unwrap();
        let resource_b = value_b["resources"][0].as_str().unwrap();
        assert!(resource_a.contains("skill-a"));
        assert!(!resource_a.contains("skill-b"));
        assert!(resource_b.contains("skill-b"));
        assert!(!resource_b.contains("skill-a"));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Manifest entries for skills must carry the `.konductor/skills/`
    /// prefix, with correct lowercase-hex hashes.
    #[test]
    fn install_from_local_records_skills_in_manifest_under_konductor_prefix() {
        let target_dir = scratch_dir("skill-manifest-prefix-target");
        let repo_root = scratch_dir("skill-manifest-prefix-repo");
        let skill_contents: &[u8] = b"---\nname: code-review\n---\nBody\n";
        seed_synthed_skill(&repo_root, "code-review", skill_contents, &[]);

        KiroCliInstallStrategy
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
        let entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".konductor/skills/code-review/SKILL.md")
            .expect("manifest must record the installed skill under .konductor/skills/");
        let sha256 = entry
            .sha256
            .as_deref()
            .expect("complete manifest entries must have a hash");
        assert_eq!(sha256, sha256_hex(skill_contents));
        assert_eq!(sha256, sha256.to_lowercase());
        assert_eq!(sha256.len(), 64);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The same `dist/` tree installed into two separate roots: each
    /// root's installed agent must carry its OWN correct absolute skill
    /// path.
    #[test]
    fn install_from_local_installs_same_dist_into_two_roots_independently_for_skills() {
        let repo_root = scratch_dir("skill-two-roots-repo");
        let target_a = scratch_dir("skill-two-roots-target-a");
        let target_b = scratch_dir("skill-two-roots-target-b");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_a,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        KiroCliInstallStrategy
            .install_from_local(
                &target_b,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");

        let value_a: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_a.join(".kiro/agents/k-example.json")).unwrap(),
        )
        .unwrap();
        let value_b: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_b.join(".kiro/agents/k-example.json")).unwrap(),
        )
        .unwrap();
        let expected_a = format!(
            "skill://{}",
            target_a
                .join(".konductor/skills/constraints/SKILL.md")
                .display()
        );
        let expected_b = format!(
            "skill://{}",
            target_b
                .join(".konductor/skills/constraints/SKILL.md")
                .display()
        );
        assert_eq!(value_a["resources"], serde_json::json!([expected_a]));
        assert_eq!(value_b["resources"], serde_json::json!([expected_b]));
        assert_ne!(value_a["resources"], value_b["resources"]);

        fs::remove_dir_all(&repo_root).ok();
        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
    }

    // ── Write-ahead manifest + provenance (Part A) ──────────────────────

    /// On success the FINAL manifest is marked `Status::Complete` and
    /// every entry has a correct 64-char lowercase-hex hash -- no entry
    /// is left `None`.
    #[test]
    fn install_from_local_final_manifest_is_complete_with_real_hashes() {
        let target_dir = scratch_dir("complete-status-target");
        let repo_root = scratch_dir("complete-status-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{\"name\":\"k-example\"}\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        assert_eq!(manifest.status, super::super::manifest::Status::Complete);
        assert!(!manifest.files.is_empty());
        for file in &manifest.files {
            let hash = file.sha256.as_deref().unwrap_or_else(|| {
                panic!("{} must have a hash once status is complete", file.path)
            });
            assert_eq!(hash.len(), 64, "{} hash must be 64 hex chars", file.path);
            assert_eq!(
                hash,
                hash.to_lowercase(),
                "{} hash must be lowercase",
                file.path
            );
        }

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Genuine crash-recovery proof: `install_from_local` writes its OWN
    /// `Status::InProgress` write-ahead manifest BEFORE copying any file,
    /// so a failure DURING the copy phase leaves that manifest on disk
    /// naming what may have landed -- orphans stay recoverable, not
    /// invisible. Driven through a REAL error path with no test-only seam
    /// inside `install_from_local`: the agent DESTINATION dir
    /// (`.kiro/agents/`) is pre-created and locked read-only (`0o555`)
    /// while `.konductor/` is left writable, so install's write-ahead
    /// manifest write succeeds but the subsequent agent-file copy into
    /// `.kiro/agents/` fails.
    ///
    /// Falsifiability: if `install_from_local`'s write-ahead write were
    /// removed (manifest written only at the end, on full success), the
    /// forced copy failure would leave NO manifest at all and the final
    /// `read_manifest(...).expect(...)` below would panic. The test wrote
    /// no manifest itself, so a pass proves install recorded the
    /// `InProgress` record up front.
    #[test]
    #[cfg(unix)]
    fn install_from_local_leaves_in_progress_manifest_naming_orphans_on_forced_failure() {
        use std::os::unix::fs::PermissionsExt;

        let target_dir = scratch_dir("forced-failure-target");
        let repo_root = scratch_dir("forced-failure-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{\"name\":\"k-example\"}\n");

        // Pre-create the agent DESTINATION dir and lock it read-only
        // (0o555) so the agent-file copy fails -- while leaving
        // `.konductor/` untouched and writable so install's OWN
        // write-ahead manifest write (which runs FIRST, before any copy)
        // still succeeds and lands on disk.
        let agents_dir = target_dir.join(".kiro/agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::set_permissions(&agents_dir, fs::Permissions::from_mode(0o555)).unwrap();

        let result = KiroCliInstallStrategy.install_from_local(
            &target_dir,
            Some(repo_root.to_str().unwrap()),
            "2026-01-01T00:00:00Z",
            false,
        );

        // Restore perms immediately so cleanup (remove_dir_all) can
        // delete the tree.
        fs::set_permissions(&agents_dir, fs::Permissions::from_mode(0o755)).unwrap();

        assert!(
            result.is_err(),
            "install must fail when the agent copy cannot write into a read-only .kiro/agents/"
        );

        // The manifest on disk is the one INSTALL wrote up front (its
        // write-ahead InProgress record) -- the test wrote none. It must
        // be InProgress and name the agent the copy was about to write.
        let on_disk = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("install's write-ahead manifest must remain after the forced copy failure");
        assert_eq!(
            on_disk.status,
            super::super::manifest::Status::InProgress,
            "a failure before the final Complete rewrite must leave the manifest in_progress, \
             not complete and not absent"
        );
        assert!(
            on_disk
                .files
                .iter()
                .any(|f| f.path == ".kiro/agents/k-example.json"),
            "the in_progress manifest must still name the file this install intended to write"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Provenance state 1 of 3: a fresh install into an empty target
    /// classifies every file `Created`.
    #[test]
    fn install_from_local_classifies_fresh_install_as_created() {
        let target_dir = scratch_dir("provenance-created-target");
        let repo_root = scratch_dir("provenance-created-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{}\n");

        KiroCliInstallStrategy
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
        let entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".kiro/agents/k-example.json")
            .unwrap();
        assert_eq!(entry.provenance, Provenance::Created);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Provenance state 2 of 3: re-installing over a file this same
    /// install strategy previously wrote (present in the PRIOR
    /// manifest) classifies it `ReplacedOurs`.
    #[test]
    fn install_from_local_classifies_reinstall_over_own_file_as_replaced_ours() {
        let target_dir = scratch_dir("provenance-ours-target");
        let repo_root = scratch_dir("provenance-ours-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{\"v\":1}\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");

        // Re-synth with different content, then reinstall over the
        // same target -- the prior manifest now names this exact path.
        fs::write(
            repo_root.join("dist/kiro-cli-v2/agents/k-example.json"),
            b"{\"v\":2}\n",
        )
        .unwrap();
        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        let entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".kiro/agents/k-example.json")
            .unwrap();
        assert_eq!(entry.provenance, Provenance::ReplacedOurs);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Provenance state 3 of 3: installing over a FOREIGN pre-existing
    /// file at the same destination path (never present in any prior
    /// Konductor manifest for this target) classifies it
    /// `ReplacedForeign` -- the state a future `uninstall` must never
    /// delete.
    #[test]
    fn install_from_local_classifies_foreign_preexisting_file_as_replaced_foreign() {
        let target_dir = scratch_dir("provenance-foreign-target");
        let repo_root = scratch_dir("provenance-foreign-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{}\n");

        // A foreign file already sits at the exact destination path
        // this install is about to write, with NO prior Konductor
        // manifest anywhere for this target.
        let agents_dir = target_dir.join(".kiro/agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(
            agents_dir.join("k-example.json"),
            b"{\"hand-authored\":true}\n",
        )
        .unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed despite the foreign pre-existing file");

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        let entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".kiro/agents/k-example.json")
            .unwrap();
        assert_eq!(entry.provenance, Provenance::ReplacedForeign);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Defect-2 regression: a FAILED re-install must not leave a
    /// manifest that hash-mismatches disk. Simulates the failure mode
    /// by re-installing with a source that will fail deep into the
    /// process (a missing skill target for a NEW agent added on the
    /// second run) after context/skills for a FIRST, unrelated agent
    /// have already been re-copied to disk with new bytes. Because
    /// `install_from_local` now writes the write-ahead manifest BEFORE
    /// any copy (naming the up-to-date destination paths for every
    /// planned file, including ones about to be overwritten) rather
    /// than only after a full success, the manifest on disk after the
    /// failed run is never the STALE previous-run manifest -- it always
    /// reflects the run that just (partially) executed.
    ///
    /// Falsifiability: confirmed this test fails under the pre-fix
    /// behavior (manifest written only once, at the very end, after all
    /// copying) -- there, a failed second run leaves the FIRST run's
    /// manifest completely untouched, so `stable-agent.json`'s recorded
    /// hash still matches its OLD (first-run) bytes while disk already
    /// holds the NEW (second-run) bytes for that same file, a real hash
    /// mismatch. Restored immediately after confirming the failure.
    #[test]
    fn install_from_local_failed_reinstall_does_not_leave_hash_mismatching_manifest() {
        let target_dir = scratch_dir("failed-reinstall-target");
        let repo_root = scratch_dir("failed-reinstall-repo");
        seed_synthed_agent(&repo_root, "stable-agent", b"{\"v\":1}\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");

        // Second run: `stable-agent`'s content changes (so its on-disk
        // bytes will differ from what any stale manifest would record),
        // and a SECOND agent is added that declares a skill resource
        // with no corresponding skill directory -- guaranteed to fail
        // deep into `install_agents`, AFTER `stable-agent.json` (listed
        // first, alphabetically) has already been recopied with its new
        // bytes.
        fs::write(
            repo_root.join("dist/kiro-cli-v2/agents/stable-agent.json"),
            b"{\"v\":2}\n",
        )
        .unwrap();
        seed_synthed_agent_with_skill_resource(&repo_root, "zzz-broken-agent", "missing-skill");

        let result = KiroCliInstallStrategy.install_from_local(
            &target_dir,
            Some(repo_root.to_str().unwrap()),
            "2026-01-01T00:00:00Z",
            false,
        );
        assert!(result.is_err(), "second install must fail");

        // `stable-agent.json` on disk now holds the SECOND run's bytes
        // (copied before the failure further down in `install_agents`).
        let on_disk_bytes = fs::read(target_dir.join(".kiro/agents/stable-agent.json")).unwrap();
        assert_eq!(on_disk_bytes, b"{\"v\":2}\n");

        // The manifest on disk must NOT be the stale first-run manifest
        // (which would record `stable-agent.json`'s OLD hash, mismatching
        // the NEW bytes now on disk) -- it must be the write-ahead record
        // from this second, failed run, which is `InProgress` and whose
        // entries carry no hash at all yet (so there is nothing to
        // mismatch).
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("a manifest must exist after the failed second install");
        assert_eq!(
            manifest.status,
            super::super::manifest::Status::InProgress,
            "the failed second run's write-ahead manifest, not the stale first run's, must be on disk"
        );
        let stable_entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".kiro/agents/stable-agent.json")
            .expect("the write-ahead manifest must still name stable-agent.json");
        assert_eq!(
            stable_entry.sha256, None,
            "an in_progress entry must carry no hash, so it can never mismatch disk"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── MCP server binary install (skill-lookup-mcp) ────────────────────

    /// A built `skill-lookup-mcp` binary is copied into
    /// `.konductor/bin/skill-lookup-mcp`, preserving executability, and
    /// recorded in the manifest with a correct hash and `.konductor/bin/`
    /// prefix.
    #[test]
    fn install_from_local_copies_mcp_binary_and_records_manifest_entry() {
        let target_dir = scratch_dir("mcp-bin-target");
        let repo_root = scratch_dir("mcp-bin-repo");
        let contents = b"fake-elf-binary-contents";
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", contents);

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed with only a built MCP binary present");

        let installed = target_dir.join(".konductor/bin/skill-lookup-mcp");
        assert!(installed.is_file());
        assert_eq!(fs::read(&installed).unwrap(), contents);
        // `is_executable` unconditionally returns `Ok(false)` on
        // non-Unix targets (no equivalent permission bit -- see its own
        // #[cfg(not(unix))] variant), so this assertion is gated to
        // Unix only; the copy/manifest coverage above still runs
        // cross-platform.
        #[cfg(unix)]
        assert!(
            is_executable(&installed).unwrap(),
            "installed MCP binary must be executable regardless of source bit"
        );

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        let entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".konductor/bin/skill-lookup-mcp")
            .expect("manifest must record the installed MCP binary");
        assert_eq!(entry.sha256.as_deref(), Some(sha256_hex(contents).as_str()));
        assert_eq!(entry.provenance, Provenance::Created);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A repo with agents/skills/context but NO built MCP binary must
    /// still install successfully -- an unbuilt binary is not an error,
    /// exactly like the feature's design intent (the binary is a
    /// separate, optional build step, not a synth output).
    #[test]
    fn install_from_local_succeeds_without_mcp_binary_present() {
        let target_dir = scratch_dir("mcp-bin-absent-target");
        let repo_root = scratch_dir("mcp-bin-absent-repo");
        seed_synthed_agent(&repo_root, "k-example", b"{}\n");
        // Deliberately no seed_mcp_binary call.

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed without a built MCP binary");

        assert!(!target_dir.join(".konductor/bin").exists());
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        assert!(manifest
            .files
            .iter()
            .all(|f| !f.path.starts_with(".konductor/bin/")));

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A repo with ONLY a built MCP binary (no agents, no skills, no
    /// context) must still install successfully -- the binary alone is
    /// enough to make the plan non-empty.
    #[test]
    fn install_from_local_succeeds_with_only_mcp_binary_present() {
        let target_dir = scratch_dir("mcp-bin-only-target");
        let repo_root = scratch_dir("mcp-bin-only-repo");
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed with only the MCP binary present");

        assert!(target_dir.join(".konductor/bin/skill-lookup-mcp").is_file());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Reinstalling over a previously-installed MCP binary this same
    /// strategy wrote is classified `ReplacedOurs`, matching the
    /// existing agent/skill provenance tests.
    #[test]
    fn install_from_local_classifies_mcp_binary_reinstall_as_replaced_ours() {
        let target_dir = scratch_dir("mcp-bin-ours-target");
        let repo_root = scratch_dir("mcp-bin-ours-repo");
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"v1");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");

        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"v2");
        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");

        assert_eq!(
            fs::read(target_dir.join(".konductor/bin/skill-lookup-mcp")).unwrap(),
            b"v2"
        );
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        let entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".konductor/bin/skill-lookup-mcp")
            .unwrap();
        assert_eq!(entry.provenance, Provenance::ReplacedOurs);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// A foreign pre-existing file at the MCP binary's destination path
    /// (never recorded by a prior Konductor manifest) is classified
    /// `ReplacedForeign` -- the state `uninstall` must never delete --
    /// matching the equivalent agent-file provenance test.
    #[test]
    fn install_from_local_classifies_foreign_preexisting_mcp_binary_as_replaced_foreign() {
        let target_dir = scratch_dir("mcp-bin-foreign-target");
        let repo_root = scratch_dir("mcp-bin-foreign-repo");
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"synthed");

        let bin_dir = target_dir.join(".konductor/bin");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("skill-lookup-mcp"), b"hand-installed").unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed despite the foreign pre-existing binary");

        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .unwrap();
        let entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".konductor/bin/skill-lookup-mcp")
            .unwrap();
        assert_eq!(entry.provenance, Provenance::ReplacedForeign);

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `would_fail_as_noop` must NOT report a no-op failure when the
    /// only installable content is a built MCP binary -- it must stay
    /// consistent with `install_from_local`'s own success in that same
    /// scenario (`install_from_local_succeeds_with_only_mcp_binary_present`
    /// above).
    #[test]
    fn would_fail_as_noop_returns_none_when_only_mcp_binary_present() {
        let target_dir = scratch_dir("mcp-bin-noop-check-target");
        let repo_root = scratch_dir("mcp-bin-noop-check-repo");
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        let result = KiroCliInstallStrategy
            .would_fail_as_noop(&target_dir, Some(repo_root.to_str().unwrap()));
        assert!(
            result.is_none(),
            "would_fail_as_noop must agree with install_from_local: a built MCP binary alone \
             is real installable content, not a no-op, got: {result:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// `would_fail_as_noop` must NOT report a no-op failure when the
    /// only installable content is the additive Claude SOP-skill
    /// conversion on a dual-marker target: empty `dist/kiro-cli-v2/`, no
    /// built binary, a populated `dist/claude/sops/`, and a pre-existing
    /// `.claude` marker at the target. `plan_additive_claude_sop_skill_files`
    /// is gated only on that marker, independent of `plan`/`bin_plan`, so
    /// omitting it would return the "run `konductor synth` first" message
    /// for a target `install_from_local` actually installs into -- exit
    /// `EXIT_USAGE_ERROR` for work that would have succeeded.
    #[test]
    fn would_fail_as_noop_returns_none_when_only_additive_claude_sop_skill_content_present() {
        let target_dir = scratch_dir("claude-sop-noop-check-target");
        let repo_root = scratch_dir("claude-sop-noop-check-repo");
        fs::create_dir_all(target_dir.join(".claude")).unwrap();

        let claude_sops_dir = repo_root
            .join("dist")
            .join(super::super::claude::CLAUDE_HARNESS_DIR)
            .join("sops");
        fs::create_dir_all(&claude_sops_dir).unwrap();
        fs::write(
            claude_sops_dir.join("ticket-sync.sop.md"),
            b"## Overview\n\nSyncs a ticket.\n",
        )
        .unwrap();

        let result = KiroCliInstallStrategy
            .would_fail_as_noop(&target_dir, Some(repo_root.to_str().unwrap()));
        assert!(
            result.is_none(),
            "would_fail_as_noop must agree with install_from_local: an additive Claude \
             SOP-skill conversion alone is real installable content, not a no-op, got: {result:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── Install-time mcpServers injection (rewrite_mcp_servers) ──────────

    /// The core acceptance test: an agent declaring a `skill://skills/...`
    /// resource, installed alongside a built `skill-lookup-mcp` binary,
    /// gets an injected `mcpServers.konductor-skills.command` pointing at
    /// the ABSOLUTE path of the just-installed binary -- never a bare
    /// name, never a relative path.
    #[test]
    fn install_from_local_injects_absolute_mcp_server_path_for_skill_bearing_agent() {
        let target_dir = scratch_dir("mcp-inject-target");
        let repo_root = scratch_dir("mcp-inject-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        let expected_command = target_dir
            .join(".konductor/bin/skill-lookup-mcp")
            .display()
            .to_string();
        assert_eq!(
            value["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_command)
        );
        assert!(Path::new(&expected_command).is_absolute());
        assert!(Path::new(&expected_command).is_file());

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Reachability proof for the Claude/V3 `permissions.allow` grant
    /// (`resource_rewrite.rs`'s `McpServerPass::verify`): there is no
    /// separate Claude `InstallStrategy` yet (`registry::STRATEGIES`
    /// registers only `KiroCliInstallStrategy`), but that grant does
    /// not depend on one existing -- it fires through THIS unmodified
    /// strategy's own `install_from_local` whenever the target directory
    /// already has a `.claude` marker dir alongside `.kiro`, which is
    /// exactly the real "I use both Kiro CLI and Claude Code in this
    /// repo" scenario (this very package's own dev workspace is one).
    /// `KiroCliInstallStrategy::matches` still claims such a target
    /// because it only ever special-cases a Claude-ONLY target (see its
    /// own doc comment above); it does not care whether `.claude` is
    /// ALSO present alongside `.kiro`.
    #[test]
    fn install_from_local_grants_claude_settings_permissions_when_claude_marker_dir_present() {
        let target_dir = scratch_dir("mcp-inject-claude-target");
        // The dual-runtime scenario this proves reachable: `.kiro`
        // AND `.claude` already exist at the target BEFORE this run
        // (a reinstall/update over a prior konductor install, on a
        // target that also already has Claude Code set up) -- not
        // hypothetical, this package's own workspace is set up exactly
        // this way. `.kiro` must ALREADY exist here: `matches()` runs
        // before this install creates anything, so a target with
        // `.claude` alone (no pre-existing `.kiro`) is rejected outright
        // -- see the negative-case test below.
        fs::create_dir_all(target_dir.join(".kiro")).unwrap();
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        let repo_root = scratch_dir("mcp-inject-claude-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        assert!(
            KiroCliInstallStrategy.matches(&target_dir),
            "a target with .claude already present must still be claimed by \
             KiroCliInstallStrategy -- it only special-cases a Claude-ONLY target"
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        // The V2 Kiro grant lands additively, alongside the V3 one below.
        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        assert!(value["mcpServers"]["konductor-skills"]["command"].is_string());

        // The V3/Claude grant also exists, written through the real,
        // unmodified `KiroCliInstallStrategy::install_from_local` entry
        // point -- proving this is reachable today, not dead code
        // waiting on a future Claude InstallStrategy.
        let claude_settings: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_dir.join(".claude/settings.json")).expect(
                ".claude/settings.json must be written by this same install run when a \
                 .claude marker dir is already present at the target",
            ),
        )
        .unwrap();
        assert_eq!(
            claude_settings["permissions"]["allow"],
            serde_json::json!([
                "mcp__konductor-skills__find_skills",
                "mcp__konductor-skills__get_skill",
                "mcp__konductor-skills__reload_skills"
            ])
        );

        // The telemetry hook wiring lands
        // in the SAME write, gated on the grant above having just
        // succeeded (`phases.rs`'s `AgentInstallPhase::run`) -- asserts
        // the real hook entries, not just that SOME hooks key exists.
        // The command embeds the resolved absolute path to the
        // currently-running binary (`resource_rewrite.rs`'s
        // `resolve_konductor_exe_path`), not the bare word "konductor",
        // so this is computed the same way, not hand-typed.
        let exe = std::env::current_exe().unwrap().display().to_string();
        assert_eq!(
            claude_settings["hooks"]["SessionStart"],
            serde_json::json!([{
                "matcher": "startup|clear",
                "hooks": [{"type": "command", "command": format!("{exe} __telemetry-hook agent-invocation")}]
            }]),
            "SessionStart must invoke the hidden __telemetry-hook subcommand for agent_invocation"
        );
        assert_eq!(
            claude_settings["hooks"]["SubagentStart"],
            serde_json::json!([{
                "matcher": ".*",
                "hooks": [{"type": "command", "command": format!("{exe} __telemetry-hook subagent-invocation")}]
            }]),
            "SubagentStart must invoke the hidden __telemetry-hook subcommand for subagent_invocation"
        );
        assert!(
            Path::new(&exe).is_absolute(),
            "the wired hook command must carry an absolute path, not a bare binary name that \
             depends on $PATH at hook-fire time: {exe:?}"
        );

        // The write is also tracked in the final manifest, so it is
        // visible to `konductor doctor`/`update` and accounted for if
        // the install had failed partway through.
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        let claude_entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".claude/settings.json")
            .expect(".claude/settings.json must be recorded in the final manifest");
        assert_eq!(
            claude_entry.sha256,
            Some(sha256_hex(
                &fs::read(target_dir.join(".claude/settings.json")).unwrap()
            )),
            "the recorded hash must match the actual written content"
        );
        assert_eq!(
            claude_entry.provenance,
            super::super::manifest::Provenance::Created,
            "a settings.json that didn't exist before this run must be classified Created"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The `--no-telemetry` regression the CRITICAL fix above addresses:
    /// a real dual-marker install (`.kiro` AND `.claude` both already
    /// present, same fixture setup as
    /// `install_from_local_grants_claude_settings_permissions_when_claude_marker_dir_present`
    /// above) run end to end through the real, unmodified
    /// `KiroCliInstallStrategy::install_from_local` -- not a mock, not a
    /// direct call to `apply_claude_settings_hooks` -- with
    /// `no_telemetry: true`. The V2 Kiro `mcpServers` injection and the
    /// V3/Claude `permissions.allow` grant must still land (neither is a
    /// telemetry side effect), but `.claude/settings.json` must carry NO
    /// `hooks.SessionStart`/`hooks.SubagentStart` telemetry-hook block at
    /// all -- proving the opt-out actually reaches
    /// `AgentInstallPhase::run`'s `apply_claude_settings_hooks` call, not
    /// only the top-level `report_package_installed`/`report_cli_error`
    /// calls `dispatch_install_with` already gated on this same flag.
    #[test]
    fn install_from_local_no_telemetry_skips_claude_hook_wiring_but_keeps_permission_grant() {
        let target_dir = scratch_dir("no-telemetry-skips-hooks-target");
        fs::create_dir_all(target_dir.join(".kiro")).unwrap();
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        let repo_root = scratch_dir("no-telemetry-skips-hooks-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                true,
            )
            .expect("install must succeed with --no-telemetry");

        // The V2 Kiro grant is unaffected -- not a telemetry side
        // effect.
        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        assert!(value["mcpServers"]["konductor-skills"]["command"].is_string());

        let claude_settings: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_dir.join(".claude/settings.json")).expect(
                ".claude/settings.json must still be written for the permission grant even \
                 with --no-telemetry -- only the hook wiring is a telemetry side effect",
            ),
        )
        .unwrap();
        // The V3/Claude permission grant is unaffected either -- also
        // not a telemetry side effect.
        assert_eq!(
            claude_settings["permissions"]["allow"],
            serde_json::json!([
                "mcp__konductor-skills__find_skills",
                "mcp__konductor-skills__get_skill",
                "mcp__konductor-skills__reload_skills"
            ]),
            "--no-telemetry must not affect the unrelated MCP permission grant"
        );

        // The telemetry hook wiring itself must be completely absent --
        // not an empty array, not a key with no entries: no `hooks` key
        // at all, since this is a fresh target with nothing else that
        // would have written one.
        assert!(
            claude_settings.get("hooks").is_none(),
            "--no-telemetry must suppress the SessionStart/SubagentStart telemetry-hook \
             wiring entirely; got: {claude_settings:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The reachability boundary the test above depends on: a target
    /// with `.claude` present but NO pre-existing `.kiro` is a
    /// Claude-ONLY target by `detect_runtimes`'s reckoning (this run
    /// would be the one to CREATE `.kiro`, and `matches()` is evaluated
    /// before any of that happens) -- `KiroCliInstallStrategy::matches`
    /// rejects it outright (see its own doc comment), so with today's
    /// registry (`KiroCliInstallStrategy` is the only entry) NO strategy
    /// claims it and install fails before `McpServerPass` ever runs.
    /// This is the real, narrower-than-it-first-looks scope of the
    /// Claude/V3 grant added above: it fires on a target where `.kiro`
    /// ALREADY exists (a reinstall/update, or `.kiro` created by hand)
    /// alongside `.claude`, not on a brand-new "first install ever, this
    /// target only has Claude Code" target -- that case has no install
    /// path at all yet, Claude grant or otherwise, pending a real Claude
    /// `InstallStrategy` (the same "task 3.8" gap `matches`'s doc
    /// comment already names).
    #[test]
    fn install_from_local_rejects_claude_only_target_with_no_preexisting_kiro_dir() {
        let target_dir = scratch_dir("mcp-inject-claude-only-target");
        fs::create_dir_all(target_dir.join(".claude")).unwrap();
        // Deliberately no `.kiro` dir created beforehand.

        assert!(
            !KiroCliInstallStrategy.matches(&target_dir),
            "a Claude-only target (no pre-existing .kiro) must NOT be claimed by \
             KiroCliInstallStrategy -- with no other registered strategy, this target has no \
             install path at all today"
        );
        assert!(
            !target_dir.join(".claude/settings.json").exists(),
            "nothing must be written for a target no strategy claims"
        );

        fs::remove_dir_all(&target_dir).ok();
    }

    /// A foreign-content problem in `.claude/settings.json` (here: a
    /// pre-existing `permissions.deny` that shadows this server's own
    /// grant, a condition entirely under the USER's control, not a
    /// defect in what this install is writing) must never abort the
    /// Kiro side of the install -- that content already landed on disk
    /// before the Claude grant is even attempted, and aborting the
    /// whole run over an unrelated foreign file would throw it away for
    /// no benefit. The grant is skipped (with a warning), the rest of
    /// the install completes normally, and the untouched foreign file
    /// is never recorded in the manifest.
    #[test]
    fn install_from_local_does_not_abort_when_claude_grant_fails_on_foreign_content() {
        let target_dir = scratch_dir("mcp-inject-claude-foreign-fail-target");
        fs::create_dir_all(target_dir.join(".kiro")).unwrap();
        let claude_dir = target_dir.join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let original_settings =
            serde_json::json!({"permissions": {"deny": ["mcp__konductor-skills__*"]}}).to_string();
        fs::write(claude_dir.join("settings.json"), &original_settings).unwrap();

        let repo_root = scratch_dir("mcp-inject-claude-foreign-fail-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("the Kiro install must succeed despite the Claude grant failing");

        // The Kiro side landed exactly as normal.
        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        assert!(value["mcpServers"]["konductor-skills"]["command"].is_string());

        // The foreign settings.json is completely untouched.
        assert_eq!(
            fs::read_to_string(claude_dir.join("settings.json")).unwrap(),
            original_settings,
            "a deny-shadowed grant must never modify the foreign file it failed against"
        );

        // No manifest entry for a file this run never actually wrote.
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        assert!(
            !manifest
                .files
                .iter()
                .any(|f| f.path == ".claude/settings.json"),
            "a skipped grant must not leave a manifest entry behind"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The negative case: with no built MCP binary present, an agent
    /// declaring a skill resource installs successfully but gets NO
    /// `mcpServers` entry injected at all -- there is nothing on disk
    /// yet to point at.
    #[test]
    fn install_from_local_injects_no_mcp_server_when_binary_absent() {
        let target_dir = scratch_dir("mcp-inject-no-binary-target");
        let repo_root = scratch_dir("mcp-inject-no-binary-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );
        // Deliberately no seed_mcp_binary call.

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed without a built MCP binary");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        assert!(
            value.get("mcpServers").is_none()
                || value["mcpServers"].as_object().unwrap().is_empty(),
            "no mcpServers entry must be injected when the binary was never built/copied, got: {value:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Scoping proof: an agent with NO `skill://skills/...` resource
    /// (e.g. one that only declares a `contextNames`/`file://context/`
    /// resource) must get no `mcpServers` injection even when the MCP
    /// binary IS present -- injection is scoped to skill-bearing agents
    /// only, per this feature's design (an agent with no packaged
    /// skills has nothing for find_skills/get_skill to look up).
    #[test]
    fn install_from_local_does_not_inject_mcp_server_for_agent_without_skill_resources() {
        let target_dir = scratch_dir("mcp-inject-no-skill-target");
        let repo_root = scratch_dir("mcp-inject-no-skill-repo");
        seed_synthed_agent_with_context_resource(&repo_root, "k-example", "routing-rules.md");
        seed_synthed_context(&repo_root, "routing-rules.md", b"# Routing rules\n");
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        assert!(
            value.get("mcpServers").is_none()
                || value["mcpServers"].as_object().unwrap().is_empty(),
            "an agent with no skill:// resource must get no mcpServers injection, got: {value:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Installing twice must not duplicate or corrupt the injected
    /// `mcpServers` block -- the second install's re-read-from-`dist/`
    /// + re-inject must produce byte-identical output to the first.
    #[test]
    fn install_from_local_mcp_server_injection_is_idempotent_across_two_installs() {
        let target_dir = scratch_dir("mcp-inject-idempotent-target");
        let repo_root = scratch_dir("mcp-inject-idempotent-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let first_bytes = fs::read(&installed_agent).unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");
        let second_bytes = fs::read(&installed_agent).unwrap();

        assert_eq!(
            first_bytes, second_bytes,
            "installing twice must not duplicate or corrupt the injected mcpServers block"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Covers the present -> absent MCP binary transition. Install once
    /// with the binary present (a `mcpServers.konductor-skills` entry is
    /// injected, and the binary is copied to
    /// `.konductor/bin/skill-lookup-mcp`), then remove the binary from
    /// the SOURCE (`mcp/target/release/skill-lookup-mcp`) and install
    /// again. The stale copy this install previously wrote to
    /// `.konductor/bin/skill-lookup-mcp` deliberately stays on disk --
    /// `install_bin_files` never deletes a no-longer-sourced binary --
    /// so this test specifically proves the `mcpServers` entry is
    /// dropped on the rerun anyway, rather than being left dangling and
    /// pointing at that now-orphaned file.
    #[test]
    fn install_from_local_removes_stale_mcp_server_entry_when_binary_becomes_absent() {
        let target_dir = scratch_dir("mcp-inject-becomes-absent-target");
        let repo_root = scratch_dir("mcp-inject-becomes-absent-repo");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install (binary present) must succeed");

        let installed_agent = target_dir.join(".kiro/agents/k-example.json");
        let installed_binary = target_dir.join(".konductor/bin/skill-lookup-mcp");
        assert!(
            installed_binary.is_file(),
            "sanity check: the first install must have copied the binary"
        );
        let first: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        assert!(
            first
                .get("mcpServers")
                .and_then(|m| m.get("konductor-skills"))
                .is_some(),
            "sanity check: the first install (binary present) must have injected \
             mcpServers.konductor-skills"
        );

        fs::remove_file(repo_root.join("mcp/target/release/skill-lookup-mcp")).unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:01:00Z",
                false,
            )
            .expect("second install (binary absent) must succeed");

        assert!(
            installed_binary.is_file(),
            "sanity check: the stale binary copy from the first install must still be on \
             disk -- install_bin_files never deletes a no-longer-sourced binary"
        );
        let second: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&installed_agent).unwrap()).unwrap();
        assert!(
            second.get("mcpServers").is_none()
                || second["mcpServers"].as_object().unwrap().is_empty(),
            "a binary that becomes absent on a later install must leave no dangling \
             mcpServers.konductor-skills entry, got: {second:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Two separate roots installed from the same `dist/`/binary source
    /// must each carry their OWN absolute `mcpServers.konductor-skills.command`
    /// path -- never the other root's, and never a shared/global value.
    #[test]
    fn install_from_local_mcp_server_injection_is_independent_across_two_roots() {
        let repo_root = scratch_dir("mcp-inject-two-roots-repo");
        let target_a = scratch_dir("mcp-inject-two-roots-target-a");
        let target_b = scratch_dir("mcp-inject-two-roots-target-b");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(
            &repo_root,
            "constraints",
            b"---\nname: constraints\n---\nBody\n",
            &[],
        );
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"binary bytes\n");

        KiroCliInstallStrategy
            .install_from_local(
                &target_a,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("first install must succeed");
        KiroCliInstallStrategy
            .install_from_local(
                &target_b,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("second install must succeed");

        let value_a: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_a.join(".kiro/agents/k-example.json")).unwrap(),
        )
        .unwrap();
        let value_b: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(target_b.join(".kiro/agents/k-example.json")).unwrap(),
        )
        .unwrap();
        let expected_a = target_a
            .join(".konductor/bin/skill-lookup-mcp")
            .display()
            .to_string();
        let expected_b = target_b
            .join(".konductor/bin/skill-lookup-mcp")
            .display()
            .to_string();
        assert_eq!(
            value_a["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_a)
        );
        assert_eq!(
            value_b["mcpServers"]["konductor-skills"]["command"],
            serde_json::json!(expected_b)
        );
        assert_ne!(
            value_a["mcpServers"]["konductor-skills"]["command"],
            value_b["mcpServers"]["konductor-skills"]["command"],
        );

        fs::remove_dir_all(&repo_root).ok();
        fs::remove_dir_all(&target_a).ok();
        fs::remove_dir_all(&target_b).ok();
    }

    // ── _sop_scopes.json sidecar -> --agent-sop-paths/--agent-sop-filter ──

    /// Seeds `<repo_root>/dist/kiro-cli-v2/agents/_sop_scopes.json` with
    /// the given agent-name -> SOP-names map, mirroring
    /// `kiro_cli_v2::write_sop_scopes_sidecar`'s real output shape.
    fn seed_synthed_sop_scopes(repo_root: &Path, scopes: &[(&str, &[&str])]) {
        let dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&dir).unwrap();
        let map: std::collections::BTreeMap<&str, &[&str]> =
            scopes.iter().map(|(name, names)| (*name, *names)).collect();
        fs::write(
            dir.join(SOP_SCOPES_SIDECAR_FILE),
            serde_json::to_string_pretty(&map).unwrap(),
        )
        .unwrap();
    }

    /// Seeds `<repo_root>/dist/kiro-cli-v2/sops/<name>.sop.md` with
    /// `body`, mirroring real synth output layout.
    fn seed_synthed_sop(repo_root: &Path, name: &str, body: &[u8]) {
        let dir = repo_root.join("dist").join("kiro-cli-v2").join("sops");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.sop.md")), body).unwrap();
    }

    #[test]
    fn read_sop_scopes_sidecar_returns_empty_map_when_missing() {
        let dir = scratch_dir("sop-scopes-missing");
        let map = read_sop_scopes_sidecar(&dir).expect("a missing sidecar must not error");
        assert!(map.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_sop_scopes_sidecar_parses_present_file() {
        let dir = scratch_dir("sop-scopes-present");
        fs::write(
            dir.join(SOP_SCOPES_SIDECAR_FILE),
            r#"{"k-example": ["ticket-sync", "code-review"]}"#,
        )
        .unwrap();
        let map = read_sop_scopes_sidecar(&dir).expect("a well-formed sidecar must parse");
        assert_eq!(
            map.get("k-example"),
            Some(&vec!["ticket-sync".to_string(), "code-review".to_string()])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_sop_scopes_sidecar_errors_on_malformed_json() {
        let dir = scratch_dir("sop-scopes-malformed");
        fs::write(dir.join(SOP_SCOPES_SIDECAR_FILE), "not json").unwrap();
        let err = read_sop_scopes_sidecar(&dir)
            .expect_err("a present but malformed sidecar must be a hard error");
        assert!(err.contains(SOP_SCOPES_SIDECAR_FILE));
        fs::remove_dir_all(&dir).ok();
    }

    /// The sidecar lives in the same directory `list_agent_files` scans
    /// (`dist/kiro-cli-v2/agents/`) but is not itself an agent file -- it
    /// must never be copied to `.kiro/agents/` or parsed/rewritten as one.
    #[test]
    fn list_agent_files_excludes_sop_scopes_sidecar() {
        let dir = scratch_dir("list-agent-files-excludes-sop-sidecar");
        fs::write(dir.join("real.json"), b"{}\n").unwrap();
        fs::write(dir.join(SOP_SCOPES_SIDECAR_FILE), b"{}\n").unwrap();

        let names = list_agent_files(&dir).expect("listing must succeed");
        assert_eq!(names, vec!["real.json".to_string()]);

        fs::remove_dir_all(&dir).ok();
    }

    /// End-to-end: when the sidecar declares a non-empty SOP list for an
    /// agent, the installed agent JSON's `mcpServers.konductor-skills.
    /// args` gains a trailing `--agent-sop-paths <dir1> --agent-sop-paths
    /// <dir2> --agent-sop-filter <names>` sequence.
    #[test]
    fn install_from_local_injects_agent_sop_args_when_sidecar_declares_names() {
        let target_dir = scratch_dir("sop-filter-target");
        let repo_root = scratch_dir("sop-filter-repo-root");
        seed_synthed_agent(&repo_root, "k-example", br#"{"name":"k-example"}"#);
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"fake binary");
        seed_synthed_sop_scopes(
            &repo_root,
            &[("k-example", &["ticket-sync", "code-review"])],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let agent_path = target_dir.join(".kiro/agents/k-example.json");
        let installed: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        let args = installed["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        let args: Vec<&str> = args.iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(
            args.last().copied(),
            Some("ticket-sync,code-review"),
            "expected the --agent-sop-filter value as the last arg, got: {args:?}"
        );
        assert_eq!(
            args[args.len() - 2],
            "--agent-sop-filter",
            "expected --agent-sop-filter immediately before its value, got: {args:?}"
        );
        assert!(
            args.iter().filter(|a| **a == "--agent-sop-paths").count() == 2,
            "expected --agent-sop-paths to appear twice (user-level, project-local), got: {args:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Backward compatibility: a `dist/` tree with NO SOP-scopes sidecar
    /// at all installs with exactly the pre-existing args -- no
    /// `--agent-sop-paths`/`--agent-sop-filter` anywhere.
    #[test]
    fn install_from_local_omits_agent_sop_args_when_sidecar_absent() {
        let target_dir = scratch_dir("sop-filter-absent-target");
        let repo_root = scratch_dir("sop-filter-absent-repo-root");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(&repo_root, "constraints", b"body", &[]);
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"fake binary");
        // Deliberately no seed_synthed_sop_scopes call.

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed with no SOP-scopes sidecar present at all");

        let agent_path = target_dir.join(".kiro/agents/k-example.json");
        let installed: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        let args = installed["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        assert!(
            !args.iter().any(|v| v.as_str() == Some("--agent-sop-paths")),
            "no --agent-sop-paths must appear when the sidecar is entirely absent, got: {args:?}"
        );
        assert!(
            !args
                .iter()
                .any(|v| v.as_str() == Some("--agent-sop-filter")),
            "no --agent-sop-filter must appear when the sidecar is entirely absent, got: {args:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// End-to-end: `install_sops` copies every staged `.sop.md` file
    /// verbatim into `.konductor/sops/`, regardless of per-agent scoping
    /// (which happens at MCP launch-arg time, not at file-copy time --
    /// see `install_sops`'s own doc comment).
    #[test]
    fn install_from_local_copies_multiple_staged_sops_unconditionally() {
        let target_dir = scratch_dir("sops-multi-target");
        let repo_root = scratch_dir("sops-multi-repo-root");
        seed_synthed_agent(&repo_root, "k-example", br#"{"name":"k-example"}"#);
        seed_synthed_sop(&repo_root, "ticket-sync", b"# Ticket Sync\n");
        seed_synthed_sop(&repo_root, "code-review", b"# Code Review\n");
        // No sidecar at all -- install_sops must still copy both files;
        // per-agent scoping is orthogonal to the raw file copy.

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        assert_eq!(
            fs::read(target_dir.join(".konductor/sops/ticket-sync.sop.md")).unwrap(),
            b"# Ticket Sync\n"
        );
        assert_eq!(
            fs::read(target_dir.join(".konductor/sops/code-review.sop.md")).unwrap(),
            b"# Code Review\n"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// End-to-end regression test: a real run of
    /// `KiroCliInstallStrategy::install_from_local`
    /// against a target with BOTH `.kiro` and `.claude` markers
    /// pre-existing (a genuine dual-runtime reinstall target) must
    /// succeed, exercising the full write-ahead-plan -> phases ->
    /// `attach_provenance` pipeline rather than calling
    /// `SopInstallPhase::run` directly (which never touches `plan` or
    /// `attach_provenance`, and so could not have caught this). Before
    /// `plan_additive_claude_sop_skill_files` was wired into this
    /// strategy's own plan (see `install_from_local`'s own comment at the
    /// call site), this exact scenario failed with
    /// "internal error: .claude/skills/sop-ticket-sync/SKILL.md was
    /// copied but not present in the write-ahead plan" the first time
    /// the dual-marker branch produced a file.
    #[test]
    fn install_from_local_dual_marker_target_converts_claude_sop_skill_without_provenance_error() {
        let target_dir = scratch_dir("sop-dual-marker-e2e-target");
        let repo_root = scratch_dir("sop-dual-marker-e2e-repo");
        fs::create_dir_all(target_dir.join(".kiro")).unwrap();
        fs::create_dir_all(target_dir.join(".claude")).unwrap();

        seed_synthed_agent(&repo_root, "k-example", br#"{"name":"k-example"}"#);
        seed_synthed_sop_scopes(&repo_root, &[("k-example", &["ticket-sync"])]);
        // Kiro's own staged copy -- installed verbatim into
        // `.konductor/sops/` by the Kiro branch, unconditionally.
        seed_synthed_sop(&repo_root, "ticket-sync", b"# Ticket Sync\n\nKiro copy.\n");
        // Claude's staged copy, under `dist/claude/sops/` -- the source
        // the additive branch reads from `repo_root`, never from
        // `staged_root` (which is Kiro's harness dir for this run).
        let claude_sops_dir = repo_root
            .join("dist")
            .join(super::super::claude::CLAUDE_HARNESS_DIR)
            .join("sops");
        fs::create_dir_all(&claude_sops_dir).unwrap();
        fs::write(
            claude_sops_dir.join("ticket-sync.sop.md"),
            b"## Overview\n\nSyncs a ticket.\n",
        )
        .unwrap();

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect(
                "install must succeed end-to-end on a dual-marker target -- \
                 attach_provenance must not reject the additively-converted \
                 Claude SOP-skill file as absent from the write-ahead plan",
            );

        // The Kiro-side raw copy landed, as in the single-marker case.
        assert_eq!(
            fs::read(target_dir.join(".konductor/sops/ticket-sync.sop.md")).unwrap(),
            b"# Ticket Sync\n\nKiro copy.\n"
        );

        // The additive Claude-side conversion also landed, sourced from
        // `repo_root`'s Claude staging dir, not Kiro's.
        let converted =
            fs::read_to_string(target_dir.join(".claude/skills/sop-ticket-sync/SKILL.md"))
                .expect("expected the additively-converted Claude SKILL.md to exist on disk");
        assert!(converted.contains("name: \"sop-ticket-sync\""));
        assert!(converted.contains("Syncs a ticket."));

        // The converted file is correctly recorded in the FINAL manifest
        // with real provenance -- proving `attach_provenance` matched it
        // against the write-ahead plan rather than merely not crashing.
        let manifest = super::super::manifest::read_manifest(&target_dir)
            .unwrap()
            .expect("manifest must exist after install");
        let claude_entry = manifest
            .files
            .iter()
            .find(|f| f.path == ".claude/skills/sop-ticket-sync/SKILL.md")
            .expect("converted Claude SOP-skill file must be recorded in the final manifest");
        assert_eq!(
            claude_entry.provenance,
            super::super::manifest::Provenance::Created,
            "a file that didn't exist before this run must be classified Created"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    // ── _skill_scopes.json sidecar -> --skill-name-filter ────────────

    /// Seeds `<repo_root>/dist/kiro-cli-v2/agents/_skill_scopes.json`
    /// with the given agent-name -> skill-names map, mirroring
    /// `kiro_cli_v2::write_skill_scopes_sidecar`'s real output shape.
    fn seed_synthed_skill_scopes(repo_root: &Path, scopes: &[(&str, &[&str])]) {
        let dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&dir).unwrap();
        let map: std::collections::BTreeMap<&str, &[&str]> =
            scopes.iter().map(|(name, names)| (*name, *names)).collect();
        fs::write(
            dir.join(SKILL_SCOPES_SIDECAR_FILE),
            serde_json::to_string_pretty(&map).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn read_skill_scopes_sidecar_returns_empty_map_when_missing() {
        let dir = scratch_dir("skill-scopes-missing");
        let map = read_skill_scopes_sidecar(&dir).expect("a missing sidecar must not error");
        assert!(map.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_skill_scopes_sidecar_parses_present_file() {
        let dir = scratch_dir("skill-scopes-present");
        fs::write(
            dir.join(SKILL_SCOPES_SIDECAR_FILE),
            r#"{"k-example": ["constraints", "sdlc-navigator"]}"#,
        )
        .unwrap();
        let map = read_skill_scopes_sidecar(&dir).expect("a well-formed sidecar must parse");
        assert_eq!(
            map.get("k-example"),
            Some(&vec![
                "constraints".to_string(),
                "sdlc-navigator".to_string()
            ])
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_skill_scopes_sidecar_errors_on_malformed_json() {
        let dir = scratch_dir("skill-scopes-malformed");
        fs::write(dir.join(SKILL_SCOPES_SIDECAR_FILE), "not json").unwrap();
        let err = read_skill_scopes_sidecar(&dir)
            .expect_err("a present but malformed sidecar must be a hard error");
        assert!(err.contains(SKILL_SCOPES_SIDECAR_FILE));
        fs::remove_dir_all(&dir).ok();
    }

    /// The sidecar lives in the same directory `list_agent_files` scans
    /// (`dist/kiro-cli-v2/agents/`) but is not itself an agent file -- it
    /// must never be copied to `.kiro/agents/` or parsed/rewritten as
    /// one.
    #[test]
    fn list_agent_files_excludes_skill_scopes_sidecar() {
        let dir = scratch_dir("list-agent-files-excludes-skill-sidecar");
        fs::write(dir.join("real.json"), b"{}\n").unwrap();
        fs::write(dir.join(SKILL_SCOPES_SIDECAR_FILE), b"{}\n").unwrap();

        let names = list_agent_files(&dir).expect("listing must succeed");
        assert_eq!(names, vec!["real.json".to_string()]);

        fs::remove_dir_all(&dir).ok();
    }

    /// End-to-end: when the sidecar declares a non-empty skill list for
    /// an agent, the installed agent JSON's `mcpServers.konductor-skills.
    /// args` gains a trailing `--skill-name-filter <names>` pair, joined
    /// by comma.
    #[test]
    fn install_from_local_injects_skill_name_filter_when_sidecar_declares_names() {
        let target_dir = scratch_dir("skill-filter-target");
        let repo_root = scratch_dir("skill-filter-repo-root");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(&repo_root, "constraints", b"body", &[]);
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"fake binary");
        seed_synthed_skill_scopes(
            &repo_root,
            &[("k-example", &["constraints", "sdlc-navigator"])],
        );

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let agent_path = target_dir.join(".kiro/agents/k-example.json");
        let installed: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        let args = installed["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        let args: Vec<&str> = args.iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(
            args.last().copied(),
            Some("constraints,sdlc-navigator"),
            "expected the --skill-name-filter value as the last arg, got: {args:?}"
        );
        assert_eq!(
            args[args.len() - 2],
            "--skill-name-filter",
            "expected --skill-name-filter immediately before its value, got: {args:?}"
        );

        // The sidecar itself must never be installed as an agent file.
        assert!(
            !target_dir
                .join(".kiro/agents")
                .join(SKILL_SCOPES_SIDECAR_FILE)
                .exists(),
            "the sidecar must never be copied into .kiro/agents/"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Backward compatibility: a `dist/` tree with NO skill-scopes
    /// sidecar at all installs with exactly the pre-existing args -- no
    /// `--skill-name-filter` anywhere.
    #[test]
    fn install_from_local_omits_skill_name_filter_when_sidecar_absent() {
        let target_dir = scratch_dir("skill-filter-absent-target");
        let repo_root = scratch_dir("skill-filter-absent-repo-root");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(&repo_root, "constraints", b"body", &[]);
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"fake binary");
        // Deliberately no seed_synthed_skill_scopes call.

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed with no skill-scopes sidecar present at all");

        let agent_path = target_dir.join(".kiro/agents/k-example.json");
        let installed: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        let args = installed["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        assert!(
            !args
                .iter()
                .any(|v| v.as_str() == Some("--skill-name-filter")),
            "no --skill-name-filter must appear when the sidecar is entirely absent, got: {args:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// Same backward-compatibility contract, sidecar-present-but-agent-
    /// absent case: the sidecar exists and declares names for a
    /// DIFFERENT agent, so this agent must still see no filter.
    #[test]
    fn install_from_local_omits_skill_name_filter_when_agent_absent_from_sidecar() {
        let target_dir = scratch_dir("skill-filter-other-agent-target");
        let repo_root = scratch_dir("skill-filter-other-agent-repo-root");
        seed_synthed_agent_with_skill_resource(&repo_root, "k-example", "constraints");
        seed_synthed_skill(&repo_root, "constraints", b"body", &[]);
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"fake binary");
        seed_synthed_skill_scopes(&repo_root, &[("some-other-agent", &["constraints"])]);

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let agent_path = target_dir.join(".kiro/agents/k-example.json");
        let installed: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        let args = installed["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        assert!(
            !args
                .iter()
                .any(|v| v.as_str() == Some("--skill-name-filter")),
            "no --skill-name-filter must appear for an agent absent from the sidecar, got: {args:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }

    /// The circular-dependency fix this whole section exists for,
    /// exercised end-to-end through the real `install_from_local` entry
    /// point (not just `McpServerPass::matches` in isolation): an agent
    /// that declares skill-name scoping in the sidecar but has NO
    /// `skill://` resource at all -- the state every agent would be in
    /// once the `skill://` resource entries are removed in favor of the
    /// MCP server as the sole delivery path -- must still get
    /// `mcpServers.konductor-skills` injected, with `--skill-name-filter`
    /// appended. Without both this and the widened fast-path skip in
    /// `copy_agent_files_rewriting_resources`, such an agent's JSON
    /// contains neither `CONTEXT_RESOURCE_PREFIX` nor
    /// `SKILL_RESOURCE_PREFIX`, so it would be copied verbatim and never
    /// even reach `apply_all`.
    #[test]
    fn install_from_local_injects_mcp_server_for_skill_names_only_agent_with_no_skill_resource() {
        let target_dir = scratch_dir("skill-filter-no-resource-target");
        let repo_root = scratch_dir("skill-filter-no-resource-repo-root");
        seed_synthed_agent(&repo_root, "k-example", br#"{"name":"k-example"}"#);
        seed_mcp_binary(&repo_root, "skill-lookup-mcp", b"fake binary");
        seed_synthed_skill_scopes(&repo_root, &[("k-example", &["constraints"])]);

        KiroCliInstallStrategy
            .install_from_local(
                &target_dir,
                Some(repo_root.to_str().unwrap()),
                "2026-01-01T00:00:00Z",
                false,
            )
            .expect("install must succeed");

        let agent_path = target_dir.join(".kiro/agents/k-example.json");
        let installed: serde_json::Value =
            serde_json::from_slice(&fs::read(&agent_path).unwrap()).unwrap();
        let command = installed["mcpServers"]["konductor-skills"]["command"]
            .as_str()
            .expect("mcpServers.konductor-skills.command must be injected");
        assert!(
            Path::new(command).is_file(),
            "the injected command must point at the actually-installed binary"
        );
        let args = installed["mcpServers"]["konductor-skills"]["args"]
            .as_array()
            .expect("args must be an array");
        let args: Vec<&str> = args.iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(
            args.last().copied(),
            Some("constraints"),
            "expected the --skill-name-filter value as the last arg, got: {args:?}"
        );
        assert_eq!(
            args[args.len() - 2],
            "--skill-name-filter",
            "expected --skill-name-filter immediately before its value, got: {args:?}"
        );

        fs::remove_dir_all(&target_dir).ok();
        fs::remove_dir_all(&repo_root).ok();
    }
}
