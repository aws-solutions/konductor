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
