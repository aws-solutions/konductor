// SPDX-License-Identifier: Apache-2.0
//! The trust hash, the gate's verdict and the summary.

mod common;

use std::cell::Cell;
use std::collections::BTreeMap;

use common::{check_with, codes, MemorySource, VALID};
use workflow_core::ports::{
    AgentCatalog, AgentDefinition, AgentTools, Harness, Placement, Runner, Session, SessionEnd,
    SessionOutcome,
};
use workflow_core::runner::{judge, GuardedHarness};
use workflow_core::trust::{
    decide, needs_trust, render_summary, ConfigFile, SummaryInput, TrustInputs, Verdict,
};
use workflow_core::trust::{plain, sha256_hex};
use workflow_core::Reason;
use workflow_core::{check_text, WorkflowSource};

const WITH_FILE: &str = "format: konductor/1
version: 0.1.0
intent:
  outcome: Do it.
stages:
  - name: plan
    agent: k-architect
    prompt_file: plan.md
";

fn config(path: &str, bytes: &[u8]) -> ConfigFile {
    ConfigFile {
        path: path.to_string(),
        bytes: bytes.to_vec(),
    }
}

fn hash_of(text: &str, source: &MemorySource, config: &[ConfigFile]) -> String {
    check_with(text, source).trust_inputs.hash(config)
}

#[test]
fn the_layout_has_a_known_answer() {
    let inputs = TrustInputs::new(
        b"abc".to_vec(),
        BTreeMap::from([("a.md".to_string(), b"xy".to_vec())]),
    );
    assert_eq!(
        inputs.hash(&[config(".mcp.json", b"{}")]),
        "e233bdfa952c4e2e8cc6b08d3e626788932c40dc68c61e4dbb51082f34e1b7ac"
    );
}

#[test]
fn the_hash_is_stable_and_64_lowercase_hex_digits() {
    let source = MemorySource::default();
    let first = hash_of(VALID, &source, &[]);
    assert_eq!(first, hash_of(VALID, &source, &[]));
    assert_eq!(first.len(), 64);
    assert!(first
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
}

#[test]
fn the_hash_changes_with_the_workflow_bytes() {
    let source = MemorySource::default();
    let changed = VALID.replace("Do it.", "Do it!");
    assert_ne!(
        hash_of(VALID, &source, &[]),
        hash_of(&changed, &source, &[])
    );
    // A comment or trailing space changes the bytes, so it changes the hash.
    assert_ne!(
        hash_of(VALID, &source, &[]),
        hash_of(&format!("{VALID}# x\n"), &source, &[])
    );
}

#[test]
fn the_hash_changes_with_a_prompt_file_and_not_with_another_one() {
    let mut source = MemorySource::with("plan.md", b"Plan it.");
    source.files.insert("other.md".into(), b"Other.".to_vec());
    let before = hash_of(WITH_FILE, &source, &[]);
    source.files.insert("other.md".into(), b"Changed.".to_vec());
    assert_eq!(before, hash_of(WITH_FILE, &source, &[]));
    source.files.insert("plan.md".into(), b"Plan it!".to_vec());
    assert_ne!(before, hash_of(WITH_FILE, &source, &[]));
}

#[test]
fn another_workflow_does_not_change_the_hash() {
    let mut source = MemorySource::default();
    source.files.insert("other.yml".into(), b"a: 1".to_vec());
    let before = hash_of(VALID, &source, &[]);
    source.files.insert("other.yml".into(), b"a: 2".to_vec());
    assert_eq!(before, hash_of(VALID, &source, &[]));
}

#[test]
fn the_hash_covers_config_files_whatever_their_order() {
    let source = MemorySource::default();
    let a = config(".claude/settings.json", b"{}");
    let b = config(".mcp.json", b"{}");
    let plain = hash_of(VALID, &source, &[]);
    let both = hash_of(VALID, &source, &[a.clone(), b.clone()]);
    assert_ne!(plain, both);
    assert_eq!(both, hash_of(VALID, &source, &[b.clone(), a.clone()]));
    assert_ne!(
        both,
        hash_of(VALID, &source, &[a.clone(), config(".mcp.json", b"{ }")])
    );
    // The path counts, not only the bytes.
    assert_ne!(
        hash_of(VALID, &source, &[config("x", b"1")]),
        hash_of(VALID, &source, &[config("y", b"1")])
    );
}

/// One frame as the spec writes it: a kind byte, the path length (8 bytes, big endian), the path, the content length
/// (8 bytes) and the content.
fn frame(kind: u8, path: &str, content: &[u8]) -> Vec<u8> {
    let mut out = vec![kind];
    out.extend_from_slice(&(path.len() as u64).to_be_bytes());
    out.extend_from_slice(path.as_bytes());
    out.extend_from_slice(&(content.len() as u64).to_be_bytes());
    out.extend_from_slice(content);
    out
}

#[test]
fn a_prompt_file_that_cannot_be_read_is_a_workflow_error_and_there_is_no_hash_to_give() {
    // The source has no `plan.md`: the same answer a file that is not there, a link, a file over the limit or one that
    // cannot be read gets from the source. It is `INVALID_VALUE`, an error (exit 65), and not a frame of the hash.
    let checked = check_with(WITH_FILE, &MemorySource::default());
    assert!(!checked.is_valid());
    assert_eq!(codes(&checked), ["INVALID_VALUE"]);
    assert!(checked.workflow.is_none());
}

#[test]
fn the_hashed_input_has_only_workflow_prompt_and_config_frames_and_no_frame_for_an_unreadable_file()
{
    // The layout is the tag, one `w` frame, the `p` frames sorted by path, then the `c` frames sorted by path. A file
    // that cannot be read has no hash, so there is no frame kind for it: the scan refuses the run before a hash is
    // made.
    let inputs = TrustInputs::new(
        b"wf".to_vec(),
        BTreeMap::from([
            ("b.md".to_string(), b"B".to_vec()),
            ("a.md".to_string(), b"A".to_vec()),
        ]),
    );
    let mut expected = b"konductor-trust/1\n".to_vec();
    expected.extend(frame(b'w', "", b"wf"));
    expected.extend(frame(b'p', "a.md", b"A"));
    expected.extend(frame(b'p', "b.md", b"B"));
    expected.extend(frame(b'c', ".claude/settings.json", b"{}"));
    expected.extend(frame(b'c', ".mcp.json", b"{}"));
    assert_eq!(
        inputs.hash(&[
            config(".mcp.json", b"{}"),
            config(".claude/settings.json", b"{}")
        ]),
        sha256_hex(&expected)
    );
}

#[test]
fn frames_cannot_be_shifted_into_each_other() {
    let one = TrustInputs::new(
        b"w".to_vec(),
        BTreeMap::from([("ab".to_string(), b"c".to_vec())]),
    );
    let two = TrustInputs::new(
        b"w".to_vec(),
        BTreeMap::from([("a".to_string(), b"bc".to_vec())]),
    );
    assert_ne!(one.hash(&[]), two.hash(&[]));
}

/// Gives different bytes each time a prompt file is read.
struct Shifting(Cell<u8>);

impl WorkflowSource for Shifting {
    fn workflow_bytes(&self, _: &str) -> Option<Vec<u8>> {
        None
    }
    fn prompt_file_bytes(&self, _: &str) -> Option<Vec<u8>> {
        self.0.set(self.0.get() + 1);
        Some(vec![b'a' + self.0.get()])
    }
}

#[test]
fn the_loader_hashes_the_bytes_it_parsed() {
    let source = Shifting(Cell::new(0));
    let checked = check_text("t", WITH_FILE, &source);
    assert!(checked.is_valid(), "{:?}", checked.diagnostics);
    let parsed = checked.workflow.as_ref().unwrap().stages[0]
        .prompt
        .clone()
        .unwrap();
    let expected = TrustInputs::new(
        WITH_FILE.as_bytes().to_vec(),
        BTreeMap::from([("plan.md".to_string(), parsed.into_bytes())]),
    );
    assert_eq!(checked.trust_inputs, expected);
    assert_eq!(source.0.get(), 1, "the file is read once");
}

#[test]
fn the_rule_for_who_needs_trust() {
    assert!(needs_trust(true, &[]));
    assert!(!needs_trust(false, &[]));
    assert!(needs_trust(false, &[config(".mcp.json", b"")]));
}

#[test]
fn the_verdict() {
    let h = "a".repeat(64);
    let other = "b".repeat(64);
    assert_eq!(decide(&h, Some(&h), None), Verdict::Trusted);
    assert_eq!(decide(&h, Some(&other), None), Verdict::Unconfirmed);
    assert_eq!(decide(&h, None, None), Verdict::Unconfirmed);
    assert_eq!(decide(&h, None, Some(&h)), Verdict::OfferedHashMatches);
    assert_eq!(
        decide(&h, None, Some(&h.to_uppercase())),
        Verdict::OfferedHashMatches
    );
    assert_eq!(
        decide(&h, Some(&h), Some(&other)),
        Verdict::OfferedHashDiffers(other.clone())
    );
    assert_eq!(
        decide(&h, None, Some("nonsense")),
        Verdict::OfferedHashDiffers("nonsense".into())
    );
}

struct Catalog(Vec<AgentDefinition>);

impl AgentCatalog for Catalog {
    fn definitions(&self, agent: &str) -> Vec<AgentDefinition> {
        if agent == "k-architect" {
            self.0.clone()
        } else {
            Vec::new()
        }
    }
}

fn summary(catalog: &Catalog, config: &[ConfigFile]) -> String {
    let checked = check_with(WITH_FILE, &MemorySource::with("plan.md", b"Plan."));
    let workflow = checked.workflow.as_ref().unwrap();
    let hash = checked.trust_inputs.hash(config);
    render_summary(&SummaryInput {
        name: "t",
        path: ".konductor/workflows/t.yml",
        hash: &hash,
        workflow,
        inputs: &checked.trust_inputs,
        config,
        catalog,
    })
}

fn definition(runner: Runner, tools: AgentTools) -> AgentDefinition {
    AgentDefinition {
        runner,
        placement: Placement::Project,
        tools,
        also_sets: Vec::new(),
    }
}

#[test]
fn the_summary_lists_the_parts_the_spec_names() {
    let catalog = Catalog(vec![
        definition(
            Runner::KiroCli,
            AgentTools::Listed(vec!["fs_read".into(), "@aws-mcp/read_docs".into()]),
        ),
        definition(
            Runner::Claude,
            AgentTools::Listed(vec!["Read".into(), "Bash".into()]),
        ),
    ]);
    let text = summary(&catalog, &[]);
    assert!(text.contains("Workflow: t\nPath: .konductor/workflows/t.yml\nTrust hash: "));
    assert!(text.contains("kiro-cli (project): runs without asking: fs_read, @aws-mcp/read_docs\n"));
    assert!(text.contains(
        "claude (project): each tool in its tools list runs without asking: Read, Bash\n"
    ));
    assert!(text.contains("Run checks: none\n"));
    assert!(text.contains("  .konductor/workflows/t.yml (the workflow)\n  plan.md (prompt file)\n"));
    assert!(!text.contains("tool configuration files"));
}

#[test]
fn a_claude_agent_with_no_tools_key_lists_no_tool_names() {
    let catalog = Catalog(vec![definition(
        Runner::Claude,
        AgentTools::EveryToolNonePreApproved,
    )]);
    let text = summary(&catalog, &[]);
    assert!(text.contains("every tool is available, and the file's tools key pre-approves none"));
    assert!(!text.contains("runs without asking"));
}

#[test]
fn an_agent_with_no_definition_and_an_unknown_one_are_said() {
    let none = summary(&Catalog(vec![]), &[]);
    assert!(none.contains("no definition found in the project or in your home folder"));
    let unknown = summary(
        &Catalog(vec![definition(
            Runner::KiroCli,
            AgentTools::Unknown("the file has no allowedTools list".into()),
        )]),
        &[],
    );
    assert!(unknown.contains("kiro-cli (project): the file has no allowedTools list\n"));
}

#[test]
fn the_summary_lists_config_files_and_cleans_what_a_repo_wrote() {
    let catalog = Catalog(vec![definition(
        Runner::KiroCli,
        AgentTools::Listed(vec!["bad\u{1b}[2Jtool".into()]),
    )]);
    let text = summary(&catalog, &[config(".claude/settings.json", b"{}")]);
    assert!(text.contains("tool configuration files"));
    assert!(text.contains("  .claude/settings.json\n"));
    assert!(text.contains("bad?[2Jtool"));
    assert!(!text.contains('\u{1b}'));
}

#[test]
fn long_tool_lists_wrap_at_120_columns() {
    let tools: Vec<String> = (0..60).map(|n| format!("mcp__aws-mcp__tool_{n}")).collect();
    let text = summary(
        &Catalog(vec![definition(
            Runner::Claude,
            AgentTools::Listed(tools.clone()),
        )]),
        &[],
    );
    assert!(text.lines().all(|l| l.chars().count() <= 120));
    for tool in &tools {
        assert!(text.contains(tool.as_str()));
    }
}

#[test]
fn an_empty_kiro_list_does_not_claim_that_nothing_runs() {
    let text = summary(
        &Catalog(vec![definition(
            Runner::KiroCli,
            AgentTools::Listed(Vec::new()),
        )]),
        &[],
    );
    assert!(text.contains("its allowedTools list is empty, so that list pre-approves no tool\n"));
    assert!(!text.contains("nothing runs without asking"));
}

#[test]
fn keys_that_can_change_what_runs_are_named_and_not_read() {
    let mut claude = definition(Runner::Claude, AgentTools::EveryToolNonePreApproved);
    claude.also_sets = vec!["permissionMode".into(), "hooks".into(), "mcpServers".into()];
    let mut kiro = definition(Runner::KiroCli, AgentTools::Listed(vec!["fs_read".into()]));
    kiro.also_sets = vec!["hooks".into(), "toolsSettings".into()];
    let text = summary(&Catalog(vec![kiro, claude]), &[]);
    assert!(
        text.contains("      also sets: hooks, toolsSettings\n"),
        "{text}"
    );
    assert!(
        text.contains("      also sets: permissionMode, hooks, mcpServers\n"),
        "{text}"
    );
    assert_eq!(
        text.matches("This build does not read these keys, and they can change what runs.")
            .count(),
        2
    );
    assert!(text.lines().all(|l| l.chars().count() <= 120));
}

#[test]
fn text_that_prints_as_nothing_or_moves_the_cursor_is_replaced() {
    let nasty = [
        '\u{200b}',
        '\u{200c}',
        '\u{200d}',
        '\u{2060}',
        '\u{feff}',
        '\u{2028}',
        '\u{2029}',
        '\u{e0041}',
        '\u{e007f}',
        '\u{202e}',
        '\u{1b}',
        // The rest of the format characters (Cf), including the six that were missed: U+206A to U+206F.
        '\u{00ad}',
        '\u{0600}',
        '\u{06dd}',
        '\u{070f}',
        '\u{180e}',
        '\u{2061}',
        '\u{2064}',
        '\u{206a}',
        '\u{206b}',
        '\u{206c}',
        '\u{206d}',
        '\u{206e}',
        '\u{206f}',
        '\u{fff9}',
        '\u{fffa}',
        '\u{fffb}',
        '\u{110bd}',
        '\u{1d173}',
        '\u{e0001}',
        // Default-ignorable code points that are not Cf.
        '\u{034f}',
        '\u{115f}',
        '\u{1160}',
        '\u{17b4}',
        '\u{17b5}',
        '\u{180b}',
        '\u{180d}',
        '\u{180f}',
        '\u{3164}',
        '\u{fe00}',
        '\u{fe0f}',
        '\u{ffa0}',
        '\u{e0100}',
        '\u{e01ef}',
    ];
    for c in nasty {
        let shown = plain(&format!("a{c}b"));
        assert_eq!(shown, "a?b", "U+{:04X}", c as u32);
    }
    assert_eq!(plain("plain text"), "plain text");
}

const TWO_STAGES_ONE_FILE: &str = "format: konductor/1
version: 0.1.0
intent:
  outcome: Do it.
stages:
  - name: plan
    agent: k-architect
    prompt_file: shared.md
  - name: build
    agent: k-architect
    prompt_file: shared.md
";

#[test]
fn a_prompt_file_that_two_stages_name_is_read_once_and_hashed_as_read() {
    let source = Shifting(Cell::new(0));
    let checked = check_text("t", TWO_STAGES_ONE_FILE, &source);
    assert!(checked.is_valid(), "{:?}", checked.diagnostics);
    assert_eq!(source.0.get(), 1, "the file is read once");
    let stages = &checked.workflow.as_ref().unwrap().stages;
    assert_eq!(stages[0].prompt, stages[1].prompt);
    let text = stages[0].prompt.clone().unwrap();
    let expected = TrustInputs::new(
        TWO_STAGES_ONE_FILE.as_bytes().to_vec(),
        BTreeMap::from([("shared.md".to_string(), text.into_bytes())]),
    );
    assert_eq!(checked.trust_inputs, expected);
}

fn summary_of(config: &[ConfigFile]) -> String {
    summary(&Catalog(vec![]), config)
}

#[test]
fn the_summary_names_the_top_level_keys_of_a_settings_file() {
    let text = summary_of(&[
        config(
            ".claude/settings.json",
            br#"{"permissions": {}, "hooks": {"SessionStart": []}, "env": {}}"#,
        ),
        config(".claude/settings.local.json", b"{}"),
    ]);
    assert!(
        text.contains("  .claude/settings.json\n    sets the keys: env, hooks, permissions\n"),
        "{text}"
    );
    assert!(
        text.contains("  .claude/settings.local.json\n    sets no top-level key\n"),
        "{text}"
    );
}

#[test]
fn the_summary_names_the_servers_an_mcp_file_starts() {
    let text = summary_of(&[
        config(
            ".mcp.json",
            br#"{"mcpServers": {
                "docs": {"command": "npx", "args": ["-y", "some-server@1"]},
                "remote": {"url": "https://example.com/mcp"},
                "odd": {"type": "stdio"}
            }}"#,
        ),
        config(".kiro/settings/mcp.json", br#"{"mcpServers": {}}"#),
    ]);
    assert!(
        text.contains("    server docs runs: npx -y some-server@1\n"),
        "{text}"
    );
    assert!(
        text.contains("    server remote connects to https://example.com/mcp\n"),
        "{text}"
    );
    assert!(
        text.contains("    server odd has no command or address this build can read\n"),
        "{text}"
    );
    assert!(
        text.contains("  .kiro/settings/mcp.json\n    starts no MCP server\n"),
        "{text}"
    );
}

#[test]
fn a_settings_file_that_is_not_json_is_said_and_text_from_it_is_cleaned() {
    let text = summary_of(&[config(".claude/settings.json", b"{ not json")]);
    assert!(
        text.contains("is not a JSON object, so this build cannot say what it sets"),
        "{text}"
    );
    let text = summary_of(&[config(
        "sub/.mcp.json",
        "{\"mcpServers\": {\"a\\u001bb\": {\"command\": \"x\\u202ey\"}}}".as_bytes(),
    )]);
    assert!(text.contains("server a?b runs: x?y\n"), "{text}");
    assert!(!text.contains('\u{1b}') && !text.contains('\u{202e}'));
}

#[test]
fn a_long_mcp_command_wraps_and_keeps_every_argument() {
    let args: Vec<String> = (0..60).map(|n| format!("--flag-number-{n}")).collect();
    let json = format!(
        "{{\"mcpServers\": {{\"big\": {{\"command\": \"run\", \"args\": {:?}}}}}}}",
        args
    );
    let text = summary_of(&[config(".mcp.json", json.as_bytes())]);
    assert!(text.lines().all(|l| l.chars().count() <= 120), "{text}");
    for arg in &args {
        assert!(text.contains(arg.as_str()));
    }
}

/// A harness that counts its sessions and runs `edit` at the end of each one.
struct Counting<'a> {
    sessions: Vec<String>,
    edit: &'a dyn Fn(),
}

impl Harness for Counting<'_> {
    fn run_session(&mut self, session: &Session) -> SessionOutcome {
        self.sessions.push(session.stage.to_string());
        (self.edit)();
        SessionOutcome {
            end: SessionEnd::Exited(0),
            final_message: String::new(),
        }
    }
}

#[test]
fn a_guarded_harness_refuses_the_session_after_a_change_and_every_session_after_it() {
    use std::cell::Cell;
    // The files change once the first session has run, and the check then fails for good.
    let ran = Cell::new(0);
    let unchanged = || ran.get() < 1;
    let bump = || ran.set(ran.get() + 1);
    let mut inner = Counting {
        sessions: Vec::new(),
        edit: &bump,
    };
    let mut guard = GuardedHarness::new(&mut inner, &unchanged);
    let session = |stage| Session {
        stage,
        agent: "k-architect",
        prompt: "p",
        time_limit_ms: 1,
    };
    assert_eq!(
        guard.run_session(&session("one")).end,
        SessionEnd::Exited(0)
    );
    assert_eq!(guard.refused_stage(), None);
    assert_eq!(
        guard.run_session(&session("two")).end,
        SessionEnd::NotStarted
    );
    assert_eq!(guard.refused_stage(), Some("two"));
    assert_eq!(
        guard.run_session(&session("three")).end,
        SessionEnd::NotStarted
    );
    assert_eq!(guard.refused_stage(), Some("two"));
    drop(guard);
    // Only the first session reached the harness.
    assert_eq!(inner.sessions, ["one"]);
}

#[test]
fn a_session_the_guard_refuses_ends_its_stage_as_session_failed() {
    let refused = SessionOutcome {
        end: SessionEnd::NotStarted,
        final_message: String::new(),
    };
    assert_eq!(judge(&refused, 0), Err(Reason::SessionFailed));
}
