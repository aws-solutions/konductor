const { readDecision, near, meets } = require('./decision-lib.js');
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixture');
const SOLUTION_ROOT = path.join(__dirname, '..', 'solution');

// Helper to read CSV and parse pricing data
function readPricingData() {
  const csv = fs.readFileSync(path.join(FIXTURE_ROOT, 'pricing-data.csv'), 'utf8');
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const item = {};
    for (let j = 0; j < headers.length; j++) {
      item[headers[j]] = values[j];
    }
    data.push(item);
  }
  
  return data;
}

// Helper to extract numbers from requirements
function parseRequirements() {
  const requirements = fs.readFileSync(path.join(FIXTURE_ROOT, 'requirements.md'), 'utf8');
  const traffic = fs.readFileSync(path.join(FIXTURE_ROOT, 'traffic-analysis.md'), 'utf8');
  
  // Extract peak RPS from requirements
  const peakMatch = requirements.match(/Peak request rate[^\d]*(\d[\d,]*)\s*requests per second/);
  const peakRps = peakMatch ? parseInt(peakMatch[1].replace(/,/g, '')) : null;
  
  // Extract max utilization from requirements
  const utilMatch = requirements.match(/Maximum instance utilization[^\d]*(\d+)%/);
  const maxUtilization = utilMatch ? parseInt(utilMatch[1]) / 100 : null;
  
  // Extract instance capacity from traffic analysis
  const capacityMatch = traffic.match(/100% CPU utilization[^\d]*(\d[\d,]*)\s*RPS sustained/);
  const instanceCapacity = capacityMatch ? parseInt(capacityMatch[1].replace(/,/g, '')) : null;
  
  return { peakRps, maxUtilization, instanceCapacity };
}

// Helper to extract quota from pricing overview
function parseQuota() {
  const pricing = fs.readFileSync(path.join(FIXTURE_ROOT, 'pricing-overview.md'), 'utf8');
  const quotaMatch = pricing.match(/Running instances[^\d]*(\d+)/);
  return quotaMatch ? parseInt(quotaMatch[1]) : null;
}

// Helper to extract budget from requirements
function parseBudget() {
  const requirements = fs.readFileSync(path.join(FIXTURE_ROOT, 'requirements.md'), 'utf8');
  const budgetMatch = requirements.match(/Monthly infrastructure budget[^\d]*\$(\d[\d,]*)/);
  return budgetMatch ? parseFloat(budgetMatch[1].replace(/,/g, '')) : null;
}

test('decision block exists and is valid JSON', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  assert.doesNotThrow(() => {
    const decision = readDecision(decisionPath);
    assert(decision, 'Decision block should exist');
    assert(typeof decision === 'object', 'Decision should be an object');
  }, 'Should read decision block without error');
});

test('decision has required keys', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  
  assert(decision.chosen, 'Missing "chosen" key');
  assert(Array.isArray(decision.options), '"options" should be an array');
  assert(decision.limits && typeof decision.limits === 'object', '"limits" should be an object');
  assert(typeof decision.monthly_cost_usd === 'number', '"monthly_cost_usd" should be a number');
});

test('chosen option is one of the considered options', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  
  assert(decision.options.includes(decision.chosen), 
    `Chosen option "${decision.chosen}" should be in options array: ${JSON.stringify(decision.options)}`);
});

test('chosen option is not the tempting option', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  
  // The tempting option is using current instance type which violates quota
  assert(decision.chosen !== 'current-instance-quota-violation', 
    'Should not choose the tempting option that violates quota');
});

test('monthly cost is computed correctly for chosen option', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  const pricingData = readPricingData();
  
  // Get pricing for large instance in us-east-1
  const largeInstance = pricingData.find(item => 
    item.instance_type === 'large' && item.region === 'us-east-1'
  );
  assert(largeInstance, 'Should find large instance pricing');
  
  const hourlyCost = parseFloat(largeInstance.cost_per_hour);
  const hoursPerMonth = 24 * 30; // 720 hours
  
  // For option 2 (large instances): 12 instances
  const expectedMonthlyCost = 12 * hourlyCost * hoursPerMonth;
  
  assert(near(decision.monthly_cost_usd, expectedMonthlyCost, 0.1),
    `Monthly cost ${decision.monthly_cost_usd} should be near ${expectedMonthlyCost} for 12 large instances`);
});

test('instance quota limit is correctly reported and obeyed', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  const quota = parseQuota();
  
  assert(quota, 'Should parse quota from pricing overview');
  assert(decision.limits.instance_quota, 'Should have instance_quota in limits');
  assert.strictEqual(decision.limits.instance_quota.limit, quota, 'Quota limit should match parsed value');
  
  // For large instance option: 12 instances, quota is 14
  assert(decision.limits.instance_quota.value <= quota, 
    `Instance count ${decision.limits.instance_quota.value} should be ≤ quota ${quota}`);
});

test('peak RPS limit is correctly reported', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  const { peakRps } = parseRequirements();
  
  assert(peakRps, 'Should parse peak RPS from requirements');
  assert(decision.limits.peak_rps, 'Should have peak_rps in limits');
  assert.strictEqual(decision.limits.peak_rps.limit, peakRps, 'Peak RPS limit should match parsed value');
  
  // Value should be the actual peak RPS (12,000)
  assert.strictEqual(decision.limits.peak_rps.value, peakRps, 'Peak RPS value should equal limit');
});

test('CPU utilization limit is correctly reported', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  const { maxUtilization } = parseRequirements();
  
  assert(maxUtilization, 'Should parse max utilization from requirements');
  assert(decision.limits.max_cpu_utilization, 'Should have max_cpu_utilization in limits');
  
  // Max utilization is 70% in requirements
  assert.strictEqual(decision.limits.max_cpu_utilization.limit, 70, 'CPU utilization limit should be 70%');
  
  // For large instances: calculate per-instance CPU utilization at peak
  const { peakRps } = parseRequirements();
  const largeInstanceCapacity = 1800; // From traffic analysis
  const totalInstances = decision.limits.instance_quota.value; // Should be 12
  const rpsPerInstance = peakRps / totalInstances;
  const cpuUtilization = (rpsPerInstance / largeInstanceCapacity) * 100;
  
  assert(near(decision.limits.max_cpu_utilization.value, cpuUtilization, 0.1),
    `Reported CPU utilization ${decision.limits.max_cpu_utilization.value}% should be near calculated ${cpuUtilization}%`);
  
  // Also verify it's under 70% limit
  assert(decision.limits.max_cpu_utilization.value <= 70,
    `CPU utilization ${decision.limits.max_cpu_utilization.value}% should be ≤ 70% limit`);
});

test('monthly budget limit is correctly reported', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  const budget = parseBudget();
  
  assert(budget, 'Should parse budget from requirements');
  assert(decision.limits.monthly_budget, 'Should have monthly_budget in limits');
  assert.strictEqual(decision.limits.monthly_budget.limit, budget, 'Budget limit should match parsed value');
  
  // Monthly cost should be ≤ budget
  assert(decision.monthly_cost_usd <= budget,
    `Monthly cost ${decision.monthly_cost_usd} should be ≤ budget ${budget}`);
});

test('all hard limits from requirements are included', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  
  // Check for all expected limits
  const expectedLimits = ['instance_quota', 'max_cpu_utilization', 'peak_rps', 'monthly_budget'];
  
  for (const limitName of expectedLimits) {
    assert(decision.limits[limitName], `Missing limit: ${limitName}`);
    assert(typeof decision.limits[limitName].limit === 'number', `${limitName}.limit should be a number`);
    assert(typeof decision.limits[limitName].value === 'number', `${limitName}.value should be a number`);
  }
});

test('limits object meets function works correctly', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  
  const quota = parseQuota();
  const budget = parseBudget();
  
  // Test instance quota (value ≤ limit)
  assert(meets(decision.limits, 'instance_quota', quota, 'max'),
    `Instance count ${decision.limits.instance_quota.value} should be ≤ quota ${quota}`);
  
  // Test budget (cost ≤ limit)  
  assert(meets(decision.limits, 'monthly_budget', budget, 'max'),
    `Monthly cost ${decision.limits.monthly_budget.value} should be ≤ budget ${budget}`);
});

test('capacity calculations are consistent with requirements', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  const { peakRps, maxUtilization, instanceCapacity } = parseRequirements();
  
  // Only test if chosen option is larger-instance-type
  if (decision.chosen === 'larger-instance-type') {
    const largeInstanceCapacity = 1800; // From traffic analysis
    const effectiveCapacity = largeInstanceCapacity * maxUtilization;
    const instancesNeeded = Math.ceil(peakRps / effectiveCapacity);
    const instancesPerAz = Math.ceil(instancesNeeded / 2);
    const instancesWithRedundancy = instancesPerAz + 1; // N+1 per AZ
    const totalInstances = instancesWithRedundancy * 2;
    
    // Should be 12 instances for large instance option
    assert.strictEqual(totalInstances, 12, 
      `Should need 12 large instances, calculated ${totalInstances}`);
  }
});

test('redundancy requirement is satisfied', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  const { peakRps, maxUtilization } = parseRequirements();
  
  if (decision.chosen === 'larger-instance-type') {
    const largeInstanceCapacity = 1800;
    const effectiveCapacity = largeInstanceCapacity * maxUtilization;
    const instancesNeeded = Math.ceil(peakRps / effectiveCapacity);
    const instancesPerAz = Math.ceil(instancesNeeded / 2);
    
    // With N+1 redundancy, should have at least instancesPerAz + 1 per AZ
    // Total instances should be at least (instancesPerAz + 1) * 2
    const minInstancesWithRedundancy = (instancesPerAz + 1) * 2;
    
    assert(decision.limits.instance_quota.value >= minInstancesWithRedundancy,
      `Instance count ${decision.limits.instance_quota.value} should support N+1 redundancy (minimum ${minInstancesWithRedundancy})`);
  }
});

test('AZ failure tolerance is considered', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  const { peakRps, maxUtilization } = parseRequirements();
  
  if (decision.chosen === 'larger-instance-type') {
    const largeInstanceCapacity = 1800;
    const effectiveCapacity = largeInstanceCapacity * maxUtilization;
    const instancesPerAz = Math.ceil(decision.limits.instance_quota.value / 2);
    
    // Capacity in one AZ should handle traffic if other AZ fails
    // With graceful degradation allowed, but let's check basic capacity
    const capacityInOneAz = instancesPerAz * effectiveCapacity;
    
    // During AZ failure, system might operate at reduced capacity
    // But we should have significant capacity in remaining AZ
    assert(capacityInOneAz > 0, 'Should have capacity in each AZ');
  }
});

test('deliverable file exists and is readable', () => {
  const capacityPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  assert.doesNotThrow(() => {
    const content = fs.readFileSync(capacityPath, 'utf8');
    assert(content.length > 0, 'Capacity document should not be empty');
    assert(content.includes('CloudStream'), 'Should mention CloudStream');
    assert(content.includes('capacity'), 'Should discuss capacity planning');
  }, 'Should read capacity document without error');
});

test('deliverable contains analysis sections', () => {
  const capacityPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const content = fs.readFileSync(capacityPath, 'utf8');
  
  // Check for expected sections
  assert(content.includes('Executive Summary'), 'Should have executive summary');
  assert(content.includes('Requirements and Constraints'), 'Should have requirements section');
  assert(content.includes('Infrastructure Options'), 'Should have options analysis');
  assert(content.includes('Cost Comparison'), 'Should have cost comparison');
  assert(content.includes('Recommended Approach'), 'Should have recommendation');
  assert(content.includes('Implementation Considerations'), 'Should have implementation details');
});

test('decision block is properly formatted', () => {
  const capacityPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const content = fs.readFileSync(capacityPath, 'utf8');
  
  // Check for fenced code block with info string "decision"
  const decisionBlockMatch = content.match(/^```decision[ \t]*\r?\n([\s\S]*?)\r?\n```/m);
  assert(decisionBlockMatch, 'Should have fenced code block with info string "decision"');
  
  const jsonStr = decisionBlockMatch[1];
  assert.doesNotThrow(() => {
    JSON.parse(jsonStr);
  }, 'Decision block should contain valid JSON');
});

test('tempting option would violate quota', () => {
  const { peakRps, maxUtilization, instanceCapacity } = parseRequirements();
  const quota = parseQuota();
  
  // Calculate for tempting option (current medium instances)
  const effectiveCapacity = instanceCapacity * maxUtilization;
  const instancesNeeded = Math.ceil(peakRps / effectiveCapacity);
  const instancesPerAz = Math.ceil(instancesNeeded / 2);
  const instancesWithRedundancy = instancesPerAz + 1; // N+1 per AZ
  const totalInstances = instancesWithRedundancy * 2;
  
  // This should exceed quota
  assert(totalInstances > quota, 
    `Tempting option would need ${totalInstances} instances, exceeding quota of ${quota}`);
});

test('chosen option respects all limits', () => {
  const decisionPath = path.join(SOLUTION_ROOT, 'docs', 'capacity.md');
  const decision = readDecision(decisionPath);
  
  // Check each limit
  for (const [limitName, limitData] of Object.entries(decision.limits)) {
    assert(typeof limitData.value === 'number', `${limitName}.value should be a number`);
    assert(typeof limitData.limit === 'number', `${limitName}.limit should be a number`);
    
    // Determine direction based on limit name
    const isMinLimit = limitName.includes('min') || limitName.includes('at_least');
    const direction = isMinLimit ? 'min' : 'max';
    
    if (direction === 'max') {
      assert(limitData.value <= limitData.limit,
        `${limitName}: value ${limitData.value} should be ≤ limit ${limitData.limit}`);
    } else {
      assert(limitData.value >= limitData.limit,
        `${limitName}: value ${limitData.value} should be ≥ limit ${limitData.limit}`);
    }
  }
});