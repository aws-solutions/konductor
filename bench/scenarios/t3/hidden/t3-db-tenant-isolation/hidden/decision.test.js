const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');
const { readDecision, near, meets } = require('./decision-lib.js');

// Read fixture data for calculations
const pricingData = fs.readFileSync(path.join(__dirname, '../fixture/pricing.csv'), 'utf8')
  .split('\n')
  .slice(1)
  .filter(line => line.trim())
  .map(line => {
    const [service, unit, cost_per_unit, notes] = line.split(',');
    return { service, unit, cost: parseFloat(cost_per_unit) };
  });

const storageCostPerGB = pricingData.find(d => d.service === 'storage').cost;
const connectionCost = pricingData.find(d => d.service === 'connection').cost;

// Constants from requirements
const TENANTS = 12000;
const TOTAL_ROWS = 1900000000;
const BYTES_PER_ROW = 310;
const MAX_CONNECTIONS = 1000;
const MAX_MONTHLY_COST = 600;

// Calculate expected values
const totalStorageGB = (TOTAL_ROWS * BYTES_PER_ROW) / (1024 * 1024 * 1024);
const storageCost = totalStorageGB * storageCostPerGB;

const DECISION_PATH = path.join(__dirname, '../docs/decision.md');

test('decision block exists and is valid JSON', () => {
  const decision = readDecision(DECISION_PATH);
  assert(decision, 'Decision block should exist');
  assert(typeof decision === 'object', 'Decision should be an object');
});

test('decision has required keys', () => {
  const decision = readDecision(DECISION_PATH);
  assert(decision.chosen, 'Missing "chosen" key');
  assert(Array.isArray(decision.options), '"options" should be an array');
  assert(typeof decision.limits === 'object', '"limits" should be an object');
  assert(typeof decision.monthly_cost_usd === 'number', '"monthly_cost_usd" should be a number');
});

test('chosen option is valid', () => {
  const decision = readDecision(DECISION_PATH);
  const validOptions = ['schema_tenant_column', 'schema_tenant_partition', 'tenant_views'];
  assert(
    validOptions.includes(decision.chosen),
    `Chosen option "${decision.chosen}" is not one of valid options: ${validOptions.join(', ')}`
  );
});

test('chosen option is NOT the tempting option', () => {
  const decision = readDecision(DECISION_PATH);
  const temptingOption = 'global_unique_keys';
  assert(
    decision.chosen !== temptingOption,
    `Chosen option should not be the tempting option "${temptingOption}"`
  );
});

test('options array includes chosen option', () => {
  const decision = readDecision(DECISION_PATH);
  assert(
    decision.options.includes(decision.chosen),
    'Options array should include the chosen option'
  );
});

test('monthly cost is within 10% of calculated value', () => {
  const decision = readDecision(DECISION_PATH);
  
  // Base cost calculation for tenant-column approach
  const baseCost = storageCost * 1.2; // Storage + 20% for indexes
  const computedCost = decision.monthly_cost_usd;
  
  assert(
    near(computedCost, baseCost, 0.1),
    `Monthly cost $${computedCost} should be within 10% of calculated base cost $${baseCost.toFixed(2)}`
  );
});

test('storage limit is correctly reported', () => {
  const decision = readDecision(DECISION_PATH);
  const expectedLimit = MAX_MONTHLY_COST;
  
  assert(
    meets(decision.limits, 'monthly_budget_usd', expectedLimit),
    `Limit "monthly_budget_usd" should be ${expectedLimit} and value should be <= limit`
  );
});

test('connection pool limit is correctly reported', () => {
  const decision = readDecision(DECISION_PATH);
  const expectedLimit = MAX_CONNECTIONS;
  
  assert(
    meets(decision.limits, 'database_connections', expectedLimit),
    `Limit "database_connections" should be ${expectedLimit} and value should be <= limit`
  );
});

test('row count limit is correctly reported', () => {
  const decision = readDecision(DECISION_PATH);
  const expectedLimit = TOTAL_ROWS;
  
  // For tenant-column approach, value should be <= limit
  assert(
    meets(decision.limits, 'total_rows', expectedLimit),
    `Limit "total_rows" should be ${expectedLimit} and value should be <= limit`
  );
});

test('tenant count limit is correctly reported', () => {
  const decision = readDecision(DECISION_PATH);
  const expectedLimit = TENANTS;
  
  assert(
    meets(decision.limits, 'tenant_count', expectedLimit),
    `Limit "tenant_count" should be ${expectedLimit} and value should be <= limit`
  );
});

test('all hard limits are present', () => {
  const decision = readDecision(DECISION_PATH);
  const requiredLimits = ['monthly_budget_usd', 'database_connections', 'total_rows', 'tenant_count'];
  
  requiredLimits.forEach(limitName => {
    assert(
      decision.limits[limitName],
      `Missing limit "${limitName}" in limits object`
    );
  });
});

test('limit values match chosen approach calculations', () => {
  const decision = readDecision(DECISION_PATH);
  
  // For tenant-column approach
  if (decision.chosen === 'schema_tenant_column') {
    const connectionsValue = decision.limits.database_connections.value;
    assert(
      connectionsValue <= 1000, // Should be within pool limit
      `For tenant-column approach, connections value should be <= 1000, got ${connectionsValue}`
    );
  }
});

test('cost calculation uses correct pricing', () => {
  const decision = readDecision(DECISION_PATH);
  const cost = decision.monthly_cost_usd;
  
  // Should be at least storage cost
  assert(
    cost >= storageCost * 0.9, // Allow 10% tolerance
    `Cost $${cost} seems too low compared to storage cost $${storageCost.toFixed(2)}`
  );
  
  // Should be under budget
  assert(
    cost <= MAX_MONTHLY_COST,
    `Cost $${cost} exceeds maximum budget $${MAX_MONTHLY_COST}`
  );
});