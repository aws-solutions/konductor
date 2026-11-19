// Test that critical/high severity findings are properly classified
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('Severity classification', () => {
  it('should have appropriate severity levels for serious issues', () => {
    const findings = readFindings('REVIEW.md');
    
    // Require REVIEW.md exists with at least 3 findings
    assert.ok(findings.length >= 3, 'REVIEW.md should exist with at least 3 findings');
    
    // Check plaintext password should be critical
    const passwordItem = findItem(findings, {
      where: ['password', 'db_password'],
      about: [['plaintext', 'hardcoded']]
    });
    
    if (passwordItem) {
      assert.ok(atLeast(passwordItem, 'critical') || atLeast(passwordItem, 'high'),
        'Plaintext password should be critical or high severity');
    }
    
    // Check open PostgreSQL port should be high
    const dbPortItem = findItem(findings, {
      where: ['5432', 'postgres', 'database'],
      about: [['0.0.0.0/0', 'public']]
    });
    
    if (dbPortItem) {
      assert.ok(atLeast(dbPortItem, 'high'),
        'Open PostgreSQL port should be at least high severity');
    }
  });
});