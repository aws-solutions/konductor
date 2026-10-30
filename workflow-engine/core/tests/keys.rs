// SPDX-License-Identifier: Apache-2.0
//! The key table: one slice tag per key, and the subset rule (D3): a build at slice N honors the keys of slices 1 to N,
//! and names the slice of any later key.

mod common;

use std::collections::BTreeMap;

use common::{check, codes, VALID};
use workflow_core::keys::{
    is_stage_kind, status, KeyStatus, Slice, ALL_SLICES, BUILD_SLICE, INTENT_STRING_FORM, KEY_TABLE,
};
use workflow_core::Code;

/// Every key the spec names, with its slice: "Keys", "Reserved keys" and "Planned keys". The keys marked `*` are
/// where the spec leaves the slice open and the table makes a choice (see the notes in the pull request).
const SPEC_KEYS: &[(&str, &str)] = &[
    ("format", "1"),
    ("name", "1"),
    ("version", "1"),
    ("intent", "1"),
    ("intent.outcome", "1"),
    ("intent.accept", "1"),
    ("intent.accept[].id", "1"),
    ("intent.accept[].file", "1"),
    ("intent.accept[].run", "3a"),
    ("params", "1"),
    ("params.goal", "1"),
    ("params.goal.description", "1"),
    ("params.goal.default", "1"),
    ("params.goal.type", "2"),     // *
    ("params.goal.required", "2"), // *
    ("params.<name>", "2"),
    ("stages", "1"),
    ("stages[].name", "1"),
    ("stages[].agent", "1"),
    ("stages[].prompt", "1"),
    ("stages[].prompt_file", "1"),
    ("stages[].outputs", "2"),
    ("stages[].done_when", "3a"),
    ("intent.writes", "3b"),
    ("stages[].run", "3b"),
    ("stages[].on_fail", "4"),
    ("stages[].max_iterations", "4"),
    ("stages[].on_exhausted", "4"),
    ("stages[].human_review", "5"),
    ("stages[].human_input", "5"),
    ("stages[].parallel", "6"),
    ("stages[].uses", "7"),
    ("stages[].renamed_from", "8"),
    ("stages[].required", "8"),
    ("fallback_sop", "11b"),
    ("runner_options", "12"),
    ("stages[].effort", "13"),
    ("stages[].model", "13"),
    ("targets", "14"),
];

#[test]
fn every_key_has_exactly_one_slice_tag() {
    let mut seen: BTreeMap<&str, usize> = BTreeMap::new();
    for entry in KEY_TABLE {
        *seen.entry(entry.path).or_default() += 1;
    }
    let twice: Vec<_> = seen.iter().filter(|(_, n)| **n != 1).collect();
    assert_eq!(twice, Vec::<(&&str, &usize)>::new(), "a key with two tags");
}

#[test]
fn every_tag_is_a_slice_of_the_plan() {
    for entry in KEY_TABLE {
        assert!(
            ALL_SLICES.contains(&entry.slice),
            "{} has the tag {}",
            entry.path,
            entry.slice
        );
    }
    assert!(ALL_SLICES.contains(&BUILD_SLICE));
    assert!(ALL_SLICES.contains(&INTENT_STRING_FORM));
}

#[test]
fn the_slices_are_in_order_of_delivery_and_print_as_the_plan_writes_them() {
    let mut sorted = ALL_SLICES;
    sorted.sort();
    assert_eq!(sorted, ALL_SLICES);
    let names: Vec<String> = ALL_SLICES.iter().map(Slice::to_string).collect();
    assert_eq!(
        names,
        [
            "1", "2", "3a", "3b", "4", "5", "6", "7", "8", "9", "10", "11a", "11b", "12", "13",
            "14"
        ]
    );
    assert!(Slice::step(3, 'a') < Slice::step(3, 'b'));
    assert!(Slice::step(3, 'b') < Slice::whole(4));
    assert!(Slice::whole(2) < Slice::step(3, 'a'));
}

#[test]
fn the_table_holds_exactly_the_keys_of_the_spec_with_the_slices_of_the_spec() {
    let table: BTreeMap<&str, String> = KEY_TABLE
        .iter()
        .map(|e| (e.path, e.slice.to_string()))
        .collect();
    let spec: BTreeMap<&str, String> = SPEC_KEYS.iter().map(|(k, s)| (*k, s.to_string())).collect();
    assert_eq!(table, spec);
}

#[test]
fn a_build_at_each_slice_honors_the_keys_up_to_it_and_names_the_slice_of_the_rest() {
    for build in ALL_SLICES {
        for entry in KEY_TABLE {
            let (prefix, name) = split(entry.path);
            let expected = if entry.slice <= build {
                KeyStatus::Honored
            } else {
                KeyStatus::Later(entry.slice)
            };
            assert_eq!(
                status(&prefix, &name, build),
                expected,
                "{} at slice {build}",
                entry.path
            );
        }
    }
}

/// A key path as the prefix of its mapping and its own name, as the checker looks keys up. A `params.<name>` entry is
/// looked up by any name under `params.`.
fn split(path: &str) -> (String, String) {
    if path == "params.<name>" {
        return ("params.".into(), "some_param".into());
    }
    match path.rfind(['.', ']']) {
        Some(at) if path.as_bytes()[at] == b'.' => {
            (path[..=at].to_string(), path[at + 1..].to_string())
        }
        Some(at) => (path[..=at].to_string(), String::new()),
        None => (String::new(), path.to_string()),
    }
}

#[test]
fn a_key_that_no_slice_plans_is_unknown_at_every_build() {
    for build in ALL_SLICES {
        assert_eq!(status("", "bogus", build), KeyStatus::Unknown);
        assert_eq!(status("stages[].", "bogus", build), KeyStatus::Unknown);
        assert_eq!(status("intent.", "description", build), KeyStatus::Unknown);
    }
}

#[test]
fn the_stage_kind_keys_are_agent_and_the_kinds_of_later_slices() {
    for name in ["agent", "run", "human_review", "human_input", "uses"] {
        assert!(is_stage_kind(name), "{name}");
    }
    for name in [
        "name",
        "prompt",
        "prompt_file",
        "outputs",
        "done_when",
        "parallel",
        "bogus",
    ] {
        assert!(!is_stage_kind(name), "{name}");
    }
}

// --- The checker names the slice of each later key -------------------------------------------------------------------

/// The base workflow with the key at `path` added, written the way the key is written.
fn with_key(path: &str) -> String {
    let edit = |from: &str, to: &str| VALID.replacen(from, to, 1);
    match path {
        "params.<name>" => format!("{VALID}params:\n  diff_input:\n    description: x\n"),
        "intent.accept[].run" => edit(
            "  outcome: Do it.",
            "  outcome: Do it.\n  accept:\n    - id: a\n      run: [make, test]",
        ),
        _ if path.starts_with("intent.accept[].") => {
            let key = path.trim_start_matches("intent.accept[].");
            edit(
                "  outcome: Do it.",
                &format!("  outcome: Do it.\n  accept:\n    - id: a\n      {key}: x"),
            )
        }
        _ if path.starts_with("intent.") => {
            let key = path.trim_start_matches("intent.");
            edit(
                "  outcome: Do it.",
                &format!("  outcome: Do it.\n  {key}: x"),
            )
        }
        _ if path.starts_with("params.goal.") => {
            let key = path.trim_start_matches("params.goal.");
            format!("{VALID}params:\n  goal:\n    {key}: x\n")
        }
        _ if path.starts_with("stages[].") => {
            let key = path.trim_start_matches("stages[].");
            edit(
                "    agent: k-architect",
                &format!("    agent: k-architect\n    {key}: x"),
            )
        }
        _ => format!("{VALID}{path}: x\n"),
    }
}

#[test]
fn a_key_of_a_later_slice_is_not_supported_and_the_message_names_its_slice() {
    for entry in KEY_TABLE.iter().filter(|e| e.slice > BUILD_SLICE) {
        let checked = check(&with_key(entry.path));
        let reported: Vec<_> = checked
            .diagnostics
            .iter()
            .filter(|d| d.code == Code::NotSupportedByThisBuild)
            .collect();
        assert_eq!(
            reported.len(),
            1,
            "{}: {:#?}",
            entry.path,
            checked.diagnostics
        );
        let message = &reported[0].message;
        assert!(
            message.contains(&format!("slice {}", entry.slice)),
            "{}: {message}",
            entry.path
        );
        assert!(
            message.contains(&format!("`{}`", entry.path)),
            "{}: {message}",
            entry.path
        );
        assert!(
            message.contains("this build is slice 1"),
            "{}: {message}",
            entry.path
        );
        assert!(
            !checked
                .diagnostics
                .iter()
                .any(|d| d.code == Code::UnknownKey),
            "{}",
            entry.path
        );
    }
}

#[test]
fn a_key_of_this_slice_is_never_reported_as_not_supported() {
    for entry in KEY_TABLE.iter().filter(|e| e.slice <= BUILD_SLICE) {
        let checked = check(&with_key(entry.path));
        assert!(
            !codes(&checked).contains(&"NOT_SUPPORTED_BY_THIS_BUILD")
                && !codes(&checked).contains(&"UNKNOWN_KEY"),
            "{}: {:#?}",
            entry.path,
            checked.diagnostics
        );
    }
}

#[test]
fn a_later_key_is_not_read_into_so_nothing_inside_it_is_reported() {
    let text = VALID.replacen(
        "    agent: k-architect",
        "    agent: k-architect\n    outputs:\n      Bad-Name: [not, a, path]\n      other: {a: 1}",
        1,
    );
    assert_eq!(codes(&check(&text)), ["NOT_SUPPORTED_BY_THIS_BUILD"]);
}

#[test]
fn the_slice_of_the_message_matches_the_reserved_keys_table_of_the_spec() {
    for (path, tag) in SPEC_KEYS.iter().filter(|(_, tag)| *tag != "1") {
        let checked = check(&with_key(path));
        let message = checked
            .diagnostics
            .iter()
            .find(|d| d.code == Code::NotSupportedByThisBuild)
            .map(|d| d.message.clone())
            .unwrap_or_default();
        assert!(
            message.contains(&format!("slice {tag}")),
            "{path}: {message}"
        );
    }
}
