'use strict';

const orders = require('../data/sample-orders.json');
for (const order of orders) console.log(`sample ${order.id}`);
