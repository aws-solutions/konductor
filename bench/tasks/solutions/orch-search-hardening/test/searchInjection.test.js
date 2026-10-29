'use strict';

const test = require('node:test');
const assert = require('node:assert');
const repo = require('../src/repository/itemRepo');

test('searchByName treats a quote-and-OR term as data', async () => {
  const found = await repo.searchByName("zzz%' OR '1'='1' --");
  assert.deepStrictEqual(found, []);
});
