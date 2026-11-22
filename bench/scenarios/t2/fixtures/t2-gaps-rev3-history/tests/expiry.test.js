import test from 'node:test';
import assert from 'node:assert/strict';
import { resetBalances, setBalance, getBalance } from '../src/balance-store.js';
import { expireCustomer } from '../src/expiry-job.js';

test('expiry leaves a recent balance alone', async () => {
  resetBalances();
  await setBalance('cus-301', 42);
  const result = await expireCustomer('cus-301', '2025-01-01', new Date('2025-05-01T03:00:00Z'));
  assert.equal(result.expired, false);
  assert.equal((await getBalance('cus-301')).points, 42);
});
