'use strict';

const test = require('node:test');
const assert = require('node:assert');
const h = require('../src/handlers/items');

test('adjustStock rejects a non-integer delta', async () => {
  const r = await h.adjustStock({ params: { id: '1' }, body: { delta: 'abc' }, headers: {} });
  assert.strictEqual(r.status, 400);
});
