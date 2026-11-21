const test = require('node:test');
const assert = require('node:assert/strict');
const { BUFFER_LIMIT_BYTES, exportRecords } = require('../src/export-route');
const { createPagedSource } = require('../src/data-source');

test('the configured export ceiling is documented by the public constant', () => {
  assert.equal(BUFFER_LIMIT_BYTES, 64);
});

test('a source is closed when the sink closes', async () => {
  const source = createPagedSource([[{ id: 1 }]]);
  const sink = { write() { return true; }, end() {}, once() {}, removeListener() {} };
  await exportRecords({ source, sink });
  assert.equal(source.closed, true);
});
