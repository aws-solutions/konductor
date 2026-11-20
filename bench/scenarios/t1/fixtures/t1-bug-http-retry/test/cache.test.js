'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { request, clearCache } = require('../src');

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function close(server) { return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

test('caches a successful GET when asked', async () => {
  clearCache();
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; res.end(`hit-${hits}`); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/value`;
    const first = await request(url, { cacheTtlMs: 5000 });
    const second = await request(url, { cacheTtlMs: 5000 });
    assert.equal(first.body, 'hit-1');
    assert.equal(second.body, 'hit-1');
    assert.equal(second.fromCache, true);
    assert.equal(hits, 1);
  } finally {
    clearCache();
    await close(server);
  }
});

test('does not cache a POST', async () => {
  clearCache();
  let hits = 0;
  const server = await listen((req, res) => { hits += 1; res.end('ok'); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/write`;
    await request(url, { method: 'POST', body: 'a', cacheTtlMs: 5000 });
    await request(url, { method: 'POST', body: 'b', cacheTtlMs: 5000 });
    assert.equal(hits, 2);
  } finally {
    clearCache();
    await close(server);
  }
});
