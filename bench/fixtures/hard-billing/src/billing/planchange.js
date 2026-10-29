'use strict';

// Charge for moving to a plan part-way through a period: the new plan for the rest of the period minus the
// unused credit of the old plan.
function bankersDiv(num, den) {
  const q = Math.floor(num / den);
  const r = num - q * den;
  if (2 * r === den) return q % 2 === 0 ? q : q + 1;
  return 2 * r < den ? q : q + 1;
}

function planChangeCharge({ fromCents, toCents, daysUsed, daysInPeriod }) {
  const left = daysInPeriod - daysUsed;
  return bankersDiv(toCents * left, daysInPeriod) - bankersDiv(fromCents * left, daysInPeriod);
}

module.exports = { planChangeCharge };
