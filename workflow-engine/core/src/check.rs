// SPDX-License-Identifier: Apache-2.0
//! The checks of a workflow file: "Rules for every file" and "Keys" of the spec.
//!
//! The loader reads the YAML. This module reads the tree it gives, reports every finding it can in one pass, and
//! builds the resolved workflow when there is none.

use std::collections::{BTreeMap, BTreeSet};

use crate::diagnostic::{Code, Diagnostic};
use crate::json::Json;
use crate::keys::{
    display_path, honored_names, is_stage_kind, status, KeyStatus, Slice, BUILD_SLICE,
    INTENT_STRING_FORM,
};
use crate::limits::{MAX_OUTCOME_CHARS, MAX_PROMPT_CHARS, MAX_STAGES, MIN_STAGES};
use crate::model::{Check, Intent, Param, Stage, Workflow};
use crate::report::{quote, to_diagnostics, Problem, Seg, Span};
use crate::rules::{
    code_points, decode_file, is_name, is_reserved_stage_name, is_semver, path_problem, NAME_RULE,
};
use crate::source::WorkflowSource;
use crate::source_map::SourceMap;
use crate::yaml::{load, Entry, Map, Node};

/// The result of checking one workflow.
#[derive(Debug)]
pub struct Checked {
    /// The name the workflow was looked up by.
    pub name: String,
    /// The resolved workflow, present exactly when there are no diagnostics.
    pub workflow: Option<Workflow>,
    pub diagnostics: Vec<Diagnostic>,
}

impl Checked {
    /// The number of errors. Every diagnostic of this release is one.
    pub fn errors(&self) -> usize {
        self.diagnostics.len()
    }

    pub fn is_valid(&self) -> bool {
        self.errors() == 0
    }

    /// The report of `flow check --json`. Keys are sorted.
    pub fn report_json(&self) -> Json {
        let mut root = Json::object();
        root.insert("name", Json::str(&self.name));
        root.insert(
            "diagnostics",
            Json::Array(self.diagnostics.iter().map(Diagnostic::to_json).collect()),
        );
        root.insert("errors", Json::number(self.errors()));
        root.insert("warnings", Json::number(0));
        root.insert("infos", Json::number(0));
        let mut counts = Json::object();
        counts.insert(
            "stages",
            Json::number(self.workflow.as_ref().map_or(0, |w| w.stages.len())),
        );
        let mut summary = Json::object();
        summary.insert("valid", Json::Bool(self.is_valid()));
        summary.insert("counts", counts);
        root.insert("summary", summary);
        root
    }
}

/// Checks the text of workflow `name` as a build at [`BUILD_SLICE`]. `name` is the file name without `.yml`, and must
/// follow the name pattern. Prompt files are read through `source`.
///
/// There is no way to check as a later slice: this engine reads no key beyond [`BUILD_SLICE`], so it would accept a
/// key it ignores. How a build at another slice treats each key is [`crate::keys::status`].
pub fn check_text(name: &str, text: &str, source: &dyn WorkflowSource) -> Checked {
    let build = BUILD_SLICE;
    let map = SourceMap::new(text);
    let loaded = load(text, &map);
    let unreadable = loaded.is_unreadable();
    let mut checker = Checker {
        name,
        source,
        build,
        problems: loaded.problems,
        stage_names: Vec::new(),
        check_ids: BTreeSet::new(),
    };
    let mut workflow = None;
    match &loaded.root {
        Some(Node::Map(root)) => {
            checker.stage_names = stage_names(root);
            if !unreadable {
                workflow = checker.read_root(root);
            }
        }
        Some(other) => {
            if !unreadable {
                checker.report(
                    Code::NotAMapping,
                    &[],
                    other.span(),
                    "The workflow must be a mapping.",
                );
            }
        }
        None => {
            if !unreadable {
                checker.report(
                    Code::NotAMapping,
                    &[],
                    Span::default(),
                    "The workflow must be a mapping.",
                );
            }
        }
    }
    let diagnostics = to_diagnostics(
        checker.problems,
        &format!("{name}.yml"),
        &map,
        &checker.stage_names,
    );
    let workflow = if diagnostics.is_empty() {
        workflow
    } else {
        None
    };
    Checked {
        name: name.to_string(),
        workflow,
        diagnostics,
    }
}

/// The name that addresses each stage in a path: usable (a name that is not reserved) and not used before.
fn stage_names(root: &Map) -> Vec<Option<String>> {
    let stages = root
        .entries
        .iter()
        .find(|e| e.key.text == "stages")
        .map(|e| &e.value);
    let Some(Node::Seq(list)) = stages else {
        return Vec::new();
    };
    let mut used = BTreeSet::new();
    list.items
        .iter()
        .map(|item| {
            let Node::Map(stage) = item else { return None };
            let first = stage.entries.iter().find(|e| e.key.text == "name")?;
            let Node::Scalar(value) = &first.value else {
                return None;
            };
            let usable =
                value.is_string() && is_name(&value.text) && !is_reserved_stage_name(&value.text);
            if usable && used.insert(value.text.clone()) {
                Some(value.text.clone())
            } else {
                None
            }
        })
        .collect()
}

struct Checker<'a> {
    name: &'a str,
    source: &'a dyn WorkflowSource,
    build: Slice,
    problems: Vec<Problem>,
    stage_names: Vec<Option<String>>,
    check_ids: BTreeSet<String>,
}

fn child(path: &[Seg], key: &str) -> Vec<Seg> {
    let mut out = path.to_vec();
    out.push(Seg::Key(key.to_string()));
    out
}

fn child_index(path: &[Seg], index: usize) -> Vec<Seg> {
    let mut out = path.to_vec();
    out.push(Seg::Index(index));
    out
}

impl<'a> Checker<'a> {
    fn report(&mut self, code: Code, path: &[Seg], span: Span, message: impl Into<String>) {
        self.problems.push(Problem::new(code, path, span, message));
    }

    /// The first entry of each key that this build honors. A repeated key is already a `DUPLICATE_KEY`, and the check
    /// goes on as if it were not there. A key of a later slice and a key that no slice plans are reported here.
    fn entries<'n>(
        &mut self,
        map: &'n Map,
        path: &[Seg],
        prefix: &str,
    ) -> BTreeMap<&'n str, &'n Entry> {
        let mut honored = BTreeMap::new();
        for entry in map.entries.iter().filter(|e| !e.duplicate) {
            let key = entry.key.text.as_str();
            let at = child(path, key);
            match status(prefix, key, self.build) {
                KeyStatus::Honored => {
                    honored.insert(key, entry);
                }
                KeyStatus::Later(slice) => {
                    let message = format!(
                        "`{}` is not supported by this build. It arrives in slice {slice}, and this build is slice {}.",
                        display_path(prefix, key),
                        self.build
                    );
                    self.report(Code::NotSupportedByThisBuild, &at, entry.key.span, message);
                }
                KeyStatus::Unknown => {
                    let mut message = format!("Unknown key {}.", quote(key));
                    if prefix.is_empty() && key == "description" {
                        message.push_str(
                            " A `description` for a workflow is planned, not supported yet.",
                        );
                    }
                    let mut problem = Problem::new(Code::UnknownKey, &at, entry.key.span, message);
                    if let Some(near) = suggest(key, &honored_names(prefix, self.build)) {
                        problem = problem.with_suggestion(near);
                    }
                    self.problems.push(problem);
                }
            }
        }
        honored
    }

    fn missing(&mut self, mapping: &Map, path: &[Seg], key: &str, suggestion: Option<&str>) {
        let message = format!("The mapping needs the key `{key}`.");
        let mut problem = Problem::new(Code::MissingKey, path, mapping.span, message);
        if let Some(text) = suggestion {
            problem = problem.with_suggestion(text);
        }
        self.problems.push(problem);
    }

    /// The string value of an entry, or `None` after a `WRONG_TYPE`.
    fn string_of<'n>(&mut self, entry: &'n Entry, path: &[Seg]) -> Option<&'n str> {
        if let Node::Scalar(scalar) = &entry.value {
            if scalar.is_string() {
                return Some(&scalar.text);
            }
        }
        let message = format!("`{}` must be a string.", entry.key.text);
        self.report(Code::WrongType, path, entry.value_span(), message);
        None
    }

    /// A string that follows the name pattern, or `None` after a report.
    fn name_of<'n>(&mut self, entry: &'n Entry, path: &[Seg]) -> Option<&'n str> {
        let text = self.string_of(entry, path)?;
        if is_name(text) {
            return Some(text);
        }
        let message = format!("`{}` {NAME_RULE}.", entry.key.text);
        self.report(Code::InvalidName, path, entry.value_span(), message);
        None
    }

    /// A string between 1 and `max` code points.
    fn text_of<'n>(&mut self, entry: &'n Entry, path: &[Seg], max: usize) -> Option<&'n str> {
        let text = self.string_of(entry, path)?;
        self.length_ok(text, entry, path, max).then_some(text)
    }

    fn length_ok(&mut self, text: &str, entry: &Entry, path: &[Seg], max: usize) -> bool {
        let length = code_points(text);
        if (1..=max).contains(&length) {
            return true;
        }
        let message = format!("`{}` must have 1 to {max} characters.", entry.key.text);
        self.report(Code::InvalidValue, path, entry.value_span(), message);
        false
    }

    /// A string that follows the path rules, or `None` after a report.
    fn path_of<'n>(&mut self, entry: &'n Entry, path: &[Seg]) -> Option<&'n str> {
        let text = self.string_of(entry, path)?;
        match path_problem(text) {
            None => Some(text),
            Some(problem) => {
                let message = format!(
                    "`{}` {}. A path is relative, uses `/`, has no `..` and is not absolute.",
                    entry.key.text,
                    problem.reason()
                );
                self.report(Code::InvalidValue, path, entry.value_span(), message);
                None
            }
        }
    }

    fn read_root(&mut self, root: &Map) -> Option<Workflow> {
        let top = self.entries(root, &[], "");
        let format = self.read_format(top.get("format").copied(), root);
        let name = self.read_workflow_name(top.get("name").copied());
        let version = self.read_version(top.get("version").copied(), root);
        let intent = self.read_intent(top.get("intent").copied(), root);
        let goal = self.read_params(top.get("params").copied());
        let stages = self.read_stages(top.get("stages").copied(), root);
        if !self.problems.is_empty() {
            return None;
        }
        Some(Workflow {
            format: format?,
            name: name?,
            version: version?,
            intent: intent?,
            params: BTreeMap::from([("goal".to_string(), goal?)]),
            stages: stages?,
        })
    }

    fn read_format(&mut self, entry: Option<&Entry>, root: &Map) -> Option<String> {
        let Some(entry) = entry else {
            self.missing(root, &[], "format", Some("format: konductor/1"));
            return None;
        };
        // Any value but `konductor/1` is UNSUPPORTED_FORMAT, whatever its type.
        let text = match &entry.value {
            Node::Scalar(scalar) if scalar.is_string() => Some(scalar.text.as_str()),
            _ => None,
        };
        if text == Some("konductor/1") {
            return text.map(str::to_string);
        }
        let message = match text {
            Some(text) => format!(
                "The format {} is not supported. This build reads `konductor/1`.",
                quote(text)
            ),
            None => "The format is not supported. This build reads `konductor/1`.".to_string(),
        };
        let problem = Problem::new(
            Code::UnsupportedFormat,
            &child(&[], "format"),
            entry.value_span(),
            message,
        )
        .with_suggestion("konductor/1");
        self.problems.push(problem);
        None
    }

    fn read_workflow_name(&mut self, entry: Option<&Entry>) -> Option<String> {
        let Some(entry) = entry else {
            return Some(self.name.to_string());
        };
        let at = child(&[], "name");
        let text = self.name_of(entry, &at)?;
        if text != self.name {
            let message = format!("`name` must be `{}`, the name of the file.", self.name);
            self.report(Code::NameMismatch, &at, entry.value_span(), message);
            return None;
        }
        Some(text.to_string())
    }

    fn read_version(&mut self, entry: Option<&Entry>, root: &Map) -> Option<String> {
        let Some(entry) = entry else {
            self.missing(root, &[], "version", Some("version: 0.1.0"));
            return None;
        };
        let at = child(&[], "version");
        let Node::Scalar(scalar) = &entry.value else {
            self.report(
                Code::WrongType,
                &at,
                entry.value_span(),
                "`version` must be a string such as `0.1.0`.",
            );
            return None;
        };
        if !scalar.is_string() {
            self.report(
                Code::WrongType,
                &at,
                entry.value_span(),
                "`version` must be a string such as `0.1.0`.",
            );
            return None;
        }
        if is_semver(&scalar.text) {
            return Some(scalar.text.clone());
        }
        let message = "`version` must be three numbers separated by dots, such as `0.1.0`.";
        let problem = Problem::new(Code::InvalidValue, &at, entry.value_span(), message)
            .with_suggestion("0.1.0");
        self.problems.push(problem);
        None
    }

    fn read_intent(&mut self, entry: Option<&Entry>, root: &Map) -> Option<Intent> {
        let Some(entry) = entry else {
            self.missing(root, &[], "intent", None);
            return None;
        };
        let at = child(&[], "intent");
        match &entry.value {
            Node::Map(map) => self.read_intent_map(map, &at),
            Node::Scalar(scalar) if scalar.is_string() => {
                let message = format!(
                    "The string form of `intent` is not supported by this build. It arrives in slice {INTENT_STRING_FORM}, \
                     and this build is slice {}. Write `intent` as a mapping with an `outcome`.",
                    self.build
                );
                self.report(
                    Code::NotSupportedByThisBuild,
                    &at,
                    entry.value_span(),
                    message,
                );
                None
            }
            _ => {
                self.report(
                    Code::WrongType,
                    &at,
                    entry.value_span(),
                    "`intent` must be a mapping with an `outcome`.",
                );
                None
            }
        }
    }

    fn read_intent_map(&mut self, map: &Map, at: &[Seg]) -> Option<Intent> {
        let entries = self.entries(map, at, "intent.");
        let outcome = match entries.get("outcome") {
            Some(entry) => self.read_outcome(entry, &child(at, "outcome")),
            None => {
                self.missing(map, at, "outcome", None);
                None
            }
        };
        let accept = match entries.get("accept") {
            Some(entry) => self.read_accept(entry, &child(at, "accept")),
            None => Some(Vec::new()),
        };
        Some(Intent {
            outcome: outcome?,
            accept: accept?,
        })
    }

    fn read_outcome(&mut self, entry: &Entry, at: &[Seg]) -> Option<String> {
        let text = self.string_of(entry, at)?;
        let problem = if text.is_empty() {
            Some("must not be empty".to_string())
        } else if text.contains(['\n', '\r']) {
            Some("must be one line".to_string())
        } else if code_points(text) > MAX_OUTCOME_CHARS {
            Some(format!("must have at most {MAX_OUTCOME_CHARS} characters"))
        } else {
            None
        };
        match problem {
            None => Some(text.to_string()),
            Some(reason) => {
                let message = format!("`outcome` {reason}.");
                self.report(Code::InvalidValue, at, entry.value_span(), message);
                None
            }
        }
    }

    fn read_accept(&mut self, entry: &Entry, at: &[Seg]) -> Option<Vec<Check>> {
        let Node::Seq(list) = &entry.value else {
            self.report(
                Code::WrongType,
                at,
                entry.value_span(),
                "`accept` must be a list of checks.",
            );
            return None;
        };
        let mut checks = Vec::new();
        let mut complete = true;
        for (index, item) in list.items.iter().enumerate() {
            let item_at = child_index(at, index);
            let Node::Map(map) = item else {
                self.report(
                    Code::NotAMapping,
                    &item_at,
                    item.span(),
                    "A check must be a mapping.",
                );
                complete = false;
                continue;
            };
            match self.read_check(map, &item_at) {
                Some(check) => checks.push(check),
                None => complete = false,
            }
        }
        complete.then_some(checks)
    }

    fn read_check(&mut self, map: &Map, at: &[Seg]) -> Option<Check> {
        let entries = self.entries(map, at, "intent.accept[].");
        let id = match entries.get("id") {
            Some(entry) => self.read_check_id(entry, &child(at, "id")),
            None => {
                self.missing(map, at, "id", None);
                None
            }
        };
        // `run` is a later-slice key, and it is reported as such. It still counts as the check's kind.
        let has_run = map
            .entries
            .iter()
            .any(|e| !e.duplicate && e.key.text == "run");
        let file = match (entries.get("file"), has_run) {
            (Some(_), true) => {
                self.report(
                    Code::InvalidValue,
                    at,
                    map.span,
                    "A check needs exactly one of `file` or `run`, not both.",
                );
                None
            }
            (None, false) => {
                self.report(
                    Code::InvalidValue,
                    at,
                    map.span,
                    "A check needs one of `file` or `run`.",
                );
                None
            }
            (Some(entry), false) => self.path_of(entry, &child(at, "file")).map(str::to_string),
            (None, true) => None,
        };
        Some(Check {
            id: id?,
            file: file?,
        })
    }

    fn read_check_id(&mut self, entry: &Entry, at: &[Seg]) -> Option<String> {
        let text = self.name_of(entry, at)?;
        if !self.check_ids.insert(text.to_string()) {
            let message = format!("The check id {} is already used.", quote(text));
            self.report(Code::InvalidValue, at, entry.value_span(), message);
            return None;
        }
        Some(text.to_string())
    }

    /// Reads `params` and returns the `goal` param, which every workflow has.
    fn read_params(&mut self, entry: Option<&Entry>) -> Option<Param> {
        let Some(entry) = entry else {
            return Some(Param::default());
        };
        let at = child(&[], "params");
        let Node::Map(map) = &entry.value else {
            let message = if matches!(entry.value, Node::Seq(_)) {
                "`params` must be a mapping of names to params. A list of names is planned, not supported yet."
            } else {
                "`params` must be a mapping of names to params."
            };
            self.report(Code::WrongType, &at, entry.value_span(), message);
            return None;
        };
        let entries = self.entries(map, &at, "params.");
        let Some(goal) = entries.get("goal") else {
            return Some(Param::default());
        };
        let goal_at = child(&at, "goal");
        let Node::Map(goal_map) = &goal.value else {
            self.report(
                Code::WrongType,
                &goal_at,
                goal.value_span(),
                "`goal` must be a mapping.",
            );
            return None;
        };
        let fields = self.entries(goal_map, &goal_at, "params.goal.");
        let mut param = Param::default();
        let mut complete = true;
        for (key, slot) in [
            ("description", &mut param.description),
            ("default", &mut param.default),
        ] {
            if let Some(field) = fields.get(key) {
                match self.string_of(field, &child(&goal_at, key)) {
                    Some(text) => *slot = Some(text.to_string()),
                    None => complete = false,
                }
            }
        }
        complete.then_some(param)
    }

    fn read_stages(&mut self, entry: Option<&Entry>, root: &Map) -> Option<Vec<Stage>> {
        let Some(entry) = entry else {
            self.missing(root, &[], "stages", None);
            return None;
        };
        let at = child(&[], "stages");
        let Node::Seq(list) = &entry.value else {
            self.report(
                Code::WrongType,
                &at,
                entry.value_span(),
                "`stages` must be a list.",
            );
            return None;
        };
        let mut complete = true;
        if !(MIN_STAGES..=MAX_STAGES).contains(&list.items.len()) {
            let message = format!("`stages` must have {MIN_STAGES} to {MAX_STAGES} entries.");
            self.report(Code::InvalidValue, &at, list.span, message);
            complete = false;
        }
        let mut used = BTreeSet::new();
        let mut stages = Vec::new();
        for (index, item) in list.items.iter().enumerate() {
            let item_at = child_index(&at, index);
            let Node::Map(map) = item else {
                self.report(
                    Code::NotAMapping,
                    &item_at,
                    item.span(),
                    "A stage must be a mapping.",
                );
                complete = false;
                continue;
            };
            match self.read_stage(map, &item_at, &mut used) {
                Some(stage) => stages.push(stage),
                None => complete = false,
            }
        }
        complete.then_some(stages)
    }

    fn read_stage(&mut self, map: &Map, at: &[Seg], used: &mut BTreeSet<String>) -> Option<Stage> {
        let entries = self.entries(map, at, "stages[].");
        let name = match entries.get("name") {
            Some(entry) => self.read_stage_name(entry, &child(at, "name"), used),
            None => {
                self.missing(map, at, "name", None);
                None
            }
        };

        // A stage has exactly one key that says what kind of stage it is. Keys of a later slice count, so a stage
        // that only has `run` is reported for that key and not also as having no kind.
        let kinds = map
            .entries
            .iter()
            .filter(|e| !e.duplicate && is_stage_kind(&e.key.text))
            .count();
        if kinds == 0 {
            let message = "A stage needs a kind. Add `agent` with the id of an installed agent.";
            self.report(Code::StageKindMissing, at, map.span, message);
        } else if kinds > 1 {
            let message = "A stage must have exactly one kind key, and this one has more than one.";
            self.report(Code::StageKindAmbiguous, at, map.span, message);
        }
        let agent = entries
            .get("agent")
            .and_then(|entry| self.name_of(entry, &child(at, "agent")).map(str::to_string));

        let inline = entries.get("prompt").map(|entry| {
            self.text_of(entry, &child(at, "prompt"), MAX_PROMPT_CHARS)
                .map(str::to_string)
        });
        let file = entries.get("prompt_file").map(|entry| {
            let file_at = child(at, "prompt_file");
            self.path_of(entry, &file_at).and_then(|path| {
                if inline.is_some() {
                    let message = "Use `prompt` or `prompt_file`, not both.";
                    self.report(Code::InvalidValue, &file_at, entry.value_span(), message);
                    return None;
                }
                let text = self.read_prompt_file(path, entry, &file_at)?;
                Some((path.to_string(), text))
            })
        });

        let (prompt, prompt_file, prompt_ok) = match (inline, file) {
            (Some(Some(text)), _) => (Some(text), None, true),
            (Some(None), _) => (None, None, false),
            (None, Some(Some((path, text)))) => (Some(text), Some(path), true),
            (None, Some(None)) => (None, None, false),
            (None, None) => (None, None, true),
        };

        if !prompt_ok {
            return None;
        }
        Some(Stage {
            name: name?,
            agent: agent?,
            prompt,
            prompt_file,
        })
    }

    fn read_stage_name(
        &mut self,
        entry: &Entry,
        at: &[Seg],
        used: &mut BTreeSet<String>,
    ) -> Option<String> {
        let name = self.name_of(entry, at)?;
        if is_reserved_stage_name(name) {
            let message = format!("The stage name `{name}` is reserved.");
            self.report(Code::ReservedName, at, entry.value_span(), message);
            return None;
        }
        if !used.insert(name.to_string()) {
            let message = format!("The stage name {} is already used.", quote(name));
            self.report(Code::DuplicateStage, at, entry.value_span(), message);
            return None;
        }
        Some(name.to_string())
    }

    /// Reads the file that `prompt_file` names. A file that is not there, or is not a regular UTF-8 file within the
    /// size limit, is `INVALID_VALUE` at the `prompt_file` value.
    fn read_prompt_file(&mut self, path: &str, entry: &Entry, at: &[Seg]) -> Option<String> {
        let Some(text) = self.source.prompt_file_bytes(path).and_then(decode_file) else {
            let message = "The file named by `prompt_file` is not there, or it is not a regular UTF-8 file within the \
                           size limit.";
            self.report(Code::InvalidValue, at, entry.value_span(), message);
            return None;
        };
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text).to_string();
        if !(1..=MAX_PROMPT_CHARS).contains(&code_points(&text)) {
            let message = format!("The text of the file named by `prompt_file` must have 1 to {MAX_PROMPT_CHARS} characters.");
            self.report(Code::InvalidValue, at, entry.value_span(), message);
            return None;
        }
        Some(text)
    }
}

/// The key, among those that a build honors, that a mistyped key was most likely meant to be: within an edit distance
/// of 2, and the first of them if two are equally near.
fn suggest<'n>(key: &str, candidates: &[&'n str]) -> Option<&'n str> {
    let mut best: Option<(&str, usize)> = None;
    for candidate in candidates {
        let distance = edit_distance(key, candidate);
        if distance <= 2 && best.is_none_or(|(_, nearest)| distance < nearest) {
            best = Some((candidate, distance));
        }
    }
    best.map(|(candidate, _)| candidate)
}

/// The number of insertions, deletions and substitutions of code points between two texts.
fn edit_distance(a: &str, b: &str) -> usize {
    let left: Vec<char> = a.chars().collect();
    let right: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    for (i, l) in left.iter().enumerate() {
        let mut row = vec![i + 1];
        for (j, r) in right.iter().enumerate() {
            let substitution = previous[j] + usize::from(l != r);
            row.push(substitution.min(previous[j + 1] + 1).min(row[j] + 1));
        }
        previous = row;
    }
    previous[right.len()]
}
