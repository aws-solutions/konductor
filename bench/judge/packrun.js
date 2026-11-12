// SPDX-License-Identifier: Apache-2.0
'use strict';

// The quality-pack judging pass. It reads finished runs and writes judgments-quality.json beside judgments.json. It never
// reads or writes judgments.json, so the default rubric, pairwise and graded results and every report built from them are unchanged.

const fs = require('node:fs');
const path = require('node:path');
const { loadTasks, requireTasks } = require('../runner/lib/tasks.js');
const { runPool } = require('../runner/lib/orchestrate.js');
const { loadRun } = require('../report/load.js');
const { checkJudgeModel, checkPanel, families, effectiveLimits, maxPromptBytes: promptBytesFor } = require('./config.js');
const { buildBundle } = require('./bundle.js');
const { validateRubricReply, parseJsonStrict } = require('./validate.js');
const { withCache, hasCachedReply } = require('./model.js');
const { taskRevision, readAnswerKey } = require('./revision.js');
const { openLedger } = require('../runner/lib/credit-ledger.js');
const { BACKENDS, DEFAULT_BACKEND } = require('./backends.js');
const { judgeOnce, notJudgedReason, runKey, estimateSpend } = require('./run.js');
const { cacheSaltOf } = require('./opencode.js');
const { mergeRecords, addSpend } = require('./merge.js');
const pack = require('./pack/index.js');

const FILE = 'judgments-quality.json';

const readQuality = (runDir) => {
  const file = path.join(runDir, FILE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

/**
 * What a pass over a run would cost: per run, the criteria a judge is asked about. No model call.
 * Returns { runs: [{ key, judged, auto, absent, na, calls }], calls, notJudged }.
 */
function planPack({ run, tasks, benchDir, limits, explicitLimits = {}, redactions, thePack, judges }) {
  const plan = [];
  const notJudged = [];
  requireTasks(run.runs.filter((x) => x.result.status !== 'budget_skipped' && !notJudgedReason(x)).map((x) => x.taskId), tasks, benchDir);
  for (const r of run.runs.filter((x) => x.result.status !== 'budget_skipped')) {
    const why = notJudgedReason(r);
    if (why) { notJudged.push({ armId: r.armId, taskId: r.taskId, replicate: r.replicate, reason: why }); continue; }
    const task = tasks.get(r.taskId);
    const bundle = buildBundle({ runDir: r.dir, result: r.result, fixtureDir: task.fixtureDir, limits: effectiveLimits(task, limits, explicitLimits), redactions });
    const app = pack.applicability(thePack, task, bundle.files, { deleted: bundle.deleted });
    const count = (st) => app.criteria.filter((c) => c.status === st).length;
    plan.push({ run: r, task, bundle, app, judged: count('judged'), auto: count('auto'), absent: count('absent'), na: count('na'), calls: count('judged') ? judges.length : 0 });
  }
  return { plan, notJudged, calls: plan.reduce((n, p) => n + p.calls, 0) };
}

const judgedItemsOf = (p) => p.app.criteria.filter((c) => c.status === 'judged').map((c) => c.criterion);

function packPromptOf(p, redactions) {
  return pack.packPrompt({ task: p.task, answerKey: readAnswerKey(p.task.fixtureDir), bundleText: p.bundle.text, changesText: pack.redactedChanges(p.app.stats, redactions), criteria: judgedItemsOf(p) });
}

/** planPack plus what the CLI needs to show before a pass: backend, calls served by the cache, and the estimated spend. */
function describePackPlan(o) {
  const { run, judges, redactions, thePack } = o;
  const backend = o.backend ?? DEFAULT_BACKEND;
  if (!BACKENDS.includes(backend)) throw new Error(`unknown judge backend "${backend}" (${BACKENDS.join(' or ')})`);
  const usdMode = backend === 'opencode';
  const base = planPack(o);
  const salt = o.cacheSalt ?? (usdMode ? cacheSaltOf : null);
  const cacheDir = path.join(run.dir, 'judge', 'cache');
  const maxPromptBytes = promptBytesFor(backend);
  let cached = 0;
  let tooLarge = 0;
  const liveBy = new Map(judges.map((judge) => [judge, { judge, kind: 'pack', live: 0 }]));
  for (const p of base.plan.filter((x) => x.calls)) {
    const items = judgedItemsOf(p);
    const prompt = packPromptOf(p, redactions);
    const accept = (text) => { const parsed = parseJsonStrict(text); return parsed.ok && validateRubricReply(parsed.value, items).ok; };
    for (const judge of judges) {
      if (Buffer.byteLength(prompt) > maxPromptBytes) tooLarge++;
      else if (hasCachedReply(cacheDir, { model: judge, prompt, salt, accept })) cached++;
      else liveBy.get(judge).live++;
    }
  }
  const live = base.calls - cached - tooLarge;
  return { ...base, backend, thePack, judges, cached, tooLarge, live, estimate: estimateSpend({ judgments: readQuality(run.dir), usdMode, backend, liveCalls: live, liveUnits: [...liveBy.values()] }) };
}

async function runPackJudging(o) {
  if (o.plan) throw new Error('runPackJudging makes model calls and cannot honor --plan; call describePackPlan instead');
  const { runDir, benchDir, extraDirs = [], judges, concurrency, budgetCredits, budgetUsd = null, limits, explicitLimits = {}, redactions, log = () => {} } = o;
  const thePack = o.pack;
  const backend = o.backend ?? DEFAULT_BACKEND;
  if (!BACKENDS.includes(backend)) throw new Error(`unknown judge backend "${backend}" (${BACKENDS.join(' or ')})`);
  const usdMode = backend === 'opencode';
  if (usdMode && budgetCredits != null) throw new Error('--budget-credits does not apply to the opencode backend; use --budget-usd');
  if (!usdMode && budgetUsd != null) throw new Error('--budget-usd applies to the opencode backend only; use --budget-credits');
  const run = loadRun(runDir);
  const earlier = readQuality(run.dir);
  if (earlier && (earlier.backend ?? DEFAULT_BACKEND) !== backend) {
    throw new Error(`${runDir} already holds quality-pack judgments from the ${earlier.backend} backend; one backend per panel per study. Move ${FILE} aside or judge a copy.`);
  }
  if (earlier && earlier.pack.id !== thePack.id) throw new Error(`${FILE} holds pack "${earlier.pack.id}", not "${thePack.id}"`);
  const tasks = loadTasks(benchDir, { extraDirs });
  const subject = o.subjectModel ?? run.config.model ?? run.runs[0].result.model;
  judges.forEach((j) => checkJudgeModel(j, subject));
  checkPanel(judges);
  const salt = o.cacheSalt ?? (usdMode ? (model) => `${backend}\n${model}` : null);
  const caller = withCache(o.caller, path.join(run.dir, 'judge', 'cache'), { salt });
  // A ledger of its own: the study ledger in the results directory feeds the default report, which must not change.
  const study = o.ledger ?? openLedger({ dir: path.join(run.dir, 'judge', 'quality-pack'), budget: usdMode ? budgetUsd : budgetCredits, budgetUnit: usdMode ? 'usd' : 'credits' });

  const { plan, notJudged, calls: plannedCalls } = planPack({ run, tasks, benchDir, limits, explicitLimits, redactions, thePack, judges });
  for (const n of notJudged) log(`not judged ${runKey(n)}: ${n.reason}`);
  log(`quality pack ${thePack.id} (revision ${thePack.revision}): ${plan.length} run(s), ${plannedCalls} judge call(s) planned (${plan.filter((p) => p.calls).length} run(s) x ${judges.length} judge(s)); the other criteria are scored without a call`);

  const units = [];
  for (const judge of judges) for (const p of plan) units.push({ judge, p });
  const maxPromptBytes = promptBytesFor(backend);
  let spent = 0;
  let spentUsd = 0;
  const spentByJudge = {};
  const spentUsdByJudge = {};

  const worker = async ({ judge, p }) => {
    const judgedItems = judgedItemsOf(p);
    if (!judgedItems.length) return { skipped: true, calls: [], parseFailures: 0 };
    const prompt = packPromptOf(p, redactions);
    const out = await judgeOnce({ caller, model: judge, prompt, maxPromptBytes, check: (v) => validateRubricReply(v, judgedItems) });
    const live = out.calls.filter((c) => !c.cached).reduce((s, c) => s + (c.credits ?? 0), 0);
    const liveUsd = out.calls.filter((c) => !c.cached).reduce((s, c) => s + (c.usd || 0), 0);
    spent += live; spentUsd += liveUsd;
    spentByJudge[judge] = (spentByJudge[judge] || 0) + live;
    spentUsdByJudge[judge] = (spentUsdByJudge[judge] || 0) + liveUsd;
    for (const c of out.calls) {
      study.record({ kind: 'judge', unit: usdMode ? 'usd' : 'credits', judge, mode: 'quality-pack', arm: p.run.armId, task: p.run.taskId, replicate: p.run.replicate, credits: c.cached ? 0 : c.credits, ...(usdMode ? { usd: c.cached ? 0 : (c.usd ?? null), tokens: c.cached ? null : (c.tokens ?? null) } : {}), cached: Boolean(c.cached), ok: c.ok });
    }
    log(`judged quality ${judge} ${runKey(p.run)}: ${out.error ? `ERROR ${out.error}` : 'ok'}; ${study.line()}`);
    return out;
  };
  const onSkip = () => ({ error: `budget reached (${study.stopReason() ?? (usdMode ? `$${budgetUsd}` : `${budgetCredits} credits`)})`, calls: [], parseFailures: 0 });
  const outs = await runPool(units, concurrency, worker, () => study.shouldStop(), onSkip);

  const records = units.map(({ judge, p }, i) => {
    const out = outs[i];
    const items = p.app.criteria;
    const judgedItems = items.filter((c) => c.status === 'judged').map((c) => c.criterion);
    const replied = out.error || out.skipped ? [] : pack.scoreReply(out.value.criteria, judgedItems, p.bundle.text, readAnswerKey(p.task.fixtureDir));
    const criteria = [...replied, ...pack.absentCriteria(items), ...pack.autoCriteria(thePack, items)];
    const failed = Boolean(out.error);
    return {
      judge, armId: p.run.armId, taskId: p.run.taskId, replicate: p.run.replicate,
      taskRevision: taskRevision(p.task), packRevision: thePack.revision,
      artifacts: { declared: p.app.declared, present: Object.entries(p.app.state).filter(([, v]) => v.s === 'present').map(([k]) => k) },
      criteria: failed ? [...pack.absentCriteria(items), ...pack.autoCriteria(thePack, items)] : criteria,
      na: items.filter((c) => c.status === 'na').map((c) => ({ id: c.criterion.id, dimension: c.criterion.dimension, reason: c.reason })),
      dimensions: failed ? null : pack.dimensionScores(thePack, criteria),
      judgeError: out.error ?? null, parseFailures: out.parseFailures, calls: out.calls,
      redactionsFired: p.bundle.fired, truncatedFiles: p.bundle.meta.truncatedFiles,
    };
  });

  const merged = mergeAndWrite(run, earlier, { thePack, judges, backend, limits, spent, spentUsd, spentByJudge, spentUsdByJudge, records, notJudged, calls: outs.flatMap((x) => x.calls || []), subjectModel: o.subjectModel ?? null, backendInfo: o.backendInfo ?? null });
  return { ...merged, plannedCalls, ledgerLine: study.line(), guardState: study.state() };
}

function mergeAndWrite(run, prev, { thePack, judges, backend, limits, spent, spentUsd, spentByJudge, spentUsdByJudge, records, notJudged, calls, backendInfo }) {
  const usd = backend === 'opencode';
  const allJudges = [...new Set([...(prev?.judges || []), ...judges])].sort();
  const out = {
    schemaVersion: 1,
    kind: 'quality-pack',
    pack: { id: thePack.id, revision: thePack.revision },
    createdAt: new Date().toISOString(),
    backend,
    ...(backendInfo ? { backendInfo: { ...(prev?.backendInfo || {}), ...backendInfo, models: { ...(prev?.backendInfo?.models || {}), ...(backendInfo.models || {}) } } } : {}),
    judges: allJudges,
    panel: { families: families(allJudges) },
    limits,
    spentCredits: (prev?.spentCredits || 0) + spent,
    spentByJudge: addSpend(prev?.spentByJudge, spentByJudge),
    ...(usd ? { spentUsd: (prev?.spentUsd || 0) + spentUsd, spentUsdByJudge: addSpend(prev?.spentUsdByJudge, spentUsdByJudge) } : {}),
    invocations: [...(prev?.invocations || []), { at: new Date().toISOString(), judges, spentCredits: spent, ...(usd ? { spentUsd } : {}), calls: calls.length, cachedCalls: calls.filter((c) => c.cached).length }],
    notJudged,
    records: mergeRecords(prev?.records || [], records),
  };
  fs.writeFileSync(path.join(run.dir, FILE), JSON.stringify(out, null, 2) + '\n');
  return out;
}

module.exports = { runPackJudging, planPack, describePackPlan, readQuality, FILE };
