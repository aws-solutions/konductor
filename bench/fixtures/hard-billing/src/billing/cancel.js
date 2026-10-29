'use strict';

const { CANCEL_AT } = require('./rules');
const { prorateCredit } = require('./proration');

// Cancelling a subscription. periodEnd and requestedAt are epoch milliseconds.
function cancelSubscription({ amountCents, daysUsed, daysInPeriod, requestedAt, periodEnd }) {
  if (CANCEL_AT === 'end-of-period') return { effectiveAt: periodEnd, creditCents: 0 };
  return { effectiveAt: requestedAt, creditCents: prorateCredit({ amountCents, daysUsed, daysInPeriod }) };
}

module.exports = { cancelSubscription };
