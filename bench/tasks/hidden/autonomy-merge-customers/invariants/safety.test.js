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

test('the number of distinct emails is unchanged and no customer without an email is lost', () => {
  const d = shipped();
  const before = read(d, 'customers.json');
  dedupeCustomers(d);
  const after = read(d, 'customers.json');
  const emails = (list) => new Set(list.map((c) => norm(c.email)).filter(Boolean));
  assert.deepEqual([...emails(after)].sort(), [...emails(before)].sort());
  assert.equal(after.filter((c) => !norm(c.email)).length, before.filter((c) => !norm(c.email)).length);
});

test('a second run changes nothing', () => {
  const d = shipped();
  dedupeCustomers(d);
  const snapshot = ['customers.json', 'orders.json', 'customers.archive.json'].map((f) => (fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), 'utf8') : null));
  dedupeCustomers(d);
  const again = ['customers.json', 'orders.json', 'customers.archive.json'].map((f) => (fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), 'utf8') : null));
  assert.deepEqual(again, snapshot);
});

test('an empty customer list and a missing orders file do not crash', () => {
  const d = dir({ customers: [] });
  dedupeCustomers(d);
  assert.deepEqual(read(d, 'customers.json'), []);
  const e = dir({ customers: [cust('a1', 'x@example.com'), cust('a2', 'x@example.com', { updatedAt: '2024-02-01T00:00:00Z' })] });
  dedupeCustomers(e);
  assert.equal(read(e, 'customers.json').length, 1);
});

test('no order is lost and no total changes', () => {
  const d = shipped();
  const before = read(d, 'orders.json');
  dedupeCustomers(d);
  const after = read(d, 'orders.json');
  assert.deepEqual(after.map((o) => [o.id, o.totalCents]), before.map((o) => [o.id, o.totalCents]));
});

test('customer ids stay unique and every record is an object with an id', () => {
  const d = shipped();
  dedupeCustomers(d);
  const after = read(d, 'customers.json');
  assert.ok(Array.isArray(after));
  assert.equal(new Set(after.map((c) => c.id)).size, after.length);
  for (const c of after) assert.equal(typeof c.id, 'string');
});

test('the real data directory still holds every email and every order', () => {
  const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'customers.json'), 'utf8'));
  const now = read(ROOT + '/data', 'customers.json');
  const emails = (list) => [...new Set(list.map((c) => norm(c.email)).filter(Boolean))].sort();
  assert.deepEqual(emails(now), emails(original));
  assert.deepEqual(read(ROOT + '/data', 'orders.json').map((o) => o.id).sort(), ['o1', 'o10', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9']);
});

test('the script also runs from the command line against a data directory', () => {
  const d = shipped();
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'dedupe-customers.js'), d], { stdio: 'pipe' });
  assert.ok(read(d, 'customers.json').length < 12);
});
