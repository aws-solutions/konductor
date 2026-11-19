const test = require('node:test');
const assert = require('node:assert/strict');
const { LegacyStore } = require('../src/stores/legacy-store');
const { NewStore } = require('../src/stores/new-store');
const { migrateBatches } = require('../src/migration/batch-runner');
test('legacy store pages rows in order', async () => {
  const source = new LegacyStore([{id:'a'}, {id:'b'}, {id:'c'}]);
  assert.deepEqual(await source.page('a', 2), [{id:'b'}, {id:'c'}]);
});
test('migration copies a complete page', async () => {
  const source = new LegacyStore([{id:'a', email:'a'}, {id:'b', email:'b'}]);
  const target = new NewStore();
  const checkpoints = { read: async () => ({lastId:null,count:0}), write: async () => {} };
  const result = await migrateBatches({source, target, checkpoints, batchSize: 2});
  assert.equal(result.copied, 2);
  assert.equal(await target.count(), 2);
});
