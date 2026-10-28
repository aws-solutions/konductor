// SPDX-License-Identifier: Apache-2.0

const SECONDS_PER_DAY = 86_400;

/** The UTC calendar fields of a time. */
export interface UtcParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const pad = (value: number, width: number) =>
  String(value).padStart(width, '0');

/** The UTC fields of milliseconds since the Unix epoch, to the whole second. */
export function utcParts(ms: number): UtcParts {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / SECONDS_PER_DAY);
  const secondOfDay = seconds - days * SECONDS_PER_DAY;
  return {
    ...civilDate(days),
    hour: Math.floor(secondOfDay / 3600),
    minute: Math.floor((secondOfDay % 3600) / 60),
    second: secondOfDay % 60,
  };
}

// The proleptic Gregorian date of a day count from 1970-01-01.
function civilDate(daysSinceEpoch: number) {
  const shifted = daysSinceEpoch + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthFromMarch = Math.floor((5 * dayOfYear + 2) / 153);
  const month = monthFromMarch < 10 ? monthFromMarch + 3 : monthFromMarch - 9;
  return {
    year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0),
    month,
    day: dayOfYear - Math.floor((153 * monthFromMarch + 2) / 5) + 1,
  };
}

/** A time as `YYYY-MM-DDTHH:MM:SSZ`, in UTC. */
export function formatTimestamp(ms: number): string {
  const t = utcParts(ms);
  const date = `${pad(t.year, 4)}-${pad(t.month, 2)}-${pad(t.day, 2)}`;
  return `${date}T${pad(t.hour, 2)}:${pad(t.minute, 2)}:${pad(t.second, 2)}Z`;
}

/** The `YYYYMMDD-HHMM` start of a run id. */
export function runIdPrefix(ms: number): string {
  const t = utcParts(ms);
  const date = `${pad(t.year, 4)}${pad(t.month, 2)}${pad(t.day, 2)}`;
  return `${date}-${pad(t.hour, 2)}${pad(t.minute, 2)}`;
}
