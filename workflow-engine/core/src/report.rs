// SPDX-License-Identifier: Apache-2.0
//! Problems found while loading and checking a file, and their conversion into diagnostics.

use crate::diagnostic::{Code, Diagnostic};
use crate::source_map::SourceMap;

/// A range of bytes in the text. `end` is the first byte after the range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Span {
        Span { start, end }
    }

    pub fn is_empty(&self) -> bool {
        self.end <= self.start
    }
}

/// A step in a key path: a key, or the place of a list entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Seg {
    Key(String),
    Index(usize),
}

/// A finding, before its path and position are put into the form of a diagnostic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Problem {
    pub code: Code,
    pub path: Vec<Seg>,
    pub span: Span,
    pub message: String,
    pub suggestion: Option<String>,
}

impl Problem {
    pub fn new(code: Code, path: &[Seg], span: Span, message: impl Into<String>) -> Problem {
        Problem {
            code,
            path: path.to_vec(),
            span,
            message: message.into(),
            suggestion: None,
        }
    }

    pub fn with_suggestion(mut self, suggestion: impl Into<String>) -> Problem {
        self.suggestion = Some(suggestion.into());
        self
    }
}

/// Names a value in a message only if it is short and plain. A longer value, or a value of 12 or more characters with a
/// digit in it, may be an access key, a token or a hash, so it is never echoed.
pub fn quote(text: &str) -> String {
    let plain = !text.is_empty()
        && text.chars().count() <= 24
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '~' | '-'));
    let long_with_digit = text.chars().count() >= 12 && text.chars().any(|c| c.is_ascii_digit());
    if plain && !long_with_digit && !has_secret_prefix(text) {
        format!("`{text}`")
    } else {
        "(not shown)".to_string()
    }
}

// Prefixes that credentials of well-known services start with.
fn has_secret_prefix(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [
        "akia",
        "asia",
        "ghp_",
        "gho_",
        "ghs_",
        "github_pat_",
        "xox",
        "sk-",
        "eyj",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
}

/// Turns problems into diagnostics, in the order of the text. `stage_names` holds, for each place in the `stages`
/// list, the name that addresses the stage in a path, or `None` when its name is missing, malformed or already used.
pub fn to_diagnostics(
    problems: Vec<Problem>,
    file: &str,
    map: &SourceMap,
    stage_names: &[Option<String>],
) -> Vec<Diagnostic> {
    let mut ordered: Vec<(usize, Problem)> =
        problems.into_iter().map(|p| (p.span.start, p)).collect();
    // A stable sort keeps the order of discovery for findings at one place.
    ordered.sort_by_key(|(start, _)| *start);
    ordered
        .into_iter()
        .map(|(_, problem)| {
            let start = map.position(problem.span.start);
            let end = map.position(problem.span.end.max(problem.span.start));
            Diagnostic {
                code: problem.code,
                severity: problem.code.severity(),
                file: file.to_string(),
                path: format_path(&problem.path, stage_names),
                line: start.line,
                column: start.column,
                end_line: end.line,
                end_column: end.column,
                message: problem.message,
                suggestion: problem.suggestion,
            }
        })
        .collect()
}

fn format_path(path: &[Seg], stage_names: &[Option<String>]) -> String {
    let mut out = String::new();
    for (n, seg) in path.iter().enumerate() {
        match seg {
            Seg::Key(key) => {
                if !out.is_empty() {
                    out.push('.');
                }
                out.push_str(key);
            }
            Seg::Index(index) => {
                let after_stages = n > 0 && path[n - 1] == Seg::Key("stages".to_string());
                match stage_names.get(*index).and_then(Option::as_ref) {
                    Some(name) if after_stages => {
                        out.push('.');
                        out.push_str(name);
                    }
                    _ => out.push_str(&format!("[{index}]")),
                }
            }
        }
    }
    out
}
