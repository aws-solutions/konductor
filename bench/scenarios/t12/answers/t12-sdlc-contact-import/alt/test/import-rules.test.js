'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBook } = require('../src/contacts');
const { importContacts } = require('../src/import');

const rows = (n) => Array.from({ length: n }, (_, i) => `c${i}@example.test,C ${i}`).join('\n');

test('columns in any order, phone optional, a byte-order mark and CRLF line ends', () => {
  const book = createBook();
  const r = importContacts('\uFEFFemail,phone,name\r\nana@example.test,,Ana\r\nbo@example.test,021 5,"Li, Bo"\r\n', book);
  assert.deepEqual(r, { imported: 2, skipped: [] });
  assert.deepEqual(book.list().map((c) => [c.name, c.phone]), [['Ana', ''], ['Li, Bo', '021 5']]);
});

test('duplicates are skipped without case, against the book and earlier rows of the same file', () => {
  const book = createBook();
  book.add({ name: 'Ana', email: 'ana@example.test' });
  const r = importContacts('name,email\nAna,ANA@example.test\nCy,cy@example.test\nCy again,Cy@Example.test\n', book);
  assert.equal(r.imported, 1);
  assert.deepEqual(r.skipped.map((s) => s.line), [2, 4]);
  assert.ok(r.skipped.every((s) => /duplicate/.test(s.reason)));
});

test('a row with no name or a bad email is skipped with its file line and why; the rest import', () => {
  const r = importContacts('name,email\n"Two\nline name",ok@example.test\n,x@example.test\nDee,dee-at-example\nEd,ed@example.test\n', createBook());
  assert.equal(r.imported, 2);
  assert.deepEqual(r.skipped, [{ line: 4, reason: 'name is required' }, { line: 5, reason: 'email is invalid' }]);
});

test('5,000 data rows import; 5,001 are refused and nothing is added', () => {
  assert.equal(importContacts(`email,name\n${rows(5000)}\n`, createBook()).imported, 5000);
  const book = createBook();
  assert.throws(() => importContacts(`email,name\n${rows(5001)}\n`, book), { name: 'RowLimitError' });
  assert.equal(book.list().length, 0);
});
