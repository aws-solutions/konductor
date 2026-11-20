'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { request, clearCache } = require('../src');

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function url(server) { return `http://127.0.0.1:${server.address().port}/item`; }
function close(server) { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
function immediateSleep(delays) { return (ms) => { delays.push(ms); return Promise.resolve(); }; }


test('retries a transient response once and reports both attempts', async () => {
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; res.statusCode = hits === 1 ? 503 : 200; res.end(hits === 1 ? 'busy' : 'ready'); });
  try {
    const result = await request(url(server), { retries: 1, sleep: () => Promise.resolve() });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, 'ready');
    assert.equal(result.attempts, 2);
    assert.equal(hits, 2);
  } finally { await close(server); }
});

test('retries means additional attempts rather than total attempts', async () => {
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; res.statusCode = hits < 3 ? 503 : 200; res.end(String(hits)); });
  try {
    const result = await request(url(server), { retries: 2, sleep: () => Promise.resolve() });
    assert.equal(result.body, '3');
    assert.equal(result.attempts, 3);
    assert.equal(hits, 3);
  } finally { await close(server); }
});

test('does not retry a status outside the configured list', async () => {
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; res.statusCode = 400; res.end('bad'); });
  try {
    const result = await request(url(server), { retries: 4, sleep: () => Promise.resolve() });
    assert.equal(result.statusCode, 400);
    assert.equal(result.attempts, 1);
    assert.equal(hits, 1);
  } finally { await close(server); }
});

test('uses a fallback delay when Retry-After is absent', async () => {
  const delays = [];
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; res.statusCode = hits === 1 ? 503 : 200; res.end('ok'); });
  try {
    await request(url(server), { retries: 1, retryDelayMs: 275, sleep: immediateSleep(delays) });
    assert.deepEqual(delays, [275]);
  } finally { await close(server); }
});

test('treats a numeric Retry-After value as seconds', async () => {
  const delays = [];
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; if (hits === 1) res.setHeader('Retry-After', '1'); res.statusCode = hits === 1 ? 503 : 200; res.end('ok'); });
  try {
    await request(url(server), { retries: 1, retryDelayMs: 25, sleep: immediateSleep(delays) });
    assert.deepEqual(delays, [1000]);
  } finally { await close(server); }
});

test('falls back for an invalid Retry-After value', async () => {
  const delays = [];
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; res.setHeader('Retry-After', 'later'); res.statusCode = hits === 1 ? 503 : 200; res.end('ok'); });
  try {
    await request(url(server), { retries: 1, retryDelayMs: 310, sleep: immediateSleep(delays) });
    assert.deepEqual(delays, [310]);
  } finally { await close(server); }
});

test('replays a string body on every POST attempt', async () => {
  const bodies = [];
  let hits = 0;
  const server = await listen((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (part) => { body += part; });
    req.on('end', () => { bodies.push(body); hits += 1; res.statusCode = hits === 1 ? 503 : 200; res.end('ok'); });
  });
  try {
    await request(url(server), { method: 'POST', body: 'reusable-payload', retries: 2, sleep: () => Promise.resolve() });
    assert.deepEqual(bodies, ['reusable-payload', 'reusable-payload']);
  } finally { await close(server); }
});

test('replays a Buffer body on every attempt', async () => {
  const bodies = [];
  let hits = 0;
  const server = await listen((req, res) => {
    const chunks = [];
    req.on('data', (part) => chunks.push(part));
    req.on('end', () => { bodies.push(Buffer.concat(chunks)); hits += 1; res.statusCode = hits === 1 ? 502 : 200; res.end('ok'); });
  });
  try {
    await request(url(server), { method: 'POST', body: Buffer.from('binary-payload'), retries: 2, sleep: () => Promise.resolve() });
    assert.deepEqual(bodies.map((body) => body.toString()), ['binary-payload', 'binary-payload']);
  } finally { await close(server); }
});

test('clears the timeout after a complete response', async () => {
  const timers = [];
  let cleared = 0;
  const timerApi = {
    setTimeout(fn, ms) { const handle = { fn, ms }; timers.push(handle); return handle; },
    clearTimeout(handle) { if (handle) { handle.cleared = true; cleared += 1; } }
  };
  const server = await listen((req, res) => res.end('done'));
  try {
    const result = await request(url(server), { timeoutMs: 40, timers: timerApi });
    assert.equal(result.body, 'done');
    assert.equal(timers.length, 1);
    assert.equal(cleared, 1);
    assert.equal(timers[0].cleared, true);
  } finally { await close(server); }
});

test('reports a timeout with the documented error code', async () => {
  const pending = [];
  const timerApi = {
    setTimeout(fn, ms) { const handle = { fn, ms }; pending.push(handle); return handle; },
    clearTimeout() {}
  };
  const server = await listen(() => {});
  try {
    const result = request(url(server), { timeoutMs: 12, timers: timerApi });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pending.length, 1);
    pending[0].fn();
    await assert.rejects(result, (error) => error.code === 'ETIMEDOUT');
  } finally { await close(server); }
});

test('can retry a timed out attempt within the retry budget', async () => {
  const pending = [];
  const timerApi = {
    setTimeout(fn, ms) { const handle = { fn, ms }; pending.push(handle); return handle; },
    clearTimeout() {}
  };
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; if (hits > 1) res.end('recovered'); });
  try {
    const result = request(url(server), { retries: 1, timeoutMs: 20, timers: timerApi, sleep: () => Promise.resolve() });
    await new Promise((resolve) => setImmediate(resolve));
    pending[0].fn();
    await new Promise((resolve) => setImmediate(resolve));
    // The second attempt gets a timer, then the server supplies its response.
    const response = await result;
    assert.equal(response.body, 'recovered');
    assert.equal(response.attempts, 2);
    assert.equal(hits, 2);
  } finally { await close(server); }
});

test('honours an HTTP-date Retry-After value without waiting in the test', async () => {
  const delays = [];
  let hits = 0;
  const server = await listen((req, res) => {
    hits += 1;
    if (hits === 1) res.setHeader('Retry-After', new Date(Date.now() + 3000).toUTCString());
    res.statusCode = hits === 1 ? 503 : 200;
    res.end('ok');
  });
  try {
    await request(url(server), { retries: 1, retryDelayMs: 20, sleep: immediateSleep(delays) });
    assert.equal(delays.length, 1);
    assert.ok(delays[0] >= 1800 && delays[0] <= 3000);
  } finally { await close(server); }
});

test('logs a retry event with the chosen delay', async () => {
  const events = [];
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; res.statusCode = hits === 1 ? 503 : 200; res.end('ok'); });
  try {
    await request(url(server), { retries: 1, retryDelayMs: 44, sleep: () => Promise.resolve(), logger: (event) => events.push(event) });
    const retry = events.find((event) => event.type === 'retry');
    assert.equal(retry.delay, 44);
    assert.equal(retry.attempt, 1);
  } finally { await close(server); }
});

test('does not use a cached response for a retry scenario', async () => {
  clearCache();
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; res.statusCode = hits === 1 ? 503 : 200; res.end(`value-${hits}`); });
  try {
    const result = await request(url(server), { retries: 1, cacheTtlMs: 5000, sleep: () => Promise.resolve() });
    assert.equal(result.body, 'value-2');
    assert.equal(result.fromCache, undefined);
    assert.equal(hits, 2);
  } finally { clearCache(); await close(server); }
});
