'use strict';

const { prorateCredit } = require('./proration');

// Charge for moving to a plan part-way through a period: the new plan for the rest of the period minus the
// unused credit of the old plan. Both amounts are prorated with the same rounding rule.
function planChangeCharge({ fromCents, toCents, daysUsed, daysInPeriod }) {
  return prorateCredit({ amountCents: toCents, daysUsed, daysInPeriod }) - prorateCredit({ amountCents: fromCents, daysUsed, daysInPeriod });
}

module.exports = { planChangeCharge };
