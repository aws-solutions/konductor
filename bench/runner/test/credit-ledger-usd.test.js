// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-196 (USD side): a USD ledger line with no known cost never counts as 0. It counts at the larger of UNKNOWN_USD_FLOOR
// and the highest USD cost seen in the ledger, in the study total and in the command's USD guard.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmp } = require('./helpers.js');
const { openLedger, readLedger, UNKNOWN_USD_FLOOR } = require('../lib/credit-ledger.js');

const judge = (usd) => ({ kind: 'judge', unit: 'usd', credits: 0, usd });

test('an unknown USD cost counts at the highest USD cost seen, never 0', () => {
  const dir = tmp();
  try {
    const l = openLedger({ dir, budget: 1, budgetUnit: 'usd' });
    l.record(judge(0.2));
    l.record(judge(null));
    const t = l.totals();
    assert.equal(t.sessionUsd, 0.4);
    assert.equal(t.usd, 0.4);
    assert.equal(t.unknownUsd, 1);
    assert.equal(t.total, 0, 'no credit is counted for a USD line');
    assert.match(l.line(), /1 USD call\(s\) with unknown cost/);
    assert.equal(readLedger(dir).totals.usd, 0.4, 'the same on a re-read');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with no USD cost seen yet, an unknown one counts at the floor, and the guard sees it', () => {
  const dir = tmp();
  try {
    const l = openLedger({ dir, budget: UNKNOWN_USD_FLOOR * 1.5, budgetUnit: 'usd' });
    l.record(judge(undefined));
    assert.equal(l.totals().sessionUsd, UNKNOWN_USD_FLOOR);
    assert.equal(l.shouldStop(), false);
    l.record(judge(null));
    assert.equal(l.shouldStop(), true, 'two unknown calls pass the guard');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a cached USD call (usd 0) is a known 0 and raises nothing', () => {
  const dir = tmp();
  try {
    const l = openLedger({ dir, budgetUnit: 'usd' });
    l.record({ ...judge(0), cached: true });
    assert.equal(l.totals().usd, 0);
    assert.equal(l.totals().unknownUsd, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
