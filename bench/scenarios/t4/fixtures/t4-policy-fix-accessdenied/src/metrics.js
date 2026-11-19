'use strict';

function summarize(calls) {
  return calls.reduce((summary, call) => {
    summary[call.action] = (summary[call.action] || 0) + 1;
    return summary;
  }, {});
}

module.exports = { summarize };
