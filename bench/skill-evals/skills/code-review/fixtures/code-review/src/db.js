'use strict';

// In-memory stand-in for the wallet table. get/put have the same shape as the real client.
const store = new Map([['w1', { balance: 100 }]]);

async function get(id) {
  return store.get(id);
}

async function put(id, item) {
  store.set(id, item);
}

// Conditional write: only applies when the stored balance still equals expectedBalance.
async function putIf(id, item, expectedBalance) {
  const cur = store.get(id);
  if (!cur || cur.balance !== expectedBalance) {
    const err = new Error('ConditionalCheckFailed');
    err.code = 'ConditionalCheckFailed';
    throw err;
  }
  store.set(id, item);
}

module.exports = { get, put, putIf };
