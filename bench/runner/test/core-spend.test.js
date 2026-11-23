// SPDX-License-Identifier: Apache-2.0
// The one spend count (core/spend.js): the run ledger, the paid keep-or-prune ledger and the bash chains' study sums
// all read lines and count unknown costs the same way. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const spend = require('../../core/spend.js');
const { readLedger } = require('../lib/credit-ledger.js');
const { ledgerSpent } = require('../../cap/paidcall.js');
const { studyCredits } = require('../../scripts/lib/ledger.js');

test('readJsonl keeps good lines, counts bad ones, and reads a missing file as empty', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'l.jsonl');
    assert.deepEqual(spend.readJsonl(f), { exists: false, entries: [], bad: 0 });
    write(f, '{"a":1}\nnot json\n\n{"a":2}\n');
    assert.deepEqual(spend.readJsonl(f), { exists: true, entries: [{ a: 1 }, { a: 2 }], bad: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('creditsOf: known cost as is, charge over credits, an unknown cost at the larger of 15 and the highest seen', () => {
  assert.equal(spend.creditsOf({ credits: 2 }, 0), 2);
  assert.equal(spend.creditsOf({ credits: 0.2, charged: 1.5 }, 0), 1.5);
  assert.equal(spend.creditsOf({ credits: null }, 0), 15);
  assert.equal(spend.creditsOf({ credits: null }, 40), 40);
  assert.equal(spend.creditsOf({ unit: 'usd', credits: null }, 40), 0, 'a USD line adds no credits');
});

test('the three ledger readers agree with the one count', () => {
  const dir = tmp();
  try {
    write(path.join(dir, 'credit-ledger.jsonl'), [{ kind: 'run', credits: 2 }, { kind: 'run', credits: null }, { kind: 'run', charged: 20, credits: 1 }, { kind: 'run', credits: null }].map((e) => JSON.stringify(e)).join('\n') + '\n');
    assert.equal(readLedger(dir).totals.total, 2 + 15 + 20 + 20);
    assert.equal(studyCredits([dir]).credits, 2 + 15 + 20 + 20, 'the bash chains print the same total');
    write(path.join(dir, 'kp.jsonl'), '{"counted":15}\n{"counted":3}\nbad\n');
    assert.equal(ledgerSpent(path.join(dir, 'kp.jsonl')), 15 + 3 + 15, 'a torn line in the paid ledger counts as one more call at 15');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
