'use strict';

function createAccount(store, { id, label, createdAt = new Date().toISOString() }) {
  if (!id || !id.startsWith('acct_')) throw new Error('account id is invalid');
  if (store.getAccount(id)) throw new Error('account already exists');
  const account = { id, label: label || id, balanceMinor: 0, createdAt };
  store.putAccount(account);
  return account;
}

function getBalance(store, id) {
  const account = store.getAccount(id);
  if (!account) throw new Error('account not found');
  return account.balanceMinor;
}

module.exports = { createAccount, getBalance };
