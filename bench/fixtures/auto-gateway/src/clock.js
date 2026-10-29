'use strict';

const systemClock = { now: () => Date.now() };

function manualClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    set(value) { t = value; },
    advance(ms) { t += ms; },
  };
}

module.exports = { systemClock, manualClock };
