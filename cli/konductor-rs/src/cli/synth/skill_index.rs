// SPDX-License-Identifier: Apache-2.0
//
// synth/skill_index.rs: builds the "Your skills" block synth appends to
// each agent's prompt: a rule for when to load one of the agent's own
// declared skills, how to load it on the target harness, and the list
// of those skills.

use super::model::SkillDef;

const TRIGGER_MAX_CHARS: usize = 160;
const ELLIPSIS: &str = "...";

const HEADING: &str = "## Your skills";

const USE_RULE: &str = "Before a non-trivial task, check whether one of the skills listed below \
covers it. If one matches, load at most one or two and follow their steps and output format. \
Skip this for trivial tasks such as a quick question, a one-line edit, or a lookup.";

const KIRO_LOAD: &str = "Load a skill by name with the `get_skill` tool on the \
`konductor-skills` MCP server. If the tool is deferred, load it with `tool_load` first.";

const CLAUDE_LOAD: &str = "Load a matching skill with the `Skill` tool.";

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

fn block_preamble(agent_name: &str, load_line: &str) -> String {
    let mut block = format!("{HEADING}\n\n{USE_RULE}\n\n{load_line}\n\n");
    if is_orchestrator(agent_name) {
        block.push_str(ORCHESTRATOR_RULE);
        block.push_str("\n\n");
    }
    block
}

/// The Kiro block: one `- <name>: <trigger>` line per declared skill, in
/// declared order. Names with no matching `SkillDef` are skipped (synth's
/// parse step already rejects dangling names). `None` when nothing would
/// be listed.
pub(crate) fn kiro_skill_block(
    agent_name: &str,
    skill_names: &[&str],
    skills: &[SkillDef],
) -> Option<String> {
    let lines: Vec<String> = skill_names
        .iter()
        .filter_map(|name| skills.iter().find(|s| s.name == *name))
        .map(|skill| match skill_trigger(&skill.raw_frontmatter) {
            Some(trigger) => format!("- {}: {trigger}", skill.name),
            None => format!("- {}", skill.name),
        })
        .collect();
    if lines.is_empty() {
        return None;
    }
    let mut block = block_preamble(agent_name, KIRO_LOAD);
    block.push_str(&lines.join("\n"));
    Some(block)
}

// Claude Code already shows every skill's description natively, so this
// block carries names only: it ties the rule to the agent's own skills
// without paying for a second copy of the descriptions.
pub(crate) fn claude_skill_block(agent_name: &str, skill_names: &[String]) -> Option<String> {
    if skill_names.is_empty() {
        return None;
    }
    let names: Vec<String> = skill_names.iter().map(|n| format!("`{n}`")).collect();
    let mut block = block_preamble(agent_name, CLAUDE_LOAD);
    block.push_str(&format!("Your skills: {}.", names.join(", ")));
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
        assert!(claude_skill_block("k-developer", &[]).is_none());
    }

    #[test]
    fn kiro_block_names_get_skill_and_tool_load() {
        let skills = vec![skill("a", "Use for a.")];
        let block = kiro_skill_block("k-developer", &["a"], &skills).unwrap();
        assert!(block.contains("`get_skill`"));
        assert!(block.contains("`konductor-skills`"));
        assert!(block.contains("`tool_load`"));
    }

    #[test]
    fn claude_block_has_names_only_and_no_get_skill() {
        let block = claude_skill_block("k-developer", &["a".into(), "b".into()]).unwrap();
        assert!(block.ends_with("Your skills: `a`, `b`."));
        assert!(block.contains("`Skill` tool"));
        assert!(!block.contains("get_skill"));
    }

    #[test]
    fn blocks_contain_no_em_or_en_dashes() {
        let skills = vec![skill("a", "Use for a.")];
        let kiro = kiro_skill_block("konductor", &["a"], &skills).unwrap();
        let claude = claude_skill_block("konductor", &["a".into()]).unwrap();
        for block in [kiro, claude] {
            assert!(!block.contains('\u{2014}') && !block.contains('\u{2013}'));
        }
    }

    #[test]
    fn append_block_separates_with_one_blank_line() {
        assert_eq!(append_block("Prompt.\n\n", "BLOCK"), "Prompt.\n\nBLOCK\n");
    }
}
