'use strict';

// Calendar window helpers in UTC. Timestamps are epoch milliseconds.
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function windowStart(ts, unit) {
  const d = new Date(ts);
  switch (unit) {
    case 'minute': return ts - (ts % MINUTE);
    case 'day': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    case 'month': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    default: throw new RangeError(`unknown window unit: ${unit}`);
  }
}

function windowEnd(ts, unit) {
  const start = windowStart(ts, unit);
  switch (unit) {
    case 'minute': return start + MINUTE;
    case 'day': return start + DAY;
    case 'month': return Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, 1);
    default: throw new RangeError(`unknown window unit: ${unit}`);
  }
}

// Whole seconds from ts until end, rounded up, never less than 1.
function secondsUntil(ts, end) {
  return Math.max(1, Math.ceil((end - ts) / 1000));
}

module.exports = { windowStart, windowEnd, secondsUntil, MINUTE, DAY };
