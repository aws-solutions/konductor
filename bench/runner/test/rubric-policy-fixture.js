// SPDX-License-Identifier: Apache-2.0
'use strict';

// A small judged study with runs kept out of judging, built on disk, and the report outputs read from it. The legacy
// snapshot in fixtures/rubric-policy-legacy.snapshot.json was taken from this study with the code from before the
// rubric policy existed.

const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun, withViews } = require('./helpers.js');

const JUDGES = ['j1', 'j2'];

// arm -> rep -> score the judges give; a rep with no score is not judged.
const DEFAULT_SCORES = { vanilla: { 1: 0.5, 2: 0.75, 3: 1 }, v1: { 1: 1, 2: 0.75 } };

const DEFAULT_RUNS = [
  { arm: 'vanilla', rep: 1 }, { arm: 'vanilla', rep: 2 }, { arm: 'vanilla', rep: 3 },
  { arm: 'vanilla', rep: 4, status: 'error', infraError: 'post-processing failed: x' },
  { arm: 'v1', rep: 1 }, { arm: 'v1', rep: 2 },
  { arm: 'v1', rep: 3, flags: ['credsUnscrubbed'] },
  { arm: 'v1', rep: 4, flags: ['usageDbTampered'] },
];

const DEFAULT_NOT_JUDGED = [
  { armId: 'vanilla', taskId: 't1', replicate: 4, reason: 'infraError' },
  { armId: 'v1', taskId: 't1', replicate: 3, reason: 'credsUnscrubbed' },
  { armId: 'v1', taskId: 't1', replicate: 4, reason: 'usageDbTampered' },
];

function rubricRecords(scores) {
  return Object.entries(scores).flatMap(([arm, reps]) => Object.entries(reps).flatMap(([rep, score]) => JUDGES.map((judge) => withViews({
    kind: 'rubric', judge, armId: arm, taskId: 't1', replicate: Number(rep), score, scoreRaw: score,
    criteria: [{ id: 'c1', verdict: 'pass', evidence: 'e', evidenceFound: true }, { id: 'c2', verdict: 'pass', evidence: 'e', evidenceFound: true }],
    judgeError: null, parseFailures: 0, calls: [{ credits: 0.1, latencyMs: 100, cached: false, ok: true }], redactionsFired: {},
  }))));
}

/** Writes a bench dir and a run dir under `root`; `stamp` is the rubricPolicy value to put in judgments.json, or null for a legacy file. */
function buildStudy(root, name, { stamp = null, scores = DEFAULT_SCORES, runs = DEFAULT_RUNS, notJudged = DEFAULT_NOT_JUDGED } = {}) {
  const bench = fs.existsSync(path.join(root, 'bench')) ? path.join(root, 'bench') : makeBench(path.join(root, 'bench'));
  const dir = makeRun(path.join(root, name), bench, runs);
  write(path.join(dir, 'judgments.json'), JSON.stringify({
    schemaVersion: 1, baseline: 'vanilla', backend: 'kiro', judges: JUDGES, modes: ['rubric'], panel: { families: ['a', 'b', 'c'], small: false },
    ...(stamp ? { rubricPolicy: stamp } : {}),
    notJudged, rubric: rubricRecords(scores), pairwise: [], graded: [],
  }));
  return { bench, dir };
}

/** Everything the legacy snapshot holds: the report JSON and markdown, the compare text and the verdict sentences. */
function renderAll(root, { stamp = null } = {}) {
  const { buildReport } = require('../../report/aggregate.js');
  const { renderMarkdown } = require('../../report/render.js');
  const { loadRun } = require('../../report/load.js');
  const { loadTasks } = require('../../runner/lib/tasks.js');
  const { compareRuns, formatCompare } = require('../../report/compare.js');
  const { buildVerdict } = require('../../report/verdict.js');
  const head = buildStudy(root, 'head', { stamp });
  const base = buildStudy(root, 'base', { stamp, scores: { vanilla: { 1: 0.25, 2: 0.5, 3: 0.75 }, v1: { 1: 0.5, 2: 0.5 } } });
  const norm = (text) => text.split(root).join('<ROOT>');
  const r = buildReport({ run: loadRun(head.dir), tasks: loadTasks(head.bench), baseline: 'vanilla' });
  const compare = compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: head.bench, minRel: 0.01 });
  const verdict = buildVerdict({ dirs: [head.dir], benchDir: head.bench, baseline: 'vanilla', withSensitivity: false });
  return {
    json: JSON.parse(norm(JSON.stringify(r.report))),
    md: norm(renderMarkdown(r.report)),
    compare: norm(formatCompare(compare)),
    verdict: verdict.arms.map((x) => x.sentence),
  };
}

module.exports = { buildStudy, renderAll, DEFAULT_SCORES, DEFAULT_RUNS, DEFAULT_NOT_JUDGED, JUDGES, tmp };
