const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationService } = require('../src/notifications');
const { testConfig } = require('./helpers');

test('sends normalized SMS messages', () => {
  let request;
  const service = createNotificationService(testConfig(), { sms: (value) => { request = value; return { accepted: true }; } });
  assert.deepEqual(service.send({ channel: 'sms', to: '(555) 0100', body: 'hello' }), { accepted: true });
  assert.equal(request.to, '+5550100');
  assert.equal(request.body, 'hello');
});

test('rejects unknown channels', () => {
  const service = createNotificationService(testConfig());
  assert.throws(() => service.send({ channel: 'pager', to: 'x', body: 'x' }), /Unsupported channel/);
});
