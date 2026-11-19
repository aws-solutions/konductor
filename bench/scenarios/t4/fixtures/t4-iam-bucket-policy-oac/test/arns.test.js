const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { generateARNs } = require('../scripts/generate-arns.js');

describe('ARN generation', () => {
  it('should generate ARNs without throwing', () => {
    const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Should not throw
    assert.doesNotThrow(() => generateARNs(config));
  });
  
  it('should have correct bucket names in config', () => {
    const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    const stages = ['staging', 'production'];
    const bucketTypes = ['assets', 'downloads', 'logs'];
    
    for (const stage of stages) {
      for (const type of bucketTypes) {
        const bucketName = config.bucketNames[stage][type];
        assert.ok(bucketName, `Missing ${stage}.${type} bucket name`);
        assert.match(bucketName, /^[a-z0-9.-]+$/, `Invalid bucket name: ${bucketName}`);
      }
    }
  });
  
  it('should have CloudFront distribution ARNs', () => {
    const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    assert.ok(config.distributions.staging.arn);
    assert.ok(config.distributions.production.arn);
    
    assert.match(
      config.distributions.staging.arn,
      /^arn:aws:cloudfront::111122223333:distribution\/[A-Z0-9]+$/
    );
  });
});