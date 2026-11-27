'use strict';

// Hidden test of t12-split-shared-file: both tickets in the one shared file, the old behaviour kept, and both
// CHANGELOG lines in the Unreleased section.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { formatMoney, formatDate } = require('../src/format.js');

test('FMT-7: accounting brackets negatives for every currency; positives, zero and the old calls unchanged', () => {
  assert.equal(formatMoney(-1250, 'GBP'), '-£12.50');
  assert.equal(formatMoney(123456, 'EUR'), '€1,234.56');
  assert.throws(() => formatMoney(1.5), TypeError);
  assert.equal(formatMoney(-1250, 'EUR', { accounting: true }), '(€12.50)');
  assert.equal(formatMoney(-123456, 'USD', { accounting: true }), '($1,234.56)');
  assert.equal(formatMoney(-1, 'GBP', { accounting: true }), '(£0.01)');
  assert.equal(formatMoney(1250, 'EUR', { accounting: true }), '€12.50');
  assert.equal(formatMoney(0, 'USD', { accounting: true }), '$0.00');
});

test('FMT-9: long dates; iso is the default; a bad style throws', () => {
  assert.equal(formatDate('2026-03-02'), '2026-03-02');
  assert.equal(formatDate('2026-03-02', 'long'), '2 March 2026');
  assert.equal(formatDate('2026-12-31', 'long'), '31 December 2026');
  assert.equal(formatDate('2026-01-01', 'iso'), '2026-01-01');
  assert.throws(() => formatDate('2026-03-02', 'short'), RangeError);
});

test('FMT-9: the long date does not depend on the time zone', () => {
  const script = "const { formatDate } = require('./src/format.js'); process.stdout.write(formatDate('2026-01-01', 'long'))";
  for (const tz of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
    const out = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(out, '1 January 2026', tz);
  }
});


test('CHANGELOG.md: both ticket lines in the Unreleased section, the 1.3.0 section kept', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const unreleased = /## Unreleased\n([\s\S]*?)\n## 1\.3\.0/.exec(text);
  assert.ok(unreleased, 'Unreleased then 1.3.0');
  assert.match(unreleased[1], /^- FMT-7:/m);
  assert.match(unreleased[1], /^- FMT-9:/m);
  assert.match(text, /## 1\.3\.0\n\n- formatMoney takes a currency code \(USD, EUR, GBP\)\./);
});
