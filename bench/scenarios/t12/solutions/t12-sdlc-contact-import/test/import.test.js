'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBook } = require('../src/contacts');
const { importContacts } = require('../src/import');

test('imports rows in any column order, with a BOM, quotes and CRLF', () => {
  const book = createBook();
  const r = importContacts('\uFEFFemail,name\r\nana@example.test,"Rua, Ana"\r\n', book);
  assert.equal(r.imported, 1);
  assert.equal(book.list()[0].name, 'Rua, Ana');
});

test('skips duplicates and bad rows with file lines, and imports the rest', () => {
  const book = createBook();
  book.add({ name: 'Bo', email: 'bo@example.test' });
  const r = importContacts('name,email\nBo,BO@example.test\n,x@example.test\nCy,cy@example.test\nCy,cy@example.test\n', book);
  assert.equal(r.imported, 1);
  assert.deepEqual(r.skipped.map((s) => s.line), [2, 3, 5]);
});

test('refuses more than 5,000 rows before importing anything', () => {
  const book = createBook();
  const rows = Array.from({ length: 5001 }, (_, i) => `P${i},p${i}@example.test`).join('\n');
  assert.throws(() => importContacts(`name,email\n${rows}\n`, book), /5000/);
  assert.equal(book.list().length, 0);
});
