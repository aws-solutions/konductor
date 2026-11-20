const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readEntries, writeEntries } = require('../src/store');

test('store writes and reads a temporary ledger', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minute-mason-'));
  try {
    const file = path.join(dir, 'nested', 'ledger.json');
    const entries = [{ id: 'local', minutes: 8 }];
    writeEntries(file, entries);
    assert.deepEqual(readEntries(file), entries);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
