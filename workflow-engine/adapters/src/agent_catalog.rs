// SPDX-License-Identifier: Apache-2.0
//! Finds an agent definition the way the harness will (spec: "Finding the agent"): in the project root, then in the
//! home folder, and reads the tools the runner lets it run without asking.
//!
//! - Kiro CLI: `.kiro/agents/<id>.json`, and the tools in its `allowedTools` list.
//! - Claude Code: `.claude/agents/<id>.md`, and the tools in the `tools` key of its front matter, as written there. A
//!   definition with no `tools` key makes every tool available and pre-approves none.
//!
//! The order on Kiro is assumed until step 1f records it. An install made with another `--target` is seen only when
//! that folder is the project root or the home folder.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use workflow_core::json::{self, Json};
use workflow_core::ports::{AgentCatalog, AgentDefinition, AgentTools, Placement, Runner};
use workflow_core::rules::is_name;

/// A definition over this many bytes is not read.
const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone)]
pub struct FileAgentCatalog {
    /// The folders of the repo, nearest first. Claude Code finds `.claude/agents` in each folder from the working
    /// directory up to the git root, and the nearest definition wins.
    project: Vec<PathBuf>,
    home: Option<PathBuf>,
}

impl FileAgentCatalog {
    pub fn new(project_root: &Path, home: Option<&Path>) -> FileAgentCatalog {
        FileAgentCatalog {
            project: vec![project_root.to_path_buf()],
            home: home.map(Path::to_path_buf),
        }
    }

    /// Also searches `folders`, the folders above the project root, after it and before the home folder.
    pub fn with_folders_above(mut self, folders: &[PathBuf]) -> FileAgentCatalog {
        for folder in folders {
            if !self.project.contains(folder) {
                self.project.push(folder.clone());
            }
        }
        self
    }

    fn find(&self, runner: Runner, agent: &str) -> Option<AgentDefinition> {
        let (folder, file) = match runner {
            Runner::KiroCli => (".kiro/agents", format!("{agent}.json")),
            Runner::Claude => (".claude/agents", format!("{agent}.md")),
        };
        let mut places: Vec<(Placement, &PathBuf)> = self
            .project
            .iter()
            .map(|p| (Placement::Project, p))
            .collect();
        if let Some(home) = &self.home {
            places.push((Placement::Home, home));
        }
        for (placement, base) in places {
            let path = base.join(folder).join(&file);
            let Some(text) = read_definition(&path) else {
                continue;
            };
            let (tools, also_sets) = match text {
                Ok(text) => match runner {
                    Runner::KiroCli => (kiro_tools(&text), kiro_also_sets(&text)),
                    Runner::Claude => (claude_tools(&text), claude_also_sets(&text)),
                },
                Err(why) => (AgentTools::Unknown(why), Vec::new()),
            };
            return Some(AgentDefinition {
                runner,
                placement,
                tools,
                also_sets,
            });
        }
        None
    }
}

impl AgentCatalog for FileAgentCatalog {
    fn definitions(&self, agent: &str) -> Vec<AgentDefinition> {
        if !is_name(agent) {
            return Vec::new();
        }
        [Runner::KiroCli, Runner::Claude]
            .into_iter()
            .filter_map(|runner| self.find(runner, agent))
            .collect()
    }
}

/// `None` if nothing is there, `Some(Err)` if something is there that cannot be used.
fn read_definition(path: &Path) -> Option<Result<String, String>> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return Some(Err("the agent definition is not a regular file".into()));
    }
    if meta.len() > MAX_BYTES {
        return Some(Err("the agent definition is over 1 MiB".into()));
    }
    let mut bytes = Vec::new();
    let read = fs::File::open(path).and_then(|f| f.take(MAX_BYTES + 1).read_to_end(&mut bytes));
    Some(match read {
        Err(_) => Err("the agent definition could not be read".into()),
        Ok(_) => String::from_utf8(bytes)
            .map_err(|_| "the agent definition is not UTF-8 text".to_string()),
    })
}

/// Keys of a Kiro agent file, besides `allowedTools`, that can change what runs: rules that allow, hooks, MCP servers,
/// and per-tool settings. Their values are not read.
const KIRO_KEYS: &[&str] = &[
    "permissions",
    "hooks",
    "mcpServers",
    "includeMcpJson",
    "toolsSettings",
];

/// Keys of a Claude agent file's front matter, besides `tools`, that can change what runs: how permission prompts are
/// handled, hooks, and MCP servers the agent starts. Their values are not read.
const CLAUDE_KEYS: &[&str] = &["permissionMode", "hooks", "mcpServers"];

fn kiro_also_sets(text: &str) -> Vec<String> {
    let Ok(value) = json::parse(text) else {
        return Vec::new();
    };
    KIRO_KEYS
        .iter()
        .filter(|key| value.get(key).is_some())
        .map(|key| (*key).to_string())
        .collect()
}

fn claude_also_sets(text: &str) -> Vec<String> {
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return Vec::new();
    }
    let front: Vec<&str> = lines.take_while(|l| l.trim_end() != "---").collect();
    CLAUDE_KEYS
        .iter()
        .filter(|key| {
            front.iter().any(|l| {
                l.strip_prefix(**key)
                    .is_some_and(|rest| rest.trim_start().starts_with(':'))
            })
        })
        .map(|key| (*key).to_string())
        .collect()
}

fn kiro_tools(text: &str) -> AgentTools {
    let Ok(value) = json::parse(text) else {
        return AgentTools::Unknown("the agent file is not valid JSON".into());
    };
    let list = value.get("allowedTools").and_then(Json::as_array);
    let names: Option<Vec<String>> = list.and_then(|items| {
        items
            .iter()
            .map(|item| item.as_str().map(str::to_string))
            .collect()
    });
    match names {
        Some(names) => AgentTools::Listed(names),
        None => AgentTools::Unknown(
            "the agent file has no `allowedTools` list, so this build cannot say what the runner lets it run \
             without asking"
                .into(),
        ),
    }
}

fn claude_tools(text: &str) -> AgentTools {
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return AgentTools::Unknown("the agent file has no front matter".into());
    }
    let front: Vec<&str> = lines.take_while(|l| l.trim_end() != "---").collect();
    let keys: Vec<usize> = front
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with("tools:"))
        .map(|(n, _)| n)
        .collect();
    match keys.as_slice() {
        [] => AgentTools::EveryToolNonePreApproved,
        [at] => parse_tools_value(&front[*at]["tools:".len()..], &front[at + 1..]),
        _ => AgentTools::Unknown("the agent file has more than one `tools` key".into()),
    }
}

fn parse_tools_value(inline: &str, following: &[&str]) -> AgentTools {
    let unreadable =
        || AgentTools::Unknown("its `tools` key is in a form this build cannot read".into());
    let value = strip_comment(inline).trim();
    if value.is_empty() {
        let items: Vec<String> = following
            .iter()
            .map_while(|l| {
                let trimmed = l.trim_start();
                let item = trimmed.strip_prefix('-')?;
                (l.starts_with(' ') || l.starts_with('\t'))
                    .then(|| unquote(strip_comment(item).trim()))
            })
            .collect();
        return if items.is_empty() {
            unreadable()
        } else {
            AgentTools::Listed(items)
        };
    }
    if value.starts_with(['|', '>', '&', '*', '!', '{']) {
        return unreadable();
    }
    let body = match value.strip_prefix('[') {
        Some(rest) => match rest.strip_suffix(']') {
            Some(inner) => inner,
            None => return unreadable(),
        },
        None => value,
    };
    let body = unquote_whole(body);
    AgentTools::Listed(
        body.split(',')
            .map(|item| unquote(item.trim()))
            .filter(|item| !item.is_empty())
            .collect(),
    )
}

/// The text before a ` #` comment.
fn strip_comment(text: &str) -> &str {
    match text.find(" #") {
        Some(at) => &text[..at],
        None => text,
    }
}

fn unquote(item: &str) -> String {
    for quote in ['"', '\''] {
        if let Some(inner) = item.strip_prefix(quote).and_then(|r| r.strip_suffix(quote)) {
            return inner.to_string();
        }
    }
    item.to_string()
}

/// `"Read, Write"` as a whole string is the same list as `Read, Write`.
fn unquote_whole(body: &str) -> String {
    let trimmed = body.trim();
    for quote in ['"', '\''] {
        if let Some(inner) = trimmed
            .strip_prefix(quote)
            .and_then(|r| r.strip_suffix(quote))
        {
            if !inner.contains(quote) {
                return inner.to_string();
            }
        }
    }
    trimmed.to_string()
}
