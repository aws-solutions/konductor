// Padding test: no more than 18 items
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings } = require('./findings.js');

describe('Padding limit', () => {
  it('should have reasonable number of findings (not excessive)', () => {
    const findings = readFindings('REVIEW.md');
    
    // Must have at least 3 findings to show meaningful review
    assert.ok(findings.length >= 3, 'Should have at least 3 findings for meaningful review');
    
    // Should not have more than 18 findings (padding test)
    assert.ok(findings.length <= 18, 'Should not have more than 18 findings (reasonable limit)');
  });
});