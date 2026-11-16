// SPDX-License-Identifier: Apache-2.0
//
// gate_config.rs: parses the gate files shipped in cli/gate-config/.
//
// Both files are embedded with `include_str!` (as config.rs does for the
// preset config), so the binary never reads them from disk. Nothing here
// touches the filesystem or emits an exit code; callers map a
// `GateConfigError` to their own exit.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use super::config::Severity;

const SEVERITY_SCHEMA: &str = include_str!("../../../gate-config/severity-schema.yml");
const SOP_ORCHESTRATION: &str = include_str!("../../../gate-config/sop-orchestration.yml");

const SEVERITY_SCHEMA_NAME: &str = "severity-schema.yml";
const SOP_ORCHESTRATION_NAME: &str = "sop-orchestration.yml";

/// A gate file failed to parse or validate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GateConfigError {
    pub(crate) file: &'static str,
    pub(crate) message: String,
}

impl std::fmt::Display for GateConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.file, self.message)
    }
}

impl std::error::Error for GateConfigError {}

/// One `severities` entry of severity-schema.yml.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SeverityEntry {
    pub(crate) id: Severity,
    pub(crate) rank: u8,
    pub(crate) aliases: Vec<String>,
}

/// severity-schema.yml's entries, in file order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SeverityTable {
    pub(crate) entries: Vec<SeverityEntry>,
}

/// What a checker's severity word maps to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WordRank {
    Known(Severity),
    Unknown,
}

impl SeverityTable {
    /// Reports whether a finding's severity label is known and which gate
    /// id it holds. The input is the label as a checker writes it: a bare
    /// word or a legend label that starts with it (`Warning Gap`,
    /// `🚨 Critical Gap`, `CRITICAL (must fix):`). Matching ignores case and
    /// reads the leading run of letters, so emoji, punctuation and trailing
    /// words are dropped.
    ///
    /// Headings, counters, status words and checkbox lines are outside the
    /// contract and may rank either way: `### Warnings (Should Address)`
    /// and `- [ ] IMPORTANT` read as their leading word. A label whose
    /// second word is `RISK`, `PRIORITY` or `CONFIDENCE` (or a plural) is
    /// `Unknown`: those scales share the words High, Medium and Low but are
    /// not severities.
    pub(crate) fn rank_of_word(&self, word: &str) -> WordRank {
        if is_scale_label(word) {
            return WordRank::Unknown;
        }
        let token = leading_severity_token(word);
        self.entries
            .iter()
            .find(|entry| {
                entry.id.to_string().eq_ignore_ascii_case(&token)
                    || entry.aliases.iter().any(|a| a.eq_ignore_ascii_case(&token))
            })
            .map_or(WordRank::Unknown, |entry| WordRank::Known(entry.id))
    }

    /// The gate severity a finding counts as, and whether its label was
    /// recognized. This is the only place the fail-closed rule lives: an
    /// empty, whitespace-only or unrecognized label ranks CRITICAL (flag
    /// `false`), so a finding nobody mapped blocks the gate instead of
    /// slipping through it. The config's `default_severity` is never
    /// applied here.
    pub(crate) fn gate_rank_of_word(&self, word: &str) -> (Severity, bool) {
        match self.rank_of_word(word) {
            WordRank::Known(severity) => (severity, true),
            WordRank::Unknown => (Severity::Critical, false),
        }
    }
}

/// The first run of ASCII letters in `word`, upper-cased.
fn leading_severity_token(word: &str) -> String {
    letter_runs(word).next().unwrap_or_default()
}

/// The runs of ASCII letters in `word`, upper-cased, in order.
fn letter_runs(word: &str) -> impl Iterator<Item = String> + '_ {
    word.split(|c: char| !c.is_ascii_alphabetic())
        .filter(|run| !run.is_empty())
        .map(str::to_ascii_uppercase)
}

/// True when the label's second word names a scale (`High Risk`,
/// `HIGH-confidence`) rather than a severity.
fn is_scale_label(word: &str) -> bool {
    matches!(
        letter_runs(word).nth(1).as_deref(),
        Some("RISK" | "RISKS" | "PRIORITY" | "PRIORITIES" | "CONFIDENCE")
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GateKind {
    Approval,
    CheckThreshold,
    LoopExit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Scope {
    Run,
    Feature,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Boundary {
    pub(crate) phase: String,
    pub(crate) kind: GateKind,
    pub(crate) scope: Scope,
}

/// One `gated` entry of sop-orchestration.yml. `basis` is prose for
/// people and is not kept.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub(crate) struct GatedSop {
    pub(crate) gates: Vec<GateKind>,
    #[serde(default)]
    pub(crate) phases: Vec<String>,
    #[serde(default)]
    pub(crate) boundaries: Vec<Boundary>,
}

/// sop-orchestration.yml's `gated` entries, keyed by SOP name. The
/// `marker` and `not_gated` keys are for the list's lint and are ignored.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub(crate) struct GateMap {
    pub(crate) gated: BTreeMap<String, GatedSop>,
}

#[derive(Deserialize)]
struct RawSeveritySchema {
    severities: Vec<RawSeverityEntry>,
}

/// `deny_unknown_fields` makes a misspelled key such as `alias` an error
/// instead of a silently empty alias list.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSeverityEntry {
    id: String,
    rank: u8,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    #[allow(dead_code)]
    description: Option<String>,
    #[serde(default)]
    exit_code_signal: Option<String>,
}

const CRITICAL_GATE_SIGNAL: &str = "critical_gate";

/// The embedded severity-schema.yml.
pub(crate) fn severity_table() -> Result<SeverityTable, GateConfigError> {
    parse_severity_table(SEVERITY_SCHEMA)
}

/// The embedded sop-orchestration.yml.
pub(crate) fn gate_map() -> Result<GateMap, GateConfigError> {
    parse_gate_map(SOP_ORCHESTRATION)
}

fn severity_error(message: impl Into<String>) -> GateConfigError {
    GateConfigError {
        file: SEVERITY_SCHEMA_NAME,
        message: message.into(),
    }
}

fn parse_severity_table(text: &str) -> Result<SeverityTable, GateConfigError> {
    let raw: RawSeveritySchema =
        serde_yaml::from_str(text).map_err(|err| severity_error(err.to_string()))?;
    let entries = raw
        .severities
        .into_iter()
        .map(|entry| {
            let id = entry
                .id
                .parse::<Severity>()
                .map_err(|()| severity_error(format!("unknown severity id '{}'", entry.id)))?;
            check_exit_code_signal(id, entry.exit_code_signal.as_deref())
                .map_err(severity_error)?;
            Ok(SeverityEntry {
                id,
                rank: entry.rank,
                aliases: entry.aliases,
            })
        })
        .collect::<Result<Vec<_>, GateConfigError>>()?;
    let table = SeverityTable { entries };
    check_aliases(&table).map_err(severity_error)?;
    Ok(table)
}

/// Only CRITICAL carries the `critical_gate` marker.
fn check_exit_code_signal(id: Severity, signal: Option<&str>) -> Result<(), String> {
    let expected = (id == Severity::Critical).then_some(CRITICAL_GATE_SIGNAL);
    if signal == expected {
        return Ok(());
    }
    Err(format!(
        "{id} has exit_code_signal {signal:?}, expected {expected:?}"
    ))
}

/// Each alias is one word of ASCII letters, the only shape the lookup can
/// match, and names one id only, so a word can never rank two ways.
/// Words match ignoring case, so aliases that differ only by case collide.
fn check_aliases(table: &SeverityTable) -> Result<(), String> {
    let ids: BTreeSet<String> = table
        .entries
        .iter()
        .map(|e| e.id.to_string().to_ascii_uppercase())
        .collect();
    let mut seen = BTreeSet::new();
    for entry in &table.entries {
        for alias in &entry.aliases {
            let folded = alias.to_ascii_uppercase();
            if folded.is_empty() || leading_severity_token(alias) != folded {
                return Err(format!(
                    "alias '{alias}' of {} must be a single word of ASCII letters",
                    entry.id
                ));
            }
            if ids.contains(&folded) {
                return Err(format!("alias '{alias}' of {} is a severity id", entry.id));
            }
            if !seen.insert(folded) {
                return Err(format!(
                    "alias '{alias}' appears more than once (ignoring case)"
                ));
            }
        }
    }
    Ok(())
}

/// The table's ids and ranks, in order, must equal `Severity::ALL` and
/// `Severity::rank`.
#[cfg(test)]
pub(crate) fn check_parity(table: &SeverityTable) -> Result<(), String> {
    let file_ids: Vec<Severity> = table.entries.iter().map(|e| e.id).collect();
    if file_ids != Severity::ALL {
        return Err(format!(
            "severity ids {file_ids:?} differ from the CLI's {:?}",
            Severity::ALL
        ));
    }
    for entry in &table.entries {
        if entry.rank != entry.id.rank() {
            return Err(format!(
                "{} has rank {} in the file but {} in the CLI",
                entry.id,
                entry.rank,
                entry.id.rank()
            ));
        }
    }
    Ok(())
}

fn parse_gate_map(text: &str) -> Result<GateMap, GateConfigError> {
    serde_yaml::from_str(text).map_err(|err| GateConfigError {
        file: SOP_ORCHESTRATION_NAME,
        message: err.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::config;
    use std::fs;

    fn table() -> SeverityTable {
        severity_table().expect("embedded severity-schema.yml must parse")
    }

    #[test]
    fn embedded_files_parse() {
        table();
        gate_map().expect("embedded sop-orchestration.yml must parse");
    }

    #[test]
    fn embedded_severity_ids_and_ranks_match_the_enum() {
        assert_eq!(check_parity(&table()), Ok(()));
    }

    #[test]
    fn embedded_aliases_are_unique_and_never_ids() {
        let table = table();
        let ids: BTreeSet<String> = Severity::ALL.iter().map(|s| s.to_string()).collect();
        let aliases: Vec<String> = table
            .entries
            .iter()
            .flat_map(|e| &e.aliases)
            .map(|a| a.to_ascii_uppercase())
            .collect();
        let unique: BTreeSet<&String> = aliases.iter().collect();
        assert_eq!(
            aliases.len(),
            unique.len(),
            "duplicate alias in {aliases:?}"
        );
        assert!(aliases.iter().all(|a| !ids.contains(a)));
    }

    #[test]
    fn checker_words_map_to_gate_ids() {
        let table = table();
        for (word, expected) in [
            ("IMPORTANT", Severity::High),
            ("WARNING", Severity::High),
            ("SUGGESTION", Severity::Low),
            ("MINOR", Severity::Low),
            ("CRITICAL", Severity::Critical),
            (" HIGH ", Severity::High),
        ] {
            assert_eq!(
                table.rank_of_word(word),
                WordRank::Known(expected),
                "{word}"
            );
        }
        assert_eq!(table.rank_of_word("bogus"), WordRank::Unknown);
        assert_eq!(table.rank_of_word("bogus-severity"), WordRank::Unknown);
        assert_eq!(table.rank_of_word(""), WordRank::Unknown);
        assert_eq!(table.rank_of_word("🚨"), WordRank::Unknown);
    }

    #[test]
    fn unknown_word_counts_as_critical() {
        let table = table();
        assert_eq!(
            table.gate_rank_of_word("bogus"),
            (Severity::Critical, false)
        );
        assert_eq!(table.gate_rank_of_word(""), (Severity::Critical, false));
        assert_eq!(table.gate_rank_of_word("Suggestion"), (Severity::Low, true));
        assert_eq!(table.gate_rank_of_word("IMPORTANT"), (Severity::High, true));
    }

    #[test]
    fn matching_ignores_case_emoji_and_trailing_words() {
        let table = table();
        for (word, expected) in [
            ("important", Severity::High),
            ("Warning", Severity::High),
            ("Suggestion", Severity::Low),
            ("🚨 Critical Gap", Severity::Critical),
            ("⚠️ Warning Gap", Severity::High),
            ("💡 Suggestion", Severity::Low),
            ("**CRITICAL", Severity::Critical),
            ("CRITICAL \u{2014} architectural", Severity::Critical),
            ("Medium", Severity::Medium),
            ("Low", Severity::Low),
        ] {
            assert_eq!(
                table.rank_of_word(word),
                WordRank::Known(expected),
                "{word}"
            );
        }
    }

    #[test]
    fn aliases_differing_only_by_case_are_rejected() {
        let text = "severities:\n  - {id: HIGH, rank: 3, aliases: [Important]}\n  - {id: LOW, rank: 1, aliases: [IMPORTANT]}\n";
        let err = parse_severity_table(text).unwrap_err();
        assert!(err.message.contains("more than once"), "{err}");
        let text = "severities:\n  - {id: HIGH, rank: 3, aliases: [low]}\n  - {id: LOW, rank: 1}\n";
        let err = parse_severity_table(text).unwrap_err();
        assert!(err.message.contains("is a severity id"), "{err}");
    }

    /// Severity labels are the bold, bullet, table-cell or legend words the
    /// gated SOPs' checker skills tell the reader to write.
    fn checker_labels() -> Vec<(&'static str, Vec<&'static str>)> {
        vec![
            (
                "test-coverage-analysis",
                vec![
                    "🚨 Critical Gap",
                    "⚠️ Warning Gap",
                    "💡 Suggestion",
                    "Warning",
                    "Warnings",
                    "Critical",
                    "CRITICAL (must fix):",
                    "IMPORTANT (should fix):",
                    "SUGGESTION:",
                ],
            ),
            (
                "security-test-generation",
                vec![
                    "CRITICAL (must fix):",
                    "IMPORTANT (should fix):",
                    "SUGGESTION:",
                ],
            ),
            (
                "design-evaluation",
                vec![
                    "CRITICAL (blocks implementation):",
                    "IMPORTANT (should address before implementation):",
                    "SUGGESTION:",
                ],
            ),
            (
                "adversarial-design-review",
                vec![
                    "CRITICAL \u{2014} architectural:",
                    "CRITICAL \u{2014} factual:",
                    "IMPORTANT:",
                    "MINOR:",
                ],
            ),
            ("design-quality-check", vec!["IMPORTANT", "MINOR"]),
            ("doc-accuracy-analyzer", vec!["High", "Medium", "Low"]),
        ]
    }

    fn skill_text(skill: &str) -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../skills")
            .join(skill)
            .join("SKILL.md");
        fs::read_to_string(&path).unwrap_or_else(|err| panic!("{skill}: {err}"))
    }

    /// `label` appears with no ASCII letter or digit touching it where the
    /// label itself starts or ends with one, so `Critical` does not match
    /// inside `Criticality`.
    fn contains_whole_word(text: &str, label: &str) -> bool {
        let starts_alnum = label.starts_with(|c: char| c.is_ascii_alphanumeric());
        let ends_alnum = label.ends_with(|c: char| c.is_ascii_alphanumeric());
        text.match_indices(label).any(|(start, _)| {
            let before_ok =
                !starts_alnum || !text[..start].ends_with(|c: char| c.is_ascii_alphanumeric());
            let after_ok = !ends_alnum
                || !text[start + label.len()..].starts_with(|c: char| c.is_ascii_alphanumeric());
            before_ok && after_ok
        })
    }

    #[test]
    fn whole_word_match_rejects_longer_words() {
        assert!(!contains_whole_word(
            "the Criticality attribute",
            "Critical"
        ));
        assert!(!contains_whole_word("Warnings: 3", "Warning"));
        assert!(contains_whole_word("Warnings: 3", "Warnings"));
        assert!(contains_whole_word("**SUGGESTION:**", "SUGGESTION:"));
        assert!(contains_whole_word("a Critical gap", "Critical"));
    }

    #[test]
    fn labels_listed_for_each_checker_appear_in_its_skill() {
        for (skill, labels) in checker_labels() {
            let text = skill_text(skill);
            for label in labels {
                assert!(
                    contains_whole_word(&text, label),
                    "{skill} no longer contains '{label}'"
                );
            }
        }
    }

    /// Severity words a skill writes in the places the labels live: the
    /// `Severity` column of a table, `**Severity:** value` lines and bold
    /// headings of the form `**WORD (note):**`.
    fn severity_words_in(text: &str) -> Vec<String> {
        let mut words = Vec::new();
        let mut column: Option<Option<usize>> = None;
        for line in text.lines().map(str::trim) {
            if !line.starts_with('|') {
                column = None;
            }
            if let Some(value) = line.strip_prefix("**Severity:**") {
                words.push(value.trim().to_string());
            } else if let Some(inner) = line
                .strip_prefix("**")
                .and_then(|rest| rest.strip_suffix(":**"))
            {
                if is_severity_heading(inner) {
                    words.push(inner.to_string());
                }
            } else if line.starts_with('|') {
                let cells: Vec<&str> = line.trim_matches('|').split('|').map(str::trim).collect();
                match column {
                    None => column = Some(cells.iter().position(|c| *c == "Severity")),
                    Some(None) => {}
                    Some(Some(index)) => {
                        let cell = cells.get(index).copied().unwrap_or("");
                        let cell = cell.trim_matches(|c| c == '`' || c == '*');
                        if cell.contains(|c: char| c.is_ascii_alphabetic()) {
                            words.push(cell.to_string());
                        }
                    }
                }
            }
        }
        words
    }

    /// An all-caps first word followed only by lowercase words or a
    /// parenthesized note, as in `CRITICAL (must fix)` or
    /// `BLOCKER (Must Fix)`; `API Layer` and `AWS Security` do not qualify.
    fn is_severity_heading(inner: &str) -> bool {
        let inner = inner.split_once('(').map_or(inner, |(head, _)| head);
        let mut runs = inner
            .split(|c: char| !c.is_ascii_alphabetic())
            .filter(|run| !run.is_empty());
        let first_is_caps = runs
            .next()
            .is_some_and(|run| run.chars().all(|c| c.is_ascii_uppercase()));
        first_is_caps && runs.all(|run| run.chars().all(|c| c.is_ascii_lowercase()))
    }

    #[test]
    fn severity_heading_accepts_parenthesized_title_case_note() {
        assert!(is_severity_heading("BLOCKER (Must Fix)"));
        assert!(is_severity_heading("CRITICAL (must fix)"));
        assert!(!is_severity_heading("API Layer"));
    }

    #[test]
    fn every_severity_word_a_checker_skill_writes_ranks_known() {
        let table = table();
        for (skill, _) in checker_labels() {
            let words = severity_words_in(&skill_text(skill));
            assert!(!words.is_empty(), "{skill}: found no severity words");
            for word in words {
                assert_ne!(
                    table.rank_of_word(&word),
                    WordRank::Unknown,
                    "{skill}: '{word}' is written as a severity but is not in the table"
                );
            }
        }
    }

    #[test]
    fn every_checker_label_ranks_known() {
        let table = table();
        for (skill, labels) in checker_labels() {
            for label in labels {
                assert_ne!(
                    table.rank_of_word(label),
                    WordRank::Unknown,
                    "{skill}: {label}"
                );
            }
        }
    }

    #[test]
    fn plural_warnings_label_ranks_high() {
        let table = table();
        for word in ["Warnings", "### Warnings (Should Address)", "Warnings: [M]"] {
            assert_eq!(
                table.rank_of_word(word),
                WordRank::Known(Severity::High),
                "{word}"
            );
        }
    }

    #[test]
    fn words_that_are_not_severities_rank_critical() {
        let table = table();
        for word in [
            "Importantly",
            "Not Ready",
            "At Risk",
            "Criticality",
            "Should Fix",
            "Priority: High",
            "High Risks",
            "### Medium Risks",
            "Low Risks",
        ] {
            assert_eq!(table.rank_of_word(word), WordRank::Unknown, "{word}");
            assert_eq!(
                table.gate_rank_of_word(word),
                (Severity::Critical, false),
                "{word}"
            );
        }
    }

    #[test]
    fn risk_priority_and_confidence_scales_rank_critical() {
        let table = table();
        for word in [
            "High Risk",
            "Medium Risk: Warning gaps",
            "Low Priority",
            "HIGH-confidence",
            "MEDIUM-confidence",
            "LOW-confidence",
        ] {
            assert_eq!(table.rank_of_word(word), WordRank::Unknown, "{word}");
            assert_eq!(
                table.gate_rank_of_word(word),
                (Severity::Critical, false),
                "{word}"
            );
        }
    }

    #[test]
    fn malformed_aliases_are_rejected() {
        for alias in [
            "''",
            "'MUST FIX'",
            "'NIT:'",
            "'\u{1F6A8}'",
            "P1",
            "' MINOR'",
        ] {
            let text = format!("severities:\n  - {{id: LOW, rank: 1, aliases: [{alias}]}}\n");
            let err = parse_severity_table(&text).unwrap_err();
            assert!(err.message.contains("single word"), "{alias}: {err}");
        }
    }

    #[test]
    fn empty_whitespace_and_unknown_labels_fail_closed_to_critical() {
        let table = table();
        for word in ["", " ", "\t\n", "\u{1F6A8}", "bogus", "default"] {
            assert_eq!(
                table.gate_rank_of_word(word),
                (Severity::Critical, false),
                "{word:?}"
            );
        }
    }

    #[test]
    fn misspelled_severity_key_is_rejected() {
        for key in ["alias", "aliasses"] {
            let text = format!("severities:\n  - {{id: HIGH, rank: 3, {key}: [IMPORTANT]}}\n");
            let err = parse_severity_table(&text).unwrap_err();
            assert_eq!(err.file, SEVERITY_SCHEMA_NAME);
            assert!(err.message.contains(key), "{key}: {err}");
        }
    }

    #[test]
    fn critical_gate_marker_must_sit_on_critical_only() {
        let moved = "severities:\n  - {id: CRITICAL, rank: 4, exit_code_signal: null}\n  - {id: HIGH, rank: 3, exit_code_signal: critical_gate}\n";
        assert!(parse_severity_table(moved).is_err());
        let removed = "severities:\n  - {id: CRITICAL, rank: 4}\n";
        assert!(parse_severity_table(removed).is_err());
    }

    #[test]
    fn parity_fails_when_order_differs_from_the_enum() {
        let mut swapped = table();
        swapped.entries.swap(0, 1);
        assert!(check_parity(&swapped).is_err());
    }

    #[test]
    fn parity_fails_when_a_rank_differs_from_the_enum() {
        let mut reranked = table();
        reranked.entries[1].rank = 9;
        assert!(check_parity(&reranked).is_err());
    }

    #[test]
    fn duplicate_alias_is_rejected() {
        let text = "severities:\n  - {id: HIGH, rank: 3, aliases: [IMPORTANT]}\n  - {id: LOW, rank: 1, aliases: [IMPORTANT]}\n";
        let err = parse_severity_table(text).unwrap_err();
        assert_eq!(err.file, SEVERITY_SCHEMA_NAME);
        assert!(err.message.contains("more than once"), "{err}");
    }

    #[test]
    fn alias_equal_to_an_id_is_rejected() {
        let text = "severities:\n  - {id: HIGH, rank: 3, aliases: [LOW]}\n  - {id: LOW, rank: 1}\n";
        let err = parse_severity_table(text).unwrap_err();
        assert!(err.message.contains("is a severity id"), "{err}");
    }

    #[test]
    fn unknown_severity_id_is_rejected() {
        let err = parse_severity_table("severities:\n  - {id: BLOCKER, rank: 5}\n").unwrap_err();
        assert!(err.message.contains("BLOCKER"), "{err}");
    }

    #[test]
    fn full_sdlc_lists_twelve_phases_and_five_boundaries() {
        let map = gate_map().unwrap();
        let sop = &map.gated["k-full-sdlc"];
        assert_eq!(sop.phases.len(), 12);
        assert_eq!(sop.boundaries.len(), 5);
        assert_eq!(
            sop.boundaries[0],
            Boundary {
                phase: "design-review".to_string(),
                kind: GateKind::CheckThreshold,
                scope: Scope::Run,
            }
        );
    }

    #[test]
    fn gated_entry_without_phases_has_empty_vectors() {
        let text = "marker: x\ngated:\n  some-sop:\n    gates: [loop-exit]\n    basis: b\nnot_gated:\n  other: o\n";
        let map = parse_gate_map(text).unwrap();
        let sop = &map.gated["some-sop"];
        assert_eq!(sop.gates, vec![GateKind::LoopExit]);
        assert!(sop.phases.is_empty());
        assert!(sop.boundaries.is_empty());
    }

    #[test]
    fn unknown_boundary_field_is_rejected() {
        let text = "gated:\n  s:\n    gates: [approval]\n    phases: [a]\n    boundaries:\n      - {phase: a, kind: approval, scope: run, extra: 1}\n";
        let err = parse_gate_map(text).unwrap_err();
        assert_eq!(err.file, SOP_ORCHESTRATION_NAME);
    }

    /// Aliases are for checker words only; config severity fields still
    /// load and accept gate ids exactly as before.
    #[test]
    fn config_loading_is_unchanged_by_aliases() {
        let root = std::env::temp_dir().join(format!(
            "konductor-gate-config-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();

        let loaded = config::load_config_with_home(&root, None).unwrap();
        assert_eq!(loaded.fail_on_severity_at_or_above, "CRITICAL");
        assert_eq!(loaded.severities_source, "severity-schema.yml");

        fs::create_dir_all(root.join(".konductor")).unwrap();
        fs::write(
            root.join(".konductor/config.yml"),
            "fail_on_severity_at_or_above: IMPORTANT\n",
        )
        .unwrap();
        assert!(
            config::load_config_with_home(&root, None).is_err(),
            "an alias must not be accepted as a config severity"
        );

        fs::remove_dir_all(&root).ok();
    }
}
