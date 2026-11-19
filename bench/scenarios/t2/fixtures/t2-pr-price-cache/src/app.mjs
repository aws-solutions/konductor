import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { JsonStore } from './store/json-store.mjs';
import { CatalogRepository } from './repositories/catalog-repository.mjs';
import { PriceRepository } from './repositories/price-repository.mjs';
import { CatalogService } from './services/catalog-service.mjs';
import { PriceService } from './services/price-service.mjs';
import { PriceCache } from './cache/price-cache.mjs';
import { TenantService } from './services/tenant-service.mjs';
import { createRoutes } from './routes.mjs';
import { createHttpServer } from './http.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = await loadConfig(root);
const store = new JsonStore(config.dataDir);
const priceCache = config.priceCache.enabled
  ? new PriceCache({ maxEntries: config.priceCache.maxEntries })
  : null;
const route = createRoutes({
  catalog: new CatalogService(new CatalogRepository(store)),
  prices: new PriceService(new PriceRepository(store), {
    cache: priceCache,
    ttlSeconds: config.priceCache.ttlSeconds
  }),
  tenants: new TenantService(store)
});
const server = createHttpServer(route);
server.listen(process.env.PORT || config.port, () => console.log(`catalog listening on ${process.env.PORT || config.port}`));
