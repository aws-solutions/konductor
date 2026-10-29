// SPDX-License-Identifier: Apache-2.0
'use strict';

// Report, compare and judge-bundle rules for runs made with the opencode harness.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { loadRun } = require('../../report/load.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');
const { compareRuns, formatCompare } = require('../../report/compare.js');
const { loadTasks } = require('../lib/tasks.js');
const { buildBundle } = require('../../judge/bundle.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { DEFAULTS, modelFamily } = require('../../judge/config.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const FAKE_JUDGE = `node ${path.join(__dirname, 'fake-judge.js')}`;
const STREAM = fs.readFileSync(path.join(__dirname, 'fixtures', 'opencode-vanilla.stream.jsonl'), 'utf8');

const tokens = (total) => ({ input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: total - 2, total });
const ocOverrides = (o) => ({
  harness: 'opencode', credits: null, kiroCliVersion: null, harnessVersion: '1.19.5', model: 'global.anthropic.claude-sonnet-5-5',
  costUsd: o.usd, costCensored: false, tokens: tokens(o.tok ?? 1000), estTokens: { value: o.tok ?? 1000, isEstimate: false }, ...o.extra,
});

// specs: [{arm, rep, usd, tok, finalText, files, extra}]
function makeOcRun(runDir, bench, specs, config = {}) {
  makeRun(runDir, bench, specs.map(({ arm, rep, usd, tok, extra, ...rest }) => ({ arm, rep, ...rest, ...ocOverrides({ usd, tok, extra }) })), {
    harness: 'opencode', harnessVersion: '1.19.5', model: 'global.anthropic.claude-sonnet-5-5', ...config,
  });
  for (const s of specs) write(path.join(runDir, s.arm, 't1', String(s.rep), 'stream.jsonl'), STREAM);
  return runDir;
}

const reps = (arm, f) => [1, 2, 3].map((rep) => ({ arm, rep, ...f(rep) }));

test('an opencode report has USD and token cells, no credit columns, and says so', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const run = makeOcRun(path.join(root, 'run'), bench, [...reps('oc-vanilla', () => ({ usd: 0.03, tok: 20000 })), ...reps('oc-k', (r) => ({ usd: 0.1 * r, tok: 50000 * r }))]);
    const r = buildReport({ run: loadRun(run), tasks: loadTasks(bench) });
    assert.equal(r.report.harness, 'opencode');
    assert.equal(r.report.costUnit, 'usd');
    assert.equal(r.report.baseline, 'oc-vanilla');
    const c = r.report.arms['oc-k'].overall;
    assert.equal(c.efficiency.costUsd.median, 0.2);
    assert.equal(c.efficiency.tokens.median, 100000);
    assert.equal('estTokens' in c.efficiency, false);
    assert.equal('credits' in c, false);
    assert.ok(Math.abs(c.cost.perSuccessfulRun - 0.2) < 1e-9);
    assert.equal(c.cost.unit, 'usd');
    const md = renderMarkdown(r.report);
    assert.match(md, /opencode 1\.19\.5/);
    assert.match(md, /USD \(list price\)/);
    assert.match(md, /tokens \(input \+ output \+ cache read \+ cache write\)/);
    assert.match(md, /USD per successful run/);
    assert.doesNotMatch(md, /estTokens|credits per successful run|\| credits \|/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a censored opencode run is a lower bound in USD and is charged its ledger value', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const run = makeOcRun(path.join(root, 'run'), bench, [
      { arm: 'oc-k', rep: 1, usd: 0.2 },
      { arm: 'oc-k', rep: 2, usd: 0.05, extra: { status: 'timeout', costCensored: true, costUsdCharged: 0.2 } },
    ]);
    const c = buildReport({ run: loadRun(run), tasks: loadTasks(bench) }).report.arms['oc-k'].overall;
    assert.equal(c.cost.censoredRuns, 1);
    assert.equal(c.cost.isLowerBound, true);
    assert.ok(Math.abs(c.cost.total - 0.4) < 1e-9);
    assert.equal(c.efficiency.costUsd.median, 0.2, 'the timed-out run is not in the median');
    assert.ok(c.flags.some((f) => /lower bounds/.test(f) && /cost and token/.test(f)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a run directory that mixes harnesses is refused, never put in one table', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const run = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', rep: 1 }]);
    makeOcRun(run, bench, [{ arm: 'oc-vanilla', rep: 1, usd: 0.03 }]);
    assert.throws(() => loadRun(run), /mixes harnesses \(kiro-cli, opencode\)/);
    const r = spawnSync('node', [BENCH_JS, 'report', '--run', run, '--bench-dir', bench], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /mixes harnesses/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function pair(baseSpecs, headSpecs, { headKiro = false } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const base = makeOcRun(path.join(root, 'base'), bench, baseSpecs);
  const head = headKiro
    ? makeRun(path.join(root, 'head'), bench, reps('vanilla', () => ({})), { harness: 'none' })
    : makeOcRun(path.join(root, 'head'), bench, headSpecs);
  return { root, bench, base, head };
}

test('compare refuses runs of different harnesses (exit 2) unless --force', () => {
  const p = pair(reps('oc-vanilla', () => ({ usd: 0.03 })), null, { headKiro: true });
  try {
    const r = compareRuns({ baseDir: p.base, headDir: p.head, benchDir: p.bench });
    assert.equal(r.exitCode, 2);
    assert.match(r.refusals.join(' '), /harness differs: base "opencode" vs head "kiro-cli"/);
    const cli = spawnSync('node', [BENCH_JS, 'compare', '--base', p.base, '--head', p.head, '--bench-dir', p.bench], { encoding: 'utf8' });
    assert.equal(cli.status, 2);
    const forced = compareRuns({ baseDir: p.base, headDir: p.head, benchDir: p.bench, force: true });
    assert.equal(forced.forced, true);
    assert.notEqual(forced.exitCode, 2);
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('compare of two opencode runs flags a cost regression and a different opencode version', () => {
  const same = reps('oc-vanilla', () => ({ usd: 0.03 }));
  const p = pair(same, reps('oc-vanilla', () => ({ usd: 0.09 })));
  try {
    const r = compareRuns({ baseDir: p.base, headDir: p.head, benchDir: p.bench });
    assert.equal(r.exitCode, 1);
    const hit = r.regressions.find((x) => x.metric === 'costUsd');
    assert.ok(hit && hit.rel > 1.9);
    assert.match(formatCompare(r), /costUsd/);
    write(path.join(p.head, 'run-config.json'), JSON.stringify({ suite: 'lite', harness: 'opencode', harnessVersion: '1.20.0', model: 'global.anthropic.claude-sonnet-5-5', effort: 'high', taskIds: ['t1'] }));
    const v = compareRuns({ baseDir: p.base, headDir: p.head, benchDir: p.bench });
    assert.equal(v.exitCode, 2);
    assert.match(v.refusals.join(' '), /opencode version differs/);
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('judge bundle from an opencode run: last assistant text, files changed versus the fixture, tool state skipped', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const run = makeOcRun(path.join(root, 'run'), bench, [{ arm: 'oc-k', rep: 1, usd: 0.1, files: { 'a.txt': 'alpha fixed\n', '.opencode/x.json': '{}' } }]);
    const dir = path.join(run, 'oc-k/t1/1');
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
    const { text } = buildBundle({ runDir: dir, result, fixtureDir: path.join(bench, 'fixtures/fx'), limits: DEFAULTS.limits, redactions: compileRedactions(DEFAULT_REDACTIONS) });
    assert.match(text, /I created `hello\.txt`/);
    assert.match(text, /alpha fixed/);
    assert.doesNotMatch(text, /bravo|x\.json|tool_use|step_finish/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the judge command runs on an opencode run with a fake judge and the report picks up the scores', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const run = makeOcRun(path.join(root, 'run'), bench, ['oc-vanilla', 'oc-k'].flatMap((arm) => reps(arm, () => ({ usd: 0.05 }))));
    const j = spawnSync('node', [BENCH_JS, 'judge', '--run', run, '--bench-dir', bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE_JUDGE], { encoding: 'utf8' });
    assert.equal(j.status, 0, j.stderr);
    const judgments = JSON.parse(fs.readFileSync(path.join(run, 'judgments.json'), 'utf8'));
    assert.equal(judgments.baseline, 'oc-vanilla');
    assert.ok(judgments.rubric.length > 0 && judgments.pairwise.length > 0);
    const rep = spawnSync('node', [BENCH_JS, 'report', '--run', run, '--bench-dir', bench], { encoding: 'utf8' });
    assert.equal(rep.status, 0, rep.stderr);
    const md = fs.readFileSync(path.join(run, 'report.md'), 'utf8');
    assert.match(md, /Baseline: oc-vanilla\. Judges: gpt-test/);
    assert.match(md, /gpt-test 1\.00/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('modelFamily sees through Bedrock routing prefixes so a Claude judge is still refused', () => {
  assert.equal(modelFamily('global.anthropic.claude-sonnet-5-5'), 'claude');
  assert.equal(modelFamily('us.anthropic.claude-haiku-5-5'), 'claude');
  assert.equal(modelFamily('gpt-5.6-luna'), 'gpt');
});
