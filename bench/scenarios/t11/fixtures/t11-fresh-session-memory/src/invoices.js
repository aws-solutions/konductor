'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseDate } = require('./dates.js');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'invoices.json');

function validate(inv, i) {
  for (const k of ['id', 'customer', 'issuedOn', 'dueOn']) {
    if (typeof inv[k] !== 'string' || !inv[k]) throw new Error(`invoice ${i}: missing ${k}`);
  }
  if (!Number.isInteger(inv.amountCents) || inv.amountCents < 0) throw new Error(`invoice ${inv.id}: amountCents must be a whole number of cents`);
  parseDate(inv.issuedOn);
  parseDate(inv.dueOn);
  if (inv.paidOn != null) parseDate(inv.paidOn);
  return { id: inv.id, customer: inv.customer, amountCents: inv.amountCents, issuedOn: inv.issuedOn, dueOn: inv.dueOn, paidOn: inv.paidOn ?? null };
}

function loadInvoices(file = DEFAULT_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw.invoices)) throw new Error(`${file}: expected an "invoices" array`);
  return raw.invoices.map(validate);
}

function isOpen(inv, on) {
  return inv.paidOn === null || inv.paidOn > on;
}

module.exports = { loadInvoices, isOpen, DEFAULT_FILE };
