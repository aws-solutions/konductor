'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { handler } = require('../src/handlers/fulfilment-worker'); const { fake } = require('./helpers');
test('worker processes without redrive', async () => { const client = fake(); const out = await handler({}, {}, { client }); assert.equal(out.redriven, false); assert.equal(client.calls.some((c) => c.resource.includes('dlq')), false); });
