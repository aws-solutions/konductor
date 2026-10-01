// SPDX-License-Identifier: Apache-2.0
//
// time.rs — shared ISO-8601 UTC timestamp formatting. No chrono/time
// dependency pulled in solely for this: both functions format directly
// from `SystemTime` via a standard civil-from-days algorithm.

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
/// the usage-analytics telemetry wire schema uses for `Data.TimeStamp`.
/// A separate function from `utc_now_iso` rather than widening it,
/// since other callers depend on that function's exact second-precision
/// on-disk format.
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
/// Howard Hinnant's public-domain `civil_from_days` algorithm, reproduced
/// here to avoid adding a datetime crate dependency for a single
/// timestamp format.
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
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2000-03-01 is a well-known checkpoint used to validate this
        // exact algorithm in Howard Hinnant's reference implementation.
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
        assert_eq!(civil_from_days(20_468), (2026, 1, 15));
    }
}
