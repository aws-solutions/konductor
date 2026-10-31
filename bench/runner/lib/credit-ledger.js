// SPDX-License-Identifier: Apache-2.0
'use strict';

// The study credit ledger: one JSON line per agent run and per judge call, appended to credit-ledger.jsonl in the
// results directory. By default it only tracks and prints totals. A budget passed with --budget-credits turns it into a
// guard for the command that was given it: at 90% of the budget no new work starts, at 100% the stop is hard.

const fs = require('node:fs');
const path = require('node:path');

const LEDGER_FILE = 'credit-ledger.jsonl';
const SOFT_STOP = 0.9;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** 'ok' | 'stop' (90% or more of the budget) | 'hard' (the budget or more). No budget is always 'ok'. */
function guardState(spent, budget) {
  if (!finite(budget) || budget <= 0) return 'ok';
  if (spent >= budget) return 'hard';
  return spent >= budget * SOFT_STOP ? 'stop' : 'ok';
}

function emptyTotals() {
  return { run: 0, judge: 0, other: 0, total: 0, calls: 0, unknown: 0 };
}

// A run killed before its last metering event has a lower-bound `credits` and a higher `charged` estimate; the total uses the charge.
const amountOf = (entry) => (finite(entry.charged) ? entry.charged : finite(entry.credits) ? entry.credits : null);

function addTo(t, entry) {
  const c = amountOf(entry) ?? 0;
  const key = entry.kind === 'run' || entry.kind === 'judge' ? entry.kind : 'other';
  t[key] += c;
  t.total += c;
  t.calls++;
  if (amountOf(entry) === null) t.unknown++;
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
 * totals also include earlier commands on the same directory. `budget` (credits) is judged against the session only.
 */
function openLedger({ dir, budget = null, create = true, now = () => new Date() }) {
  const file = path.join(dir, LEDGER_FILE);
  const study = readLedger(dir).totals;
  const t = { ...study, session: 0, writeFailures: 0 };
  const budgetValue = finite(budget) && budget > 0 ? budget : null;
  const state = () => guardState(t.session, budgetValue);
  return {
    file,
    budget: budgetValue,
    record(entry) {
      const e = { at: now().toISOString(), ...entry };
      addTo(t, e);
      t.session += amountOf(e) ?? 0;
      try {
        if (create) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(e)}\n`);
      } catch { t.writeFailures++; }
    },
    totals: () => ({ ...t }),
    state,
    shouldStop: () => state() !== 'ok',
    stopReason() {
      const s = state();
      if (s === 'ok') return null;
      const pct = s === 'hard' ? '100%' : '90%';
      return `credit guard: this command has spent ${fmt(t.session)} credits, ${pct} of the ${budgetValue}-credit guard`;
    },
    line() {
      const cap = budgetValue === null ? 'no cap' : `guard ${budgetValue}`;
      const unknown = t.unknown ? `; ${t.unknown} call(s) with unknown credits` : '';
      return `credits: this command ${fmt(t.session)} (${cap}), study total ${fmt(t.total)} (runs ${fmt(t.run)}, judge ${fmt(t.judge)}${t.other ? `, other ${fmt(t.other)}` : ''})${unknown}`;
    },
  };
}

module.exports = { openLedger, readLedger, guardState, LEDGER_FILE, SOFT_STOP };
