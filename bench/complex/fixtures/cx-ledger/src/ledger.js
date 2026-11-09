'use strict';

function createLedger(initial = {}) {
  const balances = new Map(Object.entries(initial));

  function balance(id) {
    if (!balances.has(id)) throw new Error(`unknown account: ${id}`);
    return balances.get(id);
  }

  function total() {
    return [...balances.values()].reduce((sum, v) => sum + v, 0);
  }

  function transfer(from, to, cents) {
    if (!Number.isInteger(cents) || cents <= 0) throw new Error('amount must be a positive integer');
    const available = balance(from);
    if (available < cents) throw new Error('insufficient funds');
    balances.set(from, available - cents);
    balances.set(to, balance(to) + cents);
    return { from, to, cents };
  }

  return { balance, total, transfer };
}

module.exports = { createLedger };
