const test = require('node:test');
const assert = require('node:assert/strict');
const { PaymentProvider } = require('../src/payments/provider');
const { refundOrder } = require('../src/orders/refunds');

test('refund order sends a request to the payment provider', async () => {
  const provider = new PaymentProvider();
  await refundOrder(provider, { id: 'o-4', total: 50, lines: [{ quantity: 2 }] }, [{ quantity: 1 }]);
  assert.equal(provider.refunds.length, 1);
  assert.equal(provider.refunds[0].orderId, 'o-4');
});
