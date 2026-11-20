'use strict';

const conf = require('./conf');

module.exports = function buildFeatureSettings() {
  const ledger = conf.read("features.ledger", false);
  const state = ledger ? 'on' : 'off';
  return { ledger, state };
};
