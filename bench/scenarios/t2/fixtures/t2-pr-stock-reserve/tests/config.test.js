import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('config includes stock and basket limits', () => {
  const config = loadConfig({ PORT: '3500' });
  assert.equal(config.port, 3500);
  assert.equal(config.limits.stock.minimum, 0);
  assert.equal(config.limits.basket.maximumLines, 40);
});
