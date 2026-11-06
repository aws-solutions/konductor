// SPDX-License-Identifier: Apache-2.0
//! The stage result line: one case for each way it can be missing or invalid.

use workflow_core::json::{parse, Json, ParseError};
use workflow_core::{parse_result, Reason, StageResult};

fn ok(outputs: &[&str]) -> Result<StageResult, Reason> {
    Ok(StageResult {
        outputs: outputs.iter().map(|s| s.to_string()).collect(),
    })
}

#[test]
fn a_success_line_at_the_end_is_read() {
    let message =
        "Wrote the plan.\nKONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}";
    assert_eq!(parse_result(message), ok(&["PLAN.md"]));
}

#[test]
fn the_last_result_line_wins_so_a_quoted_example_does_not_count() {
    let message =
        "The format is:\nKONDUCTOR_RESULT {\"status\": \"failure\", \"outputs\": []}\nDone.\n\
                   KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"a/b.md\", \"c\"]}\n";
    assert_eq!(parse_result(message), ok(&["a/b.md", "c"]));
}

#[test]
fn crlf_line_ends_and_space_after_the_object_are_accepted() {
    let message = "x\r\nKONDUCTOR_RESULT {\"status\":\"success\",\"outputs\":[]}  \r\n";
    assert_eq!(parse_result(message), ok(&[]));
}

#[test]
fn other_keys_are_ignored() {
    let message = "KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [], \"note\": {\"a\": [1, 2.5, null]}}";
    assert_eq!(parse_result(message), ok(&[]));
}

#[test]
fn a_missing_line_is_result_missing() {
    for message in [
        "",
        "All done.",
        "KONDUCTOR_RESULT{\"status\": \"success\", \"outputs\": []}",
        " KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": []}",
        "konductor_result {\"status\": \"success\", \"outputs\": []}",
        "Say KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": []}",
    ] {
        assert_eq!(
            parse_result(message),
            Err(Reason::ResultMissing),
            "{message:?}"
        );
    }
}

#[test]
fn a_failure_status_is_result_failure() {
    let message = "KONDUCTOR_RESULT {\"status\": \"failure\", \"outputs\": []}";
    assert_eq!(parse_result(message), Err(Reason::ResultFailure));
}

#[test]
fn each_way_a_line_is_invalid_is_result_invalid() {
    let cases = [
        // Not JSON, or not one object.
        "",
        "{",
        "{\"status\": \"success\", \"outputs\": []} trailing",
        "{\"status\": \"success\", \"outputs\": []}{}",
        "[\"success\"]",
        "\"success\"",
        "null",
        "{status: \"success\", outputs: []}",
        "{'status': 'success', 'outputs': []}",
        "{\"status\": \"success\", \"outputs\": [],}",
        // A field is missing.
        "{\"outputs\": []}",
        "{\"status\": \"success\"}",
        // A field has the wrong type or value.
        "{\"status\": true, \"outputs\": []}",
        "{\"status\": \"ok\", \"outputs\": []}",
        "{\"status\": \"Success\", \"outputs\": []}",
        "{\"status\": \"success\", \"outputs\": \"PLAN.md\"}",
        "{\"status\": \"success\", \"outputs\": null}",
        "{\"status\": \"success\", \"outputs\": [1]}",
        "{\"status\": \"success\", \"outputs\": [[\"a\"]]}",
        // A key twice.
        "{\"status\": \"failure\", \"status\": \"success\", \"outputs\": []}",
        // An output path breaks the path rules.
        "{\"status\": \"success\", \"outputs\": [\"\"]}",
        "{\"status\": \"success\", \"outputs\": [\"/etc/passwd\"]}",
        "{\"status\": \"success\", \"outputs\": [\"../x\"]}",
        "{\"status\": \"success\", \"outputs\": [\"a\\\\b\"]}",
        "{\"status\": \"success\", \"outputs\": [\"C:x\"]}",
        "{\"status\": \"success\", \"outputs\": [\"./a\"]}",
        "{\"status\": \"success\", \"outputs\": [\"a/\"]}",
        "{\"status\": \"success\", \"outputs\": [\"a\\u0000b\"]}",
        // The shape is checked before the status.
        "{\"status\": \"failure\", \"outputs\": [\"../x\"]}",
        "{\"status\": \"failure\"}",
    ];
    for json in cases {
        let message = format!("text\nKONDUCTOR_RESULT {json}");
        assert_eq!(parse_result(&message), Err(Reason::ResultInvalid), "{json}");
    }
}

#[test]
fn reason_codes_are_the_contract_values() {
    let codes: Vec<&str> = Reason::ALL.iter().map(|r| r.as_str()).collect();
    assert_eq!(
        codes,
        [
            "RESULT_MISSING",
            "RESULT_INVALID",
            "RESULT_FAILURE",
            "SESSION_FAILED",
            "TIMEOUT"
        ]
    );
    for reason in Reason::ALL {
        assert_eq!(Reason::from_code(reason.as_str()), Some(reason));
    }
    assert_eq!(Reason::from_code("CHECK_FAILED"), None);
}

#[test]
fn the_json_parser_reads_every_kind_of_value() {
    let value = parse(" {\"a\": [true, false, null, 0, 18446744073709551615, -1, 1.5e3], \"b\": \"\\u00e9\\ud83d\\ude00\\n\\\"\"} ")
        .expect("valid");
    assert_eq!(value.get("b").and_then(Json::as_str), Some("é😀\n\""));
    let items = value.get("a").and_then(Json::as_array).expect("array");
    assert_eq!(items[3], Json::Number(0));
    assert_eq!(items[4].as_u64(), Some(u64::MAX));
    assert_eq!(items[5], Json::OtherNumber("-1".to_string()));
    assert_eq!(items[6], Json::OtherNumber("1.5e3".to_string()));
    assert_eq!(parse(&value.compact()), Ok(value));
}

#[test]
fn the_json_parser_refuses_what_rfc_8259_does_not_allow() {
    for text in [
        "01",
        "1.",
        ".5",
        "+1",
        "1e",
        "-",
        "\"\\x\"",
        "\"\t\"",
        "\"\\ud800\"",
        "\"\\udc00\"",
        "tru",
        "nul",
        "[1,]",
        "{\"a\" 1}",
        "",
        "\"open",
    ] {
        assert_eq!(parse(text), Err(ParseError::Syntax), "{text:?}");
    }
    assert_eq!(parse("{\"a\": 1, \"a\": 2}"), Err(ParseError::DuplicateKey));
}

#[test]
fn the_json_parser_stops_at_its_depth_limit() {
    let deep = "[".repeat(65) + &"]".repeat(65);
    assert_eq!(parse(&deep), Err(ParseError::TooDeep));
    let fine = "[".repeat(64) + &"]".repeat(64);
    assert!(parse(&fine).is_ok());
    // Hostile depth well past the limit does not exhaust the stack.
    assert_eq!(parse(&"[".repeat(1_000_000)), Err(ParseError::TooDeep));
}
