'use strict';

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function lineTotal(unitPrice, quantity, discountPercent = 0) {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new RangeError('Unit price must be non-negative');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('Quantity must be a non-negative integer');
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new RangeError('Discount must be between 0 and 100 percent');
  }

  const gross = unitPrice * quantity;
  return roundMoney(gross * (1 - discountPercent / 100));
}

function stockValue(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('Items must be an array');
  }
  return roundMoney(items.reduce(
    (total, item) => total + lineTotal(item.unitPrice, item.onHand),
    0
  ));
}

module.exports = { lineTotal, stockValue };
