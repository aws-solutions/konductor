const { blockOf } = require('./doc-key.js');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('JSON block structure requirements', () => {
  const block = blockOf('docs/framing.md');
  
  it('has required top-level fields', () => {
    assert.ok(typeof block === 'object' && block !== null, 'Block should be a JSON object');
    assert.ok(block.requirements, 'Should have requirements field');
    assert.ok(block.options, 'Should have options field');
    assert.ok(block.analysis, 'Should have analysis field');
    assert.ok(block.recommendation, 'Should have recommendation field');
    assert.ok(block.measure, 'Should have measure field');
  });
  
  it('has requirements as array', () => {
    assert.ok(Array.isArray(block.requirements), 'requirements should be an array');
    assert.ok(block.requirements.length > 0, 'requirements array should not be empty');
    
    // Check each requirement is either string or object with text
    block.requirements.forEach((req, i) => {
      if (typeof req === 'string') {
        assert.ok(req.length > 10, `Requirement ${i} string should be substantial`);
      } else if (typeof req === 'object') {
        assert.ok(req.text, `Requirement ${i} object should have text property`);
        assert.ok(req.text.length > 10, `Requirement ${i} text should be substantial`);
      } else {
        assert.fail(`Requirement ${i} should be string or object, got ${typeof req}`);
      }
    });
  });
  
  it('has options as array', () => {
    assert.ok(Array.isArray(block.options), 'options should be an array');
    assert.ok(block.options.length >= 2, 'options should have at least 2 items');
  });
  
  it('has analysis as string or object', () => {
    const analysis = block.analysis;
    const analysisText = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
    assert.ok(analysisText.length > 50, 'analysis should be substantial');
  });
  
  it('has recommendation as string or object', () => {
    const recommendation = block.recommendation;
    const recText = typeof recommendation === 'string' ? recommendation : JSON.stringify(recommendation);
    assert.ok(recText.length > 30, 'recommendation should be substantial');
  });
  
  it('has measure as string or object', () => {
    const measure = block.measure;
    const measureText = typeof measure === 'string' ? measure : JSON.stringify(measure);
    assert.ok(measureText.length > 20, 'measure should be substantial');
  });
});