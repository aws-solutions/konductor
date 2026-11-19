// SPDX-License-Identifier: Apache-2.0

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// A Gregorian leap year: divisible by 4, except by 100, unless by 400.
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
}

// Days from 1970-01-01 to the given date of the proleptic Gregorian calendar.
function daysFromEpoch(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * A time of the API, such as `2026-10-24T04:12:05Z`, in milliseconds since
 * the epoch, or `undefined` when it does not have that form. It reads no
 * clock, so the run core can use it.
 */
export function timestampMs(at: string): number | undefined {
  const parts = TIMESTAMP.exec(at)?.slice(1).map(Number);
  if (!parts) return undefined;
  const [year, month, day, hours, minutes, seconds] = parts as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hours > 23 || minutes > 59 || seconds > 59) return undefined;
  const days = daysFromEpoch(year, month, day);
  return ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000;
}
