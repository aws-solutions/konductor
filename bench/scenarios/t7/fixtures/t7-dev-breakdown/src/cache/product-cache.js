class ProductCache {
  constructor() { this.values = new Map(); }
  key(productId) { return `product:${productId}`; }
  get(productId) { return this.values.get(this.key(productId)); }
  put(productId, product) { this.values.set(this.key(productId), product); }
}
module.exports = { ProductCache };
