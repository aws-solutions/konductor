import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService } from '../src/services/catalog-service.mjs';

test('catalog service asks for the tenant catalog', async () => {
  let received;
  const service = new CatalogService({ listProducts: async (tenant) => { received = tenant; return []; } });
  assert.deepEqual(await service.products('northwind'), []);
  assert.equal(received, 'northwind');
});
