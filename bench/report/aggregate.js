// SPDX-License-Identifier: Apache-2.0
'use strict';

const { median, medianCI, mean } = require('./stats.js');
const { summarizeSkills, rowsFromResults } = require('./skills.js');
const { rubricScore } = require('../judge/score.js');
const { taskRevision } = require('../judge/revision.js');
const { MIN_RECALL } = require('../runner/lib/contamination.js');

const CLASS_ORDER = ['simple', 'sop', 'orchestration', 'review', 'design', 'hard', 'real', 'autonomy'];
const MIN_REPLICATES = 3;

const EFFICIENCY = {
  credits: (r) => r.credits,
  modelCalls: (r) => r.modelCalls?.meteringEntries,
  toolCalls: (r) => r.toolCalls,
  subagentCalls: (r) => r.subagentCalls,
  wallClockMs: (r) => r.wallClockMs,
  estTokens: (r) => r.estTokens?.value,
};

const EFFICIENCY_OC = {
  costUsd: (r) => r.costUsd,
  tokens: (r) => r.tokens?.total,
  modelCalls: (r) => r.modelCalls?.meteringEntries,
  toolCalls: (r) => r.toolCalls,
  subagentCalls: (r) => r.subagentCalls,
  wallClockMs: (r) => r.wallClockMs,
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const avg = (xs) => (xs.length ? mean(xs) : null);

function tally(records) {
  const t = { win: 0, tie: 0, loss: 0, positionInconsistent: 0, errors: 0 };
  for (const r of records) {
    if (r.judgeError || !r.verdict) t.errors++;
    else t[r.verdict]++;
    if (r.positionInconsistent) t.positionInconsistent++;
  }
  return t;
}

const sumTallies = (ts) => ts.reduce((a, t) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + t[k]])), tally([]));

// What a run is charged: the ledger value when the runner recorded one, else the observed credits
// (a censored run is at least its known lower bound). A failure never counts as free.
const chargedCredits = (r) => num(r.creditsCharged) ?? (r.creditsCensored ? Math.max(num(r.credits) ?? 0, num(r.creditsLowerBound) ?? 0) : num(r.credits) ?? 0);
const chargedUsd = (r) => num(r.costUsdCharged) ?? num(r.costUsd) ?? 0;

// Per-harness cost basis. kiro-cli is metered in credits; opencode reports tokens and list-price USD.
const BASIS = {
  'kiro-cli': { unit: 'credits', efficiency: EFFICIENCY, charged: chargedCredits, observed: (r) => num(r.credits), censored: (r) => r.creditsCensored === true, perSuccess: 'creditsPerSuccess' },
  opencode: { unit: 'usd', efficiency: EFFICIENCY_OC, charged: chargedUsd, observed: (r) => num(r.costUsd), censored: (r) => r.costCensored === true, perSuccess: 'costPerSuccess' },
};

// Mutually exclusive outcome of one executed run. Only 'good' runs feed the efficiency medians.
function outcomeOf(r) {
  if (r.infraError) return 'infraError';
  if ((r.flags || []).includes('modelMismatch')) return 'modelMismatch';
  if (r.status === 'timeout') return 'timeout';
  if (r.status !== 'success') return 'error';
  return (r.checks || []).length && r.checks.every((c) => c.passed) ? 'good' : 'checksFailed';
}

const OUTCOMES = ['good', 'checksFailed', 'timeout', 'error', 'infraError', 'modelMismatch'];

// Hidden acceptance tests: mean pass fraction over the runs that have a score, and the share passing all.
function hiddenSummary(executed) {
  const scored = executed.map((e) => e.result.hiddenTests).filter((h) => h && h.total > 0);
  if (!scored.length) return null;
  return {
    runs: scored.length,
    meanFraction: mean(scored.map((h) => h.passed / h.total)),
    allPassShare: scored.filter((h) => h.passed === h.total).length / scored.length,
  };
}

// PASS_TO_PASS of the real class: how much of the existing test suite still passes, apart from the FAIL_TO_PASS score.
function regressionSummary(executed) {
  const scored = executed.map((e) => e.result.regressionTests).filter((h) => h && h.total > 0);
  if (!scored.length) return null;
  return {
    runs: scored.length,
    meanFraction: mean(scored.map((h) => h.passed / h.total)),
    allPassShare: scored.filter((h) => h.passed === h.total).length / scored.length,
  };
}

const hasAutonomyData = (r) => typeof r.turns === 'number' && r.turns > 0;
const share = (xs, pred) => (xs.length ? xs.filter(pred).length / xs.length : null);

// Scored group of the autonomy tier (intended or invariant tests): mean fraction and the share of runs passing all.
function groupSummary(runs, field) {
  const scored = runs.map((r) => r[field]).filter((h) => h && h.total > 0);
  if (!scored.length) return null;
  return {
    runs: scored.length,
    meanFraction: mean(scored.map((h) => h.passed / h.total)),
    allPassShare: scored.filter((h) => h.passed === h.total).length / scored.length,
  };
}

/**
 * The autonomy tier, per arm and scope: how often the agent asked, how many scripted replies it needed, and what it got right.
 * Questions on no-question tasks are counted apart from unmatched questions on the other tasks, so no question is in both figures.
 * Cost and wall clock cover every turn of every executed run, failures included.
 */
function autonomySummary(executed, { noQuestionTasks, charged, outcome }) {
  const entries = executed.filter((e) => hasAutonomyData(e.result));
  if (!entries.length) return null;
  const runs = entries.map((e) => e.result);
  const onNoQuestion = entries.filter((e) => noQuestionTasks.has(e.taskId)).map((e) => e.result);
  const onOthers = entries.filter((e) => !noQuestionTasks.has(e.taskId)).map((e) => e.result);
  const sum = (xs, f) => xs.reduce((n, r) => n + (num(f(r)) ?? 0), 0);
  const good = entries.filter((e) => outcome(e) === 'good');
  const walls = runs.map((r) => num(r.wallClockMs)).filter((v) => v !== null);
  return {
    runs: runs.length,
    askedRuns: runs.filter((r) => r.questionsAsked > 0).length,
    askedRate: share(runs, (r) => r.questionsAsked > 0),
    askedFirstTurnRate: share(runs, (r) => r.askedFirstTurn === true),
    meanInterjections: avg(runs.map((r) => num(r.interjections) ?? 0)),
    noQuestionTasks: { runs: onNoQuestion.length, askedRuns: onNoQuestion.filter((r) => r.questionsAsked > 0).length, questions: sum(onNoQuestion, (r) => r.questionsAsked) },
    unmatchedQuestions: sum(onOthers, (r) => r.unmatchedQuestions),
    capHits: runs.filter((r) => r.interjectionCapHit === true).length,
    intended: groupSummary(runs, 'intendedTests'),
    invariants: groupSummary(runs, 'invariantTests'),
    completedWithoutHelpRate: share(runs, (r) => r.completedWithoutHelp === true),
    assumptionsStatedRate: share(runs, (r) => r.assumptionsStated === true),
    interjectionsPerSuccess: good.length ? sum(runs, (r) => r.interjections) / good.length : null,
    successfulRuns: good.length,
    costPerRun: avg(entries.map((e) => charged(e.result))),
    wallClockPerRunMs: avg(walls),
  };
}

// Post-run audit of the real class. Flagged runs are named, and a run whose audit failed counts as unchecked.
function contaminationSummary(executed) {
  const audited = executed.filter((e) => e.result.contamination);
  if (!audited.length) return null;
  const kindsOf = (c) => [...((c.externalFetch || []).length ? ['externalFetch'] : []), ...((c.fixRecallChars || 0) >= MIN_RECALL ? ['fixRecall'] : [])];
  const flagged = audited
    .map((e) => ({ taskId: e.taskId, replicate: e.replicate, kinds: kindsOf(e.result.contamination) }))
    .filter((f) => f.kinds.length)
    .sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : a.replicate - b.replicate));
  return {
    audited: audited.length,
    externalFetch: flagged.filter((f) => f.kinds.includes('externalFetch')).length,
    fixRecall: flagged.filter((f) => f.kinds.includes('fixRecall')).length,
    unchecked: audited.filter((e) => (e.result.flags || []).includes('contaminationUnchecked')).length,
    flagged,
  };
}

function buildCell(entries, { judges, rubricIdx, pairRecords, isBaseline, disagreeScore, notJudged = [], basis = BASIS['kiro-cli'], rawScoreOf = (rec) => rec.scoreRaw ?? rec.score, noQuestionTasks = new Set() }) {
  const charged = basis.charged;
  const executed = entries.filter((e) => e.result.status !== 'budget_skipped');
  const n = executed.length;
  const byStatus = { success: 0, timeout: 0, error: 0 };
  for (const e of executed) byStatus[e.result.status] = (byStatus[e.result.status] || 0) + 1;

  const outcome = new Map(executed.map((e) => [e, outcomeOf(e.result)]));
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, executed.filter((e) => outcome.get(e) === o).length]));
  const rates = Object.fromEntries(OUTCOMES.map((o) => [o, n ? counts[o] / n : null]));
  const good = executed.filter((e) => outcome.get(e) === 'good');
  const clean = counts.good + counts.checksFailed;
  const chargedVals = executed.map((e) => charged(e.result));
  const creditsTotal = chargedVals.reduce((s, v) => s + v, 0);
  const observedVals = executed.map((e) => basis.observed(e.result)).filter((v) => v !== null);
  const censoredRuns = executed.filter((e) => basis.censored(e.result)).length;
  const asked = executed.map((e) => e.result.askedUser).filter((v) => typeof v === 'boolean');
  const flagCounts = {};
  for (const e of executed) for (const f of e.result.flags || []) flagCounts[f] = (flagCounts[f] || 0) + 1;

  const perTask = new Map();
  for (const e of executed) perTask.set(e.taskId, (perTask.get(e.taskId) || 0) + 1);
  const minReplicates = perTask.size ? Math.min(...perTask.values()) : 0;

  // Success needs a clean finish; the pass rate also needs every check to pass.
  const series = {
    successRate: executed.map((e) => (outcome.get(e) === 'good' || outcome.get(e) === 'checksFailed' ? 1 : 0)),
    checkPassRate: executed.map((e) => (outcome.get(e) === 'good' ? 1 : 0)),
    [basis.perSuccess]: executed.map((e) => [charged(e.result), outcome.get(e) === 'good' ? 1 : 0]),
  };
  const efficiency = {};
  for (const [name, get] of Object.entries(basis.efficiency)) {
    const vals = good.map((e) => num(get(e.result))).filter((v) => v !== null);
    series[name] = vals;
    efficiency[name] = medianCI(vals);
    if (name === 'estTokens') efficiency[name].isEstimate = true;
  }

  // Autonomy series feed `compare`; they stay empty (and so are skipped there) for runs with no autonomy data.
  const withData = executed.filter((e) => hasAutonomyData(e.result));
  series.interjections = withData.map((e) => num(e.result.interjections)).filter((v) => v !== null);
  series.unmatchedQuestions = withData.map((e) => num(e.result.unmatchedQuestions)).filter((v) => v !== null);
  series.intendedFraction = withData.map((e) => e.result.intendedTests).filter((h) => h && h.total > 0).map((h) => h.passed / h.total);
  series.invariantFraction = withData.map((e) => e.result.invariantTests).filter((h) => h && h.total > 0).map((h) => h.passed / h.total);
  series.completedWithoutHelp = withData.map((e) => e.result.completedWithoutHelp).filter((v) => typeof v === 'boolean').map(Number);

  let rubric = null;
  const flags = [];
  if (judges.length) {
    const byJudge = {};
    const perRun = [];
    const diffs = [];
    for (const j of judges) byJudge[j] = { n: 0, mean: null, meanRaw: null, errors: 0 };
    const scoresByJudge = Object.fromEntries(judges.map((j) => [j, []]));
    const rawByJudge = Object.fromEntries(judges.map((j) => [j, []]));
    const perRunRaw = [];
    for (const e of executed) {
      const got = [];
      const gotRaw = [];
      for (const j of judges) {
        const rec = rubricIdx.get(`${j}|${e.armId}|${e.taskId}|${e.replicate}`);
        if (!rec) continue;
        if (rec.judgeError || rec.score === null) byJudge[j].errors++;
        else {
          const raw = rawScoreOf(rec);
          got.push(rec.score); scoresByJudge[j].push(rec.score);
          gotRaw.push(raw); rawByJudge[j].push(raw);
        }
      }
      if (got.length) { perRun.push(mean(got)); perRunRaw.push(mean(gotRaw)); }
      if (got.length > 1) diffs.push(Math.max(...got) - Math.min(...got));
    }
    for (const j of judges) {
      byJudge[j].n = scoresByJudge[j].length;
      byJudge[j].mean = avg(scoresByJudge[j]);
      byJudge[j].meanRaw = avg(rawByJudge[j]);
    }
    rubric = {
      byJudge,
      meanOfJudges: { n: perRun.length, mean: avg(perRun), meanRaw: avg(perRunRaw) },
      disagreement: { n: diffs.length, meanAbsDiff: avg(diffs), runsOver: diffs.filter((d) => d > disagreeScore).length },
    };
    series.rubricScore = perRun;
    if (rubric.disagreement.meanAbsDiff !== null && rubric.disagreement.meanAbsDiff > disagreeScore) {
      flags.push(`judges disagree: mean difference ${rubric.disagreement.meanAbsDiff.toFixed(2)} > ${disagreeScore} on ${diffs.length} run(s)`);
    }
  }

  let pairwise = null;
  if (pairRecords && !isBaseline) {
    const byJudge = Object.fromEntries(judges.map((j) => [j, tally(pairRecords.filter((r) => r.judge === j))]));
    pairwise = { byJudge, total: sumTallies(Object.values(byJudge)) };
  }

  const lowReplicates = n > 0 && minReplicates < MIN_REPLICATES;
  if (lowReplicates) flags.push(`fewer than ${MIN_REPLICATES} replicates per task (min ${minReplicates}); CIs are unreliable`);
  if (censoredRuns) {
    flags.push(basis.unit === 'usd'
      ? `${censoredRuns} run(s) ended before finishing; their usage is the partial session rows present at the kill, so cost and token figures are lower bounds`
      : `${censoredRuns} run(s) ended before their final metering event; their credits are missing or partial, so credit figures are lower bounds`);
  }
  for (const [name, count] of Object.entries(flagCounts)) flags.push(`${count} run(s) flagged ${name}`);
  if (n - counts.good > 0) flags.push(`${n - counts.good} of ${n} run(s) were not clean passes (${OUTCOMES.slice(1).filter((o) => counts[o]).map((o) => `${counts[o]} ${o}`).join(', ')}); efficiency medians use the ${counts.good} clean pass(es) only, the failure rates and credits per successful run include all`);
  const skippedJudge = notJudged.length;
  if (skippedJudge) flags.push(`${skippedJudge} run(s) not judged (${[...new Set(notJudged.map((x) => x.reason))].join(', ')}); they have no rubric or pairwise result`);

  const cell = {
    n, skipped: entries.length - n, byStatus, counts, rates,
    successRate: n ? clean / n : null,
    timeoutRate: rates.timeout,
    askedUserRate: asked.length ? asked.filter(Boolean).length / asked.length : null,
    flagCounts,
    checkPassRate: n ? counts.good / n : null,
    hidden: hiddenSummary(executed),
    regression: regressionSummary(executed),
    contamination: contaminationSummary(executed),
    minReplicates, lowReplicates, notJudged: skippedJudge,
    efficiencyRuns: good.length,
    [basis.unit === 'usd' ? 'cost' : 'credits']: {
      unit: basis.unit,
      total: creditsTotal,
      observedTotal: observedVals.reduce((s, v) => s + v, 0),
      missing: n - observedVals.length,
      censoredRuns,
      isLowerBound: censoredRuns > 0,
      successfulRuns: counts.good,
      perSuccessfulRun: counts.good ? creditsTotal / counts.good : null,
    },
    rubric, pairwise, efficiency, flags,
  };
  const autonomy = autonomySummary(executed, { noQuestionTasks, charged, outcome: (e) => outcome.get(e) });
  if (autonomy) cell.autonomy = autonomy;
  if (basis.unit === 'credits') cell.cost = cell.credits;
  return { cell, series };
}

const allPass = (checks) => Array.isArray(checks) && checks.length > 0 && checks.every((c) => c.passed);

// Runs whose checks were re-evaluated by `bench.js recheck`; the cell "pass" figures use those results.
function recheckSummary(runs) {
  const executed = runs.filter((r) => r.result.status !== 'budget_skipped');
  const done = executed.filter((r) => Array.isArray(r.result.checksOriginal));
  if (!done.length) return null;
  return {
    rechecked: done.length,
    runs: executed.length,
    flippedToPass: done.filter((r) => !allPass(r.result.checksOriginal) && allPass(r.result.checks)).length,
    flippedToFail: done.filter((r) => allPass(r.result.checksOriginal) && !allPass(r.result.checks)).length,
  };
}

// vanilla when the run has it; a run without vanilla (for example --no-vanilla) uses the release arm, then the first arm.
function defaultBaseline(run) {
  const oc = run.harness === 'opencode';
  const present = [...new Set((run.runs || []).map((r) => r.armId))];
  const prefer = [oc ? 'oc-vanilla' : 'vanilla', oc ? 'oc-v1.2.0' : 'v1.2.0'];
  return prefer.find((a) => present.includes(a)) ?? (present.length ? [...present].sort()[0] : prefer[0]);
}

function buildReport({ run, tasks, baseline = defaultBaseline(run), disagreeScore = 0.2 }) {
  const j = run.judgments;
  const judges = j?.judges || [];
  // A record made against an earlier wording of the task is left out of every mean and tally, and listed.
  const revisions = new Map([...tasks].map(([id, t]) => [id, taskRevision(t)]));
  const isStale = (r) => Boolean(r.taskRevision) && revisions.has(r.taskId) && r.taskRevision !== revisions.get(r.taskId);
  const stale = j ? [...j.rubric, ...j.pairwise].filter(isStale).map((r) => ({ kind: r.kind, judge: r.judge, armId: r.armId, taskId: r.taskId, replicate: r.replicate })) : [];
  const rubricIdx = new Map((j?.rubric || []).filter((r) => !isStale(r)).map((r) => [`${r.judge}|${r.armId}|${r.taskId}|${r.replicate}`, r]));
  const rawScoreOf = (rec) => rec.scoreRaw ?? rawFromCriteria(rec, tasks.get(rec.taskId));
  const classOf = (taskId) => tasks.get(taskId)?.class ?? 'unknown';
  const noQuestionTasks = new Set([...tasks].filter(([, t]) => t.autonomy?.noQuestionNeeded === true).map(([id]) => id));

  const armIds = [...new Set(run.runs.map((r) => r.armId))];
  const order = (run.config.armIds || []).filter((a) => armIds.includes(a));
  const arms = [...new Set([...(armIds.includes(baseline) ? [baseline] : []), ...order, ...armIds.sort()])];
  const classes = [...new Set(run.runs.map((r) => classOf(r.taskId)))].sort((a, b) => (CLASS_ORDER.indexOf(a) + 1 || 99) - (CLASS_ORDER.indexOf(b) + 1 || 99));

  const basis = BASIS[run.harness ?? 'kiro-cli'];
  const report = {
    schemaVersion: 1,
    harness: run.harness ?? 'kiro-cli',
    costUnit: basis.unit,
    run: { dir: run.dir, suite: run.config.suite ?? null, model: run.config.model ?? run.runs[0].result.model, effort: run.config.effort ?? run.runs[0].result.effort, taskIds: run.config.taskIds ?? [...new Set(run.runs.map((r) => r.taskId))].sort(), kiroCliVersion: run.runs[0].result.kiroCliVersion ?? null, harnessVersion: run.config.harnessVersion ?? run.runs[0].result.harnessVersion ?? run.runs[0].result.kiroCliVersion ?? null },
    baseline, judges, scopes: ['overall', ...classes], arms: {},
    judging: j ? judgingSummary(j, isStale, stale) : null,
    checksRecheck: recheckSummary(run.runs),
  };
  const series = {};
  for (const arm of arms) {
    report.arms[arm] = {};
    series[arm] = {};
    for (const scope of report.scopes) {
      const entries = run.runs.filter((r) => r.armId === arm && (scope === 'overall' || classOf(r.taskId) === scope));
      if (!entries.length) continue;
      const pairRecords = j ? j.pairwise.filter((r) => !isStale(r) && r.armId === arm && (scope === 'overall' || classOf(r.taskId) === scope)) : null;
      const built = buildCell(entries, { judges, rubricIdx, pairRecords, isBaseline: arm === baseline, disagreeScore, basis, rawScoreOf, noQuestionTasks, notJudged: (j?.notJudged || []).filter((x) => x.armId === arm && (scope === 'overall' || classOf(x.taskId) === scope)) });
      report.arms[arm][scope] = built.cell;
      series[arm][scope] = built.series;
    }
  }
  const startup = Object.fromEntries((run.config.arms || []).filter((a) => a.startupResources).map((a) => [a.id, a.startupResources]));
  const skills = summarizeSkills(rowsFromResults(run.runs, classOf, (id) => tasks.get(id)?.target ?? null), { armOrder: arms, startup });
  if (skills.recorded) report.skills = skills;
  return { report, series };
}

// Records written before verdictRaw existed keep the judge's own verdict in judgeVerdict when it was downgraded.
function rawFromCriteria(rec, task) {
  if (!task || !rec.criteria?.length) return rec.score;
  return rubricScore(task.rubric, rec.criteria.map((c) => ({ id: c.id, verdict: c.verdictRaw ?? c.judgeVerdict ?? c.verdict })));
}

function judgingSummary(j, isStale, stale) {
  const out = { byJudge: {}, positionInconsistent: 0, spentCredits: j.spentCredits ?? null, panel: j.panel ?? null, notJudged: j.notJudged || [], stale };
  for (const judge of j.judges) {
    const recs = [...j.rubric, ...j.pairwise].filter((r) => r.judge === judge && !isStale(r));
    const calls = recs.flatMap((r) => r.calls || []);
    const live = calls.filter((c) => !c.cached);
    // A cached call carries the latency measured when it ran live, so each call counts once.
    const lat = calls.map((c) => c.latencyMs).filter((v) => typeof v === 'number');
    const own = j.rubric.filter((r) => r.judge === judge && !isStale(r)).flatMap((r) => r.criteria);
    const evidence = own.filter((c) => c.evidenceFound !== null);
    out.byJudge[judge] = {
      records: recs.length,
      errors: recs.filter((r) => r.judgeError).length,
      calls: calls.length,
      cachedCalls: calls.length - live.length,
      parseFailures: recs.reduce((s, r) => s + (r.parseFailures || 0), 0),
      credits: j.spentByJudge?.[judge] ?? live.reduce((s, c) => s + (c.credits || 0), 0),
      medianLatencyMs: lat.length ? median(lat) : null,
      evidenceDowngraded: own.filter((c) => c.evidenceDowngraded).length,
      evidenceQuoteFoundRate: evidence.length ? evidence.filter((c) => c.evidenceFound).length / evidence.length : null,
      unverifiedQuoteRate: evidence.length ? evidence.filter((c) => !c.evidenceFound).length / evidence.length : null,
    };
  }
  out.positionInconsistent = j.pairwise.filter((r) => !isStale(r) && r.positionInconsistent).length;
  return out;
}

module.exports = { buildReport, defaultBaseline, outcomeOf, OUTCOMES, CLASS_ORDER, MIN_REPLICATES, EFFICIENCY, EFFICIENCY_OC, BASIS };
