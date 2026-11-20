'use strict';
const orders = require('../data/orders.json');
console.log(JSON.stringify({ count: orders.length, first: orders[0].id }));
