// SPDX-License-Identifier: Apache-2.0
//! The stage prompt against golden files, byte for byte (D10).

mod common;

use std::path::Path;

use common::MemorySource;
use workflow_core::model::Stage;
use workflow_core::{check_text, runner_prompt, stage_prompt, Workflow};

fn golden(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn hello_plan() -> Workflow {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/hello-plan.yml");
    let text = std::fs::read_to_string(path).expect("read hello-plan.yml");
    check_text("hello-plan", &text, &MemorySource::default())
        .workflow
        .expect("hello-plan is valid")
}

fn stage(name: &str, agent: &str, prompt: Option<&str>) -> Stage {
    Stage {
        name: name.to_string(),
        agent: agent.to_string(),
        prompt: prompt.map(str::to_string),
        prompt_file: None,
    }
}

fn hello_goal(workflow: &Workflow) -> String {
    workflow.params["goal"]
        .default
        .clone()
        .expect("default goal")
}

#[test]
fn the_first_stage_of_hello_plan_matches_its_golden_file() {
    let workflow = hello_plan();
    let goal = hello_goal(&workflow);
    assert_eq!(
        stage_prompt(&goal, &workflow.intent.outcome, &workflow.stages, 0),
        golden("hello-plan-1-plan.txt")
    );
}

#[test]
fn the_last_stage_of_hello_plan_matches_its_golden_file() {
    let workflow = hello_plan();
    let goal = hello_goal(&workflow);
    assert_eq!(
        stage_prompt(&goal, &workflow.intent.outcome, &workflow.stages, 1),
        golden("hello-plan-2-implement.txt")
    );
}

#[test]
fn the_runner_adds_the_result_block_after_a_blank_line_and_changes_nothing_before_it() {
    let workflow = hello_plan();
    let goal = hello_goal(&workflow);
    let full = runner_prompt(&goal, &workflow.intent.outcome, &workflow.stages, 0);
    assert_eq!(full, golden("hello-plan-1-plan-runner.txt"));
    let shared = stage_prompt(&goal, &workflow.intent.outcome, &workflow.stages, 0);
    assert!(full.starts_with(&format!("{shared}\n\n")));
}

#[test]
fn a_stage_with_no_prompt_gets_the_fallback_line_and_line_ends_are_normalized() {
    let stages = [
        stage("design", "k-architect", Some("Design it.")),
        stage("review", "k-quality-assurance", None),
        stage("build", "k-developer", Some("Build it.")),
    ];
    let prompt = stage_prompt(
        "  First line.\r\nSecond line.\r\n",
        "\tShip it. ",
        &stages,
        1,
    );
    assert_eq!(prompt, golden("fallback-middle-stage.txt"));
}

#[test]
fn an_authored_prompt_is_trimmed_and_a_blank_one_gets_the_fallback() {
    let stages = [stage("only", "k-developer", Some("\n  Do it.\r\n\n"))];
    assert!(stage_prompt("g", "o", &stages, 0).ends_with("project root.\n\nDo it."));
    let stages = [stage("only", "k-developer", Some("  \n "))];
    assert!(stage_prompt("g", "o", &stages, 0)
        .ends_with("\n\nDo the part of this work that fits your role."));
}

#[test]
fn the_prompt_has_no_final_newline_and_no_outputs_line() {
    let workflow = hello_plan();
    for current in 0..workflow.stages.len() {
        let prompt = runner_prompt("g", "o", &workflow.stages, current);
        assert!(!prompt.ends_with('\n'));
        assert!(!prompt.contains("Files this stage must write"));
    }
}
