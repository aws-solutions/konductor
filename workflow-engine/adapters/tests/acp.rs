// SPDX-License-Identifier: Apache-2.0
//! The ACP harnesses on a fake ACP agent: a shell script (`tests/common/fake_acp_agent.sh`) that speaks scripted v1
//! frames over standard input and output. No test here starts a real adapter. The checks against the real adapters are
//! done by hand and written up with the step.

#![cfg(unix)]

mod common;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use common::TempDir;
use workflow_adapters::process::current_owner;
use workflow_adapters::{
    scan_repo_config, AcpHarness, AcpKind, FileAgentCatalog, FileRunLock, FileRunStore, FileSource,
    InstalledFiles, SimulatedClock, SystemLauncher,
};
use workflow_core::limits::MAX_SESSION_OUTPUT_BYTES;
use workflow_core::ports::{
    GroupState, Harness, ProcessGroup, ProcessLauncher, RunStore, Session, SessionEnd,
    SessionOutcome,
};
use workflow_core::run::{Run, RunStatus, StageStatus};
use workflow_core::runner::{execute, judge, prepare, start, GuardedHarness};
use workflow_core::{check_text, Reason};

/// Tests that take the workspace lock or start a process run one at a time, as in `kiro.rs`.
fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
    SERIAL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn fake_agent() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/common/fake_acp_agent.sh")
}

fn alive(pid: u32) -> bool {
    let output = std::process::Command::new("/bin/ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .expect("run ps");
    let stat = String::from_utf8_lossy(&output.stdout);
    let stat = stat.trim();
    !stat.is_empty() && !stat.starts_with('Z')
}

/// The agent files a project has.
enum Agent {
    /// A Kiro V2 file: `allowedTools`.
    KiroV2(&'static [&'static str]),
    /// A Kiro V3 file: `permissions.rules` with one unscoped allow rule for each capability.
    KiroV3(&'static [&'static str]),
    /// A Claude definition with this `tools` line, or none.
    Claude(Option<&'static str>),
}

struct Setup {
    kind: AcpKind,
    project: TempDir,
    bin: TempDir,
}

impl Setup {
    fn new(kind: AcpKind, agent: &Agent) -> Setup {
        let project = TempDir::new("acp-project");
        match agent {
            Agent::KiroV2(tools) => {
                let list: Vec<String> = tools.iter().map(|t| format!("\"{t}\"")).collect();
                project.write(
                    ".kiro/agents/k-a.json",
                    format!("{{\"name\":\"k-a\",\"allowedTools\":[{}]}}", list.join(","))
                        .as_bytes(),
                );
            }
            Agent::KiroV3(capabilities) => {
                let rules: Vec<String> = capabilities
                    .iter()
                    .map(|c| format!("{{\"capability\":\"{c}\",\"effect\":\"allow\"}}"))
                    .collect();
                project.write(
                    ".kiro/agents/k-a.json",
                    format!(
                        "{{\"name\":\"k-a\",\"permissions\":{{\"rules\":[{}]}}}}",
                        rules.join(",")
                    )
                    .as_bytes(),
                );
            }
            Agent::Claude(tools) => {
                let line = tools.map(|t| format!("tools: {t}\n")).unwrap_or_default();
                project.write(
                    ".claude/agents/k-a.md",
                    format!("---\nname: k-a\n{line}---\nBody.\n").as_bytes(),
                );
            }
        }
        Setup {
            kind,
            project,
            bin: TempDir::new("acp-bin"),
        }
    }

    /// A program that runs the fake agent with `case` and the extra environment `env` (`NAME=value` words). It records
    /// the arguments it got in `args` and every frame it reads in `log`.
    fn adapter(&self, case: &str, env: &str) -> PathBuf {
        let flavor = match self.kind {
            AcpKind::KiroCli => "kiro",
            AcpKind::Claude => "claude",
        };
        let body = format!(
            "#!/bin/sh\necho \"$*\" > '{bin}/args'\nexport FAKE_ACP_CASE='{case}' FAKE_ACP_FLAVOR={flavor} FAKE_ACP_LOG='{bin}/log' {env}\nexec /bin/sh '{fake}' \"$@\"\n",
            bin = self.bin.path().display(),
            fake = fake_agent().display(),
        );
        let path = self.bin.write("adapter", body.as_bytes());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn log(&self) -> String {
        fs::read_to_string(self.bin.path().join("log")).unwrap_or_default()
    }

    fn args(&self) -> String {
        fs::read_to_string(self.bin.path().join("args"))
            .unwrap_or_default()
            .trim()
            .to_string()
    }

    fn catalog(&self) -> FileAgentCatalog {
        FileAgentCatalog::new(self.project.path(), None)
    }
}

fn session<'a>(prompt: &'a str) -> Session<'a> {
    Session {
        stage: "plan",
        agent: "k-a",
        prompt,
        time_limit_ms: 60_000,
    }
}

type Lines = Rc<RefCell<Vec<String>>>;

/// Runs one session, trying again while the freshly written script is busy, which is a failed start and nothing else.
fn run_one(
    setup: &Setup,
    program: &Path,
    limit_ms: Option<u64>,
    grace_ms: u64,
    s: &Session,
) -> (SessionOutcome, Lines) {
    for _ in 0..20 {
        let lines: Lines = Rc::new(RefCell::new(Vec::new()));
        let sink = Rc::clone(&lines);
        let launcher = SystemLauncher::with_grace_ms(grace_ms);
        let catalog = setup.catalog();
        let mut harness = AcpHarness::new(
            &launcher,
            &catalog,
            setup.kind,
            program.to_str().unwrap(),
            setup.project.path().to_str().unwrap(),
            Box::new(move |line| sink.borrow_mut().push(line.to_string())),
        )
        .with_test_limits(limit_ms, Some(grace_ms));
        let outcome = harness.run_session(s);
        if outcome.end == SessionEnd::NotStarted
            && lines.borrow().iter().any(|l| l.contains("busy"))
        {
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        return (outcome, lines);
    }
    panic!("the script stayed busy");
}

fn joined(lines: &Lines) -> String {
    lines.borrow().join("\n")
}

// --- the conversation ----------------------------------------------------------------------------------------------

#[test]
fn a_kiro_v2_stage_runs_the_whole_conversation_and_gives_the_message_text() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&["fs_read"]));
    let program = setup.adapter("normal", "");
    let (outcome, lines) = run_one(
        &setup,
        &program,
        None,
        200,
        &session("Goal: x\nSecond line"),
    );
    assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
    assert!(
        outcome
            .final_message
            .contains("Plan written.\nKONDUCTOR_RESULT {"),
        "{}",
        outcome.final_message
    );
    // Reasoning and every other update are dropped.
    assert!(!outcome.final_message.contains("HIDDEN-THOUGHT"));
    assert!(!outcome.final_message.contains("usage"));
    assert!(judge(&outcome).is_ok());
    assert_eq!(setup.args(), "acp --agent k-a --agent-engine v2");
    let log = setup.log();
    let methods: Vec<&str> = log
        .lines()
        .filter_map(|l| l.split("\"method\":\"").nth(1))
        .map(|m| m.split('"').next().unwrap())
        .collect();
    assert_eq!(methods, ["initialize", "session/new", "session/prompt"]);
    // The stage prompt arrives whole, as one text block.
    assert!(
        log.contains(r#""text":"Goal: x\nSecond line","type":"text""#),
        "{log}"
    );
    assert!(log.contains(r#""protocolVersion":1"#));
}

#[test]
fn a_kiro_v3_stage_names_the_agent_as_the_session_mode_and_not_on_the_command_line() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV3(&["fs_read"]));
    let program = setup.adapter("normal", "");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
    assert_eq!(setup.args(), "acp --agent-engine v3");
    assert!(
        setup.log().contains(r#""_meta":{"kiro":{"modeId":"k-a"}}"#),
        "{}",
        setup.log()
    );
}

#[test]
fn a_claude_stage_selects_its_agent_holds_mode_default_and_reads_project_settings_only() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Read")));
    let program = setup.adapter("normal", "");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
    assert_eq!(setup.args(), "");
    let log = setup.log();
    let methods: Vec<&str> = log
        .lines()
        .filter_map(|l| l.split("\"method\":\"").nth(1))
        .map(|m| m.split('"').next().unwrap())
        .collect();
    assert_eq!(
        methods,
        [
            "initialize",
            "session/new",
            "session/set_config_option",
            "session/prompt"
        ]
    );
    assert!(
        log.contains(r#""options":{"agent":"k-a","settingSources":["project"]}"#),
        "{log}"
    );
    assert!(
        log.contains(r#""configId":"mode","sessionId":"s1","value":"default""#),
        "{log}"
    );
}

#[test]
fn a_claude_session_that_keeps_the_auto_mode_fails_and_never_gets_the_prompt() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Read")));
    let program = setup.adapter("mode-stuck", "");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("secret prompt"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    assert!(
        joined(&lines).contains("permission mode `default`"),
        "{}",
        joined(&lines)
    );
    assert!(!setup.log().contains("secret prompt"));
    assert_eq!(judge(&outcome), Err(Reason::SessionFailed));
}

#[test]
fn a_session_that_does_not_run_as_the_named_agent_fails_and_no_other_agent_is_used() {
    let _serial = one_at_a_time();
    for (kind, agent) in [
        (AcpKind::Claude, Agent::Claude(Some("Read"))),
        (AcpKind::KiroCli, Agent::KiroV3(&["fs_read"])),
    ] {
        let setup = Setup::new(kind, &agent);
        let program = setup.adapter("wrong-agent", "");
        let (outcome, lines) = run_one(&setup, &program, None, 200, &session("secret prompt"));
        assert_eq!(outcome.end, SessionEnd::Exited(1));
        assert!(
            joined(&lines).contains("did not start the agent `k-a`"),
            "{}",
            joined(&lines)
        );
        assert!(!setup.log().contains("secret prompt"));
    }
}

#[test]
fn an_agent_that_the_adapter_cannot_see_does_not_start_a_session() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("normal", "");
    let (outcome, lines) = run_one(
        &setup,
        &program,
        None,
        200,
        &Session {
            agent: "k-missing",
            ..session("p")
        },
    );
    assert_eq!(outcome.end, SessionEnd::NotStarted);
    assert!(joined(&lines).contains("Kiro CLI cannot see the agent `k-missing`"));
    assert_eq!(setup.log(), "", "no adapter was started");
}

#[test]
fn a_claude_agent_in_the_home_folder_is_not_run_because_only_project_settings_are_read() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(None));
    let home = TempDir::new("acp-home");
    home.write(
        ".claude/agents/k-home.md",
        b"---\nname: k-home\n---\nBody.\n",
    );
    let catalog = FileAgentCatalog::new(setup.project.path(), Some(home.path()));
    let launcher = SystemLauncher::with_grace_ms(100);
    let lines: Lines = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&lines);
    let program = setup.adapter("normal", "");
    let mut harness = AcpHarness::new(
        &launcher,
        &catalog,
        AcpKind::Claude,
        program.to_str().unwrap(),
        setup.project.path().to_str().unwrap(),
        Box::new(move |line| sink.borrow_mut().push(line.to_string())),
    );
    let outcome = harness.run_session(&Session {
        agent: "k-home",
        ..session("p")
    });
    assert_eq!(outcome.end, SessionEnd::NotStarted);
    assert!(
        joined(&lines).contains("defined in the home folder"),
        "{}",
        joined(&lines)
    );
    assert_eq!(setup.log(), "");
}

// --- permissions ---------------------------------------------------------------------------------------------------

#[test]
fn a_request_for_a_tool_the_agent_file_lists_is_allowed_once_and_the_stage_passes() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Read, Write")));
    let program = setup.adapter("perm", "FAKE_ACP_TOOL=Write");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
    assert!(
        outcome.final_message.starts_with("ALLOWED\n"),
        "{}",
        outcome.final_message
    );
    assert!(setup
        .log()
        .contains(r#""result":{"outcome":{"optionId":"allow-once","outcome":"selected"}}"#));
    assert!(judge(&outcome).is_ok());
}

#[test]
fn a_request_for_a_tool_the_file_does_not_list_blocks_the_stage_and_names_the_tool() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Read")));
    let program = setup.adapter("perm", "FAKE_ACP_TOOL=Bash");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    let note = joined(&lines);
    assert!(
        note.contains("stage `plan` is blocked") && note.contains("`Bash`"),
        "{note}"
    );
    assert_eq!(judge(&outcome), Err(Reason::SessionFailed));
    let log = setup.log();
    assert!(
        log.contains(r#""optionId":"reject","outcome":"selected""#),
        "{log}"
    );
    assert!(!log.contains("allow-once\",\"outcome"), "{log}");
    assert!(!log.contains("allow-always\",\"outcome"), "{log}");
}

#[test]
fn a_request_with_only_allow_always_is_refused_even_for_a_listed_tool() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Write")));
    let program = setup.adapter("perm", "FAKE_ACP_TOOL=Write FAKE_ACP_OPTIONS=always-only");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    assert!(joined(&lines).contains("`Write`"), "{}", joined(&lines));
    let log = setup.log();
    assert!(!log.contains(r#""optionId":"allow-always""#), "{log}");
    assert!(log.contains(r#""optionId":"reject""#), "{log}");
}

#[test]
fn a_kiro_request_is_matched_by_its_tool_id_or_capability_against_the_allow_rules() {
    let _serial = one_at_a_time();
    let allowed = Setup::new(AcpKind::KiroCli, &Agent::KiroV3(&["fs_write"]));
    let program = allowed.adapter("perm", "FAKE_ACP_TOOL=fs_write");
    let (outcome, lines) = run_one(&allowed, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
    assert!(outcome.final_message.starts_with("ALLOWED"));

    let refused = Setup::new(AcpKind::KiroCli, &Agent::KiroV3(&["fs_read"]));
    let program = refused.adapter("perm", "FAKE_ACP_TOOL=fs_write");
    let (outcome, lines) = run_one(&refused, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    assert!(joined(&lines).contains("`fs_write`"), "{}", joined(&lines));
}

#[test]
fn a_scoped_kiro_rule_is_not_a_match_for_the_whole_capability() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV3(&[]));
    setup.project.write(
        ".kiro/agents/k-a.json",
        br#"{"name":"k-a","permissions":{"rules":[{"capability":"fs_write","match":["a.txt"],"effect":"allow"}]}}"#,
    );
    let program = setup.adapter("perm", "FAKE_ACP_TOOL=fs_write");
    let (outcome, _) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
}

// --- what goes wrong on the wire -----------------------------------------------------------------------------------

#[test]
fn a_frame_over_four_mebibytes_ends_the_stage_with_the_cause() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("big-frame", "");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    assert!(
        joined(&lines).contains("over the 4194304 byte limit"),
        "{}",
        joined(&lines)
    );
}

#[test]
fn a_frame_that_is_not_json_or_has_the_wrong_id_ends_the_stage_with_the_cause() {
    let _serial = one_at_a_time();
    for (case, expected) in [("not-json", "not JSON"), ("wrong-id", "the id 99")] {
        let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
        let program = setup.adapter(case, "");
        let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
        assert_eq!(outcome.end, SessionEnd::Exited(1), "{case}");
        assert!(
            joined(&lines).contains(expected),
            "{case}: {}",
            joined(&lines)
        );
    }
}

#[test]
fn an_adapter_that_exits_early_fails_the_stage_with_its_exit_status() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("early-exit", "");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(3));
    assert!(
        joined(&lines).contains("exit status 3"),
        "{}",
        joined(&lines)
    );
    let (outcome, lines) = run_one(
        &setup,
        &setup.adapter("exit-in-prompt", ""),
        None,
        200,
        &session("p"),
    );
    assert_eq!(outcome.end, SessionEnd::Exited(5));
    assert!(
        joined(&lines).contains("ended its output before it answered `session/prompt`"),
        "{}",
        joined(&lines)
    );
}

#[test]
fn an_adapter_that_serves_only_version_2_is_refused_before_any_session_starts() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV3(&[]));
    let program = setup.adapter("v2-only", "");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("secret prompt"));
    assert_eq!(outcome.end, SessionEnd::NotStarted);
    let note = joined(&lines);
    assert!(
        note.contains("ACP version 2") && note.contains("version 1 only"),
        "{note}"
    );
    let log = setup.log();
    assert!(
        !log.contains("session/new") && !log.contains("secret prompt"),
        "{log}"
    );
}

#[test]
fn a_missing_adapter_does_not_start_and_says_so() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(None));
    let (outcome, lines) = run_one(
        &setup,
        Path::new("/nonexistent/claude-agent-acp"),
        None,
        200,
        &session("p"),
    );
    assert_eq!(outcome.end, SessionEnd::NotStarted);
    assert!(
        joined(&lines).contains("could not start"),
        "{}",
        joined(&lines)
    );
}

// --- limits and process groups -------------------------------------------------------------------------------------

#[test]
fn at_the_time_limit_the_client_sends_cancel_and_then_ends_the_group() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Read")));
    // This agent answers the prompt only when it gets `session/cancel`, so the stage still times out: the limit
    // passed, and the answer after a cancel does not undo that.
    let program = setup.adapter("waits-for-cancel", "");
    let began = Instant::now();
    let (outcome, lines) = run_one(&setup, &program, Some(300), 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::TimedOut, "{}", joined(&lines));
    assert!(began.elapsed() >= Duration::from_millis(300));
    assert!(
        setup.log().contains(r#""method":"session/cancel""#),
        "{}",
        setup.log()
    );
    assert_eq!(judge(&outcome), Err(Reason::Timeout));
}

#[test]
fn an_adapter_that_never_answers_gets_cancel_then_the_terminate_and_leaves_no_process() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("hang", "");
    let mut group = None;
    let began = Instant::now();
    let launcher = SystemLauncher::with_grace_ms(150);
    let catalog = setup.catalog();
    let lines: Lines = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&lines);
    let mut harness = AcpHarness::new(
        &launcher,
        &catalog,
        AcpKind::KiroCli,
        program.to_str().unwrap(),
        setup.project.path().to_str().unwrap(),
        Box::new(move |line| sink.borrow_mut().push(line.to_string())),
    )
    .with_test_limits(Some(300), Some(150));
    let outcome = harness.run_session_recorded(&session("p"), &mut |g| {
        group = Some(g.clone());
        Ok(())
    });
    assert_eq!(outcome.end, SessionEnd::TimedOut, "{}", joined(&lines));
    // The limit, the wait after the cancel, then the terminate.
    assert!(
        began.elapsed() >= Duration::from_millis(450),
        "{:?}",
        began.elapsed()
    );
    assert!(began.elapsed() < Duration::from_secs(10));
    let group = group.expect("the group was reported");
    let mut launcher = SystemLauncher::with_grace_ms(150);
    assert_eq!(launcher.group_state(&group), GroupState::Gone);
}

#[test]
fn an_adapter_that_keeps_sending_updates_still_times_out_and_leaves_no_process() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("chatty", "");
    let mut group = None;
    let began = Instant::now();
    let launcher = SystemLauncher::with_grace_ms(150);
    let catalog = setup.catalog();
    let lines: Lines = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&lines);
    let mut harness = AcpHarness::new(
        &launcher,
        &catalog,
        AcpKind::KiroCli,
        program.to_str().unwrap(),
        setup.project.path().to_str().unwrap(),
        Box::new(move |line| sink.borrow_mut().push(line.to_string())),
    )
    .with_test_limits(Some(300), Some(150));
    let outcome = harness.run_session_recorded(&session("p"), &mut |g| {
        group = Some(g.clone());
        Ok(())
    });
    assert_eq!(outcome.end, SessionEnd::TimedOut, "{}", joined(&lines));
    // The limit and the wait after the cancel count, however many updates arrive in them.
    assert!(
        began.elapsed() >= Duration::from_millis(450),
        "{:?}",
        began.elapsed()
    );
    assert!(
        began.elapsed() < Duration::from_secs(10),
        "{:?}",
        began.elapsed()
    );
    assert!(outcome.final_message.contains("talking."));
    assert_eq!(judge(&outcome), Err(Reason::Timeout));
    let group = group.expect("the group was reported");
    let mut launcher = SystemLauncher::with_grace_ms(150);
    assert_eq!(launcher.group_state(&group), GroupState::Gone);
}

#[test]
fn a_stage_during_which_the_adapter_rewrites_the_agent_file_fails() {
    let _serial = one_at_a_time();
    for (kind, agent, file) in [
        (
            AcpKind::KiroCli,
            Agent::KiroV2(&["fs_read"]),
            ".kiro/agents/k-a.json",
        ),
        (
            AcpKind::Claude,
            Agent::Claude(Some("Read")),
            ".claude/agents/k-a.md",
        ),
    ] {
        let setup = Setup::new(kind, &agent);
        let program = setup.adapter(
            "normal",
            &format!(
                "FAKE_ACP_REWRITE='{}'",
                setup.project.path().join(file).display()
            ),
        );
        let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
        assert_eq!(
            outcome.end,
            SessionEnd::Exited(1),
            "{file}: {}",
            joined(&lines)
        );
        let note = joined(&lines);
        assert!(
            note.contains(&format!(
                "the agent file `{file}` of `k-a` changed while the stage ran"
            )) && note.contains("its content is not what was read before the stage")
                && note.contains("rewrote"),
            "{note}"
        );
        assert_eq!(judge(&outcome), Err(Reason::SessionFailed));
    }
}

#[test]
fn a_stage_that_leaves_the_agent_file_alone_is_not_reported_as_rewritten() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Read")));
    let program = setup.adapter("normal", "");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
    assert!(!joined(&lines).contains("changed while the stage ran"));
}

#[test]
fn a_failed_stage_shows_the_tail_of_the_adapters_standard_error_cut_to_printable_text() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("early-exit", "FAKE_ACP_STDERR='login failed \u{1b}[31mred'");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(3));
    let note = joined(&lines);
    assert!(note.contains("exit status 3"), "{note}");
    assert!(
        note.contains("The session wrote this to its standard error:\n    login failed ?[31mred"),
        "{note:?}"
    );
    assert!(!note.contains('\u{1b}'));
    // It is for the terminal: the outcome carries none of it.
    assert!(!outcome.final_message.contains("login failed"));
}

#[test]
fn only_the_last_four_kibibytes_of_the_adapters_standard_error_are_shown() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("early-exit", "FAKE_ACP_STDERR_BULK=1");
    let (_, lines) = run_one(&setup, &program, None, 200, &session("p"));
    let note = joined(&lines);
    let shown = note.lines().filter(|l| l.contains("noise line")).count();
    assert!(shown > 10 && shown < 100, "{shown} lines");
    assert!(note.contains("noise line 399 "), "{note}");
    assert!(!note.contains("noise line 0 "), "{note}");
    assert!(note.len() < 8 * 1024, "{}", note.len());
    // The adapter wrote about 24 KiB, so the note says that only the end is shown.
    assert!(
        note.contains("wrote more than 4 KiB to its standard error"),
        "{note}"
    );
}

#[test]
fn a_short_standard_error_is_shown_whole_with_no_remark_about_the_cut() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("early-exit", "FAKE_ACP_STDERR='login failed'");
    let (_, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert!(
        !joined(&lines).contains("more than 4 KiB"),
        "{}",
        joined(&lines)
    );
}

#[test]
fn a_tool_name_that_starts_with_a_dash_in_an_agent_file_allows_nothing_and_is_noted() {
    let _serial = one_at_a_time();
    // Kiro: the name is in the allow list, the request names the same tool, and the request is still refused.
    let kiro = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&["-x", "fs_read"]));
    let program = kiro.adapter("perm", "FAKE_ACP_TOOL=-x");
    let (outcome, lines) = run_one(&kiro, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    let note = joined(&lines);
    assert!(
        note.contains("the tool `-x` in the allow list of `.kiro/agents/k-a.json` starts with `-`"),
        "{note}"
    );
    assert!(
        note.contains("is blocked") && note.contains("`-x`"),
        "{note}"
    );
    assert!(
        !kiro.log().contains(r#""optionId":"allow-once""#),
        "{}",
        kiro.log()
    );
    // Claude: one such name makes the whole `tools` list unreadable, so even a listed tool is refused.
    let claude = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Write, -x")));
    let program = claude.adapter("perm", "FAKE_ACP_TOOL=Write");
    let (outcome, lines) = run_one(&claude, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    assert!(
        joined(&lines).contains("no tool request is allowed"),
        "{}",
        joined(&lines)
    );
}

#[test]
fn a_group_that_cannot_be_recorded_stops_the_adapter_and_the_stage_does_not_start() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("hang", "");
    let lines: Lines = Rc::new(RefCell::new(Vec::new()));
    let mut group = None;
    let mut outcome = None;
    for _ in 0..20 {
        let sink = Rc::clone(&lines);
        let launcher = SystemLauncher::with_grace_ms(150);
        let catalog = setup.catalog();
        let mut harness = AcpHarness::new(
            &launcher,
            &catalog,
            AcpKind::KiroCli,
            program.to_str().unwrap(),
            setup.project.path().to_str().unwrap(),
            Box::new(move |line| sink.borrow_mut().push(line.to_string())),
        )
        .with_test_limits(Some(60_000), Some(150));
        let got = harness.run_session_recorded(&session("p"), &mut |g| {
            group = Some(g.clone());
            Err("the disk is full".to_string())
        });
        if got.end == SessionEnd::NotStarted && joined(&lines).contains("busy") {
            lines.borrow_mut().clear();
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        outcome = Some(got);
        break;
    }
    let outcome = outcome.expect("the script stayed busy");
    assert_eq!(outcome.end, SessionEnd::NotStarted);
    let note = joined(&lines);
    assert!(
        note.contains("could not be recorded") && note.contains("the disk is full"),
        "{note}"
    );
    // Nothing was sent to it, and its group is gone.
    assert!(!setup.log().contains("initialize"), "{}", setup.log());
    let mut state = SystemLauncher::with_grace_ms(150);
    assert_eq!(
        state.group_state(&group.expect("the group was reported")),
        GroupState::Gone
    );
}

#[test]
fn an_interrupt_ends_a_running_stage_and_its_adapter_group_without_waiting_for_the_limit() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("hang", "");
    let flag = Arc::new(AtomicBool::new(false));
    let launcher = SystemLauncher::with_grace_ms(150).with_interrupt(Arc::clone(&flag));
    let catalog = setup.catalog();
    let lines: Lines = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&lines);
    let mut harness = AcpHarness::new(
        &launcher,
        &catalog,
        AcpKind::KiroCli,
        program.to_str().unwrap(),
        setup.project.path().to_str().unwrap(),
        Box::new(move |line| sink.borrow_mut().push(line.to_string())),
    );
    let mut group = None;
    let setter = {
        let flag = Arc::clone(&flag);
        let log = setup.bin.path().join("log");
        std::thread::spawn(move || {
            // The adapter has read the prompt once it has logged `session/new` and `session/prompt`.
            let until = Instant::now() + Duration::from_secs(20);
            while Instant::now() < until
                && fs::read_to_string(&log)
                    .unwrap_or_default()
                    .matches("session/")
                    .count()
                    < 2
            {
                std::thread::sleep(Duration::from_millis(10));
            }
            flag.store(true, Ordering::SeqCst);
        })
    };
    let began = Instant::now();
    // The limit is 30 minutes. The interrupt is what ends the stage.
    let outcome = harness.run_session_recorded(&session("p"), &mut |g| {
        group = Some(g.clone());
        Ok(())
    });
    setter.join().unwrap();
    assert_eq!(outcome.end, SessionEnd::Interrupted, "{}", joined(&lines));
    assert!(
        began.elapsed() < Duration::from_secs(10),
        "{:?}",
        began.elapsed()
    );
    assert!(joined(&lines).contains("interrupted"), "{}", joined(&lines));
    assert_eq!(judge(&outcome), Err(Reason::SessionFailed));
    let mut state = SystemLauncher::with_grace_ms(150);
    assert_eq!(
        state.group_state(&group.expect("the group was reported")),
        GroupState::Gone
    );
}

#[test]
fn a_session_that_begins_after_an_interrupt_starts_no_adapter() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Read")));
    let program = setup.adapter("normal", "");
    let launcher =
        SystemLauncher::with_grace_ms(150).with_interrupt(Arc::new(AtomicBool::new(true)));
    let catalog = setup.catalog();
    let lines: Lines = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&lines);
    let mut harness = AcpHarness::new(
        &launcher,
        &catalog,
        AcpKind::Claude,
        program.to_str().unwrap(),
        setup.project.path().to_str().unwrap(),
        Box::new(move |line| sink.borrow_mut().push(line.to_string())),
    );
    let outcome = harness.run_session(&session("p"));
    assert_eq!(outcome.end, SessionEnd::Interrupted);
    assert!(joined(&lines).contains("interrupted"));
    assert_eq!(setup.log(), "", "no adapter was started");
}

/// Processes of group `pgid` that still run. A zombie that nobody reaped does not count.
fn live_in_group(pgid: u32) -> usize {
    let output = std::process::Command::new("/bin/ps")
        .args(["-e", "-o", "pgid=", "-o", "stat="])
        .output()
        .expect("run ps");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            let group: u32 = words.next()?.parse().ok()?;
            let stat = words.next()?;
            (group == pgid && !stat.starts_with('Z')).then_some(())
        })
        .count()
}

#[test]
fn the_recorded_group_has_the_deadline_that_holds_when_the_owner_is_gone() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("hang", "");
    let launcher = SystemLauncher::with_grace_ms(150);
    let mut recorded: Vec<ProcessGroup> = Vec::new();
    let mut process = None;
    for _ in 0..20 {
        match launcher.spawn_piped(
            program.to_str().unwrap(),
            &[],
            setup.project.path().to_str().unwrap(),
            Duration::from_secs(60),
            &mut |g| {
                recorded.push(g.clone());
                Ok(())
            },
        ) {
            Ok(started) => {
                process = Some(started);
                break;
            }
            Err(why) if why.contains("busy") => std::thread::sleep(Duration::from_millis(50)),
            Err(why) => panic!("{why}"),
        }
        recorded.clear();
    }
    let _process = process.expect("the adapter started");
    let group = recorded.last().expect("a group was recorded");
    assert_eq!(group.deadline_ms.is_some(), launcher.guards_limit());
    if let Some(deadline) = group.deadline_ms {
        // The limit of `timeout` is beyond the 60 seconds the owner needs, by the grace period and a moment more.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        assert!(
            deadline > now + 60_000 && deadline < now + 70_000,
            "{deadline} {now}"
        );
    }
}

#[test]
fn a_limit_held_by_timeout_ends_an_adapter_whose_owner_is_gone() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("hang", "");
    let launcher = SystemLauncher::with_grace_ms(100);
    if !launcher.guards_limit() {
        eprintln!("no `timeout` or `gtimeout` on PATH: nothing to check");
        return;
    }
    let mut group = None;
    let mut process = None;
    for _ in 0..20 {
        match launcher.spawn_piped(
            program.to_str().unwrap(),
            &[],
            setup.project.path().to_str().unwrap(),
            Duration::from_millis(300),
            &mut |g| {
                group = Some(g.clone());
                Ok(())
            },
        ) {
            Ok(started) => {
                process = Some(started);
                break;
            }
            Err(why) if why.contains("busy") => std::thread::sleep(Duration::from_millis(50)),
            Err(why) => panic!("{why}"),
        }
    }
    let process = process.expect("the adapter started");
    let pgid = group.expect("the group was recorded").pgid;
    // `timeout` and the adapter both run, once `timeout` has started the adapter.
    let until = Instant::now() + Duration::from_secs(10);
    while live_in_group(pgid) < 2 {
        assert!(
            Instant::now() < until,
            "timeout and the adapter did not both run"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    // The owner is gone: nothing ends the group but `timeout`. Its limit is the 300 milliseconds, the grace period and
    // two seconds.
    std::mem::forget(process);
    let until = Instant::now() + Duration::from_secs(30);
    while live_in_group(pgid) > 0 {
        assert!(
            Instant::now() < until,
            "the group was not ended by `timeout`"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn without_timeout_the_adapter_runs_directly_and_the_limit_and_the_cancel_still_hold() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Read")));
    let program = setup.adapter("waits-for-cancel", "");
    let launcher = SystemLauncher::with_grace_ms(150).with_timeout_search("/nonexistent-folder");
    assert!(!launcher.guards_limit());
    let catalog = setup.catalog();
    let lines: Lines = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&lines);
    let mut harness = AcpHarness::new(
        &launcher,
        &catalog,
        AcpKind::Claude,
        program.to_str().unwrap(),
        setup.project.path().to_str().unwrap(),
        Box::new(move |line| sink.borrow_mut().push(line.to_string())),
    )
    .with_test_limits(Some(300), Some(150));
    let mut group = None;
    let outcome = harness.run_session_recorded(&session("p"), &mut |g| {
        group = Some(g.clone());
        Ok(())
    });
    assert_eq!(outcome.end, SessionEnd::TimedOut, "{}", joined(&lines));
    assert!(
        setup.log().contains(r#""method":"session/cancel""#),
        "{}",
        setup.log()
    );
    // No `timeout` holds a limit, so the record has no deadline.
    assert_eq!(group.expect("recorded").deadline_ms, None);
}

#[test]
fn only_the_stage_limit_gives_timed_out_and_an_exit_status_that_timeout_uses_does_not() {
    let _serial = one_at_a_time();
    for code in ["124", "137"] {
        let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
        let program = setup.adapter("early-exit", &format!("FAKE_ACP_EXIT={code}"));
        let (outcome, _) = run_one(&setup, &program, None, 200, &session("p"));
        // The adapter exited with the status that `timeout` gives a program it stopped, long before the limit.
        assert_eq!(
            outcome.end,
            SessionEnd::Exited(code.parse().unwrap()),
            "{code}"
        );
        assert_eq!(judge(&outcome), Err(Reason::SessionFailed), "{code}");
    }
    // The other ways a stage ends badly are never the time-out verdict either.
    let setup = Setup::new(AcpKind::Claude, &Agent::Claude(Some("Read")));
    for (case, env) in [
        ("exit-in-prompt", ""),
        ("big-frame", ""),
        ("v2-only", ""),
        ("perm", "FAKE_ACP_TOOL=Bash"),
    ] {
        let program = setup.adapter(case, env);
        let (outcome, _) = run_one(&setup, &program, None, 200, &session("p"));
        assert_ne!(outcome.end, SessionEnd::TimedOut, "{case}");
        assert_eq!(judge(&outcome), Err(Reason::SessionFailed), "{case}");
    }
}

#[cfg(unix)]
#[test]
fn an_agent_file_that_is_a_link_to_a_file_runs_as_that_file_and_a_rewrite_through_it_is_found() {
    let _serial = one_at_a_time();
    for (kind, agent, link, real) in [
        (
            AcpKind::KiroCli,
            Agent::KiroV2(&["fs_read"]),
            ".kiro/agents/k-a.json",
            "real-agent.json",
        ),
        (
            AcpKind::Claude,
            Agent::Claude(Some("Read")),
            ".claude/agents/k-a.md",
            "real-agent.md",
        ),
    ] {
        let setup = Setup::new(kind, &agent);
        // Move the file the setup wrote to another name and put a link in its place.
        let at = setup.project.path().join(link);
        let target = setup.project.path().join(real);
        fs::rename(&at, &target).unwrap();
        std::os::unix::fs::symlink(&target, &at).unwrap();
        let program = setup.adapter("normal", "");
        let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
        assert_eq!(
            outcome.end,
            SessionEnd::Exited(0),
            "{link}: {}",
            joined(&lines)
        );
        let program = setup.adapter(
            "normal",
            &format!("FAKE_ACP_REWRITE='{}'", target.display()),
        );
        let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
        assert_eq!(outcome.end, SessionEnd::Exited(1), "{link}");
        assert!(
            joined(&lines).contains(&format!("the agent file `{link}` of `k-a` changed")),
            "{}",
            joined(&lines)
        );
    }
}

/// One stage through `catalog` in `cwd`; the adapter is `program`.
fn run_with_catalog(
    catalog: &FileAgentCatalog,
    kind: AcpKind,
    program: &Path,
    cwd: &Path,
) -> (SessionOutcome, Lines) {
    let lines: Lines = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&lines);
    let launcher = SystemLauncher::with_grace_ms(200);
    let mut harness = AcpHarness::new(
        &launcher,
        catalog,
        kind,
        program.to_str().unwrap(),
        cwd.to_str().unwrap(),
        Box::new(move |line| sink.borrow_mut().push(line.to_string())),
    )
    .with_test_limits(None, Some(200));
    let outcome = harness.run_session(&session("p"));
    (outcome, lines)
}

#[test]
fn a_rewrite_of_an_agent_file_is_found_when_another_catalog_resolves_the_agent_to_a_different_file()
{
    let _serial = one_at_a_time();
    // Kiro: the agent file is in the home folder, and a search that does not look there finds a decoy in the project.
    // Claude: the agent file is in a folder above the project root, and the search from the project root alone finds
    // a decoy. The harness hashes the file of its own catalog, whatever another catalog shows.
    for kind in [AcpKind::KiroCli, AcpKind::Claude] {
        let setup = Setup::new(
            kind,
            &match kind {
                AcpKind::KiroCli => Agent::KiroV2(&["fs_read"]),
                AcpKind::Claude => Agent::Claude(Some("Read")),
            },
        );
        let outer = TempDir::new("acp-outer");
        let (relative, text): (&str, &[u8]) = match kind {
            AcpKind::KiroCli => (
                ".kiro/agents/k-a.json",
                br#"{"name":"k-a","allowedTools":["fs_read","fs_write"]}"#,
            ),
            AcpKind::Claude => (
                ".claude/agents/k-a.md",
                b"---\nname: k-a\ntools: Read\n---\nOuter.\n",
            ),
        };
        let real = outer.write(relative, text);
        // The project holds a different file for the same agent, which the harness's catalog must not use.
        let project = setup.project.path();
        let own = match kind {
            AcpKind::KiroCli => {
                FileAgentCatalog::new(Path::new("/nonexistent-project"), Some(outer.path()))
            }
            AcpKind::Claude => FileAgentCatalog::new(Path::new("/nonexistent-project"), None)
                .with_folders_above(&[outer.path().to_path_buf()]),
        };
        let other = FileAgentCatalog::new(project, None);
        let runner = match kind {
            AcpKind::KiroCli => workflow_core::ports::Runner::KiroCli,
            AcpKind::Claude => workflow_core::ports::Runner::Claude,
        };
        assert_ne!(
            own.agent_file_hash(runner, "k-a"),
            other.agent_file_hash(runner, "k-a"),
            "the two catalogs resolve to different files"
        );
        let program = setup.adapter("normal", "");
        let (outcome, lines) = run_with_catalog(&own, kind, &program, project);
        assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
        let program = setup.adapter("normal", &format!("FAKE_ACP_REWRITE='{}'", real.display()));
        let (outcome, lines) = run_with_catalog(&own, kind, &program, project);
        assert_eq!(outcome.end, SessionEnd::Exited(1), "{}", joined(&lines));
        assert!(
            joined(&lines).contains("of `k-a` changed while the stage ran"),
            "{}",
            joined(&lines)
        );
    }
}

#[test]
fn a_file_that_is_gone_after_the_stage_is_named_with_that_reason() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&["fs_read"]));
    let file = setup.project.path().join(".kiro/agents/k-a.json");
    let program = setup.adapter("normal", &format!("FAKE_ACP_REMOVE='{}'", file.display()));
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    let note = joined(&lines);
    assert!(
        note.contains("the agent file `.kiro/agents/k-a.json` of `k-a` changed")
            && note.contains("it is gone or cannot be read now"),
        "{note}"
    );
}

#[test]
fn a_tool_configuration_file_that_changes_between_two_stages_stops_the_second_stage_and_names_it() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let config = setup.project.write(".mcp.json", b"{\"mcpServers\":{}}");
    // The first adapter rewrites the tool configuration file, as an agent with a write tool could.
    let program = setup.adapter(
        "normal",
        &format!("FAKE_ACP_REWRITE='{}'", config.display()),
    );
    let project = setup.project.path().to_path_buf();
    let prepared = two_stage_workflow();
    let checked = check_text(
        "t",
        "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nstages:\n  - name: one\n    agent: k-a\n  - name: two\n    agent: k-a\n",
        &FileSource::under(&project),
    );
    // The same check `flow run` makes: the files the workflow was confirmed with, and the first one that differs.
    let scan = || scan_repo_config(&project, None, &project, &InstalledFiles::new());
    let confirmed = scan().unwrap();
    let confirmed_hash = checked.trust_inputs.hash(&confirmed);
    let unchanged = || match scan() {
        Err(unreadable) => Err(format!("{} entries cannot be read", unreadable.len())),
        Ok(files) if checked.trust_inputs.hash(&files) == confirmed_hash => Ok(()),
        Ok(files) => {
            let differs = files
                .iter()
                .find(|f| !confirmed.contains(f))
                .map_or("a file was removed".to_string(), |f| f.path.clone());
            Err(format!("{differs} changed"))
        }
    };
    assert!(unchanged().is_ok());
    let mut store = FileRunStore::open(&project).unwrap();
    let mut lock = FileRunLock::new(&project);
    let clock = Rc::new(SimulatedClock::default());
    let mut launcher = SystemLauncher::with_grace_ms(150);
    let mut run = start(
        &prepared,
        "kiro-cli-acp",
        current_owner(),
        &mut store,
        &mut lock,
        &*clock,
        &mut launcher,
    )
    .unwrap()
    .run;
    let catalog = setup.catalog();
    let mut acp = AcpHarness::new(
        &launcher,
        &catalog,
        AcpKind::KiroCli,
        program.to_str().unwrap(),
        project.to_str().unwrap(),
        Box::new(|_| {}),
    );
    let mut guarded = GuardedHarness::new(&mut acp, &unchanged);
    execute(
        &mut run,
        &prepared,
        &mut guarded,
        &*clock,
        &mut store,
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(guarded.refused_stage(), Some("two"));
    assert!(
        guarded
            .refused_cause()
            .is_some_and(|c| c.contains(".mcp.json")),
        "{:?}",
        guarded.refused_cause()
    );
    assert_eq!(run.status, RunStatus::Halted);
    assert_eq!(run.stages[0].status, StageStatus::Passed);
    assert_eq!(
        run.stages[1].status,
        StageStatus::Blocked(Reason::SessionFailed)
    );
    // The second adapter never started.
    assert_eq!(setup.log().matches("\"method\":\"initialize\"").count(), 1);
}

#[test]
fn a_kiro_agent_is_found_by_its_name_in_a_file_with_another_name_and_its_rules_come_from_that_file()
{
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&["fs_read"]));
    // Move the agent to a file whose name has nothing to do with its id, and leave a decoy under its id.
    let original = setup.project.path().join(".kiro/agents/k-a.json");
    let text = fs::read_to_string(&original).unwrap();
    let moved = setup.project.path().join(".kiro/agents/renamed.json");
    fs::rename(&original, &moved).unwrap();
    assert!(text.contains("\"name\":\"k-a\""));
    fs::write(&original, r#"{"name":"decoy","allowedTools":["shell"]}"#).unwrap();

    // The stage runs as `k-a` from the moved file, and its allow list is that file's.
    let program = setup.adapter("perm", "FAKE_ACP_TOOL=fs_read");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
    assert_eq!(setup.args(), "acp --agent k-a --agent-engine v2");
    // A tool that only the decoy lists is not allowed.
    let program = setup.adapter("perm", "FAKE_ACP_TOOL=shell");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    let note = joined(&lines);
    assert!(
        note.contains("the agent file `.kiro/agents/renamed.json`"),
        "{note}"
    );
    // A rewrite of the moved file is found, and the note names it.
    let program = setup.adapter("normal", &format!("FAKE_ACP_REWRITE='{}'", moved.display()));
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(1));
    assert!(
        joined(&lines).contains("the agent file `.kiro/agents/renamed.json` of `k-a` changed"),
        "{}",
        joined(&lines)
    );
}

#[test]
fn the_adapter_group_is_reported_while_it_runs_and_is_the_adapters_own() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("hang", "");
    let launcher = SystemLauncher::with_grace_ms(150);
    let mut recorded: Vec<ProcessGroup> = Vec::new();
    let mut process = None;
    for _ in 0..20 {
        match launcher.spawn_piped(
            program.to_str().unwrap(),
            &[],
            setup.project.path().to_str().unwrap(),
            Duration::from_secs(60),
            &mut |g| {
                recorded.push(g.clone());
                Ok(())
            },
        ) {
            Ok(started) => {
                process = Some(started);
                break;
            }
            Err(why) if why.contains("busy") => std::thread::sleep(Duration::from_millis(50)),
            Err(why) => panic!("{why}"),
        }
    }
    let mut process = process.expect("the adapter started");
    assert_eq!(recorded.len(), 1);
    let group = recorded[0].clone();
    assert_ne!(group.pgid, std::process::id());
    let mut state = SystemLauncher::with_grace_ms(150);
    // The record is what the sweep of a killed owner reads: it matches while the adapter runs.
    assert_eq!(state.group_state(&group), GroupState::Matches);
    assert!(alive(group.pgid));
    process.end();
    assert_eq!(state.group_state(&group), GroupState::Gone);
}

#[test]
fn dropping_the_adapter_ends_its_group_on_every_path() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("hang", "");
    let launcher = SystemLauncher::with_grace_ms(150);
    let mut group = None;
    let process = (0..20).find_map(|_| {
        match launcher.spawn_piped(
            program.to_str().unwrap(),
            &[],
            setup.project.path().to_str().unwrap(),
            Duration::from_secs(60),
            &mut |g| {
                group = Some(g.clone());
                Ok(())
            },
        ) {
            Ok(process) => Some(process),
            Err(_) => {
                std::thread::sleep(Duration::from_millis(50));
                None
            }
        }
    });
    let group = group.expect("recorded");
    drop(process);
    let mut state = SystemLauncher::with_grace_ms(150);
    assert_eq!(state.group_state(&group), GroupState::Gone);
}

#[test]
fn the_message_text_is_cut_to_its_last_mebibyte_and_the_result_line_is_still_read() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("big-text", "");
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
    assert!(outcome.final_message.len() <= MAX_SESSION_OUTPUT_BYTES);
    assert!(outcome.final_message.len() > MAX_SESSION_OUTPUT_BYTES - 100);
    assert!(judge(&outcome).is_ok());
}

#[test]
fn the_adapter_gets_the_environment_of_this_process_and_nothing_added() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let seen = setup.bin.path().join("env");
    let program = setup.adapter("normal", &format!("FAKE_ACP_ENV_FILE='{}'", seen.display()));
    let (outcome, lines) = run_one(&setup, &program, None, 200, &session("p"));
    assert_eq!(outcome.end, SessionEnd::Exited(0), "{}", joined(&lines));
    // The shell adds a few variables of its own, and the wrapper script adds the FAKE_ACP ones.
    // A value with a line break in it, as a shell prompt can have, makes `env | cut` print a piece of it as a name.
    let ignored = |name: &str| {
        matches!(name, "PWD" | "OLDPWD" | "SHLVL" | "_")
            || name.starts_with("FAKE_ACP_")
            || !name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
    };
    let child: std::collections::BTreeSet<String> = fs::read_to_string(&seen)
        .unwrap()
        .lines()
        .filter(|n| !ignored(n))
        .map(str::to_string)
        .collect();
    let ours: std::collections::BTreeSet<String> = std::env::vars_os()
        .filter_map(|(name, _)| name.into_string().ok())
        .filter(|n| !ignored(n))
        .collect();
    assert_eq!(child, ours);
}

// --- inside a run --------------------------------------------------------------------------------------------------

fn two_stage_workflow() -> workflow_core::runner::Prepared {
    let text = "format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Do it.\nstages:\n  - name: one\n    agent: k-a\n  - name: two\n    agent: k-a\n";
    let project = TempDir::new("unused");
    let workflow = check_text("t", text, &FileSource::under(project.path()))
        .workflow
        .expect("valid");
    prepare(workflow, Some("Goal."), &BTreeMap::new()).expect("prepared")
}

fn run_two_stages(setup: &Setup, program: &Path) -> Run {
    let project = setup.project.path().to_path_buf();
    let prepared = two_stage_workflow();
    let mut store = FileRunStore::open(&project).unwrap();
    let mut lock = FileRunLock::new(&project);
    let clock = Rc::new(SimulatedClock::default());
    let mut launcher = SystemLauncher::with_grace_ms(150);
    let mut run = start(
        &prepared,
        "kiro-cli-acp",
        current_owner(),
        &mut store,
        &mut lock,
        &*clock,
        &mut launcher,
    )
    .unwrap()
    .run;
    let catalog = setup.catalog();
    let mut harness = AcpHarness::new(
        &launcher,
        &catalog,
        setup.kind,
        program.to_str().unwrap(),
        project.to_str().unwrap(),
        Box::new(|_| {}),
    );
    execute(
        &mut run,
        &prepared,
        &mut harness,
        &*clock,
        &mut store,
        &mut |_| {},
    )
    .unwrap();
    let state = FileRunStore::open(&project)
        .unwrap()
        .read_state(&run.run_id)
        .unwrap()
        .unwrap();
    assert_eq!(Run::from_text(&state).unwrap().session_group, None);
    run
}

#[test]
fn a_run_passes_when_each_stage_has_its_own_adapter() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("normal", "");
    let run = run_two_stages(&setup, &program);
    assert_eq!(run.status, RunStatus::Passed);
    // Two stages, so two adapters, and each read initialize first.
    assert_eq!(setup.log().matches("\"method\":\"initialize\"").count(), 2);
}

#[test]
fn a_denied_permission_blocks_the_stage_and_halts_the_run_before_the_next_stage() {
    let _serial = one_at_a_time();
    let setup = Setup::new(AcpKind::KiroCli, &Agent::KiroV2(&[]));
    let program = setup.adapter("perm", "FAKE_ACP_TOOL=fs_write");
    let run = run_two_stages(&setup, &program);
    assert_eq!(run.status, RunStatus::Halted);
    assert_eq!(
        run.stages[0].status,
        StageStatus::Blocked(Reason::SessionFailed)
    );
    assert_eq!(run.stages[1].status, StageStatus::Pending);
    assert_eq!(setup.log().matches("\"method\":\"initialize\"").count(), 1);
}
