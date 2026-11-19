'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decide, lint } = require('./iam-eval.js');
const config = require('../src/config');
const { FakeCloudClient } = require('../src/fake-cloud-client');
const { runExport } = require('../src/export-job');

const identity = () => JSON.parse(fs.readFileSync(path.join('infra', 'iam', 'export-job-policy.json')));
const bucket = () => JSON.parse(fs.readFileSync(path.join('infra', 'iam', 'exports-bucket-policy.json')));
const key = () => JSON.parse(fs.readFileSync(path.join('infra', 'iam', 'exports-key-policy.json')));
const principal = { AWS: config.roleArn };
const keyContext = {
  's3:x-amz-server-side-encryption': 'aws:kms',
  's3:x-amz-server-side-encryption-aws-kms-key-id': config.kmsKeyId
};
const object = (name = 'ledger.json') => `${config.bucketArn}/exports/2025-02-03/${name}`;
const s3 = (action, resource = object(), context = keyContext) => ({ action, resource, principal, context });
const ddb = (resource) => ({ action: 'dynamodb:Query', resource, principal, context: {} });
const kms = (action, resource = config.kmsKeyArn) => ({ action, resource, principal, context: {} });
const layers = (req) => {
  if (req.action.startsWith('s3:')) return { identity: [identity()], resource: [bucket()] };
  if (req.action.startsWith('kms:')) return { identity: [identity()], resource: [key()] };
  return { identity: [identity()] };
};
const allowed = (req) => decide(layers(req), req);

for (const [name, load] of [
  ['identity policy', identity],
  ['bucket policy', bucket],
  ['key policy', key]
]) {
  test(`${name} has a valid shape`, () => assert.deepEqual(lint(load()), []));
}

test('a normal export object write is allowed with the configured key', () => {
  assert.equal(allowed(s3('s3:PutObject')), true);
});

test('multipart part upload is allowed under the export prefix', () => {
  assert.equal(allowed(s3('s3:UploadPart', object('ledger.ndjson'))), true);
});

test('the source index query is allowed', () => {
  assert.equal(allowed(ddb(config.indexArn)), true);
});

test('a query against the base source table remains allowed', () => {
  assert.equal(allowed(ddb(config.tableArn)), true);
});

test('the worker can generate data keys only for the export key', () => {
  assert.equal(allowed(kms('kms:GenerateDataKey')), true);
});

test('the multipart worker can decrypt only with the export key', () => {
  assert.equal(allowed(kms('kms:Decrypt')), true);
});

test('a second dated object in the prefix is allowed', () => {
  assert.equal(allowed(s3('s3:PutObject', `${config.bucketArn}/exports/2025-02-04/ledger.json`)), true);
});

test('a second dated multipart part is allowed', () => {
  assert.equal(allowed(s3('s3:UploadPart', `${config.bucketArn}/exports/2025-02-04/ledger.ndjson`)), true);
});

test('the index ARN is allowed when supplied with a normal query context', () => {
  assert.equal(allowed({ ...ddb(config.indexArn), context: { 'dynamodb:LeadingKeys': ['2025-02-03'] } }), true);
});

test('data-key generation remains allowed with a service context', () => {
  assert.equal(allowed({ ...kms('kms:GenerateDataKey'), context: { 'kms:ViaService': 's3.us-test-1.amazonaws.com' } }), true);
});

test('decrypt is allowed for the configured key during multipart work', () => {
  assert.equal(allowed({ ...kms('kms:Decrypt'), context: { 'kms:EncryptionContext:aws:s3:arn': object('ledger.ndjson') } }), true);
});

test('multipart creation uses the PutObject permission on the export object', () => {
  assert.equal(allowed(s3('s3:PutObject', object('ledger.ndjson'))), true);
});

test('multipart completion uses the PutObject permission on the export object', () => {
  assert.equal(allowed(s3('s3:PutObject', object('ledger.ndjson'), keyContext)), true);
});

test('a nested export object remains inside the permitted prefix', () => {
  assert.equal(allowed(s3('s3:PutObject', `${config.bucketArn}/exports/2025-02-03/archive/part-1`)), true);
});

test('the fake job finishes and every recorded request is authorized', async () => {
  const client = new FakeCloudClient();
  await runExport(client, { date: '2025-02-03' });
  assert.ok(client.calls.length >= 5);
  for (const call of client.calls) {
    assert.equal(allowed({ ...call, principal }), true, `${call.action} ${call.resource}`);
  }
});

test('every object upload sends the configured KMS key id', async () => {
  const client = new FakeCloudClient();
  await runExport(client, { date: '2025-02-03' });
  const uploads = client.calls.filter((call) => call.action === 's3:PutObject' || call.action === 's3:UploadPart');
  assert.ok(uploads.length >= 4);
  for (const call of uploads) {
    assert.equal(call.context['s3:x-amz-server-side-encryption-aws-kms-key-id'], config.kmsKeyId);
    assert.equal(call.request.SSEKMSKeyId, config.kmsKeyId);
  }
});

test('a write outside exports is denied', () => {
  assert.equal(allowed(s3('s3:PutObject', `${config.bucketArn}/incoming/ledger.json`)), false);
});

test('object deletion is denied', () => {
  assert.equal(allowed(s3('s3:DeleteObject')), false);
});

test('bucket policy changes are denied', () => {
  assert.equal(allowed({ action: 's3:PutBucketPolicy', resource: config.bucketArn, principal, context: {} }), false);
});

test('a query against another table is denied', () => {
  assert.equal(allowed(ddb('arn:aws:dynamodb:us-test-1:111122223333:table/OtherRecords')), false);
});

test('decrypt on another key is denied', () => {
  assert.equal(allowed(kms('kms:Decrypt', 'arn:aws:kms:us-test-1:111122223333:key/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')), false);
});

test('data-key generation on another key is denied', () => {
  assert.equal(allowed(kms('kms:GenerateDataKey', 'arn:aws:kms:us-test-1:111122223333:key/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')), false);
});

test('an upload without a KMS key id is denied', () => {
  assert.equal(allowed(s3('s3:PutObject', object(), { 's3:x-amz-server-side-encryption': 'aws:kms' })), false);
});

test('an upload naming a different KMS key is denied', () => {
  assert.equal(allowed(s3('s3:PutObject', object(), {
    's3:x-amz-server-side-encryption': 'aws:kms',
    's3:x-amz-server-side-encryption-aws-kms-key-id': 'arn:aws:kms:us-test-1:111122223333:key/cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  })), false);
});

test('multipart upload outside exports is denied', () => {
  assert.equal(allowed(s3('s3:UploadPart', `${config.bucketArn}/archive/part-1`)), false);
});

test('an object write to another bucket is denied', () => {
  assert.equal(allowed(s3('s3:PutObject', 'arn:aws:s3:::another-bucket/exports/2025-02-03/file')), false);
});

test('a table index from another table is denied', () => {
  assert.equal(allowed(ddb('arn:aws:dynamodb:us-test-1:111122223333:table/OtherRecords/index/by_day')), false);
});

test('a different region table is denied', () => {
  assert.equal(allowed(ddb('arn:aws:dynamodb:us-test-2:111122223333:table/LedgerRecords')), false);
});

test('an unconfigured KMS action is denied', () => {
  assert.equal(allowed(kms('kms:ScheduleKeyDeletion')), false);
});

test('reading an object is denied', () => {
  assert.equal(allowed(s3('s3:GetObject')), false);
});

test('listing the destination bucket is denied', () => {
  assert.equal(allowed({ action: 's3:ListBucket', resource: config.bucketArn, principal, context: {} }), false);
});

test('changing the destination encryption configuration is denied', () => {
  assert.equal(allowed({ action: 's3:PutEncryptionConfiguration', resource: config.bucketArn, principal, context: {} }), false);
});

