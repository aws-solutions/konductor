// SPDX-License-Identifier: Apache-2.0
'use strict';

// `judge --rescore-quotes`: recompute the evidence check of stored rubric verdicts without calling a model. Each judged
// output bundle is rebuilt from the run directory, each stored quote is matched again (strictly, or leniently), and the
// scored verdicts and per-judge scores follow. The result goes to a new file, judgments-lenient.json; judgments.json is
// never read for writing. Newer judgments carry both views already (see views.js); this path serves older ones, and
// a report rebuilds the lenient view of an old record in memory on its own.

const fs = require('node:fs');
const path = require('node:path');
const { loadTasks } = require('../runner/lib/tasks.js');
const { loadRun } = require('../report/load.js');
const { effectiveLimits } = require('./config.js');
const { writeAtomic } = require('../runner/lib/owned.js');
const { buildBundle } = require('./bundle.js');
const { makeQuoteMatcher, MAX_UNSUPPORTED_LETTERS } = require('./quote.js');
const { rubricScore, DOWNGRADE } = require('./score.js');

const LENIENT_FILE = 'judgments-lenient.json';
const NO_EVIDENCE = /^\(nothing in the output\)/i;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const keyOf = (r) => `${r.armId}\u0000${r.taskId}\u0000${r.replicate}`;

// The criteria of one record with the evidence check applied again. verdictRaw is the judge's own verdict.
function rescoredCriteria(criteria, found) {
  return criteria.map((c) => {
    const raw = c.verdictRaw ?? c.judgeVerdict ?? c.verdict;
    const evidenceFound = NO_EVIDENCE.test(c.evidence ?? '') ? false : found(c.evidence ?? '');
    const downgraded = evidenceFound === false && raw !== 'fail';
    const { evidenceDowngraded, quoteFound, verdictStrict, verdictLenient, ...rest } = c;
    return { ...rest, verdict: downgraded ? DOWNGRADE[raw] : raw, verdictRaw: raw, verdictScored: downgraded ? DOWNGRADE[raw] : raw, evidenceFound, ...(downgraded ? { evidenceDowngraded: true } : {}) };
  });
}

function summarize(records) {
  const out = {};
  for (const judge of [...new Set(records.map((r) => r.judge))].sort()) {
    const mine = records.filter((r) => r.judge === judge && !r.judgeError);
    const criteria = mine.flatMap((r) => r.criteria);
    out[judge] = { records: mine.length, criteria: criteria.length, downgraded: criteria.filter((c) => c.evidenceDowngraded).length, unfound: criteria.filter((c) => c.evidenceFound === false).length, meanScore: mean(mine.map((r) => r.score).filter((v) => typeof v === 'number')) };
    out[judge].downgradeRate = criteria.length ? out[judge].downgraded / criteria.length : null;
  }
  return out;
}

function perArm(records) {
  const arms = {};
  for (const r of records.filter((x) => !x.judgeError && typeof x.score === 'number')) (arms[r.armId] ??= []).push(r);
  const out = {};
  for (const [arm, recs] of Object.entries(arms)) {
    // mean over judges of the mean over the arm's runs
    const byJudge = [...new Set(recs.map((r) => r.judge))].map((j) => mean(recs.filter((r) => r.judge === j).map((r) => r.score)));
    out[arm] = mean(byJudge);
  }
  return out;
}

/**
 * mode: 'lenient' writes judgments-lenient.json; 'strict' recomputes with the default rule and writes nothing, which shows
 * that the rescoring reproduces the stored values. Returns { file, before, after, armBefore, armAfter, changed }.
 */
function rescoreQuotes({ runDir, benchDir, extraDirs = [], redactions, mode = 'lenient', write = true }) {
  if (!['lenient', 'strict'].includes(mode)) throw new Error('--quote-match takes lenient or strict');
  const run = loadRun(runDir);
  const j = run.judgments;
  if (!j) throw new Error(`${runDir} has no judgments.json; run bench.js judge first`);
  const tasks = loadTasks(benchDir, { extraDirs });
  const bundles = new Map();
  const matchers = new Map();
  const matcherFor = (rec) => {
    const k = keyOf(rec);
    if (!matchers.has(k)) {
      const entry = run.runs.find((e) => keyOf(e) === k);
      const task = tasks.get(rec.taskId);
      if (!entry || !task) return null;
      if (!bundles.has(k)) bundles.set(k, buildBundle({ runDir: entry.dir, result: entry.result, fixtureDir: task.fixtureDir, limits: effectiveLimits(task, j.limits ?? {}, {}), redactions }));
      matchers.set(k, makeQuoteMatcher(bundles.get(k).text, { lenient: mode === 'lenient' }));
    }
    return matchers.get(k);
  };
  let changed = 0;
  const skipped = [];
  const rubric = j.rubric.map((rec) => {
    const found = rec.judgeError || !rec.criteria?.length ? null : matcherFor(rec);
    if (!found) {
      if (!rec.judgeError && rec.criteria?.length) skipped.push(`${rec.judge}|${rec.armId}|${rec.taskId}|${rec.replicate}`);
      return rec;
    }
    const task = tasks.get(rec.taskId);
    const criteria = rescoredCriteria(rec.criteria, found);
    const score = rubricScore(task.rubric, criteria);
    if (criteria.some((c, i) => c.evidenceDowngraded !== rec.criteria[i].evidenceDowngraded)) changed++;
    const { scoreStrict, scoreLenient, quoteViews, ...base } = rec;
    return { ...base, criteria, score };
  });
  const before = summarize(j.rubric);
  const after = summarize(rubric);
  const result = { before, after, armBefore: perArm(j.rubric), armAfter: perArm(rubric), changed, skipped, mode, file: null };
  if (mode === 'lenient' && write) {
    const file = path.join(run.dir, LENIENT_FILE);
    const quoteMatch = { mode: 'lenient', maxUnsupportedLetters: MAX_UNSUPPORTED_LETTERS, rescoredFrom: 'judgments.json', createdAt: new Date().toISOString(), before, after, recordsChanged: changed };
    writeAtomic(file, `${JSON.stringify({ ...j, quoteMatch, rubric }, null, 2)}\n`);
    result.file = file;
  }
  return result;
}

function formatRescore(r) {
  const pct = (v) => (v === null ? 'n/a' : `${(100 * v).toFixed(1)}%`);
  const f2 = (v) => (typeof v === 'number' ? v.toFixed(3) : 'n/a');
  const lines = ['judge | criteria | downgraded before | after | rate before | rate after | mean rubric before | after'];
  for (const [judge, b] of Object.entries(r.before)) {
    const a = r.after[judge];
    lines.push(`${judge} | ${b.criteria} | ${b.downgraded} | ${a.downgraded} | ${pct(b.downgradeRate)} | ${pct(a.downgradeRate)} | ${f2(b.meanScore)} | ${f2(a.meanScore)}`);
  }
  lines.push('', 'arm | mean rubric before | after | change');
  for (const arm of Object.keys(r.armBefore)) lines.push(`${arm} | ${f2(r.armBefore[arm])} | ${f2(r.armAfter[arm])} | ${f2(r.armAfter[arm] - r.armBefore[arm])}`);
  return lines.join('\n');
}

module.exports = { rescoreQuotes, formatRescore, rescoredCriteria, LENIENT_FILE };
