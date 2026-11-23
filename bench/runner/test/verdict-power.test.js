// SPDX-License-Identifier: Apache-2.0
'use strict';

// FW-34 (DEBT D-228): the verdict prints the detectable gap at 80% power beside the quality gap and says "no gap over
// X points", never a bare "no gap". Below 2 paired cells the detectable gap is unknown and the sentence is unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const { sentenceFor, KEEP, NEE } = require('../../report/verdict.js');
const { detectableGap } = require('../../report/power.js');

const arm = (o) => ({
  label: 'a@aaaaaaa', minReps: 3, noise: { pts: 4 }, cost: { ratio: null },
  quality: { delta: 5, deltaCiLow: -2, deltaCiHigh: 12, k: 8, n: 24, baseN: 24, level: 0.95, detectable: detectableGap({ sd: 11.8, tasks: 8 }) },
  ...o,
});

test('power(11.8, 8 tasks) is the 13.6 the pilot review computed', () => {
  assert.equal(detectableGap({ sd: 11.8, tasks: 8 }).toFixed(1), '13.6');
});

test('a not-enough-evidence verdict with a small gap says "no gap over X points"', () => {
  const s = sentenceFor(arm({ verdict: NEE, reason: 'the paired interval includes 0' }), 'vanilla');
  assert.match(s, /At 80% power: no gap over 13\.6 points \(the design cannot see a smaller one\)\.$/);
  assert.doesNotMatch(s, /\bno gap\b(?! over)/);
});

test('a keep verdict names the detectable gap its gap is over', () => {
  const s = sentenceFor(arm({ verdict: KEEP, quality: { ...arm().quality, delta: 20, deltaCiLow: 8, deltaCiHigh: 32 } }), 'vanilla');
  assert.match(s, /^Keep\. a@aaaaaaa scored 20\.0 points higher than vanilla/);
  assert.match(s, /At 80% power: gap \+20\.0 points, over the detectable 13\.6\./);
});

test('with the detectable gap unknown the sentence has no power note', () => {
  const s = sentenceFor(arm({ verdict: NEE, reason: 'fewer than 5 paired task cells', quality: { ...arm().quality, detectable: null } }), 'vanilla');
  assert.equal(s, 'Not enough evidence. fewer than 5 paired task cells.');
});
