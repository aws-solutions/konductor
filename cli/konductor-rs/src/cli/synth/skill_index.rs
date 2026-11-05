// SPDX-License-Identifier: Apache-2.0
//
// synth/skill_index.rs: builds the "Your skills" block synth appends to
// each Kiro agent's prompt: a rule for when to load one of the agent's
// own declared skills, how to load it, and the list of those skills.
// Claude Code gets no block; it lists and loads skills natively.

use super::model::{is_orchestrator, SkillDef};
use crate::cli::skills_server::{GET_SKILL_TOOL, MCP_SERVER_NAME};

const TRIGGER_MAX_CHARS: usize = 160;
/// Below this, a cut-down summary says too little to be worth the space.
const MIN_SUMMARY_CHARS: usize = 40;
const ELLIPSIS: &str = "...";

const HEADING: &str = "## Your skills";

const USE_RULE: &str = "Before a non-trivial task, check whether one of the skills listed below \
covers it. If one matches, load at most one or two and follow their steps and output format. \
Skip this for trivial tasks such as a quick question, a one-line edit, or a lookup. \
Workspace skills named `ws-*` also count; read them from `.kiro/skills/<name>/SKILL.md`.";

// A skill whose "MUST USE" sentence starts with this marker (constraints)
// claims every task, which contradicts the one-or-two rule above, so it is
// left out of the index. A "MUST USE for <task>" skill (git-merge) stays.
const EVERY_TASK_MARKER: &str = "MUST USE for every ";
/// The one every-task skill synth expects; any other match gets a warning.
const EXPECTED_EVERY_TASK_SKILL: &str = "constraints";

const ORCHESTRATOR_RULE: &str = "You orchestrate. When a task matches a skill a specialist \
owns, such as a code review, a threat model, or user stories, route it to that specialist \
instead of doing it yourself. Load a skill from this list only for your own orchestration work.";

struct Trigger {
    text: String,
    every_task: bool,
}

/// One short trigger for a skill, taken from its frontmatter
/// `description`: the first "Use ..." or "MUST USE" sentence, led by the
/// first sentence when that is a different one so the line still says what
/// the skill does. `None` when the description is missing, not a string,
/// or blank.
fn skill_trigger(raw_frontmatter: &str) -> Option<Trigger> {
    let value: serde_yaml::Value = serde_yaml::from_str(raw_frontmatter).ok()?;
    let description = value.get("description")?.as_str()?;
    // Many descriptions use em or en dashes; the index is prompt text we
    // generate, so it keeps to plain hyphens.
    let plain = description
        .replace('\u{2014}', " - ")
        .replace('\u{2013}', "-");
    let collapsed = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    let sentences = split_sentences(&collapsed);
    let chosen_at = sentences
        .iter()
        .position(|s| s.starts_with("Use ") || s.starts_with("MUST USE"))
        .unwrap_or(0);
    let chosen = sentences[chosen_at];
    Some(Trigger {
        text: with_summary(sentences[0], chosen, chosen_at),
        every_task: chosen.starts_with(EVERY_TASK_MARKER),
    })
}

// A sentence ends at `.`, `!` or `?` only when whitespace and then an
// uppercase letter, quote or backtick follow, so names like `AGENTS.md`
// or `design.md` never split mid-word.
fn split_sentences(text: &str) -> Vec<&str> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut sentences = Vec::new();
    let mut start = 0;
    for i in 0..chars.len() {
        let (idx, c) = chars[i];
        if !matches!(c, '.' | '!' | '?') {
            continue;
        }
        let (Some(&(_, space)), Some(&(next_idx, next))) = (chars.get(i + 1), chars.get(i + 2))
        else {
            continue;
        };
        if space == ' ' && (next.is_uppercase() || matches!(next, '"' | '\'' | '`')) {
            sentences.push(&text[start..idx + c.len_utf8()]);
            start = next_idx;
        }
    }
    if start < text.len() {
        sentences.push(&text[start..]);
    }
    sentences
}

// The "Use ..." sentence is what a task gets matched against, so it is kept
// whole when it fits in the line and the summary sentence gets whatever room
// is left, if enough. A longer one is cut like any other text.
fn with_summary(summary: &str, chosen: &str, chosen_at: usize) -> String {
    let chosen_chars = chosen.chars().count();
    if chosen_at == 0 || chosen_chars + 1 >= TRIGGER_MAX_CHARS {
        return cap_on_word_boundary(chosen, TRIGGER_MAX_CHARS);
    }
    let room = TRIGGER_MAX_CHARS - chosen_chars - 1;
    if room < MIN_SUMMARY_CHARS {
        return chosen.to_string();
    }
    format!("{} {chosen}", cap_on_word_boundary(summary, room))
}

fn cap_on_word_boundary(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let keep = max_chars - ELLIPSIS.len();
    let cut = text
        .char_indices()
        .nth(keep)
        .map_or(text.len(), |(idx, _)| idx);
    let prefix = &text[..cut];
    let at_word = match prefix.rfind(' ') {
        Some(space) if !text[cut..].starts_with(' ') => &prefix[..space],
        _ => prefix,
    };
    format!(
        "{}{ELLIPSIS}",
        at_word.trim_end_matches([',', ';', ':', ' '])
    )
}

fn kiro_load_rule() -> String {
    format!(
        "Load a skill by name with the `{GET_SKILL_TOOL}` tool on the `{MCP_SERVER_NAME}` MCP \
         server. If the tool is deferred, load it with `tool_load` first."
    )
}

fn block_preamble(agent_name: &str) -> String {
    let mut block = format!("{HEADING}\n\n{USE_RULE}\n\n{}\n\n", kiro_load_rule());
    if is_orchestrator(agent_name) {
        block.push_str(ORCHESTRATOR_RULE);
        block.push_str("\n\n");
    }
    block
}

/// The Kiro block: one `- <name>: <trigger>` line per declared skill, in
/// declared order, leaving out any skill whose "MUST USE" sentence starts
/// with `MUST USE for every `. Names with no matching `SkillDef` are skipped
/// (synth's parse step already rejects dangling names). `None` when
/// nothing would be listed.
pub(crate) fn kiro_skill_block(
    agent_name: &str,
    skill_names: &[&str],
    skills: &[SkillDef],
) -> Option<String> {
    let mut lines = Vec::new();
    for skill in skill_names
        .iter()
        .filter_map(|name| skills.iter().find(|s| s.name == *name))
    {
        match skill_trigger(&skill.raw_frontmatter) {
            Some(trigger) if trigger.every_task => {}
            Some(trigger) => lines.push(format!("- {}: {}", skill.name, trigger.text)),
            None => lines.push(format!("- {}", skill.name)),
        }
    }
    if lines.is_empty() {
        return None;
    }
    let mut block = block_preamble(agent_name);
    block.push_str(&lines.join("\n"));
    Some(block)
}

/// One warning per skill other than `constraints` that the Kiro index
/// leaves out as an every-task skill, so a new one is not dropped silently.
pub(crate) fn every_task_skill_warnings(skills: &[SkillDef]) -> Vec<String> {
    skills
        .iter()
        .filter(|skill| skill.name != EXPECTED_EVERY_TASK_SKILL)
        .filter(|skill| skill_trigger(&skill.raw_frontmatter).is_some_and(|t| t.every_task))
        .map(|skill| {
            format!(
                "skill '{}' is left out of every Kiro agent's skills index because its \
                 description says \"{}\"",
                skill.name,
                EVERY_TASK_MARKER.trim_end()
            )
        })
        .collect()
}

pub(crate) fn append_block(prompt: &str, block: &str) -> String {
    format!("{}\n\n{block}\n", prompt.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(name: &str, description_yaml: &str) -> SkillDef {
        SkillDef {
            name: name.to_string(),
            raw_frontmatter: format!("name: {name}\ndescription: {description_yaml}"),
            body: String::new(),
            auxiliary_files: Vec::new(),
        }
    }

    fn trigger(description_yaml: &str) -> Option<String> {
        skill_trigger(&format!("name: x\ndescription: {description_yaml}")).map(|t| t.text)
    }

    #[test]
    fn trigger_leads_use_sentence_with_first_sentence() {
        assert_eq!(
            trigger("Reviews code for defects. Covers style. Use when a diff needs review.")
                .as_deref(),
            Some("Reviews code for defects. Use when a diff needs review.")
        );
    }

    #[test]
    fn trigger_is_just_the_use_sentence_when_it_comes_first() {
        assert_eq!(
            trigger("Use when a diff needs review. Covers style.").as_deref(),
            Some("Use when a diff needs review.")
        );
    }

    #[test]
    fn trigger_accepts_must_use_sentence() {
        assert_eq!(
            trigger("Core rules. MUST USE for merging. More.").as_deref(),
            Some("Core rules. MUST USE for merging.")
        );
    }

    #[test]
    fn trigger_keeps_what_backend_review_does() {
        // Copied from skills/backend-review/SKILL.md.
        let description = "Reviews backend code changes for architectural pattern compliance, \
                           type safety, DynamoDB correctness, and test quality. Use after \
                           implementing backend changes to catch issues before code review. \
                           Produces CRITICAL/IMPORTANT/SUGGESTION findings.";
        assert_eq!(
            trigger(description).as_deref(),
            Some(
                "Reviews backend code changes for architectural pattern compliance, type \
                 safety... Use after implementing backend changes to catch issues before code \
                 review."
            )
        );
    }

    #[test]
    fn trigger_keeps_what_progress_tracking_is_for() {
        // Copied from skills/progress-tracking/SKILL.md.
        let description = "Validates feature plans, tracks implementation progress, and verifies \
                           code-level requirements traceability. Use when validating a feature \
                           plan, tracking its progress, or checking requirements against code.";
        let got = trigger(description).unwrap();
        assert!(got.starts_with("Validates feature plans"), "{got}");
        assert!(
            got.ends_with("checking requirements against code."),
            "{got}"
        );
    }

    #[test]
    fn trigger_keeps_the_coordinator_only_qualifier() {
        // Copied from skills/adversarial-code-review-pass-security/SKILL.md.
        let description =
            "Reviews a diff through the lens of security concerns \u{2014} information \
                           disclosure, authorization, injection, secrets. Use only when the \
                           adversarial-code-review coordinator spawns it, alongside the integrity \
                           and schema passes.";
        let got = trigger(description).unwrap();
        assert!(
            got.contains("Use only when the adversarial-code-review coordinator spawns it"),
            "{got}"
        );
    }

    #[test]
    fn long_summary_never_cuts_into_the_use_sentence() {
        let summary = "Does a thing ".repeat(20);
        let use_sentence = "Use when the user asks for a thing to be done carefully and well \
                            before anything else happens in the session.";
        let got = trigger(&format!("{}. {use_sentence}", summary.trim())).unwrap();
        assert!(got.ends_with(use_sentence), "{got}");
        assert!(got.chars().count() <= TRIGGER_MAX_CHARS, "{got}");

        let long_use = format!("Use when {}.", "the user asks ".repeat(12).trim());
        let got = trigger(&format!("Summary here. {long_use}")).unwrap();
        assert!(got.starts_with("Use when"), "{got}");
    }

    #[test]
    fn trigger_falls_back_to_first_sentence() {
        assert_eq!(
            trigger("Writes threat models. Covers STRIDE.").as_deref(),
            Some("Writes threat models.")
        );
    }

    #[test]
    fn trigger_keeps_dotted_file_names_intact() {
        assert_eq!(
            trigger("Use when editing AGENTS.md or design.md files. Other text.").as_deref(),
            Some("Use when editing AGENTS.md or design.md files.")
        );
    }

    #[test]
    fn trigger_replaces_em_and_en_dashes_with_hyphens() {
        assert_eq!(
            trigger("Use when reviewing a diff \u{2014} pages 1\u{2013}2.").as_deref(),
            Some("Use when reviewing a diff - pages 1-2.")
        );
    }

    #[test]
    fn trigger_caps_long_text_on_word_boundary() {
        let long = format!("Use when {}", "alpha beta ".repeat(30));
        let got = trigger(&long).unwrap();
        assert!(got.chars().count() <= TRIGGER_MAX_CHARS, "{got}");
        assert!(got.ends_with("..."));
        let stem = got.trim_end_matches("...");
        assert!(stem.ends_with("alpha") || stem.ends_with("beta"), "{got}");
    }

    #[test]
    fn trigger_cap_never_splits_multibyte_chars() {
        let long = format!("Use when {}", "日本語テキスト ".repeat(40));
        let got = trigger(&long).unwrap();
        assert!(got.chars().count() <= TRIGGER_MAX_CHARS);
        assert!(got.ends_with("..."));
    }

    #[test]
    fn trigger_reads_folded_yaml_description() {
        let fm = "name: x\ndescription: >\n  Summary line.\n  Use when the\n  thing happens.\n";
        assert_eq!(
            skill_trigger(fm).map(|t| t.text).as_deref(),
            Some("Summary line. Use when the thing happens.")
        );
    }

    #[test]
    fn non_string_description_gives_name_only_line() {
        let skills = vec![skill("odd", "[1, 2]")];
        let block = kiro_skill_block("k-developer", &["odd"], &skills).unwrap();
        assert!(block.ends_with("\n- odd"), "{block}");
    }

    #[test]
    fn kiro_block_lists_only_declared_names_in_order() {
        let skills = vec![
            skill("a", "Use for a."),
            skill("b", "Use for b."),
            skill("c", "Use for c."),
        ];
        let block = kiro_skill_block("k-developer", &["c", "a"], &skills).unwrap();
        let lines: Vec<&str> = block.lines().filter(|l| l.starts_with("- ")).collect();
        assert_eq!(lines, vec!["- c: Use for c.", "- a: Use for a."]);
    }

    #[test]
    fn orchestrator_paragraph_only_for_konductor_agents() {
        let skills = vec![skill("a", "Use for a.")];
        let orch = kiro_skill_block("konductor", &["a"], &skills).unwrap();
        let spec = kiro_skill_block("k-developer", &["a"], &skills).unwrap();
        assert!(orch.contains(ORCHESTRATOR_RULE));
        assert!(!spec.contains(ORCHESTRATOR_RULE));
    }

    #[test]
    fn empty_names_give_no_block() {
        assert!(kiro_skill_block("k-developer", &[], &[]).is_none());
    }

    #[test]
    fn kiro_block_names_the_installed_server_and_tool() {
        let skills = vec![skill("a", "Use for a.")];
        let block = kiro_skill_block("k-developer", &["a"], &skills).unwrap();
        assert!(block.contains(&format!("`{GET_SKILL_TOOL}`")), "{block}");
        assert!(block.contains(&format!("`{MCP_SERVER_NAME}`")), "{block}");
        assert!(block.contains("`tool_load`"));
        assert!(
            block.contains("`ws-*` also count; read them from `.kiro/skills/<name>/SKILL.md`"),
            "{block}"
        );
    }

    #[test]
    fn use_rule_keeps_one_or_two_budget() {
        let skills = vec![skill("a", "Use for a.")];
        let block = kiro_skill_block("k-developer", &["a"], &skills).unwrap();
        assert!(
            block.contains("If one matches, load at most one or two and follow"),
            "{block}"
        );
    }

    #[test]
    fn every_task_skill_is_left_out_of_the_index() {
        let skills = vec![
            skill("constraints", "MUST USE for every interaction. Core rules."),
            skill("a", "Use for a."),
        ];
        let block = kiro_skill_block("k-developer", &["constraints", "a"], &skills).unwrap();
        assert!(
            block.ends_with(&format!("{}\n\n- a: Use for a.", kiro_load_rule())),
            "{block}"
        );
        assert!(!block.contains("constraints"), "{block}");
        assert!(!block.contains("Always-apply"), "{block}");
    }

    #[test]
    fn every_task_skill_is_left_out_after_a_leading_summary() {
        let skills = vec![
            skill("rules", "Core rules. MUST USE for every interaction."),
            skill("a", "Use for a."),
        ];
        let block = kiro_skill_block("k-developer", &["rules", "a"], &skills).unwrap();
        assert!(!block.contains("- rules"), "{block}");
    }

    #[test]
    fn only_every_task_skills_give_no_block() {
        let skills = vec![skill("constraints", "MUST USE for every interaction.")];
        assert!(kiro_skill_block("k-developer", &["constraints"], &skills).is_none());
    }

    #[test]
    fn must_use_for_a_specific_task_stays_in_task_list() {
        let skills = vec![skill("git-merge", "MUST USE for merging branches. More.")];
        let block = kiro_skill_block("konductor", &["git-merge"], &skills).unwrap();
        assert!(
            block.ends_with("\n- git-merge: MUST USE for merging branches."),
            "{block}"
        );
    }

    #[test]
    fn block_contains_no_em_or_en_dashes() {
        let skills = vec![skill("a", "Use for a.")];
        let block = kiro_skill_block("konductor", &["a"], &skills).unwrap();
        assert!(!block.contains('\u{2014}') && !block.contains('\u{2013}'));
    }

    #[test]
    fn every_task_warning_names_new_skills_but_not_constraints() {
        let skills = vec![
            skill("constraints", "MUST USE for every interaction."),
            skill("always", "MUST USE for every task."),
            skill("git-merge", "MUST USE for merging branches."),
        ];
        let warnings = every_task_skill_warnings(&skills);
        assert_eq!(warnings.len(), 1, "{warnings:?}");
        assert!(warnings[0].starts_with("skill 'always' "), "{warnings:?}");
    }

    #[test]
    fn append_block_separates_with_one_blank_line() {
        assert_eq!(append_block("Prompt.\n\n", "BLOCK"), "Prompt.\n\nBLOCK\n");
    }
}
