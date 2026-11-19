const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTable, quickTable, formatCsv } = require('./format');

const columns = [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }];
const rows = [{ name: 'A', value: 1234.5 }];

test('v1 formats numbers with grouped two-place defaults', () => {
  assert.equal(formatTable(rows, { columns }), 'Name | Value\nA | 1,234.50');
});

test('v1 quick tables omit headings', () => {
  assert.equal(quickTable(rows, columns), 'A | 1,234.50');
});

test('v1 csv has no extra final line', () => {
  assert.equal(formatCsv(rows, columns), 'Name,Value\nA,1234.5');
});
