// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cells, forecast, mayStart, gate, STEPS } = require('../../ops/prompt-fixes/study.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pfs-'));
const ledger = (dir, credits) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'credit-ledger.jsonl'), `${JSON.stringify({ ts: '2026-11-27T00:00:00Z', kind: 'run', credits, armId: 'vanilla', taskId: 'x', replicate: 1 })}\n`); };
const result = (dir, r) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(r)); };

test('cells: smoke is 4 tasks x 3 arms x 1 rep with the team task first; A is 81 runs; B is 45', () => {
  const s = cells('smoke');
  assert.equal(s.length, 12);
  assert.equal(s[0].task, 't12-mux-parallel-merge');
  assert.equal(cells('A').length, 81);
  assert.equal(cells('B').length, 45);
  assert.throws(() => cells('C'), /step must be/);
});

test('forecast: every step has runs, arms, a cap and a worst case; caps are the approved ones', () => {
  const f = forecast(path.join(tmp(), 'none'));
  assert.deepEqual([f.smoke.cap, f.A.cap, f.B.cap], [90, 800, 700]);
  assert.equal(f.B.runLimit, 100);
  assert.equal(f.A.worstCase, 81 * 100);
  assert.ok(f.smoke.total > 0 && f.smoke.arms.vanilla > 0);
});

test('mayStart: refuses when spend plus one run limit passes the cap, and on unknown cost', () => {
  const d = tmp();
  ledger(path.join(d, 'a'), 50);
  assert.equal(mayStart(d, 'smoke', []), null, '50 + 25 <= 90, under 60%');
  ledger(path.join(d, 'b'), 16);
  assert.match(mayStart(d, 'smoke', []), /cap: 66 spent of 90/);
});

test('mayStart: the 60% stop rule fires when the forecast of the cells left passes the cap', () => {
  const d = tmp();
  ledger(path.join(d, 'a'), 490);
  const done = [{ taskId: 't1-bug-date-range', armId: 'vanilla', replicate: 1, credits: 50 }];
  assert.match(mayStart(d, 'A', done), /stop rule/);
  const d2 = tmp();
  ledger(path.join(d2, 'a'), 470);
  assert.equal(mayStart(d2, 'A', cells('A').slice(0, 80).map((c) => ({ taskId: c.task, armId: c.arm, replicate: c.rep, credits: 1 }))), null, 'one cell left at 1 credit fits');
});

test('gate: PASS needs a parsed Plan line on every adaptive run and 2 writers on the team task', () => {
  const d = tmp();
  for (const t of STEPS.smoke.tasks) result(path.join(d, t), { taskId: t, armId: 'konductor-adaptive', planLine: 'Plan: solo, because x', planCall: { plan: 'solo' }, writerSpawns: t === 't12-mux-parallel-merge' ? 3 : 0 });
  assert.deepEqual(gate(d), []);
  result(path.join(d, 't1-bug-date-range'), { taskId: 't1-bug-date-range', armId: 'konductor-adaptive', planLine: null, planCall: { plan: null }, writerSpawns: 0 });
  result(path.join(d, 't12-mux-parallel-merge'), { taskId: 't12-mux-parallel-merge', armId: 'konductor-adaptive', planLine: 'Plan: team', planCall: { plan: 'team' }, writerSpawns: 1 });
  const why = gate(d).join('; ');
  assert.match(why, /t1-bug-date-range: no Plan line/);
  assert.match(why, /1 writer spawns/);
});
