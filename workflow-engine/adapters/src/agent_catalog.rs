// SPDX-License-Identifier: Apache-2.0
//! Finds an agent definition the way the harness will (spec: "Finding the agent"): in the project root, then in the
//! home folder, and reads the tools the runner lets it run without asking.
//!
//! - Kiro CLI: `.kiro/agents/<id>.json`, and the tools in its `allowedTools` list.
//! - Claude Code: the file under `.claude/agents/` (and its subfolders) whose front matter has `name: <id>`, and the
//!   tools in the `tools` key of its front matter, as written there. A definition with no `tools` key makes every tool
//!   available and pre-approves none.
//!
//! The order on Kiro is assumed until step 1f-1 records it. An install made with another `--target` is seen only when
//! that folder is the project root or the home folder.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use workflow_core::json::{self, Json};
use workflow_core::ports::{AgentCatalog, AgentDefinition, AgentTools, Placement, Runner};
use workflow_core::rules::is_name;

use crate::repo_config::{MAX_DEPTH, MAX_ENTRIES};

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

    /// The folders searched, nearest first, each with where it counts and how its files are shown.
    fn places(&self) -> Vec<Place<'_>> {
        let mut places: Vec<Place> = self
            .project
            .iter()
            .enumerate()
            .map(|(n, base)| Place {
                placement: Placement::Project,
                base,
                label: if n == 0 {
                    String::new()
                } else {
                    format!("{}/", base.display())
                },
            })
            .collect();
        if let Some(home) = &self.home {
            places.push(Place {
                placement: Placement::Home,
                base: home,
                label: "~/".into(),
            });
        }
        places
    }

    fn find_kiro(&self, agent: &str) -> Option<AgentDefinition> {
        let file = format!("{agent}.json");
        for place in self.places() {
            let path = place.base.join(".kiro/agents").join(&file);
            let Some(text) = read_definition(&path) else {
                continue;
            };
            let (tools, also_sets) = match text {
                Ok(text) => (kiro_tools(&text), kiro_also_sets(&text)),
                Err(why) => (AgentTools::Unknown(why), Vec::new()),
            };
            return Some(AgentDefinition {
                runner: Runner::KiroCli,
                placement: place.placement,
                tools,
                also_sets,
                file: format!("{}.kiro/agents/{file}", place.label),
                ambiguous: false,
            });
        }
        None
    }

    /// The nearest folder with a file that declares `agent` gives the definition, as Claude Code does. Within that
    /// folder, two such files, or one whose file stem is not the id, leave the agent unknown and ambiguous.
    fn find_claude(&self, agent: &str) -> Option<AgentDefinition> {
        for place in self.places() {
            let candidates = claude_candidates(&place.base.join(".claude/agents"), agent);
            let shown = |c: &Candidate| format!("{}.claude/agents/{}", place.label, c.relative);
            let definition = |tools, also_sets, file: String, ambiguous| AgentDefinition {
                runner: Runner::Claude,
                placement: place.placement,
                tools,
                also_sets,
                file,
                ambiguous,
            };
            match candidates.as_slice() {
                [] => continue,
                [one] if one.stem == agent || matches!(one.kind, Kind::Unreadable(_)) => {
                    let (tools, also_sets) = match &one.kind {
                        Kind::Declares(text) => (claude_tools(text), claude_also_sets(text)),
                        Kind::Unreadable(why) => (AgentTools::Unknown(why.clone()), Vec::new()),
                    };
                    return Some(definition(tools, also_sets, shown(one), false));
                }
                [one] => {
                    let why = format!(
                        "the file {} declares the agent `{agent}`, but its file name is not `{agent}.md`, so this \
                         build cannot say which file the harness will use",
                        one.relative
                    );
                    return Some(definition(
                        AgentTools::Unknown(why),
                        Vec::new(),
                        shown(one),
                        true,
                    ));
                }
                many => {
                    let names: Vec<&str> = many.iter().map(|c| c.relative.as_str()).collect();
                    let why = format!(
                        "more than one file declares the agent `{agent}` ({}), so this build cannot say which one \
                         the harness will use",
                        names.join(", ")
                    );
                    return Some(definition(
                        AgentTools::Unknown(why),
                        Vec::new(),
                        shown(&many[0]),
                        true,
                    ));
                }
            }
        }
        None
    }
}

/// One folder that is searched for agent files.
struct Place<'a> {
    placement: Placement,
    base: &'a PathBuf,
    /// What a path below the folder is shown after: nothing for the project root, `~/` for the home folder.
    label: String,
}

enum Kind {
    /// A readable file whose front matter has `name: <id>`. Holds the file's text.
    Declares(String),
    /// A file that may declare the id but that this build cannot read in full. Holds why.
    Unreadable(String),
}

/// A file under `.claude/agents/` that declares the id asked for, or may.
struct Candidate {
    /// The path below `.claude/agents/`, with `/` between the parts.
    relative: String,
    stem: String,
    kind: Kind,
}

/// The `.md` files below `folder` (and its subfolders, as deep as the config scan goes) whose front matter has the
/// exact `name` asked for. A file with no front matter, or with another name, is not an agent of this id, whatever its
/// file name or the rest of its text says. A file whose `name` key this build cannot read in full counts when that key
/// mentions the id, because it might declare it. A file that cannot be read at all counts when its file stem is the
/// id, as the name inside cannot be seen. A link to a file counts as that file, as it does in the config scan. A link
/// to a folder or a link that leads nowhere is not listed here, and the scan refuses the run for it.
fn claude_candidates(folder: &Path, agent: &str) -> Vec<Candidate> {
    let mut files = Vec::new();
    list_markdown(folder, "", 0, &mut files);
    files.sort();
    let mut found = Vec::new();
    for relative in files {
        let stem = relative
            .rsplit('/')
            .next()
            .and_then(|name| name.strip_suffix(".md"))
            .unwrap_or_default()
            .to_string();
        let kind = match read_definition(&folder.join(&relative)) {
            None => continue,
            Some(Err(why)) if stem == agent => Kind::Unreadable(why),
            Some(Err(_)) => continue,
            Some(Ok(text)) => match declared_name(&text, agent) {
                Declared::Name(name) if name == agent => Kind::Declares(text),
                Declared::Name(_) | Declared::NoName | Declared::NoFrontMatter => continue,
                Declared::Unreadable(why) => Kind::Unreadable(why),
            },
        };
        found.push(Candidate {
            relative,
            stem,
            kind,
        });
    }
    found
}

fn list_markdown(folder: &Path, prefix: &str, depth: usize, out: &mut Vec<String>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten().take(MAX_ENTRIES) {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let relative = format!("{prefix}{name}");
        if kind.is_dir() {
            list_markdown(&entry.path(), &format!("{relative}/"), depth + 1, out);
            continue;
        }
        // A link to a regular file is that file: the harness loads it, and the config scan hashes its target. A link
        // to a folder is not followed, and a dangling link has no target to follow.
        let is_file = if kind.is_symlink() {
            fs::metadata(entry.path()).is_ok_and(|target| target.is_file())
        } else {
            kind.is_file()
        };
        if is_file && name.ends_with(".md") {
            out.push(relative);
        }
    }
}

enum Declared {
    NoFrontMatter,
    NoName,
    Name(String),
    /// The front matter or its `name` key cannot be read in full, and a `name` key may declare the id asked for.
    Unreadable(String),
}

/// The `name` of a Claude agent file, compared exactly: the value is not trimmed beyond the plain-scalar rule, and its
/// case is kept. Only a plain `name:` line of the front matter counts, not a comment, another key's value or the body.
/// When the front matter has a line this build cannot read, or the `name` key is in a form it cannot read, the answer
/// is `Unreadable` only if the `name` key itself mentions `agent`, and `NoName` otherwise.
fn declared_name(text: &str, agent: &str) -> Declared {
    let front = match front_matter(text) {
        Ok(front) => front,
        Err(_) => return Declared::NoFrontMatter,
    };
    let unreadable_if_mentioned = |why: String| {
        if name_keys_mention(&front, agent) {
            Declared::Unreadable(why)
        } else {
            Declared::NoName
        }
    };
    let keys = match top_level_keys(&front) {
        Ok(keys) => keys,
        Err(why) => return unreadable_if_mentioned(why),
    };
    let names: Vec<usize> = keys
        .iter()
        .filter(|(_, key)| *key == "name")
        .map(|(n, _)| *n)
        .collect();
    let at = match names.as_slice() {
        [] => return Declared::NoName,
        [at] => *at,
        _ => return unreadable_if_mentioned("the agent file has more than one `name` key".into()),
    };
    let value = strip_comment(&front[at]["name:".len()..]).trim();
    if value.is_empty() || value.starts_with(['|', '>', '&', '*', '!', '{', '[']) {
        return unreadable_if_mentioned(
            "its `name` key is in a form this build cannot read".into(),
        );
    }
    Declared::Name(unquote(value))
}

/// Whether the text of a `name` key, its line and the indented lines under it, contains `agent`. Used for a file this
/// build cannot read in full, where only the `name` key may make it a candidate.
fn name_keys_mention(front: &[&str], agent: &str) -> bool {
    let mut in_name = false;
    for line in front {
        let indented = line.starts_with([' ', '\t']);
        if !indented {
            let rest = line.strip_prefix("name:");
            in_name = rest.is_some_and(|r| r.is_empty() || r.starts_with([' ', '\t']));
        }
        if in_name && line.contains(agent) && !line.trim_start().starts_with('#') {
            return true;
        }
    }
    false
}

impl AgentCatalog for FileAgentCatalog {
    fn definitions(&self, agent: &str) -> Vec<AgentDefinition> {
        if !is_name(agent) {
            return Vec::new();
        }
        [self.find_kiro(agent), self.find_claude(agent)]
            .into_iter()
            .flatten()
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

/// What the front matter of a markdown file sets, for the install exemption of the config scan.
pub(crate) enum FrontMatterKeys {
    /// The text has no front matter, so it sets nothing.
    Absent,
    /// The top-level keys of the front matter.
    Keys(Vec<String>),
    /// There is front matter, but this build cannot read it in full.
    Unreadable,
}

/// The top-level keys of the front matter of `text`. Text that does not start with a `---` line, ignoring a byte order
/// mark and leading blank space, has none. Text that seems to start one but is not in the exact form the reader takes
/// is `Unreadable`, so a caller that must fail closed can tell it from none.
pub(crate) fn front_matter_keys(text: &str) -> FrontMatterKeys {
    let Ok(front) = front_matter(text) else {
        let loose = text.trim_start_matches('\u{feff}').trim_start();
        return if loose.starts_with("---") {
            FrontMatterKeys::Unreadable
        } else {
            FrontMatterKeys::Absent
        };
    };
    match top_level_keys(&front) {
        Ok(keys) => FrontMatterKeys::Keys(keys.into_iter().map(|(_, k)| k.to_string()).collect()),
        Err(_) => FrontMatterKeys::Unreadable,
    }
}

/// The keys whose block list may have its `- item` lines in column 0, as YAML allows and Claude Code installs write:
/// the tool list, the skill list and the MCP server list. A column-0 item cannot set a key, but the other keys keep the
/// strict rule so that a stray list item is not read as part of one.
const COLUMN_0_LIST_KEYS: &[&str] = &["tools", "skills", "mcpServers"];

/// The top-level keys of the front matter, as `(line number, key)` in order.
///
/// This is not a YAML parser. It reads a key only when the line is a plain `key:` (letters, digits, `_` and `-`, then a
/// colon at the end of the line or before a space). A line in column 0 that is anything else, such as a quoted key, a
/// key with a space before its colon, a list item or a flow mapping, might set a key this build would miss, so the
/// whole file is unreadable. The one exception is a `- item` line in column 0 in the list of a `tools:`, `skills:` or
/// `mcpServers:` key that has no value on its own line. It must come before any indented line of that list, and the
/// first other column-0 line is the next key. The items of `mcpServers:` are mappings, so once its list has begun, the
/// indented lines under an item belong to that item. Indented lines belong to the value above them, and blank and
/// comment lines are skipped.
fn top_level_keys<'a>(front: &[&'a str]) -> Result<Vec<(usize, &'a str)>, String> {
    let mut keys = Vec::new();
    // Whether a column-0 `- item` may follow: set after one of `COLUMN_0_LIST_KEYS` with no inline value, and cleared
    // by any other key and by an indented line before the first item.
    let mut column_0_list = false;
    // Whether the list has had an item, and whether its items hold indented lines of their own (`mcpServers`).
    let mut seen_item = false;
    let mut items_hold_lines = false;
    for (n, line) in front.iter().enumerate() {
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with([' ', '\t']) {
            if !(items_hold_lines && seen_item) {
                column_0_list = false;
            }
            continue;
        }
        if column_0_list && is_list_item(line) {
            seen_item = true;
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
        column_0_list = COLUMN_0_LIST_KEYS.contains(&key) && strip_comment(rest).trim().is_empty();
        items_hold_lines = key == "mcpServers";
        seen_item = false;
        keys.push((n, key));
    }
    Ok(keys)
}

/// A `-` that starts a block list item: alone on the line or followed by a space or tab.
fn is_list_item(line: &str) -> bool {
    line.trim_end()
        .strip_prefix('-')
        .is_some_and(|item| item.is_empty() || item.starts_with([' ', '\t']))
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
        let mut items = Vec::new();
        // Whether the items are in column 0, set by the first line of the list. The two forms are not mixed.
        let mut column_0: Option<bool> = None;
        for line in following {
            let trimmed = line.trim();
            // Blank and comment lines can sit inside a list.
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if line.starts_with([' ', '\t']) {
                if column_0 == Some(true) {
                    return unreadable();
                }
                column_0 = Some(false);
            } else {
                // A column-0 line ends an indented list. It is an item of a column-0 list, and the list ends at the
                // first column-0 line that is not an item, the next key.
                if !is_list_item(line) || column_0 == Some(false) {
                    break;
                }
                column_0 = Some(true);
            }
            // Anything else indented under `tools:` that is not an item is text this build does not read, and the
            // items before it must not be shown as the whole list.
            match trimmed.strip_prefix('-') {
                Some(item) if item.is_empty() || item.starts_with([' ', '\t']) => {
                    items.push(unquote(strip_comment(item).trim()));
                }
                _ => return unreadable(),
            }
        }
        return checked_items(items);
    }
    if value.starts_with(['|', '>', '&', '*', '!', '{']) {
        return unreadable();
    }
    let (body, in_brackets) = match value.strip_prefix('[') {
        Some(rest) => match rest.strip_suffix(']') {
            Some(inner) => (inner, true),
            None => return unreadable(),
        },
        None => (value, false),
    };
    let body = unquote_whole(body);
    let Some(parts) = split_outside_parentheses(&body, in_brackets) else {
        return AgentTools::Unknown(
            "its `tools` list has a parenthesis that is not closed, or a comma inside parentheses in a `[...]` list"
                .into(),
        );
    };
    if in_brackets && parts.iter().any(|p| p.starts_with(['"', '\''])) {
        return AgentTools::Unknown(
            "its `tools` list has a quoted item in a `[...]` list, which this build does not read"
                .into(),
        );
    }
    checked_items(
        parts
            .iter()
            .map(|item| unquote(item))
            .filter(|item| !item.is_empty())
            .collect(),
    )
}

/// The items of a `tools` list as written, or `Unknown` when one is outside `[A-Za-z0-9_*:.-]+` and is not the
/// `Agent(a, b)` form. A scoped rule such as `Bash(git status)` is outside it, so it makes the whole list unknown
/// instead of a short list.
fn checked_items(items: Vec<String>) -> AgentTools {
    match items.iter().find(|item| !is_tool_item(item)) {
        Some(bad) => AgentTools::Unknown(format!(
            "its `tools` list has the item `{}`, which is outside [A-Za-z0-9_*:.-]+ and is not the Agent(...) form",
            workflow_core::trust::plain(bad)
        )),
        None => AgentTools::Listed(items),
    }
}

fn is_tool_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '*' | ':' | '.' | '-'))
}

fn is_tool_item(item: &str) -> bool {
    match item
        .strip_prefix("Agent(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        Some(inside) => inside.split(',').all(|name| is_tool_name(name.trim())),
        None => is_tool_name(item),
    }
}

/// Splits on commas that are outside parentheses, trimming each part. `None` for a parenthesis that is not closed or
/// is stray, and, when `no_comma_inside` is set, for a comma inside parentheses.
fn split_outside_parentheses(body: &str, no_comma_inside: bool) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0usize;
    for c in body.chars() {
        match c {
            '(' => {
                depth += 1;
                current.push(c);
            }
            ')' => {
                depth = depth.checked_sub(1)?;
                current.push(c);
            }
            ',' if depth == 0 => parts.push(std::mem::take(&mut current).trim().to_string()),
            ',' if no_comma_inside => return None,
            _ => current.push(c),
        }
    }
    if depth != 0 {
        return None;
    }
    parts.push(current.trim().to_string());
    Some(parts)
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
