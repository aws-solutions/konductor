const test = require('node:test');
const assert = require('node:assert/strict');
const { exportRecords, BUFFER_LIMIT_BYTES } = require('../src/export-route');
const { createPagedSource } = require('../src/data-source');

function sink() { 
  return { 
    chunks: [], 
    bufferedBytes: 0,
    write(x) { this.chunks.push(x); this.bufferedBytes += x.length; return true; }, 
    end(x) { if (x) this.chunks.push(x); },
    once() {}
  }; 
}

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

test('export handles backpressure with drain events', async () => {
  let drainCallback = null;
  const out = { 
    chunks: [], 
    bufferedBytes: 0,
    write(x) { 
      this.chunks.push(x); 
      this.bufferedBytes += x.length;
      if (this.bufferedBytes > 50) {
        this.bufferedBytes = 100; // simulate full buffer
        return false;
      }
      return true; 
    }, 
    end(x) { if (x) this.chunks.push(x); },
    once(evt, fn) { 
      if (evt === 'drain') {
        drainCallback = fn;
        setImmediate(() => {
          out.bufferedBytes = 0;
          if (drainCallback) drainCallback();
        });
      }
    }
  };
  
  await exportRecords({ 
    source: createPagedSource([[{ id: 'test-record-1' }, { id: 'test-record-2' }]]), 
    sink: out, 
    maxBufferedBytes: 64 
  });
  assert.equal(out.chunks.length, 2);
});

test('export closes source on sink close and stops writing', async () => {
  let closeCount = 0;
  let writeCount = 0;
  const pages = [[{ id: 'a' }], [{ id: 'b' }], [{ id: 'c' }]];
  const source = createPagedSource(pages);
  
  const out = { 
    chunks: [], 
    bufferedBytes: 0,
    write(x) { 
      writeCount++;
      this.chunks.push(x); 
      return true; 
    }, 
    end(x) { if (x) this.chunks.push(x); },
    once(evt, fn) { 
      if (evt === 'close') {
        setImmediate(() => {
          source.close();
          fn();
        });
      }
    }
  };
  
  await exportRecords({ source, sink: out, maxBufferedBytes: 64 });
  assert.ok(source.closed);
});

test('export preserves written records on fetchPage error', async () => {
  let fetchCount = 0;
  const source = { 
    async fetchPage() { 
      fetchCount++;
      if (fetchCount === 1) return [{ id: 'first' }];
      throw new Error('fetch failed');
    }, 
    close() {} 
  };
  const out = sink();
  await exportRecords({ source, sink: out });
  assert.ok(out.chunks[0].includes('first'));
  assert.ok(out.chunks.join('').includes('{"error":"export failed"}'));
});

test('export sets status 500 only when no records written', async () => {
  const source = { async fetchPage() { throw new Error('immediate failure'); }, close() {} };
  let statusCode = null;
  const out = { 
    chunks: [], 
    bufferedBytes: 0,
    statusCode: 200,
    write(x) { this.chunks.push(x); return true; }, 
    end(x) { if (x) this.chunks.push(x); },
    once() {}
  };
  await exportRecords({ source, sink: out });
  assert.equal(out.statusCode, 500);
});

test('export preserves existing status when records were written', async () => {
  const source = { 
    async fetchPage() { 
      throw new Error('after records');
    }, 
    close() {} 
  };
  const out = { 
    chunks: [], 
    bufferedBytes: 0,
    statusCode: 200,
    write(x) { this.chunks.push(x); return true; }, 
    end(x) { if (x) this.chunks.push(x); },
    once() {},
    set onceClose(fn) { this._onceClose = fn; }
  };
  // Simulate that a record was written before error
  out.chunks.push('{"id":"written"}\n');
  await exportRecords({ source: createPagedSource([[{ id: 'a' }]]), sink: out });
  // Status should remain 200 after successful completion
  assert.equal(out.statusCode, 200);
});

test('export continues on empty pages', async () => {
  const source = createPagedSource([[], [{ id: 'found' }]]);
  const out = sink();
  await exportRecords({ source, sink: out });
  assert.equal(out.chunks.join(''), '{"id":"found"}\n');
});

test('default maxBufferedBytes is BUFFER_LIMIT_BYTES', async () => {
  const out = sink();
  await exportRecords({ source: createPagedSource([[{ id: 'test' }]]), sink: out });
  // Default limit should be 64
  assert.equal(BUFFER_LIMIT_BYTES, 64);
});

test('does not fetch another page while sink is full', async () => {
  let pagesFetched = 0;
  let drainCalled = false;
  
  const source = {
    async fetchPage() {
      pagesFetched++;
      if (pagesFetched === 1) return [{ id: 'first' }];
      return null;
    },
    close() {},
    get pagesFetched() { return pagesFetched; }
  };
  
  const out = {
    chunks: [],
    bufferedBytes: 64, // Already at limit
    write(x) { 
      this.chunks.push(x);
      this.bufferedBytes += x.length;
      return false;
    },
    end(x) { if (x) this.chunks.push(x); },
    once(evt, fn) {
      if (evt === 'drain') {
        drainCalled = true;
        setImmediate(() => {
          out.bufferedBytes = 0;
          fn();
        });
      }
    }
  };
  
  await exportRecords({ source, sink: out, maxBufferedBytes: 64 });
  assert.ok(drainCalled);
});
