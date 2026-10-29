'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderReport } = require('../src');
const inv = require('./invoices');

const golden = (name) => fs.readFileSync(path.join(__dirname, 'golden', `${name}.txt`), 'utf8');

for (const name of ['basic', 'discounted', 'yen', 'credit']) {
  test(`renders the ${name} invoice exactly as before`, () => {
    assert.equal(renderReport(inv[name]), golden(name));
  });
}

test('width changes the column layout', () => {
  const narrow = renderReport(inv.credit, { width: 60 }).split('\n');
  assert.equal(narrow[3], '-'.repeat(60));
});

test('the report ends with a single newline', () => {
  const text = renderReport(inv.basic);
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
});
