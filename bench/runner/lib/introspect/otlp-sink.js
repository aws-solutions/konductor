// SPDX-License-Identifier: Apache-2.0
'use strict';

// A loopback OTLP/HTTP receiver for one introspection run. Claude Code exports its logs, metrics and traces here
// instead of to any collector the host runs. Every request body is appended to one JSON-lines file in the run's
// introspect directory; nothing is forwarded. Only 127.0.0.1 is bound, on a port the OS picks.

const fs = require('node:fs');
const http = require('node:http');
const zlib = require('node:zlib');

const MAX_BODY = 64 * 1024 * 1024;

/** The bytes of an OTLP request body, gunzipped when `encoding` is gzip. */
function decodeBody(buf, encoding) {
  if (encoding === 'gzip') return zlib.gunzipSync(buf);
  if (encoding === 'deflate') return zlib.inflateSync(buf);
  return buf;
}

/**
 * Starts the receiver. Resolves to { url, port, stop }. `stop()` closes the server and resolves to counts of what
 * was received: { requests, bytes, bySignal: { logs, metrics, traces, other }, rejected }.
 */
function startSink({ file, host = '127.0.0.1' }) {
  const fd = fs.openSync(file, 'a', 0o600);
  const counts = { requests: 0, bytes: 0, bySignal: { logs: 0, metrics: 0, traces: 0, other: 0 }, rejected: 0, protobuf: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { aborted = true; req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      const signal = /\/v1\/(logs|metrics|traces)$/.exec(req.url || '')?.[1] ?? 'other';
      if (req.method !== 'POST') { counts.rejected++; res.writeHead(405).end(); return; }
      let body;
      let note = null;
      try {
        const raw = decodeBody(Buffer.concat(chunks), req.headers['content-encoding']);
        const type = String(req.headers['content-type'] || '');
        if (/json/.test(type)) body = JSON.parse(raw.toString('utf8'));
        else { body = raw.toString('base64'); note = `non-JSON body (${type || 'no content-type'}), kept as base64`; counts.protobuf++; }
      } catch (e) {
        body = null;
        note = `undecodable body: ${e.message}`;
      }
      counts.requests++;
      counts.bySignal[signal]++;
      counts.bytes += size;
      fs.writeSync(fd, `${JSON.stringify({ receivedAt: new Date().toISOString(), signal, path: req.url, ...(note ? { note } : {}), body })}\n`);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      const stop = () => new Promise((done) => {
        server.close(() => { try { fs.closeSync(fd); } catch { /* already closed */ } done({ ...counts, bySignal: { ...counts.bySignal } }); });
        server.closeAllConnections?.();
      });
      resolve({ url: `http://${host}:${port}`, port, stop });
    });
  });
}

module.exports = { startSink, MAX_BODY };
