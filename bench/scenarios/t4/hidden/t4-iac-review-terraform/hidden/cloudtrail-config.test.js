// Test for seeded issue: audit trail changed to single-region with log file validation off
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem, atLeast } = require('./findings.js');

describe('CloudTrail configuration', () => {
  it('should find single-region CloudTrail without validation', () => {
    const findings = readFindings('REVIEW.md');
    const item = findItem(findings, {
      where: ['cloudtrail', 'audit', 'trail', 'logging'],
      about: [
        ['multi', 'region', 'single'],
        ['validation', 'log_file', 'integrity'],
        ['false', 'disabled', 'off']
      ],
      min: 2
    });
    
    assert.ok(item, 'Should find the CloudTrail configuration issue');
    assert.ok(atLeast(item, 'medium'), 'Should be at least medium severity');
  });
});