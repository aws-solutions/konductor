'use strict';

// Hidden behaviour tests of the contact import (the request in docs/requests/contact-import.md). One test per agreed
// rule, each holding all of that rule's cases: a rule counts only when every case of it works, so an import that
// handles the easy half of each rule does not earn half the score.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createBook } = require(path.join(__dirname, 'src/contacts.js'));
const load = () => require(path.join(__dirname, 'src/import.js')).importContacts;
const run = (csv, book = createBook()) => ({ book, result: load()(csv, book) });

test('rule 1: valid rows import in any column order, phone optional, CRLF and blank lines', () => {
  let r = run('name,email,phone\nAna Rua,ana@example.test,021 555\nBo Li,bo@example.test,\n');
  assert.equal(r.result.imported, 2);
  assert.deepEqual(r.result.skipped, []);
  assert.deepEqual(r.book.list().map((c) => c.email), ['ana@example.test', 'bo@example.test']);
  r = run('email,name\ncy@example.test,Cy Moss\n');
  assert.equal(r.book.list()[0].name, 'Cy Moss');
  assert.equal(run('name,email\r\nFa,fa@example.test\r\nGus,gus@example.test\r\n').result.imported, 2);
  // The request does not say how a blank line is handled: ignoring it or skipping it with its line both pass.
  r = run('name,email\n\nNia,nia@example.test\n\n');
  assert.equal(r.result.imported, 1);
  assert.ok(r.result.skipped.every((s) => [2, 4, 5].includes(s.line)), 'only the blank lines may be skipped');
});

test('rule 2: spreadsheet exports work: byte-order mark, quoted commas and quotes, line numbers after a two-line field', () => {
  assert.equal(run('\uFEFFname,email\nDee,dee@example.test\n').result.imported, 1);
  const { book } = run('name,email\n"Ngata, Aroha",aroha@example.test\n"Eli ""E"" Fox",eli@example.test\n');
  assert.deepEqual(book.list().map((c) => c.name), ['Ngata, Aroha', 'Eli "E" Fox']);
  assert.deepEqual(run('name,email\n"Lee\nSmith",lee@example.test\nMo,bad\n').result.skipped.map((s) => s.line), [4]);
});

test('rule 3: duplicates are skipped, against the book and within the file, without case', () => {
  const book = createBook();
  book.add({ name: 'Ana', email: 'ana@example.test' });
  let r = run('name,email\nAna Again,ANA@Example.test\n', book).result;
  assert.equal(r.imported, 0);
  assert.equal(r.skipped[0].line, 2);
  assert.match(r.skipped[0].reason, /duplicate|already/i);
  r = run('name,email\nHal,hal@example.test\nHal 2,HAL@example.test\n').result;
  assert.equal(r.imported, 1);
  assert.deepEqual(r.skipped.map((s) => s.line), [3]);
});

test('rule 4: bad rows are skipped with their file line and reason, and the rest imports', () => {
  const r = run('name,email\nIvy,ivy@example.test\n,nobody@example.test\nJo,not-an-email\nKai,kai@example.test\n').result;
  assert.equal(r.imported, 2);
  assert.deepEqual(r.skipped.map((s) => s.line), [3, 4]);
  assert.match(r.skipped[0].reason, /name/i);
  assert.match(r.skipped[1].reason, /email/i);
});

test('rule 5: more than 5,000 data rows are refused before anything is imported; 5,000 import', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => `P${i},p${i}@example.test`).join('\n');
  const book = createBook();
  // The prompt asks for an Error over the limit and leaves its wording free.
  assert.throws(() => load()(`name,email\n${rows(5001)}\n`, book), Error);
  assert.equal(book.list().length, 0);
  assert.equal(run(`name,email\n${rows(5000)}\n`).result.imported, 5000);
});
