// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared by the judge passes that write a records file (judgments.json, judgments-quality.json): how a rerun replaces
// records and how spend adds up across invocations.

// A unit skipped by the budget has nothing to say; it must not replace an earlier record that has a result.
const skippedByBudget = (r) => /^budget reached/.test(r.judgeError || '');

/** Records keyed by (judge, arm, task, replicate): a fresh record replaces the old one, except a budget skip never replaces a result. */
function mergeRecords(old, fresh) {
  const keyOf = (r) => `${r.judge}|${r.armId}|${r.taskId}|${r.replicate}`;
  const m = new Map(old.map((r) => [keyOf(r), r]));
  for (const r of fresh) {
    const kept = m.get(keyOf(r));
    if (skippedByBudget(r) && kept && !kept.judgeError) continue;
    m.set(keyOf(r), r);
  }
  return [...m.values()];
}

/** { judge: amount } maps added key by key. Cached calls cost 0 now, so replacing a record never erases earlier spend. */
function addSpend(prev, current) {
  const out = { ...(prev || {}) };
  for (const [j, v] of Object.entries(current)) out[j] = (out[j] || 0) + v;
  return out;
}

module.exports = { mergeRecords, addSpend };
