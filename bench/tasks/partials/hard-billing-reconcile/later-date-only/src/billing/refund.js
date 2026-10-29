'use strict';

const { REFUND_DAYS, DAY_MS } = require('./rules');

function refundFor({ amountCents, paidAt }, requestedAt) {
  if (requestedAt < paidAt) throw new RangeError('refund requested before payment');
  const eligible = requestedAt - paidAt <= REFUND_DAYS * DAY_MS;
  return { eligible, amountCents: eligible ? amountCents : 0 };
}

module.exports = { refundFor };
