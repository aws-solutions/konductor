import { requireId } from '../id.mjs';

export class CatalogService {
  constructor(repository) { this.repository = repository; }
  async products(tenantId) {
    requireId(tenantId, 'tenant');
    return this.repository.listProducts(tenantId);
  }
}
