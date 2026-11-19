'use strict';

const { CartStore } = require('../src/store');

function demoCart() {
  const store = new CartStore();
  store.addItem('demo', { sku: 'mug-blue', unitPriceCents: 1299, quantity: 1 });
  return store.getCart('demo');
}

if (require.main === module) console.log(JSON.stringify(demoCart(), null, 2));
module.exports = { demoCart };
