const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('the twelve existing migration files remain present', () => {
  for (let n = 1; n <= 12; n++) {
    const prefix = String(n).padStart(3, '0');
    assert.equal(fs.readdirSync('migrations').some((file) => file.startsWith(`${prefix}-`)), true);
  }
});
