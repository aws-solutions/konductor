const test = require('node:test');
const assert = require('node:assert/strict');
const { sign } = require('../src/payments/signature');
const { handleWebhook } = require('../src/payments/webhook');

test('valid payment webhook updates an order', () => {
  const body = JSON.stringify({ type: 'charge.succeeded', data: { orderId: 'o-3', chargeId: 'ch-3' } });
  const state = { orders: {} };
  const result = handleWebhook({ rawBody: body, signature: sign(body, 'secret') }, state, 'secret');
  assert.equal(result.accepted, true);
  assert.equal(state.orders['o-3'].paid, true);
});

test('invalid webhook signature is rejected', () => {
  const state = { orders: {} };
  const result = handleWebhook({ rawBody: '{}', signature: 'bad' }, state, 'secret');
  assert.deepEqual(result, { accepted: false, reason: 'bad_signature' });
});
