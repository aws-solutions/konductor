import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceService } from '../src/services/price-service.mjs';

test('price service delegates list and writes', async () => {
  const calls = [];
  const service = new PriceService({
    async listPrices(...args) { calls.push(['list', ...args]); return [{ amount: 3 }]; },
    async updatePrice(...args) { calls.push(['update', ...args]); return { amount: 4 }; },
    async replacePrices(...args) { calls.push(['replace', ...args]); return args[2]; }
  });
  assert.deepEqual(await service.list('northwind'), [{ amount: 3 }]);
  assert.deepEqual(await service.update('northwind', 'retail', 'pencil', { amount: 4 }), { amount: 4 });
  assert.deepEqual(await service.replace('northwind', 'retail', [{ amount: 5 }]), [{ amount: 5 }]);
  assert.equal(calls.length, 3);
});

test('price service reads a cached list on a second request', async () => {
  let reads = 0;
  const cache = new Map();
  const service = new PriceService({
    async listPrices() { reads += 1; return [{ amount: 3 }]; }
  }, {
    cache: {
      get: (key) => cache.get(key),
      set: (key, value) => cache.set(key, value)
    },
    ttlSeconds: 30
  });
  assert.deepEqual(await service.list('northwind'), [{ amount: 3 }]);
  assert.deepEqual(await service.list('northwind'), [{ amount: 3 }]);
  assert.equal(reads, 1);
});
