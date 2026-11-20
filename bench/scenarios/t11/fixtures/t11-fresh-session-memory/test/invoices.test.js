'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadInvoices, isOpen } = require('../src/invoices.js');

test('the shipped invoice file loads', () => {
  const all = loadInvoices();
  assert.ok(all.length >= 5);
  for (const inv of all) assert.equal(inv.customer.includes(' '), false);
});

test('a bad amount is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-'));
  try {
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, JSON.stringify({ invoices: [{ id: 'X', customer: 'Y', amountCents: 1.5, issuedOn: '2026-01-01', dueOn: '2026-02-01' }] }));
    assert.throws(() => loadInvoices(file), /whole number of cents/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an invoice is open until the day it is paid', () => {
  assert.equal(isOpen({ paidOn: null }, '2026-11-20'), true);
  assert.equal(isOpen({ paidOn: '2026-11-21' }, '2026-11-20'), true);
  assert.equal(isOpen({ paidOn: '2026-11-20' }, '2026-11-20'), false);
});
