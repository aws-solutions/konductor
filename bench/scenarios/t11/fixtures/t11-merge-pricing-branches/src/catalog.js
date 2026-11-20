'use strict';

const catalog = require('../data/catalog.json');

function findItem(sku) {
  return catalog.items.find((item) => item.sku === sku) || null;
}

module.exports = { findItem };
