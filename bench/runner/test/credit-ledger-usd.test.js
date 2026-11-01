// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { openLedger, readLedger, LEDGER_FILE } = require('../lib/credit-ledger.js');

test('ledger: USD lines are kept apart from credits; the USD guard counts only USD', () => {
  const dir = tmp();
  try {
    openLedger({ dir }).record({ kind: 'run', credits: 500 });
    const l = openLedger({ dir, budget: 0.1, budgetUnit: 'usd' });
    assert.equal(l.state(), 'ok');
    l.record({ kind: 'judge', unit: 'usd', judge: 'glm-5', credits: 0, usd: 0.05 });
    assert.equal(l.state(), 'ok');
    l.record({ kind: 'judge', unit: 'usd', judge: 'glm-5', credits: 0, usd: 0.045 });
    assert.equal(l.state(), 'stop');
    assert.match(l.stopReason(), /usd guard.*\$0\.0950.*90% of the \$0\.1 guard/);
    l.record({ kind: 'judge', unit: 'usd', judge: 'glm-5', credits: 0, usd: 0.02 });
    assert.equal(l.state(), 'hard');
    const t = l.totals();
    assert.equal(t.total, 500, 'USD never enters the credit total');
    assert.equal(t.judge, 0);
    assert.equal(t.usd, 0.115);
    assert.match(l.line(), /usd: this command \$0\.1150 \(guard \$0\.1\)/);
    assert.equal(readLedger(dir).totals.usd, 0.115);
    const lines = fs.readFileSync(path.join(dir, LEDGER_FILE), 'utf8').trim().split('\n').map((x) => JSON.parse(x));
    assert.deepEqual(lines.slice(1).map((x) => [x.unit, x.usd, x.credits]), [['usd', 0.05, 0], ['usd', 0.045, 0], ['usd', 0.02, 0]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ledger: a credit guard ignores USD lines, and a USD guard ignores credits', () => {
  const dir = tmp();
  try {
    const credits = openLedger({ dir, budget: 1 });
    credits.record({ kind: 'judge', unit: 'usd', credits: 0, usd: 50 });
    assert.equal(credits.state(), 'ok');
    const usd = openLedger({ dir, budget: 1, budgetUnit: 'usd' });
    usd.record({ kind: 'judge', unit: 'credits', credits: 50 });
    assert.equal(usd.state(), 'ok');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
