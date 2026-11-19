// Test for decoy: wildcard resource on read-only log describe actions (this is fine)
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('Log shipping wildcard (decoy)', () => {
  it('should NOT report log describe wildcard as high/critical issue', () => {
    const findings = readFindings('REVIEW.md');
    
    // Require REVIEW.md exists with at least 3 findings
    assert.ok(findings.length >= 3, 'REVIEW.md should exist with at least 3 findings');
    
    const item = findItem(findings, {
      where: ['log', 'shipping', 'iam', 'policy'],
      about: [
        ['wildcard', 'resource', '*'],
        ['log', 'logs', 'cloudwatch'],
        ['read-only', 'readonly', 'operations']
      ],
      min: 2
    });
    
    // This is a decoy - log describe wildcard is acceptable for read-only operations
    // So if it's reported, it should be low or info severity, not high/critical
    if (item) {
      assert.ok(!atLeast(item, 'high'), 
        'Log describe wildcard should not be reported as high/critical (it\'s read-only operations)');
    }
    // It's okay if it's not reported at all, or reported as low/info
  });
});