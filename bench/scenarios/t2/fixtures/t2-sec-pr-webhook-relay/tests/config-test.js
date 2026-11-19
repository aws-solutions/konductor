import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('config reads port and timeout', () => {
  const config = loadConfig({ PORT: '9090', WEBHOOK_SECRET: 'local-secret' });
  assert.equal(config.port, 9090);
  assert.equal(config.notifyTimeoutMs, 2500);
});
