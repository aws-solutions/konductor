// Test for decoy: port 443 open to the world on the public load balancer (this is fine)
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('Load balancer port 443 (decoy)', () => {
  it('should NOT report load balancer port 443 as high/critical issue', () => {
    const findings = readFindings('REVIEW.md');
    
    // Require REVIEW.md exists with at least 3 findings
    assert.ok(findings.length >= 3, 'REVIEW.md should exist with at least 3 findings');
    
    const item = findItem(findings, {
      where: ['load balancer', 'alb', '443', 'https'],
      about: [['0.0.0.0/0', 'public', 'internet']]
    });
    
    // This is a decoy - load balancer SHOULD have port 443 open to the world
    // So if it's reported, it should be low or info severity, not high/critical
    if (item) {
      assert.ok(!atLeast(item, 'high'), 
        'Load balancer port 443 should not be reported as high/critical (it\'s intended to be public)');
    }
    // It's okay if it's not reported at all, or reported as low/info
  });
});