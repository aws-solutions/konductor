'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBook } = require('../src/contacts');

test('address book adds, lists and finds emails without case', () => {
  const book = createBook();
  book.add({ name: 'Ana', email: 'Ana@Example.test' });
  assert.equal(book.has('ana@example.test'), true);
  assert.equal(book.list().length, 1);
  assert.throws(() => book.add({ name: '', email: 'x@y.test' }), /name/);
});
