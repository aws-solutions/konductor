// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadTasks } = require('../runner/lib/tasks.js');
const { runPool } = require('../runner/lib/orchestrate.js');
const { loadRun } = require('../report/load.js');
const { checkJudgeModel, checkPanel, families } = require('./config.js');
const { buildBundle } = require('./bundle.js');
const { rubricPrompt, pairPrompt, retrySuffix } = require('./prompts.js');
const { parseJsonStrict, validateRubricReply, validatePairReply } = require('./validate.js');
const { rubricScore, pairOutcome, combineOrderings } = require('./score.js');
const { withCache } = require('./model.js');
const { makeQuoteMatcher } = require('./quote.js');
const { taskRevision, readAnswerKey } = require('./revision.js');

const MAX_PROMPT_BYTES = 120000; // one argv string is capped near 128 KiB on Linux

const runKey = (r) => `${r.armId}|${r.taskId}|${r.replicate}`;
// A quote that is not in the bundle weakens the verdict one level. The judge's own verdict is kept as verdictRaw.
const DOWNGRADE = { pass: 'partial', partial: 'fail', fail: 'fail' };

// Runs whose output is not a fair basis for scoring: setup or post-run infrastructure failed, or no workspace was kept.
function notJudgedReason(r) {
  if (r.result.infraError) return 'infraError';
  if (!fs.existsSync(path.join(r.dir, 'workspace')) || (r.result.flags || []).includes('snapshotFailed')) return 'no workspace';
  return null;
}

// One judged answer: call, validate, retry once with a short correction on a bad reply.
async function judgeOnce({ caller, model, prompt, check }) {
  const calls = [];
  let parseFailures = 0;
  let p = prompt;
  let reason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Buffer.byteLength(p) > MAX_PROMPT_BYTES) return { error: 'prompt too large for one argument; lower the bundle limits', calls, parseFailures };
    const r = await caller({ model, prompt: p });
    calls.push({ credits: r.credits ?? 0, latencyMs: r.latencyMs ?? null, cached: Boolean(r.cached), ...(r.cached ? { originalCredits: r.originalCredits ?? null } : {}), ok: !r.error });
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

async function runJudging(o) {
  const { runDir, benchDir, judges, modes, baseline, concurrency, budgetCredits, limits, redactions, log = () => {} } = o;
  const run = loadRun(runDir);
  const tasks = loadTasks(benchDir);
  const subject = o.subjectModel ?? run.config.model ?? run.runs[0].result.model;
  judges.forEach((j) => checkJudgeModel(j, subject));
  checkPanel(judges);
  const caller = withCache(o.caller, path.join(run.dir, 'judge', 'cache'));

  const candidates = run.runs.filter((r) => r.result.status !== 'budget_skipped');
  const notJudged = candidates.map((r) => ({ armId: r.armId, taskId: r.taskId, replicate: r.replicate, reason: notJudgedReason(r) })).filter((r) => r.reason);
  const skipKeys = new Set(notJudged.map(runKey));
  const judged = candidates.filter((r) => !skipKeys.has(runKey(r)));
  for (const n of notJudged) log(`not judged ${runKey(n)}: ${n.reason}`);
  const bundles = new Map();
  for (const r of judged) {
    const task = tasks.get(r.taskId);
    if (!task) throw new Error(`task "${r.taskId}" is not in ${benchDir}/tasks`);
    bundles.set(runKey(r), buildBundle({ runDir: r.dir, result: r.result, fixtureDir: task.fixtureDir, limits, redactions }));
  }
  const byKey = new Map(judged.map((r) => [runKey(r), r]));
  const revisions = new Map(judged.map((r) => [r.taskId, taskRevision(tasks.get(r.taskId))]));

  const units = [];
  const pairErrors = [];
  for (const judge of judges) {
    for (const r of judged) {
      if (modes.includes('rubric')) units.push({ kind: 'rubric', judge, run: r });
      if (modes.includes('pairwise') && r.armId !== baseline) {
        const base = byKey.get(`${baseline}|${r.taskId}|${r.replicate}`);
        if (!base) pairErrors.push({ judge, run: r });
        else for (const order of [1, 2]) units.push({ kind: 'pair', judge, run: r, base, order });
      }
    }
  }

  // Under a budget cap the rubric calls come first so every judge covers every run before any pairwise call is spent.
  units.sort((a, b) => (a.kind === 'rubric' ? 0 : 1) - (b.kind === 'rubric' ? 0 : 1));

  let spent = 0;
  const spentByJudge = {};
  const worker = async (u) => {
    const task = tasks.get(u.run.taskId);
    const answerKey = readAnswerKey(task.fixtureDir);
    let out;
    if (u.kind === 'rubric') {
      const b = bundles.get(runKey(u.run));
      const prompt = rubricPrompt({ task, answerKey, bundleText: b.text });
      out = await judgeOnce({ caller, model: u.judge, prompt, check: (v) => validateRubricReply(v, task.rubric) });
    } else {
      // Order 1 puts the baseline in position A; order 2 swaps.
      const mine = bundles.get(runKey(u.run)).text;
      const theirs = bundles.get(runKey(u.base)).text;
      const [bundleA, bundleB] = u.order === 1 ? [theirs, mine] : [mine, theirs];
      const prompt = pairPrompt({ task, answerKey, bundleA, bundleB });
      out = await judgeOnce({ caller, model: u.judge, prompt, check: validatePairReply });
    }
    const live = out.calls.filter((c) => !c.cached).reduce((s, c) => s + c.credits, 0);
    spent += live;
    spentByJudge[u.judge] = (spentByJudge[u.judge] || 0) + live;
    log(`judged ${u.kind} ${u.judge} ${runKey(u.run)}${u.order ? ` order ${u.order}` : ''}: ${out.error ? `ERROR ${out.error}` : 'ok'} (spent ${spent.toFixed(3)})`);
    return out;
  };
  const onSkip = () => ({ error: `budget reached (${budgetCredits} credits)`, calls: [], parseFailures: 0 });
  const outs = await runPool(units, concurrency, worker, () => budgetCredits != null && spent >= budgetCredits, onSkip);

  const rubric = [];
  const pairs = new Map();
  units.forEach((u, i) => {
    const out = outs[i];
    const bundle = bundles.get(runKey(u.run));
    const common = { judge: u.judge, armId: u.run.armId, taskId: u.run.taskId, replicate: u.run.replicate };
    if (u.kind === 'rubric') {
      const task = tasks.get(u.run.taskId);
      const found = makeQuoteMatcher(bundle.text);
      const criteria = out.error ? [] : out.value.criteria.map((c) => {
        const evidenceFound = /^\(nothing in the output\)/i.test(c.evidence) ? null : found(c.evidence);
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
  for (const { judge, run: r } of pairErrors) {
    pairwise.push({ kind: 'pairwise', judge, armId: r.armId, taskId: r.taskId, replicate: r.replicate, baselineId: baseline, verdict: null, positionInconsistent: false, orderings: [null, null], reasons: [], parseFailures: 0, calls: [], redactionsFired: {}, judgeError: `no baseline run (${baseline}) for this task and replicate` });
  }

  const judgments = mergeAndWrite(run, { judges, modes, baseline, limits, spent, spentByJudge, rubric, pairwise, notJudged, calls: outs.flatMap((o) => o.calls), smallPanel: Boolean(o.smallPanel) });
  return judgments;
}

// A rerun with other judges or modes keeps earlier records; a record is replaced by the same (judge, run, kind).
// Spend accumulates across invocations: cached calls cost 0 now, so replacing a record never erases earlier spend.
function mergeAndWrite(run, { judges, modes, baseline, limits, spent, spentByJudge, rubric, pairwise, notJudged, calls, smallPanel }) {
  const file = path.join(run.dir, 'judgments.json');
  const prev = run.judgments || { rubric: [], pairwise: [], judges: [], modes: [] };
  // A unit skipped by the budget has nothing to say; it must not replace an earlier record that has a result.
  const skippedByBudget = (r) => /^budget reached/.test(r.judgeError || '');
  const merge = (old, fresh) => {
    const m = new Map(old.map((r) => [`${r.judge}|${r.armId}|${r.taskId}|${r.replicate}`, r]));
    for (const r of fresh) {
      const key = `${r.judge}|${r.armId}|${r.taskId}|${r.replicate}`;
      const kept = m.get(key);
      if (skippedByBudget(r) && kept && !kept.judgeError) continue;
      m.set(key, r);
    }
    return [...m.values()];
  };
  const byJudge = { ...(prev.spentByJudge || {}) };
  for (const [j, v] of Object.entries(spentByJudge)) byJudge[j] = (byJudge[j] || 0) + v;
  const allJudges = [...new Set([...prev.judges, ...judges])].sort();
  const out = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    subjectModel: run.config.model ?? null,
    baseline,
    judges: allJudges,
    modes: [...new Set([...prev.modes, ...modes])].sort(),
    limits,
    panel: { families: families(allJudges), small: Boolean(prev.panel?.small || smallPanel) },
    spentCredits: (prev.spentCredits || 0) + spent,
    spentByJudge: byJudge,
    invocations: [...(prev.invocations || []), { at: new Date().toISOString(), judges, modes, spentCredits: spent, calls: calls.length, cachedCalls: calls.filter((c) => c.cached).length }],
    notJudged,
    rubric: merge(prev.rubric, rubric),
    pairwise: merge(prev.pairwise, pairwise),
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return out;
}

module.exports = { runJudging, judgeOnce };
