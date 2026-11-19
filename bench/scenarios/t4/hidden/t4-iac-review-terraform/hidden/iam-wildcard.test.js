// Test for seeded issue: IAM policy for reporting task with Action "*"
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('IAM policy wildcard', () => {
  it('should find overly permissive IAM policy', () => {
    const findings = readFindings('REVIEW.md');
    const item = findItem(findings, {
      where: ['iam', 'policy', 'reporting', 'task', 'role'],
      about: [
        ['action', '*', 'wildcard', 'all'],
        ['permission', 'privilege'],
        ['excessive', 'overly']
      ],
      min: 2
    });
    
    assert.ok(item, 'Should find the wildcard IAM policy issue');
    assert.ok(atLeast(item, 'high'), 'Should be at least high severity');
  });
});