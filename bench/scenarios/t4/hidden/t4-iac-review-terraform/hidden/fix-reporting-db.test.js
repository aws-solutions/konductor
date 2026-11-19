// Test fix for: reporting database with storage_encrypted false and publicly_accessible true
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem } = require('./findings.js');

describe('Reporting database fix', () => {
  it('should suggest proper fix for reporting database', () => {
    const findings = readFindings('REVIEW.md');
    
    // Require REVIEW.md exists with at least 3 findings
    assert.ok(findings.length >= 3, 'REVIEW.md should exist with at least 3 findings');
    
    const item = findItem(findings, {
      where: ['reporting', 'database', 'rds'],
      about: [
        ['encryption', 'encrypted'],
        ['public', 'accessible']
      ],
      min: 1
    });
    
    // Must find the reporting database issue
    assert.ok(item, 'Should find reporting database encryption/accessibility issue');
    
    const fixText = (item.fix || item.recommendation || item.suggestion || '').toLowerCase();
    const hasFixIdea = (fixText.includes('storage_encrypted') && fixText.includes('true')) ||
                      (fixText.includes('encryption') && fixText.includes('enable')) ||
                      (fixText.includes('publicly_accessible') && fixText.includes('false')) ||
                      (fixText.includes('private') && fixText.includes('vpc'));
    
    assert.ok(hasFixIdea, 'Should suggest enabling encryption and making database private');
  });
});