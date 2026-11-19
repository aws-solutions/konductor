export class CatalogRepository {
  constructor(store) { this.store = store; }
  async listProducts(tenantId) {
    return this.store.read(`${tenantId}-products.json`);
  }
}
