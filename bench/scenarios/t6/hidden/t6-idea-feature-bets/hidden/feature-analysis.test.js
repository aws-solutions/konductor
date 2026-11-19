const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');
const { blockOf, readDoc } = require('./doc-key.js');

describe('feature analysis', () => {
  const block = blockOf('docs/framing.md');
  
  it('has three options in the JSON block', () => {
    assert.ok(Array.isArray(block.options), 'options should be an array');
    assert.equal(block.options.length, 3, 'should have exactly 3 options');
  });
  
  it('first option is Export CSV with correct customer count', () => {
    const exportOption = block.options.find(o => o.name && o.name.includes('Export CSV'));
    assert.ok(exportOption, 'should have Export CSV option');
    // Allow within 2% of 15 (14.7 to 15.3) - but customer count should be integer
    assert.ok(exportOption.customers >= 14 && exportOption.customers <= 16, 
      `should have ~15 customers (got ${exportOption.customers})`);
  });
  
  it('first option notes duplicate requests from Acme Corp', () => {
    const exportOption = block.options.find(o => o.name && o.name.includes('Export CSV'));
    assert.ok(exportOption.notes, 'should have notes field');
    assert.ok(
      /Acme Corp.*duplicate|duplicate.*Acme Corp/i.test(exportOption.notes),
      'notes should mention Acme Corp duplicate requests'
    );
    assert.ok(
      /8.*duplicate|duplicate.*8/i.test(exportOption.notes) || 
      /multiple.*duplicate|duplicate.*multiple/i.test(exportOption.notes),
      'should mention multiple duplicates'
    );
  });
  
  it('second option is Sales Notes with correct revenue impact', () => {
    const salesOption = block.options.find(o => o.name && o.name.includes('Sales Notes'));
    assert.ok(salesOption, 'should have Sales Notes option');
    // Allow within 2% of 71561 (70130 to 72992)
    assert.ok(salesOption.revenue_impact >= 70130 && salesOption.revenue_impact <= 72992, 
      `should have ~$71,561 revenue impact (got ${salesOption.revenue_impact})`);
  });
  
  it('second option notes double counting of revenue', () => {
    const salesOption = block.options.find(o => o.name && o.name.includes('Sales Notes'));
    assert.ok(salesOption.notes, 'should have notes field');
    assert.ok(
      /double.*count|count.*double|overstated|inflated/i.test(salesOption.notes),
      'should mention double counting or overstatement'
    );
  });
  
  it('third option is Support Tickets with correct cost savings', () => {
    const supportOption = block.options.find(o => o.name && o.name.includes('Support Tickets'));
    assert.ok(supportOption, 'should have Support Tickets option');
    // Allow within 2% of 18500 (18130 to 18870)
    assert.ok(supportOption.monthly_cost_savings >= 18130 && supportOption.monthly_cost_savings <= 18870, 
      `should have ~$18,500 monthly savings (got ${supportOption.monthly_cost_savings})`);
    // Allow within 2% of 222000 (217560 to 226440)
    assert.ok(supportOption.annual_cost_savings >= 217560 && supportOption.annual_cost_savings <= 226440, 
      `should have ~$222,000 annual savings (got ${supportOption.annual_cost_savings})`);
  });
  
  it('third option notes alignment with Q3 goals', () => {
    const supportOption = block.options.find(o => o.name && o.name.includes('Support Tickets'));
    assert.ok(supportOption.notes, 'should have notes field');
    assert.ok(
      /Q3.*goal|goal.*Q3|support.*ticket.*volume|reduce.*support/i.test(supportOption.notes),
      'should mention Q3 goal of reducing support ticket volume'
    );
  });
  
  it('recommends support tickets feature', () => {
    assert.ok(block.recommendation, 'should have recommendation');
    const recLower = block.recommendation.toLowerCase();
    assert.ok(recLower.includes('support') && recLower.includes('ticket'), 
      `recommendation should mention support tickets (got: ${block.recommendation})`);
  });
  
  it('reason mentions financial case and strategic alignment', () => {
    assert.ok(block.reason, 'should have reason field');
    assert.ok(
      /financial.*case|cost.*savings|ROI/i.test(block.reason),
      'reason should mention financial case or cost savings'
    );
    assert.ok(
      /strategic.*alignment|Q3.*goal|board.*concern/i.test(block.reason),
      'reason should mention strategic alignment or Q3 goals'
    );
  });
  
  it('first option has reasonable monthly revenue', () => {
    const exportOption = block.options.find(o => o.name && o.name.includes('Export CSV'));
    // Allow within 2% of 6785 (6649 to 6921)
    assert.ok(exportOption.monthly_revenue >= 6649 && exportOption.monthly_revenue <= 6921, 
      `should have ~$6,785 monthly revenue (got ${exportOption.monthly_revenue})`);
  });
  
  it('does not choose Export CSV due to duplicate inflation', () => {
    assert.notEqual(block.recommendation, 'Export CSV with Customer IDs', 'should not choose Export CSV');
  });
  
  it('does not choose Sales Notes due to double counting', () => {
    assert.notEqual(block.recommendation, 'Sales Notes Integration', 'should not choose Sales Notes');
  });
});