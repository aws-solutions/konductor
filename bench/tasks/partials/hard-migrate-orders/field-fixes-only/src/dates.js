'use strict';

// MM/DD/YYYY to YYYY-MM-DD, validated against the calendar. No time zone is involved.
function isoFromUs(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text));
  if (!m) throw new Error('invalid date');
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) throw new Error('invalid date');
  return `${m[3]}-${m[1]}-${m[2]}`;
}

module.exports = { isoFromUs };
