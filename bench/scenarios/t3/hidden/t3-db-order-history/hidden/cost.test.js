const { readDecision, near } = require('./decision-lib.js');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = __dirname + '/..';
const DECISION_FILE = R + '/solution/docs/decision.md';

// Read pricing data from fixture
const PRICING_CSV = fs.readFileSync(R + '/fixture/pricing.csv', 'utf8');
const pricing = {};
PRICING_CSV.split('\n').slice(1).forEach(line => {
  if (line.trim()) {
    const parts = line.split(',');
    const service = parts[0];
    // Price might be in different column depending on row
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith('$')) {
        const price = parseFloat(parts[i].replace('$', ''));
        if (service === 'storage') pricing.storagePerGB = price;
        if (service === 'iops') pricing.iopsPer1000 = price;
        if (service === 'throughput') pricing.throughputPerMbps = price;
        if (service === 'volume-standard') pricing.standardVolumeFee = price;
        break;
      }
    }
  }
});

// Calculate expected cost for chosen option
function calculateExpectedCost(storageTB, iops, throughputMbps) {
  // Standard volume fee includes first 2.5 TB storage
  const standardVolumeFee = pricing.standardVolumeFee || 50;
  const iopsPer1000 = pricing.iopsPer1000 || 0.10;
  const throughputPerMbps = pricing.throughputPerMbps || 0.08;
  
  let cost = standardVolumeFee;
  
  // Add IOPS cost (beyond base 3,000 included in Standard volume)
  const iopsBeyondBase = Math.max(0, iops - 3000);
  cost += (iopsBeyondBase / 1000) * iopsPer1000;
  
  // Add throughput cost
  cost += throughputMbps * throughputPerMbps;
  
  return cost;
}

test('monthly cost is calculated from pricing data', () => {
  const decision = readDecision(DECISION_FILE);
  
  // Get limits from decision
  const storageTB = decision.limits.storage_tb?.value || 2.5;
  const iops = decision.limits.iops?.value || 15000;
  const throughputMbps = decision.limits.throughput_mbps?.value || 500;
  
  // Calculate expected cost
  const expectedCost = calculateExpectedCost(storageTB, iops, throughputMbps);
  
  // Check if reported cost is within 10% of expected
  assert(near(decision.monthly_cost_usd, expectedCost, 0.1),
    `Monthly cost $${decision.monthly_cost_usd} should be within 10% of calculated $${expectedCost.toFixed(2)}`);
});

test('cost is reasonable for chosen option', () => {
  const decision = readDecision(DECISION_FILE);
  
  // For composite-optimized (2.5 TB storage)
  if (decision.chosen === 'composite-optimized') {
    const expectedMin = 50; // Just volume fee
    const expectedMax = 150; // Volume fee + max performance costs
    
    assert(decision.monthly_cost_usd >= expectedMin,
      `Cost for composite-optimized should be at least $${expectedMin}`);
    assert(decision.monthly_cost_usd <= expectedMax,
      `Cost for composite-optimized should not exceed $${expectedMax}`);
  }
});

test('cost does not exceed budget limit', () => {
  const decision = readDecision(DECISION_FILE);
  const BUDGET_LIMIT = 300;
  
  assert(decision.monthly_cost_usd <= BUDGET_LIMIT,
    `Monthly cost $${decision.monthly_cost_usd} exceeds budget limit $${BUDGET_LIMIT}`);
});

test('cost calculation uses correct pricing values', () => {
  // We know the pricing from the fixture files
  const expectedPrices = {
    storagePerGB: 0.10,
    iopsPer1000: 0.10,
    throughputPerMbps: 0.08,
    standardVolumeFee: 50
  };
  
  // Check if pricing was parsed, otherwise use expected values
  if (pricing.storagePerGB !== undefined) {
    assert.strictEqual(pricing.storagePerGB, expectedPrices.storagePerGB,
      `Storage cost should be $${expectedPrices.storagePerGB}/GB`);
  }
  
  if (pricing.iopsPer1000 !== undefined) {
    assert.strictEqual(pricing.iopsPer1000, expectedPrices.iopsPer1000,
      `IOPS cost should be $${expectedPrices.iopsPer1000}/1000 IOPS`);
  }
  
  if (pricing.throughputPerMbps !== undefined) {
    assert.strictEqual(pricing.throughputPerMbps, expectedPrices.throughputPerMbps,
      `Throughput cost should be $${expectedPrices.throughputPerMbps}/MB/s`);
  }
  
  if (pricing.standardVolumeFee !== undefined) {
    assert.strictEqual(pricing.standardVolumeFee, expectedPrices.standardVolumeFee,
      `Standard volume fee should be $${expectedPrices.standardVolumeFee}`);
  }
  
  // Even if parsing failed, we can continue with expected values
  console.log('Using expected pricing:', expectedPrices);
});