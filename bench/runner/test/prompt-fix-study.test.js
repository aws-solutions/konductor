// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cells, forecast, mayStart, judgeMayStart, gate, rebook, spent, STEPS } = require('../../ops/prompt-fixes/study.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pfs-'));
const ledger = (dir, credits) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'credit-ledger.jsonl'), `${JSON.stringify({ ts: '2026-11-27T00:00:00Z', kind: 'run', credits, armId: 'vanilla', taskId: 'x', replicate: 1 })}\n`); };
const result = (dir, r) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(r)); };

test('cells: smoke is 4 tasks x 3 arms x 1 rep with the team task first; A is 81 runs; B is 45', () => {
  const s = cells('smoke');
  assert.equal(s.length, 12);
  assert.equal(s[0].task, 't12-mux-parallel-merge');
  assert.equal(cells('A').length, 81);
  assert.equal(cells('B').length, 45);
  assert.throws(() => cells('D'), /step must be/);
});

test('forecast: every step has runs, arms, a cap and a worst case; caps are the approved ones', () => {
  const { steps: f, judge } = forecast(path.join(tmp(), 'none'));
  assert.deepEqual([f.smoke.cap, f.A.cap, f.B.cap, f.C.cap], [90, 800, 700, 598]);
  assert.equal(f.B.runLimit, 100);
  assert.equal(f.A.worstCase, 81 * 100);
  assert.ok(f.smoke.total > 0 && f.smoke.arms.vanilla > 0);
  assert.deepEqual(judge.panel, ['gpt-5.6-luna', 'deepseek-3.2', 'qwen3-coder-next']);
  assert.ok(judge.capUsd >= judge.high && judge.high > judge.mid && judge.mid > 0);
});

test('batch C: 3 arms x 3 reps of CardDemo (607.5) do not fit 598, so 2 reps; at the soft worst case 270 all 6 runs start (the owner ruled 598, D-298)', () => {
  const { steps } = forecast(path.join(tmp(), 'none'));
  assert.equal(steps.C.reps, 2);
  assert.equal(steps.C.runs, 6);
  assert.equal(steps.C.total, 405);
  assert.equal(steps.C.soft, true);
  assert.equal(steps.C.startable, 6);
});

test('judgeMayStart: refuses when judge USD spent plus one run high estimate passes the cap', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'a'), { recursive: true });
  fs.writeFileSync(path.join(d, 'a', 'credit-ledger.jsonl'), `${JSON.stringify({ kind: 'judge', unit: 'usd', usd: 1.9, credits: 0 })}\n`);
  assert.equal(judgeMayStart(d, 't1-bug-date-range', 3), null);
  assert.match(judgeMayStart(d, 'cx-carddemo-batchday', 2), /judge cap: USD 1.9 spent of 2/);
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

// The smoke stop of 2026-11-27 (D-297): the adaptive t12 run was stopped at an estimate of 26.005 under a limit of 25 and
// booked 26.005, while its session's creditSplit said 3.29.
test('rebook: an estimate-fault stop is moved aside and re-booked at its measured spend; a real stop is left alone', () => {
  const d = tmp();
  const steps = path.join(d, 'runs/smoke');
  const aside = path.join(d, 'incomplete');
  const split = (main) => `${JSON.stringify({ payload: { type: 'session_metadata', key: 'creditSplit', value: { main, delegated: 0, auxiliary: 0.01 } } })}\n`;
  const cell = (rel, { charged, r, mains }) => {
    const u = path.join(steps, rel);
    fs.mkdirSync(u, { recursive: true });
    fs.writeFileSync(path.join(u, 'credit-ledger.jsonl'), `${JSON.stringify({ kind: 'run', unit: 'credits', arm: r.armId, task: r.taskId, replicate: 1, credits: null, charged, censored: true })}\n`);
    const run = path.join(u, `${r.armId}/${r.taskId}/1`);
    result(run, r);
    fs.mkdirSync(path.join(run, 'session/sess_a'), { recursive: true });
    fs.writeFileSync(path.join(run, 'session/sess_a/messages.jsonl'), mains.map(split).join(''));
    return u;
  };
  const stop = { status: 'error', flags: ['creditLimit'], creditLimit: 25, creditsCensored: true };
  const fault = cell('t12-mux-parallel-merge/konductor-adaptive/r1', { charged: 26, r: { ...stop, armId: 'konductor-adaptive', taskId: 't12-mux-parallel-merge', creditEstimate: 26.005 }, mains: [0, 0.4, 3.28] });
  const real = cell('t1-bug-date-range/konductor-adaptive/r1', { charged: 31, r: { ...stop, armId: 'konductor-adaptive', taskId: 't1-bug-date-range', creditEstimate: 31 }, mains: [0, 12, 26] });
  ledger(path.join(steps, 't1-bug-date-range/vanilla/r1'), 1.62);
  assert.equal(spent(steps).credits, 58.62);
  const dry = rebook(steps, aside, { apply: false });
  assert.equal(dry.length, 1);
  assert.equal(dry[0].measured, 3.29);
  assert.equal(dry[0].charge, 6.17, 'measured plus the largest rise between two lines (2.88), the most one unwritten call adds');
  assert.equal(fs.existsSync(fault), true, 'a dry run moves nothing');
  const done = rebook(steps, aside, { apply: true });
  assert.equal(fs.existsSync(fault), false);
  assert.equal(fs.existsSync(path.join(done[0].movedTo, 'konductor-adaptive/t12-mux-parallel-merge/1/result.json')), true, 'the evidence is kept');
  assert.equal(fs.existsSync(real), true, 'a stop whose measured spend passed the limit stays booked');
  assert.equal(spent(steps).credits, 38.79, '31 + 1.62 + 6.17');
  assert.deepEqual(rebook(steps, aside, { apply: true }), [], 'a second pass finds nothing');
});
