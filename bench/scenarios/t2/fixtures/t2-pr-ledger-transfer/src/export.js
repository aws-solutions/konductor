'use strict';

function exportAccount(store, accountId) {
  const account = store.getAccount(accountId);
  if (!account) throw new Error('account not found');
  return JSON.stringify({ ...account, journal: store.listJournal().filter((line) => line.accountId === accountId) }, null, 2);
}

module.exports = { exportAccount };
