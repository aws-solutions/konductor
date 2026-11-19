'use strict';

const { createCart, addItem, removeItem } = require('./cart');
const { ValidationError } = require('./errors');

class CartStore {
  constructor() {
    this.carts = new Map();
  }

  getCart(id) {
    if (typeof id !== 'string' || id.trim() === '') throw new ValidationError('Cart id is required');
    if (!this.carts.has(id)) this.carts.set(id, createCart(id));
    const cart = this.carts.get(id);
    return { ...cart, lines: cart.lines.map((line) => ({ ...line })) };
  }

  addItem(id, item) {
    const next = addItem(this.getCart(id), item);
    this.carts.set(id, next);
    return this.getCart(id);
  }

  removeItem(id, sku) {
    const next = removeItem(this.getCart(id), sku);
    this.carts.set(id, next);
    return this.getCart(id);
  }

  clear(id) {
    this.carts.set(id, this.getCart(id));
    return this.getCart(id);
  }
}

module.exports = { CartStore };
