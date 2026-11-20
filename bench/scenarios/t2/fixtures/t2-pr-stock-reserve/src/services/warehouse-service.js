import { requiredString } from '../util/validation.js';

export class WarehouseService {
  constructor(config) { this.config = config; }

  get(id) {
    requiredString(id, 'warehouseId');
    return this.config.warehouses.find((warehouse) => warehouse.id === id) ?? null;
  }

  active() { return this.config.warehouses.filter((warehouse) => warehouse.active); }
}
