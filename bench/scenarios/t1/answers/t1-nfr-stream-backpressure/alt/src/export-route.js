const { defaultSource } = require('./data-source');
const { toLine } = require('./format');

const BUFFER_LIMIT_BYTES = 64;

async function exportRecords({ source = defaultSource, sink, maxBufferedBytes = BUFFER_LIMIT_BYTES }) {
  if (!sink || typeof sink.write !== 'function') throw new TypeError('sink is required');
  if (typeof sink.setHeader === 'function') sink.setHeader('content-type', 'application/x-ndjson');
  
  let recordsWritten = 0;
  let sinkClosed = false;
  let sourceClosed = false;
  
  function handleSinkClose() {
    sinkClosed = true;
    if (!sourceClosed && source && typeof source.close === 'function') {
      source.close();
      sourceClosed = true;
    }
  }
  
  if (typeof sink.once === 'function') {
    sink.once('close', handleSinkClose);
  }
  
  async function waitForDrain() {
    return new Promise(resolve => {
      sink.once('drain', resolve);
    });
  }
  
  async function writeWithBackpressure(line) {
    if (sinkClosed) return false;
    
    const currentBuffered = sink.bufferedBytes !== undefined ? sink.bufferedBytes : (sink.writableLength || 0);
    const remaining = maxBufferedBytes - currentBuffered;
    
    if (line.length > remaining) {
      if (currentBuffered >= maxBufferedBytes) {
        await waitForDrain();
      }
      if (sinkClosed) return false;
    }
    
    const canWrite = sink.write(line);
    recordsWritten++;
    
    if (!canWrite && !sinkClosed) {
      await waitForDrain();
    }
    
    return !sinkClosed;
  }
  
  try {
    let page;
    while ((page = await source.fetchPage()) !== null) {
      if (sinkClosed) break;
      
      for (const record of page) {
        if (sinkClosed) break;
        const line = toLine(record);
        const written = await writeWithBackpressure(line);
        if (!written) break;
      }
    }
    
    if (!sourceClosed && source && typeof source.close === 'function') {
      source.close();
      sourceClosed = true;
    }
    
    if (!sinkClosed) {
      sink.end();
    }
  } catch (error) {
    if (!sourceClosed && source && typeof source.close === 'function') {
      source.close();
      sourceClosed = true;
    }
    
    if ('statusCode' in sink && recordsWritten === 0) {
      sink.statusCode = 500;
    }
    
    if (!sinkClosed) {
      sink.write(toLine({ error: 'export failed' }));
      sink.end();
    }
  }
}

function createExportHandler({ source = defaultSource, maxBufferedBytes = BUFFER_LIMIT_BYTES } = {}) {
  return (req, res) => exportRecords({ source, sink: res, maxBufferedBytes });
}

module.exports = { BUFFER_LIMIT_BYTES, exportRecords, createExportHandler };
