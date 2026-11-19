// Test fix for: database master password as a plain variable default
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { readFindings, findItem } = require('./findings.js');

describe('Plaintext password fix', () => {
  it('should suggest proper fix for plaintext password', () => {
    const findings = readFindings('REVIEW.md');
    
    // Require REVIEW.md exists with at least 3 findings
    assert.ok(findings.length >= 3, 'REVIEW.md should exist with at least 3 findings');
    
    const item = findItem(findings, {
      where: ['variables', 'password', 'db_password', 'default'],
      about: [
        ['plaintext', 'cleartext', 'hardcoded'],
        ['password', 'secret', 'credential']
      ],
      min: 2
    });
    
    // Must find the plaintext password issue
    assert.ok(item, 'Should find plaintext password issue');
    
    const fixText = (item.fix || item.recommendation || item.suggestion || '').toLowerCase();
    const hasFixIdea = fixText.includes('secret') || 
                      fixText.includes('secretsmanager') ||
                      fixText.includes('parameter') ||
                      fixText.includes('ssm') ||
                      fixText.includes('environment') ||
                      fixText.includes('variable') && fixText.includes('sensitive');
    
    assert.ok(hasFixIdea, 'Should suggest proper fix like Secrets Manager or sensitive variables');
  });
});