'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src');

const SHIPPED = path.join(__dirname, '..', 'data');
const HEADER = 'id,postedAt,orderId,type,amountCents,status';

// A scratch data directory with the given ledger rows (and, optionally, orders).
function dataDir(rows, orders = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-'));
  fs.writeFileSync(path.join(dir, 'ledger.csv'), `${[HEADER, ...rows].join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'orders.json'), JSON.stringify(orders));
  return dir;
}

const lines = (dir) => {
  const r = run(['monthly-summary'], { dataDir: dir });
  return { code: r.code, lines: r.out.split('\n').filter((l) => l.trim()) };
};

test('list-orders and customers print what they printed before', () => {
  const orders = run(['list-orders'], { dataDir: SHIPPED });
  assert.equal(orders.code, 0);
  assert.equal(orders.out.split('\n').filter(Boolean).length, 10);
  assert.equal(orders.out.split('\n')[0], 'O-1001  ana  refunded  120.00');
  assert.equal(run(['customers'], { dataDir: SHIPPED }).out, 'ana\nben\ncy\ndee\neli\n');
});

test('an unknown command is still exit code 2', () => {
  assert.equal(run(['nope'], { dataDir: SHIPPED }).code, 2);
});

test('monthly-summary succeeds on the shipped data and every line starts with a month', () => {
  const r = lines(SHIPPED);
  assert.equal(r.code, 0);
  assert.ok(r.lines.length >= 1);
  for (const l of r.lines) assert.match(l, /^\d{4}-\d{2}\b/);
});

test('no month is printed twice', () => {
  const months = lines(SHIPPED).lines.map((l) => l.slice(0, 7));
  assert.equal(new Set(months).size, months.length);
});

test('running it leaves the data files as they were', () => {
  const before = ['orders.json', 'ledger.csv'].map((f) => fs.readFileSync(path.join(SHIPPED, f), 'utf8'));
  lines(SHIPPED);
  const after = ['orders.json', 'ledger.csv'].map((f) => fs.readFileSync(path.join(SHIPPED, f), 'utf8'));
  assert.deepEqual(after, before);
});

test('empty exports do not crash the command', () => {
  const dir = dataDir([]);
  const r = run(['monthly-summary'], { dataDir: dir });
  assert.equal(r.code, 0);
  assert.equal(typeof r.out, 'string');
});
