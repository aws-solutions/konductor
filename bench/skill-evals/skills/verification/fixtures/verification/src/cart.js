'use strict';

function subtotal(items) {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function totalForUS(items) {
  const sub = subtotal(items);
  const tax = Math.round(sub * 0.08 * 100) / 100;
  return Math.round((sub + tax) * 100) / 100;
}

function totalForUSWithDiscount(items, discount) {
  const sub = subtotal(items) - discount;
  const tax = Math.round(sub * 0.08 * 100) / 100;
  return Math.round((sub + tax) * 100) / 100;
}

module.exports = { subtotal, totalForUS, totalForUSWithDiscount };
