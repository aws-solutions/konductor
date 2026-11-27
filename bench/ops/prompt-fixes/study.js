#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free helper of run-prompt-fix-arms.sh (bench/ops/workspace). No model call; reads files only.
//   node study.js cells STEP                    one "task arm rep" line per run of STEP, in run order
//   node study.js forecast [RUNS]               JSON: per step, the runs, the forecast credits per arm and in all, the
//                                               cap, the per-run limit and the worst case (runs x per-run limit)
//   node study.js spent DIR                     "<credits> <unknown>" from every credit-ledger.jsonl under DIR
//   node study.js may-start DIR STEP            exit 0 when spend under DIR plus the step's per-run limit stays within
//                                               the cap, and the 60% stop rule has not fired; else exit 1 and say why
//   node study.js gate DIR                      the smoke gate over DIR: exit 0 PASS, 1 FAIL; prints the reasons
// RUNS (default /var/tmp/konductor-standard-v2/runs) holds the saved STANDARD v2 runs the forecast measures vanilla
// and konductor per task from. Steps, caps and limits are the owner's approval of 2026-11-27.

const fs = require('node:fs');
const path = require('node:path');
const { EXPECT } = require('../../report/plan-call.js');
const { readLedger } = require('../../runner/lib/credit-ledger.js');

const ARMS = ['vanilla', 'konductor-adaptive', 'konductor-coordinator'];
const byRow = (lo, hi) => Object.entries(EXPECT.tasks).filter(([, e]) => e.row >= lo && e.row <= hi).sort((a, b) => a[1].row - b[1].row).map(([id]) => id);
// Smoke: rows 10, 1, 7 and 8; the team task first, so the gate's team-writer evidence comes before the cap can bind.
const STEPS = {
  smoke: { tasks: ['t12-mux-parallel-merge', 't1-bug-date-range', 't12-split-shared-file', 'probe-e2e-explicit-yes'], reps: 1, cap: 90, runLimit: 25 },
  A: { tasks: byRow(1, 9), reps: 3, cap: 800, runLimit: 100 },
  B: { tasks: byRow(10, 14), reps: 3, cap: 700, runLimit: 100 },
};
const STOP_SHARE = 0.6;

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
  const out = {};
  for (const [step, s] of Object.entries(STEPS)) {
    const list = cells(step);
    const arms = Object.fromEntries(ARMS.map((a) => [a, r1(list.filter((c) => c.arm === a).reduce((n, c) => n + perRun(c.task, a, mean), 0))]));
    const total = r1(Object.values(arms).reduce((a, b) => a + b, 0));
    out[step] = { tasks: s.tasks, reps: s.reps, runs: list.length, arms, total, cap: s.cap, runLimit: s.runLimit, worstCase: list.length * s.runLimit, fits: total <= s.cap };
  }
  return out;
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

function main([cmd, a, b]) {
  if (cmd === 'cells') { for (const c of cells(a)) console.log(`${c.task} ${c.arm} ${c.rep}`); return 0; }
  if (cmd === 'forecast') { console.log(JSON.stringify(forecast(a), null, 2)); return 0; }
  if (cmd === 'spent') { const s = spent(a); console.log(`${s.credits} ${s.unknown}`); return 0; }
  if (cmd === 'may-start') { const why = mayStart(a, b); if (why) { console.log(why); return 1; } return 0; }
  if (cmd === 'gate') { const why = gate(a); console.log(why.length ? `FAIL: ${why.join('; ')}` : 'PASS'); return why.length ? 1 : 0; }
  console.error('usage: study.js cells STEP | forecast [RUNS] | spent DIR | may-start DIR STEP | gate DIR');
  return 64;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { ARMS, STEPS, cells, forecast, spent, mayStart, gate };
