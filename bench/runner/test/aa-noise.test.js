// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/report/aa.js: the A/A noise floor (the same arm run twice), and the mark a gap gets beside it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { aaNoise, noiseMark } = require('../../report/aa.js');
const { pairedCellCI } = require('../../report/stats.js');

const cells = [[70, 74], [50, 44], [90, 88], [61, 69], [80, 77], [55, 57], [66, 60], [72, 79]].map(([a, b]) => ({ head: [a], base: [b] }));

test('aaNoise: the half-width of the paired t interval of an arm against its repeat, over tasks', () => {
  const n = aaNoise(cells);
  const ci = pairedCellCI(cells);
  assert.equal(n.tasks, 8);
  assert.equal(n.delta, ci.delta);
  assert.equal(n.halfWidth, (ci.ciHigh - ci.ciLow) / 2);
  assert.equal(n.sd.toFixed(6), (ci.se * Math.sqrt(8)).toFixed(6));
  assert.deepEqual(aaNoise([{ head: [1], base: [2] }]), { tasks: 1, delta: -1, halfWidth: null, sd: null });
  assert.deepEqual(aaNoise([{ head: [], base: [2] }]), { tasks: 0, delta: null, halfWidth: null, sd: null }, 'a task with one side empty is left out');
});

test('noiseMark: a gap smaller than the A/A half-width is inside noise', () => {
  const aa = { halfWidth: 5.2, tasks: 8 };
  assert.equal(noiseMark(3.1, aa), 'inside A/A noise (half-width 5.2 over 8 tasks)');
  assert.equal(noiseMark(-6, aa), 'outside A/A noise (half-width 5.2 over 8 tasks)');
  assert.equal(noiseMark(3, { halfWidth: null, tasks: 1 }), 'A/A noise unknown (fewer than 2 paired tasks)');
  assert.equal(noiseMark(3, null), 'no A/A pair in these runs');
});
