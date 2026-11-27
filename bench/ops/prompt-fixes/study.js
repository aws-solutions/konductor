#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free helper of run-prompt-fix-arms.sh (bench/ops/workspace). No model call; reads files only.
//   node study.js cells STEP                    one "task arm rep" line per run of STEP, in run order
//   node study.js forecast [RUNS]               JSON: per step (steps), the runs, the forecast credits per arm and in all,
//                                               the cap, the per-run limit, the worst case (runs x per-run limit), the runs
//                                               the per-run check lets start, and the judge USD; the judge panel and cap
//   node study.js spent DIR                     "<credits> <unknown>" from every credit-ledger.jsonl under DIR
//   node study.js may-start DIR STEP            exit 0 when spend under DIR plus the step's per-run limit stays within
//                                               the cap, and the 60% stop rule has not fired; else exit 1 and say why
//   node study.js gate DIR                      the smoke gate over DIR: exit 0 PASS, 1 FAIL; prints the reasons
//   node study.js rebook DIR ASIDE [--apply]   un-books estimate-fault stops under the step folder DIR (D-297; see rebook)
//   node study.js usd-spent DIR                 USD the judge calls under DIR were charged
//   node study.js judge-may-start DIR TASK CAP  exit 0 when judge spend under DIR plus one run of TASK (high estimate)
//                                               stays within CAP USD; else exit 1 and say why
// RUNS (default /var/tmp/konductor-standard-v2/runs) holds the saved STANDARD v2 runs the forecast measures vanilla
// and konductor per task from. Steps, caps and limits are the owner's approval of 2026-11-27.

const fs = require('node:fs');
const path = require('node:path');
const { EXPECT } = require('../../report/plan-call.js');
const { readLedger } = require('../../runner/lib/credit-ledger.js');
const { makeSplitReader } = require('../../runner/lib/credit-watch.js');

const ARMS = ['vanilla', 'konductor-adaptive', 'konductor-coordinator'];
const byRow = (lo, hi) => Object.entries(EXPECT.tasks).filter(([, e]) => e.row >= lo && e.row <= hi).sort((a, b) => a[1].row - b[1].row).map(([id]) => id);
// Smoke: rows 10, 1, 7 and 8; the team task first, so the gate's team-writer evidence comes before the cap can bind.
// Batch C: cx-carddemo-batchday on the owner's CardDemo approval (600 total, 125.5 spent: cap 474), soft per-run caps
// as run-cx.sh --soft: a run is never killed, its worst case is the 3600 s timeout at the top measured rate of 4.5
// credits a minute (270). Measured per run (owner, 2026-11-27): konductor 77, vanilla 48.5; the two konductor arms are
// planned at konductor's 77 (inferred). 3 reps when they fit the cap, else 2.
const CX = { id: 'cx-carddemo-batchday', cap: 474, softWorst: 270, perRun: { vanilla: 48.5, 'konductor-adaptive': 77, 'konductor-coordinator': 77 } };
const cxPerRep = Object.values(CX.perRun).reduce((a, b) => a + b, 0);
const STEPS = {
  smoke: { tasks: ['t12-mux-parallel-merge', 't1-bug-date-range', 't12-split-shared-file', 'probe-e2e-explicit-yes'], reps: 1, cap: 90, runLimit: 25 },
  A: { tasks: byRow(1, 9), reps: 3, cap: 800, runLimit: 100 },
  B: { tasks: byRow(10, 14), reps: 3, cap: 700, runLimit: 100 },
  C: { tasks: [CX.id], reps: 3 * cxPerRep <= CX.cap ? 3 : 2, cap: CX.cap, runLimit: CX.softWorst, soft: true },
};
const STOP_SHARE = 0.6;

// Judge cost (USD, the 3-judge panel per run), from STANDARD v2: the rubric pass (bundle view) cost USD 9.02 over 496
// runs, 0.0182 a run; the quality-pack plan of r1-t1 estimated 0.0204 a run (mean) to 0.0297 (p90). The read view is
// rubric-only and costs about 5 to 10 times a bundle call (reports/judge-read-tools-build-2026-11-26.md, rough):
// planned at 7.5, high 10. The quality pack runs in the bundle view (the read view does not serve the pack mode).
// A CardDemo run is a much larger output: 3 times both (inferred).
const JUDGE = { rubricBundle: 0.0182, readMid: 7.5, readHigh: 10, packMean: 0.0204, packP90: 0.0297, cxFactor: 3 };
const PANEL = ['gpt-5.6-luna', 'deepseek-3.2', 'qwen3-coder-next'];

/** USD one run's two judge passes may cost: { mid, high }. */
function judgePerRun(task) {
  const f = task === CX.id ? JUDGE.cxFactor : 1;
  return { mid: f * (JUDGE.rubricBundle * JUDGE.readMid + JUDGE.packMean), high: f * (JUDGE.rubricBundle * JUDGE.readHigh + JUDGE.packP90) };
}

// Forecast rule (inferred, not measured; prompt-fix spec Part C): a solo-type row costs 1.3 times the larger of the
// measured vanilla and konductor means (forced review and the new lines); a team row costs 3.5 times vanilla (3 writers
// and a reviewer; the spec's 2 to 4 times a solo run). The coordinator always hands off: 3 times vanilla, at least
// konductor. Tasks STANDARD v2 did not run take the spec's per-run estimates (DEFAULTS).
const DEFAULTS = { 't12-delegated-worker-fix': [5, 6], 't12-parallel-backlog': [6, 8], 't12-split-three-modules': [5, 6], 't12-split-four-jobs': [6, 8], 't12-split-shared-file': [4, 6] };

function cells(step) {
  const s = STEPS[step];
  if (!s) throw new Error(`step must be ${Object.keys(STEPS).join(', ')}`);
  const out = [];
  for (let rep = 1; rep <= s.reps; rep++) for (const task of s.tasks) for (const arm of ARMS) out.push({ task, arm, rep });
  return out;
}

function measured(runsDir) {
  const m = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'result.json') {
        const r = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!EXPECT.tasks[r.taskId] || !Number.isFinite(r.credits)) continue;
        const k = `${r.taskId}|${r.armId}`;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r.credits);
      }
    }
  };
  if (runsDir && fs.existsSync(runsDir)) walk(runsDir);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return (task, arm) => (m.has(`${task}|${arm}`) ? mean(m.get(`${task}|${arm}`)) : null);
}

function perRun(task, arm, mean) {
  if (task === CX.id) return CX.perRun[arm];
  const [dv, dk] = DEFAULTS[task] ?? [4, 6];
  const v = mean(task, 'vanilla') ?? dv;
  const k = mean(task, 'konductor') ?? dk;
  if (arm === 'vanilla') return v;
  if (arm === 'konductor-coordinator') return Math.max(k, 3 * v);
  return EXPECT.tasks[task].plan === 'team' ? 3.5 * v : 1.3 * Math.max(v, k);
}

const r1 = (x) => Math.round(x * 10) / 10;
function forecast(runsDir = '/var/tmp/konductor-standard-v2/runs') {
  const mean = measured(runsDir);
  const steps = {};
  let mid = 0; let high = 0;
  for (const [step, s] of Object.entries(STEPS)) {
    const list = cells(step);
    const arms = Object.fromEntries(ARMS.map((a) => [a, r1(list.filter((c) => c.arm === a).reduce((n, c) => n + perRun(c.task, a, mean), 0))]));
    const total = r1(Object.values(arms).reduce((a, b) => a + b, 0));
    // How many runs the per-run check lets start when each costs its forecast: spend plus the limit within the cap.
    let spent = 0; let startable = 0;
    for (const c of list) { if (spent + s.runLimit > s.cap) break; spent += perRun(c.task, c.arm, mean); startable++; }
    const judge = list.reduce((j, c) => { const p = judgePerRun(c.task); return { mid: j.mid + p.mid, high: j.high + p.high }; }, { mid: 0, high: 0 });
    mid += judge.mid; high += judge.high;
    steps[step] = { tasks: s.tasks, reps: s.reps, runs: list.length, arms, total, cap: s.cap, runLimit: s.runLimit, soft: Boolean(s.soft), worstCase: list.length * s.runLimit, fits: total <= s.cap, startable, judgeUsd: { mid: Math.round(judge.mid * 100) / 100, high: Math.round(judge.high * 100) / 100 } };
  }
  return { steps, judge: { panel: PANEL, mid: Math.round(mid * 100) / 100, high: Math.round(high * 100) / 100, capUsd: Math.ceil(high) } };
}

function ledgerDirs(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name === 'credit-ledger.jsonl') out.push(d);
    }
  };
  walk(dir);
  return out;
}

function spent(dir) {
  let credits = 0; let unknown = 0;
  for (const d of ledgerDirs(dir)) { const t = readLedger(d).totals; credits += t.run; unknown += t.unknown; }
  return { credits: Math.round(credits * 100) / 100, unknown };
}

/** Results under DIR: [{ task, arm, credits }] from every result.json. */
function results(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'result.json') out.push(JSON.parse(fs.readFileSync(p, 'utf8')));
    }
  };
  walk(dir);
  return out;
}

/**
 * Null when the next run of STEP may start, else the reason. The hard rule: spend plus one run's per-run limit must
 * stay within the cap (a run is killed at its limit and charged at least that). The stop rule: at 60% of the cap or
 * more, stop when spend plus the cells left at the mean cost so far of each arm would pass the cap.
 */
function mayStart(dir, step, done = results(dir)) {
  const s = STEPS[step];
  const { credits, unknown } = spent(dir);
  if (unknown) return `the credit ledger under ${dir} has ${unknown} entr(y/ies) of unknown cost; check them before a rerun`;
  if (credits + s.runLimit > s.cap) return `cap: ${credits} spent of ${s.cap}, and one more run may cost up to ${s.runLimit}`;
  if (credits >= STOP_SHARE * s.cap) {
    const seen = new Set(done.map((r) => `${r.taskId}|${r.armId}|${r.replicate}`));
    const left = cells(step).filter((c) => !seen.has(`${c.task}|${c.arm}|${c.rep}`));
    const meanOf = (arm) => { const xs = done.filter((r) => r.armId === arm && Number.isFinite(r.credits)).map((r) => r.credits); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : s.runLimit; };
    const ahead = credits + left.reduce((n, c) => n + meanOf(c.arm), 0);
    if (ahead > s.cap) return `stop rule: ${credits} spent is 60% or more of the cap ${s.cap}, and the forecast ${r1(ahead)} is over it`;
  }
  return null;
}

/** The smoke gate: every adaptive run wrote a Plan line that parses, and the adaptive team task ran 2 or more writers. */
function gate(dir) {
  const rs = results(dir).filter((r) => r.armId === 'konductor-adaptive');
  const why = [];
  if (rs.length < STEPS.smoke.tasks.length) why.push(`${rs.length} adaptive runs of ${STEPS.smoke.tasks.length}`);
  for (const r of rs) if (!r.planCall || !r.planCall.plan) why.push(`${r.taskId}: no Plan line that parses (${r.planLine ?? 'none'})`);
  const team = rs.find((r) => r.taskId === STEPS.smoke.tasks[0]);
  if (!team || !(team.writerSpawns >= 2)) why.push(`${STEPS.smoke.tasks[0]}: ${team ? team.writerSpawns : 'no run'} writer spawns (want 2 or more)`);
  return why;
}

/** USD the judge calls under DIR were charged (ledger lines in unit usd). */
function usdSpent(dir) {
  let usd = 0;
  for (const d of ledgerDirs(dir)) usd += readLedger(d).totals.usd || 0;
  return Math.round(usd * 10000) / 10000;
}

/** Null when one more run of TASK may be judged under CAP_USD (spend plus that run's high estimate), else the reason. */
function judgeMayStart(dir, task, capUsd) {
  const spent = usdSpent(dir);
  const worst = judgePerRun(task).high;
  return spent + worst > capUsd ? `judge cap: USD ${spent} spent of ${capUsd}, and judging ${task} may cost up to ${Math.round(worst * 1000) / 1000}` : null;
}

/** Every result.json under `dir`, as [{ file, result }]. */
function resultFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'result.json') out.push({ file: p, result: JSON.parse(fs.readFileSync(p, 'utf8')) });
    }
  };
  walk(dir);
  return out;
}

const up3 = (x) => Math.ceil(x * 1000 - 1e-6) / 1000;

/**
 * Un-books the cells under the step folder `dir` that the per-run limit stopped on the old engine v3 context_usage
 * estimate (creditEstimate, no creditMeasured) while the run session's own creditSplit stayed under the limit: an
 * estimate fault, not spend (DEBT D-297). For each one, with `apply`, a ledger line at the measured spend plus the
 * largest rise between two creditSplit lines (about one model call, the most a stop can leave unwritten) goes to
 * <dir>/rebooked/<cell>/credit-ledger.jsonl, then the cell folder moves to `aside` (kept, never deleted), so the next
 * step run runs that cell again. Returns [{ cell, measured, charge, estimate, movedTo }]; without `apply` it only reports.
 */
function rebook(dir, aside, { apply = false } = {}) {
  const out = [];
  for (const cell of ledgerDirs(dir)) {
    if (path.relative(dir, cell).split(path.sep)[0] === 'rebooked') continue;
    const faults = resultFiles(cell).filter(({ result: r }) => r.status === 'error' && (r.flags || []).includes('creditLimit')
      && r.creditEstimate != null && r.creditMeasured == null && r.creditLimit != null);
    if (faults.length !== 1) continue;
    const { file, result: r } = faults[0];
    const reader = makeSplitReader(path.join(path.dirname(file), 'session'), { flat: true });
    const measured = reader.read();
    if (measured == null || measured >= r.creditLimit) continue;
    const rel = path.relative(dir, cell);
    const name = rel.split(path.sep).join('-');
    const item = { cell: rel, estimate: r.creditEstimate, measured: up3(measured), charge: up3(measured + reader.maxStep()), movedTo: null };
    if (apply) {
      const booked = path.join(dir, 'rebooked', name);
      fs.mkdirSync(booked, { recursive: true });
      const line = { at: new Date().toISOString(), kind: 'run', unit: 'credits', arm: r.armId, task: r.taskId, replicate: r.replicate ?? null, status: 'error',
        credits: item.measured, charged: item.charge, censored: true, rebooked: { estimate: r.creditEstimate, measured: item.measured, from: rel, reason: 'D-297 estimate-fault stop' } };
      fs.appendFileSync(path.join(booked, 'credit-ledger.jsonl'), `${JSON.stringify(line)}\n`);
      fs.mkdirSync(aside, { recursive: true });
      item.movedTo = path.join(aside, `${name}.estimate-stop.${Date.now()}`);
      fs.renameSync(cell, item.movedTo);
    }
    out.push(item);
  }
  return out;
}

function main([cmd, a, b, c]) {
  if (cmd === 'rebook') {
    const done = rebook(a, b, { apply: c === '--apply' });
    for (const x of done) console.log(`${x.cell}: stopped at an estimate of ${x.estimate.toFixed(3)}, measured ${x.measured}; ${c === '--apply' ? 'booked' : 'would book'} ${x.charge}${x.movedTo ? `, moved to ${x.movedTo}` : ''}`);
    if (!done.length) console.log('no estimate-fault stop found');
    return 0;
  }
  if (cmd === 'cells') { for (const x of cells(a)) console.log(`${x.task} ${x.arm} ${x.rep}`); return 0; }
  if (cmd === 'usd-spent') { console.log(usdSpent(a)); return 0; }
  if (cmd === 'judge-may-start') { const why = judgeMayStart(a, b, Number(c)); if (why) { console.log(why); return 1; } return 0; }
  if (cmd === 'forecast') { console.log(JSON.stringify(forecast(a), null, 2)); return 0; }
  if (cmd === 'spent') { const s = spent(a); console.log(`${s.credits} ${s.unknown}`); return 0; }
  if (cmd === 'may-start') { const why = mayStart(a, b); if (why) { console.log(why); return 1; } return 0; }
  if (cmd === 'gate') { const why = gate(a); console.log(why.length ? `FAIL: ${why.join('; ')}` : 'PASS'); return why.length ? 1 : 0; }
  console.error('usage: study.js cells STEP | rebook DIR ASIDE [--apply] | forecast [RUNS] | spent DIR | usd-spent DIR | may-start DIR STEP | judge-may-start DIR TASK CAP_USD | gate DIR');
  return 64;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { ARMS, STEPS, CX, PANEL, cells, forecast, spent, rebook, usdSpent, mayStart, judgeMayStart, judgePerRun, gate };
