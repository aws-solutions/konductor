const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');
const { blockOf } = require('./doc-key.js');

describe('insight validation', () => {
  const block = blockOf('docs/framing.md');
  
  it('recognizes duplicate request inflation', () => {
    const exportOption = block.options.find(o => o.name && o.name.includes('Export CSV'));
    assert.ok(exportOption, 'should have Export CSV option');
    
    // Should have customer count around 15 not raw count 28
    // Allow within 2% of 15 (14.7 to 15.3) - but customer count should be integer
    assert.ok(exportOption.customers >= 14 && exportOption.customers <= 16, 
      `should have ~15 customers, not raw count of 28 (got ${exportOption.customers})`);
    
    // Notes should mention duplicates or specific customer
    assert.ok(exportOption.notes, 'should have notes field');
    const hasInsight = /duplicate|multiple.*request|inflated.*demand|Acme Corp|large.*customer|one.*customer/i.test(exportOption.notes);
    assert.ok(hasInsight, 'notes should mention duplicates, inflation, or specific customer');
  });
  
  it('detects revenue double counting', () => {
    const salesOption = block.options.find(o => o.name && o.name.includes('Sales Notes'));
    assert.ok(salesOption, 'should have Sales Notes option');
    
    // Should have revenue impact around $71,561 not inflated $116,561
    // Allow within 2% of 71561 (70130 to 72992)
    assert.ok(salesOption.revenue_impact >= 70130 && salesOption.revenue_impact <= 72992, 
      `should have ~$71,561 revenue impact, not inflated $116,561 (got ${salesOption.revenue_impact})`);
    
    // Notes should mention double counting or overstatement
    assert.ok(salesOption.notes, 'should have notes field');
    const hasInsight = /double.*count|count.*double|overstated|inflated|same.*revenue/i.test(salesOption.notes);
    assert.ok(hasInsight, 'notes should mention double counting or overstatement');
  });
  
  it('links support tickets to Q3 goals', () => {
    const supportOption = block.options.find(o => o.name && o.name.includes('Support Tickets'));
    assert.ok(supportOption, 'should have Support Tickets option');
    
    // Should have cost savings (allow 2% rounding)
    // Allow within 2% of 18500 (18130 to 18870)
    assert.ok(supportOption.monthly_cost_savings >= 18130 && supportOption.monthly_cost_savings <= 18870, 
      `should have ~$18,500 monthly savings (got ${supportOption.monthly_cost_savings})`);
    // Allow within 2% of 222000 (217560 to 226440)
    assert.ok(supportOption.annual_cost_savings >= 217560 && supportOption.annual_cost_savings <= 226440, 
      `should have ~$222,000 annual savings (got ${supportOption.annual_cost_savings})`);
    
    // Notes should mention Q3 goals
    assert.ok(supportOption.notes, 'should have notes field');
    assert.ok(
      /Q3.*goal|goal.*Q3|strategic.*alignment|reduce.*support|support.*cost/i.test(supportOption.notes),
      'should mention Q3 goal alignment or support cost reduction'
    );
  });
  
  it('does not merely copy apparent numbers', () => {
    const exportOption = block.options.find(o => o.name && o.name.includes('Export CSV'));
    const salesOption = block.options.find(o => o.name && o.name.includes('Sales Notes'));
    
    // Export should not use raw request count (28 would be wrong, ~15 is correct)
    if (exportOption.customers && exportOption.customers >= 27 && exportOption.customers <= 29) {
      assert.fail('Should not use raw request count of ~28 (needs to account for duplicates)');
    }
    
    // Sales should not use inflated revenue (~116561 would be wrong, ~71561 is correct)
    if (salesOption.revenue_impact && salesOption.revenue_impact >= 114200 && salesOption.revenue_impact <= 118900) {
      assert.fail('Should not use inflated revenue of ~$116,561 (needs to account for double counting)');
    }
  });
  
  it('calculations are mathematically consistent', () => {
    const exportOption = block.options.find(o => o.name && o.name.includes('Export CSV'));
    const supportOption = block.options.find(o => o.name && o.name.includes('Support Tickets'));
    
    // Monthly to annual calculation for support (allow 2% difference)
    if (supportOption.monthly_cost_savings && supportOption.annual_cost_savings) {
      const calculatedAnnual = supportOption.monthly_cost_savings * 12;
      const diff = Math.abs(supportOption.annual_cost_savings - calculatedAnnual);
      const allowedDiff = calculatedAnnual * 0.02; // 2%
      assert.ok(
        diff <= allowedDiff,
        `Annual savings ${supportOption.annual_cost_savings} should be ~12 × monthly ${supportOption.monthly_cost_savings} (calculated: ${calculatedAnnual}, diff: ${diff})`
      );
    }
    
    // Export revenue per customer should be reasonable
    if (exportOption.customers && exportOption.monthly_revenue) {
      const avgPerCustomer = exportOption.monthly_revenue / exportOption.customers;
      assert.ok(avgPerCustomer >= 300 && avgPerCustomer <= 500,
        `Average revenue per customer (${avgPerCustomer}) should be between $300 and $500`);
    }
  });
});