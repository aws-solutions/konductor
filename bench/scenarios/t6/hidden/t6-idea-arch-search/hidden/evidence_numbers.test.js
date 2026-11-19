const { blockOf, numbersIn } = require('./doc-key.js');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Evidence numbers from query analysis', () => {
  const block = blockOf('docs/framing.md');
  
  it('includes part-number search share around 65%', () => {
    const reqs = block.requirements || [];
    const allText = reqs.map(r => typeof r === 'string' ? r : r?.text || '').join(' ');
    const numbers = numbersIn(allText);
    
    // Look for percentage in the 60-70% range for part number share
    const partNumberShare = numbers.find(n => {
      const num = parseFloat(n);
      return num >= 60 && num <= 70;
    });
    
    assert.ok(partNumberShare, `Should include part-number share around 65% (found numbers: ${numbers.join(', ')})`);
    
    // Also check for mention of part number with this percentage
    const textWithNumber = reqs.find(r => {
      const text = typeof r === 'string' ? r : r?.text || '';
      return text.includes(partNumberShare) && /part.?number|part.?no|pn/i.test(text);
    });
    assert.ok(textWithNumber, `Percentage ${partNumberShare}% should be associated with part-number searches`);
  });
  
  it('includes part-number search failure rate around 76%', () => {
    const reqs = block.requirements || [];
    const allText = reqs.map(r => typeof r === 'string' ? r : r?.text || '').join(' ');
    const numbers = numbersIn(allText);
    
    // Look for percentage in the 70-80% range for failure rate
    const failureRate = numbers.find(n => {
      const num = parseFloat(n);
      return num >= 70 && num <= 80;
    });
    
    assert.ok(failureRate, `Should include part-number failure rate around 76% (found numbers: ${numbers.join(', ')})`);
    
    // Check for failure context
    const textWithFailure = reqs.find(r => {
      const text = typeof r === 'string' ? r : r?.text || '';
      return text.includes(failureRate) && /fail|not.?work|unsuccessful/i.test(text);
    });
    assert.ok(textWithFailure, `Percentage ${failureRate}% should be associated with failure rate`);
  });
  
  it('includes text search success rate around 78%', () => {
    const reqs = block.requirements || [];
    const allText = reqs.map(r => typeof r === 'string' ? r : r?.text || '').join(' ');
    const numbers = numbersIn(allText);
    
    // Look for all percentages in the 70-80% range
    const successRates = numbers.filter(n => {
      const num = parseFloat(n);
      return num >= 70 && num <= 80;
    });
    
    assert.ok(successRates.length > 0, `Should include text search success rate around 78% (found numbers: ${numbers.join(', ')})`);
    
    // Check if any of these numbers is in a success context
    const hasSuccessRate = successRates.some(rate => {
      return reqs.some(r => {
        const text = typeof r === 'string' ? r : r?.text || '';
        return text.includes(rate) && /success|work|find|result/i.test(text);
      });
    });
    
    assert.ok(hasSuccessRate, `Should have a percentage 70-80% associated with success (found rates: ${successRates.join(', ')})`);
  });
});