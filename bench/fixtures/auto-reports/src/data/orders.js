'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadOrders(dataDir) {
  const file = path.join(dataDir, 'orders.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { loadOrders };
