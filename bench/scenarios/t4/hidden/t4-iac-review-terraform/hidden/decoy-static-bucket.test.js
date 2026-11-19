// Test for decoy: public-read bucket that is the intended static website behind the CDN (this is fine)
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('Static website bucket (decoy)', () => {
  it('should NOT report static website bucket as high/critical issue', () => {
    const findings = readFindings('REVIEW.md');
    
    // Require REVIEW.md exists with at least 3 findings
    assert.ok(findings.length >= 3, 'REVIEW.md should exist with at least 3 findings');
    
    const item = findItem(findings, {
      where: ['static', 'website', 'bucket', 'public-read'],
      about: [['public', 'acl', 'accessible']]
    });
    
    // This is a decoy - static website bucket SHOULD be public-read for CDN
    // So if it's reported, it should be low or info severity, not high/critical
    if (item) {
      assert.ok(!atLeast(item, 'high'), 
        'Static website bucket should not be reported as high/critical (it\'s intended to be public for CDN)');
    }
    // It's okay if it's not reported at all, or reported as low/info
  });
});