const { settlement } = require('../config');

function cutoffFor(day = new Date()) {
  const cutoff = new Date(day);
  cutoff.setHours(settlement.cutoffHour, settlement.cutoffMinute, 0, 0);
  return cutoff;
}

function eligibleTransactions(transactions, now = new Date()) {
  const cutoff = cutoffFor(now);
  return transactions.filter((transaction) => new Date(transaction.createdAt) <= cutoff && transaction.status === 'succeeded');
}

if (require.main === module) {
  process.stdout.write(`settlement cutoff ${cutoffFor().toISOString()}\n`);
}

module.exports = { cutoffFor, eligibleTransactions };
