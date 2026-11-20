'use strict';

// currency is the last field: src/export/csv.js prints FIELDS in order, so it is also the last CSV column (A2).
const FIELDS = ['id', 'customer', 'amountCents', 'issuedOn', 'currency'];
const DEFAULT_CURRENCY = 'EUR';

function validate(inv) {
  const out = { ...inv, currency: inv.currency === undefined ? DEFAULT_CURRENCY : inv.currency };
  for (const f of FIELDS) if (out[f] === undefined) throw new Error(`invoice ${out.id || '?'}: ${f} is required`);
  if (!Number.isInteger(out.amountCents)) throw new Error('amountCents must be an integer');
  if (!/^[A-Z]{3}$/.test(out.currency)) throw new Error('currency must be an ISO 4217 code');
  return out;
}

module.exports = { FIELDS, DEFAULT_CURRENCY, validate };
