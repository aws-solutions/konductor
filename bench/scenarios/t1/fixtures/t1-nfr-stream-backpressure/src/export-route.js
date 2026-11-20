const { defaultSource } = require('./data-source');
const { toLine } = require('./format');

const BUFFER_LIMIT_BYTES = 64;

async function exportRecords({ source = defaultSource, sink }) {
  if (!sink || typeof sink.write !== 'function') throw new TypeError('sink is required');
  if (typeof sink.setHeader === 'function') sink.setHeader('content-type', 'application/x-ndjson');
  let page;
  try {
    while ((page = await source.fetchPage()) !== null) {
      for (const record of page) sink.write(toLine(record));
    }
    sink.end();
  } catch (error) {
    if (!sink.headersSent && 'statusCode' in sink) sink.statusCode = 500;
    sink.end(toLine({ error: 'export failed' }));
  }
}

function createExportHandler({ source = defaultSource } = {}) {
  return (req, res) => exportRecords({ source, sink: res });
}

module.exports = { BUFFER_LIMIT_BYTES, exportRecords, createExportHandler };
