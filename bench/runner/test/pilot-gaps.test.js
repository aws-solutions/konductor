// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scenarios/pilot-gaps.js: arm gaps under the pilot table, with the detectable gap and the A/A noise floor.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { armIdentities, armGaps, renderGaps } = require('../../scenarios/pilot-gaps.js');
const { mkResult } = require('./helpers.js');

const TASKS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];
const BASE = [70, 50, 90, 61, 80, 55, 66, 72];
const REPEAT = [74, 44, 88, 69, 77, 57, 60, 79];
const rowsOf = (arm, scores) => TASKS.map((task, i) => ({ task, arm, rep: 1, score: scores[i] }));

test('armGaps: every arm against vanilla, the detectable gap, and the A/A floor from vanilla-b', () => {
  const rows = [...rowsOf('vanilla', BASE), ...rowsOf('vanilla-b', REPEAT), ...rowsOf('konductor', BASE.map((s) => s + 3))];
  const ids = new Map([['vanilla', 'v'], ['vanilla-b', 'v'], ['konductor', 'k']]);
  const g = armGaps(rows, ids);
  assert.equal(g.base, 'vanilla');
  assert.deepEqual(g.aaArms, ['vanilla', 'vanilla-b']);
  assert.deepEqual(g.gaps.map((x) => x.arm), ['konductor'], 'the base repeat is the floor, not a gap');
  const k = g.gaps[0];
  assert.equal(k.tasks, 8);
  assert.equal(k.gap, 3);
  assert.equal(k.sd, 0);
  assert.equal(k.detectable, 0);
  assert.ok(g.aa.halfWidth > 3, 'the repeat spreads more than the 3-point gap');
  const text = renderGaps(g).join('\n');
  assert.match(text, /\| konductor \| 8 \| \+3\.0 \| \[\+3\.0, \+3\.0\] \| 0\.0 \| gap \+3\.0 points, over the detectable 0\.0 \| inside A\/A noise \(half-width \d+\.\d over 8 tasks\) \|/);
  assert.match(text, /A\/A noise floor: vanilla-b against vanilla, gap \+0\.\d, half-width \d+\.\d over 8 tasks/);
});

test('armGaps: no A/A pair says so; one arm gives no section; a noisy gap reads "no gap over X"', () => {
  const noisy = BASE.map((s, i) => s + (i % 2 ? 9 : -8));
  const g = armGaps([...rowsOf('vanilla', BASE), ...rowsOf('konductor', noisy)], new Map([['vanilla', 'v'], ['konductor', 'k']]));
  assert.equal(g.aa, null);
  assert.match(renderGaps(g).join('\n'), /no gap over \d+\.\d points .*\| no A\/A pair in these runs \|[\s\S]*No A\/A pair in these runs, so no noise floor/);
  assert.equal(armGaps(rowsOf('vanilla', BASE), new Map()), null);
  assert.deepEqual(renderGaps(null), []);
});

test('armIdentities: two vanilla ids are one condition; a konductor arm at a commit is another', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-gaps-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const put = (arm, extra) => {
    const f = path.join(d, arm, 't1', '1', 'result.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(mkResult({ armId: arm, armLabel: arm, taskId: 't1', replicate: 1, ...extra })));
  };
  put('vanilla', { commitSha: null });
  put('vanilla-b', { commitSha: null });
  put('konductor', { commitSha: 'abc' });
  const ids = armIdentities([d]);
  assert.equal(ids.get('vanilla'), ids.get('vanilla-b'));
  assert.notEqual(ids.get('vanilla'), ids.get('konductor'));
});
