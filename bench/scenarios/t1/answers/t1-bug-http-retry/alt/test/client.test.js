'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { request } = require('../src');

function server(handler) {
  const instance = http.createServer(handler);
  return new Promise((resolve) => instance.listen(0, '127.0.0.1', () => resolve(instance)));
}
function address(instance) { return `http://127.0.0.1:${instance.address().port}`; }
function close(instance) { return new Promise((resolve, reject) => instance.close((error) => error ? reject(error) : resolve())); }

test('gets a text response and normalises headers', async () => {
  const instance = await server((req, res) => {
    res.setHeader('X-Trace-Id', 'abc');
    res.end('hello');
  });
  try {
    const result = await request(`${address(instance)}/hello`);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, 'hello');
    assert.equal(result.headers['x-trace-id'], 'abc');
    assert.equal(result.attempts, 1);
  } finally { await close(instance); }
});

test('sends a POST body', async () => {
  const instance = await server((req, res) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => res.end(text.toUpperCase()));
  });
  try {
    const result = await request(address(instance), { method: 'POST', body: 'catalog' });
    assert.equal(result.body, 'CATALOG');
  } finally { await close(instance); }
});

test('passes attempt and completion events to the logger', async () => {
  const events = [];
  const instance = await server((req, res) => res.end('ok'));
  try {
    await request(address(instance), { logger: (event) => events.push(event) });
    assert.deepEqual(events.map((event) => event.type), ['attempt', 'complete']);
  } finally { await close(instance); }
});

test('preserves POST body across retries', async () => {
  let requestCount = 0;
  const instance = await server((req, res) => {
    requestCount += 1;
    if (requestCount < 2) {
      res.statusCode = 503;
      res.end('retry');
      return;
    }
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => res.end(text.toUpperCase()));
  });
  try {
    const result = await request(address(instance), { method: 'POST', body: 'catalog', retries: 1 });
    assert.equal(result.body, 'CATALOG');
    assert.equal(result.attempts, 2);
  } finally { await close(instance); }
});

test('clears timeout after response completes', async () => {
  const clearTimeouts = [];
  const timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => { clearTimeouts.push(id); clearTimeout(id); }
  };
  const instance = await server((req, res) => res.end('ok'));
  try {
    const result = await request(address(instance), { timers });
    assert.equal(result.body, 'ok');
    assert.ok(clearTimeouts.length >= 1, 'timeout was cleared');
  } finally { await close(instance); }
});

test('honors Retry-After header in seconds', async () => {
  const events = [];
  const instance = await server((req, res) => {
    res.setHeader('Retry-After', '1');
    res.statusCode = 503;
    res.end('retry');
  });
  try {
    await request(address(instance), { retries: 1, logger: (e) => events.push(e), sleep: async (ms) => events.push({ sleep: ms }) });
    // Retry-After header value 1 means 1 second = 1000ms
    assert.ok(events.some(e => e.sleep === 1000), 'used Retry-After value');
  } finally { await close(instance); }
});

test('times out with ETIMEDOUT error code', async () => {
  const instance = await server((req, res) => {
    // Never respond
  });
  try {
    await assert.rejects(
      request(address(instance), { timeoutMs: 50 }),
      (error) => error.code === 'ETIMEDOUT'
    );
  } finally { await close(instance); }
});

test('counts actual network attempts', async () => {
  let requestCount = 0;
  const instance = await server((req, res) => {
    requestCount += 1;
    if (requestCount < 3) {
      res.statusCode = 503;
      res.end('retry');
      return;
    }
    res.end('done');
  });
  try {
    const result = await request(address(instance), { retries: 2 });
    assert.equal(result.attempts, 3);
    assert.equal(result.statusCode, 200);
  } finally { await close(instance); }
});

test('uses custom sleep callback for retry delays', async () => {
  const sleepCalls = [];
  const instance = await server((req, res) => {
    res.statusCode = 503;
    res.end('retry');
  });
  try {
    await request(address(instance), {
      retries: 1,
      retryDelayMs: 50,
      sleep: async (ms) => { sleepCalls.push(ms); }
    });
    assert.ok(sleepCalls.length >= 1, 'sleep was called');
    assert.ok(sleepCalls.includes(50), 'used configured delay');
  } finally { await close(instance); }
});
