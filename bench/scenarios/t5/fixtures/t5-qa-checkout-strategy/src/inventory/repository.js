class InventoryRepository {
  constructor(initial = {}) {
    this.items = new Map(Object.entries(initial));
  }

  async get(sku) {
    return this.items.get(sku) || 0;
  }

  async set(sku, quantity) {
    this.items.set(sku, quantity);
  }

  async snapshot() {
    return Object.fromEntries(this.items);
  }
}

module.exports = { InventoryRepository };
