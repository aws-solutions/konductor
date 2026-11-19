'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');

test('configuration has the export identity', () => {
  assert.equal(config.accountId, '111122223333');
  assert.equal(config.bucketName, 'nightly-exports-example');
  assert.equal(config.prefix, 'exports/');
  assert.equal(config.indexName, 'by_day');
  assert.match(config.kmsKeyId, /^arn:aws:kms:/);
});
