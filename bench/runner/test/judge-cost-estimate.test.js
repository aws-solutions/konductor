// SPDX-License-Identifier: Apache-2.0
'use strict';

// The judge --plan estimate: the run directory's own earlier spend first, then the shipped observed costs, then unknown.
// Everything runs in this process; nothing here starts the CLI or a model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { runJudging, planJudging, estimateSpend } = require('../../judge/run.js');
const { describePackPlan } = require('../../judge/packrun.js');
const { loadPack } = require('../../judge/pack/index.js');
const { loadTasks } = require('../lib/tasks.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { loadObserved, lookup, estimateFromObserved, FILE } = require('../../judge/observed-cost.js');
const { cmdJudge } = require('../eval-commands.js');
const { loadRun } = require('../../report/load.js');

const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });
const LIMITS = { maxFileChars: 6000, maxBundleChars: 24000 };

const DATA = {
  schemaVersion: 1,
  measuredOn: '2026-01-01',
  entries: [
    { backend: 'opencode', judge: 'glm-5', kind: 'rubric', liveCalls: 100, mean: 0.01, p90: 0.02 },
    { backend: 'opencode', judge: '*', kind: 'rubric', liveCalls: 400, mean: 0.004, p90: 0.008 },
    { backend: 'opencode', judge: '*', kind: '*', liveCalls: 900, mean: 0.006, p90: 0.012 },
    { backend: 'kiro', judge: '*', kind: '*', liveCalls: 50, mean: 0.2, p90: null },
  ],
};

test('lookup takes the exact entry, then the pooled judge for the pass, then the pooled backend', () => {
  assert.equal(lookup(DATA, 'opencode', 'glm-5', 'rubric').mean, 0.01);
  assert.equal(lookup(DATA, 'opencode', 'new-judge', 'rubric').mean, 0.004);
  assert.equal(lookup(DATA, 'opencode', 'glm-5', 'pairwise').mean, 0.006);
  assert.equal(lookup(DATA, 'kiro', 'x', 'pack').mean, 0.2);
  assert.equal(lookup({ entries: [] }, 'kiro', 'x', 'pack'), null);
});

test('low is the mean total and high the p90 total; a missing p90 leaves high unknown', () => {
  const e = estimateFromObserved(DATA, 'opencode', [{ judge: 'glm-5', kind: 'rubric', live: 10 }, { judge: 'other', kind: 'rubric', live: 5 }]);
  assert.ok(Math.abs(e.low - (0.1 + 0.02)) < 1e-12);
  assert.ok(Math.abs(e.high - (0.2 + 0.04)) < 1e-12);
  assert.equal(e.observedCalls, 400);
  assert.equal(estimateFromObserved(DATA, 'kiro', [{ judge: 'a', kind: 'rubric', live: 3 }]).high, null);
  assert.equal(estimateFromObserved(DATA, 'nobackend', [{ judge: 'a', kind: 'rubric', live: 3 }]), null);
  assert.equal(estimateFromObserved(null, 'kiro', [{ judge: 'a', kind: 'rubric', live: 3 }]), null);
});

test('estimateSpend: own history wins over the data, the data comes next, then unknown', () => {
  const units = [{ judge: 'glm-5', kind: 'rubric', live: 10 }];
  const fromData = estimateSpend({ judgments: null, usdMode: true, liveCalls: 10, liveUnits: units, observed: DATA });
  assert.equal(fromData.source, 'observed');
  assert.ok(Math.abs(fromData.low - 0.1) < 1e-12 && Math.abs(fromData.high - 0.2) < 1e-12);
  assert.match(fromData.basis, /observed spend in 100 live calls of earlier studies \(measured 2026-01-01\)/);
  const history = { invocations: [{ calls: 12, cachedCalls: 2, spentUsd: 0.5 }] };
  const own = estimateSpend({ judgments: history, usdMode: true, liveCalls: 10, liveUnits: units, observed: DATA });
  assert.equal(own.source, 'history');
  assert.ok(Math.abs(own.low - 0.5) < 1e-12);
  assert.ok(Math.abs(own.high - 1) < 1e-12, 'the data p90 to mean ratio (2) spreads the directory mean');
  const none = estimateSpend({ judgments: null, usdMode: true, liveCalls: 10, liveUnits: units, observed: null });
  assert.equal(none.total, null);
  assert.match(none.basis, /^unknown: /);
  assert.equal(estimateSpend({ judgments: null, usdMode: true, liveCalls: 0, observed: null }).total, 0);
});

test('the shipped data file loads, is in order, and carries no host path or internal name', () => {
  const d = loadObserved();
  assert.equal(d.schemaVersion, 1);
  assert.match(d.measuredOn, /^\d{4}-\d{2}-\d{2}$/);
  for (const e of d.entries) {
    assert.ok(e.liveCalls > 0 && e.mean > 0, JSON.stringify(e));
    if (e.p90 !== null) assert.ok(e.p90 >= e.median && e.p90 >= e.mean * 0.9, JSON.stringify(e));
  }
  for (const be of ['kiro', 'opencode']) assert.ok(lookup(d, be, 'any-judge', 'rubric'), be);
  assert.doesNotMatch(fs.readFileSync(FILE, 'utf8'), /\/var\/tmp|\/tmp\/|\/home\//);
  assert.equal(loadObserved(path.join(path.dirname(FILE), 'no-such-file.json')), null);
});

// ---- a real run directory ----

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const t1 = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  fs.writeFileSync(path.join(bench, 'tasks/d1.json'), JSON.stringify({ ...t1, id: 'd1', class: 'design', prompt: 'Write a design for the hold service.' }));
  const design = '# Hold service design\n\nThis document says how holds work.\n\n## Testing\n\nTwo returns at once: exactly one hold becomes reserved.\n';
  const runDir = makeRun(path.join(root, 'run'), bench, ['vanilla', 'other'].map((arm) => ({ arm, task: 'd1', finalText: `${arm} done`, files: { 'a.txt': `fixed by ${arm}\n`, 'docs/design.md': design } })), { taskIds: ['d1'] });
  return { root, bench, runDir };
}

const optsOf = (s, judges, extra = {}) => ({ runDir: s.runDir, benchDir: s.bench, judges, modes: ['rubric'], baseline: 'vanilla', limits: LIMITS, redactions: compileRedactions(DEFAULT_REDACTIONS), ...extra });

test('a plan with no earlier judging uses the data file, per judge and pass, and calls no backend', () => {
  const s = setup();
  try {
    const judges = ['gpt-5.6-luna', 'glm-5'];
    const d = planJudging(optsOf(s, judges, { backend: 'opencode', modes: ['rubric', 'pairwise'], caller: () => { throw new Error('backend called'); } }));
    assert.equal(d.estimate.source, 'observed');
    const data = loadObserved();
    const want = judges.reduce((t, j) => t + 2 * lookup(data, 'opencode', j, 'rubric').mean + 2 * lookup(data, 'opencode', j, 'pairwise').mean, 0);
    assert.ok(Math.abs(d.estimate.low - want) < 1e-9, `${d.estimate.low} vs ${want}`);
    assert.ok(d.estimate.high > d.estimate.low);
    const pack = describePackPlan({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), benchDir: s.bench, limits: LIMITS, redactions: compileRedactions(DEFAULT_REDACTIONS), thePack: loadPack('quality'), judges, backend: 'opencode' });
    assert.equal(pack.estimate.source, 'observed');
    assert.ok(pack.estimate.low > 0 && pack.estimate.high > pack.estimate.low);
    assert.equal(fs.existsSync(path.join(s.runDir, 'judgments.json')), false);
  } finally { cleanup(s.root); }
});

test('a plan after earlier judging uses that directory\'s own mean, whatever the data file says', async () => {
  const s = setup();
  try {
    const caller = async ({ prompt }) => {
      const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
      return { text: JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) }), credits: 0.5, latencyMs: 1 };
    };
    const o = { ...optsOf(s, ['gpt-test']), concurrency: 1, budgetCredits: null, log: () => {} };
    await runJudging({ ...o, caller });
    const more = planJudging({ ...o, judges: ['gpt-test', 'deepseek-test'] });
    assert.equal(more.estimate.source, 'history');
    assert.ok(Math.abs(more.estimate.perCall - 0.5) < 1e-9);
    assert.ok(Math.abs(more.estimate.total - 1) < 1e-9);
    assert.match(more.estimate.basis, /this directory's earlier judging/);
  } finally { cleanup(s.root); }
});

// ---- the printed plan ----

async function printedPlan(s, extra) {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await cmdJudge({ run: s.runDir, 'bench-dir': s.bench, mode: 'rubric', plan: true, ...extra }); } finally { console.log = log; }
  return lines.join('\n');
}

test('judge --plan prints low and high with their source, and writes nothing', async () => {
  const s = setup();
  try {
    const marker = path.join(s.root, 'called');
    const script = path.join(s.root, 'never.js');
    fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`);
    const oc = await printedPlan(s, { judges: 'deepseek-3.2,glm-5,gpt-5.6-luna', 'judge-backend': 'opencode', 'aws-creds-file': path.join(s.root, 'none') });
    assert.match(oc, /estimated spend: low \$0\.\d{4} USD \(mean\), high \$0\.\d{4} USD \(every call at its p90, an upper bound\) for 6 live call\(s\), from observed spend in \d+ live calls of earlier studies \(measured \d{4}-\d{2}-\d{2}\)/);
    assert.match(oc, /nothing was called and nothing was written/);
    const kiro = await printedPlan(s, { judges: 'gpt-test,deepseek-test,glm-test', 'judge-cmd': `${process.execPath} ${script}` });
    assert.match(kiro, /estimated spend: about \d+\.\d\d credits for 6 live call\(s\) at \d\.\d\d credits each, from observed spend in \d+ live calls.*no spread is known/);
    assert.equal(fs.existsSync(marker), false, 'the judge command ran');
    for (const f of ['judgments.json', 'judgments-quality.json', 'judge']) assert.equal(fs.existsSync(path.join(s.runDir, f)), false, f);
  } finally { cleanup(s.root); }
});
