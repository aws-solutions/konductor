const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');
const { blockOf, numbersIn } = require('./doc-key.js');

describe('precision checks', () => {
  const block = blockOf('docs/framing.md');
  
  it('numbers are consistent with analysis', () => {
    // All numbers in the JSON block should be from our analysis
    const jsonText = JSON.stringify(block);
    const blockNumbers = numbersIn(jsonText);
    
    // Expected numbers from correct analysis (with 2% tolerance)
    // These are the core numbers that should appear
    const expectedNumbers = [
      '15',      // customers (unique)
      '6785',    // monthly revenue for export
      '71561',   // revenue impact for sales
      '18500',   // monthly cost savings
      '222000',  // annual cost savings
      '8',       // duplicate requests mentioned
      '28',      // apparent demand (might be mentioned)
      '116561',  // apparent revenue (might be mentioned)
      '45000',   // double counted amount (might be mentioned)
      '3',       // number of options
    ];
    
    // Check each number in block appears in expected (with some flexibility)
    const problematicNumbers = [];
    for (const n of blockNumbers) {
      // Remove trailing zeros after decimal
      const clean = n.replace(/\.0+$/, '');
      // Check if matches any expected number or close variant
      const matches = expectedNumbers.some(expected => {
        // Exact match
        if (clean === expected) return true;
        // Match without leading zeros
        if (clean.replace(/^0+/, '') === expected.replace(/^0+/, '')) return true;
        // Match as thousands (e.g., "222" matches "222000")
        if (expected.endsWith('000') && clean === expected.slice(0, -3)) return true;
        // Match with thousands added (e.g., "222" matches "222000")
        if (clean.endsWith('000') && expected === clean.slice(0, -3)) return true;
        return false;
      });
      
      if (!matches) {
        problematicNumbers.push(n);
      }
    }
    
    // Allow up to 2 unexpected numbers (could be IDs, percentages, etc.)
    assert.ok(problematicNumbers.length <= 2, 
      `Unexpected numbers in analysis: ${problematicNumbers.join(', ')}`);
  });
  
  it('JSON structure is correct', () => {
    assert.ok(block.options, 'should have options array');
    assert.ok(Array.isArray(block.options), 'options should be an array');
    assert.equal(block.options.length, 3, 'should have exactly 3 options');
    
    assert.ok(block.recommendation, 'should have recommendation');
    assert.ok(typeof block.recommendation === 'string', 'recommendation should be string');
    assert.ok(block.recommendation.length > 5, 'recommendation should be substantial');
    
    assert.ok(block.reason, 'should have reason');
    assert.ok(typeof block.reason === 'string', 'reason should be string');
    assert.ok(block.reason.length > 50, 'reason should be at least 50 characters');
  });
  
  it('each option has appropriate fields', () => {
    for (const option of block.options) {
      assert.ok(option.name, 'option should have name');
      assert.ok(typeof option.name === 'string', 'name should be string');
      assert.ok(option.name.length > 5, 'name should be descriptive');
      
      assert.ok(option.notes, 'option should have notes');
      assert.ok(typeof option.notes === 'string', 'notes should be string');
      assert.ok(option.notes.length > 10, 'notes should provide insight');
      
      // Check option-specific fields
      if (option.name.includes('Export CSV')) {
        assert.ok('customers' in option, 'Export should have customers field');
        assert.ok('monthly_revenue' in option, 'Export should have monthly_revenue');
        assert.equal(typeof option.customers, 'number', 'customers should be number');
        assert.equal(typeof option.monthly_revenue, 'number', 'monthly_revenue should be number');
      }
      
      if (option.name.includes('Sales Notes')) {
        assert.ok('revenue_impact' in option, 'Sales should have revenue_impact field');
        assert.equal(typeof option.revenue_impact, 'number', 'revenue_impact should be number');
      }
      
      if (option.name.includes('Support Tickets')) {
        assert.ok('monthly_cost_savings' in option, 'Support should have monthly_cost_savings');
        assert.ok('annual_cost_savings' in option, 'Support should have annual_cost_savings');
        assert.equal(typeof option.monthly_cost_savings, 'number', 'monthly_cost_savings should be number');
        assert.equal(typeof option.annual_cost_savings, 'number', 'annual_cost_savings should be number');
      }
    }
  });
  
  it('recommendation is support tickets with clear rationale', () => {
    assert.ok(block.recommendation, 'should have recommendation');
    const recLower = block.recommendation.toLowerCase();
    assert.ok(recLower.includes('support') && recLower.includes('ticket'), 
      `recommendation should mention support tickets (got: ${block.recommendation})`);
    
    // Reason should mention key factors
    const reasonLower = block.reason.toLowerCase();
    const checks = [
      reasonLower.includes('financial') || reasonLower.includes('cost') || reasonLower.includes('savings') || reasonLower.includes('roi'),
      reasonLower.includes('strategic') || reasonLower.includes('goal') || reasonLower.includes('q3'),
      reasonLower.includes('support') || reasonLower.includes('ticket'),
    ];
    
    const passedChecks = checks.filter(Boolean).length;
    assert.ok(passedChecks >= 2, 
      `Reason should mention at least 2 of: financial case, strategic alignment, support focus. Reason: ${block.reason.substring(0, 100)}...`);
  });
});