export class CatalogStore {
  constructor(records = []) { this.records = new Map(records.map((record) => [record.sku, { ...record }])); }
  async get(sku) { return this.records.get(sku) ? { ...this.records.get(sku) } : undefined; }
  async list() { return [...this.records.values()].map((record) => ({ ...record })); }
}
