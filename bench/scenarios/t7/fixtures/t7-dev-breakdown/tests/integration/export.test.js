const test = require('node:test');
const assert = require('node:assert/strict');
const { productCsvRow } = require('../../src/export/products-csv');
test('CSV row includes product identity', () => assert.match(productCsvRow({id: 1, name: 'A', price_minor: 100, currency_code: 'USD'}), /^1,A/));
