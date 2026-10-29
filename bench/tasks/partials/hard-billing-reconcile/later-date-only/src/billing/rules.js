'use strict';

// Rule values as resolved in docs/DECISIONS.md.
module.exports = {
  TRIAL_DAYS: 7,
  REFUND_DAYS: 30,
  PRORATION_ROUNDING: 'half-even',
  SEATS: { starter: 1, team: 25, enterprise: null },
  EU_PRICES_INCLUDE_TAX: false,
  EU_VAT_PERCENT: 20,
  ANNUAL_DISCOUNT_PERCENT: 20,
  SEAT_OVERAGE_CENTS: 450,
  CANCEL_AT: 'end-of-period',
  GRACE_DAYS: 5,
  PRICES: { starter: 900, team: 2900, enterprise: 9900 },
  DAY_MS: 24 * 60 * 60 * 1000,
};
