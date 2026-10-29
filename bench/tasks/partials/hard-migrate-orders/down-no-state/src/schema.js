'use strict';

const { centsFromTotal } = require('./money');
const { isoFromUs } = require('./dates');
const { splitAddress } = require('./address');

const STATUS = { new: 'new', paid: 'paid', shipped: 'shipped', done: 'delivered', cancelled: 'cancelled', canceled: 'cancelled' };
const nonEmpty = (v) => typeof v === 'string' && v !== '';

// Converts a schema 1 record. Throws Error(reason) with the reason names from docs/SCHEMA.md.
function toV2(rec) {
  const { id, customer, total, placed, status, address, schema, ...extra } = rec;
  if (!nonEmpty(id)) throw new Error('missing field: id');
  if (!nonEmpty(customer)) throw new Error('missing field: customer');
  const totalCents = centsFromTotal(total);
  const placedAt = isoFromUs(placed);
  const mapped = STATUS[String(status).toLowerCase()];
  if (!mapped) throw new Error('unknown status');
  return { schema: 2, id, customer, totalCents, placedAt, status: mapped, address: splitAddress(address), ...extra };
}

module.exports = { toV2, STATUS };
