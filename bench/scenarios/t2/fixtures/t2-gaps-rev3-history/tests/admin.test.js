import test from 'node:test';
import assert from 'node:assert/strict';
import { resetBalances, setBalance } from '../src/balance-store.js';
import { inspectBalance } from '../src/routes-admin.js';

test('admin can inspect a balance', async () => {
  resetBalances();
  await setBalance('cus-401', 11);
  const response = await inspectBalance({ customerId: 'cus-401', user: { role: 'admin' } });
  assert.equal(response.body.balance, 11);
});

test('support user cannot inspect the admin route', async () => {
  await assert.rejects(() => inspectBalance({ customerId: 'cus-401', user: { role: 'support' } }), /forbidden/);
});
