// SPDX-License-Identifier: Apache-2.0
//
// install/registry.rs — self-registering `InstallStrategy` table.
//
// Strategy implementations append themselves to this slice, one line
// per implementation. `dispatch_install_with` selects a strategy by
// exact `harness_dir()` match against the now-REQUIRED `--harness`
// argument (see `install.rs`'s own doc comment on that lookup) --
// registration order in this slice has NO effect on that selection.

use super::claude::ClaudeInstallStrategy;
use super::kiro_cli::KiroCliInstallStrategy;
use super::kiro_cli_v3::KiroCliV3InstallStrategy;
use super::InstallStrategy;

/// Order in this slice has no effect on production behavior: selection
/// is by exact `harness_dir()` match against the required `--harness`
/// value (see `install.rs`), not by iterating and asking each strategy
/// to `matches()` the destination. `KiroCliInstallStrategy` stays first
/// only because each strategy's own `matches()` unit tests (and the
/// `kiro_cli_is_registered_before_claude_code` test below) still pin
/// that ordering. `KiroCliV3InstallStrategy` is appended after it,
/// alongside `ClaudeInstallStrategy` -- its own registration order
/// relative to the other two carries no contract either, for the same
/// reason.
pub static STRATEGIES: &[&dyn InstallStrategy] = &[
    &KiroCliInstallStrategy,
    &KiroCliV3InstallStrategy,
    &ClaudeInstallStrategy,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strategies_contains_registered_kiro_cli_strategy() {
        assert!(STRATEGIES.iter().any(|s| s.name() == "kiro-cli"));
    }

    #[test]
    fn strategies_contains_registered_kiro_cli_v3_strategy() {
        assert!(STRATEGIES.iter().any(|s| s.name() == "kiro-cli-v3"));
        assert!(STRATEGIES.iter().any(|s| s.harness_dir() == "kiro-v3"));
    }

    #[test]
    fn strategies_contains_registered_claude_code_strategy() {
        assert!(STRATEGIES.iter().any(|s| s.name() == "claude-code"));
    }

    /// Regression pin on `InstallStrategy::matches()`'s ordering-sensitive
    /// behavior (see the doc comment on `STRATEGIES`), even though
    /// production `install` selection no longer depends on it.
    #[test]
    fn kiro_cli_is_registered_before_claude_code() {
        let names: Vec<&str> = STRATEGIES.iter().map(|s| s.name()).collect();
        let kiro_index = names.iter().position(|n| *n == "kiro-cli").unwrap();
        let claude_index = names.iter().position(|n| *n == "claude-code").unwrap();
        assert!(
            kiro_index < claude_index,
            "kiro-cli must stay registered first, matching matches()'s own \
             registration-order test below"
        );
    }

    /// Pins the invariant `dispatch_install_with`'s `--harness` lookup
    /// depends on: every `harness_dir()` this registry exposes must be a
    /// name `synth::registry::TRANSFORMERS` also registers. `cli.rs`'s
    /// `--harness` clap parser is derived from `TRANSFORMERS` (not from
    /// this registry -- see `harness_value_parser()`), so a future
    /// `InstallStrategy` whose `harness_dir()` was never added to
    /// `TRANSFORMERS` would be silently unreachable: clap would reject
    /// the value at parse time, before `dispatch_install_with` ever got
    /// a chance to select that strategy or `report_no_strategy_for_harness`
    /// got a chance to explain the gap. A full derivation can't collapse
    /// this into a single list -- `report_no_strategy_for_harness`'s own
    /// "supported" text deliberately stays narrower than the clap
    /// allowlist, since a registered synth harness can still have no
    /// consuming `InstallStrategy` (e.g. a future `kiro-ide` or `codex`
    /// transformer, per `synth::registry`'s own reservation table). This
    /// test is the equality-style guard for the reverse direction --
    /// every registered `InstallStrategy` names a real synth harness --
    /// mirroring `synth::registry`'s own `transformer_names_are_unique`
    /// test in spirit: it fails loudly the moment a new `InstallStrategy`
    /// lands for a harness name `TRANSFORMERS` doesn't (yet) know about.
    #[test]
    fn every_strategy_harness_dir_is_a_registered_synth_transformer_name() {
        let transformer_names: Vec<&str> = crate::cli::synth::registry::TRANSFORMERS
            .iter()
            .map(|transformer| transformer.name())
            .collect();
        for strategy in STRATEGIES {
            let harness_dir = strategy.harness_dir();
            assert!(
                transformer_names.contains(&harness_dir),
                "InstallStrategy '{}' has harness_dir() = '{harness_dir}', which is not \
                 a registered synth::registry::TRANSFORMERS name ({transformer_names:?}) -- \
                 the --harness clap parser is derived from TRANSFORMERS, so this strategy \
                 would be unreachable via the CLI even though it is registered here",
                strategy.name()
            );
        }
    }
}
