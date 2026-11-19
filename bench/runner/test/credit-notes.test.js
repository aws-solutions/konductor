// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { creditNotes, creditNoteLines } = require('../lib/credit-notes.js');

const results = [
  { armId: 'a', taskId: 't1', replicate: 1, status: 'success', credits: 12.7, creditLimit: 6, creditOvershoot: 6.7 },
  { armId: 'a', taskId: 't2', replicate: 1, status: 'budget_skipped', error: 'budget headroom: charged 15.9 + largest run so far 12.7 would pass the budget 25' },
  { armId: 'a', taskId: 't3', replicate: 1, status: 'success', credits: 1, creditLimit: 6, creditOvershoot: null },
];

test('creditNotes lists skipped cells with their reason and runs over the limit with the overshoot', () => {
  const n = creditNotes(results);
  assert.deepEqual(n.budgetSkipped, [{ arm: 'a', task: 't2', replicate: 1, reason: results[1].error }]);
  assert.deepEqual(n.creditLimitExceeded, [{ arm: 'a', task: 't1', replicate: 1, credits: 12.7, limit: 6, overshoot: 6.7 }]);
});

test('creditNoteLines has one line per note and none for a clean run', () => {
  assert.equal(creditNoteLines(creditNotes(results)).length, 2);
  assert.deepEqual(creditNoteLines(creditNotes([results[2]])), []);
});
