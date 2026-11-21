const { readDecision, near, meets } = require('./decision-lib.js');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

// Load fixture data
const R = path.join(__dirname, '..');
const pricing = JSON.parse(fs.readFileSync(path.join(R, 'fixture', 'pricing.json'), 'utf8'));
const dataGrowth = fs.readFileSync(path.join(R, 'fixture', 'data-growth.csv'), 'utf8')
  .split('\n')
  .slice(1)
  .filter(line => line.trim())
  .map(line => {
    const [quarter, data_tb, events_millions, cost_batch, cost_streaming] = line.split(',');
    return {
      quarter,
      data_tb: parseFloat(data_tb),
      events_millions: parseFloat(events_millions),
      cost_batch: parseFloat(cost_batch),
      cost_streaming: parseFloat(cost_streaming)
    };
  });

// Helper to calculate costs
function calculateBatchCost(dataTB) {
  const hourlyRate = pricing.batch_processing.pricing[0].cost_per_hour; // $68
  const storagePerTB = pricing.batch_processing.storage.cost_per_tb_month; // $23
  
  // Current: 1.4 TB takes 2.1 hours
  const processingHours = (dataTB * 2.1) / 1.4;
  const monthlyHours = processingHours * 30; // Run nightly for 30 days
  
  // For 2x scaling: double the compute cost
  const computeCost = 2 * hourlyRate * monthlyHours;
  const storageCost = dataTB * storagePerTB;
  
  return Math.round(computeCost + storageCost);
}

function calculateStreamingCost(dataTB) {
  const baseSetup = pricing.streaming_processing.pricing[0].cost_per_month; // $1250
  const storagePerGB = pricing.streaming_processing.pricing[3].cost_per_gb_month; // $0.023
  const eventsPerMillion = pricing.streaming_processing.pricing[2].cost_per_million_events; // $0.85
  
  const dataGB = dataTB * 1024;
  const eventsPerGB = 15000; // From traffic-analysis.md
  const eventsMillions = (dataGB * eventsPerGB) / 1000000;
  
  const storageCost = dataGB * storagePerGB;
  const eventsCost = eventsMillions * eventsPerMillion;
  
  return Math.round(baseSetup + storageCost + eventsCost);
}

test('decision block exists and is valid JSON', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  assert(decision, 'Decision block should exist');
  assert(typeof decision === 'object', 'Decision should be an object');
  assert(decision.chosen, 'Decision should have "chosen" key');
  assert(Array.isArray(decision.options), 'Decision should have "options" array');
  assert(decision.limits && typeof decision.limits === 'object', 'Decision should have "limits" object');
  assert(typeof decision.monthly_cost_usd === 'number', 'Decision should have "monthly_cost_usd" number');
});

test('chosen option is one of acceptable options', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  const acceptableOptions = ['batch_2x_scaling', 'streaming'];
  assert(
    acceptableOptions.includes(decision.chosen),
    `Chosen option "${decision.chosen}" should be one of: ${acceptableOptions.join(', ')}`
  );
});

test('chosen option is not the tempting option', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  const temptingOption = 'batch_current';
  assert(
    decision.chosen !== temptingOption,
    `Should not choose tempting option "${temptingOption}" which fails processing window`
  );
});

test('all required limits are present', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  const limits = decision.limits;
  
  const requiredLimits = [
    'processing_window_hours',
    'monthly_budget_usd', 
    'data_accuracy_percent',
    'system_uptime_percent',
    'data_volume_tb_q3_2025'
  ];
  
  requiredLimits.forEach(limitName => {
    assert(limits[limitName], `Missing limit: ${limitName}`);
    assert(typeof limits[limitName].limit === 'number', `Limit ${limitName} should have numeric limit`);
    assert(typeof limits[limitName].value === 'number', `Limit ${limitName} should have numeric value`);
  });
});

test('processing window limit is correctly specified', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  // From requirements.md: 4 hours maximum
  assert.strictEqual(decision.limits.processing_window_hours.limit, 4.0);
});

test('processing window is obeyed for chosen option', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  const limit = decision.limits.processing_window_hours;
  assert(
    meets(decision.limits, 'processing_window_hours', 4.0, 'max'),
    `Processing window value ${limit.value} should be ≤ ${limit.limit}`
  );
});

test('monthly budget limit is correctly specified', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  // From business-constraints.md: $10,000 maximum
  assert.strictEqual(decision.limits.monthly_budget_usd.limit, 10000);
});

test('monthly budget is obeyed for chosen option', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  const limit = decision.limits.monthly_budget_usd;
  assert(
    meets(decision.limits, 'monthly_budget_usd', 10000, 'max'),
    `Monthly budget value ${limit.value} should be ≤ ${limit.limit}`
  );
});

test('monthly cost matches calculated cost for chosen option', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  const q4Data = dataGrowth.find(d => d.quarter === '2025-Q3'); // 4.65 TB at Q3 2025
  let expectedCost;
  
  if (decision.chosen === 'batch_2x_scaling') {
    // Use CSV value for batch cost at 4.65 TB
    expectedCost = q4Data.cost_batch;
  } else if (decision.chosen === 'streaming') {
    // Use CSV value for streaming cost at 4.65 TB
    expectedCost = q4Data.cost_streaming;
  } else {
    throw new Error(`Unknown chosen option: ${decision.chosen}`);
  }
  
  assert(
    near(decision.monthly_cost_usd, expectedCost, 0.1),
    `Monthly cost $${decision.monthly_cost_usd} should be within 10% of CSV value $${expectedCost}`
  );
});

test('Q3 2025 data volume limit is correctly specified', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  // From traffic-analysis.md: 4.65 TB at Q3 2025
  const q3Data = dataGrowth.find(d => d.quarter === '2025-Q3');
  assert.strictEqual(decision.limits.data_volume_tb_q3_2025.limit, q3Data.data_tb);
});

test('data accuracy limit is correctly specified', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  // From requirements.md: 99.9% accuracy
  assert.strictEqual(decision.limits.data_accuracy_percent.limit, 99.9);
});

test('data accuracy is obeyed', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  assert(
    meets(decision.limits, 'data_accuracy_percent', 99.9, 'min'),
    `Data accuracy ${decision.limits.data_accuracy_percent.value}% should be ≥ 99.9%`
  );
});

test('system uptime limit is correctly specified', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  // From requirements.md: 99.5% uptime
  assert.strictEqual(decision.limits.system_uptime_percent.limit, 99.5);
});

test('system uptime is obeyed', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  assert(
    meets(decision.limits, 'system_uptime_percent', 99.5, 'min'),
    `System uptime ${decision.limits.system_uptime_percent.value}% should be ≥ 99.5%`
  );
});

test('chosen option value for processing window is reasonable', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  const q4Data = dataGrowth.find(d => d.quarter === '2025-Q3');
  let expectedHours;
  
  if (decision.chosen === 'batch_2x_scaling') {
    // With 2x scaling: half the time
    expectedHours = (q4Data.data_tb * 2.1) / 1.4 / 2;
  } else if (decision.chosen === 'streaming') {
    // Streaming: near-real-time, effectively 0 for batch window purposes
    expectedHours = 0;
  }
  
  const reportedHours = decision.limits.processing_window_hours.value;
  assert(
    near(reportedHours, expectedHours, 0.15), // 15% tolerance for rounding
    `Processing window value ${reportedHours} should be near calculated ${expectedHours}`
  );
});

test('options array includes all considered options', () => {
  const file = path.join(R, 'solution', 'docs', 'adr', '0001-processing.md');
  const decision = readDecision(file);
  
  const expectedOptions = ['batch_current', 'batch_2x_scaling', 'batch_3x_scaling', 'streaming'];
  expectedOptions.forEach(option => {
    assert(
      decision.options.includes(option),
      `Options array should include ${option}`
    );
  });
});