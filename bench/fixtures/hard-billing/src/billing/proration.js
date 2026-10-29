'use strict';

const { PRORATION_ROUNDING } = require('./rules');
const { divRound } = require('../util/money');

// Credit for the unused part of a period.
function prorateCredit({ amountCents, daysUsed, daysInPeriod }) {
  if (!Number.isInteger(daysUsed) || !Number.isInteger(daysInPeriod) || daysInPeriod < 1 || daysUsed < 0 || daysUsed > daysInPeriod) {
    throw new RangeError('daysUsed must be between 0 and daysInPeriod');
  }
  return divRound(amountCents * (daysInPeriod - daysUsed), daysInPeriod, PRORATION_ROUNDING);
}

module.exports = { prorateCredit };
