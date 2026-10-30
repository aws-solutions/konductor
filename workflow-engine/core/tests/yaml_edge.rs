// SPDX-License-Identifier: Apache-2.0
//! The loader on the shapes of text that are easy to get wrong: nesting, byte order marks, non-ASCII text, line ends,
//! quoted and block scalars, and size.

mod common;

use common::{check, codes, only, place, VALID};
use workflow_core::rules::decode_file;
use workflow_core::yaml::{resolve_plain, ScalarKind};
use workflow_core::Code;

fn edit(from: &str, to: &str) -> String {
    assert!(VALID.contains(from), "{from:?} is not in the base workflow");
    VALID.replacen(from, to, 1)
}

// --- Nesting ---------------------------------------------------------------------------------------------------------

/// A workflow with an unknown key `x` whose value is `levels` lists inside each other. The root is level 1.
fn nested_lists(levels: usize) -> String {
    format!("{VALID}x: {}{}\n", "[".repeat(levels), "]".repeat(levels))
}

#[test]
fn yaml_nested_to_the_limit_is_read_and_one_level_deeper_is_not() {
    // The root mapping is level 1, so 31 lists make level 32.
    assert_eq!(codes(&check(&nested_lists(31))), ["UNKNOWN_KEY"]);
    let checked = check(&nested_lists(32));
    let d = only(&checked);
    assert_eq!(d.code, Code::YamlUnsupported);
    assert!(d.message.contains("32 levels"), "{}", d.message);
    assert_eq!(d.path, format!("x{}", "[0]".repeat(31)));
}

#[test]
fn yaml_nested_far_past_the_limit_stops_at_the_limit() {
    // Past what the parser itself allows. The builder stops first, so this is not a syntax error.
    for levels in [100, 255, 400, 3000] {
        let checked = check(&nested_lists(levels));
        assert_eq!(codes(&checked), ["YAML_UNSUPPORTED"], "{levels} levels");
    }
}

#[test]
fn block_mappings_nested_past_the_limit_are_refused_too() {
    let mut text = String::from(VALID);
    text.push_str("x:\n");
    for depth in 1..=40 {
        text.push_str(&format!("{}k{depth}:\n", "  ".repeat(depth)));
    }
    let checked = check(&text);
    assert_eq!(codes(&checked), ["YAML_UNSUPPORTED"]);
}

#[test]
fn a_nested_key_that_is_not_a_scalar_is_refused_without_reading_it_to_the_end() {
    let key = |levels: usize| {
        format!(
            "{VALID}? {}{}\n: 1\n",
            "[".repeat(levels),
            "]".repeat(levels)
        )
    };
    let checked = check(&key(5));
    assert_eq!(codes(&checked), ["YAML_UNSUPPORTED"]);
    assert_eq!(only(&checked).message, "A key must be a plain value.");
    // Skipping the key counts its levels too, so a key nested past the limit stops the read.
    let checked = check(&key(100));
    assert_eq!(codes(&checked), ["YAML_UNSUPPORTED", "YAML_UNSUPPORTED"]);
}

// --- Byte order mark -------------------------------------------------------------------------------------------------

#[test]
fn a_byte_order_mark_is_accepted_and_takes_no_column() {
    let text = format!("\u{feff}{VALID}");
    assert_eq!(check(&text).diagnostics, vec![]);
    let checked = check(&format!("\u{feff}bogus: 1\n{VALID}"));
    let d = only(&checked);
    assert_eq!(d.code, Code::UnknownKey);
    assert_eq!(place(d), (1, 1, 1, 6));
}

// --- Non-ASCII text --------------------------------------------------------------------------------------------------

#[test]
fn non_ascii_text_is_accepted_and_columns_count_code_points() {
    let line = "intent: {outcome: \"é😀x\", bogus: 1}";
    let text = VALID.replace("intent:\n  outcome: Do it.", line);
    let checked = check(&text);
    let d = only(&checked);
    assert_eq!(d.code, Code::UnknownKey);
    let expected = line
        .find("bogus")
        .map(|byte| line[..byte].chars().count() + 1)
        .expect("bogus");
    assert_eq!(d.line, 3);
    assert_eq!(d.column, expected);
    assert_eq!(d.end_column, expected + "bogus".len());
}

#[test]
fn a_syntax_error_after_non_ascii_text_has_the_right_column() {
    // The error is at the `]` on line 2, after 12 code points of 2- to 4-byte characters.
    let checked = check("a: [é, 😀, ñ, x]\nb: ]\n");
    let d = only(&checked);
    assert_eq!(d.code, Code::YamlSyntax);
    assert_eq!(d.line, 2);
}

#[test]
fn non_ascii_keys_and_names_are_handled() {
    let checked = check(&format!("{VALID}clé: 1\n"));
    let d = only(&checked);
    assert_eq!(d.code, Code::UnknownKey);
    assert!(d.message.contains("(not shown)"), "{}", d.message);
    let checked = check(&edit("name: plan", "name: plán"));
    assert_eq!(codes(&checked), ["INVALID_NAME"]);
}

// --- Line ends -------------------------------------------------------------------------------------------------------

#[test]
fn crlf_line_ends_are_accepted_and_lines_are_counted_once_per_break() {
    let text = VALID.replace('\n', "\r\n");
    assert_eq!(check(&text).diagnostics, vec![]);
    let broken = edit("version: 0.1.0", "version: '1.1'").replace('\n', "\r\n");
    let d_checked = check(&broken);
    let d = only(&d_checked);
    assert_eq!(d.code, Code::InvalidValue);
    assert_eq!(place(d), (2, 10, 2, 15));
}

#[test]
fn a_lone_carriage_return_is_a_line_break() {
    let broken = edit("version: 0.1.0", "version: '1.1'").replace('\n', "\r");
    let checked = check(&broken);
    let d = only(&checked);
    assert_eq!(d.code, Code::InvalidValue);
    assert_eq!(place(d), (2, 10, 2, 15));
}

#[test]
fn the_last_line_needs_no_line_break() {
    let text = VALID.trim_end_matches('\n');
    assert_eq!(check(text).diagnostics, vec![]);
}

// --- Quoted values and comments --------------------------------------------------------------------------------------

#[test]
fn a_quoted_value_followed_by_a_comment_ends_at_its_closing_quote() {
    for (value, width) in [
        ("\"1.1\" # note", 5),
        ("'1.1' # note", 5),
        ("\"1.1\"   # a \" quote in a comment", 5),
    ] {
        let checked = check(&edit("version: 0.1.0", &format!("version: {value}")));
        let d = only(&checked);
        assert_eq!(d.code, Code::InvalidValue, "{value}");
        assert_eq!(place(d), (2, 10, 2, 10 + width), "{value}");
    }
}

#[test]
fn quotes_with_escapes_end_at_the_right_quote() {
    // `\"` inside double quotes and `''` inside single quotes do not end the scalar.
    let checked = check(&edit("version: 0.1.0", "version: \"a\\\"b\" # c"));
    assert_eq!(place(only(&checked)), (2, 10, 2, 16));
    let checked = check(&edit("version: 0.1.0", "version: 'it''s' # c"));
    assert_eq!(place(only(&checked)), (2, 10, 2, 17));
}

#[test]
fn a_plain_value_followed_by_a_comment_ends_with_the_value() {
    let checked = check(&edit("version: 0.1.0", "version: 1.2   # note"));
    assert_eq!(place(only(&checked)), (2, 10, 2, 13));
    assert_eq!(only(&checked).code, Code::WrongType);
}

#[test]
fn a_multi_line_quoted_value_spans_its_lines() {
    let checked = check(&edit("version: 0.1.0", "version: \"one\n  two\" # c"));
    let d = only(&checked);
    assert_eq!(d.code, Code::InvalidValue);
    assert_eq!(place(d), (2, 10, 3, 7));
}

#[test]
fn an_empty_value_is_reported_at_its_key() {
    let checked = check(&edit("version: 0.1.0", "version:"));
    let d = only(&checked);
    assert_eq!(d.code, Code::WrongType);
    assert_eq!(place(d), (2, 1, 2, 8));
}

// --- Block scalars ---------------------------------------------------------------------------------------------------

#[test]
fn a_block_scalar_is_read_and_its_span_runs_from_the_header_to_the_last_content_line() {
    let checked = check(&edit(
        "outcome: Do it.",
        "outcome: |\n    first\n    second\n",
    ));
    let d = only(&checked);
    assert_eq!(d.code, Code::InvalidValue); // two lines
    assert_eq!(place(d), (4, 12, 6, 11));
}

#[test]
fn a_block_scalar_header_may_carry_indicators_and_a_comment() {
    for header in ["|-", ">-", "|2-", ">+", "|- # note | with a pipe"] {
        let checked = check(&edit(
            "outcome: Do it.",
            &format!("outcome: {header}\n    Do it.\n"),
        ));
        let kept = !header.contains('+');
        let expected = if kept { vec![] } else { vec!["INVALID_VALUE"] };
        assert_eq!(codes(&checked), expected, "{header}");
    }
    let checked = check(&edit(
        "outcome: Do it.",
        "outcome: |+ # c\n    Do it.\n\n\n",
    ));
    let d = only(&checked);
    assert_eq!(place(d), (4, 12, 5, 11));
}

#[test]
fn a_folded_prompt_is_one_line_and_a_literal_prompt_keeps_its_lines() {
    let text = edit(
        "agent: k-architect",
        "agent: k-architect\n    prompt: >-\n      one\n      two\n  - name: dev\n    agent: k-developer\n    prompt: |\n      a\n      b\n",
    );
    let workflow = check(&text).workflow.expect("workflow");
    assert_eq!(workflow.stages[0].prompt.as_deref(), Some("one two"));
    assert_eq!(workflow.stages[1].prompt.as_deref(), Some("a\nb\n"));
}

#[test]
fn a_block_scalar_in_a_list_is_read() {
    let text = edit(
        "  outcome: Do it.",
        "  outcome: Do it.\n  accept:\n    - id: a\n      file: |-\n        A.md",
    );
    assert_eq!(check(&text).diagnostics, vec![]);
}

// --- Flow collections ------------------------------------------------------------------------------------------------

#[test]
fn a_flow_collection_ends_at_its_closing_bracket_not_at_a_comment_after_it() {
    let checked = check(&edit("stages:", "stages: []  # none\nxstages:"));
    // `stages: []` is an empty list: INVALID_VALUE at the list, which ends at `]`.
    let d = checked
        .diagnostics
        .iter()
        .find(|d| d.code == Code::InvalidValue)
        .expect("invalid value");
    assert_eq!(place(d), (5, 9, 5, 11));
}

#[test]
fn flow_style_is_read_like_block_style() {
    let text = "{format: konductor/1, version: 0.1.0, intent: {outcome: Do it.}, stages: [{name: plan, agent: k-architect}]}";
    assert_eq!(check(text).diagnostics, vec![]);
}

// --- Directives, comments and keys -----------------------------------------------------------------------------------

#[test]
fn comments_and_blank_lines_anywhere_are_ignored() {
    let text = format!(
        "# header\n\n{}\n# footer\n",
        VALID.replace("intent:", "intent: # about\n  # inside")
    );
    assert_eq!(check(&text).diagnostics, vec![]);
}

#[test]
fn an_explicit_document_start_marker_is_one_document() {
    assert_eq!(check(&format!("---\n{VALID}...\n")).diagnostics, vec![]);
}

// --- Size ------------------------------------------------------------------------------------------------------------

#[test]
fn a_file_over_the_size_limit_is_treated_as_not_there() {
    assert!(decode_file(vec![b'a'; 262_144]).is_some());
    assert!(decode_file(vec![b'a'; 262_145]).is_none());
    assert!(decode_file(vec![0xff, 0xfe]).is_none());
    assert_eq!(decode_file(Vec::new()), Some(String::new()));
}

#[test]
fn a_file_near_the_size_limit_is_read_in_good_time() {
    let padding_lines = (262_144 - VALID.len()) / 80;
    let mut text = String::new();
    for _ in 0..padding_lines {
        text.push_str(&format!("#{}\n", "x".repeat(78)));
    }
    text.push_str(VALID);
    assert!(
        text.len() <= 262_144 && text.len() > 262_000,
        "{}",
        text.len()
    );
    let started = std::time::Instant::now();
    assert_eq!(check(&text).diagnostics, vec![]);
    assert!(started.elapsed().as_secs() < 5);
}

#[test]
fn a_near_limit_file_of_many_keys_is_read() {
    let mut text = String::from(VALID);
    let mut n = 0;
    while text.len() < 262_000 {
        text.push_str(&format!("k{n}: v\n"));
        n += 1;
    }
    let checked = check(&text);
    assert_eq!(checked.diagnostics.len(), n);
    assert!(checked
        .diagnostics
        .iter()
        .all(|d| d.code == Code::UnknownKey));
}

// --- Scalars of the core schema --------------------------------------------------------------------------------------

#[test]
fn plain_scalars_resolve_as_in_the_yaml_1_2_core_schema() {
    for text in ["", "~", "null", "Null", "NULL"] {
        assert_eq!(resolve_plain(text), ScalarKind::Null, "{text:?}");
    }
    for text in ["true", "True", "TRUE", "false", "False", "FALSE"] {
        assert_eq!(resolve_plain(text), ScalarKind::Bool, "{text}");
    }
    for text in ["0", "12", "-12", "+12", "0o17", "0xFF", "0xff"] {
        assert_eq!(resolve_plain(text), ScalarKind::Int, "{text}");
    }
    for text in [
        "1.5", "-1.5", ".5", "1.", "1e3", "1.5E-3", ".inf", "-.Inf", "+.INF", ".nan", ".NaN",
    ] {
        assert_eq!(resolve_plain(text), ScalarKind::Float, "{text}");
    }
    // YAML 1.1 booleans and sexagesimal numbers are plain strings here.
    for text in [
        "yes",
        "no",
        "on",
        "off",
        "y",
        "n",
        "Yes",
        "NO",
        "0.1.0",
        "1.2.3",
        "1_000",
        "0b101",
        "0o8",
        "0x",
        "e3",
        ".",
        "-",
        "+",
        "1e",
        "1e+",
        "--1",
        "12abc",
        "nan",
        "inf",
        "0.1.0-rc.1",
        "1:30",
    ] {
        assert_eq!(resolve_plain(text), ScalarKind::Str, "{text}");
    }
}

#[test]
fn only_true_and_false_are_booleans_so_yes_on_and_off_are_strings() {
    for word in ["yes", "no", "on", "off"] {
        let checked = check(&edit("agent: k-architect", &format!("agent: {word}")));
        assert_eq!(checked.diagnostics, vec![], "{word}");
    }
    for word in ["true", "false"] {
        let checked = check(&edit("agent: k-architect", &format!("agent: {word}")));
        assert_eq!(codes(&checked), ["WRONG_TYPE"], "{word}");
    }
}

#[test]
fn quoted_scalars_are_strings_whatever_they_look_like() {
    // These are valid names, because they are strings. Unquoted they would be a boolean, a number and a null.
    for value in ["'true'", "\"123\"", "'null'"] {
        let checked = check(&edit("agent: k-architect", &format!("agent: {value}")));
        assert_eq!(checked.diagnostics, vec![], "{value}");
    }
    let checked = check(&edit("agent: k-architect", "agent: '~'"));
    assert_eq!(codes(&checked), ["INVALID_NAME"]);
}

// --- Messages --------------------------------------------------------------------------------------------------------

#[test]
fn a_message_never_carries_a_control_character_from_the_file() {
    let inputs = [
        format!("{VALID}\x1b[31mred: x\n"),
        format!("{VALID}key: \x07\n"),
        format!("{VALID}@\x1b: x\n"),
        format!("{VALID}`\x1b: x\n"),
        format!("{VALID}a: [\x1b]\n"),
        format!("{VALID}\u{85}x: 1\n"),
        format!("{VALID}key: 'unclosed \x1b\n"),
    ];
    let mut syntax_errors = 0;
    for text in &inputs {
        for d in &check(text).diagnostics {
            syntax_errors += usize::from(d.code == Code::YamlSyntax);
            assert!(
                !d.message.chars().any(char::is_control),
                "{:?} in {:?}",
                d.message,
                text
            );
        }
    }
    assert!(syntax_errors > 0, "no input reached a syntax error");
}
