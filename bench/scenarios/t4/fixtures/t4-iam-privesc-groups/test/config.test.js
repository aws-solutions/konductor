'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('account configuration has the inventory used by the docs', () => {
  const account = JSON.parse(fs.readFileSync('config/account.json', 'utf8'));
  assert.equal(account.accountId, '111122223333');
  assert.equal(account.functions.length, 2);
  assert.equal(account.services.length, 2);
  assert.equal(account.analyticsBucket, 'arn:aws:s3:::analytics-lake-111122223333');
});
