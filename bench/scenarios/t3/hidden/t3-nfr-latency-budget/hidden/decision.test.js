const { readDecision, near, meets } = require('./decision-lib.js');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = path.join(__dirname, '..');
const FIXTURE = path.join(R, 'fixture');
const SOLUTION = path.join(R, 'solution');

test('decision block exists and is valid JSON', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  assert.ok(decision, 'Decision should be parsed');
  assert.ok(typeof decision === 'object', 'Decision should be an object');
});

test('decision has required keys', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  assert.ok(decision.chosen, 'Missing "chosen" key');
  assert.ok(Array.isArray(decision.options), '"options" should be an array');
  assert.ok(decision.limits && typeof decision.limits === 'object', '"limits" should be an object');
  assert.ok(typeof decision.monthly_cost_usd === 'number', '"monthly_cost_usd" should be a number');
});

test('chosen option is one of acceptable options', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  // Acceptable options that meet all limits
  const acceptableOptions = ['parallel', 'cache_parallel'];
  
  assert.ok(
    acceptableOptions.includes(decision.chosen),
    `Chosen option "${decision.chosen}" should be one of acceptable options: ${acceptableOptions.join(', ')}`
  );
});

test('chosen option is not the tempting base option', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  assert.notStrictEqual(
    decision.chosen,
    'base',
    'Chosen option should not be "base" (tempting but breaks latency limit)'
  );
});

test('options array includes all considered options', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  // Should at minimum include base, parallel, cache, cache_parallel
  const expectedOptions = ['base', 'parallel', 'cache', 'cache_parallel'];
  expectedOptions.forEach(opt => {
    assert.ok(
      decision.options.includes(opt),
      `Options array should include "${opt}"`
    );
  });
});

test('monthly cost matches cost sheet for chosen option', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  // Read cost options from CSV
  const costCsv = fs.readFileSync(path.join(FIXTURE, 'cost-options.csv'), 'utf8');
  const lines = costCsv.trim().split('\n');
  const header = lines[0].split(',');
  const optionIndex = header.indexOf('option_id');
  const costIndex = header.indexOf('monthly_cost_usd');
  
  let expectedCost = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols[optionIndex] === decision.chosen) {
      expectedCost = parseFloat(cols[costIndex]);
      break;
    }
  }
  
  assert.ok(expectedCost !== null, `Could not find cost for option "${decision.chosen}" in cost-options.csv`);
  assert.ok(
    near(decision.monthly_cost_usd, expectedCost, 0.1),
    `Monthly cost ${decision.monthly_cost_usd} should be near ${expectedCost} for option "${decision.chosen}"`
  );
});

test('p99 latency limit is present and correct', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  // p99 latency limit from requirements.md
  const requirements = fs.readFileSync(path.join(FIXTURE, 'requirements.md'), 'utf8');
  const latencyMatch = requirements.match(/End-to-end p99 latency for checkout requests:.*?≤\s*([\d.]+)\s*ms/i);
  assert.ok(latencyMatch, 'Could not find p99 latency limit in requirements.md');
  const latencyLimit = parseFloat(latencyMatch[1]);
  
  assert.ok(
    decision.limits.p99_latency_ms,
    'Missing p99_latency_ms in limits'
  );
  assert.strictEqual(
    decision.limits.p99_latency_ms.limit,
    latencyLimit,
    `p99 latency limit should be ${latencyLimit}`
  );
});

test('monthly budget limit is present and correct', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  // Monthly budget from requirements.md
  const requirements = fs.readFileSync(path.join(FIXTURE, 'requirements.md'), 'utf8');
  const budgetMatch = requirements.match(/Monthly infrastructure budget:.*?\$([\d,]+)\s*USD/i);
  assert.ok(budgetMatch, 'Could not find monthly budget in requirements.md');
  const budgetLimit = parseFloat(budgetMatch[1].replace(/,/g, ''));
  
  assert.ok(
    decision.limits.monthly_budget_usd,
    'Missing monthly_budget_usd in limits'
  );
  assert.strictEqual(
    decision.limits.monthly_budget_usd.limit,
    budgetLimit,
    `Monthly budget limit should be ${budgetLimit}`
  );
});

test('p99 latency value is computed correctly for chosen option', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  // Read latencies from traffic-analysis.md
  const traffic = fs.readFileSync(path.join(FIXTURE, 'traffic-analysis.md'), 'utf8');
  const latencies = {};
  
  const latencyRegex = /\|\s*([A-Za-z\s]+Service?)\s*\|\s*([\d.]+)\s*\|/g;
  let match;
  while ((match = latencyRegex.exec(traffic)) !== null) {
    const service = match[1].trim().toLowerCase().replace(/\s+service$/, '');
    latencies[service] = parseFloat(match[2]);
  }
  
  // Get cached pricing latency from cost-analysis.md
  const costAnalysis = fs.readFileSync(path.join(FIXTURE, 'cost-analysis.md'), 'utf8');
  const cacheMatch = costAnalysis.match(/Reduces pricing service p99 latency from [\d.]+ ms to ([\d.]+) ms/i);
  const cachedPricingLatency = cacheMatch ? parseFloat(cacheMatch[1]) : 40;
  
  // Compute expected latency based on chosen option
  let expectedLatency;
  const gateway = latencies.gateway || 40;
  const auth = latencies.auth || 60;
  const pricing = latencies.pricing || 190;
  const inventory = latencies.inventory || 150;
  const payment = latencies.payment || 280;
  
  switch (decision.chosen) {
    case 'base':
      expectedLatency = gateway + auth + pricing + inventory + payment;
      break;
    case 'parallel':
      expectedLatency = gateway + auth + Math.max(pricing, inventory) + payment;
      break;
    case 'cache':
      expectedLatency = gateway + auth + cachedPricingLatency + inventory + payment;
      break;
    case 'cache_parallel':
      expectedLatency = gateway + auth + Math.max(cachedPricingLatency, inventory) + payment;
      break;
    default:
      throw new Error(`Unknown option: ${decision.chosen}`);
  }
  
  assert.ok(
    near(decision.limits.p99_latency_ms.value, expectedLatency, 0.1),
    `p99 latency value ${decision.limits.p99_latency_ms.value} should be near computed ${expectedLatency} for option "${decision.chosen}"`
  );
});

test('monthly budget value is computed correctly', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  // Current baseline cost from cost-analysis.md
  const costAnalysis = fs.readFileSync(path.join(FIXTURE, 'cost-analysis.md'), 'utf8');
  const baselineMatch = costAnalysis.match(/Total current cost: \$([\d.]+)/);
  const baselineCost = baselineMatch ? parseFloat(baselineMatch[1]) : 900;
  
  // Expected total cost = baseline + chosen option monthly cost
  const expectedTotal = baselineCost + decision.monthly_cost_usd;
  
  assert.ok(
    near(decision.limits.monthly_budget_usd.value, expectedTotal, 0.1),
    `Monthly budget value ${decision.limits.monthly_budget_usd.value} should be near computed total ${expectedTotal}`
  );
});

test('p99 latency limit is obeyed', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  const requirements = fs.readFileSync(path.join(FIXTURE, 'requirements.md'), 'utf8');
  const latencyMatch = requirements.match(/End-to-end p99 latency for checkout requests:.*?≤\s*([\d.]+)\s*ms/i);
  const latencyLimit = parseFloat(latencyMatch[1]);
  
  assert.ok(
    meets(decision.limits, 'p99_latency_ms', latencyLimit, 'max'),
    `p99 latency value ${decision.limits.p99_latency_ms.value} should be ≤ ${latencyLimit}`
  );
});

test('monthly budget limit is obeyed', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const decision = readDecision(decisionFile);
  
  const requirements = fs.readFileSync(path.join(FIXTURE, 'requirements.md'), 'utf8');
  const budgetMatch = requirements.match(/Monthly infrastructure budget:.*?\$([\d,]+)\s*USD/i);
  const budgetLimit = parseFloat(budgetMatch[1].replace(/,/g, ''));
  
  assert.ok(
    meets(decision.limits, 'monthly_budget_usd', budgetLimit, 'max'),
    `Monthly budget value ${decision.limits.monthly_budget_usd.value} should be ≤ ${budgetLimit}`
  );
});

test('base option would exceed p99 latency limit', () => {
  // Verify the trap: base option has 0 cost but breaks latency limit
  
  // Read latencies
  const traffic = fs.readFileSync(path.join(FIXTURE, 'traffic-analysis.md'), 'utf8');
  const latencies = {};
  const latencyRegex = /\|\s*([A-Za-z\s]+Service?)\s*\|\s*([\d.]+)\s*\|/g;
  let match;
  while ((match = latencyRegex.exec(traffic)) !== null) {
    const service = match[1].trim().toLowerCase().replace(/\s+service$/, '');
    latencies[service] = parseFloat(match[2]);
  }
  
  const gateway = latencies.gateway || 40;
  const auth = latencies.auth || 60;
  const pricing = latencies.pricing || 190;
  const inventory = latencies.inventory || 150;
  const payment = latencies.payment || 280;
  
  const baseLatency = gateway + auth + pricing + inventory + payment;
  
  // Get limit from requirements
  const requirements = fs.readFileSync(path.join(FIXTURE, 'requirements.md'), 'utf8');
  const latencyMatch = requirements.match(/End-to-end p99 latency for checkout requests:.*?≤\s*([\d.]+)\s*ms/i);
  const latencyLimit = parseFloat(latencyMatch[1]);
  
  assert.ok(
    baseLatency > latencyLimit,
    `Base option latency ${baseLatency} should exceed limit ${latencyLimit} (this is the trap)`
  );
});

test('cache option would exceed budget if chosen', () => {
  // Verify cache option breaks budget limit
  
  // Read cost for cache option
  const costCsv = fs.readFileSync(path.join(FIXTURE, 'cost-options.csv'), 'utf8');
  const lines = costCsv.trim().split('\n');
  const header = lines[0].split(',');
  const optionIndex = header.indexOf('option_id');
  const costIndex = header.indexOf('monthly_cost_usd');
  
  let cacheCost = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols[optionIndex] === 'cache') {
      cacheCost = parseFloat(cols[costIndex]);
      break;
    }
  }
  
  // Current baseline cost
  const costAnalysis = fs.readFileSync(path.join(FIXTURE, 'cost-analysis.md'), 'utf8');
  const baselineMatch = costAnalysis.match(/Total current cost: \$([\d.]+)/);
  const baselineCost = baselineMatch ? parseFloat(baselineMatch[1]) : 900;
  
  const totalWithCache = baselineCost + cacheCost;
  
  // Get budget limit
  const requirements = fs.readFileSync(path.join(FIXTURE, 'requirements.md'), 'utf8');
  const budgetMatch = requirements.match(/Monthly infrastructure budget:.*?\$([\d,]+)\s*USD/i);
  const budgetLimit = parseFloat(budgetMatch[1].replace(/,/g, ''));
  
  assert.ok(
    totalWithCache > budgetLimit,
    `Cache option total cost ${totalWithCache} should exceed budget limit ${budgetLimit}`
  );
});

test('decision block is the only one with info string "decision"', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  const content = fs.readFileSync(decisionFile, 'utf8');
  
  const decisionBlocks = content.match(/^```decision[\s\S]*?```/gm);
  assert.strictEqual(
    decisionBlocks ? decisionBlocks.length : 0,
    1,
    'Should have exactly one fenced block with info string "decision"'
  );
});

test('deliverable file exists and is readable', () => {
  const decisionFile = path.join(SOLUTION, 'docs', 'latency.md');
  assert.ok(fs.existsSync(decisionFile), 'Deliverable file should exist');
  
  const stats = fs.statSync(decisionFile);
  assert.ok(stats.isFile(), 'Should be a regular file');
  assert.ok(stats.size > 0, 'File should not be empty');
});