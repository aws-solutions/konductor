'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, formatSummary } = require('../src/summary');

test('summary keeps useful inventory counts', () => {
  const result = summarize({ accountId: '111122223333', region: 'us-east-2', environment: 'sandbox', functions: [1, 2], services: [1] }, 4);
  assert.deepEqual(result, { account: '111122223333', region: 'us-east-2', environment: 'sandbox', policies: 4, functions: 2, services: 1 });
  assert.match(formatSummary(result), /Policies: 4/);
});
