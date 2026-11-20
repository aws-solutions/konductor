const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/report');

const report = {
  title: 'Tiny report',
  columns: [{ key: 'name', label: 'Name' }, { key: 'count', label: 'Count' }],
  rows: [{ name: 'A', count: 2 }]
};

test('table reports retain the title and headings', () => {
  const output = buildReport(report);
  assert.match(output, /^Tiny report\\nName \\| Count/);
  assert.match(output, /A/);
});

test('json reports preserve the input structure', () => {
  assert.deepEqual(JSON.parse(buildReport(report, { format: 'json' })), report);
});
