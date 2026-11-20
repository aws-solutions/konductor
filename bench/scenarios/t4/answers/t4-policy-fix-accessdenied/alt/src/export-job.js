// Changes for this request; see the commit message for the reasoning.
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
  const encryption = {
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: config.kmsKeyId
  };
  const snapshotKey = objectKey(config.prefix, date, 'ledger.json');
  await client.putObject({
    Bucket: config.bucketName,
    Key: snapshotKey,
    Body: JSON.stringify({ date, items }),
    ...encryption
  });

  const dataKey = objectKey(config.prefix, date, 'ledger.ndjson');
  const manifest = makeManifest(date, items.length, [snapshotKey, dataKey]);
  const upload = await client.createMultipartUpload({
    Bucket: config.bucketName,
    Key: dataKey,
    ...encryption
  });
  const body = jsonLines(items);
  const part = await client.uploadPart({
    Bucket: config.bucketName,
    Key: dataKey,
    UploadId: upload.UploadId,
    PartNumber: 1,
    Body: body,
    ...encryption
  });
  await client.completeMultipartUpload({
    Bucket: config.bucketName,
    Key: dataKey,
    UploadId: upload.UploadId,
    MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag }] },
    ...encryption
  });
  return { date, items: items.length, manifest };
}

module.exports = { runExport };
