const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductCache } = require('../../src/cache/product-cache');
test('returns a stored product', () => {
  const c = new ProductCache(); c.put(1, {id: 1}); assert.deepEqual(c.get(1), {id: 1});
});
