import test from 'node:test';
import assert from 'node:assert/strict';
import { route, match } from '../src/http/router.js';

test('router extracts order parameters', () => {
  const found = match([route('POST', '/v1/orders/:orderId/capture', () => {})], 'POST', '/v1/orders/ord_9/capture');
  assert.equal(found.params.orderId, 'ord_9');
});

test('router ignores another method', () => assert.equal(match([route('GET', '/health', () => {})], 'POST', '/health'), null));
