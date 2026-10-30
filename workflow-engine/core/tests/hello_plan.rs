// SPDX-License-Identifier: Apache-2.0
//! The example file in the docs and the engine agree.

mod common;

use std::fs;
use std::path::Path;

use common::MemorySource;

#[test]
fn hello_plan_passes_every_check() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/hello-plan.yml");
    let text = fs::read_to_string(path).expect("read the example");
    let source = MemorySource::default();
    let checked = workflow_core::check_text("hello-plan", &text, &source);
    assert_eq!(checked.diagnostics, vec![], "{:#?}", checked.diagnostics);
    let workflow = checked.workflow.expect("a workflow");
    assert_eq!(workflow.name, "hello-plan");
    assert_eq!(workflow.stages.len(), 2);
}
