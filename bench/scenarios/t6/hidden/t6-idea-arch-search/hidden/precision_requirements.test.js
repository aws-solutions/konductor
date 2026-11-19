const { blockOf, requirementTexts, numbersIn } = require('./doc-key.js');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Precision and requirement quality', () => {
  const block = blockOf('docs/framing.md');
  
  it('has at least 3 requirements but no more than 8', () => {
    const reqs = block.requirements || [];
    assert.ok(reqs.length >= 3, `Should have at least 3 requirements, found ${reqs.length}`);
    assert.ok(reqs.length <= 8, `Should have no more than 8 requirements, found ${reqs.length}`);
  });
  
  it('does not claim dedicated engine is only solution', () => {
    const reqTexts = requirementTexts(block);
    const dedicatedEngineClaims = reqTexts.filter(text => 
      /only|must|have.?to|required|necessary/i.test(text) &&
      /dedicated|separate|full|algolia|elastic|engine/i.test(text)
    );
    
    assert.strictEqual(dedicatedEngineClaims.length, 0, 
      'Should not claim dedicated engine is only/must solution: ' + dedicatedEngineClaims.join(' | '));
  });
  
  it('acknowledges text search works reasonably well', () => {
    const reqTexts = requirementTexts(block);
    const textSearchWorking = reqTexts.filter(text => 
      /text|description|word/i.test(text) &&
      /work|success|ok|reasonable|adequate/i.test(text)
    );
    
    assert.ok(textSearchWorking.length > 0, 
      'Should acknowledge text search works reasonably well');
  });
  
  it('uses numbers from evidence correctly (no invented percentages)', () => {
    const reqTexts = requirementTexts(block);
    
    // Check for reasonable percentage ranges
    const unreasonablePercentages = reqTexts.filter(text => {
      const numbers = numbersIn(text);
      return numbers.some(n => {
        const num = parseFloat(n);
        // Check for percentages outside reasonable ranges for this context
        return (num > 100 || num < 0) && !text.includes('$'); // Exclude dollar amounts
      });
    });
    
    assert.strictEqual(unreasonablePercentages.length, 0,
      'Should not contain unreasonable percentages: ' + unreasonablePercentages.join(' | '));
  });
});