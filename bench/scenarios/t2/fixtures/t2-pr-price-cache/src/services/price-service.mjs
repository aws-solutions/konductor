export class PriceService {
  constructor(repository, { cache = null, ttlSeconds = 30 } = {}) {
    this.repository = repository;
    this.cache = cache;
    this.ttlSeconds = ttlSeconds;
  }

  async list(tenantId, listId = 'retail') {
    if (!this.cache) return this.repository.listPrices(tenantId, listId);

    const cached = this.cache.get(listId);
    if (cached) return cached;
    const prices = await this.#load(tenantId, listId);
    this.cache.set(listId, prices, this.ttlSeconds);
    return prices;
  }

  async update(tenantId, listId, productId, patch) {
    const price = await this.repository.updatePrice(tenantId, listId, productId, patch);
    this.cache?.delete(listId);
    return price;
  }

  async replace(tenantId, listId, prices) {
    return this.repository.replacePrices(tenantId, listId, prices);
  }

  async #load(tenantId, listId) {
    return this.repository.listPrices(tenantId, listId);
  }
}
