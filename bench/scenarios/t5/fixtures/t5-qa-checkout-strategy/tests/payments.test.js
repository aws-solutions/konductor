const test = require('node:test');
const assert = require('node:assert/strict');
const { PaymentProvider } = require('../src/payments/provider');
const { withRetries } = require('../src/payments/retry');

test('provider records a successful charge', async () => {
  const provider = new PaymentProvider();
  const result = await provider.charge({ orderId: 'o-2', amount: 500 });
  assert.equal(result.status, 'succeeded');
  assert.equal(provider.charges[0].amount, 500);
});

test('retry helper returns a later successful result', async () => {
  let calls = 0;
  const result = await withRetries(async () => {
    calls += 1;
    if (calls < 2) throw new Error('temporary');
    return 'ok';
  }, { attempts: 3 });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});
