// SPDX-License-Identifier: Apache-2.0
// Preloaded with `node --require` by claude-plugin-telemetry-hook.test.js.
// Replaces https.request so the hook never reaches the network, and appends
// each request it would have sent to $TELEMETRY_STUB_OUT as one JSON line.
// With TELEMETRY_STUB_MODE=hang the request never gets a response, and an open
// timer stands in for the socket until the hook destroys the request.
'use strict';

const fs = require('node:fs');
const https = require('node:https');
const { EventEmitter } = require('node:events');

https.request = (url, options) => {
  const request = new EventEmitter();
  const chunks = [];
  let socket = null;
  request.setTimeout = () => request;
  request.destroy = () => {
    clearInterval(socket);
    request.emit('close');
  };
  request.write = (chunk) => chunks.push(Buffer.from(chunk));
  const record = () => {
    fs.appendFileSync(
      process.env.TELEMETRY_STUB_OUT,
      `${JSON.stringify({
        url: String(url),
        method: options.method,
        headers: options.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })}\n`,
    );
    if (process.env.TELEMETRY_STUB_MODE === 'hang') {
      socket = setInterval(() => {}, 1000);
      return;
    }
    setImmediate(() => {
      const response = new EventEmitter();
      response.resume = () => setImmediate(() => response.emit('end'));
      request.emit('response', response);
    });
  };
  request.end = (chunk) => {
    if (chunk) {
      chunks.push(Buffer.from(chunk));
    }
    record();
  };
  return request;
};
