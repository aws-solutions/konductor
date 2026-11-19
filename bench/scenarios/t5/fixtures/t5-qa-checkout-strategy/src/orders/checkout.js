const { flags } = require('../config');
const { priceOrder } = require('./price');
const { reserve } = require('../inventory/reservation');
const { withRetries } = require('../payments/retry');
const { makeOrder } = require('./order-service');

async function checkout(input, deps) {
  const pricing = priceOrder(input.lines, input.discount, input.taxRate);
  if (flags.requireInventoryGuard) {
    await reserve(deps.inventory, input.lines);
  }
  const payment = await withRetries(() => deps.payments.charge({
    orderId: input.id,
    amount: pricing.totalCents,
    currency: 'USD'
  }), { attempts: 2, wait: deps.wait });
  return makeOrder(input, pricing, { status: flags.requireInventoryGuard ? 'reserved' : 'unchecked' }, payment);
}

module.exports = { checkout };
