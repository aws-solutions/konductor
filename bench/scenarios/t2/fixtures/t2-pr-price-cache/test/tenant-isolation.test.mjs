import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantService } from '../src/services/tenant-service.mjs';

test('tenant service recognizes active tenants', async () => {
  const service = new TenantService({ read: async () => [{ id: 'northwind', active: true }, { id: 'closed', active: false }] });
  assert.equal(await service.exists('northwind'), true);
  assert.equal(await service.exists('closed'), false);
});
