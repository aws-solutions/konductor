const test = require('node:test');
const assert = require('node:assert/strict');
const { requestHandler } = require('../src/server');

test('unknown routes return not found', () => {
  const response = { statusCode: 200, end(value) { this.body = value; } };
  requestHandler({ url: '/missing', method: 'GET' }, response);
  assert.equal(response.statusCode, 404);
  assert.match(response.body, /not found/);
});
