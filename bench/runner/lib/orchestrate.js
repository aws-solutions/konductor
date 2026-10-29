// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveArm } = require('./arms.js');
const { harnessFor } = require('./harness/index.js');
const { executeRun } = require('./run-one.js');
const { skippedResult, errorResult } = require('./result.js');

const DEFAULT_CENSORED_FLOOR = 1.0;

// Small seeded PRNG so a run order can be reproduced from the seed in run-config.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rand) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Replicate-major: every (task, arm) pair runs once per replicate, in a seeded random order.
// A budget stop then removes whole replicates or an unbiased random remainder, never a task class.
function planRuns(tasks, arms, replicates, seed = 1) {
  const plan = [];
  for (let rep = 1; rep <= replicates; rep++) {
    const pairs = tasks.flatMap((task) => arms.map((arm) => ({ task, arm, replicate: rep })));
    plan.push(...shuffle(pairs, mulberry32(seed + rep)));
  }
  return plan;
}

// Bounded worker pool. `shouldSkip(item)` is checked at launch time, so runs already
// in flight when the budget is reached still finish and count.
async function runPool(plan, parallel, worker, shouldSkip, onSkip) {
  const results = new Array(plan.length);
  let next = 0;
  async function lane() {
    while (next < plan.length) {
      const i = next++;
      results[i] = shouldSkip(plan[i]) ? onSkip(plan[i]) : await worker(plan[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, lane));
  return results;
}

const BUDGET_REQUIRED_ABOVE = 10;

/**
 * What a run could cost before any credit is spent. Wall-clock worst case assumes every run hits
 * its timeout. Credits cannot be bounded per run, so the cap is the ledger budget, which stops new
 * launches once reached; up to `parallel` runs already in flight still finish and are added.
 */
function describePlan({ tasks, arms, replicates, parallel, budgetCredits, unit = 'credits' }) {
  const planned = tasks.length * arms.length * replicates;
  const worstWallSec = tasks.reduce((s, t) => s + t.timeoutSec, 0) * arms.length * replicates / Math.max(1, parallel);
  const hours = (worstWallSec / 3600).toFixed(1);
  const cap = budgetCredits == null ? 'none' : `${budgetCredits} ${unit} (new launches stop at the cap; up to ${Math.max(1, parallel)} in-flight run(s) still finish)`;
  return { planned, worstWallSec, text: `${planned} planned run(s); worst-case wall-clock ${hours} h if every run times out (parallel ${parallel}); ${unit === 'usd' ? 'USD' : 'credit'} cap: ${cap}` };
}

function requireBudget(planned, budgetCredits, flag = 'budget-credits') {
  if (planned > BUDGET_REQUIRED_ABOVE && budgetCredits == null) {
    throw new Error(`${planned} runs are planned, more than ${BUDGET_REQUIRED_ABOVE}: pass --${flag} X so a bad run cannot spend without limit (${flag === 'budget-usd' ? 'cost' : 'credits'} per run are not bounded by the runner)`);
  }
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Budget accounting. A run killed before its final metering event has unobserved spend,
 * so it is charged the median of the arm's completed runs (or `floor` when there are none).
 */
const CREDITS = (r) => ({ observed: r.credits || 0, censored: Boolean(r.creditsCensored), known: r.credits != null });
const USD = (r) => ({ observed: r.costUsd || 0, censored: Boolean(r.costCensored), known: r.costUsd != null });

// `costOf(result)` says what a run spent and in which unit: credits for kiro-cli, list-price USD for opencode.
function makeLedger({ budgetCredits, floor = DEFAULT_CENSORED_FLOOR, runsPerReplicate, costOf = CREDITS }) {
  const completed = new Map();
  const ledger = { observed: 0, charged: 0, runs: 0 };
  ledger.add = (r) => {
    const { observed, censored, known } = costOf(r);
    let charge = observed;
    if (censored) charge = Math.max(observed, median(completed.get(r.armId) || []) ?? floor);
    else if (known) completed.set(r.armId, [...(completed.get(r.armId) || []), observed]);
    ledger.observed += observed;
    ledger.charged += charge;
    ledger.runs++;
    return charge;
  };
  // Whole replicates are skipped when the next one is projected to overshoot; within one, only the hard cap applies.
  const decided = new Map();
  ledger.shouldSkip = ({ replicate }) => {
    if (budgetCredits == null) return false;
    if (ledger.charged >= budgetCredits) return true;
    if (!decided.has(replicate)) {
      const projected = ledger.runs ? (ledger.charged / ledger.runs) * runsPerReplicate : 0;
      decided.set(replicate, replicate > 1 && ledger.charged + projected > budgetCredits);
    }
    return decided.get(replicate);
  };
  return ledger;
}

function writeResult(outDir, arm, task, rep, result) {
  const dir = path.join(outDir, arm.id, task.id, String(rep));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
}

/**
 * Builds every konductor arm (MCP server, CLI, synth) and does a trial install, before any credit is spent.
 * Throws on the first failure unless allowPartial; then failed arms are returned in `errors`.
 */
function prepareAll({ arms, ctx, log, allowPartial = false }) {
  const prepared = new Map();
  const errors = new Map();
  for (const arm of arms) {
    if (arm.vanilla) continue;
    log(`preparing arm ${arm.id} (${arm.commitSha.slice(0, 10)})`);
    try {
      const harness = harnessFor(arm);
      const p = harness.prepareArm(arm, ctx);
      p.rewrittenAgents = harness.trialInstall(p, ctx);
      (ctx.skillInfo ??= new Map()).set(arm.id, p.skillInfo ?? null);
      prepared.set(arm.id, p);
    } catch (e) {
      const msg = `arm ${arm.id} could not be prepared: ${e.message}`;
      if (!allowPartial) throw new Error(`${msg}\n(use --allow-partial to run the remaining arms)`);
      errors.set(arm.id, e.message);
      log(msg.split('\n')[0]);
    }
  }
  return { prepared, errors };
}

function preflightTable(arms, prepared, errors) {
  const rows = [['arm', 'ref', 'commit', 'mcp sha256', 'state']];
  for (const a of arms) {
    const p = prepared.get(a.id);
    rows.push([
      a.label,
      a.ref ?? '-',
      a.commitSha ? a.commitSha.slice(0, 10) : '-',
      p?.mcpSha256 ? p.mcpSha256.slice(0, 12) : '-',
      a.vanilla ? 'ready' : errors.has(a.id) ? 'FAILED' : p?.cached ? 'ready (cached)' : 'ready (built)',
    ]);
  }
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(w[i])).join('  ')).join('\n');
}

async function runAll({ tasks, arms, prepared, prepErrors, replicates, parallel, budgetCredits, censoredFloor, seed, outDir, ctx, state, log, costOf = CREDITS, unit = 'credits' }) {
  const ledger = makeLedger({ budgetCredits, floor: censoredFloor, runsPerReplicate: tasks.length * arms.length, costOf });
  let active = 0;
  const plan = planRuns(tasks, arms, replicates, seed);

  const worker = async ({ task, arm, replicate }) => {
    const dir = path.join(outDir, arm.id, task.id, String(replicate));
    let r;
    if (prepErrors.has(arm.id)) {
      r = errorResult({ arm, task, replicate, config: ctx.config, env: ctx.envInfo, message: `arm preparation failed: ${prepErrors.get(arm.id)}`, meta: { agentStarted: false } });
      writeResult(outDir, arm, task, replicate, r);
    } else {
      log(`run  ${arm.id} / ${task.id} / #${replicate}`);
      const inFlightAtStart = active;
      active++;
      try {
        r = await executeRun({ arm, task, replicate, ctx, prepared: prepared.get(arm.id), outDir: dir, inFlightAtStart });
      } finally {
        active--;
      }
      const charge = ledger.add(r);
      if (unit === 'usd') r.costUsdCharged = charge; else r.creditsCharged = charge;
      writeResult(outDir, arm, task, replicate, r);
      state.spent = ledger.observed;
      state.charged = ledger.charged;
      const spent = unit === 'usd' ? r.costUsd : r.credits;
      const censored = unit === 'usd' ? r.costCensored : r.creditsCensored;
      log(`done ${arm.id} / ${task.id} / #${replicate}: ${r.status}, ${spent == null ? 'n/a' : spent.toFixed(3)} ${unit}${censored ? ` (censored, charged ${charge.toFixed(3)})` : ''}, ${r.wallClockMs == null ? 'n/a' : (r.wallClockMs / 1000).toFixed(1) + 's'} (charged ${ledger.charged.toFixed(3)})`);
    }
    state.results.push(r);
    return r;
  };
  const onSkip = ({ task, arm, replicate }) => {
    const r = skippedResult({ arm, task, replicate, config: ctx.config, env: ctx.envInfo });
    writeResult(outDir, arm, task, replicate, r);
    state.results.push(r);
    log(`skip ${arm.id} / ${task.id} / #${replicate}: budget ${budgetCredits} reached or projected`);
    return r;
  };

  const results = await runPool(plan, parallel, worker, ledger.shouldSkip, onSkip);
  return { results, observed: ledger.observed, charged: ledger.charged };
}

module.exports = {
  CREDITS, USD, runAll, planRuns, runPool, prepareAll, preflightTable, makeLedger, describePlan, requireBudget, BUDGET_REQUIRED_ABOVE, mulberry32, shuffle, median, resolveArm, DEFAULT_CENSORED_FLOOR,
};
