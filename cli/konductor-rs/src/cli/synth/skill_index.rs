// SPDX-License-Identifier: Apache-2.0
//
// synth/skill_index.rs: builds the "Your skills" block synth appends to
// each Kiro agent's prompt: a rule for when to load one of the agent's
// own declared skills, how to load it, and the list of those skills.
// Claude Code gets no block; it lists and loads skills natively.

use super::model::SkillDef;
use crate::cli::skills_server::{GET_SKILL_TOOL, MCP_SERVER_NAME};

const TRIGGER_MAX_CHARS: usize = 160;
const ELLIPSIS: &str = "...";

const HEADING: &str = "## Your skills";

const USE_RULE: &str = "Before a non-trivial task, check whether one of the skills listed below \
covers it. In addition to any skill marked always-apply, load at most one or two and follow \
their steps and output format. Skip this for trivial tasks such as a quick question, a one-line \
edit, or a lookup.";

// A skill whose trigger starts with this marker applies to every task, so
// it is listed apart from the task skills and outside their budget.
const ALWAYS_APPLY_MARKER: &str = "MUST USE";

const ALWAYS_APPLY_RULE: &str = "Follow these on every task. Load each at most once per \
session, not before every task. They do not count toward the one or two above.";

const ORCHESTRATOR_RULE: &str = "You orchestrate. When a task matches a skill a specialist \
owns, such as a code review, a threat model, or user stories, route it to that specialist \
instead of doing it yourself. Load a skill from this list only for your own orchestration work.";

/// One short trigger for a skill, taken from its frontmatter
/// `description`. `None` when the description is missing, not a string,
/// or blank.
fn skill_trigger(raw_frontmatter: &str) -> Option<String> {
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
    let chosen = sentences
        .iter()
        .find(|s| s.starts_with("Use ") || s.starts_with("MUST USE"))
        .or_else(|| sentences.first())?;
    Some(cap_on_word_boundary(chosen))
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

fn cap_on_word_boundary(text: &str) -> String {
    if text.chars().count() <= TRIGGER_MAX_CHARS {
        return text.to_string();
    }
    let keep = TRIGGER_MAX_CHARS - ELLIPSIS.len();
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

fn is_orchestrator(agent_name: &str) -> bool {
    agent_name.starts_with("konductor")
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

fn always_apply_line(names: &[&str]) -> String {
    let listed = names
        .iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<_>>()
        .join(", ");
    format!("Always-apply: {listed}. {ALWAYS_APPLY_RULE}")
}

/// The Kiro block: one `- <name>: <trigger>` line per declared task skill,
/// in declared order, after one always-apply line naming any skill whose
/// trigger starts with `MUST USE`. Names with no matching `SkillDef` are
/// skipped (synth's parse step already rejects dangling names). `None`
/// when nothing would be listed.
pub(crate) fn kiro_skill_block(
    agent_name: &str,
    skill_names: &[&str],
    skills: &[SkillDef],
) -> Option<String> {
    let mut always_apply = Vec::new();
    let mut task_lines = Vec::new();
    for skill in skill_names
        .iter()
        .filter_map(|name| skills.iter().find(|s| s.name == *name))
    {
        match skill_trigger(&skill.raw_frontmatter) {
            Some(trigger) if trigger.starts_with(ALWAYS_APPLY_MARKER) => {
                always_apply.push(skill.name.as_str());
            }
            Some(trigger) => task_lines.push(format!("- {}: {trigger}", skill.name)),
            None => task_lines.push(format!("- {}", skill.name)),
        }
    }
    let mut sections = Vec::new();
    if !always_apply.is_empty() {
        sections.push(always_apply_line(&always_apply));
    }
    if !task_lines.is_empty() {
        sections.push(task_lines.join("\n"));
    }
    if sections.is_empty() {
        return None;
    }
    let mut block = block_preamble(agent_name);
    block.push_str(&sections.join("\n\n"));
    Some(block)
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
        skill_trigger(&format!("name: x\ndescription: {description_yaml}"))
    }

    #[test]
    fn trigger_prefers_use_sentence_over_leading_summary() {
        assert_eq!(
            trigger("Reviews code for defects. Use when a diff needs review.").as_deref(),
            Some("Use when a diff needs review.")
        );
    }

    #[test]
    fn trigger_accepts_must_use_sentence() {
        assert_eq!(
            trigger("Core rules. MUST USE for every interaction.").as_deref(),
            Some("MUST USE for every interaction.")
        );
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
            skill_trigger(fm).as_deref(),
            Some("Use when the thing happens.")
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
    }

    #[test]
    fn use_rule_budget_excludes_always_apply_skills() {
        let skills = vec![skill("a", "Use for a.")];
        let block = kiro_skill_block("k-developer", &["a"], &skills).unwrap();
        assert!(
            block.contains("In addition to any skill marked always-apply, load at most one or two"),
            "{block}"
        );
    }

    #[test]
    fn must_use_skill_moves_to_always_apply_line_before_task_list() {
        let skills = vec![
            skill("constraints", "MUST USE for every interaction. Core rules."),
            skill("a", "Use for a."),
        ];
        let block = kiro_skill_block("k-developer", &["constraints", "a"], &skills).unwrap();
        let expected = "Always-apply: `constraints`. Follow these on every task. Load each \
                        at most once per session, not before every task. They do not count \
                        toward the one or two above.\n\n- a: Use for a.";
        assert!(block.ends_with(expected), "{block}");
        assert!(!block.contains("- constraints"), "{block}");
    }

    #[test]
    fn always_apply_line_joins_several_names_in_declared_order() {
        let skills = vec![skill("x", "MUST USE always."), skill("y", "MUST USE too.")];
        let block = kiro_skill_block("k-developer", &["y", "x"], &skills).unwrap();
        assert!(block.contains("Always-apply: `y`, `x`. "), "{block}");
        assert!(!block.lines().any(|l| l.starts_with("- ")), "{block}");
    }

    #[test]
    fn no_always_apply_line_without_must_use_skills() {
        let skills = vec![skill("a", "Use for a.")];
        let block = kiro_skill_block("k-developer", &["a"], &skills).unwrap();
        assert!(!block.contains("Always-apply:"), "{block}");
    }

    #[test]
    fn block_contains_no_em_or_en_dashes() {
        let skills = vec![skill("a", "Use for a.")];
        let block = kiro_skill_block("konductor", &["a"], &skills).unwrap();
        assert!(!block.contains('\u{2014}') && !block.contains('\u{2013}'));
    }

    #[test]
    fn append_block_separates_with_one_blank_line() {
        assert_eq!(append_block("Prompt.\n\n", "BLOCK"), "Prompt.\n\nBLOCK\n");
    }
}
