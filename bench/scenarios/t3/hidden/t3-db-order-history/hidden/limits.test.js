const { readDecision, meets } = require('./decision-lib.js');
const { test } = require('node:test');
const assert = require('node:assert');

const R = __dirname + '/..';
const DECISION_FILE = R + '/solution/docs/decision.md';

// Hard limits from fixture files
const STORAGE_LIMIT_TB = 2.5;
const BUDGET_LIMIT_USD = 300;
const IOPS_LIMIT = 15000;
const THROUGHPUT_LIMIT_MBPS = 500;

test('storage limit is defined and obeyed', () => {
  const decision = readDecision(DECISION_FILE);
  assert(meets(decision.limits, 'storage_tb', STORAGE_LIMIT_TB, 'max'),
    `Storage should be ≤ ${STORAGE_LIMIT_TB} TB`);
});

test('budget limit is defined and obeyed', () => {
  const decision = readDecision(DECISION_FILE);
  assert(meets(decision.limits, 'monthly_budget_usd', BUDGET_LIMIT_USD, 'max'),
    `Monthly cost should be ≤ $${BUDGET_LIMIT_USD}`);
});

test('IOPS limit is defined', () => {
  const decision = readDecision(DECISION_FILE);
  assert(meets(decision.limits, 'iops', IOPS_LIMIT, 'max'),
    `IOPS should be ≤ ${IOPS_LIMIT}`);
});

test('throughput limit is defined', () => {
  const decision = readDecision(DECISION_FILE);
  assert(meets(decision.limits, 'throughput_mbps', THROUGHPUT_LIMIT_MBPS, 'max'),
    `Throughput should be ≤ ${THROUGHPUT_LIMIT_MBPS} MB/s`);
});

test('all required limits are present', () => {
  const decision = readDecision(DECISION_FILE);
  const requiredLimits = ['storage_tb', 'monthly_budget_usd', 'iops', 'throughput_mbps'];
  
  for (const limitName of requiredLimits) {
    assert(decision.limits[limitName], `Missing limit: ${limitName}`);
    assert(typeof decision.limits[limitName].limit === 'number', 
      `Limit ${limitName}.limit should be a number`);
    assert(typeof decision.limits[limitName].value === 'number',
      `Limit ${limitName}.value should be a number`);
  }
});

test('limit values match stated limits exactly', () => {
  const decision = readDecision(DECISION_FILE);
  
  // Storage limit should be exactly 2.5
  if (decision.limits.storage_tb) {
    assert.strictEqual(decision.limits.storage_tb.limit, STORAGE_LIMIT_TB,
      `storage_tb.limit should be exactly ${STORAGE_LIMIT_TB}`);
  }
  
  // Budget limit should be exactly 300
  if (decision.limits.monthly_budget_usd) {
    assert.strictEqual(decision.limits.monthly_budget_usd.limit, BUDGET_LIMIT_USD,
      `monthly_budget_usd.limit should be exactly ${BUDGET_LIMIT_USD}`);
  }
  
  // IOPS limit should be exactly 15000
  if (decision.limits.iops) {
    assert.strictEqual(decision.limits.iops.limit, IOPS_LIMIT,
      `iops.limit should be exactly ${IOPS_LIMIT}`);
  }
  
  // Throughput limit should be exactly 500
  if (decision.limits.throughput_mbps) {
    assert.strictEqual(decision.limits.throughput_mbps.limit, THROUGHPUT_LIMIT_MBPS,
      `throughput_mbps.limit should be exactly ${THROUGHPUT_LIMIT_MBPS}`);
  }
});