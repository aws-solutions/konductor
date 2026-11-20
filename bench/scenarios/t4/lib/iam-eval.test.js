// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, isAllowed, decide, lint, inCidr } = require('../../lib/hidden/iam-eval.js');

const doc = (...Statement) => ({ Version: '2012-10-17', Statement });
const ACCT = '111122223333';

test('explicit deny beats allow, and nothing matching is an implicit deny', () => {
  const p = doc({ Effect: 'Allow', Action: 's3:*', Resource: '*' }, { Effect: 'Deny', Action: 's3:DeleteBucket', Resource: '*' });
  assert.equal(evaluate([p], { action: 's3:GetObject', resource: 'arn:aws:s3:::b/k' }), 'allow');
  assert.equal(evaluate([p], { action: 's3:DeleteBucket', resource: 'arn:aws:s3:::b' }), 'deny');
  assert.equal(evaluate([p], { action: 'ec2:RunInstances', resource: '*' }), 'implicit');
});

test('actions match case-insensitively with wildcards; resources are case-sensitive globs', () => {
  const p = doc({ Effect: 'Allow', Action: ['S3:Get*', 'dynamodb:?etItem'], Resource: ['arn:aws:s3:::logs/*', 'arn:aws:dynamodb:*:*:table/Orders'] });
  assert.ok(isAllowed([p], { action: 's3:getobject', resource: 'arn:aws:s3:::logs/a.txt' }));
  assert.ok(!isAllowed([p], { action: 's3:GetObject', resource: 'arn:aws:s3:::Logs/a.txt' }));
  assert.ok(isAllowed([p], { action: 'dynamodb:GetItem', resource: 'arn:aws:dynamodb:us-east-1:1:table/Orders' }));
  assert.ok(!isAllowed([p], { action: 'dynamodb:BatchGetItem', resource: 'arn:aws:dynamodb:us-east-1:1:table/Orders' }));
});

test('NotAction and NotResource', () => {
  const p = doc({ Effect: 'Allow', NotAction: 'iam:*', NotResource: 'arn:aws:s3:::secret/*' });
  assert.ok(isAllowed([p], { action: 's3:GetObject', resource: 'arn:aws:s3:::pub/x' }));
  assert.ok(!isAllowed([p], { action: 'iam:CreateUser', resource: '*' }));
  assert.ok(!isAllowed([p], { action: 's3:GetObject', resource: 'arn:aws:s3:::secret/x' }));
});

test('principals: account id and :root match any principal of that account; service principals', () => {
  const trust = doc(
    { Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:root` }, Action: 'sts:AssumeRole' },
    { Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' },
  );
  assert.ok(isAllowed([trust], { action: 'sts:AssumeRole', principal: { AWS: `arn:aws:iam::${ACCT}:role/ci` } }));
  assert.ok(!isAllowed([trust], { action: 'sts:AssumeRole', principal: { AWS: 'arn:aws:iam::999988887777:role/ci' } }));
  assert.ok(isAllowed([trust], { action: 'sts:AssumeRole', principal: { Service: 'lambda.amazonaws.com' } }));
  assert.ok(!isAllowed([trust], { action: 'sts:AssumeRole', principal: { Service: 'ec2.amazonaws.com' } }));
});

test('string, bool and missing keys; negated operators are true when the key is missing', () => {
  const p = doc(
    { Effect: 'Allow', Action: 's3:GetObject', Resource: '*', Condition: { StringEquals: { 'aws:PrincipalTag/team': ['a', 'b'] } } },
    { Effect: 'Deny', Action: 's3:*', Resource: '*', Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
  );
  assert.ok(isAllowed([p], { action: 's3:GetObject', resource: 'x', context: { 'aws:PrincipalTag/team': 'b', 'aws:SecureTransport': 'true' } }));
  assert.ok(!isAllowed([p], { action: 's3:GetObject', resource: 'x', context: { 'aws:PrincipalTag/team': 'b', 'aws:SecureTransport': 'false' } }));
  assert.ok(!isAllowed([p], { action: 's3:GetObject', resource: 'x', context: { 'aws:SecureTransport': 'true' } }));
  const neg = doc({ Effect: 'Deny', Action: '*', Resource: '*', Condition: { StringNotEquals: { 'aws:RequestedRegion': 'us-east-1' } } });
  assert.equal(evaluate([neg], { action: 's3:GetObject', resource: 'x' }), 'deny');
});

test('IfExists, Null, ForAnyValue and ForAllValues', () => {
  const ie = doc({ Effect: 'Allow', Action: 'ec2:RunInstances', Resource: '*', Condition: { StringEqualsIfExists: { 'ec2:InstanceType': 't3.micro' } } });
  assert.ok(isAllowed([ie], { action: 'ec2:RunInstances', resource: '*' }));
  assert.ok(!isAllowed([ie], { action: 'ec2:RunInstances', resource: '*', context: { 'ec2:InstanceType': 'm5.large' } }));
  const nul = doc({ Effect: 'Deny', Action: '*', Resource: '*', Condition: { Null: { 'aws:MultiFactorAuthAge': 'true' } } });
  assert.equal(evaluate([nul], { action: 'iam:ListUsers', resource: '*' }), 'deny');
  assert.equal(evaluate([nul], { action: 'iam:ListUsers', resource: '*', context: { 'aws:MultiFactorAuthAge': '30' } }), 'implicit');
  const any = doc({ Effect: 'Allow', Action: 'x:Y', Resource: '*', Condition: { 'ForAnyValue:StringEquals': { 'aws:TagKeys': ['env'] } } });
  assert.ok(isAllowed([any], { action: 'x:Y', resource: '*', context: { 'aws:TagKeys': ['owner', 'env'] } }));
  assert.ok(!isAllowed([any], { action: 'x:Y', resource: '*' }));
  const all = doc({ Effect: 'Allow', Action: 'x:Y', Resource: '*', Condition: { 'ForAllValues:StringEquals': { 'aws:TagKeys': ['env', 'owner'] } } });
  assert.ok(isAllowed([all], { action: 'x:Y', resource: '*', context: { 'aws:TagKeys': ['owner'] } }));
  assert.ok(!isAllowed([all], { action: 'x:Y', resource: '*', context: { 'aws:TagKeys': ['owner', 'cost'] } }));
});

test('ARN, numeric, date and IP operators', () => {
  const p = doc({
    Effect: 'Allow', Action: 's3:GetObject', Resource: '*',
    Condition: {
      ArnLike: { 'aws:SourceArn': 'arn:aws:cloudfront::111122223333:distribution/*' },
      NumericLessThan: { 'aws:MultiFactorAuthAge': '3600' },
      DateGreaterThan: { 'aws:CurrentTime': '2026-01-01T00:00:00Z' },
      IpAddress: { 'aws:SourceIp': ['10.0.0.0/8'] },
    },
  });
  const ok = { 'aws:SourceArn': 'arn:aws:cloudfront::111122223333:distribution/E1', 'aws:MultiFactorAuthAge': '60', 'aws:CurrentTime': '2026-11-19T00:00:00Z', 'aws:SourceIp': '10.2.3.4' };
  assert.ok(isAllowed([p], { action: 's3:GetObject', resource: 'r', context: ok }));
  assert.ok(!isAllowed([p], { action: 's3:GetObject', resource: 'r', context: { ...ok, 'aws:SourceIp': '192.168.1.1' } }));
  assert.ok(!isAllowed([p], { action: 's3:GetObject', resource: 'r', context: { ...ok, 'aws:MultiFactorAuthAge': '7200' } }));
  assert.ok(inCidr('203.0.113.9', '203.0.113.0/24') && !inCidr('203.0.114.9', '203.0.113.0/24') && inCidr('1.2.3.4', '0.0.0.0/0'));
});

test('policy variables in resources and condition values; a missing variable matches nothing', () => {
  const p = doc(
    { Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::home/${aws:username}/*' },
    { Effect: 'Allow', Action: 'dynamodb:Query', Resource: '*', Condition: { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['${aws:PrincipalTag/tenant}'] } } },
  );
  assert.ok(isAllowed([p], { action: 's3:GetObject', resource: 'arn:aws:s3:::home/ana/f', context: { 'aws:username': 'ana' } }));
  assert.ok(!isAllowed([p], { action: 's3:GetObject', resource: 'arn:aws:s3:::home/bo/f', context: { 'aws:username': 'ana' } }));
  assert.ok(!isAllowed([p], { action: 's3:GetObject', resource: 'arn:aws:s3:::home//f' }));
  assert.ok(isAllowed([p], { action: 'dynamodb:Query', resource: 't', context: { 'aws:PrincipalTag/tenant': 't1', 'dynamodb:LeadingKeys': ['t1'] } }));
  assert.ok(!isAllowed([p], { action: 'dynamodb:Query', resource: 't', context: { 'aws:PrincipalTag/tenant': 't1', 'dynamodb:LeadingKeys': ['t2'] } }));
});

test('decide: boundary and scp must also allow; a deny anywhere wins; resource policy alone can allow', () => {
  const id = doc({ Effect: 'Allow', Action: '*', Resource: '*' });
  const boundary = doc({ Effect: 'Allow', Action: 's3:*', Resource: '*' });
  const bucket = doc({ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:role/r` }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::b/*' });
  const req = { action: 's3:GetObject', resource: 'arn:aws:s3:::b/k', principal: { AWS: `arn:aws:iam::${ACCT}:role/r` } };
  assert.ok(decide({ identity: [id], boundary: [boundary] }, req));
  assert.ok(!decide({ identity: [id], boundary: [boundary] }, { action: 'iam:CreateUser', resource: '*' }));
  assert.ok(decide({ resource: [bucket] }, req));
  assert.ok(!decide({ identity: [id], scp: [doc({ Effect: 'Deny', Action: 's3:*', Resource: '*' })] }, req));
});

test('lint flags structural problems and unknown operators; evaluate throws on them', () => {
  assert.deepEqual(lint(doc({ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' })), []);
  assert.ok(lint({ Statement: [] }).length >= 2);
  assert.ok(lint('{bad').length === 1);
  const bad = doc({ Effect: 'Allow', Action: 'a:b', Resource: '*', Condition: { StringMaybe: { k: 'v' } } });
  assert.ok(lint(bad).some((p) => /unsupported/.test(p)));
  assert.throws(() => evaluate([bad], { action: 'a:b', resource: 'x' }), /unsupported/);
});

test('${*}, ${?} and ${$} are literal characters, not wildcards, in resources and conditions', () => {
  // A deny on a literal "*" tenant (an escaped value) must not match every tenant (the t4-arch-tenant-abac bug).
  const deny = doc(
    { Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::data/*' },
    { Effect: 'Deny', Action: 's3:GetObject', Resource: 'arn:aws:s3:::data/${*}/*' },
    { Effect: 'Deny', Action: 's3:GetObject', Resource: '*', Condition: { StringLike: { 'aws:PrincipalTag/tenant': 'a${?}c' } } },
  );
  assert.equal(evaluate([deny], { action: 's3:GetObject', resource: 'arn:aws:s3:::data/t1/k' }), 'allow');
  assert.equal(evaluate([deny], { action: 's3:GetObject', resource: 'arn:aws:s3:::data/*/k' }), 'deny');
  assert.equal(evaluate([deny], { action: 's3:GetObject', resource: 'arn:aws:s3:::data/t1/k', context: { 'aws:PrincipalTag/tenant': 'abc' } }), 'allow');
  assert.equal(evaluate([deny], { action: 's3:GetObject', resource: 'arn:aws:s3:::data/t1/k', context: { 'aws:PrincipalTag/tenant': 'a?c' } }), 'deny');
  const eq = doc({ Effect: 'Allow', Action: 'x:Y', Resource: '*', Condition: { StringEquals: { 'k': 'cost$${$}' } } });
  assert.ok(isAllowed([eq], { action: 'x:Y', resource: '*', context: { k: 'cost$$' } }));
});
