// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden acceptance tests: the `tests` check, the scratch overlay, partial scores and their plumbing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { runChecks } = require('../lib/checks.js');
const { parseNodeTestSummary, aggregateHidden } = require('../lib/check-matcher.js');
const { loadTasks, loadSuite, benchMask } = require('../lib/tasks.js');
const { validate, loadSchema } = require('../lib/schema.js');
const { buildResult, validateResult } = require('../lib/result.js');
const { recheckAll } = require('../lib/recheck.js');
const { buildBundle } = require('../../judge/bundle.js');
const { loadRun } = require('../../report/load.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');

const TAP = '1..2\n# tests 7\n# suites 1\n# pass 5\n# fail 1\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 77.4\n';
const SPEC = 'ℹ tests 7\nℹ suites 1\nℹ pass 5\nℹ fail 1\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\nℹ duration_ms 77.4\n';

const T = (name, body) => `require('node:test').test(${JSON.stringify(name)}, () => { ${body} });\n`;

// A workspace with a module and a hidden overlay of `n` passing tests plus `bad` failing ones.
function setup({ good = 3, bad = 0, workspace = {} } = {}) {
  const root = tmp();
  const ws = path.join(root, 'ws');
  const hidden = path.join(root, 'hidden-src');
  write(path.join(ws, 'src/lib.js'), 'module.exports = { one: () => 1 };\n');
  for (const [f, t] of Object.entries(workspace)) write(path.join(ws, f), t);
  const body = [];
  for (let i = 0; i < good; i++) body.push(T(`good ${i}`, "require('node:assert').equal(require('../src/lib.js').one(), 1);"));
  for (let i = 0; i < bad; i++) body.push(T(`bad ${i}`, "require('node:assert').equal(require('../src/lib.js').one(), 2);"));
  write(path.join(hidden, 'hidden/a.test.js'), body.join(''));
  return { root, ws, hidden, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const check = (extra = {}) => ({ type: 'tests', cmd: 'node --test hidden/*.test.js', ...extra });

test('parseNodeTestSummary reads TAP and spec summaries', () => {
  assert.deepEqual(parseNodeTestSummary(TAP), { passed: 5, total: 7 });
  assert.deepEqual(parseNodeTestSummary(SPEC), { passed: 5, total: 7 });
  assert.equal(parseNodeTestSummary('boom\n'), null);
  assert.equal(parseNodeTestSummary('# tests 3\n'), null, 'a summary without a pass line is not trusted');
});

test('aggregateHidden sums tests checks and ignores the rest', () => {
  assert.equal(aggregateHidden([{ type: 'cmd', passed: true }]), null);
  assert.equal(aggregateHidden([]), null);
  assert.deepEqual(aggregateHidden([
    { type: 'tests', tests: { passed: 3, total: 4 } },
    { type: 'tests', tests: { passed: 0, total: 6, unparsed: true } },
    { type: 'cmd' },
  ]), { passed: 3, total: 10, unparsed: true });
  assert.deepEqual(aggregateHidden([{ type: 'tests', tests: { passed: 2, total: 2 } }]), { passed: 2, total: 2, unparsed: false });
});

test('tests check passes only when every hidden test passes and records the counts', () => {
  const s = setup({ good: 3 });
  try {
    const [r] = runChecks(s.ws, [check({ min: 3 })], { hiddenDir: s.hidden });
    assert.equal(r.passed, true);
    assert.deepEqual(r.tests, { passed: 3, total: 3, unparsed: false });
    assert.match(r.detail, /3\/3 hidden tests passed/);
  } finally { s.cleanup(); }
});

test('a partly failing run keeps its partial score and fails the check', () => {
  const s = setup({ good: 2, bad: 2 });
  try {
    const [r] = runChecks(s.ws, [check({ min: 4 })], { hiddenDir: s.hidden });
    assert.equal(r.passed, false);
    assert.deepEqual(r.tests, { passed: 2, total: 4, unparsed: false });
    assert.doesNotMatch(r.detail, /bad \d/, 'the detail carries counts, never test names');
  } finally { s.cleanup(); }
});

test('hidden files are overlaid into a scratch copy, never into the workspace', () => {
  const s = setup({ good: 1 });
  try {
    runChecks(s.ws, [check()], { hiddenDir: s.hidden });
    assert.equal(fs.existsSync(path.join(s.ws, 'hidden')), false);
    assert.deepEqual(fs.readdirSync(s.ws).sort(), ['src']);
  } finally { s.cleanup(); }
});

test('files the agent left where the overlay goes are replaced, not merged', () => {
  const s = setup({ good: 1, workspace: { 'hidden/b.test.js': T('agent supplied', 'throw new Error("must not run")') } });
  try {
    const [r] = runChecks(s.ws, [check({ min: 1 })], { hiddenDir: s.hidden });
    assert.equal(r.passed, true);
    assert.equal(r.tests.total, 1);
  } finally { s.cleanup(); }
});

test('a crash before any summary scores 0 of the known total and is marked unparsed', () => {
  const s = setup({ good: 2, workspace: { 'src/lib.js': 'module.exports = {' } });
  try {
    const [r] = runChecks(s.ws, [check({ cmd: 'node -e "process.exit(3)"', min: 5 })], { hiddenDir: s.hidden });
    assert.equal(r.passed, false);
    assert.deepEqual(r.tests, { passed: 0, total: 5, unparsed: true });
    assert.match(r.detail, /unparsed/);
  } finally { s.cleanup(); }
});

test('a timeout scores 0 of the known total and is marked unparsed', () => {
  const s = setup({ good: 1 });
  try {
    const t0 = Date.now();
    const [r] = runChecks(s.ws, [check({ cmd: 'sleep 20', min: 4 })], { hiddenDir: s.hidden, testsTimeoutMs: 700 });
    assert.ok(Date.now() - t0 < 10000);
    assert.deepEqual(r.tests, { passed: 0, total: 4, unparsed: true });
    assert.match(r.detail, /timed out/);
  } finally { s.cleanup(); }
});

test('tests that never ran count as failed when the known total is higher than the parsed one', () => {
  const s = setup({ good: 2 });
  try {
    const [r] = runChecks(s.ws, [check({ min: 5 })], { hiddenDir: s.hidden });
    assert.equal(r.passed, false);
    assert.deepEqual(r.tests, { passed: 2, total: 5, unparsed: false });
  } finally { s.cleanup(); }
});

test('without a hidden directory the check fails and records an unparsed zero', () => {
  const s = setup({ good: 1 });
  try {
    const [r] = runChecks(s.ws, [check({ min: 2 })], {});
    assert.equal(r.passed, false);
    assert.deepEqual(r.tests, { passed: 0, total: 2, unparsed: true });
  } finally { s.cleanup(); }
});

test('buildResult records hiddenTests aggregated over tests checks, null otherwise', () => {
  const base = {
    arm: { id: 'vanilla', label: 'v', ref: null, commitSha: null, harness: 'none', agent: null },
    task: { id: 't', class: 'hard' }, replicate: 1, config: { model: 'm', effort: 'high' },
    exec: { timedOut: false, exitCode: 0, wallClockMs: 1 }, agg: null, session: null, transcript: null,
  };
  const withTests = buildResult({ ...base, checks: [{ type: 'tests', passed: false, tests: { passed: 4, total: 9 } }, { type: 'cmd', passed: true }] });
  assert.deepEqual(withTests.hiddenTests, { passed: 4, total: 9, unparsed: false });
  assert.equal(buildResult({ ...base, checks: [{ type: 'cmd', passed: true }] }).hiddenTests, null);
  assert.deepEqual(validateResult(withTests).filter((e) => /hiddenTests/.test(e)), []);
});

test('schemas accept the hard class, the hard tier, the hidden field and the tests check', () => {
  const task = {
    id: 'hard-x', class: 'hard', target: null, prompt: 'p', fixture: 'f', hidden: 'hard-x', timeoutSec: 900,
    checks: [{ type: 'tests', cmd: 'node --test hidden/*.test.js', min: 4 }],
    rubric: [{ id: 'r', criterion: 'c', weight: 1 }], tiers: ['hard'],
  };
  assert.deepEqual(validate(loadSchema('task'), task), []);
  assert.ok(validate(loadSchema('task'), { ...task, hidden: 3 }).length);
  const result = { checks: [{ type: 'tests', cmd: 'x', passed: true, tests: { passed: 1, total: 1, unparsed: false } }], hiddenTests: { passed: 1, total: 1, unparsed: false } };
  assert.deepEqual(validate({ ...loadSchema('result'), required: [] }, result), []);
  assert.ok(validate({ ...loadSchema('result'), required: [] }, { hiddenTests: { passed: 'x' } }).length);
});

test('loadTasks resolves hiddenDir and loadSuite knows the hard suite', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const file = path.join(bench, 'tasks/t1.json');
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    write(file, JSON.stringify({ ...t, class: 'hard', tiers: ['hard'], hidden: 't1' }));
    assert.throws(() => loadTasks(bench), /hidden dir missing/);
    write(path.join(bench, 'tasks/hidden/t1/hidden/a.test.js'), '');
    const tasks = loadTasks(bench);
    assert.equal(tasks.get('t1').hiddenDir, path.join(bench, 'tasks/hidden/t1'));
    const suite = loadSuite('hard', tasks, bench);
    assert.deepEqual(suite.taskIds, ['t1']);
    assert.equal(suite.parallel, 1);
    assert.throws(() => loadSuite('nightly', tasks, bench), /lite, full or hard/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('benchMask hides fixtures, solutions, stubs, hidden tests and partials', () => {
  assert.deepEqual(benchMask('/b').map((p) => path.relative('/b', p)).sort(),
    ['fixtures', 'tasks/hidden', 'tasks/partials', 'tasks/solutions', 'tasks/stubs']);
});

test('recheck re-runs tests checks against the saved workspace and stores hiddenTests', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const file = path.join(bench, 'tasks/t1.json');
    const task = JSON.parse(fs.readFileSync(file, 'utf8'));
    write(file, JSON.stringify({ ...task, class: 'hard', tiers: ['hard'], hidden: 't1', checks: [{ type: 'tests', cmd: 'node --test hidden/*.test.js', min: 2 }] }));
    write(path.join(bench, 'tasks/hidden/t1/hidden/a.test.js'),
      T('first', "require('node:assert').equal(require('fs').readFileSync('a.txt','utf8').trim(), 'alpha');") +
      T('second', "require('node:assert').equal(require('fs').readFileSync('b.txt','utf8').trim(), 'fixed');"));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', files: { 'b.txt': 'bravo\n' }, checks: [{ type: 'tests', cmd: 'node --test hidden/*.test.js', passed: false, detail: 'old' }] }]);
    const resultFile = path.join(runDir, 'vanilla/t1/1/result.json');
    const [out] = recheckAll({ runDir, benchDir: bench });
    assert.equal(out.status, 'rechecked');
    const after = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.deepEqual(after.hiddenTests, { passed: 1, total: 2, unparsed: false });
    assert.equal(after.checksAllPassed, false);
    assert.equal(fs.existsSync(path.join(runDir, 'vanilla/t1/1/workspace/hidden')), false, 'the saved workspace is not touched');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('recheck adds no hiddenTests field to tasks without tests checks', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', checks: [{ type: 'file_exists', path: 'zzz', passed: false }] }]);
    recheckAll({ runDir, benchDir: bench });
    const after = JSON.parse(fs.readFileSync(path.join(runDir, 'vanilla/t1/1/result.json'), 'utf8'));
    assert.equal('hiddenTests' in after, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the judge bundle shows pass and fail counts for tests checks and nothing else', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{
      arm: 'vanilla',
      checks: [{ type: 'tests', cmd: 'node --test hidden/secret-name/*.test.js', passed: false, detail: '3/9 hidden tests passed', tests: { passed: 3, total: 9 } }],
    }]);
    const result = JSON.parse(fs.readFileSync(path.join(runDir, 'vanilla/t1/1/result.json'), 'utf8'));
    const { text } = buildBundle({ runDir: path.join(runDir, 'vanilla/t1/1'), result, fixtureDir: path.join(bench, 'fixtures/fx'), limits: { maxFileChars: 4000, maxBundleChars: 20000 }, redactions: [] });
    assert.match(text, /FAIL tests: 3 of 9 hidden tests passed/);
    assert.doesNotMatch(text, /secret-name/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function reportFor(specs) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'), { cls: 'hard' });
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  const run = loadRun(runDir);
  const out = buildReport({ run, tasks: loadTasks(bench) });
  return { ...out, markdown: renderMarkdown(out.report), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('report shows the mean hidden pass fraction and the share of runs passing all, per arm and class', () => {
  const h = (passed, total) => ({ hiddenTests: { passed, total, unparsed: false } });
  const r = reportFor([
    { arm: 'vanilla', rep: 1, ...h(5, 10) }, { arm: 'vanilla', rep: 2, ...h(10, 10) },
    { arm: 'konductor', rep: 1, ...h(9, 10) }, { arm: 'konductor', rep: 2, ...h(10, 10) },
  ]);
  try {
    const cell = r.report.arms.vanilla.overall;
    assert.deepEqual(cell.hidden, { runs: 2, meanFraction: 0.75, allPassShare: 0.5 });
    assert.equal(r.report.arms.konductor.hard.hidden.meanFraction, 0.95);
    assert.ok(r.report.scopes.includes('hard'));
    assert.match(r.markdown, /hidden tests passed/);
    assert.match(r.markdown, /75% \(1 of 2 runs pass all\)/);
  } finally { r.cleanup(); }
});

test('the report has no hidden-tests column when no run has hiddenTests', () => {
  const r = reportFor([{ arm: 'vanilla' }]);
  try {
    assert.equal(r.report.arms.vanilla.overall.hidden, null);
    assert.doesNotMatch(r.markdown, /hidden tests passed/);
  } finally { r.cleanup(); }
});
