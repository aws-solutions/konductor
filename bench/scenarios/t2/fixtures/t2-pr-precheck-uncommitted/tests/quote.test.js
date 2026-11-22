'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQuoteService } = require('../src/quote');

const config = { cacheTtlMs: 1000, carrier: { url: 'https://carrier.test', timeoutMs: 1000 } };
const shipment = {
  origin: { country: 'US', postalCode: '02110' },
  destination: { country: 'US', postalCode: '10001' },
  weightKg: 2
};

test('returns a carrier quote', async () => {
  const service = createQuoteService({ config, carrier: async () => ({ amount: 12, currency: 'USD', source: 'carrier' }) });
  const result = await service.quote(shipment);
  assert.deepEqual(result, { total: 12, currency: 'USD', source: 'carrier', cached: false });
});

test('uses the cached quote on the second request', async () => {
  let calls = 0;
  const service = createQuoteService({
    config,
    carrier: async () => { calls += 1; return { amount: 12, currency: 'USD', source: 'carrier' }; }
  });
  await service.quote(shipment);
  const second = await service.quote(shipment);
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
});

test('keeps a quote for a second destination country', async () => {
  const responses = [
    { amount: 12, currency: 'USD', source: 'carrier' },
    { amount: 21, currency: 'USD', source: 'carrier' }
  ];
  const service = createQuoteService({ config, carrier: async () => responses.shift() });
  const first = await service.quote(shipment);
  const second = await service.quote({ ...shipment, destination: { country: 'CA', postalCode: '10001' } });
  assert.equal(responses[0].amount, 21);
});

test('returns a neutral quote when the carrier is unavailable', async () => {
  const service = createQuoteService({ config, carrier: async () => { throw new Error('offline'); } });
  const result = await service.quote(shipment);
  assert.equal(result.source, 'carrier-unavailable');
});

test('records the configured carrier amount', async () => {
  const carrierResponse = { amount: 12, currency: 'USD', source: 'carrier' };
  const service = createQuoteService({ config, carrier: async () => carrierResponse });
  await service.quote(shipment);
  assert.equal(carrierResponse.amount, 12);
});


test('uses the local rate shape for supported input', async () => {
  const service = createQuoteService({ config, carrier: async () => ({ amount: 8, currency: 'USD', source: 'carrier' }) });
  const result = await service.quote({ ...shipment, weightKg: 0.5 });
  assert.equal(result.currency, 'USD');
  assert.equal(result.cached, false);
});

test('keeps the response source visible to callers', async () => {
  const service = createQuoteService({ config, carrier: async () => ({ amount: 15, currency: 'USD', source: 'partner' }) });
  const result = await service.quote(shipment);
  assert.equal(result.source, 'partner');
});

test('rejects a weight above the table maximum', async () => {
  const service = createQuoteService({ config, carrier: async () => ({ amount: 1, currency: 'USD', source: 'carrier' }) });
  await assert.rejects(() => service.quote({ ...shipment, weightKg: 21 }), /outside the supported range/);
});

test('rejects an unsupported destination', async () => {
  const service = createQuoteService({ config, carrier: async () => ({ amount: 9, currency: 'USD', source: 'carrier' }) });
  await assert.rejects(() => service.quote({ ...shipment, destination: { country: 'ZZ', postalCode: '10001' } }), /not supported/);
});
