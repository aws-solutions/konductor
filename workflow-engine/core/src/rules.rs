// SPDX-License-Identifier: Apache-2.0
//! Character-level rules: names, versions, paths and the shape of a file's bytes.

use crate::limits::MAX_FILE_BYTES;

/// Stage names that the canvas uses as graph markers.
pub const RESERVED_STAGE_NAMES: [&str; 4] = ["start", "end", "run", "halt"];

/// The text of a name pattern, for messages.
pub const NAME_RULE: &str =
    "must use lower-case letters, digits and hyphens, start with a letter or digit, and have at most 64 characters";

/// `^[a-z0-9][a-z0-9-]{0,63}$`: workflow names, stage names, check ids and agent ids.
pub fn is_name(text: &str) -> bool {
    let mut chars = text.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_lowercase() || first.is_ascii_digit())
        && text.len() <= 64
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A stage name that is not one of the canvas markers.
pub fn is_reserved_stage_name(text: &str) -> bool {
    RESERVED_STAGE_NAMES.contains(&text)
}

/// Semantic version core, `X.Y.Z`. Each part is a number with no leading zero. A pre-release or build part is not
/// accepted.
pub fn is_semver(text: &str) -> bool {
    let parts: Vec<&str> = text.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|b| b.is_ascii_digit())
                && (part.len() == 1 || !part.starts_with('0'))
        })
}

/// Why a path breaks the path rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathProblem {
    Empty,
    Absolute,
    Backslash,
    ParentSegment,
    /// An empty segment (`a//b`, a trailing `/`) or a `.` segment (`./a`).
    UnnormalizedSegment,
    ControlCharacter,
}

impl PathProblem {
    /// A short phrase for a message, such as "is absolute".
    pub fn reason(self) -> &'static str {
        match self {
            PathProblem::Empty => "is empty",
            PathProblem::Absolute => "is absolute",
            PathProblem::Backslash => "uses a backslash, and a path uses `/`",
            PathProblem::ParentSegment => "has a `..` segment",
            PathProblem::UnnormalizedSegment => "has an empty or `.` segment",
            PathProblem::ControlCharacter => "has a control character",
        }
    }
}

/// The path rules: relative, `/` as the separator, no `..` segment, not absolute.
pub fn path_problem(path: &str) -> Option<PathProblem> {
    if path.is_empty() {
        return Some(PathProblem::Empty);
    }
    if path.chars().any(|c| c.is_control()) {
        return Some(PathProblem::ControlCharacter);
    }
    if path.contains('\\') {
        return Some(PathProblem::Backslash);
    }
    if path.starts_with('/') || has_drive_letter(path) {
        return Some(PathProblem::Absolute);
    }
    if path.split('/').any(|segment| segment == "..") {
        return Some(PathProblem::ParentSegment);
    }
    // An empty segment (`a//b`, a trailing `/`) or a `.` segment (`./a`) is refused too, so a later step never has to
    // normalize a path. The path rule is in workflows-spec.md, under "Rules for every file".
    if path
        .split('/')
        .any(|segment| segment.is_empty() || segment == ".")
    {
        return Some(PathProblem::UnnormalizedSegment);
    }
    None
}

fn has_drive_letter(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

/// The text of a file's bytes, or `None` when the engine treats the file as not there: over the size limit, or not
/// UTF-8.
pub fn decode_file(bytes: Vec<u8>) -> Option<String> {
    if bytes.len() > MAX_FILE_BYTES {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// The number of code points in a text, which is how every length limit counts.
pub fn code_points(text: &str) -> usize {
    text.chars().count()
}

/// The byte ranges of the template references in a text: `{`, a name, `.`, a name, `}`, as the spec's pattern
/// `\{[a-z0-9][a-z0-9-]*\.[a-z_][a-z0-9_-]*\}` says. Any other `{` or `}` is literal. One pass: an attempt stops at the
/// first byte that cannot continue it, and the next attempt starts there, so the cost is linear in the text.
pub fn template_references(text: &str) -> Vec<std::ops::Range<usize>> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'{' {
            i += 1;
            continue;
        }
        match reference_end(bytes, i) {
            Ok(end) => {
                found.push(i..end);
                i = end;
            }
            // Resume at the byte that broke the match, which may itself be a `{`.
            Err(stopped) => i = stopped.max(i + 1),
        }
    }
    found
}

/// The end of a reference that starts at `open`, or the index where the match failed.
fn reference_end(bytes: &[u8], open: usize) -> Result<usize, usize> {
    let at = |i: usize| bytes.get(i).copied();
    let mut i = open + 1;
    if !matches!(at(i), Some(b'a'..=b'z' | b'0'..=b'9')) {
        return Err(i);
    }
    i += 1;
    while matches!(at(i), Some(b'a'..=b'z' | b'0'..=b'9' | b'-')) {
        i += 1;
    }
    if at(i) != Some(b'.') {
        return Err(i);
    }
    i += 1;
    if !matches!(at(i), Some(b'a'..=b'z' | b'_')) {
        return Err(i);
    }
    i += 1;
    while matches!(at(i), Some(b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-')) {
        i += 1;
    }
    if at(i) == Some(b'}') {
        Ok(i + 1)
    } else {
        Err(i)
    }
}
