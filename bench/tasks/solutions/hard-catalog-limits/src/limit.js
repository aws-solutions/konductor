'use strict';

/** `run(fn)` starts `fn` when fewer than `maxInFlight` runs are active, else queues it in arrival order. */
function createConcurrencyLimit(maxInFlight) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= maxInFlight || !waiting.length) return;
    active++;
    const { fn, resolve, reject } = waiting.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return function run(fn) {
    return new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      next();
    });
  };
}

module.exports = { createConcurrencyLimit };
