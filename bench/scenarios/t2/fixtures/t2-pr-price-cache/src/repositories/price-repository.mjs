export class PriceRepository {
  constructor(store) { this.store = store; }
  async listPrices(tenantId, listId = 'retail') {
    return this.store.read(`${tenantId}-${listId}-prices.json`);
  }
  async replacePrices(tenantId, listId, prices) {
    await this.store.write(`${tenantId}-${listId}-prices.json`, prices);
    return prices;
  }
  async updatePrice(tenantId, listId, productId, patch) {
    const prices = await this.listPrices(tenantId, listId);
    const index = prices.findIndex((price) => price.productId === productId);
    if (index < 0) throw new Error(`price for ${productId} was not found`);
    prices[index] = { ...prices[index], ...patch, updatedAt: new Date().toISOString() };
    await this.store.write(`${tenantId}-${listId}-prices.json`, prices);
    return prices[index];
  }
}
