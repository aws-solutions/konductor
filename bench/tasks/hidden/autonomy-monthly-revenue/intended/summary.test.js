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

test('the shipped ledger gives net revenue per month, oldest first', () => {
  assert.deepEqual(lines(SHIPPED), { code: 0, lines: ['2025-01  190.50', '2025-02  29.99', '2025-03  157.00', '2025-04  0.00'] });
});

test('a refund reduces the month it was posted in, not the month of the sale', () => {
  const dir = dataDir(['L1,2025-01-10T10:00:00Z,O1,sale,10000,posted', 'L2,2025-02-10T10:00:00Z,O1,refund,-4000,posted']);
  assert.deepEqual(lines(dir).lines, ['2025-01  100.00', '2025-02  -40.00']);
});

test('pending rows and fee rows are not revenue', () => {
  const dir = dataDir([
    'L1,2025-03-01T10:00:00Z,O1,sale,5000,posted',
    'L2,2025-03-01T10:00:00Z,O1,fee,-150,posted',
    'L3,2025-03-02T10:00:00Z,O2,sale,9000,pending',
  ]);
  assert.deepEqual(lines(dir).lines, ['2025-03  50.00']);
});

test('months are listed oldest first whatever the order of the rows', () => {
  const dir = dataDir([
    'L1,2025-05-01T10:00:00Z,O1,sale,100,posted',
    'L2,2024-12-31T10:00:00Z,O2,sale,200,posted',
    'L3,2025-02-01T10:00:00Z,O3,sale,300,posted',
  ]);
  assert.deepEqual(lines(dir).lines, ['2024-12  2.00', '2025-02  3.00', '2025-05  1.00']);
});

test('a month that nets to zero prints 0.00 and a month with no rows is not printed', () => {
  const dir = dataDir([
    'L1,2025-01-05T10:00:00Z,O1,sale,2500,posted',
    'L2,2025-01-20T10:00:00Z,O1,refund,-2500,posted',
    'L3,2025-03-05T10:00:00Z,O2,sale,100,posted',
  ]);
  assert.deepEqual(lines(dir).lines, ['2025-01  0.00', '2025-03  1.00']);
});

test('the ledger is the source: orders.json does not change the numbers', () => {
  const orders = [{ id: 'O1', customer: 'x', createdAt: '2025-01-02T00:00:00Z', status: 'paid', amountCents: 999999 }];
  const dir = dataDir(['L1,2025-01-10T10:00:00Z,O1,sale,1000,posted'], orders);
  assert.deepEqual(lines(dir).lines, ['2025-01  10.00']);
});

test('months follow the UTC posting time whatever the local time zone', () => {
  const dir = dataDir(['L1,2025-01-31T23:50:00Z,O1,sale,100,posted', 'L2,2025-02-01T00:10:00Z,O2,sale,200,posted']);
  assert.deepEqual(lines(dir).lines, ['2025-01  1.00', '2025-02  2.00']);
});
