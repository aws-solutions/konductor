const test = require('node:test');
const assert = require('node:assert/strict');
test('products route smoke test is registered', () => assert.equal(typeof require('../../src/http/products-route').listProducts, 'function'));
