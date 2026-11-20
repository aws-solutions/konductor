'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { records } = require('../src/csv-records');

test('a quoted field may hold commas, doubled quotes and a line break; later records keep their file lines', () => {
  const got = [...records('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z\nlast,row\n')];
  assert.deepEqual(got, [
    { line: 1, fields: ['a', 'b'] },
    { line: 2, fields: ['x, y', 'say "hi"'] },
    { line: 3, fields: ['two\nlines', 'z'] },
    { line: 5, fields: ['last', 'row'] },
  ]);
});

test('blank lines are dropped but still counted', () => {
  assert.deepEqual([...records('h\n\n\nv\n')].map((r) => r.line), [1, 4]);
});
