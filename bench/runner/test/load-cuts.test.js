// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scenarios/load-cuts.js and the pilot table: a cut skill load is marked per run and counted under the table.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadState, markLoad, cutSummary, cutLine } = require('../../scenarios/load-cuts.js');
const { pilotRows, renderTable } = require('../../scenarios/pilot-table.js');
const { tmp, write, mkResult } = require('./helpers.js');

const cutRun = { skillLoads: [{ name: 'Big-Skill', cut: true, whole: false }, { name: 'small', whole: true }] };
const recoveredRun = { skillLoads: [{ name: 'big-skill', cut: true, whole: true, recovered: true }, { name: 'big-skill', via: 'file', whole: true }] };

test('loadState: a skill is whole when any of its loads was; marks name cut or whole after a read-back', () => {
  const st = loadState(cutRun);
  assert.deepEqual(st, { 'big-skill': { whole: false, recovered: false }, small: { whole: true, recovered: false } });
  assert.equal(markLoad('Big-Skill', st), 'Big-Skill (cut)');
  assert.equal(markLoad('small', st), 'small');
  assert.equal(markLoad('big-skill', loadState(recoveredRun)), 'big-skill (whole after read-back)');
  assert.equal(markLoad('other', st), 'other', 'a run without skillLoads for the name is shown as before');
  assert.deepEqual(loadState({}), {});
});

test('cutSummary and cutLine: counts per run and skill; no line without skillLoads', () => {
  const t = cutSummary([loadState(cutRun), loadState(recoveredRun), {}]);
  assert.deepEqual(t, { skills: 3, cut: 1, recovered: 1, runsWithLoads: 2, runsAllWhole: 1 });
  assert.match(cutLine(t), /^Skill loads \(per run and skill\): 2 whole \(1 only after a read-back\), 1 cut and never read whole; 1 of 2 runs/);
  assert.equal(cutLine(cutSummary([{}])), null);
});

test('the pilot table marks the cut load in its loads column and prints the count line', () => {
  const root = tmp();
  const w = path.join(root, 'w');
  write(path.join(w, 'forced', 't1-a', '1', 'result.json'), JSON.stringify(mkResult({ harness: 'kiro-cli', armId: 'forced', taskId: 't1-a', replicate: 1, checks: [], skillsLoaded: ['Big-Skill', 'small'], ...cutRun })));
  write(path.join(root, 'pack', 'README.md'), 'an empty pack\n');
  const rows = pilotRows([w], { packDir: path.join(root, 'pack') });
  assert.deepEqual(rows[0].loads, ['Big-Skill (cut)', 'small']);
  assert.match(renderTable(rows), /Skill loads \(per run and skill\): 1 whole \(0 only after a read-back\), 1 cut and never read whole; 0 of 1 runs/);
});
