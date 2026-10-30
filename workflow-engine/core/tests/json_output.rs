// SPDX-License-Identifier: Apache-2.0
//! The JSON output is stable: keys sorted, no machine paths, byte-identical whatever the YAML key order.

mod common;

use common::{check, check_with, MemorySource, VALID};
use workflow_core::json::Json;

const ORDER_A: &str = "format: konductor/1
name: t
version: 0.1.0
intent:
  outcome: Do it.
  accept:
    - id: first
      file: A.md
    - id: second
      file: B.md
params:
  goal:
    description: What to do.
    default: Write a plan.
stages:
  - name: plan
    agent: k-architect
    prompt: Plan it.
  - name: build
    agent: k-developer
    prompt_file: build.md
";

const ORDER_B: &str = "stages:
  - prompt: Plan it.
    name: plan
    agent: k-architect
  - prompt_file: build.md
    agent: k-developer
    name: build
params:
  goal:
    default: Write a plan.
    description: What to do.
intent:
  accept:
    - file: A.md
      id: first
    - file: B.md
      id: second
  outcome: Do it.
version: 0.1.0
name: t
format: konductor/1
";

fn source() -> MemorySource {
    MemorySource::with("build.md", b"Build it.\n")
}

#[test]
fn show_is_byte_identical_whatever_the_order_of_the_yaml_keys() {
    let a = check_with(ORDER_A, &source()).workflow.expect("a");
    let b = check_with(ORDER_B, &source()).workflow.expect("b");
    assert_eq!(a.to_json().pretty(), b.to_json().pretty());
    assert_eq!(a.to_json().compact(), b.to_json().compact());
}

#[test]
fn the_check_report_is_byte_identical_whatever_the_order_of_the_yaml_keys() {
    let a = check_with(ORDER_A, &source());
    let b = check_with(ORDER_B, &source());
    assert_eq!(a.report_json().pretty(), b.report_json().pretty());
}

#[test]
fn keys_are_sorted_at_every_level() {
    let workflow = check_with(ORDER_A, &source()).workflow.expect("workflow");
    let text = workflow.to_json().pretty();
    let top: Vec<&str> = text
        .lines()
        .filter(|l| l.starts_with("  \""))
        .map(|l| l.trim().split('"').nth(1).unwrap_or(""))
        .collect();
    let mut sorted = top.clone();
    sorted.sort_unstable();
    assert_eq!(top, sorted);
    assert_eq!(
        top,
        ["format", "intent", "name", "params", "stages", "version"]
    );
}

#[test]
fn the_resolved_workflow_has_the_defaults_and_the_text_of_the_prompt_file() {
    let checked = check(VALID);
    let json = checked.workflow.expect("workflow").to_json().compact();
    assert_eq!(
        json,
        "{\"format\":\"konductor/1\",\"intent\":{\"accept\":[],\"outcome\":\"Do it.\"},\"name\":\"t\",\"params\":{\"goal\":{}},\"stages\":[{\"agent\":\"k-architect\",\"name\":\"plan\"}],\"version\":\"0.1.0\"}"
    );
    let with_file = check_with(ORDER_A, &source())
        .workflow
        .expect("workflow")
        .to_json()
        .compact();
    assert!(
        with_file.contains("\"prompt\":\"Build it.\\n\",\"prompt_file\":\"build.md\""),
        "{with_file}"
    );
}

#[test]
fn the_check_report_has_the_fields_of_the_canvas_check_result() {
    let report = check(VALID).report_json().compact();
    assert_eq!(
        report,
        "{\"diagnostics\":[],\"errors\":0,\"infos\":0,\"name\":\"t\",\"summary\":{\"counts\":{\"stages\":1},\"valid\":true},\"warnings\":0}"
    );
    let bad = check("a: [").report_json().compact();
    assert!(
        bad.contains("\"errors\":1") && bad.contains("\"valid\":false"),
        "{bad}"
    );
    assert!(bad.contains("\"stages\":0"), "{bad}");
}

#[test]
fn output_names_no_machine_path() {
    let json = check_with(ORDER_A, &source()).report_json().compact();
    for needle in ["/home", "/tmp", "/Users", "\\\\"] {
        assert!(!json.contains(needle), "{needle} in {json}");
    }
    let broken = check("format: nope\n").report_json().compact();
    assert!(broken.contains("\"file\":\"t.yml\""), "{broken}");
}

#[test]
fn strings_are_escaped_as_json() {
    let mut object = Json::object();
    object.insert(
        "a",
        Json::str(
            "quote \" back \\ nl \n cr \r tab \t bs \u{8} ff \u{c} nul \u{0} del \u{7f} é 😀",
        ),
    );
    assert_eq!(
        object.compact(),
        "{\"a\":\"quote \\\" back \\\\ nl \\n cr \\r tab \\t bs \\b ff \\f nul \\u0000 del \\u007f é 😀\"}"
    );
}

#[test]
fn pretty_output_indents_by_two_and_empty_containers_stay_on_one_line() {
    let mut inner = Json::object();
    inner.insert("empty_list", Json::Array(vec![]));
    inner.insert("empty_object", Json::object());
    let mut root = Json::object();
    root.insert("z", Json::Array(vec![Json::number(1), Json::Bool(true)]));
    root.insert("a", inner);
    assert_eq!(
        root.pretty(),
        "{\n  \"a\": {\n    \"empty_list\": [],\n    \"empty_object\": {}\n  },\n  \"z\": [\n    1,\n    true\n  ]\n}"
    );
    assert_eq!(
        root.compact(),
        "{\"a\":{\"empty_list\":[],\"empty_object\":{}},\"z\":[1,true]}"
    );
}
