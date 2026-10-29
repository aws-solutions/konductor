'use strict';

// A clock is any object with now() returning epoch milliseconds.
const systemClock = { now: () => Date.now() };

function manualClock(start = 0) {
  let t = start;
  return { now: () => t, set(v) { t = v; }, advance(ms) { t += ms; } };
}

module.exports = { systemClock, manualClock };
