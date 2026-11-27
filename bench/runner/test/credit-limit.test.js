// SPDX-License-Identifier: Apache-2.0
'use strict';

// --run-credit-limit against a fake kiro-cli. Engine v2 meters after every model call, so a run can be killed mid-run.
// Engine v3 writes a turn's whole spend in one summary when the turn ends, so the limit is checked at turn boundaries
// and a run that ends over it is flagged with its overshoot. No credits, no network, nothing spawned but the fake.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { validateResult } = require('../lib/result.js');
const { makeCreditMeter, estimateCredits, ESTIMATE } = require('../lib/credit-watch.js');
const PROFILE = require('../../profiles/v3-credit-estimate.json');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const config = (agentEngine) => ({ model: 'claude-sonnet-5.5', effort: 'high', agentEngine });
const ASK = 'I found the timeout setting.\n\nShould the timeout be in seconds or milliseconds?';
const AUTONOMY = { clarifications: [{ id: 'unit', topic: 'unit', keywords: ['seconds?', 'milliseconds?'], answer: 'Seconds.' }] };

function setup(cfg, { engine, limit, mode, autonomy = false }) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  if (autonomy) {
    const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
    write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t, class: 'autonomy', tiers: ['autonomy'], timeoutSec: 60, autonomy: AUTONOMY }));
  }
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, sessionJson: true, ...cfg });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: config(engine), scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
    creditPollMs: 50, ...(limit === undefined ? {} : { runCreditLimit: limit }), ...(mode === undefined ? {} : { runCreditLimitMode: mode }),
  };
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  return {
    root, probe, outDir: path.join(root, 'out', 't1'),
    run: () => executeRun({ arm: ARM, task: loadTasks(bench).get('t1'), replicate: 1, ctx, prepared: null, outDir: path.join(root, 'out', 't1'), inFlightAtStart: 0 }),
    started: (n) => path.join(probe, `started-${n}.json`),
    cleanup: () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); },
  };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---- the meter ----

test('the meter counts v2 credits as live and v3 turn-end credits only in the total', () => {
  const root = tmp();
  try {
    const v2 = path.join(root, 'v2.jsonl');
    const v3 = path.join(root, 'v3.jsonl');
    write(v2, `${JSON.stringify({ type: 'metadata', data: { meteringUsage: [{ value: 1.5, unit: 'credit' }] } })}\n${JSON.stringify({ type: 'metadata', data: { meteringUsage: [{ value: 2, unit: 'credit' }] } })}\n`);
    write(v3, `${JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'turn_completion', executionId: 'e1', promptTurnSummaries: [{ unit: 'credit', usage: 29.4 }] } } } } })}\n`);
    const a = makeCreditMeter(v2);
    assert.equal(a.live(), 3.5);
    assert.equal(a.poll(), 3.5);
    const b = makeCreditMeter(v3);
    assert.equal(b.live(), 0);
    assert.equal(b.poll(), 29.4);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('v3: the meter estimates live credits from context_usage events with estimateCredits, and never once v2 metering is seen', () => {
  const root = tmp();
  const ctxEv = (pct) => JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'context_usage', usagePercentage: pct } } } } });
  try {
    const v3 = path.join(root, 'v3.jsonl');
    write(v3, `${ctxEv(10)}\n${ctxEv(30)}\n`);
    const m = makeCreditMeter(v3);
    assert.ok(Math.abs(m.live() - estimateCredits(40)) < 1e-9);
    assert.equal(m.estimated(), true);
    assert.equal(m.poll(), 0, 'the estimate is never a charged figure');
    const mixed = path.join(root, 'mixed.jsonl');
    write(mixed, `${ctxEv(50)}\n${JSON.stringify({ type: 'metadata', data: { meteringUsage: [{ value: 1, unit: 'credit' }] } })}\n`);
    const n = makeCreditMeter(mixed);
    assert.equal(n.live(), 1);
    assert.equal(n.estimated(), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('v3 estimate: the fitted profile sits above every saved turn by the margin and is at most 3.1x on long turns', () => {
  assert.deepEqual(ESTIMATE, PROFILE.estimate, 'credit-watch.js reads its coefficients from the profile');
  assert.equal(PROFILE.samples.length, PROFILE.sampleCount);
  assert.ok(PROFILE.sampleCount >= 500, `${PROFILE.sampleCount} samples`);
  const tol = 1e-9;
  for (const [pct, credits, run] of PROFILE.samples) {
    assert.ok(estimateCredits(pct) >= PROFILE.estimate.margin * credits - tol, `${run}: estimate ${estimateCredits(pct)} below ${PROFILE.estimate.margin} x ${credits}`);
    if (pct >= PROFILE.fit.longTurnPct) assert.ok(estimateCredits(pct) <= 3.1 * credits, `${run}: estimate ${estimateCredits(pct)} over 3.1 x ${credits}`);
  }
  // The carddemo port turns of 2026-11-26: 0.13 per point guessed 4x their real credits.
  const port = PROFILE.samples.find(([, , run]) => run.endsWith('20261126T0450/konductor/cx-carddemo-port/1'));
  assert.ok(port, 'the carddemo konductor port turn is in the fit');
  assert.ok(estimateCredits(port[0]) / port[1] < 2.7 && 0.13 * port[0] / port[1] > 4);
  assert.equal(estimateCredits(0), 0);
});

// ---- engine v2: unchanged ----

test('v2: a run past the limit is killed with its whole process group, flagged, and records the overshoot', async () => {
  const s = setup({ credits: 3, hangAfterMetering: true }, { engine: 'v2', limit: 1 });
  try {
    const r = await s.run();
    const { pid } = JSON.parse(fs.readFileSync(s.started(1), 'utf8'));
    assert.equal(alive(pid), false, 'the fake agent is gone');
    assert.equal(r.status, 'error');
    assert.ok(r.flags.includes('creditLimit'));
    assert.equal(r.flags.includes('creditLimitExceeded'), false);
    assert.match(r.error, /per-run credit limit 1 reached/);
    assert.equal(r.creditsCensored, true);
    assert.equal(r.credits, 3);
    assert.equal(r.creditLimit, 1);
    assert.equal(r.creditOvershoot, 2);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

test('v2: a run under the limit is not flagged and records no overshoot', async () => {
  const s = setup({ credits: 0.5 }, { engine: 'v2', limit: 5 });
  try {
    const r = await s.run();
    assert.equal(r.status, 'success');
    assert.deepEqual(r.flags.filter((f) => /^creditLimit/.test(f)), []);
    assert.equal(r.creditLimit, 5);
    assert.equal(r.creditOvershoot, null);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

// ---- engine v3 ----

test('v3: a single-turn run over the limit is not killed on its turn summary; it finishes and is flagged with the overshoot', async () => {
  const s = setup({ credits: 8, lingerMs: 600, finalText: 'all done' }, { engine: 'v3', limit: 3 });
  try {
    const r = await s.run();
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.finalText, 'all done', 'the events after the summary were kept');
    assert.ok(r.flags.includes('creditLimitExceeded'), r.flags.join());
    assert.equal(r.flags.includes('creditLimit'), false);
    assert.equal(r.credits, 8);
    assert.equal(r.creditLimit, 3);
    assert.equal(r.creditOvershoot, 5);
    assert.equal(r.error, null);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

test('v3: a one-shot run whose estimated credits pass the limit is killed and recorded as censored (D-67)', async () => {
  const s = setup({ contextUsage: [20, 30, 40], hangAfterContext: true }, { engine: 'v3', limit: 2 });
  try {
    const r = await s.run();
    const { pid } = JSON.parse(fs.readFileSync(s.started(1), 'utf8'));
    assert.equal(alive(pid), false, 'the fake agent is gone');
    assert.equal(r.status, 'error');
    assert.ok(r.flags.includes('creditLimit'), r.flags.join());
    assert.match(r.error, /per-run credit limit 2 reached at an estimated [0-9.]+ credits/);
    assert.equal(r.creditsCensored, true);
    assert.equal(r.creditLimit, 2);
    assert.ok(r.creditEstimate > 2, `the estimate at the kill is its own field: ${r.creditEstimate}`);
    assert.match(r.error, new RegExp(`estimated ${r.creditEstimate.toFixed(3)} credits`));
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

test('v3: a run under the limit has no flag and no overshoot', async () => {
  const s = setup({ credits: 2, lingerMs: 300 }, { engine: 'v3', limit: 3 });
  try {
    const r = await s.run();
    assert.equal(r.status, 'success');
    assert.deepEqual(r.flags.filter((f) => /^creditLimit/.test(f)), []);
    assert.equal(r.creditLimit, 3);
    assert.equal(r.creditOvershoot, null);
  } finally { s.cleanup(); }
});

test('v3 conversation: over the limit when a turn ends, the next turn is not started', async () => {
  const s = setup({ turns: [{ finalText: ASK, credits: 6 }, { finalText: 'Done.', credits: 2 }] }, { engine: 'v3', limit: 5, autonomy: true });
  try {
    const r = await s.run();
    assert.equal(fs.existsSync(s.started(1)), true);
    assert.equal(fs.existsSync(s.started(2)), false, 'turn 2 was never spawned');
    assert.ok(r.flags.includes('creditLimit'), r.flags.join());
    assert.match(r.error, /per-run credit limit 5 reached at 6\.000 credits \(checked when turn 1 ended; no further turn was started\)/);
    assert.equal(r.credits, 6);
    assert.equal(r.creditOvershoot, 1);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

test('v3 conversation: under the limit at the turn boundary the conversation goes on', async () => {
  const s = setup({ turns: [{ finalText: ASK, credits: 2 }, { finalText: 'Done.', credits: 2 }] }, { engine: 'v3', limit: 5, autonomy: true });
  try {
    const r = await s.run();
    assert.equal(fs.existsSync(s.started(2)), true);
    assert.equal(r.turns, 2);
    assert.equal(r.credits, 4);
    assert.deepEqual(r.flags.filter((f) => /^creditLimit/.test(f)), []);
    assert.equal(r.creditOvershoot, null);
  } finally { s.cleanup(); }
});

test('without a limit the result has no credit limit fields', async () => {
  const s = setup({ credits: 50 }, { engine: 'v3' });
  try {
    const r = await s.run();
    assert.equal('creditLimit' in r, false);
    assert.equal('creditOvershoot' in r, false);
    assert.deepEqual(r.flags.filter((f) => /^creditLimit/.test(f)), []);
  } finally { s.cleanup(); }
});

// ---- --run-credit-limit-mode ----

// Context usage 20+30+40 makes a live estimate of about 11.7 credits during the turn; the turn then reports 8.
const OVER_V3 = { contextUsage: [20, 30, 40], credits: 8, lingerMs: 600, finalText: 'all done' };

for (const mode of [undefined, 'hard']) {
  test(`${mode ?? 'no mode (the default)'}: a v3 run whose estimate passes the limit is killed, as before`, async () => {
    const s = setup(OVER_V3, { engine: 'v3', limit: 2, mode });
    try {
      const r = await s.run();
      assert.equal(r.status, 'error');
      assert.ok(r.flags.includes('creditLimit'), r.flags.join());
      assert.match(r.error, /per-run credit limit 2 reached/);
      assert.equal('creditLimitMode' in r, false, 'hard mode adds no field to the result');
      assert.equal('creditLimitWarning' in r, false);
    } finally { s.cleanup(); }
  });
}

test('soft: the same v3 run is not killed; it finishes, is flagged over the limit and carries a warning', async () => {
  const s = setup(OVER_V3, { engine: 'v3', limit: 2, mode: 'soft' });
  try {
    const r = await s.run();
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.finalText, 'all done');
    assert.ok(r.flags.includes('creditLimitExceeded'), r.flags.join());
    assert.equal(r.flags.includes('creditLimit'), false);
    assert.equal(r.creditsCensored, false);
    assert.equal(r.credits, 8);
    assert.equal(r.creditOvershoot, 6);
    assert.equal(r.creditLimitMode, 'soft');
    assert.equal(r.creditLimitWarning, 'per-run credit limit 2 passed at 8.000 credits (soft mode: the run was not stopped)');
    assert.equal(r.error, null);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

test('soft: a v2 run whose metered credits pass the limit mid-run is not killed', async () => {
  const s = setup({ credits: 3, lingerMs: 600, finalText: 'all done' }, { engine: 'v2', limit: 1, mode: 'soft' });
  try {
    const r = await s.run();
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.finalText, 'all done');
    assert.ok(r.flags.includes('creditLimitExceeded'), r.flags.join());
    assert.equal(r.creditOvershoot, 2);
    assert.match(r.creditLimitWarning, /per-run credit limit 1 passed at 3\.000 credits/);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

test('soft conversation: over the limit when a turn ends, the next turn still starts', async () => {
  const s = setup({ turns: [{ finalText: ASK, credits: 6 }, { finalText: 'Done.', credits: 2 }] }, { engine: 'v3', limit: 5, mode: 'soft', autonomy: true });
  try {
    const r = await s.run();
    assert.equal(fs.existsSync(s.started(2)), true, 'turn 2 was spawned');
    assert.equal(r.turns, 2);
    assert.equal(r.credits, 8);
    assert.ok(r.flags.includes('creditLimitExceeded'), r.flags.join());
    assert.equal(r.flags.includes('creditLimit'), false);
    assert.match(r.creditLimitWarning, /per-run credit limit 5 passed at 8\.000 credits/);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

test('soft: a run under the limit has no warning', async () => {
  const s = setup({ credits: 2, lingerMs: 300 }, { engine: 'v3', limit: 3, mode: 'soft' });
  try {
    const r = await s.run();
    assert.equal(r.status, 'success');
    assert.deepEqual(r.flags.filter((f) => /^creditLimit/.test(f)), []);
    assert.equal(r.creditLimitMode, 'soft');
    assert.equal('creditLimitWarning' in r, false);
  } finally { s.cleanup(); }
});
