const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readDecision, meets } = require('./decision-lib.js');
const { HARD_LIMITS, OPTIONS, CORRECT_CHOICE } = require('./expected-values.js');

const R = __dirname + '/..';
const ADR_PATH = R + '/solution/docs/adr/0001-dr.md';

describe('Limits validation', () => {
  it('should have all required limit entries', () => {
    const decision = readDecision(ADR_PATH);
    const requiredLimits = Object.keys(HARD_LIMITS);
    const actualLimits = Object.keys(decision.limits || {});
    
    for (const limitName of requiredLimits) {
      assert(
        actualLimits.includes(limitName),
        `Missing limit entry: ${limitName}`
      );
    }
  });

  it('should have correct limit values for RPO', () => {
    const decision = readDecision(ADR_PATH);
    const expectedLimit = HARD_LIMITS.rpo_min;
    assert(
      meets(decision.limits, 'rpo_min', expectedLimit, 'max'),
      `RPO limit should be ${expectedLimit} minutes (maximum) with value <= limit`
    );
  });

  it('should have correct limit values for RTO', () => {
    const decision = readDecision(ADR_PATH);
    const expectedLimit = HARD_LIMITS.rto_min;
    assert(
      meets(decision.limits, 'rto_min', expectedLimit, 'max'),
      `RTO limit should be ${expectedLimit} minutes (maximum) with value <= limit`
    );
  });

  it('should have correct limit values for budget', () => {
    const decision = readDecision(ADR_PATH);
    const expectedLimit = HARD_LIMITS.monthly_budget_usd;
    assert(
      meets(decision.limits, 'monthly_budget_usd', expectedLimit, 'max'),
      `Budget limit should be ${expectedLimit} USD (maximum) with value <= limit`
    );
  });

  it('should have correct RPO value for chosen option', () => {
    const decision = readDecision(ADR_PATH);
    const limitEntry = decision.limits.rpo_min;
    assert(limitEntry, 'Missing rpo_min entry');
    assert.strictEqual(typeof limitEntry.value, 'number', 'RPO value should be a number');
    
    const expectedRpo = OPTIONS[CORRECT_CHOICE].rpoMinutes;
    assert(
      limitEntry.value <= expectedRpo * 1.1 && limitEntry.value >= expectedRpo * 0.9,
      `RPO value ${limitEntry.value} should be within 10% of expected ${expectedRpo}`
    );
  });

  it('should have correct RTO value for chosen option', () => {
    const decision = readDecision(ADR_PATH);
    const limitEntry = decision.limits.rto_min;
    assert(limitEntry, 'Missing rto_min entry');
    assert.strictEqual(typeof limitEntry.value, 'number', 'RTO value should be a number');
    
    const expectedRto = OPTIONS[CORRECT_CHOICE].rtoMinutes;
    assert(
      limitEntry.value <= expectedRto * 1.1 && limitEntry.value >= expectedRto * 0.9,
      `RTO value ${limitEntry.value} should be within 10% of expected ${expectedRto}`
    );
  });
});