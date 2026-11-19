// SPDX-License-Identifier: Apache-2.0
'use strict';

// What a finished run must say out loud about its credit limits, so a skipped or over-limit cell is never silent:
// cells the budget skipped (with the reason) and runs that spent more than --run-credit-limit.
// shortcut: engine v3 reports a run's credits only when its turn ends, so an over-limit run cannot be stopped
// mid-run; it is listed here with its overshoot instead (bench/DEBT.md D-67).

const cell = (r) => ({ arm: r.armId, task: r.taskId, replicate: r.replicate });

/** { budgetSkipped: [{arm, task, replicate, reason}], creditLimitExceeded: [{arm, task, replicate, credits, limit, overshoot}] } */
function creditNotes(results) {
  return {
    budgetSkipped: results.filter((r) => r.status === 'budget_skipped').map((r) => ({ ...cell(r), reason: r.error ?? null })),
    creditLimitExceeded: results
      .filter((r) => r.creditOvershoot > 0)
      .map((r) => ({ ...cell(r), credits: r.credits, limit: r.creditLimit, overshoot: r.creditOvershoot })),
  };
}

/** One log line per note, for the end of a run. */
function creditNoteLines(notes) {
  return [
    ...notes.budgetSkipped.map((s) => `budget skipped ${s.task} (${s.arm}, replicate ${s.replicate}): ${s.reason}`),
    ...notes.creditLimitExceeded.map((s) => `over the run limit ${s.task} (${s.arm}, replicate ${s.replicate}): ${Number(s.credits).toFixed(3)} credits, limit ${s.limit}, over by ${Number(s.overshoot).toFixed(3)}`),
  ];
}

module.exports = { creditNotes, creditNoteLines };
