'use strict';

const { transferLines } = require('./journal');

function transfer(store, input, now = new Date().toISOString()) {
  if (store.hasTransfer(input.clientKey)) return store.getTransfer(input.clientKey);
  const transferId = `tr_${input.clientKey}`;
  const lines = transferLines({ ...input, transferId, amountMinor: input.amountMinor, createdAt: now });
  return store.withTransaction(() => {
    if (store.hasTransfer(input.clientKey)) return store.getTransfer(input.clientKey);
    const from = store.getAccount(input.fromAccountId);
    const to = store.getAccount(input.toAccountId);
    if (!from || !to) throw new Error('account not found');
    if (from.balanceMinor < input.amountMinor) throw new Error('insufficient funds');
    from.balanceMinor -= input.amountMinor;
    to.balanceMinor += input.amountMinor;
    for (const line of lines) store.appendJournal(line);
    const result = { id: transferId, clientKey: input.clientKey, amountMinor: input.amountMinor };
    store.recordTransfer(result);
    return result;
  });
}

module.exports = { transfer };
