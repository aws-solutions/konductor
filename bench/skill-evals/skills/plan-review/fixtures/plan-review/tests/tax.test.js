const test = require('node:test');
const assert = require('node:assert');
const { taxFor } = require('../src/billing/tax');
test('WA tax', () => assert.strictEqual(taxFor(100, 'US-WA'), 6.5));
