// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveArm } = require('./arms.js');
const { harnessFor } = require('./harness/index.js');
const { executeRun } = require('./run-one.js');
const { skippedResult, errorResult } = require('./result.js');
const { layoutProblem } = require('./arm-source.js');
const { openLedger } = require('./credit-ledger.js');
const { describeChange, judgeBatch, GATE_FILE } = require('./isolation-gates.js');
const { DEFAULT_MAX_AUTH_FAILURES } = require('./auth-failure.js');
const { DEFAULT_CHECK_EVERY_MS } = require('./login-check.js');
const { writeAtomic } = require('./owned.js');
const { runPlantCell } = require('./plant/lifecycle.js');

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
// `offset` continues numbering after an earlier run in the same out dir: replicates are offset+1..offset+replicates.
function planRuns(tasks, arms, replicates, seed = 1, offset = 0) {
  const plan = [];
  for (let rep = offset + 1; rep <= offset + replicates; rep++) {
    const pairs = tasks.flatMap((task) => arms.map((arm) => ({ task, arm, replicate: rep })));
    plan.push(...shuffle(pairs, mulberry32(seed + rep)));
  }
  return plan;
}

const runDirOf = (outDir, { arm, task, replicate }) => path.join(outDir, arm.id, task.id, String(replicate));

// Planned cells whose result.json already exists; running them overwrites it in place.
function existingResults(plan, outDir) {
  return plan.filter((item) => fs.existsSync(path.join(runDirOf(outDir, item), 'result.json')));
}

/**
 * --resume: the planned cells that still need a run. A cell with no result.json runs, and so does one whose result says
 * it never ran (budget_skipped). An errored cell runs again only with `errors`. Every other result is kept as it is.
 */
function resumePlan(plan, outDir, { errors = false } = {}) {
  const todo = [];
  let kept = 0;
  for (const item of plan) {
    let r = null;
    try { r = JSON.parse(fs.readFileSync(path.join(runDirOf(outDir, item), 'result.json'), 'utf8')); } catch { /* missing or unreadable: run it */ }
    if (!r || r.status === 'budget_skipped' || (errors && r.status === 'error')) todo.push(item);
    else kept++;
  }
  return { todo, kept };
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

const LARGE_PLAN_RUNS = 10;

/**
 * What a run could cost before any credit is spent. Wall-clock worst case assumes every run hits
 * its timeout. Credits cannot be bounded per run, so the cap is a guard on the ledger: it stops new
 * launches at 90% of the budget; up to `parallel` runs already in flight still finish and are added.
 */
function describePlan({ tasks, arms, replicates, parallel, budgetCredits, unit = 'credits', timeoutSecOverride = null }) {
  const planned = tasks.length * arms.length * replicates;
  const worstWallSec = tasks.reduce((s, t) => s + t.timeoutSec, 0) * arms.length * replicates / Math.max(1, parallel);
  const hours = (worstWallSec / 3600).toFixed(1);
  const cap = budgetCredits == null ? 'none' : `${budgetCredits} ${unit} (new launches stop at 90% of the cap; up to ${Math.max(1, parallel)} in-flight run(s) still finish)`;
  return { planned, worstWallSec, text: `${planned} planned run(s); worst-case wall-clock ${hours} h if every run times out (parallel ${parallel}); ${unit === 'usd' ? 'USD' : 'credit'} cap: ${cap}${timeoutSecOverride == null ? '' : `; task timeout overridden to ${timeoutSecOverride} s by --timeout-sec`}` };
}

// No cap is the default. A large plan gets a note that credits are tracked in the ledger and nothing will stop them.
function budgetNote(planned, budgetCredits, flag = 'budget-credits') {
  if (planned <= LARGE_PLAN_RUNS || budgetCredits != null) return null;
  return `${planned} runs are planned and no credit cap is set: spending is tracked in credit-ledger.jsonl and nothing stops it (pass --${flag} X for a guard that stops new work at 90% of X)`;
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
  const ledger = { observed: 0, charged: 0, runs: 0, largest: 0 };
  let reason = null;
  ledger.add = (r) => {
    const { observed, censored, known } = costOf(r);
    let charge = observed;
    if (censored) charge = Math.max(observed, median(completed.get(r.armId) || []) ?? floor);
    else if (known) completed.set(r.armId, [...(completed.get(r.armId) || []), observed]);
    ledger.observed += observed;
    ledger.charged += charge;
    ledger.largest = Math.max(ledger.largest, charge);
    ledger.runs++;
    return charge;
  };
  // Whole replicates are skipped when the next one is projected to overshoot; within one, only the hard cap applies.
  const decided = new Map();
  ledger.shouldSkip = ({ replicate }) => {
    reason = null;
    if (budgetCredits == null) return false;
    if (ledger.charged >= budgetCredits) { reason = `budget reached: charged ${ledger.charged.toFixed(3)} of ${budgetCredits}`; return true; }
    // The next run may cost as much as the largest so far; launching it must not be what overshoots the budget.
    if (ledger.runs && ledger.charged + ledger.largest > budgetCredits) {
      reason = `budget headroom: charged ${ledger.charged.toFixed(3)} + largest run so far ${ledger.largest.toFixed(3)} would pass the budget ${budgetCredits}`;
      return true;
    }
    if (!decided.has(replicate)) {
      const projected = ledger.runs ? (ledger.charged / ledger.runs) * runsPerReplicate : 0;
      decided.set(replicate, replicate > 1 && ledger.charged + projected > budgetCredits);
    }
    if (decided.get(replicate)) reason = `budget projected: the next replicate would pass the budget ${budgetCredits}`;
    return decided.get(replicate);
  };
  ledger.skipReason = () => reason ?? 'budget reached';
  return ledger;
}

function writeResult(outDir, arm, task, rep, result) {
  const dir = path.join(outDir, arm.id, task.id, String(rep));
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
}

/**
 * Builds every konductor arm (MCP server, CLI, synth) and does a trial install, before any credit is spent.
 * Throws on the first failure unless allowPartial; then failed arms are returned in `errors`.
 */
function prepareAll({ arms, ctx, log, allowPartial = false }) {
  const prepared = new Map();
  const errors = new Map();
  // Layout problems are known without building, so they stop the run before any arm spends time in cargo.
  const unbuildable = new Map();
  for (const arm of arms) {
    if (arm.vanilla) continue;
    const problem = layoutProblem(arm, ctx.repo, harnessFor(arm).requiredPaths || []);
    if (problem) unbuildable.set(arm.id, problem);
  }
  if (unbuildable.size && !allowPartial) {
    const lines = [...unbuildable].map(([id, why]) => `arm ${id} could not be prepared: ${why}`);
    throw new Error(`${lines.join('\n')}\n(use --allow-partial to run the remaining arms)`);
  }
  for (const [id, why] of unbuildable) {
    errors.set(id, why);
    log(`arm ${id} could not be prepared: ${why}`);
  }
  for (const arm of arms) {
    if (arm.vanilla || errors.has(arm.id)) continue;
    log(`preparing arm ${arm.id} (${armKey(arm)})`);
    try {
      const harness = harnessFor(arm);
      const p = harness.prepareArm(arm, ctx);
      p.entryAgent = arm.agentOverride ?? null;
      p.rewrittenAgents = harness.trialInstall(p, ctx);
      (ctx.skillInfo ??= new Map()).set(arm.id, p.skillInfo ?? null);
      noteListing(arm, p, ctx, log);
      prepared.set(arm.id, p);
    } catch (e) {
      const msg = `arm ${arm.id} could not be prepared: ${e.message}`;
      if (!allowPartial) throw new Error(`${msg}\n(use --allow-partial to run the remaining arms)`);
      errors.set(arm.id, e.message);
      log(msg.split('\n')[0]);
    }
  }
  for (const arm of arms.filter((a) => a.vanilla)) {
    const harness = harnessFor(arm);
    if (harness.vanillaSkillListing) noteListing(arm, harness.vanillaSkillListing(ctx), ctx, log);
  }
  return { prepared, errors };
}

/**
 * Keeps the arm's skill listing record in ctx.skillListings (every run of the arm copies it) and says out loud when a
 * konductor skill is name-only or the listing could not be measured.
 */
function noteListing(arm, { skillListing = null, skillListingError = null }, ctx, log) {
  (ctx.skillListings ??= new Map()).set(arm.id, { listing: skillListing, error: skillListingError });
  if (skillListingError) log(`WARNING: arm ${arm.id}: the skill listing was not recorded: ${skillListingError}`);
  else if (skillListing?.nameOnly > 0) log(`WARNING: arm ${arm.id}: ${skillListing.nameOnly} konductor skill(s) are name-only in the ${skillListing.harness} listing (${skillListing.listingChars} chars > ${skillListing.budgetChars} budget): ${skillListing.konductorNameOnly.join(', ')}; report-2x2 refuses this cell`);
  if (skillListing?.otherSkills?.length) log(`WARNING: arm ${arm.id}: the ${skillListing.harness} listing holds ${skillListing.otherSkills.length} skill(s) that are neither built-in nor the arm's: ${skillListing.otherSkills.slice(0, 5).join(', ')}${skillListing.otherSkills.length > 5 ? ', ...' : ''}; report-2x2 refuses this cell`);
}

// What identifies an arm's content in the preflight table: its commit, or the hash of a directory snapshot.
const armKey = (a) => (a.commitSha ? a.commitSha.slice(0, 10) : a.contentHash ? `dir:${a.contentHash.slice(0, 10)}` : '-');

function preflightTable(arms, prepared, errors) {
  const rows = [['arm', 'ref', 'commit', 'mcp sha256', 'skills', 'state']];
  for (const a of arms) {
    const p = prepared.get(a.id);
    rows.push([
      a.label,
      a.ref ?? '-',
      armKey(a),
      p?.mcpSha256 ? p.mcpSha256.slice(0, 12) : '-',
      a.vanilla ? '0' : Number.isInteger(p?.skillsInstalled?.skills) ? `${p.skillsInstalled.skills} (+${p.skillsInstalled.sops} sop)` : '-',
      a.vanilla ? 'ready' : errors.has(a.id) ? 'FAILED' : p?.cached ? 'ready (cached)' : 'ready (built)',
    ]);
  }
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(w[i])).join('  ')).join('\n');
}

// One rerun of a run the model service refused (a throttle), after a minute (DEBT D-138; pilot-wave.sh reruns any left).
const DEFAULT_THROTTLE_RETRY = Object.freeze({ max: 1, waitMs: 60000 });

async function runAll({ tasks, arms, prepared, prepErrors, replicates, parallel, budgetCredits, censoredFloor, seed, outDir, ctx, state, log, costOf = CREDITS, unit = 'credits', creditLedger = null, gateStrict = false, replicateOffset = 0, resume = null, maxAuthFailures = DEFAULT_MAX_AUTH_FAILURES, loginCheck = null, loginCheckEveryMs = DEFAULT_CHECK_EVERY_MS, throttleRetry = DEFAULT_THROTTLE_RETRY }) {
  const ledger = makeLedger({ budgetCredits, floor: censoredFloor, runsPerReplicate: tasks.length * arms.length, costOf });
  // The study ledger only tracks unless a budget was given; then it also stops new launches at 90% of that budget.
  const study = creditLedger ?? openLedger({ dir: outDir, budget: budgetCredits });
  let guardReason = null;
  // Consecutive login failures (in completion order) mean the login is gone; every later run would fail the same way.
  // A run whose agent binary could not be launched counts toward the same limit.
  const authStop = { limit: maxAuthFailures, consecutive: 0, tripped: false, reason: null, kind: null, skipped: 0 };
  const trip = (reason, kind = 'auth') => {
    if (authStop.tripped) return;
    authStop.tripped = true;
    authStop.reason = reason;
    authStop.kind = kind;
    log(`${kind === 'launch' ? 'LAUNCH FAILURE' : 'LOGIN FAILURE'}: ${reason}`);
  };
  // Long chunks re-check the login between runs. One check at a time; runs already in flight finish.
  let lastLoginCheck = Date.now();
  let probing = null;
  const loginStillValid = async () => {
    if (authStop.tripped) return false;
    if (!loginCheck || Date.now() - lastLoginCheck < loginCheckEveryMs) return true;
    probing ??= (async () => {
      let res;
      try { res = await loginCheck(); } catch (e) { res = { ok: true, unavailable: e.message }; }
      lastLoginCheck = Date.now();
      if (res.unavailable) log(`warning: login check unavailable: ${res.unavailable}`);
      if (!res.ok) trip(`login check failed between runs (${res.detail}); no further run started`);
    })().finally(() => { probing = null; });
    await probing;
    return !authStop.tripped;
  };
  const shouldSkip = (item) => {
    if (authStop.tripped) { guardReason = authStop.reason; return true; }
    guardReason = study.shouldStop() ? study.stopReason() : null;
    return guardReason !== null || ledger.shouldSkip(item);
  };
  let active = 0;
  let plan = planRuns(tasks, arms, replicates, seed, replicateOffset);
  if (resume) {
    const { todo, kept } = resumePlan(plan, outDir, resume);
    log(`resume: ${kept} of ${plan.length} planned cell(s) already have a result and are kept; ${todo.length} to run${resume.errors ? ' (errored cells included)' : ''}`);
    plan = todo;
  }
  const clobbered = existingResults(plan, outDir);
  if (clobbered.length && resume) log(`resume: ${clobbered.length} of them have a result.json that will be replaced (never ran${resume.errors ? ', or errored' : ''})`);
  else if (clobbered.length) log(`WARNING: ${clobbered.length} of ${plan.length} planned cell(s) already have a result.json in ${outDir} and will be OVERWRITTEN. Use a new --out, or --replicate-offset N to add replicates after the existing ones.`);
  const batchWindow = ctx.installsGate ? ctx.installsGate.begin() : null;
  const batchFrom = new Date().toISOString();

  const worker = async (item) => {
    const { task, arm, replicate } = item;
    if (!prepErrors.has(arm.id) && !(await loginStillValid())) return onSkip(item);
    const dir = path.join(outDir, arm.id, task.id, String(replicate));
    let r;
    if (prepErrors.has(arm.id)) {
      r = errorResult({ arm, task, replicate, config: ctx.config, env: ctx.envInfo, message: `arm preparation failed: ${prepErrors.get(arm.id)}`, meta: { agentStarted: false } });
      writeResult(outDir, arm, task, replicate, r);
    } else {
      log(`run  ${arm.id} / ${task.id} / #${replicate}`);
      const runIt = async () => {
        const inFlightAtStart = active;
        active++;
        try {
          const args = { arm, task, replicate, ctx, prepared: prepared.get(arm.id), outDir: dir, inFlightAtStart };
          return await (arm.plant ? runPlantCell(executeRun, args) : executeRun(args));
        } finally {
          active--;
        }
      };
      r = await runIt();
      // A run the model service refused (a throttle) never reached the task: wait and run it again, up to
      // throttleRetry.max times, while the budget and the guards still allow a launch. Each refused attempt is charged
      // and kept beside the cell as <replicate>.throttled-N (its result in attempt-result.json, so no report reads it).
      // Plant cells are left to the plant runner's own resume.
      const refused = [];
      while (!arm.plant && r.status !== 'success' && (r.flags || []).includes('throttled') && refused.length < throttleRetry.max && !shouldSkip(item)) {
        const charged = ledger.add(r);
        const seen = costOf(r);
        study.record({ kind: 'run', unit, arm: arm.id, task: task.id, replicate, status: r.status, credits: seen.known ? seen.observed : null, charged, censored: seen.censored, throttled: true });
        const aside = `${dir}.throttled-${refused.length + 1}`;
        fs.renameSync(dir, aside);
        fs.rmSync(path.join(aside, 'result.json'), { force: true });
        fs.writeFileSync(path.join(aside, 'attempt-result.json'), `${JSON.stringify({ ...r, [unit === 'usd' ? 'costUsdCharged' : 'creditsCharged']: charged }, null, 2)}\n`);
        refused.push({ dir: path.basename(aside), status: r.status, error: r.error ?? null, charged });
        log(`throttled ${arm.id} / ${task.id} / #${replicate}: the service refused the run; kept as ${path.basename(aside)}, running it again in ${Math.round(throttleRetry.waitMs / 1000)} s`);
        await new Promise((res) => setTimeout(res, throttleRetry.waitMs));
        r = await runIt();
      }
      if (refused.length) r.throttleRetries = refused;
      const charge = ledger.add(r);
      if (unit === 'usd') r.costUsdCharged = charge; else r.creditsCharged = charge;
      const seen = costOf(r);
      study.record({ kind: 'run', unit, arm: arm.id, task: task.id, replicate, status: r.status, credits: seen.known ? seen.observed : null, charged: charge, censored: seen.censored, ...(r.authFailure ? { infra: 'auth' } : r.launchFailure ? { infra: 'launch' } : {}) });
      log(study.line());
      writeResult(outDir, arm, task, replicate, r);
      state.spent = ledger.observed;
      state.charged = ledger.charged;
      if (!r.authFailure && !r.launchFailure) authStop.consecutive = 0;
      else if (++authStop.consecutive >= authStop.limit) {
        if (r.authFailure) trip(`${authStop.consecutive} consecutive runs could not log in (${r.authFailure}); no further run started`);
        else trip(`${authStop.consecutive} consecutive runs could not start the agent: agent binary missing or replaced during the run (${r.launchFailure}); no further run started`, 'launch');
      }
      const spent = unit === 'usd' ? r.costUsd : r.credits;
      const censored = unit === 'usd' ? r.costCensored : r.creditsCensored;
      log(`done ${arm.id} / ${task.id} / #${replicate}: ${r.status}, ${spent == null ? 'n/a' : spent.toFixed(3)} ${unit}${censored ? ` (censored, charged ${charge.toFixed(3)})` : ''}${r.authFailure ? ' (login failure, no turn ran, charged 0)' : ''}${r.launchFailure ? ' (agent binary could not be launched, no turn ran, charged 0)' : ''}${r.creditOvershoot > 0 ? ` (${r.creditOvershoot.toFixed(3)} over the run credit limit ${r.creditLimit})` : ''}, ${r.wallClockMs == null ? 'n/a' : (r.wallClockMs / 1000).toFixed(1) + 's'} (charged ${ledger.charged.toFixed(3)})`);
    }
    state.results.push(r);
    return r;
  };
  const onSkip = ({ task, arm, replicate }) => {
    const why = authStop.tripped ? authStop.reason : guardReason ?? ledger.skipReason();
    if (authStop.tripped) authStop.skipped++;
    const r = skippedResult({ arm, task, replicate, config: ctx.config, env: ctx.envInfo, reason: why });
    writeResult(outDir, arm, task, replicate, r);
    state.results.push(r);
    log(`skip ${arm.id} / ${task.id} / #${replicate}: ${why}`);
    return r;
  };

  const results = await runPool(plan, parallel, worker, shouldSkip, onSkip);
  const rawGate = batchWindow ? batchWindow.end() : null;
  const judged = rawGate ? judgeBatch({ gate: rawGate, results, strict: gateStrict, window: { from: batchFrom, to: new Date().toISOString() } }) : null;
  const installsGate = judged ? judged.gate : null;
  if (installsGate) {
    fs.writeFileSync(path.join(outDir, GATE_FILE), `${JSON.stringify({ checkedAt: new Date().toISOString(), ...installsGate }, null, 2)}\n`);
    if (judged.warning) log(`${judged.warning} See ${GATE_FILE}.`);
    if (!installsGate.ok) log(gateStrict ? `ISOLATION FAILURE: ${describeChange(installsGate)}. The runs of this batch are not trustworthy; see ${GATE_FILE}.` : `${judged.alarm} See ${GATE_FILE}.`);
  }
  return { installsGate, authStop, results, observed: ledger.observed, charged: ledger.charged, study: study.totals(), studyLine: study.line(), guard: study.state() };
}

module.exports = {
  CREDITS, USD, runAll, DEFAULT_THROTTLE_RETRY, planRuns, existingResults, resumePlan, runPool, prepareAll, preflightTable, makeLedger, describePlan, budgetNote, LARGE_PLAN_RUNS, mulberry32, shuffle, median, resolveArm, DEFAULT_CENSORED_FLOOR,
};
