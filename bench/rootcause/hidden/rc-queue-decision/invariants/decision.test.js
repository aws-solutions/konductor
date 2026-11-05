'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const text = () => fs.readFileSync(path.join(__dirname, '..', 'docs', 'decision.md'), 'utf8');

test('the decision file is not trivial', () => {
  const lines = text().split('\n').filter((l) => l.trim());
  assert.ok(lines.length >= 15, `${lines.length} non-blank lines`);
});

test('all three options are discussed', () => {
  const t = text();
  assert.match(t, /queue/i);
  assert.match(t, /stream/i);
  assert.match(t, /broker|self-hosted/i);
});

test('a cost or trade-off is stated', () => {
  assert.match(text(), /cost|price|spend|trade-?off|downside|drawback|limitation|risk/i);
});

test('the stated load is taken into account', () => {
  assert.match(text(), /2,?000|spike|peak|burst|sale/i);
});
