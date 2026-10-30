// SPDX-License-Identifier: Apache-2.0
//! The key table: every key the format names, with the one slice that adds it.
//!
//! A build at slice N honors the keys of slices 1 to N. A key of a later slice is reported by name as
//! `NOT_SUPPORTED_BY_THIS_BUILD`, so a file that needs a missing feature fails instead of running without it (D3).
//! A key that no slice plans is not in this table and is `UNKNOWN_KEY`.

use std::fmt;

/// A slice of the plan, or a lettered step of one (`3a`). The order is the order of delivery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Slice {
    number: u8,
    step: Option<char>,
}

impl Slice {
    pub const fn whole(number: u8) -> Slice {
        Slice { number, step: None }
    }

    pub const fn step(number: u8, step: char) -> Slice {
        Slice {
            number,
            step: Some(step),
        }
    }
}

impl fmt::Display for Slice {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.step {
            Some(step) => write!(f, "{}{}", self.number, step),
            None => write!(f, "{}", self.number),
        }
    }
}

/// Which slice this build is. Raising it is how a slice ships.
pub const BUILD_SLICE: Slice = Slice::whole(1);

/// Every slice and step of the plan, in order of delivery. A tag in the key table must be one of these.
pub const ALL_SLICES: [Slice; 16] = [
    Slice::whole(1),
    Slice::whole(2),
    Slice::step(3, 'a'),
    Slice::step(3, 'b'),
    Slice::whole(4),
    Slice::whole(5),
    Slice::whole(6),
    Slice::whole(7),
    Slice::whole(8),
    Slice::whole(9),
    Slice::whole(10),
    Slice::step(11, 'a'),
    Slice::step(11, 'b'),
    Slice::whole(12),
    Slice::whole(13),
    Slice::whole(14),
];

/// One key of the format, written as its key path. `[]` marks a list entry, and `<name>` stands for any name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyEntry {
    pub path: &'static str,
    pub slice: Slice,
    /// The key says what kind of stage this is (`agent`, and later `run`, `uses` and the human stages).
    pub stage_kind: bool,
}

const fn key(path: &'static str, slice: Slice) -> KeyEntry {
    KeyEntry {
        path,
        slice,
        stage_kind: false,
    }
}

const fn kind(path: &'static str, slice: Slice) -> KeyEntry {
    KeyEntry {
        path,
        slice,
        stage_kind: true,
    }
}

const S1: Slice = Slice::whole(1);
const S2: Slice = Slice::whole(2);
const S3A: Slice = Slice::step(3, 'a');
const S3B: Slice = Slice::step(3, 'b');

/// The key table, and the only place that tags a key with a slice.
pub const KEY_TABLE: &[KeyEntry] = &[
    key("format", S1),
    key("name", S1),
    key("version", S1),
    key("intent", S1),
    key("intent.outcome", S1),
    key("intent.accept", S1),
    key("intent.accept[].id", S1),
    key("intent.accept[].file", S1),
    key("intent.accept[].run", S3A),
    key("intent.writes", S3B),
    key("params", S1),
    key("params.goal", S1),
    key("params.goal.description", S1),
    key("params.goal.default", S1),
    key("params.goal.type", S2),
    key("params.goal.required", S2),
    key("params.<name>", S2),
    key("stages", S1),
    key("stages[].name", S1),
    kind("stages[].agent", S1),
    key("stages[].prompt", S1),
    key("stages[].prompt_file", S1),
    key("stages[].outputs", S2),
    key("stages[].done_when", S3A),
    kind("stages[].run", S3B),
    key("stages[].on_fail", Slice::whole(4)),
    key("stages[].max_iterations", Slice::whole(4)),
    key("stages[].on_exhausted", Slice::whole(4)),
    kind("stages[].human_review", Slice::whole(5)),
    kind("stages[].human_input", Slice::whole(5)),
    key("stages[].parallel", Slice::whole(6)),
    kind("stages[].uses", Slice::whole(7)),
    key("stages[].renamed_from", Slice::whole(8)),
    key("stages[].required", Slice::whole(8)),
    key("stages[].effort", Slice::whole(13)),
    key("stages[].model", Slice::whole(13)),
    key("fallback_sop", Slice::step(11, 'b')),
    key("runner_options", Slice::whole(12)),
    key("targets", Slice::whole(14)),
];

/// The string form of `intent` is not a key, so it is tagged here. It arrives with the other planned keys.
pub const INTENT_STRING_FORM: Slice = Slice::whole(13);

/// How a build at `build` treats a key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyStatus {
    /// The build honors the key.
    Honored,
    /// A later slice adds the key.
    Later(Slice),
    /// No slice plans the key.
    Unknown,
}

/// The status of the key `prefix` + `name` for a build at slice `build`. `prefix` is the key path of the mapping that
/// holds the key, ending in `.` or `[].`, and empty for the top level. A name under `params` that is not `goal` is a
/// param, `params.<name>`.
pub fn status(prefix: &str, name: &str, build: Slice) -> KeyStatus {
    let path = format!("{prefix}{name}");
    let entry = KEY_TABLE.iter().find(|e| e.path == path).or_else(|| {
        (prefix == "params.")
            .then(|| KEY_TABLE.iter().find(|e| e.path == "params.<name>"))
            .flatten()
    });
    match entry {
        None => KeyStatus::Unknown,
        Some(e) if e.slice <= build => KeyStatus::Honored,
        Some(e) => KeyStatus::Later(e.slice),
    }
}

/// The table path to show for a key in a message: the key's own path, or `params.<name>` for a param.
pub fn display_path(prefix: &str, name: &str) -> String {
    let path = format!("{prefix}{name}");
    if KEY_TABLE.iter().any(|e| e.path == path) {
        path
    } else if prefix == "params." {
        "params.<name>".to_string()
    } else {
        path
    }
}

/// Whether the key is one that names the kind of a stage.
pub fn is_stage_kind(name: &str) -> bool {
    let path = format!("stages[].{name}");
    KEY_TABLE.iter().any(|e| e.path == path && e.stage_kind)
}

/// The names of the keys directly under `prefix` that a build at `build` honors, in table order. Used to suggest the
/// key that a typo was meant to be.
pub fn honored_names(prefix: &str, build: Slice) -> Vec<&'static str> {
    KEY_TABLE
        .iter()
        .filter(|e| e.slice <= build)
        .filter_map(|e| e.path.strip_prefix(prefix))
        .filter(|rest| {
            !rest.is_empty() && !rest.contains('.') && !rest.contains('[') && !rest.contains('<')
        })
        .collect()
}
