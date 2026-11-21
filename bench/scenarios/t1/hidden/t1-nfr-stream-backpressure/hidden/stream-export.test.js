const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BUFFER_LIMIT_BYTES, exportRecords, createExportHandler } = require('../src/export-route');
const { createPagedSource } = require('../src/data-source');

class Sink extends EventEmitter {
  constructor({ track = false, stopAt = Infinity } = {}) {
    super();
    if (track) this.bufferedBytes = 0;
    this.stopAt = stopAt;
    this.chunks = [];
    this.maxBufferedBytes = 0;
    this.statusCode = 200;
    this.headersSent = false;
    this.ended = false;
  }
  setHeader(name, value) { this.headers = { ...this.headers, [name]: value }; }
  write(chunk) {
    if (this.ended) throw new Error('write after end');
    this.chunks.push(String(chunk));
    this.headersSent = true;
    if (typeof this.bufferedBytes === 'number') {
      this.bufferedBytes += Buffer.byteLength(String(chunk));
      this.maxBufferedBytes = Math.max(this.maxBufferedBytes, this.bufferedBytes);
    }
    return typeof this.bufferedBytes !== 'number' || this.bufferedBytes < this.stopAt;
  }
  end(chunk) {
    if (chunk !== undefined) this.write(chunk);
    this.ended = true;
  }
  consume() {
    if (typeof this.bufferedBytes === 'number') this.bufferedBytes = 0;
    this.emit('drain');
  }
}
const flush = () => Promise.resolve().then(() => Promise.resolve());

test('the public limit is 64 bytes', () => assert.equal(BUFFER_LIMIT_BYTES, 64));

test('fast output preserves every line and an empty final page', async () => {
  const source = createPagedSource([[{ id: 'a' }], [], [{ id: 'b' }]]);
  const sink = new Sink();
  await exportRecords({ source, sink });
  assert.equal(sink.chunks.join(''), '{"id":"a"}\n{"id":"b"}\n');
  assert.equal(source.closed, true);
});

test('a stalled sink never receives more than the configured buffered ceiling', async () => {
  const source = createPagedSource([[{ id: 'aaaaaaaaaaaaaaaa' }, { id: 'bbbbbbbbbbbbbbbb' }], [{ id: 'later' }]]);
  const sink = new Sink({ track: true, stopAt: 1000 });
  const run = exportRecords({ source, sink, maxBufferedBytes: 40 });
  await flush();
  assert.ok(sink.bufferedBytes <= 40);
  assert.equal(source.pagesFetched, 1);
  sink.consume();
  await flush();
  sink.consume();
  await run;
  assert.equal(source.pagesFetched, 2);
});

test('a slow reader can resume and receive the complete export', async () => {
  const sink = new Sink({ track: true, stopAt: 25 });
  const source = createPagedSource([[{ n: 1 }, { n: 2 }], [{ n: 3 }]]);
  const run = exportRecords({ source, sink, maxBufferedBytes: 64 });
  for (let i = 0; i < 8 && !sink.ended; i++) { await flush(); sink.consume(); }
  await run;
  assert.equal(sink.chunks.join(''), '{"n":1}\n{"n":2}\n{"n":3}\n');
  assert.ok(sink.maxBufferedBytes <= 64);
  assert.equal(source.closed, true);
});

test('a page is not fetched while the first page is waiting for drain', async () => {
  const source = createPagedSource([[{ value: '12345678901234567890' }], [{ value: 'next' }]]);
  const sink = new Sink({ track: true, stopAt: 1 });
  const run = exportRecords({ source, sink, maxBufferedBytes: 64 });
  await flush();
  assert.equal(source.pagesFetched, 1);
  sink.consume();
  await flush();
  sink.consume();
  await run;
  assert.equal(source.pagesFetched, 2);
});

test('closing a sink during a pending fetch stops later page reads', async () => {
  let release;
  let calls = 0;
  const source = { fetchPage() { calls++; if (calls === 1) return new Promise(resolve => { release = resolve; }); return null; }, close() { this.wasClosed = true; } };
  const sink = new Sink();
  const run = exportRecords({ source, sink });
  await flush();
  sink.emit('close');
  release([{ id: 'discarded' }]);
  await run;
  assert.equal(calls, 1);
  assert.equal(source.wasClosed, true);
  assert.equal(sink.ended, false);
});

test('closing a sink while waiting for drain does not end it', async () => {
  const source = createPagedSource([[{ id: 'one' }], [{ id: 'two' }]]);
  const sink = new Sink({ track: true, stopAt: 1 });
  const run = exportRecords({ source, sink });
  await flush();
  sink.emit('close');
  sink.emit('drain');
  await run;
  assert.equal(sink.ended, false);
  assert.equal(source.closed, true);
});

test('a close between pages prevents another fetch', async () => {
  let calls = 0;
  const source = { async fetchPage() { calls++; return calls === 1 ? [{ id: 1 }] : null; }, close() { this.closed = true; } };
  const sink = new Sink();
  const originalWrite = sink.write.bind(sink);
  sink.write = (line) => { const result = originalWrite(line); sink.emit('close'); return result; };
  await exportRecords({ source, sink });
  assert.equal(calls, 1);
});

test('a failure before output sets status 500 and writes the defined error line', async () => {
  const source = { async fetchPage() { throw new Error('database detail'); }, close() { this.closed = true; } };
  const sink = new Sink();
  await exportRecords({ source, sink });
  assert.equal(sink.statusCode, 500);
  assert.equal(sink.chunks.join(''), '{"error":"export failed"}\n');
  assert.equal(sink.ended, true);
  assert.equal(source.closed, true);
});

test('a mid-export failure keeps prior bytes and appends one error line', async () => {
  let call = 0;
  const source = { async fetchPage() { call++; if (call === 1) return [{ id: 'ok' }]; throw new Error('private detail'); }, close() { this.closed = true; } };
  const sink = new Sink();
  await exportRecords({ source, sink });
  assert.equal(sink.statusCode, 200);
  assert.equal(sink.chunks.join(''), '{"id":"ok"}\n{"error":"export failed"}\n');
  assert.equal(sink.chunks.join('').includes('private detail'), false);
  assert.equal(source.closed, true);
});

test('successful output ends exactly once with no error record', async () => {
  const sink = new Sink();
  const source = createPagedSource([[{ ok: true }]]);
  await exportRecords({ source, sink });
  assert.equal(sink.ended, true);
  assert.equal(sink.chunks.filter(line => line.includes('error')).length, 0);
  assert.equal(source.closed, true);
});

test('the route sets the NDJSON content type', async () => {
  const sink = new Sink();
  await createExportHandler({ source: createPagedSource([[]]) })({}, sink);
  assert.equal(sink.headers['content-type'], 'application/x-ndjson');
});

test('the handler accepts a custom byte limit', async () => {
  const sink = new Sink({ track: true, stopAt: 1000 });
  const source = createPagedSource([[{ id: 'first' }, { id: 'second' }], [{ id: 'later' }]]);
  const run = createExportHandler({ source, maxBufferedBytes: 20 })({}, sink);
  await flush();
  assert.equal(source.pagesFetched, 1);
  assert.ok(sink.maxBufferedBytes <= 20);
  sink.consume();
  await flush();
  sink.consume();
  await run;
  assert.equal(sink.ended, true);
  assert.equal(source.pagesFetched, 2);
});

test('normal completion closes the source', async () => {
  const source = createPagedSource([[{ id: 1 }]]);
  await exportRecords({ source, sink: new Sink() });
  assert.equal(source.closed, true);
});

test('empty pages do not terminate later pages', async () => {
  const source = createPagedSource([[{ id: 1 }], [], [{ id: 2 }], []]);
  const sink = new Sink();
  await exportRecords({ source, sink });
  assert.equal(sink.chunks.join(''), '{"id":1}\n{"id":2}\n');
  assert.equal(source.pagesFetched, 4);
  assert.equal(source.closed, true);
});

test('source errors close the source as well as the sink', async () => {
  const source = { async fetchPage() { throw new Error('nope'); }, close() { this.closed = true; } };
  await exportRecords({ source, sink: new Sink() });
  assert.equal(source.closed, true);
});
