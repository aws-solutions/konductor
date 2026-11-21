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
