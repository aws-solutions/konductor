'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { handler } = require('../src/handlers/admin-export'); const { fake } = require('./helpers');
test('export uses the export prefix', async () => { const client = fake(); await handler({ exportId: 'e-1' }, {}, { client }); assert.equal(client.calls.at(-1).resource.includes('/exports/e-1.json'), true); });
