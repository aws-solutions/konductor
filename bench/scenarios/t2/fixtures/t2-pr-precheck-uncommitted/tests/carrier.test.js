'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestRate } = require('../src/carrier');

test('sends the account and shipment to the carrier', async () => {
  let request;
  const result = await requestRate(
    { origin: { country: 'US', postalCode: '02110' }, destination: { country: 'US', postalCode: '10001' }, weightKg: 2 },
    { carrier: { url: 'https://carrier.test', apiKey: 'test_key_123', accountNumber: 'test_account_123', timeoutMs: 1000 } },
    async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, async json() { return { amount: 12, currency: 'USD' }; } };
    },
    { info() {} }
  );
  assert.equal(request.accountNumber, 'test_account_123');
  assert.equal(result.amount, 12);
});
