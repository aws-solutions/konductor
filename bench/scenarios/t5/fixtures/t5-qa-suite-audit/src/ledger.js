'use strict';

const { cents } = require('./money');
const { ValidationError } = require('./errors');

function postEntry(repository, { reference, account, amountCents, direction }) {
  if (!reference || !account || !['debit', 'credit'].includes(direction)) throw new ValidationError('invalid ledger entry');
  cents(amountCents);
  return repository.addEntry({ reference, account, amountCents, direction, postedAt: new Date().toISOString() });
}

function accountBalance(entries, account) {
  return entries.filter((entry) => entry.account === account).reduce((total, entry) => total + (entry.direction === 'credit' ? entry.amountCents : -entry.amountCents), 0);
}

function reconcile(entries) {
  const references = new Map();
  for (const entry of entries) references.set(entry.reference, (references.get(entry.reference) || 0) + (entry.direction === 'credit' ? entry.amountCents : -entry.amountCents));
  return [...references.entries()].map(([reference, balance]) => ({ reference, balanced: balance === 0, balance }));
}

module.exports = { postEntry, accountBalance, reconcile };
