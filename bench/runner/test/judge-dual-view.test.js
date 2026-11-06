// SPDX-License-Identifier: Apache-2.0
'use strict';

// judge records the verdict under both evidence-quote rules for every criterion; older judgments get their lenient view
// built from the saved output. In-process, with a stub caller: no model, no bench.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { runJudging } = require('../../judge/run.js');
const { viewJudgments, hasViews } = require('../../judge/views.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');

const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

const BUNDLE = [
  '| ID | Task | Depends |',
  '|---|---|---|',
  '| T2 | Schema migration and backfill | T1 |',
  '| T5 | Reservation service with a per-title lock | T4 |',
  '',
  'Fifty reserve requests fire at the same moment and exactly ten succeed.',
].join('\n');

const PIPE_FREE_ROW = 'T5 Reservation service with a per-title lock T4'; // lenient finds it, strict does not
const EXACT = 'Fifty reserve requests fire at the same moment';
const INVENTED = 'The plan includes a rollback rehearsal for every release candidate before deploy'; // neither finds it

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', files: { 'a.txt': BUNDLE } }]);
  const common = {
    runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
    limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  };
  return { root, bench, runDir, common };
}

// c1 (weight 1) quotes exactly; c2 (weight 3) quotes evidence the caller picks.
const caller = (evidence2, verdict = 'pass') => async () => ({
  text: JSON.stringify({ criteria: [{ id: 'c1', verdict: 'pass', evidence: EXACT }, { id: 'c2', verdict, evidence: evidence2 }] }), credits: 0.1, latencyMs: 1,
});

test('judge records both rules per criterion; the old fields carry the default (lenient)', async () => {
  const s = setup();
  try {
    const j = await runJudging({ ...s.common, caller: caller(PIPE_FREE_ROW) });
    const rec = j.rubric[0];
    const [c1, c2] = rec.criteria;
    assert.deepEqual(c1.quoteFound, { strict: true, lenient: true });
    assert.deepEqual(c2.quoteFound, { strict: false, lenient: true });
    assert.equal(c2.verdictRaw, 'pass');
    assert.equal(c2.verdictStrict, 'partial');
    assert.equal(c2.verdictLenient, 'pass');
    assert.equal(c2.verdict, 'pass', 'the old field holds the default rule');
    assert.equal(c2.evidenceFound, true);
    assert.equal(c2.evidenceDowngraded, undefined);
    assert.equal(rec.quoteRule, 'lenient');
    assert.equal(rec.scoreLenient, 1);
    assert.equal(rec.scoreStrict, (1 + 3 * 0.5) / 4);
    assert.equal(rec.score, rec.scoreLenient);
    assert.equal(rec.scoreRaw, 1);
    assert.ok(hasViews(rec));
    const onDisk = JSON.parse(fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8'));
    assert.deepEqual(onDisk.rubric[0].criteria[1].quoteFound, { strict: false, lenient: true });
  } finally { cleanup(s.root); }
});

test('an invented quote is lowered under both rules and an exact quote is found under both', async () => {
  const s = setup();
  try {
    const j = await runJudging({ ...s.common, caller: caller(INVENTED) });
    const [c1, c2] = j.rubric[0].criteria;
    assert.deepEqual(c1.quoteFound, { strict: true, lenient: true });
    assert.deepEqual(c2.quoteFound, { strict: false, lenient: false });
    assert.deepEqual([c2.verdictStrict, c2.verdictLenient, c2.verdict], ['partial', 'partial', 'partial']);
    assert.equal(c2.evidenceDowngraded, true);
    assert.equal(j.rubric[0].scoreStrict, j.rubric[0].scoreLenient);
  } finally { cleanup(s.root); }
});

test('"(nothing in the output)" drops a pass under both rules; a fail stays a fail', async () => {
  const s = setup();
  try {
    const j = await runJudging({ ...s.common, caller: caller('(nothing in the output)') });
    const c2 = j.rubric[0].criteria[1];
    assert.deepEqual([c2.verdictStrict, c2.verdictLenient], ['partial', 'partial']);
  } finally { cleanup(s.root); }
  const t = setup(); // a fresh directory: replies are cached by prompt
  try {
    const k = await runJudging({ ...t.common, caller: caller(INVENTED, 'fail') });
    const f2 = k.rubric[0].criteria[1];
    assert.deepEqual([f2.verdictStrict, f2.verdictLenient, f2.evidenceDowngraded], ['fail', 'fail', undefined]);
  } finally { cleanup(t.root); }
});

test('--quote-match strict makes the old fields strict while both views are still recorded', async () => {
  const s = setup();
  try {
    const j = await runJudging({ ...s.common, quoteRule: 'strict', caller: caller(PIPE_FREE_ROW) });
    const rec = j.rubric[0];
    const c2 = rec.criteria[1];
    assert.equal(rec.quoteRule, 'strict');
    assert.equal(c2.verdict, 'partial');
    assert.equal(c2.evidenceFound, false);
    assert.equal(c2.evidenceDowngraded, true);
    assert.equal(rec.score, rec.scoreStrict);
    assert.equal(c2.verdictLenient, 'pass');
    await assert.rejects(() => runJudging({ ...s.common, quoteRule: 'loose', caller: caller(PIPE_FREE_ROW) }), /--quote-match takes strict or lenient/);
  } finally { cleanup(s.root); }
});

test('viewJudgments switches a record with both views to either rule without touching the stored file', async () => {
  const s = setup();
  try {
    await runJudging({ ...s.common, caller: caller(PIPE_FREE_ROW) });
    const before = fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8');
    const run = loadRun(s.runDir);
    const tasks = loadTasks(s.bench);
    const strict = viewJudgments(run, 'strict', { tasks });
    const lenient = viewJudgments(run, 'lenient', { tasks });
    assert.equal(strict.switched, 1);
    assert.equal(strict.judgments.rubric[0].criteria[1].verdict, 'partial');
    assert.equal(strict.judgments.rubric[0].criteria[1].evidenceDowngraded, true);
    assert.equal(strict.judgments.rubric[0].score, run.judgments.rubric[0].scoreStrict);
    assert.equal(lenient.judgments.rubric[0].criteria[1].verdict, 'pass');
    assert.equal(lenient.judgments.rubric[0].criteria[1].evidenceDowngraded, undefined);
    assert.equal(lenient.missing, 0);
    assert.equal(fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8'), before);
  } finally { cleanup(s.root); }
});

// Records from before the dual view: strict values in the old fields, nothing else.
function writeOldJudgments(runDir) {
  const crit = (id, evidence, found) => ({ id, verdict: found ? 'pass' : 'partial', verdictRaw: 'pass', verdictScored: found ? 'pass' : 'partial', evidence, evidenceFound: found, ...(found ? {} : { evidenceDowngraded: true }) });
  const rec = { kind: 'rubric', judge: 'j1', armId: 'vanilla', taskId: 't1', replicate: 1, taskRevision: null, score: (1 + 3 * 0.5) / 4, scoreRaw: 1, criteria: [crit('c1', EXACT, true), crit('c2', PIPE_FREE_ROW, false)], judgeError: null, parseFailures: 0, calls: [], redactionsFired: {} };
  write(path.join(runDir, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'vanilla', judges: ['j1'], modes: ['rubric'], limits: { maxFileChars: 6000, maxBundleChars: 24000 }, rubric: [rec], pairwise: [] }));
}

test('an old record is strict as stored and gets its lenient view built from the saved output', () => {
  const s = setup();
  try {
    writeOldJudgments(s.runDir);
    const stored = fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8');
    const run = loadRun(s.runDir);
    const tasks = loadTasks(s.bench);
    const strict = viewJudgments(run, 'strict', { tasks });
    assert.deepEqual(strict.judgments.rubric[0], run.judgments.rubric[0], 'strict is the record as stored');
    const lenient = viewJudgments(run, 'lenient', { tasks });
    assert.equal(lenient.rebuilt, 1);
    assert.equal(lenient.missing, 0);
    assert.equal(lenient.judgments.rubric[0].criteria[1].verdict, 'pass');
    assert.equal(lenient.judgments.rubric[0].score, 1);
    assert.equal(fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8'), stored, 'judgments.json is not written');
    assert.equal(fs.existsSync(path.join(s.runDir, 'judgments-lenient.json')), false, 'no extra file is written');
  } finally { cleanup(s.root); }
});

test('when the output cannot be rebuilt the old record stays strict and is counted, not thrown', () => {
  const s = setup();
  try {
    writeOldJudgments(s.runDir);
    fs.rmSync(path.join(s.runDir, 'vanilla', 't1', '1', 'workspace'), { recursive: true, force: true });
    const run = loadRun(s.runDir);
    const tasks = loadTasks(s.bench);
    const lenient = viewJudgments(run, 'lenient', { tasks });
    assert.equal(lenient.missing + lenient.rebuilt, 1);
    if (lenient.missing) {
      assert.equal(lenient.rule, 'strict', 'nothing could be rebuilt, so the view is strict');
      assert.equal(lenient.judgments.rubric[0].criteria[1].verdict, 'partial');
    }
    const noTasks = viewJudgments(run, 'lenient', { tasks: new Map() });
    assert.equal(noTasks.missing, 1);
    assert.equal(noTasks.rule, 'strict');
  } finally { cleanup(s.root); }
});
