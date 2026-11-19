const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyMigration } = require('../src/verification/verify-migration');
test('verification passes equal counts', async () => {
  const store = {count: async () => 2};
  assert.equal((await verifyMigration(store, store)).ok, true);
});
