const test = require('node:test');
const assert = require('node:assert/strict');
const { sendReceipt } = require('../src/notifications/email');

test('receipt email sends the order details', async () => {
  const sent = [];
  const result = await sendReceipt({ send: async (message) => sent.push(message) }, { id: 'o-5', email: 'a@example.test', total: '12.00' });
  assert.equal(result.sent, true);
  assert.equal(sent[0].to, 'a@example.test');
});

test('receipt returns a status when mailer fails', async () => {
  const result = await sendReceipt({ send: async () => { throw new Error('mail unavailable'); } }, { id: 'o-6', email: 'a@example.test', total: '12.00' });
  assert.equal(result.sent, false);
});
