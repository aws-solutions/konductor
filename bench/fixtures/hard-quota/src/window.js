'use strict';

// Calendar window helpers. Timestamps are epoch milliseconds.
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function windowStart(ts, unit) {
  const d = new Date(ts);
  switch (unit) {
    case 'minute': return ts - (ts % MINUTE);
    case 'day': return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    case 'month': return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    default: throw new RangeError(`unknown window unit: ${unit}`);
  }
}

function windowEnd(ts, unit) {
  const start = windowStart(ts, unit);
  switch (unit) {
    case 'minute': return start + MINUTE;
    case 'day': return start + DAY;
    case 'month': return start + DAYS_IN_MONTH[new Date(start).getMonth()] * DAY;
    default: throw new RangeError(`unknown window unit: ${unit}`);
  }
}

// Whole seconds from ts until end, rounded up, never less than 1.
function secondsUntil(ts, end) {
  return Math.max(1, Math.ceil((end - ts) / 1000));
}

module.exports = { windowStart, windowEnd, secondsUntil, MINUTE, DAY };
