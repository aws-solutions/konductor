// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadTasks } = require('../runner/lib/tasks.js');
const { runPool } = require('../runner/lib/orchestrate.js');
const { loadRun } = require('../report/load.js');
const { checkJudgeModel, checkPanel, families, effectiveLimits } = require('./config.js');
const { buildBundle } = require('./bundle.js');
const { rubricPrompt, pairPrompt, gradedPrompt, retrySuffix } = require('./prompts.js');
const { parseJsonStrict, validateRubricReply, validatePairReply, validateGradedReply } = require('./validate.js');
const { rubricScore, pairOutcome, combineOrderings, combineGraded, DOWNGRADE } = require('./score.js');
const { withCache, hasCachedReply } = require('./model.js');
const { cacheSaltOf } = require('./opencode.js');
const { makeQuoteMatcher } = require('./quote.js');
const { taskRevision, readAnswerKey } = require('./revision.js');
const { openLedger } = require('../runner/lib/credit-ledger.js');
const { BACKENDS, DEFAULT_BACKEND } = require('./backends.js');
const { mergeRecords, addSpend } = require('./merge.js');
const { loadObserved, estimateFromObserved } = require('./observed-cost.js');

const MAX_PROMPT_BYTES = 120000; // one argv string is capped near 128 KiB on Linux; the opencode backend reads the prompt from stdin

const runKey = (r) => `${r.armId}|${r.taskId}|${r.replicate}`;

// Runs whose output is not a fair basis for scoring: setup or post-run infrastructure failed, or no workspace was kept.
function notJudgedReason(r) {
  if (r.result.infraError) return 'infraError';
  if (!fs.existsSync(path.join(r.dir, 'workspace')) || (r.result.flags || []).includes('snapshotFailed')) return 'no workspace';
  return null;
}

// One judged answer: call, validate, retry once with a short correction on a bad reply.
async function judgeOnce({ caller, model, prompt, check, maxPromptBytes = MAX_PROMPT_BYTES }) {
  const calls = [];
  let parseFailures = 0;
  let p = prompt;
  let reason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Buffer.byteLength(p) > maxPromptBytes) return { error: 'prompt too large for one argument; lower the bundle limits', calls, parseFailures };
    const r = await caller({ model, prompt: p, accept: (text) => { const parsed = parseJsonStrict(text); return parsed.ok && check(parsed.value).ok; } });
    calls.push({
      credits: r.credits === undefined ? 0 : r.credits, latencyMs: r.latencyMs ?? null, cached: Boolean(r.cached), ...(r.cached ? { originalCredits: r.originalCredits ?? null } : {}),
      ...(r.usd !== undefined ? { usd: r.usd, ...(r.cached ? { originalUsd: r.originalUsd ?? null } : {}), tokens: r.tokens ?? null, ...(r.retries ? { retries: r.retries } : {}) } : {}),
      ok: !r.error,
    });
    if (r.error) return { error: r.error, calls, parseFailures };
    const parsed = parseJsonStrict(r.text);
    const checked = parsed.ok ? check(parsed.value) : parsed;
    if (checked.ok) return { value: checked, calls, parseFailures };
    parseFailures++;
    calls[calls.length - 1].ok = false;
    reason = checked.error;
    p = prompt + retrySuffix(reason);
  }
  return { error: `unusable after retry: ${reason}`, calls, parseFailures };
}

/**
 * Everything a judging pass decides before it calls anything: the checks on the backend and panel, the bundles, and the
 * list of calls. `judge --plan` stops here; runJudging goes on to make the calls.
 */
function prepareJudging(o) {
  const { runDir, benchDir, extraDirs = [], judges, modes, baseline, budgetCredits, budgetUsd = null, limits, explicitLimits = {}, redactions, log = () => {} } = o;
  const backend = o.backend ?? DEFAULT_BACKEND;
  if (!BACKENDS.includes(backend)) throw new Error(`unknown judge backend "${backend}" (${BACKENDS.join(' or ')})`);
  const usdMode = backend === 'opencode';
  if (usdMode && budgetCredits != null) throw new Error('--budget-credits does not apply to the opencode backend; use --budget-usd');
  if (!usdMode && budgetUsd != null) throw new Error('--budget-usd applies to the opencode backend only; use --budget-credits');
  const run = loadRun(runDir);
  // Verdicts from two backends are not comparable, so one results directory keeps one. Files from before the label existed are kiro.
  const earlier = run.judgments ? (run.judgments.backend ?? DEFAULT_BACKEND) : null;
  if (earlier && earlier !== backend) {
    throw new Error(`${runDir} was already judged on the ${earlier} backend; cannot add ${backend} judgments to it (one backend per panel per study). Judge a copy of the directory, or move judgments.json aside.`);
  }
  const tasks = loadTasks(benchDir, { extraDirs });
  const subject = o.subjectModel ?? run.config.model ?? run.runs[0].result.model;
  judges.forEach((j) => checkJudgeModel(j, subject));
  checkPanel(judges);

  const candidates = run.runs.filter((r) => r.result.status !== 'budget_skipped');
  const notJudged = candidates.map((r) => ({ armId: r.armId, taskId: r.taskId, replicate: r.replicate, reason: notJudgedReason(r) })).filter((r) => r.reason);
  const skipKeys = new Set(notJudged.map(runKey));
  const judged = candidates.filter((r) => !skipKeys.has(runKey(r)));
  for (const n of notJudged) log(`not judged ${runKey(n)}: ${n.reason}`);
  const bundles = new Map();
  for (const r of judged) {
    const task = tasks.get(r.taskId);
    if (!task) throw new Error(`task "${r.taskId}" is not in ${benchDir}/tasks`);
    bundles.set(runKey(r), buildBundle({ runDir: r.dir, result: r.result, fixtureDir: task.fixtureDir, limits: effectiveLimits(task, limits, explicitLimits), redactions }));
  }
  const byKey = new Map(judged.map((r) => [runKey(r), r]));
  const revisions = new Map(judged.map((r) => [r.taskId, taskRevision(tasks.get(r.taskId))]));

  const units = [];
  const pairErrors = [];
  const gradedErrors = [];
  for (const judge of judges) {
    for (const r of judged) {
      if (modes.includes('rubric')) units.push({ kind: 'rubric', judge, run: r });
      if (modes.includes('pairwise') && r.armId !== baseline) {
        const base = byKey.get(`${baseline}|${r.taskId}|${r.replicate}`);
        if (!base) pairErrors.push({ judge, run: r });
        else for (const order of [1, 2]) units.push({ kind: 'pair', judge, run: r, base, order });
      }
      if (modes.includes('graded') && r.armId !== baseline) {
        const base = byKey.get(`${baseline}|${r.taskId}|${r.replicate}`);
        if (!base) gradedErrors.push({ judge, run: r });
        else for (const order of [1, 2]) units.push({ kind: 'graded', judge, run: r, base, order });
      }
    }
  }

  // Under a budget cap the rubric calls come first so every judge covers every run before any pairwise call is spent.
  units.sort((a, b) => (a.kind === 'rubric' ? 0 : 1) - (b.kind === 'rubric' ? 0 : 1));

  // The prompt of a call and the check its reply must pass. The pass and its plan build them the same way.
  const specOf = (u) => {
    const task = tasks.get(u.run.taskId);
    const answerKey = readAnswerKey(task.fixtureDir);
    if (u.kind === 'rubric') {
      return { prompt: rubricPrompt({ task, answerKey, bundleText: bundles.get(runKey(u.run)).text }), check: (v) => validateRubricReply(v, task.rubric) };
    }
    // Order 1 puts the baseline in position A; order 2 swaps. Pairwise and graded modes share the layout.
    const mine = bundles.get(runKey(u.run)).text;
    const theirs = bundles.get(runKey(u.base)).text;
    const [bundleA, bundleB] = u.order === 1 ? [theirs, mine] : [mine, theirs];
    if (u.kind === 'graded') return { prompt: gradedPrompt({ task, answerKey, bundleA, bundleB }), check: validateGradedReply };
    return { prompt: pairPrompt({ task, answerKey, bundleA, bundleB }), check: validatePairReply };
  };
  return { run, tasks, backend, usdMode, judged, notJudged, bundles, revisions, units, pairErrors, gradedErrors, specOf };
}

/** Mean live cost of one call over the earlier invocations recorded in a judgments file, or null when none are usable. */
function observedCostPerCall(judgments, usdMode) {
  let live = 0;
  let spend = 0;
  for (const inv of judgments?.invocations || []) {
    live += (inv.calls || 0) - (inv.cachedCalls || 0);
    spend += usdMode ? (inv.spentUsd || 0) : (inv.spentCredits || 0);
  }
  return live > 0 && spend > 0 ? spend / live : null;
}

/**
 * The estimate for `liveCalls` calls. `liveUnits` ([{ judge, kind, live }]) says which judge and pass each live call is.
 * Source, in order: this run directory's own earlier judging (its mean per live call; the high end scales it by the observed
 * p90 to mean ratio), the shipped observed-cost data, then unknown. `low` is the mean total and `high` the all-calls-at-p90 total.
 */
function estimateSpend({ judgments, usdMode, liveCalls, liveUnits = null, backend = null, observed }) {
  const unit = usdMode ? 'usd' : 'credits';
  const be = backend ?? (usdMode ? 'opencode' : 'kiro');
  const data = observed === undefined ? loadObserved() : observed;
  const units = liveUnits ?? [{ judge: '*', kind: '*', live: liveCalls }];
  const fromData = liveCalls > 0 ? estimateFromObserved(data, be, units) : { low: 0, high: 0, measuredOn: null, observedCalls: 0 };
  const own = observedCostPerCall(judgments, usdMode);
  if (own !== null) {
    const total = own * liveCalls;
    const ratio = fromData && fromData.high !== null && fromData.low > 0 ? fromData.high / fromData.low : null;
    return { unit, perCall: own, total, low: total, high: ratio === null ? null : total * ratio, source: 'history', basis: 'the mean live call cost in this directory\'s earlier judging' };
  }
  if (liveCalls === 0) return { unit, perCall: 0, total: 0, low: 0, high: 0, source: 'none', basis: 'no live calls to pay for' };
  if (fromData) {
    return {
      unit, perCall: liveCalls ? fromData.low / liveCalls : 0, total: fromData.low, low: fromData.low, high: fromData.high, source: 'observed',
      basis: `observed spend in ${fromData.observedCalls} live calls of earlier studies (measured ${fromData.measuredOn ?? 'on an unknown date'})`,
    };
  }
  return { unit, perCall: null, total: null, low: null, high: null, source: 'none', basis: `unknown: no earlier judging in this directory and no observed cost for the ${be} backend` };
}

/**
 * What runJudging would do, computed without a model caller: calls per mode, calls already served by the cache, the
 * estimated spend and the prompts too large to send. It writes nothing.
 */
function planJudging(o) {
  const p = prepareJudging(o);
  const { usdMode, run } = p;
  const salt = o.cacheSalt ?? (usdMode ? cacheSaltOf : null);
  const cacheDir = path.join(run.dir, 'judge', 'cache');
  const maxPromptBytes = usdMode ? Infinity : MAX_PROMPT_BYTES;
  const byMode = { rubric: 0, pairwise: 0, graded: 0 };
  let cached = 0;
  let tooLarge = 0;
  const liveBy = new Map();
  for (const u of p.units) {
    const kind = u.kind === 'pair' ? 'pairwise' : u.kind;
    byMode[kind]++;
    const { prompt, check } = p.specOf(u);
    if (Buffer.byteLength(prompt) > maxPromptBytes) { tooLarge++; continue; }
    const accept = (text) => { const parsed = parseJsonStrict(text); return parsed.ok && check(parsed.value).ok; };
    if (hasCachedReply(cacheDir, { model: u.judge, prompt, salt, accept })) cached++;
    else liveBy.set(`${u.judge}|${kind}`, { judge: u.judge, kind, live: (liveBy.get(`${u.judge}|${kind}`)?.live ?? 0) + 1 });
  }
  const calls = p.units.length;
  return {
    backend: p.backend, judges: o.judges, modes: o.modes, baseline: o.baseline, runs: p.judged.length, notJudged: p.notJudged,
    calls, byMode, cached, live: calls - cached - tooLarge, tooLarge,
    unpaired: p.pairErrors.length + p.gradedErrors.length,
    estimate: estimateSpend({ judgments: run.judgments, usdMode, backend: p.backend, liveCalls: calls - cached - tooLarge, liveUnits: [...liveBy.values()] }),
  };
}

async function runJudging(o) {
  if (o.plan) throw new Error('runJudging makes model calls and cannot honor --plan; call planJudging instead');
  const { concurrency, budgetCredits, budgetUsd = null, judges, modes, baseline, limits, redactions, log = () => {} } = o;
  const backendInfo = o.backendInfo ?? null;
  const { run, tasks, backend, usdMode, notJudged, bundles, revisions, units, pairErrors, gradedErrors, specOf } = prepareJudging(o);
  // Kiro keeps the original cache key. Any other backend adds itself (and what its caller says matters) to the key.
  const salt = o.cacheSalt ?? (usdMode ? (model) => `${backend}\n${model}` : null);
  const caller = withCache(o.caller, path.join(run.dir, 'judge', 'cache'), { salt });
  // Every call is a ledger line. A budget turns the ledger into a guard that stops new calls at 90% of it.
  const study = o.ledger ?? openLedger({ dir: run.dir, budget: usdMode ? budgetUsd : budgetCredits, budgetUnit: usdMode ? 'usd' : 'credits' });

  let spent = 0;
  let spentUsd = 0;
  const spentByJudge = {};
  const spentUsdByJudge = {};
  const maxPromptBytes = usdMode ? Infinity : MAX_PROMPT_BYTES;
  const worker = async (u) => {
    const { prompt, check } = specOf(u);
    const out = await judgeOnce({ caller, model: u.judge, prompt, maxPromptBytes, check });
    const live = out.calls.filter((c) => !c.cached).reduce((s, c) => s + (c.credits ?? 0), 0);
    spent += live;
    spentByJudge[u.judge] = (spentByJudge[u.judge] || 0) + live;
    const liveUsd = out.calls.filter((c) => !c.cached).reduce((s, c) => s + (c.usd || 0), 0);
    spentUsd += liveUsd;
    spentUsdByJudge[u.judge] = (spentUsdByJudge[u.judge] || 0) + liveUsd;
    for (const c of out.calls) {
      study.record({
        kind: 'judge', unit: usdMode ? 'usd' : 'credits', judge: u.judge, mode: u.kind === 'pair' ? 'pairwise' : u.kind, arm: u.run.armId, task: u.run.taskId, replicate: u.run.replicate, ...(u.order ? { order: u.order } : {}),
        credits: c.cached ? 0 : c.credits, ...(usdMode ? { usd: c.cached ? 0 : (c.usd ?? null), tokens: c.cached ? null : (c.tokens ?? null) } : {}), cached: Boolean(c.cached), ok: c.ok,
      });
    }
    log(`judged ${u.kind} ${u.judge} ${runKey(u.run)}${u.order ? ` order ${u.order}` : ''}: ${out.error ? `ERROR ${out.error}` : 'ok'}; ${study.line()}`);
    return out;
  };
  const onSkip = () => ({ error: `budget reached (${study.stopReason() ?? (usdMode ? `$${budgetUsd}` : `${budgetCredits} credits`)})`, calls: [], parseFailures: 0 });
  const outs = await runPool(units, concurrency, worker, () => study.shouldStop(), onSkip);

  const rubric = [];
  const pairs = new Map();
  const gradedMap = new Map();
  units.forEach((u, i) => {
    const out = outs[i];
    const bundle = bundles.get(runKey(u.run));
    const common = { judge: u.judge, armId: u.run.armId, taskId: u.run.taskId, replicate: u.run.replicate };
    if (u.kind === 'rubric') {
      const task = tasks.get(u.run.taskId);
      const found = makeQuoteMatcher(bundle.text);
      const criteria = out.error ? [] : out.value.criteria.map((c) => {
        // "(nothing in the output)" cites no evidence, so a pass or partial that rests on it drops a level like an unfound quote.
        const evidenceFound = /^\(nothing in the output\)/i.test(c.evidence) ? false : found(c.evidence);
        const downgraded = evidenceFound === false && c.verdict !== 'fail';
        const verdictScored = downgraded ? DOWNGRADE[c.verdict] : c.verdict;
        return { id: c.id, verdict: verdictScored, verdictRaw: c.verdict, verdictScored, evidence: c.evidence, evidenceFound, ...(downgraded ? { evidenceDowngraded: true } : {}) };
      });
      rubric.push({
        kind: 'rubric', ...common, taskRevision: revisions.get(task.id),
        score: out.error ? null : rubricScore(task.rubric, criteria),
        scoreRaw: out.error ? null : rubricScore(task.rubric, criteria.map((c) => ({ id: c.id, verdict: c.verdictRaw }))), criteria,
        judgeError: out.error ?? null, parseFailures: out.parseFailures, calls: out.calls,
        redactionsFired: bundle.fired, truncatedFiles: bundle.meta.truncatedFiles,
      });
    } else if (u.kind === 'graded') {
      const key = `${u.judge}|${runKey(u.run)}`;
      const rec = gradedMap.get(key) || { kind: 'graded', ...common, taskRevision: revisions.get(u.run.taskId), baselineId: baseline, orderings: [null, null], reasons: [], errors: [], parseFailures: 0, calls: [], redactionsFired: bundle.fired };
      if (out.error) rec.errors.push(out.error);
      else {
        // Order 1 has the baseline in A; order 2 has the arm in A.
        const armIsA = u.order === 2;
        rec.orderings[u.order - 1] = armIsA ? { armGrade: out.value.gradeA, baseGrade: out.value.gradeB } : { armGrade: out.value.gradeB, baseGrade: out.value.gradeA };
        rec.reasons.push(out.value.reason);
      }
      rec.parseFailures += out.parseFailures;
      rec.calls.push(...out.calls);
      gradedMap.set(key, rec);
    } else {
      const key = `${u.judge}|${runKey(u.run)}`;
      const rec = pairs.get(key) || { kind: 'pairwise', ...common, taskRevision: revisions.get(u.run.taskId), baselineId: baseline, orderings: [null, null], reasons: [], errors: [], parseFailures: 0, calls: [], redactionsFired: bundle.fired };
      if (out.error) rec.errors.push(out.error);
      else {
        rec.orderings[u.order - 1] = pairOutcome(out.value.winner, u.order === 2);
        rec.reasons.push(out.value.reason);
      }
      rec.parseFailures += out.parseFailures;
      rec.calls.push(...out.calls);
      pairs.set(key, rec);
    }
  });
  const pairwise = [...pairs.values()].map(({ errors, ...rec }) => {
    const { verdict, positionInconsistent } = combineOrderings(rec.orderings[0], rec.orderings[1]);
    return { ...rec, verdict, positionInconsistent, judgeError: errors.length ? errors.join('; ') : null };
  });
  const graded = [...gradedMap.values()].map(({ errors, ...rec }) => ({ ...rec, ...combineGraded(rec.orderings[0], rec.orderings[1]), judgeError: errors.length ? errors.join('; ') : null }));
  for (const { judge, run: r } of gradedErrors) {
    graded.push({ kind: 'graded', judge, armId: r.armId, taskId: r.taskId, replicate: r.replicate, baselineId: baseline, orderings: [null, null], reasons: [], parseFailures: 0, calls: [], redactionsFired: {}, ...combineGraded(null, null), judgeError: `no baseline run (${baseline}) for this task and replicate` });
  }
  for (const { judge, run: r } of pairErrors) {
    pairwise.push({ kind: 'pairwise', judge, armId: r.armId, taskId: r.taskId, replicate: r.replicate, baselineId: baseline, verdict: null, positionInconsistent: false, orderings: [null, null], reasons: [], parseFailures: 0, calls: [], redactionsFired: {}, judgeError: `no baseline run (${baseline}) for this task and replicate` });
  }

  const judgments = mergeAndWrite(run, { judges, modes, baseline, limits, spent, spentByJudge, backend, backendInfo, spentUsd, spentUsdByJudge, rubric, pairwise, graded, notJudged, calls: outs.flatMap((o) => o.calls), smallPanel: Boolean(o.smallPanel) });
  return { ...judgments, ledgerLine: study.line(), guardState: study.state() };
}

// A rerun with other judges or modes keeps earlier records; a record is replaced by the same (judge, run, kind).
// Spend accumulates across invocations: cached calls cost 0 now, so replacing a record never erases earlier spend.
function mergeAndWrite(run, { judges, modes, baseline, limits, spent, spentByJudge, backend, backendInfo, spentUsd, spentUsdByJudge, rubric, pairwise, graded = [], notJudged, calls, smallPanel }) {
  const file = path.join(run.dir, 'judgments.json');
  const prev = run.judgments || { rubric: [], pairwise: [], graded: [], judges: [], modes: [] };
  const byJudge = addSpend(prev.spentByJudge, spentByJudge);
  const allJudges = [...new Set([...prev.judges, ...judges])].sort();
  const usd = backend === 'opencode';
  const byJudgeUsd = addSpend(prev.spentUsdByJudge, spentUsdByJudge);
  const out = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    subjectModel: run.config.model ?? null,
    baseline,
    backend,
    ...(backendInfo ? { backendInfo: { ...(prev.backendInfo || {}), ...backendInfo, models: { ...(prev.backendInfo?.models || {}), ...(backendInfo.models || {}) } } } : {}),
    judges: allJudges,
    modes: [...new Set([...prev.modes, ...modes])].sort(),
    limits,
    panel: { families: families(allJudges), small: Boolean(prev.panel?.small || smallPanel) },
    spentCredits: (prev.spentCredits || 0) + spent,
    spentByJudge: byJudge,
    ...(usd ? { spentUsd: (prev.spentUsd || 0) + spentUsd, spentUsdByJudge: byJudgeUsd } : {}),
    invocations: [...(prev.invocations || []), { at: new Date().toISOString(), judges, modes, spentCredits: spent, ...(usd ? { spentUsd } : {}), calls: calls.length, cachedCalls: calls.filter((c) => c.cached).length }],
    notJudged,
    rubric: mergeRecords(prev.rubric, rubric),
    pairwise: mergeRecords(prev.pairwise, pairwise),
    graded: mergeRecords(prev.graded || [], graded),
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return out;
}

module.exports = { runJudging, planJudging, estimateSpend, judgeOnce, notJudgedReason, runKey, MAX_PROMPT_BYTES };
