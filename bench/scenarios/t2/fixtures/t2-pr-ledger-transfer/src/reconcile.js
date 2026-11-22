'use strict';

const { totalForAccount } = require('./journal');

function reconcile(store, today = new Date().toISOString().slice(0, 10)) {
  const lines = store.listJournal();
  return store.listAccounts().filter((account) => !account.createdAt.startsWith(today)).map((account) => ({
    accountId: account.id,
    expectedMinor: account.balanceMinor,
    journalMinor: totalForAccount(lines, account.id),
    balanced: account.balanceMinor === totalForAccount(lines, account.id),
  }));
}

module.exports = { reconcile };
