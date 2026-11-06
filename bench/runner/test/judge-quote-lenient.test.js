// SPDX-License-Identifier: Apache-2.0
'use strict';

// The opt-in lenient evidence matcher, the offline rescoring command and the scoring-file key. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { makeQuoteMatcher } = require('../../judge/quote.js');
const { rescoreQuotes, readLenientJudgments, LENIENT_FILE } = require('../../judge/rescore.js');
const { loadScoring } = require('../../report/scores.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { loadRuns } = require('../../report/load.js');
const { generateRunReport } = require('../../report/generate.js');
const { loadTasks } = require('../lib/tasks.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

const BUNDLE = [
  '## Plan',
  '',
  '| ID | Task | Depends |',
  '|---|---|---|',
  '| T2 | Schema migration and backfill | T1 |',
  '| T5 | Reservation service with a per-title lock | T4 |',
  '',
  '- The migration is additive and idempotent, so the old version keeps working after it runs.',
  '- Out of scope, listed only as follow-up tickets: the SQL injection in searchByName.',
  '',
  'Fifty reserve requests fire at the same moment and exactly ten succeed.',
].join('\n');

const strict = makeQuoteMatcher(BUNDLE);
const lenient = makeQuoteMatcher(BUNDLE, { lenient: true });

// ---- accepted ----

test('a quote the default rule accepts is accepted by the lenient rule too', () => {
  for (const q of ['Schema migration and backfill', 'The migration is additive ... the old version keeps working', 'FIFTY reserve requests fire at the same moment']) {
    assert.equal(strict(q), true, q);
    assert.equal(lenient(q), true, q);
  }
});

test('class a: table pipes, list markers and escapes are ignored', () => {
  const quotes = [
    'T2 Schema migration and backfill T1',
    '| T5 | Reservation service with a per-title lock | T4 |',
    '- The migration is additive and idempotent, so the old version keeps working after it runs.',
    '\\- Out of scope, listed only as follow-up tickets: the SQL injection in searchByName.',
    '## Plan | ID | Task | Depends',
  ];
  for (const q of quotes) assert.equal(lenient(q), true, q);
  assert.equal(strict('T2 Schema migration and backfill T1'), false, 'the default rule keeps refusing a row with its pipes removed');
  assert.equal(strict('T5 Reservation service with a per-title lock T4'), false);
});

test('class b: verbatim fragments joined by a space, a new line or a semicolon, in order', () => {
  const joined = [
    'The migration is additive and idempotent Out of scope, listed only as follow-up tickets',
    'The migration is additive and idempotent, so the old version keeps working after it runs.\nOut of scope, listed only as follow-up tickets: the SQL injection in searchByName.',
    'Schema migration and backfill; Reservation service with a per-title lock',
    'Reservation service with a per-title lock | Fifty reserve requests fire at the same moment',
  ];
  for (const q of joined) assert.equal(lenient(q), true, q);
  assert.equal(strict(joined[0]), false);
});

test('class b2: a verbatim quoted sentence of 40 letters or more inside the judge\'s prose, with fewer than 20 unsupported letters', () => {
  const wrapped = [
    'The plan says "The migration is additive and idempotent, so the old version keeps working after it runs" fine.',
    'The text states \u201cFifty reserve requests fire at the same moment and exactly ten succeed\u201d.',
    'Evidence: `The migration is additive and idempotent, so the old version keeps working after it runs` appears.',
  ];
  for (const q of wrapped) assert.equal(lenient(q), true, q);
  for (const q of wrapped) assert.equal(strict(q), false, q);
});

test('class b2 with long prose around the span is refused since the tightening (20 or more unsupported letters)', () => {
  const chatty = [
    'The plan says "The migration is additive and idempotent, so the old version keeps working after it runs" which covers the trap.',
    'Evidence: `The migration is additive and idempotent, so the old version keeps working after it runs` appears, and the judge notes it is good for the trap they planted.',
  ];
  for (const q of chatty) assert.equal(lenient(q), false, q);
});

// ---- refused ----

test('a quote with a long fragment the output does not hold is still refused', () => {
  const invented = [
    'The migration is additive and idempotent Out of scope, listed only as follow-up tickets and also adds a caching layer for members',
    'The plan includes a rollback rehearsal for every release candidate before deploy',
    'Schema migration and backfill; Reservation service that retries failed holds every minute',
  ];
  for (const q of invented) assert.equal(lenient(q), false, q);
});

test('fragments out of the output\'s order are refused', () => {
  assert.equal(lenient('Out of scope, listed only as follow-up tickets; The migration is additive and idempotent'), false);
  assert.equal(lenient('Reservation service with a per-title lock | Schema migration and backfill'), false);
});

test('connectives alone, a short inner quote, and a quote mostly invented around a short true piece are refused', () => {
  assert.equal(lenient('migration ... lock ... backfill'), false, 'no fragment of 20 letters');
  assert.equal(lenient('The judge notes "Schema migration" and says everything about the plan is excellent and complete'), false, 'inner quote under 40 letters');
  assert.equal(lenient('Schema migration and backfill; the whole design is robust against every kind of failure that anyone could imagine happening'), false);
  assert.equal(lenient(''), false);
  assert.equal(lenient('...'), false);
});

// ---- rescoring, the scoring key and the report ----

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [
    { arm: 'vanilla', files: { 'a.txt': BUNDLE } },
    { arm: 'other', files: { 'a.txt': BUNDLE } },
  ]);
  const crit = (id, verdict, evidence) => ({ id, verdict, verdictRaw: verdict, verdictScored: verdict, evidence, evidenceFound: true });
  const downgraded = (id, raw, evidence) => ({ id, verdict: { pass: 'partial', partial: 'fail', fail: 'fail' }[raw], verdictRaw: raw, verdictScored: { pass: 'partial', partial: 'fail', fail: 'fail' }[raw], evidence, evidenceFound: false, ...(raw !== 'fail' ? { evidenceDowngraded: true } : {}) });
  const rec = (judge, arm, criteria, score) => ({ kind: 'rubric', judge, armId: arm, taskId: 't1', replicate: 1, taskRevision: null, score, scoreRaw: 1, criteria, judgeError: null, parseFailures: 0, calls: [{ credits: 0.1, latencyMs: 1, cached: false, ok: true }], redactionsFired: {} });
  const rubric = [
    // c1 weight 1, c2 weight 3. j1 pasted a table row with pipes; j2 quoted exactly; j3 invented.
    rec('j1', 'vanilla', [crit('c1', 'pass', 'x'), downgraded('c2', 'pass', 'T5 Reservation service with a per-title lock T4')], 0.625),
    rec('j2', 'vanilla', [crit('c1', 'pass', 'Schema migration and backfill'), crit('c2', 'pass', 'Fifty reserve requests fire')], 1),
    rec('j3', 'vanilla', [crit('c1', 'pass', 'Schema migration and backfill'), downgraded('c2', 'pass', 'The plan includes a rollback rehearsal for every release candidate before deploy')], 0.625),
    rec('j1', 'other', [crit('c1', 'pass', 'Schema migration and backfill'), crit('c2', 'pass', 'Schema migration and backfill')], 1),
  ];
  rubric[0].criteria[0] = { ...rubric[0].criteria[0], evidence: 'Schema migration and backfill' };
  write(path.join(runDir, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'vanilla', judges: ['j1', 'j2', 'j3'], modes: ['rubric'], limits: { maxFileChars: 6000, maxBundleChars: 24000 }, rubric, pairwise: [] }));
  return { root, bench, runDir };
}

const redactions = compileRedactions(DEFAULT_REDACTIONS);

test('rescoring recomputes verdicts and scores, writes a new file, and leaves judgments.json alone', () => {
  const s = setup();
  try {
    const before = fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8');
    const r = rescoreQuotes({ runDir: s.runDir, benchDir: s.bench, redactions });
    assert.equal(fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8'), before);
    assert.equal(r.file, path.join(s.runDir, LENIENT_FILE));
    assert.equal(r.changed, 1);
    assert.deepEqual([r.before.j1.downgraded, r.after.j1.downgraded], [1, 0], 'the pasted table row is found');
    assert.deepEqual([r.before.j3.downgraded, r.after.j3.downgraded], [1, 1], 'the invented quote is still lowered');
    assert.ok(Math.abs(r.after.j1.meanScore - 1) < 1e-9);
    assert.ok(Math.abs(r.armAfter.vanilla - (1 + 1 + 0.625) / 3) < 1e-9);
    const file = JSON.parse(fs.readFileSync(r.file, 'utf8'));
    assert.equal(file.quoteMatch.mode, 'lenient');
    const fixed = file.rubric.find((x) => x.judge === 'j1' && x.armId === 'vanilla');
    assert.equal(fixed.score, 1);
    assert.equal(fixed.criteria[1].verdict, 'pass');
    assert.equal(fixed.criteria[1].evidenceFound, true);
    assert.equal(fixed.criteria[1].evidenceDowngraded, undefined);
    assert.equal(fixed.criteria[1].verdictRaw, 'pass');
    assert.deepEqual(readLenientJudgments(s.runDir).rubric.length, 4);
  } finally { cleanup(s.root); }
});

test('a strict recheck reproduces the stored verdicts and writes nothing', () => {
  const s = setup();
  try {
    const r = rescoreQuotes({ runDir: s.runDir, benchDir: s.bench, redactions, mode: 'strict' });
    assert.equal(r.file, null);
    assert.equal(r.changed, 0);
    assert.deepEqual(r.before, r.after);
    assert.equal(fs.existsSync(path.join(s.runDir, LENIENT_FILE)), false);
    assert.throws(() => readLenientJudgments(s.runDir), /judge --rescore-quotes --run/);
    assert.throws(() => rescoreQuotes({ runDir: s.runDir, benchDir: s.bench, redactions, mode: 'loose' }), /lenient or strict/);
  } finally { cleanup(s.root); }
});

test('the scoring key "quotes" is off by default and refused where the lenient file is not read', () => {
  const root = tmp();
  try {
    const lenientFile = path.join(root, 'l.json');
    write(lenientFile, JSON.stringify({ weights: { hidden: 0.5, checks: 0.2, rubric: 0.3 }, quotes: 'lenient' }));
    const strictFile = path.join(root, 's.json');
    write(strictFile, JSON.stringify({ weights: { hidden: 0.5, checks: 0.2, rubric: 0.3 }, quotes: 'strict' }));
    const bad = path.join(root, 'b.json');
    write(bad, JSON.stringify({ weights: { rubric: 1 }, quotes: 'sloppy' }));
    assert.deepEqual(loadScoring(), loadScoring(strictFile), 'strict adds nothing to the loaded weights');
    assert.equal(loadScoring(lenientFile, { allowQuotes: true }).quoteMode, 'lenient');
    assert.throws(() => loadScoring(lenientFile), /read by report only/);
    assert.throws(() => loadScoring(bad), /"quotes" must be one of "strict", "lenient"/);
  } finally { cleanup(root); }
});

test('a report with the lenient key reads judgments-lenient.json, says so, and fails clearly without it', () => {
  const s = setup();
  try {
    const scoring = path.join(s.root, 'lenient.json');
    write(scoring, JSON.stringify({ weights: { hidden: 0.5, checks: 0.2, rubric: 0.3 }, quotes: 'lenient' }));
    const tasks = loadTasks(s.bench);
    const build = (scoringFile) => generateRunReport({ run: loadRuns([s.runDir]), tasks, baseline: 'vanilla', out: path.join(s.root, 'out'), detail: 'full', format: 'md', scoringFile, defaultDir: path.join(s.root, 'out') });
    assert.throws(() => build(scoring), /no judgments-lenient\.json/);
    rescoreQuotes({ runDir: s.runDir, benchDir: s.bench, redactions });
    build(scoring);
    const md = fs.readFileSync(path.join(s.root, 'out', 'report.md'), 'utf8');
    assert.match(md, /Quote matching: lenient\./);
    assert.match(md, /\| j1 \| 4 \| 1 \(25\.0%\) \| 0 \(0\.0%\) \|/);
    build(undefined);
    assert.doesNotMatch(fs.readFileSync(path.join(s.root, 'out', 'report.md'), 'utf8'), /Quote matching/);
  } finally { cleanup(s.root); }
});

test('judge --rescore-quotes runs from the command line and refuses options that would call a model', () => {
  const s = setup();
  try {
    const env = { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR };
    const ok = spawnSync(process.execPath, [BENCH_JS, 'judge', '--rescore-quotes', '--run', s.runDir, '--bench-dir', s.bench], { encoding: 'utf8', env });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^judge \| criteria \| downgraded before/);
    assert.match(ok.stdout, /1 rubric record\(s\) changed under lenient matching/);
    assert.ok(fs.existsSync(path.join(s.runDir, LENIENT_FILE)));
    const plan = spawnSync(process.execPath, [BENCH_JS, 'judge', '--rescore-quotes', '--plan', '--run', s.runDir, '--bench-dir', s.bench], { encoding: 'utf8', env });
    assert.notEqual(plan.status, 0);
    assert.match(plan.stderr, /--plan does not apply with --rescore-quotes/);
    const orphan = spawnSync(process.execPath, [BENCH_JS, 'judge', '--quote-match', 'lenient', '--run', s.runDir, '--bench-dir', s.bench], { encoding: 'utf8', env });
    assert.match(orphan.stderr, /--quote-match goes with --rescore-quotes/);
  } finally { cleanup(s.root); }
});
