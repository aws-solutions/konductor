'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeCloudClient } = require('../src/fake-cloud-client');
const config = require('../src/config');

test('fake client records query resources by index', async () => {
  const client = new FakeCloudClient();
  await client.query({ TableName: config.tableName, IndexName: config.indexName });
  assert.equal(client.calls[0].action, 'dynamodb:Query');
  assert.equal(client.calls[0].resource, config.indexArn);
});

test('fake client returns upload ids', async () => {
  const client = new FakeCloudClient();
  const result = await client.createMultipartUpload({ Bucket: config.bucketName, Key: 'exports/x/data' });
  assert.equal(result.UploadId, 'upload-1');
  assert.equal(client.calls[0].resource, `${config.bucketArn}/exports/x/data`);
});
