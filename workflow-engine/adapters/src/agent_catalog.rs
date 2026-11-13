// SPDX-License-Identifier: Apache-2.0
//! Finds an agent definition the way the harness will (spec: "Finding the agent"): in the project root, then in the
//! home folder, and reads the tools the runner lets it run without asking.
//!
//! - Kiro CLI: `.kiro/agents/<id>.json`, and the tools in its `allowedTools` list.
//! - Claude Code: `.claude/agents/<id>.md`, and the tools in the `tools` key of its front matter, as written there. A
//!   definition with no `tools` key makes every tool available and pre-approves none.
//!
//! Kiro CLI looks for `.kiro/agents/<id>.json` in its working directory and then in the home folder, and nowhere else:
//! it does not search the folders above its working directory, and a file in the working directory wins over one with
//! the same id in the home folder (checked on Kiro CLI V2 and V3, step 1f-1). An install made with another `--target`
//! is seen only when that folder is the project root or the home folder.
//!
//! A Kiro agent file has one of two shapes, and the shape says which engine reads it: V2 has an `allowedTools` list,
//! and V3 has `permissions.rules`. The tools a V3 file lets run without asking are its `allow` rules, each named by its
//! capability (`fs_write`), or with its scope when it has one (`mcp (aws-mcp/aws___search_documentation)`).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use workflow_core::json::{self, Json};
use workflow_core::ports::{AgentCatalog, AgentDefinition, AgentTools, Placement, Runner};
use workflow_core::rules::is_name;

/// A definition over this many bytes is not read.
const MAX_BYTES: u64 = 1024 * 1024;

/// The Kiro CLI engine that reads an agent file (D16). Which one is decided by the shape of the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KiroEngine {
    V2,
    V3,
}

impl KiroEngine {
    /// The flag that makes `kiro-cli chat` use this engine.
    pub fn flag(self) -> &'static str {
        match self {
            KiroEngine::V2 => "--v2",
            KiroEngine::V3 => "--v3",
        }
    }
}

/// A Kiro agent as the harness will find it: the definition, and the engine its file shape says. `engine` is an error
/// when the file has neither shape, both, or cannot be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KiroAgent {
    pub definition: AgentDefinition,
    pub engine: Result<KiroEngine, String>,
}

/// The engine of a Kiro agent file, from its shape: V2 has `allowedTools` and V3 has `permissions.rules`.
pub fn kiro_engine(text: &str) -> Result<KiroEngine, String> {
    let value = json::parse(text).map_err(|_| "the agent file is not valid JSON".to_string())?;
    let v2 = value.get("allowedTools").is_some();
    let v3 = value
        .get("permissions")
        .and_then(|p| p.get("rules"))
        .is_some();
    match (v2, v3) {
        (true, false) => Ok(KiroEngine::V2),
        (false, true) => Ok(KiroEngine::V3),
        (true, true) => Err("the agent file has both `allowedTools` (V2) and `permissions.rules` (V3), so it is not \
                             clear which engine reads it"
            .to_string()),
        (false, false) => Err("the agent file has neither `allowedTools` (V2) nor `permissions.rules` (V3), so it is \
                              not clear which engine reads it"
            .to_string()),
    }
}

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

    /// The Kiro agent that `agent` names, with the engine its file shape says. `None` if no file is there.
    pub fn kiro_agent(&self, agent: &str) -> Option<KiroAgent> {
        if !is_name(agent) {
            return None;
        }
        let (definition, text) = self.find_with_text(Runner::KiroCli, agent)?;
        let engine = match text {
            Ok(text) => kiro_engine(&text),
            Err(why) => Err(why),
        };
        Some(KiroAgent { definition, engine })
    }

    fn find(&self, runner: Runner, agent: &str) -> Option<AgentDefinition> {
        self.find_with_text(runner, agent).map(|(found, _)| found)
    }

    fn find_with_text(
        &self,
        runner: Runner,
        agent: &str,
    ) -> Option<(AgentDefinition, Result<String, String>)> {
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
            let (tools, also_sets) = match &text {
                Ok(text) => match runner {
                    Runner::KiroCli => (kiro_tools(text), kiro_also_sets(text)),
                    Runner::Claude => (claude_tools(text), claude_also_sets(text)),
                },
                Err(why) => (AgentTools::Unknown(why.clone()), Vec::new()),
            };
            let definition = AgentDefinition {
                runner,
                placement,
                tools,
                also_sets,
            };
            return Some((definition, text));
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
    let Ok(front) = front_matter(text) else {
        return Vec::new();
    };
    let Ok(keys) = top_level_keys(&front) else {
        return Vec::new();
    };
    CLAUDE_KEYS
        .iter()
        .filter(|key| keys.iter().any(|(_, name)| name == *key))
        .map(|key| (*key).to_string())
        .collect()
}

/// The lines between the two `---` lines that open a Claude agent file, or why there are none.
fn front_matter(text: &str) -> Result<Vec<&str>, String> {
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return Err("the agent file has no front matter".into());
    }
    Ok(lines.take_while(|l| l.trim_end() != "---").collect())
}

/// The top-level keys of the front matter, as `(line number, key)` in order.
///
/// This is not a YAML parser. It reads a key only when the line is a plain `key:` (letters, digits, `_` and `-`, then a
/// colon at the end of the line or before a space). A line in column 0 that is anything else, such as a quoted key, a
/// key with a space before its colon, a list item or a flow mapping, might set a key this build would miss, so the
/// whole file is unreadable. Indented lines belong to the value above them, and blank and comment lines are skipped.
fn top_level_keys<'a>(front: &[&'a str]) -> Result<Vec<(usize, &'a str)>, String> {
    let mut keys = Vec::new();
    for (n, line) in front.iter().enumerate() {
        if line.trim().is_empty() || line.starts_with([' ', '\t', '#']) {
            continue;
        }
        let Some((key, rest)) = line.split_once(':') else {
            return Err(unreadable_front_matter());
        };
        let plain_key = !key.is_empty()
            && key
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if !plain_key || !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
            return Err(unreadable_front_matter());
        }
        keys.push((n, key));
    }
    Ok(keys)
}

fn unreadable_front_matter() -> String {
    "the agent file has a front matter line in a form this build cannot read, so it cannot say what the runner lets \
     it run without asking"
        .into()
}

fn kiro_tools(text: &str) -> AgentTools {
    let Ok(value) = json::parse(text) else {
        return AgentTools::Unknown("the agent file is not valid JSON".into());
    };
    if value.get("allowedTools").is_none() {
        if let Some(rules) = value
            .get("permissions")
            .and_then(|p| p.get("rules"))
            .and_then(Json::as_array)
        {
            return v3_allow_list(rules);
        }
    }
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

/// The tools a V3 agent file lets run without asking: its `allow` rules, in order. A rule with no scope is its
/// capability. A rule with a `match` or `exclude` scope is named with the scope, so that nothing reads it as the whole
/// capability. A capability that the file also has a rule against (`deny` or any other effect) is named as partly
/// restricted, so it never reads as the whole capability either, and the runner gives it no id.
fn v3_allow_list(rules: &[Json]) -> AgentTools {
    let unreadable = || {
        AgentTools::Unknown(
            "the agent file has a permission rule in a form this build cannot read, so it cannot say what the runner \
             lets it run without asking"
                .into(),
        )
    };
    let mut names: Vec<String> = Vec::new();
    let mut restricted: Vec<&str> = Vec::new();
    for rule in rules {
        let (Some(capability), Some(effect)) = (
            rule.get("capability").and_then(Json::as_str),
            rule.get("effect").and_then(Json::as_str),
        ) else {
            return unreadable();
        };
        if effect != "allow" {
            restricted.push(capability);
        }
    }
    for rule in rules {
        let Some(capability) = rule.get("capability").and_then(Json::as_str) else {
            return unreadable();
        };
        if rule.get("effect").and_then(Json::as_str) != Some("allow") {
            continue;
        }
        let scope = |key: &str| -> Option<Vec<String>> {
            match rule.get(key) {
                None => Some(Vec::new()),
                Some(list) => list
                    .as_array()?
                    .iter()
                    .map(|item| item.as_str().map(str::to_string))
                    .collect(),
            }
        };
        let (Some(matches), Some(excludes)) = (scope("match"), scope("exclude")) else {
            return unreadable();
        };
        let mut name = capability.to_string();
        if !matches.is_empty() || !excludes.is_empty() {
            let mut parts = Vec::new();
            if !matches.is_empty() {
                parts.push(matches.join(", "));
            }
            if !excludes.is_empty() {
                parts.push(format!("except {}", excludes.join(", ")));
            }
            name = format!("{name} ({})", parts.join("; "));
        } else if restricted.contains(&capability) {
            name = format!("{name} (partly denied)");
        }
        if !names.contains(&name) {
            names.push(name);
        }
    }
    AgentTools::Listed(names)
}

fn claude_tools(text: &str) -> AgentTools {
    let front = match front_matter(text) {
        Ok(front) => front,
        Err(why) => return AgentTools::Unknown(why),
    };
    let keys = match top_level_keys(&front) {
        Ok(keys) => keys,
        Err(why) => return AgentTools::Unknown(why),
    };
    let tools: Vec<usize> = keys
        .iter()
        .filter(|(_, key)| *key == "tools")
        .map(|(n, _)| *n)
        .collect();
    match tools.as_slice() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shape_of_the_file_says_the_engine() {
        assert_eq!(kiro_engine(r#"{"allowedTools":[]}"#), Ok(KiroEngine::V2));
        assert_eq!(
            kiro_engine(r#"{"permissions":{"rules":[]}}"#),
            Ok(KiroEngine::V3)
        );
        for text in [
            r#"{"allowedTools":[],"permissions":{"rules":[]}}"#,
            r#"{"tools":["read"]}"#,
            r#"{"permissions":{}}"#,
            "{",
        ] {
            assert!(kiro_engine(text).is_err(), "{text}");
        }
    }

    #[test]
    fn engines_have_their_flags() {
        assert_eq!(KiroEngine::V2.flag(), "--v2");
        assert_eq!(KiroEngine::V3.flag(), "--v3");
    }

    #[test]
    fn a_v3_file_lists_its_allow_rules_and_names_the_scope_of_a_scoped_one() {
        let tools = kiro_tools(
            r#"{"permissions":{"rules":[
              {"capability":"fs_read","effect":"allow"},
              {"capability":"fs_write","effect":"allow"},
              {"capability":"fs_write","effect":"allow"},
              {"capability":"web_fetch","effect":"deny"},
              {"capability":"web_fetch","effect":"allow"},
              {"capability":"shell","match":["ls *","pwd"],"exclude":["rm *"],"effect":"allow"},
              {"capability":"mcp","match":["aws-mcp/x"],"effect":"allow"}]}}"#,
        );
        assert_eq!(
            tools,
            AgentTools::Listed(vec![
                "fs_read".to_string(),
                "fs_write".to_string(),
                "web_fetch (partly denied)".to_string(),
                "shell (ls *, pwd; except rm *)".to_string(),
                "mcp (aws-mcp/x)".to_string(),
            ])
        );
    }

    #[test]
    fn a_v3_rule_that_cannot_be_read_makes_the_list_unknown_and_never_shorter() {
        for text in [
            r#"{"permissions":{"rules":[{"effect":"allow"}]}}"#,
            r#"{"permissions":{"rules":[{"capability":"shell","match":"ls","effect":"allow"}]}}"#,
            r#"{"permissions":{"rules":[{"capability":"shell"}]}}"#,
        ] {
            assert!(matches!(kiro_tools(text), AgentTools::Unknown(_)), "{text}");
        }
    }

    #[test]
    fn a_v2_file_keeps_its_allow_list_even_if_it_also_has_a_permissions_key() {
        assert_eq!(
            kiro_tools(r#"{"allowedTools":["fs_read"],"permissions":{"rules":[]}}"#),
            AgentTools::Listed(vec!["fs_read".to_string()])
        );
    }
}
