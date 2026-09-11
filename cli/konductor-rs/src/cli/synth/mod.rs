// SPDX-License-Identifier: Apache-2.0
//
// synth/mod.rs — `konductor synth` dispatch and harness-transformer
// trait (Rust implementation). Model types live in `model.rs`; the
// `CanonicalModel` builder lives in `parse_canonical.rs`.
//
// `dispatch_synth` parses the source tree at `target_dir` (or `--from`,
// when given) into a `CanonicalModel` via `parse_canonical`, then runs
// every registered `registry::TRANSFORMERS` entry against it, writing
// output under `<source_dir>/dist/` -- never the process cwd. A parse
// failure or any transformer error maps to `EXIT_USAGE_ERROR` (64), never
// exit code 2 -- see init.rs's module docstring for the same rule applied
// there.
//
// ── Output reporting ──────────────────────────────────────────────────────
// `dispatch_synth` prints one terse summary line to stdout on success:
// the output root written and a per-content-type count
// (agents/skills/SOPs/context). The count reflects
// what synth actually WROTE, not merely what it parsed. Skills, SOPs and
// context files are emitted unconditionally, so their model count equals
// what was written; but an agent is written only if it targets a
// registered harness (see `agent_is_written`) -- an agent with no
// `clientConfig` section for any registered harness is parsed into the
// model yet skipped by every transformer, so it must not be counted (or
// listed under `-v`) as written. An empty model (nothing to build) gets
// its own explicit message rather than silent success.

use std::path::{Path, PathBuf};

pub mod claude;
pub mod kiro_cli_v2;
pub mod kiro_cli_v3;
pub mod model;
pub mod parse_canonical;
pub mod parser;
pub mod registry;

mod content_writers;
mod frontmatter;
pub(crate) mod package;
mod path_safety;
mod sidecar;
mod staging;

#[allow(unused_imports)]
pub use model::{AgentSpec, AuxiliaryFile, CanonicalModel, SkillDef, SopDef};
pub use parse_canonical::parse_canonical;

/// Every failure path in `dispatch_synth` maps to this exit code -- never
/// exit code 2, which is reserved for the "unresolved CRITICAL gate"
/// signal (see dispatch.rs's module docstring).
const EXIT_USAGE_ERROR: u8 = 64;

/// Maps a `std::env::consts::OS` value to its Rust target-triple
/// vendor/environment suffix (e.g. `"linux"` -> `"unknown-linux-gnu"`),
/// covering the three CI-runner OSes. Falls back to `"unknown-{os}"`
/// for anything else rather than guessing.
///
/// Takes `os` as a parameter (not read from `std::env::consts::OS`
/// directly) so tests can exercise all branches on one OS.
///
/// `pub(crate)` because `install::github` reuses this same OS/arch ->
/// triple mapping (through `artifact_filename` below) to figure out
/// the release-asset filename it expects for the current host, instead
/// of duplicating this logic.
pub(crate) fn target_triple_suffix(os: &str) -> String {
    match os {
        "linux" => "unknown-linux-gnu".to_string(),
        "macos" => "apple-darwin".to_string(),
        "windows" => "pc-windows-msvc".to_string(),
        other => format!("unknown-{other}"),
    }
}

/// Deterministic packaged-artifact filename:
/// `konductor-v<CARGO_PKG_VERSION>-<target-triple>.tar.gz`. Reuses
/// Cargo.toml's `version` field. The target triple is composed from
/// `std::env::consts::{ARCH, OS}` at runtime (this crate has no
/// `build.rs`, so `env!("TARGET")` isn't available).
///
/// `pub(crate)` because `install::github` calls this directly to work
/// out the exact filename a GitHub Release asset needs for the current
/// host. This is the one place that naming convention is defined, so
/// packaging (this module) and install (`install::github`) can't drift
/// apart.
pub(crate) fn artifact_filename() -> String {
    format!(
        "konductor-v{}-{}-{}.tar.gz",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::ARCH,
        target_triple_suffix(std::env::consts::OS)
    )
}

/// Directory the packaged artifact and its checksum sidecar are written
/// to: `<source_dir>/target/konductor-artifacts/`. Reuses this repo's
/// existing `target/` convention (already CargoBrazil/`cargo build`'s
/// own output directory, and already covered by `cli/.gitignore`'s
/// `konductor-rs/target/` entry) instead of adding a new gitignored
/// location. Deliberately a sibling of `output_root`
/// (`<source_dir>/dist/`), never a descendant: the artifact packages
/// `output_root`'s contents, so writing it inside `output_root` would
/// risk a later re-run archiving the previous run's own
/// artifact/sidecar into the new one. Named `konductor-artifacts`, not
/// bare `target/`, so a future non-artifact use of `target/` (e.g.
/// `cargo build`'s own output, when `--from` targets this crate's own
/// checkout) can't collide with it.
fn artifact_output_dir(source_dir: &Path) -> PathBuf {
    source_dir.join("target").join("konductor-artifacts")
}

/// Transforms a `CanonicalModel` into a specific harness's output.
/// Implementations register themselves in `synth::registry::TRANSFORMERS`.
/// Requires `Sync` since transformers live in a `static` slice.
pub trait HarnessTransformer: Sync {
    /// Stable identifier for this transformer.
    fn name(&self) -> &'static str;

    /// Transforms the canonical model into harness-specific output,
    /// writing under `output_root` -- never the process cwd. `output_root`
    /// is `dispatch_synth`'s `<source_dir>/dist/` directory, resolved
    /// relative to the source tree being synthesized (`--from` when
    /// given, else `target_dir`), not wherever `konductor` was invoked
    /// from.
    fn transform(&self, model: &CanonicalModel, output_root: &Path) -> Result<(), String>;
}

/// `konductor synth [--from ...]`: parses the source tree rooted at
/// `--from` (falling back to `target_dir`, normally the cwd, when
/// `--from` is absent) into a `CanonicalModel`, then runs every
/// registered `HarnessTransformer` against it in `registry::TRANSFORMERS`
/// order, writing output under `<source_dir>/dist/` -- never the process
/// cwd, so `--from <dir>` places output under `<dir>/dist/`, not
/// wherever `konductor` was invoked from. Returns `EXIT_USAGE_ERROR` (64)
/// on the first parse or transform failure; 0 once every transformer has
/// run successfully. Prints a summary of what was written to stdout on
/// success (see `format_summary`); errors stay on stderr as before.
///
/// `verbose`/`json` are `cli.verbose`/`cli.json` (the global `-v`/
/// `--json` flags): `verbose` appends a per-file detail listing after
/// the summary line; `json` replaces the whole human-readable report
/// with one `format_summary_json` line instead (mutually exclusive with
/// `verbose` -- `json` wins if both are set, same precedence
/// `install::dispatch_install_with` uses).
///
/// ── Cross-transformer failure is NOT rolled back ─────────────────────
/// The loop below is fail-fast with no rollback ACROSS transformers.
/// Say `kiro-cli-v2` finishes all four of its own `stage_content_type`
/// swaps, then `claude` (registered later) fails partway through its
/// own four: this function still returns `EXIT_USAGE_ERROR` for the
/// call as a whole, but `kiro-cli-v2`'s output stays on disk, fully
/// and correctly updated (each `stage_content_type` call is
/// independently atomic -- see `staging.rs`), while `claude`'s own
/// output tree is now a mix of updated and stale content types, split
/// at whichever one it failed on. So a non-zero exit code does NOT
/// mean "nothing under `dist/` changed" -- part of the tree can be
/// ahead of the source that produced this run, another part behind
/// it. This is self-healing: the next successful `synth` run brings
/// every content type back to a consistent state (see
/// `synth_run_twice_produces_byte_identical_dist_output`), but there is
/// a real window, proportional to the number of registered
/// transformers, where `dist/` is torn between two generations of the
/// model. `second_transformer_failure_leaves_first_transformers_output_intact`
/// below asserts this exact, accepted behavior so it can't silently
/// regress into something worse (e.g. a rollback that only sometimes
/// runs). The alternative -- staging all of `dist/` in one shared temp
/// root with a single final atomic swap -- would be a materially
/// larger change than this diff's scope, so it's left as a follow-up
/// if the torn-state window above proves unacceptable in practice.
pub fn dispatch_synth_with(
    target_dir: &Path,
    from: Option<String>,
    verbose: bool,
    json: bool,
) -> u8 {
    let source_dir: PathBuf = match &from {
        Some(v) => PathBuf::from(v),
        None => target_dir.to_path_buf(),
    };
    let output_root: PathBuf = source_dir.join("dist");

    let model = match parse_canonical(&source_dir) {
        Ok(model) => model,
        Err(err) => {
            crate::cli::report::report_error(
                "synth",
                "synth.parse_canonical_failed",
                target_dir,
                false,
                &err.to_string(),
                Vec::new(),
                json,
            );
            return EXIT_USAGE_ERROR;
        }
    };

    // Transformer-layer defense-in-depth: every registered transformer
    // below receives this same `model` value, so this check runs once,
    // here, rather than each transformer duplicating an identical call
    // at the top of its own `transform` (see
    // `path_safety::reject_case_insensitive_model_collisions`'s own
    // docstring). Not integration-testable through this function's own
    // public `--from`/`target_dir` interface: any real source tree that
    // could trigger it is already rejected by `parse_canonical`'s own
    // `assert_unique_names` above, before reaching this line -- the
    // scenario this check exists for (a `CanonicalModel` built directly,
    // bypassing the parser) is only reachable, and only tested, at the
    // unit level in `path_safety.rs`.
    if let Err(err) = path_safety::reject_case_insensitive_model_collisions(&model) {
        crate::cli::report::report_error(
            "synth",
            "synth.case_insensitive_collision",
            target_dir,
            false,
            &err.to_string(),
            Vec::new(),
            json,
        );
        return EXIT_USAGE_ERROR;
    }

    // Name every transformer that already completed successfully in the
    // failure message, so a caller relying only on this process's exit
    // code (rather than
    // diffing `dist/` itself) can tell exactly which `dist/<name()>/`
    // subtrees are already updated to the new model vs. still stale --
    // see this function's own docstring above for the torn-state
    // window this is surfacing, not fixing.
    let mut completed: Vec<&str> = Vec::with_capacity(registry::TRANSFORMERS.len());
    for transformer in registry::TRANSFORMERS {
        if let Err(err) = transformer.transform(&model, &output_root) {
            let message = format_transformer_failure_message(transformer.name(), &err, &completed);
            crate::cli::report::report_error(
                "synth",
                "synth.transformer_failed",
                target_dir,
                false,
                &message,
                Vec::new(),
                json,
            );
            return EXIT_USAGE_ERROR;
        }
        completed.push(transformer.name());
    }

    // Package the now-complete dist/ tree and write its checksum sidecar
    // (transport-integrity only; see package.rs/sidecar.rs docstrings).
    // Runs only after every transformer has succeeded, so dist/ is
    // guaranteed consistent. Routed through `report_error` like the
    // arms above, so failures here also get the --json envelope and
    // telemetry.
    let artifact_bytes = match package::package_dist(&output_root) {
        Ok(bytes) => bytes,
        Err(err) => {
            crate::cli::report::report_error(
                "synth",
                "synth.package_failed",
                target_dir,
                false,
                &format!("failed to package dist/ tree: {err}"),
                Vec::new(),
                json,
            );
            return EXIT_USAGE_ERROR;
        }
    };
    let artifact_dir = artifact_output_dir(&source_dir);
    if let Err(err) = std::fs::create_dir_all(&artifact_dir) {
        crate::cli::report::report_error(
            "synth",
            "synth.artifact_dir_create_failed",
            target_dir,
            false,
            &format!(
                "failed to create artifact output directory {}: {err}",
                artifact_dir.display()
            ),
            Vec::new(),
            json,
        );
        return EXIT_USAGE_ERROR;
    }
    let artifact_path = artifact_dir.join(artifact_filename());
    if let Err(err) = std::fs::write(&artifact_path, &artifact_bytes) {
        crate::cli::report::report_error(
            "synth",
            "synth.artifact_write_failed",
            target_dir,
            false,
            &format!("failed to write packaged artifact: {err}"),
            Vec::new(),
            json,
        );
        return EXIT_USAGE_ERROR;
    }
    let sidecar_path = match sidecar::write_sidecar(&artifact_path, &artifact_bytes) {
        Ok(path) => path,
        Err(err) => {
            crate::cli::report::report_error(
                "synth",
                "synth.sidecar_write_failed",
                target_dir,
                false,
                &format!("failed to write checksum sidecar: {err}"),
                Vec::new(),
                json,
            );
            return EXIT_USAGE_ERROR;
        }
    };

    if json {
        println!(
            "{}",
            format_summary_json(&model, &output_root, &artifact_path, &sidecar_path)
        );
    } else {
        println!("{}", format_summary(&model, &output_root));
        if verbose {
            for line in format_verbose_lines(&model) {
                println!("{line}");
            }
        }
    }

    0
}

/// Builds the failure message `dispatch_synth_with` reports (via
/// `report::report_error`, which applies the `konductor synth: `
/// prefix in plain-text mode, or embeds this text verbatim as the
/// `--json` envelope's `error` field) when `failed_transformer` errors
/// with `err`, after `completed` (every transformer name that already
/// ran successfully, in registration order) -- see
/// `dispatch_synth_with`'s own docstring for the torn-state window
/// this surfaces. Extracted as a pure function (same pattern as
/// `format_summary`/`format_verbose_lines` below) so the exact message
/// text is directly testable without capturing stderr. Returns the
/// BARE message -- no `konductor synth: ` prefix -- so `report_error`
/// is the single place that decides how the prefix is applied,
/// matching every other command's error-reporting convention.
fn format_transformer_failure_message(
    failed_transformer: &str,
    err: &str,
    completed: &[&str],
) -> String {
    if completed.is_empty() {
        format!("transformer '{failed_transformer}' failed: {err}")
    } else {
        format!(
            "transformer '{failed_transformer}' failed: {err} (already \
             completed and left updated on disk: {})",
            completed.join(", ")
        )
    }
}

/// Whether synth actually writes `agent` to `dist/` -- in at least ONE
/// registered harness's own output tree, not necessarily all of them.
/// Only the AGENT dimension can diverge from the parsed model:
/// `kiro-cli-v2` emits an agent JSON iff the agent declares a
/// `clientConfig.kiroCli` section, and `claude` emits an agent markdown
/// file iff it declares a `clientConfig.claudeCli` section (see
/// `synth::kiro_cli_v2` / `synth::claude` -- an agent missing BOTH
/// sections targets no registered harness and is skipped by every
/// transformer's own early `continue`). Skills, SOPs and context files
/// are emitted unconditionally for every parsed entry, so their model
/// counts already equal what was written.
fn agent_is_written(agent: &AgentSpec) -> bool {
    agent.client_config.kiro_cli.is_some() || agent.client_config.claude_cli.is_some()
}

/// Counts of each content type synth WROTE to the output tree, in the
/// fixed order the summary line reports them (agents, skills, SOPs,
/// context). For agents this is the count actually written (those
/// targeting a registered harness -- see `agent_is_written`), not
/// `model.agents.len()`; for the other three it equals the model count,
/// since each parsed entry is emitted. A tiny named struct rather than a
/// raw tuple so `format_summary`/`format_verbose_lines` read clearly at
/// each call site.
struct ContentCounts {
    agents: usize,
    skills: usize,
    sops: usize,
    context: usize,
}

impl ContentCounts {
    fn from_model(model: &CanonicalModel) -> Self {
        ContentCounts {
            agents: model.agents.iter().filter(|a| agent_is_written(a)).count(),
            skills: model.skills.len(),
            sops: model.sops.len(),
            context: model.context.len(),
        }
    }

    fn total(&self) -> usize {
        self.agents + self.skills + self.sops + self.context
    }
}

/// Builds the one-line default-mode summary `dispatch_synth` prints on
/// success: the output root written and a per-content-type count (the
/// count synth actually wrote -- see `ContentCounts`), or an explicit
/// "nothing to build" message when the parsed model is entirely empty.
/// Exit code is untouched either way (still 0) -- this only changes what
/// is printed.
fn format_summary(model: &CanonicalModel, output_root: &Path) -> String {
    let counts = ContentCounts::from_model(model);
    if counts.total() == 0 {
        return "konductor synth: nothing to build (no agents, skills, SOPs, or context files found)".to_string();
    }
    format!(
        "konductor synth: wrote {} agent(s), {} skill(s), {} SOP(s), {} context file(s) to {}",
        counts.agents,
        counts.skills,
        counts.sops,
        counts.context,
        output_root.display()
    )
}

/// Builds the additional per-file detail lines `-v`/`--verbose` prints
/// after the summary: one line per WRITTEN agent, then per skill, SOP,
/// and context file name, each prefixed with its content type. An agent
/// skipped by every transformer (not written -- see `agent_is_written`)
/// is not listed, matching the summary count. Empty when the model has
/// nothing written of that type -- never a line for a zero count.
fn format_verbose_lines(model: &CanonicalModel) -> Vec<String> {
    let mut lines = Vec::new();
    for agent in model.agents.iter().filter(|a| agent_is_written(a)) {
        lines.push(format!("  agent: {}", agent.name));
    }
    for skill in &model.skills {
        lines.push(format!("  skill: {}", skill.name));
    }
    for sop in &model.sops {
        lines.push(format!("  sop: {}", sop.name));
    }
    for context in &model.context {
        lines.push(format!("  context: {}", context.name));
    }
    lines
}

/// Builds the `--json` structured equivalent of `format_summary`: one
/// compact JSON object on a single line (no pretty-printing -- this is a
/// machine-readable report, not a document), carrying the same counts as
/// the human-readable summary, plus `artifact_path`/`sidecar_path` for
/// the packaged artifact and its sidecar, so a CI step can read them
/// directly instead of globbing the output directory by suffix.
fn format_summary_json(
    model: &CanonicalModel,
    output_root: &Path,
    artifact_path: &Path,
    sidecar_path: &Path,
) -> String {
    let counts = ContentCounts::from_model(model);
    serde_json::json!({
        "command": "synth",
        "output_root": output_root.display().to_string(),
        "agents": counts.agents,
        "skills": counts.skills,
        "sops": counts.sops,
        "context": counts.context,
        "nothing_to_build": counts.total() == 0,
        "artifact_path": artifact_path.display().to_string(),
        "sidecar_path": sidecar_path.display().to_string(),
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// `target_triple_suffix` must map each of the three CI-runner OSes to
    /// its real Rust target-triple suffix, never the Linux-only
    /// `unknown-...-gnu` shape regardless of `OS`, which would produce an
    /// invalid triple on macOS/Windows. Uses the `os` parameter so all
    /// three branches run on any build host.
    #[test]
    fn target_triple_suffix_maps_each_known_os_to_its_real_triple() {
        assert_eq!(target_triple_suffix("linux"), "unknown-linux-gnu");
        assert_eq!(target_triple_suffix("macos"), "apple-darwin");
        assert_eq!(target_triple_suffix("windows"), "pc-windows-msvc");
    }

    /// An unrecognized OS falls back to `"unknown-{os}"` rather than
    /// guessing a vendor/environment that would likely be wrong.
    #[test]
    fn target_triple_suffix_falls_back_for_unknown_os() {
        assert_eq!(target_triple_suffix("freebsd"), "unknown-freebsd");
    }

    /// `artifact_output_dir` must resolve to `<source_dir>/target/
    /// konductor-artifacts/`, which is a sibling of `<source_dir>/dist/`
    /// (`output_root`), never a descendant of it -- so a later
    /// `package_dist(&output_root)` call can never archive a
    /// previously-written artifact/sidecar into a new one.
    #[test]
    fn artifact_output_dir_is_a_sibling_of_dist_not_a_descendant() {
        let source_dir = Path::new("/tmp/example-repo");
        let dir = artifact_output_dir(source_dir);
        assert_eq!(
            dir,
            Path::new("/tmp/example-repo/target/konductor-artifacts")
        );

        let output_root = source_dir.join("dist");
        assert!(
            !dir.starts_with(&output_root),
            "artifact_output_dir ({}) must not be inside output_root ({}) -- that is exactly the \
             self-referential-archiving risk this directory exists to avoid",
            dir.display(),
            output_root.display()
        );
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-synth-dispatch-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An empty source tree (no agents/skills/agent-sops directories) is a
    /// valid, empty `CanonicalModel` -- `dispatch_synth` must still exit 0
    /// even though every registered transformer runs against zero agents.
    #[test]
    fn dispatch_synth_returns_zero_on_empty_source_tree() {
        let root = scratch_dir("empty-ok");
        let code = dispatch_synth_with(&root, None, false, false);
        assert_eq!(code, 0);
        fs::remove_dir_all(&root).ok();
    }

    /// Regression guard for the output-path bug: transformer output must
    /// land under `<--from's root>/dist/`. `target_dir` is passed as an
    /// unrelated scratch dir (the process cwd is never touched) to prove
    /// output resolves against `--from`'s root, not `target_dir` or any
    /// other location.
    #[test]
    fn dispatch_synth_writes_transformer_output_under_local_root_dist_not_cwd() {
        let unrelated_target_dir = scratch_dir("unrelated-target-dir");
        let local_root = scratch_dir("local-root");
        fs::create_dir_all(local_root.join("agents")).unwrap();
        fs::write(
            local_root.join("agents/k-example.agent-spec.json"),
            br#"{
                "schemaVersion": "1",
                "name": "k-example",
                "config": {"description": "d", "systemPrompt": "p", "model": "m"},
                "clientConfig": {"kiroCli": {}}
            }"#,
        )
        .unwrap();

        let code = dispatch_synth_with(
            &unrelated_target_dir,
            Some(local_root.display().to_string()),
            false,
            false,
        );

        assert_eq!(code, 0);
        assert!(
            local_root
                .join("dist/kiro-cli-v2/agents/k-example.json")
                .exists(),
            "expected kiro-cli output under --from's root's dist/, not target_dir"
        );
        assert!(!unrelated_target_dir.join("dist").exists());
        assert!(!unrelated_target_dir.join("kiro-cli-v2").exists());

        fs::remove_dir_all(&unrelated_target_dir).ok();
        fs::remove_dir_all(&local_root).ok();
    }

    /// `--from` overrides `target_dir` as the source tree root.
    #[test]
    fn dispatch_synth_prefers_local_over_target_dir() {
        let root = scratch_dir("local-override");
        let bogus_target = PathBuf::from("/does/not/exist/at/all");
        let code = dispatch_synth_with(
            &bogus_target,
            Some(root.display().to_string()),
            false,
            false,
        );
        assert_eq!(code, 0);
        fs::remove_dir_all(&root).ok();
    }

    /// `source_dir` pointing at a file (not a directory) is a
    /// `parse_canonical` failure, which must map to `EXIT_USAGE_ERROR`.
    #[test]
    fn dispatch_synth_returns_usage_error_when_source_dir_is_a_file() {
        let root = scratch_dir("source-is-file");
        let file_path = root.join("not-a-dir");
        fs::write(&file_path, b"not a directory").unwrap();
        let code = dispatch_synth_with(&file_path, None, false, false);
        assert_eq!(code, EXIT_USAGE_ERROR);
        fs::remove_dir_all(&root).ok();
    }

    /// A minimal agent that TARGETS the kiro-cli harness (declares a
    /// `clientConfig.kiroCli` section), so `agent_is_written` counts it --
    /// the normal case. For an agent that targets no harness, overwrite
    /// `client_config` with `ClientConfig::default()` (see
    /// `summary_counts_only_agents_that_target_a_harness`).
    fn minimal_agent(name: &str) -> AgentSpec {
        AgentSpec {
            name: name.to_string(),
            config: crate::cli::synth::parser::AgentConfig {
                description: String::new(),
                system_prompt: String::new(),
                model: String::new(),
            },
            dependencies: crate::cli::synth::parser::AgentDependencies::default(),
            client_config: crate::cli::synth::parser::ClientConfig {
                kiro_cli: Some(crate::cli::synth::parser::KiroCliConfig::default()),
                claude_cli: None,
            },
        }
    }

    fn populated_model() -> CanonicalModel {
        CanonicalModel {
            agents: vec![minimal_agent("k-example")],
            skills: vec![model::SkillDef {
                name: "code-review".to_string(),
                raw_frontmatter: "name: code-review".to_string(),
                body: String::new(),
                auxiliary_files: vec![],
            }],
            sops: vec![
                model::SopDef {
                    name: "asdlc-plan".to_string(),
                    body: String::new(),
                },
                model::SopDef {
                    name: "asdlc-verify".to_string(),
                    body: String::new(),
                },
            ],
            context: vec![model::ContextDef {
                name: "routing-rules.md".to_string(),
                body: String::new(),
            }],
        }
    }

    /// The default-mode summary line reports the exact per-content-type
    /// counts (1 agent, 1 skill, 2 SOPs, 1 context file) and the output
    /// root -- non-vacuous: a stale/miscounted implementation would show
    /// up as a wrong number here, not just "some text".
    #[test]
    fn format_summary_reports_exact_per_content_type_counts() {
        let model = populated_model();
        let summary = format_summary(&model, Path::new("/tmp/example/dist"));
        assert_eq!(
            summary,
            "konductor synth: wrote 1 agent(s), 1 skill(s), 2 SOP(s), 1 context file(s) to /tmp/example/dist"
        );
    }

    /// An entirely empty model gets the explicit "nothing to build"
    /// message, not a summary line claiming zero of everything.
    #[test]
    fn format_summary_reports_nothing_to_build_on_empty_model() {
        let summary = format_summary(&CanonicalModel::default(), Path::new("/tmp/example/dist"));
        assert_eq!(
            summary,
            "konductor synth: nothing to build (no agents, skills, SOPs, or context files found)"
        );
    }

    /// `--verbose` lines name every agent/skill/SOP/context file by
    /// name, one per line, and produce MORE lines than the plain
    /// summary (which is always exactly one line) -- proving `-v`
    /// genuinely adds detail rather than just repeating the summary.
    #[test]
    fn format_verbose_lines_names_every_item_and_exceeds_summary_line_count() {
        let model = populated_model();
        let lines = format_verbose_lines(&model);
        assert_eq!(
            lines,
            vec![
                "  agent: k-example",
                "  skill: code-review",
                "  sop: asdlc-plan",
                "  sop: asdlc-verify",
                "  context: routing-rules.md",
            ]
        );
        assert!(
            lines.len() > 1,
            "-v must add more than the single summary line"
        );
    }

    /// `--verbose` on an empty model adds no lines at all -- never a
    /// line for a zero count.
    #[test]
    fn format_verbose_lines_is_empty_for_empty_model() {
        assert!(format_verbose_lines(&CanonicalModel::default()).is_empty());
    }

    /// `--json` output parses as valid JSON and carries the same counts
    /// as the human-readable summary, plus the new
    /// `artifact_path`/`sidecar_path` fields.
    #[test]
    fn format_summary_json_parses_and_matches_counts() {
        let model = populated_model();
        let rendered = format_summary_json(
            &model,
            Path::new("/tmp/example/dist"),
            Path::new("/tmp/example/konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz"),
            Path::new("/tmp/example/konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz.sha256"),
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&rendered).expect("must be valid JSON");
        assert_eq!(parsed["command"], "synth");
        assert_eq!(parsed["agents"], 1);
        assert_eq!(parsed["skills"], 1);
        assert_eq!(parsed["sops"], 2);
        assert_eq!(parsed["context"], 1);
        assert_eq!(parsed["nothing_to_build"], false);
        assert_eq!(
            parsed["artifact_path"],
            "/tmp/example/konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz"
        );
        assert_eq!(
            parsed["sidecar_path"],
            "/tmp/example/konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz.sha256"
        );
    }

    #[test]
    fn format_summary_json_nothing_to_build_flag_true_on_empty_model() {
        let rendered = format_summary_json(
            &CanonicalModel::default(),
            Path::new("/tmp/dist"),
            Path::new("/tmp/konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz"),
            Path::new("/tmp/konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz.sha256"),
        );
        let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
        assert_eq!(parsed["nothing_to_build"], true);
        assert_eq!(parsed["agents"], 0);
    }

    /// Security regression guard: the FIRST transformer to fail (nothing
    /// completed yet) gets the plain, unqualified message -- no
    /// "(already completed ...)" clause when there is nothing to report.
    #[test]
    fn format_transformer_failure_message_omits_completed_clause_when_nothing_completed() {
        let msg = format_transformer_failure_message("kiro-cli-v2", "boom", &[]);
        assert_eq!(msg, "transformer 'kiro-cli-v2' failed: boom");
    }

    /// A LATER transformer's failure must name every earlier transformer
    /// that already completed, in order, so a caller reading only this
    /// message (not diffing `dist/` itself) knows exactly which
    /// `dist/<name()>/` subtrees are already updated to the new model.
    #[test]
    fn format_transformer_failure_message_names_every_completed_transformer_in_order() {
        let msg = format_transformer_failure_message("claude", "boom", &["kiro-cli-v2"]);
        assert_eq!(
            msg,
            "transformer 'claude' failed: boom (already completed and left \
             updated on disk: kiro-cli-v2)"
        );
    }

    /// Multiple completed transformers are joined, not just the first.
    #[test]
    fn format_transformer_failure_message_joins_multiple_completed_transformers() {
        let msg = format_transformer_failure_message("third", "boom", &["first", "second"]);
        assert!(msg.contains("first, second"));
    }

    /// Recursively snapshots every regular file under `root`: relative
    /// path (relative to `root`) mapped to its exact byte content plus
    /// its Unix permission bits (masked to `0o777`; a no-op comparison
    /// value on non-Unix targets since there is no execute bit to
    /// diverge there). Uses a `BTreeMap` purely as a stable, comparable
    /// container -- insertion order from `fs::read_dir` is NOT assumed
    /// deterministic, so ordering never enters the comparison.
    ///
    /// `walk` panics (via `.unwrap()`) on a `read_dir` failure rather
    /// than silently skipping the unreadable subtree: this function is
    /// the sole oracle behind the idempotency assertion below, so a
    /// swallowed read failure would silently truncate both snapshots.
    /// If the SAME subdirectory fails to read on both the first and
    /// second call (the common case for a real, non-transient cause),
    /// the two truncated snapshots would still compare equal --
    /// masking a real byte-level regression in the untruncated part of
    /// the tree instead of failing loudly. Every call site is a
    /// post-synth-success `dist/` tree this test just created, so a
    /// `read_dir` failure here always indicates a real problem worth
    /// surfacing, never an expected "directory doesn't exist yet" case.
    ///
    /// Deliberately NOT reusing `parse_canonical.rs`'s
    /// `collect_auxiliary_files`/`read_auxiliary_file` walker, despite
    /// the structural similarity (recurse, `strip_prefix` for a relative
    /// path, read content, record a mode/executable signal): that
    /// walker enforces `MAX_AUXILIARY_FILE_BYTES` and rejects symlinks
    /// per ADR-7's untrusted-CI-content contract, which is the wrong
    /// contract for THIS walk -- `dist/` here is a tree this same test
    /// just generated a moment ago, not untrusted external input.
    /// Reusing the production walker would silently impose a byte-size
    /// ceiling and a symlink rejection this test has no reason to want.
    fn snapshot_dir(root: &Path) -> std::collections::BTreeMap<PathBuf, (Vec<u8>, u32)> {
        fn walk(
            dir: &Path,
            root: &Path,
            out: &mut std::collections::BTreeMap<PathBuf, (Vec<u8>, u32)>,
        ) {
            let entries = fs::read_dir(dir)
                .unwrap_or_else(|e| panic!("failed to read directory {}: {e}", dir.display()));
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, root, out);
                } else if path.is_file() {
                    let content = fs::read(&path).unwrap();
                    #[cfg(unix)]
                    let mode = {
                        use std::os::unix::fs::PermissionsExt;
                        fs::metadata(&path).unwrap().permissions().mode() & 0o777
                    };
                    #[cfg(not(unix))]
                    let mode = 0u32;
                    let relative = path.strip_prefix(root).unwrap().to_path_buf();
                    out.insert(relative, (content, mode));
                }
            }
        }
        let mut out = std::collections::BTreeMap::new();
        walk(root, root, &mut out);
        out
    }

    /// Idempotency regression guard: running `synth` twice against the
    /// same, unchanged source tree must produce byte-identical
    /// `dist/<name()>/` output the second time -- this is the "safe to
    /// re-run" property `stage_content_type`'s rename-old-away /
    /// rename-new-in / remove-old swap exists to guarantee (see
    /// `kiro_cli_v2.rs`'s docstring). Exercises every content type
    /// (agent, skill + executable auxiliary file, SOP, context) in one
    /// source tree so a regression in any one of the four staged
    /// directories is caught, not just the agent path.
    ///
    /// This test's whole reason to exist is to catch a non-idempotent
    /// `stage_content_type` (e.g. one that merges into a stale staging
    /// dir instead of always starting from a fresh one, or one whose
    /// swap leaves a leftover backup directory counted as "output").
    /// It passes because `stage_content_type` clears the previous output
    /// via a full directory swap on every call (its rename-old-away /
    /// rename-new-in / remove-old sequence) -- this guards that property
    /// going forward.
    #[test]
    fn synth_run_twice_produces_byte_identical_dist_output() {
        let root = scratch_dir("idempotent-rerun");

        // `resources: ["file://AGENTS.md"]` deliberately does NOT create a
        // matching `AGENTS.md` file anywhere in this scratch tree: a plain
        // `file://` resource entry is passed through verbatim by
        // `kiro_cli_v2.rs`'s `render_agent_file` and is never resolved
        // against disk at synth time (only a `skill://` entry naming a
        // single packaged skill is validated -- see
        // `normalize_skill_resource`). Cross-reference consistency between
        // an agent's `resources`/`contextNames` and the files they name is
        // therefore out of scope for this idempotency test.
        fs::create_dir_all(root.join("agents")).unwrap();
        fs::write(
            root.join("agents/k-example.agent-spec.json"),
            br#"{
                "schemaVersion": "1",
                "name": "k-example",
                "config": {"description": "d", "systemPrompt": "p", "model": "m"},
                "dependencies": {"context": {"contextNames": ["notes.md"]}},
                "clientConfig": {"kiroCli": {"resources": ["file://AGENTS.md"]}}
            }"#,
        )
        .unwrap();

        fs::create_dir_all(root.join("skills/example-skill")).unwrap();
        fs::write(
            root.join("skills/example-skill/SKILL.md"),
            b"---\nname: example-skill\ndescription: A test skill.\n---\n\n# Body\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("skills/example-skill/scripts")).unwrap();
        fs::write(
            root.join("skills/example-skill/scripts/run.sh"),
            b"#!/bin/sh\necho hi\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                root.join("skills/example-skill/scripts/run.sh"),
                fs::Permissions::from_mode(0o755),
            )
            .unwrap();
        }

        fs::create_dir_all(root.join("agent-sops")).unwrap();
        fs::write(
            root.join("agent-sops/example-sop.sop.md"),
            b"# Example SOP\n\nBody.\n",
        )
        .unwrap();

        fs::create_dir_all(root.join("context")).unwrap();
        fs::write(root.join("context/notes.md"), b"# Notes\n").unwrap();

        let first_code = dispatch_synth_with(&root, None, false, false);
        assert_eq!(first_code, 0, "first synth run must succeed");
        let first_snapshot = snapshot_dir(&root.join("dist"));
        assert!(
            !first_snapshot.is_empty(),
            "expected the first run to write something under dist/"
        );

        let second_code = dispatch_synth_with(&root, None, false, false);
        assert_eq!(second_code, 0, "second synth run must succeed");
        let second_snapshot = snapshot_dir(&root.join("dist"));

        assert_eq!(
            first_snapshot, second_snapshot,
            "re-running synth against an unchanged source tree must produce \
             byte-identical dist/ output (including file permission bits)"
        );

        fs::remove_dir_all(&root).ok();
    }

    /// Regression: synth's summary must report the agent
    /// count it actually WROTE, not `model.agents.len()`. An agent with
    /// no `clientConfig.kiroCli` section is parsed into the model but
    /// skipped by the kiro-cli-v2 transformer, so it must not be counted
    /// as written -- in the plain summary, the `--json` output, or the
    /// `-v` listing. A naive `agents: model.agents.len()` would make
    /// every assertion below see 2 agents and the `-v` listing include
    /// the skipped agent; counting only written agents makes each see 1
    /// and list only the written agent.
    #[test]
    fn summary_counts_only_agents_that_target_a_harness() {
        // populated_model()'s agent targets kiro-cli (written).
        let mut model = populated_model();
        // A second agent that targets NO registered harness.
        let mut unwritten = minimal_agent("k-not-built");
        unwritten.client_config = crate::cli::synth::parser::ClientConfig::default();
        model.agents.push(unwritten);

        // Plain summary: 1 written agent, not 2.
        assert_eq!(
            format_summary(&model, Path::new("/tmp/example/dist")),
            "konductor synth: wrote 1 agent(s), 1 skill(s), 2 SOP(s), 1 context file(s) to /tmp/example/dist"
        );
        // JSON: agents == 1.
        let parsed: serde_json::Value = serde_json::from_str(&format_summary_json(
            &model,
            Path::new("/tmp/example/dist"),
            Path::new("/tmp/example/konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz"),
            Path::new("/tmp/example/konductor-v0.1.0-x86_64-unknown-linux-gnu.tar.gz.sha256"),
        ))
        .unwrap();
        assert_eq!(parsed["agents"], 1);
        // Verbose: lists the written agent, never the skipped one.
        let lines = format_verbose_lines(&model);
        assert!(lines.contains(&"  agent: k-example".to_string()));
        assert!(
            !lines.iter().any(|l| l.contains("k-not-built")),
            "an agent that targets no registered harness must not appear in -v output"
        );
    }

    /// Companion to the test above: an agent targeting ONLY
    /// `clientConfig.claudeCli` (no `kiroCli` at all) must still count
    /// as written now that `ClaudeTransformer` is registered --
    /// `agent_is_written` is an OR across every registered harness's
    /// own targeting section, not a kiro-cli-only check.
    #[test]
    fn summary_counts_an_agent_that_targets_only_claude_cli() {
        let claude_only = AgentSpec {
            name: "k-claude-only".to_string(),
            config: crate::cli::synth::parser::AgentConfig {
                description: String::new(),
                system_prompt: String::new(),
                model: String::new(),
            },
            dependencies: crate::cli::synth::parser::AgentDependencies::default(),
            client_config: crate::cli::synth::parser::ClientConfig {
                kiro_cli: None,
                claude_cli: Some(crate::cli::synth::parser::ClaudeCliConfig::default()),
            },
        };
        let model = CanonicalModel {
            agents: vec![claude_only],
            ..Default::default()
        };

        assert_eq!(
            format_summary(&model, Path::new("/tmp/example/dist")),
            "konductor synth: wrote 1 agent(s), 0 skill(s), 0 SOP(s), 0 context file(s) to /tmp/example/dist"
        );
        let lines = format_verbose_lines(&model);
        assert_eq!(lines, vec!["  agent: k-claude-only".to_string()]);
    }

    /// Cross-transformer partial-failure regression guard: drives the
    /// exact composition `dispatch_synth_with` uses --
    /// `registry::TRANSFORMERS` in order -- against a model built so the
    /// FIRST registered transformer (`kiro-cli-v2`) succeeds fully while
    /// the SECOND (`claude`) fails partway through its own agents stage.
    /// Asserts the torn-state consequence `dispatch_synth_with`'s own
    /// docstring documents: the already-succeeded transformer's output
    /// is present and
    /// correct on disk even though the overall composition reports
    /// failure.
    ///
    /// The unsafe agent name (`"../../evil"`) that trips `claude`'s own
    /// `reject_unsafe_agent_name` cannot reach this test via a real
    /// `*.agent-spec.json` file -- `parser::validate_agent_name` already
    /// rejects it at PARSE time, before any transformer runs at all (a
    /// different failure path entirely, already covered by
    /// `dispatch_synth_returns_usage_error_when_source_dir_is_a_file`-
    /// style tests). Constructing the `AgentSpec` directly, bypassing
    /// the parser, is the only way to exercise a transformer-TIME (not
    /// parse-time) failure -- the same "constructed without parser"
    /// pattern every security regression test in `kiro_cli_v2.rs` and
    /// `claude.rs` already uses.
    ///
    /// This agent targets ONLY `claudeCli` (no `kiroCli`), so
    /// `kiro-cli-v2` skips it via its own early `continue` and never
    /// sees the unsafe name at all -- setting `kiro_cli: Some(..)` on
    /// the unsafe agent too would make the FIRST transformer fail
    /// instead, defeating this test's premise of isolating the SECOND
    /// transformer's failure.
    #[test]
    fn second_transformer_failure_leaves_first_transformers_output_intact() {
        let dir = scratch_dir("cross-transformer-partial-failure");

        let good_kiro_agent = minimal_agent("k-good");
        let unsafe_claude_agent = AgentSpec {
            name: "../../evil".to_string(),
            config: crate::cli::synth::parser::AgentConfig {
                description: String::new(),
                system_prompt: String::new(),
                model: String::new(),
            },
            dependencies: crate::cli::synth::parser::AgentDependencies::default(),
            client_config: crate::cli::synth::parser::ClientConfig {
                kiro_cli: None,
                claude_cli: Some(crate::cli::synth::parser::ClaudeCliConfig::default()),
            },
        };

        let model = CanonicalModel {
            agents: vec![good_kiro_agent, unsafe_claude_agent],
            ..Default::default()
        };

        // Drive the exact same composition dispatch_synth_with uses:
        // registry::TRANSFORMERS in order, fail-fast, no cross-
        // transformer rollback.
        let mut results = Vec::new();
        for transformer in registry::TRANSFORMERS {
            results.push((transformer.name(), transformer.transform(&model, &dir)));
        }

        let kiro_result = results
            .iter()
            .find(|(name, _)| *name == "kiro-cli-v2")
            .expect("kiro-cli-v2 must be registered");
        assert!(
            kiro_result.1.is_ok(),
            "expected kiro-cli-v2 to succeed fully despite claude's later failure, got: {:?}",
            kiro_result.1
        );

        let claude_result = results
            .iter()
            .find(|(name, _)| *name == "claude")
            .expect("claude must be registered");
        assert!(
            claude_result.1.is_err(),
            "expected claude to fail on the unsafe agent name"
        );

        // The torn-state assertion: kiro-cli-v2's own already-succeeded
        // output must remain present and correct on disk even though
        // the overall composition (as dispatch_synth_with would report
        // it) failed.
        let kiro_agent_file = dir
            .join("kiro-cli-v2")
            .join(crate::cli::synth::kiro_cli_v2::AGENTS_CONTENT_TYPE_DIR)
            .join("k-good.json");
        assert!(
            kiro_agent_file.exists(),
            "kiro-cli-v2's already-succeeded output must remain intact when claude fails later, \
             expected {} to exist",
            kiro_agent_file.display()
        );

        fs::remove_dir_all(&dir).ok();
    }
}
