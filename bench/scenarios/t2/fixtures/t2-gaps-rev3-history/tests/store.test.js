import test from 'node:test';
import assert from 'node:assert/strict';
import { resetBalances, setBalance, getBalance, compareAndSet } from '../src/balance-store.js';

test('store versions writes', async () => {
  resetBalances();
  const first = await setBalance('cus-501', 4);
  assert.equal(first.version, 1);
  assert.equal(await compareAndSet('cus-501', first.version, 9), true);
  assert.equal((await getBalance('cus-501')).points, 9);
});
