const test = require('node:test');
const assert = require('node:assert/strict');
const { exportRecords } = require('../src/export-route');
const { createPagedSource } = require('../src/data-source');

function sink() { return { chunks: [], write(x) { this.chunks.push(x); return true; }, end(x) { if (x) this.chunks.push(x); } }; }

test('export writes newline-delimited records', async () => {
  const out = sink();
  await exportRecords({ source: createPagedSource([[{ id: 'a' }, { id: 'b' }]]), sink: out });
  assert.equal(out.chunks.join(''), '{"id":"a"}\n{"id":"b"}\n');
});

test('export reports a source failure', async () => {
  const source = { async fetchPage() { throw new Error('bad source'); }, close() {} };
  const out = sink();
  await exportRecords({ source, sink: out });
  assert.equal(out.chunks.join(''), '{"error":"export failed"}\n');
});

test('export handles backpressure', async () => {
  const out = { chunks: [], bufferedBytes: 0, write(x) { this.chunks.push(x); this.bufferedBytes += x.length; return this.bufferedBytes < 30; }, end(x) { if (x) this.chunks.push(x); }, once(evt, fn) { if (evt === 'drain') { setImmediate(() => { this.bufferedBytes = 0; fn(); }); } } };
  await exportRecords({ source: createPagedSource([[{ id: 'test-record-1' }, { id: 'test-record-2' }]]), sink: out, maxBufferedBytes: 30 });
  assert.equal(out.chunks.length, 2);
});
