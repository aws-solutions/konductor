// SPDX-License-Identifier: Apache-2.0
'use strict';

// The study credit ledger: one JSON line per agent run and per judge call, appended to credit-ledger.jsonl in the
// results directory. By default it only tracks and prints totals. A budget passed with --budget-credits turns it into a
// guard for the command that was given it: at 90% of the budget no new work starts, at 100% the stop is hard.
// A credit line with no known cost never counts as 0: it counts at the larger of UNKNOWN_FLOOR and the highest
// per-line cost seen so far in the same ledger, so a run that lost its metering cannot slip under the guard. A USD line
// with no known cost follows the same rule in USD: the larger of UNKNOWN_USD_FLOOR and the highest USD cost seen.

const fs = require('node:fs');
const path = require('node:path');

const LEDGER_FILE = 'credit-ledger.jsonl';
const SOFT_STOP = 0.9;
/** The owner's spend rule: a call of unknown cost counts at 15 credits at least. */
const UNKNOWN_FLOOR = 15;
/** The USD floor of a call of unknown cost: the worst case of one opencode judge call (judge/run.js REASK_WORST_USD). */
const UNKNOWN_USD_FLOOR = 0.05;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** 'ok' | 'stop' (90% or more of the budget) | 'hard' (the budget or more). No budget is always 'ok'. */
function guardState(spent, budget) {
  if (!finite(budget) || budget <= 0) return 'ok';
  if (spent >= budget) return 'hard';
  return spent >= budget * SOFT_STOP ? 'stop' : 'ok';
}

function emptyTotals() {
  return { run: 0, judge: 0, other: 0, total: 0, calls: 0, unknown: 0, maxCall: 0, unknownUsd: 0, maxUsd: 0 };
}

// A run killed before its last metering event has a lower-bound `credits` and a higher `charged` estimate; the total uses the charge.
const amountOf = (entry) => (finite(entry.charged) ? entry.charged : finite(entry.credits) ? entry.credits : null);

// Judge calls on the opencode backend carry their cost in `usd` (with `credits: 0`), so they never add to a credit total or guard.
// `totals.usd` exists once such a line has been seen.
const usdOf = (entry) => (entry.unit === 'usd' && finite(entry.usd) ? entry.usd : null);

/**
 * Adds `entry` to the totals `t` and returns `{ credits, usd }`, what it was counted at. An unknown credit cost counts
 * at UNKNOWN_FLOOR or the highest seen; an unknown USD cost on a USD line at UNKNOWN_USD_FLOOR or the highest seen.
 */
function addTo(t, entry) {
  const known = amountOf(entry);
  const inUsd = entry.unit === 'usd';
  const c = known ?? (inUsd ? 0 : Math.max(UNKNOWN_FLOOR, t.maxCall));
  const key = entry.kind === 'run' || entry.kind === 'judge' ? entry.kind : 'other';
  t[key] += c;
  t.total += c;
  t.calls++;
  if (known === null) t.unknown++;
  else if (!inUsd) t.maxCall = Math.max(t.maxCall, known);
  if (entry.censored === true) t.censored = (t.censored || 0) + 1;
  let usd = 0;
  if (inUsd) {
    const u = usdOf(entry);
    if (u === null) t.unknownUsd++;
    else t.maxUsd = Math.max(t.maxUsd, u);
    usd = u ?? Math.max(UNKNOWN_USD_FLOOR, t.maxUsd);
    t.usd = (t.usd || 0) + usd;
  }
  return { credits: c, usd };
}

/** The ledger file of a results directory, parsed. A line that is not JSON is counted in `bad`, never fatal. */
function readLedger(dir) {
  const file = path.join(dir, LEDGER_FILE);
  const out = { file, exists: false, entries: [], bad: 0, totals: emptyTotals() };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  out.exists = true;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      out.entries.push(e);
      addTo(out.totals, e);
    } catch { out.bad++; }
  }
  return out;
}

const fmt = (v) => v.toFixed(2);

/**
 * A ledger bound to one results directory and one command. `totals().session` is what this command spent; the study
 * totals also include earlier commands on the same directory. `budget` is judged against the session only, in credits or
 * (`budgetUnit: 'usd'`, used by the opencode judge backend) in USD; the other unit never counts toward it.
 */
function openLedger({ dir, budget = null, budgetUnit = 'credits', create = true, now = () => new Date() }) {
  const file = path.join(dir, LEDGER_FILE);
  const study = readLedger(dir).totals;
  const t = { ...study, session: 0, sessionUsd: 0, writeFailures: 0 };
  let budgetValue = finite(budget) && budget > 0 ? budget : null;
  const inUsd = budgetUnit === 'usd';
  const state = () => guardState(inUsd ? t.sessionUsd : t.session, budgetValue);
  return {
    file,
    get budget() { return budgetValue; },
    record(entry) {
      const e = { at: now().toISOString(), ...entry };
      const counted = addTo(t, e);
      t.session += counted.credits;
      t.sessionUsd += counted.usd;
      try {
        if (create) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(e)}\n`);
      } catch { t.writeFailures++; }
    },
    totals: () => ({ ...t }),
    // The fill pass of `bench run --fill-skipped X`: a larger guard for the rest of this command. Never lowers it.
    raise(b) { if (budgetValue !== null && finite(b) && b > budgetValue) budgetValue = b; },
    // Whether a call that may cost up to `worst` (in the budget's unit) still fits under the guard. No budget: always.
    canAfford: (worst) => budgetValue === null || guardState((inUsd ? t.sessionUsd : t.session) + worst, budgetValue) === 'ok',
    state,
    shouldStop: () => state() !== 'ok',
    stopReason() {
      const s = state();
      if (s === 'ok') return null;
      const pct = s === 'hard' ? '100%' : '90%';
      if (inUsd) return `usd guard: this command has spent $${t.sessionUsd.toFixed(4)}, ${pct} of the $${budgetValue} guard`;
      const unknown = t.unknown ? `; ${t.unknown} call(s) had unknown credits and count at ${UNKNOWN_FLOOR} or the highest cost seen` : '';
      return `credit guard: this command has spent ${fmt(t.session)} credits, ${pct} of the ${budgetValue}-credit guard${unknown}`;
    },
    line() {
      const cap = budgetValue === null || inUsd ? 'no cap' : `guard ${budgetValue}`;
      const unknown = (t.unknown ? `; ${t.unknown} call(s) with unknown credits, counted at ${UNKNOWN_FLOOR} or the highest cost seen` : '') + (t.censored ? `; ${t.censored} run(s) timed out or were killed, so their share is an estimate, not a measured cost` : '');
      const unknownUsd = t.unknownUsd ? `; ${t.unknownUsd} USD call(s) with unknown cost, counted at $${UNKNOWN_USD_FLOOR} or the highest seen` : '';
      const usd = t.usd === undefined ? '' : `; usd: this command $${t.sessionUsd.toFixed(4)} (${inUsd && budgetValue !== null ? `guard $${budgetValue}` : 'no cap'}), study total $${t.usd.toFixed(4)}${unknownUsd}`;
      return `credits: this command ${fmt(t.session)} (${cap}), study total ${fmt(t.total)} (runs ${fmt(t.run)}, judge ${fmt(t.judge)}${t.other ? `, other ${fmt(t.other)}` : ''})${unknown}${usd}`;
    },
  };
}

module.exports = { openLedger, readLedger, guardState, LEDGER_FILE, SOFT_STOP, UNKNOWN_FLOOR, UNKNOWN_USD_FLOOR };
