const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { saveUpload, readUpload } = require('../src/upload');

test('saves and reads back a plain file', () => {
  const p = saveUpload('notes.txt', 'hello');
  assert.strictEqual(readUpload('notes.txt'), 'hello');
  fs.unlinkSync(p);
});

test('rejects empty filename', () => {
  assert.throws(() => saveUpload('', 'x'), /filename required/);
});
