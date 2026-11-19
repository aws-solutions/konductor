// Test for seeded issue: database master password as a plain variable default
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('Plaintext password', () => {
  it('should find plaintext password in variables', () => {
    const findings = readFindings('REVIEW.md');
    const item = findItem(findings, {
      where: ['variables', 'password', 'db_password', 'default'],
      about: [
        ['plaintext', 'cleartext', 'hardcoded'],
        ['password', 'secret', 'credential'],
        ['variable', 'default', 'tfvars']
      ],
      min: 2
    });
    
    assert.ok(item, 'Should find the plaintext password issue');
    assert.ok(atLeast(item, 'critical'), 'Should be at least critical severity');
  });
});