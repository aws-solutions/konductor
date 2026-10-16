// SPDX-License-Identifier: Apache-2.0
// Preloaded with `node --require` by claude-plugin-telemetry-hook.test.js.
// Replaces https.request so the hook never reaches the network, and appends
// each request it would have sent to $TELEMETRY_STUB_OUT as one JSON line.
//
// With $TELEMETRY_STUB_DNS set (comma-separated addresses), dns.lookup
// answers with those addresses and the stub runs the request's `lookup`
// option the way a socket would. A lookup error means nothing is recorded.
'use strict';

const dns = require('node:dns');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const { EventEmitter } = require('node:events');

const stubAddresses = process.env.TELEMETRY_STUB_DNS;
if (stubAddresses !== undefined) {
  dns.lookup = (hostname, options, callback) => {
    const addresses = stubAddresses
      .split(',')
      .filter(Boolean)
      .map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
    setImmediate(() => callback(null, addresses));
  };
}

https.request = (url, options) => {
  const request = new EventEmitter();
  const chunks = [];
  request.setTimeout = () => request;
  request.destroy = () => request.emit('close');
  request.write = (chunk) => chunks.push(Buffer.from(chunk));
  const record = (pinned) => {
    fs.appendFileSync(
      process.env.TELEMETRY_STUB_OUT,
      `${JSON.stringify({
        url: String(url),
        method: options.method,
        headers: options.headers,
        hasLookup: typeof options.lookup === 'function',
        pinned,
        body: Buffer.concat(chunks).toString('utf8'),
      })}\n`,
    );
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
    if (stubAddresses === undefined || typeof options.lookup !== 'function') {
      record(null);
      return;
    }
    options.lookup(new URL(String(url)).hostname, { all: false }, (err, address) => {
      if (err) {
        request.emit('error', err);
        return;
      }
      record(address);
    });
  };
  return request;
};
