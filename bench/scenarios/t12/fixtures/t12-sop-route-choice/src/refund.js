'use strict';

// The refund for a cancelled booking (policy: docs/policy.md).
// Tiers: hours between the cancellation and the start, and the share of the paid amount refunded from there on.
const TIERS = [{ hours: 24, share: 1 }];

/** The refund, in currency units with cents, of `booking` ({ start, paid }) cancelled at `cancelledAt`. */
function refundFor(booking, cancelledAt) {
  const hoursBefore = (new Date(booking.start) - new Date(cancelledAt)) / 3600000;
  if (!(hoursBefore >= 0)) return 0;
  const tier = TIERS.find((t) => hoursBefore >= t.hours);
  return tier ? Math.floor(booking.paid * tier.share * 100) / 100 : 0;
}

module.exports = { refundFor, TIERS };
