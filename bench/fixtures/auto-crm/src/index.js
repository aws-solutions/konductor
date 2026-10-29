'use strict';

const { listCustomers, getCustomer } = require('./customers');
const { ordersFor } = require('./orders');
const { normalizeEmail } = require('./normalize');
const { readJson, writeJson } = require('./store');

module.exports = { listCustomers, getCustomer, ordersFor, normalizeEmail, readJson, writeJson };
