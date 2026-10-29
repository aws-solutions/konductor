// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { runJudging } = require('../../judge/run.js');
const { buildBundle } = require('../../judge/bundle.js');
const { taskRevision } = require('../../judge/revision.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');

const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const ids = (prompt) => [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
const rubricReply = (prompt, per) => JSON.stringify({ criteria: ids(prompt).map((id) => ({ id, ...per[id] })) });

function stub(handler) {
  const calls = [];
  const fn = async ({ model, prompt }) => {
    calls.push({ model, prompt });
    const out = handler({ model, prompt, n: calls.length - 1 });
    return typeof out === 'string' ? { text: out, credits: 0.1, latencyMs: 10 } : { text: '', credits: 0, latencyMs: 10, ...out };
  };
  fn.calls = calls;
  return fn;
}

function fixture(specs = [{ arm: 'vanilla', finalText: 'The reservation is 7 days in REQ-3 and 5 in REQ-6.', files: { 'a.txt': 'fixed\n' } }]) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  const common = {
    runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
    limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  };
  return { root, bench, runDir, common };
}

test('an ellipsis quote whose pieces are in the output keeps the judge verdict', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub(({ prompt }) => rubricReply(prompt, {
      c1: { verdict: 'pass', evidence: 'The reservation is 7 days... 5 in REQ-6.' },
      c2: { verdict: 'pass', evidence: '**the** reservation   is 7 DAYS in REQ-3' },
    }));
    const j = await runJudging({ ...common, caller });
    const r = j.rubric[0];
    assert.deepEqual(r.criteria.map((c) => [c.verdictRaw, c.verdictScored, c.verdict, c.evidenceFound]), [['pass', 'pass', 'pass', true], ['pass', 'pass', 'pass', true]]);
    assert.equal(r.score, 1);
    assert.equal(r.scoreRaw, 1);
  } finally { rm(root); }
});

test('a fabricated quote and reordered segments are downgraded one level; raw and scored are both recorded', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub(({ prompt }) => rubricReply(prompt, {
      c1: { verdict: 'pass', evidence: 'The member is told by SMS, which the output never says.' },
      c2: { verdict: 'partial', evidence: '5 in REQ-6 ... The reservation is 7 days' },
    }));
    const j = await runJudging({ ...common, caller });
    const [c1, c2] = j.rubric[0].criteria;
    assert.deepEqual([c1.verdictRaw, c1.verdictScored, c1.evidenceDowngraded], ['pass', 'partial', true]);
    assert.deepEqual([c2.verdictRaw, c2.verdictScored, c2.evidenceDowngraded], ['partial', 'fail', true]);
    assert.equal(j.rubric[0].score, (1 * 0.5 + 3 * 0) / 4);
    assert.equal(j.rubric[0].scoreRaw, (1 * 1 + 3 * 0.5) / 4);
  } finally { rm(root); }
});

test('a fail verdict and a "(nothing in the output)" quote are never downgraded', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub(({ prompt }) => rubricReply(prompt, {
      c1: { verdict: 'fail', evidence: 'invented text that is not there at all' },
      c2: { verdict: 'pass', evidence: '(nothing in the output)' },
    }));
    const j = await runJudging({ ...common, caller });
    const [c1, c2] = j.rubric[0].criteria;
    assert.deepEqual([c1.verdictScored, c1.evidenceDowngraded], ['fail', undefined]);
    assert.deepEqual([c2.verdictScored, c2.evidenceFound, c2.evidenceDowngraded], ['pass', null, undefined]);
  } finally { rm(root); }
});

test('records carry the task revision, and it changes when the rubric wording changes', async () => {
  const { root, bench, common } = fixture();
  try {
    const task = () => loadTasks(bench).get('t1');
    const before = taskRevision(task());
    const j = await runJudging({ ...common, caller: stub(({ prompt }) => rubricReply(prompt, { c1: { verdict: 'pass', evidence: 'x' }, c2: { verdict: 'pass', evidence: 'x' } })) });
    assert.equal(j.rubric[0].taskRevision, before);
    const file = path.join(bench, 'tasks/t1.json');
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    t.rubric[0].criterion = 'A reworded first criterion.';
    write(file, JSON.stringify(t));
    assert.notEqual(taskRevision(task()), before);
  } finally { rm(root); }
});

test('a unit skipped by the budget does not replace an earlier record that has a result', async () => {
  const { root, common, runDir } = fixture();
  try {
    const ok = stub(({ prompt }) => rubricReply(prompt, { c1: { verdict: 'pass', evidence: 'x' }, c2: { verdict: 'pass', evidence: 'x' } }));
    await runJudging({ ...common, caller: ok });
    const rewording = path.join(common.benchDir, 'tasks/t1.json');
    const t = JSON.parse(fs.readFileSync(rewording, 'utf8'));
    t.rubric[1].criterion = 'Reworded so the cached call no longer applies.';
    write(rewording, JSON.stringify(t));
    const j = await runJudging({ ...common, budgetCredits: 0, caller: ok });
    assert.equal(j.rubric.length, 1);
    assert.equal(j.rubric[0].judgeError, null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'judgments.json'), 'utf8')).rubric[0].judgeError, null);
  } finally { rm(root); }
});

test('a record with a real judge error is still replaced by a later run', async () => {
  const { root, common } = fixture();
  try {
    await runJudging({ ...common, caller: stub(() => ({ error: 'timed out' })) });
    const j = await runJudging({ ...common, caller: stub(({ prompt }) => rubricReply(prompt, { c1: { verdict: 'pass', evidence: 'x' }, c2: { verdict: 'pass', evidence: 'x' } })) });
    assert.equal(j.rubric[0].judgeError, null);
  } finally { rm(root); }
});

test('under a budget cap every rubric call is made before any pairwise call', async () => {
  const { root, common } = fixture([
    { arm: 'vanilla', files: { 'a.txt': 'v\n' } }, { arm: 'v1.2.0', files: { 'a.txt': 'k\n' } },
  ]);
  try {
    const caller = stub(({ prompt }) => (prompt.includes('=== RESPONSE A ===') ? JSON.stringify({ winner: 'A', reason: 'r' }) : rubricReply(prompt, { c1: { verdict: 'pass', evidence: 'x' }, c2: { verdict: 'pass', evidence: 'x' } })));
    await runJudging({ ...common, modes: ['rubric', 'pairwise'], concurrency: 1, caller });
    const kinds = caller.calls.map((c) => (c.prompt.includes('=== RESPONSE A ===') ? 'pair' : 'rubric'));
    assert.deepEqual(kinds, ['rubric', 'rubric', 'pair', 'pair']);
  } finally { rm(root); }
});

test('the judge bundle keeps showing the run-time check results after a recheck', () => {
  const { root, bench, runDir } = fixture();
  try {
    const dir = path.join(runDir, 'vanilla/t1/1');
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
    const limits = { maxFileChars: 6000, maxBundleChars: 24000 };
    const args = { runDir: dir, fixtureDir: path.join(bench, 'fixtures/fx'), limits, redactions: compileRedactions(DEFAULT_REDACTIONS) };
    const failing = { ...result, checks: [{ type: 'file_exists', path: 'a.txt', passed: false, detail: 'missing' }] };
    const before = buildBundle({ ...args, result: failing }).text;
    const rechecked = { ...failing, checksOriginal: failing.checks, checks: [{ type: 'file_exists', path: 'a.txt', passed: true, detail: 'present' }] };
    assert.equal(buildBundle({ ...args, result: rechecked }).text, before);
  } finally { rm(root); }
});

test('the report shows scored and raw rubric scores per judge, the unverified-quote rate, and leaves out stale records', async () => {
  const { root, bench, common, runDir } = fixture();
  try {
    const caller = stub(({ prompt }) => rubricReply(prompt, {
      c1: { verdict: 'pass', evidence: 'never in the output' },
      c2: { verdict: 'pass', evidence: 'reservation is 7 days' },
    }));
    await runJudging({ ...common, caller });
    const report = () => buildReport({ run: loadRun(runDir), tasks: loadTasks(bench), baseline: 'vanilla' }).report;
    const c = report().arms.vanilla.overall.rubric;
    assert.equal(c.byJudge['gpt-test'].mean, (1 * 0.5 + 3 * 1) / 4);
    assert.equal(c.byJudge['gpt-test'].meanRaw, 1);
    assert.equal(report().judging.byJudge['gpt-test'].unverifiedQuoteRate, 0.5);
    const md = renderMarkdown(report());
    assert.match(md, /gpt-test 0\.88 \(raw 1\.00\)/);

    const file = path.join(bench, 'tasks/t1.json');
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    t.rubric[0].criterion = 'A reworded first criterion.';
    write(file, JSON.stringify(t));
    const stale = report();
    assert.equal(stale.arms.vanilla.overall.rubric.byJudge['gpt-test'].n, 0);
    assert.equal(stale.judging.stale.length, 1);
    assert.match(renderMarkdown(stale), /earlier version of the rubric/);
  } finally { rm(root); }
});
