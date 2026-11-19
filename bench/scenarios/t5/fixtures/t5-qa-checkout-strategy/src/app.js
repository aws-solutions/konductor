const { checkout } = require('./orders/checkout');
const { InventoryRepository } = require('./inventory/repository');
const { PaymentProvider } = require('./payments/provider');

function createApp(stock = {}) {
  const inventory = new InventoryRepository(stock);
  const payments = new PaymentProvider();
  return { checkout: (input, extra = {}) => checkout(input, { inventory, payments, wait: async () => {}, ...extra }), inventory, payments };
}

module.exports = { createApp };
