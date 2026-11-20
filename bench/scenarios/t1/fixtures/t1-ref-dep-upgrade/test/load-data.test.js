const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReport } = require('../src/load-data');

test('invalid report roots are rejected', () => {
  assert.throws(() => validateReport([]), /root must be an object/);
});

test('columns need labels', () => {
  assert.throws(() => validateReport({ title: 'x', columns: [{ key: 'a' }], rows: [] }), /key and label/);
});
