const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readDecision, near, meets } = require('./decision-lib.js');
const { OPTIONS, CORRECT_CHOICE, TEMPTING_CHOICE, HARD_LIMITS } = require('./expected-values.js');

const R = __dirname + '/..';
const ADR_PATH = R + '/solution/docs/adr/0001-dr.md';

describe('Decision block parsing', () => {
  it('should find a fenced decision block', () => {
    const decision = readDecision(ADR_PATH);
    assert(decision, 'Decision block should exist');
    assert.strictEqual(typeof decision, 'object', 'Decision should be an object');
  });

  it('should have required top-level keys', () => {
    const decision = readDecision(ADR_PATH);
    assert('chosen' in decision, 'Missing "chosen" key');
    assert('options' in decision, 'Missing "options" key');
    assert('limits' in decision, 'Missing "limits" key');
    assert('monthly_cost_usd' in decision, 'Missing "monthly_cost_usd" key');
  });

  it('should have chosen as a string', () => {
    const decision = readDecision(ADR_PATH);
    assert.strictEqual(typeof decision.chosen, 'string', '"chosen" should be a string');
  });

  it('should have options as an array', () => {
    const decision = readDecision(ADR_PATH);
    assert(Array.isArray(decision.options), '"options" should be an array');
  });

  it('should have limits as an object', () => {
    const decision = readDecision(ADR_PATH);
    assert.strictEqual(typeof decision.limits, 'object', '"limits" should be an object');
    assert(!Array.isArray(decision.limits), '"limits" should not be an array');
  });

  it('should have monthly_cost_usd as a number', () => {
    const decision = readDecision(ADR_PATH);
    assert.strictEqual(typeof decision.monthly_cost_usd, 'number', '"monthly_cost_usd" should be a number');
    assert(Number.isFinite(decision.monthly_cost_usd), '"monthly_cost_usd" should be finite');
  });
});