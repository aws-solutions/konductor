'use strict';

const FIELDS = ['id', 'customer', 'amountCents', 'issuedOn', 'currency'];
const ISO_4217 = /^[A-Z]{3}$/;

// Records written before currencies existed are in euros.
const withDefaults = (inv) => ({ ...inv, currency: inv.currency ?? 'EUR' });

function validate(raw) {
  const inv = withDefaults(raw);
  const missing = FIELDS.find((f) => inv[f] === undefined);
  if (missing) throw new Error(`invoice ${inv.id || '?'}: ${missing} is required`);
  if (!Number.isInteger(inv.amountCents)) throw new Error('amountCents must be an integer');
  if (!ISO_4217.test(inv.currency)) throw new Error(`currency ${inv.currency} is not an ISO 4217 code`);
  return inv;
}

module.exports = { FIELDS, validate };
