'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { handler } = require('../src/handlers/payment-webhook'); const { fake } = require('./helpers');
test('webhook accepts a payment', async () => { const client = fake(); const out = await handler({ paymentId: 'p-1', status: 'settled' }, {}, { client }); assert.equal(out.accepted, true); assert.equal(client.calls.filter((c) => c.action === 'secretsmanager:GetSecretValue').length, 1); });
