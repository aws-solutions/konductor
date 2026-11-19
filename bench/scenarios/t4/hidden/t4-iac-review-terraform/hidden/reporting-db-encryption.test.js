// Test for seeded issue: reporting database with storage_encrypted false and publicly_accessible true
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('Reporting database encryption and accessibility', () => {
  it('should find unencrypted and publicly accessible database', () => {
    const findings = readFindings('REVIEW.md');
    const item = findItem(findings, {
      where: ['reporting', 'database', 'rds'],
      about: [
        ['encryption', 'encrypted', 'kms', 'storage_encrypted'],
        ['public', 'accessible', 'publicly_accessible'],
        ['false', 'disabled', 'missing']
      ],
      min: 2
    });
    
    assert.ok(item, 'Should find the unencrypted/public database issue');
    assert.ok(atLeast(item, 'high'), 'Should be at least high severity');
  });
});