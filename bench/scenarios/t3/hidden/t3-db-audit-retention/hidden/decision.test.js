const { readDecision, near, meets } = require('./decision-lib.js');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.join(__dirname, '..');
const DECISION_FILE = path.join(R, 'solution', 'docs', 'decision.md');

// Helper to read CSV
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = values[i];
    });
    return obj;
  });
}

// Helper to extract numbers from text
function extractNumber(text, label) {
  const match = text.match(new RegExp(`${label}[\\s:]*([\\d,.]+)`));
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ''));
}

test('decision file exists', () => {
  assert.ok(fs.existsSync(DECISION_FILE), 'docs/decision.md should exist in solution');
});

test('decision block is present and valid JSON', () => {
  const decision = readDecision(DECISION_FILE);
  assert(decision, 'Decision block should be present');
  assert(typeof decision === 'object', 'Decision should be a JSON object');
});

test('decision has required keys', () => {
  const decision = readDecision(DECISION_FILE);
  assert('chosen' in decision, 'Missing "chosen" key');
  assert('options' in decision, 'Missing "options" key');
  assert('limits' in decision, 'Missing "limits" key');
  assert('monthly_cost_usd' in decision, 'Missing "monthly_cost_usd" key');
});

test('options is an array', () => {
  const decision = readDecision(DECISION_FILE);
  assert(Array.isArray(decision.options), '"options" should be an array');
});

test('chosen is one of the options', () => {
  const decision = readDecision(DECISION_FILE);
  assert(decision.options.includes(decision.chosen), 
    `chosen "${decision.chosen}" should be in options ${JSON.stringify(decision.options)}`);
});

test('chosen is not tempting option (3-indexes)', () => {
  const decision = readDecision(DECISION_FILE);
  assert.notStrictEqual(decision.chosen, '3-indexes',
    'Should not choose 3-indexes option as it exceeds storage limit');
});

test('chosen is not tempting option (2-indexes)', () => {
  const decision = readDecision(DECISION_FILE);
  assert.notStrictEqual(decision.chosen, '2-indexes',
    'Should not choose 2-indexes option as it exceeds storage limit');
});

test('limits is an object', () => {
  const decision = readDecision(DECISION_FILE);
  assert(typeof decision.limits === 'object' && !Array.isArray(decision.limits),
    '"limits" should be an object');
});

test('monthly_cost_usd is a number', () => {
  const decision = readDecision(DECISION_FILE);
  assert(typeof decision.monthly_cost_usd === 'number',
    '"monthly_cost_usd" should be a number');
});

// Now test actual calculations
test('storage calculation matches requirements', async (t) => {
  // Read traffic analysis
  const trafficPath = path.join(R, 'fixture', 'operations', 'traffic-analysis.md');
  const trafficText = fs.readFileSync(trafficPath, 'utf8');
  
  // Read compliance
  const compliancePath = path.join(R, 'fixture', 'requirements', 'compliance.md');
  const complianceText = fs.readFileSync(compliancePath, 'utf8');
  
  // Read budget constraints
  const budgetPath = path.join(R, 'fixture', 'finance', 'budget-constraints.md');
  const budgetText = fs.readFileSync(budgetPath, 'utf8');
  
  // Read storage costs
  const costsPath = path.join(R, 'fixture', 'finance', 'storage-costs.csv');
  const costsText = fs.readFileSync(costsPath, 'utf8');
  const costs = parseCSV(costsText);
  const standardCost = parseFloat(costs.find(c => c.storage_tier === 'standard' && c.region === 'us-east-1').cost_per_gb_month_usd);
  
  // Extract numbers
  const eventsPerSec = 25000; // From traffic-analysis.md
  const bytesPerRow = 220; // From traffic-analysis.md
  const retentionDays = 400; // From compliance.md
  const storageLimitTB = 300; // From budget-constraints.md
  const storageBudgetUSD = 7000; // From budget-constraints.md
  
  // Calculate raw storage
  const secondsPerDay = 24 * 60 * 60;
  const rowsPerDay = eventsPerSec * secondsPerDay;
  const bytesPerDay = rowsPerDay * bytesPerRow;
  const terabytesPerDay = bytesPerDay / (1024 ** 4); // Bytes to TB
  const rawStorageTB = terabytesPerDay * retentionDays;
  
  // Index overhead factors
  const overheads = {
    '1-index': 1.6,   // 60% overhead
    '2-indexes': 2.2, // 120% overhead  
    '3-indexes': 2.8  // 180% overhead
  };
  
  const decision = readDecision(DECISION_FILE);
  
  // Check each limit
  t.test('storage_limit_tb present', () => {
    assert('storage_limit_tb' in decision.limits, 'Missing storage_limit_tb limit');
  });
  
  t.test('storage_limit_tb value calculated correctly', () => {
    const limitEntry = decision.limits.storage_limit_tb;
    assert(limitEntry, 'storage_limit_tb entry missing');
    assert.strictEqual(limitEntry.limit, storageLimitTB, `Limit should be ${storageLimitTB} TB`);
    
    // Calculate expected storage based on chosen option
    const overhead = overheads[decision.chosen] || 1.6;
    const expectedStorageTB = rawStorageTB * overhead;
    
    assert(near(limitEntry.value, expectedStorageTB, 0.1),
      `Storage value ${limitEntry.value} TB should be near ${expectedStorageTB} TB (±10%)`);
  });
  
  t.test('storage_budget_usd present', () => {
    assert('storage_budget_usd' in decision.limits, 'Missing storage_budget_usd limit');
  });
  
  t.test('storage_budget_usd value matches constraint', () => {
    const limitEntry = decision.limits.storage_budget_usd;
    assert(limitEntry, 'storage_budget_usd entry missing');
    assert.strictEqual(limitEntry.limit, storageBudgetUSD, `Limit should be ${storageBudgetUSD} USD`);
  });
  
  t.test('monthly cost matches calculation', () => {
    const overhead = overheads[decision.chosen] || 1.6;
    const expectedStorageTB = rawStorageTB * overhead;
    const expectedStorageGB = expectedStorageTB * 1024;
    const expectedCost = expectedStorageGB * standardCost;
    
    assert(near(decision.monthly_cost_usd, expectedCost, 0.1),
      `Monthly cost $${decision.monthly_cost_usd} should be near $${expectedCost} (±10%)`);
  });
});

test('limits obey constraints', () => {
  const decision = readDecision(DECISION_FILE);
  
  // Storage limit check
  assert(meets(decision.limits, 'storage_limit_tb', 300, 'max'),
    `Storage ${decision.limits.storage_limit_tb?.value} TB exceeds 300 TB limit`);
  
  // Budget limit check  
  assert(meets(decision.limits, 'storage_budget_usd', 7000, 'max'),
    `Monthly cost $${decision.monthly_cost_usd} exceeds $7,000 budget`);
});

test('schema file exists', () => {
  const schemaPath = path.join(R, 'solution', 'db', 'schema.sql');
  assert.ok(fs.existsSync(schemaPath), 'db/schema.sql should exist in solution');
});

test('schema includes partitioning or bucket strategy', () => {
  const schemaPath = path.join(R, 'solution', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8').toLowerCase();
  
  // Check for partitioning or bucket strategy
  const hasPartition = schema.includes('partition') || schema.includes('bucket');
  assert(hasPartition, 'Schema should include partitioning or bucket strategy for retention cleanup');
});