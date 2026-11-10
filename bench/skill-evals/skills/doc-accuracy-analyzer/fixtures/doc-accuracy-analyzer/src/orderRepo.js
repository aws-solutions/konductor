'use strict';
const db = require('./db');

async function findByCustomer(customerId) {
  return db.query('SELECT * FROM orders WHERE customer_id = $1', [customerId]);
}

async function search(term) {
  return db.query("SELECT * FROM orders WHERE note LIKE '%" + term + "%'");
}

module.exports = { findByCustomer, search };
