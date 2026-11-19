const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney } = require('../../src/services/money');
test('formats a minor-unit amount', () => assert.equal(formatMoney(1299), '$12.99'));
