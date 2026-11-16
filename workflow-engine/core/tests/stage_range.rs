// SPDX-License-Identifier: Apache-2.0
//! The `kind` and the `range` that the view gives each stage: from the line of its first key to the line that holds
//! the end of its last value, counted as a diagnostic counts lines.

mod common;

use common::check;
use workflow_core::view::checked_view;

const HEAD: &str = "format: konductor/1\nname: t\nversion: 0.1.0\nintent:\n  outcome: Say hello\n";

/// The `[kind, line, end_line]` of each stage of the view.
fn ranges(text: &str) -> Vec<(String, usize, usize)> {
    let view = checked_view(&check(text), text);
    view.get("stages")
        .and_then(|s| s.as_array())
        .unwrap_or_else(|| panic!("no view for {text:?}"))
        .iter()
        .map(|stage| {
            let range = stage.get("range").expect("range");
            (
                stage
                    .get("kind")
                    .and_then(|k| k.as_str())
                    .unwrap()
                    .to_string(),
                range.get("line").and_then(|n| n.as_u64()).unwrap() as usize,
                range.get("end_line").and_then(|n| n.as_u64()).unwrap() as usize,
            )
        })
        .collect()
}

fn agent(line: usize, end_line: usize) -> (String, usize, usize) {
    ("agent".to_string(), line, end_line)
}

#[test]
fn a_stage_runs_from_its_first_key_to_the_end_of_its_last_value() {
    let text =
        format!("{HEAD}stages:\n  - name: write\n    agent: k-developer\n    prompt: Say it.\n");
    assert_eq!(ranges(&text), [agent(7, 9)]);
}

#[test]
fn a_comment_and_blank_lines_after_the_stage_are_not_part_of_it() {
    let text = format!(
        "{HEAD}stages:\n  - name: a\n    agent: k-developer\n\n  # next\n\n  - name: b\n    agent: k-developer\n\n"
    );
    assert_eq!(ranges(&text), [agent(7, 8), agent(12, 13)]);
}

#[test]
fn every_line_of_a_block_scalar_prompt_is_in_the_range() {
    let text = format!("{HEAD}stages:\n  - name: write\n    agent: k-developer\n    prompt: |\n      one\n      two\n");
    assert_eq!(ranges(&text), [agent(7, 11)]);
}

#[test]
fn the_blank_lines_a_keep_block_scalar_holds_are_in_the_range() {
    let text = format!(
        "{HEAD}stages:\n  - name: a\n    agent: k-developer\n    prompt: |+\n      one\n\n\n  - name: b\n    agent: k-developer\n"
    );
    assert_eq!(ranges(&text), [agent(7, 12), agent(13, 14)]);
}

#[test]
fn a_clip_or_strip_block_scalar_ends_at_its_last_line_of_text() {
    for indicator in ["|-", "|"] {
        let text = format!(
            "{HEAD}stages:\n  - name: a\n    agent: k-developer\n    prompt: {indicator}\n      one\n\n  - name: b\n    agent: k-developer\n"
        );
        assert_eq!(ranges(&text), [agent(7, 10), agent(12, 13)], "{indicator}");
    }
}

#[test]
fn a_keep_scalar_at_the_end_of_the_text_takes_the_blank_lines_up_to_it() {
    let text = format!(
        "{HEAD}stages:\n  - name: a\n    agent: k-developer\n    prompt: >+\n      one\n\n"
    );
    assert_eq!(ranges(&text), [agent(7, 11)]);
}

#[test]
fn a_comment_after_a_plain_last_value_stays_on_its_line() {
    let text = format!(
        "{HEAD}stages:\n  - name: a\n    agent: k-developer # tail\n\n  - name: b\n    agent: k-developer\n"
    );
    assert_eq!(ranges(&text), [agent(7, 8), agent(10, 11)]);
}

#[test]
fn crlf_line_ends_and_a_last_line_with_no_line_end_are_counted() {
    let text = format!("{HEAD}stages:\n  - name: a\n    agent: k-developer").replace('\n', "\r\n");
    assert_eq!(ranges(&text), [agent(7, 8)]);
}

#[test]
fn a_stage_written_on_one_line_is_one_line() {
    let text = format!("{HEAD}stages:\n  - {{ name: a, agent: k-developer }}\n");
    assert_eq!(ranges(&text), [agent(7, 7)]);
}

#[test]
fn keep_scalars_read_as_the_stub_reads_them() {
    let cases = [
        ("prompt: |+\n      one\n\n\n", vec![agent(7, 12)]),
        (
            "prompt: |+\n      one\n   \n  - name: b\n    agent: k\n",
            vec![agent(7, 11), agent(12, 13)],
        ),
        (
            "prompt: |+\n      one\n  # c\n\n  - name: b\n    agent: k\n",
            vec![agent(7, 10), agent(13, 14)],
        ),
    ];
    for (tail, want) in cases {
        let text = format!("{HEAD}stages:\n  - name: a\n    agent: k-developer\n    {tail}");
        assert_eq!(ranges(&text), want, "{tail:?}");
    }
}
