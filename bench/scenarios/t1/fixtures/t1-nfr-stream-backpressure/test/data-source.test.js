const test = require('node:test');
const assert = require('node:assert/strict');
const { createPagedSource } = require('../src/data-source');

test('paged source returns pages in order and counts fetches', async () => {
  const source = createPagedSource([[{ id: 1 }], [{ id: 2 }]]);
  assert.deepEqual(await source.fetchPage(), [{ id: 1 }]);
  assert.deepEqual(await source.fetchPage(), [{ id: 2 }]);
  assert.equal(source.pagesFetched, 2);
  source.close();
  assert.equal(await source.fetchPage(), null);
});

test('source accepts an empty page', async () => {
  const source = createPagedSource([[], [{ id: 'later' }]]);
  assert.deepEqual(await source.fetchPage(), []);
  assert.deepEqual(await source.fetchPage(), [{ id: 'later' }]);
});
