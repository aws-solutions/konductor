'use strict';

const path = require('node:path');
const { readJson } = require('./store');

const file = (dataDir) => path.join(dataDir, 'customers.json');

function listCustomers(dataDir) {
  return readJson(file(dataDir), []);
}

function getCustomer(dataDir, id) {
  return listCustomers(dataDir).find((c) => c.id === id) ?? null;
}

module.exports = { listCustomers, getCustomer };
