'use strict';

function lineFor({ transferId, accountId, amountMinor, kind, createdAt }) {
  if (!Number.isInteger(amountMinor)) throw new Error('journal amounts must be integers');
  return { transferId, accountId, amountMinor, kind, createdAt };
}

function totalForAccount(lines, accountId) {
  return lines.filter((line) => line.accountId === accountId)
    .reduce((sum, line) => sum + line.amountMinor, 0);
}

function transferLines({ transferId, fromAccountId, toAccountId, amountMinor, createdAt }) {
  if (amountMinor <= 0) throw new Error('transfer amount must be positive');
  return [
    lineFor({ transferId, accountId: fromAccountId, amountMinor: -amountMinor, kind: 'debit', createdAt }),
    lineFor({ transferId, accountId: toAccountId, amountMinor, kind: 'credit', createdAt }),
  ];
}

module.exports = { lineFor, totalForAccount, transferLines };
