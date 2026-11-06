// SPDX-License-Identifier: Apache-2.0
//! Trust (D14): the hash a confirmation covers, whether a workflow needs one, the answer to a `--trust` hash, and the
//! summary the user reads before they confirm.
//!
//! # The trust hash
//!
//! The hash is a SHA-256 over a byte string built like this, and written as 64 lowercase hex digits:
//!
//! ```text
//! input = "konductor-trust/1\n" frame*
//! frame = kind(1 byte) len(path)(8 bytes) path len(content)(8 bytes) content
//! ```
//!
//! Both lengths are unsigned and big endian, so no separator is needed and no two inputs share a byte string. A path is
//! UTF-8 with `/` between its parts. The frames come in this order:
//!
//! 1. One `w` frame: the workflow file. Its path is empty, so the hash does not depend on the file's name or folder.
//! 2. One `p` frame for each distinct `prompt_file` the workflow names, sorted by path in byte order. The path is as
//!    written in the workflow, relative to the workflow's folder.
//! 3. The repo tool configuration files, one frame each, sorted by path in byte order. The path is relative to the
//!    repo root. A file that was read is a `c` frame with its bytes. A file that is there and could not be read is a
//!    `u` frame whose content is the reason, so an unreadable file changes the hash and is never skipped.
//!
//! The version tag changes with any change to this layout, so a hash of one layout is never read as another's.

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};

use crate::model::Workflow;
use crate::ports::{AgentCatalog, AgentDefinition, AgentTools, Runner};

/// The first bytes of the hashed input. Changes with the layout.
const HASH_TAG: &[u8] = b"konductor-trust/1\n";

/// The lowercase hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// A repo tool configuration file that a headless run loads without asking (spec: "Repo tool configuration").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigFile {
    /// Relative to the repo root, with `/` between the parts.
    pub path: String,
    pub content: ConfigContent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigContent {
    Bytes(Vec<u8>),
    /// The file is there and could not be read, for the reason in the text.
    Unreadable(String),
}

/// The bytes of a workflow and of the prompt files it names, exactly as the loader parsed them. The hash is made from
/// these and not from a second read, so a file edited after the check cannot run under the old confirmation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrustInputs {
    workflow: Vec<u8>,
    prompt_files: BTreeMap<String, Vec<u8>>,
}

impl TrustInputs {
    pub fn new(workflow: Vec<u8>, prompt_files: BTreeMap<String, Vec<u8>>) -> TrustInputs {
        TrustInputs {
            workflow,
            prompt_files,
        }
    }

    /// The paths of the prompt files in the hash, sorted.
    pub fn prompt_paths(&self) -> impl Iterator<Item = &str> {
        self.prompt_files.keys().map(String::as_str)
    }

    /// The trust hash of the workflow, its prompt files and `config`. The order of `config` does not matter.
    pub fn hash(&self, config: &[ConfigFile]) -> String {
        let mut input = HASH_TAG.to_vec();
        push_frame(&mut input, b'w', "", &self.workflow);
        for (path, bytes) in &self.prompt_files {
            push_frame(&mut input, b'p', path, bytes);
        }
        let mut sorted: Vec<&ConfigFile> = config.iter().collect();
        sorted.sort_by(|a, b| a.path.cmp(&b.path));
        for file in sorted {
            match &file.content {
                ConfigContent::Bytes(bytes) => push_frame(&mut input, b'c', &file.path, bytes),
                ConfigContent::Unreadable(reason) => {
                    push_frame(&mut input, b'u', &file.path, reason.as_bytes());
                }
            }
        }
        sha256_hex(&input)
    }
}

fn push_frame(out: &mut Vec<u8>, kind: u8, path: &str, content: &[u8]) {
    out.push(kind);
    out.extend_from_slice(&(path.len() as u64).to_be_bytes());
    out.extend_from_slice(path.as_bytes());
    out.extend_from_slice(&(content.len() as u64).to_be_bytes());
    out.extend_from_slice(content);
}

/// Whether running the workflow needs the user's confirmation: a project workflow always does, and any workflow does
/// in a repo that carries tool configuration files. User and shipped workflows need none otherwise.
pub fn needs_trust(project_workflow: bool, config: &[ConfigFile]) -> bool {
    project_workflow || !config.is_empty()
}

/// What the gate makes of the recorded hash and of a `--trust` hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// The record holds the current hash.
    Trusted,
    /// The `--trust` hash equals the current hash. It permits this run and is not recorded.
    OfferedHashMatches,
    /// The `--trust` hash is not the current hash. The run is refused even if the record holds the current hash, so a
    /// script that pins a hash learns when it is out of date.
    OfferedHashDiffers(String),
    /// Nothing confirms the current hash. The user must be asked.
    Unconfirmed,
}

/// Compares the current hash with the record and with the hash passed on the command line, if one was.
pub fn decide(current: &str, recorded: Option<&str>, offered: Option<&str>) -> Verdict {
    let offered_matches = offered.map(|given| same_hash(given, current));
    if offered_matches == Some(false) {
        return Verdict::OfferedHashDiffers(offered.unwrap_or_default().to_string());
    }
    if recorded.is_some_and(|hash| same_hash(hash, current)) {
        return Verdict::Trusted;
    }
    match offered_matches {
        Some(true) => Verdict::OfferedHashMatches,
        _ => Verdict::Unconfirmed,
    }
}

fn same_hash(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// The line width of the summary.
const WIDTH: usize = 120;

/// Everything the summary shows.
pub struct SummaryInput<'a> {
    pub name: &'a str,
    /// The workflow file as the user thinks of it, such as `.konductor/workflows/plan.yml`.
    pub path: &'a str,
    pub hash: &'a str,
    pub workflow: &'a Workflow,
    pub inputs: &'a TrustInputs,
    pub config: &'a [ConfigFile],
    pub catalog: &'a dyn AgentCatalog,
}

/// The summary of what will run, ahead of the question (spec: "Asking").
///
/// A name, a path or a tool name can come from a repo, so each is shown with control characters replaced. A line of
/// the summary then cannot rewrite another one on the user's terminal.
pub fn render_summary(input: &SummaryInput) -> String {
    let mut out = String::new();
    out.push_str(&format!("Workflow: {}\n", plain(input.name)));
    out.push_str(&format!("Path: {}\n", plain(input.path)));
    out.push_str(&format!("Trust hash: {}\n\n", input.hash));

    out.push_str("Agents the stages run as:\n");
    for agent in agent_ids(input.workflow) {
        out.push_str(&format!("  {}\n", plain(agent)));
        let definitions = input.catalog.definitions(agent);
        if definitions.is_empty() {
            out.push_str("    no definition found in the project or in your home folder\n");
        }
        for definition in &definitions {
            out.push_str(&definition_line(definition));
        }
    }

    out.push('\n');
    let commands = run_check_commands(input.workflow);
    if commands.is_empty() {
        out.push_str("Run checks: none\n");
    } else {
        out.push_str("Run checks:\n");
        for command in commands {
            out.push_str(&format!("  {}\n", plain(&command)));
        }
    }

    out.push_str("\nFiles the trust hash covers:\n");
    out.push_str(&format!("  {} (the workflow)\n", plain(input.path)));
    for path in input.inputs.prompt_paths() {
        out.push_str(&format!("  {} (prompt file)\n", plain(path)));
    }
    if !input.config.is_empty() {
        out.push_str(
            "\nThis repository has tool configuration files. A headless run loads them without asking, so they are\n\
             covered too, whichever workflow runs:\n",
        );
        let mut files: Vec<&ConfigFile> = input.config.iter().collect();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        for file in files {
            let note = match &file.content {
                ConfigContent::Bytes(_) => String::new(),
                ConfigContent::Unreadable(reason) => format!(" (could not be read: {reason})"),
            };
            out.push_str(&format!("  {}{}\n", plain(&file.path), note));
        }
    }
    out
}

/// The distinct agent ids of the stages, in the order they first appear.
fn agent_ids(workflow: &Workflow) -> Vec<&str> {
    let mut seen: Vec<&str> = Vec::new();
    for stage in &workflow.stages {
        if !seen.contains(&stage.agent.as_str()) {
            seen.push(&stage.agent);
        }
    }
    seen
}

/// The argv of each `run` check, as one line. The first release has no `run` check kind, so there are none; slice 3a
/// adds them, and the summary then shows each, with a note when its program is a path into the repo.
fn run_check_commands(_workflow: &Workflow) -> Vec<String> {
    Vec::new()
}

fn definition_line(definition: &AgentDefinition) -> String {
    let who = format!(
        "{} ({})",
        definition.runner.as_str(),
        definition.placement.as_str()
    );
    let first = format!("    {who}: ");
    let rest_indent = "      ";
    let mut out = match (&definition.tools, definition.runner) {
        (AgentTools::Listed(tools), Runner::KiroCli) if tools.is_empty() => {
            format!("{first}its allowedTools list is empty, so that list pre-approves no tool\n")
        }
        (AgentTools::Listed(tools), Runner::KiroCli) => {
            wrap(&format!("{first}runs without asking:"), rest_indent, tools)
        }
        (AgentTools::Listed(tools), Runner::Claude) if tools.is_empty() => {
            format!("{first}its tools list is empty, so it has no tools\n")
        }
        (AgentTools::Listed(tools), Runner::Claude) => wrap(
            &format!("{first}each tool in its tools list runs without asking:"),
            rest_indent,
            tools,
        ),
        (AgentTools::EveryToolNonePreApproved, _) => {
            format!("{first}every tool is available, and the file's tools key pre-approves none\n")
        }
        (AgentTools::Unknown(why), _) => format!("{first}{}\n", plain(why)),
    };
    if !definition.also_sets.is_empty() {
        // These are fixed key names, not text from the repo.
        out.push_str(&wrap(
            &format!("{rest_indent}also sets:"),
            rest_indent,
            &definition.also_sets,
        ));
        out.push_str(&format!(
            "{rest_indent}This build does not read these keys, and they can change what runs.\n"
        ));
    }
    out
}

/// `head`, then the items joined by commas, on lines of at most [`WIDTH`] columns. The items are shown as the
/// definition spells them, with control characters replaced.
fn wrap(head: &str, indent: &str, items: &[String]) -> String {
    let mut out = String::new();
    let mut line = head.to_string();
    for (n, item) in items.iter().enumerate() {
        let word = format!(
            "{}{}",
            plain(item),
            if n + 1 == items.len() { "" } else { "," }
        );
        if line.chars().count() + 1 + word.chars().count() > WIDTH && line.trim() != head.trim() {
            out.push_str(&line);
            out.push('\n');
            line = indent.to_string();
            line.push_str(&word);
        } else {
            if !line.ends_with(' ') {
                line.push(' ');
            }
            line.push_str(&word);
        }
    }
    out.push_str(&line);
    out.push('\n');
    out
}

/// The longest text of one name, path or tool that the summary shows whole.
const MAX_SHOWN_CHARS: usize = 120;

/// `text` made safe to print: control characters and the characters that reorder text become `?`, and a long text is
/// cut with `...`.
pub fn plain(text: &str) -> String {
    let mut out: String = text
        .chars()
        .take(MAX_SHOWN_CHARS)
        .map(|c| if is_unsafe_to_print(c) { '?' } else { c })
        .collect();
    if text.chars().count() > MAX_SHOWN_CHARS {
        out.push_str("...");
    }
    out
}

/// Control characters, the characters that reorder text, and the ones that print as nothing, so that a name cannot
/// hide part of itself or change how its neighbours read.
fn is_unsafe_to_print(c: char) -> bool {
    c.is_control()
        || matches!(c,
            '\u{061c}'
            | '\u{200b}'..='\u{200f}'
            | '\u{2028}'..='\u{202e}'
            | '\u{2060}'
            | '\u{2066}'..='\u{2069}'
            | '\u{feff}'
            | '\u{e0000}'..='\u{e007f}')
}
