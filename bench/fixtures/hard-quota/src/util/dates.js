'use strict';

// Kept for the old dashboard export. Nothing in src/ calls these any more.
function startOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isSameLocalDay(a, b) {
  return startOfLocalDay(a) === startOfLocalDay(b);
}

module.exports = { startOfLocalDay, isSameLocalDay };
