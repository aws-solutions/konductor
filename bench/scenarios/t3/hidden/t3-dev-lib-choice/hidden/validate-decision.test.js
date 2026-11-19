const { readDecision, near, meets } = require('./decision-lib.js');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const R = path.join(__dirname, '..');
const FIXTURE = path.join(R, 'fixture');
const SOLUTION = path.join(R, 'solution');

// Read fixture data
const perfCsv = fs.readFileSync(path.join(FIXTURE, 'performance-benchmark.csv'), 'utf8');
const costData = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'cost-analysis.json'), 'utf8'));
const requirements = fs.readFileSync(path.join(FIXTURE, 'requirements.md'), 'utf8');

// Parse performance data
const formats = {};
const lines = perfCsv.trim().split('\n');
const headers = lines[0].split(',');
for (let i = 1; i < lines.length; i++) {
  const cols = lines[i].split(',');
  const format = {};
  for (let j = 0; j < headers.length; j++) {
    format[headers[j]] = cols[j];
  }
  formats[format.format] = {
    encodeTime: parseFloat(format.encode_time_ms),
    decodeTime: parseFloat(format.decode_time_ms),
    totalTime: parseFloat(format.total_time_ms),
    sizeRatio: parseFloat(format.size_relative_to_json),
    schemaRequired: format.schema_required === 'yes'
  };
}

// Extract key numbers from requirements
const eventsPerSecond = 50000;
const jsonEventSize = 1200; // bytes
const availableCores = 6;
const networkBudget = 40 * 1024 * 1024; // 40 MB/s in bytes
const monthlyBudget = costData.budget_constraints.monthly_infrastructure_budget;
const coreCostPerMonth = costData.resource_costs.compute.vcpu_per_month;

// Acceptable options (computed from our analysis)
const acceptableOptions = ['protobuf', 'avro'];
const temptingOption = 'json';

test('decision file exists and contains fenced block', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  fs.accessSync(decisionPath);
  
  const content = fs.readFileSync(decisionPath, 'utf8');
  const hasBlock = /^```decision[ \t]*\r?\n/.test(content);
  if (!hasBlock) {
    throw new Error('No fenced decision block found');
  }
});

test('decision block parses as valid JSON', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  // Check required structure
  if (typeof decision !== 'object') throw new Error('Decision must be an object');
  if (typeof decision.chosen !== 'string') throw new Error('Missing or invalid "chosen" field');
  if (!Array.isArray(decision.options)) throw new Error('Missing or invalid "options" array');
  if (typeof decision.limits !== 'object') throw new Error('Missing or invalid "limits" object');
  if (typeof decision.monthly_cost_usd !== 'number') throw new Error('Missing or invalid "monthly_cost_usd" number');
});

test('chosen option is valid and considered', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  if (!formats[decision.chosen]) {
    throw new Error(`Chosen option "${decision.chosen}" not found in performance data`);
  }
  
  if (!decision.options.includes(decision.chosen)) {
    throw new Error('Chosen option must be in the considered options array');
  }
});

test('chosen option is not the tempting option', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  if (decision.chosen === temptingOption) {
    throw new Error('JSON is the tempting option that violates limits');
  }
});

test('chosen option is acceptable', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  if (!acceptableOptions.includes(decision.chosen)) {
    throw new Error(`Option "${decision.chosen}" is not acceptable. Acceptable options are: ${acceptableOptions.join(', ')}`);
  }
});

test('limits object contains core limit', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  if (!decision.limits.cores) {
    throw new Error('Missing "cores" limit in limits object');
  }
  
  const limit = decision.limits.cores;
  if (typeof limit.limit !== 'number' || limit.limit !== availableCores) {
    throw new Error(`Core limit should be ${availableCores}, got ${limit.limit}`);
  }
});

test('limits object contains bandwidth limit', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  if (!decision.limits.bandwidth) {
    throw new Error('Missing "bandwidth" limit in limits object');
  }
  
  const limit = decision.limits.bandwidth;
  const expectedLimit = networkBudget / (1024 * 1024); // Convert to MB/s
  if (typeof limit.limit !== 'number' || limit.limit !== expectedLimit) {
    throw new Error(`Bandwidth limit should be ${expectedLimit} MB/s, got ${limit.limit}`);
  }
});

test('limits object contains budget limit', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  if (!decision.limits.budget) {
    throw new Error('Missing "budget" limit in limits object');
  }
  
  const limit = decision.limits.budget;
  if (typeof limit.limit !== 'number' || limit.limit !== monthlyBudget) {
    throw new Error(`Budget limit should be ${monthlyBudget}, got ${limit.limit}`);
  }
});

test('core usage calculation is within 10% of expected', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  const format = formats[decision.chosen];
  const expectedCores = (eventsPerSecond * format.totalTime) / 1000;
  
  const reportedValue = decision.limits.cores.value;
  if (!near(reportedValue, expectedCores, 0.1)) {
    throw new Error(`Core usage for ${decision.chosen} should be ~${expectedCores.toFixed(1)}, got ${reportedValue}`);
  }
});

test('bandwidth calculation is within 10% of expected', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  const format = formats[decision.chosen];
  const expectedBandwidth = (eventsPerSecond * jsonEventSize * format.sizeRatio) / (1024 * 1024); // MB/s
  
  const reportedValue = decision.limits.bandwidth.value;
  if (!near(reportedValue, expectedBandwidth, 0.1)) {
    throw new Error(`Bandwidth for ${decision.chosen} should be ~${expectedBandwidth.toFixed(1)} MB/s, got ${reportedValue}`);
  }
});

test('core limit is obeyed', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  if (!meets(decision.limits, 'cores', availableCores, 'max')) {
    throw new Error(`Core limit violated: ${decision.limits.cores.value} > ${availableCores}`);
  }
});

test('bandwidth limit is obeyed', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  const bandwidthLimitMB = networkBudget / (1024 * 1024);
  if (!meets(decision.limits, 'bandwidth', bandwidthLimitMB, 'max')) {
    throw new Error(`Bandwidth limit violated: ${decision.limits.bandwidth.value} > ${bandwidthLimitMB}`);
  }
});

test('monthly cost calculation is within 10% of expected', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  const format = formats[decision.chosen];
  const coresNeeded = (eventsPerSecond * format.totalTime) / 1000;
  const extraCores = Math.max(0, coresNeeded - availableCores);
  const expectedCost = extraCores * coreCostPerMonth;
  
  if (!near(decision.monthly_cost_usd, expectedCost, 0.1)) {
    throw new Error(`Monthly cost for ${decision.chosen} should be ~$${expectedCost.toFixed(2)}, got $${decision.monthly_cost_usd}`);
  }
});

test('budget limit is obeyed', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  if (!meets(decision.limits, 'budget', monthlyBudget, 'max')) {
    throw new Error(`Budget limit violated: ${decision.monthly_cost_usd} > ${monthlyBudget}`);
  }
});

test('options array includes all relevant formats', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  const expectedOptions = ['json', 'msgpack', 'protobuf', 'cbor', 'avro'];
  for (const option of expectedOptions) {
    if (!decision.options.includes(option)) {
      throw new Error(`Options array missing ${option}`);
    }
  }
});

test('tempting option (JSON) violates core limit in limits object', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  // Check that JSON would violate core limit
  const jsonFormat = formats['json'];
  const jsonCores = (eventsPerSecond * jsonFormat.totalTime) / 1000;
  
  // The decision should show JSON violates limits if it's being honest
  // But we just need to ensure the chosen option isn't JSON
  // This test is more for documentation
  
  if (decision.chosen === 'json') {
    throw new Error('JSON violates core limit and should not be chosen');
  }
});

test('chosen option meets all three hard limits', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const decision = readDecision(decisionPath);
  
  const allPass = 
    meets(decision.limits, 'cores', availableCores, 'max') &&
    meets(decision.limits, 'bandwidth', networkBudget / (1024 * 1024), 'max') &&
    decision.monthly_cost_usd <= monthlyBudget;
    
  if (!allPass) {
    throw new Error('Chosen option fails one or more hard limits');
  }
});

test('decision record contains proper justification', () => {
  const decisionPath = path.join(SOLUTION, 'docs', 'decision-record.md');
  const content = fs.readFileSync(decisionPath, 'utf8');
  
  // Check for key elements in the justification
  const hasCalculations = /calc|compute|calculate|50,?000|cores.*[0-9]/i.test(content);
  const hasLimitsCheck = /limit|constraint|budget|bandwidth|cores/i.test(content);
  const hasComparison = /compare|alternative|trade.?off|vs\.?/i.test(content);
  
  if (!hasCalculations || !hasLimitsCheck || !hasComparison) {
    throw new Error('Decision record should include calculations, limits check, and comparison of alternatives');
  }
});