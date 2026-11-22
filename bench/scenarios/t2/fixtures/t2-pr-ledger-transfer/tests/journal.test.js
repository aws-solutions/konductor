'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { transferLines, totalForAccount } = require('../src/journal');

test('transfer lines balance to zero', () => {
  const lines = transferLines({ transferId: 'tr_x', fromAccountId: 'acct_a', toAccountId: 'acct_b', amountMinor: 125, createdAt: '2025-01-01T00:00:00.000Z' });
  assert.equal(lines.reduce((sum, line) => sum + line.amountMinor, 0), 0);
  assert.equal(totalForAccount(lines, 'acct_a'), -125);
});
