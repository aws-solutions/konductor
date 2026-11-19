import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutes } from '../src/routes.mjs';

test('routes reject missing tenant header', async () => {
  const routes = createRoutes({ catalog: {}, prices: {}, tenants: { exists: async () => true } });
  await assert.rejects(() => routes({ headers: {}, url: '/v1/products', method: 'GET' }), /x-tenant-id/);
});
