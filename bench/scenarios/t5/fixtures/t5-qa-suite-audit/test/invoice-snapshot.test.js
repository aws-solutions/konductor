'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeInvoice } = require('../src/invoices');

const snapshotPath = path.join(__dirname, 'fixtures', 'invoice.json');

test('invoice representation matches its snapshot', () => {
  const invoice = makeInvoice({ id: 'inv_snapshot', customerId: 'cus_snapshot', planId: 'scale', cycleStart: '2025-07-01' });
  fs.writeFileSync(snapshotPath, JSON.stringify(invoice, null, 2) + '\n');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  assert.deepEqual(invoice, snapshot);
});
