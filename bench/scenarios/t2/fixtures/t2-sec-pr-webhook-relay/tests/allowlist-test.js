import test from 'node:test';
import assert from 'node:assert/strict';
import { isCustomerDestination } from '../src/notify/allowlist.js';

test('customer allowlist accepts example tenant hosts', () => {
  assert.equal(isCustomerDestination('https://tenant.example.invalid/hook'), true);
});
