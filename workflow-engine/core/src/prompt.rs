// SPDX-License-Identifier: Apache-2.0
//! The stage prompt (D10): the one function that builds the text an agent stage is given.
//!
//! The spec's "Stage prompts" section fixes the text byte for byte, and the golden files in `tests/golden/` hold it.

use crate::model::Stage;

/// The line a stage with no authored prompt gets.
pub const FALLBACK_PROMPT: &str = "Do the part of this work that fits your role.";

/// The ending the runner adds after the shared text and a blank line: the stage result block of the spec's "Stage
/// result" section. `PLAN.md` in it is an example, and nothing in it is replaced.
pub const RESULT_ENDING: &str = "End your final message with one line, and put nothing after it:
KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}
Use \"failure\" as the status if you could not do the work. List each file you wrote in \"outputs\", or use [].";

/// The shared text of stage `current` (an index into `stages`): the fixed preamble, then the authored prompt or the
/// fallback line. Line ends become `\n`, surrounding white space is trimmed, and there is no final newline.
///
/// Slice 1 has no `outputs`, so the line `Files this stage must write: ...` is never part of it.
///
/// # Panics
///
/// If `current` is not an index into `stages`.
pub fn stage_prompt(goal: &str, outcome: &str, stages: &[Stage], current: usize) -> String {
    let stage = &stages[current];
    let authored = stage
        .prompt
        .as_deref()
        .map(normalize)
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| FALLBACK_PROMPT.to_string());
    let lines = [
        format!("Goal: {}", normalize(goal)),
        format!("Workflow outcome: {}", normalize(outcome)),
        String::new(),
        format!(
            "You are stage {} of {}: {}.",
            current + 1,
            stages.len(),
            stage.name
        ),
        format!("Earlier stages: {}.", stage_list(&stages[..current])),
        format!("Later stages: {}.", stage_list(&stages[current + 1..])),
        "Anything earlier stages produced is in the workspace files.".to_string(),
        "All file paths are relative to the project root.".to_string(),
        String::new(),
        authored,
    ];
    lines.join("\n")
}

/// The full text the runner sends for stage `current`: the shared text, a blank line and [`RESULT_ENDING`].
pub fn runner_prompt(goal: &str, outcome: &str, stages: &[Stage], current: usize) -> String {
    format!(
        "{}\n\n{RESULT_ENDING}",
        stage_prompt(goal, outcome, stages, current)
    )
}

/// `name (agent-id)` for each stage, separated by `, `, or `none`.
fn stage_list(stages: &[Stage]) -> String {
    if stages.is_empty() {
        return "none".to_string();
    }
    stages
        .iter()
        .map(|stage| format!("{} ({})", stage.name, stage.agent))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `\r\n` and a lone `\r` become `\n`, and white space around the text is removed.
fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}
