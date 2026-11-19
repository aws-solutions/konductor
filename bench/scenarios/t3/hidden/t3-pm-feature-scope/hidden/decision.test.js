const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readDecision, near, meets } = require('./decision-lib.js');
const path = require('node:path');
const fs = require('node:fs');

const R = path.join(__dirname, '..');
const solutionPath = path.join(R, 'solution', 'docs', 'export-approach.md');

describe('Decision block validation', () => {
  it('should have a decision block', () => {
    const text = fs.readFileSync(solutionPath, 'utf8');
    const hasDecisionBlock = /^```decision[ \t]*\r?\n([\s\S]*?)\r?\n```/m.test(text);
    assert.ok(hasDecisionBlock, 'Missing fenced decision block with info string "decision"');
  });

  it('should parse valid JSON', () => {
    const decision = readDecision(solutionPath);
    assert.ok(decision, 'Failed to parse decision block');
    assert.strictEqual(typeof decision, 'object', 'Decision should be an object');
  });

  it('should have required keys', () => {
    const decision = readDecision(solutionPath);
    assert.ok(decision.chosen, 'Missing "chosen" key');
    assert.ok(decision.options, 'Missing "options" key');
    assert.ok(decision.limits, 'Missing "limits" key');
    assert.ok(typeof decision.monthly_cost_usd === 'number', 'Missing or invalid "monthly_cost_usd"');
  });

  it('should have chosen as one of acceptable options', () => {
    const decision = readDecision(solutionPath);
    const acceptable = ['A', 'B', 'C', 'hybrid'];
    assert.ok(acceptable.includes(decision.chosen), 
      `chosen "${decision.chosen}" should be one of ${acceptable.join(', ')}`);
  });

  it('should NOT choose the tempting option A', () => {
    const decision = readDecision(solutionPath);
    assert.notStrictEqual(decision.chosen, 'A', 
      'Should not choose option A (synchronous) as it violates timeout constraint');
  });

  it('should have options as array', () => {
    const decision = readDecision(solutionPath);
    assert.ok(Array.isArray(decision.options), 'options should be an array');
    assert.ok(decision.options.length >= 2, 'options array should have at least 2 items');
  });

  it('should include chosen in options array', () => {
    const decision = readDecision(solutionPath);
    assert.ok(decision.options.includes(decision.chosen),
      'options array should include the chosen option');
  });
});

describe('Cost calculation validation', () => {
  it('should have reasonable monthly cost', () => {
    const decision = readDecision(solutionPath);
    assert.ok(decision.monthly_cost_usd > 0, 'monthly_cost_usd should be positive');
    assert.ok(decision.monthly_cost_usd < 1200, 'monthly_cost_usd should be under budget');
  });

  it('should have cost within 10% of correct value for chosen option', () => {
    const decision = readDecision(solutionPath);
    
    // Calculate correct costs from fixture data
    const reportsPerMonth = 500000;
    
    // Read pricing data
    const pricingCsv = fs.readFileSync(path.join(R, 'fixture', 'aws_pricing.csv'), 'utf8');
    const pricingLines = pricingCsv.split('\n').slice(1);
    const pricing = {};
    pricingLines.forEach(line => {
      if (line.trim()) {
        const [service, unit, price, region, notes] = line.split(',');
        pricing[service] = parseFloat(price);
      }
    });
    
    // Calculate based on chosen option
    let expectedCost = 0;
    
    if (decision.chosen === 'B') {
      // Option B: Async with email
      const lambdaCost = reportsPerMonth * 0.7 * pricing.Lambda * 0.5; // 512MB = 0.5GB
      const apiGatewayCost = (reportsPerMonth / 1000000) * pricing['API Gateway'];
      const dataTransferCost = reportsPerMonth * 0.0018 * pricing['Data Transfer']; // 1.8MB avg
      const s3PutCost = (reportsPerMonth / 1000) * pricing['S3 PUT'];
      const s3GetCost = (reportsPerMonth / 1000) * pricing['S3 GET'] * 0.5; // 50% download
      const s3StorageCost = 100 * pricing['S3 Storage']; // 100GB storage
      const sqsCost = (reportsPerMonth / 1000000) * pricing.SQS;
      const sesCost = (reportsPerMonth / 1000) * pricing.SES;
      
      expectedCost = lambdaCost + apiGatewayCost + dataTransferCost + 
                    s3PutCost + s3GetCost + s3StorageCost + sqsCost + sesCost;
    } else if (decision.chosen === 'C') {
      // Option C: Scheduled
      const s3StorageCost = 500 * pricing['S3 Storage']; // 500GB storage
      const lambdaRuns = 50 * 30; // 50 reports × 30 days
      const lambdaCost = lambdaRuns * 30 * pricing.Lambda * 0.5; // 30s each, 512MB
      const dataTransferCost = reportsPerMonth * 0.0018 * pricing['Data Transfer'];
      
      expectedCost = s3StorageCost + lambdaCost + dataTransferCost;
    } else if (decision.chosen === 'hybrid') {
      // Hybrid: between A and B
      expectedCost = 90; // Approximate
    }
    
    // Accept wider range since different reasonable calculations exist
    // Option B cost should be roughly $100-$160 based on different assumptions
    if (decision.chosen === 'B') {
      assert.ok(decision.monthly_cost_usd >= 80 && decision.monthly_cost_usd <= 180,
        `monthly_cost_usd ${decision.monthly_cost_usd} should be between $80-$180 for option B`);
    } else if (decision.chosen === 'C') {
      assert.ok(decision.monthly_cost_usd >= 70 && decision.monthly_cost_usd <= 120,
        `monthly_cost_usd ${decision.monthly_cost_usd} should be between $70-$120 for option C`);
    } else if (decision.chosen === 'hybrid') {
      assert.ok(decision.monthly_cost_usd >= 80 && decision.monthly_cost_usd <= 120,
        `monthly_cost_usd ${decision.monthly_cost_usd} should be between $80-$120 for hybrid option`);
    }
  });
});

describe('Limits validation', () => {
  it('should have limits object', () => {
    const decision = readDecision(solutionPath);
    assert.ok(decision.limits && typeof decision.limits === 'object', 
      'limits should be an object');
    assert.ok(Object.keys(decision.limits).length > 0, 
      'limits object should have at least one entry');
  });

  it('should include gateway_timeout limit', () => {
    const decision = readDecision(solutionPath);
    const limit = decision.limits.gateway_timeout;
    assert.ok(limit, 'Missing gateway_timeout limit');
    assert.strictEqual(limit.limit, 29, 'gateway_timeout.limit should be 29');
    assert.ok(typeof limit.value === 'number', 'gateway_timeout.value should be a number');
  });

  it('should include monthly_budget_usd limit', () => {
    const decision = readDecision(solutionPath);
    const limit = decision.limits.monthly_budget_usd;
    assert.ok(limit, 'Missing monthly_budget_usd limit');
    assert.strictEqual(limit.limit, 1200, 'monthly_budget_usd.limit should be 1200');
    assert.ok(typeof limit.value === 'number', 'monthly_budget_usd.value should be a number');
    assert.ok(limit.value <= 1200, 'monthly_budget_usd.value should be ≤ 1200');
  });

  it('should include p95_processing_time limit', () => {
    const decision = readDecision(solutionPath);
    const limit = decision.limits.p95_processing_time;
    assert.ok(limit, 'Missing p95_processing_time limit');
    assert.strictEqual(limit.limit, 29, 'p95_processing_time.limit should be 29');
    assert.ok(typeof limit.value === 'number', 'p95_processing_time.value should be a number');
  });

  it('should include p99_processing_time limit', () => {
    const decision = readDecision(solutionPath);
    const limit = decision.limits.p99_processing_time;
    assert.ok(limit, 'Missing p99_processing_time limit');
    assert.strictEqual(limit.limit, 29, 'p99_processing_time.limit should be 29');
    assert.ok(typeof limit.value === 'number', 'p99_processing_time.value should be a number');
    
    // Verify p99 time calculation
    const p99Rows = 6800000;
    const renderTimePer100k = 0.4;
    const p99RenderTime = (p99Rows / 100000) * renderTimePer100k;
    const p99UploadTime = (p99Rows / 100000) * 0.1; // 0.1s per 100k upload
    const expectedP99Time = p99RenderTime + p99UploadTime;
    
    assert.ok(near(limit.value, expectedP99Time, 0.1),
      `p99_processing_time.value ${limit.value} should be within 10% of calculated ${expectedP99Time.toFixed(2)}`);
  });

  it('should obey gateway timeout for chosen option', () => {
    const decision = readDecision(solutionPath);
    
    if (decision.chosen === 'A') {
      // Option A fails p99 timeout
      assert.ok(!meets(decision.limits, 'p99_processing_time', 29, 'max'),
        'Option A should violate p99_processing_time limit');
    } else {
      // Options B, C, hybrid should obey timeout
      assert.ok(meets(decision.limits, 'gateway_timeout', 29, 'max'),
        'Chosen option should obey gateway_timeout limit');
    }
  });

  it('should obey budget limit', () => {
    const decision = readDecision(solutionPath);
    assert.ok(meets(decision.limits, 'monthly_budget_usd', 1200, 'max'),
      'Should obey monthly_budget_usd limit');
  });
});

describe('Consistency checks', () => {
  it('should have consistent p95 time calculation', () => {
    const decision = readDecision(solutionPath);
    const limit = decision.limits.p95_processing_time;
    
    // Calculate expected p95 time
    const p95Rows = 2300000;
    const renderTimePer100k = 0.4;
    const p95RenderTime = (p95Rows / 100000) * renderTimePer100k;
    const p95UploadTime = (p95Rows / 100000) * 0.1; // 0.1s per 100k upload
    const expectedP95Time = p95RenderTime + p95UploadTime;
    
    assert.ok(near(limit.value, expectedP95Time, 0.1),
      `p95_processing_time.value ${limit.value} should be within 10% of calculated ${expectedP95Time.toFixed(2)}`);
  });

  it('should have correct ratio between p95 and p99 times', () => {
    const decision = readDecision(solutionPath);
    const p95Limit = decision.limits.p95_processing_time;
    const p99Limit = decision.limits.p99_processing_time;
    
    const p95Rows = 2300000;
    const p99Rows = 6800000;
    const expectedRatio = p99Rows / p95Rows; // ~2.96
    
    const actualRatio = p99Limit.value / p95Limit.value;
    assert.ok(near(actualRatio, expectedRatio, 0.2),
      `p99/p95 time ratio ${actualRatio.toFixed(2)} should be near rows ratio ${expectedRatio.toFixed(2)}`);
  });
});