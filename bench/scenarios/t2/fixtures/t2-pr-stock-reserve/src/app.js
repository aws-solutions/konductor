import { loadConfig } from './config.js';
import { makeLogger } from './logger.js';
import { InventoryService } from './services/inventory-service.js';
import { WarehouseService } from './services/warehouse-service.js';
import { CatalogStore } from './store/catalog-store.js';
import { MemoryStore } from './store/memory-store.js';
import { SyncEmitter } from './events/sync-emitter.js';
import { AuditLog } from './events/audit-log.js';
import { seedCatalog, seedStock } from './data/seed.js';
import { makeRouter } from './http/router.js';

export function makeApp(overrides = {}) {
  const config = overrides.config ?? loadConfig();
  const store = overrides.store ?? new MemoryStore(seedStock);
  const catalog = overrides.catalog ?? new CatalogStore(seedCatalog);
  const events = overrides.events ?? new SyncEmitter();
  const audit = overrides.audit ?? new AuditLog();
  const logger = overrides.logger ?? makeLogger();
  const inventory = new InventoryService({ store, catalog, events, audit, config, logger });
  const warehouses = new WarehouseService(config);
  return { config, store, events, audit, inventory, warehouses, router: makeRouter({ inventory, warehouses, logger }) };
}
