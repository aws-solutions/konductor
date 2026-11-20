const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/report');

const sampleReport = {
  title: 'Sales Summary',
  columns: [
    { key: 'name', label: 'Name' },
    { key: 'count', label: 'Count' },
    { key: 'amount', label: 'Amount' }
  ],
  rows: [
    { name: 'Widget', count: 2, amount: 199.99 },
    { name: 'Gadget', count: 1, amount: 49.50 }
  ]
};

test('table output includes title and column headings', () => {
  const output = buildReport(sampleReport, { format: 'table' });
  assert.match(output, /^Sales Summary\nName \| Count \| Amount/);
  assert.match(output, /Widget/);
  assert.match(output, /Gadget/);
});

test('table output uses plain numeric formatting', () => {
  const output = buildReport(sampleReport, { format: 'table' });
  assert.match(output, /199\.99/);
  assert.match(output, /49\.5/);
});

test('compact output produces tab-separated rows without headings', () => {
  const output = buildReport(sampleReport, { compact: true });
  assert.doesNotMatch(output, /Name \| Count/);
  assert.match(output, /Widget\t2\t199\.99/);
  assert.match(output, /Gadget\t1\t49\.5/);
});

test('compact output does not include title', () => {
  const output = buildReport(sampleReport, { compact: true });
  assert.doesNotMatch(output, /^Sales Summary/);
});

test('CSV output includes header row and trailing newline', () => {
  const output = buildReport(sampleReport, { format: 'csv' });
  assert.match(output, /^Name,Count,Amount\n/);
  assert.match(output, /\n$/);
});

test('CSV output quotes values with commas', () => {
  const report = {
    columns: [{ key: 'name', label: 'Item' }, { key: 'desc', label: 'Description' }],
    rows: [{ name: 'Widget', desc: 'A test, with comma' }]
  };
  const output = buildReport(report, { format: 'csv' });
  assert.match(output, /"A test, with comma"/);
});

test('CSV output quotes values with double quotes', () => {
  const report = {
    columns: [{ key: 'name', label: 'Item' }, { key: 'desc', label: 'Description' }],
    rows: [{ name: 'Widget', desc: 'Say "hello"' }]
  };
  const output = buildReport(report, { format: 'csv' });
  assert.match(output, /"Say ""hello"""/);
});

test('CSV output quotes values with line breaks', () => {
  const report = {
    columns: [{ key: 'name', label: 'Item' }, { key: 'desc', label: 'Description' }],
    rows: [{ name: 'Widget', desc: 'Line one\nLine two' }]
  };
  const output = buildReport(report, { format: 'csv' });
  assert.match(output, /"Line one\nLine two"/);
});

test('CSV output handles empty cells', () => {
  const report = {
    columns: [{ key: 'name', label: 'Item' }, { key: 'note', label: 'Note' }],
    rows: [{ name: 'Widget', note: null }, { name: 'Gadget', note: undefined }, { name: 'Thing', note: '' }]
  };
  const output = buildReport(report, { format: 'csv' });
  const lines = output.trimEnd().split('\n');
  assert.equal(lines[1], 'Widget,');
  assert.equal(lines[2], 'Gadget,');
  assert.equal(lines[3], 'Thing,');
});
