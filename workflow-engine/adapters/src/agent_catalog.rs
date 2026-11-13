// SPDX-License-Identifier: Apache-2.0
//! Finds an agent definition the way the harness will (spec: "Finding the agent"): in the project root, then in the
//! home folder, and reads the tools the runner lets it run without asking.
//!
//! - Kiro CLI: the `.json` file under `.kiro/agents/` (in a subfolder too, as Kiro 3 loads) whose JSON `name` (a
//!   string) is the id, whatever the file is called, and the tools in its `allowedTools` list. The file is read as Kiro
//!   does, leniently: deep nesting and a repeated key that is not read are accepted. A file that does not parse, or is
//!   not UTF-8, is never shown as a definition, but when its text mentions the id it is an ambiguous candidate, because
//!   Kiro may load it. A file named `<id>.json` with no `name` is one too, as Kiro then takes the file name for the id.
//!   Kiro 3 also loads a `.md` file at any depth, whose id is the front matter `name`, or the file stem when there is
//!   none. Its tools are not read: the definition has unknown tools.
//! - Claude Code: the file under `.claude/agents/` (and its subfolders) whose front matter has `name: <id>`, and the
//!   tools in the `tools` key of its front matter, as written there. A definition with no `tools` key makes every tool
//!   available and pre-approves none.
//!
//! Kiro CLI identifies an agent by the JSON `name` of a file under `.kiro/agents/` (any file name, any subfolder, and
//! on Kiro 3 a `.md` file too), in its working directory and then in the home folder, and nowhere else: it does not
//! search the folders above its working directory, and an agent in the working directory wins over one with the same id
//! in the home folder (checked on Kiro CLI V2 and V3 in step 1f-1, and again in step 1e). An install made with another
//! `--target` is seen only when that folder is the project root or the home folder.
//!
//! The summary of `flow run` and the harness that starts the session use one lookup and one parse of that file
//! (`find_kiro_with_text`, one `kiro_candidates` walk), so they never read two different files. The engine is read from
//! the text of the one JSON file that declares the agent. A Kiro markdown agent, two files that may be the agent, or a
//! file this build cannot read has no engine, and the session does not start.
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

use crate::repo_config::{MAX_DEPTH, MAX_ENTRIES};

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
    // The same parse as the lookup and the tools use (`parse_kiro`), so a file that the lookup finds is read one way
    // everywhere: deep nesting and a repeated key that is not read are accepted, as Kiro accepts them.
    let value = parse_kiro(text).ok_or_else(|| "the agent file is not valid JSON".to_string())?;
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
        let (definition, text) = self.find_kiro_with_text(agent)?;
        let engine = match text {
            Ok(text) => kiro_engine(&text),
            Err(why) => Err(why),
        };
        Some(KiroAgent { definition, engine })
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

    /// Kiro CLI identifies an agent by the `name` in its JSON, not by the file name. The first folder with a file that
    /// declares `agent` gives the definition. Within it, two such files leave the agent unknown and ambiguous.
    fn find_kiro(&self, agent: &str) -> Option<AgentDefinition> {
        self.find_kiro_with_text(agent).map(|(found, _)| found)
    }

    /// The Kiro definition and, for the engine, the text of the one JSON file that declares the agent. The text is an
    /// error when no single readable JSON file does (a markdown agent, two files, a file this build cannot read), so
    /// the engine is never guessed from a file that may not be the one Kiro loads.
    fn find_kiro_with_text(
        &self,
        agent: &str,
    ) -> Option<(AgentDefinition, Result<String, String>)> {
        for place in self.places() {
            let candidates = kiro_candidates(&place.base.join(".kiro/agents"), agent);
            let shown = |c: &KiroCandidate| format!("{}.kiro/agents/{}", place.label, c.file);
            let definition = |tools, also_sets, file: String, ambiguous| AgentDefinition {
                runner: Runner::KiroCli,
                placement: place.placement,
                tools,
                also_sets,
                file,
                ambiguous,
            };
            match candidates.as_slice() {
                [] => continue,
                [one] => {
                    let (tools, also_sets, text) = match &one.kind {
                        Kind::Declares(text) => (
                            kiro_tools(text),
                            kiro_also_sets(text),
                            engine_text(&one.file, text),
                        ),
                        Kind::Unreadable(why) => (
                            AgentTools::Unknown(why.clone()),
                            Vec::new(),
                            Err(why.clone()),
                        ),
                    };
                    return Some((
                        definition(tools, also_sets, shown(one), one.ambiguous),
                        text,
                    ));
                }
                many => {
                    let names: Vec<&str> = many.iter().map(|c| c.file.as_str()).collect();
                    let why = format!(
                        "more than one file declares the agent `{agent}` ({}), so this build cannot say which one \
                         the harness will use",
                        names.join(", ")
                    );
                    return Some((
                        definition(
                            AgentTools::Unknown(why.clone()),
                            Vec::new(),
                            shown(&many[0]),
                            true,
                        ),
                        Err(why),
                    ));
                }
            }
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
/// file name or the rest of its text says. A file whose front matter this build cannot read in full counts when a part
/// of it that may hold a `name` key mentions the id (see `declared_name`), because it might declare it. A file that cannot be read at all counts when its file stem is the
/// id, as the name inside cannot be seen. A link to a file counts as that file, as it does in the config scan. A link
/// to a folder or a link that leads nowhere is not listed here, and the scan refuses the run for it.
fn claude_candidates(folder: &Path, agent: &str) -> Vec<Candidate> {
    let mut files = Vec::new();
    list_files(folder, "", 0, &[".md"], &mut files);
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
            Some(Ok(bytes)) => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                match declared_name(&text, agent) {
                    Declared::Name(name) if name == agent => Kind::Declares(text),
                    Declared::Name(_) | Declared::NoName | Declared::NoFrontMatter => continue,
                    Declared::Unreadable(why) => Kind::Unreadable(why),
                }
            }
        };
        found.push(Candidate {
            relative,
            stem,
            kind,
        });
    }
    found
}

/// The text of the one JSON file that declares a Kiro agent, as the engine is read from it, or why the engine is unclear.
/// Kiro 2 loads only the top-level `.json` files of `.kiro/agents/`, and the engine is read from the shape of the file,
/// not from where it sits. So a V2-shaped file in a subfolder would get `--v2` and never be loaded: Kiro 2 would run
/// another file with the same id, one that nothing here showed. That leaves the engine unclear, as a markdown agent
/// does. A V3-shaped file in a subfolder is loaded by Kiro 3 and keeps its engine.
fn engine_text(file: &str, text: &str) -> Result<String, String> {
    if file.contains('/') && kiro_engine(text) == Ok(KiroEngine::V2) {
        return Err(format!(
            "the file {file} is a V2-style agent file (`allowedTools`) in a subfolder, which Kiro 2 does not load, so it \
             cannot say which file the session would run. Move it to the top level of `.kiro/agents` or give it V3 \
             `permissions.rules`"
        ));
    }
    Ok(text.to_string())
}

/// A `.json` or `.md` file under `.kiro/agents/` that declares the id asked for, or may.
struct KiroCandidate {
    /// The path below `.kiro/agents/`, with `/` between the parts.
    file: String,
    kind: Kind,
    /// Set when this build cannot say whether the harness loads the file as the agent, so the run must be refused.
    ambiguous: bool,
}

/// The `.json` and `.md` files of `folder` and its subfolders (as deep as the config scan goes, dotfiles included) that
/// declare the agent `agent`, or may. Kiro 2 loads the top-level `.json` files only. Kiro 3 loads `.json` and `.md`
/// files at any depth, and this build cannot tell which one runs, so all of them count.
///
/// - A `.json` file that reads as UTF-8 JSON (see `parse_kiro`) whose `name` is the string `agent` declares it.
/// - A `.json` file whose `name` is another value, is not a string, or whose file name is not `<agent>.json` and has no
///   `name`, is not the agent.
/// - A file named `<agent>.json` that is a JSON object with no `name` is an ambiguous candidate with unknown tools:
///   Kiro 3 takes the file name for the id then.
/// - A `.json` file this build cannot read as JSON, because it is not UTF-8, does not parse or repeats `name` or
///   `allowedTools`, is never shown as a definition. If its text mentions the id, as written or once the JSON escapes
///   are decoded, it is an ambiguous candidate whatever its file name is, because Kiro may load it. Otherwise it counts,
///   as unreadable but not ambiguous, only when its file name is `<agent>.json`.
/// - A `.md` file whose front matter `name` is `agent` declares it, with unknown tools (see `declared_name_kiro`, which
///   closes the front matter at the first line that starts with `---`). One that opens a front matter block with no
///   `name` and the file stem `agent` is an ambiguous candidate, as Kiro 3 takes the stem for the id then. One whose
///   front matter this build cannot read in full and that may declare the id is an ambiguous candidate too. One with
///   no front matter block is not a candidate, whatever its name: Kiro does not load it, so the prompt file of a JSON
///   agent (`<id>.md`, `prompts/<id>.md`) is not a second declaration.
fn kiro_candidates(folder: &Path, agent: &str) -> Vec<KiroCandidate> {
    let mut files = Vec::new();
    list_files(folder, "", 0, &[".json", ".md"], &mut files);
    files.sort();
    let mut found = Vec::new();
    for file in files {
        let name = file.rsplit('/').next().unwrap_or_default();
        let markdown = name.ends_with(".md");
        let stem = name
            .strip_suffix(".md")
            .or_else(|| name.strip_suffix(".json"))
            .unwrap_or_default();
        let (kind, ambiguous) = match read_definition(&folder.join(&file)) {
            None => continue,
            Some(Err(why)) if stem == agent => (Kind::Unreadable(why), false),
            Some(Err(_)) => continue,
            Some(Ok(bytes)) if markdown => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                match declared_name_kiro(&text, agent) {
                    Declared::Name(name) if name == agent => (
                        Kind::Unreadable(format!(
                            "the file {file} is a Kiro markdown agent, whose tools and permission rules this build \
                             does not read, so it cannot say what the runner lets it run without asking"
                        )),
                        false,
                    ),
                    Declared::Name(_) => continue,
                    Declared::NoName if stem == agent => (
                        Kind::Unreadable(format!(
                            "the file {file} has no `name`, so Kiro may take the file name for the agent id \
                             `{agent}`, and this build cannot say what it lets run without asking"
                        )),
                        true,
                    ),
                    // Kiro does not load a markdown file with no front matter, such as the prompt file of a JSON agent.
                    Declared::NoName | Declared::NoFrontMatter => continue,
                    Declared::Unreadable(why) => (Kind::Unreadable(why), true),
                }
            }
            Some(Ok(bytes)) => {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                let parsed = if std::str::from_utf8(&bytes).is_ok() {
                    parse_kiro(&text)
                } else {
                    None
                };
                match parsed {
                    Some(value) => match value.get("name") {
                        Some(Json::Str(name)) if name == agent => (Kind::Declares(text), false),
                        Some(_) => continue,
                        None if stem == agent && matches!(value, Json::Object(_)) => (
                            Kind::Unreadable(format!(
                                "the file {file} has no `name`, so Kiro may take the file name for the agent id \
                                 `{agent}`, and this build cannot say what it lets run without asking"
                            )),
                            true,
                        ),
                        None => continue,
                    },
                    None if mentions(&text, agent) => (
                        Kind::Unreadable(format!(
                            "the file {file} mentions the agent `{agent}` but this build cannot read it as the JSON \
                             that Kiro loads, so it cannot say whether the file declares the agent"
                        )),
                        true,
                    ),
                    None if stem == agent => {
                        (Kind::Unreadable("the agent file is not valid JSON".into()), false)
                    }
                    None => continue,
                }
            }
        };
        found.push(KiroCandidate {
            file,
            kind,
            ambiguous,
        });
    }
    found
}

/// A Kiro agent file's JSON as a value, or `None` when this build cannot rely on it: the text does not parse (nesting
/// up to `MAX_LENIENT_DEPTH` is accepted, and so is a repeated key that is not read), or `name` or `allowedTools` is
/// repeated, which one Kiro engine rejects and the other reads last-wins.
fn parse_kiro(text: &str) -> Option<Json> {
    let parsed = json::parse_lenient(text).ok()?;
    let read_key_repeated = parsed
        .repeated_keys
        .iter()
        .any(|key| key == "name" || key == "allowedTools");
    if read_key_repeated {
        None
    } else {
        Some(parsed.value)
    }
}

/// The files below `folder` whose names end in one of `suffixes`, as paths below it with `/` between the parts. The walk
/// goes as deep as the config scan does, and lists dotfiles. A link to a file is listed, a link to a folder is not.
fn list_files(folder: &Path, prefix: &str, depth: usize, suffixes: &[&str], out: &mut Vec<String>) {
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
            list_files(
                &entry.path(),
                &format!("{relative}/"),
                depth + 1,
                suffixes,
                out,
            );
            continue;
        }
        // A link to a regular file is that file: the harness loads it, and the config scan hashes its target. A link
        // to a folder is not followed, and a dangling link has no target to follow.
        let is_file = if kind.is_symlink() {
            fs::metadata(entry.path()).is_ok_and(|target| target.is_file())
        } else {
            kind.is_file()
        };
        if is_file && suffixes.iter().any(|suffix| name.ends_with(suffix)) {
            out.push(relative);
        }
    }
}

/// The characters, besides a line feed, that end a line in some YAML readers: a lone carriage return, NEL, LS and PS.
const NON_LF_BREAKS: [char; 4] = ['\r', '\u{85}', '\u{2028}', '\u{2029}'];

enum Declared {
    NoFrontMatter,
    NoName,
    Name(String),
    /// The front matter or its `name` key cannot be read in full, and a `name` key may declare the id asked for.
    Unreadable(String),
}

/// The `name` of a Claude agent file, compared exactly: the value is not trimmed beyond the plain-scalar rule, and its
/// case is kept. Only a plain `name:` line of the front matter counts, not a comment, another key's value or the body.
///
/// One rule covers every form this build cannot read. When the front matter is not fully readable (see
/// `top_level_keys`), or the plain `name` key is in a form this build cannot read, the answer is `Unreadable` if any
/// text that may hold a `name` key mentions `agent` (see `possible_name_text` and `mentions`), and `NoName` otherwise.
/// A readable front matter with no `name` key is `NoName`, whatever its other keys say. A plain `name` value that is
/// read but is not `agent` is a different agent, and stays readable, unless the same value with its comment cut off
/// at a tab (`name: k-architect<TAB># x`) is the id. An alias (`*n`) in the `name` entry, or in any entry whose key
/// this build cannot read, is `Unreadable` when the id is anywhere in the front matter. So is text with a line break
/// other than LF or CRLF, or an opening `---` line this build does not take, when it mentions the id. So is a `---`
/// anywhere in the front matter lines but the closing one (see `front_matter`).
fn declared_name(text: &str, agent: &str) -> Declared {
    let front = match front_matter(text) {
        Ok(front) => front,
        Err(why) => {
            // A `---` inside the front matter lines (see `front_matter`): a reader that ends the front matter at the
            // first `---` may read another `name` or other keys. If the id is in the text, the file may declare it.
            if text.lines().next().map(str::trim_end) == Some("---") {
                let after_fence = text.split_once('\n').map_or("", |(_, rest)| rest);
                return if mentions(up_to_first_dash_run(after_fence), agent) {
                    Declared::Unreadable(why)
                } else {
                    Declared::NoName
                };
            }
            // The opening fence may be in a form this reader does not take (a byte order mark, a blank line first,
            // `---yaml`) that another reader still opens. The trust hash side treats these as front matter, so the
            // same test applies here: if the id is in the text, the file may declare it.
            let loose = text.trim_start_matches('\u{feff}').trim_start();
            return if loose.starts_with("---")
                && mentions(up_to_first_dash_run(&loose["---".len()..]), agent)
            {
                Declared::Unreadable(
                    "its opening `---` line is in a form this build does not read as front matter"
                        .into(),
                )
            } else {
                Declared::NoFrontMatter
            };
        }
    };
    declared_in_front(&front, agent)
}

/// The `name` of a Kiro markdown agent file. Kiro 3 closes the front matter at the first LINE that starts with `---`
/// (`----`, `---x` and `--- # c` close it too, an indented ` ---` does not), so a `---` inside a line is ordinary text
/// and the `name` after it is read. A file with no opening `---` line has no front matter and Kiro does not load it
/// (`NoFrontMatter`). The rest is read as for a Claude file (see `declared_name`).
fn declared_name_kiro(text: &str, agent: &str) -> Declared {
    let cut = |after_fence: &str| -> Vec<String> {
        after_fence
            .lines()
            .take_while(|l| !l.starts_with("---"))
            .map(str::to_string)
            .collect()
    };
    if text.lines().next().map(str::trim_end) == Some("---") {
        let after_fence = text.split_once('\n').map_or("", |(_, rest)| rest);
        let owned = cut(after_fence);
        let front: Vec<&str> = owned.iter().map(String::as_str).collect();
        return declared_in_front(&front, agent);
    }
    // The opening fence may be in a form this reader does not take (a byte order mark, a blank line first, `---yaml`)
    // that Kiro still opens. Such a file opens a block: it is a candidate when the block mentions the id, and it may
    // take its file stem for the id like any nameless file.
    let loose = text.trim_start_matches('\u{feff}').trim_start();
    match loose.strip_prefix("---") {
        Some(rest) if mentions(&cut(rest).join("\n"), agent) => Declared::Unreadable(
            "its opening `---` line is in a form this build does not read as front matter".into(),
        ),
        Some(_) => Declared::NoName,
        None => Declared::NoFrontMatter,
    }
}

/// The `name` in the lines of a front matter that is already cut (see `declared_name`).
fn declared_in_front(front: &[&str], agent: &str) -> Declared {
    // `front_matter` splits on a line feed, and `lines` drops the carriage return of a CRLF pair. A carriage return
    // left in a line is a lone one, which YAML 1.2 reads as a line break, so `name: k-a<CR>tools: Bash` is two entries
    // to the harness and one line here. The id anywhere in the front matter may then be the `name` value. The same
    // holds for NEL, LS and PS (U+0085, U+2028, U+2029), which a YAML 1.1 reader takes as line breaks.
    if front.iter().any(|line| line.contains(NON_LF_BREAKS)) && mentions(&front.join("\n"), agent) {
        return Declared::Unreadable(
            "its front matter has a line break character that is not a line feed or a CRLF pair, which this build \
             does not read as a line break"
                .into(),
        );
    }
    let unreadable_if_mentioned = |why: String| {
        // The kept entries are joined, so a double-quoted value continued at column 0 (`name: "k-\` then
        // `architect"`) reads as one text. An alias in any kept entry takes its text from an anchor that is in an
        // entry left out (`description: &v k-architect`, then `"name": *v`), so the id anywhere in the front matter
        // counts then. A description that only mentions the id, with no alias, is not a clash.
        let regions = possible_name_text(front);
        let alias = regions.iter().any(|region| region.contains('*'));
        if mentions(&regions.join("\n"), agent) || (alias && mentions(&front.join("\n"), agent)) {
            Declared::Unreadable(why)
        } else {
            Declared::NoName
        }
    };
    let keys = match top_level_keys(front) {
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
    let raw = &front[at]["name:".len()..];
    let value = strip_comment(raw).trim();
    // An alias (`name: *n`, or `*n` on the next line) takes its text from an anchor on any other key
    // (`description: &n k-architect`), which `possible_name_text` leaves out. The id anywhere in the front matter may
    // be the anchor, so any `*` in the `name` entry counts.
    let name_entry = format!("{}\n{}", value, continuation(front, at));
    if name_entry.contains('*') && mentions(&front.join("\n"), agent) {
        return Declared::Unreadable(
            "its `name` value is an alias, which this build does not resolve".into(),
        );
    }
    if value.is_empty() || value.starts_with(['|', '>', '&', '*', '!', '{', '[']) {
        return unreadable_if_mentioned(
            "its `name` key is in a form this build cannot read".into(),
        );
    }
    // A double-quoted value reads backslash escapes (`"k\u002darchitect"`), also over several lines, so it can name the
    // id without the id's text being in the file. This build does not read a quoted value in full.
    let region = format!("{value}\n{}", continuation(front, at));
    if value.starts_with('"') && region.contains('\\') && mentions(&region, agent) {
        return Declared::Unreadable(
            "its `name` value has a backslash escape, which this build does not read".into(),
        );
    }
    // A tab before a comment (`name: k-architect<TAB># x`) is a comment in YAML, but `strip_comment` cuts at a space
    // only, so this build reads the value as another agent. Cut the raw value at the first space or tab before a `#`
    // and compare it to the id: if it is the id, the form is one this build does not follow. A value that is another
    // agent after that cut stays another agent, even when it contains the id (`k-architect-helper`) or a comment
    // names it.
    let name = unquote(value);
    if name != agent && unquote(cut_comment(raw).trim()) == agent {
        return Declared::Unreadable(
            "its `name` value is the id followed by a tab and a comment, which this build does not follow".into(),
        );
    }
    Declared::Name(name)
}

/// The text before the first `---`, where the harness is assumed to end the front matter (see `front_matter`). Only
/// this text can hold the keys of the file, so the id in the body after it does not make the file a candidate.
fn up_to_first_dash_run(after_fence: &str) -> &str {
    after_fence
        .find("---")
        .map_or(after_fence, |at| &after_fence[..at])
}

/// The text before the first space or tab that is followed by `#` (a YAML comment).
fn cut_comment(text: &str) -> &str {
    let mut prev_blank = false;
    for (at, c) in text.char_indices() {
        if c == '#' && prev_blank {
            return &text[..at - 1];
        }
        prev_blank = matches!(c, ' ' | '\t');
    }
    text
}

/// The indented and blank lines right after line `at`, which belong to its value.
fn continuation(front: &[&str], at: usize) -> String {
    front[at + 1..]
        .iter()
        .take_while(|l| l.trim().is_empty() || l.starts_with([' ', '\t']))
        .copied()
        .collect::<Vec<_>>()
        .join("\n")
}

/// The text of the front matter that may hold a `name` key, one string per top-level entry (its line and the lines under
/// it). An entry is left out only when this build can tell its key is not `name`: a plain or fully quoted key, once its
/// escapes are decoded. An entry whose key it cannot tell is kept, such as one with no colon, a key that is not a plain
/// or quoted word, or an indented line before any key (an indented root mapping). If a column-0 line starts a flow
/// collection (`{` or `[`), the keys are hidden inside it and every entry is kept.
fn possible_name_text(front: &[&str]) -> Vec<String> {
    let root_flow = front.iter().any(|line| line.starts_with(['{', '[']));
    let mut entries: Vec<(bool, String)> = Vec::new();
    for line in front {
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        let indented = line.starts_with([' ', '\t']);
        match entries.last_mut() {
            Some((_, text)) if indented || is_list_item(line) => {
                text.push('\n');
                text.push_str(line);
            }
            None if indented => entries.push((true, (*line).to_string())),
            _ => entries.push((root_flow || may_be_name_key(line), (*line).to_string())),
        }
    }
    entries
        .into_iter()
        .filter(|(kept, _)| *kept)
        .map(|(_, text)| text)
        .collect()
}

/// Whether a column-0 line may set `name`: false only when the key before the first colon is a plain word, or a word in
/// quotes, that reads as something other than `name` once the escapes of a double-quoted key are decoded.
fn may_be_name_key(line: &str) -> bool {
    let Some((key, _)) = line.split_once(':') else {
        return true;
    };
    let key = key.trim();
    if !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return key == "name";
    }
    let quoted = |quote: char| key.strip_prefix(quote).and_then(|k| k.strip_suffix(quote));
    if let Some(inner) = quoted('"') {
        return decode_escapes(inner) == "name";
    }
    if let Some(inner) = quoted('\'') {
        return inner.replace("''", "'") == "name";
    }
    true
}

/// Whether `text` has the id in it, either as written or once the escapes of a double-quoted YAML string are decoded.
fn mentions(text: &str, agent: &str) -> bool {
    text.contains(agent) || decode_escapes(text).contains(agent)
}

/// `\xHH`, `\uHHHH` and `\UHHHHHHHH` as the characters they name, `\` before a line break (LF, CR or CRLF) and the
/// white space after it as nothing (a YAML line fold inside a double-quoted string), and any other `\c` as `c`. These
/// are the escapes that can write a character of an id.
fn decode_escapes(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let digits = match chars.peek() {
            Some('x') => 2,
            Some('u') => 4,
            Some('U') => 8,
            Some('\n' | '\r') => {
                // A line break is a line feed, a carriage return, or both in that order (CRLF).
                if chars.next() == Some('\r') {
                    chars.next_if_eq(&'\n');
                }
                while chars.next_if(|c| matches!(c, ' ' | '\t')).is_some() {}
                continue;
            }
            Some(_) => {
                out.extend(chars.next());
                continue;
            }
            None => {
                out.push(c);
                continue;
            }
        };
        let marker = chars.next().unwrap_or_default();
        let mut hex = String::new();
        while hex.len() < digits {
            match chars.next_if(char::is_ascii_hexdigit) {
                Some(d) => hex.push(d),
                None => break,
            }
        }
        match u32::from_str_radix(&hex, 16)
            .ok()
            .filter(|_| hex.len() == digits)
            .and_then(char::from_u32)
        {
            Some(decoded) => out.push(decoded),
            None => {
                out.push('\\');
                out.push(marker);
                out.push_str(&hex);
            }
        }
    }
    out
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

/// The bytes of a definition: `None` if nothing is there, `Some(Err)` if something is there that cannot be used. A
/// caller decides what a byte that is not UTF-8 means: Claude Code decodes a markdown agent file as a Node.js reader
/// does, a byte that is not UTF-8 becoming U+FFFD, so the harness still loads it and so must the catalog.
fn read_definition(path: &Path) -> Option<Result<Vec<u8>, String>> {
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
        Ok(_) => Ok(bytes),
    })
}

/// Keys of a Kiro agent file, besides `allowedTools`, that can change what runs: rules that allow, hooks, MCP servers,
/// and per-tool settings. Their values are not read.
const KIRO_KEYS: &[&str] = &[
    "permissions",
    "hooks",
    "mcpServers",
    "includeMcpJson",
    "useLegacyMcpJson",
    "toolsSettings",
];

/// Keys of a Claude agent file's front matter, besides `tools`, that can change what runs: how permission prompts are
/// handled, hooks, MCP servers the agent starts, and `memory`, which gives the agent file tools (see
/// `memory_grants_file_tools`). Their values are not read here.
const CLAUDE_KEYS: &[&str] = &["permissionMode", "hooks", "mcpServers", "memory"];

fn kiro_also_sets(text: &str) -> Vec<String> {
    let Some(value) = parse_kiro(text) else {
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
///
/// Harness front matter split (an assumption, named here so the code and the tests point at one place): Claude Code
/// is taken to split the file with the lazy pattern `^---\s*\n([\s\S]*?)---\s*\n?`, so its front matter ends at the
/// FIRST `---` after the opening fence, wherever that sits, inside a value included, and not only on a line that is
/// `---` alone. This is assumed from Claude Code's front matter reader; the `claude` binary on the development desktop
/// is a stub, so it could not be checked here. The differential test in `adapters/tests/trust.rs` applies the same
/// split before it reads the text as YAML 1.2.
///
/// This reader ends the front matter at a line that is `---` alone. Where a `---` sits anywhere else in those lines,
/// the two readers would end it at different places and could read different keys, so such a front matter is an
/// error, and every caller treats it as one it cannot read. A hyphen run shorter than three (`a--b`) is a plain value.
fn front_matter(text: &str) -> Result<Vec<&str>, String> {
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return Err("the agent file has no front matter".into());
    }
    let front: Vec<&str> = lines.take_while(|l| l.trim_end() != "---").collect();
    if front.iter().any(|line| line.contains("---")) {
        return Err(
            "its front matter has a `---` that is not on a line of its own, where a reader may end the front matter \
             at the first `---`"
                .into(),
        );
    }
    Ok(front)
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
    // `lines` drops the carriage return of a CRLF pair, so one left in a line is a lone one. YAML 1.2 reads it as a
    // line break, which this reader does not, so a key could hide behind it.
    if front.iter().any(|line| line.contains('\r')) {
        return FrontMatterKeys::Unreadable;
    }
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
/// whole file is unreadable, and so is an indented line before the first key (an indented root mapping). The one
/// exception is a `- item` line in column 0 in the list of a `tools:`, `skills:` or `mcpServers:` key that has no value
/// on its own line. It must come before any indented line of that list, and the first other column-0 line is the next
/// key. The items of `mcpServers:` are mappings, so once its list has begun, the indented lines under an item belong to
/// that item. Indented lines belong to the value above them, and blank and
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
            // An indented line before any key is an indented root mapping, whose keys this build does not read.
            if keys.is_empty() {
                return Err(unreadable_front_matter());
            }
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
    let Some(value) = parse_kiro(text) else {
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
/// restricted, so it never reads as the whole capability either.
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
        [at] => {
            let tools = parse_tools_value(&front[*at]["tools:".len()..], &front[at + 1..]);
            if matches!(tools, AgentTools::Listed(_)) && memory_grants_file_tools(&front, &keys) {
                return AgentTools::Unknown(
                    "its `memory` key gives the agent the Read, Write and Edit tools besides the `tools` list, which \
                     this build does not add to the list"
                        .into(),
                );
            }
            tools
        }
        _ => AgentTools::Unknown("the agent file has more than one `tools` key".into()),
    }
}

/// Whether a `memory` key may give the agent Read, Write and Edit on top of its `tools` list. Claude Code does that for
/// the values `user`, `project` and `local`, and YAML writes each of them in many forms (quoted, with an escape, an
/// alias or a tag, a block scalar, on the next line). Only a plain word of letters, one that is not one of the three,
/// is known to grant nothing. Any other form of the value may be one of them.
fn memory_grants_file_tools(front: &[&str], keys: &[(usize, &str)]) -> bool {
    keys.iter()
        .filter(|(_, key)| *key == "memory")
        .any(|(at, _)| {
            // Only spaces are trimmed: a tab before a comment is a form this build does not follow.
            let value = strip_comment(&front[*at]["memory:".len()..]).trim_matches(' ');
            let plain_word = !value.is_empty()
                && value.chars().all(|c| c.is_ascii_alphabetic())
                && !matches!(value, "user" | "project" | "local");
            let continued = continuation(front, *at)
                .lines()
                .any(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#'));
            !plain_word || continued
        })
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
    // An indented line right after an inline value continues it (`tools: Read` then `  , Write`), so the list is longer
    // than the first line. Blank and comment lines can sit between. The first column-0 line is the next key.
    for line in following {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if line.starts_with([' ', '\t']) {
            return AgentTools::Unknown(
                "its `tools` value continues on an indented line, which this build does not read"
                    .into(),
            );
        }
        break;
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

/// The items of a `tools` list as written (a list with an item `*` is just `*`), or `Unknown` when one is outside
/// `[A-Za-z0-9_*:.-]+` and is not the `Agent(a, b)` form. A scoped rule such as `Bash(git status)` is outside it, so it
/// makes the whole list unknown instead of a short list.
fn checked_items(items: Vec<String>) -> AgentTools {
    // A `*` item means every tool, whatever else is listed, so it stands alone: the other items add nothing to show.
    if items.iter().any(|item| item == "*") && items.iter().all(|item| is_tool_item(item)) {
        return AgentTools::Listed(vec!["*".into()]);
    }
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
