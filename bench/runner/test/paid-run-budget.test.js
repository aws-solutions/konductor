// SPDX-License-Identifier: Apache-2.0
// Every run that can spend carries a budget (runner/lib/paid-run.js). No model, no network, no spend.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { isFreeRun, requireRunBudget } = require('../lib/paid-run.js');

const CONTROLS = path.join(__dirname, '..', '..', 'physical', 'controls');

test('a paid run without a budget is refused; a plant control or a fake Strands model is free', () => {
  assert.equal(isFreeRun({ opts: {} }), false);
  assert.equal(isFreeRun({ opts: { 'kiro-bin': '/usr/bin/kiro-cli' } }), false);
  assert.equal(isFreeRun({ opts: { 'kiro-bin': path.join(CONTROLS, 'do-nothing-kiro') } }), true);
  assert.equal(isFreeRun({ opts: { 'claude-bin': path.join(CONTROLS, 'do-nothing-claude') } }), true);
  assert.equal(isFreeRun({ opts: { model: 'fake:do-nothing' } }), true);
  assert.equal(isFreeRun({ opts: { model: 'bedrock:qwen.qwen3-32b' } }), false);
  assert.equal(isFreeRun({ opts: {} }), false);
  assert.throws(() => requireRunBudget({ free: false, budget: null, budgetFlag: 'budget-credits' }), /needs --budget-credits/);
  assert.doesNotThrow(() => requireRunBudget({ free: false, budget: 50, budgetFlag: 'budget-credits' }));
  assert.doesNotThrow(() => requireRunBudget({ free: true, budget: null, budgetFlag: 'budget-credits' }));
});
