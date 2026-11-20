const { defaultSource } = require('./data-source');
const { toLine } = require('./format');

const BUFFER_LIMIT_BYTES = 64;

async function exportRecords({ source = defaultSource, sink, maxBufferedBytes = BUFFER_LIMIT_BYTES }) {
  if (!sink || typeof sink.write !== 'function') throw new TypeError('sink is required');
  if (typeof sink.setHeader === 'function') sink.setHeader('content-type', 'application/x-ndjson');
  let page;
  let recordsWritten = 0;
  try {
    while ((page = await source.fetchPage()) !== null) {
      for (const record of page) {
        const line = toLine(record);
        const canWrite = maxBufferedBytes === undefined || (sink.bufferedBytes || 0) + line.length <= maxBufferedBytes;
        if (!canWrite) {
          await new Promise(resolve => sink.once('drain', resolve));
        }
        sink.write(line);
        recordsWritten++;
      }
    }
    sink.end();
  } catch (error) {
    if ('statusCode' in sink) {
      if (recordsWritten === 0) sink.statusCode = 500;
    }
    sink.write(toLine({ error: 'export failed' }));
    sink.end();
  }
}

function createExportHandler({ source = defaultSource, maxBufferedBytes = BUFFER_LIMIT_BYTES } = {}) {
  return (req, res) => exportRecords({ source, sink: res, maxBufferedBytes });
}

module.exports = { BUFFER_LIMIT_BYTES, exportRecords, createExportHandler };
