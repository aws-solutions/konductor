import test from 'node:test';
import assert from 'node:assert/strict';
import { resetBalances, setBalance } from '../src/balance-store.js';
import { redeemHandler } from '../src/routes-redeem.js';

test('redeem lowers the balance', async () => {
  resetBalances();
  await setBalance('cus-201', 80);
  const response = await redeemHandler({ customerId: 'cus-201', points: 30 });
  assert.equal(response.body.balance, 50);
});

test('redeem rejects a balance that is too small', async () => {
  resetBalances();
  await setBalance('cus-202', 8);
  await assert.rejects(() => redeemHandler({ customerId: 'cus-202', points: 9 }), /insufficient/);
});
