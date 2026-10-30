// SPDX-License-Identifier: Apache-2.0
//! Helpers shared by the tests of the core.
#![allow(dead_code)]

use std::collections::BTreeMap;

use workflow_core::{check_text, Checked, Diagnostic, WorkflowSource};

/// A source that holds its files in memory.
#[derive(Default)]
pub struct MemorySource {
    pub files: BTreeMap<String, Vec<u8>>,
}

impl MemorySource {
    pub fn with(path: &str, bytes: &[u8]) -> MemorySource {
        let mut source = MemorySource::default();
        source.files.insert(path.to_string(), bytes.to_vec());
        source
    }
}

impl WorkflowSource for MemorySource {
    fn workflow_bytes(&self, name: &str) -> Option<Vec<u8>> {
        self.files.get(&format!("{name}.yml")).cloned()
    }

    fn prompt_file_bytes(&self, path: &str) -> Option<Vec<u8>> {
        self.files.get(path).cloned()
    }
}

/// A workflow that passes every check, named `t`.
pub const VALID: &str = "format: konductor/1
version: 0.1.0
intent:
  outcome: Do it.
stages:
  - name: plan
    agent: k-architect
";

pub fn check(text: &str) -> Checked {
    check_text("t", text, &MemorySource::default())
}

pub fn check_with(text: &str, source: &MemorySource) -> Checked {
    check_text("t", text, source)
}

pub fn codes(checked: &Checked) -> Vec<&'static str> {
    checked
        .diagnostics
        .iter()
        .map(|d| d.code.as_str())
        .collect()
}

/// The single diagnostic of a check, which must have exactly one.
pub fn only(checked: &Checked) -> &Diagnostic {
    assert_eq!(
        checked.diagnostics.len(),
        1,
        "expected one diagnostic, got {:#?}",
        checked.diagnostics
    );
    &checked.diagnostics[0]
}

/// `(line, column, end_line, end_column)` of a diagnostic.
pub fn place(d: &Diagnostic) -> (usize, usize, usize, usize) {
    (d.line, d.column, d.end_line, d.end_column)
}
