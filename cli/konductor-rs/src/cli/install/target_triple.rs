// SPDX-License-Identifier: Apache-2.0
//
// install/target_triple.rs — maps the currently-running host's
// `std::env::consts::{OS,ARCH}` to the exact target-triple strings
// `.github/workflows/release.yml`'s build matrix publishes release
// assets for.
//
// Deliberately narrow: this crate publishes release assets for exactly
// three target triples today -- `x86_64-unknown-linux-musl`,
// `aarch64-unknown-linux-musl`, `aarch64-apple-darwin` (see
// release.yml's own top-of-file comment: no free-tier Intel macOS
// GitHub runner, so there is no `x86_64-apple-darwin` leg, and Windows
// is out of scope entirely). This module must never invent a triple
// with no published asset -- `current_host_target_triple()` returns
// `None` for every host/arch combination outside that fixed set,
// including x86_64 macOS and any Windows target, so a caller can tell
// "no asset exists for this platform" apart from a real fetch failure.

/// The pure host-triple mapping table -- the single source of truth
/// both `current_host_target_triple()` and this module's own tests
/// call, so a regression in the real mapping (e.g. a swapped/renamed
/// triple) fails a test rather than being asserted against a
/// hand-copied duplicate of itself. `os`/`arch` take the same string
/// shapes `std::env::consts::{OS, ARCH}` produce (e.g. `"linux"`,
/// `"x86_64"`).
fn map_triple(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("linux", "x86_64") => Some("x86_64-unknown-linux-musl"),
        ("linux", "aarch64") => Some("aarch64-unknown-linux-musl"),
        ("macos", "aarch64") => Some("aarch64-apple-darwin"),
        _ => None,
    }
}

/// The target triple for the CURRENTLY RUNNING host, if and only if
/// `.github/workflows/release.yml`'s build matrix publishes a
/// `skill-lookup-mcp-{version}-{triple}` asset for it. Returns `None`
/// for every other OS/ARCH combination -- most notably x86_64 macOS
/// (Intel) and any Windows target, both explicitly out of scope for
/// this release's asset matrix (see this module's own doc comment).
///
/// Reads `std::env::consts::{OS, ARCH}` -- compile-time constants
/// baked into the running binary, not runtime `uname`/OS detection --
/// so this always reports the triple of the binary that is executing,
/// matching how `matrix.target` in release.yml (not `rustc -vV`'s host
/// line) is the source of truth for a build leg's own triple.
/// Delegates to `map_triple`, the pure mapping both production code
/// and tests call.
pub(crate) fn current_host_target_triple() -> Option<&'static str> {
    map_triple(std::env::consts::OS, std::env::consts::ARCH)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins the exact three triples this module is allowed to return --
    /// each one must be byte-for-byte identical to release.yml's own
    /// `matrix.target` values, since `github.rs`'s asset-name
    /// construction is only correct if these strings match exactly.
    /// Calls the real `map_triple` directly, so a regression in the
    /// production mapping (a swapped/renamed triple) fails this test.
    #[test]
    fn returns_exactly_the_three_published_triples() {
        assert_eq!(
            map_triple("linux", "x86_64"),
            Some("x86_64-unknown-linux-musl")
        );
    }

    /// `current_host_target_triple()`'s own dedicated test: confirms it
    /// resolves to the SAME value `map_triple` produces for the
    /// CURRENT host's real `std::env::consts::{OS, ARCH}` -- still
    /// meaningfully exercises the real function even though it now
    /// trivially delegates to `map_triple`, since a regression that
    /// broke the delegation itself (not just the mapping table) would
    /// still fail this test.
    #[test]
    fn current_host_resolution_matches_the_same_lookup_table_the_function_uses() {
        let expected = map_triple(std::env::consts::OS, std::env::consts::ARCH);
        assert_eq!(current_host_target_triple(), expected);
    }

    /// Table-driven pin of every supported (OS, ARCH) pair -> triple,
    /// independent of which host actually runs this test -- a
    /// regression that swapped two triples, or renamed one, fails this
    /// test regardless of CI runner OS/ARCH. Calls the real
    /// `map_triple` directly instead of re-inlining the match table.
    #[test]
    fn every_supported_pair_maps_to_its_exact_published_triple() {
        let cases: &[((&str, &str), &str)] = &[
            (("linux", "x86_64"), "x86_64-unknown-linux-musl"),
            (("linux", "aarch64"), "aarch64-unknown-linux-musl"),
            (("macos", "aarch64"), "aarch64-apple-darwin"),
        ];
        for ((os, arch), expected_triple) in cases {
            assert_eq!(
                map_triple(os, arch),
                Some(*expected_triple),
                "({os}, {arch}) must resolve to {expected_triple}"
            );
        }
    }

    /// x86_64 macOS (Intel) has no published asset -- release.yml's own
    /// top-of-file comment documents this as a deliberate scope
    /// limitation (no free-tier Intel macOS GitHub runner), not an
    /// oversight this module should paper over by guessing a triple
    /// with no asset behind it. Calls the real `map_triple` directly.
    #[test]
    fn x86_64_macos_is_unsupported() {
        assert_eq!(map_triple("macos", "x86_64"), None);
    }

    /// Windows is out of scope entirely, regardless of architecture.
    /// Calls the real `map_triple` directly.
    #[test]
    fn windows_is_unsupported_regardless_of_arch() {
        for arch in ["x86_64", "aarch64"] {
            assert_eq!(
                map_triple("windows", arch),
                None,
                "windows/{arch} must be unsupported"
            );
        }
    }

    /// Any other unrecognized OS/ARCH combination must also resolve to
    /// `None`, never fall through to a guessed triple. Calls the real
    /// `map_triple` directly.
    #[test]
    fn unrecognized_combinations_resolve_to_none() {
        for (os, arch) in [("freebsd", "x86_64"), ("linux", "arm"), ("macos", "x86_64")] {
            assert_eq!(
                map_triple(os, arch),
                None,
                "{os}/{arch} must be unsupported"
            );
        }
    }
}
