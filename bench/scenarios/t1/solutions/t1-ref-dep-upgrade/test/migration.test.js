const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/report');

const report = {
  title: 'Upgrade sample',
  columns: [{ key: 'region', label: 'Region' }, { key: 'amount', label: 'Amount' }],
  rows: [{ region: 'North', amount: 1234.5 }]
};

test('application table output uses the v2 plain number default', () => {
  assert.equal(buildReport(report), 'Upgrade sample\nRegion | Amount\nNorth | 1234.5');
});

test('application compact output uses the v2 renderer', () => {
  assert.equal(buildReport(report, { compact: true }), 'North\t1234.5');
});

test('application CSV output includes the v2 newline', () => {
  assert.equal(buildReport(report, { format: 'csv' }), 'Region,Amount\nNorth,1234.5\n');
});

test('application CSV output quotes a comma', () => {
  const withComma = { ...report, rows: [{ region: 'North, Coast', amount: 3 }] };
  assert.equal(buildReport(withComma, { format: 'csv' }), 'Region,Amount\n"North, Coast",3\n');
});
