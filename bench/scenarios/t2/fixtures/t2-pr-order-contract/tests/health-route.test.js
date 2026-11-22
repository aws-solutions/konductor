import test from 'node:test';
import assert from 'node:assert/strict';
import { healthRoute } from '../src/routes/health-route.js';

test('reports service health', () => {
  assert.deepEqual(healthRoute(), {
    statusCode: 200,
    body: { ok: true, service: 'orders', version: '3.8.0' }
  });
});
