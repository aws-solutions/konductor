'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../src/api/router');
const { fixtureStore } = require('./test-fixtures');

function fakeRequest(method, url, body = '') {
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() { if (body) yield body; },
  };
}

function fakeResponse() {
  return {
    headers: {},
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(payload) { this.payload = payload; this.writableEnded = true; },
  };
}

test('router returns a JSON issue list', async () => {
  const response = fakeResponse();
  await createRouter(fixtureStore(), { defaultPageSize: 20, maxPageSize: 100 })(fakeRequest('GET', '/v1/issues'), response);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.payload).data.length, 3);
});

test('router keeps issue filters on cursor pages', async () => {
  const response = fakeResponse();
  await createRouter(fixtureStore(), { defaultPageSize: 20, maxPageSize: 100 })(fakeRequest('GET', '/v1/issues?status=closed&limit=1'), response);
  const body = JSON.parse(response.payload);
  assert.deepEqual(body.data.map((issue) => issue.id), ['ISS-3']);
  assert.deepEqual(Object.keys(body), ['data', 'page']);
});
