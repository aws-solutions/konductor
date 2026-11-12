// SPDX-License-Identifier: Apache-2.0
// Tests for the text the markdown reports share (scripts/bench/lib/report-text.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTROLS_LINE,
  NOT_RUN,
  controlsTable,
  formatGap,
  formatInterval,
  formatReading,
  oneLine,
} = require('../../../scripts/bench/lib/report-text');

test('oneLine: one line, no table or list break, and no link, image or tag', () => {
  assert.equal(oneLine('a\r\nb\tc'), 'a b c');
  assert.equal(oneLine('x | `y`'), "x ' 'y'");
  assert.equal(oneLine('  many   spaces  '), 'many spaces');
  assert.equal(
    oneLine('<img src=x> [t](http://example.test)'),
    '&lt;img src=x> [t]\\(http://example.test)',
  );
  // A backslash before `<` must not cancel the escape: no `<` is left in the output, whatever comes before it.
  for (const text of ['\\<img src=x>', '\\\\<img src=x>', '\\\\\\<b>']) {
    const shown = oneLine(text);
    assert.ok(!shown.includes('<'), shown);
    assert.ok(
      shown.endsWith(text.slice(text.indexOf('<')).replace('<', '&lt;')),
      shown,
    );
  }
  assert.equal(oneLine(42), '42');
  assert.equal(oneLine(null), 'null');
});

test('formatGap: two decimals with a sign, two significant digits for a figure that would print as zero, n/a for no number', () => {
  assert.equal(formatGap(1.234), '+1.23');
  assert.equal(formatGap(0), '+0.00');
  assert.equal(formatGap(-0.5), '-0.50');
  assert.equal(formatGap(0.004), '+0.0040');
  assert.equal(formatGap(-0.004), '-0.0040');
  for (const value of [null, undefined, '1'])
    assert.equal(formatGap(value), 'n/a');
});

test('formatInterval: both ends in the given format, n/a when it is not a pair', () => {
  assert.equal(formatInterval([-0.25, 1.5]), '[-0.25, +1.50]');
  assert.equal(
    formatInterval([0.1, 0.2], (value) => `${value * 100}%`),
    '[10%, 20%]',
  );
  for (const value of [null, undefined, 'x', {}, 3])
    assert.equal(formatInterval(value), 'n/a');
});

test('formatReading: the gap, its interval and the task count, n/a without a mean', () => {
  assert.equal(
    formatReading({ mean_gap: 0.5, t_interval: [0.1, 0.9], tasks_counted: 7 }),
    '+0.50 [+0.10, +0.90] (n=7)',
  );
  assert.equal(
    formatReading({ mean_gap: 0.5, t_interval: null, tasks_counted: 2 }),
    '+0.50 n/a (n=2)',
  );
  for (const value of [null, undefined, {}, { mean_gap: null }])
    assert.equal(formatReading(value), 'n/a');
});

test('CONTROLS_LINE says what every controls status means for the readings', () => {
  assert.deepEqual(Object.keys(CONTROLS_LINE), ['PASS', 'FAIL', 'NONE']);
  assert.match(CONTROLS_LINE.FAIL, /not trusted/);
  assert.match(CONTROLS_LINE.NONE, /no control/);
});

test('controlsTable: a row per control with its checks and what is missing; a control that is not run shows only what is missing', () => {
  assert.deepEqual(controlsTable([]), ['No control is in this run.']);
  const lines = controlsTable([
    [
      'convention-control',
      {
        status: 'PASS',
        checks: [
          { ok: true, name: 'B gap above 0', detail: '+2.78' },
          { ok: false, name: 'A | gap', detail: '`x`' },
        ],
        missing: [],
      },
    ],
    [
      'ladder',
      {
        status: NOT_RUN,
        checks: [{ ok: true, name: 'never shown', detail: 'x' }],
        missing: ['the D0 judgments', 'the <D4> judgments'],
      },
    ],
  ]);
  assert.deepEqual(lines, [
    '| Control | Verdict | Checks |',
    '| --- | --- | --- |',
    "| `convention-control` | **PASS** | ok: B gap above 0 (+2.78)<br>NO: A ' gap ('x') |",
    '| `ladder` | **NOT RUN** | missing: the D0 judgments; the &lt;D4> judgments |',
  ]);
});
