'use strict';

const ms = (t) => new Date(t).getTime();

/** The existing bookings that clash with `candidate`. */
function conflicts(bookings, candidate) {
  const start = ms(candidate.start);
  const end = ms(candidate.end);
  const out = [];
  for (const b of [...bookings].sort((x, y) => ms(x.start) - ms(y.start))) {
    if (ms(b.start) > end) break;
    if (ms(b.end) >= start) out.push(b);
  }
  return out;
}

module.exports = { conflicts };
