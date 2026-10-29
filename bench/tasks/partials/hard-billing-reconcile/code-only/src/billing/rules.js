'use strict';

// Rule values as resolved in docs/DECISIONS.md.
module.exports = {
  TRIAL_DAYS: 7,
  REFUND_DAYS: 30,
  PRORATION_ROUNDING: 'half-up',
  SEATS: { starter: 1, team: 10, enterprise: null },
  EU_PRICES_INCLUDE_TAX: true,
  EU_VAT_PERCENT: 20,
  ANNUAL_DISCOUNT_PERCENT: 20,
  SEAT_OVERAGE_CENTS: 450,
  CANCEL_AT: 'immediate',
  GRACE_DAYS: 5,
  PRICES: { starter: 900, team: 2900, enterprise: 9900 },
  DAY_MS: 24 * 60 * 60 * 1000,
};
