const test = require('node:test');
const assert = require('node:assert/strict');
const { renderTable, renderCsv } = require('./render');

const columns = [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }];
const rows = [{ name: 'A', value: 1234.5 }];

test('v2 uses plain numbers and tabbed compact rows', () => {
  assert.equal(renderTable(rows, { columns }), 'Name | Value\nA | 1234.5');
  assert.equal(renderTable(rows, { columns, compact: true }), 'A\t1234.5');
});

test('v2 csv always ends with a newline', () => {
  assert.equal(renderCsv(rows, columns), 'Name,Value\nA,1234.5\n');
});
