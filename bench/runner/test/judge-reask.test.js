// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-149: a rubric reply that fails every expert: item without quoting the deliverable (blank, or "does not quote") is
// asked once more before its verdict counts. The re-ask is on the judge record and in the credit ledger, and starts only
// when its worst case (15 credits) still fits the spend guard. In-process, with a stub caller: no model, no bench.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { runJudging } = require('../../judge/run.js');
const { reaskReason } = require('../../judge/views.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

const PLAN = `# Rollout plan\n\n${'Context line for the plan. '.repeat(90)}\n\nRun 003_contract only after every host runs 3.0; it is the point of no return.\n`;
const QUOTE = 'Run 003_contract only after every host runs 3.0';
const KEY = { items: [{ id: 'contract', text: 'Names the step a rollback cannot undo.', source: 'x' }], weakAnswers: ['Roll back if needed.', 'Deploy then test.', 'It is safe.'] };

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const taskFile = path.join(bench, 'tasks', 't1.json');
  write(taskFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(taskFile, 'utf8')), rubric: [], expertKey: KEY }));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', files: { 'plan.md': PLAN } }]);
  const common = {
    runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
    limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  };
  return { root, runDir, common };
}

// The first reply is `first`; a prompt that carries the re-ask suffix gets the quoting reply.
const stub = (first, prompts = []) => async ({ prompt }) => {
  prompts.push(prompt);
  const again = /Your previous reply (gave|failed)/.test(prompt);
  const c = again ? { id: 'expert:contract', verdict: 'pass', evidence: QUOTE } : first;
  return { text: JSON.stringify({ criteria: [c] }), credits: 0.1, latencyMs: 1 };
};
const ledger = (dir) => fs.readFileSync(path.join(dir, 'credit-ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'judge');

test('reaskReason: blank and does-not-quote replies on a real deliverable, nothing for a judged or a short one', () => {
  const doc = 'x'.repeat(3000);
  const blank = { id: 'expert:a', verdict: 'fail', evidence: '(nothing in the output)' };
  const noQuote = { id: 'expert:b', verdict: 'fail', evidence: 'The output lists the gates but does not quote any passage stating them.' };
  assert.equal(reaskReason([blank], doc), 'blank');
  assert.equal(reaskReason([blank, noQuote], doc), 'does-not-quote');
  assert.equal(reaskReason([noQuote, { id: 'expert:c', verdict: 'partial', evidence: 'a quote' }], doc), null, 'one item judged');
  assert.equal(reaskReason([{ id: 'expert:d', verdict: 'fail', evidence: 'The plan sets no flag at all.' }], doc), null, 'a reasoned fail');
  assert.equal(reaskReason([blank], 'short'), null);
});

test('a blank reply is asked once more; the second verdict counts, both calls are recorded and paid', async () => {
  const s = setup();
  const prompts = [];
  try {
    const j = await runJudging({ ...s.common, caller: stub({ id: 'expert:contract', verdict: 'fail', evidence: '(nothing in the output)' }, prompts) });
    const rec = j.rubric[0];
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /Your previous reply gave "\(nothing in the output\)" for every expert: criterion/);
    assert.equal(rec.reask.reason, 'blank');
    assert.deepEqual(rec.reask.first, [{ id: 'expert:contract', verdict: 'fail', evidence: '(nothing in the output)' }]);
    assert.equal(rec.reask.still, null);
    assert.equal(rec.criteria[0].verdictRaw, 'pass');
    assert.equal(rec.score, 1);
    assert.equal(rec.blankExpert, undefined, 'the counted reply is not blank');
    assert.deepEqual(rec.calls.map((c) => Boolean(c.reask)), [false, true]);
    assert.equal(ledger(s.runDir).length, 2, 'the re-ask is a ledger line like any call');
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('a does-not-quote reply is asked once more', async () => {
  const s = setup();
  const prompts = [];
  try {
    const j = await runJudging({ ...s.common, caller: stub({ id: 'expert:contract', verdict: 'fail', evidence: 'It does not quote any passage naming the step.' }, prompts) });
    assert.equal(prompts.length, 2);
    assert.equal(j.rubric[0].reask.reason, 'does-not-quote');
    assert.equal(j.rubric[0].score, 1);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('no re-ask when its 15-credit worst case would pass the guard; the first verdict stands and the skip is recorded', async () => {
  const s = setup();
  const prompts = [];
  try {
    const j = await runJudging({ ...s.common, budgetCredits: 10, caller: stub({ id: 'expert:contract', verdict: 'fail', evidence: '(nothing in the output)' }, prompts) });
    const rec = j.rubric[0];
    assert.equal(prompts.length, 1);
    assert.equal(rec.reask.reason, 'blank');
    assert.match(rec.reask.skipped, /spend guard/);
    assert.equal(rec.score, 0);
    assert.equal(rec.blankExpert, true);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('a reply that quotes the deliverable is not asked again', async () => {
  const s = setup();
  const prompts = [];
  try {
    const j = await runJudging({ ...s.common, caller: stub({ id: 'expert:contract', verdict: 'pass', evidence: QUOTE }, prompts) });
    assert.equal(prompts.length, 1);
    assert.equal(j.rubric[0].reask, undefined);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

// LITE 2026-11-21: a pass or partial whose evidence is not in the output (often the rubric line itself) is asked once
// more, naming the criteria; evidence that still copies the criterion text is rejected (fail), not dropped one level.
const RUBRIC_TEXT = 'The plan names the step that is the point of no return and says when it may run.';
function setupRubric() {
  const s = setup();
  const taskFile = path.join(s.common.benchDir, 'tasks', 't1.json');
  write(taskFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(taskFile, 'utf8')), rubric: [{ id: 'gate', weight: 1, criterion: RUBRIC_TEXT }], expertKey: undefined }));
  return s;
}
const rubricStub = (first, second, prompts = []) => async ({ prompt }) => {
  prompts.push(prompt);
  const c = /does not appear in the output/.test(prompt) ? second : first;
  return { text: JSON.stringify({ criteria: [{ id: 'gate', ...c }] }), credits: 0.1, latencyMs: 1 };
};

test('a pass whose evidence copies the rubric is asked once more; a quoting second reply counts', async () => {
  const s = setupRubric();
  const prompts = [];
  try {
    const j = await runJudging({ ...s.common, reaskUnquoted: true, caller: rubricStub({ verdict: 'pass', evidence: RUBRIC_TEXT }, { verdict: 'pass', evidence: QUOTE }, prompts) });
    const rec = j.rubric[0];
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /evidence for gate that does not appear in the output\. For gate the evidence repeats the criterion's own wording/);
    assert.equal(rec.reask.reason, 'unquoted');
    assert.deepEqual(rec.reask.unquoted, [{ id: 'gate', copied: true }]);
    assert.equal(rec.reask.still, null);
    assert.equal(rec.score, 1);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('evidence that still copies the rubric after the re-ask is rejected as fail; other unquoted evidence drops one level', async () => {
  const s = setupRubric();
  try {
    const copy = await runJudging({ ...s.common, reaskUnquoted: true, caller: rubricStub({ verdict: 'pass', evidence: RUBRIC_TEXT }, { verdict: 'pass', evidence: RUBRIC_TEXT }) });
    const c = copy.rubric[0].criteria[0];
    assert.equal(copy.rubric[0].reask.still, 'unquoted');
    assert.equal(c.verdict, 'fail');
    assert.equal(c.rubricCopy, true);
    assert.equal(copy.rubric[0].score, 0);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  const s2 = setupRubric();
  try {
    const made = 'The rollout waits for all hosts on the new version before the irreversible migration step.';
    const other = await runJudging({ ...s2.common, reaskUnquoted: true, caller: rubricStub({ verdict: 'pass', evidence: made }, { verdict: 'pass', evidence: made }) });
    const c = other.rubric[0].criteria[0];
    assert.equal(c.verdict, 'partial');
    assert.equal(c.rubricCopy, undefined);
  } finally { fs.rmSync(s2.root, { recursive: true, force: true }); }
});

test('a fail verdict, or a pass that quotes the output, is not asked again', async () => {
  for (const first of [{ verdict: 'fail', evidence: 'No such step is named.' }, { verdict: 'pass', evidence: QUOTE }]) {
    const s = setupRubric();
    const prompts = [];
    try {
      const j = await runJudging({ ...s.common, reaskUnquoted: true, caller: rubricStub(first, null, prompts) });
      assert.equal(prompts.length, 1);
      assert.equal(j.rubric[0].reask, undefined);
    } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
  }
});

test('without reaskUnquoted a copied-rubric pass is one call and drops one level, as before', async () => {
  const s = setupRubric();
  const prompts = [];
  try {
    const j = await runJudging({ ...s.common, caller: rubricStub({ verdict: 'pass', evidence: RUBRIC_TEXT }, null, prompts) });
    assert.equal(prompts.length, 1);
    assert.equal(j.rubric[0].reask, undefined);
    assert.equal(j.rubric[0].criteria[0].verdict, 'partial');
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
