// SPDX-License-Identifier: Apache-2.0
//
// verify_run_cli.rs: drives the real binary's `verify-run` over k-full-sdlc
// session files in a scratch project, one test per exit row, and checks the
// command changes no file under the project.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::SystemTime;

use serde_yaml::Value;

const SESSION: &str = ".konductor/sessions/k-full-sdlc-20250101T000000Z-abcd.yml";

const PHASES: [&str; 12] = [
    "elicitation",
    "codebase-analysis",
    "requirements",
    "design",
    "design-review",
    "feature-splitting",
    "specs",
    "implementation",
    "code-review",
    "testing",
    "documentation",
    "final-summary",
];

const EVIDENCE: [&str; 5] = [
    "out/design/principal-engineer-review.md",
    "out/feature-split/feature-split.md",
    "out/specs/login/tasks.md",
    "out/login/code-review/report.md",
    "out/login/testing/test-coverage-review-report.md",
];

/// A scratch project and a separate scratch `HOME`, both canonicalized so
/// macOS's `/var` to `/private/var` link never splits the root check.
struct Project {
    root: PathBuf,
    home: PathBuf,
    sink: telemetry_test_sink::TelemetrySink,
}

impl Project {
    fn new(name: &str) -> Self {
        let base = std::env::temp_dir().join(format!(
            "konductor-verify-run-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = base.join("project");
        let home = base.join("home");
        std::fs::create_dir_all(root.join(".konductor/sessions")).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        for evidence in EVIDENCE {
            let path = root.join(evidence);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "report\n").unwrap();
        }
        Project {
            root: root.canonicalize().unwrap(),
            home: home.canonicalize().unwrap(),
            sink: telemetry_test_sink::TelemetrySink::start(),
        }
    }

    fn write_session(&self, session: &Value) {
        std::fs::write(
            self.root.join(SESSION),
            serde_yaml::to_string(session).unwrap(),
        )
        .unwrap();
    }

    fn write_session_text(&self, text: &str) {
        std::fs::write(self.root.join(SESSION), text).unwrap();
    }

    fn run(&self, args: &[&str]) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_konductor"));
        command
            .args(args)
            .current_dir(&self.root)
            .env("HOME", &self.home)
            .env_remove("KONDUCTOR_LOG");
        for var in self.sink.env_vars() {
            command.env(var.name, &var.value);
        }
        command.output().expect("failed to spawn konductor")
    }

    fn verify(&self, extra: &[&str]) -> Output {
        let mut args = vec!["verify-run", "--session", SESSION];
        args.extend_from_slice(extra);
        self.run(&args)
    }
}

fn passing() -> Value {
    let phases: String = PHASES
        .iter()
        .map(|id| {
            format!("  {id}: {{name: n, status: COMPLETED, skip_reason: null, summary: done}}\n")
        })
        .collect();
    serde_yaml::from_str(&format!(
        "run:
  schema_version: 1
  project_signature: sig
  run_status: completed
  counters: {{}}
  data:
    max_fix_cycles: 2
    gate_design-review_result: none
    gate_design-review_evidence: {}
    gate_design-review_checker: k-architect
    gate_feature-splitting_result: approved
    gate_feature-splitting_evidence: {}
    gate_feature-splitting_checker: user
    gate_code-review_result: approved
    gate_code-review_evidence: {}
    gate_code-review_checker: user
phases:
{phases}features:
  login:
    counters: {{fix_cycles_used: 0}}
    data:
      gate_specs_result: approved
      gate_specs_evidence: {}
      gate_specs_checker: user
      gate_testing_result: none
      gate_testing_evidence: {}
      gate_testing_checker: k-quality-assurance
",
        EVIDENCE[0], EVIDENCE[1], EVIDENCE[3], EVIDENCE[2], EVIDENCE[4]
    ))
    .unwrap()
}

fn set_phase(session: &mut Value, id: &str, status: &str) {
    session["phases"][id]["status"] = Value::from(status);
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// Asserts the exit code and that `code` is a reason line on stdout.
fn assert_verdict(output: &Output, exit: i32, code: &str) {
    let out = stdout(output);
    assert_eq!(
        output.status.code(),
        Some(exit),
        "stdout: {out}\nstderr: {}",
        stderr(output)
    );
    assert!(
        out.lines()
            .any(|line| line.starts_with(&format!("{code}: "))),
        "expected a {code} line in: {out}"
    );
}

/// Asserts a V1 content failure: exit `exit` and the reason on stderr.
fn assert_invalid_with(output: &Output, exit: i32, code: &str) {
    let err = stderr(output);
    assert_eq!(output.status.code(), Some(exit), "stderr: {err}");
    assert!(
        err.contains(&format!("konductor verify-run: {code}: ")),
        "expected {code} on stderr: {err}"
    );
}

fn assert_invalid(output: &Output, code: &str) {
    assert_invalid_with(output, 65, code);
}

#[test]
fn a_complete_session_passes_with_exit_0() {
    let project = Project::new("pass");
    project.write_session(&passing());
    let output = project.verify(&[]);
    assert_verdict(&output, 0, "PASSED");
    assert!(stdout(&output).starts_with("konductor verify-run: PASSED (exit 0)"));
}

#[test]
fn a_skipped_gate_phase_passes_with_exit_6() {
    let project = Project::new("skipped");
    let mut session = passing();
    set_phase(&mut session, "design-review", "SKIPPED");
    session["phases"]["design-review"]["skip_reason"] = Value::from("small change");
    project.write_session(&session);
    let output = project.verify(&[]);
    assert_verdict(&output, 6, "PASSED");
    assert!(stdout(&output).contains("PHASE_SKIPPED: "));
}

#[test]
fn a_blocked_phase_exits_1() {
    let project = Project::new("blocked");
    let mut session = passing();
    session["run"]["run_status"] = Value::from("in_progress");
    set_phase(&mut session, "testing", "BLOCKED");
    set_phase(&mut session, "documentation", "PENDING");
    set_phase(&mut session, "final-summary", "PENDING");
    project.write_session(&session);
    assert_verdict(&project.verify(&["--allow-running"]), 1, "HALTED");
}

#[test]
fn an_open_important_finding_exits_2_under_the_strict_floor() {
    let project = Project::new("important");
    let mut session = passing();
    session["features"]["login"]["data"]["gate_testing_result"] = Value::from("IMPORTANT");
    project.write_session(&session);
    let output = project.verify(&[]);
    assert_verdict(&output, 2, "FINDING_UNRESOLVED");
    assert!(stdout(&output).contains("basis=strict_floor"));
}

#[test]
fn fix_cycles_above_the_cap_exit_3() {
    let project = Project::new("budget");
    let mut session = passing();
    session["features"]["login"]["counters"]["fix_cycles_used"] = Value::from(3);
    project.write_session(&session);
    assert_verdict(&project.verify(&[]), 3, "BUDGET_EXCEEDED");
}

#[test]
fn a_missing_gate_result_exits_65() {
    let project = Project::new("gate-missing");
    let mut session = passing();
    session["run"]["data"]
        .as_mapping_mut()
        .unwrap()
        .remove("gate_code-review_result");
    project.write_session(&session);
    assert_verdict(&project.verify(&[]), 65, "GATE_MISSING");
}

#[test]
fn evidence_outside_the_project_exits_65() {
    let project = Project::new("evidence-outside");
    let mut session = passing();
    session["features"]["login"]["data"]["gate_specs_evidence"] =
        Value::from("../home/elsewhere.md");
    std::fs::write(project.home.join("elsewhere.md"), "x").unwrap();
    project.write_session(&session);
    assert_verdict(&project.verify(&[]), 65, "EVIDENCE_MISSING");
}

#[test]
fn a_running_session_exits_65_unless_allowed() {
    let project = Project::new("running");
    let mut session = passing();
    session["run"]["run_status"] = Value::from("in_progress");
    set_phase(&mut session, "final-summary", "IN_PROGRESS");
    project.write_session(&session);
    assert_verdict(&project.verify(&[]), 65, "RUNNING");
    assert_verdict(&project.verify(&["--allow-running"]), 0, "RUNNING");
}

#[test]
fn a_missing_session_file_exits_65() {
    let project = Project::new("missing");
    assert_invalid(&project.verify(&[]), "SESSION_INVALID");
}

#[cfg(unix)]
#[test]
fn a_symlinked_session_file_exits_65() {
    let project = Project::new("symlink");
    let real = project.root.join(".konductor/real.yml");
    std::fs::write(&real, serde_yaml::to_string(&passing()).unwrap()).unwrap();
    std::os::unix::fs::symlink(&real, project.root.join(SESSION)).unwrap();
    let output = project.verify(&[]);
    assert_invalid(&output, "SESSION_INVALID");
    assert!(stderr(&output).contains("symlink"));
}

#[test]
fn a_session_outside_the_project_root_exits_65() {
    let project = Project::new("outside");
    let outside = project.home.join("k-full-sdlc-20250101T000000Z-abcd.yml");
    std::fs::write(&outside, serde_yaml::to_string(&passing()).unwrap()).unwrap();
    let output = project.run(&["verify-run", "--session", outside.to_str().unwrap()]);
    assert_invalid(&output, "SESSION_INVALID");
    assert!(stderr(&output).contains("outside the root"));
}

#[test]
fn a_local_tag_is_rejected_with_exit_65() {
    let project = Project::new("local-tag");
    let text = serde_yaml::to_string(&passing())
        .unwrap()
        .replace("max_fix_cycles: 2", "max_fix_cycles: !custom 2");
    assert!(text.contains("!custom 2"));
    project.write_session_text(&text);
    assert_invalid(&project.verify(&[]), "SESSION_INVALID");
}

#[test]
fn a_core_schema_tag_is_read_as_plain_data() {
    // serde_yaml resolves `!!int` to the untagged scalar, so the tagged file
    // gives the verdict of the untagged one. A recorded cap of 1 with two
    // fix cycles used is over budget (exit 3); a dropped value would fall
    // back to the cap of 2 and pass, so exit 3 shows the value survived.
    let project = Project::new("core-tag");
    let mut session = passing();
    session["run"]["data"]["max_fix_cycles"] = Value::from(1);
    session["features"]["login"]["counters"]["fix_cycles_used"] = Value::from(2);
    let plain = serde_yaml::to_string(&session).unwrap();
    assert!(plain.contains("max_fix_cycles: 1"));
    project.write_session_text(&plain);
    assert_verdict(&project.verify(&[]), 3, "BUDGET_EXCEEDED");

    project.write_session_text(&plain.replace("max_fix_cycles: 1", "max_fix_cycles: !!int 1"));
    assert_verdict(&project.verify(&[]), 3, "BUDGET_EXCEEDED");
}

#[test]
fn a_core_schema_python_tag_does_not_construct_anything() {
    let project = Project::new("python-tag");
    let text = serde_yaml::to_string(&passing()).unwrap().replace(
        "max_fix_cycles: 2",
        "max_fix_cycles: !!python/object:os.system {cmd: ls}",
    );
    assert!(text.contains("!!python/object"));
    project.write_session_text(&text);
    assert_verdict(&project.verify(&[]), 65, "RECORD_INTEGRITY");
}

#[test]
fn a_non_utf8_session_file_exits_65() {
    let project = Project::new("non-utf8");
    std::fs::write(project.root.join(SESSION), [0xff, 0xfe, b'\n']).unwrap();
    assert_invalid(&project.verify(&[]), "SESSION_INVALID");
}

#[test]
fn an_invalid_project_config_exits_65() {
    let project = Project::new("bad-config");
    project.write_session(&passing());
    std::fs::write(
        project.root.join(".konductor/config.yml"),
        "fail_on_severity_at_or_above: BOGUS\n",
    )
    .unwrap();
    assert_invalid(&project.verify(&[]), "CONFIG_INVALID");
}

#[test]
fn usage_errors_exit_64_never_2() {
    let project = Project::new("usage");
    project.write_session(&passing());
    for args in [
        vec!["verify-run"],
        vec!["verify-run", "--session", SESSION, "--no-such-flag"],
        vec!["verify-run", "--session"],
        vec!["verify-run", "--session", SESSION, "--root"],
        vec!["verify-run", "--session", SESSION, "--root", "no-such-dir"],
        vec!["verify-run", "--session", SESSION, "--root", SESSION],
    ] {
        let output = project.run(&args);
        assert_eq!(output.status.code(), Some(64), "args {args:?}");
    }
}

/// A second directory next to the project, standing in for an output
/// directory outside the checkout: the session and its evidence live there.
fn output_dir_with_session(project: &Project, session: &Value) -> PathBuf {
    let out = project.root.parent().unwrap().join("outdir");
    for evidence in EVIDENCE {
        let path = out.join(evidence);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "report\n").unwrap();
    }
    let file = out.join(SESSION);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, serde_yaml::to_string(session).unwrap()).unwrap();
    out.canonicalize().unwrap()
}

#[test]
fn a_session_outside_the_cwd_passes_under_root() {
    let project = Project::new("root-ok");
    let out = output_dir_with_session(&project, &passing());
    let output = project.run(&[
        "verify-run",
        "--session",
        SESSION,
        "--root",
        out.to_str().unwrap(),
    ]);
    assert_verdict(&output, 0, "PASSED");
}

#[test]
fn a_session_outside_root_is_refused_with_exit_65() {
    let project = Project::new("root-outside");
    project.write_session(&passing());
    let out = output_dir_with_session(&project, &passing());
    let session = project.root.join(SESSION);
    let output = project.run(&[
        "verify-run",
        "--session",
        session.to_str().unwrap(),
        "--root",
        out.to_str().unwrap(),
    ]);
    assert_invalid(&output, "SESSION_INVALID");
    assert!(stderr(&output).contains("outside the root"));
}

#[test]
fn evidence_outside_root_is_refused() {
    let project = Project::new("root-evidence");
    let mut session = passing();
    session["run"]["data"]["gate_design-review_evidence"] =
        Value::from("../project/out/design/principal-engineer-review.md");
    let out = output_dir_with_session(&project, &session);
    let output = project.run(&[
        "verify-run",
        "--session",
        SESSION,
        "--root",
        out.to_str().unwrap(),
    ]);
    assert_verdict(&output, 65, "EVIDENCE_MISSING");
}

#[test]
fn a_relative_root_resolves_against_the_cwd() {
    let project = Project::new("root-relative");
    output_dir_with_session(&project, &passing());
    let output = project.run(&["verify-run", "--session", SESSION, "--root", "../outdir"]);
    assert_verdict(&output, 0, "PASSED");
}

#[test]
fn json_output_carries_the_same_exit() {
    let project = Project::new("json");
    let mut session = passing();
    session["features"]["login"]["data"]["gate_testing_result"] = Value::from("IMPORTANT");
    project.write_session(&session);
    let output = project.verify(&["--json"]);
    assert_eq!(output.status.code(), Some(2));
    let doc: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(doc["exit"], 2);
    assert_eq!(doc["reasons"][0]["code"], "FINDING_UNRESOLVED");
    assert!(doc["info"].is_array());

    std::fs::remove_file(project.root.join(SESSION)).unwrap();
    let output = project.verify(&["--json"]);
    assert_eq!(output.status.code(), Some(65));
    let doc: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(doc["exit"], 65);
    assert_eq!(doc["reasons"][0]["code"], "SESSION_INVALID");
}

const MEDIUM_CONFIG: &str = "fail_on_severity_at_or_above: MEDIUM\n";

fn write_project_config(project: &Project, text: &str) {
    std::fs::write(project.root.join(".konductor/config.yml"), text).unwrap();
}

fn root_args(out: &Path) -> Vec<&str> {
    vec![
        "verify-run",
        "--session",
        SESSION,
        "--root",
        out.to_str().unwrap(),
    ]
}

fn medium_session() -> Value {
    let mut session = passing();
    session["features"]["login"]["data"]["gate_testing_result"] = Value::from("MEDIUM");
    session
}

#[test]
fn the_project_config_in_the_cwd_applies_when_root_names_another_directory() {
    let project = Project::new("root-config");
    write_project_config(&project, MEDIUM_CONFIG);
    let out = output_dir_with_session(&project, &medium_session());
    let output = project.run(&root_args(&out));
    assert_verdict(&output, 2, "FINDING_UNRESOLVED");
    let plain = stdout(&output);
    assert!(plain.contains("basis=config"), "{plain}");
    let source = project.root.join(".konductor/config.yml");
    assert!(
        plain.contains(&format!(
            "CONFIG_SOURCE: fail_on_severity_at_or_above=MEDIUM from {}",
            source.display()
        )),
        "{plain}"
    );
}

#[test]
fn a_config_under_root_does_not_supply_the_threshold() {
    let project = Project::new("root-config-ignored");
    let out = output_dir_with_session(&project, &medium_session());
    std::fs::create_dir_all(out.join(".konductor")).unwrap();
    std::fs::write(out.join(".konductor/config.yml"), MEDIUM_CONFIG).unwrap();
    assert_verdict(&project.run(&root_args(&out)), 0, "PASSED");
}

#[test]
fn the_output_names_defaults_when_no_config_sets_the_threshold() {
    let project = Project::new("config-defaults");
    project.write_session(&passing());
    let output = project.verify(&[]);
    assert_verdict(&output, 0, "PASSED");
    assert!(
        stdout(&output).contains("from defaults"),
        "{}",
        stdout(&output)
    );
}

#[test]
fn the_user_config_is_named_when_it_supplies_the_threshold() {
    let project = Project::new("config-user");
    project.write_session(&medium_session());
    let user = project.home.join(".konductor");
    std::fs::create_dir_all(&user).unwrap();
    std::fs::write(user.join("config.yml"), MEDIUM_CONFIG).unwrap();
    let output = project.verify(&["--json"]);
    assert_eq!(output.status.code(), Some(2));
    let doc: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let source = doc["info"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["code"] == "CONFIG_SOURCE")
        .expect("a CONFIG_SOURCE info entry");
    let detail = source["detail"].as_str().unwrap();
    assert!(detail.ends_with("home/.konductor/config.yml"), "{detail}");
}

#[test]
fn the_sop_step_invocation_works_for_a_running_session_in_an_output_dir() {
    let project = Project::new("sop-step");
    write_project_config(&project, MEDIUM_CONFIG);
    let mut session = passing();
    session["run"]["run_status"] = Value::from("in_progress");
    set_phase(&mut session, "final-summary", "IN_PROGRESS");
    let out = output_dir_with_session(&project, &session);
    let mut args = root_args(&out);
    args.push("--allow-running");
    assert_verdict(&project.run(&args), 0, "RUNNING");
    let mut blocked = root_args(&out);
    blocked.push("--json");
    let output = project.run(&blocked);
    assert_eq!(output.status.code(), Some(65));
}

#[test]
fn a_bad_root_is_an_argument_error_with_its_own_reason_code() {
    let project = Project::new("bad-root-json");
    project.write_session(&passing());
    let output = project.verify(&["--root", "no-such-dir", "--json"]);
    assert_eq!(output.status.code(), Some(64));
    let doc: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(doc["reasons"][0]["code"], "ARGUMENT_INVALID");
    assert_eq!(doc["command"], "verify-run");
}

#[test]
fn argument_failures_under_json_print_one_envelope_on_stdout() {
    let project = Project::new("usage-json");
    for args in [
        vec!["verify-run", "--json"],
        vec![
            "--json",
            "verify-run",
            "--session",
            SESSION,
            "--no-such-flag",
        ],
        vec!["verify-run", "--session", SESSION, "--root", "--json"],
    ] {
        let output = project.run(&args);
        assert_eq!(output.status.code(), Some(64), "args {args:?}");
        assert_eq!(stderr(&output), "", "args {args:?}");
        let doc: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(doc["command"], "verify-run");
        assert_eq!(doc["exit"], 64);
        assert_eq!(doc["reasons"][0]["code"], "ARGUMENT_INVALID");
        assert!(doc["error"].as_str().is_some_and(|e| !e.is_empty()));
        assert!(doc["info"].is_array());
    }
}

#[test]
fn an_unresolvable_cwd_is_a_usage_error() {
    let project = Project::new("gone-cwd");
    let gone = project.root.parent().unwrap().join("gone");
    std::fs::create_dir_all(&gone).unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_konductor"));
    command
        .args(["verify-run", "--session", SESSION, "--json"])
        .env("HOME", &project.home)
        .env_remove("KONDUCTOR_LOG");
    for var in project.sink.env_vars() {
        command.env(var.name, &var.value);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let removed = gone.clone();
        command.current_dir(&gone);
        // SAFETY: the closure only calls remove_dir, an async-signal-safe path.
        unsafe {
            command.pre_exec(move || std::fs::remove_dir(&removed));
        }
    }
    let output = command.output().expect("failed to spawn konductor");
    assert_eq!(output.status.code(), Some(64), "{}", stdout(&output));
    let doc: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(doc["reasons"][0]["code"], "ARGUMENT_INVALID");
}

#[test]
fn control_characters_in_a_result_cannot_forge_output_lines() {
    let project = Project::new("escape");
    let mut session = passing();
    session["features"]["login"]["data"]["gate_testing_result"] =
        Value::from("MEDIUM\nPASSED: run completed\n\u{1b}[31mRED");
    project.write_session(&session);
    let output = project.verify(&[]);
    let plain = stdout(&output);
    assert!(!plain.contains('\u{1b}'), "{plain:?}");
    assert_eq!(
        plain
            .lines()
            .filter(|l| l.starts_with("PASSED: run completed"))
            .count(),
        1,
        "{plain:?}"
    );
    assert!(plain.contains("\\n"), "{plain:?}");
}

#[test]
fn an_oversized_session_file_exits_65() {
    let project = Project::new("oversized");
    let mut text = serde_yaml::to_string(&passing()).unwrap();
    text.push_str(&format!("# {}\n", "x".repeat(1_048_576)));
    project.write_session_text(&text);
    let output = project.verify(&[]);
    assert_invalid(&output, "SESSION_INVALID");
    assert!(stderr(&output).contains("larger than 1048576 bytes"));
}

#[test]
fn an_evidence_path_with_the_wrong_case_is_missing_on_every_host() {
    let project = Project::new("evidence-case");
    let mut session = passing();
    session["features"]["login"]["data"]["gate_specs_evidence"] =
        Value::from("OUT/specs/LOGIN/tasks.md");
    project.write_session(&session);
    assert_verdict(&project.verify(&[]), 65, "EVIDENCE_MISSING");
}

#[cfg(unix)]
#[test]
fn a_symlinked_evidence_file_is_accepted_inside_the_root_and_refused_outside() {
    let project = Project::new("evidence-symlink");
    let linked = project.root.join("out/specs/login/linked.md");
    std::os::unix::fs::symlink("tasks.md", &linked).unwrap();
    let mut session = passing();
    session["features"]["login"]["data"]["gate_specs_evidence"] =
        Value::from("out/specs/login/linked.md");
    project.write_session(&session);
    assert_verdict(&project.verify(&[]), 0, "PASSED");

    std::fs::remove_file(&linked).unwrap();
    std::os::unix::fs::symlink("/etc/hosts", &linked).unwrap();
    assert_verdict(&project.verify(&[]), 65, "EVIDENCE_MISSING");
}

/// Every file under `root` with its modification time and contents.
fn snapshot(root: &Path) -> BTreeMap<PathBuf, (SystemTime, Vec<u8>)> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            let metadata = std::fs::symlink_metadata(&path).unwrap();
            if metadata.is_dir() {
                pending.push(path);
            } else {
                let contents = std::fs::read(&path).unwrap_or_default();
                files.insert(path, (metadata.modified().unwrap(), contents));
            }
        }
    }
    files
}

#[test]
fn verify_run_changes_no_file_and_sends_nothing() {
    let project = Project::new("read-only");
    let mut session = passing();
    session["features"]["login"]["data"]["gate_testing_result"] = Value::from("IMPORTANT");
    project.write_session(&session);
    let before = snapshot(&project.root);

    project.verify(&[]);
    project.verify(&["--json"]);
    project.verify(&["--allow-running"]);
    assert_eq!(before, snapshot(&project.root));

    std::fs::write(project.root.join(".konductor/config.yml"), "tier: bogus\n").unwrap();
    let before = snapshot(&project.root);
    assert_eq!(project.verify(&[]).status.code(), Some(65));
    assert_eq!(before, snapshot(&project.root));

    assert!(
        project.sink.received_bodies().is_empty(),
        "verify-run sent telemetry"
    );
}
