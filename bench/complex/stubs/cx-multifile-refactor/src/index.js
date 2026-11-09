'use strict';

const { normalizeAddress } = require('./address');
const { lookupZone } = require('./zones');
const { carriers, priceWith } = require('./rates');

function orderWeight(items) {
  const kg = items.reduce((sum, item) => sum + item.weightKg * (item.qty == null ? 1 : item.qty), 0);
  if (!(kg > 0)) throw new Error('order weight must be positive');
  return Math.round(kg * 1000) / 1000;
}

function listCarriers() {
  return carriers.map((c) => c.id);
}

function quote(order) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) throw new Error('order has no items');
  const to = normalizeAddress(order.to);
  const weightKg = orderWeight(order.items);
  const zone = lookupZone(to.zip);
  let pool = carriers;
  if (order.carrier != null) {
    pool = carriers.filter((c) => c.id === order.carrier);
    if (pool.length === 0) throw new Error(`unknown carrier: ${order.carrier}`);
  }
  const options = pool
    .filter((c) => c.available(weightKg, to.country))
    .map((c) => priceWith(c, weightKg, zone))
    .sort((a, b) => a.total - b.total);
  if (options.length === 0) throw new Error('no carrier available');
  return { zone, weightKg, to, options };
}

module.exports = { quote, listCarriers, normalizeAddress };
