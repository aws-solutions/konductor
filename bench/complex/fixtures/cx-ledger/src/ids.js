'use strict';

// Correlation ids for log lines only. They are not secrets, so Math.random is fine here.
function newCorrelationId() {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

module.exports = { newCorrelationId };
