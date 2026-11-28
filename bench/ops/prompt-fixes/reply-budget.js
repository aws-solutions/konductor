// SPDX-License-Identifier: Apache-2.0
'use strict';

// The reply check's spend: the paid plan, whether one more early-stopped run fits the caps, and the D-299 re-booking of
// early stops an older bench booked at the floor. All free: no model call.

const fs = require('node:fs');
const path = require('node:path');
const { loadObserved } = require('../../judge/observed-cost.js');
const { ledgerSpent } = require('../../cap/paidcall.js');
const { makeSplitReader } = require('../../runner/lib/credit-watch.js');
const { spent: runsSpent } = require('./study.js');
const { panelCallUsd, PANEL } = require('./reply-manifest.js');
const { runsOf } = require('./reply-score.js');

const CLAUDE_PER_CALL = 15;

/**
 * The paid plan: `tasks` x `reps` early-stopped live runs at `runLimit` credits each (hard per-run limit), plus the
 * `existing` outputs already on disk; one Claude reviewer call per output at 15 credits; three panel calls per output
 * in USD (opencode, observed cost by prompt size, worst case one retry each).
 */
function paidPlan({ tasks, reps, runLimit, existing = 0, promptKChars, observed = loadObserved() }) {
  const runs = tasks.length * reps;
  const outputs = runs + existing;
  let mid = 0;
  let high = 0;
  for (const j of PANEL) {
    const u = panelCallUsd(j, promptKChars, observed);
    mid += u.mid;
    high += u.high;
  }
  return {
    runs, runCredits: runs * runLimit, outputs, claudeCalls: outputs, claudeCredits: outputs * CLAUDE_PER_CALL,
    panel: PANEL, panelCalls: outputs * PANEL.length, panelCallsWorst: outputs * PANEL.length * 2,
    panelUsdMid: Number((outputs * mid).toFixed(4)), panelUsdHigh: Number((outputs * high * 2).toFixed(4)),
  };
}

/**
 * Whether one more early-stopped run may start: the runs' own ledgers under `runs` plus `runLimit` must stay within
 * `runCap`, and that plus the Claude reviewer's `ledger` within `cap`. Returns { ok, left } (the most the run may spend
 * under both) or { ok: false, why }.
 */
function mayRun({ runs, ledger, cap, runCap, runLimit }) {
  const r = runsSpent(runs);
  if (r.unknown) return { ok: false, why: `the run ledgers under ${runs} have ${r.unknown} entr(y/ies) of unknown cost; check them first` };
  const total = r.credits + ledgerSpent(ledger);
  if (r.credits + runLimit > runCap) return { ok: false, why: `run cap: ${r.credits} spent of ${runCap}, and one more run may cost up to ${runLimit}` };
  if (total + runLimit > cap) return { ok: false, why: `total cap: ${total} spent of ${cap}, and one more run may cost up to ${runLimit}` };
  return { ok: true, left: Math.round(Math.min(runCap - r.credits, cap - total) * 100) / 100 };
}

/**
 * Re-books early-stopped runs of `arm` under `runs` that an older bench charged at the censored floor although their
 * session wrote a creditSplit (D-299; the reply check's t12-mux-parallel-merge r1 of 2026-11-28, booked 1.0, measured
 * 1.642). Each such run keeps its cell (its stream and frozen prompt are the result) and gets a top-up line, measured
 * minus booked, in runs/rebooked/<cell>/credit-ledger.jsonl, once. Returns [{ cell, booked, measured, topUp }].
 */
function rebookEarly({ runs, arm, apply = false }) {
  const out = [];
  for (const { dir, result: r } of runsOf(runs, arm)) {
    if (!(r.flags ?? []).includes('earlyStopped') || r.creditMeasured != null || r.credits != null) continue;
    const measured = makeSplitReader(path.join(dir, 'session'), { flat: true }).read();
    if (measured == null) continue;
    const cell = path.resolve(dir, '..', '..', '..');
    const name = path.relative(runs, cell).split(path.sep).join('-');
    const booked = path.join(runs, 'rebooked', name);
    if (fs.existsSync(booked)) continue;
    const m = Math.ceil(measured * 1000) / 1000;
    const item = { cell: name, booked: r.creditsCharged ?? 0, measured: m, topUp: Math.round((m - (r.creditsCharged ?? 0)) * 1000) / 1000 };
    if (item.topUp <= 0) continue;
    if (apply) {
      fs.mkdirSync(booked, { recursive: true });
      const line = { at: new Date().toISOString(), kind: 'run', unit: 'credits', arm: r.armId, task: r.taskId, replicate: r.replicate ?? null, status: r.status,
        credits: item.topUp, charged: item.topUp, censored: false, rebooked: { booked: item.booked, measured: m, from: name, reason: 'D-299 early stop booked at the floor' } };
      fs.appendFileSync(path.join(booked, 'credit-ledger.jsonl'), `${JSON.stringify(line)}\n`);
    }
    out.push(item);
  }
  return out;
}

module.exports = { paidPlan, mayRun, rebookEarly };
