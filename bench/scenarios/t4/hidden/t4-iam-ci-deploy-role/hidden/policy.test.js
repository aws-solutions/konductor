'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluate, isAllowed, lint } = require('./iam-eval.js');
const { deploy } = require('../scripts/deploy');
const { rollback } = require('../scripts/rollback');
const { createFakeClient } = require('../scripts/lib/cloud-client');

const policyFile = path.join(__dirname, '..', 'infra', 'iam', 'ci-deploy-policy.json');
const policy = () => JSON.parse(fs.readFileSync(policyFile, 'utf8'));
const principal = { AWS: 'arn:aws:iam::111122223333:role/lantern-ci-deploy' };
const request = (action, resource, context = {}) => ({ action, resource, principal, context });

function allowedForCall(call) {
  const context = {};
  if (call.action === 'iam:PassRole') context['iam:PassedToService'] = call.params.iamPassedToService;
  return isAllowed([policy()], request(call.action, call.resource, context));
}

async function recorded(run) {
  const calls = [];
  await run(createFakeClient(calls));
  return calls;
}

// Deploy and rollback are separate tests, so a policy that forgets the rollback path loses that test only.
for (const [name, runs] of [
  ['deploy of both stages', [
    (client) => deploy({ stage: 'staging', client, releaseId: 'hidden-staging' }),
    (client) => deploy({ stage: 'production', client, releaseId: 'hidden-production' }),
  ]],
  ['rollback of both stages', [
    (client) => rollback({ stage: 'staging', client, version: 11 }),
    (client) => rollback({ stage: 'production', client, version: 11 }),
  ]],
]) {
  test(`every call of the ${name} remains allowed`, async () => {
    const calls = [];
    for (const run of runs) calls.push(...(await recorded(run)));
    assert.ok(calls.length > 0);
    for (const call of calls) assert.equal(allowedForCall(call), true, `${call.action} ${call.resource}`);
  });
}

test('the stage resource boundaries allow the intended bucket, production CDN, and live alias', () => {
  const doc = policy();
  assert.equal(isAllowed([doc], request('s3:ListBucket', 'arn:aws:s3:::lantern-staging-assets-111122223333')), true);
  assert.equal(isAllowed([doc], request('cloudfront:CreateInvalidation', 'arn:aws:cloudfront::111122223333:distribution/E1PRODUCTIONLANTERN')), true);
  assert.equal(isAllowed([doc], request('lambda:UpdateAlias', 'arn:aws:lambda:us-east-1:111122223333:function:lantern-api-production:live')), true);
});

test('IAM user creation is not available to the deploy role', () => {
  assert.equal(isAllowed([policy()], request('iam:CreateUser', '*')), false);
});

test('attaching a policy to an admin role is denied', () => {
  assert.equal(isAllowed([policy()], request('iam:AttachRolePolicy', 'arn:aws:iam::111122223333:role/lantern-admin')), false);
});

test('passing an administrator role is denied even for Lambda', () => {
  assert.equal(isAllowed([policy()], request('iam:PassRole', 'arn:aws:iam::111122223333:role/lantern-admin', { 'iam:PassedToService': 'lambda.amazonaws.com' })), false);
});

test('passing an application role to another service is denied', () => {
  assert.equal(isAllowed([policy()], request('iam:PassRole', 'arn:aws:iam::111122223333:role/lantern-api-staging-exec', { 'iam:PassedToService': 'ec2.amazonaws.com' })), false);
});

test('deleting a stage bucket is denied', () => {
  assert.equal(isAllowed([policy()], request('s3:DeleteBucket', 'arn:aws:s3:::lantern-staging-assets-111122223333')), false);
});

test('changing a bucket policy is denied', () => {
  assert.equal(isAllowed([policy()], request('s3:PutBucketPolicy', 'arn:aws:s3:::lantern-production-assets-111122223333')), false);
});

test('updating a function outside the Lantern API names is denied', () => {
  assert.equal(isAllowed([policy()], request('lambda:UpdateFunctionCode', 'arn:aws:lambda:us-east-1:111122223333:function:other-product-api')), false);
});

test('publishing a version for another function is denied', () => {
  assert.equal(isAllowed([policy()], request('lambda:PublishVersion', 'arn:aws:lambda:us-east-1:111122223333:function:other-product-api')), false);
});

test('putting an object in another product bucket is denied', () => {
  assert.equal(isAllowed([policy()], request('s3:PutObject', 'arn:aws:s3:::other-product-assets-111122223333/site/index.html')), false);
});

test('invalidating another distribution is denied', () => {
  assert.equal(isAllowed([policy()], request('cloudfront:CreateInvalidation', 'arn:aws:cloudfront::111122223333:distribution/EOTHERPRODUCT')), false);
});

test('invalidating the staging distribution is denied because only production refreshes', () => {
  assert.equal(isAllowed([policy()], request('cloudfront:CreateInvalidation', 'arn:aws:cloudfront::111122223333:distribution/E1STAGING9LANTERN')), false);
});

test('updating an alias outside the product functions is denied', () => {
  assert.equal(isAllowed([policy()], request('lambda:UpdateAlias', 'arn:aws:lambda:us-east-1:111122223333:function:other-product-api:live')), false);
});

test('changing function configuration is not part of deployment permissions', () => {
  assert.equal(isAllowed([policy()], request('lambda:UpdateFunctionConfiguration', 'arn:aws:lambda:us-east-1:111122223333:function:lantern-api-production')), false);
});

test('the deploy policy is structurally valid', () => {
  assert.deepEqual(lint(policy()), []);
  assert.equal(evaluate([policy()], request('iam:CreateUser', '*')), 'implicit');
});
