// SPDX-License-Identifier: Apache-2.0
//
// flow_e2e.rs: drives the REAL compiled binary through `konductor flow check` and `konductor flow show`, and
// through `install`, `update` and `uninstall` to confirm they leave `.konductor/workflows/` alone.
//
// Isolation: every run happens in a scratch directory under `std::env::temp_dir()`. `HOME` is set to a scratch
// directory too, because `flow` reads `~/.konductor/workflows/` and the CLI writes an invocation log under `$HOME`.
// Telemetry goes to a loopback sink. There is no network access.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-flow-e2e-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// The example file that the docs ship. The test reads it from the repo so the docs and the engine cannot drift.
fn hello_plan() -> String {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../workflow-engine/examples/hello-plan.yml");
    std::fs::read_to_string(path).expect("read workflow-engine/examples/hello-plan.yml")
}

/// A project directory with a `.konductor/workflows/` folder, and a separate home directory.
struct Project {
    root: PathBuf,
    home: PathBuf,
}

impl Project {
    fn new(label: &str) -> Project {
        let root = scratch_dir(&format!("{label}-project"));
        let home = scratch_dir(&format!("{label}-home"));
        std::fs::create_dir_all(root.join(".konductor/workflows")).unwrap();
        Project { root, home }
    }

    fn write(&self, name: &str, text: &str) {
        let path = self.root.join(".konductor/workflows").join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn write_user(&self, name: &str, text: &str) {
        let dir = self.home.join(".konductor/workflows");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), text).unwrap();
    }

    fn flow(&self, args: &[&str]) -> Output {
        let mut command = Command::new(bin());
        command
            .arg("flow")
            .args(args)
            .current_dir(&self.root)
            .env("HOME", &self.home)
            .env_remove("NO_COLOR")
            .env_remove("KONDUCTOR_LOG");
        command.output().expect("spawn konductor")
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).ok();
        std::fs::remove_dir_all(&self.home).ok();
    }
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).to_string()
}

fn exit(output: &Output) -> i32 {
    output.status.code().expect("exit code")
}

/// The codes of the diagnostics in the JSON of `flow check --json`, in order.
fn codes_of(output: &Output) -> Vec<String> {
    let report: serde_json::Value = serde_json::from_str(&stdout(output)).expect("json report");
    report["diagnostics"]
        .as_array()
        .expect("diagnostics")
        .iter()
        .map(|d| d["code"].as_str().expect("code").to_string())
        .collect()
}

// --- flow check ------------------------------------------------------------------------------------------------------

#[test]
fn check_passes_on_the_hello_plan_example() {
    let project = Project::new("hello");
    project.write("hello-plan.yml", &hello_plan());
    let output = project.flow(&["check", "hello-plan"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert_eq!(stdout(&output), "ok: hello-plan (2 stages)\n");

    let output = project.flow(&["check", "hello-plan", "--json"]);
    assert_eq!(exit(&output), 0);
    assert_eq!(
        stdout(&output),
        "{\"diagnostics\":[],\"errors\":0,\"infos\":0,\"name\":\"hello-plan\",\"summary\":{\"counts\":{\"stages\":2},\"valid\":true},\"warnings\":0}\n"
    );
}

#[test]
fn check_finds_the_workflow_in_the_home_folder_when_the_project_has_none() {
    let project = Project::new("home");
    project.write_user("hello-plan.yml", &hello_plan());
    let output = project.flow(&["check", "hello-plan"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
}

#[test]
fn the_project_file_is_checked_before_the_home_file() {
    let project = Project::new("nearest");
    project.write("hello-plan.yml", "a: [");
    project.write_user("hello-plan.yml", &hello_plan());
    let output = project.flow(&["check", "hello-plan", "--json"]);
    assert_eq!(exit(&output), 65);
    assert_eq!(codes_of(&output), ["YAML_SYNTAX"]);
}

#[test]
fn check_of_broken_files_exits_65_with_the_expected_codes() {
    let good = hello_plan();
    let cases: Vec<(&str, String, Vec<&str>)> = vec![
        (
            "no-format",
            good.replace("format: konductor/1\n", ""),
            vec!["MISSING_KEY"],
        ),
        (
            "format",
            good.replace("konductor/1", "konductor/2"),
            vec!["UNSUPPORTED_FORMAT"],
        ),
        (
            "version",
            good.replace("version: 0.1.0", "version: '1.1'"),
            vec!["INVALID_VALUE"],
        ),
        (
            "name",
            good.replace("name: hello-plan", "name: other"),
            vec!["NAME_MISMATCH"],
        ),
        ("syntax", "a: [\n".to_string(), vec!["YAML_SYNTAX"]),
        (
            "anchor",
            good.replace("version: 0.1.0", "version: &v 0.1.0"),
            vec!["YAML_UNSUPPORTED"],
        ),
        ("not-a-mapping", "- a\n".to_string(), vec!["NOT_A_MAPPING"]),
        ("unknown", format!("{good}bogus: 1\n"), vec!["UNKNOWN_KEY"]),
        (
            "duplicate",
            format!("{good}name: hello-plan\n"),
            vec!["DUPLICATE_KEY"],
        ),
        (
            "wrong-type",
            good.replace("version: 0.1.0", "version: 1.1"),
            vec!["WRONG_TYPE"],
        ),
        (
            "invalid-name",
            good.replace("name: plan", "name: Plan"),
            vec!["INVALID_NAME"],
        ),
        (
            "reserved",
            good.replace("name: plan", "name: halt"),
            vec!["RESERVED_NAME"],
        ),
        (
            "duplicate-stage",
            good.replace("name: implement", "name: plan"),
            vec!["DUPLICATE_STAGE"],
        ),
        (
            "stage-kind",
            good.replace("    agent: k-architect\n", ""),
            vec!["STAGE_KIND_MISSING"],
        ),
        (
            "ambiguous",
            good.replace(
                "    agent: k-architect\n",
                "    agent: k-architect\n    uses: other\n",
            ),
            vec!["STAGE_KIND_AMBIGUOUS", "NOT_SUPPORTED_BY_THIS_BUILD"],
        ),
        (
            "later-slice",
            good.replace(
                "    agent: k-architect\n",
                "    agent: k-architect\n    done_when: [plan-exists]\n",
            ),
            vec!["NOT_SUPPORTED_BY_THIS_BUILD"],
        ),
        (
            "intent-string",
            good.replace("intent:\n  outcome: A short plan", "intent: A short plan")
                .replace(
                    "\n  accept:\n    - id: plan-exists\n      file: PLAN.md",
                    "",
                ),
            vec!["NOT_SUPPORTED_BY_THIS_BUILD"],
        ),
    ];
    for (label, text, expected) in cases {
        let project = Project::new(label);
        project.write("hello-plan.yml", &text);
        let output = project.flow(&["check", "hello-plan", "--json"]);
        assert_eq!(exit(&output), 65, "{label}: {}", stdout(&output));
        assert_eq!(codes_of(&output), expected, "{label}: {}", stdout(&output));
        assert_eq!(stderr(&output), "", "{label}");

        let text_mode = project.flow(&["check", "hello-plan"]);
        assert_eq!(exit(&text_mode), 65, "{label}");
        assert!(
            stdout(&text_mode).contains("error "),
            "{label}: {}",
            stdout(&text_mode)
        );
    }
}

#[test]
fn check_reports_the_place_of_each_problem_in_text_mode() {
    let project = Project::new("place");
    project.write(
        "hello-plan.yml",
        &hello_plan().replace("version: 0.1.0", "version: '1.1' # note"),
    );
    let output = project.flow(&["check", "hello-plan"]);
    assert_eq!(exit(&output), 65);
    let text = stdout(&output);
    assert!(
        text.starts_with("hello-plan.yml:4:10: error INVALID_VALUE: "),
        "{text}"
    );
    assert!(text.contains("    suggestion: 0.1.0\n"), "{text}");
    assert!(text.ends_with("hello-plan: 1 error\n"), "{text}");
}

#[test]
fn check_reads_a_prompt_file_from_the_workflow_folder() {
    let project = Project::new("prompt-file");
    project.write("prompts/plan.md", "Write the plan.\n");
    project.write(
        "hello-plan.yml",
        &hello_plan().replace(
            "    prompt: >-\n      Write a short plan for the goal to PLAN.md: three to five numbered steps. Do not change any other file.\n",
            "    prompt_file: prompts/plan.md\n",
        ),
    );
    let output = project.flow(&["check", "hello-plan"]);
    assert_eq!(exit(&output), 0, "{}", stdout(&output));

    std::fs::remove_file(project.root.join(".konductor/workflows/prompts/plan.md")).unwrap();
    let output = project.flow(&["check", "hello-plan", "--json"]);
    assert_eq!(exit(&output), 65);
    assert_eq!(codes_of(&output), ["INVALID_VALUE"]);
}

#[cfg(unix)]
#[test]
fn check_does_not_follow_a_link_to_a_workflow_or_a_prompt_file() {
    let project = Project::new("links");
    let outside = scratch_dir("links-outside");
    std::fs::write(outside.join("hello-plan.yml"), hello_plan()).unwrap();
    std::fs::write(outside.join("plan.md"), "secret").unwrap();
    std::os::unix::fs::symlink(
        outside.join("hello-plan.yml"),
        project.root.join(".konductor/workflows/hello-plan.yml"),
    )
    .unwrap();
    let output = project.flow(&["check", "hello-plan"]);
    assert_eq!(exit(&output), 64, "a link is treated as not there");

    std::fs::remove_file(project.root.join(".konductor/workflows/hello-plan.yml")).unwrap();
    std::os::unix::fs::symlink(
        outside.join("plan.md"),
        project.root.join(".konductor/workflows/plan.md"),
    )
    .unwrap();
    project.write(
        "hello-plan.yml",
        &hello_plan().replace(
            "    prompt: >-\n      Write a short plan for the goal to PLAN.md: three to five numbered steps. Do not change any other file.\n",
            "    prompt_file: plan.md\n",
        ),
    );
    let output = project.flow(&["check", "hello-plan", "--json"]);
    assert_eq!(exit(&output), 65);
    assert_eq!(codes_of(&output), ["INVALID_VALUE"]);
    std::fs::remove_dir_all(outside).ok();
}

#[test]
fn a_file_over_the_size_limit_is_treated_as_not_there() {
    let project = Project::new("big");
    let padding = "#".repeat(262_144);
    project.write("hello-plan.yml", &format!("{padding}\n{}", hello_plan()));
    let output = project.flow(&["check", "hello-plan"]);
    assert_eq!(exit(&output), 64, "{}", stderr(&output));
}

// --- usage errors ----------------------------------------------------------------------------------------------------

#[test]
fn a_bad_name_exits_64() {
    let project = Project::new("bad-name");
    for name in ["Bad", "../etc/passwd", "a/b", "x.yml", "a b"] {
        for command in ["check", "show"] {
            let output = project.flow(&[command, name]);
            assert_eq!(exit(&output), 64, "{command} {name}");
            assert_eq!(stdout(&output), "");
            assert!(
                stderr(&output).starts_with("konductor flow: "),
                "{}",
                stderr(&output)
            );
        }
    }
}

#[test]
fn a_shipped_name_exits_64_and_says_shipped_workflows_come_later() {
    let project = Project::new("library");
    for command in ["check", "show"] {
        let output = project.flow(&[command, "library/x"]);
        assert_eq!(exit(&output), 64);
        assert!(
            stderr(&output).contains("arrive in a later step"),
            "{}",
            stderr(&output)
        );
    }
    let output = project.flow(&["check", "library/x", "--json"]);
    assert_eq!(exit(&output), 64);
    assert!(
        stdout(&output).starts_with("{\"command\":\"flow\",\"error\":"),
        "{}",
        stdout(&output)
    );
}

#[test]
fn a_name_that_matches_no_file_exits_64() {
    let project = Project::new("ghost");
    let output = project.flow(&["check", "ghost"]);
    assert_eq!(exit(&output), 64);
    assert!(
        stderr(&output).contains("No workflow named `ghost`"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn a_missing_name_or_subcommand_is_a_usage_error_and_never_exits_2() {
    let project = Project::new("missing");
    let output = project.flow(&["check"]);
    assert_eq!(exit(&output), 64);
    let output = project.flow(&["nope", "x"]);
    assert_eq!(exit(&output), 64);
}

#[test]
fn no_flow_command_ever_exits_2() {
    let project = Project::new("never-2");
    project.write("a.yml", "a: [");
    for args in [
        &["check", "a"][..],
        &["show", "a"],
        &["check", "Bad"],
        &["show", "ghost"],
        &["check", "library/a"],
    ] {
        assert_ne!(exit(&project.flow(args)), 2, "{args:?}");
    }
}

// --- flow show -------------------------------------------------------------------------------------------------------

const HELLO_PLAN_SHOWN: &str = r#"{
  "format": "konductor/1",
  "intent": {
    "accept": [
      {
        "file": "PLAN.md",
        "id": "plan-exists"
      }
    ],
    "outcome": "A short plan for the goal is written to PLAN.md, and the first step of it is done."
  },
  "name": "hello-plan",
  "params": {
    "goal": {
      "default": "Add a README section that explains how to run the tests.",
      "description": "What the workflow should accomplish."
    }
  },
  "stages": [
    {
      "agent": "k-architect",
      "name": "plan",
      "prompt": "Write a short plan for the goal to PLAN.md: three to five numbered steps. Do not change any other file."
    },
    {
      "agent": "k-developer",
      "name": "implement",
      "prompt": "Read PLAN.md and do its first step only. Do not edit PLAN.md."
    }
  ],
  "version": "0.1.0"
}
"#;

/// `hello-plan.yml` with the keys of every mapping in another order. The stages stay in their order, because that is
/// the order of the workflow.
const HELLO_PLAN_REORDERED: &str = "stages:
  - prompt: >-
      Write a short plan for the goal to PLAN.md: three to five numbered steps. Do not change any other file.
    agent: k-architect
    name: plan
  - prompt: Read PLAN.md and do its first step only. Do not edit PLAN.md.
    agent: k-developer
    name: implement
params:
  goal:
    default: Add a README section that explains how to run the tests.
    description: What the workflow should accomplish.
version: 0.1.0
intent:
  accept:
    - file: PLAN.md
      id: plan-exists
  outcome: A short plan for the goal is written to PLAN.md, and the first step of it is done.
name: hello-plan
format: konductor/1
";

#[test]
fn show_prints_the_resolved_hello_plan_with_prompt_text() {
    let project = Project::new("show");
    project.write("hello-plan.yml", &hello_plan());
    let output = project.flow(&["show", "hello-plan", "--json"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    assert_eq!(stdout(&output), HELLO_PLAN_SHOWN);
    assert_eq!(stderr(&output), "");
    // Without --json the output is the same JSON.
    assert_eq!(
        stdout(&project.flow(&["show", "hello-plan"])),
        HELLO_PLAN_SHOWN
    );
}

#[test]
fn show_is_stable_across_two_key_orders() {
    let original = hello_plan();
    let reordered = HELLO_PLAN_REORDERED;
    let a = Project::new("order-a");
    a.write("hello-plan.yml", &original);
    let b = Project::new("order-b");
    b.write("hello-plan.yml", reordered);
    let shown_a = a.flow(&["show", "hello-plan", "--json"]);
    let shown_b = b.flow(&["show", "hello-plan", "--json"]);
    assert_eq!(exit(&shown_a), 0, "{}", stderr(&shown_a));
    assert_eq!(exit(&shown_b), 0, "{}", stderr(&shown_b));
    assert_eq!(stdout(&shown_a), stdout(&shown_b));
    assert_eq!(stdout(&shown_a), HELLO_PLAN_SHOWN);
    let checked_a = a.flow(&["check", "hello-plan", "--json"]);
    let checked_b = b.flow(&["check", "hello-plan", "--json"]);
    assert_eq!(stdout(&checked_a), stdout(&checked_b));
}

#[test]
fn show_names_no_machine_path() {
    let project = Project::new("no-paths");
    project.write("prompts/plan.md", "Plan it.\n");
    project.write(
        "hello-plan.yml",
        &hello_plan().replace(
            "    prompt: >-\n      Write a short plan for the goal to PLAN.md: three to five numbered steps. Do not change any other file.\n",
            "    prompt_file: prompts/plan.md\n",
        ),
    );
    let output = project.flow(&["show", "hello-plan"]);
    assert_eq!(exit(&output), 0, "{}", stderr(&output));
    let text = stdout(&output);
    assert!(
        text.contains("\"prompt_file\": \"prompts/plan.md\""),
        "{text}"
    );
    assert!(text.contains("\"prompt\": \"Plan it.\\n\""), "{text}");
    for machine in [
        project.root.to_string_lossy().to_string(),
        project.home.to_string_lossy().to_string(),
    ] {
        assert!(!text.contains(&machine), "{text}");
    }
}

#[test]
fn show_does_not_print_a_trust_hash() {
    let project = Project::new("no-trust");
    project.write("hello-plan.yml", &hello_plan());
    for args in [
        &["show", "hello-plan"][..],
        &["check", "hello-plan", "--json"],
    ] {
        assert!(!stdout(&project.flow(args)).contains("trust"), "{args:?}");
    }
}

#[test]
fn show_of_a_broken_workflow_exits_65_without_printing_a_workflow() {
    let project = Project::new("show-broken");
    project.write(
        "hello-plan.yml",
        &hello_plan().replace("konductor/1", "konductor/9"),
    );
    let output = project.flow(&["show", "hello-plan"]);
    assert_eq!(exit(&output), 65);
    assert_eq!(stdout(&output), "");
    assert!(
        stderr(&output).contains("UNSUPPORTED_FORMAT"),
        "{}",
        stderr(&output)
    );

    let output = project.flow(&["show", "hello-plan", "--json"]);
    assert_eq!(exit(&output), 65);
    assert_eq!(codes_of(&output), ["UNSUPPORTED_FORMAT"]);
}

// --- install, update and uninstall leave the workflows alone ---------------------------------------------------------

/// Every file under a folder, with its bytes, so two snapshots can be compared.
fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(base, &path, out);
            } else {
                let rel = path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                out.insert(rel, std::fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    if dir.is_dir() {
        walk(dir, dir, &mut out);
    }
    out
}

fn seed_source(repo: &Path) {
    std::fs::create_dir_all(repo.join("agents")).unwrap();
    std::fs::write(
        repo.join("agents/k-example.agent-spec.json"),
        br#"{
  "schemaVersion": "1",
  "name": "k-example",
  "config": { "description": "An example agent.", "model": "claude-sonnet-5", "systemPrompt": "You are a helpful agent." },
  "clientConfig": { "kiroCli": {} }
}
"#,
    )
    .unwrap();
    std::fs::create_dir_all(repo.join("skills/example-skill")).unwrap();
    std::fs::write(
        repo.join("skills/example-skill/SKILL.md"),
        b"---\nname: example-skill\ndescription: An example skill.\n---\n\n# example-skill\n\nBody.\n",
    )
    .unwrap();
}

fn lifecycle(
    cwd: &Path,
    home: &Path,
    sink: &telemetry_test_sink::TelemetrySink,
    args: &[&str],
) -> Output {
    let mut command = Command::new(bin());
    command.args(args).current_dir(cwd).env("HOME", home);
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    command.output().expect("spawn konductor")
}

fn seed_workflows(base: &Path) -> PathBuf {
    let dir = base.join(".konductor/workflows");
    std::fs::create_dir_all(dir.join("prompts")).unwrap();
    std::fs::write(dir.join("hello-plan.yml"), hello_plan()).unwrap();
    std::fs::write(dir.join("prompts/plan.md"), "Plan it.\n").unwrap();
    dir
}

#[test]
fn install_update_and_uninstall_leave_the_workflows_folder_alone() {
    let sink = telemetry_test_sink::TelemetrySink::start();
    let repo = scratch_dir("lifecycle-repo");
    seed_source(&repo);
    let synth = lifecycle(
        &repo,
        &repo,
        &sink,
        &["synth", "--from", &repo.display().to_string()],
    );
    assert!(synth.status.success(), "{}", stderr(&synth));
    let repo_arg = repo.display().to_string();

    // Without --target the install goes to $HOME, which is also where the user workflows live.
    let home = scratch_dir("lifecycle-home");
    let home_workflows = seed_workflows(&home);
    let before_home = snapshot(&home_workflows);
    // With --target the install goes to the target, where the project workflows live.
    let target = scratch_dir("lifecycle-target");
    let target_workflows = seed_workflows(&target);
    let before_target = snapshot(&target_workflows);
    let target_arg = target.display().to_string();
    let home_arg = home.display().to_string();

    let steps: Vec<(&str, Vec<&str>)> = vec![
        (
            "install",
            vec![
                "install",
                "--from",
                &repo_arg,
                "--harness",
                "kiro-cli-v2",
                "--no-telemetry",
            ],
        ),
        (
            "update",
            vec!["update", "--from", &repo_arg, "--no-telemetry"],
        ),
        ("uninstall", vec!["uninstall", "--target", &home_arg]),
    ];
    // Run the three steps against $HOME.
    for (label, args) in &steps {
        let output = lifecycle(&repo, &home, &sink, args);
        assert!(
            output.status.success(),
            "{label} (no --target): {} {}",
            stdout(&output),
            stderr(&output)
        );
        assert_eq!(
            snapshot(&home_workflows),
            before_home,
            "{label} (no --target) changed the workflows"
        );
        // The step did its own work, so the check above is not vacuous.
        let agent = home.join(".kiro/agents/k-example.json");
        assert_eq!(
            agent.is_file(),
            *label != "uninstall",
            "{label} (no --target)"
        );
    }

    // Run them again against an explicit --target.
    let with_target: Vec<(&str, Vec<&str>)> = vec![
        (
            "install",
            vec![
                "install",
                "--from",
                &repo_arg,
                "--target",
                &target_arg,
                "--harness",
                "kiro-cli-v2",
                "--no-telemetry",
            ],
        ),
        (
            "update",
            vec![
                "update",
                "--from",
                &repo_arg,
                "--target",
                &target_arg,
                "--no-telemetry",
            ],
        ),
        ("uninstall", vec!["uninstall", "--target", &target_arg]),
    ];
    for (label, args) in &with_target {
        let output = lifecycle(&repo, &home, &sink, args);
        assert!(
            output.status.success(),
            "{label} (--target): {} {}",
            stdout(&output),
            stderr(&output)
        );
        assert_eq!(
            snapshot(&target_workflows),
            before_target,
            "{label} (--target) changed the workflows"
        );
        assert_eq!(
            snapshot(&home_workflows),
            before_home,
            "{label} (--target) changed the home workflows"
        );
        let agent = target.join(".kiro/agents/k-example.json");
        assert_eq!(agent.is_file(), *label != "uninstall", "{label} (--target)");
    }
    assert!(target_workflows.join("hello-plan.yml").is_file());
    assert!(home_workflows.join("hello-plan.yml").is_file());

    for dir in [repo, home, target] {
        std::fs::remove_dir_all(dir).ok();
    }
}
