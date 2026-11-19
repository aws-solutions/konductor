const { summarize } = require('../summary');

function makeSummary(rows) {
  return summarize(rows, ['orders', 'revenue']);
}

module.exports = { makeSummary };
