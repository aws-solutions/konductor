'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogService } = require('../src');

const rec = (sku) => ({ ITM_NO: sku, DESC_TXT: sku, PRC_CENTS: '000100', STAT: 'A', CAT_CD: 'c' });
const busy = () => Object.assign(new Error('busy'), { code: 'BUSY' });

test('a repeated lookup within 60 s is served from the cache', async () => {
  let calls = 0;
  const catalog = createCatalogService({ supplier: { fetchItem: async (s) => { calls++; return rec(s); } }, clock: { now: () => 0 } });
  await catalog.lookup('A');
  await catalog.lookup('A');
  assert.equal(calls, 1);
});

test('at most 4 supplier calls run at once', async () => {
  let inFlight = 0;
  let max = 0;
  const supplier = { fetchItem: async (s) => { max = Math.max(max, ++inFlight); await new Promise((r) => setImmediate(r)); inFlight--; return rec(s); } };
  const catalog = createCatalogService({ supplier });
  await Promise.all(Array.from({ length: 20 }, (_, i) => catalog.lookup(`S${i}`)));
  assert.equal(max, 4);
});

test('BUSY is retried with the design back-off and then gives up', async () => {
  const waits = [];
  const catalog = createCatalogService({ supplier: { fetchItem: async () => { throw busy(); } }, sleep: async (ms) => { waits.push(ms); } });
  await assert.rejects(catalog.lookup('A'), { code: 'SUPPLIER_UNAVAILABLE' });
  assert.deepEqual(waits, [50, 100]);
});

test('the category index answers from the snapshot', () => {
  const catalog = createCatalogService({ supplier: { fetchItem: async () => null }, items: [rec('A'), rec('B')] });
  assert.deepEqual(catalog.listByCategory('c').map((i) => i.sku), ['A', 'B']);
});
