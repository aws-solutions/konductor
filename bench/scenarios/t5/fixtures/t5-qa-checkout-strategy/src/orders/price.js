const { cents } = require('../util/money');

function lineTotal(item) {
  return item.unitPrice * item.quantity;
}

function priceOrder(items, discount = 0, taxRate = 0) {
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const discounted = subtotal - discount;
  const tax = discounted * taxRate;
  return {
    subtotal,
    discount,
    tax,
    total: discounted + tax,
    totalCents: cents(discounted + tax)
  };
}

module.exports = { lineTotal, priceOrder };
