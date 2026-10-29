'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { dedupeCustomers } = require('../scripts/dedupe-customers');

const ROOT = path.join(__dirname, '..');
const norm = (e) => String(e ?? '').trim().toLowerCase();

const cust = (id, email, over = {}) => ({
  id, name: `Name ${id}`, email, phone: '', tier: 'basic', notes: '', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', ...over,
});

// A scratch data directory holding the given records.
function dir({ customers, orders, archive } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dedupe-'));
  fs.writeFileSync(path.join(d, 'customers.json'), JSON.stringify(customers ?? []));
  if (orders !== undefined) fs.writeFileSync(path.join(d, 'orders.json'), JSON.stringify(orders));
  if (archive !== undefined) fs.writeFileSync(path.join(d, 'customers.archive.json'), JSON.stringify(archive));
  return d;
}

const read = (d, f, fallback = null) => {
  const file = path.join(d, f);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
};
const ids = (list) => list.map((c) => c.id).sort();

// A scratch copy of the data as shipped (kept beside the tests, so a run on the real data/ does not change it).
function shipped() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dedupe-'));
  for (const f of ['customers.json', 'orders.json']) fs.copyFileSync(path.join(__dirname, 'data', f), path.join(d, f));
  return d;
}

test('on the shipped data the newest record of each email survives and the others are archived', () => {
  const d = shipped();
  dedupeCustomers(d);
  assert.deepEqual(ids(read(d, 'customers.json')), ['c10', 'c11', 'c12', 'c2', 'c3', 'c5', 'c6', 'c8', 'c9']);
  assert.deepEqual(ids(read(d, 'customers.archive.json', [])), ['c1', 'c4', 'c7']);
});

test('fields empty on the survivor are filled from the older duplicates, newest first', () => {
  const d = dir({
    customers: [
      cust('a1', 'x@example.com', { phone: '111', notes: 'old note', updatedAt: '2024-01-01T00:00:00Z' }),
      cust('a2', 'X@example.com', { phone: '', notes: '', updatedAt: '2024-03-01T00:00:00Z' }),
      cust('a3', ' x@example.com', { phone: '333', notes: '', updatedAt: '2024-02-01T00:00:00Z' }),
    ],
    orders: [],
  });
  dedupeCustomers(d);
  const [kept] = read(d, 'customers.json');
  assert.equal(kept.id, 'a2');
  assert.equal(kept.phone, '333', 'a3 is newer than a1, so its phone is used');
  assert.equal(kept.notes, 'old note');
});

test('a field that has a value on the survivor is never overwritten', () => {
  const d = dir({
    customers: [
      cust('a1', 'x@example.com', { name: 'Old Name', tier: 'gold', phone: '111', updatedAt: '2024-01-01T00:00:00Z' }),
      cust('a2', 'x@example.com', { name: 'New Name', tier: 'basic', phone: '222', updatedAt: '2024-03-01T00:00:00Z' }),
    ],
    orders: [],
  });
  dedupeCustomers(d);
  const [kept] = read(d, 'customers.json');
  assert.deepEqual([kept.id, kept.name, kept.tier, kept.phone], ['a2', 'New Name', 'basic', '222']);
});

test('merged-away records are moved unchanged to customers.archive.json, after what is already there', () => {
  const older = cust('z0', 'gone@example.com', { notes: 'archived earlier' });
  const loser = cust('a1', 'x@example.com', { phone: '111', updatedAt: '2024-01-01T00:00:00Z' });
  const d = dir({ customers: [loser, cust('a2', 'x@example.com', { updatedAt: '2024-03-01T00:00:00Z' })], orders: [], archive: [older] });
  dedupeCustomers(d);
  assert.deepEqual(read(d, 'customers.archive.json'), [older, loser]);
});

test('orders of a merged-away customer point at the survivor, other orders are left alone', () => {
  const d = dir({
    customers: [cust('a1', 'x@example.com', { updatedAt: '2024-01-01T00:00:00Z' }), cust('a2', 'x@example.com', { updatedAt: '2024-03-01T00:00:00Z' }), cust('b1', 'y@example.com')],
    orders: [{ id: 'o1', customerId: 'a1', totalCents: 10 }, { id: 'o2', customerId: 'a2', totalCents: 20 }, { id: 'o3', customerId: 'b1', totalCents: 30 }],
  });
  dedupeCustomers(d);
  assert.deepEqual(read(d, 'orders.json'), [{ id: 'o1', customerId: 'a2', totalCents: 10 }, { id: 'o2', customerId: 'a2', totalCents: 20 }, { id: 'o3', customerId: 'b1', totalCents: 30 }]);
});

test('customers with the same name or phone but different emails are not merged', () => {
  const d = dir({
    customers: [
      cust('a1', 'one@example.com', { name: 'Same Person', phone: '555' }),
      cust('a2', 'two@example.com', { name: 'Same Person', phone: '555' }),
    ],
    orders: [],
  });
  dedupeCustomers(d);
  assert.deepEqual(ids(read(d, 'customers.json')), ['a1', 'a2']);
  assert.deepEqual(read(d, 'customers.archive.json', []), []);
});

test('customers without an email are never merged with each other', () => {
  const d = dir({ customers: [cust('a1', ''), cust('a2', null), cust('a3', '   '), cust('a4', undefined)], orders: [] });
  dedupeCustomers(d);
  assert.deepEqual(ids(read(d, 'customers.json')), ['a1', 'a2', 'a3', 'a4']);
});
