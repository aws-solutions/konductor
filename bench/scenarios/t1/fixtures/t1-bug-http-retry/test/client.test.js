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
