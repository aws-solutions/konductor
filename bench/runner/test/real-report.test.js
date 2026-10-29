// SPDX-License-Identifier: Apache-2.0
'use strict';

// Report columns of the real class: FAIL_TO_PASS, regression, and the contamination audit rows.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');

const f2p = (passed, total) => ({ hiddenTests: { passed, total, unparsed: false } });
const p2p = (passed, total) => ({ regressionTests: { passed, total } });
const audit = (externalFetch = [], fixRecallChars = 0, extraFlags = []) => ({
  contamination: { externalFetch, fixRecallChars },
  flags: [...(externalFetch.length ? ['externalFetch'] : []), ...(fixRecallChars >= 80 ? ['fixRecall'] : []), ...extraFlags],
});

function reportFor(specs, cls = 'real') {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'), { cls });
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  const out = buildReport({ run: loadRun(runDir), tasks: loadTasks(bench) });
  return { ...out, markdown: renderMarkdown(out.report), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const SPECS = [
  { arm: 'vanilla', rep: 1, ...f2p(1, 2), ...p2p(100, 100), ...audit() },
  { arm: 'vanilla', rep: 2, ...f2p(2, 2), ...p2p(98, 100), ...audit(['shell: curl https://example.org/x'], 0) },
  { arm: 'main', rep: 1, ...f2p(2, 2), ...p2p(100, 100), ...audit([], 120) },
  { arm: 'main', rep: 2, ...f2p(0, 2), ...p2p(100, 100), ...audit(['shell: git clone x'], 95) },
];

test('the real class is its own scope, ordered after hard', () => {
  const r = reportFor(SPECS);
  try {
    assert.ok(r.report.scopes.includes('real'));
    assert.ok(r.report.arms.vanilla.real);
  } finally { r.cleanup(); }
});

test('FAIL_TO_PASS gives a mean fraction and the share of runs passing all; regression is kept apart', () => {
  const r = reportFor(SPECS);
  try {
    const v = r.report.arms.vanilla.real;
    assert.deepEqual(v.hidden, { runs: 2, meanFraction: 0.75, allPassShare: 0.5 });
    assert.deepEqual(v.regression, { runs: 2, meanFraction: 0.99, allPassShare: 0.5 });
    const m = r.report.arms.main.real;
    assert.deepEqual(m.hidden, { runs: 2, meanFraction: 0.5, allPassShare: 0.5 });
    assert.deepEqual(m.regression, { runs: 2, meanFraction: 1, allPassShare: 1 });
  } finally { r.cleanup(); }
});

test('contamination counts per arm and class, never dropped, with the flagged runs named', () => {
  const r = reportFor(SPECS);
  try {
    assert.deepEqual(r.report.arms.vanilla.real.contamination, { audited: 2, externalFetch: 1, fixRecall: 0, unchecked: 0, flagged: [{ taskId: 't1', replicate: 2, kinds: ['externalFetch'] }] });
    assert.deepEqual(r.report.arms.main.real.contamination, {
      audited: 2, externalFetch: 1, fixRecall: 2, unchecked: 0,
      flagged: [{ taskId: 't1', replicate: 1, kinds: ['fixRecall'] }, { taskId: 't1', replicate: 2, kinds: ['externalFetch', 'fixRecall'] }],
    });
    assert.deepEqual(r.report.arms.vanilla.overall.contamination.externalFetch, 1);
  } finally { r.cleanup(); }
});

test('the markdown shows FAIL_TO_PASS, regression and a separate contamination row for each arm', () => {
  const r = reportFor(SPECS);
  try {
    assert.match(r.markdown, /FAIL_TO_PASS passed/);
    assert.match(r.markdown, /75% \(1 of 2 runs pass all\)/);
    assert.match(r.markdown, /regression \(PASS_TO_PASS\) passed/);
    assert.match(r.markdown, /99% \(1 of 2 runs pass all\)/);
    assert.match(r.markdown, /Contamination audit/);
    assert.match(r.markdown, /\| vanilla \| 2 \| 1 \| 0 \| 0 \|/);
    assert.match(r.markdown, /\| main \| 2 \| 1 \| 2 \| 0 \|/);
    assert.match(r.markdown, /t1 #2 \(externalFetch, fixRecall\)/);
  } finally { r.cleanup(); }
});

test('a run whose audit could not be completed is counted as unchecked, not silently clean', () => {
  const r = reportFor([{ arm: 'vanilla', rep: 1, ...f2p(1, 1), ...p2p(1, 1), ...audit([], 0, ['contaminationUnchecked']) }]);
  try {
    assert.equal(r.report.arms.vanilla.real.contamination.unchecked, 1);
    assert.match(r.markdown, /\| vanilla \| 1 \| 0 \| 0 \| 1 \|/);
  } finally { r.cleanup(); }
});

test('other classes keep their layout: no regression column, no contamination section', () => {
  const r = reportFor([{ arm: 'vanilla', rep: 1, ...f2p(5, 10) }], 'hard');
  try {
    assert.equal(r.report.arms.vanilla.hard.regression, null);
    assert.equal(r.report.arms.vanilla.hard.contamination, null);
    assert.match(r.markdown, /hidden tests passed/);
    assert.doesNotMatch(r.markdown, /Contamination audit|FAIL_TO_PASS passed|PASS_TO_PASS\) passed/);
  } finally { r.cleanup(); }
});

test('the judge bundle adds the regression count for a real tests check and still shows no test names', () => {
  const { buildBundle } = require('../../judge/bundle.js');
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'), { cls: 'real' });
    const runDir = makeRun(path.join(root, 'run'), bench, [{
      arm: 'vanilla',
      checks: [{ type: 'tests', manifest: true, passed: false, detail: 'FAIL_TO_PASS 1/2, PASS_TO_PASS 98/100', tests: { passed: 1, total: 2 }, regression: { passed: 98, total: 100 } }],
    }]);
    const result = JSON.parse(fs.readFileSync(path.join(runDir, 'vanilla/t1/1/result.json'), 'utf8'));
    const { text } = buildBundle({ runDir: path.join(runDir, 'vanilla/t1/1'), result, fixtureDir: path.join(bench, 'fixtures/fx'), limits: { maxFileChars: 4000, maxBundleChars: 20000 }, redactions: [] });
    assert.match(text, /FAIL tests: 1 of 2 hidden tests passed; 98 of 100 existing tests still pass/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
