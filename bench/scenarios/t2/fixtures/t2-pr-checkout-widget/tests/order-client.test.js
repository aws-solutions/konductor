import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPromotion, submitOrder } from '../src/order-client.js';

function response(body, ok = true) {
  return { ok, status: ok ? 200 : 422, json: async () => body };
}

test('submitOrder sends JSON to the order endpoint', async () => {
  let request;
  const result = await submitOrder({ lines: [] }, async (url, options) => {
    request = { url, options };
    return response({ orderId: 'order_test_123' });
  });
  assert.equal(request.url, '/api/orders');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(result, { orderId: 'order_test_123' });
});

test('applyPromotion returns the service response', async () => {
  const result = await applyPromotion('SHIP-5', async () => response({ accepted: true, message: 'Promotion applied' }));
  assert.deepEqual(result, { accepted: true, message: 'Promotion applied' });
});
