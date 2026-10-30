// SPDX-License-Identifier: Apache-2.0
//! A case for every diagnostic code, and the rules of "Rules for every file" and "Keys".

mod common;

use common::{check, check_with, codes, only, place, MemorySource, VALID};
use workflow_core::Code;

/// `VALID` with one piece of text swapped for another.
fn edit(from: &str, to: &str) -> String {
    assert!(VALID.contains(from), "{from:?} is not in the base workflow");
    VALID.replacen(from, to, 1)
}

#[test]
fn a_valid_workflow_has_no_diagnostics_and_a_resolved_workflow() {
    let checked = check(VALID);
    assert_eq!(checked.diagnostics, vec![]);
    let workflow = checked.workflow.expect("workflow");
    assert_eq!(workflow.name, "t");
    assert_eq!(workflow.version, "0.1.0");
    assert!(workflow.params.contains_key("goal"));
}

#[test]
fn the_codes_are_the_sixteen_of_the_spec_in_its_order() {
    let all: Vec<&str> = Code::ALL.iter().map(|c| c.as_str()).collect();
    assert_eq!(
        all,
        [
            "YAML_SYNTAX",
            "YAML_UNSUPPORTED",
            "NOT_A_MAPPING",
            "UNKNOWN_KEY",
            "DUPLICATE_KEY",
            "MISSING_KEY",
            "WRONG_TYPE",
            "INVALID_NAME",
            "RESERVED_NAME",
            "DUPLICATE_STAGE",
            "NAME_MISMATCH",
            "INVALID_VALUE",
            "UNSUPPORTED_FORMAT",
            "STAGE_KIND_MISSING",
            "STAGE_KIND_AMBIGUOUS",
            "NOT_SUPPORTED_BY_THIS_BUILD",
        ]
    );
}

#[test]
fn every_code_is_raised_by_some_case() {
    let cases: Vec<(Code, String)> = vec![
        (Code::YamlSyntax, "a: [\n".into()),
        (Code::YamlUnsupported, "a: &x 1\n".into()),
        (Code::NotAMapping, "- a\n".into()),
        (Code::UnknownKey, format!("{VALID}zzzzzzzz: 1\n")),
        (
            Code::DuplicateKey,
            edit("version: 0.1.0", "version: 0.1.0\nversion: 0.1.0"),
        ),
        (Code::MissingKey, edit("format: konductor/1\n", "")),
        (Code::WrongType, edit("version: 0.1.0", "version: 1.1")),
        (Code::InvalidName, edit("name: plan", "name: Plan")),
        (Code::ReservedName, edit("name: plan", "name: halt")),
        (
            Code::DuplicateStage,
            format!("{VALID}  - name: plan\n    agent: k-developer\n"),
        ),
        (
            Code::NameMismatch,
            edit("version: 0.1.0", "version: 0.1.0\nname: other"),
        ),
        (Code::InvalidValue, edit("version: 0.1.0", "version: '1.1'")),
        (Code::UnsupportedFormat, edit("konductor/1", "konductor/2")),
        (Code::StageKindMissing, edit("    agent: k-architect\n", "")),
        (
            Code::StageKindAmbiguous,
            edit(
                "    agent: k-architect",
                "    agent: k-architect\n    uses: x",
            ),
        ),
        (
            Code::NotSupportedByThisBuild,
            edit(
                "    agent: k-architect",
                "    agent: k-architect\n    outputs: {a: B.md}",
            ),
        ),
    ];
    for (code, text) in &cases {
        assert!(
            check(text).diagnostics.iter().any(|d| d.code == *code),
            "{} was not raised by its case:\n{text}",
            code.as_str()
        );
    }
    let raised: Vec<Code> = cases.iter().map(|(code, _)| *code).collect();
    assert_eq!(raised, Code::ALL);
}

#[test]
fn every_code_is_an_error() {
    for code in Code::ALL {
        assert_eq!(code.severity().as_str(), "error", "{}", code.as_str());
    }
}

#[test]
fn codes_are_upper_snake_case_and_unique() {
    let names: Vec<&str> = Code::ALL.iter().map(|c| c.as_str()).collect();
    for name in &names {
        assert!(
            name.chars().all(|c| c.is_ascii_uppercase() || c == '_'),
            "{name}"
        );
    }
    let mut sorted = names.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(sorted.len(), names.len());
}

// --- YAML_SYNTAX -----------------------------------------------------------------------------------------------------

#[test]
fn yaml_syntax_for_text_that_is_not_yaml() {
    let checked = check("a: [1\nb: 2\n");
    let d = only(&checked);
    assert_eq!(d.code, Code::YamlSyntax);
    assert_eq!(d.path, "");
    assert_eq!((d.line, d.column), (2, 2));
    assert_eq!((d.end_line, d.end_column), (d.line, d.column));
    assert!(checked.workflow.is_none());
}

#[test]
fn yaml_syntax_is_the_only_finding_when_the_text_is_not_yaml() {
    let checked = check("format: konductor/1\nformat: x\nbad: [\n");
    assert_eq!(codes(&checked), ["YAML_SYNTAX"]);
}

// --- YAML_UNSUPPORTED ------------------------------------------------------------------------------------------------

#[test]
fn yaml_unsupported_for_an_anchor() {
    let checked = check(&edit("outcome: Do it.", "outcome: &x Do it."));
    let d = only(&checked);
    assert_eq!(d.code, Code::YamlUnsupported);
    assert_eq!(d.path, "intent.outcome");
    assert_eq!(d.message, "An anchor is not allowed.");
}

#[test]
fn yaml_unsupported_for_an_alias() {
    let checked = check(&edit("version: 0.1.0", "version: &v 0.1.0\nname: *v"));
    assert_eq!(codes(&checked), ["YAML_UNSUPPORTED", "YAML_UNSUPPORTED"]);
    assert_eq!(
        checked.diagnostics[1].message,
        "A `*` reference is not allowed."
    );
    assert_eq!(checked.diagnostics[1].path, "name");
}

#[test]
fn yaml_unsupported_for_a_tag() {
    let checked = check(&edit("agent: k-architect", "agent: !!str k-architect"));
    let d = only(&checked);
    assert_eq!(d.code, Code::YamlUnsupported);
    assert_eq!(d.path, "stages.plan.agent");
    assert_eq!(d.message, "A tag is not allowed.");
}

#[test]
fn yaml_unsupported_for_a_merge_key() {
    let checked = check(&format!("{VALID}x: 1\n<<: {{a: 1}}\n"));
    let d = checked
        .diagnostics
        .iter()
        .find(|d| d.message == "A merge key is not allowed.")
        .expect("merge key diagnostic");
    assert_eq!(d.code, Code::YamlUnsupported);
}

#[test]
fn a_quoted_merge_key_is_an_ordinary_key() {
    let checked = check(&format!("{VALID}\"<<\": 1\n"));
    assert_eq!(codes(&checked), ["UNKNOWN_KEY"]);
}

#[test]
fn yaml_unsupported_for_a_second_document() {
    let checked = check(&format!("{VALID}---\nsecond: doc\n"));
    let d = only(&checked);
    assert_eq!(d.code, Code::YamlUnsupported);
    assert_eq!(d.message, "Only one YAML document is allowed.");
    // From its `---` line to the end of its content.
    assert_eq!(place(d), (8, 1, 9, 12));
}

#[test]
fn yaml_unsupported_for_every_extra_document() {
    let checked = check(&format!("{VALID}---\na: 1\n---\nb: 2\n"));
    assert_eq!(codes(&checked), ["YAML_UNSUPPORTED", "YAML_UNSUPPORTED"]);
}

#[test]
fn yaml_unsupported_for_a_key_that_is_not_a_scalar() {
    let checked = check(&format!("{VALID}? [a]\n: 1\n"));
    let d = only(&checked);
    assert_eq!(d.code, Code::YamlUnsupported);
    assert_eq!(d.message, "A key must be a plain value.");
}

// --- NOT_A_MAPPING ---------------------------------------------------------------------------------------------------

#[test]
fn not_a_mapping_for_empty_text() {
    for text in ["", "\n\n", "# only a comment\n"] {
        let checked = check(text);
        let d = only(&checked);
        assert_eq!(d.code, Code::NotAMapping, "{text:?}");
        assert_eq!(place(d), (1, 1, 1, 1), "{text:?}");
    }
}

#[test]
fn not_a_mapping_for_a_list_or_a_scalar_at_the_root() {
    for text in ["- a\n- b\n", "hello\n"] {
        let checked = check(text);
        let d = only(&checked);
        assert_eq!(d.code, Code::NotAMapping, "{text:?}");
        assert_eq!(d.path, "");
        assert_eq!((d.line, d.column), (1, 1));
    }
}

#[test]
fn not_a_mapping_for_a_stage_that_is_a_string() {
    let checked = check(&edit(
        "  - name: plan\n    agent: k-architect\n",
        "  - plan\n",
    ));
    let d = only(&checked);
    assert_eq!(d.code, Code::NotAMapping);
    assert_eq!(d.path, "stages[0]");
    assert_eq!((d.line, d.column), (6, 5));
}

// --- UNKNOWN_KEY -----------------------------------------------------------------------------------------------------

#[test]
fn unknown_key_names_the_key_and_suggests_a_near_one() {
    let checked = check(&edit(
        "    agent: k-architect",
        "    agnet: k-architect\n    agent: k-architect",
    ));
    let d = only(&checked);
    assert_eq!(d.code, Code::UnknownKey);
    assert_eq!(d.path, "stages.plan.agnet");
    assert_eq!(d.suggestion.as_deref(), Some("agent"));
    assert_eq!((d.line, d.column), (7, 5));
}

#[test]
fn unknown_key_has_no_suggestion_when_nothing_is_near() {
    let checked = check(&format!("{VALID}zzzzzzzz: 1\n"));
    let d = only(&checked);
    assert_eq!(d.code, Code::UnknownKey);
    assert_eq!(d.suggestion, None);
}

#[test]
fn unknown_key_suggests_only_keys_the_build_honors() {
    // `output` is within 1 edit of `outputs`, a key of slice 2, which this build does not honor.
    let checked = check(&edit(
        "    agent: k-architect",
        "    agent: k-architect\n    output: x",
    ));
    let d = only(&checked);
    assert_eq!(d.code, Code::UnknownKey);
    assert_eq!(d.suggestion, None);
}

#[test]
fn unknown_key_does_not_echo_a_key_that_looks_like_a_secret() {
    let checked = check(&format!("{VALID}AKIAIOSFODNN7EXAMPLE: 1\n"));
    let d = only(&checked);
    assert_eq!(d.code, Code::UnknownKey);
    assert!(!d.message.contains("AKIA"), "{}", d.message);
    assert!(d.message.contains("(not shown)"));
}

#[test]
fn unknown_key_for_a_planned_description_says_it_is_planned() {
    let checked = check(&format!("{VALID}description: Something\n"));
    let d = only(&checked);
    assert_eq!(d.code, Code::UnknownKey);
    assert!(d.message.contains("planned"), "{}", d.message);
}

#[test]
fn unknown_key_in_every_mapping_the_format_has() {
    for (from, to) in [
        ("  outcome: Do it.", "  outcome: Do it.\n  bogus: 1"),
        (
            "    agent: k-architect",
            "    agent: k-architect\n    bogus: 1",
        ),
    ] {
        let checked = check(&edit(from, to));
        assert_eq!(codes(&checked), ["UNKNOWN_KEY"], "{to}");
    }
    let checked = check(&edit(
        "stages:",
        "intent_x: 1\nparams:\n  goal:\n    bogus: 1\nstages:",
    ));
    assert_eq!(codes(&checked), ["UNKNOWN_KEY", "UNKNOWN_KEY"]);
    let checked = check(&edit(
        "  outcome: Do it.",
        "  outcome: Do it.\n  accept:\n    - id: a\n      file: A.md\n      bogus: 1",
    ));
    assert_eq!(codes(&checked), ["UNKNOWN_KEY"]);
}

// --- DUPLICATE_KEY ---------------------------------------------------------------------------------------------------

#[test]
fn duplicate_key_is_never_last_one_wins() {
    let checked = check(&edit("version: 0.1.0", "version: 0.1.0\nversion: 9.9.9"));
    let d = only(&checked);
    assert_eq!(d.code, Code::DuplicateKey);
    assert_eq!(d.path, "version");
    assert_eq!((d.line, d.column), (3, 1));
    assert!(checked.workflow.is_none());
}

#[test]
fn duplicate_key_is_found_in_every_mapping_and_checks_go_on_without_the_later_key() {
    // The first `outcome` is empty and invalid. The later one is valid and ignored.
    let text = edit("  outcome: Do it.", "  outcome: ''\n  outcome: Fine");
    assert_eq!(codes(&check(&text)), ["INVALID_VALUE", "DUPLICATE_KEY"]);
    let text = edit(
        "    agent: k-architect",
        "    agent: k-architect\n    agent: k-developer",
    );
    assert_eq!(codes(&check(&text)), ["DUPLICATE_KEY"]);
}

#[test]
fn duplicate_key_compares_the_text_of_keys() {
    // `1` and `'1'` are one key. `true` and `True` are two.
    let checked = check(&format!("{VALID}1: a\n'1': b\n"));
    assert_eq!(codes(&checked), ["UNKNOWN_KEY", "DUPLICATE_KEY"]);
    let checked = check(&format!("{VALID}true: a\nTrue: b\n"));
    assert_eq!(codes(&checked), ["UNKNOWN_KEY", "UNKNOWN_KEY"]);
}

#[test]
fn an_unknown_key_that_repeats_is_unknown_once_and_duplicate_after() {
    let checked = check(&format!("{VALID}zzz: 1\nzzz: 2\nzzz: 3\n"));
    assert_eq!(
        codes(&checked),
        ["UNKNOWN_KEY", "DUPLICATE_KEY", "DUPLICATE_KEY"]
    );
}

// --- MISSING_KEY -----------------------------------------------------------------------------------------------------

#[test]
fn missing_key_for_format_suggests_the_line_to_add() {
    let checked = check(&edit("format: konductor/1\n", ""));
    let d = only(&checked);
    assert_eq!(d.code, Code::MissingKey);
    assert_eq!(d.path, "");
    assert_eq!(d.suggestion.as_deref(), Some("format: konductor/1"));
}

#[test]
fn missing_key_for_each_required_key() {
    for (from, key) in [
        ("version: 0.1.0\n", "version"),
        ("intent:\n  outcome: Do it.\n", "intent"),
        (
            "stages:\n  - name: plan\n    agent: k-architect\n",
            "stages",
        ),
    ] {
        let checked = check(&edit(from, ""));
        let d = only(&checked);
        assert_eq!(d.code, Code::MissingKey, "{key}");
        assert!(d.message.contains(&format!("`{key}`")), "{}", d.message);
    }
    let checked = check(&edit("  outcome: Do it.\n", "  accept: []\n"));
    assert_eq!(codes(&checked), ["MISSING_KEY"]);
    assert_eq!(only(&checked).path, "intent");
    let checked = check(&edit("  - name: plan\n", "  - "));
    assert_eq!(codes(&checked), ["MISSING_KEY"]);
    assert_eq!(only(&checked).path, "stages[0]");
}

#[test]
fn missing_key_is_reported_at_the_enclosing_mapping() {
    let checked = check(&edit("version: 0.1.0\n", ""));
    let d = only(&checked);
    assert_eq!(d.path, "");
    assert_eq!((d.line, d.column), (1, 1));
    assert_eq!(d.end_line, 6);
}

// --- WRONG_TYPE ------------------------------------------------------------------------------------------------------

#[test]
fn wrong_type_for_a_number_or_a_boolean_where_a_string_belongs() {
    for (value, key) in [("123", "name"), ("true", "name"), ("~", "name")] {
        let checked = check(&edit(
            "version: 0.1.0",
            &format!("version: 0.1.0\n{key}: {value}"),
        ));
        let d = only(&checked);
        assert_eq!(d.code, Code::WrongType, "{value}");
        assert_eq!(d.path, key);
    }
}

#[test]
fn wrong_type_for_an_unquoted_version_that_reads_as_a_number() {
    let checked = check(&edit("version: 0.1.0", "version: 1.1"));
    let d = only(&checked);
    assert_eq!(d.code, Code::WrongType);
    assert_eq!(d.path, "version");
}

#[test]
fn wrong_type_for_yes_and_no_is_not_given_because_they_are_strings_in_yaml_1_2() {
    let checked = check(&edit("version: 0.1.0", "version: 0.1.0\nname: t"));
    assert_eq!(checked.diagnostics, vec![]);
    let checked = check(&edit("agent: k-architect", "agent: yes"));
    assert_eq!(checked.diagnostics, vec![]);
}

#[test]
fn wrong_type_for_each_container_that_is_the_wrong_shape() {
    for (text, path) in [
        (
            edit(
                "stages:\n  - name: plan\n    agent: k-architect\n",
                "stages: nope\n",
            ),
            "stages",
        ),
        (
            edit("intent:\n  outcome: Do it.\n", "intent: [a]\n"),
            "intent",
        ),
        (
            edit("intent:\n  outcome: Do it.\n", "intent: 5\n"),
            "intent",
        ),
        (
            edit("  outcome: Do it.", "  outcome: Do it.\n  accept: nope"),
            "intent.accept",
        ),
        (format!("{VALID}params: nope\n"), "params"),
        (format!("{VALID}params:\n  goal: nope\n"), "params.goal"),
        (
            format!("{VALID}params:\n  goal:\n    default: 5\n"),
            "params.goal.default",
        ),
        (
            format!("{VALID}params:\n  goal:\n    description: [a]\n"),
            "params.goal.description",
        ),
        (edit("  outcome: Do it.", "  outcome: 5"), "intent.outcome"),
        (edit("name: plan", "name: [a]"), "stages[0].name"),
        (edit("agent: k-architect", "agent: 5"), "stages.plan.agent"),
        (
            edit("agent: k-architect", "agent: k-architect\n    prompt: 5"),
            "stages.plan.prompt",
        ),
    ] {
        let checked = check(&text);
        let d = only(&checked);
        assert_eq!(d.code, Code::WrongType, "{path}");
        assert_eq!(d.path, path);
    }
}

#[test]
fn wrong_type_for_params_as_a_list_says_the_form_is_planned() {
    let checked = check(&format!("{VALID}params: [a, b]\n"));
    let d = only(&checked);
    assert_eq!(d.code, Code::WrongType);
    assert!(d.message.contains("planned"), "{}", d.message);
}

// --- INVALID_NAME ----------------------------------------------------------------------------------------------------

#[test]
fn invalid_name_for_a_workflow_stage_check_or_agent_name_that_breaks_the_pattern() {
    for text in [
        edit("version: 0.1.0", "version: 0.1.0\nname: Bad_Name"),
        edit("name: plan", "name: Plan"),
        edit("name: plan", "name: -plan"),
        edit("agent: k-architect", "agent: K_Architect"),
        edit("agent: k-architect", &format!("agent: {}", "a".repeat(65))),
        edit(
            "  outcome: Do it.",
            "  outcome: Do it.\n  accept:\n    - id: Bad Id\n      file: A.md",
        ),
    ] {
        let checked = check(&text);
        assert_eq!(codes(&checked), ["INVALID_NAME"], "{text}");
    }
}

#[test]
fn a_name_of_64_characters_is_valid_and_one_of_65_is_not() {
    let ok = format!("agent: {}", "a".repeat(64));
    assert_eq!(check(&edit("agent: k-architect", &ok)).diagnostics, vec![]);
}

// --- RESERVED_NAME ---------------------------------------------------------------------------------------------------

#[test]
fn reserved_name_for_each_canvas_marker() {
    for name in ["start", "end", "run", "halt"] {
        let checked = check(&edit("name: plan", &format!("name: {name}")));
        let d = only(&checked);
        assert_eq!(d.code, Code::ReservedName, "{name}");
        assert_eq!(d.path, "stages[0].name");
    }
}

// --- DUPLICATE_STAGE -------------------------------------------------------------------------------------------------

#[test]
fn duplicate_stage_is_reported_at_the_later_stage() {
    let text = format!("{VALID}  - name: plan\n    agent: k-developer\n");
    let checked = check(&text);
    let d = only(&checked);
    assert_eq!(d.code, Code::DuplicateStage);
    // The first stage owns the name, so the later one is addressed by its place.
    assert_eq!(d.path, "stages[1].name");
    assert_eq!((d.line, d.column), (8, 11));
}

// --- NAME_MISMATCH ---------------------------------------------------------------------------------------------------

#[test]
fn name_mismatch_when_name_is_not_the_file_name() {
    let checked = check(&edit("version: 0.1.0", "version: 0.1.0\nname: other"));
    let d = only(&checked);
    assert_eq!(d.code, Code::NameMismatch);
    assert_eq!(d.path, "name");
    assert!(d.message.contains("`t`"), "{}", d.message);
}

#[test]
fn name_may_be_left_out_and_then_is_the_file_name() {
    let workflow = check(VALID).workflow.expect("workflow");
    assert_eq!(workflow.name, "t");
}

// --- INVALID_VALUE ---------------------------------------------------------------------------------------------------

#[test]
fn invalid_value_for_a_version_that_is_not_semver_suggests_zero_one_zero() {
    for version in [
        "'1.1'",
        "'1'",
        "'1.2.3.4'",
        "'01.2.3'",
        "'1.2.3-rc.1'",
        "'v1.2.3'",
        "''",
    ] {
        let checked = check(&edit("version: 0.1.0", &format!("version: {version}")));
        let d = only(&checked);
        assert_eq!(d.code, Code::InvalidValue, "{version}");
        assert_eq!(d.suggestion.as_deref(), Some("0.1.0"));
    }
    for version in ["0.1.0", "1.2.3", "10.20.30", "0.0.0"] {
        let checked = check(&edit("version: 0.1.0", &format!("version: {version}")));
        assert_eq!(checked.diagnostics, vec![], "{version}");
    }
}

#[test]
fn invalid_value_for_an_outcome_that_is_empty_has_a_line_break_or_is_too_long() {
    for outcome in ["''", "|\n    two\n    lines", &"x".repeat(301)] {
        let checked = check(&edit("outcome: Do it.", &format!("outcome: {outcome}")));
        assert_eq!(codes(&checked), ["INVALID_VALUE"], "{outcome}");
    }
    let checked = check(&edit(
        "outcome: Do it.",
        &format!("outcome: {}", "x".repeat(300)),
    ));
    assert_eq!(checked.diagnostics, vec![]);
}

#[test]
fn lengths_count_code_points_not_bytes_or_utf16_units() {
    // 300 emoji are 1200 bytes and 600 UTF-16 units, and 300 code points.
    let ok = format!("outcome: \"{}\"", "😀".repeat(300));
    assert_eq!(check(&edit("outcome: Do it.", &ok)).diagnostics, vec![]);
    let too_long = format!("outcome: \"{}\"", "😀".repeat(301));
    assert_eq!(
        codes(&check(&edit("outcome: Do it.", &too_long))),
        ["INVALID_VALUE"]
    );
}

#[test]
fn invalid_value_for_a_stage_count_outside_one_to_forty() {
    let stage = |n: usize| format!("  - name: s{n}\n    agent: a\n");
    let with = |count: usize| {
        let stages: String = (0..count).map(stage).collect();
        edit("  - name: plan\n    agent: k-architect\n", &stages)
    };
    assert_eq!(check(&with(40)).diagnostics, vec![]);
    let checked = check(&with(41));
    assert_eq!(codes(&checked), ["INVALID_VALUE"]);
    assert_eq!(only(&checked).path, "stages");
    let checked = check(&edit(
        "stages:\n  - name: plan\n    agent: k-architect\n",
        "stages: []\n",
    ));
    assert_eq!(codes(&checked), ["INVALID_VALUE"]);
}

#[test]
fn invalid_value_for_a_prompt_of_the_wrong_length() {
    let long = "p".repeat(32_769);
    for prompt in ["''", &format!("\"{long}\"")] {
        let checked = check(&edit(
            "agent: k-architect",
            &format!("agent: k-architect\n    prompt: {prompt}"),
        ));
        assert_eq!(codes(&checked), ["INVALID_VALUE"]);
    }
    let edge = "p".repeat(32_768);
    let checked = check(&edit(
        "agent: k-architect",
        &format!("agent: k-architect\n    prompt: \"{edge}\""),
    ));
    assert_eq!(checked.diagnostics, vec![]);
}

#[test]
fn invalid_value_for_both_prompt_and_prompt_file_at_the_prompt_file_value() {
    let source = MemorySource::with("plan.md", b"Do the plan.");
    let text = edit(
        "agent: k-architect",
        "agent: k-architect\n    prompt: Hi\n    prompt_file: plan.md",
    );
    let checked = check_with(&text, &source);
    let d = only(&checked);
    assert_eq!(d.code, Code::InvalidValue);
    assert_eq!(d.path, "stages.plan.prompt_file");
    assert_eq!((d.line, d.column), (9, 18));
}

#[test]
fn prompt_file_is_read_through_the_source_and_its_text_is_the_prompt() {
    let source = MemorySource::with("prompts/plan.md", "Plan it. é\n".as_bytes());
    let text = edit(
        "agent: k-architect",
        "agent: k-architect\n    prompt_file: prompts/plan.md",
    );
    let workflow = check_with(&text, &source).workflow.expect("workflow");
    assert_eq!(workflow.stages[0].prompt.as_deref(), Some("Plan it. é\n"));
    assert_eq!(
        workflow.stages[0].prompt_file.as_deref(),
        Some("prompts/plan.md")
    );
}

#[test]
fn invalid_value_for_a_prompt_file_that_is_missing_not_utf8_too_big_empty_or_too_long() {
    let big = vec![b'a'; 262_145];
    let long = "p".repeat(32_769).into_bytes();
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("missing", vec![]),
        ("not utf-8", vec![0xff, 0xfe, 0x00]),
        ("too big", big),
        ("empty", vec![]),
        ("too long", long),
    ];
    for (label, bytes) in cases {
        let source = if label == "missing" {
            MemorySource::default()
        } else {
            MemorySource::with("plan.md", &bytes)
        };
        let text = edit(
            "agent: k-architect",
            "agent: k-architect\n    prompt_file: plan.md",
        );
        let checked = check_with(&text, &source);
        let d = only(&checked);
        assert_eq!(d.code, Code::InvalidValue, "{label}");
        assert_eq!(d.path, "stages.plan.prompt_file", "{label}");
    }
}

#[test]
fn a_prompt_file_may_start_with_a_byte_order_mark_which_is_not_part_of_the_prompt() {
    let source = MemorySource::with("plan.md", "\u{feff}Plan it.".as_bytes());
    let text = edit(
        "agent: k-architect",
        "agent: k-architect\n    prompt_file: plan.md",
    );
    let workflow = check_with(&text, &source).workflow.expect("workflow");
    assert_eq!(workflow.stages[0].prompt.as_deref(), Some("Plan it."));
}

#[test]
fn invalid_value_for_a_path_that_breaks_the_path_rules() {
    for path in [
        "/etc/passwd",
        "../x.md",
        "a/../../x.md",
        "a\\\\b.md",
        "C:/x.md",
        "''",
    ] {
        let text = edit(
            "  outcome: Do it.",
            &format!("  outcome: Do it.\n  accept:\n    - id: a\n      file: {path}"),
        );
        let checked = check(&text);
        assert_eq!(codes(&checked), ["INVALID_VALUE"], "{path}");
        assert_eq!(only(&checked).path, "intent.accept[0].file", "{path}");
    }
    let source = MemorySource::default();
    for path in ["/etc/passwd", "../x.md", "a/../x.md"] {
        let text = edit(
            "agent: k-architect",
            &format!("agent: k-architect\n    prompt_file: {path}"),
        );
        let checked = check_with(&text, &source);
        assert_eq!(codes(&checked), ["INVALID_VALUE"], "{path}");
    }
    let ok = edit(
        "  outcome: Do it.",
        "  outcome: Do it.\n  accept:\n    - id: a\n      file: docs/out/PLAN.md",
    );
    assert_eq!(check(&ok).diagnostics, vec![]);
}

#[test]
fn invalid_value_for_a_check_that_has_no_kind_or_a_duplicate_id() {
    let neither = edit(
        "  outcome: Do it.",
        "  outcome: Do it.\n  accept:\n    - id: a",
    );
    assert_eq!(codes(&check(&neither)), ["INVALID_VALUE"]);
    let twice = edit(
        "  outcome: Do it.",
        "  outcome: Do it.\n  accept:\n    - id: a\n      file: A.md\n    - id: a\n      file: B.md",
    );
    let checked = check(&twice);
    assert_eq!(codes(&checked), ["INVALID_VALUE"]);
    assert_eq!(only(&checked).path, "intent.accept[1].id");
}

// --- UNSUPPORTED_FORMAT ----------------------------------------------------------------------------------------------

#[test]
fn unsupported_format_for_any_value_but_konductor_1() {
    for format in [
        "konductor/2",
        "konductor",
        "'Konductor/1'",
        "yaml",
        "1",
        "true",
        "~",
        "[konductor/1]",
        "{a: b}",
        "''",
    ] {
        let checked = check(&edit("format: konductor/1", &format!("format: {format}")));
        let d = only(&checked);
        assert_eq!(d.code, Code::UnsupportedFormat, "{format}");
        assert_eq!(d.path, "format");
        assert_eq!(d.suggestion.as_deref(), Some("konductor/1"));
    }
}

// --- STAGE_KIND_MISSING and STAGE_KIND_AMBIGUOUS ---------------------------------------------------------------------

#[test]
fn stage_kind_missing_for_a_stage_without_an_agent_and_not_missing_key() {
    let checked = check(&edit("    agent: k-architect\n", ""));
    let d = only(&checked);
    assert_eq!(d.code, Code::StageKindMissing);
    assert_eq!(d.path, "stages.plan");
}

#[test]
fn stage_kind_ambiguous_for_two_kind_keys() {
    let checked = check(&edit(
        "    agent: k-architect",
        "    agent: k-architect\n    run: [make]",
    ));
    assert_eq!(
        codes(&checked),
        ["STAGE_KIND_AMBIGUOUS", "NOT_SUPPORTED_BY_THIS_BUILD"]
    );
}

#[test]
fn a_stage_with_only_a_later_kind_key_is_reported_for_that_key_alone() {
    for kind in [
        "run: [make]",
        "uses: other",
        "human_review: {}",
        "human_input: {}",
    ] {
        let checked = check(&edit("    agent: k-architect", &format!("    {kind}")));
        assert_eq!(codes(&checked), ["NOT_SUPPORTED_BY_THIS_BUILD"], "{kind}");
    }
}

// --- NOT_SUPPORTED_BY_THIS_BUILD -------------------------------------------------------------------------------------

#[test]
fn not_supported_by_this_build_names_the_slice() {
    let checked = check(&edit(
        "    agent: k-architect",
        "    agent: k-architect\n    outputs:\n      design: DESIGN.md",
    ));
    let d = only(&checked);
    assert_eq!(d.code, Code::NotSupportedByThisBuild);
    assert_eq!(d.path, "stages.plan.outputs");
    assert!(d.message.contains("slice 2"), "{}", d.message);
    assert!(d.message.contains("this build is slice 1"), "{}", d.message);
    assert!(d.message.contains("`stages[].outputs`"), "{}", d.message);
    assert_eq!((d.line, d.column), (8, 5));
}

#[test]
fn the_string_form_of_intent_is_not_supported_and_names_its_slice() {
    let checked = check(&edit("intent:\n  outcome: Do it.\n", "intent: Do it.\n"));
    let d = only(&checked);
    assert_eq!(d.code, Code::NotSupportedByThisBuild);
    assert_eq!(d.path, "intent");
    assert!(d.message.contains("slice 13"), "{}", d.message);
    assert_eq!((d.line, d.column), (3, 9));
}

#[test]
fn a_planned_param_is_not_supported_and_the_message_does_not_echo_its_name() {
    let checked = check(&format!(
        "{VALID}params:\n  diff_input:\n    description: x\n"
    ));
    let d = only(&checked);
    assert_eq!(d.code, Code::NotSupportedByThisBuild);
    assert!(d.message.contains("`params.<name>`"), "{}", d.message);
    assert!(d.message.contains("slice 2"));
    assert_eq!(d.path, "params.diff_input");
}

#[test]
fn a_param_is_not_checked_against_the_param_name_pattern_in_this_build() {
    let checked = check(&format!("{VALID}params:\n  Bad-Name: {{}}\n"));
    assert_eq!(codes(&checked), ["NOT_SUPPORTED_BY_THIS_BUILD"]);
}

#[test]
fn goal_may_be_declared_with_a_description_and_a_default() {
    let text = format!(
        "{VALID}params:\n  goal:\n    description: What to do.\n    default: Write a plan.\n"
    );
    let workflow = check(&text).workflow.expect("workflow");
    let goal = &workflow.params["goal"];
    assert_eq!(goal.description.as_deref(), Some("What to do."));
    assert_eq!(goal.default.as_deref(), Some("Write a plan."));
}

#[test]
fn a_planned_form_that_a_build_lacks_reports_an_existing_code() {
    // A mapping where `outputs` expects a path: `outputs` itself is slice 2, so the key is reported first.
    let checked = check(&edit(
        "    agent: k-architect",
        "    agent: k-architect\n    outputs:\n      design:\n        path: DESIGN.md",
    ));
    assert_eq!(codes(&checked), ["NOT_SUPPORTED_BY_THIS_BUILD"]);
    // A string where `run` expects a list.
    let checked = check(&edit(
        "  outcome: Do it.",
        "  outcome: Do it.\n  accept:\n    - id: a\n      run: make test",
    ));
    assert_eq!(codes(&checked), ["NOT_SUPPORTED_BY_THIS_BUILD"]);
}

#[test]
fn a_check_with_both_file_and_run_is_invalid_and_run_is_also_reported() {
    let text = edit(
        "  outcome: Do it.",
        "  outcome: Do it.\n  accept:\n    - id: a\n      file: A.md\n      run: [make]",
    );
    let checked = check(&text);
    assert_eq!(
        codes(&checked),
        ["INVALID_VALUE", "NOT_SUPPORTED_BY_THIS_BUILD"]
    );
}

// --- Order, paths and positions --------------------------------------------------------------------------------------

#[test]
fn diagnostics_come_in_the_order_of_the_text() {
    let text = "format: konductor/9
version: '1.1'
intent:
  outcome: ''
stages:
  - name: Bad
    agent: x
";
    let checked = check(text);
    assert_eq!(
        codes(&checked),
        [
            "UNSUPPORTED_FORMAT",
            "INVALID_VALUE",
            "INVALID_VALUE",
            "INVALID_NAME"
        ]
    );
    let lines: Vec<usize> = checked.diagnostics.iter().map(|d| d.line).collect();
    assert_eq!(lines, [1, 2, 4, 6]);
}

#[test]
fn a_stage_is_addressed_by_name_when_it_has_a_usable_one_and_by_place_otherwise() {
    let text =
        format!("{VALID}  - name: Bad Name\n    agent: x\n  - name: dev\n    agent: Bad Agent\n");
    let checked = check(&text);
    let paths: Vec<&str> = checked
        .diagnostics
        .iter()
        .map(|d| d.path.as_str())
        .collect();
    assert_eq!(paths, ["stages[1].name", "stages.dev.agent"]);
}

#[test]
fn a_diagnostic_has_every_field_of_the_contract() {
    let checked = check(&edit("version: 0.1.0", "version: 9"));
    let json = checked.diagnostics[0].to_json().compact();
    for field in [
        "\"code\":",
        "\"severity\":\"error\"",
        "\"file\":\"t.yml\"",
        "\"path\":",
        "\"line\":",
        "\"column\":",
        "\"end_line\":",
        "\"end_column\":",
        "\"message\":",
    ] {
        assert!(json.contains(field), "{field} missing from {json}");
    }
}

#[test]
fn a_message_never_quotes_a_value_that_looks_like_a_secret() {
    let secrets = [
        "AKIAIOSFODNN7EXAMPLE",
        "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "sk-abcdefghijklmnopqrstuvwxyz0123456789",
        "0123456789abcdef0123456789abcdef01234567",
    ];
    for secret in secrets {
        for text in [
            edit("format: konductor/1", &format!("format: {secret}")),
            edit(
                "name: plan",
                &format!("name: {secret}\n  - name: {secret}\n    agent: a"),
            ),
            format!("{VALID}{secret}: 1\n"),
        ] {
            let checked = check(&text);
            assert!(!checked.diagnostics.is_empty());
            for d in &checked.diagnostics {
                assert!(!d.message.contains(secret), "{}", d.message);
                assert!(!d.message.contains(&secret[..8]), "{}", d.message);
            }
        }
    }
}
