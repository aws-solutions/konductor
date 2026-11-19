const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readDecision } = require('./decision-lib.js');

const R = __dirname + '/..';
const ADR_PATH = R + '/solution/docs/adr/0001-dr.md';

describe('Decision consistency', () => {
  it('should have chosen option in options array', () => {
    const decision = readDecision(ADR_PATH);
    assert(
      decision.options.includes(decision.chosen),
      `Chosen option "${decision.chosen}" should be in options array: ${JSON.stringify(decision.options)}`
    );
  });

  it('should have limit values consistent with chosen option', () => {
    const decision = readDecision(ADR_PATH);
    
    // Check that all limit entries have value and limit properties
    for (const [limitName, entry] of Object.entries(decision.limits)) {
      assert.strictEqual(typeof entry, 'object', `Limit entry for ${limitName} should be an object`);
      assert('limit' in entry, `Limit entry for ${limitName} missing "limit" property`);
      assert('value' in entry, `Limit entry for ${limitName} missing "value" property`);
      assert.strictEqual(typeof entry.limit, 'number', `Limit for ${limitName} should be a number`);
      assert.strictEqual(typeof entry.value, 'number', `Value for ${limitName} should be a number`);
    }
  });

  it('should have sensible limit comparisons', () => {
    const decision = readDecision(ADR_PATH);
    
    // RPO should be a maximum limit (value <= limit) - actual RPO should be less than or equal to limit
    if (decision.limits.rpo_min) {
      assert(
        decision.limits.rpo_min.value <= decision.limits.rpo_min.limit,
        `RPO value (${decision.limits.rpo_min.value}) should be <= limit (${decision.limits.rpo_min.limit})`
      );
    }
    
    // RTO should be a maximum limit (value <= limit) - actual RTO should be less than or equal to limit
    if (decision.limits.rto_min) {
      assert(
        decision.limits.rto_min.value <= decision.limits.rto_min.limit,
        `RTO value (${decision.limits.rto_min.value}) should be <= limit (${decision.limits.rto_min.limit})`
      );
    }
    
    // Budget should be a maximum limit (value <= limit)
    if (decision.limits.monthly_budget_usd) {
      assert(
        decision.limits.monthly_budget_usd.value <= decision.limits.monthly_budget_usd.limit,
        `Monthly cost (${decision.limits.monthly_budget_usd.value}) should be <= budget limit (${decision.limits.monthly_budget_usd.limit})`
      );
    }
  });
});