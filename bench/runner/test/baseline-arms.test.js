// SPDX-License-Identifier: Apache-2.0
'use strict';

// --baseline takes any arm name end to end: pairwise judge, judgments.json, report.json and report.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { buildReport, defaultBaseline } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');

const BENCH = path.join(__dirname, '..', 'bench.js');
const FAKE = `node ${path.join(__dirname, 'fake-judge.js')}`;
const cli = (args) => spawnSync('node', [BENCH, ...args], { encoding: 'utf8' });
const judge = (s, ...extra) => cli(['judge', '--run', s.runDir, '--bench-dir', s.bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE, ...extra]);

function setup(arms) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, arms.flatMap((arm) => [1, 2, 3].map((rep) => ({ arm, rep, files: { 'a.txt': `by ${arm}\n` } }))));
  return { root, bench, runDir, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const read = (s, f) => JSON.parse(fs.readFileSync(path.join(s.runDir, f), 'utf8'));

test('the pairwise judge takes v1.2.0 as the baseline: records for every other arm, none for the baseline itself', () => {
  const s = setup(['vanilla', 'v1.2.0', 'pr-95', 'wip.1']);
  try {
    const r = judge(s, '--baseline', 'v1.2.0');
    assert.equal(r.status, 0, r.stderr);
    const j = read(s, 'judgments.json');
    assert.equal(j.baseline, 'v1.2.0');
    assert.deepEqual([...new Set(j.pairwise.map((p) => p.armId))].sort(), ['pr-95', 'vanilla', 'wip.1']);
    assert.ok(j.pairwise.every((p) => p.baselineId === 'v1.2.0' && !p.judgeError));
    assert.equal(j.pairwise.length, 9);
    assert.equal(j.rubric.length, 12, 'rubric scores every arm, the baseline included');
  } finally { s.done(); }
});

test('report --baseline v1.2.0 puts the baseline first, leaves its pairwise cell empty and fills the others', () => {
  const s = setup(['vanilla', 'v1.2.0', 'pr-95']);
  try {
    assert.equal(judge(s, '--baseline', 'v1.2.0').status, 0);
    const r = cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--baseline', 'v1.2.0']);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /no runs/);
    const rep = read(s, 'report.json');
    assert.equal(rep.baseline, 'v1.2.0');
    assert.equal(Object.keys(rep.arms)[0], 'v1.2.0');
    assert.equal(rep.arms['v1.2.0'].overall.pairwise, null);
    const t = rep.arms['pr-95'].overall.pairwise.total;
    assert.equal(t.win + t.tie + t.loss, 3, 'one judged pair per task and replicate');
    assert.equal(t.errors, 0);
    assert.match(fs.readFileSync(path.join(s.runDir, 'report.md'), 'utf8'), /v1\.2\.0/);
  } finally { s.done(); }
});

test('an unknown baseline stops judge before any call is made, and report warns', () => {
  const s = setup(['vanilla', 'pr-95']);
  try {
    const r = judge(s, '--baseline', 'v1.2.0');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /baseline arm "v1\.2\.0" has no runs.*arms present: pr-95, vanilla/);
    assert.equal(fs.existsSync(path.join(s.runDir, 'judgments.json')), false);
    assert.equal(judge(s, '--baseline', 'v1.2.0', '--mode', 'rubric').status, 0, 'the baseline only matters for pairwise');
    assert.match(cli(['report', '--run', s.runDir, '--bench-dir', s.bench, '--baseline', 'v1.2.0']).stderr, /baseline arm "v1\.2\.0" has no runs/);
  } finally { s.done(); }
});

test('without --baseline the default is vanilla; a run with no vanilla falls back to v1.2.0, then the first arm', () => {
  const run = (arms, harness = 'kiro-cli') => ({ harness, runs: arms.map((a) => ({ armId: a })) });
  assert.equal(defaultBaseline(run(['pr', 'vanilla', 'v1.2.0'])), 'vanilla');
  assert.equal(defaultBaseline(run(['pr', 'v1.2.0'])), 'v1.2.0');
  assert.equal(defaultBaseline(run(['pr', 'a'])), 'a');
  assert.equal(defaultBaseline(run(['oc-vanilla', 'oc-x'], 'opencode')), 'oc-vanilla');
  assert.equal(defaultBaseline(run(['oc-v1.2.0', 'oc-x'], 'opencode')), 'oc-v1.2.0');
  const s = setup(['v1.2.0', 'pr-95']);
  try {
    const rep = buildReport({ run: loadRun(s.runDir), tasks: loadTasks(s.bench) }).report;
    assert.equal(rep.baseline, 'v1.2.0');
    assert.match(renderMarkdown(rep), /v1\.2\.0/);
  } finally { s.done(); }
});
