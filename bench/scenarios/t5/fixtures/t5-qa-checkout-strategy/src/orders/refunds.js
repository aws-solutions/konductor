const { cents } = require('../util/money');

function refundAmount(order, requestedItems) {
  const originalUnits = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const requestedUnits = requestedItems.reduce((sum, line) => sum + line.quantity, 0);
  const share = requestedUnits / originalUnits;
  return cents(order.total * share / 100);
}

function refundOrder(provider, order, requestedItems) {
  const amount = refundAmount(order, requestedItems);
  return provider.refund({ orderId: order.id, amount });
}

module.exports = { refundAmount, refundOrder };
