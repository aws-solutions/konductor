'use strict';

const { saveOrder } = require('../repo/store');

async function handle(message) {
  const body = JSON.parse(message.Body);
  return saveOrder({ sku: body.sku, quantity: body.quantity, giftWrap: body.giftWrap, region: body.region });
}

module.exports = { handle };
