// SPDX-License-Identifier: Apache-2.0
//! The trust hash, the gate's verdict and the summary.

mod common;

use std::cell::Cell;
use std::collections::BTreeMap;

use common::{check_with, MemorySource, VALID};
use workflow_core::ports::{AgentCatalog, AgentDefinition, AgentTools, Placement, Runner};
use workflow_core::trust::plain;
use workflow_core::trust::{
    decide, needs_trust, render_summary, ConfigContent, ConfigFile, SummaryInput, TrustInputs,
    Verdict,
};
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
        content: ConfigContent::Bytes(bytes.to_vec()),
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

#[test]
fn a_file_that_could_not_be_read_still_changes_the_hash() {
    let source = MemorySource::default();
    let unreadable = ConfigFile {
        path: ".mcp.json".into(),
        content: ConfigContent::Unreadable("is too large".into()),
    };
    assert_ne!(
        hash_of(VALID, &source, &[]),
        hash_of(VALID, &source, std::slice::from_ref(&unreadable))
    );
    assert_ne!(
        hash_of(VALID, &source, &[unreadable]),
        hash_of(VALID, &source, &[config(".mcp.json", b"is too large")])
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
    ];
    for c in nasty {
        let shown = plain(&format!("a{c}b"));
        assert_eq!(shown, "a?b", "U+{:04X}", c as u32);
    }
    assert_eq!(plain("plain text"), "plain text");
}
