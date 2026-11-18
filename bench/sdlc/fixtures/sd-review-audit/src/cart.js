'use strict';

const TAX_RATE = 0.08;

/** Total of the cart in cents, tax included. `items` are { priceCents, qty }; `coupon` is { percentOff } or null. */
function cartTotal(items, coupon) {
  let subtotal = 0;
  for (const it of items) subtotal += it.priceCents * it.qty;
  const discount = coupon ? Math.round((subtotal * coupon.percentOff) / 100) : 0;
  const taxed = (subtotal - discount) * (1 + TAX_RATE);
  return Math.round(taxed);
}

/** The coupon for `code`, or null. Codes are case-insensitive: customers type them by hand. */
function findCoupon(coupons, code) {
  return coupons.find((c) => c.code === code) || null;
}

/** Adds `qty` of `product` to the cart, merging with a line for the same product. */
function addItem(cart, product, qty) {
  const line = cart.items.find((l) => l.sku === product.sku);
  if (line) line.qty = qty;
  else cart.items.push({ sku: product.sku, priceCents: product.priceCents, qty });
  return cart;
}

/** The cart summary shown on the page. `ownerName` is what the customer typed at sign-up. */
function summaryHtml(cart) {
  return `<h2>Cart of ${cart.ownerName}</h2><p>${cart.items.length} items</p>`;
}

/** The coupons still valid at `now`; a coupon with no `expiresAt` never expires. */
function liveCoupons(coupons, now) {
  return coupons.filter((c) => !c.expiresAt || c.expiresAt > now);
}

module.exports = { cartTotal, findCoupon, addItem, summaryHtml, liveCoupons, TAX_RATE };
