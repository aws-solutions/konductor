// SPDX-License-Identifier: Apache-2.0
/**
 * Rebuilds a cost profile (cost-profile.js) from a spend ledger (ledger.js), for `bench.js cost-profile`.
 *
 * The calls counted are the settled ones whose cost the CLI reported: `cost_source` "reported". A "floor" row (a
 * model whose CLI reports low, charged its mean), a call charged its mean because it reported no cost, a cancelled
 * call and an expired reservation say nothing about what a call costs, so they are left out. A row needs its call `kind`
 * and `model`; a settle row that has none takes them from its reserve row, and a call with neither is left out too.
 *
 * Calls are grouped by kind and model. A group of at least MIN_CALLS calls gets a new entry: calls, failed (status
 * failed), mean, median and p90 (nearest rank), each amount rounded to AMOUNT_DECIMALS. A group with fewer, an
 * entry of the current profile that the ledger has no calls for, and the entry of a model the current profile marks
 * `cliReportsLow` (for the same kind first, else for the same model) keep the current profile's entry. A measured
 * entry has `cliReportsLow` false. With no entry measured, the profile keeps the current `measuredOn` and provenance.
 */
'use strict';

const path = require('path');
const { readLedgerRows } = require('./ledger');
const { CALL_KINDS, SCHEMA_VERSION } = require('./cost-profile');

/** The fewest calls a (kind, model) group needs before its measured figures replace the current entry. */
const MIN_CALLS = 20;
const AMOUNT_DECIMALS = 5;
const COUNTED_SOURCES = new Set(['reported']);
const P90_RANK = 0.9;
const DEFAULT_LOOKUP =
  'exact (kind, model), then (kind, "*"). kind is subject, judge or writer. With no entry, estimate_usd_per_call is used.';

const roundAmount = (amount) => Number(amount.toFixed(AMOUNT_DECIMALS));
const groupKey = (kind, model) => `${kind}\u0000${model}`;

/** The median of sorted `values`: the middle one, or the mean of the two middle ones. */
function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The nearest-rank percentile `rank` (0 to 1) of sorted `values`. */
const percentile = (sorted, rank) =>
  sorted[Math.max(0, Math.ceil(rank * sorted.length) - 1)];

/** The settled calls of `rows` that count, as { kind, model, usd, failed }. */
function countedCalls(rows) {
  const reserves = new Map(
    rows.filter((row) => row.type === 'reserve').map((row) => [row.id, row]),
  );
  const calls = [];
  for (const row of rows) {
    if (row.type !== 'settle' || !COUNTED_SOURCES.has(row.cost_source))
      continue;
    const reserve = reserves.get(row.id) || {};
    const kind = row.kind ?? reserve.kind;
    const model = row.model ?? reserve.model;
    if (!CALL_KINDS.includes(kind) || typeof model !== 'string' || !model)
      continue;
    calls.push({ kind, model, usd: row.usd, failed: row.status === 'failed' });
  }
  return calls;
}

/** One entry from the costs of one group. The p90 is at least the mean: a few costly calls can lift the mean above it. */
function measuredEntry(kind, model, group, cliReportsLow) {
  const sorted = group.map((call) => call.usd).sort((a, b) => a - b);
  const mean = sorted.reduce((sum, usd) => sum + usd, 0) / sorted.length;
  return {
    kind,
    model,
    calls: group.length,
    failed: group.filter((call) => call.failed).length,
    mean: roundAmount(mean),
    median: roundAmount(median(sorted)),
    p90: roundAmount(Math.max(percentile(sorted, P90_RANK), mean)),
    cliReportsLow,
  };
}

/** cliReportsLow of the current entry for the same kind and model, else for the same model, else false. */
function currentReportsLow(current, kind, model) {
  const entries = current.entries;
  const same =
    entries.find((entry) => entry.kind === kind && entry.model === model) ||
    entries.find((entry) => entry.model === model);
  return same?.cliReportsLow === true;
}

/**
 * A new profile from the ledger in `ledgerFile` and the current profile `current` (cost-profile.js loadProfile).
 * `today` is the measuredOn date (YYYY-MM-DD). Returns { profile, rebuilt, kept } where `rebuilt` and `kept` list the
 * "<kind> <model>" of the entries measured now and of those kept from `current`.
 */
function rebuildProfile({ ledgerFile, current, today }) {
  const calls = countedCalls(readLedgerRows(ledgerFile));
  const groups = new Map();
  for (const call of calls) {
    const key = groupKey(call.kind, call.model);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }
  const rebuilt = [];
  const kept = [];
  const entryFor = (kind, model, fallback) => {
    const group = groups.get(groupKey(kind, model)) || [];
    // A model whose CLI reports low is charged at least its mean, so its ledger rows cannot measure it: keep its entry.
    const reportsLow = currentReportsLow(current, kind, model);
    if (group.length >= MIN_CALLS && !reportsLow) {
      rebuilt.push(`${kind} ${model}`);
      return measuredEntry(kind, model, group, false);
    }
    if (fallback) kept.push(`${kind} ${model}`);
    return fallback ? { ...fallback } : null;
  };
  // The current entries first, in their order, then the new (kind, model) groups by kind and model.
  const entries = current.entries.map((entry) =>
    entryFor(entry.kind, entry.model, entry),
  );
  const known = new Set(
    current.entries.map((entry) => groupKey(entry.kind, entry.model)),
  );
  const fresh = [...groups.values()]
    .map((group) => group[0])
    .filter((call) => !known.has(groupKey(call.kind, call.model)))
    .sort(
      (left, right) =>
        CALL_KINDS.indexOf(left.kind) - CALL_KINDS.indexOf(right.kind) ||
        left.model.localeCompare(right.model),
    );
  for (const call of fresh) {
    const entry = entryFor(call.kind, call.model, null);
    if (entry) entries.push(entry);
  }
  // With nothing measured the profile is the current one, so it keeps its date and provenance.
  const measured = rebuilt.length > 0;
  const profile = {
    schemaVersion: SCHEMA_VERSION,
    measuredOn: measured ? today : current.measuredOn,
    unit: 'usd',
    provenance: measured
      ? `Rebuilt by bench.js cost-profile from the spend ledger ${path.basename(ledgerFile)}: ${calls.length} settled calls whose cost the CLI reported (cost_source reported). Entries measured from fewer than ${MIN_CALLS} calls, and those of a model whose CLI reports low, are kept from ${path.basename(current.file)}.`
      : current.provenance,
    lookup: current.lookup ?? DEFAULT_LOOKUP,
    entries,
  };
  return { profile, rebuilt, kept };
}

module.exports = { MIN_CALLS, rebuildProfile };
