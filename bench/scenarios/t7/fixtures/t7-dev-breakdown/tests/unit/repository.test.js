const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductRepository } = require('../../src/storage/product-repository');
const { fakeDb } = require('../helpers/fake-db');
test('repository returns database rows', async () => { assert.deepEqual(await new ProductRepository(fakeDb([{id: 1}])).findAll(), [{id: 1}]); });
