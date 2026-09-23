// SPDX-License-Identifier: Apache-2.0
//
// install/content_version.rs — content-version comparison for
// `install` (non-`--from`) and `update` (content path, no `--cli`).
//
// Per-target, compared against `agent_version` recorded in that
// target's existing `install-info.json`. `--from` always overwrites
// unconditionally (see `compare_incoming_version`'s own doc comment)
// -- deliberate and permanent, since a local checkout has no reliable
// version signal to compare against.

use std::path::Path;

/// The outcome of comparing an incoming source's `dist/VERSION`
/// against a target's currently-recorded `agent_version`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum VersionComparison {
    /// `--from` was given: version comparison is always skipped here,
    /// deliberately and permanently -- see `compare_incoming_version`'s
    /// own doc comment. Never participates in skip-if-unchanged.
    FromAlwaysOverwrites,
    /// No incoming version could be determined (no `dist/VERSION`, or
    /// it was empty/unreadable) -- proceeds with the write normally,
    /// no special-casing.
    IncomingVersionUnknown,
    /// The target has no recorded `agent_version` yet (first-seen
    /// target, or a broken/absent `install-info.json`) -- proceeds
    /// with the write normally, no special-casing.
    NoRecordedVersion,
    /// Both versions are known and differ -- proceeds with the write
    /// normally.
    Mismatched { incoming: String, recorded: String },
    /// Both versions are known and match -- the write should be
    /// skipped unless `--force` is passed.
    Matched { version: String },
}

impl VersionComparison {
    /// Whether this comparison, on its own (`force` not yet applied),
    /// would skip the write.
    fn matches(&self) -> bool {
        matches!(self, VersionComparison::Matched { .. })
    }

    /// The version string to report in a "already at version X,
    /// nothing to do" result -- only meaningful when `matches()` is
    /// true.
    pub(crate) fn matched_version(&self) -> Option<&str> {
        match self {
            VersionComparison::Matched { version } => Some(version.as_str()),
            _ => None,
        }
    }
}

/// Compares `incoming_source_root`'s `dist/VERSION` against
/// `target_dir`'s recorded `agent_version` (read from that target's
/// existing `install-info.json`), UNLESS `from` is `Some` -- in which
/// case comparison is always skipped and the write always proceeds.
///
/// `--from` on both `install` and `update` ALWAYS skips the
/// version-comparison entirely and always overwrites, regardless of
/// `--force`. This is deliberate and permanent: a local checkout has
/// no reliable version signal to compare against (an arbitrary
/// checkout's `dist/VERSION`, if present at all, says nothing about
/// whether the checkout itself has changed since the last install).
/// This is not a gap to be closed later by adding version comparison
/// to the `--from` path -- doing so would require inventing a
/// reliability guarantee this codebase's `--from` sources do not have.
///
/// `#[allow(dead_code)]`: no production call site reaches this today.
/// `install.rs`'s `--from` branch never calls it (per the rule above,
/// it would always resolve to `FromAlwaysOverwrites`, a guaranteed
/// no-op there), and the no-`--from` (remote) path instead calls
/// `compare_known_versions` directly, since its incoming version comes
/// from already-fetched release metadata rather than a local
/// `dist/VERSION` file this function would otherwise re-read. Kept
/// as the documented, tested reference implementation of the rule
/// this module's own doc comment states -- a future `--from`-sourced
/// content-version caller (were one ever legitimately needed) should
/// call this function, not reinvent the rule inline.
#[allow(dead_code)]
pub(crate) fn compare_incoming_version(
    from: Option<&str>,
    incoming_source_root: &Path,
    target_dir: &Path,
) -> VersionComparison {
    if from.is_some() {
        return VersionComparison::FromAlwaysOverwrites;
    }

    let Some(incoming) = crate::cli::telemetry::agent_version_from_source(incoming_source_root)
    else {
        return VersionComparison::IncomingVersionUnknown;
    };

    let recorded = crate::cli::telemetry::read_install_info(target_dir)
        .and_then(|record| record.agent_version);
    let Some(recorded) = recorded else {
        return VersionComparison::NoRecordedVersion;
    };

    if incoming == recorded {
        VersionComparison::Matched { version: incoming }
    } else {
        VersionComparison::Mismatched { incoming, recorded }
    }
}

/// Whether the write should be skipped, given a `VersionComparison`
/// and whether `--force` was passed. `--force` bypasses the
/// skip-if-unchanged behavior and overwrites even when versions
/// already match; it has no effect when versions already differ
/// (mismatched, unknown, or no recorded version at all), since the
/// write would have proceeded anyway in every one of those cases.
pub(crate) fn should_skip_write(comparison: &VersionComparison, force: bool) -> bool {
    comparison.matches() && !force
}

/// Compares two already-resolved version strings directly -- for a
/// caller that has already obtained both the incoming version (e.g.
/// from a fetched release's tag name) and the target's recorded
/// version, without going through `compare_incoming_version`'s own
/// `--from`/`dist/VERSION`-reading logic. Used by the no-`--from`
/// (remote) install/update path, where the incoming version comes from
/// release metadata rather than a local `dist/VERSION` file.
pub(crate) fn compare_known_versions(incoming: &str, recorded: &str) -> VersionComparison {
    if incoming == recorded {
        VersionComparison::Matched {
            version: recorded.to_string(),
        }
    } else {
        VersionComparison::Mismatched {
            incoming: incoming.to_string(),
            recorded: recorded.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-content-version-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed_dist_version(source_root: &Path, contents: &str) {
        let dist_dir = source_root.join("dist");
        fs::create_dir_all(&dist_dir).unwrap();
        fs::write(dist_dir.join("VERSION"), contents).unwrap();
    }

    #[test]
    fn from_given_always_overwrites_regardless_of_versions() {
        let source = scratch_dir("from-always-overwrites-source");
        let target = scratch_dir("from-always-overwrites-target");
        seed_dist_version(&source, "1.0.0\n");
        crate::cli::telemetry::write_install_info(
            &target,
            &source,
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();

        let comparison = compare_incoming_version(Some("some/repo/root"), &source, &target);
        assert_eq!(comparison, VersionComparison::FromAlwaysOverwrites);
        assert!(!should_skip_write(&comparison, false));
        assert!(
            !should_skip_write(&comparison, true),
            "--force must have no bearing on the --from case either"
        );

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn no_recorded_version_proceeds_normally() {
        let source = scratch_dir("no-recorded-version-source");
        let target = scratch_dir("no-recorded-version-target");
        seed_dist_version(&source, "1.0.0\n");

        let comparison = compare_incoming_version(None, &source, &target);
        assert_eq!(comparison, VersionComparison::NoRecordedVersion);
        assert!(!should_skip_write(&comparison, false));

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn incoming_version_unknown_proceeds_normally() {
        let source = scratch_dir("incoming-unknown-source");
        let target = scratch_dir("incoming-unknown-target");
        crate::cli::telemetry::write_install_info(
            &target,
            &source,
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();

        let comparison = compare_incoming_version(None, &source, &target);
        assert_eq!(comparison, VersionComparison::IncomingVersionUnknown);
        assert!(!should_skip_write(&comparison, false));

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn mismatched_versions_proceed_normally() {
        let source = scratch_dir("mismatched-source");
        let target = scratch_dir("mismatched-target");
        let earlier_source = scratch_dir("mismatched-earlier-source");
        seed_dist_version(&earlier_source, "1.0.0\n");
        crate::cli::telemetry::write_install_info(
            &target,
            &earlier_source,
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();
        seed_dist_version(&source, "2.0.0\n");

        let comparison = compare_incoming_version(None, &source, &target);
        assert_eq!(
            comparison,
            VersionComparison::Mismatched {
                incoming: "2.0.0".to_string(),
                recorded: "1.0.0".to_string(),
            }
        );
        assert!(!should_skip_write(&comparison, false));
        assert!(
            !should_skip_write(&comparison, true),
            "--force has no effect when versions already differ"
        );

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&target).ok();
        fs::remove_dir_all(&earlier_source).ok();
    }

    #[test]
    fn matched_versions_skip_unless_forced() {
        let source = scratch_dir("matched-source");
        let target = scratch_dir("matched-target");
        seed_dist_version(&source, "1.5.0\n");
        crate::cli::telemetry::write_install_info(
            &target,
            &source,
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
        )
        .unwrap();

        let comparison = compare_incoming_version(None, &source, &target);
        assert_eq!(
            comparison,
            VersionComparison::Matched {
                version: "1.5.0".to_string()
            }
        );
        assert_eq!(comparison.matched_version(), Some("1.5.0"));
        assert!(should_skip_write(&comparison, false));
        assert!(
            !should_skip_write(&comparison, true),
            "--force must bypass the skip when versions match"
        );

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn matched_version_is_none_for_every_other_variant() {
        assert_eq!(
            VersionComparison::FromAlwaysOverwrites.matched_version(),
            None
        );
        assert_eq!(
            VersionComparison::IncomingVersionUnknown.matched_version(),
            None
        );
        assert_eq!(VersionComparison::NoRecordedVersion.matched_version(), None);
        assert_eq!(
            VersionComparison::Mismatched {
                incoming: "a".to_string(),
                recorded: "b".to_string()
            }
            .matched_version(),
            None
        );
    }

    #[test]
    fn compare_known_versions_matches_identical_strings() {
        let comparison = compare_known_versions("1.5.0", "1.5.0");
        assert_eq!(
            comparison,
            VersionComparison::Matched {
                version: "1.5.0".to_string()
            }
        );
        assert!(should_skip_write(&comparison, false));
        assert!(!should_skip_write(&comparison, true));
    }

    #[test]
    fn compare_known_versions_reports_mismatch_for_different_strings() {
        let comparison = compare_known_versions("v2.0.0", "v1.0.0");
        assert_eq!(
            comparison,
            VersionComparison::Mismatched {
                incoming: "v2.0.0".to_string(),
                recorded: "v1.0.0".to_string(),
            }
        );
        assert!(!should_skip_write(&comparison, false));
    }
}
