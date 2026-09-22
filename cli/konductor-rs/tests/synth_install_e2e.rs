// SPDX-License-Identifier: Apache-2.0
//
// synth_install_e2e.rs — genuine end-to-end test proving `konductor
// synth` and `konductor install` agree on where synth output lives, by
// driving the REAL compiled binary through both commands against the
// SAME tree and never hand-supplying either side's path as a test
// constant.
//
// Why this exists: every existing install test -- the unit tests and the
// concurrency integration test -- seeds `dist/kiro-cli-v2/agents/`
// directly rather
// than running a real `synth` first. That leaves a real gap: if synth's
// actual output directory ever diverges from what install's source-path
// resolution expects, every one of those seeded-fixture tests keeps
// passing (they seed the path INSTALL expects, not the path SYNTH
// writes), while a real user running `synth` then `install` would see
// install fail with "no synthed agent files found". Seeded fixtures are
// still legitimate at the unit level (this file does not replace them --
// see install_manifest_concurrency.rs and the unit tests in
// install/kiro_cli.rs, which stay as-is); this file closes the specific
// gap of proving the two REAL commands agree with each other, not with
// a test author's assumption about where either of them writes.
//
// Isolation: everything happens under `std::env::temp_dir()` (never the
// repo checkout, never a real `~/.kiro`/`~/.claude`/`$HOME`). No network
// access; no published release is involved (`--from` only). `install`
// is always invoked with an explicit `--target <isolated_dir>` -- its
// default destination is `$HOME` (see install.rs's
// `resolve_destination`), so omitting `--target` here would write into
// this test-runner's real home directory.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const CMD_SYNTH: &str = "synth";
const CMD_INSTALL: &str = "install";

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-synth-install-e2e-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn run_konductor(cwd: &Path, sink: &telemetry_test_sink::TelemetrySink, args: &[&str]) -> Output {
    // `HOME` is overridden to `cwd` (an isolated temp dir) for every
    // invocation here: `install`'s default destination is now `$HOME`
    // (this test always passes `--target` explicitly, so that alone
    // isn't the concern), but `log_invocation` (logging.rs) independently
    // resolves `$HOME` for `~/.konductor/logs/` on EVERY invocation,
    // regardless of `--target` -- without this override, a real
    // subprocess run here would still write an invocation log line into
    // this test-runner's actual home directory.
    //
    // Telemetry is redirected to `sink`, a loopback fixture: a
    // successful install still reports a package_installed event, so
    // without this each synth/install pair would reach the live
    // production endpoint.
    let mut command = Command::new(bin());
    command.args(args).current_dir(cwd).env("HOME", cwd);
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    command.output().expect("failed to spawn konductor binary")
}

/// Seeds a minimal but real agent-spec source tree: one agent with a
/// `kiroCli` client config, which the real `synth` command consumes and
/// writes out under its OWN chosen output path (never asserted by this
/// test ahead of time).
fn seed_agent_spec_source(repo_root: &Path) {
    let agents_dir = repo_root.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(
        agents_dir.join("k-example.agent-spec.json"),
        br#"{
  "schemaVersion": "1",
  "name": "k-example",
  "config": {
    "description": "An example agent.",
    "model": "claude-sonnet-5",
    "systemPrompt": "You are a helpful agent."
  },
  "clientConfig": {
    "kiroCli": {}
  }
}
"#,
    )
    .unwrap();
}

/// Seeds a minimal but real skill source tree: `skills/example-skill/SKILL.md`,
/// which the real `synth` command consumes and writes out under its OWN
/// chosen output path (never asserted by this test ahead of time).
fn seed_skill_source(repo_root: &Path) {
    let skill_dir = repo_root.join("skills").join("example-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        b"---\nname: example-skill\ndescription: An example skill.\n---\n\n# example-skill\n\nBody.\n",
    )
    .unwrap();
}

/// The heart of this test: runs a REAL `synth --from <repo_root>`,
/// then a REAL `install --from <repo_root>` against a SEPARATE target
/// directory, and asserts the installed agent file's bytes match
/// whatever `synth` actually wrote -- read back from synth's own
/// output, not a path either side of this test hand-computes. If synth
/// and install ever resolve different directories, `install` fails with
/// "no synthed agent files found" and this test fails loudly rather
/// than silently seeding around the mismatch.
#[test]
fn real_synth_then_real_install_agree_on_output_path_and_bytes() {
    let sink = telemetry_test_sink::TelemetrySink::start();
    let repo_root = scratch_dir("repo");
    seed_agent_spec_source(&repo_root);
    seed_skill_source(&repo_root);

    let synth_result = run_konductor(
        &repo_root,
        &sink,
        &[CMD_SYNTH, "--from", &repo_root.display().to_string()],
    );
    assert!(
        synth_result.status.success(),
        "real `synth --from <repo>` must succeed: stderr={}",
        String::from_utf8_lossy(&synth_result.stderr)
    );

    // Deliberately do NOT hand-compute synth's output directory here.
    // Discover it by walking `repo_root/dist/` for whatever synth
    // actually produced, so this test cannot be satisfied by a
    // hand-typed path constant that happens to agree with today's
    // synth implementation.
    let dist_dir = repo_root.join("dist");
    assert!(
        dist_dir.is_dir(),
        "expected synth to create a dist/ directory under --from's repo root"
    );
    // Scoped to `dist/kiro-cli-v2/` specifically, not the whole `dist/`
    // tree: `install` (untouched by this CR) only ever reads from the
    // kiro-cli-v2 output today, and a second registered transformer
    // (`kiro-v3`) now also writes its own `k-example.json` under
    // `dist/`, which an unscoped search would otherwise pick up too.
    let kiro_cli_v2_dist_dir = dist_dir.join("kiro-cli-v2");
    let synth_agent_files = find_files_named(&kiro_cli_v2_dist_dir, "k-example.json");
    assert_eq!(
        synth_agent_files.len(),
        1,
        "expected exactly one synthed k-example.json somewhere under {}, found: {:?}",
        kiro_cli_v2_dist_dir.display(),
        synth_agent_files
    );
    let synth_output_bytes = std::fs::read(&synth_agent_files[0]).unwrap();
    assert!(
        !synth_output_bytes.is_empty(),
        "synth's real output file must not be empty"
    );

    // Now run a REAL install against a separate target directory, again
    // using --from against the SAME repo_root synth just wrote into.
    // `--target` is passed explicitly, pointing at the isolated
    // `target_dir` -- install's default destination is now `$HOME` (see
    // install.rs's `resolve_destination`), and this test must never
    // write into the real `$HOME` of whatever machine runs it.
    let target_dir = scratch_dir("target");
    let install_result = run_konductor(
        &target_dir,
        &sink,
        &[
            CMD_INSTALL,
            "--from",
            &repo_root.display().to_string(),
            "--target",
            &target_dir.display().to_string(),
            "--harness",
            "kiro-cli-v2",
        ],
    );
    assert!(
        install_result.status.success(),
        "real `install --from <repo>` must succeed after a real synth run: stderr={}",
        String::from_utf8_lossy(&install_result.stderr)
    );

    // Discover install's real output the same way -- by walking the
    // target dir, not by asserting a hand-typed ".kiro/agents/..." path
    // ahead of time (that assumption is exactly what a future
    // synth/install path divergence would silently violate).
    let installed_files = find_files_named(&target_dir, "k-example.json");
    assert_eq!(
        installed_files.len(),
        1,
        "expected exactly one installed k-example.json somewhere under {}, found: {:?}",
        target_dir.display(),
        installed_files
    );
    let installed_bytes = std::fs::read(&installed_files[0]).unwrap();

    assert_eq!(
        installed_bytes, synth_output_bytes,
        "installed file bytes must be byte-identical to what the real synth run emitted"
    );

    // The specific location contract this test is meant to lock in --
    // asserted AFTER establishing byte identity above (which alone
    // already proves the file was actually found and copied), so a
    // reader can see both "the bytes match" and "the well-known
    // destination path is what got used".
    assert_eq!(
        installed_files[0],
        target_dir.join(".kiro/agents/k-example.json"),
        "installed file must land at the documented .kiro/agents/ destination"
    );

    // Same discovery-not-assumption treatment for the skill this test
    // also seeded: find it under synth's real dist/ output, then under
    // install's real target output, and confirm both agree byte for
    // byte, landing at the documented .konductor/skills/ destination.
    //
    // Scoped to `dist/kiro-cli-v2/` specifically, not the whole `dist/`
    // tree: every registered `HarnessTransformer` writes every skill
    // unconditionally (skills have no per-harness client config to gate
    // on -- see both `kiro_cli_v2.rs` and `claude.rs`'s own module
    // docstrings), so a second registered harness (`claude`) also
    // writes its own `dist/claude/skills/example-skill/SKILL.md`. This
    // test is specifically about the kiro-cli-v2 -> `.konductor/skills/`
    // install path (the seeded agent declares only `kiroCli`, never
    // `claudeCli`), so it must look under that harness's own subtree,
    // not assert there is exactly one SKILL.md anywhere under `dist/`.
    let kiro_cli_v2_dist_dir = dist_dir.join("kiro-cli-v2");
    let synth_skill_files = find_files_named(&kiro_cli_v2_dist_dir, "SKILL.md");
    assert_eq!(
        synth_skill_files.len(),
        1,
        "expected exactly one synthed SKILL.md somewhere under {}, found: {:?}",
        kiro_cli_v2_dist_dir.display(),
        synth_skill_files
    );
    let synth_skill_bytes = std::fs::read(&synth_skill_files[0]).unwrap();
    assert!(
        !synth_skill_bytes.is_empty(),
        "synth's real skill output file must not be empty"
    );

    let installed_skill_files = find_files_named(&target_dir, "SKILL.md");
    assert_eq!(
        installed_skill_files.len(),
        1,
        "expected exactly one installed SKILL.md somewhere under {}, found: {:?}",
        target_dir.display(),
        installed_skill_files
    );
    let installed_skill_bytes = std::fs::read(&installed_skill_files[0]).unwrap();
    assert_eq!(
        installed_skill_bytes, synth_skill_bytes,
        "installed skill file bytes must be byte-identical to what the real synth run emitted"
    );
    assert_eq!(
        installed_skill_files[0],
        target_dir.join(".konductor/skills/example-skill/SKILL.md"),
        "installed skill must land at the documented .konductor/skills/ destination"
    );

    std::fs::remove_dir_all(&repo_root).ok();
    std::fs::remove_dir_all(&target_dir).ok();
}

/// Recursively finds every file named exactly `file_name` under `root`.
fn find_files_named(root: &Path, file_name: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|n| n.to_str()) == Some(file_name) {
                found.push(path);
            }
        }
    }
    found.sort();
    found
}

/// Seeds an agent-spec source tree whose agent declares one
/// `contextNames` entry, plus the referenced `context/` file -- the
/// real end-to-end path this whole feature exists to prove.
fn seed_agent_spec_with_context_source(repo_root: &Path) {
    let agents_dir = repo_root.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(
        agents_dir.join("k-example.agent-spec.json"),
        br#"{
  "schemaVersion": "1",
  "name": "k-example",
  "config": {
    "description": "An example agent.",
    "model": "claude-sonnet-5",
    "systemPrompt": "You are a helpful agent."
  },
  "dependencies": {
    "context": {
      "contextNames": ["routing-rules.md"]
    }
  },
  "clientConfig": {
    "kiroCli": {}
  }
}
"#,
    )
    .unwrap();

    let context_dir = repo_root.join("context");
    std::fs::create_dir_all(&context_dir).unwrap();
    std::fs::write(
        context_dir.join("routing-rules.md"),
        b"# Routing rules\n\n[CODE RED] NEVER MUTATE DIRECTLY\n",
    )
    .unwrap();
}

/// Unlike `real_synth_then_real_install_agree_on_output_path_and_bytes`
/// (whose seeded agent declares no `contextNames`, so its installed
/// bytes stay byte-identical to synth's own output), an agent WITH a
/// `contextNames` entry is deliberately transformed during install: its
/// `resources` entry is rewritten from a relative `file://context/...`
/// (destination-agnostic, as `dist/` must stay) to an absolute
/// `file://<install-root>/context/...` path. This test locks in that
/// divergence against the REAL compiled binary rather than asserting
/// byte identity, and additionally proves the context file itself was
/// copied to the destination the rewritten path points at.
#[test]
fn real_synth_then_real_install_rewrites_context_resource_to_absolute_path() {
    let sink = telemetry_test_sink::TelemetrySink::start();
    let repo_root = scratch_dir("repo-context");
    seed_agent_spec_with_context_source(&repo_root);

    let synth_result = run_konductor(
        &repo_root,
        &sink,
        &[CMD_SYNTH, "--from", &repo_root.display().to_string()],
    );
    assert!(
        synth_result.status.success(),
        "real `synth --from <repo>` must succeed: stderr={}",
        String::from_utf8_lossy(&synth_result.stderr)
    );

    let dist_dir = repo_root.join("dist");
    // Scoped to `dist/kiro-cli-v2/` -- see the identical comment in
    // `real_synth_then_real_install_agree_on_output_path_and_bytes`
    // above for why an unscoped `dist_dir` search now finds two files.
    let kiro_cli_v2_dist_dir = dist_dir.join("kiro-cli-v2");
    let synth_agent_files = find_files_named(&kiro_cli_v2_dist_dir, "k-example.json");
    assert_eq!(synth_agent_files.len(), 1);
    let synth_value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&synth_agent_files[0]).unwrap()).unwrap();
    assert_eq!(
        synth_value["resources"],
        serde_json::json!(["file://context/routing-rules.md"]),
        "synth's own dist/ output must stay destination-agnostic (relative path)"
    );

    let target_dir = scratch_dir("target-context");
    let install_result = run_konductor(
        &target_dir,
        &sink,
        &[
            CMD_INSTALL,
            "--from",
            &repo_root.display().to_string(),
            "--target",
            &target_dir.display().to_string(),
            "--harness",
            "kiro-cli-v2",
        ],
    );
    assert!(
        install_result.status.success(),
        "real `install --from <repo>` must succeed after a real synth run: stderr={}",
        String::from_utf8_lossy(&install_result.stderr)
    );

    let installed_files = find_files_named(&target_dir, "k-example.json");
    assert_eq!(installed_files.len(), 1);
    let installed_value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&installed_files[0]).unwrap()).unwrap();

    let expected_absolute = format!(
        "file://{}",
        target_dir.join(".kiro/context/routing-rules.md").display()
    );
    assert_eq!(
        installed_value["resources"],
        serde_json::json!([expected_absolute]),
        "installed agent's context resource must be rewritten to an absolute path"
    );

    let installed_context_file = target_dir.join(".kiro/context/routing-rules.md");
    assert!(
        installed_context_file.is_file(),
        "the context file the rewritten resource points at must actually exist on disk"
    );
    assert_eq!(
        std::fs::read(&installed_context_file).unwrap(),
        b"# Routing rules\n\n[CODE RED] NEVER MUTATE DIRECTLY\n"
    );

    // Installing a second time must be idempotent: re-running install
    // against the same target must not duplicate or double-rewrite the
    // resources entry.
    let second_install_result = run_konductor(
        &target_dir,
        &sink,
        &[
            CMD_INSTALL,
            "--from",
            &repo_root.display().to_string(),
            "--target",
            &target_dir.display().to_string(),
            "--harness",
            "kiro-cli-v2",
        ],
    );
    assert!(
        second_install_result.status.success(),
        "a second real `install` run must also succeed: stderr={}",
        String::from_utf8_lossy(&second_install_result.stderr)
    );
    let reinstalled_value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&installed_files[0]).unwrap()).unwrap();
    assert_eq!(
        reinstalled_value["resources"],
        serde_json::json!([expected_absolute]),
        "a second install must not duplicate or double-rewrite the context resource entry"
    );

    std::fs::remove_dir_all(&repo_root).ok();
    std::fs::remove_dir_all(&target_dir).ok();
}

/// Seeds a source tree with two agents, EACH declaring a hand-authored
/// `skill://~/.kiro/skills/<name>/SKILL.md` reference to a DIFFERENT one
/// of two packaged skills -- the real end-to-end scoping path this
/// whole feature exists to prove: each installed agent must end up
/// referencing only its own declared skill.
fn seed_agent_spec_with_skill_source(repo_root: &Path) {
    let agents_dir = repo_root.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    for (agent_name, skill_name) in [("agent-a", "skill-a"), ("agent-b", "skill-b")] {
        std::fs::write(
            agents_dir.join(format!("{agent_name}.agent-spec.json")),
            format!(
                r#"{{
  "schemaVersion": "1",
  "name": "{agent_name}",
  "config": {{
    "description": "An example agent.",
    "model": "claude-sonnet-5",
    "systemPrompt": "You are a helpful agent."
  }},
  "clientConfig": {{
    "kiroCli": {{
      "resources": ["skill://~/.kiro/skills/{skill_name}/SKILL.md"]
    }}
  }}
}}
"#
            ),
        )
        .unwrap();
    }
    for skill_name in ["skill-a", "skill-b"] {
        let skill_dir = repo_root.join("skills").join(skill_name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {skill_name}\ndescription: An example skill.\n---\n\nBody.\n"),
        )
        .unwrap();
    }
}

/// The full real-runtime-adjacent proof this feature exists for: `synth`
/// normalizes each agent's hand-authored `skill://~/.kiro/skills/...`
/// reference to the relative `skill://skills/<name>/SKILL.md` form
/// (destination-agnostic `dist/`), then `install` copies skills to
/// `.konductor/skills/` (NOT `.kiro/skills/`) and rewrites each agent's
/// reference to an absolute path under that root -- and each agent ends
/// up referencing ONLY its own declared skill, never the other's.
#[test]
fn real_synth_then_real_install_scopes_skill_resources_to_konductor_skills() {
    let sink = telemetry_test_sink::TelemetrySink::start();
    let repo_root = scratch_dir("repo-skill-scoping");
    seed_agent_spec_with_skill_source(&repo_root);

    let synth_result = run_konductor(
        &repo_root,
        &sink,
        &[CMD_SYNTH, "--from", &repo_root.display().to_string()],
    );
    assert!(
        synth_result.status.success(),
        "real `synth --from <repo>` must succeed: stderr={}",
        String::from_utf8_lossy(&synth_result.stderr)
    );

    let dist_dir = repo_root.join("dist");
    // Scoped to `dist/kiro-cli-v2/` -- see the identical comment in
    // `real_synth_then_real_install_agree_on_output_path_and_bytes`
    // above for why an unscoped `dist_dir` search now finds two files.
    let kiro_cli_v2_dist_dir = dist_dir.join("kiro-cli-v2");
    let synth_agent_a = find_files_named(&kiro_cli_v2_dist_dir, "agent-a.json");
    assert_eq!(synth_agent_a.len(), 1);
    let synth_value_a: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&synth_agent_a[0]).unwrap()).unwrap();
    assert_eq!(
        synth_value_a["resources"],
        serde_json::json!(["skill://skills/skill-a/SKILL.md"]),
        "synth's own dist/ output must normalize to the relative, destination-agnostic form"
    );

    let target_dir = scratch_dir("target-skill-scoping");
    let install_result = run_konductor(
        &target_dir,
        &sink,
        &[
            CMD_INSTALL,
            "--from",
            &repo_root.display().to_string(),
            "--target",
            &target_dir.display().to_string(),
            "--harness",
            "kiro-cli-v2",
        ],
    );
    assert!(
        install_result.status.success(),
        "real `install --from <repo>` must succeed after a real synth run: stderr={}",
        String::from_utf8_lossy(&install_result.stderr)
    );

    let installed_agent_a = find_files_named(&target_dir, "agent-a.json");
    let installed_agent_b = find_files_named(&target_dir, "agent-b.json");
    assert_eq!(installed_agent_a.len(), 1);
    assert_eq!(installed_agent_b.len(), 1);
    let value_a: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&installed_agent_a[0]).unwrap()).unwrap();
    let value_b: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&installed_agent_b[0]).unwrap()).unwrap();

    let expected_a = format!(
        "skill://{}",
        target_dir
            .join(".konductor/skills/skill-a/SKILL.md")
            .display()
    );
    let expected_b = format!(
        "skill://{}",
        target_dir
            .join(".konductor/skills/skill-b/SKILL.md")
            .display()
    );
    assert_eq!(
        value_a["resources"],
        serde_json::json!([expected_a]),
        "agent-a must reference only skill-a"
    );
    assert_eq!(
        value_b["resources"],
        serde_json::json!([expected_b]),
        "agent-b must reference only skill-b"
    );

    assert!(target_dir
        .join(".konductor/skills/skill-a/SKILL.md")
        .is_file());
    assert!(target_dir
        .join(".konductor/skills/skill-b/SKILL.md")
        .is_file());
    assert!(!target_dir.join(".kiro/skills").exists());

    std::fs::remove_dir_all(&repo_root).ok();
    std::fs::remove_dir_all(&target_dir).ok();
}

/// Seeds an agent-spec source tree whose agent declares a
/// `skill://~/.kiro/skills/<name>/SKILL.md` resource reference to a
/// skill that is never packaged under `skills/` -- a renamed or deleted
/// skill still referenced by an agent spec, per this fix's motivating
/// authoring mistake.
fn seed_agent_spec_with_dangling_skill_reference(repo_root: &Path) {
    let agents_dir = repo_root.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(
        agents_dir.join("k-example.agent-spec.json"),
        br#"{
  "schemaVersion": "1",
  "name": "k-example",
  "config": {
    "description": "An example agent.",
    "model": "claude-sonnet-5",
    "systemPrompt": "You are a helpful agent."
  },
  "clientConfig": {
    "kiroCli": {
      "resources": ["skill://~/.kiro/skills/renamed-or-deleted-skill/SKILL.md"]
    }
  }
}
"#,
    )
    .unwrap();
}

/// The real end-to-end proof for the skill cross-reference fix: a REAL
/// `synth --from <repo>` run against a source tree whose agent
/// references a skill that does not exist under `skills/` must fail
/// (non-zero exit), and the error must name the agent, the offending
/// field, and the missing skill -- never silently ship an agent with a
/// dangling reference. `parse_canonical` is shared by `synth`/`install`/
/// `doctor`; this test exercises the `synth` side of that sharing
/// through the real compiled binary (the `doctor` side is covered by
/// `doctor.rs`'s own unit tests in the same crate).
#[test]
fn real_synth_fails_on_dangling_skill_reference() {
    let sink = telemetry_test_sink::TelemetrySink::start();
    let repo_root = scratch_dir("repo-dangling-skill");
    seed_agent_spec_with_dangling_skill_reference(&repo_root);

    let synth_result = run_konductor(
        &repo_root,
        &sink,
        &[CMD_SYNTH, "--from", &repo_root.display().to_string()],
    );
    assert!(
        !synth_result.status.success(),
        "real `synth --from <repo>` must fail on a dangling skill reference"
    );
    let stderr = String::from_utf8_lossy(&synth_result.stderr);
    assert!(
        stderr.contains("k-example"),
        "error must name the offending agent, got: {stderr}"
    );
    assert!(
        stderr.contains("renamed-or-deleted-skill"),
        "error must name the missing skill, got: {stderr}"
    );
    assert!(
        stderr.contains("clientConfig.kiroCli.resources"),
        "error must name the offending field, got: {stderr}"
    );

    std::fs::remove_dir_all(&repo_root).ok();
}
