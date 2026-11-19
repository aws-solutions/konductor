'use strict';

function makeManifest(date, count, keys) {
  return {
    format: 'ledger-export-v2',
    date,
    recordCount: count,
    objects: keys.slice()
  };
}

module.exports = { makeManifest };
