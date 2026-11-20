'use strict';

// The refund for a cancelled booking (policy: docs/policy.md, section 4).
const HOUR = 3600000;
const TIERS = [{ hours: 48, share: 1 }, { hours: 24, share: 0.5 }];

const floorCents = (amount) => Math.floor(Math.round(amount * 1000) / 10) / 100;

/** The refund, in currency units with cents, of `booking` ({ start, paid }) cancelled at `cancelledAt`. */
function refundFor(booking, cancelledAt) {
  const before = Date.parse(booking.start) - Date.parse(cancelledAt);
  for (const t of TIERS) if (before >= t.hours * HOUR) return floorCents(booking.paid * t.share);
  return 0;
}

module.exports = { refundFor, TIERS };
