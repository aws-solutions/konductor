// SPDX-License-Identifier: Apache-2.0
//
// install/phases.rs — `InstallPhase`: an explicit, ordered pipeline
// replacing `install_from_local`'s previous fixed hand-written call
// chain (context -> skills -> MCP binary -> agents).
//
// Mirrors patterns already established in this codebase: a free
// function over a borrowed slice of trait objects, no wrapper type.
// - `install::registry::STRATEGIES` (a static slice of `&dyn
//   InstallStrategy`) + `install::dispatch_install_with` shares that
//   free-function-over-a-slice shape, though `dispatch_install_with`
//   iterates the slice to find the one strategy that applies, not to
//   run every entry.
// - `synth::registry::TRANSFORMERS` (a static slice of `&dyn
//   HarnessTransformer`) + `synth::dispatch_synth_with`, and
//   `resource_rewrite::standard_passes()` / `ResourceRewritePass` /
//   `apply_all(passes: &[Box<dyn ResourceRewritePass>], ...)`, are the
//   closer match for `InstallPhase` in one specific respect only: both
//   run every entry in a fixed slice in order, failing fast on the
//   first `Err` -- the same run-loop shape `run_all_phases` below uses
//   for `InstallPhase`. The match stops there. `ResourceRewritePass`
//   has no `name()` method and no dependency-declaration mechanism --
//   its trait is `matches`/`rewrite`/`verify` over a `serde_json::Value`,
//   a data-driven design where each pass self-checks whether it has
//   anything to do, and its fixed order in `standard_passes()` is the
//   only thing enforcing the skill-before-MCP-injection dependency that
//   design has. `InstallPhase` adds `name()` and `dependencies()`
//   precisely because `run_all_phases` validates that ordering
//   explicitly instead of relying on a hand-maintained list order.
//
// `InstallPhase` bundles one self-contained install concern, run in
// order by the free function `run_all_phases(phases: &[Box<dyn
// InstallPhase>], ..., false)` below -- not a separate chain/wrapper type. No
// new call is inserted into a growing sequential call chain inside
// `install_from_local` itself (which is now a thin wrapper: build the
// default phase list, run it, attach provenance, write the manifest);
// see `standard_install_phases()`'s own doc comment for what adding a
// new phase to that list actually takes.
//
// ── Signature: adapted, not copy-pasted, from the illustrative shape ────
// `InstallPhase::run` takes `(staged_root, target_dir, repo_root,
// prior_manifest, phase_outputs)` -- no `installed_at`: nothing about
// copying files or classifying provenance depends on the install
// timestamp, and every real implementation below would just ignore
// it, so it is not part of this trait's contract (`Manifest::new`'s
// own `installed_at` field is filled in once, by `install_from_local`
// itself, after `run_all_phases` returns). `repo_root` is `Option<&Path>`,
// not `Option<&str>`: `install_from_local` already parses the raw
// `--from <repo-root>` string into a `Path` once, before calling
// `run_all_phases` (see its own doc comment's write-ahead sequencing
// step 2 and its call site below) -- threading the already-parsed
// `Path` through means `McpInstallPhase`, the one phase that needs it,
// never re-derives a `Path` from the original string. The two
// parameters below ARE real, pre-existing data flow a bare
// `(staged_root, target_dir, repo_root)` signature cannot express, so
// both are threaded through explicitly:
//
// 1. `prior_manifest: Option<&Manifest>` -- `install_skills`'s
//    dropped-file cleanup and every phase's eventual provenance
//    classification need the manifest as it existed BEFORE this
//    install run touched anything. It is read exactly once, in
//    `kiro_cli.rs`'s `install_from_local`, before the write-ahead
//    `Status::InProgress` manifest overwrites `.konductor/manifest` on
//    disk -- a phase re-reading the manifest mid-chain would read that
//    just-written in-progress state instead (every `sha256: None`),
//    corrupting the very classification it exists to perform. So it
//    is captured once by the caller and passed to every phase by
//    reference, never re-read.
// 2. `phase_outputs: &PhaseOutputs` -- `AgentInstallPhase` needs to know
//    exactly which MCP server binaries THIS install run actually
//    copied, to decide whether to inject an `mcpServers` entry (see
//    `mcp_server.rs`'s module docstring: "gate on the local build
//    artifact existing, inject an absolute path"). Checking disk
//    existence of `<target_dir>/.konductor/bin/<name>` instead would be
//    WRONG: a prior install's copy can still be sitting on disk even
//    after the SOURCE binary was removed (`install_bin_files` never
//    deletes a no-longer-sourced binary), which would re-inject a
//    now-stale path rather than dropping the entry -- see
//    `install_from_local_removes_stale_mcp_server_entry_when_binary_becomes_absent`
//    in `kiro_cli.rs`'s test module, which exists specifically to catch
//    that mistake. `PhaseOutputs` is a typed, name-addressed handoff
//    (`files_from(name)`) for exactly this kind of cross-phase data,
//    mirroring `resource_rewrite::RewriteContext`'s typed-field
//    approach rather than filtering a flat `&[ManifestFile]` by a
//    `.konductor/bin/` path-string prefix, which would couple this
//    lookup to the exact destination path a content type happens to
//    use today. `files_from` returning an empty slice for a phase that
//    has not run yet in this chain -- e.g. if a
//    future phase list ever omitted `McpInstallPhase` -- is a deliberate
//    fail-safe, not a bug: it reproduces exactly `mcp_server.rs`'s own
//    "a missing binary is not an error" behavior (no `mcpServers` entry
//    gets injected) rather than panicking.
//
// ── Default order deviates from a naive "Agent, Skill, Sop, Mcp" ────────
// The dependency this module must preserve -- `AgentInstallPhase`'s
// resource rewrite verifies every rewritten resource and injected
// `mcpServers` target exists on disk, so skills, the MCP binary, and
// context files must already be installed -- means `AgentInstallPhase`
// cannot run first. `AgentInstallPhase` declares these three as its own
// `InstallPhase::dependencies()` (see its doc comment), which
// `run_all_phases` validates structurally, up front, before any phase
// runs -- so the ordering constraint is enforced by the trait itself,
// not only by `standard_install_phases()`'s own chosen order below.
// `standard_install_phases()` runs skills and the MCP binary first,
// then `ContextInstallPhase`, `AgentInstallPhase` last. Context gets its
// own phase (rather than being folded into `AgentInstallPhase` as an
// internal first step) specifically so `PhaseOutputs` records context
// files and agent files under two distinct names -- see
// `ContextInstallPhase` and `AgentInstallPhase`'s own doc comments for
// why that separation matters. `SopInstallPhase` is its own phase for
// the same reason: it needs to run in both runtimes' chains with its
// own additive-branch behavior -- see that struct's own doc comment
// for its real Kiro/Claude/dual-marker behavior.
//
// ── Partial-failure on-disk state is safe by design, not by luck ────────
// Because `ContextInstallPhase`/`AgentInstallPhase` run LAST, a crash
// mid-install can leave skills and the MCP binary already on disk
// while context/agent installation has not started at all. This is
// safe: the write-ahead `Status::InProgress` manifest (written before
// ANY phase runs, from the full `plan_all_files` plan) already
// anticipates an arbitrary partial on-disk state after an interrupted
// run, and a rerun's `classify_provenance`/dropped-file-cleanup logic
// is designed to converge regardless of which subset of files a prior
// run actually reached -- proven directly by
// `install_from_local_recovers_when_agent_phase_never_ran` in
// `kiro_cli.rs`, which hand-crafts exactly this state (skills and the
// MCP binary written, `.kiro/agents/`/`.kiro/context/` entirely
// absent) and asserts a rerun still converges.

use std::collections::HashSet;
use std::path::Path;

use super::manifest::{Manifest, ManifestFile, Provenance};
use super::resource_rewrite::ClaudeGrantError;
use super::runtime::{detect_runtimes, Runtime};
use super::InstallError;

/// One self-contained step of `install_from_local`'s copy work: what it
/// is called (used as the `PhaseOutputs` lookup key -- see `name()`'s
/// own doc comment below) and what it does. Each implementation is
/// independently callable -- with a real `staged_root`/`target_dir` --
/// which is what makes every phase unit-testable without running the
/// whole chain.
pub(super) trait InstallPhase {
    /// Stable identifier for this phase: `run_all_phases` records each
    /// phase's output under this name into `PhaseOutputs`, so a later
    /// phase can look its predecessor's output up by name via
    /// `PhaseOutputs::files_from` (see `AgentInstallPhase::run`'s lookup
    /// of `McpInstallPhase.name()`). Must be unique within a given
    /// phase list -- `run_all_phases` rejects a duplicate name up front
    /// (see its own doc comment), so `standard_install_phases()`'s own
    /// uniqueness is exercised on every real call, and separately
    /// pinned by the `phase_names_are_unique` test.
    fn name(&self) -> &'static str;

    /// Checked for every phase, in order, BEFORE any phase's `run` is
    /// called -- the phase-specific counterpart to `run_all_phases`'s
    /// own upfront duplicate-name check, applying that same
    /// "validate everything before doing any work" discipline to a
    /// phase's own preconditions instead of leaving them to surface
    /// only once that phase's `run` happens to execute (which, for a
    /// phase ordered after others, could be after earlier phases have
    /// already copied files). Default: no precondition. Only
    /// `McpInstallPhase` overrides this today (it needs
    /// `repo_root: Some(_)`) -- see its own doc comment.
    fn check_preconditions(&self, _repo_root: Option<&Path>) -> Result<(), InstallError> {
        Ok(())
    }

    /// Names of OTHER phases (by their own `name()`) that must appear
    /// earlier than this one in the same `run_all_phases` call --
    /// checked structurally, up front, before any phase runs (see that
    /// function's own doc comment). Default: no dependency. Only
    /// `AgentInstallPhase` overrides this today, declaring the three
    /// phases its resource-rewrite verification needs already on disk
    /// (see its own doc comment) -- so a future reorder or omission of
    /// one of those three fails loudly here, rather than only much
    /// later inside `AgentInstallPhase::run` itself, or not at all if
    /// the reordered path happens not to be exercised by a test.
    fn dependencies(&self) -> &'static [&'static str] {
        &[]
    }

    /// Performs this phase's copy work and returns the `ManifestFile`
    /// entries it wrote, with a placeholder provenance -- the real
    /// per-file provenance is attached once, over every phase's
    /// combined output, by `install_from_local` after `run_all_phases`
    /// returns (via `attach_provenance`).
    ///
    /// `staged_root` is the synthed `dist/<harness>/` tree; `repo_root`
    /// is the already-parsed `--from <repo-root>` path, `None` only if
    /// validation was skipped (see this module's own doc comment for
    /// why `Option<&Path>` rather than the raw `--from` string, and
    /// `McpInstallPhase`'s own doc comment for how a phase that needs
    /// it handles `None`). `prior_manifest` and `phase_outputs` are
    /// documented on this module's own doc comment above. `no_telemetry`
    /// carries `install`'s own `--no-telemetry` flag (see
    /// `InstallStrategy::install_from_local`'s own doc comment) --
    /// every phase receives it, even though only `AgentInstallPhase`
    /// today has a telemetry side effect to gate on it (the Claude Code
    /// telemetry-hook wiring below), so a future phase that grows one
    /// of its own already has it in scope rather than needing the
    /// trait's signature widened again.
    fn run(
        &self,
        staged_root: &Path,
        target_dir: &Path,
        repo_root: Option<&Path>,
        prior_manifest: Option<&Manifest>,
        phase_outputs: &PhaseOutputs,
        no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError>;
}

/// The `ManifestFile`s every phase in THIS `run_all_phases` call has
/// produced so far, addressable by phase name -- see this module's own
/// doc comment ("Signature: adapted...", point 2) for why this exists.
/// `run_all_phases` builds one as it iterates and passes it to each
/// phase in turn; nothing outside this module constructs one directly.
pub(super) struct PhaseOutputs {
    by_phase: Vec<(&'static str, Vec<ManifestFile>)>,
}

impl PhaseOutputs {
    fn new() -> Self {
        Self {
            by_phase: Vec::new(),
        }
    }

    /// Records `phase_name`'s output. `run_all_phases` calls this
    /// exactly once per phase, immediately after that phase's `run`
    /// returns and before the next phase's `run` is called -- so a
    /// phase's own `files_from` lookup only ever sees EARLIER phases'
    /// output, never its own or a later one's.
    fn record(&mut self, phase_name: &'static str, files: Vec<ManifestFile>) {
        self.by_phase.push((phase_name, files));
    }

    /// The files the phase named `phase_name` returned, or an empty
    /// slice if that phase has not run (yet) in this call -- fails
    /// safe rather than panicking, matching `mcp_server.rs`'s own "a
    /// missing binary is not an error" convention (see this module's
    /// own doc comment).
    pub(super) fn files_from(&self, phase_name: &str) -> &[ManifestFile] {
        self.by_phase
            .iter()
            .find(|(name, _)| *name == phase_name)
            .map(|(_, files)| files.as_slice())
            .unwrap_or(&[])
    }

    /// Every file every phase recorded so far, flattened in recording
    /// order. `run_all_phases` calls this once, after the loop, to
    /// build its own return value -- `PhaseOutputs`'s internal
    /// per-phase grouping is what phases consume mid-run; the flat
    /// list is what `install_from_local` consumes afterward (for
    /// `attach_provenance` and the final manifest).
    fn all_files(&self) -> Vec<ManifestFile> {
        self.by_phase
            .iter()
            .flat_map(|(_, files)| files.iter().cloned())
            .collect()
    }
}

/// Runs every phase in `phases`, in order, feeding each one a
/// `PhaseOutputs` containing every EARLIER phase's output from this
/// same call (see this module's doc comment on why `AgentInstallPhase`
/// needs this). Fails fast on the first `Err`, returning it
/// immediately without running any later phase -- the same convention
/// `synth::dispatch_synth_with` already applies across `TRANSFORMERS`,
/// and the same convention `resource_rewrite::apply_all` applies
/// across its own passes.
///
/// Validates every phase's preconditions up front, before running any
/// of them:
/// - Rejects `phases` if it contains two entries with the same
///   `name()` -- the structural counterpart to
///   `PhaseOutputs::files_from`'s fail-safe-on-*missing*-name design: a
///   duplicate name would make `files_from`'s lookup silently resolve
///   to only the first matching phase's output, so this function
///   refuses to run rather than let that ambiguity happen.
/// - Rejects `phases` if any phase's own `dependencies()` names a phase
///   that has not appeared earlier in the same list -- either because
///   that dependency is missing entirely, or merely ordered after the
///   dependent phase, or because a phase names *itself* (checked against
///   only the strictly-earlier names seen so far, before this phase's
///   own name is recorded, so self-dependence can never trivially pass)
///   (see `InstallPhase::dependencies`'s own doc comment for why this
///   exists).
/// - Calls each phase's own `check_preconditions(repo_root)` -- e.g.
///   `McpInstallPhase`'s `repo_root: Some(_)` requirement -- so a
///   phase-specific precondition is validated with the same eagerness
///   as the structural checks above, rather than surfacing only once
///   that phase's own `run` happens to execute (by which point an
///   earlier phase may have already copied files).
///
/// This is the third hand-rolled duplicate-key check in this codebase,
/// alongside `synth::parse_canonical::assert_unique_names` (fail-fast,
/// like this one, but keyed on parsed-item names with a parallel file-
/// label slice for its `ParseError`) and `install::index::duplicate_target_dirs`
/// (collect-all, not fail-fast, keyed on `IndexEntry::target_dir`). The
/// three do differ in error/report type and in fail-fast-vs-collect-all
/// behavior, but the core "insert into a seen-set, detect the second
/// occurrence of a key" logic each wraps is small and genuinely similar
/// across all three -- a shared detection helper is a plausible follow-up,
/// not ruled out by the type differences alone. It is not done here
/// because `assert_unique_names` lives under `cli::synth`, which this
/// diff does not touch, and factoring a helper that covers only this
/// function and `duplicate_target_dirs` (both under `cli::install`)
/// while leaving `assert_unique_names` as a third, still-separate
/// implementation would not actually eliminate the duplication -- it
/// would only move two-thirds of it into the new helper, leaving
/// `assert_unique_names` duplicated on its own.
pub(super) fn run_all_phases(
    phases: &[Box<dyn InstallPhase>],
    staged_root: &Path,
    target_dir: &Path,
    repo_root: Option<&Path>,
    prior_manifest: Option<&Manifest>,
    no_telemetry: bool,
) -> Result<Vec<ManifestFile>, InstallError> {
    let mut seen_names = HashSet::with_capacity(phases.len());
    for phase in phases {
        // Dependency check runs against `seen_names` *before* this
        // phase's own name is inserted below, so `seen_names` here
        // holds only strictly-earlier phases -- a phase that names
        // itself in `dependencies()` is checked against a set that
        // does not yet contain that name, and is correctly rejected
        // rather than trivially satisfied.
        for dep in phase.dependencies() {
            if !seen_names.contains(dep) {
                return Err(InstallError::Message(format!(
                    "InstallPhase {:?} depends on {:?}, which must run earlier in \
                     the phase list passed to run_all_phases, but it hasn't -- it \
                     is either missing from the list, ordered after {:?}, or (if \
                     {:?} names itself) a phase cannot depend on itself",
                    phase.name(),
                    dep,
                    phase.name(),
                    phase.name()
                )));
            }
        }
        if !seen_names.insert(phase.name()) {
            return Err(InstallError::Message(format!(
                "duplicate InstallPhase name {:?} -- every phase in a single \
                 run_all_phases call must have a unique name()",
                phase.name()
            )));
        }
        phase.check_preconditions(repo_root)?;
    }

    let mut outputs = PhaseOutputs::new();
    for phase in phases {
        let files = phase.run(
            staged_root,
            target_dir,
            repo_root,
            prior_manifest,
            &outputs,
            no_telemetry,
        )?;
        outputs.record(phase.name(), files);
    }
    Ok(outputs.all_files())
}

/// The default phase list: all 5 artifact categories `install_from_local`
/// handles today, in the order their real dependencies require --
/// skills, the MCP binary, and context before agents (see this
/// module's own doc comment). `SopInstallPhase` copies every staged
/// `.sop.md` file into `.konductor/sops/` (and, additively, converts
/// them into `.claude/skills/sop-<name>/SKILL.md` when a `.claude`
/// marker already exists at the target -- see its own doc comment);
/// its position in the list is otherwise inert, since nothing else in
/// this chain depends on it. Adding a sixth phase is a new `struct
/// FooInstallPhase` plus one `Box::new(FooInstallPhase)` line here --
/// no existing line changes.
pub(super) fn standard_install_phases() -> Vec<Box<dyn InstallPhase>> {
    vec![
        Box::new(SkillInstallPhase),
        Box::new(McpInstallPhase),
        Box::new(SopInstallPhase),
        Box::new(ContextInstallPhase),
        Box::new(AgentInstallPhase),
    ]
}

// ── Phase: skills ────────────────────────────────────────────────────────

/// Wraps the existing `install_skills` logic: copies every skill
/// directory under `<staged_root>/skills/` into
/// `<target_dir>/.konductor/skills/<name>/`, merging (see
/// `install_skills`'s own doc comment for the merge/cleanup contract).
pub(super) struct SkillInstallPhase;

impl InstallPhase for SkillInstallPhase {
    fn name(&self) -> &'static str {
        "skills"
    }

    fn run(
        &self,
        staged_root: &Path,
        target_dir: &Path,
        _repo_root: Option<&Path>,
        prior_manifest: Option<&Manifest>,
        _phase_outputs: &PhaseOutputs,
        _no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError> {
        Ok(super::kiro_cli::install_skills(
            staged_root,
            target_dir,
            prior_manifest,
        )?)
    }
}

// ── Phase: MCP server binary ─────────────────────────────────────────────

/// Wraps the existing `mcp_server::install_bin_files` logic: copies any
/// present `mcp_server::MCP_SERVER_BINARY_NAMES` entry from
/// `<repo_root>/mcp/target/release/<name>` into
/// `<target_dir>/.konductor/bin/<name>`. A missing binary is not an
/// error (see `mcp_server.rs`'s own module doc comment).
///
/// The only phase that needs `repo_root: Some(_)` -- overrides
/// `check_preconditions` so `run_all_phases` validates this upfront,
/// alongside its own duplicate-name check, rather than only once this
/// phase's own `run` executes. `run` below calls `check_preconditions`
/// itself as well, rather than re-checking `repo_root.is_none()`
/// inline a second time -- `check_preconditions` is this phase's
/// single source of truth for the requirement, so a caller that
/// invokes `run` directly, bypassing `run_all_phases`, still gets the
/// same rejection. By the time `run` unwraps `repo_root` below,
/// `check_preconditions` has already confirmed it is `Some`; see the
/// trait's own doc comment for why `run` takes an already-parsed
/// `Path` rather than the raw `--from` string.
pub(super) struct McpInstallPhase;

impl InstallPhase for McpInstallPhase {
    fn name(&self) -> &'static str {
        "mcp"
    }

    fn check_preconditions(&self, repo_root: Option<&Path>) -> Result<(), InstallError> {
        if repo_root.is_none() {
            return Err(InstallError::Message(
                super::NO_REMOTE_RELEASE_MESSAGE.to_string(),
            ));
        }
        Ok(())
    }

    fn run(
        &self,
        _staged_root: &Path,
        target_dir: &Path,
        repo_root: Option<&Path>,
        _prior_manifest: Option<&Manifest>,
        _phase_outputs: &PhaseOutputs,
        _no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError> {
        self.check_preconditions(repo_root)?;
        let repo_root =
            repo_root.expect("check_preconditions above already confirmed repo_root is Some");
        Ok(super::mcp_server::install_bin_files(repo_root, target_dir)?)
    }
}

// ── Phase: SOPs ──────────────────────────────────────────────────────────

/// Shared verbatim across both `standard_install_phases()` (Kiro) and
/// `standard_claude_install_phases()` (Claude) -- the only phase struct
/// in either chain that is, rather than each runtime carrying its own
/// dedicated phase the way skills/agents do (`SkillInstallPhase` vs
/// `ClaudeSkillInstallPhase`, `AgentInstallPhase` vs
/// `ClaudeAgentInstallPhase`). No new `InstallStrategy`/trait is
/// introduced for this: one phase, one impl, internal branching, rather
/// than a second SOP-specific strategy or trait.
///
/// `run` decides which chain invoked it from `staged_root`'s own name
/// (`KiroCliV2Transformer.name()` vs `CLAUDE_HARNESS_DIR`) -- NOT from
/// `detect_runtimes(target_dir)`, which is presence-only against
/// PRE-EXISTING marker directories on disk (see `runtime.rs`'s own doc
/// comment) and so cannot reliably distinguish "this run's own primary
/// runtime" from "no marker yet, because this is that runtime's
/// first-ever install and nothing has created its marker directory yet
/// at the point this phase runs" -- this phase runs THIRD in Kiro's own
/// `standard_install_phases()`, before `ContextInstallPhase`/
/// `AgentInstallPhase` (the phases that actually create content under
/// `.kiro/`), so a fresh, from-scratch Kiro install has no `.kiro`
/// marker on disk yet at the point this phase's Kiro branch needs to
/// decide whether to fire.
///
/// - Kiro CLI branch (unconditional whenever `staged_root` is Kiro's own
///   harness dir, i.e. this phase is running as part of Kiro's own
///   chain): copies every staged `.sop.md` file verbatim into
///   `.konductor/sops/` (via `kiro_cli::install_sops`), the raw files
///   `--agent-sop-paths` (see `resource_rewrite.rs`'s `McpServerPass`)
///   points the launched `skill-lookup-mcp` process at.
/// - Claude Code branch (unconditional whenever `staged_root` is
///   Claude's own harness dir): converts every staged `.sop.md` file
///   into a `sop-<name>/SKILL.md` under `.claude/skills/` (via
///   `claude::install_sop_skills`), since Claude Code has no MCP-prompt
///   equivalent to serve `.sop.md` files directly.
/// - Claude Code ADDITIVE branch, reached from WITHIN Kiro's own chain
///   (mirrors `AgentInstallPhase`'s own additive Claude/V3
///   settings-grant branch -- see that phase's doc comment for the same
///   pattern applied to a different concern): when this run's `staged_root`
///   is Kiro's, but the target ALSO has a PRE-EXISTING `.claude` marker
///   (a genuine dual-marker reinstall/update target, where `detect_
///   runtimes`'s presence-only check IS the right tool, unlike the
///   primary-branch decision above), also runs the Claude conversion --
///   always re-deriving its OWN source directory from `repo_root`
///   (`<repo_root>/dist/claude/sops/`), never from `staged_root`, since
///   `staged_root` here is Kiro's harness dir, not Claude's.
///
/// Silently no-ops the additive Claude branch when `repo_root` is
/// `None`: both real `InstallStrategy::install_from_local`
/// implementations always pass `Some(repo_root)` into `run_all_phases`
/// (see `kiro_cli.rs`'s and `claude.rs`'s own `install_from_local`), so
/// this only matters for a test harness that constructs a phase chain
/// directly with no repo root -- matching every other phase's own "no
/// input, no output, not an error" convention (e.g. `mcp_server.rs`'s
/// "a missing binary is not an error").
pub(super) struct SopInstallPhase;

impl InstallPhase for SopInstallPhase {
    fn name(&self) -> &'static str {
        "sops"
    }

    fn run(
        &self,
        staged_root: &Path,
        target_dir: &Path,
        repo_root: Option<&Path>,
        _prior_manifest: Option<&Manifest>,
        _phase_outputs: &PhaseOutputs,
        _no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError> {
        use crate::cli::synth::kiro_cli_v2::KiroCliV2Transformer;
        use crate::cli::synth::HarnessTransformer as _;

        let staged_root_name = staged_root.file_name().and_then(|n| n.to_str());
        let mut files = Vec::new();

        if staged_root_name == Some(KiroCliV2Transformer.name()) {
            files.extend(super::kiro_cli::install_sops(staged_root, target_dir)?);

            // Additive Claude branch: this run is Kiro's own, but the
            // target ALSO has a pre-existing `.claude` marker (a genuine
            // dual-marker case) -- see this struct's own doc comment.
            if detect_runtimes(target_dir).has(Runtime::ClaudeCode) {
                if let Some(repo_root) = repo_root {
                    let claude_harness_dir = repo_root
                        .join("dist")
                        .join(super::claude::CLAUDE_HARNESS_DIR);
                    files.extend(super::claude::install_sop_skills(
                        &claude_harness_dir,
                        target_dir,
                    )?);
                }
            }
        } else if staged_root_name == Some(super::claude::CLAUDE_HARNESS_DIR) {
            files.extend(super::claude::install_sop_skills(staged_root, target_dir)?);
        }

        Ok(files)
    }
}

// ── Phase: context ──────────────────────────────────────────────────────

/// Wraps the existing `install_context` logic: copies synthed context
/// files into `<target_dir>/.kiro/context/`. Given its own phase
/// (rather than being folded into `AgentInstallPhase` as an internal
/// first step) specifically so `PhaseOutputs` records context files
/// under their own `"context"` name, distinct from `"agents"` --
/// `AgentInstallPhase::run`'s resource rewrite needs the context
/// directory to already exist on disk, which is why this phase still
/// runs immediately before it, but the two no longer share one
/// `PhaseOutputs` entry.
pub(super) struct ContextInstallPhase;

impl InstallPhase for ContextInstallPhase {
    fn name(&self) -> &'static str {
        "context"
    }

    fn run(
        &self,
        staged_root: &Path,
        target_dir: &Path,
        _repo_root: Option<&Path>,
        _prior_manifest: Option<&Manifest>,
        _phase_outputs: &PhaseOutputs,
        _no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError> {
        Ok(super::kiro_cli::install_context(staged_root, target_dir)?)
    }
}

// ── Phase: agents ────────────────────────────────────────────────────────

/// Wraps the existing `install_agents` logic: copies synthed agent
/// files into `<target_dir>/.kiro/agents/`, rewriting each agent's
/// `resources`/`mcpServers` entries to absolute installed paths and
/// verifying every rewritten target exists on disk.
///
/// Must run after `SkillInstallPhase`, `McpInstallPhase`, and
/// `ContextInstallPhase` -- declared via `dependencies()` below (see
/// this module's own doc comment for why the resource-rewrite
/// verification requires this ordering).
///
/// `PhaseOutputs` contract: this phase's recorded output, under the
/// name `"agents"`, is agent files ONLY -- context files are recorded
/// separately, under `ContextInstallPhase`'s own `"context"` name (see
/// that phase's doc comment). A future phase calling
/// `phase_outputs.files_from("agents")` gets exactly what its name
/// says, with no risk of also silently getting context files. The
/// additive Claude/V3 settings-grant file (below) is folded into this
/// same `"agents"` output rather than given its own name, mirroring how
/// `install_agents`'s pre-phases caller used to fold it into its own
/// `agent_files` list.
///
/// Also applies the Claude/V3 settings grant (see `resource_rewrite.rs`'s
/// "V3/Claude Code permission grant" section) when `install_agents`
/// reports it should fire. This lives HERE, not in `run_all_phases` or a
/// later phase, because this is the one place that already holds
/// `install_agents`'s own `any_mcp_server_injected` return value -- the
/// single signal the grant is gated on -- with no need to thread it
/// through `PhaseOutputs` (which carries `Vec<ManifestFile>`, not a
/// `bool`) to reach a separate step.
pub(super) struct AgentInstallPhase;

impl InstallPhase for AgentInstallPhase {
    fn name(&self) -> &'static str {
        "agents"
    }

    fn dependencies(&self) -> &'static [&'static str] {
        &["skills", "mcp", "context"]
    }

    fn run(
        &self,
        staged_root: &Path,
        target_dir: &Path,
        _repo_root: Option<&Path>,
        _prior_manifest: Option<&Manifest>,
        phase_outputs: &PhaseOutputs,
        no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError> {
        // The set of MCP server binaries THIS run actually copied --
        // never re-derived from disk existence (see this module's own
        // doc comment for why that would be wrong). Looked up by
        // `McpInstallPhase`'s own name rather than a hardcoded literal,
        // so the two can never drift apart.
        let bin_files = phase_outputs.files_from(McpInstallPhase.name());
        let (mut files, any_mcp_server_injected) =
            super::kiro_cli::install_agents(staged_root, target_dir, bin_files)?;

        // Additive, Claude/V3-only: mirrors the V2 grant's own scope
        // exactly (only ever applies when V2 actually injected
        // something into at least one agent this run) and is applied
        // exactly ONCE for the whole run, not per-agent -- see
        // `resource_rewrite.rs`'s "V3/Claude Code permission grant"
        // section for why.
        //
        // Deliberately non-fatal: most of `apply_claude_settings_grant`'s
        // own failure modes (a symlinked `.claude`/`settings.json`, a
        // `permissions.deny` shadow, a malformed pre-existing
        // settings.json) are about PRE-EXISTING, user-owned content this
        // install did not create -- not a defect in what this run itself
        // is installing. Aborting the whole Kiro install over an
        // unrelated problem in a foreign Claude-side file would be a
        // worse outcome than skipping this one additive grant and
        // warning about it; the Kiro side (the reason the user ran
        // `konductor install` at all) already succeeded by the time this
        // block runs -- `install_agents` above already propagated its
        // own error via `?` before control ever reaches here.
        if any_mcp_server_injected && detect_runtimes(target_dir).has(Runtime::ClaudeCode) {
            // Tracks the LATEST successful mutation's own (path, sha256)
            // pair across both calls below -- both target the exact
            // SAME manifest path (`.claude/settings.json`), and exactly
            // ONE `ManifestFile` entry must be pushed for it (pushing
            // two would duplicate that path in the final manifest).
            let mut claude_settings: Option<(String, String)> = None;

            match super::resource_rewrite::apply_claude_settings_grant(target_dir) {
                Ok((claude_path, claude_sha256)) => {
                    claude_settings = Some((claude_path, claude_sha256));

                    // Telemetry hook wiring (usage-analytics design
                    // D.13): deliberately gated on the GRANT above
                    // having just succeeded, not attempted
                    // independently. `apply_claude_settings_grant`'s
                    // own failure modes (symlink, `permissions.deny`
                    // shadow, malformed pre-existing settings.json) are
                    // about PRE-EXISTING, user-owned content this
                    // install did not create; when the grant is
                    // skipped for one of those reasons, this install
                    // must leave that foreign file completely
                    // untouched (verified by
                    // `install_from_local_does_not_abort_when_claude_grant_fails_on_foreign_content`
                    // in `kiro_cli.rs`) rather than partially writing
                    // it via a second, independent mutation. See
                    // `resource_rewrite.rs`'s own "V3/Claude Code
                    // telemetry hook wiring" section for the disclosed
                    // scope boundary this reuses the grant's own gate
                    // to stay inside. `apply_claude_settings_hooks`
                    // reads the file fresh from disk, so its own
                    // returned bytes already reflect the grant's own
                    // just-completed write.
                    //
                    // ALSO gated on `!no_telemetry`: the permission
                    // grant above is about MCP tool authorization, not
                    // telemetry, so it fires unconditionally -- but
                    // wiring the `SessionStart`/`SubagentStart` hooks
                    // that invoke `__telemetry-hook` is itself a
                    // telemetry side effect, and `--no-telemetry` must
                    // suppress EVERY telemetry side effect an install
                    // run has, not only the top-level
                    // `report_package_installed`/`report_cli_error`
                    // calls `dispatch_install_with` already gates on
                    // this same flag.
                    if !no_telemetry {
                        match super::resource_rewrite::apply_claude_settings_hooks(target_dir) {
                            Ok((hooks_path, hooks_sha256)) => {
                                claude_settings = Some((hooks_path, hooks_sha256));
                            }
                            // `apply_claude_settings_hooks` never
                            // constructs `DenyShadowed` (hooks have no
                            // "deny" concept of their own) -- matched here
                            // only for exhaustiveness, and never expected
                            // to fire.
                            Err(ClaudeGrantError::DenyShadowed(message)) => {
                                eprintln!(
                                    "warning: Claude Code telemetry hook wiring intentionally \
                                     skipped ({message})"
                                );
                            }
                            Err(ClaudeGrantError::Other(message)) => {
                                eprintln!(
                                    "warning: Claude Code telemetry hook wiring skipped \
                                     ({message}) -- the Kiro CLI portion of this install is \
                                     unaffected"
                                );
                            }
                        }
                    }
                }
                // Matched by variant, NOT by sniffing the rendered
                // message for a substring: the "not a JSON array"
                // malformed-settings error also happens to contain the
                // literal substring `"permissions.deny"`, so a
                // substring check could not reliably distinguish real
                // corruption from a deliberately-respected policy
                // decision. See `ClaudeGrantError`'s own doc comment.
                Err(ClaudeGrantError::DenyShadowed(message)) => {
                    // Security-relevant in a way the other failure
                    // modes are not: it means the target owner
                    // deliberately denied this exact tool, and this
                    // install is correctly respecting that rather than
                    // silently overriding it -- so it gets its own,
                    // clearly-labeled wording instead of the generic
                    // one below.
                    eprintln!(
                        "warning: Claude Code permission grant intentionally skipped -- \
                         an existing \"permissions.deny\" rule already blocks it \
                         ({message}). This is respected, not an error to fix; the Kiro \
                         CLI portion of this install is unaffected."
                    );
                }
                Err(ClaudeGrantError::Other(message)) => {
                    eprintln!(
                        "warning: Claude Code permission grant skipped ({message}) -- \
                         the Kiro CLI portion of this install is unaffected"
                    );
                }
            }

            // Placeholder provenance (`Provenance::Created`), like every
            // other file this phase (and every other phase) returns --
            // see `InstallPhase::run`'s own doc comment: the real
            // per-file provenance is attached once, over every phase's
            // combined output, by `install_from_local` after
            // `run_all_phases` returns (via `attach_provenance`), which
            // matches this exact path against the write-ahead plan
            // `plan_claude_settings_grant` already populated (see that
            // function's own doc comment for why the plan must
            // anticipate this file before any phase runs). A mismatch
            // there (this fires but planning predicted it wouldn't)
            // fails loudly via `attach_provenance`'s own internal-error
            // check rather than silently mis-tracking.
            if let Some((claude_path, claude_sha256)) = claude_settings {
                files.push(ManifestFile {
                    path: claude_path,
                    sha256: Some(claude_sha256),
                    provenance: Provenance::Created,
                });
            }
        }

        Ok(files)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// A phase that records its own name into a shared log and either
    /// succeeds (returning one tagged `ManifestFile`) or fails with a
    /// fixed message -- lets tests assert ordering and fail-fast
    /// behavior without touching the real filesystem-backed phases.
    /// `dependencies` lets a test exercise `run_all_phases`'s ordering
    /// check directly (see `mock_with_dependencies` below) without
    /// requiring the real `AgentInstallPhase`/filesystem phases.
    struct MockPhase {
        name: &'static str,
        log: Arc<Mutex<Vec<&'static str>>>,
        fail: bool,
        dependencies: &'static [&'static str],
    }

    impl InstallPhase for MockPhase {
        fn name(&self) -> &'static str {
            self.name
        }

        fn dependencies(&self) -> &'static [&'static str] {
            self.dependencies
        }

        fn run(
            &self,
            _staged_root: &Path,
            _target_dir: &Path,
            _repo_root: Option<&Path>,
            _prior_manifest: Option<&Manifest>,
            _phase_outputs: &PhaseOutputs,
            _no_telemetry: bool,
        ) -> Result<Vec<ManifestFile>, InstallError> {
            self.log.lock().unwrap().push(self.name);
            if self.fail {
                return Err(InstallError::Message(format!("{} failed", self.name)));
            }
            Ok(vec![ManifestFile {
                path: format!("mock/{}", self.name),
                sha256: None,
                provenance: super::super::manifest::Provenance::default(),
            }])
        }
    }

    fn mock(
        name: &'static str,
        log: &Arc<Mutex<Vec<&'static str>>>,
        fail: bool,
    ) -> Box<dyn InstallPhase> {
        mock_with_dependencies(name, log, fail, &[])
    }

    fn mock_with_dependencies(
        name: &'static str,
        log: &Arc<Mutex<Vec<&'static str>>>,
        fail: bool,
        dependencies: &'static [&'static str],
    ) -> Box<dyn InstallPhase> {
        Box::new(MockPhase {
            name,
            log: Arc::clone(log),
            fail,
            dependencies,
        })
    }

    #[test]
    fn run_all_runs_every_phase_in_order_and_collects_all_files() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let phases = vec![
            mock("first", &log, false),
            mock("second", &log, false),
            mock("third", &log, false),
        ];

        let files = run_all_phases(
            &phases,
            Path::new("staged"),
            Path::new("target"),
            None,
            None,
            false,
        )
        .expect("all mock phases succeed");

        assert_eq!(*log.lock().unwrap(), vec!["first", "second", "third"]);
        assert_eq!(
            files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
            vec!["mock/first", "mock/second", "mock/third"]
        );
    }

    #[test]
    fn run_all_stops_at_first_failing_phase() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let phases = vec![
            mock("first", &log, false),
            mock("second", &log, true),
            mock("third", &log, false),
        ];

        let err = run_all_phases(
            &phases,
            Path::new("staged"),
            Path::new("target"),
            None,
            None,
            false,
        )
        .expect_err("the second phase's failure must stop the chain");
        assert!(err.contains("second failed"));
        assert_eq!(
            *log.lock().unwrap(),
            vec!["first", "second"],
            "the third phase must never run once an earlier phase fails"
        );
    }

    /// `run_all_phases` rejects a phase list containing two entries
    /// with the same `name()` up front, before running any of them --
    /// see the function's own doc comment for why. Pins both halves of
    /// that behavior: the error is returned, and NEITHER same-named
    /// phase ever runs (not even the first).
    #[test]
    fn run_all_phases_rejects_a_duplicate_phase_name_before_running_any_phase() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let phases = vec![mock("dup", &log, false), mock("dup", &log, false)];

        let err = run_all_phases(
            &phases,
            Path::new("staged"),
            Path::new("target"),
            None,
            None,
            false,
        )
        .expect_err("a duplicate phase name must be rejected before running anything");

        assert!(
            err.contains("dup"),
            "the error must name the duplicate phase"
        );
        assert!(
            log.lock().unwrap().is_empty(),
            "neither same-named phase must run once the upfront uniqueness check rejects the list"
        );
    }

    #[test]
    fn standard_install_phases_returns_five_phases_with_agents_last() {
        let phases = standard_install_phases();
        let names: Vec<&str> = phases.iter().map(|p| p.name()).collect();
        assert_eq!(names.len(), 5);
        assert_eq!(
            names.last().copied(),
            Some("agents"),
            "agents must run last: it depends on skills, the mcp binary, \
             and context already being installed"
        );
        assert!(names.contains(&"skills"));
        assert!(names.contains(&"mcp"));
        assert!(names.contains(&"sops"));
        assert!(names.contains(&"context"));
        let agent_index = names.iter().position(|n| *n == "agents").unwrap();
        let skills_index = names.iter().position(|n| *n == "skills").unwrap();
        let mcp_index = names.iter().position(|n| *n == "mcp").unwrap();
        let context_index = names.iter().position(|n| *n == "context").unwrap();
        assert!(skills_index < agent_index);
        assert!(mcp_index < agent_index);
        assert!(context_index < agent_index);
    }

    /// Every phase `name()` in the default chain must be distinct --
    /// `PhaseOutputs::files_from` looks a phase's recorded output up by
    /// this exact name (see `AgentInstallPhase::run`'s lookup of
    /// `McpInstallPhase.name()`), so a duplicate name would make that
    /// lookup ambiguous. A dedup-based check (collect into a
    /// `HashSet`, compare lengths) is the direct way to assert this.
    #[test]
    fn phase_names_are_unique() {
        let phases = standard_install_phases();
        let names: Vec<&str> = phases.iter().map(|p| p.name()).collect();
        let unique: std::collections::HashSet<&str> = names.iter().copied().collect();
        assert_eq!(
            names.len(),
            unique.len(),
            "duplicate phase name(s) found in standard_install_phases(): {names:?}"
        );
    }

    /// `staged_root`'s own name is how `SopInstallPhase::run` decides
    /// which branch (if any) to take -- an unrecognized name (neither
    /// Kiro's nor Claude's own harness dir) is a no-op, not an error.
    #[test]
    fn sop_install_phase_is_a_no_op_for_an_unrecognized_staged_root() {
        let files = SopInstallPhase
            .run(
                Path::new("staged"),
                Path::new("target"),
                None,
                None,
                &PhaseOutputs::new(),
                false,
            )
            .expect("sop phase never fails");
        assert!(files.is_empty());
    }

    /// The Kiro branch fires whenever `staged_root` is Kiro's own
    /// harness dir (`dist/kiro-cli-v2/`), copying every staged `.sop.md`
    /// file verbatim into `.konductor/sops/` -- unconditional, not
    /// gated on `detect_runtimes` (see this struct's own doc comment for
    /// why `detect_runtimes` alone would be wrong for a from-scratch
    /// install, which has no `.kiro` marker on disk yet at this point in
    /// the chain).
    #[test]
    fn sop_install_phase_kiro_branch_copies_staged_sops_into_konductor_sops() {
        let dir = std::env::temp_dir().join(format!(
            "konductor-phases-sop-kiro-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target_dir = dir.join("target");
        let staged_root = dir.join("dist").join("kiro-cli-v2");
        let sops_dir = staged_root.join("sops");
        std::fs::create_dir_all(&sops_dir).unwrap();
        std::fs::write(sops_dir.join("ticket-sync.sop.md"), b"# Ticket Sync\n").unwrap();

        let files = SopInstallPhase
            .run(
                &staged_root,
                &target_dir,
                None,
                None,
                &PhaseOutputs::new(),
                false,
            )
            .expect("Kiro branch must succeed with no pre-existing .claude marker");

        assert_eq!(files.len(), 1);
        assert_eq!(
            std::fs::read(target_dir.join(".konductor/sops/ticket-sync.sop.md")).unwrap(),
            b"# Ticket Sync\n"
        );
        assert!(
            !target_dir.join(".claude").exists(),
            "no Claude output must be produced without a pre-existing .claude marker"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The Claude branch fires whenever `staged_root` is Claude's own
    /// harness dir (`dist/claude/`), converting every staged `.sop.md`
    /// file into a `sop-<name>/SKILL.md` under `.claude/skills/`.
    #[test]
    fn sop_install_phase_claude_branch_converts_staged_sops_into_skill_md() {
        let dir = std::env::temp_dir().join(format!(
            "konductor-phases-sop-claude-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target_dir = dir.join("target");
        let staged_root = dir.join("dist").join("claude");
        let sops_dir = staged_root.join("sops");
        std::fs::create_dir_all(&sops_dir).unwrap();
        std::fs::write(sops_dir.join("ticket-sync.sop.md"), b"# Ticket Sync\n").unwrap();

        let files = SopInstallPhase
            .run(
                &staged_root,
                &target_dir,
                None,
                None,
                &PhaseOutputs::new(),
                false,
            )
            .expect("Claude branch must succeed");

        assert_eq!(files.len(), 1);
        let rendered =
            std::fs::read_to_string(target_dir.join(".claude/skills/sop-ticket-sync/SKILL.md"))
                .expect("expected a converted SKILL.md");
        assert!(rendered.contains("name: \"sop-ticket-sync\""));
        assert!(rendered.contains("disable-model-invocation: true"));
        assert!(rendered.contains("<agent-sop name=\"ticket-sync\">"));
        assert!(rendered.contains("# Ticket Sync"));
        assert!(
            !target_dir.join(".konductor/sops").exists(),
            "no Kiro-side output must be produced by the Claude branch"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Additive dual-marker case, mirroring `AgentInstallPhase`'s own
    /// Claude/V3 settings-grant branch: when this run is Kiro's own
    /// (`staged_root` is Kiro's harness dir) but the target ALREADY has
    /// a pre-existing `.claude` marker, the Claude conversion ALSO runs,
    /// sourced from `repo_root` (never from `staged_root`, which is
    /// Kiro's harness dir here, not Claude's).
    #[test]
    fn sop_install_phase_kiro_chain_additively_converts_claude_sops_when_claude_marker_preexists() {
        let dir = std::env::temp_dir().join(format!(
            "konductor-phases-sop-dual-marker-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target_dir = dir.join("target");
        let repo_root = dir.join("repo");
        std::fs::create_dir_all(target_dir.join(".claude")).unwrap();

        let kiro_staged_root = repo_root.join("dist").join("kiro-cli-v2");
        let kiro_sops_dir = kiro_staged_root.join("sops");
        std::fs::create_dir_all(&kiro_sops_dir).unwrap();
        std::fs::write(kiro_sops_dir.join("ticket-sync.sop.md"), b"# Kiro copy\n").unwrap();

        let claude_sops_dir = repo_root.join("dist").join("claude").join("sops");
        std::fs::create_dir_all(&claude_sops_dir).unwrap();
        std::fs::write(
            claude_sops_dir.join("ticket-sync.sop.md"),
            b"# Claude copy\n",
        )
        .unwrap();

        let files = SopInstallPhase
            .run(
                &kiro_staged_root,
                &target_dir,
                Some(&repo_root),
                None,
                &PhaseOutputs::new(),
                false,
            )
            .expect("dual-marker run must succeed");

        assert_eq!(
            files.len(),
            2,
            "expected one Kiro-side and one Claude-side output file"
        );
        assert_eq!(
            std::fs::read(target_dir.join(".konductor/sops/ticket-sync.sop.md")).unwrap(),
            b"# Kiro copy\n"
        );
        let rendered =
            std::fs::read_to_string(target_dir.join(".claude/skills/sop-ticket-sync/SKILL.md"))
                .unwrap();
        assert!(
            rendered.contains("# Claude copy"),
            "the additive Claude branch must read from repo_root's OWN dist/claude/sops/, not \
             from staged_root (Kiro's harness dir)"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Most phases have no precondition -- the default `check_preconditions`
    /// impl must accept `None` (and, symmetrically, `Some`) without error.
    #[test]
    fn most_phases_have_no_precondition() {
        SopInstallPhase
            .check_preconditions(None)
            .expect("SopInstallPhase has no precondition");
        SkillInstallPhase
            .check_preconditions(None)
            .expect("SkillInstallPhase has no precondition");
        ContextInstallPhase
            .check_preconditions(None)
            .expect("ContextInstallPhase has no precondition");
        AgentInstallPhase
            .check_preconditions(None)
            .expect("AgentInstallPhase has no precondition");
    }

    /// `McpInstallPhase` is the one phase with a real precondition: it
    /// needs `repo_root: Some(_)`. `check_preconditions` must reject
    /// `None` with the same message `run` itself would fail with, and
    /// must accept `Some(_)`.
    #[test]
    fn mcp_install_phase_check_preconditions_requires_repo_root() {
        let err = McpInstallPhase
            .check_preconditions(None)
            .expect_err("McpInstallPhase requires repo_root: Some(_)");
        assert!(err.contains("remote release installation is not yet available"));

        McpInstallPhase
            .check_preconditions(Some(Path::new("/some/repo/root")))
            .expect("McpInstallPhase accepts repo_root: Some(_)");
    }

    /// `run_all_phases` must call each phase's `check_preconditions`
    /// up front, before running ANY phase -- the same eagerness as its
    /// own duplicate-name check (see
    /// `run_all_phases_rejects_a_duplicate_phase_name_before_running_any_phase`
    /// above). Uses the real `McpInstallPhase` (the only phase with a
    /// real precondition) ordered AFTER a mock phase that would record
    /// its own name if it ran, so a failure to reject `repo_root: None`
    /// up front would be visible as the mock phase's name appearing in
    /// the log.
    #[test]
    fn run_all_phases_rejects_a_missing_precondition_before_running_any_phase() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let phases: Vec<Box<dyn InstallPhase>> =
            vec![mock("first", &log, false), Box::new(McpInstallPhase)];

        let err = run_all_phases(
            &phases,
            Path::new("staged"),
            Path::new("target"),
            None,
            None,
            false,
        )
        .expect_err("McpInstallPhase's missing repo_root must be rejected up front");
        assert!(err.contains("remote release installation is not yet available"));
        assert!(
            log.lock().unwrap().is_empty(),
            "the mock phase ordered before McpInstallPhase must never run once the upfront \
             precondition check rejects the list"
        );
    }

    /// `McpInstallPhase::run` unwraps `repo_root` only after calling
    /// `check_preconditions` itself (see the phase's own doc comment
    /// for why there is no separately-maintained inline
    /// `repo_root.is_none()` check) -- so calling `run` directly with
    /// `repo_root: None`, bypassing `run_all_phases` entirely, must
    /// still fail with the same message `check_preconditions` returns,
    /// not panic on the `expect()` inside `run`.
    #[test]
    fn mcp_install_phase_run_rejects_a_missing_repo_root_even_when_called_directly() {
        let err = McpInstallPhase
            .run(
                Path::new("staged"),
                Path::new("target"),
                None,
                None,
                &PhaseOutputs::new(),
                false,
            )
            .expect_err("run must reject repo_root: None even when called directly");
        assert!(err.contains("remote release installation is not yet available"));
    }

    /// `AgentInstallPhase` declares the three phases its resource-
    /// rewrite verification needs already on disk (see its own doc
    /// comment) via `dependencies()`, not just via its position in
    /// `standard_install_phases()`.
    #[test]
    fn agent_install_phase_declares_its_real_ordering_dependencies() {
        let deps = AgentInstallPhase.dependencies();
        assert!(deps.contains(&"skills"));
        assert!(deps.contains(&"mcp"));
        assert!(deps.contains(&"context"));
    }

    /// `run_all_phases` rejects a phase list where a phase's declared
    /// `dependencies()` names a phase that has not appeared earlier in
    /// the same list -- up front, before running any phase. This is
    /// what makes the ordering constraint `AgentInstallPhase` declares
    /// enforced by the trait itself: a future caller that reorders or
    /// drops a dependency now fails loudly here, rather than only much
    /// later inside the dependent phase's own `run`, or not at all if
    /// that reordered path is never exercised by a test.
    #[test]
    fn run_all_phases_rejects_a_phase_ordered_before_its_declared_dependency() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let phases: Vec<Box<dyn InstallPhase>> = vec![
            mock_with_dependencies("dependent", &log, false, &["missing-dep"]),
            mock("missing-dep", &log, false),
        ];

        let err = run_all_phases(
            &phases,
            Path::new("staged"),
            Path::new("target"),
            None,
            None,
            false,
        )
        .expect_err("a phase ordered before its own declared dependency must be rejected up front");
        assert!(
            err.contains("dependent"),
            "error must name the dependent phase"
        );
        assert!(
            err.contains("missing-dep"),
            "error must name the unmet dependency"
        );
        assert!(
            log.lock().unwrap().is_empty(),
            "no phase must run once the upfront dependency-ordering check rejects the list"
        );
    }

    /// `run_all_phases` rejects a phase that names *itself* in its own
    /// `dependencies()`. The dependency check runs against `seen_names`
    /// before this phase's own name is inserted into that set, so a
    /// self-reference can never be trivially satisfied by the phase's
    /// own not-yet-recorded name -- it is checked, and rejected, the
    /// same way any other unmet dependency is.
    #[test]
    fn run_all_phases_rejects_a_phase_that_declares_itself_as_its_own_dependency() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let phases: Vec<Box<dyn InstallPhase>> = vec![mock_with_dependencies(
            "self-referential",
            &log,
            false,
            &["self-referential"],
        )];

        let err = run_all_phases(
            &phases,
            Path::new("staged"),
            Path::new("target"),
            None,
            None,
            false,
        )
        .expect_err(
            "a phase declaring itself as its own dependency must be rejected, not \
             silently accepted",
        );
        assert!(
            err.contains("self-referential"),
            "error must name the self-referential phase"
        );
        assert!(
            log.lock().unwrap().is_empty(),
            "the self-referential phase must never run once its own dependency check rejects it"
        );
    }

    /// The positive counterpart to the rejection test above: every
    /// phase's declared `dependencies()` must actually be satisfied by
    /// `standard_install_phases()`'s own chosen order. Walks the same
    /// `name()`/`dependencies()` pair `run_all_phases` itself checks,
    /// without running any phase's real filesystem-backed `run`.
    #[test]
    fn standard_install_phases_satisfies_every_declared_dependency() {
        let phases = standard_install_phases();
        let names: Vec<&str> = phases.iter().map(|p| p.name()).collect();
        for (index, phase) in phases.iter().enumerate() {
            for dep in phase.dependencies() {
                let dep_index = names.iter().position(|n| n == dep).unwrap_or_else(|| {
                    panic!(
                        "phase {:?} declares dependency {:?}, which does not appear \
                         anywhere in standard_install_phases()",
                        phase.name(),
                        dep
                    )
                });
                assert!(
                    dep_index < index,
                    "phase {:?} (at index {index}) depends on {:?}, which must appear \
                     earlier in standard_install_phases(), but is at index {dep_index}",
                    phase.name(),
                    dep
                );
            }
        }
    }

    #[test]
    fn context_install_phase_wraps_install_context() {
        assert_eq!(ContextInstallPhase.name(), "context");
    }

    /// A minimal `ManifestFile` for tests that only care about `path` --
    /// mirrors `resource_rewrite.rs`'s own `bin_file_entry` test helper
    /// for the same reason: every `PhaseOutputs` test below cares which
    /// path came back, never the hash or provenance.
    fn mf(path: &str) -> ManifestFile {
        ManifestFile {
            path: path.to_string(),
            sha256: None,
            provenance: super::super::manifest::Provenance::default(),
        }
    }

    /// `record`-ing the same phase name twice directly against a
    /// `PhaseOutputs` (bypassing `run_all_phases`'s own upfront
    /// uniqueness check -- see its doc comment) leaves the SECOND
    /// recording unreachable via `files_from`, even though `all_files()`
    /// still includes it. `.find()`'s first-match semantics, made
    /// explicit rather than left implicit, for this lower-level type.
    #[test]
    fn phase_outputs_files_from_returns_only_the_first_recorded_entry_for_a_duplicate_name() {
        let mut outputs = PhaseOutputs::new();
        outputs.record("dup", vec![mf("first")]);
        outputs.record("dup", vec![mf("second")]);

        let files = outputs.files_from("dup");
        assert_eq!(files.len(), 1);
        assert_eq!(
            files[0].path, "first",
            "files_from must return the FIRST recorded entry for a duplicate name, \
             not the most recent one"
        );
    }

    #[test]
    fn phase_outputs_files_from_returns_a_recorded_phase_s_own_files() {
        let mut outputs = PhaseOutputs::new();
        outputs.record("mcp", vec![mf(".konductor/bin/skill-lookup-mcp")]);
        outputs.record("skills", vec![mf(".konductor/skills/constraints/SKILL.md")]);

        let mcp_files = outputs.files_from("mcp");
        assert_eq!(mcp_files.len(), 1);
        assert_eq!(mcp_files[0].path, ".konductor/bin/skill-lookup-mcp");

        let skills_files = outputs.files_from("skills");
        assert_eq!(skills_files.len(), 1);
        assert_eq!(
            skills_files[0].path,
            ".konductor/skills/constraints/SKILL.md"
        );
    }

    /// A phase that has not run yet in this chain (never recorded,
    /// whether because a caller reordered the chain or omitted that
    /// phase entirely) must look up as an empty slice, not panic -- the
    /// fail-safe this module's own doc comment documents for
    /// `AgentInstallPhase` looking up `McpInstallPhase`'s output in a
    /// reordered or MCP-less chain.
    #[test]
    fn phase_outputs_files_from_is_empty_for_a_phase_that_has_not_run_yet() {
        let outputs = PhaseOutputs::new();
        assert!(outputs.files_from("mcp").is_empty());

        let mut outputs = PhaseOutputs::new();
        outputs.record("skills", vec![]);
        assert!(
            outputs.files_from("mcp").is_empty(),
            "querying an unrecorded phase name must return empty, not panic, even when \
             OTHER phases have already recorded output"
        );
    }

    #[test]
    fn phase_outputs_all_files_flattens_every_recorded_phase_in_order() {
        let mut outputs = PhaseOutputs::new();
        outputs.record("skills", vec![mf("a")]);
        outputs.record("mcp", vec![mf("b")]);

        let files = outputs.all_files();
        let all: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(all, vec!["a", "b"]);
    }
}
