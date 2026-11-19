'use strict';

const { ValidationError } = require('./errors');

const MAX_QUANTITY = 99;

function checkCartId(id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ValidationError('Cart id is required');
  }
}

function checkQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new ValidationError('Quantity must be an integer from 1 to 99');
  }
}

function checkPrice(unitPriceCents) {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new ValidationError('Unit price must be a non-negative integer');
  }
}

function createCart(id) {
  checkCartId(id);
  return { id, lines: [] };
}

function addItem(cart, item) {
  if (!cart || typeof cart.id !== 'string') throw new ValidationError('Cart is required');
  if (!item || typeof item.sku !== 'string' || item.sku === '') throw new ValidationError('SKU is required');
  checkPrice(item.unitPriceCents);
  checkQuantity(item.quantity);
  const lines = cart.lines.map((line) => ({ ...line }));
  const existing = lines.find((line) => line.sku === item.sku);
  if (existing) {
    checkQuantity(existing.quantity + item.quantity);
    existing.quantity += item.quantity;
  } else {
    lines.push({ sku: item.sku, unitPriceCents: item.unitPriceCents, quantity: item.quantity });
  }
  return { ...cart, lines };
}

function removeItem(cart, sku) {
  if (!cart || !Array.isArray(cart.lines)) throw new ValidationError('Cart is required');
  return { ...cart, lines: cart.lines.filter((line) => line.sku !== sku).map((line) => ({ ...line })) };
}

module.exports = { MAX_QUANTITY, createCart, addItem, removeItem, checkQuantity };
