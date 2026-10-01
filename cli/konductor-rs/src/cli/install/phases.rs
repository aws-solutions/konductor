// SPDX-License-Identifier: Apache-2.0
//
// install/phases.rs — `InstallPhase`: an explicit, ordered pipeline
// replacing `install_from_local`'s previous fixed hand-written call
// chain (context -> skills -> MCP binary -> agents).
//
// Mirrors `resource_rewrite::apply_all` and `synth::dispatch_synth_with`
// in shape: a free function running every entry in a fixed slice in
// order, failing fast on the first `Err`. `InstallPhase` additionally
// has `name()` and `dependencies()`, since `run_all_phases` validates
// ordering explicitly instead of relying on a hand-maintained list
// order.
//
// `InstallPhase::run` takes `(staged_root, target_dir, repo_root,
// prior_manifest, phase_outputs, no_telemetry)`:
// - `prior_manifest` is read exactly once, before the write-ahead
//   `Status::InProgress` manifest overwrites `.konductor/manifest` on
//   disk, and passed to every phase by reference. A phase re-reading
//   the manifest mid-chain would see that just-written in-progress
//   state instead (every `sha256: None`).
// - `phase_outputs: &PhaseOutputs` lets `AgentInstallPhase` know which
//   MCP server binaries this install run actually copied, to decide
//   whether to inject an `mcpServers` entry. Checking disk existence
//   instead would be wrong: a prior install's copy can still be
//   sitting on disk after the source binary was removed
//   (`install_bin_files` never deletes a no-longer-sourced binary),
//   which would re-inject a stale path. `files_from` returning an
//   empty slice for a phase that has not run yet is a deliberate
//   fail-safe matching `mcp_server.rs`'s "a missing binary is not an
//   error" behavior.
//
// `standard_install_phases()` runs skills and the MCP binary first,
// then context, then agents last: `AgentInstallPhase`'s resource
// rewrite verifies every rewritten resource and injected `mcpServers`
// target exists on disk, so those three must already be installed.
// This dependency is declared via `AgentInstallPhase::dependencies()`
// and validated structurally by `run_all_phases` before any phase
// runs. Context gets its own phase (rather than folding into
// `AgentInstallPhase`) so `PhaseOutputs` records context files and
// agent files under two distinct names. `SopInstallPhase` is its own
// phase since it runs in both runtimes' chains with its own
// additive-branch behavior.
//
// Because context/agent install run last, a crash mid-install can
// leave skills and the MCP binary already on disk while context/agent
// installation never started. This is safe: the write-ahead
// `Status::InProgress` manifest already anticipates an arbitrary
// partial on-disk state, and a rerun's provenance/dropped-file-cleanup
// logic converges regardless of which subset of files a prior run
// reached (see `install_from_local_recovers_when_agent_phase_never_ran`
// in `kiro_cli.rs`).

use std::collections::HashSet;
use std::path::Path;

use super::manifest::{ManifestFile, StrategyManifest};
use super::runtime::{detect_runtimes, Runtime};
use super::InstallError;

/// One self-contained step of `install_from_local`'s copy work. Each
/// implementation is independently callable, which is what makes
/// every phase unit-testable without running the whole chain.
pub(super) trait InstallPhase {
    /// Stable identifier for this phase: `run_all_phases` records each
    /// phase's output under this name into `PhaseOutputs`, so a later
    /// phase can look its predecessor's output up by name via
    /// `PhaseOutputs::files_from`. Must be unique within a given phase
    /// list; `run_all_phases` rejects a duplicate name up front.
    fn name(&self) -> &'static str;

    /// Checked for every phase, in order, before any phase's `run` is
    /// called. Default: no precondition. Only `McpInstallPhase`
    /// overrides this today (it needs `repo_root: Some(_)`).
    fn check_preconditions(&self, _repo_root: Option<&Path>) -> Result<(), InstallError> {
        Ok(())
    }

    /// Names of other phases (by their own `name()`) that must appear
    /// earlier than this one in the same `run_all_phases` call.
    /// Default: no dependency. Only `AgentInstallPhase` overrides this
    /// today, declaring the three phases its resource-rewrite
    /// verification needs already on disk.
    fn dependencies(&self) -> &'static [&'static str] {
        &[]
    }

    /// Performs this phase's copy work and returns the `ManifestFile`
    /// entries it wrote, with a placeholder provenance; the real
    /// per-file provenance is attached once, over every phase's
    /// combined output, by `install_from_local` after `run_all_phases`
    /// returns (via `attach_provenance`).
    ///
    /// `staged_root` is the synthed `dist/<harness>/` tree; `repo_root`
    /// is the already-parsed `--from <repo-root>` path, `None` only if
    /// validation was skipped. `no_telemetry` carries `install`'s own
    /// `--no-telemetry` flag; every phase receives it, even though
    /// only `AgentInstallPhase` today has telemetry side effects to
    /// gate on it.
    fn run(
        &self,
        staged_root: &Path,
        target_dir: &Path,
        repo_root: Option<&Path>,
        prior_manifest: Option<&StrategyManifest>,
        phase_outputs: &PhaseOutputs,
        no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError>;
}

/// The `ManifestFile`s every phase in this `run_all_phases` call has
/// produced so far, addressable by phase name. `run_all_phases` builds
/// one as it iterates and passes it to each phase in turn; nothing
/// outside this module constructs one directly.
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
    /// returns, so a phase's own `files_from` lookup only ever sees
    /// earlier phases' output.
    fn record(&mut self, phase_name: &'static str, files: Vec<ManifestFile>) {
        self.by_phase.push((phase_name, files));
    }

    /// The files the phase named `phase_name` returned, or an empty
    /// slice if that phase has not run (yet) in this call; fails safe
    /// rather than panicking, matching `mcp_server.rs`'s own "a
    /// missing binary is not an error" convention.
    pub(super) fn files_from(&self, phase_name: &str) -> &[ManifestFile] {
        self.by_phase
            .iter()
            .find(|(name, _)| *name == phase_name)
            .map(|(_, files)| files.as_slice())
            .unwrap_or(&[])
    }

    /// Every file every phase recorded so far, flattened in recording
    /// order. `run_all_phases` calls this once, after the loop, to
    /// build its own return value.
    fn all_files(&self) -> Vec<ManifestFile> {
        self.by_phase
            .iter()
            .flat_map(|(_, files)| files.iter().cloned())
            .collect()
    }
}

/// Runs every phase in `phases`, in order, feeding each one a
/// `PhaseOutputs` containing every earlier phase's output from this
/// same call. Fails fast on the first `Err`, returning it immediately
/// without running any later phase.
///
/// Validates every phase's preconditions up front, before running any
/// of them:
/// - Rejects `phases` if it contains two entries with the same
///   `name()`.
/// - Rejects `phases` if any phase's own `dependencies()` names a
///   phase that has not appeared earlier in the same list, including
///   a phase naming itself.
/// - Calls each phase's own `check_preconditions(repo_root)` (e.g.
///   `McpInstallPhase`'s `repo_root: Some(_)` requirement) up front
///   rather than only once that phase's own `run` happens to execute.
pub(super) fn run_all_phases(
    phases: &[Box<dyn InstallPhase>],
    staged_root: &Path,
    target_dir: &Path,
    repo_root: Option<&Path>,
    prior_manifest: Option<&StrategyManifest>,
    no_telemetry: bool,
) -> Result<Vec<ManifestFile>, InstallError> {
    let mut seen_names = HashSet::with_capacity(phases.len());
    for phase in phases {
        // Dependency check runs against `seen_names` before this
        // phase's own name is inserted below, so a phase that names
        // itself in `dependencies()` is correctly rejected rather than
        // trivially satisfied.
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

/// The default phase list: all 5 artifact categories
/// `install_from_local` handles today, in the order their real
/// dependencies require (skills, the MCP binary, and context before
/// agents). `SopInstallPhase` copies every staged `.sop.md` file into
/// `.konductor/sops/` (and additively converts them into
/// `.claude/skills/sop-<name>/SKILL.md` when a `.claude` marker
/// already exists at the target). Adding a sixth phase is a new
/// `struct FooInstallPhase` plus one `Box::new(FooInstallPhase)` line
/// here.
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
        prior_manifest: Option<&StrategyManifest>,
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
/// The only phase that needs `repo_root: Some(_)`; overrides
/// `check_preconditions` so `run_all_phases` validates this upfront.
/// `run` below calls `check_preconditions` itself too, so a caller
/// that invokes `run` directly, bypassing `run_all_phases`, still gets
/// the same rejection.
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
        _prior_manifest: Option<&StrategyManifest>,
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
/// `standard_claude_install_phases()` (Claude), unlike skills/agents
/// which each runtime handles with its own dedicated phase
/// (`SkillInstallPhase` vs `ClaudeSkillInstallPhase`,
/// `AgentInstallPhase` vs `ClaudeAgentInstallPhase`).
///
/// `run` decides which chain invoked it from `staged_root`'s own name
/// (`KiroCliV2Transformer.name()` vs `CLAUDE_HARNESS_DIR`), not from
/// `detect_runtimes(target_dir)`: that check is presence-only against
/// pre-existing marker directories on disk, so it cannot reliably
/// distinguish this run's own primary runtime from "no marker yet,
/// because this is that runtime's first-ever install."
///
/// - Kiro CLI branch (whenever `staged_root` is Kiro's own harness
///   dir): copies every staged `.sop.md` file verbatim into
///   `.konductor/sops/` via `kiro_cli::install_sops`.
/// - Claude Code branch (whenever `staged_root` is Claude's own
///   harness dir): converts every staged `.sop.md` file into a
///   `sop-<name>/SKILL.md` under `.claude/skills/` via
///   `claude::install_sop_skills`, since Claude Code has no MCP-prompt
///   equivalent to serve `.sop.md` files directly.
/// - Claude Code additive branch, reached from within Kiro's own
///   chain (mirrors `AgentInstallPhase`'s own additive Claude/V3
///   settings-grant branch): when this run's `staged_root` is Kiro's,
///   but the target also has a pre-existing `.claude` marker, also
///   runs the Claude conversion, always re-deriving its own source
///   directory from `repo_root` (`<repo_root>/dist/claude/sops/`),
///   never from `staged_root`.
///
/// Silently no-ops the additive Claude branch when `repo_root` is
/// `None`: both real `InstallStrategy::install_from_local`
/// implementations always pass `Some(repo_root)`, so this only
/// matters for a test harness constructing a phase chain directly
/// with no repo root.
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
        _prior_manifest: Option<&StrategyManifest>,
        _phase_outputs: &PhaseOutputs,
        _no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError> {
        use crate::cli::synth::kiro_cli_v2::KiroCliV2Transformer;
        use crate::cli::synth::HarnessTransformer as _;

        let staged_root_name = staged_root.file_name().and_then(|n| n.to_str());
        let mut files = Vec::new();

        if staged_root_name == Some(KiroCliV2Transformer.name()) {
            files.extend(super::kiro_cli::install_sops(staged_root, target_dir)?);
            // Kiro-discoverable conversion, alongside the raw copy
            // above. Primary content type for this chain, not
            // additive/marker-gated.
            files.extend(super::kiro_cli::install_kiro_sop_skills(
                staged_root,
                target_dir,
            )?);

            // Additive Claude branch: this run is Kiro's own, but the
            // target also has a pre-existing `.claude` marker.
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
/// Given its own phase (rather than being folded into
/// `AgentInstallPhase`) so `PhaseOutputs` records context files under
/// their own `"context"` name, distinct from `"agents"`.
/// `AgentInstallPhase::run`'s resource rewrite needs the context
/// directory to already exist on disk, which is why this phase still
/// runs immediately before it.
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
        _prior_manifest: Option<&StrategyManifest>,
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
/// `ContextInstallPhase`, declared via `dependencies()` below.
///
/// `PhaseOutputs` contract: this phase's recorded output, under the
/// name `"agents"`, is agent files only; context files are recorded
/// separately under `ContextInstallPhase`'s own `"context"` name. The
/// additive Claude/V3 settings files are folded into this same
/// `"agents"` output rather than given their own name.
///
/// Also applies the Claude/V3 settings grant when `install_agents`
/// reports it should fire. This lives here, not in `run_all_phases` or
/// a later phase, because this is the one place that already holds
/// `install_agents`'s own `any_mcp_server_injected` return value, the
/// single signal the grant is gated on.
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
        _prior_manifest: Option<&StrategyManifest>,
        phase_outputs: &PhaseOutputs,
        no_telemetry: bool,
    ) -> Result<Vec<ManifestFile>, InstallError> {
        // The set of MCP server binaries this run actually copied,
        // never re-derived from disk existence. Looked up by
        // `McpInstallPhase`'s own name so the two can never drift
        // apart.
        let bin_files = phase_outputs.files_from(McpInstallPhase.name());
        let (mut files, any_mcp_server_injected) =
            super::kiro_cli::install_agents(staged_root, target_dir, bin_files, no_telemetry)?;

        // Additive, Claude/V3-only: mirrors the V2 grant's own scope
        // (only applies when V2 actually injected something into at
        // least one agent this run) and is applied exactly once for
        // the whole run, not per-agent.
        //
        // Deliberately non-fatal: most of `apply_claude_settings_grant`'s
        // failure modes (a symlinked `.claude`/`settings.json`, a
        // `permissions.deny` shadow, a malformed pre-existing
        // settings.json) are about pre-existing, user-owned content
        // this install did not create. Aborting the whole Kiro install
        // over an unrelated problem in a foreign Claude-side file would
        // be worse than skipping this one additive grant with a
        // warning; the Kiro side already succeeded by the time this
        // block runs.
        //
        // Telemetry hook wiring is folded into the same shared call
        // below, gated on the grant having just succeeded and on
        // `!no_telemetry`. The hooks go to `.claude/settings.local.json`
        // for a project install (`~/.claude/settings.json` for a `$HOME`
        // one), never the shared `settings.json`; under `--no-telemetry`
        // the call strips a prior install's hooks from both files
        // instead.
        if any_mcp_server_injected && detect_runtimes(target_dir).has(Runtime::ClaudeCode) {
            // Placeholder provenance (`Provenance::Created`), like
            // every other file this phase returns; the real per-file
            // provenance is attached once, over every phase's combined
            // output, by `install_from_local` after `run_all_phases`
            // returns.
            files.extend(
                super::resource_rewrite::apply_claude_settings_grant_and_hooks(
                    target_dir,
                    no_telemetry,
                    "Kiro CLI",
                ),
            );
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
    /// fixed message. `dependencies` lets a test exercise
    /// `run_all_phases`'s ordering check directly.
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
            _prior_manifest: Option<&StrategyManifest>,
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
    /// with the same `name()` up front, before running any of them.
    /// Pins both halves: the error is returned, and neither same-named
    /// phase ever runs.
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

    /// Every phase `name()` in the default chain must be distinct, so
    /// `PhaseOutputs::files_from` lookups by name are never ambiguous.
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
    /// which branch to take; an unrecognized name is a no-op, not an
    /// error.
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
    /// harness dir, copying every staged `.sop.md` file verbatim into
    /// `.konductor/sops/` and converting it into a Kiro-discoverable
    /// `sop-<name>/SKILL.md` under `.kiro/skills/`, both unconditional,
    /// not gated on `detect_runtimes`.
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

        assert_eq!(files.len(), 2);
        assert_eq!(
            std::fs::read(target_dir.join(".konductor/sops/ticket-sync.sop.md")).unwrap(),
            b"# Ticket Sync\n"
        );
        let sop_skill =
            std::fs::read_to_string(target_dir.join(".kiro/skills/sop-ticket-sync/SKILL.md"))
                .expect("expected a Kiro-discoverable SOP-skill conversion");
        assert!(sop_skill.contains("name: \"sop-ticket-sync\""));
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
    /// but the target already has a pre-existing `.claude` marker, the
    /// Claude conversion also runs, sourced from `repo_root`, never
    /// from `staged_root`.
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
            3,
            "expected the Kiro-side raw copy, the Kiro-discoverable skill conversion, \
             and the additive Claude-side skill conversion"
        );
        assert_eq!(
            std::fs::read(target_dir.join(".konductor/sops/ticket-sync.sop.md")).unwrap(),
            b"# Kiro copy\n"
        );
        let kiro_skill =
            std::fs::read_to_string(target_dir.join(".kiro/skills/sop-ticket-sync/SKILL.md"))
                .expect("expected a Kiro-discoverable SOP-skill conversion");
        assert!(
            kiro_skill.contains("# Kiro copy"),
            "the Kiro-discoverable conversion must read from staged_root (Kiro's own harness \
             dir), not repo_root's Claude staging dir"
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

    /// Most phases have no precondition; the default
    /// `check_preconditions` impl must accept `None` without error.
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

    /// `run_all_phases` must call each phase's `check_preconditions` up
    /// front, before running any phase. Uses the real `McpInstallPhase`
    /// ordered after a mock phase that would record its own name if it
    /// ran, so a failure to reject `repo_root: None` up front would be
    /// visible as the mock phase's name appearing in the log.
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
    /// `check_preconditions` itself, so calling `run` directly with
    /// `repo_root: None`, bypassing `run_all_phases`, must still fail
    /// with the same message, not panic.
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
    /// rewrite verification needs already on disk via
    /// `dependencies()`, not just via its position in
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
    /// the same list, up front, before running any phase.
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

    /// `run_all_phases` rejects a phase that names itself in its own
    /// `dependencies()`. The dependency check runs against
    /// `seen_names` before this phase's own name is inserted, so a
    /// self-reference can never be trivially satisfied.
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
    /// `standard_install_phases()`'s own chosen order.
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

    /// A minimal `ManifestFile` for tests that only care about `path`.
    fn mf(path: &str) -> ManifestFile {
        ManifestFile {
            path: path.to_string(),
            sha256: None,
            provenance: super::super::manifest::Provenance::default(),
        }
    }

    /// `record`-ing the same phase name twice directly against a
    /// `PhaseOutputs` leaves the second recording unreachable via
    /// `files_from`, even though `all_files()` still includes it.
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

    /// A phase that has not run yet in this chain must look up as an
    /// empty slice, not panic.
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
