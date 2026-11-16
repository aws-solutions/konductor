// SPDX-License-Identifier: Apache-2.0
//! The shared conformance corpus: every `.yml` in `workflow-canvas/api/corpus/` is checked, and the result must equal
//! the `.json` next to it. The stub's test suite reads the same folder, so the two loaders cannot drift.
//!
//! Set `UPDATE_CORPUS=1` to write the `.json` files from this loader. Read the diff before it is committed: a
//! disagreement with the stub is a bug in one of them.

use std::fs;
use std::path::PathBuf;

use workflow_core::json::{self, Json};
use workflow_core::view::check_response;
use workflow_core::{check_text, WorkflowSource};

fn corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../workflow-canvas/api/corpus")
}

/// What the corpus compares: the error count, every diagnostic without its message, and the view. The message is
/// prose for a person, and each loader words it its own way.
fn comparable(response: &Json) -> Json {
    let mut out = Json::object();
    out.insert("errors", response.get("errors").cloned().unwrap());
    out.insert("view", response.get("view").cloned().unwrap());
    let diagnostics = response
        .get("diagnostics")
        .and_then(Json::as_array)
        .unwrap()
        .iter()
        .map(|d| {
            let mut d = d.clone();
            if let Json::Object(map) = &mut d {
                map.remove("message");
            }
            d
        })
        .collect();
    out.insert("diagnostics", Json::Array(diagnostics));
    out
}

/// A source with no files: the corpus has no prompt files, because the stub reads none.
struct NoFiles;

impl WorkflowSource for NoFiles {
    fn workflow_bytes(&self, _: &str) -> Option<Vec<u8>> {
        None
    }
    fn prompt_file_bytes(&self, _: &str) -> Option<Vec<u8>> {
        None
    }
}

/// The cases where the two loaders differ on purpose. The stub on integration reads the data-between-stages and check
/// keys; the Rust loader answers NOT_SUPPORTED_BY_THIS_BUILD until slices 2 and 3a land. The fixture holds the stub's
/// answer. Each case must keep differing: `listed_divergences_still_diverge` fails when the Rust loader catches up, so
/// the entry is removed then and the case is held to the fixture like any other.
const KNOWN_DIVERGENCES: &[(&str, &str)] = &[
    (
        "check-both",
        "the stub reads the `run` check key; the Rust loader answers NOT_SUPPORTED_BY_THIS_BUILD until slice 3a",
    ),
    (
        "check-both-flow",
        "the stub reads the `run` check key; the Rust loader answers NOT_SUPPORTED_BY_THIS_BUILD until slice 3a",
    ),
    (
        "later-keys",
        "the stub reads the `outputs` key; the Rust loader answers NOT_SUPPORTED_BY_THIS_BUILD until slice 2",
    ),
    (
        "param-slice-2",
        "the stub reads params other than `goal`; the Rust loader answers NOT_SUPPORTED_BY_THIS_BUILD until slice 2",
    ),
];

fn is_divergence(name: &str) -> bool {
    KNOWN_DIVERGENCES.iter().any(|(case, _)| *case == name)
}

#[test]
fn every_case_of_the_corpus_gives_its_expected_result() {
    let update = std::env::var_os("UPDATE_CORPUS").is_some();
    let mut cases: Vec<PathBuf> = fs::read_dir(corpus_dir())
        .expect("the corpus folder")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "yml"))
        .collect();
    cases.sort();
    assert!(cases.len() > 50, "the corpus has {} cases", cases.len());
    let mut wrong = Vec::new();
    for path in cases {
        let name = path.file_stem().unwrap().to_str().unwrap().to_string();
        let bytes = fs::read(&path).unwrap();
        let text = String::from_utf8(bytes).expect("a corpus file is UTF-8");
        let checked = check_text(&name, &text, &NoFiles);
        let actual = comparable(&check_response(&checked, &text));
        let expected_path = path.with_extension("json");
        if update {
            // The fixture of a listed divergence holds the stub's answer, not this loader's.
            if is_divergence(&name) {
                continue;
            }
            fs::write(&expected_path, format!("{}\n", actual.pretty())).unwrap();
            continue;
        }
        let expected =
            fs::read_to_string(&expected_path).unwrap_or_else(|_| panic!("{name}.json is missing"));
        if is_divergence(&name) {
            continue;
        }
        if json::parse(&expected).expect("expected JSON") != actual {
            wrong.push(name);
        }
    }
    assert!(wrong.is_empty(), "these cases differ: {wrong:?}");
}

#[test]
fn listed_divergences_still_diverge() {
    let mut caught_up = Vec::new();
    for (name, _reason) in KNOWN_DIVERGENCES {
        let yml = corpus_dir().join(format!("{name}.yml"));
        let text = fs::read_to_string(&yml).unwrap_or_else(|_| panic!("{name}.yml is missing"));
        let actual = comparable(&check_response(&check_text(name, &text, &NoFiles), &text));
        let expected = fs::read_to_string(corpus_dir().join(format!("{name}.json")))
            .unwrap_or_else(|_| panic!("{name}.json is missing"));
        if json::parse(&expected).expect("expected JSON") == actual {
            caught_up.push(*name);
        }
    }
    assert!(
        caught_up.is_empty(),
        "these listed divergences are gone, so remove them from KNOWN_DIVERGENCES: {caught_up:?}"
    );
}

#[test]
fn every_diagnostic_code_is_in_the_corpus() {
    let mut seen = std::collections::BTreeSet::new();
    for entry in fs::read_dir(corpus_dir()).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "json") {
            let value = json::parse(&fs::read_to_string(&path).unwrap()).unwrap();
            for d in value.get("diagnostics").and_then(Json::as_array).unwrap() {
                seen.insert(d.get("code").and_then(Json::as_str).unwrap().to_string());
            }
        }
    }
    for code in workflow_core::Code::ALL {
        assert!(
            seen.contains(code.as_str()),
            "no case has {}",
            code.as_str()
        );
    }
}
