const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readDecision, near, meets } = require('./decision-lib.js');

const R = path.join(__dirname, '..');
const SOLUTION_DIR = path.join(R, 'solution');
const FIXTURE_DIR = path.join(R, 'fixture');
const DECISION_FILE = path.join(SOLUTION_DIR, 'docs', 'retention.md');

// Helper to read fixture data
function readPricingData() {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'pricing-data.json'), 'utf8'));
  const prices = {};
  data.storage_tiers.forEach(tier => {
    prices[tier.name] = tier.price_per_gb_month;
  });
  return {
    prices,
    compression: data.compression
  };
}

function readRequirements() {
  const requirements = fs.readFileSync(path.join(FIXTURE_DIR, 'requirements.md'), 'utf8');
  const slos = fs.readFileSync(path.join(FIXTURE_DIR, 'performance-slos.md'), 'utf8');
  const budget = fs.readFileSync(path.join(FIXTURE_DIR, 'budget-constraints.md'), 'utf8');
  
  // Extract numbers from requirements (simplified parsing)
  let dailyIngestTB = 24;
  let retentionDays = 365;
  let recentQueryLimit = 60;
  let olderQueryLimit = 15 * 60;
  let monthlyBudget = 28000;
  
  // Parse from text (simplified for test)
  if (requirements.includes('24 TB')) dailyIngestTB = 24;
  if (requirements.includes('365 days')) retentionDays = 365;
  if (slos.includes('≤ 60 seconds')) recentQueryLimit = 60;
  if (slos.includes('≤ 15 minutes')) olderQueryLimit = 15 * 60;
  if (budget.includes('$28,000')) monthlyBudget = 28000;
  
  return {
    dailyIngestTB,
    retentionDays,
    recentQueryLimit,
    olderQueryLimit,
    monthlyBudget
  };
}

describe('Decision block tests', () => {
  it('should have a decision block in the file', () => {
    assert.doesNotThrow(() => {
      readDecision(DECISION_FILE);
    }, 'File should contain a fenced decision block');
  });

  it('decision block should contain required JSON structure', () => {
    const decision = readDecision(DECISION_FILE);
    
    assert(decision.chosen, 'Missing "chosen" field');
    assert(Array.isArray(decision.options), '"options" should be an array');
    assert(decision.limits && typeof decision.limits === 'object', 'Missing "limits" object');
    assert(typeof decision.monthly_cost_usd === 'number', 'Missing "monthly_cost_usd" number');
  });

  it('chosen option should be one of the considered options', () => {
    const decision = readDecision(DECISION_FILE);
    assert(decision.options.includes(decision.chosen), 
      `Chosen option "${decision.chosen}" should be in options array: ${JSON.stringify(decision.options)}`);
  });

  it('chosen option should not be the tempting all-hot option', () => {
    const decision = readDecision(DECISION_FILE);
    assert(decision.chosen !== 'all_hot', 
      'All-hot option exceeds budget and should not be chosen');
  });

  it('chosen option should not be all-cold (violates query limit)', () => {
    const decision = readDecision(DECISION_FILE);
    assert(decision.chosen !== 'all_cold', 
      'All-cold option violates query performance limit (900s > 60s for recent data) and should not be chosen');
  });

  it('should have limits for all hard constraints', () => {
    const decision = readDecision(DECISION_FILE);
    const limits = decision.limits;
    
    // Check for expected limit names
    const expectedLimits = ['monthly_budget', 'recent_query_p95', 'older_query_p95', 'retention_days'];
    
    for (const limitName of expectedLimits) {
      assert(limits[limitName], `Missing limit "${limitName}"`);
      assert(typeof limits[limitName].limit === 'number', `Limit "${limitName}" should have a number limit`);
      assert(typeof limits[limitName].value === 'number', `Limit "${limitName}" should have a number value`);
    }
  });
});

describe('Calculation validation tests', () => {
  const req = readRequirements();
  const pricing = readPricingData();
  const compressionRatio = 8; // From pricing data
  
  // Calculate daily ingest in GB
  const dailyIngestGB = req.dailyIngestTB * 1024;
  const dailyIngestCompressedGB = dailyIngestGB / compressionRatio;
  const daysPerMonth = 30.44; // Average days per month
  
  // Valid option configurations
  const validOptions = {
    mixed_hot_warm_cold: { hotDays: 30, warmDays: 90, coldDays: 245 },
    hot_90_cold_rest: { hotDays: 90, warmDays: 0, coldDays: 275 },
  };
  
  it('monthly cost should be correctly calculated for chosen option', () => {
    const decision = readDecision(DECISION_FILE);
    const optionId = decision.chosen;
    
    if (validOptions[optionId]) {
      const config = validOptions[optionId];
      
      // Calculate expected cost
      const hotGBMonth = (config.hotDays * dailyIngestGB) / daysPerMonth;
      const warmGBMonth = (config.warmDays * dailyIngestCompressedGB) / daysPerMonth;
      const coldGBMonth = (config.coldDays * dailyIngestCompressedGB) / daysPerMonth;
      
      const expectedCost = 
        hotGBMonth * pricing.prices.hot +
        warmGBMonth * pricing.prices.warm +
        coldGBMonth * pricing.prices.cold;
      
      // Allow 10% tolerance for rounding differences
      assert(
        near(decision.monthly_cost_usd, expectedCost, 0.1),
        `Monthly cost $${decision.monthly_cost_usd} should be near calculated $${expectedCost.toFixed(2)}`
      );
    }
    // If option is not in our predefined list, we can't validate calculation
  });

  it('monthly cost should be within budget limit', () => {
    const decision = readDecision(DECISION_FILE);
    const limits = decision.limits;
    
    assert(meets(limits, 'monthly_budget', req.monthlyBudget, 'max'),
      `Monthly cost $${limits.monthly_budget.value} should be ≤ $${req.monthlyBudget}`);
    
    // Also check the reported monthly_cost_usd
    assert(decision.monthly_cost_usd <= req.monthlyBudget,
      `Reported monthly cost $${decision.monthly_cost_usd} should be ≤ $${req.monthlyBudget}`);
  });

  it('recent query performance should meet limit', () => {
    const decision = readDecision(DECISION_FILE);
    const limits = decision.limits;
    
    assert(meets(limits, 'recent_query_p95', req.recentQueryLimit, 'max'),
      `Recent query p95 ${limits.recent_query_p95.value}s should be ≤ ${req.recentQueryLimit}s`);
  });

  it('older query performance should meet limit', () => {
    const decision = readDecision(DECISION_FILE);
    const limits = decision.limits;
    
    assert(meets(limits, 'older_query_p95', req.olderQueryLimit, 'max'),
      `Older query p95 ${limits.older_query_p95.value}s should be ≤ ${req.olderQueryLimit}s`);
  });

  it('retention days should meet requirement', () => {
    const decision = readDecision(DECISION_FILE);
    const limits = decision.limits;
    
    assert(meets(limits, 'retention_days', req.retentionDays, 'min'),
      `Retention ${limits.retention_days.value} days should be ≥ ${req.retentionDays} days`);
  });

  it('limit values should be consistent with chosen option', () => {
    const decision = readDecision(DECISION_FILE);
    const optionId = decision.chosen;
    
    if (validOptions[optionId]) {
      const config = validOptions[optionId];
      
      // Check retention days
      const totalDays = config.hotDays + config.warmDays + config.coldDays;
      assert(decision.limits.retention_days.value >= 365,
        `Total retention should be at least 365 days for option ${optionId}`);
      
      // Check recent query performance (first 30 days should be in hot tier)
      if (config.hotDays >= 30) {
        assert(decision.limits.recent_query_p95.value <= 60,
          `Recent query should be ≤ 60s when first 30 days are hot`);
      }
    }
  });
});

describe('Option validation tests', () => {
  it('should consider multiple options', () => {
    const decision = readDecision(DECISION_FILE);
    assert(decision.options.length >= 2, 'Should consider at least 2 options');
  });

  it('options array should contain valid option IDs', () => {
    const decision = readDecision(DECISION_FILE);
    
    // Valid option IDs based on our scenario
    const validOptionIds = ['all_hot', 'all_cold', 'mixed_hot_warm_cold', 'hot_90_cold_rest'];
    
    for (const optionId of decision.options) {
      assert(validOptionIds.includes(optionId), 
        `Option ID "${optionId}" should be one of: ${validOptionIds.join(', ')}`);
    }
  });

  it('should not choose all-cold option (violates query limit)', () => {
    const decision = readDecision(DECISION_FILE);
    assert(decision.chosen !== 'all_cold', 
      'All-cold option violates recent query performance limit (900s > 60s)');
  });

  it('chosen option should be optimal or reasonable', () => {
    const decision = readDecision(DECISION_FILE);
    
    // mixed_hot_warm_cold is the optimal choice ($2,794/month)
    // hot_90_cold_rest is also viable but suboptimal ($7,377/month, 2.6x more expensive)
    const reasonableChoices = ['mixed_hot_warm_cold', 'hot_90_cold_rest'];
    
    assert(reasonableChoices.includes(decision.chosen),
      `Chosen option "${decision.chosen}" should be one of: ${reasonableChoices.join(', ')}`);
  });
});

describe('File structure tests', () => {
  it('deliverable file should exist', () => {
    assert(fs.existsSync(DECISION_FILE), `Deliverable file should exist: ${DECISION_FILE}`);
  });

  it('deliverable should contain analysis and rationale', () => {
    const content = fs.readFileSync(DECISION_FILE, 'utf8');
    assert(content.length > 500, 'Deliverable should contain substantial analysis');
    assert(content.includes('recommend') || content.includes('conclusion') || content.includes('decision'),
      'Deliverable should contain recommendation or conclusion');
  });

  it('should reference fixture data in analysis', () => {
    const content = fs.readFileSync(DECISION_FILE, 'utf8');
    // Check for references to key numbers from fixtures
    const keyRefs = ['24 TB', '365', '28,000', '60 seconds', '15 minutes'];
    let refCount = 0;
    
    for (const ref of keyRefs) {
      if (content.includes(ref)) refCount++;
    }
    
    assert(refCount >= 3, 'Analysis should reference key numbers from requirements');
  });
});