'use strict';

const FIELDS = ['id', 'customer', 'amountCents', 'issuedOn'];

function validate(inv) {
  for (const f of FIELDS) if (inv[f] === undefined) throw new Error(`invoice ${inv.id || '?'}: ${f} is required`);
  if (!Number.isInteger(inv.amountCents)) throw new Error('amountCents must be an integer');
  return { ...inv };
}

module.exports = { FIELDS, validate };
