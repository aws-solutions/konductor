const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readDecision } = require('./decision-lib.js');
const { OPTIONS, CORRECT_CHOICE } = require('./expected-values.js');

const R = __dirname + '/..';
const ADR_PATH = R + '/solution/docs/adr/0001-dr.md';

describe('Cost validation', () => {
  it('should have monthly cost within 10% of expected', () => {
    const decision = readDecision(ADR_PATH);
    const expectedCost = OPTIONS[CORRECT_CHOICE].monthlyCost;
    const actualCost = decision.monthly_cost_usd;
    
    assert(
      actualCost <= expectedCost * 1.1 && actualCost >= expectedCost * 0.9,
      `Monthly cost $${actualCost} should be within 10% of expected $${expectedCost}`
    );
  });

  it('should have monthly cost as a reasonable number', () => {
    const decision = readDecision(ADR_PATH);
    const cost = decision.monthly_cost_usd;
    
    assert(cost > 0, 'Monthly cost should be positive');
    assert(cost < 20000, 'Monthly cost should be reasonable (< $20,000)');
    assert.strictEqual(Math.round(cost), cost, 'Monthly cost should be rounded to nearest dollar');
  });

  it('should have cost below budget limit', () => {
    const decision = readDecision(ADR_PATH);
    const cost = decision.monthly_cost_usd;
    const budgetLimit = 12000;
    
    assert(
      cost <= budgetLimit,
      `Monthly cost $${cost} should be within budget of $${budgetLimit}`
    );
  });
});