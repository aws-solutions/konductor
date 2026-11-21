'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { readRows, readRecords } = require('../lib/csv');

const collect = async (it) => { const out = []; for await (const x of it) out.push(x); return out; };
const from = (...chunks) => Readable.from(chunks);

test('plain rows with LF and CRLF', async () => {
  assert.deepEqual(await collect(readRows(from('a,b\n1,2\n'))), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(await collect(readRows(from('a,b\r\n1,2\r\n'))), [['a', 'b'], ['1', '2']]);
});

test('last row without a final newline', async () => {
  assert.deepEqual(await collect(readRows(from('a\n1'))), [['a'], ['1']]);
});

test('quoted fields: delimiter, doubled quote, line break', async () => {
  const rows = await collect(readRows(from('a,b\n"x,y","he said ""hi"""\n"two\nlines",z\n')));
  assert.deepEqual(rows, [['a', 'b'], ['x,y', 'he said "hi"'], ['two\nlines', 'z']]);
});

test('quotes split across chunks', async () => {
  const rows = await collect(readRows(from('a\n"x"', '"y"\n', '"p', 'q"\n')));
  assert.deepEqual(rows, [['a'], ['x"y'], ['pq']]);
});

test('BOM is dropped and blank lines are skipped', async () => {
  const rows = await collect(readRows(from('\uFEFFa,b\n\n1,2\n\n')));
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('records are numbered from 1 after the header, short rows padded', async () => {
  const recs = await collect(readRecords(from('a,b\n1,2\n3\n')));
  assert.deepEqual(recs, [
    { row: 1, cells: { a: '1', b: '2' } },
    { row: 2, cells: { a: '3', b: '' } },
  ]);
});
