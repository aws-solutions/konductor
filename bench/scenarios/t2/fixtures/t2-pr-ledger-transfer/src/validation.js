'use strict';

function requireClientKey(value) {
  if (typeof value !== 'string' || !value.startsWith('client_')) throw new Error('client key is invalid');
  return value;
}

function requireAccountId(value) {
  if (typeof value !== 'string' || !value.startsWith('acct_')) throw new Error('account id is invalid');
  return value;
}

module.exports = { requireClientKey, requireAccountId };
