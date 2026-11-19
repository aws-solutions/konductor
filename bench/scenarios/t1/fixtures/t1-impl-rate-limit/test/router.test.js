const test = require('node:test');
const assert = require('node:assert/strict');
const { Router } = require('../src/router');

test('router extracts a URL parameter', () => {
  const router = new Router();
  router.add('GET', '/rooms/:id', () => 'ok');
  const match = router.match('GET', '/rooms/42');
  assert.equal(match.params.id, '42');
});

test('router does not match a different method', () => {
  const router = new Router();
  router.add('GET', '/rooms', () => 'ok');
  assert.equal(router.match('POST', '/rooms'), null);
});
