// Test for seeded issue: security group opening port 5432 to 0.0.0.0/0
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('Reporting database security group', () => {
  it('should find overly permissive security group', () => {
    const findings = readFindings('REVIEW.md');
    const item = findItem(findings, {
      where: ['reporting', 'database', 'security', 'sg', '5432'],
      about: [
        ['0.0.0.0/0', 'world', 'internet', 'anywhere'],
        ['port', '5432', 'postgres'],
        ['insecure', 'permissive', 'open']
      ],
      min: 2
    });
    
    assert.ok(item, 'Should find the open PostgreSQL port issue');
    assert.ok(atLeast(item, 'high'), 'Should be at least high severity');
  });
});