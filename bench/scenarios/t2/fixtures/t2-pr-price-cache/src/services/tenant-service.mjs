export class TenantService {
  constructor(store) { this.store = store; }
  async exists(tenantId) {
    const tenants = await this.store.read('tenants.json');
    return tenants.some((tenant) => tenant.id === tenantId && tenant.active);
  }
}
