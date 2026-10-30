// SPDX-License-Identifier: Apache-2.0
'use strict';

// Two small fixes from the first paired experiment: judge bundle limits that fit a design document, and a cap plan
// budget that does not let the headroom rule skip a cell.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeCapRepo, makeCapBench, entry, writeEntry, scratch } = require('./cap-helpers.js');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { planCap, budgetFor } = require('../../cap/plan.js');
const { OBSERVED } = require('../lib/pr-plan.js');
const { makeLedger } = require('../lib/orchestrate.js');
const { DEFAULTS, effectiveLimits } = require('../../judge/config.js');
const { runJudging } = require('../../judge/run.js');
const { buildBundle } = require('../../judge/bundle.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { loadTasks } = require('../lib/tasks.js');

// ---- judge bundle limits ----

test('the default judge limits hold a design document of about 2,100 words', () => {
  assert.equal(DEFAULTS.limits.maxFileChars, 16000);
  assert.equal(DEFAULTS.limits.maxBundleChars, 48000);
  const words2100 = 2100 * 7;
  assert.ok(words2100 < DEFAULTS.limits.maxFileChars, 'the longest document seen in the first paired experiment fits');
});

test('effectiveLimits: an explicit flag beats the task, the task beats the default', () => {
  const base = { maxFileChars: 16000, maxBundleChars: 48000 };
  assert.deepEqual(effectiveLimits({}, base), base);
  assert.deepEqual(effectiveLimits({ bundleLimits: { maxFileChars: 30000 } }, base), { maxFileChars: 30000, maxBundleChars: 48000 });
  assert.deepEqual(effectiveLimits({ bundleLimits: { maxFileChars: 30000, maxBundleChars: 90000 } }, base, { maxFileChars: true }), { maxFileChars: 16000, maxBundleChars: 90000 });
  assert.deepEqual(effectiveLimits(null, base), base);
});

test('a task with bundleLimits is judged on a longer file than the default allows', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const tf = path.join(bench, 'tasks', 't1.json');
    const task = JSON.parse(fs.readFileSync(tf, 'utf8'));
    const doc = `${'word '.repeat(4000)}END-OF-DOC\n`;
    const run = (limitTask, limits, explicit) => {
      fs.writeFileSync(tf, JSON.stringify(limitTask));
      const runDir = makeRun(path.join(root, `run-${Math.random().toString(36).slice(2)}`), bench, [{ arm: 'vanilla', files: { 'doc.md': doc } }]);
      const prompts = [];
      const caller = async ({ prompt }) => {
        prompts.push(prompt);
        const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
        return { text: JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'END-OF-DOC' })) }), credits: 0, latencyMs: 1 };
      };
      return runJudging({
        runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null, limits, explicitLimits: explicit,
        redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {}, caller,
      }).then((j) => ({ j, prompts }));
    };
    const tight = await run(task, { maxFileChars: 6000, maxBundleChars: 24000 });
    assert.equal(tight.j.rubric[0].truncatedFiles.length, 1, 'a 20 KB document is cut at 6000');
    const wide = await run({ ...task, bundleLimits: { maxFileChars: 30000, maxBundleChars: 60000 } }, { maxFileChars: 6000, maxBundleChars: 24000 });
    assert.deepEqual(wide.j.rubric[0].truncatedFiles, []);
    assert.match(wide.prompts[0], /END-OF-DOC/);
    const flagged = await run({ ...task, bundleLimits: { maxFileChars: 30000, maxBundleChars: 60000 } }, { maxFileChars: 6000, maxBundleChars: 24000 }, { maxFileChars: true, maxBundleChars: true });
    assert.equal(flagged.j.rubric[0].truncatedFiles.length, 1, 'an explicit flag wins over the task');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the task schema accepts bundleLimits and rejects unknown keys inside it', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const tf = path.join(bench, 'tasks', 't1.json');
    const task = JSON.parse(fs.readFileSync(tf, 'utf8'));
    fs.writeFileSync(tf, JSON.stringify({ ...task, bundleLimits: { maxFileChars: 20000 } }));
    assert.deepEqual(loadTasks(bench).get('t1').bundleLimits, { maxFileChars: 20000 });
    fs.writeFileSync(tf, JSON.stringify({ ...task, bundleLimits: { maxFiles: 3 } }));
    assert.throws(() => loadTasks(bench), /bundleLimits/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  assert.equal(typeof buildBundle, 'function');
});

// ---- cap plan budget ----

function setup() {
  const root = scratch();
  const r = makeCapRepo(root, { tag: 'v1.2.0' });
  const bench = makeCapBench(root);
  writeEntry(bench, entry());
  const plan = (o = {}) => planCap({ repoRoot: r.repo, benchDir: bench, scratch: path.join(root, 'scr'), now: new Date('2026-01-02T03:04:05Z'), tmpRoot: path.join(root, 'tmp'), ...o });
  return { plan, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const PER_CELL = OBSERVED.suites.lite.credits['v1.2.0'] / OBSERVED.suites.lite.tasks;
const TAIL = OBSERVED.tail.credits;

test('budgetFor takes the largest of 1.5x the estimate, estimate plus the tail, and a pass with one outlier before the last cell', () => {
  const b = budgetFor({ total: 10, cells: 5, tail: 8 });
  assert.equal(b.budget, Math.ceil(Math.max(15, 18, 10 - 4 + 16)));
  assert.equal(b.budget, 22);
  assert.match(b.why, /largest observed single run 8\.00/);
  assert.equal(budgetFor({ total: 100, cells: 10, tail: 5 }).budget, 150, 'the 1.5x term wins on a large plan');
  assert.equal(budgetFor({ total: 4, cells: 1, tail: 8 }).budget, 12, 'one cell: the estimate plus the tail');
});

test('a one-replicate A/A plan gets a budget that covers its estimate plus the tail', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', reps: 1 });
    const total = 3 * PER_CELL;
    assert.ok(p.budget >= total + TAIL, `${p.budget} < ${total + TAIL}`);
    assert.ok(p.budget > Math.ceil(total * 1.5), 'larger than the old 1.5x rule');
    assert.match(p.text, /Budget \d+: .*headroom rule/);
    assert.match(p.text, new RegExp(`--budget-credits ${p.budget}`));
  } finally { s.done(); }
});

test('replaying a plan with one 11-credit run in any position never skips a cell under the planned budget', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', reps: 1 });
    const cells = 3;
    for (let outlier = 0; outlier < cells; outlier++) {
      const ledger = makeLedger({ budgetCredits: p.budget, runsPerReplicate: cells });
      const skipped = [];
      for (let i = 0; i < cells; i++) {
        if (ledger.shouldSkip({ replicate: 1 })) { skipped.push(i); continue; }
        ledger.add({ armId: `a${i}`, credits: i === outlier ? TAIL : PER_CELL, creditsCensored: false });
      }
      assert.deepEqual(skipped, [], `outlier at position ${outlier}`);
    }
    const old = makeLedger({ budgetCredits: 25, runsPerReplicate: cells });
    old.add({ armId: 'a', credits: TAIL, creditsCensored: false });
    old.add({ armId: 'b', credits: PER_CELL, creditsCensored: false });
    assert.equal(old.shouldSkip({ replicate: 1 }), true, 'the budget of 25 used in the experiment does skip the third cell');
  } finally { s.done(); }
});

test('a budget given by the user below the safe minimum is kept and warned about', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', reps: 1, budgetCredits: 15 });
    assert.equal(p.budget, 15);
    assert.ok(p.warnings.some((w) => /below the 2\d credits/.test(w) && /headroom/.test(w)), p.warnings.join('\n'));
  } finally { s.done(); }
});
