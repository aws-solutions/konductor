const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { checkConfig } = require('../scripts/check-config.js');

describe('config validation', () => {
  it('should have valid config structure', () => {
    const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    const errors = checkConfig(config);
    assert.strictEqual(errors.length, 0, `Config errors: ${errors.join(', ')}`);
  });
  
  it('should have correct distribution IDs', () => {
    const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    assert.strictEqual(config.distributions.staging.id, 'E1A2B3C4D5E6F7');
    assert.strictEqual(config.distributions.production.id, 'F8E7D6C5B4A3F2');
    
    // IDs should be CloudFront distribution ID format
    assert.match(config.distributions.staging.id, /^[A-Z0-9]+$/);
    assert.match(config.distributions.production.id, /^[A-Z0-9]+$/);
  });
  
  it('should have matching ARNs', () => {
    const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    assert.strictEqual(
      config.distributions.staging.arn,
      `arn:aws:cloudfront::${config.accountId}:distribution/${config.distributions.staging.id}`
    );
    
    assert.strictEqual(
      config.distributions.production.arn,
      `arn:aws:cloudfront::${config.accountId}:distribution/${config.distributions.production.id}`
    );
  });
});