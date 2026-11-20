const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the new numbered migration exports both directions', () => {
  const file = path.join(process.cwd(), 'migrations', '013-split-customer-address.js');
  assert.ok(fs.existsSync(file));
  const migration = require(file);
  assert.equal(typeof migration.up, 'function');
  assert.equal(typeof migration.down, 'function');
});
