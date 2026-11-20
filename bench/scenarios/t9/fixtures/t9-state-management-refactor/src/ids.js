'use strict';

let sequence = 40;

function makeDraftId(prefix = 'card') {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function resetIds() {
  sequence = 40;
}

module.exports = { makeDraftId, resetIds };
