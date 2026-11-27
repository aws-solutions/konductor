// SPDX-License-Identifier: Apache-2.0
//! The canvas contract's `WorkflowView` and `CheckResponse`, built from what the checker gives.
//!
//! A view is the parsed file, so a key the file leaves out is left out of it. The resolved [`Workflow`] has the
//! defaults applied and cannot tell, so the file's tree says which of `accept`, `params` and `params.goal` were
//! written. Each stage also has its `kind` and the lines it takes up in the text.

use crate::check::Checked;
use crate::diagnostic::Diagnostic;
use crate::json::Json;
use crate::limits::MAX_PROMPT_CHARS;
use crate::model::Workflow;
use crate::rules::{NAME_PATTERN, RESERVED_STAGE_NAMES};
use crate::source_map::SourceMap;
use crate::yaml::{load, Map, Node, Seq};

fn entry<'a>(map: &'a Map, key: &str) -> Option<&'a Node> {
    map.entries
        .iter()
        .find(|e| e.key.text == key)
        .map(|e| &e.value)
}

fn as_map(node: Option<&Node>) -> Option<&Map> {
    match node {
        Some(Node::Map(map)) => Some(map),
        _ => None,
    }
}

/// The view of a workflow that passed every check. `text` is the text it was checked from.
pub fn workflow_view(workflow: &Workflow, text: &str) -> Json {
    let source_map = SourceMap::new(text);
    let loaded = load(text, &source_map);
    let root = as_map(loaded.root.as_ref());
    let has_accept = root
        .and_then(|r| as_map(entry(r, "intent")))
        .is_some_and(|i| entry(i, "accept").is_some());
    let params = root.and_then(|r| entry(r, "params"));
    let goal_declared = as_map(params).is_some_and(|p| entry(p, "goal").is_some());

    let mut view = Json::object();
    view.insert("format", Json::str(&workflow.format));
    view.insert("version", Json::str(&workflow.version));
    view.insert("name", Json::str(&workflow.name));

    let mut intent = Json::object();
    intent.insert("outcome", Json::str(&workflow.intent.outcome));
    if has_accept {
        let accept = workflow
            .intent
            .accept
            .iter()
            .map(|check| {
                let mut object = Json::object();
                object.insert("id", Json::str(&check.id));
                object.insert("file", Json::str(&check.file));
                object
            })
            .collect();
        intent.insert("accept", Json::Array(accept));
    }
    view.insert("intent", intent);

    if params.is_some() {
        let mut declared = Json::object();
        if let (true, Some(goal)) = (goal_declared, workflow.params.get("goal")) {
            let mut object = Json::object();
            if let Some(description) = &goal.description {
                object.insert("description", Json::str(description));
            }
            if let Some(default) = &goal.default {
                object.insert("default", Json::str(default));
            }
            declared.insert("goal", object);
        }
        view.insert("params", declared);
    }

    let stage_nodes = root
        .and_then(|r| entry(r, "stages"))
        .and_then(|node| match node {
            Node::Seq(seq) => Some(seq),
            _ => None,
        });
    let stages = workflow
        .stages
        .iter()
        .enumerate()
        .map(|(index, stage)| {
            let mut object = Json::object();
            object.insert("name", Json::str(&stage.name));
            // The first release has one kind of stage, named by its `agent` key.
            object.insert("kind", Json::str("agent"));
            object.insert("agent", Json::str(&stage.agent));
            // The text of a prompt file is not the file's own `prompt` key.
            match (&stage.prompt_file, &stage.prompt) {
                (Some(path), _) => object.insert("prompt_file", Json::str(path)),
                (None, Some(prompt)) => object.insert("prompt", Json::str(prompt)),
                (None, None) => {}
            }
            object.insert("range", stage_range(stage_nodes, index, text, &source_map));
            object
        })
        .collect();
    view.insert("stages", Json::Array(stages));
    view
}

/// The lines of the text that a stage takes up, counted from 1 as a diagnostic counts them, both included. The first
/// is the line of the stage's first key, or of its `{` in flow form. The last is the line that holds the end of its
/// last value: white space and line breaks after it, a comment on a line of its own and the blank lines before the next
/// stage are not part of the stage. The one exception is a `|+` or `>+` block scalar as the last value, whose kept blank
/// lines are part of the value.
///
/// A workflow with no errors has a mapping at each place of `stages`, so the fallback to line 1 is not reached for
/// one.
fn stage_range(stages: Option<&Seq>, index: usize, text: &str, source_map: &SourceMap) -> Json {
    let (line, end_line) = match stages.and_then(|seq| seq.items.get(index)) {
        Some(Node::Map(stage)) => {
            let start = stage.span.start;
            let last = last_byte_of(stage, text).max(start);
            (
                source_map.position(start).line,
                source_map.position(last.saturating_sub(1).max(start)).line,
            )
        }
        _ => (1, 1),
    };
    let mut range = Json::object();
    range.insert("line", Json::number(line));
    range.insert("end_line", Json::number(end_line));
    range
}

/// The offset just after the last character that belongs to the stage.
fn last_byte_of(stage: &Map, text: &str) -> usize {
    if let Some(Node::Scalar(value)) = stage.entries.last().map(|e| &e.value) {
        if keeps_trailing_lines(text, value.span.start) {
            return after_kept_blank_lines(text, value.span.end);
        }
    }
    text[..stage.span.end.min(text.len())].trim_end().len()
}

/// Whether the text at `at` is the header of a block scalar with the keep indicator, as in `|+` or `>2+`.
fn keeps_trailing_lines(text: &str, at: usize) -> bool {
    let rest = &text[at.min(text.len())..];
    let header = &rest[..rest.find(['\n', '\r']).unwrap_or(rest.len())];
    let mut chars = header.chars();
    matches!(chars.next(), Some('|' | '>'))
        && chars
            .take_while(|c| c.is_ascii_digit() || matches!(c, '+' | '-'))
            .any(|c| c == '+')
}

/// The offset just after the line break of the last blank line that follows the content, or `content_end` when the
/// next line has text on it.
fn after_kept_blank_lines(text: &str, content_end: usize) -> usize {
    let content_end = content_end.min(text.len());
    let Some(mut at) = next_line_start(text, content_end) else {
        return content_end;
    };
    let mut end = content_end;
    while at < text.len() {
        let line_end = text[at..]
            .find(['\n', '\r'])
            .map_or(text.len(), |offset| at + offset);
        if !text[at..line_end].trim().is_empty() {
            break;
        }
        end = next_line_start(text, line_end).unwrap_or(text.len());
        at = end;
    }
    end
}

/// The start of the line after the one that holds `from`, or `None` when that line is the last and has no break.
fn next_line_start(text: &str, from: usize) -> Option<usize> {
    let at = from + text[from..].find(['\n', '\r'])?;
    Some(if text[at..].starts_with("\r\n") {
        at + 2
    } else {
        at + 1
    })
}

/// The path rule of the contract's `Path`, as a regular expression that the whole value matches. It states what
/// [`crate::rules::path_problem`] checks, so a client can test a value before it saves.
const PATH_PATTERN: &str = r"^(?![A-Za-z]:)(?!/)(?:(?!\.{1,2}(?:/|$))[^\\/\x00-\x1f\x7f-\x9f]+)(?:/(?!\.{1,2}(?:/|$))[^\\/\x00-\x1f\x7f-\x9f]+)*$";

/// The longest name, in characters, that [`NAME_PATTERN`] accepts: a first character and up to 63 more.
const MAX_NAME_CHARS: usize = 64;

fn field(key: &str, kind: &str, required: bool) -> Json {
    let mut object = Json::object();
    object.insert("key", Json::str(key));
    object.insert("type", Json::str(kind));
    object.insert("required", Json::Bool(required));
    object
}

fn name_field(key: &str) -> Json {
    let mut object = field(key, "name", true);
    object.insert("max_length", Json::number(MAX_NAME_CHARS));
    object.insert("pattern", Json::str(NAME_PATTERN));
    object
}

fn keys(names: &[&str]) -> Json {
    Json::Array(names.iter().map(|name| Json::str(name)).collect())
}

/// The contract's `stage_fields`: for each kind of stage, the keys a client may edit and what each takes, in the order
/// of the table of stage keys. The first release has one kind, `agent`. The values are the limits that the checker
/// enforces, so a client builds its form from what the engine accepts. It is the same for every text.
pub fn stage_fields() -> Json {
    let mut name = name_field("name");
    name.insert("reserved", keys(&RESERVED_STAGE_NAMES));
    let mut prompt = field("prompt", "text", false);
    prompt.insert("min_length", Json::number(1));
    prompt.insert("max_length", Json::number(MAX_PROMPT_CHARS));
    prompt.insert("excludes", keys(&["prompt_file"]));
    let mut prompt_file = field("prompt_file", "path", false);
    prompt_file.insert("pattern", Json::str(PATH_PATTERN));
    prompt_file.insert("excludes", keys(&["prompt"]));
    let mut kinds = Json::object();
    kinds.insert(
        "agent",
        Json::Array(vec![name, name_field("agent"), prompt, prompt_file]),
    );
    kinds
}

/// The diagnostics as a JSON list.
pub fn diagnostics_json(diagnostics: &[Diagnostic]) -> Json {
    Json::Array(diagnostics.iter().map(Diagnostic::to_json).collect())
}

/// The view of a checked workflow, or `Null` when it has errors.
pub fn checked_view(checked: &Checked, text: &str) -> Json {
    match &checked.workflow {
        Some(workflow) if checked.is_valid() => workflow_view(workflow, text),
        _ => Json::Null,
    }
}

/// The contract's `CheckResponse`. `counts.stages` is the number of stages in `view`, so it is 0 with errors.
pub fn check_response(checked: &Checked, text: &str) -> Json {
    let view = checked_view(checked, text);
    let stages = match &view {
        Json::Null => 0,
        view => view
            .get("stages")
            .and_then(Json::as_array)
            .map_or(0, <[Json]>::len),
    };
    let mut counts = Json::object();
    counts.insert("stages", Json::number(stages));
    let mut summary = Json::object();
    summary.insert("valid", Json::Bool(checked.is_valid()));
    summary.insert("counts", counts);
    let mut root = Json::object();
    root.insert("errors", Json::number(checked.errors()));
    root.insert("warnings", Json::number(0));
    root.insert("infos", Json::number(0));
    root.insert("view", view);
    root.insert("diagnostics", diagnostics_json(&checked.diagnostics));
    root.insert("summary", summary);
    root
}
