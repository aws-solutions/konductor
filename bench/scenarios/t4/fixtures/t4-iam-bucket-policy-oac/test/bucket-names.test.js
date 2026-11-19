const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { validateBucketNames } = require('../scripts/validate-buckets.js');

describe('bucket names', () => {
  it('should follow naming convention', () => {
    const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    const stages = ['staging', 'production'];
    const bucketTypes = ['assets', 'downloads', 'logs'];
    
    for (const stage of stages) {
      for (const type of bucketTypes) {
        const bucketName = config.bucketNames[stage][type];
        
        // Check naming pattern
        const expectedPattern = `${type}-bucket-${stage === 'production' ? 'prod' : stage}`;
        assert.strictEqual(
          bucketName,
          expectedPattern,
          `Bucket name should be ${expectedPattern}, got ${bucketName}`
        );
        
        // Check S3 naming rules
        assert.ok(bucketName.length >= 3 && bucketName.length <= 63);
        assert.match(bucketName, /^[a-z0-9.-]+$/);
        
        // Should not start or end with hyphen
        assert.ok(!bucketName.startsWith('-') && !bucketName.endsWith('-'));
        
        // Should not have consecutive hyphens or periods
        assert.ok(!bucketName.includes('--'));
        assert.ok(!bucketName.includes('..'));
        assert.ok(!bucketName.includes('-.'));

      }
    }
  });
  
  it('validateBucketNames should return true for valid config', () => {
    const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    const isValid = validateBucketNames(config);
    assert.strictEqual(isValid, true);
  });
});