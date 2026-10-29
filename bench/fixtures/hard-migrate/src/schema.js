'use strict';

const { centsFromTotal } = require('./money');
const { isoFromUs } = require('./dates');
const { splitAddress } = require('./address');

const STATUS = { new: 'new', paid: 'paid', shipped: 'shipped', done: 'delivered', cancelled: 'cancelled' };

function toV2(rec) {
  const { id, customer, total, placed, status, address, ...extra } = rec;
  return {
    schema: 2,
    id,
    customer,
    totalCents: centsFromTotal(total),
    placedAt: isoFromUs(placed),
    status: STATUS[String(status).toLowerCase()],
    address: splitAddress(address),
    ...extra,
  };
}

module.exports = { toV2, STATUS };
