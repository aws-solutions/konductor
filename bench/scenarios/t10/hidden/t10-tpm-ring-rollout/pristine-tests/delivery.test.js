'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDelivery } = require('../src/delivery');
const { createMemoryStore } = require('../src/store');

test('delivery passes document and destination', () => { let seen; const d = createDelivery((x) => { seen = x; return { accepted: true }; }); assert.deepEqual(d.deliver('pdf', 'inbox'), { accepted: true }); assert.deepEqual(seen, { document: 'pdf', destination: 'inbox' }); });
test('memory store starts empty', () => assert.equal(createMemoryStore().count(), 0));
test('memory store saves copy', () => { const s = createMemoryStore(); const r = { id: 'a', value: 1 }; s.save(r); r.value = 2; assert.equal(s.get('a').value, 1); });
test('memory store misses absent key', () => assert.equal(createMemoryStore().get('x'), null));
test('memory store counts records', () => { const s = createMemoryStore(); s.save({ id: 'a' }); s.save({ id: 'b' }); assert.equal(s.count(), 2); });
