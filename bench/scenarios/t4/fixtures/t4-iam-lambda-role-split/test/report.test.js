'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { handler } = require('../src/handlers/nightly-report'); const { fake } = require('./helpers');
test('report uses supplied date', async () => { const client = fake(); const out = await handler({ reportDate: '2025-01-15' }, {}, { client }); assert.equal(out.object, 'reports/2025-01-15.json'); });
