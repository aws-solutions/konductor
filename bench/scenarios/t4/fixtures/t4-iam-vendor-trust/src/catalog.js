'use strict';

const { readJson } = require('../scripts/read-config');

function integrationNames() {
  return Object.keys(readJson('accounts.json').integrations);
}

function accountFor(name) {
  const entry = readJson('accounts.json').integrations[name];
  return entry ? entry.accountId : undefined;
}

module.exports = { integrationNames, accountFor };
