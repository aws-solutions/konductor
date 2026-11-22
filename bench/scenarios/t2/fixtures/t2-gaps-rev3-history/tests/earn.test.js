import test from 'node:test';
import assert from 'node:assert/strict';
import { resetBalances, getBalance } from '../src/balance-store.js';
import { earnHandler } from '../src/routes-earn.js';

test('earn returns tier-adjusted points', async () => {
  resetBalances();
  const response = await earnHandler({ customerId: 'cus-101', subtotal: 20, tier: 'plus' });
  assert.equal(response.status, 201);
  assert.equal(response.body.points, 25);
  assert.equal((await getBalance('cus-101')).points, 25);
});

test('earn defaults missing tier to standard', async () => {
  resetBalances();
  const response = await earnHandler({ customerId: 'cus-102', subtotal: 7 });
  assert.equal(response.body.points, 7);
});
