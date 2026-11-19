'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { handler } = require('../src/handlers/create-order'); const { fake } = require('./helpers');
test('create order returns an id', async () => { const client = fake(); const out = await handler({ orderId: 'o-1' }, {}, { client }); assert.equal(out.orderId, 'o-1'); assert.equal(client.calls.at(-1).action, 'dynamodb:PutItem'); });
