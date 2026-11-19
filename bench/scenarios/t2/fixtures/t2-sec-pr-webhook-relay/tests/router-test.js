import test from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../src/router.js';
import { makeLogger } from '../src/logger.js';
import { makeDeliveryStore } from '../src/storage/deliveries.js';

test('router returns health response', async () => {
  const response = await route({ method: 'GET', path: '/healthz', rawBody: '', headers: {} }, {
    config: {}, logger: makeLogger('error'), store: makeDeliveryStore()
  });
  assert.equal(response.status, 200);
});
