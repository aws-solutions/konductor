'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../scripts/validate-config');

test('valid configuration has no validation errors', () => {
  assert.deepEqual(validateConfig({
    stage: 'staging', region: 'us-east-1', accountId: '111122223333',
    bucketName: 'bucket', distributionId: 'EDIST', functionName: 'api',
    executionRoleName: 'api-exec', liveAlias: 'live', sitePrefix: 'site/'
  }), []);
});

test('validation reports malformed account and prefix', () => {
  const errors = validateConfig({ stage: 'staging', region: 'us-east-1', accountId: '123', bucketName: 'b', distributionId: 'd', functionName: 'f', executionRoleName: 'r', liveAlias: 'live', sitePrefix: 'site' });
  assert.ok(errors.includes('accountId must contain 12 digits'));
  assert.ok(errors.includes('sitePrefix must end with a slash'));
});
