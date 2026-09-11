// SPDX-License-Identifier: Apache-2.0
//
// time.rs — shared ISO-8601 UTC timestamp formatting.
//
// `utc_now_iso` (second precision) is used by the invocation logger
// (logging.rs), the install manifest writer (install/kiro_cli.rs,
// install.rs), and update.rs's own index/manifest timestamp.
// `utc_now_iso_millis` (millisecond precision) is a telemetry-specific
// sibling used only by telemetry/envelope.rs, to match the usage-
// analytics wire schema's documented `Data.TimeStamp` precision -- see
// that function's own doc comment for why it is a separate function
// rather than a change to `utc_now_iso` itself. No chrono/time
// dependency pulled in solely for this: both format directly from
// `SystemTime` via a standard civil-from-days algorithm.

use std::time::{SystemTime, UNIX_EPOCH};

/// Formats the current time as an ISO-8601 UTC timestamp
/// (`YYYY-MM-DDTHH:MM:SSZ`), second precision.
pub(crate) fn utc_now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let days = (secs / 86_400) as i64;
    let sod = secs % 86_400;
    let (hour, minute, second) = (sod / 3600, (sod % 3600) / 60, sod % 60);

    let (year, month, day) = civil_from_days(days);

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Formats the current time as an ISO-8601 UTC timestamp with
/// millisecond precision (`YYYY-MM-DDTHH:MM:SS.sssZ`) -- the precision
/// the usage-analytics telemetry wire schema
/// (`docs/telemetry-schema.json`) uses for `Data.TimeStamp` in every one
/// of its worked examples.
///
/// A telemetry-specific SIBLING to `utc_now_iso` above, not a change to
/// that function's own second-precision output: `utc_now_iso` is shared
/// by non-telemetry callers whose exact 20-character shape existing
/// tests and on-disk formats already depend on -- the manifest/index
/// `installed_at` timestamps (`install.rs`, `update.rs`) and the
/// invocation logger (`logging.rs`). Widening `utc_now_iso` itself to
/// millisecond precision would change those callers' on-disk formats
/// and break `utc_now_iso_produces_parseable_shape`'s pinned 20-char
/// length, for no benefit to any of them.
pub(crate) fn utc_now_iso_millis() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();

    let days = (secs / 86_400) as i64;
    let sod = secs % 86_400;
    let (hour, minute, second) = (sod / 3600, (sod % 3600) / 60, sod % 60);

    let (year, month, day) = civil_from_days(days);

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Converts a day count since the Unix epoch (1970-01-01) into a
/// (year, month, day) civil calendar date, proleptic Gregorian. This is
/// the well-known constant-time `civil_from_days` algorithm (Howard
/// Hinnant's `chrono::civil_from_days`, public domain), reproduced here
/// to avoid adding a datetime crate dependency for a single timestamp
/// format.
pub(crate) fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// "YYYY-MM-DDTHH:MM:SSZ" — 20 characters, separators at fixed
    /// offsets regardless of the moment called.
    #[test]
    fn utc_now_iso_produces_parseable_shape() {
        let ts = utc_now_iso();
        assert_eq!(ts.len(), 20);
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.as_bytes()[4], b'-');
        assert_eq!(ts.as_bytes()[7], b'-');
        assert_eq!(ts.as_bytes()[10], b'T');
        assert_eq!(ts.as_bytes()[13], b':');
        assert_eq!(ts.as_bytes()[16], b':');
    }

    /// "YYYY-MM-DDTHH:MM:SS.sssZ" — 24 characters, millisecond
    /// precision, matching `docs/telemetry-schema.json`'s own worked
    /// `Data.TimeStamp` examples (e.g. `"2026-09-03T20:41:07.312Z"`) --
    /// distinct from `utc_now_iso`'s 20-character, second-precision
    /// shape.
    #[test]
    fn utc_now_iso_millis_produces_parseable_shape() {
        let ts = utc_now_iso_millis();
        assert_eq!(ts.len(), 24);
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.as_bytes()[4], b'-');
        assert_eq!(ts.as_bytes()[7], b'-');
        assert_eq!(ts.as_bytes()[10], b'T');
        assert_eq!(ts.as_bytes()[13], b':');
        assert_eq!(ts.as_bytes()[16], b':');
        assert_eq!(ts.as_bytes()[19], b'.');
    }

    #[test]
    fn civil_from_days_matches_known_epoch_dates() {
        // 1970-01-01 is day 0.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2000-03-01 is a well-known checkpoint used to validate this
        // exact algorithm in Howard Hinnant's reference implementation.
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
        // 2026-01-15 is 20468 days after the Unix epoch (verified via
        // an independent date calculation) — pins the algorithm
        // against a known real date rather than only round-tripping.
        assert_eq!(civil_from_days(20_468), (2026, 1, 15));
    }
}
