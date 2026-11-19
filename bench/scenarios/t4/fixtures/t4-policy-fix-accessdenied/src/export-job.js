'use strict';

const config = require('./config');
const { datePart, objectKey, jsonLines } = require('./format');
const { makeManifest } = require('./manifest');
const { withRetry } = require('./retry');

async function runExport(client, options = {}) {
  const date = datePart(options.date || new Date().toISOString().slice(0, 10));
  const result = await withRetry(() => client.query({
    TableName: config.tableName,
    IndexName: config.indexName,
    KeyConditionExpression: '#day = :day',
    ExpressionAttributeNames: { '#day': 'day' },
    ExpressionAttributeValues: { ':day': date }
  }));
  const items = result.Items || [];
  const snapshotKey = objectKey(config.prefix, date, 'ledger.json');
  await client.putObject({
    Bucket: config.bucketName,
    Key: snapshotKey,
    Body: JSON.stringify({ date, items }),
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: config.kmsKeyId
  });

  const dataKey = objectKey(config.prefix, date, 'ledger.ndjson');
  const manifest = makeManifest(date, items.length, [snapshotKey, dataKey]);
  const upload = await client.createMultipartUpload({
    Bucket: config.bucketName,
    Key: dataKey,
    ServerSideEncryption: 'aws:kms'
  });
  const body = jsonLines(items);
  const part = await client.uploadPart({
    Bucket: config.bucketName,
    Key: dataKey,
    UploadId: upload.UploadId,
    PartNumber: 1,
    Body: body,
    SSEKMSKeyId: config.kmsKeyId
  });
  await client.completeMultipartUpload({
    Bucket: config.bucketName,
    Key: dataKey,
    UploadId: upload.UploadId,
    MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag }] }
  });
  return { date, items: items.length, manifest };
}

module.exports = { runExport };
