// SPDX-License-Identifier: Apache-2.0
//
// Thin CLI wrapper around the shared `konductor-telemetry` crate's
// `$HOME/.konductor/telemetry.json` read/write logic. Consent gating
// itself lives in `report.rs`'s AND gate, not here.

use std::path::Path;

pub(crate) use konductor_telemetry::InstanceRecord;

use super::super::time::utc_now_iso_millis;

/// `$HOME/.konductor/telemetry.json`. Test-only: production resolves
/// this path via `konductor_telemetry`.
#[cfg(test)]
pub(crate) fn instance_path(home_dir: &Path) -> std::path::PathBuf {
    konductor_telemetry::instance_path(home_dir)
}

#[cfg(test)]
pub(crate) fn read_instance(home_dir: &Path) -> Option<InstanceRecord> {
    konductor_telemetry::read_instance(home_dir)
}

/// Migration-free convenience for other modules' tests.
#[cfg(test)]
pub(crate) fn ensure_instance(home_dir: &Path, initial_consent: bool) -> InstanceRecord {
    konductor_telemetry::ensure_instance(home_dir, initial_consent, utc_now_iso_millis)
}

/// Resolves the `UUID` to send on the wire, never minting.
pub(crate) fn resolve_instance_uuid_for_wire(home_dir: &Path) -> String {
    konductor_telemetry::resolve_instance_uuid_for_wire(home_dir)
}

/// Ensures the instance record exists at `home_dir`.
///
/// `target_already_opted_out` no longer seeds consent on first mint:
/// `report.rs`'s AND gate already suppresses an opted-out target's own
/// reporting, so seeding consent from it here only suppressed
/// telemetry for every other project on the same machine.
pub(crate) fn ensure_instance_with_migration(
    home_dir: &Path,
    target_already_opted_out: bool,
    default_consent_if_no_migration_applies: bool,
) -> InstanceRecord {
    let _ = target_already_opted_out;
    konductor_telemetry::ensure_instance(
        home_dir,
        default_consent_if_no_migration_applies,
        utc_now_iso_millis,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch_home(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-instance-test-{name}-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn delegation_round_trips_through_the_shared_crate() {
        let home = scratch_home("delegation-round-trip");
        let record = ensure_instance_with_migration(&home, false, true);
        assert!(konductor_telemetry::is_valid_uuid_shape(&record.uuid));
        assert!(record.telemetry_consent);

        let read_back = read_instance(&home).expect("must read back");
        assert_eq!(read_back, record);

        let wire_uuid = resolve_instance_uuid_for_wire(&home);
        assert_eq!(wire_uuid, record.uuid);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn target_already_opted_out_no_longer_affects_the_minted_default() {
        let home = scratch_home("migration-seed-removed");
        let record = ensure_instance_with_migration(&home, true, true);
        assert!(
            record.telemetry_consent,
            "target_already_opted_out must no longer force the freshly-minted instance \
             record to false -- the ordinary new-install default (true here) passes through \
             unchanged, since suppressing an opted-out target's own reporting is now entirely \
             the per-target AND-gate conjunct's job, not this function's"
        );
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn target_already_opted_out_does_not_flip_a_false_default_to_true_either() {
        let home = scratch_home("migration-seed-removed-false-default");
        let record = ensure_instance_with_migration(&home, true, false);
        assert!(
            !record.telemetry_consent,
            "the default (false here) must pass through unchanged regardless of \
             target_already_opted_out's value"
        );
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn migration_passes_through_default_when_target_not_opted_out() {
        let home_true = scratch_home("migration-default-true");
        let record_true = ensure_instance_with_migration(&home_true, false, true);
        assert!(record_true.telemetry_consent);
        fs::remove_dir_all(&home_true).ok();

        let home_false = scratch_home("migration-default-false");
        let record_false = ensure_instance_with_migration(&home_false, false, false);
        assert!(!record_false.telemetry_consent);
        fs::remove_dir_all(&home_false).ok();
    }

    #[test]
    fn migration_only_applies_on_first_mint_not_on_subsequent_calls() {
        let home = scratch_home("migration-first-mint-only");
        let first = ensure_instance_with_migration(&home, false, true);
        assert!(first.telemetry_consent);

        let second = ensure_instance_with_migration(&home, true, true);
        assert_eq!(first.uuid, second.uuid, "must be the same instance record");
        assert!(
            second.telemetry_consent,
            "an already-minted instance record's consent must never be revisited by a later call"
        );
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn instance_path_matches_shared_crate_path() {
        let home = scratch_home("instance-path-matches");
        assert_eq!(
            instance_path(&home),
            konductor_telemetry::instance_path(&home)
        );
        fs::remove_dir_all(&home).ok();
    }
}
