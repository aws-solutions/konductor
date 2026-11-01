// SPDX-License-Identifier: Apache-2.0
'use strict';

// runAll and runJudging write the study ledger. Fake kiro-cli and a fake judge: no credits, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { runAll } = require('../lib/orchestrate.js');
const { loadTasks } = require('../lib/tasks.js');
const { readLedger, LEDGER_FILE } = require('../lib/credit-ledger.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };

function setup(cfg = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, ...cfg });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const outDir = path.join(root, 'out');
  const ctx = {
    config: CONFIG, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, outDir] },
  };
  const tasks = [...loadTasks(bench).values()];
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  const cleanup = () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); };
  return { root, ctx, tasks, outDir, cleanup };
}

const go = (s, o) => runAll({ tasks: s.tasks, arms: [ARM], prepared: new Map(), prepErrors: new Map(), replicates: 3, parallel: 1, budgetCredits: null, censoredFloor: 1, seed: 1, outDir: s.outDir, ctx: s.ctx, state: { results: [], spent: 0, charged: 0 }, log: () => {}, ...o });

test('every executed run appends one ledger line with its arm, task, replicate and credits', async () => {
  const s = setup({ credits: 0.5 });
  try {
    await go(s);
    const led = readLedger(s.outDir);
    assert.equal(led.entries.length, 3);
    assert.ok(led.entries.every((e) => e.kind === 'run' && e.arm === 'vanilla' && e.task === 't1' && e.credits === 0.5 && e.charged === 0.5));
    assert.deepEqual(led.entries.map((e) => e.replicate).sort(), [1, 2, 3]);
    assert.equal(led.totals.total, 1.5);
    assert.equal(path.basename(led.file), LEDGER_FILE);
  } finally { s.cleanup(); }
});

test('with no cap set nothing is stopped, however much the runs cost', async () => {
  const s = setup({ credits: 400 });
  try {
    const { results } = await go(s);
    assert.ok(results.every((r) => r.status === 'success'));
    assert.equal(readLedger(s.outDir).totals.total, 1200);
  } finally { s.cleanup(); }
});

test('a budget stops new runs at 90% and records why', async () => {
  const s = setup({ credits: 0.5 });
  try {
    const { results } = await go(s, { budgetCredits: 1.0 });
    const skipped = results.filter((r) => r.status === 'budget_skipped');
    assert.equal(skipped.length, 1, 'two runs reach 1.0 of 1.0, the third never starts');
    assert.equal(results.filter((r) => r.status === 'success').length, 2);
    assert.match(JSON.stringify(skipped[0]), /credit guard|budget/);
    assert.equal(readLedger(s.outDir).entries.length, 2, 'a skipped run costs nothing and is not a ledger line');
  } finally { s.cleanup(); }
});

test('the running total is logged after each run', async () => {
  const s = setup({ credits: 0.5 });
  try {
    const logs = [];
    await go(s, { log: (m) => logs.push(m) });
    assert.ok(logs.some((m) => /credits: this command 1\.00 \(no cap\), study total 1\.00 \(runs 1\.00, judge 0\.00\)/.test(m)), logs.join('\n'));
    assert.ok(logs.some((m) => /study total 1\.50/.test(m)));
  } finally { s.cleanup(); }
});

test('a run that takes the study past 100% of the budget is a hard stop: the result says so and no further run starts', async () => {
  const s = setup({ credits: 5 });
  try {
    const { results, guard } = await go(s, { budgetCredits: 1.0 });
    assert.equal(guard, 'hard');
    assert.equal(results.filter((r) => r.status === 'success').length, 1);
    assert.equal(results.filter((r) => r.status === 'budget_skipped').length, 2);
  } finally { s.cleanup(); }
});

test('a stop at 90% that does not overshoot is not a hard stop, and with no budget the guard is ok', async () => {
  const s = setup({ credits: 0.32 });
  try {
    assert.equal((await go(s, { budgetCredits: 1.0 })).guard, 'stop', 'three runs of 0.32 end at 96% of 1.0');
  } finally { s.cleanup(); }
  const t = setup({ credits: 0.5 });
  try {
    assert.equal((await go(t)).guard, 'ok');
  } finally { t.cleanup(); }
});

test('the 90% stop is its own rule: small runs stop at 90% of the budget, where the older headroom rule would let them go on', async () => {
  const s = setup({ credits: 0.04 });
  try {
    const { results, guard } = await runAll({ tasks: s.tasks, arms: [ARM], prepared: new Map(), prepErrors: new Map(), replicates: 30, parallel: 1, budgetCredits: 1.0, censoredFloor: 1, seed: 1, outDir: s.outDir, ctx: s.ctx, state: { results: [], spent: 0, charged: 0 }, log: () => {} });
    assert.equal(results.filter((r) => r.status === 'success').length, 23, '22 runs end at 0.88, the 23rd at 0.92, which is past 90%');
    assert.equal(guard, 'stop');
    assert.match(JSON.stringify(results.find((r) => r.status === 'budget_skipped')), /90% of the 1-credit guard/);
  } finally { s.cleanup(); }
});

test('engine v3: a ledger line carries the credits read from the turn summary, not null', async () => {
  const s = setup({ credits: 2.5 });
  s.ctx.config = { ...CONFIG, agentEngine: 'v3' };
  try {
    const { results } = await go(s, { replicates: 1 });
    assert.equal(results[0].credits, 2.5);
    const [entry] = readLedger(s.outDir).entries;
    assert.deepEqual({ kind: entry.kind, credits: entry.credits, charged: entry.charged, censored: entry.censored }, { kind: 'run', credits: 2.5, charged: 2.5, censored: false });
  } finally { s.cleanup(); }
});
