'use strict';

const ev = (id, customerId = 'c1', amountCents = 100) => ({ id, customerId, amountCents, ts: 0 });

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance(ms) { t += ms; } };
}

module.exports = { ev, fakeClock };
