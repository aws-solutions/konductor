'use strict';

const ORDER_STATUS = ['PENDING', 'PAID', 'DISPATCHED', 'CANCELLED'];

function orderInput(body) {
  const errors = [];
  if (typeof body.sku !== 'string') errors.push('sku must be a string');
  if (!Number.isInteger(body.quantity) || body.quantity < 1) errors.push('quantity must be a positive integer');
  if (typeof body.giftWrap !== 'boolean') errors.push('giftWrap must be a boolean');
  return errors;
}

function toOrderResponse(order) {
  return {
    id: order.id,
    sku: order.sku,
    quantity: order.quantity,
    status: order.status,
    region: order.region,
    createdAt: order.createdAt,
  };
}

module.exports = { ORDER_STATUS, orderInput, toOrderResponse };
