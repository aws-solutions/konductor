// Test for seeded issue: KMS key with rotation disabled and a key policy granting kms:* to an external account
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('KMS key security', () => {
  it('should find KMS key with rotation disabled and external access', () => {
    const findings = readFindings('REVIEW.md');
    const item = findItem(findings, {
      where: ['kms', 'key', 'encryption', 'sensitive'],
      about: [
        ['rotation', 'key_rotation', 'rotate'],
        ['external', 'account', '999999999999'],
        ['policy', 'permission', 'kms:*']
      ],
      min: 2
    });
    
    assert.ok(item, 'Should find the KMS key security issue');
    assert.ok(atLeast(item, 'high'), 'Should be at least high severity');
  });
});