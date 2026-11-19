const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { validateConfig } = require('../deploy/deploy.js');

describe('deploy', () => {
  it('should have all required policy files', () => {
    const policyFiles = [
      'infra/buckets/assets-policy.json',
      'infra/buckets/downloads-policy.json',
      'infra/buckets/logs-policy.json'
    ];
    
    for (const policyFile of policyFiles) {
      const policyPath = path.join(__dirname, '..', policyFile);
      assert.ok(fs.existsSync(policyPath), `Missing ${policyFile}`);
    }
  });
  
  it('should have valid JSON in policy files', () => {
    const policyFiles = [
      'infra/buckets/assets-policy.json',
      'infra/buckets/downloads-policy.json',
      'infra/buckets/logs-policy.json'
    ];
    
    for (const policyFile of policyFiles) {
      const policyPath = path.join(__dirname, '..', policyFile);
      const content = fs.readFileSync(policyPath, 'utf8');
      assert.doesNotThrow(() => JSON.parse(content), `Invalid JSON in ${policyFile}`);
    }
  });
  
  it('should have CDN config file', () => {
    const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
    assert.ok(fs.existsSync(configPath), 'Missing CDN config');
    
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    assert.strictEqual(config.accountId, '111122223333');
    assert.ok(config.distributions.staging);
    assert.ok(config.distributions.production);
  });
  
  it('deploy role policy should allow required actions', () => {
    const policyPath = path.join(__dirname, '..', 'infra', 'iam', 'deploy-role-policy.json');
    assert.ok(fs.existsSync(policyPath), 'Missing deploy role policy');
    
    const content = fs.readFileSync(policyPath, 'utf8');
    const policy = JSON.parse(content);
    
    // Check it has statements
    assert.ok(Array.isArray(policy.Statement));
    assert.ok(policy.Statement.length > 0);
  });
});

describe('validateConfig', () => {
  it('should validate config without throwing', () => {
    const mockConfig = {
      environment: 'staging'
    };
    assert.doesNotThrow(() => validateConfig(mockConfig));
  });
});