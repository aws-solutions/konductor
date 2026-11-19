'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../scripts/lib/config');

test('stage configs derive the expected resource shapes', () => {
  const staging = loadConfig('staging');
  const production = loadConfig('production');
  assert.match(staging.bucketArn, /^arn:aws:s3:::/);
  assert.match(production.functionArn, /:function:lantern-api-production$/);
  assert.match(staging.executionRoleArn, /:role\/lantern-api-staging-exec$/);
  assert.match(production.aliasArn, /:function:lantern-api-production:live$/);
});

test('unknown stages are rejected', () => {
  assert.throws(() => loadConfig('qa'), /Unknown stage/);
});
