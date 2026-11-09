// SPDX-License-Identifier: Apache-2.0
'use strict';

// One flat record per executed run, with the quality components resolved. scores, diligence and the charts read
// these rows, so the three agree on what a run's hidden fraction, checks and rubric are.

const { outcomeOf } = require('./aggregate.js');
const { resultComparable } = require('../runner/lib/isolate.js');
const { checksScore } = require('./scores.js');

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const fraction = (h) => (h && h.total > 0 ? h.passed / h.total : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * run: loaded run (loadRun or loadRuns). ctx: the `ctx` returned by buildReport (rubric index, judges, class lookup,
 * cost basis, packScoreOf when the quality pack is part of the score, and scoring: the loaded weights, which say how checks are scored). Budget-skipped runs are not rows; they are counted by `skippedCount`.
 */
function buildRows(run, tasks, ctx) {
  const { rubricIdx, judges, rawScoreOf, classOf, noQuestionTasks, basis, packScoreOf = null, scoring } = ctx;
  const rows = [];
  for (const e of run.runs) {
    const r = e.result;
    if (r.status === 'budget_skipped') continue;
    const verified = [];
    const raw = [];
    for (const j of judges) {
      const rec = rubricIdx.get(`${j}|${e.armId}|${e.taskId}|${e.replicate}`);
      if (!rec || rec.judgeError || !finite(rec.score)) continue;
      verified.push(rec.score);
      raw.push(rawScoreOf(rec));
    }
    const checks = checksScore(r.checks, scoring);
    const hidden = fraction(r.hiddenTests) ?? fraction(r.intendedTests);
    rows.push({
      arm: e.armId, task: e.taskId, cls: classOf(e.taskId), rep: e.replicate, outcome: outcomeOf(r), status: r.status,
      hidden, hiddenSource: fraction(r.hiddenTests) !== null ? 'hiddenTests' : fraction(r.intendedTests) !== null ? 'intendedTests' : null,
      checks, rubric: verified.length ? mean(verified) : null, rubricRaw: raw.length ? mean(raw) : null, judgesUsed: verified.length,
      credits: basis.charged(r), creditsObserved: basis.observed(r), censored: basis.censored(r),
      wall: finite(r.wallClockMs) ? r.wallClockMs : null, modelCalls: finite(r.modelCalls?.meteringEntries) ? r.modelCalls.meteringEntries : null,
      workToolCalls: finite(r.workToolCalls) ? r.workToolCalls : null, subagentCalls: finite(r.subagentCalls) ? r.subagentCalls : null,
      turns: finite(r.turns) ? r.turns : 0, interjections: finite(r.interjections) ? r.interjections : 0, questionsAsked: finite(r.questionsAsked) ? r.questionsAsked : 0,
      completedWithoutHelp: typeof r.completedWithoutHelp === 'boolean' ? r.completedWithoutHelp : null, noQuestionTask: noQuestionTasks.has(e.taskId),
      askedUser: typeof r.askedUser === 'boolean' ? r.askedUser : null,
      startedAt: r.runStartedAt ? Date.parse(r.runStartedAt) : null, flags: r.flags || [], contamination: r.contamination || null,
      isolation: r.isolation ?? null, comparable: resultComparable(r), modelNormalized: r.modelNormalized ?? null, sessionModel: r.sessionModel ?? null, streamModel: r.streamModel ?? null, model: r.model ?? null,
      commitSha: r.commitSha ?? null, contentHash: r.contentHash ?? null, dirty: r.dirty ?? null, armConfig: r.armConfig ?? null,
      armPrefix: r.armPrefix ? { sha256: r.armPrefix.sha256 ?? null, bytes: r.armPrefix.bytes ?? null } : null,
      oracle: r.oracle ?? null,
      tripwire: (r.flags || []).includes('homeTripwire') || (r.flags || []).includes('homeTripwireTruncated'),
      // Only when the scoring file weights the pack, so a default row has exactly the fields it always had.
      ...(packScoreOf ? { pack: packScoreOf(e.armId, e.taskId, e.replicate) } : {}),
    });
  }
  return rows;
}

const skippedCount = (run) => run.runs.filter((e) => e.result.status === 'budget_skipped').length;

module.exports = { buildRows, skippedCount, fraction };
