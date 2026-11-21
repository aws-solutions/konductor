// SPDX-License-Identifier: Apache-2.0
'use strict';

// Paired fill (bench/docs/paired-fill.md): konductor-first pair order, the --fill-skipped pass, and budget_skipped
// runs shown as rows and unpaired pairs in the pilot table. Fake kiro-cli: no credits, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, mkResult } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { runAll, planRuns, makeLedger } = require('../lib/orchestrate.js');
const { openLedger, readLedger } = require('../lib/credit-ledger.js');
const { loadTasks } = require('../lib/tasks.js');
const { fillOpts } = require('../lib/run-cmd.js');
const { pilotRows, renderTable, unpaired, pairedRows, batchSummary } = require('../../scenarios/pilot-table.js');

const VAN = { id: 'vanilla', label: 'vanilla', vanilla: true };
const KON = { id: 'konductor', label: 'konductor', vanilla: false };
const TASKS = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

test('pair order konductor-first: every cell once, and each task runs its konductor arm before vanilla', () => {
  const plan = planRuns(TASKS, [VAN, KON], 2, 7);
  assert.equal(plan.length, 16);
  for (let i = 0; i < plan.length; i += 2) {
    assert.equal(plan[i].task, plan[i + 1].task);
    assert.equal(plan[i].replicate, plan[i + 1].replicate);
    assert.deepEqual([plan[i].arm.id, plan[i + 1].arm.id], ['konductor', 'vanilla']);
  }
  assert.deepEqual(planRuns(TASKS, [VAN, KON], 2, 7), plan, 'seeded: the same seed gives the same order');
});

test('pair order shuffle keeps the same cells in one seeded order; an unknown order is refused', () => {
  const key = (p) => p.map((c) => `${c.task.id}/${c.arm.id}/${c.replicate}`).sort();
  assert.deepEqual(key(planRuns(TASKS, [VAN, KON], 2, 7, 0, 'shuffle')), key(planRuns(TASKS, [VAN, KON], 2, 7)));
  assert.throws(() => planRuns(TASKS, [VAN], 1, 1, 0, 'vanilla-first'), /konductor-first or shuffle/);
});

test('a raised ledger budget lets the run it skipped start, and never lowers', () => {
  const led = makeLedger({ budgetCredits: 10, runsPerReplicate: 2 });
  led.add({ armId: 'x', credits: 6, creditsCensored: false });
  assert.equal(led.shouldSkip({ replicate: 1 }), true, '6 charged + 6 largest passes 10');
  led.raise(20);
  assert.equal(led.shouldSkip({ replicate: 1 }), false);
  led.raise(5);
  led.add({ armId: 'x', credits: 6, creditsCensored: false });
  assert.equal(led.shouldSkip({ replicate: 1 }), false, '12 + 6 fits 20: the budget stayed 20, not 5');
  led.add({ armId: 'x', credits: 6, creditsCensored: false });
  assert.equal(led.shouldSkip({ replicate: 1 }), true, '18 + 6 passes 20');
  const study = openLedger({ dir: tmp(), budget: 1 });
  study.raise(3);
  assert.equal(study.budget, 3);
  study.raise(2);
  assert.equal(study.budget, 3);
});

test('--fill-skipped and --pair-order are checked', () => {
  assert.deepEqual(fillOpts({}, 10), { pairOrder: 'konductor-first', fillBudget: null });
  assert.deepEqual(fillOpts({ 'fill-skipped': '40', 'pair-order': 'shuffle' }, 10), { pairOrder: 'shuffle', fillBudget: 40 });
  assert.throws(() => fillOpts({ 'fill-skipped': true }, null), /positive number/);
  assert.throws(() => fillOpts({ 'fill-skipped': '5' }, 10), /under the budget 10/);
  assert.throws(() => fillOpts({ 'pair-order': 'random' }, null), /--pair-order takes/);
});

function setup(cfg) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  for (const d of [probe, path.join(root, 'scratch'), path.join(root, 'watch')]) fs.mkdirSync(d);
  makeFakeKiro(bin, { dir: probe, ...cfg });
  fs.writeFileSync(path.join(root, 'data.sqlite3'), 'fake-auth');
  const outDir = path.join(root, 'out');
  const ctx = {
    config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir: path.join(root, 'scratch'), authDb: path.join(root, 'data.sqlite3'),
    envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null }, isolation: { mode: 'none' },
    tripwire: { roots: [{ dir: path.join(root, 'watch'), depth: 2 }], extraExcludes: [], absExclude: [path.join(root, 'scratch'), outDir] },
  };
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
  const go = (o) => runAll({ tasks: [...loadTasks(bench).values()], arms: [ARM], prepared: new Map(), prepErrors: new Map(), replicates: 3, parallel: 1, censoredFloor: 1, seed: 1, outDir, ctx, state: { results: [], spent: 0, charged: 0 }, log: () => {}, ...o });
  return { outDir, go, cleanup: () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); } };
}

test('--fill-skipped runs the budget_skipped cell again before the command ends, and keeps the skipped record aside', async () => {
  const s = setup({ credits: 0.5 });
  try {
    const { results, fill } = await s.go({ budgetCredits: 1.0, fillBudget: 2.0 });
    assert.equal(results.filter((r) => r.status === 'success').length, 3);
    assert.deepEqual(fill, { budget: 2, tried: 1, filled: 1, left: 0 });
    assert.equal(readLedger(s.outDir).entries.length, 3);
    const aside = fs.readdirSync(path.join(s.outDir, 'vanilla', 't1')).filter((d) => /\.resumed-1$/.test(d));
    assert.equal(aside.length, 1, 'the skipped cell kept as <rep>.resumed-1');
  } finally { s.cleanup(); }
});

test('without --fill-skipped the skipped cell stays skipped; a fill budget too small leaves it skipped and says so', async () => {
  const a = setup({ credits: 0.5 });
  try {
    const { results, fill } = await a.go({ budgetCredits: 1.0 });
    assert.equal(results.filter((r) => r.status === 'budget_skipped').length, 1);
    assert.equal(fill, null);
  } finally { a.cleanup(); }
  const b = setup({ credits: 0.5 });
  try {
    const { fill } = await b.go({ budgetCredits: 1.0, fillBudget: 1.0 });
    assert.deepEqual(fill, { budget: 1, tried: 1, filled: 0, left: 1 });
  } finally { b.cleanup(); }
});

const json = (o) => `${JSON.stringify(o, null, 1)}\n`;
function fakePairs(dir) {
  const put = (arm, task, o) => write(path.join(dir, arm, task, '1', 'result.json'), json(mkResult({ armId: arm, harness: 'kiro-cli', taskId: task, creditsCharged: 2, ...o })));
  put('konductor', 't9-a', {});
  put('vanilla', 't9-a', {});
  put('konductor', 't9-b', {});
  put('vanilla', 't9-b', { status: 'budget_skipped', error: 'budget headroom: charged 8 + largest run so far 4 would pass the budget 10', credits: null, creditsCharged: null, checks: [] });
}

test('a budget_skipped run is a visible row, a batch-summary count, and makes its pair unpaired', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'no-pack'));
  fakePairs(path.join(root, 'w'));
  const rows = pilotRows([path.join(root, 'w')], { packDir: path.join(root, 'no-pack') });
  const skipped = rows.find((r) => r.skipped);
  assert.equal(skipped.task, 't9-b');
  assert.equal(skipped.arm, 'vanilla');
  assert.match(skipped.flags.budget_skipped, /budget headroom/);
  assert.deepEqual(unpaired(rows), [{ task: 't9-b', rep: 1, ran: ['konductor'], skipped: ['vanilla'] }]);
  assert.deepEqual(pairedRows(rows).map((r) => `${r.task}/${r.arm}`), ['t9-a/konductor', 't9-a/vanilla']);
  const [b] = batchSummary(rows);
  assert.equal(b.runs, 3);
  assert.equal(b.skipped, 1);
  const md = renderTable(rows);
  assert.match(md, /\| t9-b \(not in the pack\) \| vanilla \| 1 \|.*\*\*budget_skipped\*\* \(budget headroom/);
  assert.match(md, /3 run\(s\), 6\.00 credits, and 1 budget_skipped \(never ran\)/);
  assert.match(md, /Unpaired, left out of paired analysis until filled .*t9-b #1 \(ran konductor; skipped vanilla\)/);
  assert.match(md, /\| t9 \| 3 \| 1 \| 2 \|/);
});
