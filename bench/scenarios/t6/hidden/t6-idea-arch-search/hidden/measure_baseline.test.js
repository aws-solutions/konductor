const { blockOf, numbersIn } = require('./doc-key.js');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Measure with baseline', () => {
  const block = blockOf('docs/framing.md');
  
  it('includes a measurable goal', () => {
    const measure = block.measure || {};
    const measureText = typeof measure === 'string' ? measure : JSON.stringify(measure);
    
    assert.ok(measureText.length > 10, 'Measure should be defined');
    assert.match(measureText, /goal|target|objective|metric|kpi|success/i, 'Should define a goal');
  });
  
  it('specifies part-number search success rate improvement', () => {
    const measure = block.measure || {};
    const measureText = typeof measure === 'string' ? measure : JSON.stringify(measure);
    
    assert.match(measureText, /part.?number|pn|partnum/i, 'Should mention part number');
    assert.match(measureText, /success|rate|percent|%|improve|increase/i, 'Should mention success rate improvement');
  });
  
  it('includes baseline (current) value around 24%', () => {
    const measure = block.measure || {};
    const measureText = typeof measure === 'string' ? measure : JSON.stringify(measure);
    const numbers = numbersIn(measureText);
    
    // Look for baseline around 20-30%
    const baseline = numbers.find(n => {
      const num = parseFloat(n);
      return num >= 20 && num <= 30;
    });
    
    assert.ok(baseline, `Should include baseline success rate around 24% (found numbers: ${numbers.join(', ')})`);
    
    // Check for baseline context
    assert.match(measureText, /current|baseline|now|present|existing/i, 'Should indicate baseline');
  });
  
  it('includes target value significantly higher than baseline', () => {
    const measure = block.measure || {};
    const measureText = typeof measure === 'string' ? measure : JSON.stringify(measure);
    const numbers = numbersIn(measureText);
    
    // Should have at least one number >30% (higher than baseline)
    const target = numbers.find(n => {
      const num = parseFloat(n);
      return num > 30;
    });
    
    assert.ok(target, `Should include target success rate higher than baseline (found numbers: ${numbers.join(', ')})`);
    
    // Check for target context
    assert.match(measureText, /target|goal|aim|objective|improve.?to/i, 'Should indicate target');
  });
  
  it('relates measure to support ticket reduction', () => {
    const measure = block.measure || {};
    const measureText = typeof measure === 'string' ? measure : JSON.stringify(measure);
    
    assert.match(measureText, /support.?ticket|ticket.?volume|complaint/i, 'Should mention support tickets');
    assert.match(measureText, /reduc|decreas|lower|improve/i, 'Should mention reduction');
  });
});