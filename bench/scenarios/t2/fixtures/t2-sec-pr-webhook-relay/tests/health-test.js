import test from 'node:test';
import assert from 'node:assert/strict';
import { healthResponse } from '../src/health.js';

test('health response is stable', () => {
  assert.equal(healthResponse().status, 200);
  assert.match(healthResponse().body, /relay-gateway/);
});
