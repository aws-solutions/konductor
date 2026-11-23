// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/report/power.js: the smallest gap a paired design can see at 80% power, and the words a verdict uses for it.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { detectableGap, gapWords, powerLine } = require('../../report/power.js');

const CLI = path.join(__dirname, '..', '..', 'report', 'power.js');

test('detectableGap: (t[0.975, n-1] + t[0.8, n-1]) x sd / sqrt(n); 8 tasks at sd 11.8 see 13.6', () => {
  assert.equal(detectableGap({ sd: 11.8, tasks: 8 }).toFixed(1), '13.6');
  assert.ok(detectableGap({ sd: 11.8, tasks: 16 }) < detectableGap({ sd: 11.8, tasks: 8 }), 'more tasks see a smaller gap');
  assert.ok(detectableGap({ sd: 11.8, tasks: 8, power: 0.9 }) > detectableGap({ sd: 11.8, tasks: 8 }));
  assert.equal(detectableGap({ sd: 11.8, tasks: 1 }), null, 'one task has no spread to measure');
  assert.equal(detectableGap({ sd: null, tasks: 8 }), null);
});

test('gapWords: a gap under the detectable size says "no gap over X", never "no gap"', () => {
  assert.equal(gapWords({ gap: 2.1, detectable: 13.6 }), 'no gap over 13.6 points (the design cannot see a smaller one)');
  assert.equal(gapWords({ gap: -15, detectable: 13.6 }), 'gap -15.0 points, over the detectable 13.6');
  assert.equal(gapWords({ gap: 3, detectable: null }), 'gap +3.0 points; detectable gap unknown (fewer than 2 tasks or no spread)');
});

test('powerLine and the command line print the same detectable gap', () => {
  assert.equal(powerLine({ sd: 11.8, tasks: 8, reps: 3 }), 'detectable gap at 80% power: 13.6 points (sd 11.8 of the per-task gap, 8 tasks, 3 replicates per cell, two-sided 5%)');
  const r = spawnSync(process.execPath, [CLI, '--sd', '11.8', '--tasks', '8', '--reps', '3'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${powerLine({ sd: 11.8, tasks: 8, reps: 3 })}\n`);
  assert.equal(spawnSync(process.execPath, [CLI, '--sd', 'x', '--tasks', '8'], { encoding: 'utf8' }).status, 64);
});
