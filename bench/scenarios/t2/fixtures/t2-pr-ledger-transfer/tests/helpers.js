'use strict';

function fixedAccounts() {
  return [
    { id: 'acct_a', balanceMinor: 1000, createdAt: '2025-01-01T00:00:00.000Z' },
    { id: 'acct_b', balanceMinor: 0, createdAt: '2025-01-01T00:00:00.000Z' },
  ];
}

module.exports = { fixedAccounts };
