'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PaymentGatewayAdapter } = require('../src/adapters/payment-gateway');

function fakeClient() {
  const calls = [];
  return { calls, createCharge(input) { calls.push(['charge', input]); return { ok: true, id: 'ch_1' }; }, createRefund(input) { calls.push(['refund', input]); return { ok: true, id: 'rf_1' }; } };
}

test('payment adapter maps charge request and provider response', () => {
  const client = fakeClient();
  const adapter = new PaymentGatewayAdapter(client);
  assert.deepEqual(adapter.charge({ invoiceId: 'inv_1', amountCents: 1200, token: 'tok_1' }), { status: 'succeeded', retryable: false, code: null, providerId: 'ch_1' });
  assert.deepEqual(client.calls[0], ['charge', { amount: 1200, token: 'tok_1', metadata: { invoiceId: 'inv_1' } }]);
});

test('provider exceptions become retryable failures when marked', () => {
  const client = { createCharge() { const error = new Error('busy'); error.retryable = true; error.code = 'busy'; throw error; } };
  assert.deepEqual(new PaymentGatewayAdapter(client).charge({ invoiceId: 'inv_2', amountCents: 4 }), { status: 'failed', retryable: true, code: 'busy', providerId: null });
});

test('refund adapter passes provider identifiers through', () => {
  const client = fakeClient();
  assert.deepEqual(new PaymentGatewayAdapter(client).refund({ providerId: 'ch_1', amountCents: 400 }), { status: 'succeeded', providerId: 'rf_1' });
  assert.deepEqual(client.calls[0], ['refund', { chargeId: 'ch_1', amount: 400 }]);
});
