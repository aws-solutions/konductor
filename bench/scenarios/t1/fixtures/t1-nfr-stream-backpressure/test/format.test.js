const test = require('node:test');
const assert = require('node:assert/strict');
const { toLine, parsePort } = require('../src/format');

test('toLine appends exactly one newline', () => assert.equal(toLine({ ok: 1 }), '{"ok":1}\n'));
test('parsePort uses a safe default', () => {
  assert.equal(parsePort('4100'), 4100);
  assert.equal(parsePort('nope'), 3000);
});
