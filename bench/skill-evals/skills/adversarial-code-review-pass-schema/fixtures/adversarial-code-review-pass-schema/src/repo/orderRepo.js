'use strict';

function toOrder(item) {
  return {
    id: item.pk.replace('ORDER#', ''),
    sku: item.sku,
    quantity: item.quantity,
    status: item.status,
    region: item.region.toUpperCase(),
    giftWrap: item.giftWrap,
    createdAt: item.createdAt,
  };
}

module.exports = { toOrder };
