// SPDX-License-Identifier: Apache-2.0
//! UTC times as the canvas contract writes them, and the run id, from milliseconds since the Unix epoch.

const SECONDS_PER_DAY: u64 = 86_400;

/// `YYYY-MM-DDTHH:MM:SSZ`, to the whole second (the contract's `Timestamp`).
pub fn format_timestamp(ms: u64) -> String {
    let (year, month, day, hour, minute, second) = utc_parts(ms);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// The milliseconds of a time in the form [`format_timestamp`] writes, or `None` for any other text.
pub fn parse_timestamp(text: &str) -> Option<u64> {
    let bytes = text.as_bytes();
    let shape = bytes.len() == 20
        && bytes.iter().enumerate().all(|(i, &b)| match i {
            4 | 7 => b == b'-',
            10 => b == b'T',
            13 | 16 => b == b':',
            19 => b == b'Z',
            _ => b.is_ascii_digit(),
        });
    if !shape {
        return None;
    }
    let number = |range: std::ops::Range<usize>| text[range].parse::<u64>().ok();
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    let (hour, minute, second) = (number(11..13)?, number(14..16)?, number(17..19)?);
    if year < 1970
        || !(1..=12).contains(&month)
        || day < 1
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some((days * SECONDS_PER_DAY + hour * 3600 + minute * 60 + second) * 1000)
}

/// The part of a run id that comes from the time it started: `YYYYMMDD-HHMM`, in UTC.
pub fn run_id_prefix(ms: u64) -> String {
    let (year, month, day, hour, minute, _) = utc_parts(ms);
    format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}")
}

/// The contract's `RunId` pattern, `^[0-9]{8}-[0-9]{4}-[a-z0-9]{5}$`.
pub fn is_run_id(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 19
        && bytes.iter().enumerate().all(|(i, &b)| match i {
            8 | 13 => b == b'-',
            0..=12 => b.is_ascii_digit(),
            _ => b.is_ascii_digit() || b.is_ascii_lowercase(),
        })
}

fn utc_parts(ms: u64) -> (u64, u64, u64, u64, u64, u64) {
    let seconds = ms / 1000;
    let (year, month, day) = civil_from_days(seconds / SECONDS_PER_DAY);
    let second_of_day = seconds % SECONDS_PER_DAY;
    (
        year,
        month,
        day,
        second_of_day / 3600,
        (second_of_day % 3600) / 60,
        second_of_day % 60,
    )
}

// The proleptic Gregorian date of a day count from 1970-01-01, and back. Howard Hinnant's algorithms, for days on or
// after the epoch.
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let shifted = days + 719_468;
    let era = shifted / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

fn days_from_civil(year: u64, month: u64, day: u64) -> u64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year / 400;
    let year_of_era = year - era * 400;
    let shifted_month = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn days_in_month(year: u64, month: u64) -> u64 {
    match month {
        2 if (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400) => {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}
