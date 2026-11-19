'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deploy } = require('../scripts/deploy');
const { rollback } = require('../scripts/rollback');
const { createFakeClient } = require('../scripts/lib/cloud-client');

test('staging deployment uploads the site and publishes the API', async () => {
  const calls = [];
  const result = await deploy({ stage: 'staging', client: createFakeClient(calls), releaseId: 'test-release' });
  assert.equal(result.stage, 'staging');
  assert.ok(result.uploaded.includes('index.html'));
  assert.ok(calls.some((call) => call.action === 'lambda:PublishVersion'));
  assert.ok(!calls.some((call) => call.action === 'cloudfront:CreateInvalidation'));
});

test('production deployment refreshes the CDN', async () => {
  const calls = [];
  await deploy({ stage: 'production', client: createFakeClient(calls), releaseId: 'test-release' });
  assert.ok(calls.some((call) => call.action === 'cloudfront:CreateInvalidation'));
});

test('rollback moves the stage alias', async () => {
  const calls = [];
  const result = await rollback({ stage: 'staging', client: createFakeClient(calls), version: 8 });
  assert.equal(result.version, '8');
  assert.equal(calls[0].action, 'lambda:UpdateAlias');
});
