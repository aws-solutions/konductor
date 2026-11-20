import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { WarehouseService } from '../src/services/warehouse-service.js';

test('warehouse service lists active locations', () => {
  const service = new WarehouseService(loadConfig());
  assert.deepEqual(service.active().map((item) => item.id), ['north', 'harbor']);
  assert.equal(service.get('missing'), null);
});
