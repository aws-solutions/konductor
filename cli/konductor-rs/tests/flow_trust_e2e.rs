// SPDX-License-Identifier: Apache-2.0
//
// flow_trust_e2e.rs: drives the REAL compiled binary through the trust rules of `konductor flow run` and
// `konductor flow trust`. The tests have no terminal (stdin is null), so the prompt itself is covered by the unit tests
// of `src/cli/flow.rs`, which answer it from a script. Every test runs in a scratch project with `HOME` set to a scratch
// folder, so the trust record is the scratch one.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-flow-trust-e2e-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn hello_plan() -> String {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../workflow-engine/examples/hello-plan.yml");
    std::fs::read_to_string(path).expect("read hello-plan.yml")
}

const SCRIPT: &str = r#"{"stages": {
    "plan": {"reply": "KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}"},
    "implement": {"reply": "KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": []}"}}}"#;

struct Project {
    root: PathBuf,
    home: PathBuf,
    sink: telemetry_test_sink::TelemetrySink,
}

impl Project {
    fn new(label: &str) -> Project {
        let project = Project {
            root: scratch_dir(&format!("{label}-project")),
            home: scratch_dir(&format!("{label}-home")),
            sink: telemetry_test_sink::TelemetrySink::start(),
        };
        project.write(".konductor/workflows/hello-plan.yml", &hello_plan());
        project.write("script.json", SCRIPT);
        project
    }

    fn write(&self, relative: &str, text: &str) {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn write_user(&self, name: &str, text: &str) {
        let path = self.home.join(".konductor/workflows").join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(bin());
        command
            .args(args)
            .current_dir(&self.root)
            .env("HOME", &self.home)
            .env_remove("NO_COLOR")
            .env_remove("KONDUCTOR_LOG")
            .env_remove("KONDUCTOR_FAKE_SCRIPT")
            .env_remove("KONDUCTOR_TRUST")
            .stdin(Stdio::null());
        for var in self.sink.env_vars() {
            command.env(var.name, var.value);
        }
        command
    }

    fn flow(&self, args: &[&str]) -> Output {
        let mut full = vec!["flow"];
        full.extend_from_slice(args);
        self.command(&full).output().expect("spawn konductor")
    }

    fn run(&self, name: &str, extra: &[&str]) -> Output {
        let script = self.root.join("script.json");
        let mut args = vec![
            "run",
            name,
            "--harness",
            "fake",
            "--fake-script",
            script.to_str().unwrap(),
        ];
        args.extend_from_slice(extra);
        self.flow(&args)
    }

    fn hash(&self, name: &str) -> String {
        let output = self.flow(&["check", name, "--json"]);
        let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        report["trust_hash"].as_str().unwrap().to_string()
    }

    fn record(&self) -> PathBuf {
        self.home.join(".konductor/trust.json")
    }

    fn ran(&self) -> bool {
        self.root.join(".konductor/runs").exists()
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn exit(output: &Output) -> i32 {
    output.status.code().expect("exit code")
}

#[test]
fn an_untrusted_project_workflow_with_no_terminal_exits_77_names_both_ways_and_runs_nothing() {
    let project = Project::new("none");
    let output = project.run("hello-plan", &[]);
    assert_eq!(exit(&output), 77, "{}", stderr(&output));
    let text = stderr(&output);
    assert!(text.contains("konductor flow trust hello-plan"), "{text}");
    assert!(text.contains("--trust <hash>"), "{text}");
    assert!(text.contains("KONDUCTOR_TRUST=<hash>"), "{text}");
    assert_eq!(stdout(&output), "");
    assert!(!project.ran());
    assert!(!project.record().exists());
}

#[test]
fn a_matching_trust_hash_permits_that_run_only_and_the_environment_variable_works() {
    let project = Project::new("flag");
    let hash = project.hash("hello-plan");
    let output = project.run("hello-plan", &["--trust", &hash]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert!(!project.record().exists(), "--trust records nothing");
    assert_eq!(exit(&project.run("hello-plan", &[])), 77);

    let script = project.root.join("script.json");
    let output = project
        .command(&[
            "flow",
            "run",
            "hello-plan",
            "--harness",
            "fake",
            "--fake-script",
            script.to_str().unwrap(),
        ])
        .env("KONDUCTOR_TRUST", &hash)
        .output()
        .unwrap();
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
}

#[test]
fn a_trust_hash_that_differs_exits_77_and_prints_both_hashes_and_the_flag_beats_the_variable() {
    let project = Project::new("mismatch");
    let hash = project.hash("hello-plan");
    let wrong = "f".repeat(64);
    let output = project.run("hello-plan", &["--trust", &wrong]);
    assert_eq!(exit(&output), 77);
    let text = stderr(&output);
    assert!(text.contains(&wrong) && text.contains(&hash), "{text}");
    assert!(!project.ran());

    let script = project.root.join("script.json");
    let output = project
        .command(&[
            "flow",
            "run",
            "hello-plan",
            "--harness",
            "fake",
            "--fake-script",
            script.to_str().unwrap(),
            "--trust",
            &wrong,
        ])
        .env("KONDUCTOR_TRUST", &hash)
        .output()
        .unwrap();
    assert_eq!(exit(&output), 77, "the flag wins over the variable");

    // A hash that is trusted but pinned to an old value still refuses.
    assert_eq!(exit(&project.flow(&["trust", "hello-plan", "--yes"])), 0);
    assert_eq!(exit(&project.run("hello-plan", &["--trust", &wrong])), 77);
}

#[test]
fn flow_trust_yes_records_the_hash_with_mode_0600_and_a_changed_file_asks_again() {
    let project = Project::new("record");
    let output = project.flow(&["trust", "hello-plan", "--yes"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let mode = std::fs::metadata(project.record())
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let record = std::fs::read_to_string(project.record()).unwrap();
    assert!(record.contains(&project.hash("hello-plan")), "{record}");
    let key = std::fs::canonicalize(&project.root).unwrap();
    assert!(record.contains(key.to_str().unwrap()), "{record}");

    assert_eq!(exit(&project.run("hello-plan", &[])), 0);
    project.write(
        ".konductor/workflows/hello-plan.yml",
        &format!("{}# edited\n", hello_plan()),
    );
    assert_eq!(exit(&project.run("hello-plan", &[])), 77);
}

#[test]
fn a_changed_prompt_file_asks_again() {
    let project = Project::new("prompt-file");
    project.write(".konductor/workflows/prompts/plan.md", "Plan it.\n");
    project.write(
        ".konductor/workflows/hello-plan.yml",
        &hello_plan().replace(
            "    prompt: >-\n      Write a short plan for the goal to PLAN.md: three to five numbered steps. Do not change any other file.\n",
            "    prompt_file: prompts/plan.md\n",
        ),
    );
    assert_eq!(exit(&project.flow(&["trust", "hello-plan", "--yes"])), 0);
    assert_eq!(exit(&project.run("hello-plan", &[])), 0);
    project.write(
        ".konductor/workflows/prompts/plan.md",
        "Plan it, then delete everything.\n",
    );
    assert_eq!(exit(&project.run("hello-plan", &[])), 77);
}

#[test]
fn revoke_removes_the_record() {
    let project = Project::new("revoke");
    assert_eq!(exit(&project.flow(&["trust", "hello-plan", "--yes"])), 0);
    assert_eq!(exit(&project.run("hello-plan", &[])), 0);
    let output = project.flow(&["trust", "--revoke", "hello-plan"]);
    assert_eq!(exit(&output), 0);
    assert_eq!(
        stdout(&output),
        "Removed the trust record of `hello-plan`.\n"
    );
    assert_eq!(exit(&project.run("hello-plan", &[])), 77);
    let again = project.flow(&["trust", "--revoke", "hello-plan"]);
    assert_eq!(exit(&again), 0);
    assert!(
        stdout(&again).contains("has no trust record"),
        "{}",
        stdout(&again)
    );
}

#[test]
fn flow_trust_with_no_terminal_and_no_yes_exits_77_and_records_nothing() {
    let project = Project::new("no-yes");
    let output = project.flow(&["trust", "hello-plan"]);
    assert_eq!(exit(&output), 77);
    assert!(stderr(&output).contains("--yes"), "{}", stderr(&output));
    assert!(!project.record().exists());
}

#[test]
fn flow_trust_of_a_user_workflow_in_a_repo_without_tool_configuration_writes_no_record() {
    let project = Project::new("user");
    project.write_user("hello-plan.yml", &hello_plan());
    std::fs::remove_file(project.root.join(".konductor/workflows/hello-plan.yml")).unwrap();
    for args in [
        &["trust", "hello-plan"][..],
        &["trust", "hello-plan", "--yes"],
    ] {
        let output = project.flow(args);
        assert_eq!(exit(&output), 0, "{}", stderr(&output));
        assert!(
            stdout(&output).contains("No trust is needed"),
            "{}",
            stdout(&output)
        );
    }
    assert!(!project.record().exists());
    // And it runs without being asked.
    assert_eq!(exit(&project.run("hello-plan", &[])), 0);
}

#[test]
fn a_repo_with_a_claude_settings_file_asks_for_a_user_workflow() {
    let project = Project::new("settings");
    project.write_user("hello-plan.yml", &hello_plan());
    std::fs::remove_file(project.root.join(".konductor/workflows/hello-plan.yml")).unwrap();
    let before = project.hash("hello-plan");
    project.write(".claude/settings.json", "{\"hooks\": {}}");
    assert_ne!(
        project.hash("hello-plan"),
        before,
        "the hash covers the settings file"
    );
    let output = project.run("hello-plan", &[]);
    assert_eq!(exit(&output), 77);
    assert!(
        stderr(&output).contains("tool configuration files"),
        "{}",
        stderr(&output)
    );

    assert_eq!(exit(&project.flow(&["trust", "hello-plan", "--yes"])), 0);
    assert_eq!(exit(&project.run("hello-plan", &[])), 0);
    project.write(".claude/settings.json", "{\"hooks\": {\"x\": 1}}");
    assert_eq!(exit(&project.run("hello-plan", &[])), 77);
}

#[test]
fn every_other_kind_of_tool_configuration_counts_too() {
    let project = Project::new("kinds");
    project.write_user("hello-plan.yml", &hello_plan());
    std::fs::remove_file(project.root.join(".konductor/workflows/hello-plan.yml")).unwrap();
    for file in [".mcp.json", ".kiro/agents/a.json", ".claude/agents/a.md"] {
        assert_eq!(exit(&project.run("hello-plan", &[])), 0, "before {file}");
        project.write(file, "{}");
        assert_eq!(exit(&project.run("hello-plan", &[])), 77, "{file}");
        std::fs::remove_file(project.root.join(file)).unwrap();
    }
}

#[test]
fn a_record_that_cannot_be_read_trusts_nothing() {
    let project = Project::new("bad-record");
    assert_eq!(exit(&project.flow(&["trust", "hello-plan", "--yes"])), 0);
    assert_eq!(exit(&project.run("hello-plan", &[])), 0);
    std::fs::write(project.record(), "{ not json").unwrap();
    assert_eq!(exit(&project.run("hello-plan", &[])), 77);
}

#[test]
fn check_prints_the_trust_hash_in_both_forms_and_it_follows_the_bytes() {
    let project = Project::new("check");
    let plain = project.flow(&["check", "hello-plan"]);
    let hash = project.hash("hello-plan");
    assert_eq!(hash.len(), 64);
    assert!(
        stdout(&plain).ends_with(&format!("trust hash: {hash}\n")),
        "{}",
        stdout(&plain)
    );
    project.write(
        ".konductor/workflows/hello-plan.yml",
        &format!("{}\n", hello_plan()),
    );
    assert_ne!(project.hash("hello-plan"), hash);
}

#[test]
fn under_json_a_refusal_is_the_error_envelope_with_the_code() {
    let project = Project::new("json");
    let output = project.run("hello-plan", &["--json"]);
    assert_eq!(exit(&output), 77);
    let envelope: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(envelope["command"], "flow");
    assert_eq!(envelope["code"], "trust_required");
    assert_eq!(envelope["trust_hash"], project.hash("hello-plan"));
    assert_eq!(stderr(&output), "");
}

#[test]
fn the_old_repo_wide_form_does_not_exist() {
    let project = Project::new("old-form");
    for args in [
        &["trust"][..],
        &["trust", "--all"],
        &["trust", "a", "--revoke", "b"],
    ] {
        let output = project.flow(args);
        assert_eq!(exit(&output), 64, "{args:?}");
    }
}

#[test]
fn a_manifest_without_the_install_index_vouches_for_nothing() {
    let project = Project::new("forged");
    project.write_user("hello-plan.yml", &hello_plan());
    std::fs::remove_file(project.root.join(".konductor/workflows/hello-plan.yml")).unwrap();
    project.write(".claude/agents/k-a.md", "installed");
    let hash = "5a1b2b3d1f9b2c6a0a1f3a2b8f6d2f2d0c0f0f4b6a3c1d8f9e0b7c6d5e4f3a2b";
    project.write(
        ".konductor/manifest",
        &format!(
            r#"{{"schema_version":2,"strategies":[{{"strategy":"claude","installed_at":"2026-01-01T00:00:00Z","destination":".","status":"complete","files":[{{"path":".claude/agents/k-a.md","sha256":"{hash}","provenance":"created"}}]}}]}}"#
        ),
    );
    assert_eq!(exit(&project.run("hello-plan", &[])), 77);
}

#[test]
fn a_linked_agent_folder_refuses_every_way_in_and_an_edit_behind_it_changes_nothing() {
    let project = Project::new("linked");
    project.write("elsewhere/evil.md", "one");
    std::fs::create_dir_all(project.root.join(".claude")).unwrap();
    std::os::unix::fs::symlink(
        project.root.join("elsewhere"),
        project.root.join(".claude/agents"),
    )
    .unwrap();
    let hash = project.hash("hello-plan");
    for edit in ["one", "two"] {
        project.write("elsewhere/evil.md", edit);
        let output = project.run("hello-plan", &[]);
        assert_eq!(exit(&output), 77);
        assert!(
            stderr(&output).contains("cannot be read in full"),
            "{}",
            stderr(&output)
        );
        assert_eq!(exit(&project.run("hello-plan", &["--trust", &hash])), 77);
        assert_eq!(exit(&project.flow(&["trust", "hello-plan", "--yes"])), 77);
        assert!(!project.record().exists());
        assert!(!project.ran());
    }
    let json = project.run("hello-plan", &["--json"]);
    let envelope: serde_json::Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(envelope["code"], "tool_config_unreadable");
}

#[test]
fn a_folder_with_too_many_files_or_nested_too_deep_refuses() {
    let project = Project::new("limits");
    for n in 0..600 {
        project.write(&format!(".kiro/agents/a{n:04}.json"), "{}");
    }
    project.write(".claude/agents/evil.md", "one");
    let hash = project.hash("hello-plan");
    assert_eq!(exit(&project.run("hello-plan", &["--trust", &hash])), 77);
    assert_eq!(exit(&project.flow(&["trust", "hello-plan", "--yes"])), 77);

    let deep = Project::new("deep");
    deep.write(".claude/agents/a/b/c/d/e/evil.md", "one");
    let hash = deep.hash("hello-plan");
    assert_eq!(exit(&deep.run("hello-plan", &["--trust", &hash])), 77);
    assert_eq!(exit(&deep.flow(&["trust", "hello-plan", "--yes"])), 77);
}

#[test]
fn a_file_name_that_is_not_utf8_refuses() {
    use std::os::unix::ffi::OsStrExt;
    let project = Project::new("non-utf8");
    let dir = project.root.join(".claude/agents");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(std::ffi::OsStr::from_bytes(b"\xff.md")), "x").unwrap();
    let hash = project.hash("hello-plan");
    assert_eq!(exit(&project.run("hello-plan", &["--trust", &hash])), 77);
    assert_eq!(exit(&project.flow(&["trust", "hello-plan", "--yes"])), 77);
}

#[test]
fn a_run_from_a_subfolder_sees_the_tool_configuration_at_the_git_root() {
    let project = Project::new("subfolder");
    project.write(".mcp.json", "{}");
    std::fs::create_dir_all(project.root.join(".git")).unwrap();
    let sub = project.root.join("pkg");
    std::fs::create_dir_all(sub.join(".konductor/workflows")).unwrap();
    std::fs::write(
        sub.join(".konductor/workflows/hello-plan.yml"),
        hello_plan(),
    )
    .unwrap();
    let script = project.root.join("script.json");
    let mut command = project.command(&[
        "flow",
        "run",
        "hello-plan",
        "--harness",
        "fake",
        "--fake-script",
        script.to_str().unwrap(),
    ]);
    command.current_dir(&sub);
    let output = command.output().unwrap();
    assert_eq!(exit(&output), 77, "{}", stderr(&output));
    assert!(
        stderr(&output).contains("tool configuration files"),
        "{}",
        stderr(&output)
    );
}

/// A repo whose git root is `project.root`, with the same workflow at the root and in `pkg/`, so the run can start from
/// either folder.
fn repo_with_subfolder(label: &str) -> (Project, PathBuf) {
    let project = Project::new(label);
    project.write(".mcp.json", "{}");
    std::fs::create_dir_all(project.root.join(".git")).unwrap();
    let sub = project.root.join("pkg");
    std::fs::create_dir_all(sub.join(".konductor/workflows")).unwrap();
    std::fs::write(
        sub.join(".konductor/workflows/hello-plan.yml"),
        hello_plan(),
    )
    .unwrap();
    (project, sub)
}

fn run_in(project: &Project, dir: &Path, args: &[&str]) -> Output {
    let script = project.root.join("script.json");
    let mut full = vec!["flow"];
    full.extend_from_slice(args);
    full.extend_from_slice(&[
        "--harness",
        "fake",
        "--fake-script",
        script.to_str().unwrap(),
    ]);
    let mut command = project.command(&full);
    command.current_dir(dir);
    command.output().unwrap()
}

fn trust_in(project: &Project, dir: &Path) -> Output {
    let mut command = project.command(&["flow", "trust", "hello-plan", "--yes"]);
    command.current_dir(dir);
    command.output().unwrap()
}

#[test]
fn trusting_at_the_git_root_covers_a_run_from_a_subfolder() {
    let (project, sub) = repo_with_subfolder("root-then-sub");
    let output = trust_in(&project, &project.root);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let output = run_in(&project, &sub, &["run", "hello-plan"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let record = std::fs::read_to_string(project.record()).unwrap();
    let key = std::fs::canonicalize(&project.root).unwrap();
    assert!(record.contains(key.to_str().unwrap()), "{record}");
    assert!(!record.contains("pkg"), "{record}");
}

#[test]
fn trusting_in_a_subfolder_covers_a_run_from_the_git_root() {
    let (project, sub) = repo_with_subfolder("sub-then-root");
    let output = trust_in(&project, &sub);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let output = run_in(&project, &project.root, &["run", "hello-plan"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
}

#[test]
fn a_record_that_cannot_be_kept_exits_74_and_not_1() {
    let project = Project::new("no-home");
    let mut command = project.command(&["flow", "trust", "hello-plan", "--yes"]);
    command.env_remove("HOME");
    let output = command.output().unwrap();
    assert_eq!(exit(&output), 74, "{}", stderr(&output));
    assert!(
        stderr(&output).contains("HOME is not set"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn flow_trust_on_a_trusted_workflow_says_so_and_exits_0() {
    let project = Project::new("already");
    assert_eq!(exit(&project.flow(&["trust", "hello-plan", "--yes"])), 0);
    let output = project.flow(&["trust", "hello-plan"]);
    assert_eq!(exit(&output), 0);
    assert!(
        stdout(&output).contains("is already trusted ("),
        "{}",
        stdout(&output)
    );
}
