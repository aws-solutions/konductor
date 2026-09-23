// SPDX-License-Identifier: Apache-2.0
//
// synth/registry.rs — self-registering `HarnessTransformer` table.
//
// Transformer implementations append themselves to this slice, one line
// per implementation.

use super::claude::ClaudeTransformer;
use super::kiro_cli_v2::KiroCliV2Transformer;
use super::kiro_cli_v3::KiroCliV3Transformer;
#[cfg(test)]
use super::path_safety::case_insensitive_fold_key;
use super::HarnessTransformer;

/// Reserved first-party `HarnessTransformer::name()` values -- one per
/// harness this project intends to ship. `kiro-cli-v2`, `kiro-v3`, and
/// `claude` are registered today; the remaining two names are reserved
/// here so a future contributor doesn't casually reuse one of them for
/// something unrelated before its transformer lands. This is a
/// documentation-only reservation -- there is no runtime enforcement,
/// and none is planned: there is no third-party admission boundary
/// today for it to protect (this static slice is the sole registration
/// point, edited by first-party contributors only).
///
/// `kiro-v3` is registered: Kiro CLI V3 (KAS)'s public schema is
/// confirmed directly against kiro.dev (see `kiro_cli_v3.rs`'s own
/// header comment for the four source pages and fetch dates). `kiro-v3`
/// is NOT `kiro-ide` -- that name remains reserved for the separate Kiro
/// IDE Markdown-subagent surface, which this CR does not implement.
///
/// | Registered name | Harness          | Status                                |
/// | ---------------- | ----------------- | ------------------------------------- |
/// | `kiro-cli-v2`     | Kiro CLI (V2)      | Registered (`KiroCliV2Transformer`)   |
/// | `kiro-v3`         | Kiro CLI V3 (KAS)  | Registered (`KiroCliV3Transformer`)   |
/// | `kiro-ide`        | Kiro IDE           | Reserved -- not yet implemented       |
/// | `claude`          | Claude Code        | Registered (`ClaudeTransformer`)      |
/// | `codex`           | Codex              | Reserved -- not yet implemented       |
pub static TRANSFORMERS: &[&dyn HarnessTransformer] = &[
    &KiroCliV2Transformer,
    &KiroCliV3Transformer,
    &ClaudeTransformer,
];

/// The same five names as the table above, as data: lets
/// `every_registered_name_is_reserved` cross-check that every currently
/// *registered* name actually appears in the *documented* reservation
/// list, so the doc comment's table can't silently drift from what's
/// really registered (e.g. a future transformer landing under
/// `"kiro-ide-v2"` instead of the documented `"kiro-ide"`). `#[cfg(test)]`
/// since it exists purely to back that test, not runtime logic.
#[cfg(test)]
const RESERVED_NAMES: &[&str] = &["kiro-cli-v2", "kiro-v3", "kiro-ide", "claude", "codex"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transformers_contains_registered_kiro_cli_v2_transformer() {
        assert!(TRANSFORMERS.iter().any(|t| t.name() == "kiro-cli-v2"));
    }

    #[test]
    fn transformers_contains_registered_claude_transformer() {
        assert!(TRANSFORMERS.iter().any(|t| t.name() == "claude"));
    }

    #[test]
    fn transformers_contains_registered_kiro_cli_v3_transformer() {
        assert!(TRANSFORMERS.iter().any(|t| t.name() == "kiro-v3"));
    }

    /// Guards the one real gap the registry pattern has today: nothing
    /// stops two `HarnessTransformer` impls from registering under the
    /// same `name()`. `dispatch_synth_with` iterates `TRANSFORMERS` in
    /// order and reports failures by name -- a collision would make two
    /// distinct transformers indistinguishable in that output and would
    /// silently double-write (or race on) the same `output_root.join(name)`
    /// directory. This fails if a second `&KiroCliV2Transformer` entry
    /// is ever appended to `TRANSFORMERS` above.
    #[test]
    fn transformer_names_are_unique() {
        let mut names: Vec<&str> = TRANSFORMERS.iter().map(|t| t.name()).collect();
        let before = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(
            names.len(),
            before,
            "duplicate HarnessTransformer name registered"
        );
    }

    /// `transformer_names_are_unique` above only catches an EXACT-string
    /// collision. On a case-insensitive filesystem (default macOS APFS,
    /// Windows NTFS) two distinct-by-string names that differ only in
    /// case (e.g. a hypothetical `"Claude"` alongside `"claude"`) still
    /// resolve to the very same `output_root.join(name)` directory at
    /// runtime -- reproducing the exact silent double-write/race the
    /// uniqueness test's own doc comment describes, while passing that
    /// test outright. This guards the actual filesystem-collision
    /// contract, not just string distinctness. This fails if a second
    /// transformer named `"KIRO-CLI-V2"` (same letters, different case)
    /// is ever appended to `TRANSFORMERS`.
    ///
    /// Folds through the same `path_safety::case_insensitive_fold_key`
    /// every other case-insensitive collision check in `synth` uses (see
    /// `parse_canonical.rs`'s
    /// `case_insensitive_duplicate_agent_name_is_rejected_for_non_ascii_case`,
    /// which names this test explicitly as the guard it matches) --
    /// registered transformer names are fixed ASCII literals today, so a
    /// bare `to_lowercase()` would behave identically here in practice,
    /// but folding through the shared helper keeps this test's own claim
    /// of parity with that guard actually true rather than incidental.
    #[test]
    fn transformer_names_are_unique_case_insensitively() {
        let mut lowered: Vec<String> = TRANSFORMERS
            .iter()
            .map(|t| case_insensitive_fold_key(t.name()))
            .collect();
        let before = lowered.len();
        lowered.sort_unstable();
        lowered.dedup();
        assert_eq!(
            lowered.len(),
            before,
            "two registered HarnessTransformer names collide when lowercased -- \
             they would resolve to the same directory on a case-insensitive filesystem"
        );
    }

    /// Gives the reserved-name doc comment table actual test-time teeth:
    /// every currently *registered* `name()` must be one of the five
    /// names the table above documents as reserved. Catches drift in the
    /// other direction from `transformer_names_are_unique` -- not "are
    /// the registered names distinct from each other", but "does each
    /// registered name match what the doc comment says it should be".
    /// This fails if `KiroCliV2Transformer`'s `name()` is ever changed to
    /// return a name not in `RESERVED_NAMES` (e.g. a typo'd
    /// `"kiro-cli-v4"`). `"kiro-v3"` was this example's own
    /// placeholder for "not yet a real, reserved name" until
    /// `KiroCliV3Transformer` was implemented and registered above --
    /// it is now a real, reserved, registered name, not a valid stand-in
    /// for this docstring's "unreserved" example.
    #[test]
    fn every_registered_name_is_reserved() {
        for transformer in TRANSFORMERS {
            let name = transformer.name();
            assert!(
                RESERVED_NAMES.contains(&name),
                "registered HarnessTransformer name {name:?} is not in the documented \
                 RESERVED_NAMES list -- update the doc comment table (and RESERVED_NAMES) \
                 above TRANSFORMERS to match, or fix the transformer's name() to use the \
                 already-reserved name"
            );
        }
    }

    /// Complements `every_registered_name_is_reserved` (registered =>
    /// reserved) with the missing negative direction: a name that is
    /// only *reserved* -- `kiro-ide`, `codex` -- must stay ABSENT from
    /// `TRANSFORMERS` until its own transformer actually lands. Without
    /// this, a copy-paste mistake that accidentally registered
    /// `KiroCliV2Transformer` a second time under the name `"kiro-ide"`
    /// (instead of implementing a real `KiroIdeTransformer`) would pass
    /// every other test in this file -- it's a registered name, it's in
    /// `RESERVED_NAMES`, and it's unique -- while silently claiming a
    /// harness this design has not actually implemented.
    #[test]
    fn reserved_but_unimplemented_names_are_not_registered() {
        for reserved_only in ["kiro-ide", "codex"] {
            assert!(
                !TRANSFORMERS.iter().any(|t| t.name() == reserved_only),
                "{reserved_only:?} is documented as reserved-but-not-yet-implemented; it \
                 must not appear in TRANSFORMERS until its transformer is actually \
                 implemented and this test (and the doc comment table above) is updated"
            );
        }
    }
}
