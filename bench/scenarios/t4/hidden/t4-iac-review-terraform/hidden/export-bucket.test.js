// Test for seeded issue: exports bucket made public through ACL or policy
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('Export bucket security', () => {
  it('should find public exports bucket issue', () => {
    const findings = readFindings('REVIEW.md');
    const item = findItem(findings, {
      where: ['exports', 'storage', 's3', 'bucket'],
      about: [
        ['public', 'world', 'everyone'],
        ['acl', 'policy'],
        ['principal', '*']
      ],
      min: 2
    });
    
    assert.ok(item, 'Should find the public exports bucket issue');
    assert.ok(atLeast(item, 'medium'), 'Should be at least medium severity');
  });
});