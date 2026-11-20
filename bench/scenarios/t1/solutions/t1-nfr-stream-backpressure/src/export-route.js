const { defaultSource } = require('./data-source');
const { toLine } = require('./format');

const BUFFER_LIMIT_BYTES = 64;

function bufferedBytes(sink) {
  if (Number.isFinite(sink.bufferedBytes)) return sink.bufferedBytes;
  if (Number.isFinite(sink.writableLength)) return sink.writableLength;
  return null;
}

function waitForDrain(sink) {
  return new Promise((resolve) => {
    if (typeof sink.once !== 'function') return resolve();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    sink.once('drain', finish);
    sink.once('close', finish);
  });
}

async function exportRecords({ source = defaultSource, sink, maxBufferedBytes = BUFFER_LIMIT_BYTES }) {
  if (!sink || typeof sink.write !== 'function') throw new TypeError('sink is required');
  if (typeof sink.setHeader === 'function') sink.setHeader('content-type', 'application/x-ndjson');

  let stopped = Boolean(sink.destroyed);
  let wroteRecord = false;
  let ended = false;
  const onClose = () => {
    stopped = true;
    if (typeof source.close === 'function') source.close();
  };
  if (typeof sink.once === 'function') sink.once('close', onClose);

  const canWrite = (line) => {
    if (stopped || ended) return false;
    const current = bufferedBytes(sink);
    return current === null || current + Buffer.byteLength(line) <= maxBufferedBytes;
  };

  const writeLine = async (line) => {
    while (!canWrite(line)) {
      if (stopped || ended) return false;
      await waitForDrain(sink);
    }
    if (stopped || ended) return false;
    const accepted = sink.write(line);
    wroteRecord = true;
    if (accepted === false) await waitForDrain(sink);
    return !stopped;
  };

  try {
    let page;
    while (!stopped && (page = await source.fetchPage()) !== null) {
      for (const record of page) {
        if (!(await writeLine(toLine(record)))) break;
      }
    }
    if (!stopped) {
      ended = true;
      sink.end();
    }
  } catch (error) {
    if (!stopped) {
      const errorLine = toLine({ error: 'export failed' });
      if (!wroteRecord && !sink.headersSent && 'statusCode' in sink) sink.statusCode = 500;
      try {
        await writeLine(errorLine);
      } catch {}
      if (!ended) {
        ended = true;
        sink.end();
      }
    }
  } finally {
    stopped = stopped || ended;
    if (typeof source.close === 'function') source.close();
    if (typeof sink.removeListener === 'function') sink.removeListener('close', onClose);
  }
  return { stopped, wroteRecord };
}

function createExportHandler({ source = defaultSource, maxBufferedBytes = BUFFER_LIMIT_BYTES } = {}) {
  return (req, res) => exportRecords({ source, sink: res, maxBufferedBytes });
}

module.exports = { BUFFER_LIMIT_BYTES, exportRecords, createExportHandler };
