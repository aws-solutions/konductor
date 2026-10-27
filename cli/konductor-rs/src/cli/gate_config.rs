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
    /// Maps a checker's word to a gate id by exact id or alias match.
    /// Case-sensitive; surrounding whitespace is ignored.
    pub(crate) fn rank_of_word(&self, word: &str) -> WordRank {
        let word = word.trim();
        self.entries
            .iter()
            .find(|entry| entry.id.to_string() == word || entry.aliases.iter().any(|a| a == word))
            .map_or(WordRank::Unknown, |entry| WordRank::Known(entry.id))
    }
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

#[derive(Deserialize)]
struct RawSeverityEntry {
    id: String,
    rank: u8,
    #[serde(default)]
    aliases: Vec<String>,
}

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

/// Each alias names one id only, so a word can never rank two ways.
fn check_aliases(table: &SeverityTable) -> Result<(), String> {
    let ids: BTreeSet<String> = table.entries.iter().map(|e| e.id.to_string()).collect();
    let mut seen = BTreeSet::new();
    for entry in &table.entries {
        for alias in &entry.aliases {
            if ids.contains(alias) {
                return Err(format!("alias '{alias}' of {} is a severity id", entry.id));
            }
            if !seen.insert(alias.as_str()) {
                return Err(format!("alias '{alias}' appears more than once"));
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
        let aliases: Vec<&String> = table.entries.iter().flat_map(|e| &e.aliases).collect();
        let unique: BTreeSet<&String> = aliases.iter().copied().collect();
        assert_eq!(
            aliases.len(),
            unique.len(),
            "duplicate alias in {aliases:?}"
        );
        assert!(aliases.iter().all(|a| !ids.contains(*a)));
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
        assert_eq!(table.rank_of_word("important"), WordRank::Unknown);
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
