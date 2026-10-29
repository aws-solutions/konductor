'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dedupeCustomers } = require('../scripts/dedupe-customers');

test('duplicates by email are merged, archived and their orders re-pointed', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'));
  const c = (id, email, updatedAt) => ({ id, name: id, email, phone: '', tier: 'basic', notes: '', createdAt: updatedAt, updatedAt });
  fs.writeFileSync(path.join(d, 'customers.json'), JSON.stringify([c('a', 'X@example.com', '2024-01-01'), c('b', 'x@example.com', '2024-02-01')]));
  fs.writeFileSync(path.join(d, 'orders.json'), JSON.stringify([{ id: 'o', customerId: 'a', totalCents: 1 }]));
  dedupeCustomers(d);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'customers.json'), 'utf8')).map((x) => x.id), ['b']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'customers.archive.json'), 'utf8')).map((x) => x.id), ['a']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'orders.json'), 'utf8'))[0].customerId, 'b');
});
