const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPriceNotice } = require('../../src/notifications/price-email');
test('price notice names recipient', () => assert.match(renderPriceNotice({name: 'A', price_minor: 100, currency_code: 'USD'}, 'Lee'), /Lee/));
