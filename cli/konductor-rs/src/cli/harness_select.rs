// SPDX-License-Identifier: Apache-2.0
//
// Shared `--harness <name>` selection for `update`/`uninstall` once a
// target's manifest tracks 2+ strategies. Both callers need identical
// selection behavior, so it lives here rather than duplicated per caller.
//
// Four cases (0 tracked strategies is the caller's own upstream case,
// never passed here):
//   - `--harness <name>` given: matched against tracked strategy names.
//     An unmatched name is a usage error listing what IS tracked. This
//     check runs even with exactly one tracked strategy -- see below.
//   - No `--harness`, 1 slot: returned directly, no prompt.
//   - No `--harness`, 2+ slots, interactive (not an `--all` batch run,
//     not `--json`, stdin is a TTY): numbered picker. An invalid or
//     empty response is a usage error.
//   - No `--harness`, 2+ slots, non-interactive: usage error (exit 64).
//
// A single tracked slot is still validated against an explicit
// `--harness` rather than returned unconditionally. `kiro-cli-v2` and
// `kiro-v3` share every destination path and override each other's slot
// on install, so a concurrent install landing between an uninstall's
// manifest read and its locked delete can leave exactly one slot tracked
// -- not necessarily the one the caller asked for. Skipping this check
// would silently delete the wrong harness.
//
// The flag is `--harness`, matching `install --harness <name>`'s
// existing name for the same concept, not `--strategy`. It selects
// exactly one strategy per invocation; there is no `all` value -- the
// existing `--all` flag already covers "every target", and a second
// "every strategy within one target" mode is out of scope.

use std::io::IsTerminal;

use super::install::manifest::StrategyManifest;

/// Every tracked strategy's own name, sorted for a deterministic
/// display/error order.
fn sorted_display_names(strategies: &[StrategyManifest]) -> Vec<&str> {
    let mut names: Vec<&str> = strategies.iter().map(|s| s.strategy.as_str()).collect();
    names.sort_unstable();
    names
}

/// Why `select_harness` failed. Split into two variants so a batch
/// caller (`uninstall.rs`'s `--all`, via `dispatch_all`) can treat
/// "target doesn't track the requested harness" as a per-target skip
/// rather than a failure, without parsing the error message to tell
/// the two apart.
#[derive(Debug)]
pub(crate) enum HarnessSelectionError {
    /// An explicit `--harness <name>` was given, but this target does
    /// not track a strategy by that name.
    NotTracked(String),
    /// Every other usage error: ambiguous selection with no `--harness`
    /// given and no way to prompt (batch, `--json`, or no TTY), or an
    /// invalid response to the interactive picker.
    Ambiguous(String),
}

impl HarnessSelectionError {
    /// Whether this is specifically the "target doesn't track the
    /// requested harness" case -- the one case a batch caller should
    /// treat as a skip instead of a failure.
    pub(crate) fn is_not_tracked(&self) -> bool {
        matches!(self, HarnessSelectionError::NotTracked(_))
    }
}

impl std::fmt::Display for HarnessSelectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HarnessSelectionError::NotTracked(message) => write!(f, "{message}"),
            HarnessSelectionError::Ambiguous(message) => write!(f, "{message}"),
        }
    }
}

/// Resolves which of `strategies` (non-empty; see module doc) to act on
/// for this run, per the four cases above. `target_dir` is used only
/// for the error/prompt text.
pub(crate) fn select_harness<'a>(
    target_dir: &str,
    strategies: &'a [StrategyManifest],
    harness: Option<&str>,
    allow_interactive: bool,
    json: bool,
) -> Result<&'a StrategyManifest, HarnessSelectionError> {
    // Checked before the 1-slot shortcut below -- an explicit --harness
    // must be validated even when only one strategy is tracked (see
    // module doc for why).
    if let Some(harness_value) = harness {
        return strategies
            .iter()
            .find(|s| s.strategy == harness_value)
            .ok_or_else(|| {
                HarnessSelectionError::NotTracked(format!(
                "{target_dir} does not track harness '{harness_value}'; tracked harness(es): {}",
                sorted_display_names(strategies).join(", ")
            ))
            });
    }
    if strategies.len() == 1 {
        return Ok(&strategies[0]);
    }
    if allow_interactive && !json && std::io::stdin().is_terminal() {
        return prompt_for_harness(target_dir, strategies);
    }
    Err(HarnessSelectionError::Ambiguous(format!(
        "{target_dir} tracks multiple harnesses ({}); pass --harness <name> to select one",
        sorted_display_names(strategies).join(", ")
    )))
}

/// Prints a numbered list of `strategies` to stderr and reads one line
/// from stdin as a 1-based index. Any invalid response -- including
/// empty input or a read error -- is a usage error, the same convention
/// `uninstall.rs`'s `confirm_destructive_uninstall` applies to its own
/// y/n prompt. Always returns `Ambiguous`; there's no name to mismatch
/// in this path.
fn prompt_for_harness<'a>(
    target_dir: &str,
    strategies: &'a [StrategyManifest],
) -> Result<&'a StrategyManifest, HarnessSelectionError> {
    let mut sorted: Vec<&StrategyManifest> = strategies.iter().collect();
    sorted.sort_by(|a, b| a.strategy.cmp(&b.strategy));

    eprintln!("{target_dir} tracks multiple harnesses:");
    for (index, slot) in sorted.iter().enumerate() {
        eprintln!("  {}) {}", index + 1, slot.strategy);
    }
    eprint!("Select a harness [1-{}]: ", sorted.len());

    let mut input = String::new();
    if std::io::stdin().read_line(&mut input).is_err() {
        return Err(HarnessSelectionError::Ambiguous(invalid_selection_message(
            target_dir, &sorted,
        )));
    }
    match parse_harness_choice(&input, sorted.len()) {
        Some(choice) => Ok(sorted[choice - 1]),
        None => Err(HarnessSelectionError::Ambiguous(invalid_selection_message(
            target_dir, &sorted,
        ))),
    }
}

/// Parses a raw response line into a 1-based index in `[1, count]`, or
/// `None` for anything invalid (non-numeric, zero, out of range,
/// garbage). Split out from `prompt_for_harness` for testability, since
/// stdin can't be faked -- same reasoning as `uninstall.rs`'s
/// `parse_confirmation_response`.
fn parse_harness_choice(raw: &str, count: usize) -> Option<usize> {
    let choice = raw.trim().parse::<usize>().ok()?;
    if choice == 0 || choice > count {
        return None;
    }
    Some(choice)
}

fn invalid_selection_message(target_dir: &str, sorted: &[&StrategyManifest]) -> String {
    let names: Vec<&str> = sorted.iter().map(|s| s.strategy.as_str()).collect();
    format!(
        "{target_dir}: invalid harness selection; pass --harness <name> to select one of: {}",
        names.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::install::manifest::{ManifestFile, Status};

    fn slot(strategy: &str) -> StrategyManifest {
        StrategyManifest::new(
            strategy,
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::Complete,
            Vec::<ManifestFile>::new(),
        )
    }

    #[test]
    fn single_slot_returns_directly_no_flag_needed() {
        let strategies = vec![slot("kiro-cli-v2")];
        let selected = select_harness("/t", &strategies, None, true, false).unwrap();
        assert_eq!(selected.strategy, "kiro-cli-v2");
    }

    /// `--harness` is matched directly against the manifest's own
    /// tracked `StrategyManifest.strategy` values -- no translation
    /// layer between what a user types and what the manifest stores.
    #[test]
    fn explicit_harness_matches_the_tracked_strategy_name_directly() {
        let strategies = vec![slot("kiro-cli-v2"), slot("claude")];
        let selected = select_harness("/t", &strategies, Some("claude"), true, false).unwrap();
        assert_eq!(selected.strategy, "claude");
    }

    /// Requesting a harness tracked at neither slot must be a usage
    /// error naming what IS tracked, classified `NotTracked` (not
    /// `Ambiguous`) so a batch caller treats it as a skip.
    #[test]
    fn explicit_harness_not_tracked_at_target_is_a_usage_error() {
        let strategies = vec![slot("kiro-cli-v2"), slot("kiro-v3")];
        let err = select_harness("/t", &strategies, Some("claude"), true, false).unwrap_err();
        assert!(err.is_not_tracked());
        let message = err.to_string();
        assert!(
            message.contains("does not track harness 'claude'"),
            "got: {message}"
        );
        assert!(message.contains("kiro-cli-v2"), "got: {message}");
        assert!(message.contains("kiro-v3"), "got: {message}");
    }

    /// A single tracked strategy that doesn't match an explicit
    /// `--harness` must be a usage error, not a silent return of that
    /// slot -- this is the shape a kiro-cli-v2/kiro-v3 override race
    /// leaves behind. Also classified `NotTracked`.
    #[test]
    fn explicit_harness_not_tracked_at_a_single_slot_target_is_a_usage_error() {
        let strategies = vec![slot("kiro-v3")];
        let err = select_harness("/t", &strategies, Some("kiro-cli-v2"), true, false).unwrap_err();
        assert!(err.is_not_tracked());
        let message = err.to_string();
        assert!(
            message.contains("does not track harness 'kiro-cli-v2'"),
            "got: {message}"
        );
        assert!(message.contains("kiro-v3"), "got: {message}");
    }

    /// The fix above only rejects a mismatch -- an explicit `--harness`
    /// matching the sole tracked slot still succeeds.
    #[test]
    fn explicit_harness_matching_the_single_tracked_slot_still_succeeds() {
        let strategies = vec![slot("kiro-cli-v2")];
        let selected = select_harness("/t", &strategies, Some("kiro-cli-v2"), true, false).unwrap();
        assert_eq!(selected.strategy, "kiro-cli-v2");
    }

    #[test]
    fn no_harness_non_interactive_json_is_a_usage_error() {
        let strategies = vec![slot("kiro-cli-v2"), slot("claude")];
        let err = select_harness("/t", &strategies, None, true, true).unwrap_err();
        assert!(!err.is_not_tracked(), "ambiguous selection, not a mismatch");
        let message = err.to_string();
        assert!(
            message.contains("tracks multiple harnesses"),
            "got: {message}"
        );
    }

    #[test]
    fn no_harness_batch_mode_is_a_usage_error_even_if_a_tty() {
        let strategies = vec![slot("kiro-cli-v2"), slot("claude")];
        // `allow_interactive = false` mirrors an `--all` target batch --
        // never prompts regardless of the real stdin/TTY state.
        let err = select_harness("/t", &strategies, None, false, false).unwrap_err();
        assert!(!err.is_not_tracked(), "ambiguous selection, not a mismatch");
        let message = err.to_string();
        assert!(
            message.contains("tracks multiple harnesses"),
            "got: {message}"
        );
    }

    #[test]
    fn display_names_are_tracked_strategy_names_sorted() {
        let strategies = vec![slot("claude"), slot("kiro-cli-v2"), slot("kiro-v3")];
        assert_eq!(
            sorted_display_names(&strategies),
            vec!["claude", "kiro-cli-v2", "kiro-v3"]
        );
    }

    // -- parse_harness_choice --

    #[test]
    fn parse_harness_choice_accepts_a_valid_in_range_number() {
        assert_eq!(parse_harness_choice("2", 3), Some(2));
    }

    #[test]
    fn parse_harness_choice_trims_surrounding_whitespace() {
        assert_eq!(parse_harness_choice("  2\n", 3), Some(2));
    }

    #[test]
    fn parse_harness_choice_rejects_zero() {
        assert_eq!(parse_harness_choice("0", 3), None);
    }

    #[test]
    fn parse_harness_choice_rejects_out_of_range() {
        assert_eq!(parse_harness_choice("4", 3), None);
    }

    #[test]
    fn parse_harness_choice_rejects_non_numeric_input() {
        assert_eq!(parse_harness_choice("claude", 3), None);
    }

    #[test]
    fn parse_harness_choice_rejects_empty_input() {
        assert_eq!(parse_harness_choice("", 3), None);
    }
}
