import test from 'node:test';
import assert from 'node:assert/strict';
import { resetBalances, setBalance, getBalance } from '../src/balance-store.js';
import { earnHandler } from '../src/routes-earn.js';
import { adjustBalance } from '../src/routes-admin.js';
import { redeemHandler } from '../src/routes-redeem.js';
import { expireCustomer } from '../src/expiry-job.js';

function earnRequest(customerId, subtotal, tier) {
  return { customerId, subtotal, tier };
}

function adjustment(customerId, points) {
  return { customerId, points };
}

test('revised earn route handles an ordinary order', async () => {
  resetBalances();
  const response = await earnHandler(earnRequest('cus-601', 10, 'standard'));
  assert.equal(response.status, 201);
  assert.equal(response.body.customer, 'cus-601');
  assert.equal(response.body.points, 10);
  assert.equal(response.body.balance, 10);
});

test('plus tier is applied to an earn request', async () => {
  resetBalances();
  const response = await earnHandler(earnRequest('cus-604', 40, 'plus'));
  assert.equal(response.body.points, 50);
  assert.equal((await getBalance('cus-604')).points, 50);
});

test('premier tier is applied to an earn request', async () => {
  resetBalances();
  const response = await earnHandler(earnRequest('cus-605', 40, 'premier'));
  assert.equal(response.body.points, 60);
});

test('unknown tier uses the standard multiplier', async () => {
  resetBalances();
  const response = await earnHandler(earnRequest('cus-606', 12, 'seasonal'));
  assert.equal(response.body.points, 12);
});

test('adjust route returns the new balance', async () => {
  resetBalances();
  await setBalance('cus-602', 3);
  const response = await adjustBalance(adjustment('cus-602', 4));
  assert.equal(response.status, 200);
  assert.equal(response.body.customer, 'cus-602');
  assert.equal(response.body.balance, 7);
});

test('adjust route can apply a negative correction', async () => {
  resetBalances();
  await setBalance('cus-607', 20);
  const response = await adjustBalance(adjustment('cus-607', -5));
  assert.equal(response.body.balance, 15);
});

test('adjust route starts an empty account at the requested amount', async () => {
  resetBalances();
  const response = await adjustBalance(adjustment('cus-608', 6));
  assert.equal(response.body.balance, 6);
});

test('redeem accepts a small positive request', async () => {
  resetBalances();
  await setBalance('cus-609', 15);
  const response = await redeemHandler({ customerId: 'cus-609', points: 5 });
  assert.equal(response.body.points, 5);
  assert.equal(response.body.balance, 10);
});

test('redeem accepts a decimal request', async () => {
  resetBalances();
  await setBalance('cus-610', 8.5);
  const response = await redeemHandler({ customerId: 'cus-610', points: 2.25 });
  assert.equal(response.body.balance, 6.25);
});

test('redeem rejects a zero request', async () => {
  resetBalances();
  await assert.rejects(() => redeemHandler({ customerId: 'cus-611', points: 0 }), /positive/);
});

test('redeem rejects a malformed customer id', async () => {
  await assert.rejects(() => redeemHandler({ customerId: 'not valid', points: 2 }), /customer id/);
});

test('expiry still leaves a current account alone', async () => {
  resetBalances();
  await setBalance('cus-603', 9);
  const result = await expireCustomer('cus-603', '2025-01-01', new Date('2025-05-01T00:30:00Z'));
  assert.equal(result.expired, false);
  assert.equal(result.date, '2026-01-08');
  assert.equal((await getBalance('cus-603')).points, 9);
});

test('expiry clears an old account', async () => {
  resetBalances();
  await setBalance('cus-612', 19);
  const result = await expireCustomer('cus-612', '2023-01-01', new Date('2025-05-01T00:30:00Z'));
  assert.equal(result.expired, true);
  assert.equal(result.points, 19);
  assert.equal((await getBalance('cus-612')).points, 0);
});
