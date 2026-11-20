const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/report');

const report = {
  title: 'Report',
  columns: [{ key: 'name', label: 'Name' }, { key: 'count', label: 'Count' }],
  rows: [{ name: 'A', count: 2 }]
};

test('compact output uses tab separator', () => {
  const output = buildReport(report, { compact: true });
  assert.match(output, /A\t2/);
});
