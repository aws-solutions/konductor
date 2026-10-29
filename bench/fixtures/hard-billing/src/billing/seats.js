'use strict';

const { SEATS, SEAT_OVERAGE_CENTS } = require('./rules');

// null means unlimited.
function seatLimit(plan) {
  if (!(plan in SEATS)) throw new RangeError(`unknown plan: ${plan}`);
  return SEATS[plan];
}

// Monthly charge for seats above the plan limit.
function seatOverage({ plan, seats }) {
  const limit = seatLimit(plan);
  if (!Number.isInteger(seats) || seats < 0) throw new RangeError('seats must be a non-negative integer');
  return limit === null ? 0 : Math.max(0, seats - limit) * SEAT_OVERAGE_CENTS;
}

module.exports = { seatLimit, seatOverage };
