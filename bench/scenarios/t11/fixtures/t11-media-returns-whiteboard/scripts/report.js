'use strict';
const { readFileSync } = require('node:fs');
const orders = JSON.parse(readFileSync('data/orders.json', 'utf8'));
console.log(orders.reduce((sum, order) => sum + order.lines.length, 0) + ' order lines');
